use tokio::{net::TcpListener, signal};
use tracing_subscriber::EnvFilter;
use yearly_overview_server::{AppState, app, config::Config, db};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,sqlx=warn")),
        )
        .init();

    let config = Config::from_env()?;
    let pool = db::connect(&config.database_url).await?;

    match &config.static_dir {
        Some(dir) => tracing::info!("serving the app from {}", dir.display()),
        None => tracing::warn!("no frontend build found; serving the API only"),
    }

    let state = AppState { pool: pool.clone() };
    let listener = TcpListener::bind(config.bind_addr).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);

    axum::serve(listener, app(state, &config).into_make_service())
        .with_graceful_shutdown(shutdown())
        .await?;

    pool.close().await;
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async {
        signal::ctrl_c().await.ok();
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
