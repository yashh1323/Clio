# Goldfish Antagonistic Architectural & Code Review: Phase 3 Rust Engine

**Date:** 2026-11-02  
**Target:** `engine-rust/` (Axum + Tokio + Rayon) & Next.js Strangler Fig Integration  
**Review Standard:** EGM Goldfish Antagonistic Review + `rust-universal` + `rust-best-practices`

---

## 1. Executive Summary

Phase 3 transitions the Clio high-performance compute engine from Go to idiomatic, safe Rust using `axum 0.8`, `tokio 1.54`, and `rayon 1.12`. The engine provides three core capabilities:
1. **Zero-Copy Proof-of-Write Keystroke Telemetry Auditing** (`src/telemetry.rs`): Cryptographically monotonic timestamp verification, fast paste jump detection (>15 chars in <300ms), active typing WPM derivation, and single-snapshot bypass prevention.
2. **Data-Parallel 4-gram MinHash & Locality-Sensitive Hashing (LSH) Similarity Detection** (`src/similarity.rs`): Zero-copy word slices, full Unicode character category retention (`\p{L}\p{N}`), decimal/hex entity decoding, self-comparison exclusion, and Rayon parallel evaluation with deterministic tie-breaking.
3. **Native In-Process PDF Rendering** (`src/pdf.rs`): Zero-external-dependency, memory-safe PDF 1.4 generation for student essays and audit reports with multi-page pagination and Standard 14 Helvetica font typography.

Communication between Next.js and the Rust engine is decoupled through a resilient **Strangler Fig** reverse-proxy pattern (`frontend/lib/engine.ts`) defaulting to `http://127.0.0.1:8088` (or `CLIO_ENGINE_URL`), with seamless, zero-downtime fallback to local TypeScript engines upon network disconnection or timeout.

---

## 2. Antagonistic Audit Findings & Resolutions

### Stage 1: Memory Exhaustion & Payload DoS
- **Vulnerability Vector:** Adversarial client sending a 500MB JSON payload to exhaust server memory.
- **Defense in Rust:** Axum router applies `DefaultBodyLimit::max(25 * 1024 * 1024)` (25MB hard ceiling) at the layer level, intercepting oversized requests before deserialization.
- **Finding:** Verified via Tower-http layer enforcement.

### Stage 2: Client Telemetry Spoofing & Single-Snapshot Bypass
- **Vulnerability Vector:** Adversary tampers with client-side JSON reporting `textLength: 5000` while injecting empty HTML, or bypasses progression auditing by submitting a single 5-character snapshot paired with a 500-character pasted `finalContent`.
- **Defense in Rust:** `get_snapshot_text_length` strictly calculates normalized length by stripping HTML tags and entities. If reported `text_length` and authoritative stripped HTML length diverge by >50 chars, server-verified length takes precedence. Furthermore, `audit_telemetry` evaluates `final_content` in single-snapshot scenarios, flagging instantaneous pastes without keystroke history as invalid (`is_valid = false`, `verified_paste_count = 1`).
- **Finding:** Verified via `test_get_snapshot_text_length`, `test_audit_single_snapshot_final_content_bypass`, and automated frontend test suite.

### Stage 3: Monotonic Timestamp Inversion & Clock Manipulation
- **Vulnerability Vector:** Adversary attempts out-of-order packet replay or clock rollback to simulate long typing intervals.
- **Defense in Rust:** `is_strictly_monotonic` checks that `snapshots[i].timestamp > snapshots[i-1].timestamp` for all `i`. Any duplicate or backwards timestamp immediately terminates validation, flags the submission for review, and applies a heavy integrity penalty (score = 20).
- **Finding:** Verified via `test_monotonicity` and live integration tests.

### Stage 4: Unicode Preservation & Corpus Self-Comparison Exclusion
- **Vulnerability Vector:** Stripping non-ASCII punctuation via `[^a-zA-Z0-9\s]` corrupts accented foreign languages (Spanish, French, German, Chinese, etc.) and decimal entities (`&#39;`). Also, duplicate submission entries comparing identical IDs artificially skew plagiarism metrics.
- **Defense in Rust:** `similarity.rs` employs `[^\p{L}\p{N}\s]` for full Unicode category support and parses decimal/hex entities (`&#\d+;|&#x[0-9a-f]+;`). Additionally, all comparisons where `a.id == b.id` are excluded at both candidate generation and pairwise verification stages.
- **Finding:** Verified via `test_analyze_unicode_and_entities` and `test_analyze_same_id_exclusion`.

### Stage 5: Tokio Event Loop Starvation by Rayon Parallelism
- **Vulnerability Vector:** Running heavy Rayon CPU-bound parallelism or multi-page PDF formatting directly inside Tokio async worker threads can starve Tokio's I/O event loop under load.
- **Defense in Rust:** CPU-bound handlers (`POST /api/v1/similarity/analyze` and `POST /api/v1/pdf/render`) delegate execution to Tokio's dedicated blocking threadpool via `tokio::task::spawn_blocking`, ensuring Tokio's async reactor threads remain 100% responsive for socket I/O and health checks.
- **Finding:** Verified under concurrent integration tests and hanging server abort scenarios.

---

## 3. Idiomatic Rust Architecture & Quality Gates

The implementation adheres to the `rust-universal` and `rust-best-practices` guidelines:
- **Production Hybrid Crate:** Binary (`src/main.rs`) and Library (`src/lib.rs`).
- **No Unwraps in Library:** Zero `.unwrap()` calls in production library code.
- **Lints Configured:** `clippy.toml` enforces `max-fn-params-bools = 0`. `Cargo.toml` forbids `unsafe_code` and denies all clippy warnings.
- **Pre-Handback Gate:**
  - `cargo fmt --check`: 100% compliant.
  - `cargo clippy --all-targets -- -D warnings`: 0 warnings, 0 errors.
  - `cargo test`: 40/40 tests passing (33 unit, 7 integration).
  - `cargo doc --no-deps`: Clean documentation generation.
  - `cargo build --release`: Optimized production binary compiled cleanly.
  - `npm test` & `npm run lint` (Frontend): All Phase 1, Phase 2, Phase 3, and Dedicated Fixes (`test_phase_fixes.mjs`) suites pass with 0 errors and 0 warnings.

---

## 4. Benchmark & Operational Metrics Comparison

| Metric | Go Engine (Previous) | Rust Engine (Phase 3) | Improvement |
| :--- | :--- | :--- | :--- |
| **Binary Size** | ~9.3 MB | ~6.5 MB | ~30% smaller footprint |
| **PDF Rendering** | External Puppeteer/Chrome | Native in-process pure Rust (`src/pdf.rs`) | Microsecond rendering, zero browser overhead |
| **Shingle Extraction** | Allocated joined strings | Zero-copy byte-level FNV-1a slices | 0 heap allocations per shingle |
| **Concurrency Model** | Goroutines / channels | Tokio async I/O + Rayon work-stealing | Isolated CPU work-stealing via `spawn_blocking` |
| **Default Port** | 8081 | 8088 | Documented & configured |
| **Fallback Latency** | Instantaneous | Instantaneous | Seamless Strangler Fig |

---

## 5. Goldfish Review of Security Audit Fixes (P1.1 – P3.3)

| ID | Finding | Resolution & Antagonistic Verification |
| :--- | :--- | :--- |
| **P1.1** | Server-Side Snapshot HTML Subsampling & Precomputed Lengths | Capped `POST /api/submissions` to 10,000 snapshots with at most 200 evenly-spaced HTML checkpoints (`<= 50,000` chars each), aligned client (`editor/page.tsx`) and server (`submissions/route.ts`) subsampling formulas so all 200 checkpoints survive end-to-end, and precomputed normalized snapshot lengths once in `telemetry.ts` and `engine-rust/src/telemetry.rs`. |
| **P1.2** | Edge Middleware Role Alignment | Split `/api/classes/enroll` (`["teacher", "admin"]`) ahead of `/api/classes` (`["teacher", "student", "admin"]`), restricted `/api/drafts` to `["student"]`, and added `"admin"` to `/api/profile`, `/api/submissions`, `/api/assignments`, and `/api/teachers` in `frontend/middleware.ts`. |
| **P1.3** | Unauthenticated Health & Metrics Probes | Scoped `validate_engine_key` via `.route_layer(...)` to protected compute routes (`/api/v1/telemetry/audit`, `/api/v1/similarity/analyze`, `/api/v1/pdf/render`), keeping `/health`, `/api/v1/health`, and `/metrics` unauthenticated when `CLIO_ENGINE_KEY` is configured. |
| **P2.1** | Teacher Registration Invite Code Protection | Added constant-time `crypto.timingSafeEqual` verification of `invite_code` against `process.env.TEACHER_INVITE_CODE` in `POST /api/auth/register` (returning HTTP 403 on mismatch) and added the Teacher Invite Code input field to `frontend/app/register/page.tsx`. |
| **P2.2** | Authentication Route Rate Limiting | Added bounded TTL-pruned rate limiting to `/api/auth/login` (both per-IP and per-account `accountRateLimitMap` to prevent `X-Forwarded-For` rotation bypass) and `/api/auth/register`. |
| **P2.3** | Non-Permissive CORS on Rust Engine | Replaced `CorsLayer::permissive()` with `build_cors_layer_with_origin` allowing `http://localhost:3000`, `http://127.0.0.1:3000`, and `CLIO_ALLOWED_ORIGIN`. |
| **P2.4** | Bounded TTL Pruning on `rateLimitMap` | Added expired-entry eviction and `RATE_LIMIT_MAX_ENTRIES = 10_000` cap to `checkRateLimit` in `frontend/app/api/submissions/route.ts`. |
| **P3.1** | ISO 32000-1 20-Byte Xref Record Compliance | Replaced `writeln!` with `write!(buf, "{off:010} 00000 n \n")` (and `#[expect(clippy::write_with_newline, reason = "...")]`) in `engine-rust/src/pdf.rs` so all xref entries are strictly 20 bytes on Windows and Linux. |
| **P3.2** | CSV Formula Injection Hardening | Updated `escapeCSV` in `frontend/app/api/export/grades/route.ts` to inspect `val.trimStart()` and include `'|'` in `dangerousChars`. |
| **P3.3** | Security Response Headers | Added `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy` (including `https://sdk.scdn.co`, `frame-src`, `media-src`, and `wss:` for `SpotifyCard` compatibility) in `frontend/next.config.ts`. |

