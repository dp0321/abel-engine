// Abel's standing hard gates: the only exceptions to Full access. A call that matches one waits on the person's tap at
// every approval level, whatever rule a bot or thread has. Everything else runs without asking.
// Security invariant: this is a name-and-text match, the smallest reliable guard; code that computes an endpoint at run
// time (a script file the bot wrote, then ran) is not seen here. ABEL.md lists what it covers.
import { ABEL_DEFAULTS } from "./abel-defaults.ts";
import { isConnectedAppsServer } from "./own-apps.ts";
import { isOutboundTool, isReadOnlyTool, type ConnectorCall } from "./outbound.ts";

export type HardGateKind = "money" | "trade" | "live-trading" | "mass-send" | "credential";

export interface HardGate {
  kind: HardGateKind;
  /** What the person reads on the card. */
  label: string;
}

const MONEY = new Set([
  "PAY", "PAYMENT", "PAYMENTS", "PAYOUT", "PAYOUTS", "TRANSFER", "TRANSFERS", "CHARGE", "CHARGES", "REFUND", "REFUNDS",
  "WITHDRAW", "WITHDRAWAL", "WITHDRAWALS", "DEPOSIT", "DEPOSITS", "REMIT", "WIRE", "TOPUP", "TOPUPS",
]);
const TRADE = new Set(["TRADE", "TRADES", "ORDER", "ORDERS", "BUY", "SELL", "SWAP", "FLATTEN", "LIQUIDATE", "SHORT"]);
/** One-word tool names: submitorder, placetrade, closeallpositions, flattenall. */
const TRADE_WORD = /^(PLACE|SUBMIT|CREATE|SEND|NEW|EXECUTE|OPEN|MODIFY|REPLACE|AMEND|CANCEL|CLOSE)(ALL)?(ORDERS?|TRADES?|POSITIONS?)$|^(BUY|SELL)(STOCK|SHARES?|CRYPTO|COIN|MARKET|LIMIT|ORDER)?$|^FLATTEN(ALL|POSITIONS?)?$/;
/** Words that switch trading to live / real money: go_live, goLive, set_live_mode, enable_live_trading. */
const LIVE_WORD = /^(GO)?LIVE(MODE|TRADING)?$/;
const LIVE_KEY = /^(mode|trading[-_]?mode|trade[-_]?mode|execution[-_]?mode|account[-_]?(type|mode)|environment|env)$/i;
const LIVE_VALUE = /^\s*(live|real|real[-_ ]?money|live[-_ ]?trading)\s*$/i;
const LIVE_FLAG = /^(live|is[-_]?live|live[-_]?(mode|trading)|real[-_]?money|go[-_]?live)$/i;
const PAPER_FLAG = /^(paper|paper[-_]?(mode|trading)|sandbox|dry[-_]?run|simulat\w*|practice|demo)$/i;
const BULK = new Set(["BULK", "BROADCAST", "BROADCASTS", "BLAST", "MASS"]);
const CAMPAIGN_SENDS = new Set(["SEND", "SCHEDULE", "LAUNCH", "START", "TRIGGER"]);

/** Payment, finance and broker apps: any action that is not a read asks every time. */
export const FINANCE_APPS: ReadonlySet<string> = new Set([
  "STRIPE", "PAYPAL", "SQUARE", "SQUAREUP", "BRAINTREE", "ADYEN", "PLAID", "WISE", "BREX", "MERCURY", "RAMP", "VENMO",
  "CASHAPP", "ZELLE", "COINBASE", "KRAKEN", "BINANCE", "ALPACA", "ROBINHOOD", "OANDA", "TRADIER", "IBKR", "SCHWAB",
  "ETRADE", "TASTYTRADE", "TRADESTATION", "WEBULL", "FIDELITY", "LEMONSQUEEZY", "PADDLE", "CHARGEBEE", "RECURLY",
  "GUSTO", "BILL", "PAYONEER", "REVOLUT", "MOONPAY",
]);

const SHELL_TOOLS = new Set([
  "bash", "shell", "exec_command", "run_shell_command", "run_terminal_cmd", "terminal", "execute_command", "local_shell",
  "run_command", "shell_command",
]);

const RECIPIENT_KEY = /^(to|cc|bcc|recipients?|\w*_recipients?|recipient_\w+|\w*_?emails?|email_?addresses|\w*_addresses|(to|cc|bcc)_\w+|contacts|phone_?numbers?|\w*_phones?|numbers|members|invitees|attendees|guests|participants|user_?ids|users|channels|audience)$/i;
const NOT_RECIPIENT = /^(from|sender|reply_?to)(_\w+)?$/i;
const ADDRESS = /^\s*(?:[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+|\+?[\d ()-]{7,})\s*$/;
const CREDENTIAL_KEY = /^(x[-_]?)?(pass(word|wd|phrase|code)?|pwd|pin|otp|totp|mfa[-_]?code|two[-_]?factor[-_]?code|2fa[-_]?code|verification[-_]?code|one[-_]?time[-_]?code|secret|client[-_]?secret|api[-_]?key|token|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|private[-_]?key|credentials?)$/i;
const FIELD_KEY = /^(selector|element|field|ref|target|label|name|placeholder|input_?type|locator|action_?summary|description|summary)$/i;
const SECRET_FIELD = /pass(word|wd|code|phrase)|credential|one[- ]time code|\botp\b|2fa|security code/i;
const TYPING = new Set(["TYPE", "FILL", "INPUT", "ENTER", "SET", "KEYBOARD"]);

/** Upper-case word tokens of a name, camelCase split. */
function tokens(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

/** The app and the action words of a tool name: Composio's TOOLKIT_ACTION, an MCP server's mcp__server__action. */
function appAndAction(tool: string): { app: string; action: string[] } {
  if (tool.startsWith("mcp__")) {
    const [, server = "", ...rest] = tool.split("__");
    const action = rest.join("_");
    if (isConnectedAppsServer(server)) return appAndAction(action);
    return { app: tokens(server).join(""), action: tokens(action) };
  }
  if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(tool)) {
    const [app = "", ...rest] = tool.split("_");
    return { app, action: rest };
  }
  return { app: "", action: tokens(tool) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function walk(value: unknown, visit: (key: string, value: unknown) => void, depth = 0): void {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
  } else if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      visit(key, inner);
      walk(inner, visit, depth + 1);
    }
  }
}

/** Addresses in one recipient field, however they are separated: emails, else phone numbers, else comma-separated names. */
function addressesIn(value: string): number {
  const emails = value.match(/[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+/g)?.length ?? 0;
  if (emails) return emails;
  const phones = value.match(/\+?\d[\d().-]{6,}\d/g)?.length ?? 0;
  return phones || value.split(/[,;\n]/).filter((part) => part.trim()).length;
}

/** How many people one call addresses, counted from its recipient fields. */
export function recipientCount(input: unknown, depth = 0): number {
  if (depth > 5) return 0;
  if (Array.isArray(input)) return input.reduce((sum: number, item) => sum + recipientCount(item, depth + 1), 0);
  if (!isRecord(input)) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (NOT_RECIPIENT.test(key)) continue;
    if (!RECIPIENT_KEY.test(key)) {
      // Any list of addresses or phone numbers is a recipient list, whatever its field is called.
      const addresses = Array.isArray(value) ? value.filter((item) => typeof item === "string" && ADDRESS.test(item)).length : 0;
      count += addresses || recipientCount(value, depth + 1);
    } else if (Array.isArray(value)) count += value.length;
    else if (typeof value === "string") count += addressesIn(value);
  }
  return count;
}

/** Does a call's arguments switch trading to live or real money? */
function switchesToLive(input: unknown): boolean {
  let found = false;
  walk(input, (key, value) => {
    if (found) return;
    if (LIVE_KEY.test(key) && typeof value === "string" && LIVE_VALUE.test(value)) found = true;
    else if (LIVE_FLAG.test(key) && (value === true || value === 1 || (typeof value === "string" && /^(true|1|on|yes)$/i.test(value)))) found = true;
    else if (PAPER_FLAG.test(key) && (value === false || value === 0 || (typeof value === "string" && /^(false|0|off|no)$/i.test(value)))) found = true;
  });
  return found;
}

function typesACredential(action: string[], input: unknown): boolean {
  let found = false;
  const typing = action.some((token) => TYPING.has(token));
  walk(input, (key, value) => {
    if (found || typeof value !== "string" || !value.trim()) return;
    if (CREDENTIAL_KEY.test(key)) found = true;
    else if (typing && FIELD_KEY.test(key) && SECRET_FIELD.test(value)) found = true;
  });
  return found;
}

const HTTP_CALL = /(\b(curl|wget|https?|xhs?|httpx|urllib|axios)\b|https?:\/\/|fetch\(|requests\.\w+\(|Invoke-(RestMethod|WebRequest))/i;
const WRITE_METHOD = /(-X\s*['"]?(POST|PUT|PATCH|DELETE)\b|--request[=\s]+['"]?(POST|PUT|PATCH|DELETE)\b|(^|\s)(-d|--data(-raw|-binary|-urlencode|-ascii)?|--json|-F|--form|--post-data|--post-file|--body-data|--body-file)(\s|=)|--method[=\s]+['"]?(POST|PUT|PATCH|DELETE)\b|\b(https?|xhs?)\s+(-{1,2}[\w-]+(=\S+)?\s+)*(POST|PUT|PATCH|DELETE)\s|\.(post|put|patch|delete)\(|method\s*[:=]\s*['"]?(POST|PUT|PATCH|DELETE)\b|\b(POST|PUT|PATCH|DELETE)\s+https?:|\burlopen\([^)]*\bdata\s*=|\bRequest\([^)]*\bdata\s*=|\burlopen\(\s*[\w.]+\s*,\s*[^)\s])/i;

interface CommandRule { kind: HardGateKind; label: string; test: (command: string) => boolean }

const COMMAND_RULES: CommandRule[] = [
  { kind: "trade", label: "a trading order (Total /api/orders)", test: (c) => /\/api\/orders\b/i.test(c) && HTTP_CALL.test(c) && WRITE_METHOD.test(c) },
  { kind: "trade", label: "flattening positions", test: (c) => /flatten/i.test(c) && HTTP_CALL.test(c) },
  {
    kind: "live-trading", label: "a live trading switch",
    test: (c) => (HTTP_CALL.test(c) && /\/api\/[\w/-]*\b(go-?live|live)\b(?![-.\w])/i.test(c)) ||
      /\b[A-Z_]*LIVE(_TRADING)?\s*=\s*['"]?(1|true|on|yes|TRUE|ON)\b/.test(c) ||
      /\b(live[-_ ]?trading|trading[-_]?mode)\s*[=:]\s*['"]?(on|true|1|live)\b/i.test(c) ||
      /--(live-trading|go-live)\b/i.test(c),
  },
  {
    kind: "trade", label: "a live broker order",
    test: (c) => /(api-fxtrade\.oanda\.com|(?<![\w-])api\.alpaca\.markets|api\.tradier\.com|api\.tastyworks\.com|api\.schwabapi\.com)/i.test(c) && WRITE_METHOD.test(c),
  },
  {
    kind: "money", label: "a payment or money move",
    test: (c) => (/api\.stripe\.com\/v1\/(charges|payment_intents|refunds|transfers|payouts|topups|invoices\/[^\s/]+\/pay)/i.test(c) && WRITE_METHOD.test(c)) ||
      /\bstripe\s+(charges|payment_intents|refunds|transfers|payouts|topups)\s+(create|capture|confirm)\b/i.test(c) ||
      /(api(-m)?\.paypal\.com\/v[12]\/(payments|checkout\/orders|payouts))/i.test(c) && WRITE_METHOD.test(c),
  },
  {
    kind: "credential", label: "typing a password or credential",
    test: (c) => /\bsecurity\s+(add|set)-(generic|internet)-password\b/i.test(c) || /\bop\s+item\s+(create|edit)\b/i.test(c) ||
      /\bsshpass\b|\bchpasswd\b|(^|[\s;&|])passwd\b/i.test(c) || /\bsudo\s+(-[a-zA-Z]*S\b|--stdin\b)/.test(c) || /--password[=\s]+\S/i.test(c) ||
      /\b(mysql|mysqldump|mysqladmin|mariadb)\b[^|;&]*\s-p\S+/.test(c),
  },
];

/** The command a shell tool would run, or undefined. */
function commandOf(tool: string, input: unknown): string | undefined {
  const bare = (tool.startsWith("mcp__") ? tool.split("__").slice(2).join("__") : tool).toLowerCase();
  if (!SHELL_TOOLS.has(bare) || !isRecord(input)) return undefined;
  const command = input.command ?? input.cmd;
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) return command.join(" ");
  return undefined;
}

/** The command as the shell and the server would read it: quotes the shell joins and backslashes dropped, percent-escapes
 * decoded, `/./`, `//` and `/x/../` collapsed. Rules match the raw line and this one. */
export function normalizedCommand(command: string): string {
  let text = command.replace(/['"\\]/g, "");
  for (let i = 0; i < 3; i++) text = text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\/\.(?=\/)/g, "").replace(/([^:/])\/{2,}/g, "$1/").replace(/\/(?!\.\.\/)[^/\s]+\/\.\.(?=\/)/g, "");
  }
  return text;
}

/** The hard gate a shell command meets, or null. */
export function commandHardGate(command: string): HardGate | null {
  const normalized = normalizedCommand(command);
  const rule = COMMAND_RULES.find((one) => one.test(command) || one.test(normalized));
  return rule ? { kind: rule.kind, label: rule.label } : null;
}

/** The hard gate one tool call meets, or null. `commandLine`: the shell line when the caller already read it. */
export function abelHardGate(call: { tool: string; input?: unknown; commandLine?: string }): HardGate | null {
  if (!ABEL_DEFAULTS.hardGates) return null;
  const command = call.commandLine ?? commandOf(call.tool, call.input);
  if (command !== undefined) return commandHardGate(command);
  // A raw API call names its endpoint only in its arguments.
  if (call.tool === "COMPOSIO_PROXY_EXECUTE" || /^mcp__.+__invoke_api_endpoint$/.test(call.tool)) {
    const text = JSON.stringify(call.input ?? "");
    const app = tokens(text).find((token) => FINANCE_APPS.has(token));
    if (app) return { kind: "money", label: `a raw ${app.toLowerCase()} API call` };
    return commandHardGate(`curl ${text}`);
  }
  const { app, action } = appAndAction(call.tool);
  if (action.length === 0) return null;
  if (typesACredential(action, call.input)) return { kind: "credential", label: "typing a password or credential" };
  if (isReadOnlyTool(call.tool)) return null;
  if (action.some((token) => LIVE_WORD.test(token)) || switchesToLive(call.input)) return { kind: "live-trading", label: "a switch to live or real-money trading" };
  if (FINANCE_APPS.has(app)) return { kind: "money", label: `${app.toLowerCase()}: ${action.join(" ").toLowerCase()}` };
  if (action.some((token) => MONEY.has(token))) return { kind: "money", label: "a payment or money move" };
  if (action.some((token) => TRADE.has(token) || TRADE_WORD.test(token)) || (action.includes("CLOSE") && action.some((t) => t.startsWith("POSITION")))) {
    return { kind: "trade", label: "a trade or order" };
  }
  if (action.some((token) => BULK.has(token)) || (action.includes("CAMPAIGN") && action.some((token) => CAMPAIGN_SENDS.has(token)))) {
    return { kind: "mass-send", label: "a bulk or broadcast send" };
  }
  if (isOutboundTool(call.tool) && recipientCount(call.input) > ABEL_DEFAULTS.massSendRecipients) {
    return { kind: "mass-send", label: `a send to more than ${ABEL_DEFAULTS.massSendRecipients} recipients` };
  }
  return null;
}

/** The connected-app calls of one request that hard-gate, and the first gate they meet; null when none does. A batch with
 * more sends than the mass-send limit gates every send in it. */
export function abelHardGateForCalls(calls: readonly ConnectorCall[]): { gate: HardGate; calls: ConnectorCall[] } | null {
  const gated = calls.flatMap((call) => {
    const gate = abelHardGate({ tool: call.slug, input: call.arguments });
    return gate ? [{ call, gate }] : [];
  });
  if (gated.length) return { gate: gated[0]!.gate, calls: gated.map((one) => one.call) };
  const sends = ABEL_DEFAULTS.hardGates ? calls.filter((call) => isOutboundTool(call.slug)) : [];
  if (sends.length > ABEL_DEFAULTS.massSendRecipients) {
    return { gate: { kind: "mass-send", label: `more than ${ABEL_DEFAULTS.massSendRecipients} sends at once` }, calls: sends };
  }
  return null;
}

/** Claude Code's PreToolUse answer for one hook event: "ask" for a hard-gated call, so it reaches the permission prompt
 * tool even under bypassPermissions (verified on Claude Code 2.1.311); undefined lets it run. Connected-app calls are
 * gated where the server relays them, so they are left to it. */
export function abelPreToolUseOutput(event: unknown): string | undefined {
  if (!isRecord(event) || event.hook_event_name !== "PreToolUse" || typeof event.tool_name !== "string") return undefined;
  const server = event.tool_name.startsWith("mcp__") ? event.tool_name.split("__")[1] ?? "" : "";
  if (server && isConnectedAppsServer(server)) return undefined;
  const gate = abelHardGate({ tool: event.tool_name, input: event.tool_input });
  if (!gate) return undefined;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Abel hard gate: ${gate.label}. This waits for the owner's approval.`,
    },
  });
}
