import { NextResponse } from "next/server"

export class ApiError extends Error {
    constructor(message: string, public readonly status = 400) { super(message) }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireSameOrigin(req: Request) {
    const origin = req.headers.get("origin")
    // Standalone Next may use an internal listener hostname in req.url.
    const host = req.headers.get("host") ?? new URL(req.url).host
    if ((origin && !["http://" + host, "https://" + host].includes(origin)) ||
        req.headers.get("sec-fetch-site") === "cross-site") {
        throw new ApiError("Same-origin request required", 403)
    }
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new ApiError("Content-Type must be application/json", 415)
    }
    const bytes = await readBoundedBody(req, maxBytes)
    let body: unknown
    try { body = JSON.parse(bytes.toString("utf8")) }
    catch { throw new ApiError("Invalid JSON body") }
    if (!isRecord(body)) throw new ApiError("JSON body must be an object")
    return body
}

export async function readBoundedBody(req: Request, maxBytes: number): Promise<Buffer> {
    const declared = req.headers.get("content-length")
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
        throw new ApiError("Request body is too large", 413)
    }
    if (!req.body) throw new ApiError("Request body required")
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > maxBytes) {
                await reader.cancel().catch(() => {})
                throw new ApiError("Request body is too large", 413)
            }
            chunks.push(value)
        }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function apiErrorResponse(error: unknown) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
}
