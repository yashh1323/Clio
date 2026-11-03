import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/notifications — Unread grade notifications for a student ──
// Returns recently graded submissions that the student hasn't dismissed.
// A grade is "unread" if it was graded after the student's last_seen_notifications timestamp.
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
        .select("id, last_seen_notifications")
        .eq("username", session.username)
        .single()

    if (profileErr || !profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Fetch all grades for this student's submissions that were graded
    // after their last seen timestamp (or all if never seen)
    const lastSeen = profile.last_seen_notifications || "1970-01-01T00:00:00Z"

    const { data: gradedSubmissions, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            submitted_at,
            grade:grades ( score, feedback, graded_at, teacher:profiles!grades_teacher_id_fkey ( username ) )
        `)
        .eq("student_id", profile.id)
        .not("grade", "is", null)
        .order("submitted_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Filter to unread: grades where graded_at > lastSeen
    const notifications = (gradedSubmissions ?? [])
        .map(s => {
            const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
            if (!grade || !grade.graded_at) return null
            const teacher = Array.isArray(grade.teacher) ? grade.teacher[0] : grade.teacher
            return {
                submission_id: s.id,
                assignment_title: s.assignment_title,
                score: grade.score,
                feedback: grade.feedback,
                graded_at: grade.graded_at,
                graded_by: teacher?.username ?? "Unknown",
                is_unread: new Date(grade.graded_at) > new Date(lastSeen),
            }
        })
        .filter(Boolean)

    const unreadCount = notifications.filter(n => n?.is_unread).length

    return NextResponse.json({ notifications, unreadCount })
}

// ── POST /api/notifications — Mark notifications as read ──
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "student") {
        return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    const { data, error } = await supabase
        .from("profiles")
        .update({ last_seen_notifications: new Date().toISOString() })
        .eq("username", session.username)
        .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    return NextResponse.json({ message: "Notifications marked as read" })
}
