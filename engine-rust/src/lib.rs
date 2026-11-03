//! Clio High-Performance Pure Rust Engine
//!
//! Provides native, zero-copy telemetry auditing, data-parallel MinHash/LSH
//! plagiarism similarity analysis, and native in-process PDF rendering
//! for the Clio educational platform.

#![forbid(unsafe_code)]

pub mod api;
pub mod pdf;
pub mod semantic;
pub mod similarity;
pub mod stylometry;
pub mod telemetry;
pub mod telemetry_advanced;
pub mod winnowing;

pub use api::{AppState, build_router};
pub use pdf::{PdfRenderError, RenderPdfRequest, render_pdf};
pub use semantic::{
    AlignedSentencePair, SemanticAnalyzeRequest, SemanticAnalyzeResponse,
    analyze_semantic_similarity, compute_document_centroid, embed_word,
};
pub use similarity::{AnalyzeRequest, AnalyzeResponse, analyze_corpus};
pub use stylometry::{
    FUNCTION_WORDS, StylometricProfile, StylometryRequest, StylometryResponse, audit_stylometry,
    burrows_delta_windowed, calculate_yules_k,
};
pub use telemetry::{AuditRequest, AuditResult, PasteEvent, TelemetrySnapshot, audit_telemetry};
pub use telemetry_advanced::{
    KeystrokeEvent, KeystrokeOp, ProcessAuditRequest, ProcessAuditResult, audit_keystroke_process,
};
pub use winnowing::{
    Fingerprint, InvertedFingerprintIndex, calculate_set_containment,
    calculate_windowed_containment, generate_sequential_shingles, winnow_shingle_hashes,
};
