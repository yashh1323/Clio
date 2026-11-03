import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/teachers — returns all teacher profiles ──
export async function GET(req: NextRequest) {
    // Any authenticated user can list teachers
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })

    const supabase = createSupabaseAdmin()

    const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("role", "teacher")
        .order("username")

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
}
