import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"
import sanitizeHtml from "sanitize-html"

// ── GET /api/classes — List classes ──
// Teachers: see their classes with enrollment counts
// Students: see classes they are enrolled in
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })

    const supabase = createSupabaseAdmin()

    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    if (session.role === "teacher") {
        const { data, error } = await supabase
            .from("classes")
            .select(`
                id, name, section, description, created_at,
                class_enrollments ( id )
            `)
            .eq("teacher_id", profile.id)
            .order("created_at", { ascending: false })

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        const formatted = (data ?? []).map(c => ({
            ...c,
            enrollment_count: Array.isArray(c.class_enrollments) ? c.class_enrollments.length : 0,
            class_enrollments: undefined,
        }))
        return NextResponse.json(formatted)
    }

    // Student: find classes they are enrolled in
    const { data: enrollments, error: enrollErr } = await supabase
        .from("class_enrollments")
        .select(`
            enrolled_at,
            class:classes ( id, name, section, description, teacher:profiles!classes_teacher_id_fkey ( username ) )
        `)
        .eq("student_id", profile.id)

    if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 500 })

    const classes = (enrollments ?? [])
        .filter(e => {
            const cls = Array.isArray(e.class) ? e.class[0] : e.class
            return cls && typeof cls === "object" && cls.id
        })
        .map(e => {
            const cls = Array.isArray(e.class) ? e.class[0] : e.class
            const teacher = cls?.teacher
            const teacherObj = Array.isArray(teacher) ? teacher[0] : teacher
            return {
                id: cls?.id,
                name: cls?.name,
                section: cls?.section,
                description: cls?.description,
                teacher_name: teacherObj?.username ?? "Unknown",
                enrolled_at: e.enrolled_at,
            }
        })

    return NextResponse.json(classes)
}

// ── POST /api/classes — Teacher creates a class ──
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    try {
        const body = await req.json()
        const { name, section, description } = body as {
            name?: string
            section?: string
            description?: string
        }

        if (!name || name.trim().length === 0) {
            return NextResponse.json({ error: "Class name is required" }, { status: 400 })
        }

        const supabase = createSupabaseAdmin()

        const { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        const { data, error } = await supabase
            .from("classes")
            .insert({
                teacher_id: profile.id,
                name: sanitizeHtml(name.trim().slice(0, 200), { allowedTags: [], allowedAttributes: {} }),
                section: sanitizeHtml((section || "").trim().slice(0, 100), { allowedTags: [], allowedAttributes: {} }),
                description: sanitizeHtml((description || "").trim().slice(0, 2000), { allowedTags: [], allowedAttributes: {} }),
            })
            .select("id, name, section, description, created_at")
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json(data, { status: 201 })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}

// ── DELETE /api/classes?id=... — Teacher deletes a class ──
export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const id = new URL(req.url).searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Class ID required" }, { status: 400 })

    const supabase = createSupabaseAdmin()

    const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const { data: deleted, error } = await supabase
        .from("classes")
        .delete()
        .eq("id", id)
        .eq("teacher_id", profile.id)
        .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!deleted || deleted.length === 0) return NextResponse.json({ error: "Class not found" }, { status: 404 })
    return NextResponse.json({ message: "Deleted" })
}
