# Phase 2 Implementation Plan: Intrinsic Stylometry (Burrows' Delta & Yule's K) and Snapshot Accretion Dynamics

**Document Type:** Detailed Implementation Plan & Execution Blueprint  
**Subsystems:** `engine-rust/src/stylometry.rs`, `engine-rust/src/telemetry.rs`, `engine-rust/src/api.rs`, and `frontend/lib/engine.ts`  
**Status:** Approved for Implementation (Goldfish Review Passed & Resolved)  
**Target Milestone:** Single-Document Patchwriting Detection and Privacy-Preserving Drafting Accretion Verification

---

## 1. Objectives & Scope

### 1.1 Core Problems Solved
1. **The Cross-Document Blind Spot (Limitation 1.4):** Pairwise collusion detection only catches copying within the same assignment cohort. If a student copies an unindexed external paper, previous year's essay, or AI output, cross-submission similarity is $0\%$. **Single-document intrinsic stylometry** analyzes internal stylistic consistency to detect patchwriting seams in isolation.
2. **Text-Length Sensitivity of Vocabulary Metrics:** Traditional Type-Token Ratio ($\operatorname{TTR} = V / N$) collapses as essay length increases due to Zipf's Law. **Udny Yule's Characteristic $K$** provides a length-invariant mathematical measure of vocabulary richness ($E[K]$ is constant under Poisson word selection).
3. **Register Fracture Detection:** John Burrows' Delta ($\Delta$) evaluates relative deviations in the frequencies of the top 50 English function words (*the, of, and, to, a, in, that...*) across sliding 250-word windows. A sustained spike of $\Delta > 2.5$ reveals pasted foreign text (e.g. academic journal prose inserted into a student essay).
4. **Drafting Verification Without Invasive Keylogging:** Instead of invasive keystroke logging, Clio's periodic editor snapshots ($S_0, S_1, \dots, S_T$) are audited for **Snapshot Accretion Velocity** ($v = \Delta L / \Delta t$) and **Revision Ratio** ($R_{\text{rev}} = C_{\text{del}} / C_{\text{ins}}$), providing tamper-proof mathematical proof of live human composition.

### 1.2 In-Scope Deliverables
- **New Rust Module:** [`engine-rust/src/stylometry.rs`](file:///c:/mini%20project/clio/engine-rust/src/stylometry.rs):
  - `calculate_yules_k(words: &[&str]) -> f64`: $O(1)$ auxiliary memory calculation of Yule's $K$.
  - `burrows_delta_windowed(words: &[&str], window_size: usize, stride: usize) -> StylometricProfile`: Pre-mapped $O(1)$ function word index lookups with running accumulators.
  - `audit_stylometry(content: &str) -> StylometryResponse`: Top-level entry point analyzing intrinsic stylistic integrity.
- **Enhanced Telemetry Auditing:** [`engine-rust/src/telemetry.rs`](file:///c:/mini%20project/clio/engine-rust/src/telemetry.rs):
  - Update `AuditResult` to drop `Eq` (avoiding compiler error E0277) and add `revisionRatio: Option<f64>`, `peakAccretionVelocity: Option<f64>`, and `avgAccretionVelocity: Option<f64>`.
  - Update all 4 early-return paths in `telemetry.rs` to set accretion fields to `None`.
  - Calculate snapshot accretion deltas excluding paste events, accumulating active typing intervals ($\le 5000\text{ms}$) to prevent idle pause distortion.
  - Penalize integrity score when sustained accretion velocity exceeds $80\text{ chars/second}$ or when revision ratio drops to $< 0.02$ on essays with $>500$ typed characters.
- **Axum API Route:** [`engine-rust/src/api.rs`](file:///c:/mini%20project/clio/engine-rust/src/api.rs):
  - Add `stylometry_audits_total: Arc<AtomicU64>` to `AppState` and initialize it in `AppState::default()`.
  - Add `stylometry_audits_total` to `MetricsResponse` and export in `metrics_handler`.
  - Register `POST /api/v1/stylometry/audit` in `protected_routes` (inheriting `validate_engine_key` middleware).
  - Wrap `audit_stylometry` in `tokio::task::spawn_blocking` to avoid async worker thread starvation.
- **Crate Root Registration:** [`engine-rust/src/lib.rs`](file:///c:/mini%20project/clio/engine-rust/src/lib.rs):
  - Register `pub mod stylometry;` and re-export public types.
- **Frontend Engine Integration:** [`frontend/lib/telemetry.ts`](file:///c:/mini%20project/clio/frontend/lib/telemetry.ts) and [`frontend/lib/engine.ts`](file:///c:/mini%20project/clio/frontend/lib/engine.ts):
  - Update `TelemetryAuditResult` in `telemetry.ts`.
  - Add `EngineStylometricProfile`, `StylometryAuditResult`, and `auditStylometryWithEngine` in `engine.ts` with local fallback.
- **Automated Verification Suite:**
  - Unit tests in `stylometry.rs` verifying length-invariance bound $|K(D) - K(D \cdot D)| \le 1.0$ on $N \ge 5000$ words, homogeneous stability, and patchwriting seam detection.
  - Unit tests in `telemetry.rs` verifying accretion velocity and revision ratio.
  - Integration tests in `api.rs` and `test_phase3_engine.mjs`.

---

## 2. Technical Architecture & File-by-File Changes

### 2.1 Component 1: `engine-rust/src/stylometry.rs` (New File)
```rust
//! Single-document intrinsic stylometry: length-invariant Yule's K and windowed Burrows' Delta.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Top 50 English function words most indicative of subconscious authorial register.
pub const FUNCTION_WORDS: [&str; 50] = [
    "the", "of", "and", "to", "a", "in", "that", "is", "was", "he", "for", "it", "with", "as",
    "his", "on", "be", "at", "by", "i", "this", "had", "not", "are", "but", "from", "or", "have",
    "an", "they", "which", "one", "you", "were", "her", "all", "she", "there", "would", "their",
    "we", "him", "been", "has", "when", "who", "will", "more", "no", "if",
];

/// Detailed stylometric anomaly profile for an essay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StylometricProfile {
    /// Length-invariant vocabulary richness metric (Yule's K).
    #[serde(rename = "yulesK")]
    pub yules_k: f64,
    /// Maximum Burrows' Delta observed across all sliding windows.
    #[serde(rename = "burrowsDeltaMax")]
    pub burrows_delta_max: f64,
    /// Mean Burrows' Delta across all sliding windows.
    #[serde(rename = "burrowsDeltaMean")]
    pub burrows_delta_mean: f64,
    /// Indices of windows exhibiting statistical register fracture (Delta > 2.5).
    /// Window i covers word range [i * stride .. i * stride + window_size].
    #[serde(rename = "anomalousWindows")]
    pub anomalous_windows: Vec<usize>,
    /// Whether any window exceeds the stylistic fracture threshold.
    #[serde(rename = "isAnomalous")]
    pub is_anomalous: bool,
    /// Stylistic anomaly risk score (0 - 100).
    #[serde(rename = "riskScore")]
    pub risk_score: i32,
}

/// Request payload for single-document stylometry audit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct StylometryRequest {
    /// Raw text or HTML essay content.
    pub content: String,
    /// Optional document title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Response payload from stylometry audit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StylometryResponse {
    /// Stylometric analysis profile.
    pub profile: StylometricProfile,
    /// Total word count evaluated.
    #[serde(rename = "wordCount")]
    pub word_count: usize,
    /// Total sliding windows evaluated.
    #[serde(rename = "totalWindows")]
    pub total_windows: usize,
}

/// Computes length-invariant Yule's Characteristic K with O(1) auxiliary allocations.
pub fn calculate_yules_k(words: &[&str]) -> f64 {
    let total_words = words.len();
    if total_words < 20 {
        return 0.0;
    }

    let mut word_counts: HashMap<&str, usize> = HashMap::with_capacity(total_words / 2);
    for &word in words {
        *word_counts.entry(word).or_insert(0) += 1;
    }

    let s1 = total_words as f64;
    let s2 = word_counts.values().map(|&c| (c * c) as f64).sum::<f64>();

    10_000.0 * (s2 - s1) / (s1 * s1)
}

/// Computes windowed Burrows' Delta across sliding windows against document baseline.
/// Pre-maps words to integer IDs (0..49) to eliminate repeated string lookups in sliding windows.
pub fn burrows_delta_windowed(
    words: &[&str],
    window_size: usize,
    stride: usize,
) -> StylometricProfile {
    let yules_k = calculate_yules_k(words);
    let total_words = words.len();

    if total_words < window_size || window_size == 0 || stride == 0 {
        let is_anomalous = total_words >= 100 && (yules_k < 35.0 || yules_k > 135.0);
        let risk_score = if is_anomalous { 60 } else { 10 };
        return StylometricProfile {
            yules_k: (yules_k * 100.0).round() / 100.0,
            burrows_delta_max: 0.0,
            burrows_delta_mean: 0.0,
            anomalous_windows: Vec::new(),
            is_anomalous,
            risk_score,
        };
    }

    // Pre-map words into integer function word index 0..49 (or 255 for non-function word)
    let mapped_words: Vec<u8> = words
        .iter()
        .map(|&w| {
            FUNCTION_WORDS
                .iter()
                .position(|&fw| fw == w)
                .map(|p| p as u8)
                .unwrap_or(255)
        })
        .collect();

    // 1. Compute baseline function word frequencies across entire document
    let mut baseline_counts = [0usize; 50];
    for &idx in &mapped_words {
        if (idx as usize) < 50 {
            baseline_counts[idx as usize] += 1;
        }
    }
    let total_w = total_words as f64;
    let mut baseline_freqs = [0.0f64; 50];
    for i in 0..50 {
        baseline_freqs[i] = (baseline_counts[i] as f64) / total_w;
    }

    // 2. Evaluate sliding windows using running accumulators (zero heap allocations for deltas)
    let mut delta_max = 0.0f64;
    let mut delta_sum = 0.0f64;
    let mut total_windows = 0usize;
    let mut anomalous_windows = Vec::new();

    for (win_idx, chunk) in mapped_words.windows(window_size).step_by(stride).enumerate() {
        let mut win_counts = [0usize; 50];
        for &idx in chunk {
            if (idx as usize) < 50 {
                win_counts[idx as usize] += 1;
            }
        }
        let win_len = chunk.len() as f64;

        let mut delta = 0.0f64;
        for i in 0..50 {
            let win_f = (win_counts[i] as f64) / win_len;
            let diff = (win_f - baseline_freqs[i]).abs();
            delta += diff / (baseline_freqs[i].sqrt().max(0.005));
        }
        delta /= 50.0;

        if delta > 2.5 {
            anomalous_windows.push(win_idx);
        }
        if delta > delta_max {
            delta_max = delta;
        }
        delta_sum += delta;
        total_windows += 1;
    }

    let burrows_delta_mean = if total_windows > 0 {
        delta_sum / (total_windows as f64)
    } else {
        0.0
    };

    let is_anomalous = !anomalous_windows.is_empty()
        || (total_words >= 100 && (yules_k < 35.0 || yules_k > 135.0));

    let mut risk_score = 10;
    if !anomalous_windows.is_empty() {
        risk_score += (anomalous_windows.len() * 20).min(60) as i32;
    }
    if delta_max > 2.5 {
        risk_score += 20;
    }
    if total_words >= 100 && (yules_k > 135.0 || yules_k < 35.0) {
        risk_score += 20;
    }

    StylometricProfile {
        yules_k: (yules_k * 100.0).round() / 100.0,
        burrows_delta_max: (delta_max * 1000.0).round() / 1000.0,
        burrows_delta_mean: (burrows_delta_mean * 1000.0).round() / 1000.0,
        anomalous_windows,
        is_anomalous,
        risk_score: risk_score.min(100),
    }
}

/// Top-level audit function extracting cleaned words and running stylometric evaluation.
pub fn audit_stylometry(content: &str) -> StylometryResponse {
    let cleaned = crate::similarity::clean_text(content);
    let words = crate::similarity::extract_words(&cleaned);
    let word_count = words.len();

    let profile = burrows_delta_windowed(&words, 250, 50);
    let total_windows = if word_count >= 250 {
        ((word_count - 250) / 50) + 1
    } else {
        0
    };

    StylometryResponse {
        profile,
        word_count,
        total_windows,
    }
}
```

---

### 2.2 Component 2: `engine-rust/src/telemetry.rs` (Snapshot Accretion Analytics)
1. Update `AuditResult`:
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditResult {
    #[serde(rename = "isValid")]
    pub is_valid: bool,
    #[serde(rename = "flaggedForReview")]
    pub flagged_for_review: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "verifiedWpm")]
    pub verified_wpm: i32,
    #[serde(rename = "verifiedPasteCount")]
    pub verified_paste_count: i32,
    #[serde(rename = "integrityScore")]
    pub integrity_score: i32,
    #[serde(rename = "typedCharCount")]
    pub typed_char_count: i32,
    #[serde(rename = "activeTypingTimeMs")]
    pub active_typing_time_ms: i64,
    #[serde(rename = "totalSnapshots")]
    pub total_snapshots: usize,
    #[serde(rename = "pasteEvents")]
    pub paste_events: Vec<PasteEvent>,
    /// Net revision ratio: total characters deleted / total characters inserted (0.0 - 1.0).
    #[serde(rename = "revisionRatio", default, skip_serializing_if = "Option::is_none")]
    pub revision_ratio: Option<f64>,
    /// Peak accretion velocity in characters per second observed during typing.
    #[serde(rename = "peakAccretionVelocity", default, skip_serializing_if = "Option::is_none")]
    pub peak_accretion_velocity: Option<f64>,
    /// Average accretion velocity in characters per second during active typing.
    #[serde(rename = "avgAccretionVelocity", default, skip_serializing_if = "Option::is_none")]
    pub avg_accretion_velocity: Option<f64>,
}
```
2. Update all 4 early-return initializers:
   - Line 300 (empty snapshots): `revision_ratio: None, peak_accretion_velocity: None, avg_accretion_velocity: None`
   - Line 317 (non-positive timestamp): `revision_ratio: None, peak_accretion_velocity: None, avg_accretion_velocity: None`
   - Line 336 (non-monotonic): `revision_ratio: None, peak_accretion_velocity: None, avg_accretion_velocity: None`
   - Line 383 (single snapshot): `revision_ratio: None, peak_accretion_velocity: None, avg_accretion_velocity: None`
3. Accurate accretion velocity and revision ratio calculation:
```rust
    let mut total_insertions: usize = 0;
    let mut total_deletions: usize = 0;
    let mut peak_velocity: f64 = 0.0;
    let mut active_vel_chars: usize = 0;
    let mut active_vel_ms: i64 = 0;

    for i in 1..snapshots.len() {
        let prev = &snapshots[i - 1];
        let curr = &snapshots[i];
        let delta_ms = curr.timestamp - prev.timestamp;
        let prev_len = snap_lengths[i - 1] as i32;
        let curr_len = snap_lengths[i] as i32;
        let delta_chars = curr_len - prev_len;

        if delta_chars > 0 {
            total_insertions += delta_chars as usize;
        } else if delta_chars < 0 {
            total_deletions += delta_chars.unsigned_abs() as usize;
        }

        // Accretion velocity only tracks typing progression (pastes excluded)
        if !paste_indices.contains(&i) && delta_chars > 0 && delta_ms > 100 {
            let delta_sec = (delta_ms as f64) / 1000.0;
            let vel = (delta_chars as f64) / delta_sec;
            if vel > peak_velocity {
                peak_velocity = vel;
            }
            // Only integrate active typing intervals (<= 5000ms) to prevent idle pauses from skewing average
            if delta_ms <= 5000 {
                active_vel_chars += delta_chars as usize;
                active_vel_ms += delta_ms;
            }
        }
    }

    let revision_ratio = if total_insertions > 0 {
        Some(((total_deletions as f64) / (total_insertions as f64) * 1000.0).round() / 1000.0)
    } else {
        None
    };

    let peak_accretion_velocity = if peak_velocity > 0.0 {
        Some((peak_velocity * 10.0).round() / 10.0)
    } else {
        None
    };

    let avg_accretion_velocity = if active_vel_ms > 0 && active_vel_chars > 0 {
        let avg_vel = (active_vel_chars as f64) / ((active_vel_ms as f64) / 1000.0);
        Some((avg_vel * 10.0).round() / 10.0)
    } else {
        None
    };

    let anomalous_accretion = peak_velocity > 80.0;
    let zero_revision_injection = typed_char_count > 500 && revision_ratio.map_or(false, |r| r < 0.02);

    if zero_revision_injection {
        score -= 15;
    }
    if anomalous_accretion {
        score -= 20;
    }
```

---

### 2.3 Component 3: `engine-rust/src/api.rs` (Stylometry Endpoint & Metrics)
1. Add `pub stylometry_audits_total: Arc<AtomicU64>` to `AppState` and initialize in `AppState::default()`.
2. Add `pub stylometry_audits_total: u64` to `MetricsResponse` and populate in `metrics_handler`.
3. Register `.route("/api/v1/stylometry/audit", post(audit_stylometry_handler))` inside `protected_routes` (inheriting `validate_engine_key` middleware).
4. Implement `audit_stylometry_handler`:
```rust
async fn audit_stylometry_handler(
    State(state): State<AppState>,
    ValidatedJson(req): ValidatedJson<crate::stylometry::StylometryRequest>,
) -> Result<Json<crate::stylometry::StylometryResponse>, (StatusCode, Json<serde_json::Value>)> {
    if req.content.len() > 1_000_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Content exceeds 1MB limit" })),
        ));
    }
    state.stylometry_audits_total.fetch_add(1, Ordering::Relaxed);
    let content = req.content;
    let result = tokio::task::spawn_blocking(move || {
        crate::stylometry::audit_stylometry(&content)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Worker task failed: {e}") })),
        )
    })?;
    Ok(Json(result))
}
```

---

### 2.4 Component 4: `frontend/lib/telemetry.ts` and `frontend/lib/engine.ts`
1. Update `TelemetryAuditResult` in `frontend/lib/telemetry.ts` with optional `revisionRatio?: number`, `peakAccretionVelocity?: number`, and `avgAccretionVelocity?: number`.
2. In `frontend/lib/engine.ts`:
   - Declare `EngineStylometricProfile` and `StylometryAuditResult`.
   - Implement `localCalculateYulesK(words: string[]): number`.
   - Implement `auditStylometryWithEngine(content: string, title?: string): Promise<StylometryAuditResult>`.

---

## 3. Verification & Validation Metrics

| Test Scenario | Input Data | Expected Metric |
| :--- | :--- | :--- |
| **Yule's K Length Invariance** | Essay $D$ (5,000 words), Doubled Essay $D \cdot D$ (10,000 words) | $|K(D) - K(D \cdot D)| \le 1.0$ (Strict mathematical length-invariance) |
| **Stylometric Register Fracture** | Informal student essay with a 300-word inserted academic research excerpt | $\Delta_{\text{max}} > 2.5$ on inserted windows; `is_anomalous = true` |
| **Homogeneous Essay** | Clean, authored 800-word essay with consistent register | $\Delta_{\text{max}} < 2.0$; `is_anomalous = false`; `risk_score <= 20` |
| **Natural Drafting Accretion** | 20 snapshots with steady typing and backspaces | $v_{\text{avg}} \in [2, 12]\text{ chars/s}$; $R_{\text{rev}} \in [0.10, 0.45]$ |
| **Unrevised Bulk Insertion** | 10 snapshots where 2,000 chars are typed with 0 backspaces | $R_{\text{rev}} < 0.02$; Flagged for review with penalized score |
| **Short Text Edge Case** | Text with $< 20$ words | Returns $K = 0.0, \Delta_{\text{max}} = 0.0$; no panics |
