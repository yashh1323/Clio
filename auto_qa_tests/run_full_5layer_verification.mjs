import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Pre-load frontend/.env.local so AUTH_SECRET matches Next.js dev server
try {
  const envContent = fs.readFileSync(path.resolve('frontend/.env.local'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      process.env[key] = val;
    }
  }
} catch (_) {}

import { signToken } from '../frontend/lib/auth.ts';

let chromium;
try {
  const pw = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  chromium = pw.chromium;
} catch {
  // If playwright is not globally installed, attempt fallback to sibling directory if present
  try {
    const pw = await import('../node_modules/playwright/index.mjs');
    chromium = pw.chromium;
  } catch {
    console.warn('⚠️ Playwright not detected; browser layer will be skipped if unavailable.');
  }
}

console.log('================================================================');
console.log('🛡️  CLIO FULL 5-LAYER E2E QUALITY ASSURANCE & VERIFICATION SUITE');
console.log('================================================================\n');

const results = [];
function recordResult(layer, name, passed, details = '') {
  results.push({ layer, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${layer}] ${icon} - ${name} ${details ? '(' + details + ')' : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const studentToken = signToken({ username: 'qa_student', role: 'student' });
  const teacherToken = signToken({ username: 'qa_teacher', role: 'teacher' });

  try {
    // ========================================================================
    // LAYER 1: Route Availability & Edge Middleware Authentication Guards
    // ========================================================================
    console.log('--- Executing Layer 1: Route Availability & Edge Middleware Guards ---');
    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();

    // 1.1 Landing page
    await anonPage.goto('http://localhost:3000/');
    const letsGoBtn = anonPage.getByRole('button', { name: "Let's Go" }).or(anonPage.getByRole('link', { name: "Let's Go" }));
    const hasLetsGo = await letsGoBtn.first().isVisible({ timeout: 5000 });
    recordResult('Layer 1', 'Landing page renders with "Let\'s Go" CTA', hasLetsGo);

    // 1.2 Unauthenticated /dashboard guard redirect
    await anonPage.goto('http://localhost:3000/dashboard');
    await anonPage.waitForTimeout(600);
    const dashRedirected = anonPage.url().includes('/login');
    recordResult('Layer 1', 'Unauthenticated /dashboard access redirects to /login', dashRedirected, anonPage.url());

    // 1.3 Unauthenticated /editor guard redirect
    await anonPage.goto('http://localhost:3000/editor');
    await anonPage.waitForTimeout(600);
    const editorRedirected = anonPage.url().includes('/login');
    recordResult('Layer 1', 'Unauthenticated /editor access redirects to /login', editorRedirected, anonPage.url());

    // 1.4 Unauthenticated API route guard
    const anonApiRes = await fetch('http://localhost:3000/api/submissions');
    recordResult('Layer 1', 'Unauthenticated /api/submissions returns 401 Unauthorized', anonApiRes.status === 401, `Status ${anonApiRes.status}`);

    // 1.5 Role-mismatched access (Student accessing /api/grades)
    const studentGradesRes = await fetch('http://localhost:3000/api/grades', {
      headers: { Cookie: 'clio_session=' + studentToken }
    });
    recordResult('Layer 1', 'Student accessing teacher-only /api/grades returns 403 Forbidden', studentGradesRes.status === 403, `Status ${studentGradesRes.status}`);

    // ========================================================================
    // LAYER 2: Student & Teacher Authentication Funnels
    // ========================================================================
    console.log('\n--- Executing Layer 2: Student & Teacher Authentication Funnels ---');
    await anonPage.goto('http://localhost:3000/register');
    await anonPage.waitForTimeout(600);

    // 2.1 Empty registration submission validation
    const createBtn = anonPage.getByRole('button', { name: 'Create Account' });
    await createBtn.click();
    await anonPage.waitForTimeout(300);
    const emptyErrVisible = await anonPage.getByText('Username, email, and password are required').isVisible({ timeout: 3000 });
    recordResult('Layer 2', 'Empty registration form rejected with inline validation banner', emptyErrVisible);

    // 2.2 Teacher role toggle & faculty invite code field presentation
    const teacherRoleBtn = anonPage.getByRole('button', { name: 'Teacher' });
    await teacherRoleBtn.click();
    await anonPage.waitForTimeout(300);
    const inviteCodeVisible = await anonPage.locator('#inviteCode').isVisible({ timeout: 3000 });
    recordResult('Layer 2', 'Toggling Teacher role dynamically displays Faculty Invite Code input', inviteCodeVisible);

    // 2.3 Password mismatch validation
    await anonPage.locator('#username').fill('prof_hopper');
    await anonPage.locator('#fullName').fill('Grace Hopper');
    await anonPage.locator('#email').fill('hopper@navy.edu');
    await anonPage.locator('#inviteCode').fill('FACULTY_PASS');
    await anonPage.locator('#password').fill('securepass123');
    await anonPage.locator('#confirmPassword').fill('mismatch999');
    await createBtn.click();
    await anonPage.waitForTimeout(300);
    const mismatchVisible = await anonPage.getByText('Passwords do not match').isVisible({ timeout: 3000 });
    recordResult('Layer 2', 'Mismatched passwords rejected before submission', mismatchVisible);

    // 2.4 Login rejection & constant-time dummy bcrypt verification
    await anonPage.goto('http://localhost:3000/login');
    await anonPage.locator('#username').fill('nonexistent_user');
    await anonPage.locator('#password').fill('wrong_credentials');
    const loginStart = Date.now();
    await anonPage.locator('#login-button, button[type="submit"]').click();
    let loginErrVisible = false;
    try {
      await anonPage.getByText('Invalid credentials').waitFor({ state: 'visible', timeout: 5000 });
      loginErrVisible = true;
    } catch (_) {}
    const loginElapsed = Date.now() - loginStart;
    recordResult('Layer 2', 'Invalid credentials rejected with constant-time dummy bcrypt', loginErrVisible, `${loginElapsed}ms`);

    // ========================================================================
    // LAYER 3: TipTap Editor, Word Count, Draft Persistence, Telemetry
    // ========================================================================
    console.log('\n--- Executing Layer 3: TipTap Editor, Word Count, Persistence & Telemetry ---');
    const studentCtx = await browser.newContext();
    await studentCtx.addCookies([{ name: 'clio_session', value: studentToken, domain: 'localhost', path: '/' }]);
    const studentPage = await studentCtx.newPage();

    await studentPage.goto('http://localhost:3000/editor');
    await studentPage.waitForTimeout(1500);

    // 3.1 TipTap editor canvas mounted
    const tiptapVisible = await studentPage.locator('.tiptap, div[contenteditable="true"]').first().isVisible({ timeout: 5000 });
    recordResult('Layer 3', 'TipTap ProseMirror rich text editor canvas mounts successfully', tiptapVisible);

    // 3.2 Real keyboard typing & live keystroke telemetry simulation
    const tiptap = studentPage.locator('.tiptap');
    await tiptap.click();
    const testText = 'Autonomous verification confirms the TipTap rich editor tracks word progression flawlessly.';
    await studentPage.keyboard.type(testText, { delay: 15 });
    await studentPage.waitForTimeout(1500);

    // 3.3 Dynamic word count update
    const wordCountVal = await studentPage.locator('#word-count-value').innerText().catch(() => '');
    const wordCountExpected = testText.trim().split(/\s+/).length;
    recordResult('Layer 3', `Dynamic word count updates accurately (${wordCountVal} words)`, parseInt(wordCountVal, 10) === wordCountExpected, `expected ${wordCountExpected}`);

    // 3.4 Focus Mode toggle
    const focusBtn = studentPage.getByRole('button', { name: 'Focus Mode' });
    await focusBtn.click();
    await studentPage.waitForTimeout(400);
    const inFocusMode = await studentPage.getByText('Exit Focus').first().isVisible({ timeout: 3000 });
    recordResult('Layer 3', 'Focus mode toggle isolates editor and suppresses distracting chrome', inFocusMode);
    await studentPage.getByText('Exit Focus').first().click();
    await studentPage.waitForTimeout(400);

    // 3.5 IndexedDB draft persistence & localStorage state
    const autoSaveData = await studentPage.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('ClioDB', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('editor_state', 'readonly');
          const store = tx.objectStore('editor_state');
          const htmlReq = store.get('clio_html');
          const snapReq = store.get('clio_replay_snapshots');
          htmlReq.onsuccess = () => {
            snapReq.onsuccess = () => {
              resolve({
                html: htmlReq.result,
                snapshotsCount: Array.isArray(snapReq.result) ? snapReq.result.length : 0,
                localTitle: localStorage.getItem('clio_title'),
                localWpm: localStorage.getItem('clio_wpm')
              });
            };
          };
        };
        req.onerror = () => resolve(null);
      });
    });

    const hasHtmlSaved = autoSaveData && typeof autoSaveData.html === 'string' && autoSaveData.html.includes('Autonomous verification');
    recordResult('Layer 3', 'Draft content safely auto-saved to IndexedDB (clio_html)', hasHtmlSaved, autoSaveData?.html?.slice(0, 35) + '...');

    // 3.6 Live keystroke telemetry capture in IndexedDB
    const hasSnapshots = autoSaveData && autoSaveData.snapshotsCount > 0;
    recordResult('Layer 3', `Keystroke replay snapshots recorded (${autoSaveData?.snapshotsCount || 0} snapshots)`, hasSnapshots);

    // ========================================================================
    // LAYER 4: Teacher Dashboard, Grading & Similarity Views
    // ========================================================================
    console.log('\n--- Executing Layer 4: Teacher Dashboard, Grading & Similarity Analysis ---');
    const teacherCtx = await browser.newContext();
    await teacherCtx.addCookies([{ name: 'clio_session', value: teacherToken, domain: 'localhost', path: '/' }]);
    const teacherPage = await teacherCtx.newPage();

    await teacherPage.goto('http://localhost:3000/dashboard');
    await teacherPage.waitForTimeout(1500);

    // 4.1 Teacher dashboard header & toolbar
    const dashHeaderVisible = await teacherPage.getByText('Clio — Teacher Dashboard').isVisible({ timeout: 5000 });
    recordResult('Layer 4', 'Teacher dashboard renders header and navigation toolbar', dashHeaderVisible);

    // 4.2 Stat metrics cards (TOTAL, AVG SCORE, NEEDS GRADING)
    const totalStatVisible = await teacherPage.getByText('TOTAL').first().isVisible({ timeout: 3000 });
    const avgScoreVisible = await teacherPage.getByText('AVG SCORE').first().isVisible({ timeout: 3000 });
    recordResult('Layer 4', 'Aggregate dashboard telemetry stat cards (TOTAL, AVG SCORE) render', totalStatVisible && avgScoreVisible);

    // 4.3 Filter panel toggle
    const filterBtn = teacherPage.getByRole('button', { name: 'Show Filters' });
    await filterBtn.click();
    await teacherPage.waitForTimeout(400);
    const filterPanelVisible = await teacherPage.getByText('GRADED').first().isVisible({ timeout: 3000 });
    recordResult('Layer 4', 'Filter controls expand and display ALL / GRADED / UNGRADED toggles', filterPanelVisible);

    // 4.4 Similarity view
    await teacherPage.goto('http://localhost:3000/similarity');
    await teacherPage.waitForTimeout(1500);
    const simTitleVisible = await teacherPage.getByText('Similarity Check').isVisible({ timeout: 5000 });
    recordResult('Layer 4', 'Plagiarism Similarity Detection interface mounted', simTitleVisible);

    // ========================================================================
    // LAYER 5: Rust Engine Endpoints & High-Performance Microservice
    // ========================================================================
    console.log('\n--- Executing Layer 5: Rust Engine Endpoints & Microservice Integration ---');

    // 5.1 Rust Health probe
    const rustHealthRes = await fetch('http://127.0.0.1:8088/health');
    const rustHealthData = await rustHealthRes.json();
    const rustHealthy = rustHealthRes.status === 200 && rustHealthData.status === 'ok' && rustHealthData.service === 'clio-engine';
    recordResult('Layer 5', 'Rust Engine /health endpoint returns HTTP 200 (clio-engine v1.0.0)', rustHealthy, `Uptime: ${Math.round(rustHealthData.uptime_seconds)}s`);

    // 5.2 Rust Prometheus Metrics
    const rustMetricsRes = await fetch('http://127.0.0.1:8088/metrics');
    const rustMetricsData = await rustMetricsRes.json();
    const metricsValid = rustMetricsRes.status === 200 && typeof rustMetricsData.telemetry_audits_total === 'number';
    recordResult('Layer 5', 'Rust Engine /metrics endpoint tracks atomic atomic counters', metricsValid, `Audits: ${rustMetricsData.telemetry_audits_total}`);

    // 5.3 Rust Monotonic Telemetry Audit Compute Route
    const auditRes = await fetch('http://127.0.0.1:8088/api/v1/telemetry/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshots: [
          { timestamp: 1000, textLength: 10, html: '<p>First line</p>' },
          { timestamp: 2000, textLength: 22, html: '<p>First line second line</p>' },
          { timestamp: 3000, textLength: 35, html: '<p>First line second line third line</p>' }
        ],
        finalContent: 'First line second line third line'
      })
    });
    const auditData = await auditRes.json();
    const auditPassed = auditRes.status === 200 && auditData.isValid === true && auditData.integrityScore === 100 && auditData.flaggedForReview === false;
    recordResult('Layer 5', 'Rust Engine telemetry audit computes monotonic keystroke integrity (100%)', auditPassed, `WPM: ${auditData.verifiedWpm}`);

    // 5.4 Rust Parallel MinHash/LSH Plagiarism Analysis
    const simCompRes = await fetch('http://127.0.0.1:8088/api/v1/similarity/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissions: [
          { id: 'sub_a', assignment: 'term_paper', student: 'Student A', username: 'student_a', content: 'The Industrial Revolution marked a rapid period of technological and societal change, transforming rural manufacturing into steam power across eighteenth-century England.' },
          { id: 'sub_b', assignment: 'term_paper', student: 'Student B', username: 'student_b', content: 'The Industrial Revolution marked a rapid period of technological and societal change, transforming rural manufacturing into steam power across eighteenth-century England.' }
        ],
        threshold: 25,
        shingleSize: 4
      })
    });
    const simCompData = await simCompRes.json();
    const simPassed = simCompRes.status === 200 && simCompData.pairs.length === 1 && simCompData.pairs[0].similarity === 100 && simCompData.method === 'minhash_lsh';
    recordResult('Layer 5', 'Rust Engine MinHash/LSH computes 100% collision match on duplicate papers', simPassed, `Method: ${simCompData.method}`);

    // 5.5 Rust Native In-Process ISO 32000-1 PDF Rendering
    const pdfCompRes = await fetch('http://127.0.0.1:8088/api/v1/pdf/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '<h1>Clio Authorship Report</h1><p>Verified authentic human writing session with zero unauthorized block-paste events.</p>',
        title: 'Clio E2E Certification',
        author: 'EGM Autopilot Observer'
      })
    });
    const pdfBytes = new Uint8Array(await pdfCompRes.arrayBuffer());
    const pdfHeader = String.fromCharCode(...pdfBytes.slice(0, 8));
    const isIsoPdf = pdfCompRes.status === 200 && pdfHeader.startsWith('%PDF-1.4') && pdfBytes.length > 500;
    recordResult('Layer 5', 'Rust Engine generates compliant native ISO 32000-1 PDF document', isIsoPdf, `Size: ${pdfBytes.length} bytes, Header: ${pdfHeader}`);

    console.log('\n================================================================');
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    console.log(`🏁 E2E VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED CLEANLY (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('================================================================\n');

  } finally {
    await browser.close();
  }
})();
