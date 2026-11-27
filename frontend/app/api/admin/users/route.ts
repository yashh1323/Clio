import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { verifySessionToken } from "@/lib/auth"
import sanitizeHtml from "sanitize-html"

const ALLOWED_ROLES = ["student", "teacher", "admin"]

// Helper to check admin authorization
async function requireAdmin(req: NextRequest) {
    const sessionToken = req.cookies.get("clio_session")?.value
    if (!sessionToken) return null

    try {
        const decoded = await verifySessionToken(sessionToken)
        if (!decoded || decoded.role !== "admin") return null
        return decoded
    } catch {
        return null
    }
}

// ── GET /api/admin/users — List all users ──
export async function GET(req: NextRequest) {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const supabaseAdmin = createSupabaseAdmin()

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, username, email, full_name, role, class, course, created_at")
        .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ users: data })
}

// ── POST /api/admin/users — Create a new user ──
export async function POST(req: NextRequest) {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    try {
        const body = await req.json()
        const { username, password, role, email, full_name, student_class, course } = body

        if (!username || !password || !role || !email) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
        }

        const safeUsername = username.toLowerCase().trim()
        const safeEmail = email.toLowerCase().trim()

        if (!ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: "Invalid role specified" }, { status: 400 })
        }

        const supabaseAdmin = createSupabaseAdmin()

        // Check duplicates for username and email safely
        const { data: existingUser } = await supabaseAdmin.from("profiles").select("id").eq("username", safeUsername).maybeSingle()
        if (existingUser) return NextResponse.json({ error: "Username taken" }, { status: 409 })

        const { data: existingEmail } = await supabaseAdmin.from("profiles").select("id").eq("email", safeEmail).maybeSingle()
        if (existingEmail) return NextResponse.json({ error: "Email taken" }, { status: 409 })

        const hashedPassword = await bcrypt.hash(password, 10)
        const safeName = sanitizeHtml((full_name || "").trim(), { allowedTags: [], allowedAttributes: {} })

        const insertData: Record<string, string> = {
            username: safeUsername,
            email: safeEmail,
            role,
            password: hashedPassword,
            full_name: safeName,
        }

        if (role === "student") {
            insertData.class = sanitizeHtml((student_class || "").trim(), { allowedTags: [], allowedAttributes: {} })
            insertData.course = sanitizeHtml((course || "").trim(), { allowedTags: [], allowedAttributes: {} })
        }

        const { data, error } = await supabaseAdmin.from("profiles")
            .insert(insertData)
            .select("id, username, email, full_name, role, class, course, created_at")
            .single()
        if (error) throw error

        return NextResponse.json({ user: data })
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create user" }, { status: 500 })
    }
}

// ── PUT /api/admin/users — Update user role or details ──
export async function PUT(req: NextRequest) {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    try {
        const body = await req.json()
        const { id, role, full_name, email, password } = body

        if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 })

        const updateData: Record<string, string> = {}
        if (role) {
            if (!ALLOWED_ROLES.includes(role)) {
                return NextResponse.json({ error: "Invalid role specified" }, { status: 400 })
            }
            updateData.role = role
        }
        if (full_name) updateData.full_name = sanitizeHtml(full_name.trim(), { allowedTags: [], allowedAttributes: {} })
        if (email) updateData.email = email.toLowerCase().trim()
        if (password) {
            updateData.password = await bcrypt.hash(password, 10)
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 })
        }

        const supabaseAdmin = createSupabaseAdmin()

        const { data, error } = await supabaseAdmin.from("profiles")
            .update(updateData)
            .eq("id", id)
            .select("id, username, email, full_name, role, class, course, created_at")
            .single()
        if (error) throw error

        return NextResponse.json({ user: data })
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Update failed" }, { status: 500 })
    }
}

// ── DELETE /api/admin/users — Delete a user ──
export async function DELETE(req: NextRequest) {
    const admin = await requireAdmin(req)
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    try {
        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")

        if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 })

        const supabaseAdmin = createSupabaseAdmin()

        // Prevent self-deletion
        const { data: adminProfile } = await supabaseAdmin.from("profiles").select("id").eq("username", admin.username).single()
        if (adminProfile && adminProfile.id === id) {
            return NextResponse.json({ error: "Cannot delete your own admin account" }, { status: 403 })
        }

        const { error } = await supabaseAdmin.from("profiles").delete().eq("id", id)
        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (err: unknown) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Delete failed. Check constraint logs." }, { status: 500 })
    }
}
