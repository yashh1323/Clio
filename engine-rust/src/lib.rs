//! Clio High-Performance Pure Rust Engine
//!
//! Provides native, zero-copy telemetry auditing, data-parallel MinHash/LSH
//! plagiarism similarity analysis, and native in-process PDF rendering
//! for the Clio educational platform.

pub mod api;
pub mod pdf;
pub mod similarity;
pub mod telemetry;

pub use api::{AppState, build_router};
pub use pdf::{PdfRenderError, RenderPdfRequest, render_pdf};
pub use similarity::{AnalyzeRequest, AnalyzeResponse, analyze_corpus};
pub use telemetry::{AuditRequest, AuditResult, audit_telemetry};
