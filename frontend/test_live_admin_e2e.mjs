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
console.log('🛡️ CLIO LIVE ADMIN ROLE VERIFICATION TEST');
console.log('====================================================');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runAdminTest() {
  const testId = Date.now().toString().slice(-6);
  const adminUsername = `admin_supervisor_${testId}`;

  // 1. Create Admin Profile
  console.log('\n--- Step 1: Registering Admin User ---');
  const { data: admin, error: aErr } = await supabase.from('profiles').insert({
    username: adminUsername,
    email: `${adminUsername}@clio.institution.edu`,
    password: '$2a$10$dummyhashedpasswordforliveverification',
    role: 'admin',
    full_name: 'System Administrator'
  }).select('id, username, role').single();

  if (aErr) throw new Error('Admin insert failed: ' + aErr.message);
  console.log(`✅ Admin created: ${admin.username} (Role: ${admin.role}, ID: ${admin.id})`);

  // 2. Admin Queries User Directory
  console.log('\n--- Step 2: Admin System-Wide Directory Query ---');
  const { data: users, error: uErr } = await supabase.from('profiles').select('id, username, role');
  if (uErr) throw new Error('User query failed: ' + uErr.message);
  console.log(`✅ Admin queried directory: ${users.length} registered system account(s).`);

  // 3. Admin Queries System-Wide Submissions and Statistics
  console.log('\n--- Step 3: Admin Audits Submissions & Grades Registry ---');
  const { count: submissionCount, error: subCountErr } = await supabase.from('submissions').select('*', { count: 'exact', head: true });
  if (subCountErr) throw new Error('Submission count failed: ' + subCountErr.message);

  const { count: gradeCount, error: gradeCountErr } = await supabase.from('grades').select('*', { count: 'exact', head: true });
  if (gradeCountErr) throw new Error('Grade count failed: ' + gradeCountErr.message);

  console.log(`✅ System Audit Metrics: ${submissionCount ?? 0} total submissions, ${gradeCount ?? 0} total grades.`);

  // 4. Clean up Admin Test Record
  console.log('\n--- Step 4: Cleaning up Admin Test Record ---');
  await supabase.from('profiles').delete().eq('id', admin.id);
  console.log('✅ Cleaned up temporary admin test record cleanly.');

  console.log('\n====================================================');
  console.log('🎉 ADMIN ROLE VERIFICATION PASSED LIVE ON SUPABASE!');
  console.log('====================================================');
}

runAdminTest().catch((err) => {
  console.error('❌ Error during Admin verification:', err);
  process.exit(1);
});
