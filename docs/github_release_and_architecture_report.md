# Clio: Working System Report, Architecture Requirements & GitHub Release Plan

**Prepared by:** EGM Autopilot & HumanScope Orchestrator  
**Repository Target:** `https://github.com/yashh1323/Clio`  
**Status:** Verified Production-Ready (Zero Credentials Committed)

---

## 1. Executive Working Report: The New Clio Architecture

Clio has been re-architected from a prototype web app into a **hardened, hybrid Next.js 16 + Pure Rust Academic Authorship & Telemetry Platform**. Instead of relying on unreliable post-hoc AI text detectors that penalize non-native English writers, Clio verifies **Proof of Write** through cryptographic session integrity, monotonic keystroke progression auditing, and parallel locality-sensitive hashing (LSH).

### 1.1 Architectural Components & Runtime Requirements

| Component | Path | Stack | Runtime Prerequisites | Port / Binding |
| :--- | :--- | :--- | :--- | :--- |
| **Web Studio & Edge API** | [`frontend/`](../frontend) | Next.js 16.0.10 (App Router), React 19, TipTap ProseMirror, Tailwind CSS v4 | Node.js `v22.x+`, npm `10+` | `http://localhost:3000` |
| **Compute Micro-Engine** | [`engine-rust/`](../engine-rust) | Rust 2024 (`Axum 0.8`, `Tokio 1.54`, `Rayon 1.12`, `Serde`) | Rust `1.85+` (`cargo`) | `http://127.0.0.1:8088` |
| **Strangler Fig Bridge** | [`frontend/lib/engine.ts`](../frontend/lib/engine.ts) | TypeScript HTTP Client with `AbortSignal.timeout` | Built into `frontend/` | Automatic fallback to local TS if `8088` is offline |
| **Relational Database** | [`migrations/`](../migrations) | Supabase PostgreSQL (`uuid-ossp`, `pgcrypto`, RLS Enabled) | Supabase Project URL + Anon & Service Role Keys | HTTPS (`*.supabase.co`) |
| **Container Stack** | [`docker-compose.yml`](../docker-compose.yml) | Multi-stage Docker builds (`node:20-alpine` + `rust:1.85-alpine`) | Docker Engine `24+` & Docker Compose `v2` | `3000` (Web), `8088` (Rust) |

### 1.2 What You Need to Run Clio (Environment Checklist)

To run Clio in any environment (local development, CI, or production), copy [`frontend/.env.example`](../frontend/.env.example) to `frontend/.env.local` and supply:

```env
# 1. Supabase Database Connection (Required)
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>

# 2. Session & Role Security (Required in Production)
AUTH_SECRET=<64-char-hex-hmac-secret>
TEACHER_INVITE_CODE=<institutional-faculty-invite-code>

# 3. Pure Rust Compute Engine (Optional - auto-falls back to TypeScript)
CLIO_ENGINE_URL=http://127.0.0.1:8088
CLIO_ENGINE_KEY=<shared-internal-engine-secret>
```

**Database Initialization:**
Apply [`migrations/000_full_schema.sql`](../migrations/000_full_schema.sql) once in the Supabase SQL Editor (or via Supabase CLI/MCP) to provision all 7 RLS-protected tables (`profiles`, `assignments`, `classes`, `class_enrollments`, `submissions`, `grades`, `drafts`) and 10 performance indexes.

---

## 2. End-to-End Verification & Security Audit Ledger

Every subsystem and user role has been verified across unit, integration, browser automation, and live multi-role database workflows:

### 2.1 Security Audit Remediation Summary (Phases 1–5)
- **Phase 1 (Critical Hotfixes)**:
  - Eliminated DOCX-to-PDF Server-Side Request Forgery (SSRF) via `sanitize-html` scrubbing, routing to the Rust in-process PDF engine first, unconditional network scheme abortion (`http:`, `https:`, `file:`, `ftp:`, `ws:`, `wss:`, `javascript:`) on fallback (blocking all external and RFC 1918 private networks), and a strict 25 MB upload ceiling ([`frontend/app/api/convert-docx-to-pdf/route.ts`](../frontend/app/api/convert-docx-to-pdf/route.ts)).
  - Patched Insecure Direct Object References (IDOR) on [`/api/grades`](../frontend/app/api/grades/route.ts) and [`/api/grades/batch`](../frontend/app/api/grades/batch/route.ts) by enforcing `submission.teacher_id` ownership checks before grade mutation.
  - Enforced fail-closed WebCrypto `HMAC-SHA256` verification in [`frontend/middleware.ts`](../frontend/middleware.ts) and separated `SUPABASE_SERVICE_ROLE_KEY` into server-only routes ([`frontend/lib/supabase.ts`](../frontend/lib/supabase.ts)).
- **Phase 2 (Core Integrity Hardening)**:
  - Replaced client-trusted integrity scores with authoritative server-side keystroke snapshot auditing ([`frontend/lib/telemetry.ts`](../frontend/lib/telemetry.ts)).
  - Added cryptographic `exp`, `iat`, and `jti` claims to session tokens ([`frontend/lib/auth.ts`](../frontend/lib/auth.ts)).
- **Phase 3 (Pure Rust Compute Engine)**:
  - Built [`engine-rust/`](../engine-rust) implementing zero-copy telemetry auditing ([`src/telemetry.rs`](../engine-rust/src/telemetry.rs)), Rayon parallel 128-permutation MinHash + 64×2 LSH similarity detection ([`src/similarity.rs`](../engine-rust/src/similarity.rs)), and an in-process ISO 32000-1 PDF 1.4 compiler ([`src/pdf.rs`](../engine-rust/src/pdf.rs)).
- **Phases 4 & 5 (Deep Hardening)**:
  - Enforced snapshot subsampling (`≤ 200` HTML snapshots, `≤ 50,000 chars` / `~50 KB` per snapshot) to prevent JSONB storage exhaustion.
  - Added constant-time `TEACHER_INVITE_CODE` validation (`crypto.timingSafeEqual`), constant-time dummy `bcrypt` hashing on unknown usernames, dual IP + account rate limiting, CSV formula injection neutralization ([`frontend/app/api/export/grades/route.ts`](../frontend/app/api/export/grades/route.ts)), and strict 20-byte ISO 32000-1 `xref` table offsets (`{off:010} 00000 n \n`).

### 2.2 Automated Test & Live Role Verification Matrix

| Test Suite | Command | Scope | Result |
| :--- | :--- | :--- | :--- |
| **Rust Engine Unit & Integration** | `cd engine-rust && cargo test` | 33 unit tests + 7 full HTTP pipeline integration tests (`cargo clippy -- -D warnings`: 0 warnings) | **40 / 40 Passed** |
| **Frontend Security & Engine Suites** | `cd frontend && npm test` | `test_phase1_security.mjs`, `test_phase2_security.mjs`, `test_phase3_engine.mjs`, `test_phase_fixes.mjs` | **38 / 38 Passed** |
| **5-Layer Auto-QA Playwright Suite** | `node auto_qa_tests/run_full_5layer_verification.mjs` | Edge guards, Auth funnels, TipTap editor + IndexedDB persistence, Teacher dashboard, Rust API | **23 / 23 Passed** |
| **Live Classroom E2E (Student & Teacher)** | `cd frontend && node test_live_classroom_e2e.mjs` | Teacher registration → Student registration → Assignment creation → Essay + 41 keystroke snapshots upload → Teacher dashboard fetch & grading (`96/100`) → Student grade verification | **7 / 7 Steps Passed** |
| **Live Admin Role E2E** | `cd frontend && node test_live_admin_e2e.mjs` | Admin provisioning → Institution-wide profile directory query → System-wide submissions & grades audit | **4 / 4 Steps Passed** |

---

## 3. GitHub Publication & Credential Hygiene Plan

To guarantee zero sensitive credentials or local artifacts are leaked to GitHub:

1. **Secret Scrubbing Audit**:
   - `frontend/.env.local` (containing live Supabase keys) is excluded via `.gitignore` and verified untracked by Git, while `frontend/.env.example` is explicitly un-ignored (`!.env.example`).
   - [`frontend/test_live_classroom_e2e.mjs`](../frontend/test_live_classroom_e2e.mjs) and [`frontend/test_live_admin_e2e.mjs`](../frontend/test_live_admin_e2e.mjs) load credentials exclusively from `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`.
   - [`migrations/000_full_schema.sql`](../migrations/000_full_schema.sql) uses generic `<YOUR_PROJECT_ID>` placeholders.
   - Legacy prototype folder `engine/` (containing compiled `.exe` and `.bak` binaries) has been removed.
   - A workspace-wide secret scan across all tracked and staged files returns **0 matches** prior to `git commit`.
2. **Git Remote Authentication Hygiene**:
   - The GitHub Personal Access Token is used transiently for push and metadata API calls and is **never** written to tracked files or left persisted in `.git/config`.

---

## 4. GitHub SEO & Viral Positioning Blueprint

### 4.1 HumanScope Narrative Structure Sheet (Mode A: Structure First)
*Scope Note: HumanScope (StoryScope, COLM 2026) was calibrated on narrative prose. For an open-source engineering README, Decisions 1, 5, 6, 7, 8, and 9 govern how the technical problem and architecture story are framed, while Decisions 2, 3, 4, and 10 govern engineering trade-offs. Per the HumanScope Budget Rule, we break the AI default on **4 axes** and keep the rest straightforward:*

| # | Decision Axis | Choice for Clio `README.md` | Rationale |
| :--- | :--- | :--- | :--- |
| **1** | **Timeline** | Linear progression (Problem → Architecture → Workflows → Quickstart) | Developers scanning a repository need predictable structural navigation. |
| **2** | **Subplots** | One parallel thread: Student protection from false AI accusations alongside Teacher grading | Highlights that authorship telemetry protects honest students just as much as it catches copy-paste abuse. |
| **3** | **Ending Cause** | Deterministic engineering verification (running the test suites) | Gives contributors immediate agency to verify every claim locally. |
| **4** | **Resolution Mode** | External action (`cargo test && npm test`) | Concrete CLI verification rather than vague vision statements. |
| **5** | **The Moral (DEVIATION 1)** | **Cut the closing summary paragraph** | AI READMEs almost always end with a sentimental summary ("Built to empower the future of education..."). We end cleanly on contributing & license links. |
| **6** | **How Emotion/Friction Arrives** | Plain engineering statement | State the false-positive pain of AI text detectors directly without melodrama. |
| **7** | **How the Lead Enters (DEVIATION 2)** | **Open mid-action on a concrete telemetry trace** | Instead of "Clio is a modern platform...", open on what a 1,400-word paste in `180ms` looks like vs. 41 monotonic ProseMirror snapshots at `65 WPM`. |
| **8** | **References (DEVIATION 3)** | **Named standards & algorithms** | Replace vague buzzwords ("blazingly fast AI") with exact primitives: `ISO 32000-1` 20-byte `xref` tables, 128-perm `MinHash` + `64×2 LSH` on `Rayon`, `WebCrypto` `HMAC-SHA256`, `TipTap ProseMirror`. |
| **9** | **Reader Address** | Direct second-person ("Run `cargo test`", "Kill the Rust process mid-request and watch the fallback") | Invites the engineer reading the repo to test the resilience boundary themselves. |
| **10** | **Moral/System Ambivalence (DEVIATION 4)** | **Explicitly state what Clio refuses to do & its trade-offs** | Acknowledge that Clio refuses webcam surveillance and probabilistic LLM "AI detectors", and document exact fallback behavior when the Rust engine is offline. |

### 4.2 GitHub Search Engine Optimization (SEO) Metadata
- **Repository Description (158 chars)**:
  `Proof-of-Write academic authorship platform. Next.js 16 + Pure Rust (Axum/Rayon) keystroke telemetry auditor, MinHash LSH similarity engine & Session Replay.`
- **20 High-Intent GitHub Topics**:
  `rust`, `nextjs`, `academic-integrity`, `edtech`, `axum`, `tiptap`, `prosemirror`, `supabase`, `minhash`, `lsh`, `plagiarism-detection`, `keystroke-dynamics`, `session-replay`, `typescript`, `tailwindcss`, `postgresql`, `rayon`, `webcrypto`, `proof-of-write`, `open-source-education`
- **Primary Search Keywords Embedded in H1/H2/First-Paragraph**:
  - *Proof of Write*, *Academic Integrity Platform*, *Keystroke Telemetry & Session Replay*, *MinHash LSH Plagiarism Detection in Rust*, *Next.js 16 + Axum Microservice Architecture*, *TipTap Rich Text Editor with Cloud & IndexedDB Autosave*.
