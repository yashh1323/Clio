import { NextRequest, NextResponse } from "next/server"

// ── Role-Based Route Protection Middleware ──
// Centralizes authentication + role checking so individual API routes
// don't need to repeat boilerplate session verification.

// Routes that require authentication (and their allowed roles)
const PROTECTED_ROUTES: { pattern: RegExp; roles: string[] }[] = [
    // Admin routes
    { pattern: /^\/api\/admin(\/.*)?$/, roles: ["admin"] },
    // Teacher-only routes
    { pattern: /^\/api\/grades(\/.*)?$/, roles: ["teacher"] },
    { pattern: /^\/api\/analytics(\/.*)?$/, roles: ["teacher"] },
    { pattern: /^\/api\/similarity(\/.*)?$/, roles: ["teacher"] },
    { pattern: /^\/api\/export(\/.*)?$/, roles: ["teacher"] },
    { pattern: /^\/api\/classes\/enroll(\/.*)?$/, roles: ["teacher", "admin"] },
    // Student-only routes
    { pattern: /^\/api\/submissions\/mine(\/.*)?$/, roles: ["student"] },
    { pattern: /^\/api\/notifications(\/.*)?$/, roles: ["student"] },
    { pattern: /^\/api\/student-analytics(\/.*)?$/, roles: ["student"] },
    { pattern: /^\/api\/drafts(\/.*)?$/, roles: ["student"] },
    // Shared routes
    { pattern: /^\/api\/classes(\/.*)?$/, roles: ["teacher", "student", "admin"] },
    { pattern: /^\/api\/submissions(\/.*)?$/, roles: ["teacher", "student", "admin"] },
    { pattern: /^\/api\/convert-docx-to-pdf(\/.*)?$/, roles: ["teacher", "student", "admin"] },
    { pattern: /^\/api\/assignments(\/.*)?$/, roles: ["teacher", "student", "admin"] },
    { pattern: /^\/api\/teachers(\/.*)?$/, roles: ["teacher", "student", "admin"] },
    { pattern: /^\/api\/profile(\/.*)?$/, roles: ["teacher", "student", "admin"] },
]

// Pages that require specific roles
const PROTECTED_PAGES: { pattern: RegExp; roles: string[]; redirectTo: string }[] = [
    { pattern: /^\/admin/, roles: ["admin"], redirectTo: "/login" },
    { pattern: /^\/dashboard/, roles: ["teacher"], redirectTo: "/login" },
    { pattern: /^\/assignments/, roles: ["teacher"], redirectTo: "/login" },
    { pattern: /^\/analytics/, roles: ["teacher"], redirectTo: "/login" },
    { pattern: /^\/similarity/, roles: ["teacher"], redirectTo: "/login" },
    { pattern: /^\/classes/, roles: ["teacher"], redirectTo: "/login" },
    { pattern: /^\/editor/, roles: ["student"], redirectTo: "/login" },
    { pattern: /^\/submissions/, roles: ["student"], redirectTo: "/login" },
    { pattern: /^\/student-dashboard/, roles: ["student"], redirectTo: "/login" },
    { pattern: /^\/student-analytics/, roles: ["student"], redirectTo: "/login" },
    { pattern: /^\/drafts/, roles: ["student"], redirectTo: "/login" },
    { pattern: /^\/profile/, roles: ["teacher", "student", "admin"], redirectTo: "/login" },
]

// Routes that should NOT be intercepted
const PUBLIC_ROUTES = [
    /^\/api\/auth\//,
    /^\/api\/spotify/,
    /^\/login/,
    /^\/register/,
    /^\/_next/,
    /^\/favicon/,
]

function base64UrlDecode(str: string) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/")
    while (base64.length % 4) base64 += "="
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

async function verifyTokenSignature(token: string): Promise<string | null> {
    const secretStr = process.env.AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "clio-dev-secret-DO-NOT-USE-IN-PROD" : "")
    if (!secretStr) return null

    const parts = token.split(".")
    if (parts.length !== 2) return null

    const [dataB64, sigB64] = parts

    try {
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secretStr),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        )

        const signatureBytes = base64UrlDecode(sigB64)
        const dataBytes = encoder.encode(dataB64)

        const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, dataBytes)
        if (!isValid) return null

        const payloadJson = new TextDecoder().decode(base64UrlDecode(dataB64))
        const payload = JSON.parse(payloadJson)
        if (payload && typeof payload.role === "string" && payload.role.length > 0) {
            // Strictly check cryptographic expiration claim at the edge
            const now = Math.floor(Date.now() / 1000)
            if (typeof payload.exp !== "number" || payload.exp <= now) {
                return null // Expired session fails closed at the edge
            }
            return payload.role.trim().toLowerCase()
        }
        return null
    } catch {
        return null
    }
}

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl

    // Skip public routes
    if (PUBLIC_ROUTES.some(r => r.test(pathname))) {
        return NextResponse.next()
    }

    // Get session token
    const token = req.cookies.get("clio_session")?.value

    // Properly verify JWT signature using Web Crypto API
    let userRole: string | null = null
    if (token) {
        userRole = await verifyTokenSignature(token)
    }

    // Check protected API routes
    const apiRoute = PROTECTED_ROUTES.find(r => r.pattern.test(pathname))
    if (apiRoute) {
        if (!token || !userRole) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }
        if (!apiRoute.roles.includes(userRole)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
    }

    // Check protected pages — redirect unauthenticated or unauthorized users
    const pageRoute = PROTECTED_PAGES.find(r => r.pattern.test(pathname))
    if (pageRoute) {
        if (!token || !userRole || !pageRoute.roles.includes(userRole)) {
            return NextResponse.redirect(new URL(pageRoute.redirectTo, req.url))
        }
    }

    // Add caching headers for static-ish data
    const res = NextResponse.next()

    // Cache teacher list (doesn't change often) - only on safe methods
    if (/^\/api\/teachers/.test(pathname) && (req.method === "GET" || req.method === "HEAD")) {
        res.headers.set("Cache-Control", "private, max-age=300, stale-while-revalidate=600")
    }
    // Cache assignment list (changes infrequently)
    if (/^\/api\/assignments/.test(pathname) && req.method === "GET") {
        res.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120")
    }

    return res
}

export const config = {
    matcher: [
        // Match all paths except static files
        "/((?!_next/static|_next/image|favicon.ico).*)",
    ],
}
