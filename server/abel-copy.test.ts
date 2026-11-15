import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import en from "../src/locales/en.json" with { type: "json" };
import { abelCopy } from "../shared/abel-copy.ts";
import { seededHelperName } from "../shared/default-bot.ts";
import { seededMausBot } from "./default-bot.ts";
import { serverLine } from "./server-lines.ts";
import type { BotRecord } from "./store.ts";

// server/testing/setup.ts gives upstream's tests upstream's names; this file checks Abel Engine's own.
vi.unmock("../packages/phone-protocol/src/abel-defaults.ts");

const electronCopy = createRequire(import.meta.url)("../electron/abel-copy.cjs") as { abelCopy: (key: string, text: string) => string };

describe("Abel Engine's names in upstream's copy", () => {
  it("seeds the helper as Abel Crew and still finds a helper seeded as MausBot", async () => {
    vi.resetModules();
    vi.doUnmock("../packages/phone-protocol/src/abel-defaults.ts");
    const fresh = await import("../packages/phone-protocol/src/default-bot.ts");
    expect(fresh.DEFAULT_BOT_NAME).toBe("Abel Crew");
    expect(fresh.seededHelperName("MausBot")).toBe(true);
    expect(fresh.seededHelperName("Abel Crew")).toBe(true);
    expect(fresh.seededHelperName(" mausbot ")).toBe(true);
    expect(fresh.seededHelperName("Sales")).toBe(false);
    expect(seededHelperName("MausBot")).toBe(true);
    const bot = (name: string, createdAt: string) => ({ id: name, name, color: "blue", createdAt }) as unknown as BotRecord;
    expect(seededMausBot([bot("Sales", "2026-02-01"), bot("MausBot", "2026-01-01")])?.name).toBe("MausBot");
  });

  it("reads OpenMausBot and the product sense of MausBot as Abel Engine, the helper sense as Abel Crew", () => {
    expect(abelCopy("native.boot.unsafe.title", en["native.boot.unsafe.title"])).toBe("Abel Engine could not start safely");
    expect(abelCopy("serverError.pair.oldCode", en["serverError.pair.oldCode"])).toContain("a code from an older Abel Engine");
    expect(abelCopy("native.talk.thinking", en["native.talk.thinking"])).toBe("Abel Crew is thinking…");
    expect(abelCopy("room.panel.responder.auto", en["room.panel.responder.auto"])).toBe("Abel Crew decides");
    expect(serverLine("en", "server.cloudComputer.restarted", { name: "Scout" })).toContain("so Abel Engine restarted it");
  });

  it("keeps upstream's own services and team by name", () => {
    expect(abelCopy("cloudSetup.title", en["cloudSetup.title"])).toBe("Set up MausBot Cloud");
    expect(abelCopy("server.reports.sent", en["server.reports.sent"])).toBe(en["server.reports.sent"]);
    expect(abelCopy("phoneUpdate.title", en["phoneUpdate.title"])).toBe(en["phoneUpdate.title"]);
  });

  it("leaves no product or helper MausBot in English copy outside what it keeps on purpose", () => {
    const kept = /^(server\.reports\.|productHunt\.|boatOffer\.|modelgoOffer\.|cloudBuy\.|cloudCancel\.|updatesConsent\.|phoneUpdate\.)|^(remote\.devices\.retired|native\.connect\.phoneLink)$/;
    const left = Object.entries(en as Record<string, string>)
      .filter(([key]) => !kept.test(key))
      .filter(([key, text]) => /OpenMausBot|\bMausBot\b(?! (?:Cloud|Relay)\b)/.test(abelCopy(key, text)));
    expect(left).toEqual([]);
  });

  it("the desktop's CommonJS copy reads every English line the same", () => {
    for (const [key, text] of Object.entries(en as Record<string, string>)) expect(electronCopy.abelCopy(key, text), key).toBe(abelCopy(key, text));
  });
});
