import { readFileSync } from "node:fs";
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

  it("writes English's \"an\" before the new names, and leaves another language's \"a\" alone", () => {
    expect(abelCopy("settings.customThemes.importFailed", en["settings.customThemes.importFailed"])).toBe("This file is not an Abel Engine theme.");
    expect(abelCopy("native.connect.desktopApp", en["native.connect.desktopApp"])).toContain("is an Abel Engine desktop app");
    expect(abelCopy("native.talk.sending", "A MausBot reply", true)).toBe("An Abel Crew reply");
    expect(abelCopy("native.talk.sending", "Envía a MausBot", false)).toBe("Envía a Abel Crew");
    const left = Object.entries(en as Record<string, string>).filter(([key, text]) => /\b[Aa] Abel\b/.test(abelCopy(key, text))).map(([key]) => key);
    expect(left).toEqual([]);
  });

  it("keeps upstream's own services and team by name", () => {
    expect(abelCopy("cloudSetup.title", en["cloudSetup.title"])).toBe("Set up MausBot Cloud");
    expect(abelCopy("server.reports.sent", en["server.reports.sent"])).toBe(en["server.reports.sent"]);
    expect(abelCopy("phoneUpdate.title", en["phoneUpdate.title"])).toBe(en["phoneUpdate.title"]);
  });

  it("leaves no product or helper MausBot in English copy outside what it keeps on purpose", () => {
    const kept = /^(server\.reports\.|productHunt\.|boatOffer\.|modelgoOffer\.|cloudBuy\.|cloudCancel\.|updatesConsent\.|phoneUpdate\.)|^(remote\.devices\.retired|native\.connect\.phoneLink|files\.outputs\.help|native\.lend\.own\.detail|native\.lend\.terminalDetail)$/;
    const left = Object.entries(en as Record<string, string>)
      .filter(([key]) => !kept.test(key))
      .filter(([key, text]) => /OpenMausBot|\bMausBot\b(?! (?:Cloud|Relay)\b)/.test(abelCopy(key, text)));
    expect(left).toEqual([]);
  });

  it("never renames a folder, path or on-screen name to one the code does not use", () => {
    const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const outputs = /path\.join\(documentsDir, "([^"]+)"\)/.exec(read("electron/cloud-sync.mjs"))?.[1];
    const tray = /tray\.setToolTip\("([^"]+)"\)/.exec(read("electron/system-tray.mjs"))?.[1];
    expect(outputs).toBe("MausBot");
    const lines = Object.entries(en as Record<string, string>).map(([key, text]) => [key, abelCopy(key, text)] as const);
    for (const [key, text] of lines) {
      for (const folder of text.matchAll(/Documents › ([^,.;\s]+)/g)) expect(folder[1], key).toBe(outputs);
      for (const icon of text.matchAll(/the (\S+) icon/g)) if (/MausBot|Abel/.test(icon[1]!)) expect(icon[1], key).toBe(tray);
    }
    expect(read("server/system-prompt.ts")).toContain(`Documents › ${outputs}`);
  });

  it("the desktop's CommonJS copy reads every English line the same", () => {
    for (const [key, text] of Object.entries(en as Record<string, string>)) expect(electronCopy.abelCopy(key, text), key).toBe(abelCopy(key, text));
  });
});
