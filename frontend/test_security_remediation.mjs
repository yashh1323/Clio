import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Starting Security Audit Remediation Verification Suite...\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Teacher Registration Gate Fail-Closed Logic Simulation
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Test 1: Teacher Registration Gate Fail-Closed Logic ---');

function evaluateTeacherGate({ role, invite_code, envInviteCode }) {
    const expectedInviteCode = (envInviteCode || "").trim();
    if (role === "teacher") {
        if (!expectedInviteCode) {
            return {
                status: 403,
                error: "Teacher registration is disabled: faculty invite code not configured",
            };
        }
        const providedCode = typeof invite_code === "string" ? invite_code.trim() : "";
        const expectedBuf = Buffer.from(expectedInviteCode, "utf8");
        const providedBuf = Buffer.from(providedCode, "utf8");
        const inviteMatches =
            expectedBuf.length === providedBuf.length &&
            crypto.timingSafeEqual(expectedBuf, providedBuf);
        if (!inviteMatches) {
            return {
                status: 403,
                error: "Invalid or missing teacher invite code",
            };
        }
    }
    return { status: 200, ok: true };
}

// 1.1 Unset / empty env var with teacher role -> FAILS CLOSED (403)
const resUnsetNoCode = evaluateTeacherGate({ role: "teacher", invite_code: "", envInviteCode: "" });
assert.strictEqual(resUnsetNoCode.status, 403);
assert.strictEqual(resUnsetNoCode.error, "Teacher registration is disabled: faculty invite code not configured");
console.log('  ✔ Unset TEACHER_INVITE_CODE fails closed with HTTP 403');

const resUnsetWithCode = evaluateTeacherGate({ role: "teacher", invite_code: "guess123", envInviteCode: "" });
assert.strictEqual(resUnsetWithCode.status, 403);
console.log('  ✔ Unset TEACHER_INVITE_CODE rejects arbitrary codes with HTTP 403');

// 1.2 Configured env var with missing / wrong invite code -> FAILS (403)
const resConfiguredNoCode = evaluateTeacherGate({ role: "teacher", invite_code: "", envInviteCode: "CLIO-FACULTY-2026" });
assert.strictEqual(resConfiguredNoCode.status, 403);
assert.strictEqual(resConfiguredNoCode.error, "Invalid or missing teacher invite code");
console.log('  ✔ Configured TEACHER_INVITE_CODE rejects missing code with HTTP 403');

const resConfiguredWrongCode = evaluateTeacherGate({ role: "teacher", invite_code: "wrong-code", envInviteCode: "CLIO-FACULTY-2026" });
assert.strictEqual(resConfiguredWrongCode.status, 403);
assert.strictEqual(resConfiguredWrongCode.error, "Invalid or missing teacher invite code");
console.log('  ✔ Configured TEACHER_INVITE_CODE rejects invalid code with HTTP 403');

// 1.3 Configured env var with valid invite code -> SUCCEEDS (200)
const resConfiguredValid = evaluateTeacherGate({ role: "teacher", invite_code: "CLIO-FACULTY-2026", envInviteCode: "CLIO-FACULTY-2026" });
assert.strictEqual(resConfiguredValid.status, 200);
console.log('  ✔ Configured TEACHER_INVITE_CODE accepts matching code with HTTP 200');

// 1.4 Student role -> Bypasses teacher gate
const resStudent = evaluateTeacherGate({ role: "student", invite_code: undefined, envInviteCode: "" });
assert.strictEqual(resStudent.status, 200);
console.log('  ✔ Student registration unaffected by teacher gate');


// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Source File Verification for Teacher Registration
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 2: Source File Verification (register/route.ts) ---');
const registerSource = fs.readFileSync(path.resolve(__dirname, 'app/api/auth/register/route.ts'), 'utf8');

assert.ok(registerSource.includes('Teacher registration is disabled: faculty invite code not configured'), 'Must fail closed when expectedInviteCode is missing');
assert.ok(registerSource.includes('Invalid or missing teacher invite code'), 'Must reject invalid invite codes');
assert.ok(registerSource.includes('crypto.timingSafeEqual'), 'Must use constant-time comparison for invite code');
assert.strictEqual(registerSource.includes('expectedInviteCode.length > 0'), false, 'Old fail-open condition must be removed');
console.log('  ✔ register/route.ts verifies fail-closed gate without fail-open condition');


// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Docker Compose Hardening Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 3: Docker Compose Hardening ---');
const composePath = path.resolve(__dirname, '../docker-compose.yml');
const composeYaml = fs.readFileSync(composePath, 'utf8');

assert.ok(composeYaml.includes('127.0.0.1:8088:8088'), 'Engine port 8088 must be bound strictly to 127.0.0.1 loopback');
assert.ok(composeYaml.includes('CLIO_ENGINE_KEY=${CLIO_ENGINE_KEY:-clio-engine-dev-secret-key-2026}'), 'Must specify default dev engine key');
console.log('  ✔ docker-compose.yml binds engine to 127.0.0.1 and sets default engine key');


// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Rust Engine Security Logic Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 4: Rust Engine Source Verification ---');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../engine-rust/src/main.rs'), 'utf8');
const apiSource = fs.readFileSync(path.resolve(__dirname, '../engine-rust/src/api.rs'), 'utf8');

assert.ok(mainSource.includes('SECURITY ALERT: Clio Engine is listening on non-loopback host'), 'main.rs must issue warning if listening on non-loopback without key');
assert.ok(apiSource.includes('CLIO_ENGINE_REQUIRE_KEY'), 'api.rs must support CLIO_ENGINE_REQUIRE_KEY policy');
assert.ok(apiSource.includes('validate_engine_key'), 'api.rs must implement validate_engine_key middleware');
console.log('  ✔ engine-rust source confirms startup security warning and policy checks');


// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Local Environment Alignment (.env.local)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Test 5: Local Environment Alignment (.env.local) ---');
const envPath = path.resolve(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

assert.ok(envContent.includes('CLIO_ENGINE_KEY=clio-engine-dev-secret-key-2026'), '.env.local must define CLIO_ENGINE_KEY');
assert.ok(envContent.includes('TEACHER_INVITE_CODE=CLIO-FACULTY-2026'), '.env.local must define TEACHER_INVITE_CODE');
console.log('  ✔ .env.local defines both CLIO_ENGINE_KEY and TEACHER_INVITE_CODE');

console.log('\n======================================================');
console.log('🎉 ALL SECURITY REMEDIATION VERIFICATION TESTS PASSED!');
console.log('======================================================\n');
