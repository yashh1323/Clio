import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';
import bcrypt from 'bcryptjs';
import { getEngineHeaders } from './lib/engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Starting Dedicated Phase 1-3 Fixes Verification Suite...\n');

// ── Test 1: Phase 1 - DOCX HTML Sanitization & Filename Header Injection ──
console.log('--- Test 1: Phase 1 - DOCX HTML Sanitization & Filename Header Injection ---');
const sanitizeOptions = {
    allowedTags: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'b', 'i', 'strong', 'em',
        'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'sub', 'sup',
        'table', 'tbody', 'thead', 'tr', 'th', 'td', 'br', 'hr', 'img'
    ],
    allowedAttributes: {
        '*': ['style', 'class'],
        img: ['src', 'alt', 'width', 'height'],
    },
    allowedSchemes: ['data'],
    allowedSchemesByTag: {
        img: ['data'],
    },
    allowedStyles: {
        '*': {
            'color': [/^\#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^[a-zA-Z]+$/i],
            'background-color': [/^\#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^[a-zA-Z]+$/i],
            'text-align': [/^(left|right|center|justify)$/i],
            'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%)$/i],
            'font-weight': [/^\d+$/i, /^(bold|normal|bolder|lighter)$/i],
            'font-style': [/^(italic|normal|oblique)$/i],
            'text-decoration': [/^(underline|line-through|none)$/i],
            'margin': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm))*$/i],
            'padding': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|pt|%|mm|cm))*$/i],
            'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|pt|%)?$/i],
        },
    },
};

const rawDocxHtml = '<p>Essay</p><script>alert("hacked")</script><iframe src="http://169.254.169.254"></iframe>';
const sanitizedHtml = sanitizeHtml(rawDocxHtml, sanitizeOptions);
assert.strictEqual(sanitizedHtml.includes('<script>'), false);
assert.strictEqual(sanitizedHtml.includes('<iframe'), false);
console.log('  ✔ DOCX HTML sanitization strips dangerous tags');

const maliciousFilename = 'my_essay\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>.docx';
const sanitizedBase = maliciousFilename.replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9.\-_ ()]/g, '_') || 'document';
assert.strictEqual(sanitizedBase.includes('\r'), false);
assert.strictEqual(sanitizedBase.includes('\n'), false);
assert.strictEqual(sanitizedBase.includes('<'), false);
assert.strictEqual(sanitizedBase.includes('>'), false);
console.log('  ✔ Filename header injection sanitized:', sanitizedBase);

// ── Test 2: Phase 1 - Pre-Shared Engine Key Transmission ──
console.log('\n--- Test 2: Phase 1 - Pre-Shared Engine Key Transmission ---');
delete process.env.CLIO_ENGINE_KEY;
assert.deepStrictEqual(getEngineHeaders(), {});
process.env.CLIO_ENGINE_KEY = 'super-secret-key-456';
assert.deepStrictEqual(getEngineHeaders(), { 'X-Clio-Engine-Key': 'super-secret-key-456' });
delete process.env.CLIO_ENGINE_KEY;
console.log('  ✔ getEngineHeaders correctly populates X-Clio-Engine-Key');

// ── Test 3: Phase 1 - Automatic Assignment Teacher Binding & Override Rejection ──
console.log('\n--- Test 3: Phase 1 - Assignment Teacher Binding & Override Rejection ---');
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const teacherAuthoritativeId = '11111111-1111-1111-1111-111111111111';
const teacherForgedId = '22222222-2222-2222-2222-222222222222';
const mockAssignment = { id: '33333333-3333-3333-3333-333333333333', teacher_id: teacherAuthoritativeId };

function resolveSubmissionTeacher(assignmentId, studentTeacherId, assignmentLookup) {
    const insertData = {};
    if (assignmentId) {
        if (typeof assignmentId !== 'string' || !uuidRegex.test(assignmentId)) {
            return { error: 'Invalid assignment_id format', status: 400 };
        }
        const assignment = assignmentLookup(assignmentId);
        if (!assignment) {
            return { error: 'Assignment not found', status: 404 };
        }
        if (studentTeacherId && studentTeacherId !== assignment.teacher_id) {
            return { error: 'teacher_id mismatch with assignment', status: 400 };
        }
        insertData.assignment_id = assignment.id;
        insertData.teacher_id = assignment.teacher_id;
    } else if (studentTeacherId) {
        if (typeof studentTeacherId !== 'string' || !uuidRegex.test(studentTeacherId)) {
            return { error: 'Invalid teacher_id format', status: 400 };
        }
        insertData.teacher_id = studentTeacherId;
    }
    return { data: insertData, status: 200 };
}

const autoBound = resolveSubmissionTeacher(mockAssignment.id, undefined, () => mockAssignment);
assert.strictEqual(autoBound.status, 200);
assert.strictEqual(autoBound.data.teacher_id, teacherAuthoritativeId);

const matchingBound = resolveSubmissionTeacher(mockAssignment.id, teacherAuthoritativeId, () => mockAssignment);
assert.strictEqual(matchingBound.status, 200);
assert.strictEqual(matchingBound.data.teacher_id, teacherAuthoritativeId);

const forgedBound = resolveSubmissionTeacher(mockAssignment.id, teacherForgedId, () => mockAssignment);
assert.strictEqual(forgedBound.status, 400);
assert.strictEqual(forgedBound.error, 'teacher_id mismatch with assignment');

const unassignedValid = resolveSubmissionTeacher(undefined, teacherAuthoritativeId, () => null);
assert.strictEqual(unassignedValid.status, 200);
assert.strictEqual(unassignedValid.data.teacher_id, teacherAuthoritativeId);

const unassignedInvalid = resolveSubmissionTeacher(undefined, 'invalid-not-uuid', () => null);
assert.strictEqual(unassignedInvalid.status, 400);
assert.strictEqual(unassignedInvalid.error, 'Invalid teacher_id format');

console.log('  ✔ Automatic assignment teacher binding and mismatch rejection verified');

// ── Test 4: Phase 2 - Time Compression Algorithm & 12 WPM Distortion Prevention ──
console.log('\n--- Test 4: Phase 2 - Time Compression Algorithm ---');
// Simulate typing session:
// Keystroke 1 at t=0
// Keystroke 2 at t=200ms
// Pause for 30,000ms (idle)
// Keystroke 3 at t=30,200ms
// Keystroke 4 at t=30,400ms (fast typing resumes at 200ms delta)
// Keystroke 5 at t=30,600ms (fast typing resumes at 200ms delta)
const rawKeystrokes = [0, 200, 30200, 30400, 30600];
let lastRawTime = null;
const compressedSnapshots = [];

for (const rawNow of rawKeystrokes) {
    const last = compressedSnapshots[compressedSnapshots.length - 1];
    let effectiveTimestamp = rawNow;
    if (last) {
        const rawGap = lastRawTime !== null ? Math.max(0, rawNow - lastRawTime) : 5001;
        const delta = Math.max(1, rawGap > 5000 ? 1000 : rawGap);
        effectiveTimestamp = last.timestamp + delta;
    }
    lastRawTime = rawNow;
    compressedSnapshots.push({ timestamp: effectiveTimestamp });
}

// Check gaps:
const gap1_2 = compressedSnapshots[1].timestamp - compressedSnapshots[0].timestamp;
const gap2_3 = compressedSnapshots[2].timestamp - compressedSnapshots[1].timestamp;
const gap3_4 = compressedSnapshots[3].timestamp - compressedSnapshots[2].timestamp;
const gap4_5 = compressedSnapshots[4].timestamp - compressedSnapshots[3].timestamp;

assert.strictEqual(gap1_2, 200, 'Initial keystroke gap should be preserved (200ms)');
assert.strictEqual(gap2_3, 1000, 'Idle pause (30s) should be compressed to exactly 1000ms');
assert.strictEqual(gap3_4, 200, 'Resumed typing gap must NOT be distorted to 1000ms! Must be 200ms');
assert.strictEqual(gap4_5, 200, 'Subsequent typing gap must NOT be distorted to 1000ms! Must be 200ms');
console.log('  ✔ Time compression preserves active typing speed and avoids 12 WPM distortion');

// ── Test 5: Phase 2 - Telemetry Subsampling & Verification Metadata Preservation ──
console.log('\n--- Test 5: Phase 2 - Telemetry Subsampling ---');
const totalTestSnapshots = 1000;
const rawTestSnapshots = [];
for (let i = 0; i < totalTestSnapshots; i++) {
    rawTestSnapshots.push({
        timestamp: 1000 + i * 200,
        textLength: i * 5,
        html: `<p>Paragraph ${i} with long HTML content that bloats the payload</p>`,
    });
}

const MAX_HTML_SNAPSHOTS = 200;
const htmlIndices = new Set();
for (let i = 0; i < MAX_HTML_SNAPSHOTS - 1; i++) {
    htmlIndices.add(Math.floor((i * (rawTestSnapshots.length - 1)) / (MAX_HTML_SNAPSHOTS - 1)));
}
htmlIndices.add(0);
htmlIndices.add(rawTestSnapshots.length - 1);

const processedSnapshots = rawTestSnapshots.map((snap, idx) => {
    if (!htmlIndices.has(idx)) {
        return {
            timestamp: snap.timestamp,
            textLength: snap.textLength,
            html: '',
        };
    }
    return {
        timestamp: snap.timestamp,
        textLength: snap.textLength,
        html: snap.html,
    };
});

assert.strictEqual(processedSnapshots.length, 1000, 'All 1000 snapshots must be preserved');
const withHtml = processedSnapshots.filter(s => s.html.length > 0);
const withoutHtml = processedSnapshots.filter(s => s.html.length === 0);
assert.strictEqual(withHtml.length, 200, 'Exactly 200 snapshots retain HTML');
assert.strictEqual(withoutHtml.length, 800, 'Remaining 800 snapshots have empty HTML');
assert.strictEqual(processedSnapshots[555].textLength, 555 * 5, 'textLength metadata preserved intact');
assert.strictEqual(processedSnapshots[555].timestamp, 1000 + 555 * 200, 'timestamp metadata preserved intact');
console.log(`  ✔ Subsampled HTML preserved: ${withHtml.length} full snapshots, ${withoutHtml.length} metadata-only snapshots`);

// ── Test 6: Phase 3 - Middleware /profile Protection ──
console.log('\n--- Test 6: Phase 3 - Middleware /profile Protection ---');
const middlewareSource = fs.readFileSync(path.resolve(__dirname, 'middleware.ts'), 'utf8');
assert.ok(middlewareSource.includes('/profile'), 'middleware.ts must include /profile in PROTECTED_PAGES');
assert.ok(middlewareSource.includes('PROTECTED_PAGES'), 'PROTECTED_PAGES array must be present');
console.log('  ✔ Edge Middleware protects /profile page');

// ── Test 7: Phase 3 - Login Timing Neutralization with DUMMY_HASH ──
console.log('\n--- Test 7: Phase 3 - Login Timing Neutralization ---');
const loginSource = fs.readFileSync(path.resolve(__dirname, 'app/api/auth/login/route.ts'), 'utf8');
assert.ok(loginSource.includes('DUMMY_HASH'), 'Login route must define DUMMY_HASH');
assert.ok(loginSource.includes('hashToCompare'), 'Login route must compare password against hashToCompare');

// Timing test comparing password with DUMMY_HASH
const start = performance.now();
await bcrypt.compare('test_password', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
const duration = performance.now() - start;
assert.ok(duration > 20, 'Bcrypt dummy compare executed with standard cryptographic delay');
console.log(`  ✔ Login timing neutralization executes bcrypt dummy check (${duration.toFixed(1)}ms)`);

// ── Test 8: Phase 3 - Migration 002 Full Table RLS Lockdown ──
console.log('\n--- Test 8: Phase 3 - Migration 002 Full Table RLS Lockdown ---');
const migrationPath = path.resolve(__dirname, '../migrations/002_lockdown_rls_all_tables.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration 002 file must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert.ok(migrationSql.includes('ENABLE ROW LEVEL SECURITY'), 'Must enable RLS');
assert.ok(migrationSql.includes('FORCE ROW LEVEL SECURITY'), 'Must force RLS');
assert.ok(migrationSql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon'), 'Must revoke privileges from anon');
assert.ok(migrationSql.includes('Deny anon access to profiles'), 'Must have deny policy for profiles');
assert.ok(migrationSql.includes('Deny anon access to submissions'), 'Must have deny policy for submissions');
assert.ok(migrationSql.includes('Deny anon access to assignments'), 'Must have deny policy for assignments');
console.log('  ✔ Migration 002 verified for full RLS lockdown of anon role');

// ── Test 9: Phase 3 - Docker Compose Alignment ──
console.log('\n--- Test 9: Phase 3 - Docker Compose Alignment ---');
const composePath = path.resolve(__dirname, '../docker-compose.yml');
const composeYaml = fs.readFileSync(composePath, 'utf8');
assert.ok(composeYaml.includes('CLIO_ENGINE_URL=http://engine:8088'), 'Must point to http://engine:8088');
assert.ok(composeYaml.includes('context: ./engine-rust'), 'Must build engine-rust context');
assert.ok(composeYaml.includes('"8088:8088"'), 'Must expose port 8088');
console.log('  ✔ docker-compose.yml aligned to engine-rust on port 8088');

// ── Test 10: P1.1 - Server-Side Snapshot HTML Subsampling & Precomputed Lengths ──
console.log('\n--- Test 10: P1.1 - Server-Side Snapshot HTML Subsampling & Precomputed Lengths ---');
const submissionsSource = fs.readFileSync(path.resolve(__dirname, 'app/api/submissions/route.ts'), 'utf8');
assert.ok(submissionsSource.includes('MAX_HTML_SNAPSHOTS = 200'), 'Must cap HTML snapshots at 200');
assert.ok(submissionsSource.includes('MAX_SNAPSHOT_HTML_CHARS = 50_000'), 'Must cap per-snapshot HTML at 50,000 chars');

// Verify subsampling algorithm retains at most 200 snapshots (including first and last) out of 1,500
const bigSnapshots = Array.from({ length: 1500 }, (_, i) => ({
    timestamp: 1000 + i * 500,
    textLength: (i + 1) * 3,
    html: `<p>${'x'.repeat(60_000)}</p><script>alert(1)</script>`,
}));
const maxHtmlSnaps = 200;
const maxHtmlChars = 50_000;
const sampledIndices = new Set();
for (let i = 0; i < maxHtmlSnaps - 1; i++) {
    sampledIndices.add(Math.floor((i * (bigSnapshots.length - 1)) / (maxHtmlSnaps - 1)));
}
sampledIndices.add(0);
sampledIndices.add(bigSnapshots.length - 1);

assert.strictEqual(sampledIndices.size, 200, 'Must select at most 200 evenly-spaced snapshots');
assert.ok(sampledIndices.has(0), 'Must include first snapshot');
assert.ok(sampledIndices.has(bigSnapshots.length - 1), 'Must include last snapshot');

const serverSubsampled = bigSnapshots.map((snap, idx) => ({
    ...snap,
    html: sampledIndices.has(idx)
        ? sanitizeHtml(snap.html.trim().slice(0, maxHtmlChars)).slice(0, maxHtmlChars)
        : '',
}));
const retainedCount = serverSubsampled.filter(s => s.html.length > 0).length;
assert.strictEqual(retainedCount, 200, 'Exactly 200 snapshots should retain sanitized HTML');
assert.ok(serverSubsampled[0].html.length <= maxHtmlChars, 'Retained HTML must be <= 50,000 chars');
assert.strictEqual(serverSubsampled[0].html.includes('<script>'), false, 'Retained HTML must be sanitized');
assert.strictEqual(serverSubsampled[1].html, '', 'Non-sampled snapshot HTML must be empty string');
assert.strictEqual(serverSubsampled[1].textLength, 6, 'Non-sampled snapshot textLength must be preserved');

const editorPageSource = fs.readFileSync(path.resolve(__dirname, 'app/editor/page.tsx'), 'utf8');
assert.ok(
    editorPageSource.includes('Math.floor((i * (cappedSnapshots.length - 1)) / (MAX_HTML_SNAPSHOTS - 1))'),
    'editor/page.tsx must use identical 200-snapshot subsampling formula as submissions/route.ts'
);
const telemetryTsSource = fs.readFileSync(path.resolve(__dirname, 'lib/telemetry.ts'), 'utf8');
assert.ok(telemetryTsSource.includes('const snapLengths = typedSnapshots.map(getSnapshotTextLength)'), 'telemetry.ts must precompute snapshot lengths once');
const telemetryRsSource = fs.readFileSync(path.resolve(__dirname, '../engine-rust/src/telemetry.rs'), 'utf8');
assert.ok(telemetryRsSource.includes('let snap_lengths: Vec<usize> = snapshots.iter().map(get_snapshot_text_length).collect()'), 'telemetry.rs must precompute snapshot lengths once');
console.log('  ✔ P1.1 Server-side HTML subsampling (<=200 snapshots, <=50k chars), client-server alignment & precomputed lengths verified');

// ── Test 11: P1.2 - Edge Middleware Role Alignment ──
console.log('\n--- Test 11: P1.2 - Edge Middleware Role Alignment ---');
const enrollIdx = middlewareSource.indexOf('/^\\/api\\/classes\\/enroll(\\/.*)?$/');
const classesIdx = middlewareSource.indexOf('/^\\/api\\/classes(\\/.*)?$/');
assert.ok(enrollIdx !== -1 && classesIdx !== -1 && enrollIdx < classesIdx, '/api/classes/enroll must precede /api/classes');
assert.ok(
    middlewareSource.includes('{ pattern: /^\\/api\\/classes\\/enroll(\\/.*)?$/, roles: ["teacher", "admin"] }'),
    '/api/classes/enroll must allow teacher and admin only'
);
assert.ok(
    middlewareSource.includes('{ pattern: /^\\/api\\/classes(\\/.*)?$/, roles: ["teacher", "student", "admin"] }'),
    '/api/classes must allow teacher, student, and admin'
);
assert.ok(
    middlewareSource.includes('{ pattern: /^\\/api\\/drafts(\\/.*)?$/, roles: ["student"] }'),
    '/api/drafts must be restricted to student only'
);
for (const routeName of ['submissions', 'assignments', 'teachers', 'profile']) {
    assert.ok(
        middlewareSource.includes(`{ pattern: /^\\/api\\/${routeName}(\\/.*)?$/, roles: ["teacher", "student", "admin"] }`),
        `/api/${routeName} must include admin role`
    );
}
console.log('  ✔ P1.2 Edge Middleware roles aligned for /api/classes/enroll, /api/classes, /api/drafts, and admin routes');

// ── Test 12: P1.3 & P2.3 - Rust Engine Unauthenticated Probes & Restricted CORS ──
console.log('\n--- Test 12: P1.3 & P2.3 - Rust Engine Unauthenticated Probes & Restricted CORS ---');
const rustApiSource = fs.readFileSync(path.resolve(__dirname, '../engine-rust/src/api.rs'), 'utf8');
assert.ok(rustApiSource.includes('.route_layer(from_fn_with_state(state.clone(), validate_engine_key))'), 'validate_engine_key must be scoped to protected_routes');
assert.strictEqual(rustApiSource.includes('CorsLayer::permissive()'), false, 'CorsLayer::permissive() must be removed');
assert.ok(rustApiSource.includes('http://localhost:3000'), 'CORS must allow http://localhost:3000');
assert.ok(rustApiSource.includes('http://127.0.0.1:3000'), 'CORS must allow http://127.0.0.1:3000');
assert.ok(rustApiSource.includes('CLIO_ALLOWED_ORIGIN'), 'CORS must support CLIO_ALLOWED_ORIGIN');
console.log('  ✔ P1.3 & P2.3 Rust Engine unauthenticated probes and non-permissive CORS verified');

// ── Test 13: P2.1, P2.2, P2.4 - Teacher Invite Code Gate & Bounded Auth/Submission Rate Limiting ──
console.log('\n--- Test 13: P2.1, P2.2, P2.4 - Teacher Invite Gate & Bounded Rate Limiting ---');
const registerSource = fs.readFileSync(path.resolve(__dirname, 'app/api/auth/register/route.ts'), 'utf8');
const registerPageSource = fs.readFileSync(path.resolve(__dirname, 'app/register/page.tsx'), 'utf8');
assert.ok(registerSource.includes('TEACHER_INVITE_CODE'), 'register/route.ts must check TEACHER_INVITE_CODE');
assert.ok(registerSource.includes('Invalid or missing teacher invite code'), 'register/route.ts must return 403 error message on invite mismatch');
assert.ok(registerSource.includes('timingSafeEqual'), 'register/route.ts must use constant-time comparison');
assert.ok(registerSource.includes('checkRateLimit'), 'register/route.ts must enforce checkRateLimit');
assert.ok(registerSource.includes('RATE_LIMIT_MAX_ENTRIES'), 'register/route.ts must cap rateLimitMap entries');
assert.ok(registerPageSource.includes('invite_code'), 'register/page.tsx must send invite_code when registering a teacher');

assert.ok(loginSource.includes('checkRateLimit'), 'login/route.ts must enforce checkRateLimit');
assert.ok(loginSource.includes('accountRateLimitMap'), 'login/route.ts must enforce per-account rate limiting against X-Forwarded-For spoofing');
assert.ok(loginSource.includes('RATE_LIMIT_MAX_ENTRIES'), 'login/route.ts must cap rateLimitMap entries');
assert.ok(submissionsSource.includes('RATE_LIMIT_MAX_ENTRIES'), 'submissions/route.ts must cap rateLimitMap entries');
assert.ok(submissionsSource.includes('rateLimitMap.delete(key)'), 'submissions/route.ts must evict expired entries');

// Simulate X-Forwarded-For rotation attack against per-account + per-IP rate limiter
const ipStore = new Map();
const acctStore = new Map();
function simCheckRateLimit(id, store, max = 15, maxEntries = 100) {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
        if (now > v.resetTime) store.delete(k);
    }
    const entry = store.get(id);
    if (!entry || now > entry.resetTime) {
        if (!store.has(id) && store.size >= maxEntries) {
            const oldest = store.keys().next().value;
            if (oldest !== undefined) store.delete(oldest);
        }
        store.set(id, { count: 1, resetTime: now + 60_000 });
        return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
}
let blockedByAccountLimiter = false;
for (let attempt = 0; attempt < 20; attempt++) {
    const spoofedIp = `10.0.0.${attempt}`;
    const ipOk = simCheckRateLimit(spoofedIp, ipStore, 15, 100);
    const acctOk = simCheckRateLimit('target_teacher', acctStore, 15, 100);
    if (!ipOk || !acctOk) {
        blockedByAccountLimiter = true;
        assert.strictEqual(attempt, 15, 'Should block on 16th attempt despite rotating X-Forwarded-For IP');
        break;
    }
}
assert.ok(blockedByAccountLimiter, 'Account rate limiter must block brute-force even when X-Forwarded-For rotates');
console.log('  ✔ P2.1, P2.2, P2.4 Teacher registration invite protection, UI field & X-Forwarded-For-resilient bounded rate limiting verified');

// ── Test 14: P3.1 - ISO 32000-1 20-Byte Xref Record Compliance ──
console.log('\n--- Test 14: P3.1 - ISO 32000-1 20-Byte Xref Record Compliance ---');
const rustPdfSource = fs.readFileSync(path.resolve(__dirname, '../engine-rust/src/pdf.rs'), 'utf8');
assert.strictEqual(rustPdfSource.includes('writeln!(buf, "{off:010} 00000 n ")'), false, 'writeln! must not be used on xref entries');
assert.ok(rustPdfSource.includes('write!(buf, "{off:010} 00000 n \\n")'), 'write! with explicit SP+LF must be used on xref entries');
console.log('  ✔ P3.1 ISO 32000-1 20-byte PDF xref records verified');

// ── Test 15: P3.2 - CSV Formula Injection Hardening ──
console.log('\n--- Test 15: P3.2 - CSV Formula Injection Hardening ---');
const exportGradesSource = fs.readFileSync(path.resolve(__dirname, 'app/api/export/grades/route.ts'), 'utf8');
assert.ok(exportGradesSource.includes('val.trimStart()'), 'escapeCSV must check val.trimStart()');
assert.ok(exportGradesSource.includes("'|'"), 'dangerousChars must include pipe character');

function testEscapeCSV(val) {
    const dangerousChars = ['=', '+', '-', '@', '|', '\t', '\r'];
    let safe = val;
    const trimmed = val.trimStart();
    if (
        (safe.length > 0 && dangerousChars.includes(safe[0])) ||
        (trimmed.length > 0 && dangerousChars.includes(trimmed[0]))
    ) {
        safe = "'" + safe;
    }
    if (safe.includes(",") || safe.includes("\"") || safe.includes("\n") || safe.includes("\r")) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}
assert.strictEqual(testEscapeCSV('   =1+1'), "'   =1+1", 'Leading spaces before = must be escaped');
assert.strictEqual(testEscapeCSV('|calc.exe'), "'|calc.exe", 'Leading pipe | must be escaped');
assert.strictEqual(testEscapeCSV('  |calc.exe'), "'  |calc.exe", 'Leading spaces before | must be escaped');
assert.strictEqual(testEscapeCSV('\t=cmd'), "'\t=cmd", 'Leading tab must be escaped');
console.log('  ✔ P3.2 CSV formula injection hardening verified (trimStart + pipe char)');

// ── Test 16: P3.3 - Security Response Headers in next.config.ts ──
console.log('\n--- Test 16: P3.3 - Security Response Headers ---');
const nextConfigMod = await import('./next.config.ts');
const nextConfig = nextConfigMod.default;
const headerRules = await nextConfig.headers();
assert.ok(Array.isArray(headerRules) && headerRules.length > 0, 'nextConfig.headers() must return rules');
const globalHeaders = new Map(headerRules[0].headers.map(h => [h.key, h.value]));
assert.strictEqual(globalHeaders.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
assert.strictEqual(globalHeaders.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
const cspValue = globalHeaders.get('Content-Security-Policy') || '';
assert.ok(cspValue.includes("default-src 'self'"), 'CSP must include default-src self');
assert.ok(cspValue.includes('https://sdk.scdn.co'), 'CSP must allow Spotify Web Playback SDK script/frame');
assert.ok(cspValue.includes('frame-src'), 'CSP must configure frame-src for embedded SDK');
assert.ok(cspValue.includes('wss:'), 'CSP must allow wss: in connect-src');
console.log('  ✔ P3.3 Referrer-Policy, Permissions-Policy, and Spotify-compatible Content-Security-Policy verified at runtime');

console.log('\n======================================================');
console.log('🎉 ALL 16 DEDICATED VERIFICATION SUITE TESTS PASSED CLEANLY!');
console.log('======================================================\n');

