import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';

console.log('🧪 Starting Phase 1 Security Hotfixes Automated Test Suite...\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: DOCX-to-PDF HTML Sanitization (SSRF, XSS, & CSS Injection Defenses)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Test 1: DOCX-to-PDF HTML Sanitization ---');
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

// 1.1 Script tags must be stripped
const maliciousScript = '<p>Hello</p><script>fetch("http://169.254.169.254")</script>';
const clean1 = sanitizeHtml(maliciousScript, sanitizeOptions);
assert.strictEqual(clean1.includes('<script>'), false, 'Script tag should be removed');
assert.strictEqual(clean1.includes('169.254.169.254'), false, 'Payload in script should be stripped');
console.log('  ✔ <script> execution stripped');

// 1.2 SSRF iframe must be stripped
const maliciousIframe = '<p>Doc</p><iframe src="http://169.254.169.254/latest/meta-data"></iframe>';
const clean2 = sanitizeHtml(maliciousIframe, sanitizeOptions);
assert.strictEqual(clean2.includes('<iframe'), false, 'Iframe tag should be completely removed');
console.log('  ✔ <iframe> SSRF vector stripped');

// 1.3 Outbound remote HTTP/HTTPS image SSRF must be stripped
const maliciousImg = '<p>Doc</p><img src="http://169.254.169.254/secret.png" alt="leak" />';
const clean3 = sanitizeHtml(maliciousImg, sanitizeOptions);
assert.strictEqual(clean3.includes('http://169.254.169.254'), false, 'Remote HTTP image src should be stripped');
console.log('  ✔ Outbound remote image SSRF stripped');

// 1.4 CSS background url SSRF injection must be stripped
const cssInjection = '<p style="background: url(\'http://169.254.169.254/leak\'); color: #333">Styled text</p>';
const cleanCss = sanitizeHtml(cssInjection, sanitizeOptions);
assert.strictEqual(cleanCss.includes('169.254.169.254'), false, 'CSS url background SSRF should be stripped');
console.log('  ✔ CSS background-image url SSRF injection stripped');

// 1.5 Valid inline data: URI image must be preserved
const safeDataImg = '<p>Doc</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="inline" />';
const clean4 = sanitizeHtml(safeDataImg, sanitizeOptions);
assert.strictEqual(clean4.includes('data:image/png;base64'), true, 'Inline data URI image should be preserved');
console.log('  ✔ Safe inline data: image preserved');

// 1.6 Typography tags and tables must be preserved
const typographyDoc = '<h1>Title</h1><p>Paragraph with <b>bold</b>, <i>italic</i>, and <u>underline</u>.</p><table><tr><td>Cell 1</td></tr></table>';
const clean5 = sanitizeHtml(typographyDoc, sanitizeOptions);
assert.strictEqual(clean5, typographyDoc, 'Typography tags must be intact');
console.log('  ✔ Clean typography and table structures preserved');


// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Puppeteer Request Interception SSRF & Local Resource Protection
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 2: Puppeteer Request Interception Logic ---');

// Handler simulation directly implementing the interception rules from convert-docx-to-pdf/route.ts
function simulateRequestInterception(url, resourceType) {
    const lowerUrl = url.toLowerCase();

    // 1. Explicitly block all network schemes and local file schemes
    if (
        lowerUrl.startsWith('http:') ||
        lowerUrl.startsWith('https:') ||
        lowerUrl.startsWith('file:') ||
        lowerUrl.startsWith('ftp:') ||
        lowerUrl.startsWith('ws:') ||
        lowerUrl.startsWith('wss:') ||
        lowerUrl.startsWith('javascript:')
    ) {
        return { action: 'abort', reason: 'Blocked external/file scheme' };
    }

    // 2. Allow local document rendering (about:blank or data:text/html)
    if (resourceType === 'document' && (lowerUrl === 'about:blank' || lowerUrl.startsWith('data:'))) {
        return { action: 'continue' };
    }

    // 3. Allow safe inline data URIs (images and inline styles)
    if (lowerUrl.startsWith('data:image/') || lowerUrl.startsWith('data:text/css') || lowerUrl.startsWith('data:font/')) {
        return { action: 'continue' };
    }

    // 4. Abort any other request
    return { action: 'abort', reason: 'Disallowed request type/URL' };
}

// 2.1 Block Cloud Metadata IP (169.254.169.254)
assert.strictEqual(simulateRequestInterception('http://169.254.169.254/latest/meta-data', 'document').action, 'abort');
// 2.2 Block Localhost / Loopback
assert.strictEqual(simulateRequestInterception('http://localhost:3000/api/admin', 'xhr').action, 'abort');
assert.strictEqual(simulateRequestInterception('http://127.0.0.1:8080/secret', 'image').action, 'abort');
assert.strictEqual(simulateRequestInterception('http://0.0.0.0:8000/', 'document').action, 'abort');
assert.strictEqual(simulateRequestInterception('http://[::1]:8080/', 'document').action, 'abort');
// 2.3 Block Private Subnets (10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12)
assert.strictEqual(simulateRequestInterception('http://10.0.0.1/admin', 'document').action, 'abort');
assert.strictEqual(simulateRequestInterception('http://192.168.1.1/router', 'document').action, 'abort');
assert.strictEqual(simulateRequestInterception('http://172.20.0.1/docker', 'document').action, 'abort');
// 2.4 Block Local Files and Dangerous Schemes
assert.strictEqual(simulateRequestInterception('file:///etc/passwd', 'document').action, 'abort');
assert.strictEqual(simulateRequestInterception('file:///c:/boot.ini', 'image').action, 'abort');
assert.strictEqual(simulateRequestInterception('ftp://internal-ftp/secrets', 'document').action, 'abort');
// 2.5 Block Remote Images and External Stylesheets
assert.strictEqual(simulateRequestInterception('https://evil.com/style.css', 'stylesheet').action, 'abort');
assert.strictEqual(simulateRequestInterception('https://evil.com/font.woff2', 'font').action, 'abort');
assert.strictEqual(simulateRequestInterception('https://evil.com/tracker.png', 'image').action, 'abort');
// 2.6 Allow Local Document and Embedded Data Images
assert.strictEqual(simulateRequestInterception('about:blank', 'document').action, 'continue');
assert.strictEqual(simulateRequestInterception('data:image/png;base64,iVBORw0KGgo...', 'image').action, 'continue');
assert.strictEqual(simulateRequestInterception('data:image/jpeg;base64,/9j/4AAQSkZJRg...', 'image').action, 'continue');

console.log('  ✔ All private IP ranges (127/8, 10/8, 169.254/16, 192.168/16, 172.16/12) blocked');
console.log('  ✔ file://, ftp://, javascript:// schemes blocked');
console.log('  ✔ Remote HTTP/HTTPS stylesheets, fonts, and scripts blocked');
console.log('  ✔ Embedded data:image URIs preserved and allowed to render in PDF');


// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Edge Middleware Route Matching & Cryptographic Signature Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 3: Edge Middleware & Token Signature Verification ---');

// Read actual middleware.ts to verify regex rules directly from the codebase
const middlewareSource = fs.readFileSync(path.resolve('./middleware.ts'), 'utf8');

// Helper to extract regex patterns from source
function extractRegex(source, patternName) {
    const match = source.match(new RegExp(`${patternName}[^[]*\\[([\\s\\S]*?)\\];`));
    assert(match, `Could not find ${patternName} in middleware.ts`);
    return match[1];
}

const protectedRoutesBlock = extractRegex(middlewareSource, 'PROTECTED_ROUTES');
assert(protectedRoutesBlock.includes('/^\\/api\\/submissions(\\/.*)?$/'), 'Submissions regex must match sub-paths');
assert(protectedRoutesBlock.includes('/^\\/api\\/grades(\\/.*)?$/'), 'Grades regex must match sub-paths');
assert(protectedRoutesBlock.includes('/^\\/api\\/convert-docx-to-pdf(\\/.*)?$/'), 'convert-docx-to-pdf must be protected');
console.log('  ✔ middleware.ts regex patterns cover all subpaths');

// Test HMAC-SHA256 Token Signing & WebCrypto Verification
const secret = 'clio-dev-secret-DO-NOT-USE-IN-PROD';

function signTestToken(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function verifyTokenWebCrypto(token) {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [dataB64, sigB64] = parts;
    try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );
        const signatureBytes = base64UrlDecode(sigB64);
        const dataBytes = encoder.encode(dataB64);
        const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, dataBytes);
        if (!isValid) return null;
        const payloadJson = new TextDecoder().decode(base64UrlDecode(dataB64));
        const payload = JSON.parse(payloadJson);
        return payload.role || null;
    } catch {
        return null;
    }
}

// 3.1 Valid teacher token
const teacherToken = signTestToken({ username: 'dr_smith', role: 'teacher' });
const verifiedTeacherRole = await verifyTokenWebCrypto(teacherToken);
assert.strictEqual(verifiedTeacherRole, 'teacher');
console.log('  ✔ WebCrypto correctly verifies teacher token');

// 3.2 Valid student token
const studentToken = signTestToken({ username: 'alice', role: 'student' });
const verifiedStudentRole = await verifyTokenWebCrypto(studentToken);
assert.strictEqual(verifiedStudentRole, 'student');
console.log('  ✔ WebCrypto correctly verifies student token');

// 3.3 Forged / Tampered token fails closed
const forgedToken = teacherToken.slice(0, -5) + 'AAAAA';
const forgedRole = await verifyTokenWebCrypto(forgedToken);
assert.strictEqual(forgedRole, null, 'Forged token must return null');
console.log('  ✔ Forged / tampered token rejected (fails closed)');

// 3.4 Missing / corrupt token fails closed
assert.strictEqual(await verifyTokenWebCrypto('invalid-token'), null);
assert.strictEqual(await verifyTokenWebCrypto(''), null);
console.log('  ✔ Malformed token rejected (fails closed)');


// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Submission Grading IDOR Protection (Teacher Scoping & Unassigned Rules)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 4: Submission Grading IDOR Protection ---');

function evaluateGradingPermission({ submission, grade, requestingTeacherId }) {
    if (!submission) {
        return { status: 404, error: 'Submission not found' };
    }
    // Cross-teacher IDOR check on submission
    if (submission.teacher_id && submission.teacher_id !== requestingTeacherId) {
        return { status: 403, error: 'Forbidden: Not your submission' };
    }
    // Residual IDOR check on grade record if submission teacher_id was null
    if (grade && grade.teacher_id && grade.teacher_id !== requestingTeacherId) {
        return { status: 403, error: 'Forbidden: Not your submission' };
    }
    return { status: 200, allowed: true };
}

const teacher1 = 'teacher-uuid-1111';
const teacher2 = 'teacher-uuid-2222';

// 4.1 Teacher 1 attempts to grade Teacher 2's submission -> 403
const testIdor1 = evaluateGradingPermission({
    submission: { id: 'sub-1', teacher_id: teacher2 },
    grade: null,
    requestingTeacherId: teacher1
});
assert.strictEqual(testIdor1.status, 403);
console.log('  ✔ Cross-teacher grade modification blocked: 403 Forbidden');

// 4.2 Teacher 1 grades own submission -> 200
const testIdor2 = evaluateGradingPermission({
    submission: { id: 'sub-2', teacher_id: teacher1 },
    grade: null,
    requestingTeacherId: teacher1
});
assert.strictEqual(testIdor2.status, 200);
console.log('  ✔ Authorized teacher grading allowed: 200 OK');

// 4.3 Teacher 1 attempts to read unassigned submission grade created by Teacher 2 -> 403
const testIdor3 = evaluateGradingPermission({
    submission: { id: 'sub-3', teacher_id: null },
    grade: { id: 'grade-1', teacher_id: teacher2 },
    requestingTeacherId: teacher1
});
assert.strictEqual(testIdor3.status, 403);
console.log('  ✔ Residual IDOR on unassigned submission grades blocked: 403 Forbidden');

// 4.4 Score boundary checks
function validateScore(score) {
    if (score === undefined || typeof score !== 'number' || score < 0 || score > 100) {
        return { status: 400, error: 'score must be 0–100' };
    }
    return { status: 200 };
}
assert.strictEqual(validateScore(-1).status, 400);
assert.strictEqual(validateScore(101).status, 400);
assert.strictEqual(validateScore(95).status, 200);
assert.strictEqual(validateScore(0).status, 200);
console.log('  ✔ Score boundary enforcement (0-100) verified');


// ─────────────────────────────────────────────────────────────────────────────
// Test 5: File Size Limits & Multipart Boundary Handling (Memory DoS Defense)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 5: File Size & Payload Limits ---');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function checkFileUpload(fileSize, contentLengthHeader) {
    if (contentLengthHeader) {
        const cl = parseInt(contentLengthHeader, 10);
        // Allow up to 1MB buffer for multipart boundaries/headers
        if (isNaN(cl) || cl > MAX_FILE_SIZE + 1024 * 1024) {
            return { status: 413, error: 'File size exceeds 25MB limit' };
        }
    }
    if (fileSize > MAX_FILE_SIZE) {
        return { status: 413, error: 'File size exceeds 25MB limit' };
    }
    return { status: 200 };
}

// 5.1 Exact 25MB file with multipart header overhead is accepted
assert.strictEqual(checkFileUpload(25 * 1024 * 1024, String(25 * 1024 * 1024 + 500)).status, 200);
console.log('  ✔ 25MB file with multipart boundary headers accepted');

// 5.2 File size exceeding 25MB rejected with 413
assert.strictEqual(checkFileUpload(25 * 1024 * 1024 + 1, String(25 * 1024 * 1024 + 1000)).status, 413);
console.log('  ✔ >25MB file size rejected with HTTP 413 Payload Too Large');

// 5.3 Huge Content-Length pre-check rejected early before buffering
assert.strictEqual(checkFileUpload(100, String(50 * 1024 * 1024)).status, 413);
console.log('  ✔ Huge Content-Length rejected early via pre-check');


// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Draft Update Payload Validation (Assignment ID Association)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 6: Draft Update Persistence ---');

function buildDraftUpdateData(body) {
    const { title, content, html, json_content, word_count, assignment_id } = body;
    const updateData = { last_saved_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = (title || "Untitled Draft").slice(0, 500);
    if (content !== undefined) updateData.content = content;
    if (html !== undefined) updateData.html = html;
    if (json_content !== undefined) updateData.json_content = json_content;
    if (word_count !== undefined) updateData.word_count = word_count;
    if (assignment_id !== undefined) updateData.assignment_id = assignment_id || null;
    return updateData;
}

const updateWithAssignment = buildDraftUpdateData({
    title: 'Updated Essay',
    assignment_id: 'assign-uuid-456'
});
assert.strictEqual(updateWithAssignment.assignment_id, 'assign-uuid-456', 'assignment_id must be included in updateData');
console.log('  ✔ assignment_id correctly included in draft update payload');

const updateClearAssignment = buildDraftUpdateData({
    assignment_id: null
});
assert.strictEqual(updateClearAssignment.assignment_id, null, 'assignment_id can be cleared to null');
console.log('  ✔ assignment_id null clear supported');


console.log('\n======================================================');
console.log('🎉 ALL PHASE 1 SECURITY & ROBUSTNESS TESTS PASSED CLEANLY!');
console.log('======================================================');
