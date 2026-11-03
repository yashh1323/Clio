import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── GET /api/drafts — List student's drafts or get single draft by ID ──
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "student") {
        return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const id = req.nextUrl.searchParams.get("id")
    if (id) {
        const { data, error } = await supabase
            .from("drafts")
            .select("id, title, content, html, json_content, assignment_id, word_count, last_saved_at, created_at")
            .eq("id", id)
            .eq("student_id", profile.id)
            .single()

        if (error || !data) {
            return NextResponse.json({ error: "Draft not found" }, { status: 404 })
        }
        return NextResponse.json(data)
    }

    const { data, error } = await supabase
        .from("drafts")
        .select("id, title, assignment_id, word_count, last_saved_at, created_at")
        .eq("student_id", profile.id)
        .order("last_saved_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
}

// ── POST /api/drafts — Create or update a draft ──
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "student") {
        return NextResponse.json({ error: "Forbidden: students only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    try {
        const body = await req.json()
        const { id, title, content, html, json_content, word_count, assignment_id } = body as {
            id?: string
            title?: string
            content?: string
            html?: string
            json_content?: object
            word_count?: number
            assignment_id?: string
        }

        const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        // Update existing draft
        if (id) {
            const updateData: Record<string, unknown> = { last_saved_at: new Date().toISOString() }
            if (title !== undefined) updateData.title = (title || "Untitled Draft").slice(0, 500)
            if (content !== undefined) updateData.content = content
            if (html !== undefined) updateData.html = html
            if (json_content !== undefined) updateData.json_content = json_content
            if (word_count !== undefined) updateData.word_count = word_count
            if (assignment_id !== undefined) updateData.assignment_id = assignment_id || null

            const { data, error } = await supabase
                .from("drafts")
                .update(updateData)
                .eq("id", id)
                .eq("student_id", profile.id)
                .select("id, title, assignment_id, word_count, last_saved_at")
                .single()

            if (error) {
                if (error.code === "PGRST116") {
                    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
                }
                return NextResponse.json({ error: error.message }, { status: 500 })
            }
            if (!data) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
            return NextResponse.json(data)
        }

        // Create new draft
        const insertData: Record<string, unknown> = {
            student_id: profile.id,
            title: (title || "Untitled Draft").slice(0, 500),
            content: content || "",
            html: html || "",
            json_content: json_content || {},
            word_count: word_count || 0,
        }
        if (assignment_id) insertData.assignment_id = assignment_id

        const { data, error } = await supabase
            .from("drafts")
            .insert(insertData)
            .select("id, title, assignment_id, word_count, last_saved_at")
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json(data, { status: 201 })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}

// ── DELETE /api/drafts?id=... — Delete a draft ──
export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "student") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const id = new URL(req.url).searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Draft ID required" }, { status: 400 })

    const supabase = createSupabaseAdmin()

    const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const { data: deleted, error } = await supabase
        .from("drafts")
        .delete()
        .eq("id", id)
        .eq("student_id", profile.id)
        .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!deleted || deleted.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ message: "Deleted" })
}
