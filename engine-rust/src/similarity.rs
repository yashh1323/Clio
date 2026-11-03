//! High-performance text similarity module using zero-copy n-gram shingles,
//! MinHash signatures (128 hash functions), Locality-Sensitive Hashing (LSH),
//! and Rayon data parallelism.

use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

/// Number of hash functions for MinHash signature vector.
pub const NUM_HASHES: usize = 128;
/// Number of rows per LSH band.
pub const ROWS_PER_BAND: usize = 2;
/// Number of LSH bands (NUM_BANDS * ROWS_PER_BAND = NUM_HASHES).
pub const NUM_BANDS: usize = 64;

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static HTML_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<[^>]*>").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&[a-z]+;|&#\d+;|&#x[0-9a-f]+;").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static PUNCT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}\s]").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static MULTI_SPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("valid regex"));

/// Precomputed pseudo-random seeds for MinHash universal hashing (Weyl sequence / SplitMix64).
pub const HASH_SEEDS: [u64; NUM_HASHES] = {
    let mut seeds = [0u64; NUM_HASHES];
    let mut state: u64 = 0x853c_49e6_748f_ea9b;
    let mut i = 0;
    while i < NUM_HASHES {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        seeds[i] = z ^ (z >> 31);
        i += 1;
    }
    seeds
};

/// Universal 64-bit mixer function.
#[inline]
pub fn mix64(mut x: u64, seed: u64) -> u64 {
    x ^= seed;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    x ^= x >> 33;
    x
}

/// SubmissionInput represents a student essay submission ingested for similarity analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmissionInput {
    /// Submission ID.
    pub id: String,
    /// Assignment title or identifier.
    pub assignment: String,
    /// Student display name.
    #[serde(default)]
    pub student: String,
    /// Student username.
    #[serde(default)]
    pub username: String,
    /// Raw HTML or plain text essay content.
    pub content: String,
}

/// StudentRef contains public identification metadata for a student in a similarity pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StudentRef {
    /// Submission ID.
    pub id: String,
    /// Student display name.
    pub student: String,
    /// Student username.
    pub username: String,
}

/// SimilarityPair details a pair of submissions exceeding the similarity threshold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SimilarityPair {
    /// First submission reference.
    pub submission1: StudentRef,
    /// Second submission reference.
    pub submission2: StudentRef,
    /// Jaccard similarity percentage (0 - 100).
    pub similarity: i32,
    /// Count of shared n-gram shingles.
    #[serde(rename = "sharedShingles")]
    pub shared_shingles: usize,
    /// Asymmetric containment of submission 1 inside submission 2 (0.0 - 1.0).
    #[serde(rename = "containment1In2", default)]
    pub containment_1_in_2: f64,
    /// Asymmetric containment of submission 2 inside submission 1 (0.0 - 1.0).
    #[serde(rename = "containment2In1", default)]
    pub containment_2_in_1: f64,
    /// Maximum containment observed (global or windowed block, 0.0 - 1.0).
    #[serde(rename = "maxContainment", default)]
    pub max_containment: f64,
    /// Count of shared Winnowing fingerprints.
    #[serde(rename = "sharedFingerprints", default)]
    pub shared_fingerprints: usize,
    /// Assignment title.
    pub assignment: String,
}

/// AnalyzeRequest encapsulates the payload passed to the similarity engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AnalyzeRequest {
    /// Submissions to compare.
    pub submissions: Vec<SubmissionInput>,
    /// Minimum similarity percentage to report (default: 25).
    #[serde(default)]
    pub threshold: Option<i32>,
    /// Minimum asymmetric containment ratio to report (0.0 - 1.0, default: 0.20).
    #[serde(rename = "containmentThreshold", default)]
    pub containment_threshold: Option<f64>,
    /// Shingle n-gram size in words (default: 4).
    #[serde(rename = "shingleSize", default)]
    pub shingle_size: Option<usize>,
}

/// AnalyzeResponse delivers similarity metrics and detected pairs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeResponse {
    /// Detected high-similarity pairs (sorted descending, capped at 50).
    pub pairs: Vec<SimilarityPair>,
    /// Total possible pairs for assignments with >= 2 submissions.
    #[serde(rename = "totalPossiblePairs")]
    pub total_possible_pairs: usize,
    /// Total candidate comparisons evaluated.
    #[serde(rename = "comparisonsMade")]
    pub comparisons_made: usize,
    /// Total comparisons alias for backward compatibility.
    #[serde(rename = "totalComparisons")]
    pub total_comparisons: usize,
    /// Minimum similarity threshold applied.
    pub threshold: i32,
    /// Execution method identifier.
    pub method: String,
}

/// Normalizes raw submission text or HTML.
pub fn clean_text(raw: &str) -> String {
    let s = HTML_TAG_RE.replace_all(raw, " ");
    let s = ENTITY_RE.replace_all(&s, " ");
    let s = PUNCT_RE.replace_all(&s, "");
    let s = s.to_lowercase();
    let s = MULTI_SPACE_RE.replace_all(&s, " ");
    s.trim().to_string()
}

/// Splits cleaned text into non-empty word slices zero-copy.
pub fn extract_words(cleaned: &str) -> Vec<&str> {
    cleaned.split_whitespace().collect()
}

/// Computes a 64-bit FNV-1a hash for a sequence of words with space separators without allocating.
pub fn hash_shingle(words: &[&str]) -> u64 {
    const FNV_OFFSET_BASIS: u64 = 14695981039346656037;
    const FNV_PRIME: u64 = 1099511628211;

    let mut h = FNV_OFFSET_BASIS;
    for (i, word) in words.iter().enumerate() {
        if i > 0 {
            h ^= b' ' as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        for &b in word.as_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
    }
    h
}

/// Generates n-gram shingle hash set and unique keys from a word slice.
pub fn generate_shingles(words: &[&str], n: usize) -> (HashSet<u64>, Vec<u64>) {
    let n = if n == 0 { 4 } else { n };
    let mut shingle_set = HashSet::new();
    let mut shingle_keys = Vec::new();

    if words.len() < n {
        return (shingle_set, shingle_keys);
    }

    for window in words.windows(n) {
        let key = hash_shingle(window);
        if shingle_set.insert(key) {
            shingle_keys.push(key);
        }
    }

    (shingle_set, shingle_keys)
}

/// Generates a MinHash signature vector (128 hash functions) for a set of shingle keys.
pub fn compute_minhash_signature(shingle_keys: &[u64]) -> [u64; NUM_HASHES] {
    let mut sig = [u64::MAX; NUM_HASHES];
    if shingle_keys.is_empty() {
        return sig;
    }

    for &key in shingle_keys {
        for (i, seed) in HASH_SEEDS.iter().enumerate() {
            let h = mix64(key, *seed);
            if h < sig[i] {
                sig[i] = h;
            }
        }
    }

    sig
}

/// Intermediate preprocessed submission with fast lookup sets and MinHash signature.
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

/// Analyzes a corpus of submissions and detects similarity pairs using MinHash and LSH.
pub fn analyze_corpus(req: &AnalyzeRequest) -> AnalyzeResponse {
    let threshold = req.threshold.unwrap_or(25).max(1);
    let shingle_size = req.shingle_size.unwrap_or(4).max(1);
    let effective_containment_threshold =
        req.containment_threshold.unwrap_or(0.20).clamp(0.01, 1.0);

    if req.submissions.len() < 2 {
        return AnalyzeResponse {
            pairs: Vec::new(),
            total_possible_pairs: 0,
            comparisons_made: 0,
            total_comparisons: 0,
            threshold,
            method: "minhash_lsh".to_string(),
        };
    }

    // 1. Preprocess submissions in parallel with Rayon
    let processed: Vec<ProcessedSubmission> = req
        .submissions
        .par_iter()
        .map(|s| {
            let cleaned = clean_text(&s.content);
            let words = extract_words(&cleaned);
            let word_count = words.len();
            let (shingles, shingle_keys) = generate_shingles(&words, shingle_size);
            let minhash_sig = compute_minhash_signature(&shingle_keys);

            // Winnowing sequential shingles and fingerprint extraction
            let seq_shingles = crate::winnowing::generate_sequential_shingles(
                &words,
                crate::winnowing::NOISE_THRESHOLD_K,
            );
            let fingerprints = crate::winnowing::winnow_shingle_hashes(&seq_shingles);
            let mut fingerprint_set = HashSet::with_capacity(fingerprints.len());
            for fp in &fingerprints {
                fingerprint_set.insert(fp.hash);
            }

            let student_name = if !s.student.is_empty() {
                s.student.clone()
            } else if !s.username.is_empty() {
                s.username.clone()
            } else {
                "Unknown".to_string()
            };

            ProcessedSubmission {
                id: s.id.clone(),
                assignment: s.assignment.clone(),
                student: student_name,
                username: s.username.clone(),
                word_count,
                shingles,
                minhash_sig,
                fingerprints,
                fingerprint_set,
            }
        })
        .collect();

    // Group submissions by assignment
    let mut by_assignment: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, p) in processed.iter().enumerate() {
        if p.word_count >= 20 {
            by_assignment
                .entry(p.assignment.clone())
                .or_default()
                .push(idx);
        }
    }

    // Calculate totalEligiblePairs based on valid submissions per assignment
    let mut total_eligible_pairs = 0;
    for indices in by_assignment.values() {
        let count = indices.len();
        if count > 1 {
            total_eligible_pairs += count * (count - 1) / 2;
        }
    }

    // 2. Candidate Pair Detection via LSH Banding
    let mut candidate_pair_map: HashMap<(usize, usize), ()> = HashMap::new();

    for (assignment, indices) in &by_assignment {
        let n = indices.len();
        if n < 2 {
            continue;
        }

        // For classroom cohorts (<= 60 submissions), evaluate all pairs for 100% recall
        if n <= 60 {
            for i in 0..n {
                for j in (i + 1)..n {
                    let mut idx_a = indices[i];
                    let mut idx_b = indices[j];
                    if processed[idx_a].id == processed[idx_b].id {
                        continue;
                    }
                    if idx_a > idx_b {
                        std::mem::swap(&mut idx_a, &mut idx_b);
                    }
                    candidate_pair_map.insert((idx_a, idx_b), ());
                }
            }
            continue;
        }

        // For larger cohorts, index into LSH band buckets AND Inverted Winnowing Fingerprint Index
        let mut buckets: HashMap<(String, usize, u64), Vec<usize>> = HashMap::new();
        let mut inv_index = crate::winnowing::InvertedFingerprintIndex::new();

        for &idx in indices {
            // Index into MinHash LSH bands
            let sig = &processed[idx].minhash_sig;
            for b in 0..NUM_BANDS {
                let r1 = sig[b * ROWS_PER_BAND];
                let r2 = sig[b * ROWS_PER_BAND + 1];
                let band_hash = mix64(r1 ^ r2.wrapping_mul(0x9e37_79b9_7f4a_7c15), b as u64);
                buckets
                    .entry((assignment.clone(), b, band_hash))
                    .or_default()
                    .push(idx);
            }

            // Index into Winnowing Inverted Index
            inv_index.insert(idx, &processed[idx].fingerprints);
        }

        // Add MinHash LSH collision candidate pairs
        for members in buckets.values() {
            if members.len() < 2 {
                continue;
            }
            for i in 0..members.len() {
                for j in (i + 1)..members.len() {
                    let mut idx_a = members[i];
                    let mut idx_b = members[j];
                    if processed[idx_a].id == processed[idx_b].id {
                        continue;
                    }
                    if idx_a > idx_b {
                        std::mem::swap(&mut idx_a, &mut idx_b);
                    }
                    candidate_pair_map.insert((idx_a, idx_b), ());
                }
            }
        }

        // Add Winnowing candidate pairs (sharing >= 3 fingerprints guarantees verbatim passages)
        for (idx_a, idx_b, _) in inv_index.find_candidate_pairs(3) {
            let pair = (idx_a.min(idx_b), idx_a.max(idx_b));
            if processed[pair.0].id != processed[pair.1].id {
                candidate_pair_map.insert(pair, ());
            }
        }
    }

    // 3. Evaluate candidate pairs in parallel with Rayon
    let comparisons_made = candidate_pair_map.len();
    let candidate_pairs: Vec<(usize, usize)> = candidate_pair_map.into_keys().collect();

    let mut pairs: Vec<SimilarityPair> = candidate_pairs
        .par_iter()
        .filter_map(|&(idx_a, idx_b)| {
            let a = &processed[idx_a];
            let b = &processed[idx_b];

            if a.id == b.id {
                return None;
            }
            if a.assignment != b.assignment {
                return None;
            }
            if a.word_count < 20 || b.word_count < 20 {
                return None;
            }

            // Exact Jaccard: |A ∩ B| / |A ∪ B|
            let intersection = a.shingles.iter().filter(|k| b.shingles.contains(k)).count();
            let union = a.shingles.len() + b.shingles.len() - intersection;
            let similarity = if union > 0 {
                ((intersection as f64 / union as f64) * 100.0).round() as i32
            } else {
                0
            };

            // Asymmetric Broder Containment: C(A ⊆ B) & C(B ⊆ A)
            let (c_1_in_2, c_2_in_1) =
                crate::winnowing::calculate_set_containment(&a.fingerprint_set, &b.fingerprint_set);
            let global_containment = c_1_in_2.max(c_2_in_1);

            // Localized windowed block containment to catch dense passages in large essays
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

            let shared_fingerprints = a.fingerprint_set.intersection(&b.fingerprint_set).count();

            // Retain pair if Jaccard similarity OR asymmetric containment meets threshold
            let is_match =
                similarity >= threshold || max_containment >= effective_containment_threshold;

            if is_match {
                Some(SimilarityPair {
                    submission1: StudentRef {
                        id: a.id.clone(),
                        student: a.student.clone(),
                        username: a.username.clone(),
                    },
                    submission2: StudentRef {
                        id: b.id.clone(),
                        student: b.student.clone(),
                        username: b.username.clone(),
                    },
                    similarity,
                    shared_shingles: intersection,
                    containment_1_in_2: (c_1_in_2 * 1000.0).round() / 1000.0,
                    containment_2_in_1: (c_2_in_1 * 1000.0).round() / 1000.0,
                    max_containment: (max_containment * 1000.0).round() / 1000.0,
                    shared_fingerprints,
                    assignment: a.assignment.clone(),
                })
            } else {
                None
            }
        })
        .collect();

    // 4. Sort descending by composite severity (max of Jaccard similarity or scaled containment)
    let pair_score = |p: &SimilarityPair| -> i32 {
        p.similarity.max((p.max_containment * 100.0).round() as i32)
    };

    pairs.sort_by(|a, b| {
        pair_score(b)
            .cmp(&pair_score(a))
            .then_with(|| b.shared_fingerprints.cmp(&a.shared_fingerprints))
            .then_with(|| b.shared_shingles.cmp(&a.shared_shingles))
            .then_with(|| b.similarity.cmp(&a.similarity))
            .then_with(|| a.submission1.id.cmp(&b.submission1.id))
            .then_with(|| a.submission2.id.cmp(&b.submission2.id))
    });

    // Cap at top 50
    pairs.truncate(50);

    AnalyzeResponse {
        pairs,
        total_possible_pairs: total_eligible_pairs,
        comparisons_made,
        total_comparisons: comparisons_made,
        threshold,
        method: "minhash_lsh".to_string(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_text_and_extract_words() {
        let raw = "<p>This is a <b>test</b> submission! It has HTML &amp; punctuation.</p>";
        let cleaned = clean_text(raw);
        let words = extract_words(&cleaned);
        let expected = vec![
            "this",
            "is",
            "a",
            "test",
            "submission",
            "it",
            "has",
            "html",
            "punctuation",
        ];
        assert_eq!(words, expected);
    }

    #[test]
    fn test_generate_shingles() {
        let words = vec!["the", "quick", "brown", "fox", "jumps", "over"];
        let (shingles, keys) = generate_shingles(&words, 4);
        assert_eq!(shingles.len(), 3);
        assert_eq!(keys.len(), 3);

        let expected_key = hash_shingle(&["the", "quick", "brown", "fox"]);
        assert!(shingles.contains(&expected_key));
    }

    #[test]
    fn test_analyze_identical_submissions() {
        let essay = "The Industrial Revolution marked a period of rapid technological change, transforming rural societies in Europe and America into industrialized, urban societies through steam power and iron manufacturing.";
        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "sub-1".into(),
                    assignment: "History 101".into(),
                    student: "Alice Smith".into(),
                    username: "alice".into(),
                    content: essay.into(),
                },
                SubmissionInput {
                    id: "sub-2".into(),
                    assignment: "History 101".into(),
                    student: "Bob Jones".into(),
                    username: "bob".into(),
                    content: essay.into(),
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 1);
        assert_eq!(res.pairs[0].similarity, 100);
        assert_eq!(res.total_possible_pairs, 1);
    }

    #[test]
    fn test_analyze_different_assignments() {
        let essay = "The Industrial Revolution marked a period of rapid technological change, transforming rural societies in Europe and America into industrialized, urban societies through steam power and iron manufacturing.";
        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "sub-1".into(),
                    assignment: "History 101".into(),
                    student: "Alice".into(),
                    username: "alice".into(),
                    content: essay.into(),
                },
                SubmissionInput {
                    id: "sub-2".into(),
                    assignment: "Biology 202".into(),
                    student: "Bob".into(),
                    username: "bob".into(),
                    content: essay.into(),
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 0);
    }

    #[test]
    fn test_analyze_short_submissions_skipped() {
        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "sub-1".into(),
                    assignment: "Essay 1".into(),
                    student: "Alice".into(),
                    username: "alice".into(),
                    content: "Too short to analyze".into(),
                },
                SubmissionInput {
                    id: "sub-2".into(),
                    assignment: "Essay 1".into(),
                    student: "Bob".into(),
                    username: "bob".into(),
                    content: "Too short to analyze".into(),
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 0);
    }

    #[test]
    fn test_analyze_high_similarity() {
        let base = "Quantum computing utilizes the principles of superposition and entanglement to perform complex computations vastly faster than classical computers for specific cryptographic and optimization algorithms.";
        let copied =
            format!("{base} Additional unique conclusions added at the end by the second student.");

        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "sub-1".into(),
                    assignment: "Physics 401".into(),
                    student: "Student A".into(),
                    username: "student_a".into(),
                    content: base.into(),
                },
                SubmissionInput {
                    id: "sub-2".into(),
                    assignment: "Physics 401".into(),
                    student: "Student B".into(),
                    username: "student_b".into(),
                    content: copied,
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 1);
        assert!(res.pairs[0].similarity >= 60);
        assert!(res.pairs[0].shared_shingles > 0);
    }

    #[test]
    fn test_analyze_lsh_scalability() {
        let base_text = "Cellular respiration is a metabolic pathway that breaks down glucose and produces adenosine triphosphate through glycolysis and the citric acid cycle.";
        let mut subs = Vec::new();

        for i in 0..80 {
            let content = format!(
                "{base_text} Student essay number {i} with distinct paragraphs describing metabolic pathways in biological cells."
            );
            subs.push(SubmissionInput {
                id: format!("sub-{i}"),
                assignment: "Biology 101".into(),
                student: format!("Student {i}"),
                username: format!("student{i}"),
                content,
            });
        }

        let req = AnalyzeRequest {
            submissions: subs,
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.total_possible_pairs, 3160);
        assert!(!res.pairs.is_empty());
    }

    #[test]
    fn test_analyze_unicode_and_entities() {
        let content = "La educación superior sobre el cambio climático y la física cuántica transforma las sociedades modernas en todo el mundo don&#39;t believe otherwise hoy.";
        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "u1".into(),
                    assignment: "Spanish 101".into(),
                    student: "Estudiante A".into(),
                    username: "est_a".into(),
                    content: content.into(),
                },
                SubmissionInput {
                    id: "u2".into(),
                    assignment: "Spanish 101".into(),
                    student: "Estudiante B".into(),
                    username: "est_b".into(),
                    content: content.into(),
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 1);
        assert_eq!(res.pairs[0].similarity, 100);
    }

    #[test]
    fn test_analyze_same_id_exclusion() {
        let content = "This is a long essay content describing technological progress during eighteenth century industrial revolutions.";
        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "same-id".into(),
                    assignment: "Self Test".into(),
                    student: "Student Alpha".into(),
                    username: "alpha".into(),
                    content: content.into(),
                },
                SubmissionInput {
                    id: "same-id".into(),
                    assignment: "Self Test".into(),
                    student: "Student Alpha".into(),
                    username: "alpha".into(),
                    content: content.into(),
                },
            ],
            threshold: Some(25),
            containment_threshold: None,
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);
        assert_eq!(res.pairs.len(), 0);
    }

    #[test]
    fn test_analyze_needle_in_a_haystack_diluted_plagiarism() {
        // Stolen verbatim passage of ~180 words
        let copied_passage = "\
            The architectural transition from monolithic database management systems to distributed event-driven microservices \
            represents a paradigm shift in software scalability and resilience. By decoupling bounded contexts through asynchronous \
            message brokers, modern applications achieve horizontal elasticity and operational fault isolation. \
            However, this architectural decoupling introduces significant data consistency challenges, necessitating the adoption \
            of eventual consistency, compensating transactions, and distributed consensus algorithms such as Raft and Paxos to \
            maintain state integrity across network partitions. Distributed transactions cannot rely on two-phase commit across \
            heterogeneous cloud environments due to blocking coordinator latency and network unreliability. Therefore, event sourcing \
            and saga orchestration patterns have emerged as the standard industry practice for maintaining eventual consistency across \
            independent relational databases and document stores.";

        // Unique background filler for Essay A (~1,800 words)
        let filler_a = (0..90)
            .map(|i| format!("Chapter {i} explores unique early twentieth century agricultural economics and crop rotation techniques across northern European fertile plains."))
            .collect::<Vec<_>>()
            .join(" ");

        // Unique background filler for Essay B (~2,300 words)
        let filler_b = (0..115)
            .map(|i| format!("Section {i} examines distinct marine biological biodiversity and hydrothermal vent ecosystems situated within oceanic tectonic trenches."))
            .collect::<Vec<_>>()
            .join(" ");

        let essay_a = format!("{filler_a} {copied_passage}");
        let essay_b = format!("{filler_b} {copied_passage}");

        let req = AnalyzeRequest {
            submissions: vec![
                SubmissionInput {
                    id: "essay-a".into(),
                    assignment: "Thesis 500".into(),
                    student: "Alice".into(),
                    username: "alice".into(),
                    content: essay_a,
                },
                SubmissionInput {
                    id: "essay-b".into(),
                    assignment: "Thesis 500".into(),
                    student: "Bob".into(),
                    username: "bob".into(),
                    content: essay_b,
                },
            ],
            threshold: Some(25),               // Jaccard threshold is 25%
            containment_threshold: Some(0.20), // Containment threshold is 20%
            shingle_size: Some(4),
        };

        let res = analyze_corpus(&req);

        // Diluted Jaccard similarity must be < 10% (would fail standard plagiarism detector)
        assert_eq!(
            res.pairs.len(),
            1,
            "Must detect the plagiarized pair despite dilution!"
        );
        let pair = &res.pairs[0];
        assert!(
            pair.similarity < 15,
            "Symmetric Jaccard must be diluted (< 15%), actual: {}",
            pair.similarity
        );
        assert!(
            pair.max_containment >= 0.85,
            "Windowed containment must detect copied passage with >= 85%, actual: {}",
            pair.max_containment
        );
        assert!(
            pair.shared_fingerprints >= 10,
            "Must share Winnowing fingerprints, actual: {}",
            pair.shared_fingerprints
        );
    }
}
