import { NextRequest, NextResponse } from "next/server"
import { signToken } from "@/lib/auth"
import { createSupabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { apiErrorResponse, readJsonBody, requireSameOrigin } from "../../_lib/request"

// Pre-computed dummy bcrypt hash to ensure constant-time response even when username is not found,
// preventing timing-based user enumeration attacks.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

// ── Rate Limiting (In-Memory with Bounded TTL Pruning) ──
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const accountRateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_MAX = 15
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_ENTRIES = 10_000

function checkRateLimit(
    identifier: string,
    store: Map<string, { count: number; resetTime: number }> = rateLimitMap
): boolean {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
        if (now > entry.resetTime) {
            store.delete(key)
        }
    }

    const userLimit = store.get(identifier)
    if (!userLimit || now > userLimit.resetTime) {
        if (!store.has(identifier) && store.size >= RATE_LIMIT_MAX_ENTRIES) {
            const oldestKey = store.keys().next().value
            if (oldestKey !== undefined) {
                store.delete(oldestKey)
            }
        }
        store.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
        return true
    }

    if (userLimit.count >= RATE_LIMIT_MAX) {
        return false
    }

    userLimit.count += 1
    return true
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const clientIp =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip")?.trim() ||
        "unknown"
    if (!checkRateLimit(clientIp, rateLimitMap)) {
        return NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
    }

    try {
        requireSameOrigin(req)
        const body = await readJsonBody(req, 16_384)
        const { username, password } = body as { username?: string; password?: string }

        if (typeof username !== "string" || !username.trim() || username.length > 50 ||
            typeof password !== "string" || !password) {
            return NextResponse.json({ error: "Username and password are required" }, { status: 400 })
        }

        const normalizedUser = username.toLowerCase().trim()
        if (!checkRateLimit(normalizedUser, accountRateLimitMap)) {
            return NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
        }

        const supabaseAdmin = createSupabaseAdmin()

        // Secure Database authentication check via service role (bypasses anon RLS)
        const { data: user, error } = await supabaseAdmin
            .from('profiles')
            .select('id, username, password, role, status, session_version')
            .eq('username', normalizedUser)
            .maybeSingle()

        // Always run bcrypt comparison to prevent user enumeration via timing discrepancies
        const hashToCompare = (user && typeof user.password === "string" && user.password.length > 0)
            ? user.password
            : DUMMY_HASH

        const passwordMatch = await bcrypt.compare(password, hashToCompare)

        if (error) {
            console.error("[Login] Account lookup failed", error.code)
            return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 })
        }
        if (!user || !user.password || !passwordMatch || user.status !== "active" ||
            !["student", "teacher", "admin"].includes(user.role) || !Number.isSafeInteger(user.session_version)) {
            return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
        }

        // Build signed token using the shared auth module
        const token = signToken({ sub: user.id, username: user.username, role: user.role, session_version: user.session_version })

        // Set HttpOnly cookie
        const isProd = process.env.NODE_ENV === "production"
        const res = NextResponse.json({ id: user.id, account_id: user.id, role: user.role, username: user.username }, { headers: { "Cache-Control": "no-store" } })
        res.cookies.set("clio_session", token, {
            httpOnly: true,
            secure: isProd,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 8, // 8 hours
        })

        return res
    } catch (error) {
        return apiErrorResponse(error)
    }
}
