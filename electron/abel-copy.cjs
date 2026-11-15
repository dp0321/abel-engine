// The desktop's copy of shared/abel-copy.ts (CommonJS for native-text.cjs); abel-copy.test.ts checks both read every
// English line the same. Only the packaged or dev Electron app renames: plain-node tests read upstream's words.
const rules = require("./abel-copy-keys.json");

const keep = (key) => rules.keepKeys.includes(key) || rules.keepPrefixes.some((prefix) => key.startsWith(prefix));
const helper = (key) => rules.botKeys.includes(key) || rules.botPrefixes.some((prefix) => key.startsWith(prefix));

function article(text, english, names) {
  if (!english) return text;
  const name = [names.product, names.bot].filter((one) => /^[aeiou]/i.test(one)).map((one) => one.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return name.length ? text.replace(new RegExp(`\\b([Aa]) (?=(?:${name.join("|")})\\b)`, "g"), "$1n ") : text;
}

function abelCopy(key, text, english = true, names = { product: "Abel Engine", bot: "Abel Crew" }) {
  if (names.product === "MausBot" || keep(key) || typeof text !== "string" || !text.includes("MausBot")) return text;
  return article(text.replace(/\bOpenMausBot\b/g, names.product).replace(/\bMausBot\b(?! (?:Cloud|Relay)\b)/g, helper(key) ? names.bot : names.product), english, names);
}

module.exports = { abelCopy, renames: Boolean(process.versions.electron) };
