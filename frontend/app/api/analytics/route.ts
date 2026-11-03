import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/analytics — Teacher analytics aggregation ──
// Returns: integrity distribution, submissions over time, assignment stats, grade distribution
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    // Fetch all submissions for this teacher
    const { data: submissions, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            integrity_score,
            wpm,
            paste_count,
            submitted_at,
            grade:grades ( score )
        `)
        .eq("teacher_id", profile.id)
        .order("submitted_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const subs = submissions ?? []

    // ── 1. Integrity score distribution (histogram buckets of 10) ──
    const integrityDistribution = Array.from({ length: 10 }, (_, i) => ({
        range: `${i * 10}-${i * 10 + 9}`,
        min: i * 10,
        max: i * 10 + 9,
        count: 0,
    }))
    // Special bucket: 100
    integrityDistribution.push({ range: "100", min: 100, max: 100, count: 0 })

    subs.forEach(s => {
        const score = s.integrity_score ?? 0
        if (score === 100) {
            integrityDistribution[10].count++
        } else {
            const bucket = Math.floor(score / 10)
            if (bucket >= 0 && bucket < 10) integrityDistribution[bucket].count++
        }
    })

    // ── 2. Submissions over time (group by day) ──
    const submissionsByDay: Record<string, number> = {}
    subs.forEach(s => {
        if (s.submitted_at) {
            const day = new Date(s.submitted_at).toISOString().slice(0, 10)
            submissionsByDay[day] = (submissionsByDay[day] ?? 0) + 1
        }
    })
    const submissionsTimeline = Object.entries(submissionsByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }))

    // ── 3. Per-assignment stats ──
    const assignmentMap: Record<string, { count: number; totalScore: number; flagged: number; graded: number; totalGrade: number }> = {}
    subs.forEach(s => {
        const key = s.assignment_title || "Untitled"
        if (!assignmentMap[key]) assignmentMap[key] = { count: 0, totalScore: 0, flagged: 0, graded: 0, totalGrade: 0 }
        assignmentMap[key].count++
        assignmentMap[key].totalScore += s.integrity_score ?? 0
        if ((s.integrity_score ?? 100) < 50) assignmentMap[key].flagged++
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
        if (grade?.score !== undefined && grade?.score !== null) {
            assignmentMap[key].graded++
            assignmentMap[key].totalGrade += grade.score
        }
    })
    const assignmentStats = Object.entries(assignmentMap).map(([title, stats]) => ({
        title,
        submissions: stats.count,
        avgIntegrity: stats.count > 0 ? Math.round(stats.totalScore / stats.count) : 0,
        flagged: stats.flagged,
        graded: stats.graded,
        ungraded: stats.count - stats.graded,
        avgGrade: stats.graded > 0 ? Math.round(stats.totalGrade / stats.graded) : null,
    }))

    // ── 4. Grade distribution (0-100 in buckets of 10) ──
    const gradeDistribution = Array.from({ length: 11 }, (_, i) => ({
        range: i < 10 ? `${i * 10}-${i * 10 + 9}` : "100",
        count: 0,
    }))
    subs.forEach(s => {
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
        if (grade?.score !== undefined && grade?.score !== null) {
            const score = grade.score
            if (score === 100) gradeDistribution[10].count++
            else {
                const bucket = Math.floor(score / 10)
                if (bucket >= 0 && bucket < 10) gradeDistribution[bucket].count++
            }
        }
    })

    // ── 5. Summary stats ──
    const totalSubmissions = subs.length
    const avgIntegrity = totalSubmissions > 0 ? Math.round(subs.reduce((a, s) => a + (s.integrity_score ?? 0), 0) / totalSubmissions) : 0
    const totalFlagged = subs.filter(s => (s.integrity_score ?? 100) < 50).length
    const totalGraded = subs.filter(s => {
        const g = Array.isArray(s.grade) ? s.grade[0] : s.grade
        return g?.score !== undefined && g?.score !== null
    }).length
    const avgWpm = totalSubmissions > 0 ? Math.round(subs.reduce((a, s) => a + (s.wpm ?? 0), 0) / totalSubmissions) : 0

    return NextResponse.json({
        summary: { totalSubmissions, avgIntegrity, totalFlagged, totalGraded, totalUngraded: totalSubmissions - totalGraded, avgWpm },
        integrityDistribution,
        submissionsTimeline,
        assignmentStats,
        gradeDistribution,
    })
}
