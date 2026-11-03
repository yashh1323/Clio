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
    containment1In2?: number
    containment2In1?: number
    maxContainment?: number
    sharedFingerprints?: number
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
 * Returns the configured Rust microservice URL or undefined if unconfigured.
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
 * Checks health and connectivity of the Clio Rust High-Performance Engine.
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
 * Dispatches heavy cryptographic/monotonic auditing to Rust microservice if available.
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
    shingleSize: number = 4,
    containmentThreshold: number = 0.20
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

            const aSize = a.shingles.size
            const bSize = b.shingles.size
            const containment1In2 = aSize > 0 ? Number((intersection / aSize).toFixed(3)) : 0
            const containment2In1 = bSize > 0 ? Number((intersection / bSize).toFixed(3)) : 0
            const maxContainment = Math.max(containment1In2, containment2In1)

            if (similarity >= validThreshold || maxContainment >= containmentThreshold) {
                pairs.push({
                    submission1: { id: a.id, student: a.student, username: a.username },
                    submission2: { id: b.id, student: b.student, username: b.username },
                    similarity,
                    sharedShingles: intersection,
                    containment1In2,
                    containment2In1,
                    maxContainment,
                    sharedFingerprints: intersection,
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
        const scoreA = Math.max(a.similarity, Math.round((a.maxContainment ?? 0) * 100))
        const scoreB = Math.max(b.similarity, Math.round((b.maxContainment ?? 0) * 100))
        if (scoreB !== scoreA) return scoreB - scoreA
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
    shingleSize: number = 4,
    containmentThreshold: number = 0.20
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
                    containmentThreshold,
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
    return localAnalyzeSimilarity(submissions, threshold, shingleSize, containmentThreshold)
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

export interface EngineStylometricProfile {
    yulesK: number
    burrowsDeltaMax: number
    burrowsDeltaMean: number
    anomalousWindows: number[]
    isAnomalous: boolean
    riskScore: number
}

export interface StylometryAuditResult {
    profile: EngineStylometricProfile
    wordCount: number
    totalWindows: number
    method?: "engine_rust" | "local_typescript"
}

const FUNCTION_WORDS = [
    "the", "of", "and", "to", "a", "in", "that", "is", "was", "he", "for", "it", "with", "as",
    "his", "on", "be", "at", "by", "i", "this", "had", "not", "are", "but", "from", "or", "have",
    "an", "they", "which", "one", "you", "were", "her", "all", "she", "there", "would", "their",
    "we", "him", "been", "has", "when", "who", "will", "more", "no", "if",
]

export function localCalculateYulesK(words: string[]): number {
    const totalWords = words ? words.length : 0
    if (totalWords < 20) return 0

    const counts = new Map<string, number>()
    for (const w of words) {
        counts.set(w, (counts.get(w) || 0) + 1)
    }

    const s1 = totalWords
    let s2 = 0
    for (const c of counts.values()) {
        s2 += c * c
    }

    return (10000 * (s2 - s1)) / (s1 * s1)
}

export function localAuditStylometry(content: string): StylometryAuditResult {
    // Match Rust engine clean_text: strip HTML, entity references, and non-letter tokens
    const stripped = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi, " ")
        .toLowerCase()
    const words = stripped
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(w => w.length > 0)
    const wordCount = words.length
    const yulesK = Math.round(localCalculateYulesK(words) * 100) / 100

    const windowSize = 250
    const stride = 50

    if (wordCount < windowSize) {
        const isAnomalous = wordCount >= 100 && (yulesK < 25 || yulesK > 180)
        return {
            profile: {
                yulesK,
                burrowsDeltaMax: 0,
                burrowsDeltaMean: 0,
                anomalousWindows: [],
                isAnomalous,
                riskScore: isAnomalous ? 60 : 10,
            },
            wordCount,
            totalWindows: 0,
            method: "local_typescript",
        }
    }

    const mapped = words.map(w => FUNCTION_WORDS.indexOf(w))
    const baseCounts = new Array(50).fill(0)
    for (const idx of mapped) {
        if (idx >= 0 && idx < 50) baseCounts[idx]++
    }
    const baseFreqs = baseCounts.map(c => c / wordCount)
    let activeFeatures = 0
    for (let i = 0; i < 50; i++) {
        if (baseCounts[i] > 0) activeFeatures++
    }
    const denomFeatures = Math.max(activeFeatures, 10)

    let deltaMax = 0
    let deltaSum = 0
    let totalWindows = 0
    const anomalousWindows: number[] = []

    for (let start = 0; start + windowSize <= wordCount; start += stride) {
        const chunk = mapped.slice(start, start + windowSize)
        const winCounts = new Array(50).fill(0)
        for (const idx of chunk) {
            if (idx >= 0 && idx < 50) winCounts[idx]++
        }

        let delta = 0
        for (let i = 0; i < 50; i++) {
            if (baseCounts[i] > 0 || winCounts[i] > 0) {
                const expected = windowSize * baseFreqs[i]
                const observed = winCounts[i]
                const sigma = Math.max(Math.sqrt(expected), 0.5)
                delta += Math.abs(observed - expected) / sigma
            }
        }
        delta /= denomFeatures

        if (delta > 1.8) {
            anomalousWindows.push(totalWindows)
        }
        if (delta > deltaMax) {
            deltaMax = delta
        }
        deltaSum += delta
        totalWindows++
    }

    const burrowsDeltaMean = totalWindows > 0 ? deltaSum / totalWindows : 0
    const isAnomalous = anomalousWindows.length > 0 || (wordCount >= 100 && (yulesK < 25 || yulesK > 180))

    let riskScore = 10
    if (anomalousWindows.length > 0) {
        riskScore += Math.min(anomalousWindows.length * 20, 60)
    }
    if (deltaMax > 1.8) riskScore += 20
    if (wordCount >= 100 && (yulesK < 25 || yulesK > 180)) riskScore += 20

    return {
        profile: {
            yulesK,
            burrowsDeltaMax: Math.round(deltaMax * 1000) / 1000,
            burrowsDeltaMean: Math.round(burrowsDeltaMean * 1000) / 1000,
            anomalousWindows,
            isAnomalous,
            riskScore: Math.min(riskScore, 100),
        },
        wordCount,
        totalWindows,
        method: "local_typescript",
    }
}

/**
 * Strangler Fig proxy for single-document intrinsic stylometry audit:
 * Dispatches analysis to Rust Engine (/api/v1/stylometry/audit) if available.
 * Gracefully falls back to local TypeScript implementation if offline or unconfigured.
 */
export async function auditStylometryWithEngine(
    content: string,
    title?: string
): Promise<StylometryAuditResult> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/stylometry/audit`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    content,
                    title,
                }),
                signal: AbortSignal.timeout(5000),
            })

            if (res.ok) {
                const data = (await res.json()) as StylometryAuditResult
                data.method = "engine_rust"
                return data
            }

            console.warn(`[Clio Engine] Stylometry endpoint responded with HTTP ${res.status}; falling back to local TypeScript engine.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local TypeScript engine.`)
        }
    }

    return localAuditStylometry(content)
}

// ── Phase 3: Semantic Paraphrase Detection & Cognitive Process Telemetry ──

export interface AlignedSentencePair {
    sentenceA: string
    sentenceB: string
    similarity: number
    indexA: number
    indexB: number
}

export interface SemanticAnalyzeResult {
    semanticScore: number
    coverageAToB: number
    coverageBToA: number
    docASentences: number
    docBSentences: number
    alignedPairs: AlignedSentencePair[]
    threshold: number
    method?: string
}

export type ProcessKeystrokeOp = "insert" | "delete"

export interface ProcessKeystrokeEvent {
    timestamp: number
    op: ProcessKeystrokeOp
}

export interface ProcessAuditResult {
    isAuthentic: boolean
    confidenceScore: number
    pBurstMean: number
    rBurstMean: number
    revisionRatio: number
    cognitivePauseRatio: number
    logMean: number
    logStdDev: number
    ksDStatistic: number
    rapidIntervalCount: number
    validIntervalCount: number
    flags: string[]
    method?: string
}

const SYNONYM_CLUSTERS: string[][] = [
    ["rapid", "quick", "fast", "swift", "speedy", "brisk"],
    ["transform", "alter", "change", "shift", "convert", "transition", "metamorphose"],
    ["revolution", "upheaval", "overhaul", "rebellion", "transformation"],
    ["manufacturing", "production", "industry", "fabrication", "assembly"],
    ["crucial", "essential", "vital", "critical", "imperative", "pivotal"],
    ["study", "research", "investigation", "inquiry", "analysis", "examination"],
    ["student", "pupil", "scholar", "learner", "apprentice"],
    ["huge", "enormous", "massive", "immense", "gigantic", "tremendous"],
    ["create", "generate", "produce", "build", "develop", "construct", "spawn"],
    ["show", "demonstrate", "illustrate", "display", "reveal", "exhibit"],
    ["consequence", "outcome", "result", "effect", "ramification", "aftermath"],
    ["difficult", "hard", "challenging", "arduous", "demanding", "strenuous"],
    ["improve", "enhance", "boost", "elevate", "upgrade", "better"],
    ["decrease", "reduce", "diminish", "lessen", "curtail", "lower"],
    ["increase", "expand", "augment", "grow", "multiply", "escalate"],
    ["mark", "signal", "indicate", "herald", "denote", "signify"],
    ["period", "era", "epoch", "age", "time"],
    ["mechanical", "technological", "machine", "industrial", "automated"],
    ["steam", "vapor", "gas"],
    ["power", "energy", "force", "vigor"],
    ["economic", "financial", "monetary", "fiscal"],
    ["britain", "england", "europe", "kingdom"],
]

function fnv1a32(str: string): number {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i)
        hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash
}

function embedWord(word: string): number[] {
    const vec = new Array(64).fill(0)
    const trimmed = word.trim().toLowerCase()
    if (!trimmed) return vec

    let inCluster = false
    for (let clusterIdx = 0; clusterIdx < SYNONYM_CLUSTERS.length; clusterIdx++) {
        const cluster = SYNONYM_CLUSTERS[clusterIdx]
        if (cluster.includes(trimmed)) {
            const dim1 = clusterIdx % 64
            const dim2 = (clusterIdx * 7 + 13) % 64
            const dim3 = (clusterIdx * 17 + 29) % 64
            vec[dim1] += 8.0
            vec[dim2] += 6.0
            vec[dim3] += 4.0
            inCluster = true
            break
        }
    }

    const subwordWeight = inCluster ? 0.25 : 1.0
    const bracketed = `<${trimmed}>`
    if (bracketed.length >= 3) {
        for (let i = 0; i <= bracketed.length - 3; i++) {
            const trigram = bracketed.slice(i, i + 3)
            const h = fnv1a32(trigram)
            const dim = h % 64
            const sign = ((h >>> 16) & 1) === 0 ? 1.0 : -1.0
            vec[dim] += sign * subwordWeight
        }
    } else {
        const h = fnv1a32(trimmed)
        const dim = h % 64
        vec[dim] += 1.0 * subwordWeight
    }

    let normSq = 0
    for (let i = 0; i < 64; i++) normSq += vec[i] * vec[i]
    if (normSq > 1e-9) {
        const invNorm = 1.0 / Math.sqrt(normSq)
        for (let i = 0; i < 64; i++) vec[i] *= invNorm
    }
    return vec
}

function splitSentences(text: string): string[] {
    const sentences: string[] = []
    let cur = ""
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        cur += ch
        if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
            const trimmed = cur.trim()
            if (trimmed.length >= 5 && /[a-zA-Z0-9]/.test(trimmed)) {
                sentences.push(trimmed)
            }
            cur = ""
        }
    }
    const remaining = cur.trim()
    if (remaining.length >= 5 && /[a-zA-Z0-9]/.test(remaining)) {
        sentences.push(remaining)
    }
    return sentences
}

function tokenizeWordsClean(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .split(/\s+/)
        .map(w => w.replace(/^'+|'+$/g, ""))
        .filter(Boolean)
}

function computeSentenceCentroid(sentence: string): number[] {
    const words = tokenizeWordsClean(sentence)
    const centroid = new Array(64).fill(0)
    if (words.length === 0) return centroid

    for (const w of words) {
        const weight = FUNCTION_WORDS.includes(w) ? 0.3 : 1.0
        const emb = embedWord(w)
        for (let d = 0; d < 64; d++) centroid[d] += weight * emb[d]
    }
    let normSq = 0
    for (let d = 0; d < 64; d++) normSq += centroid[d] * centroid[d]
    if (normSq > 1e-9) {
        const inv = 1.0 / Math.sqrt(normSq)
        for (let d = 0; d < 64; d++) centroid[d] *= inv
    }
    return centroid
}

function cosineSim(v1: number[], v2: number[]): number {
    let dot = 0
    for (let i = 0; i < 64; i++) dot += v1[i] * v2[i]
    return Math.max(-1.0, Math.min(1.0, dot))
}

/**
 * Local pure-TypeScript fallback for Semantic & Paraphrase Similarity Analysis.
 */
export function localAnalyzeSemanticSimilarity(
    docA: string,
    docB: string,
    threshold = 0.75
): SemanticAnalyzeResult {
    const t = Math.max(0.1, Math.min(0.99, threshold))
    const sentencesA = splitSentences(docA)
    const sentencesB = splitSentences(docB)

    if (sentencesA.length === 0 || sentencesB.length === 0) {
        return {
            semanticScore: 0,
            coverageAToB: 0,
            coverageBToA: 0,
            docASentences: sentencesA.length,
            docBSentences: sentencesB.length,
            alignedPairs: [],
            threshold: t,
            method: "local_typescript",
        }
    }

    const wordsA = tokenizeWordsClean(docA)
    const wordsB = tokenizeWordsClean(docB)
    const setA = new Set(wordsA)
    const setB = new Set(wordsB)
    const docFreqs = new Map<string, number>()
    for (const w of setA) docFreqs.set(w, (docFreqs.get(w) || 0) + 1)
    for (const w of setB) docFreqs.set(w, (docFreqs.get(w) || 0) + 1)

    const computeCentroid = (words: string[]) => {
        const c = new Array(64).fill(0)
        for (const w of words) {
            const df = docFreqs.get(w) || 1
            const idf = Math.max(0.1, Math.log(1.0 + 2.0 / (1.0 + df)))
            const weight = FUNCTION_WORDS.includes(w) ? idf * 0.25 : idf
            const emb = embedWord(w)
            for (let d = 0; d < 64; d++) c[d] += weight * emb[d]
        }
        let normSq = 0
        for (let d = 0; d < 64; d++) normSq += c[d] * c[d]
        if (normSq > 1e-9) {
            const inv = 1.0 / Math.sqrt(normSq)
            for (let d = 0; d < 64; d++) c[d] *= inv
        }
        return c
    }

    const cA = computeCentroid(wordsA)
    const cB = computeCentroid(wordsB)
    const overallCentroidSim = cosineSim(cA, cB)

    const sCentroidsA = sentencesA.map(computeSentenceCentroid)
    const sCentroidsB = sentencesB.map(computeSentenceCentroid)

    const nA = sentencesA.length
    const nB = sentencesB.length
    const matrix: number[][] = []

    for (let i = 0; i < nA; i++) {
        const row = new Array(nB).fill(0)
        for (let j = 0; j < nB; j++) {
            row[j] = cosineSim(sCentroidsA[i], sCentroidsB[j])
        }
        matrix.push(row)
    }

    let covASum = 0
    for (let i = 0; i < nA; i++) {
        let maxSim = 0
        for (let j = 0; j < nB; j++) {
            if (matrix[i][j] > maxSim) maxSim = matrix[i][j]
        }
        if (maxSim >= t) covASum += maxSim
    }
    const coverageAToB = Math.max(0, Math.min(1.0, covASum / nA))

    let covBSum = 0
    for (let j = 0; j < nB; j++) {
        let maxSim = 0
        for (let i = 0; i < nA; i++) {
            if (matrix[i][j] > maxSim) maxSim = matrix[i][j]
        }
        if (maxSim >= t) covBSum += maxSim
    }
    const coverageBToA = Math.max(0, Math.min(1.0, covBSum / nB))

    const harmonicScore =
        coverageAToB + coverageBToA > 1e-9
            ? (2.0 * coverageAToB * coverageBToA) / (coverageAToB + coverageBToA)
            : 0

    const compositeScore =
        Math.round((0.4 * Math.max(0, overallCentroidSim) + 0.6 * harmonicScore) * 100) / 100

    const candidatePairs: { i: number; j: number; sim: number }[] = []
    for (let i = 0; i < nA; i++) {
        for (let j = 0; j < nB; j++) {
            if (matrix[i][j] >= t) {
                candidatePairs.push({ i, j, sim: matrix[i][j] })
            }
        }
    }
    candidatePairs.sort((a, b) => b.sim - a.sim)

    const usedA = new Array(nA).fill(false)
    const usedB = new Array(nB).fill(false)
    const alignedPairs: AlignedSentencePair[] = []

    for (const pair of candidatePairs) {
        if (!usedA[pair.i] && !usedB[pair.j]) {
            usedA[pair.i] = true
            usedB[pair.j] = true
            alignedPairs.push({
                sentenceA: sentencesA[pair.i],
                sentenceB: sentencesB[pair.j],
                similarity: Math.round(pair.sim * 1000) / 1000,
                indexA: pair.i,
                indexB: pair.j,
            })
        }
    }

    return {
        semanticScore: Math.max(0, Math.min(1.0, compositeScore)),
        coverageAToB: Math.round(coverageAToB * 1000) / 1000,
        coverageBToA: Math.round(coverageBToA * 1000) / 1000,
        docASentences: nA,
        docBSentences: nB,
        alignedPairs,
        threshold: t,
        method: "local_typescript",
    }
}

/**
 * Strangler Fig proxy for Semantic & Paraphrase Similarity Analysis:
 * Dispatches analysis to Rust Engine (/api/v1/semantic/analyze) if available.
 * Gracefully falls back to local TypeScript implementation if offline or unconfigured.
 */
export async function analyzeSemanticSimilarityWithEngine(
    docA: string,
    docB: string,
    threshold = 0.75
): Promise<SemanticAnalyzeResult> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/semantic/analyze`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    docA,
                    docB,
                    threshold,
                }),
                signal: AbortSignal.timeout(5000),
            })

            if (res.ok) {
                const data = (await res.json()) as SemanticAnalyzeResult
                data.method = "engine_rust"
                return data
            }

            console.warn(`[Clio Engine] Semantic endpoint responded with HTTP ${res.status}; falling back to local TypeScript engine.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local TypeScript engine.`)
        }
    }

    return localAnalyzeSemanticSimilarity(docA, docB, threshold)
}

/**
 * Dependency-free Abramowitz & Stegun Formula 7.1.26 polynomial approximation for erf(x).
 */
export function erfApprox(x: number): number {
    if (isNaN(x)) return NaN
    const sign = x < 0 ? -1 : 1
    const absX = Math.abs(x)

    const p = 0.3275911
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429

    const t = 1.0 / (1.0 + p * absX)
    const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
    const result = 1.0 - poly * Math.exp(-absX * absX)

    return sign * result
}

export function standardNormalCdf(z: number): number {
    return 0.5 * (1.0 + erfApprox(z / Math.SQRT2))
}

/**
 * Local pure-TypeScript fallback for Cognitive Process Keystroke Telemetry Audit.
 */
export function localAuditKeystrokeProcess(
    events: ProcessKeystrokeEvent[],
    _sessionId?: string
): ProcessAuditResult {
    if (!events || events.length < 2) {
        return {
            isAuthentic: true,
            confidenceScore: 50.0,
            pBurstMean: 0,
            rBurstMean: 0,
            revisionRatio: 0,
            cognitivePauseRatio: 0,
            logMean: 0,
            logStdDev: 0,
            ksDStatistic: 0,
            rapidIntervalCount: 0,
            validIntervalCount: 0,
            flags: ["Insufficient keystroke data for cognitive analysis (N < 2)"],
            method: "local_typescript",
        }
    }

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
    const totalIntervals = sorted.length - 1
    let rapidIntervalCount = 0
    const validLogs: number[] = []
    const validDeltas: number[] = []

    let insertions = 0
    let deletions = 0

    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].op === "insert") insertions++
        else if (sorted[i].op === "delete") deletions++

        const delta = Math.max(0, sorted[i + 1].timestamp - sorted[i].timestamp)
        if (delta < 20) {
            rapidIntervalCount++
        } else if (delta <= 10000) {
            validLogs.push(Math.log(delta))
            validDeltas.push(delta)
        }
    }
    if (sorted[sorted.length - 1].op === "insert") insertions++
    else if (sorted[sorted.length - 1].op === "delete") deletions++

    const flags: string[] = []
    let rapidBot = false
    if (
        rapidIntervalCount > 10 ||
        (totalIntervals > 10 && rapidIntervalCount / totalIntervals > 0.1)
    ) {
        rapidBot = true
        flags.push(
            `Automated high-frequency macro injection (<20ms intervals: ${rapidIntervalCount}/${totalIntervals})`
        )
    }

    const n = validLogs.length
    if (n < 10) {
        const revRatio = deletions / Math.max(insertions, 1)
        if (!rapidBot) {
            flags.push("Insufficient keystroke data for cognitive analysis (N < 10)")
        }
        return {
            isAuthentic: !rapidBot,
            confidenceScore: rapidBot ? 20.0 : 50.0,
            pBurstMean: 0,
            rBurstMean: 0,
            revisionRatio: Math.round(revRatio * 1000) / 1000,
            cognitivePauseRatio: 0,
            logMean: 0,
            logStdDev: 0,
            ksDStatistic: rapidBot ? 1.0 : 0,
            rapidIntervalCount,
            validIntervalCount: n,
            flags,
            method: "local_typescript",
        }
    }

    let sumLog = 0
    let sumSqLog = 0
    for (const x of validLogs) {
        sumLog += x
        sumSqLog += x * x
    }
    const meanLog = sumLog / n
    const varLog = Math.max(1e-4, sumSqLog / n - meanLog * meanLog)
    const stdDevLog = Math.sqrt(varLog)
    const tauCog = Math.exp(meanLog + 2.0 * stdDevLog)

    const cogPauseThresh = Math.max(300, Math.exp(meanLog))
    let cogPauseCount = 0
    for (const d of validDeltas) {
        if (d >= cogPauseThresh) cogPauseCount++
    }
    const cognitivePauseRatio = cogPauseCount / n

    let transcription = false
    if (n >= 30 && cognitivePauseRatio < 0.05) {
        transcription = true
        flags.push(
            `Sight-reading transcription detected (cognitive pauses suppressed: ${(cognitivePauseRatio * 100).toFixed(1)}%)`
        )
    }

    let varianceCollapse = false
    if (n >= 20 && stdDevLog < 0.15) {
        varianceCollapse = true
        flags.push(
            `Automated macro injection detected (robotic uniform interval variance: std_log=${stdDevLog.toFixed(3)})`
        )
    }

    const sortedLogs = [...validLogs].sort((a, b) => a - b)
    let ksDMax = 0
    for (let k = 0; k < n; k++) {
        const z = (sortedLogs[k] - meanLog) / stdDevLog
        const cdfTheo = standardNormalCdf(z)
        const cdfEmpUpper = (k + 1) / n
        const cdfEmpLower = k / n
        const diffUpper = Math.abs(cdfEmpUpper - cdfTheo)
        const diffLower = Math.abs(cdfTheo - cdfEmpLower)
        if (diffUpper > ksDMax) ksDMax = diffUpper
        if (diffLower > ksDMax) ksDMax = diffLower
    }

    let ksBot = false
    if (n >= 20 && (ksDMax > 0.45 || (ksDMax > 0.35 && cognitivePauseRatio < 0.08))) {
        ksBot = true
        flags.push(
            `Automated macro injection detected (non-log-normal interval distribution, KS D=${ksDMax.toFixed(3)})`
        )
    }

    let pBurstSum = 0
    let pBurstCount = 0
    let curPLen = 0

    let rBurstSum = 0
    let rBurstCount = 0
    let curRLen = 0

    for (let i = 0; i < sorted.length - 1; i++) {
        const delta = Math.max(0, sorted[i + 1].timestamp - sorted[i].timestamp)
        if (delta < 20 || delta > 10000 || delta >= tauCog) {
            if (curPLen > 0) {
                pBurstSum += curPLen
                pBurstCount++
                curPLen = 0
            }
        } else if (sorted[i].op === "insert") {
            curPLen++
        }

        if (sorted[i + 1].op === "delete") {
            if (curRLen > 0) {
                rBurstSum += curRLen
                rBurstCount++
                curRLen = 0
            }
        } else if (sorted[i].op === "insert") {
            curRLen++
        }
    }
    if (curPLen > 0) {
        pBurstSum += curPLen
        pBurstCount++
    }
    if (curRLen > 0) {
        rBurstSum += curRLen
        rBurstCount++
    }

    const pBurstMean = pBurstCount > 0 ? pBurstSum / pBurstCount : pBurstSum
    const rBurstMean = rBurstCount > 0 ? rBurstSum / rBurstCount : rBurstSum
    const revisionRatio = deletions / Math.max(insertions, 1)

    let zeroRevision = false
    if (n >= 30 && revisionRatio < 0.02) {
        zeroRevision = true
        flags.push(`Unnatural zero-revision accretion (R_rev=${revisionRatio.toFixed(3)} < 0.02)`)
    }

    let penalty = 0
    if (rapidBot) penalty += 45
    if (transcription) penalty += 40
    if (varianceCollapse) penalty += 40
    if (ksBot) penalty += 30
    if (zeroRevision) penalty += 20

    const confidenceScore = Math.max(0, Math.min(100, 100 - penalty))
    const isAuthentic = confidenceScore >= 70 && flags.length === 0

    return {
        isAuthentic,
        confidenceScore: Math.round(confidenceScore * 10) / 10,
        pBurstMean: Math.round(pBurstMean * 100) / 100,
        rBurstMean: Math.round(rBurstMean * 100) / 100,
        revisionRatio: Math.round(revisionRatio * 1000) / 1000,
        cognitivePauseRatio: Math.round(cognitivePauseRatio * 1000) / 1000,
        logMean: Math.round(meanLog * 1000) / 1000,
        logStdDev: Math.round(stdDevLog * 1000) / 1000,
        ksDStatistic: Math.round(ksDMax * 1000) / 1000,
        rapidIntervalCount,
        validIntervalCount: n,
        flags,
        method: "local_typescript",
    }
}

/**
 * Strangler Fig proxy for Cognitive Process Keystroke Telemetry Audit:
 * Dispatches stream analysis to Rust Engine (/api/v1/telemetry/process) if available.
 * Gracefully falls back to local TypeScript implementation if offline or unconfigured.
 */
export async function auditKeystrokeProcessWithEngine(
    events: ProcessKeystrokeEvent[],
    sessionId?: string
): Promise<ProcessAuditResult> {
    const engineUrl = getEngineUrl()

    if (engineUrl) {
        try {
            const res = await fetch(`${engineUrl}/api/v1/telemetry/process`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getEngineHeaders(),
                },
                body: JSON.stringify({
                    events,
                    sessionId,
                }),
                signal: AbortSignal.timeout(5000),
            })

            if (res.ok) {
                const data = (await res.json()) as ProcessAuditResult
                data.method = "engine_rust"
                return data
            }

            console.warn(`[Clio Engine] Telemetry process endpoint responded with HTTP ${res.status}; falling back to local TypeScript engine.`)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[Clio Engine] Rust engine unreachable (${msg}); falling back to local TypeScript engine.`)
        }
    }

    return localAuditKeystrokeProcess(events, sessionId)
}



