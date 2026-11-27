"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
    Loader2,
    ArrowLeft,
    BarChart3,
    TrendingUp,
    Users,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Download,
    BookOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { WebGLShader } from "@/components/ui/web-gl-shader"

interface AnalyticsData {
    summary: {
        totalSubmissions: number
        avgIntegrity: number
        totalFlagged: number
        totalGraded: number
        totalUngraded: number
        avgWpm: number
    }
    integrityDistribution: Array<{ range: string; count: number }>
    submissionsTimeline: Array<{ date: string; count: number }>
    assignmentStats: Array<{
        key: string
        title: string
        submissions: number
        avgIntegrity: number
        flagged: number
        graded: number
        ungraded: number
        avgGrade: number | null
    }>
    gradeDistribution: Array<{ range: string; count: number }>
}

function Bar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
    const pct = max > 0 ? (value / max) * 100 : 0
    return (
        <div className="h-full w-full flex items-end">
            <div
                className={`w-full rounded-t-sm transition-all duration-500 ${color}`}
                style={{ height: `${Math.max(pct, 2)}%` }}
            />
        </div>
    )
}

export default function AnalyticsPage() {
    const router = useRouter()
    const [data, setData] = useState<AnalyticsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Auth check
    useEffect(() => {
        async function check() {
            try {
                const res = await fetch("/api/auth/session", { credentials: "include" })
                if (!res.ok) { router.replace("/login"); return }
                const d = await res.json()
                if (!d.authenticated || d.role !== "teacher") router.replace("/login")
            } catch { router.replace("/login") }
        }
        check()
    }, [router])

    const fetchAnalytics = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/analytics", { credentials: "include" })
            if (!res.ok) throw new Error(`Error ${res.status}`)
            setData(await res.json())
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load analytics")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

    const handleExportCSV = () => { window.location.href = "/api/export/grades" }

    const maxIntegrity = data ? Math.max(...data.integrityDistribution.map(d => d.count), 1) : 1
    const maxTimeline = data ? Math.max(...data.submissionsTimeline.map(d => d.count), 1) : 1
    const maxGrade = data ? Math.max(...data.gradeDistribution.map(d => d.count), 1) : 1

    return (
        <div className="relative min-h-[125vh] w-full bg-background text-foreground font-sans">
            <div className="fixed inset-0 z-0 opacity-40"><WebGLShader /></div>

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between border-b border-white/10 bg-black/50 px-6 py-4 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
                        <ArrowLeft className="h-4 w-4" /><span className="text-sm font-medium">Dashboard</span>
                    </button>
                    <div className="h-5 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                            <BarChart3 className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-white tracking-tight">Analytics</span>
                            <span className="text-xs text-white/40">Submission insights &amp; grade distributions</span>
                        </div>
                    </div>
                </div>
                <Button onClick={handleExportCSV} variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/10">
                    <Download className="h-4 w-4 mr-1.5" />Export CSV
                </Button>
            </header>

            {/* Main */}
            <main className="relative z-10 max-w-6xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="h-8 w-8 animate-spin text-white/40" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3">
                        <XCircle className="h-10 w-10 text-red-400/60" />
                        <p className="text-sm text-red-400/80">{error}</p>
                        <Button variant="ghost" size="sm" onClick={fetchAnalytics} className="text-white/60">Retry</Button>
                    </div>
                ) : data ? (
                    <div className="space-y-8">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            {[
                                { label: "Total Submissions", value: data.summary.totalSubmissions, icon: BookOpen, color: "text-blue-400" },
                                { label: "Avg Integrity", value: `${data.summary.avgIntegrity}%`, icon: CheckCircle, color: data.summary.avgIntegrity >= 70 ? "text-green-400" : "text-yellow-400" },
                                { label: "Flagged", value: data.summary.totalFlagged, icon: AlertTriangle, color: "text-red-400" },
                                { label: "Graded", value: `${data.summary.totalGraded} / ${data.summary.totalSubmissions}`, icon: TrendingUp, color: "text-purple-400" },
                                { label: "Avg WPM", value: data.summary.avgWpm, icon: Users, color: "text-cyan-400" },
                            ].map((card) => (
                                <div key={card.label} className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <card.icon className={`h-4 w-4 ${card.color}`} />
                                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">{card.label}</span>
                                    </div>
                                    <span className={`text-2xl font-bold ${card.color}`}>{card.value}</span>
                                </div>
                            ))}
                        </div>

                        {/* Charts Grid */}
                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Integrity Distribution */}
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-6">
                                <h3 className="text-sm font-bold text-white mb-4">Integrity Score Distribution</h3>
                                <div className="flex items-end gap-1 h-40">
                                    {data.integrityDistribution.map((bucket) => (
                                        <div key={bucket.range} className="flex-1 relative group h-full">
                                            <Bar value={bucket.count} max={maxIntegrity} color={
                                                (() => {
                                                    const rangeVal = bucket.range === "100" ? 100
                                                        : parseInt(bucket.range.split("-")[0], 10)
                                                    if (isNaN(rangeVal)) return "bg-red-500/70"
                                                    if (rangeVal >= 100) return "bg-green-500"
                                                    if (rangeVal >= 70) return "bg-green-500/70"
                                                    if (rangeVal >= 50) return "bg-yellow-500/70"
                                                    return "bg-red-500/70"
                                                })()
                                            } />
                                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap">
                                                {bucket.range}: {bucket.count}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between mt-2">
                                    <span className="text-[9px] text-white/30">0</span>
                                    <span className="text-[9px] text-white/30">50</span>
                                    <span className="text-[9px] text-white/30">100</span>
                                </div>
                            </div>

                            {/* Grade Distribution */}
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-6">
                                <h3 className="text-sm font-bold text-white mb-4">Grade Distribution</h3>
                                <div className="flex items-end gap-1 h-40">
                                    {data.gradeDistribution.map((bucket) => (
                                        <div key={bucket.range} className="flex-1 relative group h-full">
                                            <Bar value={bucket.count} max={maxGrade} color="bg-purple-500/70" />
                                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap">
                                                {bucket.range}: {bucket.count}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between mt-2">
                                    <span className="text-[9px] text-white/30">0</span>
                                    <span className="text-[9px] text-white/30">50</span>
                                    <span className="text-[9px] text-white/30">100</span>
                                </div>
                            </div>

                            {/* Submissions Timeline */}
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-6 md:col-span-2">
                                <h3 className="text-sm font-bold text-white mb-4">Submissions Over Time</h3>
                                {data.submissionsTimeline.length === 0 ? (
                                    <p className="text-xs text-white/30 text-center py-8">No submission data yet</p>
                                ) : (
                                    <>
                                        {(() => {
                                            const visible = data.submissionsTimeline.slice(-30)
                                            return (
                                                <>
                                                    <div className="flex items-end gap-1 h-32">
                                                        {visible.map((d) => (
                                                            <div key={d.date} className="flex-1 relative group h-full">
                                                                <Bar value={d.count} max={maxTimeline} color="bg-cyan-500/70" />
                                                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                                                                    {d.date}: {d.count}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="flex justify-between mt-2">
                                                        <span className="text-[9px] text-white/30">{visible[0]?.date}</span>
                                                        <span className="text-[9px] text-white/30">{visible[visible.length - 1]?.date}</span>
                                                    </div>
                                                </>
                                            )
                                        })()}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Per-Assignment Table */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md overflow-hidden">
                            <div className="px-6 py-4 border-b border-white/5">
                                <h3 className="text-sm font-bold text-white">Per-Assignment Breakdown</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-white/5 text-white/40">
                                            <th className="text-left px-6 py-3 font-semibold">Assignment</th>
                                            <th className="text-center px-4 py-3 font-semibold">Submissions</th>
                                            <th className="text-center px-4 py-3 font-semibold">Avg Integrity</th>
                                            <th className="text-center px-4 py-3 font-semibold">Flagged</th>
                                            <th className="text-center px-4 py-3 font-semibold">Graded</th>
                                            <th className="text-center px-4 py-3 font-semibold">Ungraded</th>
                                            <th className="text-center px-4 py-3 font-semibold">Avg Grade</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.assignmentStats.map((a) => (
                                            <tr key={a.key} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                                <td className="px-6 py-3 text-white font-medium truncate max-w-[200px]">{a.title}</td>
                                                <td className="text-center px-4 py-3 text-white/60">{a.submissions}</td>
                                                <td className="text-center px-4 py-3">
                                                    <span className={`font-semibold ${a.avgIntegrity >= 70 ? 'text-green-400' : a.avgIntegrity >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                        {a.avgIntegrity}%
                                                    </span>
                                                </td>
                                                <td className="text-center px-4 py-3">
                                                    <span className={`${a.flagged > 0 ? 'text-red-400 font-semibold' : 'text-white/30'}`}>{a.flagged}</span>
                                                </td>
                                                <td className="text-center px-4 py-3 text-white/60">{a.graded}</td>
                                                <td className="text-center px-4 py-3">
                                                    {a.ungraded > 0 ? <span className="text-yellow-400 font-semibold">{a.ungraded}</span> : <span className="text-white/30">0</span>}
                                                </td>
                                                <td className="text-center px-4 py-3 text-white/60">{a.avgGrade !== null ? `${a.avgGrade}%` : "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : null}
            </main>
        </div>
    )
}
