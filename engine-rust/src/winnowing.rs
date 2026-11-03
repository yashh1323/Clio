//! In-process Winnowing fingerprinting algorithm with Inverted Indexing and Broder Containment.
//!
//! Implements local sliding-window fingerprint selection (Schleimer, Wilkerson, Aiken, SIGMOD 2003)
//! with provable t-guarantee, inverted hash indexing for O(N) candidate generation, and
//! asymmetric Broder Containment with localized windowed analysis.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Noise threshold: any match shorter than k words is considered spurious noise.
pub const NOISE_THRESHOLD_K: usize = 5;

/// Guarantee threshold: any matching substring of length >= t words must be detected.
pub const GUARANTEE_THRESHOLD_T: usize = 12;

/// Sliding window size: w = t - k + 1 = 8.
pub const WINDOW_SIZE_W: usize = GUARANTEE_THRESHOLD_T - NOISE_THRESHOLD_K + 1;

/// Maximum postings per fingerprint hash to ignore ubiquitous boilerplate idioms.
pub const MAX_POSTINGS_PER_HASH: usize = 100;

/// Default sliding window block size in fingerprints for localized containment (~90 words).
pub const WINDOW_BLOCK_FINGERPRINTS: usize = 20;

/// Represents a selected Winnowing fingerprint with its 0-indexed word position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Fingerprint {
    pub hash: u64,
    pub position: usize,
}

/// Generates sequential shingle hashes preserving strict text ordering and repetition.
/// Reuses `crate::similarity::hash_shingle` to prevent hash divergence.
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

    // Expected density is 2 / (w + 1) per Theorem 2.2; preallocate capacity accurately
    let expected_capacity = (n * 2) / (WINDOW_SIZE_W + 1) + 16;
    let mut fingerprints = Vec::with_capacity(expected_capacity);

    if n < WINDOW_SIZE_W {
        // Rightmost minimum tie-breaker on short input (using reverse iteration)
        if let Some((min_idx, &min_val)) = shingle_hashes
            .iter()
            .enumerate()
            .rev()
            .min_by_key(|&(_, val)| val)
        {
            fingerprints.push(Fingerprint {
                hash: min_val,
                position: min_idx,
            });
        }
        return fingerprints;
    }

    let mut min_pos: Option<usize> = None;

    for i in 0..=(n - WINDOW_SIZE_W) {
        let window = &shingle_hashes[i..i + WINDOW_SIZE_W];

        // Find minimum hash with rightmost tie-breaker (using <=)
        let mut local_min_idx = 0;
        let mut local_min_val = window[0];
        for j in 1..WINDOW_SIZE_W {
            if window[j] <= local_min_val {
                local_min_val = window[j];
                local_min_idx = j;
            }
        }
        let absolute_pos = i + local_min_idx;

        // Record fingerprint only when minimum changes or moves out of window
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
/// returns `(C(A ⊆ B), C(B ⊆ A))`
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sequential_shingle_matches_similarity_hash() {
        let words = vec!["the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"];
        let seq = generate_sequential_shingles(&words, 5);
        assert_eq!(seq.len(), 5);
        assert_eq!(seq[0], crate::similarity::hash_shingle(&words[0..5]));
        assert_eq!(seq[1], crate::similarity::hash_shingle(&words[1..6]));
    }

    #[test]
    fn test_winnowing_short_input_rightmost_tie_break() {
        let hashes = vec![500, 200, 200];
        let fps = winnow_shingle_hashes(&hashes);
        assert_eq!(fps.len(), 1);
        assert_eq!(fps[0].hash, 200);
        assert_eq!(fps[0].position, 2); // Rightmost occurrence at index 2
    }

    #[test]
    fn test_winnowing_guarantee_12_words() {
        let text_a = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar";
        let text_b = "zulu yankee x-ray alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima victor whiskey";

        let words_a: Vec<&str> = text_a.split_whitespace().collect();
        let words_b: Vec<&str> = text_b.split_whitespace().collect();

        let shingles_a = generate_sequential_shingles(&words_a, NOISE_THRESHOLD_K);
        let shingles_b = generate_sequential_shingles(&words_b, NOISE_THRESHOLD_K);

        let fps_a = winnow_shingle_hashes(&shingles_a);
        let fps_b = winnow_shingle_hashes(&shingles_b);

        let set_a: HashSet<u64> = fps_a.iter().map(|f| f.hash).collect();
        let set_b: HashSet<u64> = fps_b.iter().map(|f| f.hash).collect();

        let shared: Vec<_> = set_a.intersection(&set_b).collect();
        assert!(!shared.is_empty(), "At least one fingerprint must match for >= 12 shared words");
    }

    #[test]
    fn test_inverted_index_deduplication_and_no_self_pairs() {
        let mut idx = InvertedFingerprintIndex::new();
        let fps_1 = vec![
            Fingerprint { hash: 42, position: 0 },
            Fingerprint { hash: 42, position: 5 }, // Repetitive text with identical hash
            Fingerprint { hash: 99, position: 10 },
        ];
        let fps_2 = vec![
            Fingerprint { hash: 42, position: 2 },
            Fingerprint { hash: 99, position: 8 },
        ];

        idx.insert(0, &fps_1);
        idx.insert(1, &fps_2);

        let candidates = idx.find_candidate_pairs(2);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].0, 0);
        assert_eq!(candidates[0].1, 1);
        assert_eq!(candidates[0].2, 2); // Shares exactly 2 distinct hashes (42 and 99)
    }

    #[test]
    fn test_windowed_containment_and_guards() {
        let fps = vec![
            Fingerprint { hash: 10, position: 0 },
            Fingerprint { hash: 20, position: 1 },
            Fingerprint { hash: 30, position: 2 },
            Fingerprint { hash: 40, position: 3 },
            Fingerprint { hash: 50, position: 4 },
        ];
        let mut set = HashSet::new();
        set.insert(20);
        set.insert(30);

        // Guard against zero window
        assert_eq!(calculate_windowed_containment(&fps, &set, 0), 0.0);
        // Window of 2 over [20, 30] should be 1.0 (100%)
        let win_score = calculate_windowed_containment(&fps, &set, 2);
        assert!((win_score - 1.0).abs() < 1e-6);
    }
}
