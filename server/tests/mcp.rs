//! The MCP endpoint (`/mcp`).

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

struct Mcp(Router);

impl Mcp {
    fn new(pool: PgPool) -> Self {
        let config = Config {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            database_url: String::new(),
            static_dir: None,
            allowed_hosts: Vec::new(),
        };
        Self(app(AppState { pool }, &config))
    }

    async fn send(&self, body: Value, origin: Option<&str>) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(header::HOST, "localhost")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json, text/event-stream");
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        let response = self
            .0
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn rpc(&self, method: &str, params: Value) -> Value {
        let (status, reply) = self
            .send(
                json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params }),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(reply["id"], 7);
        reply
    }

    async fn tool(&self, name: &str, arguments: Value) -> Value {
        self.rpc(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        )
        .await["result"]
            .clone()
    }
}

#[sqlx::test]
async fn handshake(pool: PgPool) {
    let mcp = Mcp::new(pool);
    let reply = mcp
        .rpc(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "test", "version": "1" } }),
        )
        .await;
    assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(reply["result"]["serverInfo"]["name"], "yearly-overview");
    assert!(reply["result"]["capabilities"]["tools"].is_object());
    assert!(
        reply["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("get_today")
    );

    // Unknown versions get our newest.
    let reply = mcp
        .rpc("initialize", json!({ "protocolVersion": "1999-01-01" }))
        .await;
    assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");

    let (status, body) = mcp
        .send(
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body, Value::Null);

    assert_eq!(mcp.rpc("ping", json!({})).await["result"], json!({}));
}

#[sqlx::test]
async fn lists_tools_with_schemas(pool: PgPool) {
    let mcp = Mcp::new(pool);
    let tools = mcp.rpc("tools/list", json!({})).await["result"]["tools"].clone();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "get_today",
            "get_year_summary",
            "list_events",
            "list_days",
            "get_day",
            "list_categories",
            "add_event",
            "update_day",
            "clear_days",
            "update_settings"
        ]
    );
    for tool in tools.as_array().unwrap() {
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
        assert!(tool["description"].as_str().unwrap().len() > 20);
        assert!(tool["annotations"]["readOnlyHint"].is_boolean());
    }
}

#[sqlx::test]
async fn plans_with_tools(pool: PgPool) {
    let mcp = Mcp::new(pool);
    mcp.tool(
        "update_settings",
        json!({ "categories": { "green": "Holiday" }, "holiday_country": "SE" }),
    )
    .await;

    let added = mcp
        .tool(
            "add_event",
            json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation", "category": "Holiday" }),
        )
        .await;
    assert_eq!(added["isError"], false);
    assert_eq!(added["structuredContent"]["event"]["days"], 5);
    assert_eq!(added["content"][0]["type"], "text");

    let events = mcp
        .tool(
            "list_events",
            json!({ "from": "2026-07-01", "to": "2026-07-31" }),
        )
        .await;
    assert_eq!(
        events["structuredContent"]["events"][0]["category"],
        "Holiday"
    );

    let updated = mcp
        .tool(
            "update_day",
            json!({ "date": "2026-07-08", "description": "Rest day" }),
        )
        .await;
    assert_eq!(updated["structuredContent"]["day"]["title"], "Vacation");
    assert_eq!(
        updated["structuredContent"]["day"]["description"],
        "Rest day"
    );

    let day = mcp.tool("get_day", json!({ "date": "2026-07-08" })).await;
    assert_eq!(day["structuredContent"]["day"]["description"], "Rest day");

    let today = mcp.tool("get_today", json!({ "date": "2026-07-07" })).await;
    assert_eq!(today["structuredContent"]["today"]["title"], "Vacation");

    let summary = mcp.tool("get_year_summary", json!({ "year": 2026 })).await;
    assert_eq!(summary["structuredContent"]["planned_days"], 5);

    let categories = mcp.tool("list_categories", json!({})).await;
    assert_eq!(
        categories["structuredContent"]["categories"][3],
        json!({ "color": "green", "name": "Holiday", "days": 5 })
    );

    let days = mcp.tool("list_days", json!({ "query": "rest" })).await;
    assert_eq!(days["structuredContent"]["days"][0]["date"], "2026-07-08");

    let cleared = mcp
        .tool(
            "clear_days",
            json!({ "from": "2026-07-01", "to": "2026-07-31" }),
        )
        .await;
    assert_eq!(cleared["structuredContent"]["cleared"], 5);
}

#[sqlx::test]
async fn reports_problems_as_tool_errors(pool: PgPool) {
    let mcp = Mcp::new(pool);
    mcp.tool(
        "update_day",
        json!({ "date": "2026-07-08", "title": "Dentist" }),
    )
    .await;

    // Conflicts come back as a readable error listing what's in the way.
    let conflict = mcp
        .tool(
            "add_event",
            json!({ "start": "2026-07-06", "end": "2026-07-10", "title": "Vacation" }),
        )
        .await;
    assert_eq!(conflict["isError"], true);
    let text = conflict["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("overwrite"), "{text}");
    assert!(text.contains("Dentist"), "{text}");

    let bad_date = mcp.tool("get_day", json!({ "date": "next tuesday" })).await;
    assert_eq!(bad_date["isError"], true);
    assert!(
        bad_date["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("YYYY-MM-DD")
    );

    let typo = mcp
        .tool("clear_days", json!({ "form": "2026-01-01" }))
        .await;
    assert_eq!(typo["isError"], true);

    // Unknown tools and methods are protocol errors.
    let unknown = mcp
        .rpc(
            "tools/call",
            json!({ "name": "launch_rockets", "arguments": {} }),
        )
        .await;
    assert_eq!(unknown["error"]["code"], -32602);
    assert_eq!(
        mcp.rpc("resources/list", json!({})).await["error"]["code"],
        -32601
    );
}

#[sqlx::test]
async fn transport_rules(pool: PgPool) {
    let mcp = Mcp::new(pool);

    // No server-sent event stream.
    let response = mcp
        .0
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mcp")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

    // Web pages on other sites can't drive the tools (DNS rebinding protection).
    let (status, _) = mcp
        .send(
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
            Some("https://evil.example"),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, reply) = mcp.send(json!("not json-rpc"), None).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(reply, Value::Null);

    // Batches (older protocol versions) get a batch reply.
    let (_, batch) = mcp
        .send(
            json!([
                { "jsonrpc": "2.0", "id": 1, "method": "ping" },
                { "jsonrpc": "2.0", "method": "notifications/initialized" },
                { "jsonrpc": "2.0", "id": 2, "method": "ping" }
            ]),
            None,
        )
        .await;
    assert_eq!(batch.as_array().unwrap().len(), 2);
}
