import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"
import { auditTelemetryWithEngine } from "@/lib/engine"
import sanitizeHtml from "sanitize-html"

export const runtime = 'nodejs'

// ── Rate Limiting (In-Memory with Bounded TTL Pruning) ──
const rateLimitMap = new Map<string, { count: number, resetTime: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

function checkRateLimit(identifier: string): boolean {
    const now = Date.now();

    // Evict expired entries to prevent unbounded memory growth
    for (const [key, entry] of rateLimitMap.entries()) {
        if (now > entry.resetTime) {
            rateLimitMap.delete(key);
        }
    }

    const userLimit = rateLimitMap.get(identifier);

    if (!userLimit || now > userLimit.resetTime) {
        if (!rateLimitMap.has(identifier) && rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
            const oldestKey = rateLimitMap.keys().next().value;
            if (oldestKey !== undefined) {
                rateLimitMap.delete(oldestKey);
            }
        }
        rateLimitMap.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }

    if (userLimit.count >= RATE_LIMIT_MAX) {
        return false;
    }

    userLimit.count += 1;
    return true;
}

// ── GET /api/submissions — returns all submissions or single submission by query id ──
export async function GET(req: NextRequest) {
    // Verify session (teacher only)
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    
    // Explicitly check role without whitespace/case issues
    const role = session ? (session.role || "").trim().toLowerCase() : "";
    if (!session || role !== "teacher") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    // Look up the teacher's profile ID to filter submissions
    const { data: teacherProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (!teacherProfile) {
        return NextResponse.json({ error: "Teacher profile not found" }, { status: 404 })
    }

    // Check if a specific submission ID is requested via query parameter
    const queryId = req.nextUrl.searchParams.get("id")
    if (queryId) {
        const { data: sub, error: subError } = await supabase
            .from("submissions")
            .select(`
                id,
                assignment_title,
                content,
                wpm,
                paste_count,
                integrity_score,
                submitted_at,
                teacher_id,
                replay_snapshots,
                student:profiles!submissions_student_id_fkey ( id, username ),
                grade:grades ( id, score, feedback, graded_at )
            `)
            .eq("id", queryId)
            .single()

        if (subError || !sub) {
            return NextResponse.json({ error: subError?.message || "Submission not found" }, { status: 404 })
        }

        // Check teacher authorization
        if (sub.teacher_id && sub.teacher_id !== teacherProfile.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }

        const student = Array.isArray(sub.student) ? sub.student[0] : sub.student
        const grade = Array.isArray(sub.grade) ? sub.grade[0] : sub.grade

        return NextResponse.json({
            id: sub.id,
            student_id: student?.username ?? "unknown",
            assignment_title: sub.assignment_title,
            content: sub.content,
            wpm: sub.wpm,
            paste_count: sub.paste_count,
            integrity_score: sub.integrity_score,
            timestamp: sub.submitted_at,
            replay_snapshots: sub.replay_snapshots ?? [],
            grade: grade ?? null,
        })
    }

    const { data, error } = await supabase
        .from("submissions")
        .select(`
      id,
      assignment_title,
      wpm,
      paste_count,
      integrity_score,
      submitted_at,
      teacher_id,
      student:profiles!submissions_student_id_fkey ( id, username ),
      grade:grades ( id, score, feedback, graded_at )
    `)
        .or(`teacher_id.eq.${teacherProfile.id},teacher_id.is.null`)
        .order("submitted_at", { ascending: false })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Flatten for the dashboard
    const formatted = (data ?? []).map((s) => {
        const student = Array.isArray(s.student) ? s.student[0] : s.student
        const grade = Array.isArray(s.grade) ? s.grade[0] : s.grade
        return {
            id: s.id,
            student_id: student?.username ?? "unknown",
            assignment_title: s.assignment_title,
            wpm: s.wpm,
            paste_count: s.paste_count,
            integrity_score: s.integrity_score,
            timestamp: s.submitted_at,
            grade: grade ?? null,
        }
    })

    return NextResponse.json(formatted)
}

// ── POST /api/submissions — student submits an essay ──
export async function POST(req: NextRequest) {
    // Verify session (student only)
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    
    // Explicitly check role without whitespace/case issues
    const role = (session.role || "").trim().toLowerCase();
    if (role !== "student") {
        return NextResponse.json({ error: "Forbidden: only students can submit essays" }, { status: 403 })
    }

    // Apply Rate Limiting
    const identifier = session.username;
    if (!checkRateLimit(identifier)) {
        return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
    }

    try {
        const supabase = createSupabaseAdmin()
        // Use Next.js built-in JSON parser
        const body = await req.json()

        const { assignment_title, assignment_id, content, replay_snapshots, teacher_id } = body as {
            assignment_title?: string
            assignment_id?: string
            content?: string
            wpm?: number
            paste_count?: number
            replay_snapshots?: Array<{ timestamp: number; html: string; textLength: number }>
            teacher_id?: string
        }

        if (!content || content.trim().length === 0) {
            return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
        }

        if (content.length > 20_000_000) {
            return NextResponse.json({ error: "Essay content is too long (max 20,000,000 characters)" }, { status: 400 })
        }

        const safeTitle = sanitizeHtml((assignment_title || "Untitled").slice(0, 500))

        // Server-side HTML subsampling & sanitization:
        // Out of up to 10,000 snapshots, retain & sanitize `html` (capped at max 50,000 chars)
        // for at most 200 evenly-spaced snapshots (including first and last).
        // Remaining snapshots set `html: ""` while keeping `{ timestamp, textLength }` intact.
        const MAX_SNAPSHOTS = 10_000
        const MAX_HTML_SNAPSHOTS = 200
        const MAX_SNAPSHOT_HTML_CHARS = 50_000

        const rawSnapshots = Array.isArray(replay_snapshots)
            ? replay_snapshots.slice(0, MAX_SNAPSHOTS)
            : []

        const htmlIndices = new Set<number>()
        if (rawSnapshots.length <= MAX_HTML_SNAPSHOTS) {
            for (let i = 0; i < rawSnapshots.length; i++) {
                htmlIndices.add(i)
            }
        } else {
            for (let i = 0; i < MAX_HTML_SNAPSHOTS - 1; i++) {
                htmlIndices.add(Math.floor((i * (rawSnapshots.length - 1)) / (MAX_HTML_SNAPSHOTS - 1)))
            }
            htmlIndices.add(0)
            htmlIndices.add(rawSnapshots.length - 1)
        }

        const safeSnapshots = rawSnapshots.map((snap, idx) => ({
            timestamp: snap?.timestamp,
            textLength: snap?.textLength,
            html:
                htmlIndices.has(idx) && typeof snap?.html === "string" && snap.html.length > 0
                    ? sanitizeHtml(snap.html.trim().slice(0, MAX_SNAPSHOT_HTML_CHARS)).slice(
                          0,
                          MAX_SNAPSHOT_HTML_CHARS
                      )
                    : "",
        }))

        // Sanitize the HTML on the server before passing to Database (prevents XSS permanently)
        const sanitizedContent = sanitizeHtml(content.trim())

        // ── Server-Side Proof-of-Write Verification ──
        // Never blindly trust client-submitted wpm or paste_count.
        // Audit safe sanitized snapshots via high-performance Go Engine with local fallback:
        // (Strangler Fig pattern: proxies to Go engine or falls back to local auditTelemetrySnapshots)
        const audit = await auditTelemetryWithEngine(safeSnapshots, sanitizedContent)

        const safeWpm = audit.verifiedWpm
        const safePaste = audit.verifiedPasteCount
        const score = audit.integrityScore

        // Lookup the student's profile ID from the username
        const { data: profile, error: profileErr } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", session.username)
            .single()

        if (profileErr || !profile) {
            return NextResponse.json({ error: "Student profile not found" }, { status: 404 })
        }

        // Insert the submission with verified metrics
        const insertData: Record<string, unknown> = {
            student_id: profile.id,
            assignment_title: safeTitle,
            content: sanitizedContent,
            wpm: safeWpm,
            paste_count: safePaste,
            integrity_score: score,
            replay_snapshots: safeSnapshots,
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

        // Validate and attach assignment if specified, binding teacher_id automatically
        if (assignment_id) {
            if (typeof assignment_id !== "string" || !uuidRegex.test(assignment_id)) {
                return NextResponse.json({ error: "Invalid assignment_id format" }, { status: 400 })
            }

            const { data: assignment, error: assignErr } = await supabase
                .from("assignments")
                .select("id, teacher_id")
                .eq("id", assignment_id)
                .single()

            if (assignErr || !assignment) {
                return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
            }

            // Reject student overrides if teacher_id mismatches assignment.teacher_id
            if (teacher_id && teacher_id !== assignment.teacher_id) {
                return NextResponse.json({ error: "teacher_id mismatch with assignment" }, { status: 400 })
            }

            insertData.assignment_id = assignment.id
            insertData.teacher_id = assignment.teacher_id
        } else if (teacher_id) {
            // Validate and attach teacher if specified directly for unassigned submissions
            if (typeof teacher_id !== "string" || !uuidRegex.test(teacher_id)) {
                return NextResponse.json({ error: "Invalid teacher_id format" }, { status: 400 })
            }

            // Verify the teacher exists and has the 'teacher' role
            const { data: teacherCheck, error: teacherErr } = await supabase
                .from("profiles")
                .select("id")
                .eq("id", teacher_id)
                .eq("role", "teacher")
                .single()

            if (teacherErr || !teacherCheck) {
                return NextResponse.json({ error: "Teacher not found" }, { status: 404 })
            }

            insertData.teacher_id = teacher_id
        }

        const { data: sub, error: subErr } = await supabase
            .from("submissions")
            .insert(insertData)
            .select("id, integrity_score, submitted_at")
            .single()

        if (subErr) {
            return NextResponse.json({ error: subErr.message }, { status: 500 })
        }

        return NextResponse.json({
            message: "Submitted successfully",
            submission_id: sub.id,
            score,
            verified_wpm: safeWpm,
            verified_paste_count: safePaste,
            flagged: audit.flaggedForReview,
            submitted_at: sub.submitted_at,
        })
    } catch (err: unknown) {
        console.error("[POST /api/submissions] Error:", err)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}
