import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { abelHardGate, abelHardGateForCalls, abelPreToolUseOutput, commandHardGate, normalizedCommand, recipientCount } from "../shared/abel-hard-gate.ts";
import { DEFAULT_APPROVAL_MODE } from "../shared/approval-mode.ts";
import { DEFAULT_OUTBOUND_POLICY } from "../shared/outbound.ts";
import { autoVerdict } from "./auto-approve.ts";
import { abelGateHookSettings } from "./drivers/claude-hook-command.ts";
import { lanUrl, listenHost } from "./lan-address.ts";
import { ABEL_LOCAL_CLIENT_LABEL, abelLocalClientRefused, mayApproveHardGate, type RequestAuth } from "./request-auth.ts";
import { createOutboundHold, type OutboundHoldDeps } from "./outbound-hold.ts";
import { OutboundRequestService } from "./outbound-requests.ts";

// server/testing/setup.ts gives upstream's tests upstream's values; this file checks the real ones.
const { ABEL_DEFAULTS } = await vi.importActual<typeof import("../shared/abel-defaults.ts")>("../shared/abel-defaults.ts");
const HOOK = join(dirname(fileURLToPath(import.meta.url)), "hooks", "abel-gate-hook.ts");
const gated = (tool: string, input?: unknown) => abelHardGate({ tool, input })?.kind ?? null;
const emails = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);

describe("Abel defaults", () => {
  it("start every bot at Full access, send without asking, loopback only, analytics and sponsors off", () => {
    expect(DEFAULT_APPROVAL_MODE).toBe("full");
    expect(DEFAULT_OUTBOUND_POLICY).toEqual({ policy: "allow" });
    expect(ABEL_DEFAULTS).toMatchObject({ loopbackTrust: "service", clientTokenFile: "abel-client-token", productName: "Abel Engine", bindHost: "127.0.0.1", pairingRequired: true, analytics: false, sponsorOffers: false, hardGates: true, massSendRecipients: 25 });
  });

  it("listens on 127.0.0.1 and offers no LAN link even with OMB_LAN=1", () => {
    expect(listenHost(createServer(), { OMB_LAN: "1" })).toBe("127.0.0.1");
    expect(lanUrl(8799, { OMB_LAN: "1" }, () => ({ lan: ["192.168.1.5"], tailscale: [] }) as never)).toBeNull();
  });
});

describe("abelHardGate on connected-app and MCP tools", () => {
  it.each([
    ["STRIPE_CREATE_PAYMENT_INTENT", "money"],
    ["STRIPE_CREATE_CUSTOMER", "money"],
    ["PAYPAL_CREATE_PAYOUT", "money"],
    ["QUICKBOOKS_CREATE_TRANSFER", "money"],
    ["SQUARE_REFUND_PAYMENT", "money"],
    ["SHOPIFY_CREATE_REFUND", "money"],
    ["ALPACA_PLACE_ORDER", "money"],
    ["mcp__alpaca__place_order", "money"],
    ["mcp__total__submit_order", "trade"],
    ["mcp__broker__closePosition", "trade"],
    ["mcp__total__flatten_all", "trade"],
    ["COINBASE_CREATE_TRADE", "money"],
    ["SENDGRID_SEND_BULK_EMAIL", "mass-send"],
    ["TWILIO_BROADCAST_SMS", "mass-send"],
    ["MAILCHIMP_SEND_CAMPAIGN", "mass-send"],
  ])("%s asks (%s)", (tool, kind) => {
    expect(gated(tool)).toBe(kind);
  });

  it.each(["STRIPE_LIST_CHARGES", "STRIPE_GET_BALANCE", "mcp__alpaca__get_orders", "ALPACA_LIST_POSITIONS", "GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE", "GITHUB_CREATE_ISSUE", "NOTION_UPDATE_PAGE", "MAILCHIMP_CREATE_CAMPAIGN", "Read", "Edit", "WebFetch"])(
    "%s runs without asking",
    (tool) => expect(gated(tool, { to: "ana@example.com" })).toBeNull(),
  );

  it("a send to more than 25 recipients is a mass send; 25 is not", () => {
    expect(gated("GMAIL_SEND_EMAIL", { to: emails(25) })).toBeNull();
    expect(gated("GMAIL_SEND_EMAIL", { to: emails(20), cc: emails(4), bcc: emails(2) })).toBe("mass-send");
    expect(gated("GMAIL_SEND_EMAIL", { recipient_list: emails(30).join(", ") })).toBe("mass-send");
    expect(recipientCount({ message: { to: emails(3), cc: "a@x.com; b@x.com" } })).toBe(5);
  });

  it("counts Composio's own recipient fields: Gmail and Outlook to 30 people are mass sends", () => {
    expect(gated("GMAIL_SEND_EMAIL", { recipient_email: "a@x.com", extra_recipients: emails(29), cc: [], bcc: [] })).toBe("mass-send");
    expect(gated("OUTLOOK_SEND_EMAIL", { to_email: "a@x.com", cc_emails: emails(15), bcc_emails: emails(14) })).toBe("mass-send");
    expect(gated("OUTLOOK_SEND_EMAIL", { to_email: "a@x.com", cc_emails: emails(10) })).toBeNull();
    expect(gated("TWILIO_SEND_SMS", { phone_numbers: Array.from({ length: 30 }, (_, i) => `+1555000${String(i).padStart(4, "0")}`) })).toBe("mass-send");
    expect(gated("SLACK_SEND_MESSAGE", { targets: emails(30) })).toBe("mass-send");
    expect(recipientCount({ from_email: "me@x.com", reply_to: "me@x.com", to: "a@x.com" })).toBe(1);
  });

  it("a tool call that switches trading to live or real money asks", () => {
    expect(gated("mcp__total__go_live")).toBe("live-trading");
    expect(gated("mcp__total__goLive", {})).toBe("live-trading");
    expect(gated("mcp__total__set_trading_mode", { mode: "live" })).toBe("live-trading");
    expect(gated("mcp__broker__update_settings", { account: { paper: false } })).toBe("live-trading");
    expect(gated("mcp__broker__configure", { live_trading: true })).toBe("live-trading");
    expect(gated("mcp__total__set_trading_mode", { mode: "paper" })).toBeNull();
    expect(gated("mcp__total__get_mode", { mode: "live" })).toBeNull();
  });

  it("one-word trade tools ask", () => {
    for (const tool of ["mcp__total__submitorder", "mcp__total__placeorder", "mcp__total__closeallpositions", "mcp__total__flattenall", "mcp__broker__buymarket"]) expect(gated(tool), tool).toBe("trade");
    expect(gated("mcp__total__getorders")).toBeNull();
  });

  it("addresses separated only by spaces each count", () => {
    expect(gated("GMAIL_SEND_EMAIL", { recipient_email: emails(30).join(" ") })).toBe("mass-send");
    expect(recipientCount({ to: "Ana Lima <ana@x.com>" })).toBe(1);
    expect(recipientCount({ phone_numbers: "+15550001111 +15550002222 +15550003333" })).toBe(3);
  });

  it("typing a password or credential asks", () => {
    expect(gated("mcp__browser__fill", { selector: "input[type=password]", value: "hunter2" })).toBe("credential");
    expect(gated("mcp__playwright__browser_type", { element: "Password field", text: "hunter2" })).toBe("credential");
    expect(gated("GITHUB_CREATE_REPO_SECRET", { secret: "s3cr3t" })).toBe("credential");
    expect(gated("mcp__vendor__configure", { headers: { "API-Key": "k-123" } })).toBe("credential");
    expect(gated("mcp__vendor__connect", { token: "t-123" })).toBe("credential");
    expect(gated("mcp__browser__fill", { selector: "#search", value: "shoes" })).toBeNull();
    expect(gated("mcp__claude-in-chrome__form_input", { ref: "ref_12", value: "hunter2", action_summary: "Enters the account password" })).toBe("credential");
    expect(gated("mcp__claude-in-chrome__form_input", { ref: "ref_3", value: "Austin", action_summary: "Sets the city to Austin" })).toBeNull();
  });

  it("a raw API call to a finance app asks; to another app it does not", () => {
    expect(gated("COMPOSIO_PROXY_EXECUTE", { toolkit: "stripe", endpoint: "/v1/charges", method: "POST" })).toBe("money");
    expect(gated("COMPOSIO_PROXY_EXECUTE", { toolkit: "github", endpoint: "/repos", method: "GET" })).toBeNull();
  });

  it("a batch with more than 25 sends gates every send in it", () => {
    const batch = Array.from({ length: 26 }, () => ({ slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@x.com" } }));
    expect(abelHardGateForCalls(batch)).toMatchObject({ gate: { kind: "mass-send" }, calls: batch });
    expect(abelHardGateForCalls(batch.slice(0, 25))).toBeNull();
    const mixed = [{ slug: "SLACK_SEND_MESSAGE" }, { slug: "STRIPE_CREATE_REFUND", arguments: { charge: "ch_1" } }];
    expect(abelHardGateForCalls(mixed)).toEqual({ gate: { kind: "money", label: "stripe: create refund" }, calls: [mixed[1]] });
  });
});

describe("commandHardGate on shell commands", () => {
  it.each([
    ["curl -X POST http://127.0.0.1:8080/api/orders -d '{\"symbol\":\"ES\"}'", "trade"],
    ["curl -s http://localhost:8080/api/orders --json '{\"qty\":1}'", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/positions/flatten", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/mode/live", "live-trading"],
    ["curl -X POST https://total.local/api/go-live", "live-trading"],
    ["TOTAL_LIVE=1 python run.py", "live-trading"],
    ["sed -i 's/trading_mode=paper/trading_mode=live/' .env", "live-trading"],
    ["curl -X POST https://api-fxtrade.oanda.com/v3/accounts/1/orders -d @order.json", "trade"],
    ["curl https://api.stripe.com/v1/refunds -u $STRIPE_KEY: -d charge=ch_1", "money"],
    ["stripe payouts create --amount 100", "money"],
    ["security add-generic-password -a me -s svc -w hunter2", "credential"],
    ["mysql --password=hunter2 -e 'select 1'", "credential"],
    ["mysql -uroot -pS3cret -e 'select 1'", "credential"],
    ["echo hunter2 | sudo --stdin true", "credential"],
    ["curl -X POST http://127.0.0.1:8080/api/or''ders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/\"or\"ders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/%6Frders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/%256Frders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/./orders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api//orders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/x/../orders -d qty=1", "trade"],
    ["curl http://127.0.0.1:8080/api/orders --data-ascii qty=1", "trade"],
    ["curl http://127.0.0.1:8080/api/orders --data-urlencode qty=1", "trade"],
    ["wget --post-data 'qty=1' http://127.0.0.1:8080/api/orders", "trade"],
    ["http POST 127.0.0.1:8080/api/orders qty:=1", "trade"],
    ["xh POST :8080/api/orders qty=1", "trade"],
    ["python3 -c \"import urllib.request as u; u.urlopen('http://127.0.0.1:8080/api/orders', data=b'qty=1')\"", "trade"],
    ["python3 -c \"import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:8080/api/orders', data=b'{}'))\"", "trade"],
  ])("%s asks (%s)", (command, kind) => {
    expect(commandHardGate(command)?.kind).toBe(kind);
    expect(abelHardGate({ tool: "Bash", input: { command } })?.kind).toBe(kind);
  });

  it.each([
    "git commit -m 'flatten the config tree'",
    "curl -s http://127.0.0.1:8080/api/orders",
    "http GET 127.0.0.1:8080/api/orders",
    "python3 -c \"import urllib.request as u; print(u.urlopen('http://127.0.0.1:8080/api/orders').read())\"",
    "mysql -u root -p -e 'select 1'",
    "curl -X POST https://api-fxpractice.oanda.com/v3/accounts/1/orders -d @order.json",
    "curl -X POST https://paper-api.alpaca.markets/v2/orders -d @o.json",
    "ls -la && cat /etc/passwd",
    "pnpm test",
    "python -c 'import numpy as np; np.array([[1]]).flatten()'",
  ])("%s runs without asking", (command) => {
    expect(commandHardGate(command)).toBeNull();
  });
});

describe("an address built at run time still gates (expand, decode, then the write backstop)", () => {
  const kind = (command: string) => abelHardGate({ tool: "Bash", input: { command } })?.kind ?? null;
  it.each([
    ["BASE=http://127.0.0.1:8080/api; curl -X POST \"$BASE/orders\" -d qty=1", "trade"],
    ["export API=http://127.0.0.1:8080/api && curl -X POST ${API}/orders --json '{}'", "trade"],
    ["curl -X POST \"${API:-http://127.0.0.1:8080/api}/orders\" -d qty=1", "trade"],
    ["python3 -c \"import requests; BASE='http://127.0.0.1:8080/api'; requests.post(f'{BASE}/orders', json={})\"", "trade"],
    ["python3 -c \"import requests; b='http://127.0.0.1:8080/api'; requests.post(b+'/orders', json={})\"", "trade"],
    ["curl -X POST \"$BASE/go-live\"", "trade"],
    ["P=orders; curl -X POST http://127.0.0.1:8080/api/$P -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api$'\\x2f'orders -d qty=1", "trade"],
    ["curl -X POST http://127.0.0.1:8080/api/$'\\157'rders -d qty=1", "trade"],
    ["curl -X POST \"http://127.0.0.1:8080/api/\\x6frders\" -d qty=1", "trade"],
    ["python3 -c \"import requests; requests.post('http://127.0.0.1:8080/api/' + chr(111) + 'rders', json={})\"", "trade"],
    ["node -e \"fetch('http://127.0.0.1:8080/api/\\u006frders', { method: 'POST', body: '{}' })\"", "trade"],
    ["node -e \"fetch('http://127.0.0.1:8080/api/' + String.fromCharCode(111) + 'rders', { method: 'POST' })\"", "trade"],
    ["curl${IFS}-X${IFS}POST${IFS}http://127.0.0.1:8080/api/orders${IFS}-d${IFS}qty=1", "trade"],
    ["curl -X POST \"$(printf 'http://127.0.0.1:8080/api/%s' orders)\" -d qty=1", "trade"],
    ["curl -X POST \"$(printf 'http://127.0.0.1:8080/api/\\x6frders')\" -d qty=1", "trade"],
    ["python3 -c \"import aiohttp, asyncio; asyncio.run(aiohttp.ClientSession().post(URL + '/order'))\"", "trade"],
    ["curl -X POST \"$HOST/api/flatten_all\"", "trade"],
    ["curl -X PUT \"$HOST/api/mode\" -d mode=live", "trade"],
  ])("%s asks", (command, expected) => {
    expect(kind(command)).toBe(expected);
  });

  it.each([
    "curl $BASE/orders",
    "BASE=http://127.0.0.1:8080/api; curl -s \"$BASE/orders?status=open\"",
    "curl -G http://127.0.0.1:8080/api/orders -d status=open",
    "python3 -c \"import requests; print(requests.get('http://127.0.0.1:8080/api/orders').json())\"",
    "node -e \"fetch('http://127.0.0.1:8080/api/orders').then(r => r.json())\"",
    "curl -X POST https://example.com/api/messages -d text=hello",
  ])("%s runs without asking", (command) => {
    expect(kind(command)).toBeNull();
  });

  it("normalizes what the shell would run", () => {
    expect(normalizedCommand("P=orders; curl -X POST http://h/api/$P")).toContain("http://h/api/orders");
    expect(normalizedCommand("curl${IFS}-X${IFS}POST")).toBe("curl -X POST");
    expect(normalizedCommand("echo $'\\x2f'$'\\157'")).toBe("echo /o");
  });
});

describe("approvals honour the hard gate at Full access", () => {
  it("autoVerdict leaves a hard-gated request to a person at every level", () => {
    for (const mode of ["full", "auto", "edits", "ask"] as const) {
      expect(autoVerdict(mode, "Bash", { hardGate: "a trading order", commandAllowed: true })).toEqual({ approve: null, source: "abel-hard-gate" });
    }
    expect(autoVerdict("full", "Bash", {}).approve).toBe("approved Bash (full access)");
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function hold(outbound?: { policy: "ask" | "allow" }) {
    const dataDir = mkdtempSync(join(tmpdir(), "abel-gate-"));
    dirs.push(dataDir);
    const appended: Array<{ id: string; card?: { title?: string; requestId?: string } }> = [];
    const outboundRequests = new OutboundRequestService();
    const bot = { id: "b1", name: "Scout", color: "green" as const, outbound, notifications: false };
    const deps: OutboundHoldDeps = {
      store: {
        appendMessage: (_thread: string, message: Record<string, unknown>) => {
          const row = { ...message, id: `m${appended.length + 1}` };
          appended.push(row);
          return row;
        },
        bot: () => bot,
        messagesFor: () => appended,
        patchMessage: () => null,
        setActivity: () => null,
        setTaskActivity: () => null,
        taskByThread: () => ({ busy: true }),
      } as unknown as OutboundHoldDeps["store"],
      dataDir, outboundRequests, holdMs: 1_000,
      connectorThread: () => ({ group: undefined }), activeGroupTurnForBot: () => null, notify: () => {},
    };
    const call = { slug: "STRIPE_CREATE_REFUND", arguments: { charge: "ch_1" } };
    const input = { bot, threadId: "t1", tool: call.slug, calls: [call], opaque: false, fullAccess: true, hardGate: abelHardGate({ tool: call.slug, input: call.arguments })! };
    return { hold: createOutboundHold(deps), appended, outboundRequests, input };
  }

  it("a hard-gated connected-app call shows a card at Full access and under Send without asking", async () => {
    for (const outbound of [undefined, { policy: "allow" as const }]) {
      const held = hold(outbound);
      const answer = held.hold.hold({ ...held.input, active: () => true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(held.appended[0]?.card?.title).toBe("Approve stripe: create refund?");
      held.outboundRequests.resolve({ threadId: "t1", requestId: held.appended[0]!.card!.requestId!, behavior: "allow" });
      await expect(answer).resolves.toEqual({ ok: true, approved: true });
      expect(() => held.hold.beforeDispatch({ ...held.input, approved: false })).toThrow(/Ask for approval again/);
      expect(() => held.hold.beforeDispatch({ ...held.input, approved: true })).not.toThrow();
    }
  });

  it("without a gate, Full access still sends with no card", async () => {
    const held = hold();
    const { hardGate: _gate, ...input } = held.input;
    await expect(held.hold.hold({ ...input, active: () => true })).resolves.toEqual({ ok: true, approved: false });
    expect(held.appended).toEqual([]);
  });
});

describe("who may allow a hard-gate card", () => {
  const session = (scopes: Array<"admin" | "client">, label = "Dion's phone") => ({ kind: "session", via: "bearer", scopes, session: { label } }) as unknown as RequestAuth;
  it("the desktop app's page, a verified phone companion, or a paired owner; never an unsigned local caller or a client token", () => {
    expect(mayApproveHardGate({ kind: "loopback", scopes: ["admin", "client"] })).toBe(false);
    expect(mayApproveHardGate({ kind: "loopback", scopes: ["client"], trust: "service" })).toBe(false);
    expect(mayApproveHardGate({ kind: "loopback", scopes: ["admin", "client"], desktopOwner: true })).toBe(true);
    expect(mayApproveHardGate({ kind: "loopback", scopes: ["admin", "client"], companionDevice: "phone-1" })).toBe(true);
    expect(mayApproveHardGate(session(["admin", "client"]))).toBe(true);
    expect(mayApproveHardGate(session(["client"]))).toBe(false);
    expect(mayApproveHardGate(session(["admin", "client"], ABEL_LOCAL_CLIENT_LABEL))).toBe(false);
  });

  it("the local token mints no credential and rewrites no sign-in settings", () => {
    for (const [method, path] of [["POST", "/api/auth/pairing"], ["GET", "/api/auth/sessions"], ["DELETE", "/api/auth/sessions/s1"], ["POST", "/api/auth/email/start"], ["POST", "/api/team/phone-pairing"], ["PATCH", "/api/config"], ["PUT", "/api/config"]]) {
      expect(abelLocalClientRefused(method!, path!), `${method} ${path}`).toBe(true);
    }
    for (const [method, path] of [["GET", "/api/auth/session"], ["GET", "/api/config"], ["POST", "/api/bots"], ["PATCH", "/api/bots/b1"], ["POST", "/api/threads/t1/respond"], ["GET", "/api/instances"]]) {
      expect(abelLocalClientRefused(method!, path!), `${method} ${path}`).toBe(false);
    }
  });
});

describe("Claude Code PreToolUse hook", () => {
  it("answers ask for a hard-gated call and nothing otherwise; connected apps are left to the relay", () => {
    const ask = abelPreToolUseOutput({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "curl -X POST http://127.0.0.1:8080/api/orders -d x" } });
    expect(JSON.parse(ask!)).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } });
    expect(abelPreToolUseOutput({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } })).toBeUndefined();
    expect(abelPreToolUseOutput({ hook_event_name: "PreToolUse", tool_name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", tool_input: { tools: [{ tool_slug: "STRIPE_CREATE_REFUND" }] } })).toBeUndefined();
    expect(abelPreToolUseOutput({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "stripe payouts create" } })).toBeUndefined();
  });

  it("is registered for every tool before it runs", () => {
    expect(abelGateHookSettings("/x/abel-gate-hook.js", "darwin")).toEqual({
      PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: `'${process.execPath}' '/x/abel-gate-hook.js'`, timeout: 5 }] }],
    });
  });

  const run = (stdin: string) => new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(stdin);
  });

  it("fails closed: a call it cannot finish reading in time asks", async () => {
    const child = spawn(process.execPath, [HOOK], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stdin.write("{\"hook_event_name\":\"PreToolUse\"");
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  }, 10_000);

  it("the helper prints ask for a gated command, nothing for a benign one, and always exits 0", async () => {
    const gatedRun = await run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "stripe refunds create --charge ch_1" } }));
    expect(gatedRun.code).toBe(0);
    expect(JSON.parse(gatedRun.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    await expect(run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo hi" } }))).resolves.toEqual({ code: 0, stdout: "" });
    await expect(run("not json")).resolves.toEqual({ code: 0, stdout: "" });
  });
});
