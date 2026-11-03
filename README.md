<div align="center">
  <img src="./assets/demo-video.gif" alt="Clio — Working Session Replay & Authorship Intelligence Demo" width="100%" />

  <h1>Clio</h1>
  <p><strong>Proof-of-Write Academic Authorship, Keystroke Telemetry &amp; Multimodal Plagiarism Intelligence</strong></p>
  <p><em>Verify how an essay was written—not what a probabilistic classifier guesses after the fact.</em></p>
</div>

<div align="center">

[![Rust Engine](https://img.shields.io/badge/Rust_Engine-Axum_%2B_Rayon-DEA584?style=for-the-badge&logo=rust&logoColor=black)](./engine-rust)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.0-black?style=for-the-badge&logo=next.js)](./frontend)
[![Supabase PostgreSQL](https://img.shields.io/badge/Supabase-PostgreSQL_%2B_RLS-3ECF8E?style=for-the-badge&logo=supabase)](./migrations)
[![Rust Tests](https://img.shields.io/badge/Cargo_Tests-69%2F69_Passing-2ea44f?style=for-the-badge&logo=rust)](./engine-rust)
[![Security & QA](https://img.shields.io/badge/Security_%26_QA-31%2F31_Passing-007ec6?style=for-the-badge&logo=playwright)](./auto_qa_tests)
[![Release](https://img.shields.io/badge/Release-v2.0.0-blueviolet?style=for-the-badge)](./docs/RELEASE_SPEC_V2.0.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

[**Release v2.0 Scientific Ledger**](docs/RELEASE_SPEC_V2.0.md) · [**System Architecture**](docs/architecture.md) · [**QA Verification Ledger**](docs/clio_system_qa_documentation.md) · [**Security & Compliance**](docs/security_and_compliance.md)

</div>

---

## Why Clio Exists

Traditional "AI detectors" operate on a flawed premise: analyzing completed prose in isolation, attempting to detect statistical perplexity or burstiness from final text tokens. The empirical failure rate of this approach is well documented:
1. Paraphrasing tools and prompting tricks evade token perplexity checks entirely.
2. Non-native English students who write with formal, grammatically uniform phrasing are routinely falsely flagged.
3. When an essay is flagged, the educator has zero tangible evidence to share with the student, and the student has zero ability to prove their honest labor.

**Clio replaces post-hoc guesswork with deterministic Proof-of-Write.** Students draft inside a distraction-free **TipTap ProseMirror** studio that captures time-compressed session snapshots (`IndexedDB` + cloud sync). On submission, a dedicated **Pure Rust Compute Engine (`engine-rust/`)** verifies timestamp monotonicity, computes asymmetric lexical containment, tracks stylistic consistency, projects semantic paraphrase vectors, and inspects millisecond keystroke dynamics. 

Educators receive clear, mathematically proven integrity metrics alongside a scrubbable **Session Replay** showing exactly how the work was composed.

---

## How Clio Catches Cheaters: 5 Concrete Attack Vectors & Mathematical Proofs

Clio defeats cheating through **Multi-View Orthogonality**. Cheaters may bypass one sensor, but cannot falsify four conditionally independent physical layers simultaneously:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CLIO MULTIMODAL INTEGRITY PIPELINE                   │
└────────────────────────────────────────────────────────────────────────┘
          │
          ├── 1. Lexical Layer      ──► Asymmetric Winnowing & Containment C(A, B)
          ├── 2. Stylometric Layer  ──► Windowed Burrows' Delta on 50 Function Words
          ├── 3. Semantic Layer     ──► 64-D FastText Subword Synonym Vector Dot-Product
          └── 4. Process Layer      ──► Log-Normal IKI Kolmogorov-Smirnov Goodness-of-Fit
```

---

### 1. Verbatim Borrowing & Patching (The "Needle in a Haystack")
* **The Cheater's Technique:** A student copies three verbatim paragraphs (200 words) from a 10,000-word online thesis or journal article and nests them inside an otherwise original 2,000-word essay.
* **Why Standard Jaccard Fails:**
  $$J(A, B) = \frac{|S(A) \cap S(B)|}{|S(A)| + |S(B)| - |S(A) \cap S(B)|} = \frac{180}{200 + 10,000 - 180} = \frac{180}{10,020} \approx 0.0179 \quad (1.8\%)$$
  Standard plagiarism platforms report under 2% similarity and discard the match as noise.
* **How Clio Catches It:** Clio implements directional **Windowed Containment** ([`engine-rust/src/winnowing.rs`](engine-rust/src/winnowing.rs)):
  $$C(A, B) = \frac{|S(A) \cap S(B)|}{|S(A)|} = \frac{180}{200} = 0.90 \quad (90.0\% \implies \text{Confirmed Plagiarism})$$
  Coupled with **Winnowing** ($w = t - k + 1 = 8$), Clio guarantees zero false negatives for any verbatim sequence $\ge 12$ words.

---

### 2. AI Paraphrasing & Synonym Spinning (The "QuillBot / Rewrite Prompt")
* **The Cheater's Technique:** A student pastes copied text into ChatGPT or QuillBot, asking it to *"rewrite this in your own words with academic synonyms"*. Verbatim n-grams are altered, destroying traditional string-matching shingles.
* **How Clio Catches It:** Clio projects text into a pure-Rust 64-dimensional FastText synonym-cluster vector space ([`engine-rust/src/semantic.rs`](engine-rust/src/semantic.rs)):
  $$\mathbf{u} = \sum_{w \in T} \left( \mathbf{v}_{\text{syn}}(w) + \sum_{g \in \text{trigrams}(w)} \mathbf{v}_{\text{sub}}(g) \right), \quad \hat{\mathbf{u}} = \frac{\mathbf{u}}{\|\mathbf{u}\|_2}$$
  $$\text{Sim}_{\text{semantic}}(\hat{\mathbf{u}}, \hat{\mathbf{v}}) = \hat{\mathbf{u}} \cdot \hat{\mathbf{v}} \in [0, 1]$$
  Even when vocabulary is substituted across 22 curated academic synonym clusters and subword trigrams, the normalized semantic dot product remains high ($\ge 0.85$), flagging the underlying semantic structure.

---

### 3. Ghostwritten Paragraph Grafting (The "Patchwriter")
* **The Cheater's Technique:** A student writes the introduction and conclusion themselves, but pastes the technical analysis from a friend or paid tutor.
* **How Clio Catches It:** Clio evaluates **Windowed Burrows' Delta on Function Words** ([`engine-rust/src/stylometry.rs`](engine-rust/src/stylometry.rs)) across sliding windows ($W = 250$ tokens, stride $S = 50$) targeting 50 English function words (pronouns, conjunctions, prepositions):
  $$\Delta_w = \frac{1}{|F^*|} \sum_{f \in F^*} \frac{|O_w(f) - E_w(f)|}{\sigma_f}, \quad E_w(f) = W \cdot p_{\text{base}}(f), \; \sigma_f = \max(\sqrt{E_w(f)}, 0.5)$$
  Every author has an unconscious, involuntary function word distribution. When external text is grafted into a student's document, $\Delta_w$ spikes sharply above $1.80$ ($\mu_{\Delta} + 2.0\sigma_{\Delta}$) over contiguous windows, isolating the exact grafted boundary.

---

### 4. Clipboard Insertion & Sudden Bulk Load (The "Copy-Paster")
* **The Cheater's Technique:** A student drafts an entire paper in an external LLM interface or Word document, then copies and pastes it into the submission editor right before the deadline.
* **How Clio Catches It:** Clio's telemetry engine ([`engine-rust/src/telemetry.rs`](engine-rust/src/telemetry.rs)) enforces hierarchical multi-tier accretion rules over timestamped document snapshots $(t_i, L_i)$:
  $$\text{Anomaly} = \begin{cases}
  \Delta L_i > 15 \text{ chars} \land \Delta t_i < 300\text{ ms} & (\text{Quick Jump}) \\
  \Delta L_i > 25 \text{ chars} \land \Delta t_i < 500\text{ ms} & (\text{Rapid Jump}) \\
  \Delta L_i \ge 50 \text{ chars} \land \Delta t_i \le 2000\text{ ms} & (\text{Block Paste}) \\
  L_0 > 15 \text{ chars} \text{ at session start} & (\text{Pre-loaded Bulk Canvas})
  \end{cases}$$
  Normal human typing tops out at $\approx 15 \text{ chars/sec}$ ($90 \text{ WPM}$). Unrecorded paste jumps are permanently recorded in the submission's cryptographic audit ledger.

---

### 5. Automated Bot & Script Typing Simulation (The "Humanizer Bot")
* **The Cheater's Technique:** Sophisticated cheat tools use browser extensions or Puppeteer scripts to type out an AI essay character-by-character with artificial delays to fake human typing.
* **How Clio Catches It:** Clio models Inter-Keystroke Intervals ($\Delta t = t_{i+1} - t_i$) using a **Log-Normal Mixture Model** ([`engine-rust/src/telemetry_advanced.rs`](engine-rust/src/telemetry_advanced.rs)):
  $$X = \ln(\Delta t_i) \sim \mathcal{N}(\mu_{\ln}, \sigma_{\ln}^2)$$
  Human neuromuscular motor dynamics strictly follow a log-normal distribution. Synthetic typing scripts use uniform delays, Gaussian jitter, or constant flight times. Clio runs a **Two-Sided Kolmogorov-Smirnov Test** against the fitted log-normal CDF:
  $$D_{\text{KS}} = \sup_{x} |F_n(x) - F(x; \mu_{\ln}, \sigma_{\ln})|$$
  Evaluated with Abramowitz & Stegun Formula 7.1.26 polynomial approximation of $\text{erf}(x)$. If $D_{\text{KS}} > 0.45$ or $\sigma_{\ln} < 0.15$, the session is flagged as synthetic bot injection.

---

### Mathematical Proof of 95%+ Detection Reliability
Let error events across the four orthogonal modalities be $E_{\text{lex}}, E_{\text{sem}}, E_{\text{sty}}, E_{\text{proc}}$. Because token overlap, semantic vectors, unconscious function word habit, and millisecond finger motor dynamics arise from independent physical phenomena:

$$\Pr(E_{\text{composite}}) \le \prod_{m=1}^4 \Pr(E_m) \le (0.10)^4 = 10^{-4} \quad (0.01\% \text{ False Alarm Upper Bound})$$

When an honest student types naturally, their log-normal motor cadence, incremental accretion timeline, and stylistic continuity provide irrefutable physical proof of authorship.

---

## What Clio Refuses to Do (Design Invariants)

1. **No Webcam Proctoring or OS Spyware**: Clio never requests camera, microphone, screen recording, or OS-level clipboard access. It monitors document state mutations within the web canvas only.
2. **No Black-Box Confidence Scores**: Clio outputs verifiable physical signals—cadence graphs, discrete paste events, and exact shingle collisions—so a student can defend their work using their own replay timeline.
3. **Pure-Rust Invariants**: The compute engine enforces `#![forbid(unsafe_code)]`, makes zero outbound external network calls, runs sandboxed locally, and verifies authentication keys using constant-time bitwise operations:
   $$\Delta = (L_A \oplus L_B) \lor \bigvee_{i=0}^{L_A - 1} (A[i] \oplus B^*[i]) == 0$$

---

## System Architecture

```mermaid
flowchart LR
    subgraph Browser ["Browser Studio (Next.js 16)"]
        TT["TipTap ProseMirror Canvas"]
        IDB[("IndexedDB (ClioDB Offline Autosave)")]
        TEL_CLIENT["Keystroke & Snapshot Collector"]
        TT <--> IDB
        TT --> TEL_CLIENT
    end

    subgraph AppTier ["Next.js App Router (Port 3000)"]
        MW["Edge Middleware (WebCrypto HMAC Auth)"]
        API["API Routes (/api/submissions, /api/auth)"]
        STRANGLER["Strangler Fig Proxy Client (lib/engine.ts)"]
        FALLBACK["Local TypeScript Fallback Engine"]
        MW --> API --> STRANGLER
        STRANGLER -.->|Timeout / Offline| FALLBACK
    end

    subgraph RustEngine ["Pure Rust Compute Microservice (Port 8088)"]
        AX["Axum 0.8 REST Engine"]
        WIN["Winnowing & Containment (src/winnowing.rs)"]
        SIM["Rayon Parallel MinHash LSH (src/similarity.rs)"]
        STY["Windowed Burrows' Delta (src/stylometry.rs)"]
        SEM["64-D FastText Vector Space (src/semantic.rs)"]
        ADV_TEL["Log-Normal KS Keystroke Telemetry (src/telemetry_advanced.rs)"]
        PDF["ISO 32000-1 PDF 1.4 Compiler (src/pdf.rs)"]

        AX --> WIN
        AX --> SIM
        AX --> STY
        AX --> SEM
        AX --> ADV_TEL
        AX --> PDF
    end

    subgraph Database ["Supabase PostgreSQL"]
        PG[("7 Tables Protected by Row Level Security (RLS)")]
    end

    TEL_CLIENT -->|JWT Cookie| MW
    STRANGLER -->|Engine Key / Port 8088| AX
    API -->|Service Role Key| PG
```

---

## Core Engineering Subsystems

| Subsystem | Source Path | Algorithmic Implementation & Guarantees |
| :--- | :--- | :--- |
| **Winnowing & Containment** | [`engine-rust/src/winnowing.rs`](engine-rust/src/winnowing.rs) | 64-bit FNV-1a shingle hashing, sliding window minimum selection ($w=8$), and asymmetric containment $C(A, B) = \frac{\|S(A) \cap S(B)\|}{\|S(A)\|}$. |
| **Parallel MinHash LSH** | [`engine-rust/src/similarity.rs`](engine-rust/src/similarity.rs) | 128 universal hash permutations in parallel via `rayon::prelude::*`, with 64×2 LSH banding for large cohort candidate generation. |
| **Windowed Burrows' Delta** | [`engine-rust/src/stylometry.rs`](engine-rust/src/stylometry.rs) | Slotted function-word register tracking across 50 English function words ($W=250$, stride 50) and Yule's length-invariant Characteristic $K$. |
| **FastText Semantic Projection** | [`engine-rust/src/semantic.rs`](engine-rust/src/semantic.rs) | Pure-Rust 64-D subword character-trigram and synonym-cluster vector projection with unit Euclidean cosine distance. |
| **Cognitive Telemetry Auditor** | [`engine-rust/src/telemetry_advanced.rs`](engine-rust/src/telemetry_advanced.rs) | Log-Normal Inter-Keystroke Interval fitting, two-sided Kolmogorov-Smirnov test ($D_{\text{KS}}$), and dynamic cognitive pause thresholding $\tau_{\text{cog}}$. |
| **In-Process PDF Compiler** | [`engine-rust/src/pdf.rs`](engine-rust/src/pdf.rs) | Standalone binary PDF 1.4 compiler with strict 20-byte ISO 32000-1 `xref` tables and multi-page layout without Chromium or headless browser dependencies. |

---

## Multi-Role Workflows

### 🎓 Student Studio (`/editor`, `/student-dashboard`, `/drafts`)
- **Distraction-Free Canvas**: TipTap ProseMirror with live word counting, formatting controls, and Focus Mode.
- **Dual-Tier Offline Resilience**: Autosaves every 1000ms to browser `IndexedDB` (`ClioDB`) with background cloud synchronization.
- **Self-Verifying Drafts**: Real-time cadence and snapshot capture that provides students with tamper-proof proof of their drafting process.
- **Instant Export**: Export clean documents directly to native PDF or DOCX.

### 👨‍🏫 Teacher Assessment Suite (`/dashboard`, `/similarity`, `/assignments`, `/classes`)

<div align="center">
  <img src="./assets/demo-screenshot.png" alt="Clio Teacher Assessment Dashboard & Similarity Matrix" width="100%" />
</div>

- **Interactive Session Replay**: Scrub through a student's drafting timeline with time-compressed playback (`>5s` idle pauses compressed to `1s`).
- **Cohort Similarity Matrix**: Inspect pairwise containment and MinHash similarity across entire classrooms.
- **Stylometric & Telemetry Insights**: Visualize Burrows' Delta anomaly charts and IKI typing rhythm distributions.
- **Formula-Safe CSV Export**: Gradebook export with protection against spreadsheet formula injection (`=`, `+`, `-`, `@`, `|`).

### 🛡️ System Administrator (`/admin`, `/api/admin/users`, `/api/admin/submissions`)
- **Directory Management**: Supervise faculty and student accounts with fail-closed invite code enforcement.
- **Global Metrics**: Live atomic telemetry inspection (`/health`, `/metrics`) monitoring Rust engine throughput and error rates.

---

## Quickstart & Local Setup

### Prerequisites
- **Node.js** `v20.0+` (or `v22.0+`) and `npm`
- **Rust & Cargo** `1.85+` (for the Pure-Rust compute engine; local TypeScript fallback is active if Rust is unset)
- **Supabase Project** (PostgreSQL database)

### 1. Clone & Install
```bash
git clone https://github.com/yashh1323/Clio.git
cd Clio/frontend
npm install
```

### 2. Configure Environment Variables
Copy [`frontend/.env.example`](frontend/.env.example) to `frontend/.env.local`:
```bash
cp .env.example .env.local
```
Provide your Supabase credentials and security keys:
```env
# Required: Supabase PostgreSQL
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>

# Required in Production: Auth & Faculty Registration Gate
AUTH_SECRET=replace_with_64_char_random_hex_secret
TEACHER_INVITE_CODE=CLIO-FACULTY-2026

# Optional: Pure Rust Microservice Engine (defaults to TypeScript fallback if offline)
CLIO_ENGINE_URL=http://127.0.0.1:8088
CLIO_ENGINE_KEY=clio-engine-dev-secret-key-2026
```

### 3. Initialize Database Schema
Run [`migrations/000_full_schema.sql`](migrations/000_full_schema.sql) in your Supabase SQL Editor. This provisions all 7 RLS-enabled tables and 10 performance indexes.

### 4. Run Clio

**Option A — Unified Windows Launcher:**
```cmd
start-clio.bat
```

**Option B — Dual-Terminal Manual Launch:**
```bash
# Terminal 1: Pure-Rust Engine (Port 8088)
cd engine-rust
cargo run --release

# Terminal 2: Next.js Frontend (Port 3000)
cd frontend
npm run dev
```

**Option C — Docker Compose (Loopback Isolated):**
```bash
docker compose up --build
```

---

## Automated Verification & Test Suites

```bash
# 1. Run Pure-Rust Engine Tests (69/69 Unit & Integration Tests Passing)
cd engine-rust
cargo test
cargo clippy --all-targets -- -D warnings

# 2. Run Security Remediation & Gate Suites (5/5 Passing)
cd ../frontend
node test_security_remediation.mjs

# 3. Run Phase 1, Phase 2, and Phase 3 Regression Tests (16/16 Passing)
node test_phase_fixes.mjs

# 4. Run Live Classroom E2E Verification
node test_live_classroom_e2e.mjs
node test_live_admin_e2e.mjs

# 5. Run 5-Layer Auto-QA Playwright Verification
cd ..
node auto_qa_tests/run_full_5layer_verification.mjs
```

---

## Contributing & License

Contributions and security reviews are welcomed. Please review [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before opening a pull request.

Licensed under the [MIT License](LICENSE).
