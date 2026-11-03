import crypto from "crypto"

/**
 * Returns the AUTH_SECRET used for signing/verifying session tokens.
 *
 * - In production: throws if AUTH_SECRET env var is missing (never falls back).
 * - In development: uses a dev-only default so the app works out of the box.
 */
export function getAuthSecret(): string {
    const secret = process.env.AUTH_SECRET

    if (secret) return secret

    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "[Clio] AUTH_SECRET environment variable is required in production. " +
            "Set it in your deployment config to a strong random string."
        )
    }

    // Dev-only fallback — never used in production
    return "clio-dev-secret-DO-NOT-USE-IN-PROD"
}

export interface SessionTokenPayload {
    username: string
    role: string
    exp?: number
    iat?: number
    jti?: string
    [key: string]: unknown
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
            if (typeof parsed.exp !== "number" || parsed.exp <= now) {
                return null // Expired or missing exp claim fails closed
            }

            return parsed as SessionTokenPayload
        }
        return null
    } catch {
        return null
    }
}