"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
    Loader2,
    ArrowLeft,
    ShieldAlert,
    Users,
    XCircle,
    AlertTriangle,
    Search,
    FileText,
    Eye,
    EyeOff,
    ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { WebGLShader } from "@/components/ui/web-gl-shader"

interface SimilarityPair {
    submission1: { id: string; student: string; username: string }
    submission2: { id: string; student: string; username: string }
    similarity: number
    sharedShingles: number
    assignment: string
}

interface SimilarityData {
    pairs: SimilarityPair[]
    totalComparisons: number
    threshold: number
}

export default function SimilarityPage() {
    const router = useRouter()
    const [data, setData] = useState<SimilarityData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState("")
    const [expandedPair, setExpandedPair] = useState<string | null>(null)
    const [pairContent, setPairContent] = useState<{ content1: string; content2: string } | null>(null)
    const [loadingContent, setLoadingContent] = useState(false)

    const [isAuthenticated, setIsAuthenticated] = useState(false)

    useEffect(() => {
        async function check() {
            try {
                const res = await fetch("/api/auth/session", { credentials: "include" })
                if (!res.ok) { router.replace("/login"); return }
                const d = await res.json()
                if (!d.authenticated || d.role !== "teacher") {
                    router.replace("/login")
                    return
                }
                setIsAuthenticated(true)
            } catch { router.replace("/login") }
        }
        check()
    }, [router])

    const fetchSimilarity = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/similarity", { credentials: "include" })
            if (!res.ok) throw new Error(`Error ${res.status}`)
            setData(await res.json())
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load similarity data")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (isAuthenticated) fetchSimilarity()
    }, [isAuthenticated, fetchSimilarity])

    const severityColor = (pct: number) => {
        if (pct >= 70) return "text-red-400 bg-red-500/10 border-red-500/20"
        if (pct >= 50) return "text-orange-400 bg-orange-500/10 border-orange-500/20"
        if (pct >= 35) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
        return "text-blue-400 bg-blue-500/10 border-blue-500/20"
    }

    const severityLabel = (pct: number) => {
        if (pct >= 70) return "High"
        if (pct >= 50) return "Medium"
        if (pct >= 35) return "Low"
        return "Minimal"
    }

    const abortControllerRef = useRef<AbortController | null>(null)

    // ── Load pair content for comparison ──
    const togglePairView = async (pair: SimilarityPair) => {
        const pairKey = `${pair.submission1.id}-${pair.submission2.id}`

        if (expandedPair === pairKey) {
            setExpandedPair(null)
            setPairContent(null)
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
                abortControllerRef.current = null
            }
            return
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        const abortController = new AbortController()
        abortControllerRef.current = abortController

        setExpandedPair(pairKey)
        setLoadingContent(true)
        try {
            const [res1, res2] = await Promise.all([
                fetch(`/api/submissions/${pair.submission1.id}`, { credentials: "include", signal: abortController.signal }),
                fetch(`/api/submissions/${pair.submission2.id}`, { credentials: "include", signal: abortController.signal }),
            ])
            const data1 = res1.ok ? await res1.json().catch(() => null) : null
            const data2 = res2.ok ? await res2.json().catch(() => null) : null

            if (abortController.signal.aborted) return

            setPairContent({
                content1: data1?.content || data1?.[0]?.content || "Content unavailable",
                content2: data2?.content || data2?.[0]?.content || "Content unavailable",
            })
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return
            setPairContent({ content1: "Failed to load", content2: "Failed to load" })
        }
        setLoadingContent(false)
    }

    const filteredPairs = data?.pairs.filter(p => {
        if (!filter) return true
        const q = filter.toLowerCase()
        return p.assignment.toLowerCase().includes(q) ||
            p.submission1.student.toLowerCase().includes(q) ||
            p.submission2.student.toLowerCase().includes(q) ||
            p.submission1.username.toLowerCase().includes(q) ||
            p.submission2.username.toLowerCase().includes(q)
    }) ?? []

    return (
        <div className="relative min-h-[125vh] w-full bg-background text-foreground font-sans">
            <div className="fixed inset-0 z-0 opacity-40"><WebGLShader /></div>

            <header className="relative z-10 flex items-center justify-between border-b border-white/10 bg-black/50 px-6 py-4 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
                        <ArrowLeft className="h-4 w-4" /><span className="text-sm font-medium">Dashboard</span>
                    </button>
                    <div className="h-5 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center">
                            <ShieldAlert className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-white tracking-tight">Similarity Check</span>
                            <span className="text-xs text-white/40">Detect potential plagiarism across submissions</span>
                        </div>
                    </div>
                </div>
                <Button variant="ghost" size="sm" onClick={fetchSimilarity} className="text-white/60 hover:text-white hover:bg-white/10">
                    Refresh
                </Button>
            </header>

            <main className="relative z-10 max-w-4xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="h-8 w-8 animate-spin text-white/40" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3">
                        <XCircle className="h-10 w-10 text-red-400/60" />
                        <p className="text-sm text-red-400/80">{error}</p>
                        <Button variant="ghost" size="sm" onClick={fetchSimilarity} className="text-white/60">Retry</Button>
                    </div>
                ) : data ? (
                    <div className="space-y-6">
                        {/* Summary */}
                        <div className="flex items-center gap-6">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md px-5 py-3 flex items-center gap-3">
                                <Users className="h-4 w-4 text-white/40" />
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Comparisons</p>
                                    <p className="text-lg font-bold text-white">{data.totalComparisons}</p>
                                </div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md px-5 py-3 flex items-center gap-3">
                                <AlertTriangle className={`h-4 w-4 ${data.pairs.length > 0 ? 'text-red-400' : 'text-green-400'}`} />
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Flagged Pairs</p>
                                    <p className={`text-lg font-bold ${data.pairs.length > 0 ? 'text-red-400' : 'text-green-400'}`}>{data.pairs.length}</p>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                                    <input
                                        type="text"
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        placeholder="Filter by student or assignment…"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Results */}
                        {filteredPairs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-3">
                                <div className="h-16 w-16 rounded-2xl border border-green-500/20 bg-green-500/5 flex items-center justify-center">
                                    <ShieldAlert className="h-8 w-8 text-green-400/60" />
                                </div>
                                <p className="text-sm text-white/50">No similar submissions detected</p>
                                <p className="text-xs text-white/30">Threshold: {data.threshold}% Jaccard similarity on 4-gram shingles</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filteredPairs.map((pair) => {
                                    const pairKey = `${pair.submission1.id}-${pair.submission2.id}`;
                                    return (
                                        <div key={pairKey} className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md overflow-hidden hover:border-white/20 transition-all">
                                            <div
                                                className="p-5 cursor-pointer focus:outline-none focus:bg-white/[0.05]"
                                                onClick={() => togglePairView(pair)}
                                                tabIndex={0}
                                                role="button"
                                                aria-expanded={expandedPair === pairKey}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault()
                                                        togglePairView(pair)
                                                    }
                                                }}
                                            >
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                                        {/* Student A */}
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shrink-0">
                                                                <span className="text-[10px] font-bold text-white">{pair.submission1.student.charAt(0).toUpperCase()}</span>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-white truncate">{pair.submission1.student}</p>
                                                                <p className="text-[10px] text-white/30">@{pair.submission1.username}</p>
                                                            </div>
                                                        </div>

                                                        {/* Similarity Badge */}
                                                        <div className={`shrink-0 flex flex-col items-center gap-0.5 rounded-xl border px-4 py-2 ${severityColor(pair.similarity)}`}>
                                                            <span className="text-lg font-bold">{pair.similarity}%</span>
                                                            <span className="text-[9px] uppercase tracking-wider font-semibold">{severityLabel(pair.similarity)}</span>
                                                        </div>

                                                        {/* Student B */}
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shrink-0">
                                                                <span className="text-[10px] font-bold text-white">{pair.submission2.student.charAt(0).toUpperCase()}</span>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-white truncate">{pair.submission2.student}</p>
                                                                <p className="text-[10px] text-white/30">@{pair.submission2.username}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <ChevronDown className={`h-4 w-4 text-white/30 transition-transform ${expandedPair === pairKey ? "rotate-180" : ""}`} />
                                                </div>
                                                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
                                                    <FileText className="h-3 w-3 text-white/30" />
                                                    <span className="text-[10px] text-white/40 font-medium">{pair.assignment}</span>
                                                    <span className="text-[10px] text-white/20">•</span>
                                                    <span className="text-[10px] text-white/30">{pair.sharedShingles} shared text segments</span>
                                                    <span className="text-[10px] text-white/20 ml-auto">
                                                        {expandedPair === pairKey ? <EyeOff className="h-3 w-3 inline" /> : <Eye className="h-3 w-3 inline" />}
                                                        <span className="ml-1">{expandedPair === pairKey ? "Hide" : "Compare"}</span>
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Expandable Content Comparison */}
                                            {expandedPair === pairKey && (
                                                <div className="border-t border-white/10 p-5">
                                                    {loadingContent ? (
                                                        <div className="flex items-center justify-center h-20">
                                                            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                                                        </div>
                                                    ) : pairContent ? (
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div>
                                                                <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                                    <div className="h-2 w-2 rounded-full bg-blue-400" />
                                                                    {pair.submission1.student}
                                                                </div>
                                                                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-white/70 leading-relaxed max-h-60 overflow-y-auto glass-scroll whitespace-pre-wrap">
                                                                    {pairContent.content1.replace(/<[^>]*>/g, "").slice(0, 2000)}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div className="text-[10px] text-orange-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                                    <div className="h-2 w-2 rounded-full bg-orange-400" />
                                                                    {pair.submission2.student}
                                                                </div>
                                                                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-white/70 leading-relaxed max-h-60 overflow-y-auto glass-scroll whitespace-pre-wrap">
                                                                    {pairContent.content2.replace(/<[^>]*>/g, "").slice(0, 2000)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                ) : null}
            </main>
        </div>
    )
}
