//! A Model Context Protocol server, so AI agents can use the planner as tools.
//!
//! Streamable HTTP transport, stateless: every POST to `/mcp` carries one JSON-RPC message and
//! gets a JSON reply (no sessions, no server-sent events). The tools wrap the same operations as
//! the REST API in [`crate::planner`].

use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    AppState,
    error::AppError,
    planner::{self, DayInput, EventInput, Filter, SettingsInput},
};

/// Newest first; we answer with the client's version when we know it.
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "\
Yearly Overview is the user's personal year planner. Each day holds at most one entry (title, \
optional description, optional color). The seven colors (red, orange, yellow, green, blue, purple, pink) \
can be named as categories, e.g. red = \"Work\"; tools accept either the name or the color. \
Consecutive days with the same entry form an event, such as a trip.

Start with get_today for the date and what's coming up. Use list_events to look things up, \
add_event to plan something (it refuses to overwrite other plans unless overwrite is true, so \
show the user any conflicts first), update_day to adjust one day and clear_days to remove plans. \
Dates are YYYY-MM-DD. Changes appear in the user's open planner within seconds.";

fn tools() -> Value {
    let date = json!({ "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$", "description": "YYYY-MM-DD" });
    let category = json!({ "type": "string", "description": "A category name (e.g. \"Work\") or a color: red, orange, yellow, green, blue, purple, pink. \"\" removes the color." });
    let filters = json!({
        "from": { "type": "string", "description": "First day to include, YYYY-MM-DD." },
        "to": { "type": "string", "description": "Last day to include, YYYY-MM-DD." },
        "query": { "type": "string", "description": "Case-insensitive text to find in titles, descriptions and category names." },
        "category": { "type": "string", "description": "Only this category name or color." }
    });
    let read = json!({ "readOnlyHint": true, "openWorldHint": false });

    json!([
        {
            "name": "get_today",
            "title": "Today",
            "description": "Today's date (in the planner's time zone), weekday, ISO week, what's planned today, and events running now or starting in the next 60 days. Call this first for context.",
            "inputSchema": { "type": "object", "properties": {
                "date": { "type": "string", "description": "Pretend today is this date (YYYY-MM-DD)." }
            } },
            "annotations": read
        },
        {
            "name": "get_year_summary",
            "title": "Year at a glance",
            "description": "Every event in a year, grouped by the month it starts in, plus how many days each category uses.",
            "inputSchema": { "type": "object", "properties": {
                "year": { "type": "integer", "minimum": 1900, "maximum": 9999, "description": "Defaults to the current year." }
            } },
            "annotations": read
        },
        {
            "name": "list_events",
            "title": "Find events",
            "description": "Events (consecutive identical days merged, so a 10-day trip is one item), optionally limited to a date range, a search text or a category. Prefer this over list_days for reading.",
            "inputSchema": { "type": "object", "properties": filters },
            "annotations": read
        },
        {
            "name": "list_days",
            "title": "Find days",
            "description": "Individual days with entries, with the same filters as list_events.",
            "inputSchema": { "type": "object", "properties": filters },
            "annotations": read
        },
        {
            "name": "get_day",
            "title": "Get a day",
            "description": "What is planned on one day (null if nothing).",
            "inputSchema": { "type": "object", "properties": { "date": date }, "required": ["date"] },
            "annotations": read
        },
        {
            "name": "list_categories",
            "title": "Categories",
            "description": "The seven colors, their category names (if named) and how many days use each.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read
        },
        {
            "name": "add_event",
            "title": "Plan something",
            "description": "Puts the same entry on every day from start to end (inclusive). If any of those days already holds something different, nothing is written and the conflicting days are returned; ask the user, then retry with overwrite: true if they agree.",
            "inputSchema": { "type": "object", "properties": {
                "start": date,
                "end": { "type": "string", "description": "Last day, YYYY-MM-DD. Defaults to start." },
                "title": { "type": "string", "maxLength": 200 },
                "description": { "type": "string", "maxLength": 5000 },
                "category": category,
                "overwrite": { "type": "boolean", "default": false, "description": "Replace days that already have other plans." }
            }, "required": ["start", "title"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "update_day",
            "title": "Change a day",
            "description": "Changes only the given fields of one day (creating it if empty). To change a whole multi-day event, use add_event with overwrite: true over its range.",
            "inputSchema": { "type": "object", "properties": {
                "date": date,
                "title": { "type": "string", "maxLength": 200 },
                "description": { "type": "string", "maxLength": 5000 },
                "category": category
            }, "required": ["date"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "clear_days",
            "title": "Clear days",
            "description": "Removes everything planned from `from` to `to` (inclusive; use the same date for one day). Returns how many days had something on them.",
            "inputSchema": { "type": "object", "properties": { "from": date, "to": date }, "required": ["from", "to"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "update_settings",
            "title": "Change settings",
            "description": "Names the color categories and/or sets whose public holidays the planner shows.",
            "inputSchema": { "type": "object", "properties": {
                "categories": { "type": "object", "additionalProperties": { "type": "string", "maxLength": 40 },
                    "description": "Names by color, e.g. {\"red\": \"Work\", \"green\": \"Holiday\"}. Replaces all names; \"\" removes one." },
                "holiday_country": { "type": ["string", "null"], "description": "ISO 3166 code with optional region, e.g. SE or DE-BY; null turns holidays off." }
            } },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }
    ])
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct DateArgs {
    date: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct YearArgs {
    year: Option<i32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateDayArgs {
    date: String,
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeArgs {
    from: String,
    to: String,
}

fn args<T: DeserializeOwned>(arguments: Value) -> Result<T, AppError> {
    serde_json::from_value(arguments)
        .map_err(|error| AppError::BadRequest(format!("Invalid arguments: {error}")))
}

/// Runs a tool. `Ok(None)` means there is no such tool.
async fn call_tool(
    state: &AppState,
    name: &str,
    arguments: Value,
) -> Result<Option<Value>, AppError> {
    let pool = &state.pool;
    let result = match name {
        "get_today" => {
            let DateArgs { date } = args(arguments)?;
            json!(planner::today_overview(pool, date.as_deref()).await?)
        }
        "get_year_summary" => {
            let YearArgs { year } = args(arguments)?;
            let year = match year {
                Some(year) => year,
                None => planner::today(None)?.year(),
            };
            json!(planner::summary(pool, year).await?)
        }
        "list_events" => {
            json!({ "events": planner::events(pool, &args::<Filter>(arguments)?).await? })
        }
        "list_days" => json!({ "days": planner::days(pool, &args::<Filter>(arguments)?).await? }),
        "get_day" => {
            let DateArgs { date } = args(arguments)?;
            let date = date.ok_or_else(|| AppError::BadRequest("`date` is required".into()))?;
            json!({ "date": date, "day": planner::day(pool, &date).await? })
        }
        "list_categories" => json!({ "categories": planner::categories(pool).await? }),
        "add_event" => json!(planner::add_event(pool, args::<EventInput>(arguments)?).await?),
        "update_day" => {
            let input: UpdateDayArgs = args(arguments)?;
            let day = planner::set_day(
                pool,
                &input.date,
                DayInput {
                    title: input.title,
                    description: input.description,
                    color: None,
                    category: input.category,
                },
                true,
            )
            .await?;
            json!({ "day": day })
        }
        "clear_days" => {
            let RangeArgs { from, to } = args(arguments)?;
            json!({ "cleared": planner::clear(pool, &from, &to).await? })
        }
        "update_settings" => {
            json!(planner::update_settings(pool, args::<SettingsInput>(arguments)?).await?)
        }
        _ => return Ok(None),
    };
    Ok(Some(result))
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Handles one JSON-RPC message. Returns `None` for notifications, which get no reply.
async fn handle_message(state: &AppState, message: Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str);

    let (Some(id), Some(method)) = (id, method) else {
        // Notifications (e.g. notifications/initialized) and stray responses need no answer.
        return None;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    Some(match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let version = PROTOCOL_VERSIONS
                .into_iter()
                .find(|version| *version == requested)
                .unwrap_or(PROTOCOL_VERSIONS[0]);
            rpc_result(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": "yearly-overview",
                        "title": "Yearly Overview",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "instructions": INSTRUCTIONS
                }),
            )
        }
        "ping" => rpc_result(&id, json!({})),
        "tools/list" => rpc_result(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let arguments = match params.get("arguments") {
                None | Some(Value::Null) => json!({}),
                Some(arguments) => arguments.clone(),
            };
            match call_tool(state, name, arguments).await {
                Ok(Some(result)) => rpc_result(
                    &id,
                    json!({
                        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }],
                        "structuredContent": result,
                        "isError": false
                    }),
                ),
                Ok(None) => rpc_error(&id, -32602, &format!("Unknown tool: {name}")),
                // Tool failures are results the model can read and act on, not protocol errors.
                Err(error) => {
                    let (_, message, details) = error.public();
                    let text = match details {
                        Some(details) => format!(
                            "{message}\n{}",
                            serde_json::to_string_pretty(details).unwrap_or_default()
                        ),
                        None => message,
                    };
                    rpc_result(
                        &id,
                        json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
                    )
                }
            }
        }
        _ => rpc_error(&id, -32601, &format!("Method not found: {method}")),
    })
}

pub async fn post(State(state): State<AppState>, body: Bytes) -> Response {
    let message: Value = match serde_json::from_slice(&body) {
        Ok(message) => message,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(rpc_error(&Value::Null, -32700, "Parse error")),
            )
                .into_response();
        }
    };

    // Older protocol versions allow batches.
    let reply = if let Value::Array(messages) = message {
        let mut replies = Vec::new();
        for message in messages {
            replies.extend(handle_message(&state, message).await);
        }
        (!replies.is_empty()).then_some(Value::Array(replies))
    } else {
        handle_message(&state, message).await
    };

    match reply {
        Some(reply) => Json(reply).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

/// This server never pushes messages, so there is no event stream to open.
pub async fn get() -> Response {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        [(header::ALLOW, "POST")],
        "This MCP server only answers POST requests",
    )
        .into_response()
}
