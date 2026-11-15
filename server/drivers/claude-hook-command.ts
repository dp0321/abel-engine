/** One Claude Code hook entry that runs a helper script with this Node. */
export function hookCommand(helperPath: string, platform: NodeJS.Platform): Record<string, unknown> {
  // Claude Code runs `command` as a shell line: sh on macOS and Linux; on Windows Git Bash, or PowerShell
  // when Git Bash is missing, and the two quote differently. Given `args` (2.1.139), it starts `command` itself.
  // JSON quoting is not shell quoting: $(), backticks and $names expand inside double quotes.
  return platform === "win32"
    ? { type: "command", command: process.execPath, args: [helperPath], timeout: 5 }
    : { type: "command", command: [process.execPath, helperPath].map(path => `'${path.replace(/'/g, "'\\''")}'`).join(" "), timeout: 5 };
}

/** Abel's hard-gate hook: Claude Code runs it before every tool call; it answers "ask" for a hard-gated call. */
export function abelGateHookSettings(helperPath: string, platform: NodeJS.Platform = process.platform): Record<string, unknown> {
  return { PreToolUse: [{ matcher: "", hooks: [hookCommand(helperPath, platform)] }] };
}
