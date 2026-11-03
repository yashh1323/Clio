//! Telemetry auditing module for proof-of-write verification.
//!
//! Provides strict timestamp monotonicity verification, paste event detection,
//! verified WPM calculation (excluding pauses > 5s), and server-computed
//! integrity scoring.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::LazyLock;

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static STYLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<style[^>]*>[\s\S]*?</style>").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static SCRIPT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<script[^>]*>[\s\S]*?</script>").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<[^>]*>").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static NBSP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&nbsp;").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&[a-z]+;").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static DEC_ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&#\d+;").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static HEX_ENTITY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)&#x[0-9a-f]+;").expect("valid regex"));

#[expect(
    clippy::expect_used,
    reason = "static regex patterns are statically verified"
)]
static SPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("valid regex"));

/// TelemetrySnapshot represents an incremental snapshot captured during essay drafting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetrySnapshot {
    /// Timestamp in milliseconds.
    pub timestamp: i64,
    /// Optional HTML editor content snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Optional character length self-reported by client.
    #[serde(
        rename = "textLength",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub text_length: Option<f64>,
}

/// PasteEvent records an anomalous rapid insertion of text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PasteEvent {
    /// Index in snapshot sequence where paste was detected.
    pub index: usize,
    /// Delta characters inserted during this step.
    #[serde(rename = "deltaChars")]
    pub delta_chars: i32,
    /// Milliseconds elapsed during this step.
    #[serde(rename = "deltaMs")]
    pub delta_ms: i64,
    /// Timestamp of the snapshot containing the paste.
    pub timestamp: i64,
    /// Explanation of why the paste was flagged.
    pub reason: String,
}

/// AuditRequest encapsulates telemetry snapshots and final content submitted for verification.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AuditRequest {
    /// Ordered snapshots from the client drafting session.
    #[serde(default)]
    pub snapshots: Vec<TelemetrySnapshot>,
    /// Final submitted essay content.
    #[serde(rename = "finalContent", default)]
    pub final_content: Option<String>,
}

/// AuditResult delivers authoritative server-computed proof-of-write metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditResult {
    /// Whether the telemetry stream is structurally valid.
    #[serde(rename = "isValid")]
    pub is_valid: bool,
    /// Whether the submission should be flagged for human instructor review.
    #[serde(rename = "flaggedForReview")]
    pub flagged_for_review: bool,
    /// Rejection or flagging reason when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Authoritatively verified Words Per Minute.
    #[serde(rename = "verifiedWpm")]
    pub verified_wpm: i32,
    /// Number of verified paste events.
    #[serde(rename = "verifiedPasteCount")]
    pub verified_paste_count: i32,
    /// Calculated integrity score (0 - 100).
    #[serde(rename = "integrityScore")]
    pub integrity_score: i32,
    /// Total verified typed characters (excluding pasted blocks).
    #[serde(rename = "typedCharCount")]
    pub typed_char_count: i32,
    /// Active typing duration in milliseconds (pauses > 5s excluded).
    #[serde(rename = "activeTypingTimeMs")]
    pub active_typing_time_ms: i64,
    /// Total number of snapshots evaluated.
    #[serde(rename = "totalSnapshots")]
    pub total_snapshots: usize,
    /// List of detected anomalous paste events.
    #[serde(rename = "pasteEvents")]
    pub paste_events: Vec<PasteEvent>,
    /// Net revision ratio: total characters deleted / total characters inserted (typically 0.0 - 1.0; can exceed 1.0 during heavy redaction).
    #[serde(
        rename = "revisionRatio",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub revision_ratio: Option<f64>,
    /// Peak accretion velocity in characters per second observed during typing.
    #[serde(
        rename = "peakAccretionVelocity",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub peak_accretion_velocity: Option<f64>,
    /// Average accretion velocity in characters per second during active typing.
    #[serde(
        rename = "avgAccretionVelocity",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub avg_accretion_velocity: Option<f64>,
}

/// Monotonicity violation details.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonotonicityViolation {
    /// The index in snapshots where monotonicity failed.
    pub violation_index: usize,
    /// The preceding timestamp.
    pub prev_ts: i64,
    /// The violating current timestamp.
    pub curr_ts: i64,
}

/// Strip HTML tags and entity references, mimicking frontend normalization.
pub fn strip_html(html: &str) -> String {
    let s = STYLE_RE.replace_all(html, "");
    let s = SCRIPT_RE.replace_all(&s, "");
    let s = TAG_RE.replace_all(&s, " ");
    let s = NBSP_RE.replace_all(&s, " ");
    let s = ENTITY_RE.replace_all(&s, " ");
    let s = DEC_ENTITY_RE.replace_all(&s, " ");
    let s = HEX_ENTITY_RE.replace_all(&s, " ");
    let s = SPACE_RE.replace_all(&s, " ");
    s.trim().to_string()
}

/// Calculates normalized text length of final essay content.
pub fn clean_final_content_length(final_content: &str) -> usize {
    strip_html(final_content).chars().count()
}

/// Extracts normalized text character length from a snapshot.
/// Prioritizes actual HTML content when present to prevent client spoofing of textLength.
pub fn get_snapshot_text_length(snap: &TelemetrySnapshot) -> usize {
    if let Some(ref html) = snap.html {
        if !html.is_empty() {
            let stripped = strip_html(html);
            let stripped_len = stripped.chars().count();

            if let Some(tl) = snap.text_length {
                if !tl.is_nan() && !tl.is_infinite() && tl >= 0.0 {
                    let raw_len = tl.floor() as usize;
                    let diff = raw_len.abs_diff(stripped_len);
                    if diff > 50 {
                        // Client textLength contradicts actual HTML text — prefer authoritative HTML length
                        return stripped_len;
                    }
                    return raw_len;
                }
            }
            return stripped_len;
        }
    }

    if let Some(tl) = snap.text_length {
        if !tl.is_nan() && !tl.is_infinite() && tl >= 0.0 {
            return tl.floor() as usize;
        }
    }

    0
}

/// Verifies that an array of timestamps is strictly monotonically increasing.
pub fn is_strictly_monotonic(snapshots: &[TelemetrySnapshot]) -> Result<(), MonotonicityViolation> {
    for i in 1..snapshots.len() {
        let prev_ts = snapshots[i - 1].timestamp;
        let curr_ts = snapshots[i].timestamp;

        if curr_ts <= prev_ts {
            return Err(MonotonicityViolation {
                violation_index: i,
                prev_ts,
                curr_ts,
            });
        }
    }
    Ok(())
}

/// Detects anomalous jumps in character progression using precomputed snapshot character lengths.
fn detect_paste_events_with_lengths(
    snapshots: &[TelemetrySnapshot],
    lengths: &[usize],
) -> Vec<PasteEvent> {
    let mut paste_events = Vec::new();
    if snapshots.is_empty() || lengths.len() != snapshots.len() {
        return paste_events;
    }

    // Check initial snapshot for pre-existing or instant paste text
    let initial_len = lengths[0];
    if initial_len > 15 {
        paste_events.push(PasteEvent {
            index: 0,
            delta_chars: initial_len as i32,
            delta_ms: 0,
            timestamp: snapshots[0].timestamp,
            reason: format!(
                "Initial snapshot contained {initial_len} pre-existing or pasted characters without typing progression"
            ),
        });
    }

    for i in 1..snapshots.len() {
        let prev = &snapshots[i - 1];
        let curr = &snapshots[i];
        let delta_ms = curr.timestamp - prev.timestamp;
        let prev_len = lengths[i - 1] as i32;
        let curr_len = lengths[i] as i32;
        let delta_chars = curr_len - prev_len;

        if delta_chars <= 0 {
            continue;
        }

        let is_quick_jump = delta_chars > 15 && delta_ms < 300;
        let is_block_paste = delta_chars >= 50 && delta_ms <= 2000;
        let is_rapid_jump = delta_chars > 25 && delta_ms < 500;

        if is_quick_jump || is_block_paste || is_rapid_jump {
            let reason = if is_quick_jump {
                format!("Sudden jump of {delta_chars} chars in {delta_ms}ms (<300ms)")
            } else if is_block_paste {
                format!("Large block paste of {delta_chars} chars in {delta_ms}ms")
            } else {
                format!("Rapid jump of {delta_chars} chars in {delta_ms}ms (<500ms)")
            };
            paste_events.push(PasteEvent {
                index: i,
                delta_chars,
                delta_ms,
                timestamp: curr.timestamp,
                reason,
            });
        }
    }

    paste_events
}

/// Detects anomalous jumps in character progression.
pub fn detect_paste_events(snapshots: &[TelemetrySnapshot]) -> Vec<PasteEvent> {
    if snapshots.is_empty() {
        return Vec::new();
    }
    let lengths: Vec<usize> = snapshots.iter().map(get_snapshot_text_length).collect();
    detect_paste_events_with_lengths(snapshots, &lengths)
}

/// Performs high-speed, cryptographically monotonic server-side proof-of-write verification.
pub fn audit_telemetry(
    snapshots: &[TelemetrySnapshot],
    final_content: Option<&str>,
) -> AuditResult {
    // 1. Check for absent telemetry snapshots
    if snapshots.is_empty() {
        return AuditResult {
            is_valid: false,
            flagged_for_review: true,
            reason: Some("Telemetry snapshots are completely absent".to_string()),
            verified_wpm: 0,
            verified_paste_count: 0,
            integrity_score: 25,
            typed_char_count: 0,
            active_typing_time_ms: 0,
            total_snapshots: 0,
            paste_events: Vec::new(),
            revision_ratio: None,
            peak_accretion_velocity: None,
            avg_accretion_velocity: None,
        };
    }

    // 2. Validate timestamps
    for (i, s) in snapshots.iter().enumerate() {
        if s.timestamp <= 0 {
            return AuditResult {
                is_valid: false,
                flagged_for_review: true,
                reason: Some(format!(
                    "Invalid non-numeric or non-positive timestamp at index {i}"
                )),
                verified_wpm: 0,
                verified_paste_count: 0,
                integrity_score: 20,
                typed_char_count: 0,
                active_typing_time_ms: 0,
                total_snapshots: snapshots.len(),
                paste_events: Vec::new(),
                revision_ratio: None,
                peak_accretion_velocity: None,
                avg_accretion_velocity: None,
            };
        }
    }

    // 3. Verify strict timestamp monotonicity
    if let Err(violation) = is_strictly_monotonic(snapshots) {
        return AuditResult {
            is_valid: false,
            flagged_for_review: true,
            reason: Some(format!(
                "Non-monotonic timestamp at index {} ({} <= {})",
                violation.violation_index, violation.curr_ts, violation.prev_ts
            )),
            verified_wpm: 0,
            verified_paste_count: 0,
            integrity_score: 20,
            typed_char_count: 0,
            active_typing_time_ms: 0,
            total_snapshots: snapshots.len(),
            paste_events: Vec::new(),
            revision_ratio: None,
            peak_accretion_velocity: None,
            avg_accretion_velocity: None,
        };
    }

    // Precompute snapshot text lengths once across the entire audit pipeline
    let snap_lengths: Vec<usize> = snapshots.iter().map(get_snapshot_text_length).collect();
    let final_content_str = final_content.unwrap_or("");
    let clean_content_len = clean_final_content_length(final_content_str);

    // 4. Single-snapshot edge case
    if snapshots.len() == 1 {
        let single_len = snap_lengths[0];
        let effective_len = single_len.max(clean_content_len);
        let has_substantial_text = effective_len > 15;
        let reason = if has_substantial_text {
            "Single snapshot with substantial text indicates instantaneous paste without typing telemetry"
        } else {
            "Single snapshot provides insufficient progression data"
        };
        let score = if has_substantial_text { 30 } else { 50 };
        let mut events = Vec::new();
        let paste_count = if has_substantial_text {
            events.push(PasteEvent {
                index: 0,
                delta_chars: effective_len as i32,
                delta_ms: 0,
                timestamp: snapshots[0].timestamp,
                reason: format!("Instantaneous single snapshot insertion of {effective_len} chars"),
            });
            1
        } else {
            0
        };

        return AuditResult {
            is_valid: !has_substantial_text,
            flagged_for_review: true,
            reason: Some(reason.to_string()),
            verified_wpm: 0,
            verified_paste_count: paste_count,
            integrity_score: score,
            typed_char_count: 0,
            active_typing_time_ms: 0,
            total_snapshots: 1,
            paste_events: events,
            revision_ratio: None,
            peak_accretion_velocity: None,
            avg_accretion_velocity: None,
        };
    }

    // 5. Progression Audit, Paste Detection, & Accretion Dynamics
    let mut paste_events = detect_paste_events_with_lengths(snapshots, &snap_lengths);
    let paste_indices: HashSet<usize> = paste_events.iter().map(|p| p.index).collect();

    let mut typed_char_count = 0;
    let mut active_typing_time_ms: i64 = 0;
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

        if paste_indices.contains(&i) {
            // Paste event — do not credit characters toward typing speed
            if delta_ms < 300 {
                active_typing_time_ms += delta_ms;
            } else {
                active_typing_time_ms += 300;
            }
        } else if delta_chars > 0 {
            // Legitimate typing progression
            typed_char_count += delta_chars;
            // Cap single typing intervals at 5000ms so long idle pauses don't skew WPM downward
            if delta_ms < 5000 {
                active_typing_time_ms += delta_ms;
            } else {
                active_typing_time_ms += 5000;
            }

            // Accretion velocity only tracks typing progression (pastes excluded)
            if delta_ms > 100 {
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
        } else if delta_ms <= 5000 {
            // Backspacing / editing / idle within 5s
            active_typing_time_ms += delta_ms;
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

    // 6. Check for unrecorded trailing paste
    let last_snap_len = snap_lengths[snapshots.len() - 1];
    let trailing_delta = (clean_content_len as i32) - (last_snap_len as i32);

    if trailing_delta > 20 {
        paste_events.push(PasteEvent {
            index: snapshots.len(),
            delta_chars: trailing_delta,
            delta_ms: 0,
            timestamp: snapshots[snapshots.len() - 1].timestamp,
            reason: format!(
                "Untracked text injection of {trailing_delta} chars between last snapshot and submission"
            ),
        });
    }

    // 7. Calculate Verified WPM (1 word = 5 characters)
    let mut verified_wpm = 0;
    let active_minutes = (active_typing_time_ms as f64) / 60_000.0;
    let words_typed = (typed_char_count as f64) / 5.0;

    if typed_char_count > 0 && active_minutes > 0.0 {
        if active_minutes < 0.05 {
            // Under 3 seconds: conservative cap to prevent infinite or extreme spikes
            let calculated = (words_typed / 0.05).round() as i32;
            verified_wpm = calculated.min(300);
        } else {
            let calculated = (words_typed / active_minutes).round() as i32;
            verified_wpm = calculated.min(300);
        }
    }

    // 8. Calculate Final Server Integrity Score
    let mut score = 100;
    let verified_paste_count = paste_events.len() as i32;

    // Paste penalties: -15 per detected paste
    score -= verified_paste_count * 15;

    // Total pasted characters volume penalty
    let total_pasted_chars: i32 = paste_events.iter().map(|p| p.delta_chars).sum();
    if total_pasted_chars >= 500 {
        score -= 30;
    } else if total_pasted_chars >= 200 {
        score -= 15;
    }

    // Speed penalties
    if verified_wpm > 150 {
        score -= 40; // Superhuman typing speed (anti-bot)
    } else if verified_wpm > 100 {
        score -= 20; // Unusually fast typing speed
    }

    // Ratio penalty: compare verified typed characters against final essay length
    let total_essay_length = clean_content_len.max(last_snap_len);
    if total_essay_length > 100 {
        if typed_char_count == 0 {
            score -= 30;
        } else if (typed_char_count as f64) < (total_essay_length as f64) * 0.2 {
            // More than 80% of essay was not typed
            score -= 30;
        } else if (typed_char_count as f64) < (total_essay_length as f64) * 0.5 {
            // More than 50% of essay was not typed
            score -= 15;
        }
    }

    let anomalous_accretion = peak_velocity > 80.0;
    let zero_revision_injection =
        typed_char_count > 500 && revision_ratio.is_some_and(|r| r < 0.02);

    if zero_revision_injection {
        score -= 15;
    }
    if anomalous_accretion {
        score -= 20;
    }

    let final_integrity_score = score.clamp(0, 100);

    let flagged_for_review = final_integrity_score < 50
        || verified_paste_count >= 3
        || verified_wpm > 150
        || total_pasted_chars >= 200
        || anomalous_accretion
        || zero_revision_injection
        || (total_essay_length > 100
            && (typed_char_count as f64) < (total_essay_length as f64) * 0.3);

    AuditResult {
        is_valid: true,
        flagged_for_review,
        reason: None,
        verified_wpm,
        verified_paste_count,
        integrity_score: final_integrity_score,
        typed_char_count,
        active_typing_time_ms,
        total_snapshots: snapshots.len(),
        paste_events,
        revision_ratio,
        peak_accretion_velocity,
        avg_accretion_velocity,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_monotonicity() {
        let snaps = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(1.0),
            },
            TelemetrySnapshot {
                timestamp: 2000,
                html: None,
                text_length: Some(2.0),
            },
            TelemetrySnapshot {
                timestamp: 3000,
                html: None,
                text_length: Some(3.0),
            },
        ];
        assert!(is_strictly_monotonic(&snaps).is_ok());

        let dups = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(1.0),
            },
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(2.0),
            },
        ];
        let err = is_strictly_monotonic(&dups).unwrap_err();
        assert_eq!(err.violation_index, 1);
        assert_eq!(err.prev_ts, 1000);
        assert_eq!(err.curr_ts, 1000);

        let backwards = vec![
            TelemetrySnapshot {
                timestamp: 2000,
                html: None,
                text_length: Some(1.0),
            },
            TelemetrySnapshot {
                timestamp: 1500,
                html: None,
                text_length: Some(2.0),
            },
        ];
        assert!(is_strictly_monotonic(&backwards).is_err());
    }

    #[test]
    fn test_get_snapshot_text_length() {
        let snap = TelemetrySnapshot {
            timestamp: 1000,
            html: Some("<p>Hello <b>World</b>&nbsp;!</p>".to_string()),
            text_length: None,
        };
        assert_eq!(get_snapshot_text_length(&snap), 13);

        let spoofed = TelemetrySnapshot {
            timestamp: 1000,
            html: Some("<p>Tiny</p>".to_string()),
            text_length: Some(500.0),
        };
        assert_eq!(get_snapshot_text_length(&spoofed), 4);

        let minor_delta = TelemetrySnapshot {
            timestamp: 1000,
            html: Some("<p>Hello World</p>".to_string()),
            text_length: Some(12.0),
        };
        assert_eq!(get_snapshot_text_length(&minor_delta), 12);
    }

    #[test]
    fn test_detect_paste_events() {
        let initial_paste = vec![TelemetrySnapshot {
            timestamp: 1000,
            html: None,
            text_length: Some(100.0),
        }];
        let pastes = detect_paste_events(&initial_paste);
        assert_eq!(pastes.len(), 1);
        assert_eq!(pastes[0].index, 0);

        let quick_jump = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(5.0),
            },
            TelemetrySnapshot {
                timestamp: 1200,
                html: None,
                text_length: Some(30.0),
            },
        ];
        let pastes = detect_paste_events(&quick_jump);
        assert_eq!(pastes.len(), 1);
        assert_eq!(pastes[0].index, 1);

        let block_paste = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(10.0),
            },
            TelemetrySnapshot {
                timestamp: 2500,
                html: None,
                text_length: Some(70.0),
            },
        ];
        let pastes = detect_paste_events(&block_paste);
        assert_eq!(pastes.len(), 1);
        assert_eq!(pastes[0].index, 1);
    }

    #[test]
    fn test_audit_normal_typing() {
        let mut snaps = Vec::new();
        for i in 0..20 {
            snaps.push(TelemetrySnapshot {
                timestamp: 1000 + i * 1000,
                html: None,
                text_length: Some(((i + 1) * 5) as f64),
            });
        }
        let essay = "a".repeat(100);
        let res = audit_telemetry(&snaps, Some(&essay));
        assert!(res.is_valid);
        assert!(!res.flagged_for_review);
        assert_eq!(res.verified_paste_count, 0);
        assert!(res.integrity_score >= 90);
        assert!((40..=80).contains(&res.verified_wpm));
    }

    #[test]
    fn test_audit_absent_snapshots() {
        let res = audit_telemetry(&[], Some("Essay"));
        assert!(!res.is_valid);
        assert!(res.flagged_for_review);
        assert_eq!(res.integrity_score, 25);
    }

    #[test]
    fn test_audit_tampered_timestamps() {
        let snaps = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(5.0),
            },
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(10.0),
            },
        ];
        let res = audit_telemetry(&snaps, Some("Hello"));
        assert!(!res.is_valid);
        assert_eq!(res.integrity_score, 20);
    }

    #[test]
    fn test_audit_single_snapshot_paste() {
        let snaps = vec![TelemetrySnapshot {
            timestamp: 1000,
            html: None,
            text_length: Some(300.0),
        }];
        let res = audit_telemetry(&snaps, Some(&"x".repeat(300)));
        assert!(!res.is_valid);
        assert!(res.flagged_for_review);
        assert_eq!(res.verified_paste_count, 1);
        assert_eq!(res.integrity_score, 30);
    }

    #[test]
    fn test_audit_trailing_injection() {
        let snaps = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(5.0),
            },
            TelemetrySnapshot {
                timestamp: 2000,
                html: None,
                text_length: Some(10.0),
            },
        ];
        let essay = "a".repeat(150);
        let res = audit_telemetry(&snaps, Some(&essay));
        assert!(res.flagged_for_review);
        assert!(
            res.paste_events
                .iter()
                .any(|p| p.reason.contains("Untracked text injection"))
        );
    }

    #[test]
    fn test_audit_idle_pause_capping() {
        let snaps = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(5.0),
            },
            TelemetrySnapshot {
                timestamp: 61000,
                html: None,
                text_length: Some(10.0),
            },
        ];
        let res = audit_telemetry(&snaps, Some("1234567890"));
        assert!(res.active_typing_time_ms <= 6000);
    }

    #[test]
    fn test_audit_single_snapshot_final_content_bypass() {
        let snaps = vec![TelemetrySnapshot {
            timestamp: 1000,
            html: None,
            text_length: Some(5.0),
        }];
        let res = audit_telemetry(&snaps, Some(&"x".repeat(500)));
        assert!(!res.is_valid);
        assert!(res.flagged_for_review);
        assert_eq!(res.verified_paste_count, 1);
        assert_eq!(res.integrity_score, 30);
    }

    #[test]
    fn test_audit_accretion_velocity_and_revision_ratio() {
        // Natural drafting: 10 typing intervals with slight backspacing
        let mut snaps = Vec::new();
        let mut text_len = 0;
        let mut ts = 1000;
        snaps.push(TelemetrySnapshot {
            timestamp: ts,
            html: None,
            text_length: Some(0.0),
        });

        for i in 1..=10 {
            ts += 1000; // 1 second intervals
            if i == 5 {
                // Backspacing: delete 5 chars
                text_len -= 5;
            } else {
                // Type 10 chars (10 chars / sec)
                text_len += 10;
            }
            snaps.push(TelemetrySnapshot {
                timestamp: ts,
                html: None,
                text_length: Some(text_len as f64),
            });
        }

        let essay = "a".repeat(text_len as usize);
        let res = audit_telemetry(&snaps, Some(&essay));
        assert!(res.is_valid);
        assert!(res.revision_ratio.is_some());
        let rev = res.revision_ratio.unwrap();
        // 5 chars deleted / 90 chars inserted = 0.056
        assert!((0.04..0.07).contains(&rev));

        assert!(res.peak_accretion_velocity.is_some());
        let peak_v = res.peak_accretion_velocity.unwrap();
        assert!((9.0..=11.0).contains(&peak_v));

        assert!(res.avg_accretion_velocity.is_some());
        let avg_v = res.avg_accretion_velocity.unwrap();
        assert!((9.0..=11.0).contains(&avg_v));
    }

    #[test]
    fn test_audit_anomalous_accretion_penalty() {
        // Human typing cannot sustain > 80 chars/sec without pasting.
        // 45 chars in 520ms = 86.5 chars/s (below single-jump paste thresholds: <50 chars, >=500ms, >=300ms)
        let snaps = vec![
            TelemetrySnapshot {
                timestamp: 1000,
                html: None,
                text_length: Some(0.0),
            },
            TelemetrySnapshot {
                timestamp: 1520, // 520 ms
                html: None,
                text_length: Some(45.0),
            },
            TelemetrySnapshot {
                timestamp: 2500,
                html: None,
                text_length: Some(50.0),
            },
        ];

        let res = audit_telemetry(&snaps, Some(&"a".repeat(50)));
        assert_eq!(res.verified_paste_count, 0); // Not a discrete paste event
        assert!(res.peak_accretion_velocity.is_some());
        let peak_v = res.peak_accretion_velocity.unwrap();
        assert!(
            peak_v >= 80.0,
            "Peak velocity should be >= 80.0 (actual: {peak_v})"
        );
        assert!(res.flagged_for_review);
    }
}
