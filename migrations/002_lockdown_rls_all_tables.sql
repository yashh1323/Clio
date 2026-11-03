-- ============================================================
-- Clio: Comprehensive Row Level Security (RLS) Lockdown
-- Migration: 002_lockdown_rls_all_tables.sql
--
-- Defense-in-depth security migration to ensure full RLS enforcement
-- across all application tables and deny unauthorized access to the `anon`
-- public role. All legitimate queries originate from backend Next.js API
-- routes running with the service_role key.
-- ============================================================

-- 1. Enable Row Level Security on all core tables
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS class_enrollments ENABLE ROW LEVEL SECURITY;

-- 2. Force RLS for table owners (ensures RLS policies cannot be bypassed accidentally)
ALTER TABLE IF EXISTS profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grades FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classes FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS class_enrollments FORCE ROW LEVEL SECURITY;

-- 3. Revoke all privileges on public tables and sequences from the unauthenticated `anon` role
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

-- Ensure future tables don't grant permissions to `anon` by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;

-- 4. Explicit Deny Policies for `anon` across all tables (Idempotent)
-- Profiles
DROP POLICY IF EXISTS "Deny anon access to profiles" ON profiles;
CREATE POLICY "Deny anon access to profiles"
    ON profiles FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Submissions
DROP POLICY IF EXISTS "Deny anon access to submissions" ON submissions;
CREATE POLICY "Deny anon access to submissions"
    ON submissions FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Assignments
DROP POLICY IF EXISTS "Deny anon access to assignments" ON assignments;
CREATE POLICY "Deny anon access to assignments"
    ON assignments FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Grades
DROP POLICY IF EXISTS "Deny anon access to grades" ON grades;
CREATE POLICY "Deny anon access to grades"
    ON grades FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Drafts
DROP POLICY IF EXISTS "Deny anon access to drafts" ON drafts;
CREATE POLICY "Deny anon access to drafts"
    ON drafts FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Classes (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'classes') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Deny anon access to classes" ON classes';
        EXECUTE 'CREATE POLICY "Deny anon access to classes" ON classes FOR ALL TO anon USING (false) WITH CHECK (false)';
    END IF;
END $$;

-- Class Enrollments (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'class_enrollments') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Deny anon access to class_enrollments" ON class_enrollments';
        EXECUTE 'CREATE POLICY "Deny anon access to class_enrollments" ON class_enrollments FOR ALL TO anon USING (false) WITH CHECK (false)';
    END IF;
END $$;
