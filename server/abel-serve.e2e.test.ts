import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { workerPort } from "./testing/worker-port.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

describe("Abel's openmausbot serve", () => {
  it("treats an unsigned local caller as a service, and writes a local token that Abel's HQ uses", async () => {
    const home = mkdtempSync(join(tmpdir(), "abel-serve-"));
    const port = workerPort(23000, 9000);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, OMB_WEBHOOK_PORT: String(port + 1), OMB_BROWSER_CONNECTION: join(home, "browser-connection.json") };
    const child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "openmausbot.ts"), "serve", "--no-pair", "--no-open", "--port", String(port), "--data-dir", join(home, "data")], {
      cwd: join(SERVER_DIR, ".."), env, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.stderr.on("data", (c) => (out += String(c)));
    const url = `http://127.0.0.1:${port}`;
    const call = (method: string, path: string, body?: unknown, token?: string) => fetch(url + path, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try {
      const deadline = Date.now() + 60_000;
      while (!/local client token|no local client token/.test(out) && Date.now() < deadline && child.exitCode === null) await new Promise((r) => setTimeout(r, 200));
      expect(out).toContain("local client token (for Abel's HQ");
      const file = join(home, "data", "abel-client-token");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const token = readFileSync(file, "utf8").trim();

      const bots = await call("GET", "/api/bots");
      expect(bots.status).toBe(200);
      const bot = (await bots.json() as { bots: Array<{ id: string; threadId: string }> }).bots[0];
      // An unsigned local caller (any bot's shell): no approving a card, no level change, no pairing.
      const approve = await call("POST", `/api/threads/${bot?.threadId ?? "t"}/respond`, { requestId: "r1", behavior: "allow" });
      expect(approve.status).toBe(403);
      expect((await call("PATCH", `/api/bots/${bot?.id ?? "b"}`, { approvalMode: "ask" })).status).toBe(403);
      expect((await call("POST", "/api/auth/pairing", {})).status).toBe(403);
      expect((await call("POST", "/api/bots", { name: "Not allowed" })).status).toBe(403);

      // The local token reaches what Abel's HQ (abel-lite engine.py) uses, and mints no other credential.
      expect((await call("GET", "/api/bots?messages=0", undefined, token)).status).toBe(200);
      expect((await call("GET", "/api/instances", undefined, token)).status).toBe(200);
      const made = await call("POST", "/api/bots", { useDefaults: false, name: "HQ worker" }, token);
      expect(made.status).toBe(201);
      const worker = (await made.json() as { bot: { id: string; threadId: string } }).bot;
      expect((await call("PATCH", `/api/bots/${worker.id}`, { soul: "Be brief." }, token)).status).toBe(200);
      expect((await call("POST", `/api/bots/${worker.id}/tasks`, { title: "From HQ" }, token)).status).toBeLessThan(400);
      expect((await call("POST", `/api/threads/${worker.threadId}/respond`, { requestId: "no-such-request", behavior: "allow" }, token)).status).not.toBe(403);
      for (const [method, path, body] of [["POST", "/api/auth/pairing", {}], ["GET", "/api/auth/sessions", undefined], ["PATCH", "/api/config", { signIn: { admins: ["bot@example.com"] } }]] as const) {
        expect((await call(method, path, body, token)).status, `${method} ${path}`).toBe(403);
      }
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, { signal: "SIGTERM" });
      await removeTempDir(home);
    }
  }, 90_000);
});
