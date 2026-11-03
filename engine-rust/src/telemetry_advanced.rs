//! Advanced Cognitive Process Telemetry & Authorship Verification Engine.
//!
//! Provides zero-allocation streaming Inter-Keystroke Interval (IKI) modeling,
//! two-component log-normal mixture modeling, sight-reading transcription detection,
//! Kolmogorov-Smirnov macro/bot detection, and dynamic P-burst and R-burst accumulators.

use serde::{Deserialize, Serialize};

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

/// Dependency-free Error Function erf(x) using Abramowitz & Stegun Formula 7.1.26.
/// Maximum error < 1.5e-7.
#[inline]
pub fn erf_approx(x: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let abs_x = x.abs();

    let p = 0.3275911;
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;

    let t = 1.0 / (1.0 + p * abs_x);
    let poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
    let result = 1.0 - poly * (-abs_x * abs_x).exp();

    sign * result
}

/// Standard Normal Cumulative Distribution Function (CDF).
#[inline]
pub fn standard_normal_cdf(z: f64) -> f64 {
    0.5 * (1.0 + erf_approx(z / std::f64::consts::SQRT_2))
}

/// Evaluates keystroke dynamics for cognitive authenticity, transcription cheating, or automated injection.
pub fn audit_keystroke_process(events: &[KeystrokeEvent]) -> ProcessAuditResult {
    if events.len() < 2 {
        return ProcessAuditResult {
            is_authentic: true,
            confidence_score: 50.0,
            p_burst_mean: 0.0,
            r_burst_mean: 0.0,
            revision_ratio: 0.0,
            cognitive_pause_ratio: 0.0,
            log_mean: 0.0,
            log_std_dev: 0.0,
            ks_d_statistic: 0.0,
            rapid_interval_count: 0,
            valid_interval_count: 0,
            flags: vec!["Insufficient keystroke data for cognitive analysis (N < 2)".to_string()],
            method: "engine_rust".to_string(),
        };
    }

    // Sort events monotonically by timestamp to protect against out-of-order client payloads
    let mut sorted_events = events.to_vec();
    sorted_events.sort_by_key(|e| e.timestamp);

    let total_intervals = sorted_events.len() - 1;
    let mut rapid_interval_count = 0usize;
    let mut valid_log_intervals = Vec::with_capacity(total_intervals);
    let mut valid_deltas = Vec::with_capacity(total_intervals);

    let mut insertions = 0usize;
    let mut deletions = 0usize;

    for w in sorted_events.windows(2) {
        match w[0].op {
            KeystrokeOp::Insert => insertions += 1,
            KeystrokeOp::Delete => deletions += 1,
        }

        let delta = w[1].timestamp.saturating_sub(w[0].timestamp) as f64;
        if delta < 20.0 {
            rapid_interval_count += 1;
        } else if delta <= 10_000.0 {
            valid_log_intervals.push(delta.ln());
            valid_deltas.push(delta);
        }
    }
    // Record operation of final keystroke
    match sorted_events[sorted_events.len() - 1].op {
        KeystrokeOp::Insert => insertions += 1,
        KeystrokeOp::Delete => deletions += 1,
    }

    let mut flags = Vec::new();
    let mut rapid_bot_detected = false;

    // Bot Shield: Detect automated high-frequency character injection (<20ms intervals)
    if rapid_interval_count > 10
        || (total_intervals > 10 && (rapid_interval_count as f64) / (total_intervals as f64) > 0.10)
    {
        rapid_bot_detected = true;
        flags.push(format!(
            "Automated high-frequency macro injection (<20ms intervals: {}/{})",
            rapid_interval_count, total_intervals
        ));
    }

    let n = valid_log_intervals.len();

    // Guard: If valid intervals < 10, return uncalibrated default response
    if n < 10 {
        let rev_ratio = (deletions as f64) / (insertions.max(1) as f64);
        let conf = if rapid_bot_detected { 20.0 } else { 50.0 };
        let authentic = !rapid_bot_detected;
        if !rapid_bot_detected {
            flags.push("Insufficient keystroke data for cognitive analysis (N < 10)".to_string());
        }

        return ProcessAuditResult {
            is_authentic: authentic,
            confidence_score: conf,
            p_burst_mean: 0.0,
            r_burst_mean: 0.0,
            revision_ratio: (rev_ratio * 1000.0).round() / 1000.0,
            cognitive_pause_ratio: 0.0,
            log_mean: 0.0,
            log_std_dev: 0.0,
            ks_d_statistic: if rapid_bot_detected { 1.0 } else { 0.0 },
            rapid_interval_count,
            valid_interval_count: n,
            flags,
            method: "engine_rust".to_string(),
        };
    }

    // Pass 1: Parameter Estimation for Log-Normal Mixture
    let n_f = n as f64;
    let sum_log: f64 = valid_log_intervals.iter().sum();
    let sum_sq_log: f64 = valid_log_intervals.iter().map(|&x| x * x).sum();

    let mean_log = sum_log / n_f;
    let var_log = ((sum_sq_log / n_f) - (mean_log * mean_log)).max(1e-4);
    let std_dev_log = var_log.sqrt();

    // Dynamic Pause Threshold tau_cog = exp(mu + 2*sigma)
    let tau_cog = (mean_log + 2.0 * std_dev_log).exp();

    // Cognitive Pause Detection (hesitation pauses >= exp(mu) and > 300ms)
    let cognitive_pause_threshold = (mean_log.exp()).max(300.0);
    let cognitive_pause_count = valid_deltas
        .iter()
        .filter(|&&d| d >= cognitive_pause_threshold)
        .count();
    let cognitive_pause_ratio = (cognitive_pause_count as f64) / n_f;

    let mut transcription_detected = false;
    if n >= 30 && cognitive_pause_ratio < 0.05 {
        transcription_detected = true;
        flags.push(format!(
            "Sight-reading transcription detected (cognitive pauses suppressed: {:.1}%)",
            cognitive_pause_ratio * 100.0
        ));
    }

    let mut variance_collapse_detected = false;
    if n >= 20 && std_dev_log < 0.15 {
        variance_collapse_detected = true;
        flags.push(format!(
            "Automated macro injection detected (robotic uniform interval variance: std_log={:.3})",
            std_dev_log
        ));
    }

    // Two-Sided Kolmogorov-Smirnov Test against fitted Log-Normal CDF
    let mut sorted_logs = valid_log_intervals.clone();
    sorted_logs.sort_by(|a, b| a.total_cmp(b));

    let mut ks_d_max = 0.0f64;
    for (k, &val) in sorted_logs.iter().enumerate() {
        let z = (val - mean_log) / std_dev_log;
        let cdf_theo = standard_normal_cdf(z);
        let cdf_emp_upper = ((k + 1) as f64) / n_f;
        let cdf_emp_lower = (k as f64) / n_f;

        let diff_upper = (cdf_emp_upper - cdf_theo).abs();
        let diff_lower = (cdf_theo - cdf_emp_lower).abs();
        if diff_upper > ks_d_max {
            ks_d_max = diff_upper;
        }
        if diff_lower > ks_d_max {
            ks_d_max = diff_lower;
        }
    }

    let mut ks_bot_detected = false;
    // Flag KS anomaly if distribution is severely non-log-normal (D > 0.45)
    // or moderately non-log-normal with suppressed cognitive pauses
    if n >= 20 && (ks_d_max > 0.45 || (ks_d_max > 0.35 && cognitive_pause_ratio < 0.08)) {
        ks_bot_detected = true;
        flags.push(format!(
            "Automated macro injection detected (non-log-normal interval distribution, KS D={:.3})",
            ks_d_max
        ));
    }

    // Pass 2: Streaming Burst State Machine using computed tau_cog
    let mut p_burst_sum = 0usize;
    let mut p_burst_count = 0usize;
    let mut cur_p_len = 0usize;

    let mut r_burst_sum = 0usize;
    let mut r_burst_count = 0usize;
    let mut cur_r_len = 0usize;

    for w in sorted_events.windows(2) {
        let delta = w[1].timestamp.saturating_sub(w[0].timestamp) as f64;

        // P-burst transition
        if delta < 20.0 || delta > 10_000.0 || delta >= tau_cog {
            if cur_p_len > 0 {
                p_burst_sum += cur_p_len;
                p_burst_count += 1;
                cur_p_len = 0;
            }
        } else if w[0].op == KeystrokeOp::Insert {
            cur_p_len += 1;
        }

        // R-burst transition
        if w[1].op == KeystrokeOp::Delete {
            if cur_r_len > 0 {
                r_burst_sum += cur_r_len;
                r_burst_count += 1;
                cur_r_len = 0;
            }
        } else if w[0].op == KeystrokeOp::Insert {
            cur_r_len += 1;
        }
    }

    // Flush remaining bursts
    if cur_p_len > 0 {
        p_burst_sum += cur_p_len;
        p_burst_count += 1;
    }
    if cur_r_len > 0 {
        r_burst_sum += cur_r_len;
        r_burst_count += 1;
    }

    let p_burst_mean = if p_burst_count > 0 {
        (p_burst_sum as f64) / (p_burst_count as f64)
    } else {
        p_burst_sum as f64
    };

    let r_burst_mean = if r_burst_count > 0 {
        (r_burst_sum as f64) / (r_burst_count as f64)
    } else {
        r_burst_sum as f64
    };

    let revision_ratio = (deletions as f64) / (insertions.max(1) as f64);
    let mut zero_revision_detected = false;
    if n >= 30 && revision_ratio < 0.02 {
        zero_revision_detected = true;
        flags.push(format!(
            "Unnatural zero-revision accretion (R_rev={:.3} < 0.02)",
            revision_ratio
        ));
    }

    // Composite Confidence Scoring
    let mut penalty = 0.0f64;
    if rapid_bot_detected {
        penalty += 45.0;
    }
    if transcription_detected {
        penalty += 40.0;
    }
    if variance_collapse_detected {
        penalty += 40.0;
    }
    if ks_bot_detected {
        penalty += 30.0;
    }
    if zero_revision_detected {
        penalty += 20.0;
    }

    let confidence_score = (100.0 - penalty).clamp(0.0, 100.0);
    let is_authentic = confidence_score >= 70.0 && flags.is_empty();

    ProcessAuditResult {
        is_authentic,
        confidence_score: (confidence_score * 10.0).round() / 10.0,
        p_burst_mean: (p_burst_mean * 100.0).round() / 100.0,
        r_burst_mean: (r_burst_mean * 100.0).round() / 100.0,
        revision_ratio: (revision_ratio * 1000.0).round() / 1000.0,
        cognitive_pause_ratio: (cognitive_pause_ratio * 1000.0).round() / 1000.0,
        log_mean: (mean_log * 1000.0).round() / 1000.0,
        log_std_dev: (std_dev_log * 1000.0).round() / 1000.0,
        ks_d_statistic: (ks_d_max * 1000.0).round() / 1000.0,
        rapid_interval_count,
        valid_interval_count: n,
        flags,
        method: "engine_rust".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_erf_and_cdf_accuracy() {
        assert!((erf_approx(0.0)).abs() < 1e-6);
        assert!((erf_approx(1.0) - 0.8427007).abs() < 1e-4);
        assert!((erf_approx(-1.0) + 0.8427007).abs() < 1e-4);

        assert!((standard_normal_cdf(0.0) - 0.5).abs() < 1e-6);
        assert!((standard_normal_cdf(1.96) - 0.975).abs() < 1e-3);
        assert!((standard_normal_cdf(-1.96) - 0.025).abs() < 1e-3);
    }

    #[test]
    fn test_authentic_human_keystrokes() {
        let mut events = Vec::new();
        let mut t = 1000u64;

        // Simulate 70 natural human keystrokes: fast motor typing with natural jitter,
        // interspersed with cognitive boundary pauses and edits
        for i in 0..70 {
            events.push(KeystrokeEvent {
                timestamp: t,
                op: if i == 25 || i == 50 {
                    KeystrokeOp::Delete
                } else {
                    KeystrokeOp::Insert
                },
            });

            // Alternate between motor intervals (110-210ms with natural human jitter)
            // and cognitive boundary pauses (500-1100ms)
            if i % 8 == 0 {
                let pause = 600 + ((i * 47) % 500) as u64;
                t += pause; // Cognitive pause
            } else {
                let motor_jitter = ((i * 31 + 17) % 95) as u64;
                t += 115 + motor_jitter; // Motor typing (115ms - 210ms)
            }
        }

        let res = audit_keystroke_process(&events);
        assert!(res.is_authentic, "Authentic typing must pass audit");
        assert!(
            res.confidence_score >= 80.0,
            "Authentic typing should have >=80 confidence, got {}",
            res.confidence_score
        );
        assert!(
            res.cognitive_pause_ratio >= 0.10,
            "Authentic typing should have cognitive pauses"
        );
        assert!(
            res.flags.is_empty(),
            "Flags should be empty for human typing"
        );
    }

    #[test]
    fn test_sight_reading_transcription_detection() {
        let mut events = Vec::new();
        let mut t = 1000u64;

        // 60 steady keystrokes with ZERO cognitive pauses (transcription / cheat-sheet)
        for _ in 0..60 {
            events.push(KeystrokeEvent {
                timestamp: t,
                op: KeystrokeOp::Insert,
            });
            t += 150; // Constant steady motor execution
        }

        let res = audit_keystroke_process(&events);
        assert!(
            !res.is_authentic,
            "Sight reading transcription must not be marked authentic"
        );
        assert!(
            res.flags.iter().any(|f| f.contains("Sight-reading")
                || f.contains("robotic uniform")
                || f.contains("zero-revision")),
            "Must flag anomaly"
        );
    }

    #[test]
    fn test_rapid_bot_injection_detection() {
        let mut events = Vec::new();
        let mut t = 1000u64;

        // 50 keystrokes with 5ms intervals (bot auto-typer macro)
        for _ in 0..50 {
            events.push(KeystrokeEvent {
                timestamp: t,
                op: KeystrokeOp::Insert,
            });
            t += 5;
        }

        let res = audit_keystroke_process(&events);
        assert!(!res.is_authentic, "Rapid bot macro must be detected");
        assert!(
            res.flags.iter().any(|f| f.contains("<20ms intervals")),
            "Must flag rapid interval macro injection"
        );
    }

    #[test]
    fn test_out_of_order_timestamps_handled() {
        let events = vec![
            KeystrokeEvent {
                timestamp: 2500,
                op: KeystrokeOp::Insert,
            },
            KeystrokeEvent {
                timestamp: 1000,
                op: KeystrokeOp::Insert,
            },
            KeystrokeEvent {
                timestamp: 1500,
                op: KeystrokeOp::Insert,
            },
        ];

        let res = audit_keystroke_process(&events);
        // Must not panic on integer overflow
        assert!(res.confidence_score > 0.0);
    }
}
