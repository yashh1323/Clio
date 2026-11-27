// Run after npm run build. The standalone server talks only to a local database fixture.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"

async function listen(server) {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    return server.address().port
}

test("standalone login, assignment grouping, account change and logout", async () => {
    const profile = {
        id: randomUUID(), username: "fixture", role: "teacher", status: "active",
        session_version: 0, password: await bcrypt.hash("fixture-password", 4),
    }
    const rows = [randomUUID(), randomUUID()].map(assignment_id => ({
        assignment_id, assignment_title: "old title", assignment: { title: "Essay" },
        integrity_score: 100, grade: null,
    }))
    const database = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost")
        res.setHeader("Content-Type", "application/json")
        if (url.pathname === "/rest/v1/submissions") return res.end(JSON.stringify(rows))
        if (url.pathname !== "/rest/v1/profiles") { res.writeHead(404); return res.end() }
        if (req.method === "PATCH") {
            if (url.searchParams.get("id") === "eq." + profile.id &&
                url.searchParams.get("session_version") === "eq." + profile.session_version) {
                let body = ""
                for await (const chunk of req) body += chunk
                profile.session_version = JSON.parse(body).session_version
            }
            res.writeHead(204)
            return res.end()
        }
        const login = url.searchParams.has("username")
        res.end(JSON.stringify(login ? [profile] : profile))
    })
    const databasePort = await listen(database)
    const reservation = createServer()
    const port = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const origin = "http://127.0.0.1:" + port
    const app = spawn(process.execPath, [".next/standalone/server.js"], {
        env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port),
            SUPABASE_URL: "http://127.0.0.1:" + databasePort, SUPABASE_SERVICE_ROLE_KEY: "fixture",
            AUTH_SECRET: randomBytes(32).toString("hex") },
        stdio: "inherit",
    })
    async function login() {
        const res = await fetch(origin + "/api/auth/login", { method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ username: profile.username, password: "fixture-password" }) })
        assert.equal(res.status, 200)
        return res.headers.get("set-cookie").split(";")[0]
    }
    try {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (app.exitCode !== null) throw new Error("Standalone server exited early")
            if (await fetch(origin + "/login").then(r => r.ok, () => false)) break
            await delay(100)
        }
        const teacher = await login()
        const response = await fetch(origin + "/api/analytics", { headers: { Cookie: teacher } })
        assert.equal(response.status, 200)
        const { assignmentStats } = await response.json()
        assert.deepEqual(assignmentStats.map(row => row.key), rows.map(row => row.assignment_id))
        assert.deepEqual(assignmentStats.map(row => row.title), ["Essay", "Essay"])
        profile.role = "student"
        profile.session_version++
        const session = cookie => fetch(origin + "/api/auth/session", { headers: { Cookie: cookie } })
        assert.equal((await session(teacher)).status, 401)
        const student = await login()
        assert.equal((await session(student)).status, 200)
        const logout = await fetch(origin + "/api/auth/logout", { method: "POST", headers: { Origin: origin, Cookie: student } })
        assert.equal(logout.status, 200)
        assert.equal(profile.session_version, 2)
        assert.equal((await session(student)).status, 401)
    } finally {
        app.kill()
        database.closeAllConnections()
        await new Promise(resolve => database.close(resolve))
    }
})
