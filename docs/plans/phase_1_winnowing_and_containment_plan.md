# Phase 1 Implementation Plan: Winnowing Algorithm, Inverted Index & Windowed Broder Containment

**Document Type:** Detailed Implementation Plan & Execution Blueprint  
**Subsystem:** `engine-rust/` (High-Performance Compute Microservice) & `frontend/lib/engine.ts`  
**Status:** Approved for Implementation (Goldfish Review Passed & Resolved)  
**Target Milestone:** Eliminate Jaccard Dilution Trap with Provable $t$-Guarantee ($t=12$) and Windowed Containment

---

## 1. Objectives & Scope

### 1.1 Core Problems Solved
1. **The Global Jaccard Dilution Trap (Limitation 1.2):** Verbatim theft of 200 words inside a 2,500-word essay yields symmetric Jaccard $J \approx 4.68\%$, which falls below typical thresholds ($\tau = 20\%\text{--}25\%$).
2. **MinHash Candidate Loss:** For $J \approx 4.68\%$, MinHash LSH ($b=64, r=2$) collision probability is only $13.1\%$, dropping $86.9\%$ of diluted plagiarized pairs before pairwise evaluation.
3. **Double-Sided Dilution in Large Essays:** If both essays are large (e.g. 2,000 words and 2,500 words), whole-document global containment $C(A \subseteq B)$ is also diluted ($10\% < 20\%$). **Windowed Block Containment** is required to inspect sliding paragraph segments and pinpoint the copied block with $\approx 100\%$ precision.
4. **Storage & Comparison Overhead:** Hashing every 4-gram shingle wastes memory. Winnowing with window $w = 8$ reduces indexed hashes by $77.8\%$ while guaranteeing $100\%$ detection of all matches $\ge 12$ words.

### 1.2 In-Scope Deliverables
- **New Rust Module:** [`engine-rust/src/winnowing.rs`](file:///c:/mini%20project/clio/engine-rust/src/winnowing.rs) containing:
  - `generate_sequential_shingles`: Ordered hashing of word $k$-grams ($k=5$) reusing `crate::similarity::hash_shingle`.
  - `winnow_shingle_hashes`: Sliding window ($w=8$) rightmost tie-breaker selection with preallocated capacity.
  - `InvertedFingerprintIndex`: Inverted hash postings index with per-document deduplication and self-pair suppression.
  - `calculate_set_containment`: Zero-heap global containment calculation on precomputed hash sets.
  - `calculate_windowed_containment`: $O(N)$ sliding block containment with zero-window safety guards.
- **Engine Pipeline Integration:** [`engine-rust/src/similarity.rs`](file:///c:/mini%20project/clio/engine-rust/src/similarity.rs):
  - Extend `SimilarityPair` with `containment1In2`, `containment2In1`, `maxContainment`, and `sharedFingerprints`.
  - Extend `AnalyzeRequest` with optional `containmentThreshold: Option<f64>` (default: `0.20`), deriving `PartialEq` without `Eq`.
  - Update `AnalyzeResponse` to derive `PartialEq` without `Eq`.
  - Merge candidate pairs from `InvertedFingerprintIndex` with MinHash LSH bands.
  - Evaluate both global containment and windowed block containment ($W_{\text{block}} = 30$ fingerprints $\approx 135$ words).
  - Sort results by composite maximum severity: `max(similarity, (max_containment * 100.0) as i32)`.
- **Crate Root Registration:** [`engine-rust/src/lib.rs`](file:///c:/mini%20project/clio/engine-rust/src/lib.rs):
  - Declare `pub mod winnowing;` and re-export public types.
- **Frontend Contract Synchronization:** [`frontend/lib/engine.ts`](file:///c:/mini%20project/clio/frontend/lib/engine.ts):
  - Extend `EngineSimilarityPair` with optional containment fields (backwards-compatible).
  - Update `analyzeSimilarityWithEngine` and `localAnalyzeSimilarity` with `containmentThreshold?: number` parameter.
  - Fix `localAnalyzeSimilarity` fallback using `shingles.size` instead of `.length`.
- **Verification Suite:**
  - Unit tests in `winnowing.rs` proving rightmost tie-breaking, short-input edge cases, zero window protection, and deduplication.
  - Integration test in `similarity.rs` proving that a 200-word stolen passage inside a 2,500-word essay is detected with $>95\%$ containment while Jaccard reports $< 5\%$.
  - End-to-end API test verifying JSON serialization and backwards compatibility.

---

## 2. Technical Architecture & File-by-File Changes

### 2.1 Component 1: `engine-rust/src/winnowing.rs` (New File)
```rust
//! In-process Winnowing fingerprinting algorithm with Inverted Indexing and Broder Containment.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Noise threshold: any match shorter than k words is considered spurious noise.
pub const NOISE_THRESHOLD_K: usize = 5;

/// Guarantee threshold: any matching substring of length >= t words must be detected.
pub const GUARANTEE_THRESHOLD_T: usize = 12;

/// Sliding window size: w = t - k + 1 = 8.
pub const WINDOW_SIZE_W: usize = GUARANTEE_THRESHOLD_T - NOISE_THRESHOLD_K + 1;

/// Maximum postings per fingerprint hash to ignore boilerplate idioms.
pub const MAX_POSTINGS_PER_HASH: usize = 100;

/// Default sliding window block size in fingerprints for localized containment (~135 words).
pub const WINDOW_BLOCK_FINGERPRINTS: usize = 30;

/// Represents a selected Winnowing fingerprint with its 0-indexed word position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Fingerprint {
    pub hash: u64,
    pub position: usize,
}

/// Generates sequential shingle hashes preserving strict text ordering and repetition.
/// Reuses crate::similarity::hash_shingle to prevent hash divergence.
pub fn generate_sequential_shingles(words: &[&str], k: usize) -> Vec<u64> {
    let k = if k == 0 { NOISE_THRESHOLD_K } else { k };
    if words.len() < k {
        return Vec::new();
    }
    words.windows(k).map(crate::similarity::hash_shingle).collect()
}

/// Computes Winnowed fingerprints using a sliding window with deterministic rightmost tie-breaking.
pub fn winnow_shingle_hashes(shingle_hashes: &[u64]) -> Vec<Fingerprint> {
    let n = shingle_hashes.len();
    if n == 0 {
        return Vec::new();
    }

    let expected_capacity = (n * 2) / (WINDOW_SIZE_W + 1) + 16;
    let mut fingerprints = Vec::with_capacity(expected_capacity);

    if n < WINDOW_SIZE_W {
        if let Some((min_idx, &min_val)) = shingle_hashes
            .iter()
            .enumerate()
            .rev()
            .min_by_key(|&(_, val)| val)
        {
            fingerprints.push(Fingerprint { hash: min_val, position: min_idx });
        }
        return fingerprints;
    }

    let mut min_pos: Option<usize> = None;

    for i in 0..=(n - WINDOW_SIZE_W) {
        let window = &shingle_hashes[i..i + WINDOW_SIZE_W];

        let mut local_min_idx = 0;
        let mut local_min_val = window[0];
        for j in 1..WINDOW_SIZE_W {
            if window[j] <= local_min_val {
                local_min_val = window[j];
                local_min_idx = j;
            }
        }
        let absolute_pos = i + local_min_idx;

        if min_pos != Some(absolute_pos) {
            fingerprints.push(Fingerprint {
                hash: local_min_val,
                position: absolute_pos,
            });
            min_pos = Some(absolute_pos);
        }
    }

    fingerprints
}

/// Inverted Fingerprint Index for O(N) candidate generation across large cohorts.
#[derive(Debug, Default, Clone)]
pub struct InvertedFingerprintIndex {
    index: HashMap<u64, Vec<usize>>,
}

impl InvertedFingerprintIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Inserts submission fingerprints with per-document hash deduplication.
    pub fn insert(&mut self, submission_idx: usize, fingerprints: &[Fingerprint]) {
        let mut seen = HashSet::with_capacity(fingerprints.len());
        for fp in fingerprints {
            if seen.insert(fp.hash) {
                let postings = self.index.entry(fp.hash).or_default();
                if postings.len() < (MAX_POSTINGS_PER_HASH + 1) {
                    postings.push(submission_idx);
                }
            }
        }
    }

    /// Finds candidate submission pairs sharing at least `min_shared` distinct fingerprints.
    pub fn find_candidate_pairs(&self, min_shared: usize) -> Vec<(usize, usize, usize)> {
        let mut co_occurrences: HashMap<(usize, usize), usize> = HashMap::new();

        for postings in self.index.values() {
            if postings.len() < 2 || postings.len() > MAX_POSTINGS_PER_HASH {
                continue;
            }
            for i in 0..postings.len() {
                for j in (i + 1)..postings.len() {
                    let a = postings[i];
                    let b = postings[j];
                    if a == b {
                        continue; // Guard against self-pairing
                    }
                    let pair = (a.min(b), a.max(b));
                    *co_occurrences.entry(pair).or_insert(0) += 1;
                }
            }
        }

        co_occurrences
            .into_iter()
            .filter(|&(_, count)| count >= min_shared)
            .map(|((a, b), count)| (a, b, count))
            .collect()
    }
}

/// Computes asymmetric Broder Containment on pre-built hash sets:
/// returns (C(A ⊆ B), C(B ⊆ A))
pub fn calculate_set_containment(set_a: &HashSet<u64>, set_b: &HashSet<u64>) -> (f64, f64) {
    if set_a.is_empty() || set_b.is_empty() {
        return (0.0, 0.0);
    }
    let intersection_count = set_a.iter().filter(|h| set_b.contains(h)).count();
    let c_a_in_b = (intersection_count as f64) / (set_a.len() as f64);
    let c_b_in_a = (intersection_count as f64) / (set_b.len() as f64);
    (c_a_in_b, c_b_in_a)
}

/// Sliding-window block containment to locate dense localized matching passages in O(N).
pub fn calculate_windowed_containment(
    fp_a: &[Fingerprint],
    set_b: &HashSet<u64>,
    window_fingerprints: usize,
) -> f64 {
    if fp_a.is_empty() || set_b.is_empty() || window_fingerprints == 0 {
        return 0.0;
    }
    if fp_a.len() <= window_fingerprints {
        let hits = fp_a.iter().filter(|f| set_b.contains(&f.hash)).count();
        return (hits as f64) / (fp_a.len() as f64);
    }

    // Precompute hit vector to ensure O(N) rolling-window efficiency
    let hits: Vec<usize> = fp_a
        .iter()
        .map(|f| if set_b.contains(&f.hash) { 1 } else { 0 })
        .collect();

    let mut current_window_hits: usize = hits[..window_fingerprints].iter().sum();
    let mut max_hits = current_window_hits;

    for i in window_fingerprints..hits.len() {
        current_window_hits += hits[i];
        current_window_hits -= hits[i - window_fingerprints];
        if current_window_hits > max_hits {
            max_hits = current_window_hits;
        }
    }

    (max_hits as f64) / (window_fingerprints as f64)
}
```

---

### 2.2 Component 2: `engine-rust/src/similarity.rs`
1. Update `SimilarityPair`:
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SimilarityPair {
    pub submission1: StudentRef,
    pub submission2: StudentRef,
    pub similarity: i32,
    #[serde(rename = "sharedShingles")]
    pub shared_shingles: usize,
    #[serde(rename = "containment1In2", default)]
    pub containment_1_in_2: f64,
    #[serde(rename = "containment2In1", default)]
    pub containment_2_in_1: f64,
    #[serde(rename = "maxContainment", default)]
    pub max_containment: f64,
    #[serde(rename = "sharedFingerprints", default)]
    pub shared_fingerprints: usize,
    pub assignment: String,
}
```
2. Update `AnalyzeRequest` & `AnalyzeResponse` (drop `Eq`):
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeRequest {
    pub submissions: Vec<SubmissionInput>,
    #[serde(default)]
    pub threshold: Option<i32>,
    #[serde(rename = "containmentThreshold", default)]
    pub containment_threshold: Option<f64>,
    #[serde(rename = "shingleSize", default)]
    pub shingle_size: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeResponse {
    pub pairs: Vec<SimilarityPair>,
    #[serde(rename = "totalPossiblePairs")]
    pub total_possible_pairs: usize,
    #[serde(rename = "comparisonsMade")]
    pub comparisons_made: usize,
    #[serde(rename = "totalComparisons")]
    pub total_comparisons: usize,
    pub threshold: i32,
    pub method: String,
}
```
3. Update `ProcessedSubmission`:
```rust
struct ProcessedSubmission {
    id: String,
    assignment: String,
    student: String,
    username: String,
    word_count: usize,
    shingles: HashSet<u64>,
    minhash_sig: [u64; NUM_HASHES],
    fingerprints: Vec<crate::winnowing::Fingerprint>,
    fingerprint_set: HashSet<u64>,
}
```
4. Update Preprocessing & Candidate Generation in `analyze_corpus`:
```rust
    // In Rayon par_iter map:
    let seq_shingles = crate::winnowing::generate_sequential_shingles(&words, crate::winnowing::NOISE_THRESHOLD_K);
    let fingerprints = crate::winnowing::winnow_shingle_hashes(&seq_shingles);
    let mut fingerprint_set = HashSet::with_capacity(fingerprints.len());
    for fp in &fingerprints {
        fingerprint_set.insert(fp.hash);
    }
```
5. Candidate Pair Generation per assignment:
```rust
    // Build inverted index for this assignment
    let mut inv_index = crate::winnowing::InvertedFingerprintIndex::new();
    for &idx in indices {
        inv_index.insert(idx, &processed[idx].fingerprints);
    }
    for (idx_a, idx_b, _) in inv_index.find_candidate_pairs(3) {
        let pair = (idx_a.min(idx_b), idx_a.max(idx_b));
        candidate_pair_map.insert(pair, ());
    }
```
6. Candidate Evaluation with Windowed Containment:
```rust
    let (c_1_in_2, c_2_in_1) = crate::winnowing::calculate_set_containment(&a.fingerprint_set, &b.fingerprint_set);
    let global_containment = c_1_in_2.max(c_2_in_1);

    let effective_containment_threshold = req.containment_threshold.unwrap_or(0.20);

    // If global containment is below threshold, evaluate localized windowed containment
    let max_containment = if global_containment >= effective_containment_threshold {
        global_containment
    } else {
        let win_1 = crate::winnowing::calculate_windowed_containment(
            &a.fingerprints,
            &b.fingerprint_set,
            crate::winnowing::WINDOW_BLOCK_FINGERPRINTS,
        );
        let win_2 = crate::winnowing::calculate_windowed_containment(
            &b.fingerprints,
            &a.fingerprint_set,
            crate::winnowing::WINDOW_BLOCK_FINGERPRINTS,
        );
        global_containment.max(win_1.max(win_2))
    };

    let is_match = similarity >= threshold || max_containment >= effective_containment_threshold;
```
7. Severity-First Composite Sorting:
```rust
    let pair_score = |p: &SimilarityPair| -> i32 {
        p.similarity.max((p.max_containment * 100.0).round() as i32)
    };

    pairs.sort_by(|a, b| {
        pair_score(b)
            .cmp(&pair_score(a))
            .then_with(|| b.shared_fingerprints.cmp(&a.shared_fingerprints))
            .then_with(|| b.similarity.cmp(&a.similarity))
            .then_with(|| a.submission1.id.cmp(&b.submission1.id))
            .then_with(|| a.submission2.id.cmp(&b.submission2.id))
    });
    pairs.truncate(50);
```

---

### 2.3 Component 3: `engine-rust/src/lib.rs`
- Add `pub mod winnowing;`
- Re-export `pub use winnowing::{Fingerprint, InvertedFingerprintIndex, calculate_set_containment, calculate_windowed_containment, generate_sequential_shingles, winnow_shingle_hashes};`

---

### 2.4 Component 4: `frontend/lib/engine.ts`
- Extend `EngineSimilarityPair`:
```typescript
export interface EngineSimilarityPair {
    submission1: { id: string; student: string; username: string }
    submission2: { id: string; student: string; username: string }
    similarity: number
    sharedShingles: number
    containment1In2?: number
    containment2In1?: number
    maxContainment?: number
    sharedFingerprints?: number
    assignment: string
}
```
- Update `analyzeSimilarityWithEngine`:
```typescript
export async function analyzeSimilarityWithEngine(
    submissions: EngineSubmissionInput[],
    threshold: number = 25,
    shingleSize: number = 4,
    containmentThreshold: number = 0.20
): Promise<SimilarityAnalysisResult>
```
- Update `localAnalyzeSimilarity` fallback with safe `.size` calculations:
```typescript
const aSize = a.shingles.size
const bSize = b.shingles.size
const containment1In2 = aSize > 0 ? Number((intersection / aSize).toFixed(4)) : 0
const containment2In1 = bSize > 0 ? Number((intersection / bSize).toFixed(4)) : 0
const maxContainment = Math.max(containment1In2, containment2In1)
```

---

## 3. Step-by-Step Execution Plan

1. **Step 1: Create `engine-rust/src/winnowing.rs`**
   - Implement all constants, structs, algorithms, and unit tests.
2. **Step 2: Update `engine-rust/src/lib.rs`**
   - Expose module and types.
3. **Step 3: Integrate with `engine-rust/src/similarity.rs`**
   - Update structs, candidate generation, windowed containment evaluation, and severity sorting.
   - Add Needle-in-a-Haystack test (200 words copied between two large essays).
4. **Step 4: Update `frontend/lib/engine.ts`**
   - Update types, engine call with `containmentThreshold`, and safe fallback math.
5. **Step 5: Run Full Test Suite & Validation**
   - Run `cargo test` in `engine-rust/`. Verify all 33 existing tests + new unit and integration tests pass.
   - Run node test `test_phase3_engine.mjs` to verify frontend contract.
