import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import sanitizeHtml from "sanitize-html"

// ── Rate Limiting (In-Memory with Bounded TTL Pruning) ──
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_ENTRIES = 10_000

function checkRateLimit(identifier: string): boolean {
    const now = Date.now()
    for (const [key, entry] of rateLimitMap.entries()) {
        if (now > entry.resetTime) {
            rateLimitMap.delete(key)
        }
    }

    const userLimit = rateLimitMap.get(identifier)
    if (!userLimit || now > userLimit.resetTime) {
        if (!rateLimitMap.has(identifier) && rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
            const oldestKey = rateLimitMap.keys().next().value
            if (oldestKey !== undefined) {
                rateLimitMap.delete(oldestKey)
            }
        }
        rateLimitMap.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
        return true
    }

    if (userLimit.count >= RATE_LIMIT_MAX) {
        return false
    }

    userLimit.count += 1
    return true
}

// ── POST /api/auth/register — Create a new student or teacher account ──
export async function POST(req: NextRequest) {
    const clientIp =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip")?.trim() ||
        "unknown"
    if (!checkRateLimit(clientIp)) {
        return NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
    }

    try {
        const body = await req.json()
        const { username, password, full_name, email, role, course, student_class, invite_code } = body as {
            username?: string
            password?: string
            full_name?: string
            email?: string
            role?: string
            course?: string
            student_class?: string
            invite_code?: string
        }

        // ── Validation ──
        if (!username || !password || !email || !role) {
            return NextResponse.json(
                { error: "Username, password, email, and role are required" },
                { status: 400 }
            )
        }

        const cleanUsername = username.toLowerCase().trim()
        if (cleanUsername.length < 3 || cleanUsername.length > 50) {
            return NextResponse.json({ error: "Username must be 3–50 characters" }, { status: 400 })
        }
        if (!/^[a-z0-9_.-]+$/.test(cleanUsername)) {
            return NextResponse.json({ error: "Username can only contain letters, numbers, dots, hyphens, and underscores" }, { status: 400 })
        }

        if (password.length < 6) {
            return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
        }
        if (password.length > 72) {
            return NextResponse.json({ error: "Password must be at most 72 characters" }, { status: 400 })
        }

        const cleanEmail = email.toLowerCase().trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
        }

        if (role !== "student" && role !== "teacher") {
            return NextResponse.json({ error: "Role must be 'student' or 'teacher'" }, { status: 400 })
        }

        // ── Teacher Registration Invite Code Gate ──
        const expectedInviteCode = (process.env.TEACHER_INVITE_CODE || "").trim()
        if (role === "teacher") {
            if (!expectedInviteCode) {
                return NextResponse.json(
                    { error: "Teacher registration is disabled: faculty invite code not configured" },
                    { status: 403 }
                )
            }
            const providedCode = typeof invite_code === "string" ? invite_code.trim() : ""
            const expectedBuf = Buffer.from(expectedInviteCode, "utf8")
            const providedBuf = Buffer.from(providedCode, "utf8")
            const inviteMatches =
                expectedBuf.length === providedBuf.length &&
                crypto.timingSafeEqual(expectedBuf, providedBuf)
            if (!inviteMatches) {
                return NextResponse.json(
                    { error: "Invalid or missing teacher invite code" },
                    { status: 403 }
                )
            }
        }

        const supabaseAdmin = createSupabaseAdmin()

        // ── Check for duplicate username ──
        const { data: existing, error: existingErr } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("username", cleanUsername)
            .maybeSingle()

        if (existingErr) {
            return NextResponse.json({ error: existingErr.message }, { status: 500 })
        }
        if (existing) {
            return NextResponse.json({ error: "Username already taken" }, { status: 409 })
        }

        // ── Check for duplicate email ──
        const { data: existingEmail, error: emailErr } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", cleanEmail)
            .maybeSingle()

        if (emailErr) {
            return NextResponse.json({ error: emailErr.message }, { status: 500 })
        }
        if (existingEmail) {
            return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
        }

        // ── Sanitize inputs ──
        const safeName = sanitizeHtml((full_name || "").trim().slice(0, 200), { allowedTags: [], allowedAttributes: {} })
        const safeCourse = sanitizeHtml((course || "").trim().slice(0, 200), { allowedTags: [], allowedAttributes: {} })
        const safeClass = sanitizeHtml((student_class || "").trim().slice(0, 100), { allowedTags: [], allowedAttributes: {} })

        // ── Hash password ──
        const hashedPassword = await bcrypt.hash(password, 10)

        // ── Insert profile ──
        const insertData: Record<string, unknown> = {
            username: cleanUsername,
            password: hashedPassword,
            email: cleanEmail,
            role,
            full_name: safeName,
        }

        if (role === "student") {
            if (safeCourse) insertData.course = safeCourse
            if (safeClass) insertData.class = safeClass
        }

        const { error: insertErr } = await supabaseAdmin
            .from("profiles")
            .insert(insertData)

        if (insertErr) {
            console.error("[Register] Insert error:", insertErr.message)
            return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
        }

        return NextResponse.json({ message: "Account created successfully" }, { status: 201 })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}
