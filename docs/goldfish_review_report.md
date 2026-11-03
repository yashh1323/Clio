# Goldfish Consolidated Review Report (`egm-review-loop`)

**Target Scope:**
- [`README.md`](../README.md)
- [`docs/architecture.md`](architecture.md)
- [`docs/github_release_and_architecture_report.md`](github_release_and_architecture_report.md)
- [`docs/clio_system_qa_documentation.md`](clio_system_qa_documentation.md)

**Review Swarm Personas Executed:**
1. `egm-codebase-details` (Pedantic Technical Quality & Secret Hygiene Auditor)
2. `egm-structural` (Structural Layout & Link Integrity Validator)
3. `egm-style` (Technical Copy Editor, HumanScope & GitHub SEO Auditor)

---

## Consolidated Findings & Resolution Ledger (`egm-resolve`)

| ID | Reviewer | Severity | Target | Finding Summary | Resolution Action (`PROPOSE FIX`) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | `egm-codebase-details` | 🔴 Blocker | `docs/github_release_and_architecture_report.md` | Literal Supabase project ID and token prefixes appeared in secret-scan description and `.env.example`. | Scrub project ID to `<your-project-id>` and use `<your-supabase-anon-key>` / `<your-supabase-service-role-key>` placeholders. | ✅ Resolved |
| **F2** | `egm-structural` & `egm-codebase-details` | 🔴 Blocker | `README.md` & root `SECURITY.md` | `README.md` linked to `[SECURITY.md](SECURITY.md)`, which did not exist at repository root. | Create root `SECURITY.md` policy and link `[MIT License](LICENSE)`. | ✅ Resolved |
| **F3** | `egm-codebase-details` | 🔴 Blocker | `README.md`, `docs/architecture.md`, `docs/github_release_and_architecture_report.md` | Docs stated `16×8 LSH`; `engine-rust/src/similarity.rs` implements `64 bands × 2 rows` (`NUM_BANDS = 64`, `ROWS_PER_BAND = 2`) with exact pairwise comparison for cohorts `≤ 60`. | Update all LSH references to `64×2 LSH (64 bands × 2 rows)` and document Weyl-seeded `mix64` FNV-1a hashing. | ✅ Resolved |
| **F4** | `egm-codebase-details` | 🔴 Blocker | `README.md`, `docs/architecture.md` | Docs stated `500-page ceiling`, `Letter (612×792 pt)`, and `{:010} {:05} n \r\n`; `engine-rust/src/pdf.rs` enforces `MAX_PDF_PAGES = 100`, `A4 (595.28×841.89 pt)`, and `{off:010} 00000 n \n`. | Align page ceiling (`100`), geometry (`A4`), and 20-byte `xref` format string (`{off:010} 00000 n \n`). | ✅ Resolved |
| **F5** | `egm-codebase-details` | 🔴 Blocker | `frontend/.gitignore` | `.env*` wildcard ignored `frontend/.env.example`. | Add `!.env.example` exception to `frontend/.gitignore` and root `.gitignore`. | ✅ Resolved |
| **F6** | `egm-codebase-details` & `egm-structural` | 🔴 Blocker | `auto_qa_tests/run_full_5layer_verification.mjs` | Line 1 hardcoded a machine-specific Windows path to `playwright`. | Replace with portable dynamic import resolving `playwright` from standard `node_modules` or `PLAYWRIGHT_MODULE_PATH`. | ✅ Resolved |
| **F7** | `egm-structural` | 🔴 Blocker | `README.md` | Hero block skipped `H1` → `H3` and placed raw Markdown inside `<div align="center">` without blank lines. | Use semantic HTML inside the top hero `<div>`, add blank lines around Markdown badges/links, and maintain strict `H1` → `H2` → `H3` hierarchy. | ✅ Resolved |
| **F8** | `egm-structural` & `egm-codebase-details` | 🟡 Major | `CONTRIBUTING.md` | Referenced legacy Python/FastAPI backend (`backend/` on port `8000`) and Next.js 15. | Rewrite `CONTRIBUTING.md` for Next.js 16 (`frontend/`) + Rust (`engine-rust/` on port `8088`). | ✅ Resolved |
| **F9** | `egm-codebase-details` | 🟡 Major | `migrations/000_full_schema.sql` & `docs/architecture.md` | Next.js routes query `profiles.class` and `drafts.last_saved_at` in addition to `student_class` and `updated_at`. | Add `class TEXT` to `profiles` and `last_saved_at TIMESTAMPTZ DEFAULT NOW()` to `drafts` in `000_full_schema.sql` and `docs/architecture.md`. | ✅ Resolved |
| **F10** | `egm-codebase-details` | 🟡 Major | `docs/github_release_and_architecture_report.md` | Listed `Rust 2021` and `node:22-alpine + rust:1.85-slim-bookworm`; actual `Cargo.toml` and `Dockerfile`s use `Rust 2024` and `node:20-alpine + rust:1.85-alpine`. | Align table with `Rust 2024` and `node:20-alpine + rust:1.85-alpine`. | ✅ Resolved |
| **F11** | `egm-codebase-details` | 🟡 Major | `README.md`, `docs/architecture.md`, `docs/security_and_compliance.md` | Clarify that `localAnalyzeSimilarity` resides in `frontend/lib/engine.ts` and server-side HTML sanitization uses `sanitize-html` with full network scheme abortion (`http:`, `https:`, `file:`, `ftp:`, `ws:`, `wss:`, `javascript:`). | Update file descriptions and `docs/security_and_compliance.md`. | ✅ Resolved |
| **F12** | `egm-structural` & `egm-style` | 🟡 Major | `README.md`, `docs/architecture.md`, `docs/clio_system_qa_documentation.md` | Literal `\n` in Mermaid labels, inline LaTeX `$...$` inside tables/bold spans, `AbortSignal.timeout`, and JSON `/metrics` terminology. | Replace `\n` with single-line or `<br/>` Mermaid labels, use clean Unicode (`64×2`, `≤ 200`, `→`), and use `AbortSignal.timeout` + `Atomic JSON Telemetry Metrics`. | ✅ Resolved |
| **F13** | `egm-structural` | 🟢 Nit | `assets/demo-screenshot.png` | Screenshot showed a dev overlay pill on `/login` rather than the clean TipTap studio. | Replace `assets/demo-screenshot.png` with clean editor verification capture `auto_qa_tests/artifacts/layer3_editor_typed.png`. | ✅ Resolved |
