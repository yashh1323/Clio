-- Run after migrations 000-003 on a test database.
BEGIN;
DO $$
DECLARE
    teacher_id uuid;
    student_id uuid;
    submission uuid;
    unassigned uuid;
    result jsonb;
BEGIN
    INSERT INTO profiles (username,password,role) VALUES (gen_random_uuid()::text,'fixture','teacher') RETURNING id INTO teacher_id;
    INSERT INTO profiles (username,password,role) VALUES (gen_random_uuid()::text,'fixture','student') RETURNING id INTO student_id;
    INSERT INTO submissions (student_id, teacher_id, assignment_title, content) VALUES (student_id, teacher_id, 'Fixture', '') RETURNING id INTO submission;
    INSERT INTO submissions (student_id, assignment_title, content) VALUES (student_id, 'Fixture', '') RETURNING id INTO unassigned;
    result := grade_owned_submission(teacher_id, 0, submission, 0, '');
    IF (result->>'score')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Zero grade lost'; END IF;
    PERFORM grade_owned_submission(teacher_id, 0, submission, 95, 'updated');
    BEGIN
        PERFORM grade_owned_submission(teacher_id, 0, unassigned, 80, '');
        RAISE EXCEPTION 'Unassigned submission accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE profiles SET password = 'changed' WHERE id = teacher_id;
    BEGIN
        PERFORM grade_owned_submission(teacher_id, 0, submission, 80, '');
        RAISE EXCEPTION 'Stale session accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM grade_owned_submission(teacher_id, 1, submission, 90, '');
    UPDATE profiles SET role = 'student' WHERE id = teacher_id;
    IF (SELECT session_version FROM profiles WHERE id = teacher_id) <> 2 THEN RAISE EXCEPTION 'Demotion left session active'; END IF;
    IF has_function_privilege('authenticated', 'grade_owned_submission(uuid,integer,uuid,integer,text)', 'execute') THEN
        RAISE EXCEPTION 'Client role can call grading function directly';
    END IF;
END $$;
ROLLBACK;
