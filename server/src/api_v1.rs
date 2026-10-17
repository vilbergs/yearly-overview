//! A REST API meant for scripts and AI agents. See `openapi.json` (served at
//! `/api/v1/openapi.json`) for the full description.

use axum::{
    Json, Router,
    extract::{FromRequest, FromRequestParts, Path, Query, Request, State},
    http::{StatusCode, header, request::Parts},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    AppState,
    entries::Settings,
    error::{AppError, AppResult},
    planner::{self, DayInput, EventInput, Filter, SettingsInput},
};

pub const OPENAPI: &str = include_str!("../openapi.json");

/// A JSON body whose problems are reported as `{"error": ...}` like every other error.
struct Body<T>(T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequest<S> for Body<T> {
    type Rejection = AppError;

    async fn from_request(request: Request, state: &S) -> Result<Self, AppError> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection| AppError::BadRequest(rejection.body_text()))
    }
}

/// Query parameters, with the same error format.
struct Params<T>(T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequestParts<S> for Params<T> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|rejection| AppError::BadRequest(rejection.body_text()))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(index))
        .route("/openapi.json", get(openapi))
        .route("/today", get(today))
        .route("/summary", get(summary))
        .route("/days", get(list_days).delete(clear_days))
        .route(
            "/days/{date}",
            get(get_day)
                .put(put_day)
                .patch(patch_day)
                .delete(delete_day),
        )
        .route("/events", get(list_events).post(add_event))
        .route("/categories", get(categories))
        .route("/settings", get(get_settings).patch(patch_settings))
}

async fn index() -> Json<Value> {
    Json(json!({
        "name": "Yearly Overview API",
        "description": "A personal year planner: one entry (title, description, color/category) per day; consecutive identical days form events.",
        "openapi": "/api/v1/openapi.json",
        "mcp": "/mcp",
    }))
}

async fn openapi() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], OPENAPI)
}

#[derive(Deserialize)]
struct DateQuery {
    date: Option<String>,
}

async fn today(
    State(state): State<AppState>,
    Params(query): Params<DateQuery>,
) -> AppResult<Json<planner::Today>> {
    Ok(Json(
        planner::today_overview(&state.pool, query.date.as_deref()).await?,
    ))
}

#[derive(Deserialize)]
struct YearQuery {
    year: Option<i32>,
}

async fn summary(
    State(state): State<AppState>,
    Params(query): Params<YearQuery>,
) -> AppResult<Json<planner::Summary>> {
    let year = match query.year {
        Some(year) => year,
        None => planner::today(None)?.year(),
    };
    Ok(Json(planner::summary(&state.pool, year).await?))
}

async fn list_days(
    State(state): State<AppState>,
    Params(filter): Params<Filter>,
) -> AppResult<Json<Value>> {
    let days = planner::days(&state.pool, &filter).await?;
    Ok(Json(json!({ "days": days })))
}

#[derive(Deserialize)]
struct RangeQuery {
    from: String,
    to: String,
}

async fn clear_days(
    State(state): State<AppState>,
    Params(range): Params<RangeQuery>,
) -> AppResult<Json<Value>> {
    let cleared = planner::clear(&state.pool, &range.from, &range.to).await?;
    Ok(Json(json!({ "cleared": cleared })))
}

async fn get_day(
    State(state): State<AppState>,
    Path(date): Path<String>,
) -> AppResult<Json<Value>> {
    let day = planner::day(&state.pool, &date).await?;
    Ok(Json(
        json!({ "date": planner::format_date(planner::parse_date(&date)?), "day": day }),
    ))
}

async fn put_day(
    State(state): State<AppState>,
    Path(date): Path<String>,
    Body(input): Body<DayInput>,
) -> AppResult<Json<Value>> {
    let day = planner::set_day(&state.pool, &date, input, false).await?;
    Ok(Json(json!({ "day": day })))
}

async fn patch_day(
    State(state): State<AppState>,
    Path(date): Path<String>,
    Body(input): Body<DayInput>,
) -> AppResult<Json<Value>> {
    let day = planner::set_day(&state.pool, &date, input, true).await?;
    Ok(Json(json!({ "day": day })))
}

async fn delete_day(
    State(state): State<AppState>,
    Path(date): Path<String>,
) -> AppResult<Json<Value>> {
    let deleted = planner::delete_day(&state.pool, &date).await?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn list_events(
    State(state): State<AppState>,
    Params(filter): Params<Filter>,
) -> AppResult<Json<Value>> {
    let events = planner::events(&state.pool, &filter).await?;
    Ok(Json(json!({ "events": events })))
}

async fn add_event(
    State(state): State<AppState>,
    Body(input): Body<EventInput>,
) -> AppResult<(StatusCode, Json<planner::AddedEvent>)> {
    Ok((
        StatusCode::CREATED,
        Json(planner::add_event(&state.pool, input).await?),
    ))
}

async fn categories(State(state): State<AppState>) -> AppResult<Json<Value>> {
    Ok(Json(
        json!({ "categories": planner::categories(&state.pool).await? }),
    ))
}

async fn get_settings(State(state): State<AppState>) -> AppResult<Json<Settings>> {
    Ok(Json(planner::settings(&state.pool).await?))
}

async fn patch_settings(
    State(state): State<AppState>,
    Body(input): Body<SettingsInput>,
) -> AppResult<Json<Settings>> {
    Ok(Json(planner::update_settings(&state.pool, input).await?))
}
