import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/export/grades — Export all grades + submissions as CSV ──
// Teachers only. Returns a downloadable CSV file.
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    // Get teacher profile
    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    // Fetch submissions with grade + student info
    const { data: submissions, error } = await supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            wpm,
            paste_count,
            integrity_score,
            submitted_at,
            student:profiles!submissions_student_id_fkey ( username, full_name, email, class, course ),
            grade:grades ( score, feedback, graded_at )
        `)
        .eq("teacher_id", profile.id)
        .order("submitted_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Build CSV
    const headers = [
        "Student Username",
        "Student Name",
        "Email",
        "Class",
        "Course",
        "Assignment",
        "Submitted At",
        "WPM",
        "Paste Count",
        "Integrity Score",
        "Grade",
        "Feedback",
        "Graded At",
    ]

    const escapeCSV = (val: string) => {
        // CSV injection protection: prefix dangerous leading chars (including after leading whitespace)
        const dangerousChars = ['=', '+', '-', '@', '|', '\t', '\r']
        let safe = val
        const trimmed = val.trimStart()
        if (
            (safe.length > 0 && dangerousChars.includes(safe[0])) ||
            (trimmed.length > 0 && dangerousChars.includes(trimmed[0]))
        ) {
            safe = "'" + safe
        }
        if (safe.includes(",") || safe.includes("\"") || safe.includes("\n") || safe.includes("\r")) {
            return `"${safe.replace(/"/g, '""')}"`
        }
        return safe
    }

    const rows = (submissions ?? []).map((s) => {
        const student = Array.isArray(s.student) ? s.student[0] : s.student
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade

        return [
            student?.username ?? "",
            student?.full_name ?? "",
            student?.email ?? "",
            student?.class ?? "",
            student?.course ?? "",
            s.assignment_title ?? "",
            s.submitted_at ? new Date(s.submitted_at).toISOString() : "",
            String(s.wpm ?? 0),
            String(s.paste_count ?? 0),
            String(s.integrity_score ?? 0),
            grade?.score !== undefined && grade?.score !== null ? String(grade.score) : "Not Graded",
            grade?.feedback ?? "",
            grade?.graded_at ? new Date(grade.graded_at).toISOString() : "",
        ].map(v => escapeCSV(v))
    })

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n")

    return new NextResponse(csvContent, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="clio-grades-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
    })
}
