//! Clio High-Performance Pure Rust Engine
//!
//! Provides native, zero-copy telemetry auditing, data-parallel MinHash/LSH
//! plagiarism similarity analysis, and native in-process PDF rendering
//! for the Clio educational platform.

pub mod api;
pub mod pdf;
pub mod similarity;
pub mod stylometry;
pub mod telemetry;
pub mod winnowing;

pub use api::{AppState, build_router};
pub use pdf::{PdfRenderError, RenderPdfRequest, render_pdf};
pub use similarity::{AnalyzeRequest, AnalyzeResponse, analyze_corpus};
pub use stylometry::{
    FUNCTION_WORDS, StylometricProfile, StylometryRequest, StylometryResponse, audit_stylometry,
    burrows_delta_windowed, calculate_yules_k,
};
pub use telemetry::{AuditRequest, AuditResult, PasteEvent, TelemetrySnapshot, audit_telemetry};
pub use winnowing::{
    Fingerprint, InvertedFingerprintIndex, calculate_set_containment,
    calculate_windowed_containment, generate_sequential_shingles, winnow_shingle_hashes,
};
