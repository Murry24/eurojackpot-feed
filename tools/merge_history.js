// tools/merge_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const PUB_DIR = path.join(process.cwd(), "public");
const FEED_FILE = path.join(PUB_DIR, "feed.json");
const PUB_HISTORY_FILE = path.join(PUB_DIR, "history.json");
const DATA_HISTORY_FILE = path.join(process.cwd(), "data", "history.json");

async function readJsonSafe(file, fallback = null) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function normalizeDraw(d) {
  // očakávaný tvar:
  // { date: "YYYY-MM-DD", main: [..5], euro: [..2], joker?: "......" }
  if (!d || !d.date || !Array.isArray(d.main) || !Array.isArray(d.euro)) return null;
  return {
    date: String(d.date),
    main: d.main.map(n => Number(n)).sort((a,b)=>a-b).slice(0,5),
    euro: d.euro.map(n => Number(n)).sort((a,b)=>a-b).slice(0,2),
    ...(d.joker ? { joker: String(d.joker) } : {})
  };
}

function mergeUniqueByDate(list) {
  const map = new Map();
  for (const x of list) {
    const nx = normalizeDraw(x);
    if (!nx) continue;
    map.set(nx.date, nx); // posledný zápis vyhrá
  }
  // zoradíme podľa dátumu zostupne
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

async function main() {
  // 1) Načítaj základ histórie – preferuj public/history.json, inak data/history.json, inak prázdno
  let base = (await readJsonSafe(PUB_HISTORY_FILE)) || (await readJsonSafe(DATA_HISTORY_FILE)) || { draws: [] };

  if (!Array.isArray(base.draws)) base.draws = [];

  // 2) Načítaj posledné žrebovanie z public/feed.json
  const feed = await readJsonSafe(FEED_FILE, { draws: [] });
  const latest = Array.isArray(feed.draws) ? feed.draws : [];

  // 3) Merge & dedupe
  const merged = mergeUniqueByDate([...base.draws, ...latest]);

  // 4) Zapíš public/history.json
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "merge(latest+history)"
    },
    draws: merged
  };

  await fs.mkdir(PUB_DIR, { recursive: true });
  await fs.writeFile(PUB_HISTORY_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`history.json updated: ${merged.length} draws`);
}

main().catch(e => {
  console.error("merge_history failed:", e);
  process.exit(1);
});
