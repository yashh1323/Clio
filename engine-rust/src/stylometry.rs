//! Single-document intrinsic stylometry: length-invariant Yule's K and windowed Burrows' Delta.
//!
//! Evaluates internal stylistic consistency without requiring cross-document candidate corpora:
//! 1. Udny Yule's Characteristic K provides a length-invariant mathematical metric of vocabulary richness.
//! 2. Windowed Burrows' Delta analyzes function word frequency shifts across sliding windows to identify
//!    patchwriting, ghostwritten sections, and un-cited foreign prose.

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
    /// Indices of windows exhibiting statistical register fracture (Delta > 1.8).
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

/// Computes length-invariant Yule's Characteristic K with O(V) auxiliary heap memory.
///
/// Mathematical formulation:
/// K = 10^4 * (S_2 - S_1) / (S_1^2)
/// where S_1 = \sum f(i) = total_words, S_2 = \sum f(i)^2.
/// Under Poisson word occurrence models, E[K] is strictly invariant to document length.
/// Note: Words must be normalized, lowercased tokens.
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
/// Note: Words must be normalized, lowercased tokens.
pub fn burrows_delta_windowed(
    words: &[&str],
    window_size: usize,
    stride: usize,
) -> StylometricProfile {
    let yules_k = calculate_yules_k(words);
    let total_words = words.len();

    if total_words < window_size || window_size == 0 || stride == 0 {
        let is_anomalous = total_words >= 100 && !(25.0..=180.0).contains(&yules_k);
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
    let mut active_features = 0usize;
    for i in 0..50 {
        baseline_freqs[i] = (baseline_counts[i] as f64) / total_w;
        if baseline_counts[i] > 0 {
            active_features += 1;
        }
    }
    let denom_features = active_features.max(10) as f64;

    // 2. Evaluate sliding windows using running accumulators (zero heap allocations for deltas)
    let mut delta_max = 0.0f64;
    let mut delta_sum = 0.0f64;
    let mut total_windows = 0usize;
    let mut anomalous_windows = Vec::new();
    let win_len = window_size as f64;

    for (win_idx, chunk) in mapped_words
        .windows(window_size)
        .step_by(stride)
        .enumerate()
    {
        let mut win_counts = [0usize; 50];
        for &idx in chunk {
            if (idx as usize) < 50 {
                win_counts[idx as usize] += 1;
            }
        }

        let mut delta = 0.0f64;
        for i in 0..50 {
            if baseline_counts[i] > 0 {
                let expected = win_len * baseline_freqs[i];
                let observed = win_counts[i] as f64;
                let sigma = expected.sqrt().max(0.5);
                let z = (observed - expected).abs() / sigma;
                delta += z;
            }
        }
        delta /= denom_features;

        if delta > 1.8 {
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

    let is_anomalous =
        !anomalous_windows.is_empty() || (total_words >= 100 && !(25.0..=180.0).contains(&yules_k));

    let mut risk_score = 10;
    if !anomalous_windows.is_empty() {
        risk_score += (anomalous_windows.len() * 20).min(60) as i32;
    }
    if delta_max > 1.8 {
        risk_score += 20;
    }
    if total_words >= 100 && !(25.0..=180.0).contains(&yules_k) {
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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_yules_k_short_text_guard() {
        let short_words = vec!["the", "quick", "brown", "fox"];
        let k = calculate_yules_k(&short_words);
        assert_eq!(k, 0.0);
    }

    #[test]
    fn test_yules_k_length_invariance_large_corpus() {
        // Base vocabulary of 100 distinct words with realistic frequencies
        let vocab = [
            "the",
            "of",
            "and",
            "to",
            "a",
            "in",
            "that",
            "is",
            "was",
            "he",
            "for",
            "it",
            "with",
            "as",
            "his",
            "on",
            "be",
            "at",
            "by",
            "i",
            "this",
            "had",
            "not",
            "are",
            "but",
            "from",
            "or",
            "have",
            "an",
            "they",
            "which",
            "one",
            "you",
            "were",
            "her",
            "all",
            "she",
            "there",
            "would",
            "their",
            "we",
            "him",
            "been",
            "has",
            "when",
            "who",
            "will",
            "more",
            "no",
            "if",
            "history",
            "science",
            "nature",
            "thought",
            "power",
            "water",
            "light",
            "time",
            "world",
            "state",
            "system",
            "structure",
            "theory",
            "process",
            "change",
            "action",
            "form",
            "life",
            "order",
            "law",
            "knowledge",
            "reason",
            "mind",
            "matter",
            "force",
            "motion",
            "energy",
            "space",
            "point",
            "line",
            "plane",
            "solid",
            "circle",
            "sphere",
            "triangle",
            "number",
            "figure",
            "ratio",
            "proportion",
            "measure",
            "quantity",
            "quality",
            "relation",
            "cause",
            "effect",
            "substance",
            "accident",
            "mode",
            "idea",
            "truth",
        ];

        // Construct 5,000-word corpus D
        let mut d_words = Vec::with_capacity(5000);
        for i in 0..5000 {
            d_words.push(vocab[i % vocab.len()]);
        }

        // Construct 10,000-word doubled corpus D . D
        let mut dd_words = Vec::with_capacity(10000);
        dd_words.extend_from_slice(&d_words);
        dd_words.extend_from_slice(&d_words);

        let k_d = calculate_yules_k(&d_words);
        let k_dd = calculate_yules_k(&dd_words);

        // For N = 5000, |K(D) - K(D . D)| = 5000 / N = 1.0
        let diff = (k_d - k_dd).abs();
        assert!(
            diff <= 1.0,
            "Yule's K must satisfy mathematical length-invariance bound (|{k_d} - {k_dd}| = {diff} <= 1.0)"
        );
    }

    #[test]
    fn test_burrows_delta_homogeneous_text() {
        // Construct an 800-word homogeneous document with natural, varied vocabulary
        let paragraphs = [
            "the",
            "student",
            "wrote",
            "an",
            "extensive",
            "essay",
            "about",
            "the",
            "history",
            "of",
            "science",
            "and",
            "it",
            "was",
            "evident",
            "that",
            "his",
            "core",
            "arguments",
            "were",
            "well",
            "grounded",
            "in",
            "empirical",
            "observations",
            "from",
            "the",
            "seventeenth",
            "century",
            "which",
            "he",
            "carefully",
            "analyzed",
            "in",
            "the",
            "university",
            "archives",
            "with",
            "keen",
            "attention",
            "to",
            "original",
            "manuscripts",
            "and",
            "scholarly",
            "records",
            "discovered",
            "during",
            "his",
            "research",
            "in",
            "subsequent",
            "chapters",
            "he",
            "examined",
            "how",
            "experimental",
            "philosophy",
            "gradually",
            "replaced",
            "scholastic",
            "traditions",
            "across",
            "western",
            "europe",
            "fostering",
            "new",
            "methodologies",
            "that",
            "prioritized",
            "reproducible",
            "measurements",
            "over",
            "dogmatic",
            "assertions",
            "thereby",
            "laying",
            "the",
            "intellectual",
            "foundations",
            "for",
            "modern",
            "scientific",
            "inquiry",
            "and",
            "transforming",
            "human",
            "understanding",
            "of",
            "natural",
            "phenomena",
            "through",
            "rigorous",
            "mathematical",
            "formulations",
            "and",
            "systematic",
            "verification",
        ];

        let mut words = Vec::new();
        for _ in 0..10 {
            words.extend_from_slice(&paragraphs);
        }
        assert!(words.len() >= 800);

        let profile = burrows_delta_windowed(&words, 250, 50);
        assert!(
            profile.burrows_delta_max < 1.5,
            "Homogeneous text delta max should remain below 1.5 (actual: {})",
            profile.burrows_delta_max
        );
        assert!(
            !profile.is_anomalous,
            "Homogeneous text should not be flagged anomalous"
        );
        assert!(
            profile.anomalous_windows.is_empty(),
            "No anomalous windows expected"
        );
        assert!(profile.risk_score <= 20, "Risk score should be low");
    }

    #[test]
    fn test_burrows_delta_detects_patchwriting_insertion() {
        // Natural student prose (informal, personal pronouns, conversational register)
        let student_prose = [
            "i",
            "think",
            "that",
            "we",
            "should",
            "really",
            "look",
            "at",
            "how",
            "people",
            "live",
            "and",
            "what",
            "they",
            "do",
            "every",
            "day",
            "because",
            "in",
            "my",
            "opinion",
            "it",
            "is",
            "very",
            "important",
            "for",
            "us",
            "to",
            "understand",
            "one",
            "another",
            "and",
            "we",
            "know",
            "that",
            "you",
            "cannot",
            "just",
            "guess",
            "what",
            "someone",
            "feels",
            "when",
            "they",
            "are",
            "struggling",
            "with",
            "their",
            "own",
            "problems",
        ];

        let mut words = Vec::new();
        // 400 words of student prose
        for _ in 0..8 {
            words.extend_from_slice(&student_prose);
        }

        // Foreign academic excerpt (dense nominalizations, passive function words)
        let foreign_prose = [
            "the",
            "methodological",
            "framework",
            "of",
            "the",
            "investigation",
            "was",
            "predicated",
            "on",
            "the",
            "empirical",
            "observation",
            "that",
            "the",
            "frequency",
            "of",
            "the",
            "phenomenon",
            "exhibits",
            "a",
            "statistically",
            "significant",
            "correlation",
            "with",
            "the",
            "variance",
            "of",
            "the",
            "independent",
            "variables",
            "as",
            "demonstrated",
            "by",
            "the",
            "analytical",
            "derivations",
            "of",
            "the",
            "authors",
            "in",
            "the",
            "preceding",
            "treatise",
            "on",
            "the",
            "structural",
            "dynamics",
            "of",
            "the",
            "system",
        ];

        // Insert 300 words of foreign academic prose
        for _ in 0..6 {
            words.extend_from_slice(&foreign_prose);
        }

        // Return to 400 words of student prose
        for _ in 0..8 {
            words.extend_from_slice(&student_prose);
        }

        let profile = burrows_delta_windowed(&words, 250, 50);
        assert!(
            profile.burrows_delta_max > 1.8,
            "Burrows Delta must identify register fracture seam (actual delta max: {})",
            profile.burrows_delta_max
        );
        assert!(
            !profile.anomalous_windows.is_empty(),
            "Must flag anomalous windows where academic excerpt was injected"
        );
        assert!(profile.is_anomalous, "Profile must be flagged as anomalous");
        assert!(
            profile.risk_score >= 50,
            "Risk score should reflect anomalous insertion (actual: {})",
            profile.risk_score
        );
    }

    #[test]
    fn test_burrows_delta_zero_window_guard() {
        let words = vec!["the", "world", "is", "large"];
        let profile = burrows_delta_windowed(&words, 0, 50);
        assert_eq!(profile.burrows_delta_max, 0.0);
        assert!(!profile.is_anomalous);
    }

    #[test]
    fn test_audit_stylometry_flow() {
        let content = "<p>This is a test essay written by the student to verify the end to end stylometry pipeline.</p>";
        let resp = audit_stylometry(content);
        assert!(resp.word_count > 10);
        assert_eq!(resp.total_windows, 0); // Fewer than 250 words
    }
}
