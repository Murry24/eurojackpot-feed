// scripts/mergeHistory.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR  = path.resolve("data");
const FEED_PATH = path.resolve("public/feed.json");
const OUT_PATH  = path.resolve("public/history.json");

function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive: true }); }
function listHistoryCsvs() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^history_\d{4}\.csv$/i.test(f))
    .map(f => path.join(DATA_DIR, f))
    .sort();
}
function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p,"utf8")); } catch { return null; } }
function iso(d){ return new Date(d).toISOString().slice(0,10); }

function colIdx(cols, names) { for (const n of names){ const i = cols.indexOf(n); if (i>=0) return i; } return -1; }

function parseRowFlexible(header, sep, parts) {
  const cols = header.split(sep).map(c => c.trim().toLowerCase());
  const dateI = colIdx(cols, ["date"]);
  const dateStr = dateI >= 0 ? parts[dateI] : parts[0];
  const d = new Date(dateStr);
  if (isNaN(d)) return null;

  const mIs = [
    colIdx(cols, ["m1","main1","main_1"]),
    colIdx(cols, ["m2","main2","main_2"]),
    colIdx(cols, ["m3","main3","main_3"]),
    colIdx(cols, ["m4","main4","main_4"]),
    colIdx(cols, ["m5","main5","main_5"]),
  ];
  const eIs = [
    colIdx(cols, ["e1","euro1","euro_1"]),
    colIdx(cols, ["e2","euro2","euro_2"]),
  ];
  const jI = colIdx(cols, ["joker"]);

  const nums = [];
  const haveNamed = mIs.every(i => i >= 0) && eIs.every(i => i >= 0);
  const numFrom = (i) => {
    const v = parseInt(String(parts[i] ?? "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(v) ? v : NaN;
  };

  if (haveNamed) {
    for (const i of mIs) { const n = numFrom(i); if (!Number.isNaN(n)) nums.push(n); }
    for (const i of eIs) { const n = numFrom(i); if (!Number.isNaN(n)) nums.push(n); }
  } else {
    for (let i = 0; i < parts.length; i++) {
      if (i === dateI) continue;
      const n = parseInt(String(parts[i]).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n)) nums.push(n);
      if (nums.length === 7) break;
    }
  }
  if (nums.length < 7) return null;

  const main = nums.slice(0,5).sort((a,b)=>a-b);
  const euro = nums.slice(5,7).sort((a,b)=>a-b);
  let joker = "";
  if (jI >= 0 && parts[jI] != null) joker = String(parts[jI]).trim();

  return { date: iso(d), main, euro, ...(joker ? { joker } : {}) };
}

function loadDrawsFromCsvs() {
  const files = listHistoryCsvs();
  let all = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
    if (!lines.length) continue;
    const header = lines[0];
    const sep = header.includes(";") ? ";" : ",";
    for (let i = 1; i < lines.length; i++) {
      const row = parseRowFlexible(header, sep, lines[i].split(sep).map(s=>s.trim()));
      if (row) all.push(row);
    }
  }
  // zoradiť najnovšie navrch
  all.sort((a,b)=> (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all;
}

function main() {
  // 1) načítaj históriu z CSV
  const drawsFromCsv = loadDrawsFromCsvs();     // môže byť prázdne, ak CSV ešte nie je doplnené
  const latestCsvDate = drawsFromCsv.length ? drawsFromCsv[0].date : null;

  // 2) načítaj najnovší ťah z feed.json (fetchuje ho fetch.js)
  const feed = readJsonSafe(FEED_PATH);
  const latestFromFeed = Array.isArray(feed?.draws) && feed.draws.length ? feed.draws[0] : null;

  // 3) výsledné pole "draws": CSV + (príp. doplnený najnovší ťah z feedu)
  let draws = [...drawsFromCsv];

  if (latestFromFeed?.date) {
    const feedDate = iso(latestFromFeed.date);
    const same = drawsFromCsv.find(d => d.date === feedDate
      && JSON.stringify(d.main) === JSON.stringify(latestFromFeed.main)
      && JSON.stringify(d.euro) === JSON.stringify(latestFromFeed.euro));
    const isNewer = !latestCsvDate || feedDate > latestCsvDate;
    if (!same && isNewer) {
      // vlož ako najnovší záznam
      draws.unshift({
        date: feedDate,
        main: latestFromFeed.main?.slice(0,5) ?? [],
        euro: latestFromFeed.euro?.slice(0,2) ?? [],
        ...(latestFromFeed.joker ? { joker: latestFromFeed.joker } : {}),
      });
      console.log(`mergeHistory: doplnený nový ťah z feed.json: ${feedDate}`);
    }
  }

  // 4) meta + agregáty
  const updatedAt = new Date().toISOString();
  const drawCount = draws.length;
  const since = drawCount ? draws.at(-1).date : "2022-03-25";

  const mainStats = {}; for (let n=1;n<=50;n++) mainStats[n] = { count:0, lastSeen:null };
  const euroStats = {}; for (let n=1;n<=12;n++) euroStats[n] = { count:0, lastSeen:null };
  for (const d of draws){
    for (const m of d.main){ mainStats[m].count++; mainStats[m].lastSeen = d.date; }
    for (const e of d.euro){ euroStats[e].count++; euroStats[e].lastSeen = d.date; }
  }

  const out = {
    meta: { since, updatedAt, drawCount },
    draws,
    main: mainStats,
    euro: euroStats,
    processedDrawDates: draws.map(d => d.date),
  };

  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`history.json hotové: ${drawCount} záznamov (since ${since})`);
}
main();
