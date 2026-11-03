import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/student-analytics — Student's personal performance analytics ──
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "student") {
        return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr || !profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Fetch all submissions with grades
    const { data: submissions, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            wpm,
            paste_count,
            integrity_score,
            submitted_at,
            grade:grades ( score, feedback, graded_at )
        `)
        .eq("student_id", profile.id)
        .order("submitted_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const subs = submissions ?? []

    // ── 1. Summary Stats ──
    const totalSubmissions = subs.length
    const avgWpm = totalSubmissions > 0
        ? Math.round(subs.reduce((a, s) => a + (s.wpm ?? 0), 0) / totalSubmissions)
        : 0
    const avgIntegrity = totalSubmissions > 0
        ? Math.round(subs.reduce((a, s) => a + (s.integrity_score ?? 0), 0) / totalSubmissions)
        : 0

    const gradedSubs = subs.filter(s => {
        const g = Array.isArray(s.grade) ? s.grade[0] : s.grade
        return g?.score !== undefined && g?.score !== null
    })
    const avgGrade = gradedSubs.length > 0
        ? Math.round(gradedSubs.reduce((a, s) => {
            const g = Array.isArray(s.grade) ? s.grade[0] : s.grade
            return a + (g?.score ?? 0)
        }, 0) / gradedSubs.length)
        : null

    // ── 2. Performance Over Time (per submission) ──
    const performanceTimeline = subs.map(s => {
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
        return {
            date: s.submitted_at ? new Date(s.submitted_at).toISOString().slice(0, 10) : null,
            assignment: s.assignment_title,
            wpm: s.wpm ?? 0,
            integrity_score: s.integrity_score ?? 0,
            grade_score: grade?.score ?? null,
        }
    })

    // ── 3. WPM Trend (moving average of last 5) ──
    const wpmValues = subs.map(s => s.wpm ?? 0)
    const wpmTrend: { index: number; wpm: number; avg: number }[] = []
    for (let i = 0; i < wpmValues.length; i++) {
        const window = wpmValues.slice(Math.max(0, i - 4), i + 1)
        const avg = Math.round(window.reduce((a, b) => a + b, 0) / window.length)
        wpmTrend.push({ index: i, wpm: wpmValues[i], avg })
    }

    // ── 4. Improvement Metrics ──
    let wpmImprovement = null
    let integrityImprovement = null
    if (subs.length >= 3) {
        const firstThird = subs.slice(0, Math.ceil(subs.length / 3))
        const lastThird = subs.slice(-Math.ceil(subs.length / 3))
        const firstAvgWpm = Math.round(firstThird.reduce((a, s) => a + (s.wpm ?? 0), 0) / firstThird.length)
        const lastAvgWpm = Math.round(lastThird.reduce((a, s) => a + (s.wpm ?? 0), 0) / lastThird.length)
        wpmImprovement = lastAvgWpm - firstAvgWpm
        const firstAvgInt = Math.round(firstThird.reduce((a, s) => a + (s.integrity_score ?? 0), 0) / firstThird.length)
        const lastAvgInt = Math.round(lastThird.reduce((a, s) => a + (s.integrity_score ?? 0), 0) / lastThird.length)
        integrityImprovement = lastAvgInt - firstAvgInt
    }

    // ── 5. Grade Distribution ──
    const gradeDistribution = Array.from({ length: 11 }, (_, i) => ({
        range: i < 10 ? `${i * 10}-${i * 10 + 9}` : "100",
        count: 0,
    }))
    gradedSubs.forEach(s => {
        const g = Array.isArray(s.grade) ? s.grade[0] : s.grade
        const score = g?.score ?? 0
        if (score >= 100) gradeDistribution[10].count++
        else {
            const bucket = Math.max(0, Math.floor(score / 10))
            if (bucket >= 0 && bucket < 10) gradeDistribution[bucket].count++
        }
    })

    // ── 6. Streaks ──
    // Count consecutive days with submissions
    const uniqueDays = [...new Set(subs.map(s => s.submitted_at ? new Date(s.submitted_at).toISOString().slice(0, 10) : null).filter(Boolean))] as string[]
    let currentStreak = 0
    let longestStreak = uniqueDays.length > 0 ? 1 : 0
    let streak = 1
    for (let i = 1; i < uniqueDays.length; i++) {
        const prev = new Date(uniqueDays[i - 1])
        const curr = new Date(uniqueDays[i])
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 1) {
            streak++
        } else {
            if (streak > longestStreak) longestStreak = streak
            streak = 1
        }
    }
    if (uniqueDays.length > 0 && streak > longestStreak) longestStreak = streak
    // Check if last submission day is today or yesterday for current streak
    if (uniqueDays.length > 0) {
        const lastDay = new Date(uniqueDays[uniqueDays.length - 1])
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        lastDay.setHours(0, 0, 0, 0)
        const diff = Math.round((today.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24))
        if (diff <= 1) currentStreak = streak
    }

    return NextResponse.json({
        summary: {
            totalSubmissions,
            totalGraded: gradedSubs.length,
            avgWpm,
            avgIntegrity,
            avgGrade,
            currentStreak,
            longestStreak,
        },
        improvements: { wpmImprovement, integrityImprovement },
        performanceTimeline,
        wpmTrend,
        gradeDistribution,
    })
}
