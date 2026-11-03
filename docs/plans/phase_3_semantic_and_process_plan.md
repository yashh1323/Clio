# Implementation Plan: Phase 3 — Semantic Paraphrase Detection & Cognitive Process Telemetry

## 1. Executive Summary & Objective

Phase 3 implements **Pillars 2 and 4** of the Clio Plagiarism and Authorship Research Specification, incorporating all resolutions from the Goldfish Review Swarm (`egm-implementation-readiness` & `egm-codebase-details`):
1. **Pillar 2: Semantic & Paraphrase Detection (`engine-rust/src/semantic.rs`)**
   - **The Synonym-Substitution Trap Resolution:** Paraphrasing replaces words with synonyms, destroying 100% of exact $n$-grams. Clio embeds a static synonym cluster dictionary + deterministic 32-bit FNV-1a character 3-gram subword feature hashing in $\mathbb{R}^{64}$.
   - **Guaranteed Positive Semi-Definite (PSD) Centroid Projection:** Document centroid $\hat{\mathbf{c}}_D = \frac{\sum \text{IDF}(w)\mathbf{v}_w}{\|\sum \text{IDF}(w)\mathbf{v}_w\|}$ is mathematically equivalent to the Gram matrix $V V^T \succeq 0$, guaranteeing outputs $\in [-1.0, 1.0]$ with zero negative quadratic form and zero `NaN` risk. Stop words from `crate::stylometry::FUNCTION_WORDS` are attenuated by factor $0.25$.
   - **Sentence-Level Maximum Bipartite Alignment:** Sentences are partitioned with empty document guards. Directed coverages $\operatorname{SemCov}(A \to B)$ and $\operatorname{SemCov}(B \to A)$ use thresholded alignment mass ($\theta = 0.75$), computing Harmonic Semantic Score $F_{\text{semantic}}$. Aligned pairs are produced via 1-to-1 greedy matching.
   - **Decoupled Pipeline:** Paraphrase analysis is triggered independently of exact shingle containment.
2. **Pillar 4: Cognitive Process Telemetry (`engine-rust/src/telemetry_advanced.rs`)**
   - **Fast-Interval Bot Evasion Shield:** If rapid intervals ($\Delta t_k < 20\text{ ms}$) exceed 10 or constitute $> 10\%$ of transitions, immediately flag `"Automated high-frequency macro injection (<20ms intervals)"`.
   - **Two-Component Log-Normal IKI Modeling:** Filtered intervals $\Delta t_k \in [20\text{ ms}, 10,000\text{ ms}]$ are log-transformed ($X_k = \ln \Delta t_k$). Evaluates motor execution vs. cognitive pauses ($> 300\text{ ms}$). If $N \ge 30$ and cognitive pauses $\pi_{\text{cog}} < 0.05$, flag `"Sight-reading transcription detected (cognitive pauses suppressed)"`.
   - **Automated Macro Injection & Kolmogorov-Smirnov Test:** If variance $\sigma < 0.15$ with $N \ge 20$, flag `"Automated macro injection detected (robotic uniform interval variance)"`. Computes two-sided KS distance $D = \max_{k=1..N} \max\left( \left|\frac{k}{N} - \Phi(z_k)\right|, \left|\Phi(z_k) - \frac{k-1}{N}\right| \right)$ against fitted log-normal CDF using Abramowitz & Stegun 7.1.26 polynomial approximation for $\operatorname{erf}(z)$ in pure Rust and TypeScript. If $D > 0.35$, flag `"Automated macro injection detected (non-log-normal interval distribution)"`.
   - **Two-Pass P-Burst and R-Burst Accumulators:** Pass 1 computes $\mu, \sigma$ and typist-tailored threshold $\tau_{\text{cog}} = \exp(\mu + 2\sigma)$. Pass 2 computes P-bursts (character insertions uninterrupted by pause $\ge \tau_{\text{cog}}$) and R-bursts (character insertions uninterrupted by revision). Zero burst counts are safely guarded.
   - **Composite Confidence Score:**
     $$\text{confidence} = \max\left(0.0, 100.0 - 40 \cdot \mathbb{I}_{\pi_{\text{cog}} < 0.05} - 40 \cdot \mathbb{I}_{\sigma < 0.15} - 30 \cdot \mathbb{I}_{D > 0.35} - 20 \cdot \mathbb{I}_{R_{\text{rev}} < 0.02}\right)$$
     `is_authentic = confidence >= 70.0 && flags.is_empty()`.
3. **Plumbing & Cross-Language Parity**
   - Endpoints in `engine-rust/src/api.rs`: `POST /api/v1/semantic/analyze` (1MB limit) and `POST /api/v1/telemetry/process` (2MB limit / 50k events max) with `camelCase` Serde annotations, `spawn_blocking`, and route validation.
   - `AppState` atomic counters: `semantic_analyzed_total` and `telemetry_processed_total` surfaced in `GET /metrics`.
   - Strangler Fig client and local TypeScript fallbacks in `frontend/lib/engine.ts`.
   - Extended verification suite in `frontend/test_phase3_engine.mjs` (Tests 5 & 6) and Rust tests.

---

## 2. Exhaustive Data Transfer Objects & Schemas

To prevent any serialization failure or `ValidatedJson` HTTP 400 rejection, all DTOs enforce `#[serde(rename_all = "camelCase")]`:

### 2.1 Semantic Paraphrase DTOs
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticAnalyzeRequest {
    pub doc_a: String,
    pub doc_b: String,
    pub threshold: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlignedSentencePair {
    pub sentence_a: String,
    pub sentence_b: String,
    pub similarity: f64,
    pub index_a: usize,
    pub index_b: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticAnalyzeResponse {
    pub semantic_score: f64,
    pub coverage_a_to_b: f64,
    pub coverage_b_to_a: f64,
    pub doc_a_sentences: usize,
    pub doc_b_sentences: usize,
    pub aligned_pairs: Vec<AlignedSentencePair>,
    pub threshold: f64,
    pub method: String,
}
```

### 2.2 Cognitive Process Telemetry DTOs
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeystrokeOp {
    Insert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeystrokeEvent {
    pub timestamp: u64,
    pub op: KeystrokeOp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessAuditRequest {
    pub events: Vec<KeystrokeEvent>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessAuditResult {
    pub is_authentic: bool,
    pub confidence_score: f64,
    pub p_burst_mean: f64,
    pub r_burst_mean: f64,
    pub revision_ratio: f64,
    pub cognitive_pause_ratio: f64,
    pub log_mean: f64,
    pub log_std_dev: f64,
    pub ks_d_statistic: f64,
    pub rapid_interval_count: usize,
    pub valid_interval_count: usize,
    pub flags: Vec<String>,
    pub method: String,
}
```

---

## 3. Mathematical & Algorithmic Specifications

### 3.1 Portable 32-bit FNV-1a Hashing & Subword Character 3-Grams
To guarantee 100% bit-level parity between Rust and TypeScript:
1. **FNV-1a 32-bit Constants:**
   `OFFSET_BASIS = 2166136261u32`, `PRIME = 16777619u32`.
   For each byte $b$: $h = (h \oplus b) \times \text{PRIME}$ (using wrapping arithmetic `h.wrapping_mul(PRIME)` in Rust, `Math.imul` in JS).
2. **Subword 3-Grams:**
   For token $w$, bracket with boundary markers: `<` + $w$ + `>`.
   Sliding 3-character windows produce n-grams (e.g. `<st`, `stu`, `tud`, `udy`, `dy>`).
   For each 3-gram:
   - Compute $h = \text{fnv1a32}(\text{3-gram})$.
   - Dimension index: $d = (h \pmod{64})$ as `usize`.
   - Sign factor: $s = \text{if } ((h \gg 16) \& 1) == 0 \{ 1.0 \} \text{ else } \{ -1.0 \}$.
   - Add $s$ to $\mathbf{v}[d]$.
3. **Synonym Cluster Table:**
   Static cluster table for common academic stems (e.g., `["rapid", "quick", "fast", "swift"]`, `["transform", "alter", "change", "shift"]`, `["revolution", "upheaval", "overhaul"]`, `["manufacturing", "production", "industry"]`, `["crucial", "essential", "vital", "critical"]`, `["study", "research", "investigation"]`, `["student", "pupil", "scholar"]`, `["huge", "enormous", "massive", "immense"]`).
   If a token stem matches cluster $k$, add cluster seed vector to ensure synonymous stems achieve $\cos \ge 0.85$.
4. **Normalized Unit Vector:**
   $$\|\mathbf{v}\|_2 = \sqrt{\sum_{i=0}^{63} v_i^2}$$
   $\mathbf{v}_w = \text{if } \|\mathbf{v}\|_2 > 10^{-9} \{ \mathbf{v} / \|\mathbf{v}\|_2 \} \text{ else } \{ \mathbf{0} \}$.

### 3.2 Centroid Cosine Projection & Bipartite Alignment
- Tokenize document into lowercase words.
- Compute document frequency $\operatorname{DF}(w) \in \{1, 2\}$ across both documents.
- Compute $\operatorname{IDF}(w) = \ln\left(1.0 + \frac{2.0}{1.0 + \operatorname{DF}(w)}\right)$.
  If `crate::stylometry::FUNCTION_WORDS.contains(&w)` is true, attenuate $\operatorname{IDF}(w) \leftarrow \operatorname{IDF}(w) \times 0.25$.
- Accumulate document centroid: $\mathbf{c}_D = \sum_{w \in D} \operatorname{IDF}(w) \cdot \mathbf{v}_w$.
  Normalize: $\hat{\mathbf{c}}_D = \mathbf{c}_D / \|\mathbf{c}_D\|_2$.
- **Sentence Alignment:**
  Split documents into non-empty sentences. If either document contains 0 sentences:
  return response with `semantic_score = 0.0`, `coverage_a_to_b = 0.0`, `coverage_b_to_a = 0.0`, `aligned_pairs = vec![]`.
  For each sentence in $A$ ($i \in [0, |A|-1]$), compute sentence centroid $\mathbf{u}_i$.
  For each sentence in $B$ ($j \in [0, |B|-1]$), compute sentence centroid $\mathbf{v}_j$.
  Cosine matrix $M_{ij} = \mathbf{u}_i \cdot \mathbf{v}_j \in [-1.0, 1.0]$.
  - Directed coverage:
    $$\operatorname{SemCov}(A \to B) = \frac{1}{|A|} \sum_{i=0}^{|A|-1} \max\left(0.0, \max_j (M_{ij} \cdot \mathbb{I}_{M_{ij} \ge \theta})\right)$$
    $$\operatorname{SemCov}(B \to A) = \frac{1}{|B|} \sum_{j=0}^{|B|-1} \max\left(0.0, \max_i (M_{ij} \cdot \mathbb{I}_{M_{ij} \ge \theta})\right)$$
  - Harmonic Score:
    $$F_{\text{semantic}}(A, B) = \frac{2 \cdot \operatorname{SemCov}(A \to B) \cdot \operatorname{SemCov}(B \to A)}{\operatorname{SemCov}(A \to B) + \operatorname{SemCov}(B \to A) + 10^{-9}}$$
  - Greedy 1-to-1 matching: extract highest scoring pairs with $M_{ij} \ge \theta$ where neither $i$ nor $j$ has been paired yet.

### 3.3 Dependency-Free Abramowitz & Stegun $\operatorname{erf}(z)$
For $x \ge 0$:
$$t = \frac{1.0}{1.0 + 0.3275911 \cdot x}$$
$$\operatorname{poly} = t \cdot (0.254829592 + t \cdot (-0.284496736 + t \cdot (1.421413741 + t \cdot (-1.453152027 + t \cdot 1.061405429))))$$
$$\operatorname{erf}(x) = 1.0 - \operatorname{poly} \cdot e^{-x^2}$$
For $x < 0$: $\operatorname{erf}(x) = -\operatorname{erf}(-x)$.
Normal CDF:
$$\Phi(z) = 0.5 \cdot \left[1.0 + \operatorname{erf}\left(\frac{z}{\sqrt{2.0}}\right)\right]$$

### 3.4 Keystroke Telemetry Two-Pass State Machine
1. Sort incoming events by timestamp: `events.sort_by_key(|e| e.timestamp);`
2. Count rapid intervals: $\Delta t_k = t_{k+1}.\text{saturating\_sub}(t_k)$.
   If $\Delta t_k < 20\text{ ms}$, `rapid_interval_count += 1`.
   If $\Delta t_k \in [20\text{ ms}, 10,000\text{ ms}]$, collect $X_k = \ln(\Delta t_k)$.
3. Bot Shield:
   If `rapid_interval_count > 10` or (`total_intervals > 10` and `rapid_interval_count as f64 / total_intervals as f64 > 0.10`):
   add flag `"Automated high-frequency macro injection (<20ms intervals)"`.
4. Guard $N < 10$:
   If valid intervals $N < 10$: return uncalibrated default response:
   `is_authentic: true`, `confidence_score: 50.0`, `flags: ["Insufficient keystroke data for cognitive analysis (N < 10)"]`, all burst/distribution metrics `0.0`.
5. Pass 1:
   $$\mu = \frac{1}{N}\sum X_k, \quad \sigma = \sqrt{\max\left(\frac{1}{N}\sum X_k^2 - \mu^2, 10^{-4}\right)}$$
   $$\tau_{\text{cog}} = \exp(\mu + 2.0 \cdot \sigma)$$
   Cognitive pauses: count of valid intervals where $\Delta t_k \ge \exp(\mu)$ and $\Delta t_k > 300\text{ ms}$.
   $\pi_{\text{cog}} = N_{\text{cog}} / N$.
   If $N \ge 30$ and $\pi_{\text{cog}} < 0.05$: flag `"Sight-reading transcription detected (cognitive pauses suppressed)"`.
   If $N \ge 20$ and $\sigma < 0.15$: flag `"Automated macro injection detected (robotic uniform interval variance)"`.
   Two-sided KS statistic:
   Sort $X_k$ using `x_sorted.sort_by(|a, b| a.total_cmp(b));`
   $$D = \max_{k=1..N} \max\left(\left|\frac{k}{N} - \Phi\left(\frac{X_{(k)} - \mu}{\sigma}\right)\right|, \left|\Phi\left(\frac{X_{(k)} - \mu}{\sigma}\right) - \frac{k-1}{N}\right|\right)$$
   If $N \ge 20$ and $D > 0.35$: flag `"Automated macro injection detected (non-log-normal interval distribution, KS D = {D:.3})"`.
6. Pass 2: Burst state machine
   - P-burst: count insertions between pauses. When $\Delta t_k \ge \tau_{\text{cog}}$, finalize current P-burst. Flush remaining burst at end.
     `p_burst_mean = if p_burst_count > 0 { p_burst_sum as f64 / p_burst_count as f64 } else { p_burst_sum as f64 }`.
   - R-burst: count insertions between deletions. When `event.op == KeystrokeOp::Delete`, finalize current R-burst. Flush at end.
     `r_burst_mean = if r_burst_count > 0 { r_burst_sum as f64 / r_burst_count as f64 } else { r_burst_sum as f64 }`.
   - Revision ratio: $R_{\text{rev}} = C_{\text{del}} / \max(C_{\text{ins}}, 1)$.
   If $N \ge 30$ and $R_{\text{rev}} < 0.02$: flag `"Unnatural zero-revision accretion (R_rev < 0.02)"`.
7. Scoring:
   $$\text{confidence} = \max\left(0.0, 100.0 - 40 \cdot \mathbb{I}_{\pi_{\text{cog}} < 0.05} - 40 \cdot \mathbb{I}_{\sigma < 0.15} - 30 \cdot \mathbb{I}_{D > 0.35} - 20 \cdot \mathbb{I}_{R_{\text{rev}} < 0.02} - 40 \cdot \mathbb{I}_{\text{rapid\_bot}}\right)$$
   `is_authentic = confidence >= 70.0 && flags.is_empty()`.

---

## 4. API Endpoints & Route Registration (`engine-rust/src/api.rs`)

1. Register in `protected_routes` with `validate_engine_key`:
   - `POST /api/v1/semantic/analyze` with `DefaultBodyLimit::max(1024 * 1024)`.
     Check `req.doc_a.len() > 1_000_000 || req.doc_b.len() > 1_000_000` $\implies$ 400 Bad Request.
     Offload to `tokio::task::spawn_blocking(move || crate::semantic::analyze_semantic_similarity(&req))`.
   - `POST /api/v1/telemetry/process` with `DefaultBodyLimit::max(2 * 1024 * 1024)`.
     Check `req.events.len() > 50_000` $\implies$ 400 Bad Request.
     Offload to `tokio::task::spawn_blocking(move || crate::telemetry_advanced::audit_keystroke_process(&req.events))`.
2. Update `AppState`:
   - `semantic_analyzed_total: Arc<AtomicU64>`
   - `telemetry_processed_total: Arc<AtomicU64>`
3. Expose in `GET /metrics` (`MetricsResponse`).

---

## 5. Frontend TypeScript Integration (`frontend/lib/engine.ts`)

1. Mirror Rust DTOs with matching camelCase properties and lowercase `KeystrokeOp`.
2. Implement `analyzeSemanticSimilarityWithEngine(docA, docB, threshold)`:
   - Call `${engineUrl}/api/v1/semantic/analyze`.
   - Fallback to `localAnalyzeSemanticSimilarity(docA, docB, threshold)` using matching 32-bit FNV-1a hashing and synonym clusters.
3. Implement `auditKeystrokeProcessWithEngine(events, sessionId)`:
   - Call `${engineUrl}/api/v1/telemetry/process`.
   - Fallback to `localAuditKeystrokeProcess(events)` using matching two-pass logic, Abramowitz & Stegun `erf`, and KS distance.

---

## 6. Verification & Test Plan

1. **Rust Unit Tests:**
   - `semantic.rs`:
     - Paraphrase test: identical sentences with synonyms (0% shingle overlap) produce $\ge 80\%$ semantic similarity.
     - PSD mathematical stability: Verify similarity $\in [-1.0, 1.0]$ and never returns `NaN` even with empty or antagonistic inputs.
     - Sentence alignment test: Verifies directed coverage and correct `AlignedSentencePair` indices.
     - Zero-sentence edge case test.
   - `telemetry_advanced.rs`:
     - Authentic typing: Bimodal intervals, natural bursts, $\text{confidence} \ge 85$, `is_authentic == true`.
     - Sight-reading transcription: $\pi_{\text{cog}} < 0.05$, flagged, $\text{confidence} < 70$.
     - Bot macro injection (<20ms intervals): Triggered by rapid intervals.
     - Variance collapse: Constant 150ms intervals ($\sigma = 0$), triggered.
     - Out-of-order timestamps: Handled via timestamp sorting.
2. **Rust Integration Tests (`engine-rust/tests/integration_test.rs`):**
   - HTTP requests to `/api/v1/semantic/analyze` and `/api/v1/telemetry/process`.
   - Verify metrics counter increments in `/metrics`.
3. **End-to-End Suite (`frontend/test_phase3_engine.mjs`):**
   - Add Test 5 (Semantic Paraphrase Detection) testing offline fallback and live engine parity on synonym-swapped paragraphs.
   - Add Test 6 (Cognitive Process Telemetry Audit) testing offline fallback and live engine on authentic typing vs. automated macro streams.
4. **Toolchain Checks:**
   - `cargo clippy --manifest-path engine-rust/Cargo.toml --all-targets -- -D warnings`
   - `cargo fmt --manifest-path engine-rust/Cargo.toml -- --check`
   - `npm --prefix frontend run build`
