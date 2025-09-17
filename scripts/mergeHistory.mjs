// scripts/mergeHistory.mjs
import fs from "node:fs";
import path from "node:path";

const FEED_PATH = path.resolve("public/feed.json");
const CSV_PATH  = path.resolve("data/history.csv");   // CSV so všetkými žrebovaniami
const OUT_PATH  = path.resolve("public/history.json");

// Bezpečné čítanie JSON
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

const feed = readJsonSafe(FEED_PATH) ?? {};
const feedMeta = typeof feed.meta === "object" && feed.meta ? feed.meta : {};
const since = feedMeta.since ?? "2022-03-25";

// CSV parser – podporí ; aj ,
function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = lines[0];
  const sep = header.includes(";") ? ";" : ",";
  const cols = header.split(sep).map((c) => c.trim().toLowerCase());
  const idx = (name) => cols.findIndex((c) => c === name);

  const need = ["date","m1","m2","m3","m4","m5","e1","e2"];
  for (const n of need) if (idx(n) === -1) throw new Error(`CSV: chýba stĺpec "${n}".`);
  const jIdx = idx("joker");

  const draws = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map((x) => x.trim());
    if (parts.length < need.length) continue;

    const dateStr = parts[idx("date")];
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;

    const toInt = (s) => {
      const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : -1;
    };

    const main = [toInt(parts[idx("m1")]), toInt(parts[idx("m2")]), toInt(parts[idx("m3")]), toInt(parts[idx("m4")]), toInt(parts[idx("m5")])]
      .filter((n) => n > 0).sort((a, b) => a - b);

    const euro = [toInt(parts[idx("e1")]), toInt(parts[idx("e2")])]
      .filter((n) => n > 0).sort((a, b) => a - b);

    const joker = jIdx >= 0 ? String(parts[jIdx] || "").trim() : "";

    if (main.length === 5 && euro.length === 2) {
      draws.push({
        date: date.toISOString().slice(0, 10),
        main, euro,
        ...(joker ? { joker } : {}),
      });
    }
  }

  draws.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return draws;
}

let draws = [];
try {
  const rawCsv = fs.readFileSync(CSV_PATH, "utf8");
  draws = parseCsv(rawCsv);
} catch (err) {
  console.error("CSV problém:", err.message);
  const feed = readJsonSafe(FEED_PATH);
  const latest = Array.isArray(feed?.draws) && feed.draws.length ? feed.draws[0] : null;
  if (latest) draws = [latest];
}

const updatedAt = new Date().toISOString();
const drawCount = draws.length;

// Agregáty (ponecháme kvôli webu)
const mainStats = {}; for (let n = 1; n <= 50; n++) mainStats[n] = { count: 0, lastSeen: null };
const euroStats = {}; for (let n = 1; n <= 12; n++) euroStats[n] = { count: 0, lastSeen: null };

for (const d of draws) {
  for (const m of d.main) { mainStats[m].count++; mainStats[m].lastSeen = d.date; }
  for (const e of d.euro) { euroStats[e].count++; euroStats[e].lastSeen = d.date; }
}

const out = {
  meta: { since, updatedAt, drawCount },
  draws,
  main: mainStats,
  euro: euroStats,
  processedDrawDates: draws.map((d) => d.date),
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
console.log(`history.json hotové: ${drawCount} záznamov, updatedAt=${updatedAt}`);
