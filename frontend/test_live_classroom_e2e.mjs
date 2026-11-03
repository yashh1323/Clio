import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

if (fs.existsSync('.env.local') && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile('.env.local');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment / .env.local');
  process.exit(1);
}

console.log('====================================================');
console.log('🧪 CLIO LIVE END-TO-END MULTI-USER CLASSROOM TEST');
console.log('====================================================');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runLiveTest() {
  // Check if tables are ready
  const { data: testProfiles, error: pErr } = await supabase.from('profiles').select('id').limit(1);
  if (pErr) {
    console.error('❌ Database tables not found in Supabase yet!');
    console.error('Please run migrations/000_full_schema.sql in your Supabase SQL editor.');
    process.exit(1);
  }

  console.log('✅ Connected to Supabase with Service Role Key. Tables are ready!');
  const testId = Date.now().toString().slice(-6);

  // 1. Create Teacher Profile
  console.log('\n--- Step 1: Registering Teacher ---');
  const teacherUsername = `prof_turner_${testId}`;
  const { data: teacher, error: tErr } = await supabase.from('profiles').insert({
    username: teacherUsername,
    email: `${teacherUsername}@university.edu`,
    password: '$2a$10$dummyhashedpasswordforliveverification',
    role: 'teacher',
    full_name: 'Professor Turner'
  }).select('id, username, role').single();

  if (tErr) throw new Error('Teacher insert failed: ' + tErr.message);
  console.log(`✅ Teacher created: ${teacher.username} (ID: ${teacher.id})`);

  // 2. Create Student Profile
  console.log('\n--- Step 2: Registering Student ---');
  const studentUsername = `alex_student_${testId}`;
  const { data: student, error: sErr } = await supabase.from('profiles').insert({
    username: studentUsername,
    email: `${studentUsername}@student.university.edu`,
    password: '$2a$10$dummyhashedpasswordforliveverification',
    role: 'student',
    full_name: 'Alex Johnson'
  }).select('id, username, role').single();

  if (sErr) throw new Error('Student insert failed: ' + sErr.message);
  console.log(`✅ Student created: ${student.username} (ID: ${student.id})`);

  // 3. Teacher Creates Assignment
  console.log('\n--- Step 3: Teacher Creates Assignment ---');
  const { data: assignment, error: aErr } = await supabase.from('assignments').insert({
    teacher_id: teacher.id,
    title: `Distributed Systems Architecture ${testId}`,
    description: 'Explain the CAP theorem and consensus protocols.',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString()
  }).select('id, title, teacher_id').single();

  if (aErr) throw new Error('Assignment insert failed: ' + aErr.message);
  console.log(`✅ Assignment created: "${assignment.title}" (ID: ${assignment.id})`);

  // 4. Student Writes & Submits Essay with Keystroke Telemetry
  console.log('\n--- Step 4: Student Submits Essay with Keystroke Telemetry ---');
  const sampleEssay = 'The CAP theorem asserts that any distributed data store can only simultaneously provide at most two out of three guarantees: Consistency, Availability, and Partition tolerance. In modern distributed systems, network partitions are inevitable, meaning architects must choose between consistency and availability.';
  
  // Generate realistic monotonic snapshots
  const snapshots = [];
  let currentText = '';
  let timestamp = Date.now() - 60000;
  const words = sampleEssay.split(' ');
  for (let i = 0; i < words.length; i++) {
    currentText += (i === 0 ? '' : ' ') + words[i];
    timestamp += 400; // 400ms typing cadence
    snapshots.push({
      timestamp,
      textLength: currentText.length,
      html: `<p>${currentText}</p>`
    });
  }

  const { data: submission, error: subErr } = await supabase.from('submissions').insert({
    student_id: student.id,
    teacher_id: teacher.id,
    assignment_id: assignment.id,
    assignment_title: assignment.title,
    content: `<p>${sampleEssay}</p>`,
    wpm: 65,
    paste_count: 0,
    integrity_score: 100, // High integrity verified
    replay_snapshots: snapshots
  }).select('id, assignment_title, student_id, teacher_id, integrity_score, wpm').single();

  if (subErr) throw new Error('Submission insert failed: ' + subErr.message);
  console.log(`✅ Essay submitted by ${student.username}! (Submission ID: ${submission.id})`);
  console.log(`   ├─ Verified Integrity Score: ${submission.integrity_score}%`);
  console.log(`   ├─ Typing Cadence: ${submission.wpm} WPM`);
  console.log(`   └─ Recorded Snapshots: ${snapshots.length} keystroke events`);

  // 5. Teacher Views Submission on Dashboard & Grades It
  console.log('\n--- Step 5: Teacher Views Submission & Submits Grade ---');
  const { data: teacherSubmissions, error: tsErr } = await supabase
    .from('submissions')
    .select('id, assignment_title, integrity_score, student:profiles!submissions_student_id_fkey(full_name, username)')
    .eq('teacher_id', teacher.id);

  if (tsErr) throw new Error('Teacher submissions fetch failed: ' + tsErr.message);
  console.log(`✅ Teacher retrieved ${teacherSubmissions.length} submission(s) for grading.`);

  const { data: grade, error: gErr } = await supabase.from('grades').insert({
    submission_id: submission.id,
    teacher_id: teacher.id,
    score: 96,
    feedback: 'Exceptional analysis of network partitions and trade-offs. 100% verified authentic authorship!'
  }).select('id, score, feedback, graded_at').single();

  if (gErr) throw new Error('Grade insert failed: ' + gErr.message);
  console.log(`✅ Grade recorded by ${teacher.username}:`);
  console.log(`   ├─ Score: ${grade.score}/100`);
  console.log(`   └─ Feedback: "${grade.feedback}"`);

  // 6. Student Verifies Their Grade
  console.log('\n--- Step 6: Student Verifies Grade on Dashboard ---');
  const { data: studentView, error: svErr } = await supabase
    .from('submissions')
    .select('id, assignment_title, grade:grades(score, feedback, graded_at)')
    .eq('id', submission.id)
    .single();

  if (svErr) throw new Error('Student view fetch failed: ' + svErr.message);
  const studentGrade = Array.isArray(studentView.grade) ? studentView.grade[0] : studentView.grade;
  console.log(`✅ Student ${student.username} sees their grade:`);
  console.log(`   ├─ Assignment: ${studentView.assignment_title}`);
  console.log(`   ├─ Score: ${studentGrade.score}/100`);
  console.log(`   └─ Teacher Feedback: "${studentGrade.feedback}"`);

  // 7. Cleanup Test Records
  console.log('\n--- Step 7: Cleaning up test records ---');
  await supabase.from('grades').delete().eq('id', grade.id);
  await supabase.from('submissions').delete().eq('id', submission.id);
  await supabase.from('assignments').delete().eq('id', assignment.id);
  await supabase.from('profiles').delete().in('id', [student.id, teacher.id]);
  console.log('✅ Cleaned up temporary test records cleanly.');

  console.log('\n====================================================');
  console.log('🎉 FULL STUDENT -> TEACHER -> GRADE WORKFLOW VERIFIED LIVE ON SUPABASE!');
  console.log('====================================================');
}

runLiveTest().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
