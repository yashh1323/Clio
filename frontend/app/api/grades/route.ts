import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifySessionToken } from "@/lib/auth"
import { apiErrorResponse, readJsonBody, UUID } from "../_lib/request"
import { gradeOwnedSubmission } from "../_lib/grading"

export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    const session = token ? await verifySessionToken(token) : null
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.role !== "teacher") return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    try {
        const body = await readJsonBody(req, 32_768)
        const grade = await gradeOwnedSubmission(session, body)
        return NextResponse.json({ message: "Graded successfully", grade })
    } catch (error) { return apiErrorResponse(error) }
}

export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    const session = token ? await verifySessionToken(token) : null
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.role !== "teacher") return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    const id = req.nextUrl.searchParams.get("submission_id")
    if (!id || !UUID.test(id)) return NextResponse.json({ error: "Valid submission_id required" }, { status: 400 })
    const supabase = createSupabaseAdmin()
    const { data: submission, error: subError } = await supabase.from("submissions")
        .select("id").eq("id", id).eq("teacher_id", session.sub).single()
    if (subError || !submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })
    const { data, error } = await supabase.from("grades")
        .select("id, score, feedback, graded_at, teacher:profiles!grades_teacher_id_fkey ( username )")
        .eq("submission_id", id).eq("teacher_id", session.sub).maybeSingle()
    if (error) return NextResponse.json({ error: "Unable to fetch grade" }, { status: 500 })
    if (!data) return NextResponse.json({ grade: null })
    const teacher = Array.isArray(data.teacher) ? data.teacher[0] : data.teacher
    return NextResponse.json({ grade: { id: data.id, score: data.score, feedback: data.feedback,
        graded_at: data.graded_at, graded_by: teacher?.username ?? "unknown" } })
}
