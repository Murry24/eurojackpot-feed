// tools/merge_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const PUB = path.join(process.cwd(), "public");
const FEED = path.join(PUB, "feed.json");
const HIST = path.join(PUB, "history.json");

// unikátny kľúč ťahu
function keyOf(d) {
  const main = (d.main || []).join("-");
  const euro = (d.euro || []).join("-");
  return `${d.date}|${main}|${euro}`;
}

async function main() {
  // čítaj feed (musí existovať – vyrobil ho fetch.js)
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));

  // čítaj históriu – ak nie je, ber prázdnu
  let history = { draws: [] };
  try {
    history = JSON.parse(await fs.readFile(HIST, "utf8"));
  } catch {
    // ok, žiadna história – nič sa nedeje
  }

  // zlúč + odstraň duplicity
  const all = [...(history.draws || []), ...(feed.draws || [])];
  const seen = new Set();
  const merged = all
    .filter((d) => {
      const k = keyOf(d);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // zapíš naspäť do feed.json (ponechaj meta z najnovšieho fetchu)
  const out = { meta: feed.meta || {}, draws: merged };
  await fs.writeFile(FEED, JSON.stringify(out, null, 2), "utf8");
  console.log(`[merge] wrote public/feed.json with ${merged.length} draws`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
