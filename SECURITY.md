# Security Policy

## Supported Versions

| Component | Version | Supported |
| :--- | :--- | :--- |
| **Clio Web Studio (`frontend/`)** | `0.1.x` (Next.js 16) | ✅ Yes |
| **Clio Rust Compute Engine (`engine-rust/`)** | `1.0.x` (Rust 2024 / Axum 0.8) | ✅ Yes |
| **Database Schema (`migrations/`)** | `000_full_schema` + `002_lockdown_rls` | ✅ Yes |

---

## Security Architecture Summary

Clio enforces defense-in-depth controls across all execution tiers:
1. **Edge Authentication & RBAC (`frontend/middleware.ts`)**: Fail-closed WebCrypto `HMAC-SHA256` signature and `exp`/`iat`/`jti` claim verification prior to route execution.
2. **Timing-Safe Credential & Invite Verification**: Constant-time dummy `bcrypt` hashing on nonexistent usernames (`/api/auth/login`) and `crypto.timingSafeEqual` verification on `TEACHER_INVITE_CODE` (`/api/auth/register`).
3. **SSRF & XSS Isolation**: Server-side HTML scrubbing via `sanitize-html`, client-side sanitization via `DOMPurify`, in-process ISO 32000-1 PDF 1.4 generation in `engine-rust/src/pdf.rs`, and full network scheme abortion (`http:`, `https:`, `file:`, `ftp:`, `ws:`, `wss:`, `javascript:`) during legacy `.docx` conversion.
4. **PostgreSQL Row Level Security (RLS)**: All 7 database tables enforce RLS with anonymous table privileges revoked (`migrations/002_lockdown_rls_all_tables.sql`).

For detailed compliance and FERPA/GDPR architecture notes, see [`docs/security_and_compliance.md`](docs/security_and_compliance.md).

---

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for suspected security vulnerabilities. Instead:
1. Use GitHub's **Private Vulnerability Reporting** tab on this repository, or contact the repository maintainer directly.
2. Include steps to reproduce, affected endpoints or source files, and potential impact.
3. You will receive an acknowledgment within 48 hours and a remediation timeline once triaged.
