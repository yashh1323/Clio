import crypto from "crypto"

export function getAuthSecret(): string {
    const secret = process.env.AUTH_SECRET
    if (!secret || secret.trim().length < 32 || secret.startsWith("replace_with_")) {
        throw new Error("Configure AUTH_SECRET with at least 32 random characters")
    }
    return secret
}

export interface SessionTokenPayload {
    username: string
    role: string
    sub?: string
    session_version?: number
    exp?: number
    iat?: number
    jti?: string
    [key: string]: unknown
}

export interface ValidatedSession extends SessionTokenPayload {
    sub: string
    session_version: number
    role: "student" | "teacher" | "admin"
}

/** API authorization is always checked against the live immutable account ID. */
export async function verifySessionToken(token: string): Promise<ValidatedSession | null> {
    try {
        const payload = verifyToken(token)
        if (!payload || typeof payload.sub !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
            !Number.isSafeInteger(payload.session_version) || (payload.session_version as number) < 0) {
            return null // Legacy username-only sessions must sign in again.
        }

        // Keep signing/verifying pure and usable without initializing a database client.
        const { createSupabaseAdmin } = await import("./supabase")
        const { data: profile, error } = await createSupabaseAdmin()
            .from("profiles")
            .select("id, username, role, status, session_version")
            .eq("id", payload.sub)
            .single()

        if (error || !profile || profile.id !== payload.sub || profile.status !== "active" ||
            profile.session_version !== payload.session_version || profile.role !== payload.role ||
            !["student", "teacher", "admin"].includes(profile.role) || typeof profile.username !== "string") {
            return null
        }
        return { ...payload, sub: profile.id, username: profile.username,
            role: profile.role, session_version: profile.session_version }
    } catch {
        return null // Missing configuration, unavailable DB, and deleted accounts fail closed.
    }
}

export const SESSION_DURATION_SECONDS = 8 * 60 * 60 // 8 hours

/**
 * Sign a payload into a `data.signature` token string.
 * Injects cryptographic `exp` (expiration), `iat` (issued at), and `jti` (unique ID) claims.
 */
export function signToken(
    payload: { username: string; role: string; [key: string]: unknown },
    expiresInSeconds: number = SESSION_DURATION_SECONDS
): string {
    const secret = getAuthSecret()
    const now = Math.floor(Date.now() / 1000)

    const fullPayload: SessionTokenPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds,
        jti: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    }

    const data = Buffer.from(JSON.stringify(fullPayload)).toString("base64url")
    const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url")
    return `${data}.${sig}`
}

/**
 * Verify and decode a `data.signature` token string.
 * Uses timing-safe comparison to prevent timing attacks.
 * Strictly enforces that `payload.exp > Math.floor(Date.now() / 1000)`.
 * Returns the decoded payload or null if invalid or expired.
 */
export function verifyToken(token: string): SessionTokenPayload | null {
    const secret = getAuthSecret()
    if (typeof token !== "string" || token.length > 8192) return null
    const parts = token.split(".")
    if (parts.length !== 2) return null

    const [data, sig] = parts

    // Compute expected signature
    const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url")

    // Timing-safe comparison: convert to Buffers and compare
    let sigBuf: Buffer
    try {
        sigBuf = Buffer.from(sig, "base64url")
    } catch {
        return null // invalid base64url input
    }

    const expectedBuf = Buffer.from(expected, "base64url")

    // Length check — timingSafeEqual requires equal-length buffers
    if (sigBuf.length !== expectedBuf.length) return null

    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null

    try {
        const parsed = JSON.parse(Buffer.from(data, "base64url").toString())
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof parsed.username === "string" &&
            typeof parsed.role === "string"
        ) {
            // Strictly check expiration claim
            const now = Math.floor(Date.now() / 1000)
            if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= now) {
                return null // Expired or missing exp claim fails closed
            }

            return parsed as SessionTokenPayload
        }
        return null
    } catch {
        return null
    }
}