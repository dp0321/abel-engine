/** Abel Engine's defaults: the one place this fork differs from upstream behaviour. ABEL.md documents each field. */
export const ABEL_DEFAULTS = {
  /** The name a person reads in titles, onboarding and settings. */
  productName: "Abel Engine",
  /** The level every bot and thread starts at, a shared company workspace's included. */
  approvalMode: "full",
  /** "Sending on your behalf" for a bot with no rule of its own. */
  outboundPolicy: "allow",
  /** Off-machine access always needs a pairing code or an approved sign-in; `serve --no-pair` only skips printing one. */
  pairingRequired: true,
  /** The only address the server listens on; `--lan` / OMB_LAN=1 is refused. */
  bindHost: "127.0.0.1",
  /** Product analytics (docs/analytics.md) until the person turns them on. */
  analytics: false,
  /** Sponsor offers (Boat credit, ModelGo) and the upstream announcements feed that carries sponsor cards. */
  sponsorOffers: false,
  /** The standing hard gates (abel-hard-gate.ts): money, trades, live flips, mass sends and typed credentials ask every time. */
  hardGates: true,
  /** More recipients than this in one send is a mass send. */
  massSendRecipients: 25,
} as const;
