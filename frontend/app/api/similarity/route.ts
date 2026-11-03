import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"
import { analyzeSimilarityWithEngine, EngineSubmissionInput } from "@/lib/engine"

// ── GET /api/similarity — Basic text similarity check between submissions ──
// Compares all submissions for the same assignment title and flags pairs
// with high similarity using Jaccard similarity on word n-grams.
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const assignmentTitle = searchParams.get("assignment")

    const supabase = createSupabaseAdmin()

    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    // Build query
    let query = supabase
        .from("submissions")
        .select(`
            id,
            assignment_title,
            content,
            student:profiles!submissions_student_id_fkey ( username, full_name )
        `)
        .eq("teacher_id", profile.id)

    if (assignmentTitle) {
        query = query.eq("assignment_title", assignmentTitle)
    }

    const { data: submissions, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const subs = submissions ?? []
    if (subs.length < 2) {
        return NextResponse.json({ pairs: [], message: "Need at least 2 submissions to compare" })
    }

    // ── High-Performance MinHash / LSH Similarity Engine (Strangler Fig) ──
    const items: EngineSubmissionInput[] = subs.map(s => {
        const student = Array.isArray(s.student) ? s.student[0] : s.student
        return {
            id: s.id,
            assignment: s.assignment_title,
            student: student?.full_name || student?.username || "Unknown",
            username: student?.username || "unknown",
            content: s.content || "",
        }
    })

    const result = await analyzeSimilarityWithEngine(items, 25, 4)
    return NextResponse.json(result)
}
