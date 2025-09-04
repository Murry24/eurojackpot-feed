// tools/merge_feeds.js
// Spojí public/history.json + public/feed.json do jedného public/feed.json (prepíše ho)

import * as fs from "node:fs/promises";
import * as path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public");
const FEED_FILE = path.join(OUT_DIR, "feed.json");
const HIST_FILE = path.join(OUT_DIR, "history.json");

function normalizeDraw(d) {
  // očistíme minimálne pole, aby sa dalo deduplikovať a sortovať
  return {
    date: d.date,            // "YYYY-MM-DD"
    main: Array.isArray(d.main) ? d.main.slice(0, 5) : [],
    euro: Array.isArray(d.euro) ? d.euro.slice(0, 2) : [],
    ...(d.joker ? { joker: d.joker } : {}),
  };
}

async function main() {
  // načítaj oba súbory
  const feed = JSON.parse(await fs.readFile(FEED_FILE, "utf8"));
  const hist = JSON.parse(await fs.readFile(HIST_FILE, "utf8"));

  const histDraws = Array.isArray(hist.draws) ? hist.draws.map(normalizeDraw) : [];
  const feedDraws = Array.isArray(feed.draws) ? feed.draws.map(normalizeDraw) : [];

  // spoj a deduplikuj podľa dátumu (posledný výskyt vyhrá)
  const byDate = new Map();
  for (const d of [...histDraws, ...feedDraws]) byDate.set(d.date, d);

  // zoradenie od najnovšieho po najstaršie
  const mergedDraws = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  const merged = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "tipos+history",
    },
    draws: mergedDraws,
  };

  await fs.writeFile(FEED_FILE, JSON.stringify(merged, null, 2), "utf8");
  console.log(`Merged history (${histDraws.length}) + latest (${feedDraws.length}) -> ${mergedDraws.length} draws`);
}

main().catch((e) => {
  console.error("merge_feeds failed:", e);
  process.exit(1);
});
