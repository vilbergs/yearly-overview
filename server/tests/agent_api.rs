//! The REST API for agents (`/api/v1`).

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use yearly_overview_server::{AppState, app, config::Config};

struct Api(Router);

impl Api {
    fn new(pool: PgPool) -> Self {
        let config = Config {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            database_url: String::new(),
            static_dir: None,
            allowed_hosts: Vec::new(),
        };
        Self(app(AppState { pool }, &config))
    }

    async fn call(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(format!("/api/v1{uri}"))
            .header(header::HOST, "localhost");
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        let request = request
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = self.0.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.call(Method::GET, uri, None).await
    }
}

#[sqlx::test]
async fn plans_and_reads_events(pool: PgPool) {
    let api = Api::new(pool);
    api.call(
        Method::PATCH,
        "/settings",
        Some(json!({ "categories": { "green": "Holiday" } })),
    )
    .await;

    let (status, added) = api
        .call(
            Method::POST,
            "/events",
            Some(json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation", "category": "holiday" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(
        added["event"],
        json!({ "start": "2026-07-06", "end": "2026-07-10", "days": 5, "title": "Vacation",
                "description": "", "color": "green", "category": "Holiday" })
    );
    assert_eq!(added["replaced"], json!([]));

    let (_, events) = api.get("/events?from=2026-07-01&to=2026-07-31").await;
    assert_eq!(events["events"].as_array().unwrap().len(), 1);
    assert_eq!(events["events"][0]["days"], 5);

    let (_, days) = api.get("/days?category=Holiday").await;
    assert_eq!(days["days"].as_array().unwrap().len(), 5);

    let (_, found) = api.get("/events?q=vacat").await;
    assert_eq!(found["events"][0]["start"], "2026-07-06");
    let (_, by_category_name) = api.get("/events?q=holiday").await;
    assert_eq!(by_category_name["events"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn refuses_to_overwrite_other_plans_unless_asked(pool: PgPool) {
    let api = Api::new(pool);
    api.call(
        Method::PUT,
        "/days/2026-07-08",
        Some(json!({ "title": "Dentist" })),
    )
    .await;

    let (status, conflict) = api
        .call(
            Method::POST,
            "/events",
            Some(json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(conflict["details"]["conflicts"][0]["title"], "Dentist");
    // Nothing was written.
    let (_, days) = api.get("/days").await;
    assert_eq!(days["days"].as_array().unwrap().len(), 1);

    let (status, added) = api
        .call(
            Method::POST,
            "/events",
            Some(json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation", "overwrite": true })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(added["replaced"][0]["date"], "2026-07-08");

    // Re-adding the identical event is not a conflict.
    let (status, _) = api
        .call(
            Method::POST,
            "/events",
            Some(json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[sqlx::test]
async fn edits_single_days(pool: PgPool) {
    let api = Api::new(pool);

    let (status, put) = api
        .call(
            Method::PUT,
            "/days/2026-03-14",
            Some(json!({ "title": " Pi day ", "description": "Bake", "color": "yellow" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        put["day"],
        json!({ "date": "2026-03-14", "title": "Pi day", "description": "Bake", "color": "yellow" })
    );

    let (_, patched) = api
        .call(
            Method::PATCH,
            "/days/2026-03-14",
            Some(json!({ "description": "Bake two pies" })),
        )
        .await;
    assert_eq!(patched["day"]["title"], "Pi day");
    assert_eq!(patched["day"]["description"], "Bake two pies");
    assert_eq!(patched["day"]["color"], "yellow");

    let (_, uncolored) = api
        .call(
            Method::PATCH,
            "/days/2026-03-14",
            Some(json!({ "color": "" })),
        )
        .await;
    assert!(uncolored["day"].get("color").is_none());

    let (_, got) = api.get("/days/2026-03-14").await;
    assert_eq!(got["day"]["title"], "Pi day");

    let (_, deleted) = api.call(Method::DELETE, "/days/2026-03-14", None).await;
    assert_eq!(deleted, json!({ "deleted": true }));
    let (_, again) = api.call(Method::DELETE, "/days/2026-03-14", None).await;
    assert_eq!(again, json!({ "deleted": false }));
    let (_, empty) = api.get("/days/2026-03-14").await;
    assert_eq!(empty, json!({ "date": "2026-03-14", "day": null }));
}

#[sqlx::test]
async fn clears_ranges(pool: PgPool) {
    let api = Api::new(pool);
    api.call(
        Method::POST,
        "/events",
        Some(json!({ "start": "2026-01-30", "end": "2026-02-02", "title": "Trip" })),
    )
    .await;
    let (_, cleared) = api
        .call(Method::DELETE, "/days?from=2026-02-01&to=2026-02-28", None)
        .await;
    assert_eq!(cleared, json!({ "cleared": 2 }));
    let (_, events) = api.get("/events").await;
    assert_eq!(events["events"][0]["end"], "2026-01-31");

    let (status, _) = api
        .call(Method::DELETE, "/days?from=2026-02-01", None)
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test]
async fn today_and_summary(pool: PgPool) {
    let api = Api::new(pool);
    api.call(
        Method::POST,
        "/events",
        Some(json!({ "start": "2026-10-10", "end": "2026-10-20", "title": "Sprint" })),
    )
    .await;
    api.call(
        Method::POST,
        "/events",
        Some(json!({ "start": "2026-11-05", "title": "Concert" })),
    )
    .await;
    api.call(
        Method::POST,
        "/events",
        Some(json!({ "start": "2027-06-01", "title": "Too far" })),
    )
    .await;

    let (status, today) = api.get("/today?date=2026-10-17").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(today["weekday"], "Saturday");
    assert_eq!(today["iso_week"], 42);
    assert_eq!(today["day_of_year"], 290);
    assert_eq!(today["days_left_in_year"], 75);
    assert_eq!(today["today"]["title"], "Sprint");
    let upcoming: Vec<&str> = today["upcoming"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["title"].as_str().unwrap())
        .collect();
    // The running sprint (with its real start date), then the concert; next year is too far.
    assert_eq!(upcoming, ["Sprint", "Concert"]);
    assert_eq!(today["upcoming"][0]["start"], "2026-10-10");

    let (_, summary) = api.get("/summary?year=2026").await;
    assert_eq!(summary["planned_days"], 12);
    assert_eq!(summary["events"], 2);
    assert_eq!(summary["months"][9]["name"], "October");
    assert_eq!(summary["months"][9]["events"][0]["title"], "Sprint");
    assert_eq!(summary["months"][10]["events"][0]["title"], "Concert");
}

#[sqlx::test]
async fn settings_and_categories(pool: PgPool) {
    let api = Api::new(pool);
    let (_, settings) = api
        .call(
            Method::PATCH,
            "/settings",
            Some(json!({ "categories": { "red": "Work", "green": "Holiday" }, "holiday_country": "SE" })),
        )
        .await;
    assert_eq!(settings["holiday_country"], "SE");

    // Partial update keeps the other field; null clears.
    let (_, settings) = api
        .call(
            Method::PATCH,
            "/settings",
            Some(json!({ "holiday_country": null })),
        )
        .await;
    assert_eq!(
        settings,
        json!({ "categories": { "green": "Holiday", "red": "Work" } })
    );

    api.call(
        Method::PUT,
        "/days/2026-01-05",
        Some(json!({ "title": "Kickoff", "category": "work" })),
    )
    .await;
    let (_, categories) = api.get("/categories").await;
    assert_eq!(
        categories["categories"][0],
        json!({ "color": "red", "name": "Work", "days": 1 })
    );
    assert_eq!(
        categories["categories"][1],
        json!({ "color": "orange", "days": 0 })
    );
}

#[sqlx::test]
async fn explains_mistakes_as_json(pool: PgPool) {
    let api = Api::new(pool);

    let (status, body) = api.get("/days/2026-02-30").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("YYYY-MM-DD"));

    let (status, body) = api
        .call(
            Method::PUT,
            "/days/2026-01-01",
            Some(json!({ "title": "x", "category": "Gym" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("Unknown category"));

    let (status, body) = api
        .call(
            Method::PUT,
            "/days/2026-01-01",
            Some(json!({ "titel": "typo" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("titel"));

    let (status, body) = api.get("/events?from=2026-13-01").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());

    let (status, _) = api
        .call(
            Method::POST,
            "/events",
            Some(json!({ "start": "2026-01-01", "end": "2040-01-01", "title": "Too long" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test]
async fn agent_writes_reach_the_web_app_sync(pool: PgPool) {
    let api = Api::new(pool);
    api.call(
        Method::PUT,
        "/days/2026-05-01",
        Some(json!({ "title": "From an agent" })),
    )
    .await;

    let request = Request::builder()
        .uri("/api/entries?since=0")
        .header(header::HOST, "localhost")
        .body(Body::empty())
        .unwrap();
    let response = api.0.clone().oneshot(request).await.unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let sync: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(sync["rev"], 1);
    assert_eq!(sync["changes"][0]["entry"]["title"], "From an agent");
}

#[sqlx::test]
async fn openapi_document_matches_the_routes(pool: PgPool) {
    let api = Api::new(pool);
    let (status, spec) = api.get("/openapi.json").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(spec["openapi"], "3.1.0");

    // Every documented path and method is routed (none answer 404/405).
    for (path, operations) in spec["paths"].as_object().unwrap() {
        let uri = path.replace("{date}", "2026-01-01");
        for method in operations.as_object().unwrap().keys() {
            if method == "parameters" {
                continue;
            }
            let method: Method = method.to_uppercase().parse().unwrap();
            let body =
                matches!(method, Method::POST | Method::PUT | Method::PATCH).then(|| json!({}));
            let (status, _) = api.call(method.clone(), &uri, body).await;
            assert!(
                status != StatusCode::NOT_FOUND && status != StatusCode::METHOD_NOT_ALLOWED,
                "{method} {path} -> {status}"
            );
        }
    }
}
