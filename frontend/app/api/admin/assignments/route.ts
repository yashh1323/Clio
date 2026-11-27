import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifySessionToken } from "@/lib/auth"

export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Only admins can access this route
    const session = await verifySessionToken(token)
    if (!session || session.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabaseAdmin = createSupabaseAdmin()

    // Fetch all assignments globally with teacher info
    const { data, error } = await supabaseAdmin
        .from("assignments")
        .select(`
            id, 
            title, 
            description, 
            created_at, 
            due_date,
            teacher:profiles!assignments_teacher_id_fkey ( username, full_name )
        `)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching assignments:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Format the response
    const assignments = (data || []).map(a => {
        const teacherProfile = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher;
        return {
            ...a,
            teacher_username: teacherProfile?.username || "Unknown",
            teacher_name: teacherProfile?.full_name || "Unknown"
        }
    })

    return NextResponse.json({ assignments })
}

export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const session = await verifySessionToken(token)
    if (!session || session.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
        return NextResponse.json({ error: "Assignment ID is required" }, { status: 400 })
    }

    const supabaseAdmin = createSupabaseAdmin()

    // Delete the assignment. ON DELETE CASCADE on submissions table 
    // will automatically delete associated submissions.
    const { data, error } = await supabaseAdmin
        .from("assignments")
        .delete()
        .eq("id", id)
        .select("id")

    if (error) {
        console.error("Error deleting assignment:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
        return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: "Assignment deleted successfully" })
}


