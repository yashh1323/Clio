import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── POST /api/grades/batch — Auto-advance batch grading ──
// Returns the next ungraded submission for the teacher, allowing a
// streamlined grading workflow where teachers grade one and move to the next.
//
// Body: { submission_id?: string, score?: number, feedback?: string, assignment_title?: string }
// - If submission_id + score provided: grades that submission, then returns next ungraded
// - If only assignment_title provided: returns first ungraded for that assignment
// - If nothing provided: returns first ungraded overall
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    try {
        const supabase = createSupabaseAdmin()
        // Parallelize: profile lookup + body parsing (independent)
        const [{ data: profile, error: profileErr }, body] = await Promise.all([
            supabase.from("profiles").select("id").eq("username", session.username).single(),
            req.json(),
        ])

        if (profileErr && profileErr.code !== "PGRST116") {
            return NextResponse.json({ error: profileErr.message }, { status: 500 })
        }
        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        const { submission_id, score, feedback, assignment_title } = body as {
            submission_id?: string
            score?: number
            feedback?: string
            assignment_title?: string
        }

        // Grade current submission if provided
        if (submission_id && score !== undefined) {
            // Verify ownership first
            const { data: subData, error: subErr } = await supabase
                .from("submissions")
                .select("teacher_id")
                .eq("id", submission_id)
                .single()

            if (subErr || !subData || subData.teacher_id !== profile.id) {
                return NextResponse.json({ error: "Forbidden: Not your submission" }, { status: 403 })
            }

            const gradeData = {
                submission_id,
                teacher_id: profile.id,
                score: Math.max(0, Math.min(100, Math.round(score))),
                feedback: (feedback || "").slice(0, 5000),
            }

            // Upsert: if already graded, update the grade
            const { error: gradeErr } = await supabase
                .from("grades")
                .upsert(gradeData, { onConflict: "submission_id" })

            if (gradeErr) return NextResponse.json({ error: gradeErr.message }, { status: 500 })
        }

        // Find next ungraded submission
        let query = supabase
            .from("submissions")
            .select(`
                id,
                assignment_title,
                content,
                wpm,
                paste_count,
                integrity_score,
                submitted_at,
                student:profiles!submissions_student_id_fkey ( username, full_name ),
                grade:grades ( score, feedback )
            `)
            .eq("teacher_id", profile.id)
            .order("submitted_at", { ascending: true })

        if (assignment_title) {
            query = query.eq("assignment_title", assignment_title)
        }

        const { data: submissions, error: fetchErr } = await query

        if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

        // Filter to ungraded
        const ungraded = (submissions ?? []).filter(s => {
            const g = Array.isArray(s.grade) ? s.grade[0] : s.grade
            return !g || g.score === null || g.score === undefined
        })

        const totalSubmissions = (submissions ?? []).length
        const totalGraded = totalSubmissions - ungraded.length

        if (ungraded.length === 0) {
            return NextResponse.json({
                next: null,
                remaining: 0,
                totalGraded,
                totalSubmissions,
                message: "All submissions graded!",
            })
        }

        const next = ungraded[0]
        const student = Array.isArray(next.student) ? next.student[0] : next.student

        return NextResponse.json({
            next: {
                id: next.id,
                assignment_title: next.assignment_title,
                content: next.content,
                wpm: next.wpm,
                paste_count: next.paste_count,
                integrity_score: next.integrity_score,
                submitted_at: next.submitted_at,
                student_name: student?.full_name || student?.username || "Unknown",
                student_username: student?.username || "unknown",
            },
            remaining: ungraded.length,
            totalGraded,
            totalSubmissions,
        })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}
