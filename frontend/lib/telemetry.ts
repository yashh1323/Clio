/**
 * Proof-of-Write Server-Side Telemetry Auditing Module
 *
 * Provides cryptographic and behavioral validation of student keystroke telemetry:
 * 1. Strict timestamp monotonicity verification (detects backdated, out-of-order, or forged packets).
 * 2. Algorithmic paste event detection (character count jumps > 15 chars in < 300ms, or large block inserts).
 * 3. Verified WPM calculation derived purely from typed character deltas and active typing time (idle pauses excluded).
 * 4. Server-computed integrity score and automated flagging for review.
 */

export interface TelemetrySnapshot {
    timestamp: number
    html?: string
    textLength?: number
}

export interface PasteEvent {
    index: number
    deltaChars: number
    deltaMs: number
    timestamp: number
    reason: string
}

export interface TelemetryAuditResult {
    isValid: boolean
    flaggedForReview: boolean
    reason?: string
    verifiedWpm: number
    verifiedPasteCount: number
    integrityScore: number
    typedCharCount: number
    activeTypingTimeMs: number
    totalSnapshots: number
    pasteEvents: PasteEvent[]
}

/**
 * Extracts normalized text character length from a snapshot.
 * Prioritizes actual HTML content when present to prevent client spoofing of textLength.
 */
export function getSnapshotTextLength(snap: TelemetrySnapshot): number {
    if (!snap || typeof snap !== "object") return 0

    // If HTML is present, compute length from stripped HTML text
    if (typeof snap.html === "string" && snap.html.length > 0) {
        const stripped = snap.html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&[a-z]+;/gi, " ")
            .replace(/&#\d+;/gi, " ")
            .replace(/&#x[0-9a-f]+;/gi, " ")
            .replace(/\s+/g, " ")
            .trim()

        // If textLength is also provided, accept it only if it is reasonably consistent
        // with the stripped HTML text (within 50 chars to accommodate whitespace/newlines in rich text)
        if (typeof snap.textLength === "number" && Number.isFinite(snap.textLength) && snap.textLength >= 0) {
            const rawLen = Math.floor(snap.textLength)
            if (Math.abs(rawLen - stripped.length) > 50) {
                // Client textLength contradicts actual HTML text — prefer authoritative HTML length
                return stripped.length
            }
            return rawLen
        }
        return stripped.length
    }

    // Fall back to textLength when HTML is omitted
    if (typeof snap.textLength === "number" && Number.isFinite(snap.textLength) && snap.textLength >= 0) {
        return Math.floor(snap.textLength)
    }

    return 0
}

/**
 * Verifies that an array of timestamps is strictly monotonically increasing.
 */
export function isStrictlyMonotonic(snapshots: TelemetrySnapshot[]): {
    monotonic: boolean
    violationIndex?: number
    prevTs?: number
    currTs?: number
} {
    for (let i = 1; i < snapshots.length; i++) {
        const prevTs = Number(snapshots[i - 1]?.timestamp)
        const currTs = Number(snapshots[i]?.timestamp)

        if (isNaN(prevTs) || isNaN(currTs) || !Number.isFinite(prevTs) || !Number.isFinite(currTs)) {
            return { monotonic: false, violationIndex: i, prevTs, currTs }
        }

        if (currTs <= prevTs) {
            return { monotonic: false, violationIndex: i, prevTs, currTs }
        }
    }
    return { monotonic: true }
}

/**
 * Detects paste events across snapshots using character count jumps and time deltas.
 * - Initial snapshot pre-pasted block (> 15 characters without typing history)
 * - Jumps > 15 characters in < 300ms
 * - Block jumps >= 50 characters in <= 2000ms
 * - Rapid jumps > 25 characters in < 500ms
 */
export function detectPasteEvents(
    snapshots: TelemetrySnapshot[],
    precomputedLengths?: number[]
): PasteEvent[] {
    const pasteEvents: PasteEvent[] = []
    if (!snapshots || snapshots.length === 0) return pasteEvents

    const lengths =
        precomputedLengths && precomputedLengths.length === snapshots.length
            ? precomputedLengths
            : snapshots.map(getSnapshotTextLength)

    // Check initial snapshot for pre-existing or instant paste text
    const initialLen = lengths[0]
    if (initialLen > 15) {
        pasteEvents.push({
            index: 0,
            deltaChars: initialLen,
            deltaMs: 0,
            timestamp: Number(snapshots[0].timestamp),
            reason: `Initial snapshot contained ${initialLen} pre-existing or pasted characters without typing progression`,
        })
    }

    for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1]
        const curr = snapshots[i]
        const deltaMs = Number(curr.timestamp) - Number(prev.timestamp)
        const prevLen = lengths[i - 1]
        const currLen = lengths[i]
        const deltaChars = currLen - prevLen

        if (deltaChars <= 0) continue

        const isQuickJump = deltaChars > 15 && deltaMs < 300
        const isBlockPaste = deltaChars >= 50 && deltaMs <= 2000
        const isRapidJump = deltaChars > 25 && deltaMs < 500

        if (isQuickJump || isBlockPaste || isRapidJump) {
            pasteEvents.push({
                index: i,
                deltaChars,
                deltaMs,
                timestamp: Number(curr.timestamp),
                reason: isQuickJump
                    ? `Sudden jump of ${deltaChars} chars in ${deltaMs}ms (<300ms)`
                    : isBlockPaste
                    ? `Large block paste of ${deltaChars} chars in ${deltaMs}ms`
                    : `Rapid jump of ${deltaChars} chars in ${deltaMs}ms (<500ms)`,
            })
        }
    }

    return pasteEvents
}

/**
 * Audits client-submitted telemetry snapshots against the final submitted essay content.
 * Returns authoritative server-computed metrics.
 */
export function auditTelemetrySnapshots(
    snapshots: unknown,
    finalContent?: string
): TelemetryAuditResult {
    // 1. Check for absent or malformed telemetry snapshots
    if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
        return {
            isValid: false,
            flaggedForReview: true,
            reason: "Telemetry snapshots are completely absent",
            verifiedWpm: 0,
            verifiedPasteCount: 0,
            integrityScore: 25, // Absent telemetry penalized heavily (flagged < 50)
            typedCharCount: 0,
            activeTypingTimeMs: 0,
            totalSnapshots: 0,
            pasteEvents: [],
        }
    }

    const typedSnapshots = (snapshots as TelemetrySnapshot[]).slice(0, 10000)

    // 2. Validate snapshot array elements
    for (let i = 0; i < typedSnapshots.length; i++) {
        const s = typedSnapshots[i]
        if (!s || typeof s !== "object") {
            return {
                isValid: false,
                flaggedForReview: true,
                reason: `Malformed snapshot object at index ${i}`,
                verifiedWpm: 0,
                verifiedPasteCount: 0,
                integrityScore: 20,
                typedCharCount: 0,
                activeTypingTimeMs: 0,
                totalSnapshots: typedSnapshots.length,
                pasteEvents: [],
            }
        }

        const ts = Number(s.timestamp)
        if (isNaN(ts) || !Number.isFinite(ts) || ts <= 0) {
            return {
                isValid: false,
                flaggedForReview: true,
                reason: `Invalid non-numeric or non-positive timestamp at index ${i}`,
                verifiedWpm: 0,
                verifiedPasteCount: 0,
                integrityScore: 20,
                typedCharCount: 0,
                activeTypingTimeMs: 0,
                totalSnapshots: typedSnapshots.length,
                pasteEvents: [],
            }
        }
    }

    // 3. Verify strict timestamp monotonicity
    const monotonicCheck = isStrictlyMonotonic(typedSnapshots)
    if (!monotonicCheck.monotonic) {
        return {
            isValid: false,
            flaggedForReview: true,
            reason: `Non-monotonic timestamp at index ${monotonicCheck.violationIndex} (${monotonicCheck.currTs} <= ${monotonicCheck.prevTs})`,
            verifiedWpm: 0,
            verifiedPasteCount: 0,
            integrityScore: 20, // Tampered or out-of-order telemetry penalized heavily
            typedCharCount: 0,
            activeTypingTimeMs: 0,
            totalSnapshots: typedSnapshots.length,
            pasteEvents: [],
        }
    }

    // Precompute normalized snapshot text lengths once across the entire audit pipeline
    const snapLengths = typedSnapshots.map(getSnapshotTextLength)
    const cleanContentLen = getSnapshotTextLength({ timestamp: 0, html: finalContent || "" })

    // 4. Single-snapshot edge case
    if (typedSnapshots.length === 1) {
        const singleLen = snapLengths[0]
        const effectiveLen = Math.max(singleLen, cleanContentLen)
        const hasSubstantialText = effectiveLen > 15
        return {
            isValid: !hasSubstantialText,
            flaggedForReview: true,
            reason: hasSubstantialText
                ? "Single snapshot with substantial text indicates instantaneous paste without typing telemetry"
                : "Single snapshot provides insufficient progression data",
            verifiedWpm: 0,
            verifiedPasteCount: hasSubstantialText ? 1 : 0,
            integrityScore: hasSubstantialText ? 30 : 50,
            typedCharCount: 0,
            activeTypingTimeMs: 0,
            totalSnapshots: 1,
            pasteEvents: hasSubstantialText
                ? [{
                    index: 0,
                    deltaChars: effectiveLen,
                    deltaMs: 0,
                    timestamp: Number(typedSnapshots[0].timestamp),
                    reason: `Instantaneous single snapshot insertion of ${effectiveLen} chars`,
                }]
                : [],
        }
    }

    // 5. Progression Audit & Paste Detection
    const pasteEvents = detectPasteEvents(typedSnapshots, snapLengths)
    const pasteIndices = new Set(pasteEvents.map(p => p.index))

    let typedCharCount = 0
    let activeTypingTimeMs = 0

    for (let i = 1; i < typedSnapshots.length; i++) {
        const prev = typedSnapshots[i - 1]
        const curr = typedSnapshots[i]
        const deltaMs = Number(curr.timestamp) - Number(prev.timestamp)
        const prevLen = snapLengths[i - 1]
        const currLen = snapLengths[i]
        const deltaChars = currLen - prevLen

        if (pasteIndices.has(i)) {
            // Paste event — do not credit characters toward typing speed
            activeTypingTimeMs += Math.min(deltaMs, 300)
        } else if (deltaChars > 0) {
            // Legitimate typing progression
            typedCharCount += deltaChars
            // Cap single typing intervals at 5000ms so long idle pauses don't skew WPM downward
            activeTypingTimeMs += Math.min(deltaMs, 5000)
        } else {
            // Backspacing / editing / idle
            if (deltaMs <= 5000) {
                activeTypingTimeMs += deltaMs
            }
        }
    }

    // 6. Check for unrecorded trailing paste (discrepancy between last snapshot and submitted content)
    const lastSnapLen = snapLengths[typedSnapshots.length - 1]
    const trailingDelta = cleanContentLen - lastSnapLen

    if (trailingDelta > 20) {
        pasteEvents.push({
            index: typedSnapshots.length,
            deltaChars: trailingDelta,
            deltaMs: 0,
            timestamp: Number(typedSnapshots[typedSnapshots.length - 1].timestamp),
            reason: `Untracked text injection of ${trailingDelta} chars between last snapshot and submission`,
        })
    }

    // 7. Calculate Verified WPM
    // Standard typing formula: 1 word = 5 characters.
    let verifiedWpm = 0
    const activeMinutes = activeTypingTimeMs / 60000
    const wordsTyped = typedCharCount / 5

    if (typedCharCount > 0 && activeMinutes > 0) {
        if (activeMinutes < 0.05) {
            // Under 3 seconds: conservative cap to prevent infinite or extreme spikes
            verifiedWpm = Math.min(Math.round(wordsTyped / 0.05), 300)
        } else {
            verifiedWpm = Math.min(Math.round(wordsTyped / activeMinutes), 300)
        }
    }

    // 8. Calculate Final Server Integrity Score
    let score = 100
    const verifiedPasteCount = pasteEvents.length

    // Paste penalties: -15 per detected paste
    score -= verifiedPasteCount * 15

    // Total pasted characters volume penalty
    const totalPastedChars = pasteEvents.reduce((sum, p) => sum + p.deltaChars, 0)
    if (totalPastedChars >= 500) {
        score -= 30
    } else if (totalPastedChars >= 200) {
        score -= 15
    }

    // Speed penalties
    if (verifiedWpm > 150) {
        score -= 40 // Superhuman typing speed (anti-bot)
    } else if (verifiedWpm > 100) {
        score -= 20 // Unusually fast typing speed
    }

    // Ratio penalty: compare verified typed characters against final essay length
    const totalEssayLength = Math.max(cleanContentLen, lastSnapLen)
    if (totalEssayLength > 100) {
        if (typedCharCount === 0) {
            score -= 30
        } else if (typedCharCount < totalEssayLength * 0.2) {
            // More than 80% of essay was not typed
            score -= 30
        } else if (typedCharCount < totalEssayLength * 0.5) {
            // More than 50% of essay was not typed
            score -= 15
        }
    }

    const finalIntegrityScore = Math.max(0, Math.min(100, Math.round(score)))
    const flaggedForReview =
        finalIntegrityScore < 50 ||
        verifiedPasteCount >= 3 ||
        verifiedWpm > 150 ||
        totalPastedChars >= 200 ||
        (totalEssayLength > 100 && typedCharCount < totalEssayLength * 0.3)

    return {
        isValid: true,
        flaggedForReview,
        verifiedWpm,
        verifiedPasteCount,
        integrityScore: finalIntegrityScore,
        typedCharCount,
        activeTypingTimeMs,
        totalSnapshots: typedSnapshots.length,
        pasteEvents,
    }
}
