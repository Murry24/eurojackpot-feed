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

function toNumArray(arr, take, sort = true) {
  if (!Array.isArray(arr)) return [];
  const out = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (sort) out.sort((a, b) => a - b);
  return typeof take === "number" ? out.slice(0, take) : out;
}

function normalizeDraw(d) {
  if (!d || !d.date) return null;
  const date = String(d.date);

  const main = toNumArray(d.main, 5, true);
  const euro = toNumArray(d.euro, 2, true);

  if (main.length === 0 || euro.length === 0) {
    // záznam je podozrivý, ale necháme ho pre istotu – len zalogujeme
    console.warn("[merge] weak draw normalized:", { date, main, euro });
  }

  const out = { date, main, euro };
  if (d.joker != null && String(d.joker).length > 0) {
    out.joker = String(d.joker);
  }
  return out;
}

function mergeUniqueByDate(arraysOfDraws) {
  const map = new Map();
  for (const list of arraysOfDraws) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const nx = normalizeDraw(raw);
      if (!nx) continue;
      map.set(nx.date, nx); // posledný zápis vyhrá
    }
  }
  // zoradiť zostupne podľa dátumu (string ISO YYYY-MM-DD)
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

async function main() {
  // 1) História (public/history.json alebo data/history.json)
  const base =
    (await readJsonSafe(PUB_HISTORY_FILE, null)) ??
    (await readJsonSafe(DATA_HISTORY_FILE, { draws: [] }));

  const baseDraws = Array.isArray(base?.draws) ? base.draws : [];
  console.log(`[merge] base history draws: ${baseDraws.length}`);

  // 2) Posledný ťah (public/feed.json)
  const feed = await readJsonSafe(FEED_FILE, { draws: [] });
  const latestDraws = Array.isArray(feed?.draws) ? feed.draws : [];
  console.log(`[merge] latest feed draws: ${latestDraws.length}`);

  // 3) Merge + dedupe
  const merged = mergeUniqueByDate([baseDraws, latestDraws]);
  console.log(`[merge] merged unique draws: ${merged.length}`);

  // 4) Zapíš
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "merge(latest+history)"
    },
    draws: merged
  };

  await fs.mkdir(PUB_DIR, { recursive: true });
  await fs.writeFile(PUB_HISTORY_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`[merge] history.json written: ${PUB_HISTORY_FILE}`);
}

main().catch((e) => {
  console.error("merge_history failed:", e);
  process.exit(1);
});
