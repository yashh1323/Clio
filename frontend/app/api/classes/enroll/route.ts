import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase"
import { verifyToken } from "@/lib/auth"

// ── POST /api/classes/enroll — Teacher enrolls students into a class ──
// Body: { class_id: string, student_usernames: string[] }
export async function POST(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden: teachers only" }, { status: 403 })
    }

    const supabase = createSupabaseAdmin()

    try {
        const body = await req.json()
        const { class_id, student_usernames } = body as {
            class_id?: string
            student_usernames?: string[]
        }

        if (!class_id || !student_usernames || student_usernames.length === 0) {
            return NextResponse.json({ error: "class_id and student_usernames are required" }, { status: 400 })
        }

        // Parallelize: profile lookup + student lookup (both independent)
        const [{ data: teacherProfile }, { data: students }] = await Promise.all([
            supabase.from("profiles").select("id").eq("username", session.username).single(),
            supabase.from("profiles").select("id, username").eq("role", "student").in("username", student_usernames),
        ])

        if (!teacherProfile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

        // Verify teacher owns this class (depends on teacherProfile.id)
        const { data: cls } = await supabase
            .from("classes")
            .select("id")
            .eq("id", class_id)
            .eq("teacher_id", teacherProfile.id)
            .single()

        if (!cls) return NextResponse.json({ error: "Class not found or not owned by you" }, { status: 404 })

        if (!students || students.length === 0) {
            return NextResponse.json({ error: "No valid students found" }, { status: 400 })
        }

        // Insert enrollments (upsert to handle duplicates)
        const enrollments = students.map(s => ({
            class_id,
            student_id: s.id,
        }))

        const { error } = await supabase
            .from("class_enrollments")
            .upsert(enrollments, { onConflict: "class_id,student_id" })

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        return NextResponse.json({
            message: `Enrolled ${students.length} student(s)`,
            enrolled: students.map(s => s.username),
        })
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
}

// ── GET /api/classes/enroll?class_id=... — List enrolled students ──
export async function GET(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const classId = new URL(req.url).searchParams.get("class_id")
    if (!classId) return NextResponse.json({ error: "class_id is required" }, { status: 400 })

    const supabase = createSupabaseAdmin()

    // Verify teacher owns this class
    const { data: teacherProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", session.username)
        .single()

    if (!teacherProfile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const { data: cls } = await supabase
        .from("classes")
        .select("id")
        .eq("id", classId)
        .eq("teacher_id", teacherProfile.id)
        .single()

    if (!cls) return NextResponse.json({ error: "Class not found or not owned by you" }, { status: 403 })

    const { data, error } = await supabase
        .from("class_enrollments")
        .select(`
            id,
            enrolled_at,
            student:profiles!class_enrollments_student_id_fkey ( id, username, full_name, email, class, course )
        `)
        .eq("class_id", classId)
        .order("enrolled_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const students = (data ?? []).map(e => {
        const student = Array.isArray(e.student) ? e.student[0] : e.student
        return {
            enrollment_id: e.id,
            enrolled_at: e.enrolled_at,
            id: student?.id,
            username: student?.username,
            full_name: student?.full_name,
            email: student?.email,
            class: student?.class,
            course: student?.course,
        }
    })

    return NextResponse.json(students)
}

// ── DELETE /api/classes/enroll?enrollment_id=... — Remove student from class ──
export async function DELETE(req: NextRequest) {
    const token = req.cookies.get("clio_session")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const session = verifyToken(token)
    if (!session || session.role !== "teacher") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const enrollmentId = new URL(req.url).searchParams.get("enrollment_id")
    if (!enrollmentId) return NextResponse.json({ error: "enrollment_id is required" }, { status: 400 })

    const supabase = createSupabaseAdmin()

    // Parallelize: profile lookup + enrollment lookup (independent)
    const [{ data: teacherProfile }, { data: enrollment }] = await Promise.all([
        supabase.from("profiles").select("id").eq("username", session.username).single(),
        supabase.from("class_enrollments").select("id, class_id").eq("id", enrollmentId).single(),
    ])

    if (!teacherProfile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    if (!enrollment) return NextResponse.json({ error: "Enrollment not found" }, { status: 404 })

    // Verify teacher owns the class (depends on both results)
    const { data: cls } = await supabase
        .from("classes")
        .select("id")
        .eq("id", enrollment.class_id)
        .eq("teacher_id", teacherProfile.id)
        .single()

    if (!cls) return NextResponse.json({ error: "Not authorized to modify this enrollment" }, { status: 403 })

    const { error } = await supabase
        .from("class_enrollments")
        .delete()
        .eq("id", enrollmentId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ message: "Student removed" })
}
