import { NextRequest, NextResponse } from "next/server"
import { verifySessionToken } from "@/lib/auth"

// ── GET /api/auth/session ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    console.log("[API Session] Token present:", !!token)
    if (!token) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    const payload = await verifySessionToken(token)
    if (!payload) {
        return NextResponse.json({ authenticated: false }, { status: 401 })
    }
    return NextResponse.json({ authenticated: true, role: payload.role, username: payload.username })
}
