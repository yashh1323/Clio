//! Integration tests for clio_engine public API.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use axum::body::Body;
use clio_engine::{
    AppState, analyze_corpus, audit_telemetry, build_router,
    similarity::{AnalyzeRequest, SubmissionInput},
    telemetry::TelemetrySnapshot,
};
use http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn test_full_pipeline_health_and_metrics() {
    let state = AppState::default();
    let app = build_router(state);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_telemetry_audit_api_endpoint() {
    let state = AppState::default();
    let app = build_router(state);

    let mut snaps = Vec::new();
    for i in 0..10 {
        snaps.push(TelemetrySnapshot {
            timestamp: 1000 + i * 1000,
            html: None,
            text_length: Some(((i + 1) * 5) as f64),
        });
    }

    let payload = serde_json::json!({
        "snapshots": snaps,
        "finalContent": "a".repeat(50),
    });

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/telemetry/audit")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_similarity_analyze_api_endpoint() {
    let state = AppState::default();
    let app = build_router(state);

    let essay = "Photosynthesis is the process by which green plants and certain other organisms transform light energy into chemical energy during cellular processes.";
    let payload = serde_json::json!({
        "submissions": [
            {
                "id": "1",
                "assignment": "Bio 101",
                "student": "Alice",
                "username": "alice",
                "content": essay
            },
            {
                "id": "2",
                "assignment": "Bio 101",
                "student": "Bob",
                "username": "bob",
                "content": essay
            }
        ],
        "threshold": 25
    });

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/similarity/analyze")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
}

#[test]
fn test_lib_direct_calls() {
    let audit_res = audit_telemetry(&[], None);
    assert!(!audit_res.is_valid);

    let sim_res = analyze_corpus(&AnalyzeRequest {
        submissions: vec![SubmissionInput {
            id: "1".into(),
            assignment: "A".into(),
            student: "A".into(),
            username: "a".into(),
            content: "Test".into(),
        }],
        threshold: Some(25),
        shingle_size: Some(4),
    });
    assert_eq!(sim_res.pairs.len(), 0);
}

#[tokio::test]
async fn test_pdf_render_api_endpoint() {
    let state = AppState::default();
    let app = build_router(state);

    let payload = serde_json::json!({
        "title": "Integration Test PDF",
        "content": "<p>This is a paragraph verifying PDF generation via HTTP API.</p>",
        "author": "Student Tester"
    });

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/pdf/render")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get("content-type").unwrap(),
        "application/pdf"
    );
}

#[tokio::test]
async fn test_unauthenticated_probes_and_protected_compute_routes() {
    let state = AppState {
        engine_key: Some("integration-key-999".to_string()),
        ..AppState::default()
    };
    let app = build_router(state);

    // Probes (/health, /api/v1/health, /metrics) must succeed without X-Clio-Engine-Key
    for probe in ["/health", "/api/v1/health", "/metrics"] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(probe).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // Compute routes must reject missing key with 401
    for compute_uri in [
        "/api/v1/telemetry/audit",
        "/api/v1/similarity/analyze",
        "/api/v1/pdf/render",
    ] {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(compute_uri)
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn test_cors_allows_localhost_and_blocks_unknown_origins() {
    let state = AppState::default();
    let app = build_router(state);

    let ok_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("origin", "http://127.0.0.1:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        ok_res
            .headers()
            .get("access-control-allow-origin")
            .and_then(|h| h.to_str().ok()),
        Some("http://127.0.0.1:3000")
    );

    let blocked_res = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("origin", "https://malicious.site")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        blocked_res
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}
