import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

export const runtime = 'nodejs'

// ── GET /api/submissions/[id] — returns the FULL submission details ──
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    // Verify session
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (!profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const { data: submission, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            content,
            wpm,
            paste_count,
            integrity_score,
            submitted_at,
            replay_snapshots,
            teacher_id,
            student_id,
            student:profiles!submissions_student_id_fkey ( id, username ),
            grade:grades ( id, score, feedback, graded_at )
        `)
        .eq("id", id)
        .single()

    if (error || !submission) {
        return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 })
    }

    // Verify ownership: must be the original student, or the assigned teacher, or an admin
    if (session.role === "student" && submission.student_id !== profile.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (session.role === "teacher" && submission.teacher_id && submission.teacher_id !== profile.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const student = Array.isArray(submission.student) ? submission.student[0] : submission.student
    const grade = Array.isArray(submission.grade) ? submission.grade[0] : submission.grade

    return NextResponse.json({
        id: submission.id,
        student_id: student?.username ?? "unknown",
        assignment_title: submission.assignment_title,
        content: submission.content,
        wpm: submission.wpm,
        paste_count: submission.paste_count,
        integrity_score: submission.integrity_score,
        timestamp: submission.submitted_at,
        replay_snapshots: submission.replay_snapshots ?? [],
        grade: grade ?? null,
    })
}
