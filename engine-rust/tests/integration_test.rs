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
    let body_bytes = axum::body::to_bytes(res.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let audit_res: clio_engine::AuditResult = serde_json::from_slice(&body_bytes).unwrap();
    assert!(audit_res.is_valid);
    assert_eq!(audit_res.peak_accretion_velocity, Some(5.0));
    assert_eq!(audit_res.avg_accretion_velocity, Some(5.0));
}

#[tokio::test]
async fn test_stylometry_audit_api_integration() {
    let state = AppState::default();
    let app = build_router(state);

    let p1 = "The student wrote an extensive essay about the history of science and it was evident that his core arguments were well grounded in empirical observations from the seventeenth century which he carefully analyzed in the university archives with keen attention to original manuscripts and scholarly records discovered during his research. ";
    let p2 = "In subsequent chapters he examined how experimental philosophy gradually replaced scholastic traditions across western europe fostering new methodologies that prioritized reproducible measurements over dogmatic assertions thereby laying the intellectual foundations for modern scientific inquiry and transforming human understanding of natural phenomena through rigorous mathematical formulations and systematic verification. ";
    let p3 = "Furthermore the investigation highlighted the crucial role of scientific societies in disseminating experimental findings fostering international correspondence and establishing peer critique as an indispensable safeguard against idiosyncratic bias. ";
    let essay = format!("{p1}{p2}{p3}{p1}{p2}{p3}"); // ~265 words with natural vocabulary
    let payload = serde_json::json!({
        "content": essay,
        "title": "Scientific Revolution"
    });

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/stylometry/audit")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let stylometry_res: clio_engine::StylometryResponse =
        serde_json::from_slice(&body_bytes).unwrap();
    assert!(stylometry_res.word_count >= 250);
    assert!(stylometry_res.total_windows >= 1);
    assert!(!stylometry_res.profile.is_anomalous);
    assert!(stylometry_res.profile.burrows_delta_max < 1.5);
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
        containment_threshold: None,
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
        "/api/v1/stylometry/audit",
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
