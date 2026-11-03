-- ====================================================================
-- Clio: Complete PostgreSQL Database Schema
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<YOUR_PROJECT_ID>/sql/new
-- ====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Profiles Table (Users: Students, Teachers, Admins)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    full_name TEXT,
    course TEXT,
    class TEXT,
    student_class TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Assignments Table
CREATE TABLE IF NOT EXISTS public.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Classes Table
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Class Enrollments Table
CREATE TABLE IF NOT EXISTS public.class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (class_id, student_id)
);

-- 6. Submissions Table (Essays & Telemetry)
CREATE TABLE IF NOT EXISTS public.submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assignment_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL,
    assignment_title TEXT NOT NULL,
    content TEXT NOT NULL,
    wpm INTEGER DEFAULT 0,
    paste_count INTEGER DEFAULT 0,
    integrity_score INTEGER DEFAULT 100,
    replay_snapshots JSONB DEFAULT '[]'::jsonb,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Grades Table
CREATE TABLE IF NOT EXISTS public.grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID UNIQUE NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    feedback TEXT DEFAULT '',
    graded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Drafts Table
CREATE TABLE IF NOT EXISTS public.drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL,
    title TEXT DEFAULT 'Untitled Draft',
    content TEXT DEFAULT '',
    html TEXT DEFAULT '',
    json_content JSONB,
    word_count INTEGER DEFAULT 0,
    last_saved_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id ON public.assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON public.submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_teacher_id ON public.submissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON public.submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_grades_submission_id ON public.grades(submission_id);
CREATE INDEX IF NOT EXISTS idx_grades_teacher_id ON public.grades(teacher_id);
CREATE INDEX IF NOT EXISTS idx_drafts_student_id ON public.drafts(student_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON public.class_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_class ON public.class_enrollments(class_id);

-- 10. Enable Row Level Security (RLS) & Deny Anonymous Direct Queries
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;

-- Note: The Backend Server uses the SUPABASE_SERVICE_ROLE_KEY which automatically
-- bypasses RLS in PostgreSQL, ensuring server-mediated operations succeed securely.
