# Contributing to Clio

Thank you for contributing to **Clio**! Whether you are fixing a bug in the Next.js 16 frontend, optimizing parallel algorithms in the Pure Rust compute engine (`engine-rust/`), or adding security regression tests, your work helps protect both honest students and instructors.

## Table of Contents
1. [Code of Conduct](#code-of-conduct)
2. [How You Can Help](#how-you-can-help)
3. [Local Development Setup](#local-development-setup)
4. [Verification & Test Suites](#verification--test-suites)
5. [Code Style & Standards](#code-style--standards)

---

## Code of Conduct
This project and everyone participating in it is governed by the [Clio Code of Conduct](CODE_OF_CONDUCT.md). For security-sensitive findings, please follow [SECURITY.md](SECURITY.md).

## How You Can Help

### Reporting Bugs & Suggesting Enhancements
- Open a GitHub Issue with reproduction steps, environment details (`node -v`, `rustc --version`), and relevant logs.
- For UI or TipTap editor issues, attach a screenshot or session replay snippet if applicable.

### Pull Requests
1. Fork the repository and create your branch from `main`.
2. Add or update unit/integration tests covering your change (`engine-rust/tests/` or `frontend/test_*.mjs`).
3. Update documentation in `docs/` if you modify API contracts, environment variables, or database columns.
4. Confirm both `cargo test` and `npm test` pass with zero warnings before submitting your PR.

---

## Local Development Setup

### Option 1: Docker Compose (Recommended for Full Stack)
Run both the Next.js 16 Web Studio (`:3000`) and the Rust Compute Microservice (`:8088`):
```bash
docker compose up --build
```
- **Web Studio & API**: `http://localhost:3000`
- **Rust Compute Engine**: `http://127.0.0.1:8088` (`/health`, `/metrics`, `/api/v1/*`)

### Option 2: Native Local Development
#### 1. Configure Environment Variables
Copy `frontend/.env.example` to `frontend/.env.local` and supply your Supabase project credentials:
```bash
cd frontend
cp .env.example .env.local
```
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
AUTH_SECRET=replace_with_64_char_cryptographic_random_hex_secret
TEACHER_INVITE_CODE=replace_with_institutional_faculty_invite_code
CLIO_ENGINE_URL=http://127.0.0.1:8088
CLIO_ENGINE_KEY=replace_with_shared_hmac_engine_key
```

#### 2. Start the Rust Compute Engine (`engine-rust/`)
```bash
cd engine-rust
cargo run --release
```

#### 3. Start the Next.js 16 Frontend (`frontend/`)
```bash
cd frontend
npm install
npm run dev
```
*(On Windows, you can also run `start-clio.bat` from the repository root to launch both services together.)*

---

## Verification & Test Suites

Before opening a pull request, run the verification suites:
```bash
# Rust Engine unit, integration, and Clippy lint checks (40 tests)
cd engine-rust
cargo test
cargo clippy --all-targets -- -D warnings

# Frontend security, telemetry, and Strangler Fig integration suites (38 assertions)
cd ../frontend
npm test
```

---

## Code Style & Standards
- **Frontend (`frontend/`)**: TypeScript + Next.js 16 App Router. Run `npm run lint` and `npm test` before committing.
- **Rust Engine (`engine-rust/`)**: Idiomatic Rust (2024 edition). Format with `cargo fmt` and verify zero warnings with `cargo clippy --all-targets -- -D warnings`.
- **Commits**: Follow Conventional Commits format (e.g., `feat(engine): add LSH candidate bucket pruning`, `fix(auth): enforce constant-time invite check`).
- **Co-Authorship & Pairing**: For collaborative contributions or pair-programming sessions, attribute co-authors using standard Git trailers (`Co-authored-by: Collaborator <email@domain.com>`).
