import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifySessionToken } from "@/lib/auth"
import { ApiError, apiErrorResponse, readJsonBody } from "../../_lib/request"
import { gradeOwnedSubmission } from "../../_lib/grading"

export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    const session = token ? await verifySessionToken(token) : null
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.role !== "teacher") return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    try {
        const body = await readJsonBody(req, 32_768)
        const { assignment_title } = body
        if (assignment_title !== undefined && (typeof assignment_title !== "string" || assignment_title.length > 500)) {
            throw new ApiError("Invalid assignment_title")
        }
        if (body.submission_id !== undefined || body.score !== undefined) await gradeOwnedSubmission(session, body)
        else if (body.feedback !== undefined) throw new ApiError("submission_id and score required with feedback")

        let query = createSupabaseAdmin().from("submissions").select(`
            id, assignment_id, assignment_title, content, wpm, paste_count, integrity_score,
            submitted_at,
            student:profiles!submissions_student_id_fkey ( username, full_name ),
            grade:grades ( score, feedback )
        `).eq("teacher_id", session.sub).order("submitted_at", { ascending: true })
        if (assignment_title) query = query.eq("assignment_title", assignment_title)
        const { data, error } = await query
        if (error) throw new ApiError("Unable to fetch submissions", 500)
        const submissions = data ?? []
        const ungraded = submissions.filter(s => {
            const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
            return grade?.score === null || grade?.score === undefined
        })
        const next = ungraded[0]
        const student = next && (Array.isArray(next.student) ? next.student[0] : next.student)
        return NextResponse.json({
            next: next ? {
                id: next.id, assignment_id: next.assignment_id, assignment_title: next.assignment_title,
                content: next.content, wpm: next.wpm, paste_count: next.paste_count,
                integrity_score: next.integrity_score, submitted_at: next.submitted_at,
                student_name: student?.full_name || student?.username || "Unknown",
                student_username: student?.username || "unknown",
            } : null,
            remaining: ungraded.length, totalGraded: submissions.length - ungraded.length,
            totalSubmissions: submissions.length,
            ...(!next ? { message: "All submissions graded!" } : {}),
        })
    } catch (error) { return apiErrorResponse(error) }
}
