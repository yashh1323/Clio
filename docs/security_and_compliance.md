# Security, Privacy, and Compliance

Clio is an academic authorship and telemetry platform. Handling student coursework, grades, and drafting telemetry requires rigorous security, data minimization, and privacy compliance suitable for institutional adoption (FERPA and GDPR).

---

## 1. Ethical Telemetry: The "Proof of Write" Promise

Clio captures drafting progression signals to verify authorship while drawing a strict boundary against invasive surveillance.

### What Clio Captures
*   **Paste Events**: Frequency and character volume of rapid text bursts (`>15 chars` in `<300ms` or `>=50 chars` in `<=2000ms`).
*   **Active Words Per Minute (WPM)**: Typing speed calculated across active drafting intervals (with idle pauses `>5000ms` compressed to `1000ms`).
*   **Subsampled Document Snapshots**: Periodic states of the document (`≤ 200` HTML snapshots at `≤ 50,000` characters each) to construct a verifiable session replay timeline.

### What Clio Never Captures
*   **No Raw Keylogger Spyware**: Clio does not record OS-level keycodes or input outside the TipTap ProseMirror editor canvas.
*   **No Peripheral Surveillance**: Clio never requests webcam, microphone, or screen-recording permissions.
*   **No Cross-Site Fingerprinting**: Clio does not track students across external websites or inspect other browser tabs.

---

## 2. Threat Modeling & Server Security

### Cross-Site Scripting (XSS) & SSRF Prevention
*   **Client-Side Sanitization**: TipTap ProseMirror enforces structured document schemas, and rendered HTML previews are sanitized via `DOMPurify`.
*   **Server-Side Sanitization**: Submitted essay HTML and converted `.docx` documents are scrubbed on the server using `sanitize-html` (`frontend/app/api/submissions/route.ts` and `frontend/app/api/convert-docx-to-pdf/route.ts`), stripping `<script>`, `<iframe>`, `<object>`, inline event handlers (`onerror`, `onload`), and external CSS `url()` references.
*   **Zero-Network PDF Rendering**: Standard PDF exports run in-process via the memory-safe Rust ISO 32000-1 PDF 1.4 compiler (`engine-rust/src/pdf.rs`). Legacy `.docx` conversions that fall back to headless rendering abort all `http:`, `https:`, `file:`, `ftp:`, `ws:`, `wss:`, and `javascript:` requests unconditionally, blocking both external hosts and RFC 1918 private networks.

### Insecure Direct Object Reference (IDOR) Mitigation
*   Every API route validates the caller's role and identity from the cryptographically signed `clio_session` cookie.
*   Grading endpoints (`/api/grades` and `/api/grades/batch`) verify that `submission.teacher_id` matches the authenticated instructor before recording scores.
*   Gradebook CSV exports (`/api/export/grades`) neutralize spreadsheet formula injection payloads (`=`, `+`, `-`, `@`, `|`, `\t`, `\r`).

### Cryptography & Authentication Hardening
*   Passwords are hashed using `bcryptjs` at registration; plaintext passwords are never persisted.
*   Login endpoints execute constant-time dummy `bcrypt` comparisons on unknown usernames to prevent timing-based account enumeration.
*   Faculty registration (`/api/auth/register`) enforces `crypto.timingSafeEqual` verification of `TEACHER_INVITE_CODE`.
*   Session tokens (`clio_session`) are signed with `HMAC-SHA256` and enforce `exp`, `iat`, and `jti` claims at the Edge via WebCrypto (`frontend/middleware.ts`).

---

## 3. Compliance Readiness (FERPA & GDPR)

*   **Data Portability & Right to Erasure**: PostgreSQL foreign keys are configured with `ON DELETE CASCADE` (`migrations/000_full_schema.sql`). Deleting a student profile automatically purges all linked drafts, submissions, telemetry snapshots, class enrollments, and grades.
*   **Row Level Security (RLS)**: All seven public tables (`profiles`, `assignments`, `classes`, `class_enrollments`, `submissions`, `grades`, `drafts`) have PostgreSQL RLS enabled with anonymous direct table privileges revoked (`migrations/002_lockdown_rls_all_tables.sql`).
*   **Encryption in Transit & at Rest**: All client-server and server-database traffic runs over TLS 1.2+/1.3, with AES-256 volume encryption at rest managed by Supabase PostgreSQL.

---

*For vulnerability reporting guidelines, see [`SECURITY.md`](../SECURITY.md).*
