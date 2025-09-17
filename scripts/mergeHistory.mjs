// scripts/mergeHistory.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const OUT_PATH = path.resolve("public/history.json");

function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive: true }); }
function listHistoryCsvs() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^history_\d{4}\.csv$/i.test(f))
    .map(f => path.join(DATA_DIR, f))
    .sort();
}
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

  return { date: d.toISOString().slice(0,10), main, euro, ...(joker ? { joker } : {}) };
}

function loadAllDraws() {
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
  all.sort((a,b)=> (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all;
}

function main() {
  const draws = loadAllDraws();

  const updatedAt = new Date().toISOString();
  if (!draws.length) {
    const out0 = {
      meta: { since: "2022-03-25", updatedAt, drawCount: 0 },
      draws: [],
      main: {}, euro: {}, processedDrawDates: []
    };
    ensureDir(OUT_PATH);
    fs.writeFileSync(OUT_PATH, JSON.stringify(out0, null, 2), "utf8");
    console.log("history.json hotové: 0 záznamov (nenašli sa platné riadky)");
    return;
  }

  const since = draws.at(-1).date;
  const drawCount = draws.length;

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
