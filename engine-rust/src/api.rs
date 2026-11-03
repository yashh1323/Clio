//! Axum HTTP API router and handlers for the Clio Engine.
//!
//! Exposes:
//! - `GET /health` and `GET /api/v1/health`
//! - `GET /metrics`
//! - `POST /api/v1/telemetry/audit`
//! - `POST /api/v1/similarity/analyze`
//! - `POST /api/v1/pdf/render`
//! - `POST /api/v1/stylometry/audit`

use crate::pdf::{RenderPdfRequest, render_pdf};
use crate::similarity::{AnalyzeRequest, AnalyzeResponse, analyze_corpus};
use crate::telemetry::{AuditRequest, AuditResult, audit_telemetry};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRequest, Request, State, rejection::JsonRejection},
    http::{HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::Instant;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

/// Shared application state containing metrics and process uptime.
#[derive(Debug, Clone)]
pub struct AppState {
    /// Server startup instant.
    pub start_time: Instant,
    /// Total count of telemetry audit requests processed.
    pub telemetry_audits_total: Arc<AtomicU64>,
    /// Total count of similarity analyze requests processed.
    pub similarity_runs_total: Arc<AtomicU64>,
    /// Total count of native in-process PDF renders processed.
    pub pdf_renders_total: Arc<AtomicU64>,
    /// Total count of stylometry audits processed.
    pub stylometry_audits_total: Arc<AtomicU64>,
    /// Total count of semantic paraphrase analyze requests processed.
    pub semantic_analyzed_total: Arc<AtomicU64>,
    /// Total count of advanced cognitive keystroke telemetry audits processed.
    pub telemetry_processed_total: Arc<AtomicU64>,
    /// Optional pre-shared key required for all requests when configured.
    pub engine_key: Option<String>,
    /// Whether an engine key is strictly required by policy (CLIO_ENGINE_REQUIRE_KEY=true).
    pub require_key: bool,
}

impl Default for AppState {
    fn default() -> Self {
        let require_key = std::env::var("CLIO_ENGINE_REQUIRE_KEY")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);
        let engine_key = std::env::var("CLIO_ENGINE_KEY")
            .ok()
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty());

        Self {
            start_time: Instant::now(),
            telemetry_audits_total: Arc::new(AtomicU64::new(0)),
            similarity_runs_total: Arc::new(AtomicU64::new(0)),
            pdf_renders_total: Arc::new(AtomicU64::new(0)),
            stylometry_audits_total: Arc::new(AtomicU64::new(0)),
            semantic_analyzed_total: Arc::new(AtomicU64::new(0)),
            telemetry_processed_total: Arc::new(AtomicU64::new(0)),
            engine_key,
            require_key,
        }
    }
}

// Compile-time Send + Sync assertions
const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AppState>();
};

/// Custom JSON extractor that maps syntax/schema parsing rejections to HTTP 400 Bad Request.
#[derive(Debug)]
pub struct ValidatedJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidatedJson<T>
where
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(val)) => Ok(ValidatedJson(val)),
            Err(rejection) => {
                let err_payload = serde_json::json!({
                    "error": "Invalid or malformed JSON payload",
                    "details": rejection.to_string(),
                });
                Err((StatusCode::BAD_REQUEST, Json(err_payload)).into_response())
            }
        }
    }
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    uptime_seconds: f64,
}

#[derive(Debug, Serialize)]
struct MetricsResponse {
    telemetry_audits_total: u64,
    similarity_runs_total: u64,
    pdf_renders_total: u64,
    stylometry_audits_total: u64,
    semantic_analyzed_total: u64,
    telemetry_processed_total: u64,
    uptime_seconds: f64,
}

/// Handler for `/health` and `/api/v1/health`.
async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let uptime = state.start_time.elapsed().as_secs_f64();
    Json(HealthResponse {
        status: "ok",
        service: "clio-engine",
        version: "1.0.0",
        uptime_seconds: uptime,
    })
}

/// Handler for `/metrics`.
async fn metrics_handler(State(state): State<AppState>) -> Json<MetricsResponse> {
    let uptime = state.start_time.elapsed().as_secs_f64();
    Json(MetricsResponse {
        telemetry_audits_total: state.telemetry_audits_total.load(Ordering::Relaxed),
        similarity_runs_total: state.similarity_runs_total.load(Ordering::Relaxed),
        pdf_renders_total: state.pdf_renders_total.load(Ordering::Relaxed),
        stylometry_audits_total: state.stylometry_audits_total.load(Ordering::Relaxed),
        semantic_analyzed_total: state.semantic_analyzed_total.load(Ordering::Relaxed),
        telemetry_processed_total: state.telemetry_processed_total.load(Ordering::Relaxed),
        uptime_seconds: uptime,
    })
}

use axum::middleware::{Next, from_fn_with_state};

/// Middleware to validate pre-shared key header (`X-Clio-Engine-Key`) when `CLIO_ENGINE_KEY` is configured.
async fn validate_engine_key(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if state.require_key && state.engine_key.is_none() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Engine pre-shared key required by policy but CLIO_ENGINE_KEY is not configured"
            })),
        )
            .into_response();
    }

    if let Some(expected) = &state.engine_key {
        let provided = req
            .headers()
            .get("x-clio-engine-key")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        let exp_bytes = expected.as_bytes();
        let prov_bytes = provided.as_bytes();
        let mut diff = exp_bytes.len() ^ prov_bytes.len();
        for i in 0..exp_bytes.len() {
            let p = if i < prov_bytes.len() {
                prov_bytes[i]
            } else {
                0
            };
            diff |= (exp_bytes[i] ^ p) as usize;
        }
        let key_match = diff == 0;

        if !key_match {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unauthorized: invalid or missing X-Clio-Engine-Key header"
                })),
            )
                .into_response();
        }
    }
    next.run(req).await
}

/// Handler for `POST /api/v1/telemetry/audit`.
/// Uses tokio::task::spawn_blocking to isolate CPU-intensive validation and caps snapshots to <= 10,000.
async fn telemetry_audit_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<AuditRequest>,
) -> Result<Json<AuditResult>, (StatusCode, Json<serde_json::Value>)> {
    if req.snapshots.len() > 10_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Snapshots count exceeds maximum limit of 10,000"
            })),
        ));
    }

    state.telemetry_audits_total.fetch_add(1, Ordering::Relaxed);
    let snapshots = req.snapshots;
    let final_content = req.final_content;

    let result =
        tokio::task::spawn_blocking(move || audit_telemetry(&snapshots, final_content.as_deref()))
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
                )
            })?;

    Ok(Json(result))
}

/// Handler for `POST /api/v1/similarity/analyze`.
/// Uses tokio::task::spawn_blocking to isolate CPU-intensive Rayon work from async runtime threads.
async fn similarity_analyze_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, (StatusCode, Json<serde_json::Value>)> {
    state.similarity_runs_total.fetch_add(1, Ordering::Relaxed);
    let result = tokio::task::spawn_blocking(move || analyze_corpus(&req))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
            )
        })?;
    Ok(Json(result))
}

/// Handler for `POST /api/v1/pdf/render`.
/// Renders in-process PDF documents without external browser or C library dependencies.
async fn pdf_render_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<RenderPdfRequest>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    state.pdf_renders_total.fetch_add(1, Ordering::Relaxed);
    let pdf_bytes = tokio::task::spawn_blocking(move || render_pdf(&req))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
            )
        })?
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/pdf"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=\"document.pdf\"",
            ),
        ],
        pdf_bytes,
    )
        .into_response())
}

/// Handler for `POST /api/v1/stylometry/audit`.
/// Uses tokio::task::spawn_blocking to isolate CPU-intensive stylometry analysis and caps content length to 1MB.
async fn audit_stylometry_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<crate::stylometry::StylometryRequest>,
) -> Result<Json<crate::stylometry::StylometryResponse>, (StatusCode, Json<serde_json::Value>)> {
    if req.content.len() > 1_000_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Content exceeds 1MB limit" })),
        ));
    }

    state
        .stylometry_audits_total
        .fetch_add(1, Ordering::Relaxed);
    if let Some(title) = &req.title {
        tracing::debug!("Auditing stylometry for document: {}", title);
    }
    let content = req.content;

    let result = tokio::task::spawn_blocking(move || crate::stylometry::audit_stylometry(&content))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
            )
        })?;

    Ok(Json(result))
}

/// Handler for `POST /api/v1/semantic/analyze`.
/// Uses tokio::task::spawn_blocking to isolate CPU-intensive semantic projection and caps content to 1MB.
async fn semantic_analyze_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<crate::semantic::SemanticAnalyzeRequest>,
) -> Result<Json<crate::semantic::SemanticAnalyzeResponse>, (StatusCode, Json<serde_json::Value>)> {
    if req.doc_a.len() > 1_000_000 || req.doc_b.len() > 1_000_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Document content exceeds 1MB limit" })),
        ));
    }

    state
        .semantic_analyzed_total
        .fetch_add(1, Ordering::Relaxed);
    let result =
        tokio::task::spawn_blocking(move || crate::semantic::analyze_semantic_similarity(&req))
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
                )
            })?;

    Ok(Json(result))
}

/// Handler for `POST /api/v1/telemetry/process`.
/// Uses tokio::task::spawn_blocking to isolate keystroke stream evaluation and caps events to <= 50,000.
async fn telemetry_process_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<crate::telemetry_advanced::ProcessAuditRequest>,
) -> Result<
    Json<crate::telemetry_advanced::ProcessAuditResult>,
    (StatusCode, Json<serde_json::Value>),
> {
    if req.events.len() > 50_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({ "error": "Keystroke events count exceeds maximum limit of 50,000" }),
            ),
        ));
    }

    state
        .telemetry_processed_total
        .fetch_add(1, Ordering::Relaxed);
    let events = req.events;
    let result = tokio::task::spawn_blocking(move || {
        crate::telemetry_advanced::audit_keystroke_process(&events)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
        )
    })?;

    Ok(Json(result))
}

/// Builds a restricted CORS layer allowing localhost:3000, 127.0.0.1:3000, or custom origins.
fn build_cors_layer_with_origin(custom_origin: Option<&str>) -> CorsLayer {
    let mut origins = vec![
        HeaderValue::from_static("http://localhost:3000"),
        HeaderValue::from_static("http://127.0.0.1:3000"),
    ];
    if let Some(custom) = custom_origin {
        for part in custom.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty()
                && let Ok(val) = HeaderValue::from_str(trimmed)
            {
                origins.push(val);
            }
        }
    }

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            HeaderName::from_static("x-clio-engine-key"),
        ])
}

/// Builds a restricted CORS layer allowing localhost:3000, 127.0.0.1:3000, or CLIO_ALLOWED_ORIGIN.
fn build_cors_layer() -> CorsLayer {
    let custom = std::env::var("CLIO_ALLOWED_ORIGIN").ok();
    build_cors_layer_with_origin(custom.as_deref())
}

/// Builds the Axum router configured with restricted CORS, Tracing, and 25MB body limit.
/// Health and metrics probes remain unauthenticated while compute routes require `X-Clio-Engine-Key` when configured.
pub fn build_router(state: AppState) -> Router {
    let protected_routes = Router::new()
        .route("/api/v1/telemetry/audit", post(telemetry_audit_handler))
        .route(
            "/api/v1/similarity/analyze",
            post(similarity_analyze_handler),
        )
        .route("/api/v1/pdf/render", post(pdf_render_handler))
        .route(
            "/api/v1/stylometry/audit",
            post(audit_stylometry_handler).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .route(
            "/api/v1/semantic/analyze",
            post(semantic_analyze_handler).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .route(
            "/api/v1/telemetry/process",
            post(telemetry_process_handler).layer(DefaultBodyLimit::max(2 * 1024 * 1024)),
        )
        .route_layer(from_fn_with_state(state.clone(), validate_engine_key));

    Router::new()
        .route("/health", get(health_handler))
        .route("/api/v1/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .merge(protected_routes)
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .layer(build_cors_layer())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_endpoint() {
        let state = AppState::default();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_metrics_endpoint() {
        let state = AppState::default();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_malformed_json_returns_400() {
        let state = AppState::default();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/audit")
                    .header("content-type", "application/json")
                    .body(Body::from("{invalid_json}"))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_pdf_render_endpoint() {
        let state = AppState::default();
        let app = build_router(state);

        let payload = serde_json::json!({
            "title": "Test Title",
            "content": "This is test essay content rendered into a native PDF.",
            "author": "Test Student"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/pdf/render")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "application/pdf"
        );
    }

    #[tokio::test]
    async fn test_telemetry_audit_snapshots_ceiling_over_10k_returns_400() {
        let state = AppState::default();
        let app = build_router(state);

        let mut snapshots = Vec::with_capacity(10_001);
        for i in 0..10_001 {
            snapshots.push(serde_json::json!({
                "timestamp": i * 1000,
                "textLength": i * 2,
            }));
        }

        let payload = serde_json::json!({
            "snapshots": snapshots,
            "finalContent": "test"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/audit")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_engine_key_validation() {
        let state = AppState {
            engine_key: Some("test-secret-key-123".to_string()),
            ..AppState::default()
        };
        let app = build_router(state);

        // 1. Health and metrics probes remain unauthenticated even when CLIO_ENGINE_KEY is set
        for probe_uri in ["/health", "/api/v1/health", "/metrics"] {
            let probe_res = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(probe_uri)
                        .body(Body::empty())
                        .expect("valid request"),
                )
                .await
                .expect("response");
            assert_eq!(probe_res.status(), StatusCode::OK);
        }

        let audit_payload = serde_json::json!({
            "snapshots": [{ "timestamp": 1000, "textLength": 5 }],
            "finalContent": "hello"
        });

        // 2. Protected compute route without key header should return 401
        let unauth_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/audit")
                    .header("content-type", "application/json")
                    .body(Body::from(audit_payload.to_string()))
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(unauth_res.status(), StatusCode::UNAUTHORIZED);

        // 3. Protected compute route with invalid key should return 401
        let invalid_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/audit")
                    .header("content-type", "application/json")
                    .header("x-clio-engine-key", "wrong-key")
                    .body(Body::from(audit_payload.to_string()))
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(invalid_res.status(), StatusCode::UNAUTHORIZED);

        // 4. Protected compute route with valid key should return 200
        let auth_res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/audit")
                    .header("content-type", "application/json")
                    .header("x-clio-engine-key", "test-secret-key-123")
                    .body(Body::from(audit_payload.to_string()))
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(auth_res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_restricted_cors_layer() {
        let state = AppState::default();
        let app = build_router(state);

        // Allowed origin (http://localhost:3000) receives access-control-allow-origin header
        let allowed_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("origin", "http://localhost:3000")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(
            allowed_res
                .headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("http://localhost:3000")
        );

        // Disallowed origin (https://evil.example.com) must NOT receive access-control-allow-origin
        let blocked_res = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("origin", "https://evil.example.com")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert!(
            blocked_res
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );

        // Custom origin via CLIO_ALLOWED_ORIGIN is honored
        let custom_app = Router::new()
            .route("/health", get(health_handler))
            .layer(build_cors_layer_with_origin(Some(
                "https://clio.university.edu",
            )))
            .with_state(AppState::default());
        let custom_res = custom_app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("origin", "https://clio.university.edu")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");
        assert_eq!(
            custom_res
                .headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("https://clio.university.edu")
        );
    }

    #[tokio::test]
    async fn test_stylometry_audit_endpoint() {
        let state = AppState::default();
        let app = build_router(state.clone());

        let essay = "The quick brown fox jumps over the lazy dog. In the beginning, the author constructed a narrative that resonated with the audience and explained the significance of the scientific revolution.";
        let payload = serde_json::json!({
            "content": essay,
            "title": "Introductory Essay"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/stylometry/audit")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.stylometry_audits_total.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_semantic_analyze_endpoint() {
        let state = AppState::default();
        let app = build_router(state.clone());

        let payload = serde_json::json!({
            "docA": "The Industrial Revolution marked a period of rapid technological change.",
            "docB": "The Industrial Upheaval signaled an era of quick mechanical shift.",
            "threshold": 0.70
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/semantic/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.semantic_analyzed_total.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_telemetry_process_endpoint() {
        let state = AppState::default();
        let app = build_router(state.clone());

        let mut events = Vec::new();
        let mut t = 1000u64;
        for i in 0..40 {
            events.push(serde_json::json!({
                "timestamp": t,
                "op": if i % 15 == 0 { "delete" } else { "insert" }
            }));
            t += if i % 8 == 0 { 600 } else { 150 };
        }

        let payload = serde_json::json!({
            "events": events,
            "sessionId": "sess-test-123"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/telemetry/process")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.telemetry_processed_total.load(Ordering::Relaxed), 1);
    }
}
