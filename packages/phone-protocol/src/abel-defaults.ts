/** Abel Engine's defaults: the one place this fork differs from upstream behaviour. ABEL.md documents each field. */
export const ABEL_DEFAULTS = {
  /** The name a person reads in titles, onboarding and settings. */
  productName: "Abel Engine",
  /** The level every bot and thread starts at on a standalone server or the desktop. A shared company (hosted) workspace
   * keeps upstream's Ask. */
  approvalMode: "full",
  /** "Sending on your behalf" for a bot with no rule of its own. */
  outboundPolicy: "allow",
  /** Off-machine access always needs a pairing code or an approved sign-in; `serve --no-pair` only skips printing one. */
  pairingRequired: true,
  /** How `openmausbot serve` treats a local caller without a session (OMB_LOOPBACK_TRUST unless set): "service" lets a
   * bot's own shell reach only the service routes, never approvals, levels or pairing. */
  loopbackTrust: "service",
  /** In the data dir: the access token `serve` writes (0600) for local tools such as Abel's HQ. It cannot pair, sign in,
   * change the sign-in list or approve a hard gate. */
  clientTokenFile: "abel-client-token",
  /** The only address the server listens on; `--lan` / OMB_LAN=1 is refused. */
  bindHost: "127.0.0.1",
  /** Product analytics (docs/analytics.md) until the person turns them on. */
  analytics: false,
  /** Sponsor offers (Boat credit, ModelGo) and the upstream announcements feed that carries sponsor cards. */
  sponsorOffers: false,
  /** Background pulls from upstream's servers: the model manifest and the update check (which reads dp0321/abel-engine
   * when on). Off: the bundled manifest stands and no update is looked for. Upstream's managed Composio broker is off
   * separately, unless ABEL_MANAGED_COMPOSIO=1 (electron/managed-composio.mjs). */
  upstreamFetches: false,
  /** The standing hard gates (abel-hard-gate.ts): money, trades, live flips, mass sends and typed credentials ask every time. */
  hardGates: true,
  /** More recipients than this in one send is a mass send. */
  massSendRecipients: 25,
} as const;
