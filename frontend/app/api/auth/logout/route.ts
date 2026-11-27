import { NextRequest, NextResponse } from "next/server"

import { verifyToken } from "@/lib/auth"
import { createSupabaseAdmin } from "@/lib/supabase"
import { apiErrorResponse, requireSameOrigin, UUID } from "../../_lib/request"

// ── POST /api/auth/logout ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        requireSameOrigin(req)
        const token = req.cookies.get("clio_session")?.value
        const session = token ? verifyToken(token) : null
        if (session && typeof session.sub === "string" && UUID.test(session.sub) &&
            typeof session.session_version === "number" && Number.isSafeInteger(session.session_version)) {
            // Compare-and-set invalidates this account's sessions once, including concurrent logouts.
            const { error } = await createSupabaseAdmin().from("profiles")
                .update({ session_version: session.session_version + 1 })
                .eq("id", session.sub).eq("session_version", session.session_version)
            if (error) return NextResponse.json({ error: "Sign-out unavailable. Please retry." }, { status: 503 })
        }
    } catch (error) {
        return apiErrorResponse(error)
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set("clio_session", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0, // expire immediately
    })
    return res
}
