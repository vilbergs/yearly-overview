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

struct TestApp {
    router: Router,
}

struct TestResponse {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Value,
}

impl TestApp {
    fn new(pool: PgPool) -> Self {
        Self::with_hosts(pool, &[])
    }

    fn with_hosts(pool: PgPool, allowed_hosts: &[&str]) -> Self {
        let config = Config {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            database_url: String::new(),
            static_dir: None,
            allowed_hosts: allowed_hosts
                .iter()
                .map(|host| (*host).to_owned())
                .collect(),
        };
        Self {
            router: app(AppState { pool }, &config),
        }
    }

    async fn send(&self, request: Request<Body>) -> TestResponse {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        TestResponse {
            status,
            headers,
            body,
        }
    }

    async fn request(&self, method: Method, uri: &str, body: Option<Value>) -> TestResponse {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "planner.example.ts.net");
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        self.send(
            request
                .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
                .unwrap(),
        )
        .await
    }

    async fn push(&self, body: Value) -> TestResponse {
        self.request(Method::PUT, "/api/entries", Some(body)).await
    }

    async fn pull(&self, since: i64) -> TestResponse {
        self.request(Method::GET, &format!("/api/entries?since={since}"), None)
            .await
    }
}

#[sqlx::test]
async fn health_check(pool: PgPool) {
    let app = TestApp::new(pool);
    let response = app.request(Method::GET, "/api/health", None).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(response.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
}

#[sqlx::test]
async fn starts_empty(pool: PgPool) {
    let app = TestApp::new(pool);
    let response = app.pull(0).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body, json!({ "rev": 0, "changes": [] }));
}

#[sqlx::test]
async fn push_and_pull_incrementally(pool: PgPool) {
    let app = TestApp::new(pool);

    let push = app
        .push(json!({ "changes": [
            { "date": "2026-07-06", "entry": { "title": " Vacation ", "description": "", "color": "green" } },
            { "date": "2026-07-07", "entry": { "title": "Vacation", "description": "", "color": "green" } },
        ]}))
        .await;
    assert_eq!(push.status, StatusCode::OK);
    assert_eq!(push.body["rev"], 1);

    let full = app.pull(0).await;
    assert_eq!(full.body["rev"], 1);
    assert_eq!(
        full.body["changes"][0],
        json!({ "date": "2026-07-06", "entry": { "title": "Vacation", "description": "", "color": "green" } })
    );

    let delete = app
        .push(json!({ "changes": [{ "date": "2026-07-07", "entry": null }] }))
        .await;
    assert_eq!(delete.body["rev"], 2);

    let incremental = app.pull(1).await;
    assert_eq!(
        incremental.body,
        json!({ "rev": 2, "changes": [{ "date": "2026-07-07", "entry": null }] })
    );

    // Deleted days are left out of a full pull.
    let full = app.pull(0).await;
    assert_eq!(full.body["changes"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn rejects_invalid_entries_atomically(pool: PgPool) {
    let app = TestApp::new(pool);

    for change in [
        json!({ "date": "2026-02-30", "entry": null }),
        json!({ "date": "2024-+1-01", "entry": null }),
        json!({ "date": "2026-01-01", "entry": { "title": "x", "color": "chartreuse" } }),
        json!({ "date": "2026-01-01", "entry": { "title": "x".repeat(201) } }),
    ] {
        let response = app
            .push(json!({ "changes": [
                { "date": "2026-05-05", "entry": { "title": "valid" } },
                change
            ] }))
            .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
    }

    // Nothing was written by the rejected batches, not even their valid parts.
    assert_eq!(app.pull(0).await.body["rev"], 0);
}

#[sqlx::test]
async fn settings_sync_with_revisions(pool: PgPool) {
    let app = TestApp::new(pool);
    assert!(app.pull(0).await.body.get("settings").is_none());

    let push = app
        .push(json!({ "settings": {
            "categories": { "green": " Holiday ", "red": "Work" },
            "holiday_country": "SE"
        } }))
        .await;
    assert_eq!(push.status, StatusCode::OK);
    assert_eq!(push.body["rev"], 1);

    assert_eq!(
        app.pull(0).await.body["settings"],
        json!({ "categories": { "green": "Holiday", "red": "Work" }, "holiday_country": "SE" })
    );
    // Unchanged since revision 1, so not sent again.
    assert!(app.pull(1).await.body.get("settings").is_none());

    let invalid = app
        .push(json!({ "settings": { "categories": { "teal": "x" } } }))
        .await;
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
}

#[sqlx::test]
async fn refuses_cross_origin_writes(pool: PgPool) {
    let app = TestApp::new(pool);
    let put = |origin: Option<&str>, forwarded: Option<&str>| {
        let mut request = Request::builder()
            .method(Method::PUT)
            .uri("/api/entries")
            .header(header::HOST, "127.0.0.1:8080")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        if let Some(forwarded) = forwarded {
            request = request.header("x-forwarded-host", forwarded);
        }
        request
            .body(Body::from(json!({ "changes": [] }).to_string()))
            .unwrap()
    };

    // A page on another site.
    let evil = app.send(put(Some("https://evil.example"), None)).await;
    assert_eq!(evil.status, StatusCode::FORBIDDEN);

    // The app itself, directly and behind a proxy that rewrites Host.
    assert_eq!(
        app.send(put(Some("http://127.0.0.1:8080"), None))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        app.send(put(
            Some("https://planner.example.ts.net"),
            Some("planner.example.ts.net")
        ))
        .await
        .status,
        StatusCode::OK
    );

    // Scripts without an Origin header (curl) are fine.
    assert_eq!(app.send(put(None, None)).await.status, StatusCode::OK);

    // Reads are never blocked by this check.
    let read = app
        .send(
            Request::builder()
                .uri("/api/entries")
                .header(header::HOST, "127.0.0.1:8080")
                .header(header::ORIGIN, "https://evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(read.status, StatusCode::OK);
}

#[sqlx::test]
async fn only_serves_allowed_hosts_when_configured(pool: PgPool) {
    let app = TestApp::with_hosts(pool, &["planner.example.ts.net"]);
    let get = |host: &str| {
        Request::builder()
            .uri("/api/health")
            .header(header::HOST, host)
            .body(Body::empty())
            .unwrap()
    };

    assert_eq!(
        app.send(get("planner.example.ts.net")).await.status,
        StatusCode::OK
    );
    assert_eq!(app.send(get("LOCALHOST:8080")).await.status, StatusCode::OK);
    // Loopback always works, e.g. for health checks on the machine itself.
    assert_eq!(app.send(get("127.0.0.1:8080")).await.status, StatusCode::OK);
    assert_eq!(app.send(get("[::1]:8080")).await.status, StatusCode::OK);
    // A DNS-rebinding page arrives with its own domain as Host.
    assert_eq!(
        app.send(get("attacker.example")).await.status,
        StatusCode::MISDIRECTED_REQUEST
    );
}

#[sqlx::test]
async fn unknown_api_routes_are_404(pool: PgPool) {
    let app = TestApp::new(pool);
    let response = app.request(Method::GET, "/api/nope", None).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    let old_auth = app
        .request(Method::POST, "/api/auth/login", Some(json!({})))
        .await;
    assert_eq!(old_auth.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn concurrent_writes_get_distinct_revisions(pool: PgPool) {
    let app = std::sync::Arc::new(TestApp::new(pool));
    let writes = (1..=25).map(|day| {
        let app = app.clone();
        tokio::spawn(async move {
            app.push(json!({ "changes": [
                { "date": format!("2026-03-{day:02}"), "entry": { "title": format!("Day {day}") } }
            ] }))
            .await
            .body["rev"]
                .as_i64()
                .unwrap()
        })
    });

    let mut revisions = Vec::new();
    for write in writes {
        revisions.push(write.await.unwrap());
    }
    revisions.sort_unstable();
    assert_eq!(revisions, (1..=25).collect::<Vec<_>>());

    let full = app.pull(0).await;
    assert_eq!(full.body["rev"], 25);
    assert_eq!(full.body["changes"].as_array().unwrap().len(), 25);
}
