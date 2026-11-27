import type { ValidatedSession } from "@/lib/auth"
import { createSupabaseAdmin } from "@/lib/supabase"
import { ApiError, UUID } from "./request"

export function validateGrade(body: Record<string, unknown>) {
    const { submission_id, score, feedback = "" } = body
    if (typeof submission_id !== "string" || !UUID.test(submission_id)) throw new ApiError("Valid submission_id required")
    if (typeof score !== "number" || !Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100) {
        throw new ApiError("score must be a finite integer from 0 to 100")
    }
    if (typeof feedback !== "string" || feedback.length > 5000) throw new ApiError("feedback must be a string of at most 5000 characters")
    return { submission_id, score, feedback }
}

export async function gradeOwnedSubmission(session: ValidatedSession, body: Record<string, unknown>) {
    const { submission_id, score, feedback } = validateGrade(body)
    const { data, error } = await createSupabaseAdmin().rpc("grade_owned_submission", {
        p_teacher_id: session.sub, p_session_version: session.session_version,
        p_submission_id: submission_id, p_score: score, p_feedback: feedback,
    })
    if (error?.code === "42501") throw new ApiError("Submission not found or not authorized", 403)
    if (error?.code === "22023") throw new ApiError("Invalid grade fields")
    if (error || !data) throw new ApiError("Unable to save grade", 500)
    return data
}
