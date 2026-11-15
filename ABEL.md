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
| `approvalMode` | `"full"` | Every bot and thread starts at Full access. Upstream switched a shared company (hosted) workspace to Ask at startup; Abel does not (`server/index.ts`). |
| `outboundPolicy` | `"allow"` | "Sending on your behalf" is "Send without asking" for every bot with no rule of its own (`DEFAULT_OUTBOUND_POLICY`) |
| `pairingRequired` | `true` | Off-machine access always needs a pairing code or an approved sign-in. `serve --no-pair` only skips printing a code. |
| `bindHost` | `"127.0.0.1"` | The server listens on loopback only; `serve --lan` and `OMB_LAN=1` are refused. Reach it from elsewhere with `--tunnel`, `--tailscale`, `--domain` or `--public-url`, each behind pairing. |
| `analytics` | `false` | No product analytics until the person turns them on in Settings → General (`src/lib/analytics.ts`) |
| `sponsorOffers` | `false` | No Boat credit card, no ModelGo offer, no upstream announcements feed (which carries sponsor cards). Your own Composio, your own keys and local CLIs are untouched. |
| `hardGates` | `true` | The standing hard gates below |
| `massSendRecipients` | `25` | More recipients than this in one send, or more sends than this in one batch, is a mass send |

## Standing hard gates

The only exceptions to Full access. A matching call becomes an approval card instead of running, at every level and
under every saved rule ("Send without asking", saved commands, always-allow) — the person taps Allow or Deny.

- **Money:** payments, transfers, charges, refunds, payouts, withdrawals; any non-read action of a payment, finance or
  broker app (Stripe, PayPal, Square, Plaid, Wise, Coinbase, Alpaca, OANDA, Robinhood and the others in `FINANCE_APPS`).
- **Trades:** order, trade, buy, sell, swap, flatten, liquidate, close-position tools; Total `POST /api/orders`, any
  `flatten` call; live-broker order endpoints (OANDA `api-fxtrade`, Alpaca live, Tradier, Tastytrade, Schwab).
- **Live trading flips:** `/api/…/live`, `/api/go-live`, `*_LIVE=1`, `trading_mode=live`, `--live-trading`.
- **Mass sends:** bulk, broadcast, blast or mass tools; sending a campaign; one send to more than 25 recipients
  (to + cc + bcc and other recipient fields); more than 25 sends in one batch.
- **Typed credentials:** a tool argument named password, passcode, OTP, secret, API key, token or private key; typing
  into a field labelled password or one-time code; `security add-generic-password`, `op item create`, `--password=…`,
  `sshpass`, `passwd`, `sudo -S`.

Reads (get, list, fetch, search…) never gate.

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

Known limits: it matches names, arguments and command text. Code that computes an endpoint at run time (a script the bot
wrote and then ran) is not seen; an engine that never asks (Codex with approvals off, an ACP agent in its own yolo mode)
is gated only through connected apps.

Tests: `server/abel-hard-gate.test.ts`.

## Run it headless

```sh
pnpm install --frozen-lockfile
pnpm build:server
node dist-server/openmausbot.js serve --no-pair --no-open --port 8799 --data-dir ~/.abel-engine
curl -s http://127.0.0.1:8799/api/health
curl -s http://127.0.0.1:8799/api/edition      # {"edition":"oss","features":[]}
node dist-server/openmausbot.js doctor --port 8799
```

No Electron is needed. Stop it by the PID you started, never by name.

## Tests

`server/testing/setup.ts` gives upstream's tests upstream's product name, analytics and sponsor values, so their copy
assertions keep passing unchanged; `server/abel-hard-gate.test.ts` checks Abel's real values unmocked.
