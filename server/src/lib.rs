pub mod api_v1;
pub mod config;
pub mod db;
pub mod entries;
pub mod error;
pub mod mcp;
pub mod planner;

use std::sync::Arc;

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use sqlx::PgPool;
use tower_http::{
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ok"),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "database unavailable"),
    }
}

/// Refuses requests for hosts that aren't ours. Without a login, this is what stops a web page
/// on another domain from reaching the API through DNS rebinding.
async fn check_host(allowed: Arc<Vec<String>>, request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(|host| {
            // Strip the port; IPv6 literals keep their brackets.
            let host = match host.rsplit_once(':') {
                Some((name, port))
                    if !name.ends_with(':') && port.bytes().all(|b| b.is_ascii_digit()) =>
                {
                    name
                }
                _ => host,
            };
            host.to_ascii_lowercase()
        });

    // Loopback names are always fine: a rebinding page sends its own domain as Host, never these.
    let local = |host: &str| matches!(host, "localhost" | "127.0.0.1" | "[::1]");

    match host {
        Some(host) if local(&host) || allowed.contains(&host) => next.run(request).await,
        _ => (StatusCode::MISDIRECTED_REQUEST, "Unknown host").into_response(),
    }
}

/// Mutating API requests must come from this site. Browsers send `Origin` on cross-site
/// requests, so a foreign page can't change the planner even if it reaches the server.
async fn check_origin(request: Request, next: Next) -> Response {
    let method = request.method();
    if method.is_safe() {
        return next.run(request).await;
    }

    let headers = request.headers();
    let same_origin = match headers.get(header::ORIGIN) {
        // Non-browser clients (curl, scripts) don't send Origin.
        None => true,
        Some(origin) => {
            let origin_host = origin
                .to_str()
                .ok()
                .and_then(|origin| origin.split_once("://"))
                .map(|(_, rest)| rest.to_ascii_lowercase());
            // Behind a proxy, Host may be rewritten; browsers can't set X-Forwarded-Host on a
            // cross-origin request without a CORS preflight, which this server never grants.
            let hosts = [header::HOST.as_str(), "x-forwarded-host"].map(|name| {
                headers
                    .get(name)
                    .and_then(|host| host.to_str().ok())
                    .map(str::to_ascii_lowercase)
            });
            origin_host.is_some() && hosts.contains(&origin_host)
        }
    };

    if same_origin {
        next.run(request).await
    } else {
        (
            StatusCode::FORBIDDEN,
            "Cross-origin requests are not allowed",
        )
            .into_response()
    }
}

/// Headers for every response, plus caching rules that depend on the path.
async fn response_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    // The page's own CSP is a <meta> tag; frame-ancestors only works as a header.
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("frame-ancestors 'none'"),
    );

    let cache = if path.starts_with("/api/") {
        "no-store"
    } else if path.starts_with("/_app/immutable/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    headers
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static(cache));

    response
}

pub fn app(state: AppState, config: &Config) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/entries", get(entries::pull).put(entries::push))
        .nest("/v1", api_v1::routes())
        .fallback(|| async { (StatusCode::NOT_FOUND, "Not found") })
        .layer(middleware::from_fn(check_origin))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES));

    // Same protections as the API: agents in the browser can't reach it from other sites.
    let mcp = Router::new()
        .route("/mcp", get(mcp::get).post(mcp::post))
        .layer(middleware::from_fn(check_origin))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES));

    let mut router = Router::new().nest("/api", api).merge(mcp);

    if let Some(dir) = &config.static_dir {
        let files = ServeDir::new(dir)
            .precompressed_br()
            .precompressed_gzip()
            .not_found_service(ServeFile::new(dir.join("404.html")));
        router = router.fallback_service(files);
    }

    if !config.allowed_hosts.is_empty() {
        let allowed = Arc::new(config.allowed_hosts.clone());
        router = router.layer(middleware::from_fn(move |request, next| {
            check_host(allowed.clone(), request, next)
        }));
    }

    router
        .layer(middleware::from_fn(response_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
