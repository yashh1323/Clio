"use client"

import { signOut } from "@/lib/logout"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    Loader2, FileText, CheckCircle, Clock, BookOpen,
    Bell, ChevronRight, BarChart3, PenTool, GraduationCap, Star, Flame
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { WebGLShader } from "@/components/ui/web-gl-shader"
import { ThemeToggle } from "@/components/ui/theme-toggle"

// ── Types ──
interface Assignment {
    id: string
    title: string
    description: string | null
    due_date: string | null
    max_word_count: number | null
    teacher_id: string
}
interface Submission {
    id: string
    assignment_title: string
    timestamp: string
    integrity_score: number
    grade: { score: number; feedback: string; graded_at: string } | null
}
interface Notification {
    submission_id: string
    assignment_title: string
    score: number
    feedback: string
    graded_at: string
    graded_by: string
    is_unread: boolean
}

// ── Helpers ──
function scoreColor(score: number) {
    if (score >= 80) return "text-green-400"
    if (score >= 50) return "text-yellow-400"
    return "text-red-400"
}

function formatRelative(ts: string) {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(ts).toLocaleDateString()
}

export default function StudentDashboard() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [showNotifications, setShowNotifications] = useState(false)
    const [username, setUsername] = useState("")

    useEffect(() => {
        async function load() {
            try {
                // Auth check
                const authRes = await fetch("/api/auth/session", { credentials: "include" })
                if (!authRes.ok) { router.push("/login"); return }
                const authData = await authRes.json()
                if (authData.role !== "student") { router.push("/dashboard"); return }
                setUsername(authData.username || "Student")

                // Parallel fetch
                const [assignRes, subRes, notifRes] = await Promise.all([
                    fetch("/api/assignments", { credentials: "include" }),
                    fetch("/api/submissions/mine", { credentials: "include" }),
                    fetch("/api/notifications", { credentials: "include" }),
                ])

                if (assignRes.ok) setAssignments(await assignRes.json())
                if (subRes.ok) setSubmissions(await subRes.json())
                if (notifRes.ok) {
                    const data = await notifRes.json()
                    setNotifications(data.notifications ?? [])
                    setUnreadCount(data.unreadCount ?? 0)
                }
            } catch { /* silent */ }
            finally { setLoading(false) }
        }
        load()
    }, [router])

    // Build assignment status map
    const getAssignmentStatus = (assignment: Assignment) => {
        const relatedSubs = submissions.filter(s =>
            s.assignment_title === assignment.title
        )
        if (relatedSubs.length === 0) return "not_started"
        const hasGraded = relatedSubs.some(s => s.grade !== null)
        if (hasGraded) return "graded"
        return "submitted"
    }

    const statusConfig = {
        not_started: { icon: PenTool, label: "Not Started", color: "text-muted-foreground", bg: "bg-accent/20", border: "border-border" },
        submitted: { icon: Clock, label: "Submitted", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
        graded: { icon: CheckCircle, label: "Graded", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
    }

    const markNotificationsRead = async () => {
        setShowNotifications(v => !v)
        if (unreadCount > 0) {
            await fetch("/api/notifications", { method: "POST", credentials: "include" })
            setUnreadCount(0)
            setNotifications(prev => prev.map(n => ({ ...n, is_unread: false })))
        }
    }

    const handleLogout = async () => {
        if (!await signOut()) return
        router.push("/login")
    }

    const dueCountdown = (dueDate: string | null) => {
        if (!dueDate) return null
        const hours = (new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60)
        if (hours < 0) return { text: "Past Due", color: "text-red-400", urgent: true }
        if (hours < 24) return { text: `${Math.ceil(hours)}h left`, color: "text-yellow-400", urgent: true }
        const days = Math.ceil(hours / 24)
        return { text: `${days}d left`, color: "text-muted-foreground", urgent: false }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="relative min-h-screen w-full bg-background text-foreground overflow-auto font-sans">
            {/* Background */}
            <div className="fixed inset-0 opacity-20 pointer-events-none z-0">
                <WebGLShader />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600" />
                    <span className="text-sm font-bold tracking-tight">Clio</span>
                    <span className="text-xs text-muted-foreground">Student Dashboard</span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Notification Bell */}
                    <div className="relative">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={markNotificationsRead}
                            className="relative text-muted-foreground hover:text-foreground h-8 w-8 p-0"
                        >
                            <Bell className="h-4 w-4" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1 animate-pulse">
                                    {unreadCount}
                                </span>
                            )}
                        </Button>

                        {/* Notification dropdown */}
                        {showNotifications && (
                            <div className="absolute right-0 top-10 w-80 max-h-96 overflow-auto rounded-xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl z-50">
                                <div className="p-3 border-b border-border">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Grade Notifications</h3>
                                </div>
                                {notifications.length === 0 ? (
                                    <div className="p-6 text-center text-xs text-muted-foreground">No notifications yet</div>
                                ) : (
                                    notifications.slice(0, 20).map((n) => (
                                        <div
                                            key={n.submission_id}
                                            className={`p-3 border-b border-border/50 cursor-pointer hover:bg-accent/30 transition-colors ${n.is_unread ? "bg-blue-500/5" : ""}`}
                                            onClick={() => router.push("/submissions")}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-semibold truncate">{n.assignment_title}</span>
                                                <span className={`text-xs font-bold ${scoreColor(n.score)}`}>{n.score}/100</span>
                                            </div>
                                            {n.feedback && (
                                                <p className="text-[10px] text-muted-foreground truncate">{n.feedback}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] text-muted-foreground">{formatRelative(n.graded_at)}</span>
                                                <span className="text-[10px] text-muted-foreground">by {n.graded_by}</span>
                                                {n.is_unread && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    <Button variant="ghost" size="sm" onClick={() => router.push("/editor")} className="text-muted-foreground hover:text-foreground h-8 px-3">
                        <PenTool className="h-3.5 w-3.5 mr-1.5" />Write
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => router.push("/submissions")} className="text-muted-foreground hover:text-foreground h-8 px-3">My Submissions</Button>
                    <Button variant="ghost" size="sm" onClick={() => router.push("/student-analytics")} className="text-muted-foreground hover:text-foreground h-8 px-3">
                        <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Analytics
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => router.push("/drafts")} className="text-muted-foreground hover:text-foreground h-8 px-3">Drafts</Button>
                    <Button variant="ghost" size="sm" onClick={() => router.push("/profile")} className="text-muted-foreground hover:text-foreground h-8 px-3">Profile</Button>
                    <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground h-8 px-3">Logout</Button>
                    <ThemeToggle />
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 max-w-6xl mx-auto px-6 py-8">
                {/* Welcome Banner */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold mb-1">Welcome back, {username}</h1>
                    <p className="text-sm text-muted-foreground">
                        {assignments.length} assignment{assignments.length !== 1 ? "s" : ""} &middot;
                        {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
                    </p>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4 text-blue-400" />
                            <span className="text-xs text-muted-foreground">Submissions</span>
                        </div>
                        <span className="text-2xl font-bold">{submissions.length}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Star className="h-4 w-4 text-yellow-400" />
                            <span className="text-xs text-muted-foreground">Avg Grade</span>
                        </div>
                        <span className="text-2xl font-bold">
                            {(() => {
                                const graded = submissions.filter(s => s.grade)
                                if (graded.length === 0) return "—"
                                const avg = Math.round(graded.reduce((a, s) => a + (s.grade?.score ?? 0), 0) / graded.length)
                                return avg
                            })()}
                        </span>
                    </div>
                    <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="h-4 w-4 text-green-400" />
                            <span className="text-xs text-muted-foreground">Avg Integrity</span>
                        </div>
                        <span className="text-2xl font-bold">
                            {submissions.length > 0
                                ? Math.round(submissions.reduce((a, s) => a + s.integrity_score, 0) / submissions.length)
                                : "—"}
                        </span>
                    </div>
                    <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Flame className="h-4 w-4 text-orange-400" />
                            <span className="text-xs text-muted-foreground">Pending Grades</span>
                        </div>
                        <span className="text-2xl font-bold">
                            {submissions.filter(s => !s.grade).length}
                        </span>
                    </div>
                </div>

                {/* Assignments Section */}
                <div className="mb-8">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        My Assignments
                    </h2>
                    {assignments.length === 0 ? (
                        <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-8 text-center">
                            <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">No assignments yet. Your teacher will post assignments for you.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {assignments.map(a => {
                                const statusKey = getAssignmentStatus(a)
                                const config = statusConfig[statusKey]
                                const StatusIcon = config.icon
                                const due = dueCountdown(a.due_date)
                                const relatedSubs = submissions.filter(s => s.assignment_title === a.title)
                                const latestGrade = relatedSubs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).find(s => s.grade)?.grade

                                return (
                                    <div
                                        key={a.id}
                                        className={`rounded-xl border ${config.border} ${config.bg} backdrop-blur-md p-5 cursor-pointer hover:scale-[1.02] transition-all duration-200 group`}
                                        onClick={() => {
                                            // Navigate to editor with this assignment pre-selected
                                            localStorage.setItem("clio_preselect_assignment", a.id)
                                            router.push("/editor")
                                        }}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <StatusIcon className={`h-4 w-4 ${config.color}`} />
                                                <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
                                                    {config.label}
                                                </span>
                                            </div>
                                            {due && (
                                                <span className={`text-[10px] font-semibold ${due.color} ${due.urgent ? "animate-pulse" : ""}`}>
                                                    <Clock className="h-3 w-3 inline mr-1" />
                                                    {due.text}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-sm font-bold mb-1 group-hover:text-foreground transition-colors">{a.title}</h3>
                                        {a.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{a.description.replace(/<[^>]*>/g, "")}</p>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                                {a.max_word_count && <span>{a.max_word_count} words max</span>}
                                                {relatedSubs.length > 0 && <span>{relatedSubs.length} submission{relatedSubs.length > 1 ? "s" : ""}</span>}
                                            </div>
                                            {latestGrade && (
                                                <span className={`text-xs font-bold ${scoreColor(latestGrade.score)}`}>
                                                    {latestGrade.score}/100
                                                </span>
                                            )}
                                            {!latestGrade && statusKey === "not_started" && (
                                                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Recent Submissions */}
                <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Recent Submissions
                    </h2>
                    {submissions.length === 0 ? (
                        <div className="rounded-xl border border-border bg-accent/10 backdrop-blur-md p-8 text-center">
                            <p className="text-sm text-muted-foreground">No submissions yet. Start writing to see your work here.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {submissions.slice(0, 10).map(s => (
                                <div
                                    key={s.id}
                                    className="flex items-center justify-between rounded-lg border border-border bg-accent/10 backdrop-blur-md px-4 py-3 hover:bg-accent/20 transition-colors cursor-pointer"
                                    onClick={() => router.push("/submissions")}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{s.assignment_title}</p>
                                            <p className="text-xs text-muted-foreground">{formatRelative(s.timestamp)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <span className={`text-xs font-semibold ${scoreColor(s.integrity_score)}`}>
                                            Integrity: {s.integrity_score}
                                        </span>
                                        {s.grade ? (
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreColor(s.grade.score)} bg-accent/20`}>
                                                {s.grade.score}/100
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Pending</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
