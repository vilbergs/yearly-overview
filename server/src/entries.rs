use axum::{
    Json,
    extract::{Query, State},
};
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::{Date, Month};

use crate::{
    AppState,
    error::{AppError, AppResult},
};

pub const MAX_CHANGES_PER_REQUEST: usize = 5000;
pub(crate) const MAX_TITLE_LENGTH: usize = 200;
pub(crate) const MAX_DESCRIPTION_LENGTH: usize = 5000;
pub(crate) const COLORS: [&str; 6] = ["red", "orange", "yellow", "green", "blue", "purple"];
pub(crate) const MAX_CATEGORY_LENGTH: usize = 40;

/// Account-wide settings. Unknown fields are rejected so typos don't silently disappear.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    /// Names for the color tags, e.g. `{ "green": "Holiday" }`.
    #[serde(default)]
    pub categories: BTreeMap<String, String>,
    /// Whose public holidays to show: an ISO 3166-1 alpha-2 code, optionally with a region
    /// (`SE`, `DE-BY`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holiday_country: Option<String>,
}

/// `SE`, `DE-BY`, and the longer region codes the holiday data uses (`CK-Rarotonga`).
fn valid_holiday_country(code: &str) -> bool {
    let (country, region) = match code.split_once('-') {
        Some((country, region)) => (country, Some(region)),
        None => (code, None),
    };
    country.len() == 2
        && country.bytes().all(|byte| byte.is_ascii_uppercase())
        && region.is_none_or(|region| {
            (1..=20).contains(&region.len())
                && region.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

pub(crate) fn normalize_settings(settings: Settings) -> AppResult<Settings> {
    let mut categories = BTreeMap::new();
    for (color, name) in settings.categories {
        if !COLORS.contains(&color.as_str()) {
            return Err(AppError::BadRequest(format!("Unknown color {color:?}")));
        }
        let name = name.trim();
        if name.chars().count() > MAX_CATEGORY_LENGTH {
            return Err(AppError::BadRequest(format!(
                "Category names can be at most {MAX_CATEGORY_LENGTH} characters"
            )));
        }
        if !name.is_empty() {
            categories.insert(color, name.to_owned());
        }
    }
    let holiday_country = settings.holiday_country.filter(|code| !code.is_empty());
    if let Some(code) = &holiday_country
        && !valid_holiday_country(code)
    {
        return Err(AppError::BadRequest(format!(
            "Invalid holiday country {code:?}"
        )));
    }

    Ok(Settings {
        categories,
        holiday_country,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Entry {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Change {
    pub date: String,
    /// `None` deletes the day.
    pub entry: Option<Entry>,
}

#[derive(Deserialize)]
pub struct PullQuery {
    #[serde(default)]
    since: i64,
}

#[derive(Serialize)]
pub struct PullResponse {
    rev: i64,
    changes: Vec<Change>,
    /// Only present when the settings changed after `since`.
    #[serde(skip_serializing_if = "Option::is_none")]
    settings: Option<Settings>,
}

#[derive(Deserialize)]
pub struct PushRequest {
    #[serde(default)]
    changes: Vec<Change>,
    #[serde(default)]
    settings: Option<Settings>,
}

#[derive(Serialize)]
pub struct PushResponse {
    rev: i64,
}

pub(crate) fn valid_date(date: &str) -> bool {
    let parts: Vec<&str> = date.split('-').collect();
    let [year, month, day] = parts.as_slice() else {
        return false;
    };
    // Exactly `YYYY-MM-DD`: `parse` alone would also accept signs like `+1`.
    let digits =
        |part: &str, len: usize| part.len() == len && part.bytes().all(|b| b.is_ascii_digit());
    if !digits(year, 4) || !digits(month, 2) || !digits(day, 2) {
        return false;
    }

    let (Ok(year), Ok(month), Ok(day)) = (year.parse(), month.parse::<u8>(), day.parse()) else {
        return false;
    };

    Month::try_from(month)
        .ok()
        .and_then(|month| Date::from_calendar_date(year, month, day).ok())
        .is_some()
}

/// Trims an entry and checks its limits. Returns `None` when nothing is left (a deletion).
pub(crate) fn normalize(entry: Entry) -> AppResult<Option<Entry>> {
    let title = entry.title.trim().to_owned();
    let description = entry.description.trim().to_owned();

    if title.chars().count() > MAX_TITLE_LENGTH {
        return Err(AppError::BadRequest(format!(
            "Titles can be at most {MAX_TITLE_LENGTH} characters"
        )));
    }
    if description.chars().count() > MAX_DESCRIPTION_LENGTH {
        return Err(AppError::BadRequest(format!(
            "Descriptions can be at most {MAX_DESCRIPTION_LENGTH} characters"
        )));
    }
    if let Some(color) = &entry.color
        && !COLORS.contains(&color.as_str())
    {
        return Err(AppError::BadRequest(format!("Unknown color {color:?}")));
    }

    Ok(
        (!title.is_empty() || !description.is_empty() || entry.color.is_some()).then_some(Entry {
            title,
            description,
            color: entry.color,
        }),
    )
}

/// Everything that changed after revision `since` (0 for everything).
pub async fn pull(
    State(state): State<AppState>,
    Query(query): Query<PullQuery>,
) -> AppResult<Json<PullResponse>> {
    // One snapshot, so the revision matches the rows we return.
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;

    let (rev, settings, settings_rev): (i64, String, i64) =
        sqlx::query_as("SELECT rev, settings::text, settings_rev FROM planner WHERE id = 1")
            .fetch_one(&mut *tx)
            .await?;

    let rows: Vec<(String, String, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT date::text, title, description, color, deleted FROM entries
         WHERE rev > $1 ORDER BY date",
    )
    .bind(query.since)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;

    let changes = rows
        .into_iter()
        // A full pull doesn't need to hear about days that were deleted.
        .filter(|row| !(query.since == 0 && row.4))
        .map(|(date, title, description, color, deleted)| Change {
            date,
            entry: (!deleted).then_some(Entry {
                title,
                description,
                color,
            }),
        })
        .collect();

    let settings = (settings_rev > query.since)
        .then(|| serde_json::from_str(&settings))
        .transpose()?;

    Ok(Json(PullResponse {
        rev,
        changes,
        settings,
    }))
}

/// Applies a batch of changes. The last write for a day wins.
pub async fn push(
    State(state): State<AppState>,
    Json(request): Json<PushRequest>,
) -> AppResult<Json<PushResponse>> {
    if request.changes.len() > MAX_CHANGES_PER_REQUEST {
        return Err(AppError::BadRequest(format!(
            "Send at most {MAX_CHANGES_PER_REQUEST} changes at a time"
        )));
    }

    let mut changes = Vec::with_capacity(request.changes.len());
    for change in request.changes {
        if !valid_date(&change.date) {
            return Err(AppError::BadRequest(format!(
                "Invalid date {:?}",
                change.date
            )));
        }
        let entry = change.entry.map(normalize).transpose()?.flatten();
        changes.push((change.date, entry));
    }
    let settings = request.settings.map(normalize_settings).transpose()?;

    let rev = crate::planner::write(&state.pool, changes, settings).await?;
    Ok(Json(PushResponse { rev }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_dates() {
        assert!(valid_date("2024-02-29"));
        assert!(!valid_date("2025-02-29"));
        assert!(!valid_date("2025-13-01"));
        assert!(!valid_date("2025-1-01"));
        assert!(!valid_date("../etc/passwd"));
        assert!(!valid_date("2024-+1-01"));
        assert!(!valid_date("+202-01-01"));
        assert!(!valid_date("2024-01-+1"));
    }

    #[test]
    fn normalizes_entries() {
        let entry = |title: &str, color: Option<&str>| Entry {
            title: title.into(),
            description: String::new(),
            color: color.map(Into::into),
        };

        assert_eq!(
            normalize(entry("  Trip ", None)).unwrap(),
            Some(entry("Trip", None))
        );
        assert_eq!(normalize(entry("  ", None)).unwrap(), None);
        assert_eq!(
            normalize(entry("", Some("green"))).unwrap(),
            Some(entry("", Some("green")))
        );
        assert!(normalize(entry("x", Some("chartreuse"))).is_err());
        assert!(normalize(entry(&"x".repeat(201), None)).is_err());
    }

    #[test]
    fn normalizes_settings() {
        let settings = |pairs: &[(&str, &str)]| Settings {
            categories: pairs
                .iter()
                .map(|(color, name)| ((*color).to_owned(), (*name).to_owned()))
                .collect(),
            holiday_country: None,
        };

        assert_eq!(
            normalize_settings(settings(&[("green", " Holiday "), ("red", "  ")])).unwrap(),
            settings(&[("green", "Holiday")])
        );
        assert!(normalize_settings(settings(&[("pink", "Nope")])).is_err());
        assert!(normalize_settings(settings(&[("red", &"x".repeat(41))])).is_err());

        let country = |code: &str| Settings {
            holiday_country: Some(code.to_owned()),
            ..Settings::default()
        };
        for code in ["SE", "DE-BY", "GB-ENG", "US-CA", "CK-Rarotonga"] {
            assert!(normalize_settings(country(code)).is_ok(), "{code}");
        }
        for code in [
            "se",
            "SWE",
            "DE-",
            "-BY",
            "S E",
            "DE-B Y",
            "DE-BY-X",
            &format!("DE-{}", "A".repeat(21)),
        ] {
            assert!(normalize_settings(country(code)).is_err(), "{code}");
        }
        assert_eq!(
            normalize_settings(country("")).unwrap().holiday_country,
            None
        );
    }
}
