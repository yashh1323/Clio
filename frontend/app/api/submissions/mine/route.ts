import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/submissions/mine — returns the current student's own submissions ──
export async function GET(req: NextRequest) {
    // Verify session (student only)
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    if (session.role !== "student") {
        return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    // Lookup the student's profile ID
    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr || !profile) {
        return NextResponse.json({ error: "Student profile not found" }, { status: 404 })
    }

    // Fetch all submissions by this student, with grade info
    const { data, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            content,
            wpm,
            paste_count,
            integrity_score,
            submitted_at,
            teacher_id,
            teacher:profiles!submissions_teacher_id_fkey ( username ),
            grade:grades ( id, score, feedback, graded_at )
        `)
        .eq("student_id", profile.id)
        .order("submitted_at", { ascending: false })

    if (error) {
        console.error("[submissions/mine] DB error:", error.message)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // Flatten for the frontend
    const formatted = (data ?? []).map((s) => {
        const teacher = Array.isArray(s.teacher) ? s.teacher[0] : s.teacher
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
        return {
            id: s.id,
            assignment_title: s.assignment_title,
            content: s.content,
            wpm: s.wpm,
            paste_count: s.paste_count,
            integrity_score: s.integrity_score,
            timestamp: s.submitted_at,
            teacher_name: teacher?.username ?? null,
            grade: grade ?? null,
        }
    })

    return NextResponse.json(formatted)
}
