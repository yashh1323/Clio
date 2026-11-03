import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Only admins can access this route
    const session = verifyToken(token)
    if (!session || session.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabaseAdmin = createSupabaseAdmin()

    // Fetch all submissions globally with student info
    const { data, error } = await supabaseAdmin
        .from("submissions")
        .select(`
            id, 
            assignment_title, 
            integrity_score,
            submitted_at, 
            student:profiles!submissions_student_id_fkey ( username, full_name )
        `)
        .order("submitted_at", { ascending: false })

    if (error) {
        console.error("Error fetching submissions:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Format the response
    const submissions = (data || []).map(s => {
        const studentProfile = Array.isArray(s.student) ? s.student[0] : s.student;
        return {
            ...s,
            student_username: studentProfile?.username || "Unknown",
            student_name: studentProfile?.full_name || "Unknown"
        }
    })

    return NextResponse.json({ submissions })
}

export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const session = verifyToken(token)
    if (!session || session.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
        return NextResponse.json({ error: "Submission ID is required" }, { status: 400 })
    }

    const supabaseAdmin = createSupabaseAdmin()

    const { data, error } = await supabaseAdmin
        .from("submissions")
        .delete()
        .eq("id", id)
        .select("id")

    if (error) {
        console.error("Error deleting submission:", error)
        return NextResponse.json({ error: (error as { message: string }).message }, { status: 500 })
    }

    if (!data || data.length === 0) {
        return NextResponse.json({ error: "Submission not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: "Submission deleted successfully" })
}
