//! The planner's operations, shared by the web app's sync API, the agent REST API and MCP.
//!
//! Everything writes through [`write`], which bumps the revision, so changes made by agents show
//! up in every open browser on its next sync.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::{
    Date, Duration, Month, format_description::BorrowedFormatItem, macros::format_description,
};

use crate::{
    entries::{COLORS, Entry, Settings, normalize, normalize_settings, valid_date},
    error::{AppError, AppResult},
};

const DATE_FORMAT: &[BorrowedFormatItem<'static>] = format_description!("[year]-[month]-[day]");

/// Longest range one request may fill or clear (about ten years).
pub const MAX_RANGE_DAYS: i64 = 3660;
const UPCOMING_DAYS: i64 = 60;
const UPCOMING_LIMIT: usize = 10;

// ── Dates ────────────────────────────────────────────────────────────────────

pub fn parse_date(value: &str) -> AppResult<Date> {
    if !valid_date(value) {
        return Err(AppError::BadRequest(format!(
            "Invalid date {value:?}: use YYYY-MM-DD, e.g. 2026-03-14"
        )));
    }
    Date::parse(value, DATE_FORMAT)
        .map_err(|_| AppError::BadRequest(format!("Invalid date {value:?}")))
}

pub fn format_date(date: Date) -> String {
    date.format(DATE_FORMAT).expect("dates always format")
}

/// Today in the server's time zone (`TZ` or the system setting), unless a date is given.
pub fn today(override_date: Option<&str>) -> AppResult<Date> {
    if let Some(date) = override_date {
        return parse_date(date);
    }
    let now = jiff::Zoned::now().date();
    let month = Month::try_from(now.month() as u8).expect("valid month");
    Ok(
        Date::from_calendar_date(i32::from(now.year()), month, now.day() as u8)
            .expect("valid date"),
    )
}

fn check_range(from: Date, to: Date) -> AppResult<()> {
    if to < from {
        return Err(AppError::BadRequest(format!(
            "The range ends ({}) before it starts ({})",
            format_date(to),
            format_date(from)
        )));
    }
    if (to - from).whole_days() >= MAX_RANGE_DAYS {
        return Err(AppError::BadRequest(format!(
            "Ranges can span at most {MAX_RANGE_DAYS} days"
        )));
    }
    Ok(())
}

fn days_between(from: Date, to: Date) -> impl Iterator<Item = Date> {
    std::iter::successors(Some(from), move |day| {
        day.next_day().filter(|next| *next <= to)
    })
}

// ── Reading ──────────────────────────────────────────────────────────────────

/// One day with something planned. `category` is the name of its color, if named.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Day {
    pub date: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

/// Consecutive days with the same title, description and color, e.g. a week-long trip.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Event {
    pub start: String,
    pub end: String,
    pub days: i64,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[derive(Deserialize, Debug, Default, Clone)]
pub struct Filter {
    /// First day to include (YYYY-MM-DD).
    pub from: Option<String>,
    /// Last day to include (YYYY-MM-DD).
    pub to: Option<String>,
    /// Case-insensitive text to find in titles, descriptions or category names.
    #[serde(alias = "q")]
    pub query: Option<String>,
    /// A category name or color.
    pub category: Option<String>,
}

pub async fn settings(pool: &PgPool) -> AppResult<Settings> {
    let raw: String = sqlx::query_scalar("SELECT settings::text FROM planner WHERE id = 1")
        .fetch_one(pool)
        .await?;
    Ok(serde_json::from_str(&raw)?)
}

fn to_day(settings: &Settings, date: String, entry: Entry) -> Day {
    let category = entry
        .color
        .as_ref()
        .and_then(|color| settings.categories.get(color))
        .cloned();
    Day {
        date,
        title: entry.title,
        description: entry.description,
        color: entry.color,
        category,
    }
}

pub async fn days(pool: &PgPool, filter: &Filter) -> AppResult<Vec<Day>> {
    let settings = settings(pool).await?;
    let from = filter.from.as_deref().map(parse_date).transpose()?;
    let to = filter.to.as_deref().map(parse_date).transpose()?;
    if let (Some(from), Some(to)) = (from, to)
        && to < from
    {
        return Err(AppError::BadRequest("`to` is before `from`".into()));
    }
    let color = filter
        .category
        .as_deref()
        .map(|category| resolve_category(&settings, category))
        .transpose()?;
    let query = filter
        .query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .map(str::to_lowercase);

    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT date::text, title, description, color FROM entries
         WHERE NOT deleted
           AND ($1::date IS NULL OR date >= $1::date)
           AND ($2::date IS NULL OR date <= $2::date)
         ORDER BY date",
    )
    .bind(from.map(format_date))
    .bind(to.map(format_date))
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(date, title, description, color)| {
            to_day(
                &settings,
                date,
                Entry {
                    title,
                    description,
                    color,
                },
            )
        })
        .filter(|day| color.is_none() || day.color == color)
        .filter(|day| {
            query.as_ref().is_none_or(|query| {
                [&day.title, &day.description]
                    .into_iter()
                    .chain(day.category.as_ref())
                    .any(|text| text.to_lowercase().contains(query))
            })
        })
        .collect())
}

pub async fn day(pool: &PgPool, date: &str) -> AppResult<Option<Day>> {
    let date = format_date(parse_date(date)?);
    let filter = Filter {
        from: Some(date.clone()),
        to: Some(date),
        ..Filter::default()
    };
    Ok(days(pool, &filter).await?.pop())
}

/// Groups days into events: consecutive dates with identical content.
pub fn group_events(days: &[Day]) -> Vec<Event> {
    let mut events: Vec<Event> = Vec::new();
    for day in days {
        if let Some(last) = events.last_mut() {
            let follows = parse_date(&last.end)
                .ok()
                .and_then(Date::next_day)
                .is_some_and(|next| format_date(next) == day.date);
            if follows
                && last.title == day.title
                && last.description == day.description
                && last.color == day.color
            {
                last.end.clone_from(&day.date);
                last.days += 1;
                continue;
            }
        }
        events.push(Event {
            start: day.date.clone(),
            end: day.date.clone(),
            days: 1,
            title: day.title.clone(),
            description: day.description.clone(),
            color: day.color.clone(),
            category: day.category.clone(),
        });
    }
    events
}

pub async fn events(pool: &PgPool, filter: &Filter) -> AppResult<Vec<Event>> {
    Ok(group_events(&days(pool, filter).await?))
}

// ── Writing ──────────────────────────────────────────────────────────────────

/// Applies changes (and settings) as one revision. `None` deletes a day.
pub async fn write(
    pool: &PgPool,
    changes: Vec<(String, Option<Entry>)>,
    settings: Option<Settings>,
) -> AppResult<i64> {
    let mut tx = pool.begin().await?;

    let rev: i64 =
        // Locks the planner row until commit, so revisions become visible in order.
        sqlx::query_scalar("UPDATE planner SET rev = rev + 1 WHERE id = 1 RETURNING rev")
            .fetch_one(&mut *tx)
            .await?;

    if let Some(settings) = settings {
        sqlx::query("UPDATE planner SET settings = $1::jsonb, settings_rev = $2 WHERE id = 1")
            .bind(serde_json::to_string(&settings)?)
            .bind(rev)
            .execute(&mut *tx)
            .await?;
    }

    for (date, entry) in changes {
        let (title, description, color, deleted) = match entry {
            Some(entry) => (entry.title, entry.description, entry.color, false),
            None => (String::new(), String::new(), None, true),
        };

        sqlx::query(
            "INSERT INTO entries (date, title, description, color, deleted, rev)
             VALUES ($1::date, $2, $3, $4, $5, $6)
             ON CONFLICT (date) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                color = excluded.color,
                deleted = excluded.deleted,
                rev = excluded.rev",
        )
        .bind(date)
        .bind(title)
        .bind(description)
        .bind(color)
        .bind(deleted)
        .bind(rev)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(rev)
}

/// Turns a category name ("Work", any case) or a color ("red") into a color.
pub fn resolve_category(settings: &Settings, category: &str) -> AppResult<String> {
    let wanted = category.trim().to_lowercase();
    if let Some(color) = COLORS.iter().find(|color| **color == wanted) {
        return Ok((*color).to_owned());
    }
    if let Some((color, _)) = settings
        .categories
        .iter()
        .find(|(_, name)| name.to_lowercase() == wanted)
    {
        return Ok(color.clone());
    }

    let named: Vec<String> = settings
        .categories
        .iter()
        .map(|(color, name)| format!("{name} ({color})"))
        .collect();
    Err(AppError::BadRequest(format!(
        "Unknown category {category:?}. Use one of the colors {} or a category name{}",
        COLORS.join(", "),
        if named.is_empty() {
            " (none are named yet)".to_owned()
        } else {
            format!(": {}", named.join(", "))
        }
    )))
}

/// What to put on a day. Absent fields keep their current value when updating.
#[derive(Deserialize, Debug, Default, Clone)]
#[serde(deny_unknown_fields)]
pub struct DayInput {
    pub title: Option<String>,
    pub description: Option<String>,
    /// One of red, orange, yellow, green, blue, purple, pink. `""` removes the color.
    pub color: Option<String>,
    /// A category name; alternative to `color`. `""` removes the color.
    pub category: Option<String>,
}

fn input_color(settings: &Settings, input: &DayInput) -> AppResult<Option<Option<String>>> {
    match (&input.color, &input.category) {
        (Some(_), Some(_)) => Err(AppError::BadRequest(
            "Give either `color` or `category`, not both".into(),
        )),
        (Some(value), None) | (None, Some(value)) if value.trim().is_empty() => Ok(Some(None)),
        (Some(value), None) | (None, Some(value)) => {
            Ok(Some(Some(resolve_category(settings, value)?)))
        }
        (None, None) => Ok(None),
    }
}

/// Replaces a day (`merge: false`) or updates some of its fields (`merge: true`).
/// Returns the day as stored, or `None` when nothing is left on it.
pub async fn set_day(
    pool: &PgPool,
    date: &str,
    input: DayInput,
    merge: bool,
) -> AppResult<Option<Day>> {
    let date = format_date(parse_date(date)?);
    let settings = settings(pool).await?;
    let current = if merge { day(pool, &date).await? } else { None };

    let color = match input_color(&settings, &input)? {
        Some(color) => color,
        None => current.as_ref().and_then(|day| day.color.clone()),
    };
    let entry = Entry {
        title: input
            .title
            .or_else(|| current.as_ref().map(|day| day.title.clone()))
            .unwrap_or_default(),
        description: input
            .description
            .or_else(|| current.as_ref().map(|day| day.description.clone()))
            .unwrap_or_default(),
        color,
    };

    let entry = normalize(entry)?;
    write(pool, vec![(date.clone(), entry.clone())], None).await?;
    Ok(entry.map(|entry| to_day(&settings, date, entry)))
}

pub async fn delete_day(pool: &PgPool, date: &str) -> AppResult<bool> {
    let existed = day(pool, date).await?.is_some();
    if existed {
        write(pool, vec![(format_date(parse_date(date)?), None)], None).await?;
    }
    Ok(existed)
}

/// Clears every day from `from` to `to` (inclusive). Returns how many had something on them.
pub async fn clear(pool: &PgPool, from: &str, to: &str) -> AppResult<usize> {
    let (from_date, to_date) = (parse_date(from)?, parse_date(to)?);
    check_range(from_date, to_date)?;

    let existing = days(
        pool,
        &Filter {
            from: Some(format_date(from_date)),
            to: Some(format_date(to_date)),
            ..Filter::default()
        },
    )
    .await?;
    if !existing.is_empty() {
        write(
            pool,
            existing
                .iter()
                .map(|day| (day.date.clone(), None))
                .collect(),
            None,
        )
        .await?;
    }
    Ok(existing.len())
}

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct EventInput {
    pub start: String,
    /// Last day (inclusive); defaults to `start`.
    pub end: Option<String>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub color: Option<String>,
    pub category: Option<String>,
    /// Replace days that already have something else on them. Without it, such days are reported
    /// as a conflict and nothing is written.
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Serialize, Debug)]
pub struct AddedEvent {
    pub event: Event,
    /// Days that had something else on them and were replaced.
    pub replaced: Vec<Day>,
}

pub async fn add_event(pool: &PgPool, input: EventInput) -> AppResult<AddedEvent> {
    let start = parse_date(&input.start)?;
    let end = input
        .end
        .as_deref()
        .map(parse_date)
        .transpose()?
        .unwrap_or(start);
    check_range(start, end)?;

    let settings = settings(pool).await?;
    let color = input_color(
        &settings,
        &DayInput {
            title: None,
            description: None,
            color: input.color.clone(),
            category: input.category.clone(),
        },
    )?
    .flatten();
    let Some(entry) = normalize(Entry {
        title: input.title,
        description: input.description,
        color,
    })?
    else {
        return Err(AppError::BadRequest(
            "An event needs a title, a description or a color".into(),
        ));
    };

    let existing = days(
        pool,
        &Filter {
            from: Some(format_date(start)),
            to: Some(format_date(end)),
            ..Filter::default()
        },
    )
    .await?;
    let replaced: Vec<Day> = existing
        .into_iter()
        .filter(|day| {
            day.title != entry.title
                || day.description != entry.description
                || day.color != entry.color
        })
        .collect();

    if !replaced.is_empty() && !input.overwrite {
        return Err(AppError::Conflict {
            message: format!(
                "{} already {} something else planned; nothing was changed. \
                 Pass `overwrite: true` to replace {}.",
                if replaced.len() == 1 {
                    "1 day".to_owned()
                } else {
                    format!("{} days", replaced.len())
                },
                if replaced.len() == 1 { "has" } else { "have" },
                if replaced.len() == 1 { "it" } else { "them" }
            ),
            details: json!({ "conflicts": replaced }),
        });
    }

    let changes = days_between(start, end)
        .map(|day| (format_date(day), Some(entry.clone())))
        .collect();
    write(pool, changes, None).await?;

    let day = to_day(&settings, format_date(start), entry);
    Ok(AddedEvent {
        event: Event {
            start: format_date(start),
            end: format_date(end),
            days: (end - start).whole_days() + 1,
            title: day.title,
            description: day.description,
            color: day.color,
            category: day.category,
        },
        replaced,
    })
}

// ── Settings ─────────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct SettingsInput {
    /// Category names by color. Replaces all names; `""` removes one.
    pub categories: Option<BTreeMap<String, String>>,
    /// Public holiday country (`SE`, `DE-BY`); `""` or `null` turns holidays off.
    #[serde(default, with = "double_option")]
    pub holiday_country: Option<Option<String>>,
}

/// Distinguishes a missing field (keep) from an explicit `null` (clear).
mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Option<String>>, D::Error> {
        Ok(Some(Option::deserialize(deserializer)?))
    }
}

pub async fn update_settings(pool: &PgPool, input: SettingsInput) -> AppResult<Settings> {
    let current = settings(pool).await?;
    let next = normalize_settings(Settings {
        categories: input.categories.unwrap_or(current.categories),
        holiday_country: match input.holiday_country {
            Some(country) => country,
            None => current.holiday_country,
        },
    })?;
    write(pool, Vec::new(), Some(next.clone())).await?;
    Ok(next)
}

#[derive(Serialize, Debug)]
pub struct Category {
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Days tagged with this color, in all years.
    pub days: usize,
}

pub async fn categories(pool: &PgPool) -> AppResult<Vec<Category>> {
    let settings = settings(pool).await?;
    let all = days(pool, &Filter::default()).await?;
    Ok(COLORS
        .iter()
        .map(|color| Category {
            color: (*color).to_owned(),
            name: settings.categories.get(*color).cloned(),
            days: all
                .iter()
                .filter(|day| day.color.as_deref() == Some(color))
                .count(),
        })
        .collect())
}

// ── Overviews ────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct Today {
    pub date: String,
    pub weekday: String,
    pub iso_week: u8,
    pub day_of_year: u16,
    pub days_left_in_year: u16,
    pub today: Option<Day>,
    /// Events overlapping the next 60 days, soonest first (at most 10).
    pub upcoming: Vec<Event>,
}

pub async fn today_overview(pool: &PgPool, date: Option<&str>) -> AppResult<Today> {
    let today = today(date)?;
    let horizon = today + Duration::days(UPCOMING_DAYS);
    // Look back far enough to see the start of an event that is already running.
    let all = days(
        pool,
        &Filter {
            from: Some(format_date(today - Duration::days(MAX_RANGE_DAYS))),
            to: Some(format_date(horizon)),
            ..Filter::default()
        },
    )
    .await?;
    let today_key = format_date(today);
    let upcoming = group_events(&all)
        .into_iter()
        .filter(|event| event.end >= today_key)
        .take(UPCOMING_LIMIT)
        .collect();
    let days_in_year = if time::util::is_leap_year(today.year()) {
        366
    } else {
        365
    };

    Ok(Today {
        weekday: today.weekday().to_string(),
        iso_week: today.iso_week(),
        day_of_year: today.ordinal(),
        days_left_in_year: days_in_year - today.ordinal(),
        today: all.into_iter().find(|day| day.date == today_key),
        date: today_key,
        upcoming,
    })
}

#[derive(Serialize, Debug)]
pub struct MonthSummary {
    pub month: u8,
    pub name: String,
    pub planned_days: usize,
    pub events: Vec<Event>,
}

#[derive(Serialize, Debug)]
pub struct Summary {
    pub year: i32,
    pub planned_days: usize,
    pub events: usize,
    pub by_category: Vec<Category>,
    pub months: Vec<MonthSummary>,
}

/// The whole year at a glance: every event, grouped by the month it starts in.
pub async fn summary(pool: &PgPool, year: i32) -> AppResult<Summary> {
    if !(1900..=9999).contains(&year) {
        return Err(AppError::BadRequest("Years go from 1900 to 9999".into()));
    }
    let settings = settings(pool).await?;
    let year_days = days(
        pool,
        &Filter {
            from: Some(format!("{year:04}-01-01")),
            to: Some(format!("{year:04}-12-31")),
            ..Filter::default()
        },
    )
    .await?;
    let events = group_events(&year_days);

    let months = (1..=12u8)
        .map(|month| {
            let prefix = format!("{year:04}-{month:02}-");
            MonthSummary {
                month,
                name: Month::try_from(month).expect("valid month").to_string(),
                planned_days: year_days
                    .iter()
                    .filter(|day| day.date.starts_with(&prefix))
                    .count(),
                events: events
                    .iter()
                    .filter(|event| event.start.starts_with(&prefix))
                    .cloned()
                    .collect(),
            }
        })
        .collect();

    let by_category = COLORS
        .iter()
        .map(|color| Category {
            color: (*color).to_owned(),
            name: settings.categories.get(*color).cloned(),
            days: year_days
                .iter()
                .filter(|day| day.color.as_deref() == Some(color))
                .count(),
        })
        .collect();

    Ok(Summary {
        year,
        planned_days: year_days.len(),
        events: events.len(),
        by_category,
        months,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(date: &str, title: &str) -> Day {
        Day {
            date: date.into(),
            title: title.into(),
            description: String::new(),
            color: None,
            category: None,
        }
    }

    #[test]
    fn groups_consecutive_identical_days() {
        let days = [
            day("2026-01-30", "Trip"),
            day("2026-01-31", "Trip"),
            day("2026-02-01", "Trip"),
            day("2026-02-03", "Trip"),
            day("2026-02-04", "Other"),
        ];
        let events = group_events(&days);
        assert_eq!(events.len(), 3);
        assert_eq!(
            (
                events[0].start.as_str(),
                events[0].end.as_str(),
                events[0].days
            ),
            ("2026-01-30", "2026-02-01", 3)
        );
    }

    #[test]
    fn resolves_categories_by_name_or_color() {
        let settings = Settings {
            categories: BTreeMap::from([("red".into(), "Work".into())]),
            holiday_country: None,
        };
        assert_eq!(resolve_category(&settings, " work ").unwrap(), "red");
        assert_eq!(resolve_category(&settings, "Green").unwrap(), "green");
        let error = resolve_category(&settings, "Gym").unwrap_err();
        assert!(matches!(error, AppError::BadRequest(message) if message.contains("Work (red)")));
    }

    #[test]
    fn checks_ranges() {
        let date = |value| parse_date(value).unwrap();
        assert!(check_range(date("2026-01-01"), date("2026-12-31")).is_ok());
        assert!(check_range(date("2026-02-01"), date("2026-01-01")).is_err());
        assert!(check_range(date("2000-01-01"), date("2026-01-01")).is_err());
        assert_eq!(
            days_between(date("2024-02-28"), date("2024-03-01")).count(),
            3
        );
    }
}
