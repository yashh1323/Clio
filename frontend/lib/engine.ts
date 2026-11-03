import { auditTelemetrySnapshots, type TelemetryAuditResult } from "./telemetry.ts"

export interface EngineSubmissionInput {
    id: string
    assignment: string
    student: string
    username: string
    content: string
}

export interface EngineSimilarityPair {
    submission1: { id: string; student: string; username: string }
    submission2: { id: string; student: string; username: string }
    similarity: number
    sharedShingles: number
    assignment: string
}

export interface SimilarityAnalysisResult {
    pairs: EngineSimilarityPair[]
    totalPossiblePairs: number
    comparisonsMade: number
    totalComparisons: number
    threshold: number
    method?: string
}

/**
 * Returns the configured Go microservice URL or undefined if unconfigured.
 */
export function getEngineUrl(): string | undefined {
    const url = process.env.CLIO_ENGINE_URL?.trim()
    return url ? url.replace(/\/+$/, "") : undefined
}

/**
 * Returns headers required for communicating with the Clio Engine,
 * including X-Clio-Engine-Key when CLIO_ENGINE_KEY is configured.
 */
export function getEngineHeaders(): Record<string, string> {
    const key = process.env.CLIO_ENGINE_KEY?.trim()
    return key ? { "X-Clio-Engine-Key": key } : {}
}

/**
 * Checks health and connectivity of the Go High-Performance Engine.
 */
export async function checkEngineHealth(): Promise<{ ok: boolean; status?: string; data?: unknown }> {
    const engineUrl = getEngineUrl()
    if (!engineUrl) {
        return { ok: false, status: "Engine URL not configured" }
    }

    try {
        const res = await fetch(`${engineUrl}/health`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                ...getEngineHeaders(),
            },
            signal: AbortSignal.timeout(2000),
        })

        if (!res.ok) {
            return { ok: false, status: `HTTP ${res.status}` }
        }

        const data = await res.json()
        return { ok: true, status: "healthy", data }
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { ok: false, status: `Unreachable: ${errorMsg}` }
    }
}

/**
 * Strangler Fig proxy for telemetry auditing:
 * Dispatches heavy cryptographic/monotonic auditing to Go microservice if available.
 * Gracefully falls back to authoritative local TypeScript engine if offline or unconfigured.
 */
export async function auditTelemetryWithEngine(
    snapshots: unknown,
    finalContent?: string
): Promise<TelemetryAuditResult> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/telemetry/audit`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    snapshots,
                    finalContent: finalContent ?? "",
                }),
                signal: AbortSignal.timeout(3000),
            })

            if (res.ok) {
                const data = (await res.json()) as TelemetryAuditResult
                return data
            }

            console.warn(`[Clio Engine] Telemetry audit endpoint responded with HTTP ${res.status}; falling back to local TypeScript engine.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local TypeScript engine.`)
        }
    }

    // Authoritative TypeScript fallback
    return auditTelemetrySnapshots(snapshots, finalContent)
}

/**
 * Local fallback implementation for Jaccard shingle similarity.
 */
export function localAnalyzeSimilarity(
    submissions: EngineSubmissionInput[],
    threshold: number = 25,
    shingleSize: number = 4
): SimilarityAnalysisResult {
    const N = shingleSize > 0 ? shingleSize : 4
    const validThreshold = threshold > 0 ? threshold : 25

    if (!submissions || submissions.length < 2) {
        return {
            pairs: [],
            totalPossiblePairs: 0,
            comparisonsMade: 0,
            totalComparisons: 0,
            threshold: validThreshold,
            method: "local_typescript",
        }
    }

    const processed = submissions.map(s => {
        const text = (s.content || "")
            .replace(/<[^>]*>/g, " ")
            .replace(/&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi, " ")
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim()

        const words = text.split(" ").filter((w: string) => w.length > 0)
        const shingles = new Set<string>()
        for (let i = 0; i <= words.length - N; i++) {
            shingles.add(words.slice(i, i + N).join(" "))
        }

        return {
            id: s.id,
            assignment: s.assignment,
            student: s.student || s.username || "Unknown",
            username: s.username || "unknown",
            wordCount: words.length,
            shingles,
        }
    })

    const pairs: EngineSimilarityPair[] = []
    let comparisonsMade = 0

    for (let i = 0; i < processed.length; i++) {
        for (let j = i + 1; j < processed.length; j++) {
            const a = processed[i]
            const b = processed[j]

            if (a.id === b.id) continue
            if (a.assignment !== b.assignment) continue
            if (a.wordCount < 20 || b.wordCount < 20) continue

            comparisonsMade++

            let intersection = 0
            for (const shingle of a.shingles) {
                if (b.shingles.has(shingle)) intersection++
            }
            const union = a.shingles.size + b.shingles.size - intersection
            const similarity = union > 0 ? Math.round((intersection / union) * 100) : 0

            if (similarity >= validThreshold) {
                pairs.push({
                    submission1: { id: a.id, student: a.student, username: a.username },
                    submission2: { id: b.id, student: b.student, username: b.username },
                    similarity,
                    sharedShingles: intersection,
                    assignment: a.assignment,
                })
            }
        }
    }

    let totalEligiblePairs = 0
    const countByAssignment: Record<string, number> = {}
    for (const sub of processed) {
        if (sub.wordCount >= 20) {
            countByAssignment[sub.assignment] = (countByAssignment[sub.assignment] || 0) + 1
        }
    }
    for (const count of Object.values(countByAssignment)) {
        if (count > 1) {
            totalEligiblePairs += (count * (count - 1)) / 2
        }
    }

    pairs.sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity
        if (b.sharedShingles !== a.sharedShingles) return b.sharedShingles - a.sharedShingles
        return a.submission1.id.localeCompare(b.submission1.id)
    })

    return {
        pairs: pairs.slice(0, 50),
        totalPossiblePairs: totalEligiblePairs,
        comparisonsMade,
        totalComparisons: comparisonsMade,
        threshold: validThreshold,
        method: "local_typescript",
    }
}

/**
 * Strangler Fig proxy for MinHash/LSH Plagiarism Similarity Analysis:
 * Dispatches corpus analysis to Go Engine (/api/v1/similarity/analyze) if available.
 * Gracefully falls back to local TypeScript analysis if offline or unconfigured.
 */
export async function analyzeSimilarityWithEngine(
    submissions: EngineSubmissionInput[],
    threshold: number = 25,
    shingleSize: number = 4
): Promise<SimilarityAnalysisResult> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/similarity/analyze`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    submissions,
                    threshold,
                    shingleSize,
                }),
                signal: AbortSignal.timeout(5000),
            })

            if (res.ok) {
                const data = (await res.json()) as SimilarityAnalysisResult
                return data
            }

            console.warn(`[Clio Engine] Similarity analysis endpoint responded with HTTP ${res.status}; falling back to local TypeScript engine.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local TypeScript engine.`)
        }
    }

    // Local TypeScript fallback
    return localAnalyzeSimilarity(submissions, threshold, shingleSize)
}

/**
 * Strangler Fig proxy for native PDF rendering:
 * Dispatches PDF generation to Rust Engine (/api/v1/pdf/render) if available.
 * Returns null if engine is offline, allowing caller to use local Puppeteer/Mammoth fallback.
 */
export async function renderPdfWithEngine(
    content: string,
    title?: string,
    author?: string,
    subtitle?: string
): Promise<Uint8Array | null> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/pdf/render`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    content,
                    title,
                    author,
                    subtitle,
                }),
                signal: AbortSignal.timeout(5000),
            })

            if (res.ok) {
                const arrayBuf = await res.arrayBuffer()
                return new Uint8Array(arrayBuf)
            }

            console.warn(`[Clio Engine] PDF render endpoint responded with HTTP ${res.status}; falling back to local Puppeteer.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local Puppeteer.`)
        }
    }

    return null
}

