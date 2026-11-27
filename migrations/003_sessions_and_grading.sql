BEGIN;

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS max_word_count INTEGER;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_seen_notifications TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Central invalidation covers every password/role/status mutation, including SQL/admin updates.
CREATE OR REPLACE FUNCTION public.invalidate_profile_sessions()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Profile IDs are immutable' USING ERRCODE = '23514';
    END IF;
    NEW.session_version := GREATEST(OLD.session_version, NEW.session_version);
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.password IS DISTINCT FROM OLD.password
       OR NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.session_version := GREATEST(OLD.session_version + 1, NEW.session_version);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_invalidate_sessions ON public.profiles;
CREATE TRIGGER profiles_invalidate_sessions BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.invalidate_profile_sessions();
REVOKE ALL ON FUNCTION public.invalidate_profile_sessions() FROM PUBLIC, anon, authenticated;

-- Authorization and grade write share one transaction and hold the submission row lock.
-- Never claim an unassigned submission. Only the server's service role may invoke this RPC.
CREATE OR REPLACE FUNCTION public.grade_owned_submission(
    p_teacher_id UUID, p_session_version INTEGER, p_submission_id UUID,
    p_score INTEGER, p_feedback TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    owner_id UUID;
    result JSONB;
BEGIN
    IF p_score IS NULL OR p_score < 0 OR p_score > 100 OR p_feedback IS NULL OR length(p_feedback) > 5000 THEN
        RAISE EXCEPTION 'Invalid grade fields' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.profiles
        WHERE id = p_teacher_id AND role = 'teacher' AND status = 'active'
          AND session_version = p_session_version FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session is no longer authorized' USING ERRCODE = '42501';
    END IF;
    SELECT teacher_id INTO owner_id FROM public.submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND OR owner_id IS DISTINCT FROM p_teacher_id THEN
        RAISE EXCEPTION 'Submission not found or not owned by teacher' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.grades (submission_id, teacher_id, score, feedback, graded_at)
        VALUES (p_submission_id, p_teacher_id, p_score, p_feedback, clock_timestamp())
        ON CONFLICT (submission_id) DO UPDATE SET
            teacher_id = EXCLUDED.teacher_id, score = EXCLUDED.score,
            feedback = EXCLUDED.feedback, graded_at = EXCLUDED.graded_at
        RETURNING jsonb_build_object('id', id, 'score', score, 'feedback', feedback, 'graded_at', graded_at) INTO result;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.grade_owned_submission(UUID, INTEGER, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grade_owned_submission(UUID, INTEGER, UUID, INTEGER, TEXT) TO service_role;

COMMIT;
