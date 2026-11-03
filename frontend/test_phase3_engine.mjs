import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    auditTelemetryWithEngine,
    analyzeSimilarityWithEngine,
    checkEngineHealth,
    renderPdfWithEngine,
} from './lib/engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Starting Phase 3 High-Performance Rust Engine & Strangler Fig Automated Test Suite...\n');

// ── Test 1: Graceful Fallback When Unconfigured ──
console.log('--- Test 1: Graceful Fallback When Unconfigured ---');
delete process.env.CLIO_ENGINE_URL;

const steadyTyping = [];
for (let i = 0; i < 20; i++) {
    steadyTyping.push({
        timestamp: 1000 + i * 1000,
        textLength: (i + 1) * 5,
    });
}

const unconfigAudit = await auditTelemetryWithEngine(steadyTyping, 'a'.repeat(100));
assert.strictEqual(unconfigAudit.isValid, true, 'Unconfigured audit must be valid');
assert.strictEqual(unconfigAudit.flaggedForReview, false, 'Steady typing must not be flagged');
assert.ok(unconfigAudit.integrityScore >= 90, 'Steady typing must maintain high integrity');
console.log('  ✔ Telemetry audit gracefully falls back to TypeScript when CLIO_ENGINE_URL is unset');

const sampleSubmissions = [
    {
        id: 's1',
        assignment: 'Assignment 1',
        student: 'Student Alpha',
        username: 'alpha',
        content: 'The Industrial Revolution marked a period of rapid technological and societal change, transforming rural manufacturing through steam power, mechanized looms, and iron factories across eighteenth-century England.',
    },
    {
        id: 's2',
        assignment: 'Assignment 1',
        student: 'Student Beta',
        username: 'beta',
        content: 'The Industrial Revolution marked a period of rapid technological and societal change, transforming rural manufacturing through steam power, mechanized looms, and iron factories across eighteenth-century England.',
    },
];

const unconfigSimilarity = await analyzeSimilarityWithEngine(sampleSubmissions, 25);
assert.strictEqual(unconfigSimilarity.pairs.length, 1, 'Should find 1 high similarity pair in fallback');
assert.strictEqual(unconfigSimilarity.pairs[0].similarity, 100, 'Identical submissions must be 100% similar');
assert.strictEqual(unconfigSimilarity.method, 'local_typescript', 'Method must indicate local fallback');
console.log('  ✔ Similarity analysis gracefully falls back to TypeScript when CLIO_ENGINE_URL is unset');

// ── Test 2: Graceful Fallback When Engine Unreachable ──
console.log('\n--- Test 2: Graceful Fallback When Engine Unreachable ---');
process.env.CLIO_ENGINE_URL = 'http://127.0.0.1:59999'; // Dead port

const offlineHealth = await checkEngineHealth();
assert.strictEqual(offlineHealth.ok, false, 'Health check on offline port must return ok=false');
console.log('  ✔ checkEngineHealth returns ok=false without throwing when engine is down');

const offlineAudit = await auditTelemetryWithEngine(steadyTyping, 'a'.repeat(100));
assert.strictEqual(offlineAudit.isValid, true, 'Audit must gracefully fallback on network error');
assert.strictEqual(offlineAudit.totalSnapshots, 20, 'Audit must process all snapshots');
console.log('  ✔ Telemetry audit catches network error and seamlessly falls back');

const offlineSimilarity = await analyzeSimilarityWithEngine(sampleSubmissions, 25);
assert.strictEqual(offlineSimilarity.pairs.length, 1, 'Similarity must gracefully fallback on network error');
assert.strictEqual(offlineSimilarity.method, 'local_typescript', 'Method must indicate local fallback');
console.log('  ✔ Similarity analysis catches network error and seamlessly falls back');

// ── Test 3: Live Engine Integration ──
console.log('\n--- Test 3: Live Rust Engine Integration ---');

const testPort = '18081';
const candidates = [
    path.resolve(__dirname, '../engine-rust/target/release/clio-engine.exe'),
    path.resolve(__dirname, '../engine-rust/target/debug/clio-engine.exe'),
    path.resolve(__dirname, '../engine-rust/target/release/clio-engine'),
    path.resolve(__dirname, '../engine-rust/target/debug/clio-engine'),
    path.resolve(__dirname, '../engine/clio-engine.exe'),
];
const engineExe = candidates.find(c => fs.existsSync(c)) || candidates[0];

const engineProcess = spawn(engineExe, [], {
    env: { ...process.env, PORT: testPort, CLIO_ENGINE_HOST: '127.0.0.1' },
    stdio: 'ignore',
});

// Wait up to 5 seconds for engine to bind to port
let engineOnline = false;
for (let attempt = 0; attempt < 25; attempt++) {
    try {
        const res = await fetch(`http://127.0.0.1:${testPort}/health`);
        if (res.ok) {
            engineOnline = true;
            break;
        }
    } catch {
        // Retry
    }
    await new Promise(r => setTimeout(r, 200));
}

assert.ok(engineOnline, 'Engine binary failed to start or respond on port ' + testPort);
console.log(`  ✔ Clio High-Performance Engine started cleanly on port ${testPort}`);

try {
    process.env.CLIO_ENGINE_URL = `http://127.0.0.1:${testPort}`;

    // Health check
    const liveHealth = await checkEngineHealth();
    assert.strictEqual(liveHealth.ok, true, 'Engine health check must succeed');
    assert.strictEqual(liveHealth.data.service, 'clio-engine', 'Engine service name must match');
    assert.strictEqual(liveHealth.data.status, 'ok', 'Engine status must be ok');
    console.log('  ✔ Live /health endpoint verified via high-performance engine');

    // Metrics check
    const metricsRes = await fetch(`http://127.0.0.1:${testPort}/metrics`);
    assert.strictEqual(metricsRes.status, 200, 'Metrics endpoint must return 200 OK');
    const metricsData = await metricsRes.json();
    assert.ok(typeof metricsData.telemetry_audits_total === 'number', 'Metrics must report audit count');
    console.log('  ✔ Live /metrics endpoint verified via high-performance engine');

    // Telemetry Audit via Engine
    const liveAudit = await auditTelemetryWithEngine(steadyTyping, 'a'.repeat(100));
    assert.strictEqual(liveAudit.isValid, true, 'Live audit must be valid');
    assert.strictEqual(liveAudit.flaggedForReview, false, 'Steady typing must not be flagged');
    assert.ok(liveAudit.integrityScore >= 90, 'Steady typing must maintain high integrity');
    assert.strictEqual(liveAudit.verifiedPasteCount, 0, 'No paste events expected in steady typing');
    console.log('  ✔ Keystroke telemetry auditing executed and verified by high-performance engine');

    // Paste event detection via Engine
    const pasteSnapshots = [
        { timestamp: 1000, textLength: 10 },
        { timestamp: 1100, textLength: 60 }, // +50 chars in 100ms
    ];
    const pasteAudit = await auditTelemetryWithEngine(pasteSnapshots, 'a'.repeat(60));
    assert.strictEqual(pasteAudit.verifiedPasteCount, 1, 'Engine must detect fast paste jump');
    assert.strictEqual(pasteAudit.pasteEvents[0].index, 1, 'Paste event must be located at index 1');
    console.log('  ✔ Fast paste detection (>15 chars in <300ms) verified by high-performance engine');

    // Monotonicity rejection via Engine
    const tamperedSnapshots = [
        { timestamp: 2000, textLength: 5 },
        { timestamp: 1500, textLength: 10 }, // Backwards
    ];
    const tamperedAudit = await auditTelemetryWithEngine(tamperedSnapshots, 'a'.repeat(10));
    assert.strictEqual(tamperedAudit.isValid, false, 'Non-monotonic timestamps must fail validity');
    assert.strictEqual(tamperedAudit.flaggedForReview, true, 'Non-monotonic timestamps must be flagged');
    assert.strictEqual(tamperedAudit.integrityScore, 20, 'Non-monotonic tampering penalized');
    console.log('  ✔ Monotonic timestamp tamper verification verified by high-performance engine');

    // Similarity Analysis via Engine
    const liveSimilarity = await analyzeSimilarityWithEngine(sampleSubmissions, 25);
    assert.strictEqual(liveSimilarity.pairs.length, 1, 'MinHash engine must detect identical pair');
    assert.strictEqual(liveSimilarity.pairs[0].similarity, 100, 'Similarity must be 100%');
    assert.strictEqual(liveSimilarity.method, 'minhash_lsh', 'Method must confirm MinHash LSH execution');
    console.log('  ✔ MinHash & LSH Plagiarism Similarity Engine verified by high-performance engine');

    // Single-snapshot finalContent bypass detection
    const singleBypassAudit = await auditTelemetryWithEngine([{ timestamp: 1000, textLength: 5 }], 'x'.repeat(500));
    assert.strictEqual(singleBypassAudit.isValid, false, 'Single snapshot with large finalContent must be marked invalid');
    assert.strictEqual(singleBypassAudit.flaggedForReview, true, 'Single snapshot with large finalContent must be flagged');
    assert.strictEqual(singleBypassAudit.verifiedPasteCount, 1, 'Single snapshot with large finalContent must report 1 paste');
    console.log('  ✔ Single-snapshot finalContent injection bypass blocked by Rust engine');

    // International Unicode & numeric entity similarity detection
    const unicodeSubmissions = [
        {
            id: 'u1',
            assignment: 'Spanish 101',
            student: 'Estudiante A',
            username: 'est_a',
            content: 'La educación superior sobre el cambio climático y la física cuántica transforma las sociedades modernas en todo el mundo don&#39;t believe otherwise hoy.',
        },
        {
            id: 'u2',
            assignment: 'Spanish 101',
            student: 'Estudiante B',
            username: 'est_b',
            content: 'La educación superior sobre el cambio climático y la física cuántica transforma las sociedades modernas en todo el mundo don&#39;t believe otherwise hoy.',
        },
    ];
    const unicodeSimilarity = await analyzeSimilarityWithEngine(unicodeSubmissions, 25);
    assert.strictEqual(unicodeSimilarity.pairs.length, 1, 'Rust engine must preserve accented Unicode words');
    assert.strictEqual(unicodeSimilarity.pairs[0].similarity, 100, 'Unicode identical essays must be 100% similar');
    console.log('  ✔ International accented Unicode text and numeric entities verified by Rust engine');

    // Self-ID submission exclusion
    const duplicateIdSubmissions = [
        {
            id: 'same-id',
            assignment: 'Self Test',
            student: 'Student Alpha',
            username: 'alpha',
            content: 'This is a long essay content describing technological progress during eighteenth century industrial revolutions.',
        },
        {
            id: 'same-id',
            assignment: 'Self Test',
            student: 'Student Alpha',
            username: 'alpha',
            content: 'This is a long essay content describing technological progress during eighteenth century industrial revolutions.',
        },
    ];
    const selfSimilarity = await analyzeSimilarityWithEngine(duplicateIdSubmissions, 25);
    assert.strictEqual(selfSimilarity.pairs.length, 0, 'Submissions with same ID must not be compared to themselves');
    console.log('  ✔ Same submission ID self-comparison exclusion verified');

    // Native in-process PDF rendering via Rust Engine
    const pdfBytes = await renderPdfWithEngine(
        '<p>This is a student submission test rendered natively by pure Rust.</p>',
        'Rust Engine PDF Test',
        'Test Student'
    );
    assert.ok(pdfBytes instanceof Uint8Array, 'PDF render must return Uint8Array');
    assert.ok(pdfBytes.length > 100, 'PDF render must produce non-trivial byte size');
    const pdfHeader = Buffer.from(pdfBytes.slice(0, 8)).toString('ascii');
    assert.strictEqual(pdfHeader, '%PDF-1.4', 'PDF header must start with %PDF-1.4');
    console.log('  ✔ Native in-process PDF rendering verified by high-performance Rust engine');

} finally {
    engineProcess.kill();
    // Allow small delay for process teardown
    await new Promise(r => setTimeout(r, 300));
    console.log('  ✔ Test engine process terminated cleanly');
}

// ── Test 4: Mid-Request Hanging Server Abort & Fallback Recovery ──
console.log('\n--- Test 4: Mid-Request Hanging Server Abort & Fallback Recovery ---');

const hangingPort = 18082;
const hangingServer = http.createServer((_req, res) => {
    // Deliberately hold connection open without responding to trigger AbortSignal.timeout
    setTimeout(() => {
        if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'delayed' }));
        }
    }, 6000);
});

await new Promise(resolve => hangingServer.listen(hangingPort, '127.0.0.1', resolve));

try {
    process.env.CLIO_ENGINE_URL = `http://127.0.0.1:${hangingPort}`;

    const hangingAudit = await auditTelemetryWithEngine(steadyTyping, 'a'.repeat(100));
    assert.strictEqual(hangingAudit.isValid, true, 'Audit must fall back to TypeScript when engine hangs');
    assert.strictEqual(hangingAudit.totalSnapshots, 20, 'Audit fallback must process all snapshots');
    console.log('  ✔ In-flight engine hanging timeout recovered cleanly without student data loss');

} finally {
    hangingServer.close();
}

console.log('\n======================================================');
console.log('🎉 ALL PHASE 3 RUST ENGINE & INTEGRATION TESTS PASSED!');
console.log('======================================================');
