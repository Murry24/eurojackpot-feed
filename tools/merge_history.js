// tools/merge_history.js
// Zoberie posledný ťah z public/feed.json, stiahne už nasadenú históriu
// z GitHub Pages (alebo použije lokálny súbor, ak fetch zlyhá),
// zmerguje bez duplikátov a zapíše public/history.json.

import * as fs from "node:fs/promises";
import * as path from "node:path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const FEED      = path.join(PUBLIC_DIR, "feed.json");
const HISTORY   = path.join(PUBLIC_DIR, "history.json");

// voliteľne si vieš prepnúť URL histórie cez secret/ENV
const HISTORY_URL =
  process.env.HISTORY_URL || "https://murry24.github.io/eurojackpot-feed/history.json";

function byDateDesc(a, b) {
  // ISO "YYYY-MM-DD" sa dá porovnať lexikograficky
  return (b.date || "").localeCompare(a.date || "");
}

async function readJsonSafeFile(file, fallback) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function readJsonSafeUrl(url, fallback) {
  try {
    const res = await fetch(`${url}?_=${Date.now()}`, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch {
    return fallback;
  }
}

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  // 1) posledný ťah z buildnutého feedu
  const latest = await readJsonSafeFile(FEED, { draws: [] });

  // 2) aktuálne nasadená história (z Pages) -> fallback na lokálny súbor
  let hist = await readJsonSafeUrl(HISTORY_URL, null);
  if (!hist) hist = await readJsonSafeFile(HISTORY, { draws: [] });

  const map = new Map(); // date -> draw

  // Najprv doterajšia história
  if (Array.isArray(hist.draws)) {
    for (const d of hist.draws) {
      if (d?.date) map.set(d.date, d);
    }
  }

  // Potom posledný ťah (prepíše prípadnú starú verziu pre ten dátum)
  if (Array.isArray(latest.draws)) {
    for (const d of latest.draws) {
      if (d?.date) map.set(d.date, d);
    }
  }

  // Zoradené od najnovších
  const merged = Array.from(map.values()).sort(byDateDesc);

  const out = { draws: merged };
  await fs.writeFile(HISTORY, JSON.stringify(out, null, 2), "utf8");
  console.log(`Merged -> public/history.json (${merged.length} draws)`);
}

main().catch((e) => {
  console.error("merge_history failed:", e);
  process.exit(1);
});
