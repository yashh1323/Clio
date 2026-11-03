import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"
import sanitizeHtml from "sanitize-html"

// ── GET /api/assignments — list assignments ──
// Teachers: see their own assignments
// Students: see all assignments (to pick from when submitting)
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })

    const supabase = createSupabaseAdmin()

    let query = supabase
        .from("assignments")
        .select(`
            id,
            title,
            description,
            due_date,
            max_word_count,
            created_at,
            teacher:profiles!assignments_teacher_id_fkey ( id, username )
        `)
        .order("created_at", { ascending: false })

    // Teachers only see their own assignments
    if (session.role === "teacher") {
        const { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (profileErr || !profile) {
            return NextResponse.json({ error: "Teacher profile not found" }, { status: 403 })
        }
        query = query.eq("teacher_id", profile.id)
    }

    const { data, error } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const formatted = (data ?? []).map((a) => {
        const teacher = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
        return {
            id: a.id,
            title: a.title,
            description: a.description,
            due_date: a.due_date,
            max_word_count: a.max_word_count,
            created_at: a.created_at,
            teacher_id: teacher?.id ?? null,
            teacher_name: teacher?.username ?? "Unknown",
        }
    })

    return NextResponse.json(formatted)
}

// ── POST /api/assignments — teacher creates assignment ──
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    try {
        const body = await req.json()
        const { title, description, due_date, max_word_count } = body as {
            title?: string
            description?: string
            due_date?: string
            max_word_count?: number
        }

        if (!title || title.trim().length === 0) {
            return NextResponse.json({ error: "Title is required" }, { status: 400 })
        }

        const safeTitle = sanitizeHtml(title.trim().slice(0, 500), { allowedTags: [], allowedAttributes: {} })
        const safeDesc = sanitizeHtml((description || "").trim().slice(0, 10000))

        const supabase = createSupabaseAdmin()

        // Lookup teacher profile
        const { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (profileErr || !profile) {
            return NextResponse.json({ error: "Teacher profile not found" }, { status: 404 })
        }

        const insertData: Record<string, unknown> = {
            teacher_id: profile.id,
            title: safeTitle,
            description: safeDesc,
        }

        if (due_date) {
            const d = new Date(due_date)
            if (!isNaN(d.getTime())) {
                insertData.due_date = d.toISOString()
            }
        }

        if (max_word_count !== undefined && max_word_count !== null) {
            const parsed = parseInt(String(max_word_count), 10)
            if (!isNaN(parsed) && parsed > 0 && parsed <= 100000) {
                insertData.max_word_count = parsed
            }
        }

        const { data: assignment, error: insertErr } = await supabase
            .from("assignments")
            .insert(insertData)
            .select("id, title, description, due_date, max_word_count, created_at")
            .single()

        if (insertErr) {
            return NextResponse.json({ error: insertErr.message }, { status: 500 })
        }

        return NextResponse.json({ message: "Assignment created", assignment })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}

// ── PUT /api/assignments — teacher updates assignment ──
export async function PUT(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    try {
        const body = await req.json()
        const { id, title, description, due_date, max_word_count } = body as {
            id?: string
            title?: string
            description?: string
            due_date?: string | null
            max_word_count?: number | null
        }

        if (!id) return NextResponse.json({ error: "Assignment ID is required" }, { status: 400 })

        const supabase = createSupabaseAdmin()

        // Verify teacher owns this assignment
        const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        const updateData: Record<string, unknown> = {}
        if (title !== undefined) updateData.title = sanitizeHtml(title.trim().slice(0, 500), { allowedTags: [], allowedAttributes: {} })
        if (description !== undefined) updateData.description = sanitizeHtml(description.trim().slice(0, 10000))
        if (due_date !== undefined) {
            if (due_date) {
                const d = new Date(due_date)
                updateData.due_date = !isNaN(d.getTime()) ? d.toISOString() : null
            } else {
                updateData.due_date = null
            }
        }
        if (max_word_count !== undefined) {
            if (max_word_count !== null) {
                const parsed = parseInt(String(max_word_count), 10)
                updateData.max_word_count = (!isNaN(parsed) && parsed > 0) ? Math.min(parsed, 100000) : null
            } else {
                updateData.max_word_count = null
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: "No fields to update" }, { status: 400 })
        }

        const { data, error } = await supabase
            .from("assignments")
            .update(updateData)
            .eq("id", id)
            .eq("teacher_id", profile.id)
            .select("id, title, description, due_date, max_word_count, created_at")
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ message: "Updated", assignment: data })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}

// ── DELETE /api/assignments — teacher deletes assignment ──
export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    try {
        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")
        if (!id) return NextResponse.json({ error: "Assignment ID is required" }, { status: 400 })

        const supabase = createSupabaseAdmin()

        const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        const { data: deleted, error } = await supabase
            .from("assignments")
            .delete()
            .eq("id", id)
            .eq("teacher_id", profile.id)
            .select("id")

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (!deleted || deleted.length === 0) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
        return NextResponse.json({ message: "Deleted" })
    } catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }
}
