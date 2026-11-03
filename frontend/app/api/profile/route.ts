import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"
import sanitizeHtml from "sanitize-html"

// ── GET /api/profile — returns the current user's profile ──
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })

    const supabase = createSupabaseAdmin()

    const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, username, role, email, full_name, class, course, created_at")
        .eq("username", session.username)
        .single()

    if (error || !profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Return role-appropriate fields
    const base = {
        id: profile.id,
        username: profile.username,
        role: profile.role,
        full_name: profile.full_name ?? "",
        email: profile.email ?? "",
        created_at: profile.created_at,
    }

    if (profile.role === "student") {
        return NextResponse.json({
            ...base,
            class: profile.class ?? "",
            course: profile.course ?? "",
        })
    }

    // Teacher — no class/course
    return NextResponse.json(base)
}

// ── PUT /api/profile — update the current user's profile ──
export async function PUT(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })

    try {
        const body = await req.json()
        const { full_name, email, class: studentClass, course } = body as {
            full_name?: string
            email?: string
            class?: string
            course?: string
        }

        // Sanitize all inputs
        const sanitize = (val: string | undefined, maxLen: number) =>
            sanitizeHtml((val || "").trim().slice(0, maxLen), { allowedTags: [], allowedAttributes: {} })

        const updateData: Record<string, string> = {}

        // Both roles can update name + email
        if (full_name !== undefined) updateData.full_name = sanitize(full_name, 200)
        if (email !== undefined) {
            const cleanEmail = sanitize(email, 254)
            // Basic email format validation
            if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
                return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
            }
            updateData.email = cleanEmail
        }

        // Only students can update class + course
        if (session.role === "student") {
            if (studentClass !== undefined) updateData.class = sanitize(studentClass, 100)
            if (course !== undefined) updateData.course = sanitize(course, 200)
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: "No fields to update" }, { status: 400 })
        }

        const supabase = createSupabaseAdmin()

        const { data, error } = await supabase
            .from("profiles")
            .update(updateData)
            .eq("username", session.username)
            .select("id, username, role, email, full_name, class, course")
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ message: "Profile updated", profile: data })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}
