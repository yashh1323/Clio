import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Import telemetry audit functions
import {
    isStrictlyMonotonic,
    detectPasteEvents,
    auditTelemetrySnapshots,
    getSnapshotTextLength,
} from './lib/telemetry.ts';

// Import auth module functions
import {
    signToken,
    verifyToken,
    SESSION_DURATION_SECONDS,
} from './lib/auth.ts';

console.log('🧪 Starting Phase 2 Core Integrity Hardening Automated Test Suite...\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Proof-of-Write Strict Timestamp Monotonicity
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Test 1: Telemetry Timestamp Monotonicity ---');

// 1.1 Strictly monotonic timestamps pass
const validSnapshots = [
    { timestamp: 1000, html: '<p>H</p>', textLength: 1 },
    { timestamp: 1500, html: '<p>He</p>', textLength: 2 },
    { timestamp: 2000, html: '<p>Hel</p>', textLength: 3 },
    { timestamp: 2500, html: '<p>Hell</p>', textLength: 4 },
    { timestamp: 3000, html: '<p>Hello</p>', textLength: 5 },
];
const check1 = isStrictlyMonotonic(validSnapshots);
assert.strictEqual(check1.monotonic, true, 'Strictly increasing timestamps must pass');
console.log('  ✔ Strictly increasing timestamps verified');

// 1.2 Duplicate/equal timestamps fail (not strictly monotonic)
const duplicateSnapshots = [
    { timestamp: 1000, html: '<p>H</p>', textLength: 1 },
    { timestamp: 1500, html: '<p>He</p>', textLength: 2 },
    { timestamp: 1500, html: '<p>Hel</p>', textLength: 3 },
    { timestamp: 2000, html: '<p>Hell</p>', textLength: 4 },
];
const check2 = isStrictlyMonotonic(duplicateSnapshots);
assert.strictEqual(check2.monotonic, false, 'Duplicate timestamps must fail monotonicity');
assert.strictEqual(check2.violationIndex, 2, 'Violation index should point to duplicate entry');
console.log('  ✔ Duplicate/equal timestamps rejected');

// 1.3 Backwards timestamps fail (clock tampering / out-of-order packet injection)
const backwardsSnapshots = [
    { timestamp: 1000, html: '<p>H</p>', textLength: 1 },
    { timestamp: 2500, html: '<p>He</p>', textLength: 2 },
    { timestamp: 1800, html: '<p>Hel</p>', textLength: 3 },
    { timestamp: 3000, html: '<p>Hell</p>', textLength: 4 },
];
const check3 = isStrictlyMonotonic(backwardsSnapshots);
assert.strictEqual(check3.monotonic, false, 'Backwards timestamps must fail monotonicity');
assert.strictEqual(check3.violationIndex, 2, 'Violation index should point to backwards entry');
console.log('  ✔ Backwards timestamps rejected');

// 1.4 Non-numeric or invalid timestamps fail
const malformedSnapshots = [
    { timestamp: 1000, html: '<p>H</p>', textLength: 1 },
    { timestamp: NaN, html: '<p>He</p>', textLength: 2 },
];
const check4 = isStrictlyMonotonic(malformedSnapshots);
assert.strictEqual(check4.monotonic, false, 'NaN timestamp must fail');
console.log('  ✔ Malformed non-numeric timestamps rejected');

// 1.5 Snapshot text length extraction (HTML tag stripping vs explicit length)
assert.strictEqual(getSnapshotTextLength({ timestamp: 1000, textLength: 25 }), 25);
assert.strictEqual(getSnapshotTextLength({ timestamp: 1000, html: '<p>Hello <b>World</b></p>' }), 11);
assert.strictEqual(
    getSnapshotTextLength({ timestamp: 1000, textLength: 10, html: '<p>' + 'A'.repeat(500) + '</p>' }),
    500,
    'Client spoofed textLength contradicting HTML must be rejected in favor of authoritative HTML length'
);
console.log('  ✔ Snapshot text length extraction verified (including spoofing defense)');


// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Algorithmic Paste Event Detection
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 2: Paste Event Detection ---');

// 2.1 Normal typing should have 0 paste events
const normalTypingSnapshots = [
    { timestamp: 1000, textLength: 0 },
    { timestamp: 1500, textLength: 3 },
    { timestamp: 2000, textLength: 6 },
    { timestamp: 2500, textLength: 10 },
    { timestamp: 3000, textLength: 14 },
];
const normalPastes = detectPasteEvents(normalTypingSnapshots);
assert.strictEqual(normalPastes.length, 0, 'Normal typing should produce 0 paste events');
console.log('  ✔ Normal human typing increments produce 0 paste events');

// 2.2 Initial snapshot with pre-pasted text (> 15 chars) detected as paste
const initialPasteSnapshots = [
    { timestamp: 1000, textLength: 800 },
    { timestamp: 2000, textLength: 805 },
];
const initialPastes = detectPasteEvents(initialPasteSnapshots);
assert.strictEqual(initialPastes.length, 1, 'Initial snapshot with substantial text must be flagged as paste');
assert.strictEqual(initialPastes[0].index, 0);
assert.strictEqual(initialPastes[0].deltaChars, 800);
console.log('  ✔ Pre-pasted text in initial snapshot detected');

// 2.2 Sudden jump of >15 characters in <300ms detected as paste
const rapidPasteSnapshots = [
    { timestamp: 1000, textLength: 10 },
    { timestamp: 1200, textLength: 60 }, // +50 chars in 200ms
];
const rapidPastes = detectPasteEvents(rapidPasteSnapshots);
assert.strictEqual(rapidPastes.length, 1, 'Jump > 15 chars in < 300ms must be flagged as paste');
assert.strictEqual(rapidPastes[0].deltaChars, 50);
assert.strictEqual(rapidPastes[0].deltaMs, 200);
console.log('  ✔ Fast jump (>15 chars in <300ms) detected as paste');

// 2.3 Large block paste (>= 50 chars in <= 2000ms)
const blockPasteSnapshots = [
    { timestamp: 1000, textLength: 5 },
    { timestamp: 2500, textLength: 150 }, // +145 chars in 1500ms
];
const blockPastes = detectPasteEvents(blockPasteSnapshots);
assert.strictEqual(blockPastes.length, 1, 'Block paste >= 50 chars in 1500ms must be flagged');
assert.strictEqual(blockPastes[0].deltaChars, 145);
console.log('  ✔ Large block paste (>=50 chars in <=2s) detected');

// 2.4 Multiple paste events across a session
const multiPasteSnapshots = [
    { timestamp: 1000, textLength: 0 },
    { timestamp: 1200, textLength: 30 }, // Paste 1 (+30 chars in 200ms)
    { timestamp: 2000, textLength: 35 }, // Normal typing
    { timestamp: 2150, textLength: 75 }, // Paste 2 (+40 chars in 150ms)
    { timestamp: 3000, textLength: 80 }, // Normal typing
];
const multiPastes = detectPasteEvents(multiPasteSnapshots);
assert.strictEqual(multiPastes.length, 2, 'Should detect exactly 2 paste events');
console.log('  ✔ Multiple discrete paste events accurately isolated');


// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Verified WPM and Active Typing Time Computation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 3: Verified WPM & Active Typing Time ---');

// 3.1 Consistent human typing WPM calculation
// 100 characters typed over 30 seconds = 20 words in 0.5 min = 40 WPM
const steadyTyping = [];
for (let i = 0; i <= 20; i++) {
    steadyTyping.push({
        timestamp: 10000 + i * 1500, // Every 1.5 seconds
        textLength: i * 5,          // 5 chars every 1.5s (3.33 chars/sec = 40 WPM)
    });
}
const steadyAudit = auditTelemetrySnapshots(steadyTyping, 'a'.repeat(100));
assert.strictEqual(steadyAudit.isValid, true);
assert.strictEqual(steadyAudit.verifiedPasteCount, 0);
assert.strictEqual(steadyAudit.typedCharCount, 100);
// 20 intervals * 1.5s = 30s = 0.5 minutes. 100 chars / 5 = 20 words. 20 words / 0.5 min = 40 WPM
assert.strictEqual(steadyAudit.verifiedWpm, 40, `WPM should be 40, got ${steadyAudit.verifiedWpm}`);
assert.strictEqual(steadyAudit.integrityScore, 100, 'Clean session should have 100 integrity');
assert.strictEqual(steadyAudit.flaggedForReview, false);
console.log('  ✔ Active typing WPM correctly computed from keystroke progression');

// 3.2 Idle time capping: a 10-minute pause should not dilute typing WPM to 0
const idlePauseTyping = [
    { timestamp: 1000, textLength: 0 },
    { timestamp: 3000, textLength: 10 },
    { timestamp: 603000, textLength: 15 }, // 10 minute pause, then +5 chars
    { timestamp: 605000, textLength: 25 },
];
const idleAudit = auditTelemetrySnapshots(idlePauseTyping, 'a'.repeat(25));
// Active time should cap interval at 5000ms instead of 600,000ms
assert(idleAudit.activeTypingTimeMs <= 15000, `Active time should exclude 10 min idle, was ${idleAudit.activeTypingTimeMs}ms`);
console.log('  ✔ Long idle periods (>5s) excluded from active typing time');

// 3.3 Pasted characters are NOT credited toward typed WPM
const pasteWithTyping = [
    { timestamp: 1000, textLength: 0 },
    { timestamp: 1100, textLength: 500 }, // Paste of 500 chars in 100ms
    { timestamp: 2500, textLength: 505 }, // Typed 5 chars
];
const pasteWpmAudit = auditTelemetrySnapshots(pasteWithTyping, 'a'.repeat(505));
assert.strictEqual(pasteWpmAudit.verifiedPasteCount, 1);
assert.strictEqual(pasteWpmAudit.typedCharCount, 5, 'Pasted 500 chars must not count toward typedCharCount');
console.log('  ✔ Pasted character blocks excluded from typed character count');


// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Server-Side Integrity Scoring & Anomaly Penalties
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 4: Server Integrity Scoring & Penalties ---');

// 4.1 Absent telemetry (null, empty array, non-array) penalizes heavily
const absentAudit1 = auditTelemetrySnapshots([], 'Some submitted essay');
assert.strictEqual(absentAudit1.isValid, false);
assert.strictEqual(absentAudit1.flaggedForReview, true);
assert(absentAudit1.integrityScore < 50, 'Absent telemetry must yield score < 50');

const absentAudit2 = auditTelemetrySnapshots(null, 'Essay');
assert.strictEqual(absentAudit2.isValid, false);
assert.strictEqual(absentAudit2.flaggedForReview, true);
console.log('  ✔ Completely absent telemetry penalized and flagged for review');

// 4.2 Non-monotonic timestamps (tampered snapshots) penalize heavily
const tamperedAudit = auditTelemetrySnapshots([
    { timestamp: 5000, textLength: 10 },
    { timestamp: 4000, textLength: 20 },
], 'Essay');
assert.strictEqual(tamperedAudit.isValid, false);
assert.strictEqual(tamperedAudit.flaggedForReview, true);
assert(tamperedAudit.integrityScore <= 30, 'Tampered timestamps must yield severe penalty');
console.log('  ✔ Non-monotonic timestamp tampering penalized and flagged');

// 4.3 High paste penalties (score decreases per paste)
const singlePasteAudit = auditTelemetrySnapshots([
    { timestamp: 1000, textLength: 0 },
    { timestamp: 1150, textLength: 40 }, // 1 paste
    { timestamp: 5000, textLength: 50 }, // 10 chars typed
], 'a'.repeat(50));
assert.strictEqual(singlePasteAudit.verifiedPasteCount, 1);
assert.strictEqual(singlePasteAudit.integrityScore, 85, '1 paste should deduct 15 points (100 - 15 = 85)');

// 4.4 Untracked trailing text (injected directly before submission)
const trailingInjectionAudit = auditTelemetrySnapshots([
    { timestamp: 1000, textLength: 0 },
    { timestamp: 3000, textLength: 10 },
], 'a'.repeat(150)); // Last snapshot was 10 chars, but final submission has 150 chars!
assert(trailingInjectionAudit.verifiedPasteCount >= 1, 'Trailing injection must be detected as paste');
console.log('  ✔ Untracked submission-time text injection detected and penalized');

// 4.5 Massive paste & low typed ratio penalty (e.g. 1500 chars pasted, 10 typed)
const massivePasteAudit = auditTelemetrySnapshots([
    { timestamp: 1000, textLength: 1500 },
    { timestamp: 2000, textLength: 1510 },
], 'a'.repeat(1510));
assert.strictEqual(massivePasteAudit.flaggedForReview, true, 'Massive paste must be flagged for review');
assert(massivePasteAudit.integrityScore <= 40, `Massive paste must yield severe penalty <= 40, got ${massivePasteAudit.integrityScore}`);
console.log('  ✔ Massive block paste & low typing ratio severely penalized and flagged');


// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Session Token Cryptographic Expiration (lib/auth & Edge Middleware)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 5: Session Token Expiration & Claims ---');

// 5.1 signToken generates exp, iat, and jti claims
const validPayload = { username: 'student_alice', role: 'student' };
const token = signToken(validPayload);
assert(token.includes('.'), 'Token must be data.signature format');

const [dataB64] = token.split('.');
const decodedPayload = JSON.parse(Buffer.from(dataB64, 'base64url').toString());

assert.strictEqual(decodedPayload.username, 'student_alice');
assert.strictEqual(decodedPayload.role, 'student');
assert(typeof decodedPayload.exp === 'number', 'exp claim must be a number');
assert(typeof decodedPayload.iat === 'number', 'iat claim must be a number');
assert(typeof decodedPayload.jti === 'string', 'jti claim must be a string');
assert(decodedPayload.exp > decodedPayload.iat, 'exp must be after iat');
assert.strictEqual(decodedPayload.exp - decodedPayload.iat, SESSION_DURATION_SECONDS, 'Default exp should be 8 hours');
console.log('  ✔ signToken generates valid exp, iat, and jti claims');

// 5.2 verifyToken accepts active unexpired token
const verified = verifyToken(token);
assert(verified !== null, 'Valid unexpired token must verify');
assert.strictEqual(verified.username, 'student_alice');
assert.strictEqual(verified.role, 'student');
console.log('  ✔ verifyToken successfully validates active unexpired session');

// 5.3 verifyToken strictly rejects expired token
const expiredToken = signToken(validPayload, -60); // Expired 60s ago
const verifiedExpired = verifyToken(expiredToken);
assert.strictEqual(verifiedExpired, null, 'Expired token must return null');
console.log('  ✔ verifyToken strictly rejects expired token (fails closed)');

// 5.4 verifyToken strictly rejects token with missing exp claim
const noExpPayload = { username: 'attacker', role: 'admin' };
const secret = 'clio-dev-secret-DO-NOT-USE-IN-PROD';
const noExpData = Buffer.from(JSON.stringify(noExpPayload)).toString('base64url');
const noExpSig = crypto.createHmac('sha256', secret).update(noExpData).digest('base64url');
const tokenWithoutExp = `${noExpData}.${noExpSig}`;
assert.strictEqual(verifyToken(tokenWithoutExp), null, 'Token missing exp claim must be rejected');
console.log('  ✔ verifyToken strictly rejects token missing exp claim');

// 5.5 signToken ignores user-injected exp claim and enforces authoritative expiration
const spoofExpPayload = { username: 'attacker', role: 'student', exp: 9999999999 };
const signedSpoof = signToken(spoofExpPayload);
const decodedSpoof = JSON.parse(Buffer.from(signedSpoof.split('.')[0], 'base64url').toString());
assert(decodedSpoof.exp < 9999999999, 'signToken must overwrite user-supplied exp claim');
assert.strictEqual(decodedSpoof.exp - decodedSpoof.iat, SESSION_DURATION_SECONDS);
console.log('  ✔ signToken strictly enforces expiration against user payload override');

// 5.5 Edge Middleware WebCrypto expiration verification simulation
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function verifyEdgeTokenSignature(tokenStr) {
    const parts = tokenStr.split(".");
    if (parts.length !== 2) return null;
    const [d, s] = parts;
    try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );
        const sigBytes = base64UrlDecode(s);
        const dBytes = encoder.encode(d);
        const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, dBytes);
        if (!isValid) return null;

        const payloadJson = new TextDecoder().decode(base64UrlDecode(d));
        const payload = JSON.parse(payloadJson);
        if (payload && typeof payload.role === "string" && payload.role.length > 0) {
            const now = Math.floor(Date.now() / 1000);
            if (typeof payload.exp !== "number" || payload.exp <= now) {
                return null; // Expired
            }
            return payload.role;
        }
        return null;
    } catch {
        return null;
    }
}

const edgeActiveRole = await verifyEdgeTokenSignature(token);
assert.strictEqual(edgeActiveRole, 'student', 'Edge verification must accept active token');

const edgeExpiredRole = await verifyEdgeTokenSignature(expiredToken);
assert.strictEqual(edgeExpiredRole, null, 'Edge verification must reject expired token');

const edgeNoExpRole = await verifyEdgeTokenSignature(tokenWithoutExp);
assert.strictEqual(edgeNoExpRole, null, 'Edge verification must reject token without exp claim');

console.log('  ✔ Edge WebCrypto verification validates expiration and fails closed');


// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Similarity Dashboard & Submission Query Integration
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 6: Similarity Dashboard & Route Verification ---');

// 6.1 Check frontend/app/similarity/page.tsx for direct route usage
const frontendDir = import.meta.dirname || path.resolve('./frontend');
const similarityPagePath = fs.existsSync(path.join(frontendDir, 'app/similarity/page.tsx'))
    ? path.join(frontendDir, 'app/similarity/page.tsx')
    : path.resolve('./app/similarity/page.tsx');
const similarityPageSource = fs.readFileSync(similarityPagePath, 'utf8');
assert(
    similarityPageSource.includes('fetch(`/api/submissions/${pair.submission1.id}`'),
    'similarity/page.tsx must fetch submission1 via /api/submissions/${id}'
);
assert(
    similarityPageSource.includes('fetch(`/api/submissions/${pair.submission2.id}`'),
    'similarity/page.tsx must fetch submission2 via /api/submissions/${id}'
);
console.log('  ✔ similarity/page.tsx updated to query direct /api/submissions/${id}');

// 6.2 Check frontend/app/api/submissions/route.ts handles query parameter 'id'
const submissionsRoutePath = fs.existsSync(path.join(frontendDir, 'app/api/submissions/route.ts'))
    ? path.join(frontendDir, 'app/api/submissions/route.ts')
    : path.resolve('./app/api/submissions/route.ts');
const submissionsRouteSource = fs.readFileSync(submissionsRoutePath, 'utf8');
assert(
    submissionsRouteSource.includes('req.nextUrl.searchParams.get("id")'),
    'submissions/route.ts must support ?id= query parameter filter'
);
assert(
    submissionsRouteSource.includes('auditTelemetrySnapshots'),
    'submissions/route.ts must invoke auditTelemetrySnapshots for server-side verification'
);
console.log('  ✔ submissions/route.ts supports ?id= query param with content');
console.log('  ✔ submissions/route.ts wires server-side proof-of-write verification');

console.log('\n======================================================');
console.log('🎉 ALL PHASE 2 CORE INTEGRITY & ROBUSTNESS TESTS PASSED!');
console.log('======================================================');
