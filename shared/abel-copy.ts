// Abel Engine's names in upstream's interface copy, applied as each line is read so the locale files stay upstream's.
// "OpenMausBot" and the product sense of "MausBot" read as the product name; the helper-bot sense as its default name.
// Upstream's own services and team keep their names: "MausBot Cloud", "MausBot Relay", the MausBot phone app, bug reports
// to the MausBot team, sponsor and Cloud purchase copy (electron/abel-copy-keys.json).
import { ABEL_DEFAULTS } from "./abel-defaults.ts";
import rules from "../electron/abel-copy-keys.json" with { type: "json" };

const keep = (key: string) => rules.keepKeys.includes(key) || rules.keepPrefixes.some((prefix) => key.startsWith(prefix));
const helper = (key: string) => rules.botKeys.includes(key) || rules.botPrefixes.some((prefix) => key.startsWith(prefix));

/** English's "a" before a vowel: "a MausBot theme" becomes "an Abel Engine theme". Only for an English line: in Spanish or
 * Italian "a" is a preposition. */
function article(text: string, english: boolean, names: { product: string; bot: string }): string {
  if (!english) return text;
  const name = [names.product, names.bot].filter((one) => /^[aeiou]/i.test(one)).map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return name.length ? text.replace(new RegExp(`\\b([Aa]) (?=(?:${name.join("|")})\\b)`, "g"), "$1n ") : text;
}

/** One line of copy as Abel Engine shows it. `english`: the line is the English one (an untranslated key included). A build
 * named MausBot (upstream's tests) is left exactly as written. */
export function abelCopy(key: string, text: string, english = true, names: { product: string; bot: string } = { product: ABEL_DEFAULTS.productName, bot: ABEL_DEFAULTS.defaultBotName }): string {
  if (names.product === "MausBot" || keep(key) || !text.includes("MausBot")) return text;
  return article(text.replace(/\bOpenMausBot\b/g, names.product).replace(/\bMausBot\b(?! (?:Cloud|Relay)\b)/g, helper(key) ? names.bot : names.product), english, names);
}
