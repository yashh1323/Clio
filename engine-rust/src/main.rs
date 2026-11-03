//! Clio High-Performance Engine Server Binary.

use anyhow::Context;
use clio_engine::{AppState, build_router};
use std::net::SocketAddr;
use tokio::signal;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let host = std::env::var("CLIO_ENGINE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8088);

    let state = AppState::default();
    let app = build_router(state);

    let ip: std::net::IpAddr = host
        .parse()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let addr = SocketAddr::new(ip, port);
    info!("🚀 Clio High-Performance Rust Engine listening on http://{addr}");
    info!("   ├─ POST /api/v1/telemetry/audit");
    info!("   ├─ POST /api/v1/similarity/analyze");
    info!("   ├─ POST /api/v1/pdf/render");
    info!("   ├─ POST /api/v1/stylometry/audit");
    info!("   ├─ GET  /health");
    info!("   └─ GET  /metrics");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("Failed to bind to {addr}"))?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("Server exited with error")?;

    info!("Clio Engine stopped cleanly.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = signal::ctrl_c().await {
            warn!("Failed to install Ctrl+C handler: {err}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {
            info!("Received shutdown signal (Ctrl+C). Shutting down gracefully...");
        },
        () = terminate => {
            info!("Received SIGTERM signal. Shutting down gracefully...");
        },
    }
}
