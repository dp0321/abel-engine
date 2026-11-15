# Abel Engine

Abel Engine is a fork of [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (Apache License 2.0), based on
upstream release tag `v0.1.160` (`d3813518d520bd5be4392c0501d6ff3013415057`). `LICENSE`, `NOTICE` and `third_party/`
are kept as they are. The OpenMausBot and MausBot names and the mascot are trademarks of their owner; this fork shows
its own name, Abel Engine, and does not use theirs as its product name.

The diff from upstream is kept small so upstream releases merge cleanly: internals, package names, the `openmausbot`
command, environment variables (`OMB_*`) and the data folder (`~/.openmausbot`) keep their upstream names.

## What changed from upstream

| Change | Where |
| --- | --- |
| `enterprise/` (the Enterprise License carve-out) is deleted; the server reports `{"edition":"oss"}` | the folder; `vite.config.ts` skips the two tests that load it |
| Display name "Abel Engine": window titles, `<title>`, CLI banner, app/bundle name, installer names, macOS permission prompts | `src/lib/brand.ts`, `server/brand.ts`, `index.html`, `electron/environments.cjs`, `electron-builder.yml`, `server/cli.ts`, `server/headless/commands.ts` |
| Desktop auto-update reads this repository's releases, never upstream's | `electron-builder.yml` (`publish`) |
| Defaults below | `shared/abel-defaults.ts` |
| Standing hard gates | `shared/abel-hard-gate.ts`, `server/hooks/abel-gate-hook.ts`, `server/drivers/claude-hook-command.ts` |

Interface copy that names MausBot inside sentences (the locale files) is upstream text and is not rewritten here.

## Defaults: `shared/abel-defaults.ts`

One module, `ABEL_DEFAULTS` (it lives in `packages/phone-protocol/src/abel-defaults.ts` so the wire package can read it;
`shared/abel-defaults.ts` re-exports it, like the rest of `shared/`). Change a value there and every use follows.

| Field | Value | Effect |
| --- | --- | --- |
| `productName` | `"Abel Engine"` | The name a person reads |
| `approvalMode` | `"full"` | Every bot and thread on a standalone server or the desktop starts at Full access. A shared company (hosted) workspace keeps upstream's Ask (`server/index.ts`). |
| `outboundPolicy` | `"allow"` | "Sending on your behalf" is "Send without asking" for every bot with no rule of its own (`DEFAULT_OUTBOUND_POLICY`) |
| `pairingRequired` | `true` | Off-machine access always needs a pairing code or an approved sign-in. `serve --no-pair` only skips printing a code. |
| `loopbackTrust` | `"service"` | `openmausbot serve` sets `OMB_LOOPBACK_TRUST=service` unless you set it: a local request without a session (any bot's shell) reaches only the service routes. It cannot approve a card, change a level, pair a device or change settings. |
| `clientTokenFile` | `"abel-client-token"` | `serve` keeps a working local token in this data-dir file (0600) for Abel's HQ; see below |
| `bindHost` | `"127.0.0.1"` | The server listens on loopback only; `serve --lan` and `OMB_LAN=1` are refused. Reach it from elsewhere with `--tunnel`, `--tailscale`, `--domain` or `--public-url`, each behind pairing. |
| `analytics` | `false` | No product analytics until the person turns them on in Settings → General (`src/lib/analytics.ts`) |
| `sponsorOffers` | `false` | No Boat credit card, no ModelGo offer, no upstream announcements feed (which carries sponsor cards). Your own Composio, your own keys and local CLIs are untouched. Upstream's managed Composio broker (desktop registration, Cloud home) is off unless `ABEL_MANAGED_COMPOSIO=1` (`electron/managed-composio.mjs`). |
| `upstreamFetches` | `false` | Background calls off: upstream's model manifest (the bundled copy stands), the Codex CLI version lookup at registry.npmjs.org (`server/drivers/codex-release.ts`) and the update check. When on, the update check reads dp0321/abel-engine and never suggests `npm install -g openmausbot` |
| `hardGates` | `true` | The standing hard gates below |
| `massSendRecipients` | `25` | More recipients than this in one send, or more sends than this in one batch, is a mass send |

### Upstream servers contacted only when you use the feature

Nothing below runs in the background:

- **Account sign-in and companion pairing:** `openmausbot login`, `serve --tunnel` / `--relay`, the desktop's account
  and companion sign-in, and email sign-in codes without your own SMTP. These go to upstream's control plane
  (`accounts.openmausbot.com`, `server/account-signin.ts`, `electron/companion-account-service.mjs`) unless
  `OMB_CONTROL_PLANE_URL` points elsewhere. Set `OMB_SIGNIN_SMTP_URL` to send codes yourself.
- **`openmausbot doctor --host`:** its clock check sends one HEAD request to `https://cloud.openmausbot.com`
  (`server/headless/host-doctor.ts`). Plain `doctor` talks only to your own server.
- **Managed Composio broker:** only with `ABEL_MANAGED_COMPOSIO=1`.

## Standing hard gates

The only exceptions to Full access. A matching call becomes an approval card instead of running, at every level and
under every saved rule ("Send without asking", saved commands, always-allow) — the person taps Allow or Deny.

- **Money:** payments, transfers, charges, refunds, payouts, withdrawals; any non-read action of a payment, finance or
  broker app (Stripe, PayPal, Square, Plaid, Wise, Coinbase, Alpaca, OANDA, Robinhood and the others in `FINANCE_APPS`).
- **Trades:** order, trade, buy, sell, swap, flatten, liquidate, close-position tools; Total `POST /api/orders`, any
  `flatten` call; live-broker order endpoints (OANDA `api-fxtrade`, Alpaca live, Tradier, Tastytrade, Schwab).
- **Live trading flips:** `/api/…/live`, `/api/go-live`, `*_LIVE=1`, `trading_mode=live`, `--live-trading`; any tool named
  go-live / live-mode / live-trading, and any tool argument that sets a mode, environment or account type to live or real
  money, sets a live flag, or turns paper/sandbox/demo off.
- **Mass sends:** bulk, broadcast, blast or mass tools; sending a campaign; one send to more than 25 recipients
  (to + cc + bcc and other recipient fields); more than 25 sends in one batch.
- **Typed credentials:** a tool argument named password, passcode, OTP, secret, API key, token or private key; typing
  into a field labelled password or one-time code; `security add-generic-password`, `op item create`, `--password=…`,
  `sshpass`, `passwd`, `sudo -S`.

Reads (get, list, fetch, search…) never gate.

The backstop covers an address built at run time. Any HTTP write gates when its decoded text names an order, a flatten
or a live switch (`order(s)`, `flatten…`, `go-live`, `go_live`, `golive`, `/live`, `mode=live`, `live_mode`), however the
URL was put together. An HTTP write is any of:
- curl, wget, httpie or xh with a write method or a request body (`-G` makes `-d` a read);
- requests, httpx, aiohttp, axios or fetch calling post, put, patch or delete, or setting `method: POST`;
- urllib with a body.

Only a write whose every address is a broker's paper or practice host is exempt. Before matching, the command is decoded
and expanded:
- `$'…'` ANSI-C quoting, plus `\x`, `\u`, octal, `chr()` and `String.fromCharCode()` escapes, are decoded;
- `$IFS` and `${IFS}` read as a space;
- variables assigned in the same command are expanded: shell `VAR=…` and `export VAR=…`, and Python or JavaScript
  `name = '…'`, used as `$V`, `${V}`, `${V:-x}`, an f-string's `{V}` or a `+` join.

A consequence: any HTTP POST whose body mentions an order (say, a message text) also asks.

Shell lines are also matched after normalizing what the shell and server
would read: joined quotes (`or''ders`, `"or"ders`) and backslashes dropped, percent-escapes decoded (twice-encoded
too), and `/./`, `//` and `/x/../` collapsed. The Claude Code hook fails closed: a call it cannot finish checking within
3.5 s gets "ask".

### How it is enforced

1. **Connected apps (every engine).** The server relays every Composio / own-apps call. A call that meets a gate goes
   through the "Send on your behalf?" hold even at Full access or under "Send without asking"; the card is titled
   "Approve …?". At dispatch the hold is checked again, so a policy change mid-wait cannot skip it
   (`server/outbound-hold.ts`, the relay in `server/index.ts`).
2. **Claude Code under Full access (bypassPermissions).** Every turn gets a `PreToolUse` hook
   (`server/hooks/abel-gate-hook.ts`) that decides locally, with no network: a gated call gets `"ask"`. Claude Code then
   sends it to the app's permission tool (`--permission-prompt-tool mcp__ogb__approve`, now passed at Full access too),
   verified on Claude Code 2.1.311. Connected-app calls are left to the relay, so there is never a second card.
3. **Permission requests from any engine.** `autoVerdict` returns no automatic answer for a request that meets a gate
   (`source: "abel-hard-gate"`), whatever the level or saved grant, and "Always allow this session" is not offered.

Only the owner may allow a hard-gate card. That means the desktop app's own page (its per-launch token), a verified
phone companion, or a paired owner (admin) device. A session-less local request, the local token and a chat-only
session can decline one but never allow it (`mayApproveHardGate` in `server/request-auth.ts`; the card carries
`hardGate`).

Known limits: it matches names, arguments and command text. Code that computes an endpoint at run time (a script the bot
wrote and then ran) is not seen; an engine that never asks (Codex with approvals off, an ACP agent in its own yolo mode)
is gated only through connected apps.

Tests: `server/abel-hard-gate.test.ts`.

## The local token for Abel's HQ

Under service trust, a tool on this Mac signs in with a token. Every `serve` start checks
`<data dir>/abel-client-token` (default data dir `~/.openmausbot`, or `--data-dir` / `OMB_DATA_DIR`). If the token there
no longer signs in, `serve` mints a new 90-day token into that file (mode 0600) and prints the path.

- The token covers the HQ routes: bots, instances, tasks, messages, jobs, Stop and ordinary card answers. Bot
  instructions (soul) and folder (cwd) are included.
- It is refused anything that mints another credential: pairing, sessions, email sign-in and phone pairing. It also
  cannot write `/api/config` (the sign-in list included) or allow a hard-gate card.

How a client sends it (abel-lite `engine.py`): read the file, strip whitespace, and send `Authorization: Bearer <token>`
on every request to `http://127.0.0.1:8799`. Keep `OPENMAUSBOT_TOKEN` as an override. On a 401, read the file again: a
restarted `serve` may have replaced the token.

A hard-gate card answered `allow` with this token gets 403 and the message "only the owner can approve it, in the
desktop app or on a paired owner device". Approve those on the phone or in the desktop app.

To pair a phone or browser as owner, run `serve` in a terminal without `--no-pair`; it prints a pairing code. Or pair
from the desktop app, or an already-paired owner device. `openmausbot pair` from another terminal is refused under
service trust, by design.

Known open risk: a bot's shell runs as the same OS user, so it can read the data dir, this file included. These rules
stop a bot from approving its own hard gate through the API. They are not an OS sandbox.

## Run it headless

```sh
pnpm install --frozen-lockfile
pnpm build:server
node dist-server/openmausbot.js serve --no-pair --no-open --port 8799 --data-dir ~/.abel-engine
curl -s http://127.0.0.1:8799/api/health
curl -s http://127.0.0.1:8799/api/edition      # {"edition":"oss","features":[]}
node dist-server/openmausbot.js doctor --port 8799 --token-file ~/.abel-engine/abel-client-token
```

No Electron is needed. Stop it by the PID you started, never by name.

## Tests

`server/testing/setup.ts` gives upstream's tests upstream's product name, analytics and sponsor values, so their copy
assertions keep passing unchanged; `server/abel-hard-gate.test.ts` checks Abel's real values unmocked.
