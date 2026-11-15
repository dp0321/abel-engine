// The local token `openmausbot serve` keeps in the data dir for local tools (Abel's HQ). Under service loopback
// trust a session-less local request reaches only the service routes, so a tool on this Mac authenticates with this.
// Security invariant: the token is admin scope so the HQ can make bots and set their instructions, but request-auth
// refuses it everything that mints another credential (pairing, sessions, sign-in, the sign-in list in settings) and
// mayApproveHardGate refuses it on an Abel hard-gate card. Known open risk: any process running as this user can read
// the file and the data dir itself, a bot's shell included; this keeps a bot from approving its own hard gate through
// the API, it is not an OS sandbox.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ABEL_DEFAULTS } from "../shared/abel-defaults.ts";
import { writeTokenFile } from "./headless/connect.ts";
import { ABEL_LOCAL_CLIENT_LABEL as LABEL } from "./request-auth.ts";
const TTL_MS = 90 * 86_400_000;

export function abelClientTokenPath(dataDir: string): string {
  return join(dataDir, ABEL_DEFAULTS.clientTokenFile);
}

type Fetch = typeof fetch;

async function still(port: number, token: string, fetchImpl: Fetch): Promise<boolean> {
  const res = await fetchImpl(`http://127.0.0.1:${port}/api/auth/session`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  return res.ok;
}

/** Keeps a working token in the file: reuses one that still signs in, else mints a client-scope one with the owner secret
 * `serve` handed the server. Returns the file's path. */
export async function ensureAbelClientToken(input: { port: number; dataDir: string; ownerToken: string; fetchImpl?: Fetch }): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const path = abelClientTokenPath(input.dataDir);
  const existing = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  if (existing && await still(input.port, existing, fetchImpl)) return path;
  const call = async (route: string, body: unknown, owner: boolean) => {
    const res = await fetchImpl(`http://127.0.0.1:${input.port}${route}`, {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", "x-openmausbot-cli": "1", ...(owner ? { "x-openmausbot-cli-owner": input.ownerToken } : {}) },
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${route} answered ${res.status}: ${typeof json.error === "string" ? json.error : "no detail"}`);
    return json;
  };
  const minted = await call("/api/auth/pairing", { label: LABEL, scopes: ["admin", "client"], tokenTtlMs: TTL_MS }, true);
  const paired = await call("/api/auth/pair", { code: minted.code, label: LABEL }, false);
  if (typeof paired.token !== "string" || !paired.token) throw new Error("the server opened no token");
  writeTokenFile(path, paired.token, true);
  return path;
}
