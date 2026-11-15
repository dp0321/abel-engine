// Claude Code runs this before every tool call with the hook's JSON on stdin. It decides locally, with no network, and
// ALWAYS exits 0: a hard-gated call gets "ask", which Claude Code sends to the permission prompt tool even under
// bypassPermissions; anything else gets no output and runs. stdout is the hook channel: never console.log anything else.
import { abelPreToolUseOutput } from "../../shared/abel-hard-gate.ts";

const MAX_INPUT_BYTES = 1024 * 1024;

const done = (out?: string) => {
  if (out === undefined) process.exit(0);
  process.stdout.write(out, () => process.exit(0));
};
process.stdout.on("error", () => process.exit(0));
const ASK = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `Abel hard gate: ${reason}` } });
// Fails closed: a check that has not finished before Claude Code's own 5 s hook timeout asks rather than lets it run.
setTimeout(() => done(ASK("this call could not be checked in time.")), 3_500).unref();

let data = "";
let bytes = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  bytes += Buffer.byteLength(chunk);
  // An input too large to read is still a tool call: it asks rather than run unseen.
  if (bytes > MAX_INPUT_BYTES) {
    done(ASK("this call was too large to check."));
    return;
  }
  data += chunk;
});
process.stdin.on("end", () => {
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return done();
  }
  done(abelPreToolUseOutput(event));
});
process.stdin.on("error", () => done());
