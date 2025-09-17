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

function parseRowFlexible(header, sep, parts) {
  const cols = header.split(sep).map(c => c.trim().toLowerCase());
  const idx = (n) => cols.findIndex(c => c === n);

  const dateStr = idx("date") >= 0 ? parts[idx("date")] : parts[0];
  const d = new Date(dateStr);
  if (isNaN(d)) return null;

  const nums = [];
  const haveNamed = ["m1","m2","m3","m4","m5","e1","e2"].every(n => idx(n) >= 0);
  if (haveNamed) {
    for (const n of ["m1","m2","m3","m4","m5","e1","e2"]) {
      const v = parseInt(String(parts[idx(n)] ?? "").replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(v)) nums.push(v);
    }
  } else {
    for (let i = 1; i < parts.length; i++) {
      const v = parseInt(String(parts[i]).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(v)) nums.push(v);
      if (nums.length === 7) break;
    }
  }
  if (nums.length < 7) return null;

  const main = nums.slice(0,5).sort((a,b)=>a-b);
  const euro = nums.slice(5,7).sort((a,b)=>a-b);

  let joker = "";
  const jIdx = cols.findIndex(c => c === "joker");
  if (jIdx >= 0 && parts[jIdx] != null) {
    joker = String(parts[jIdx]).trim();
  }

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
  if (!draws.length) {
    // aspoň nech je meta aktuálna, aby si videl, že prebehlo
    const out0 = { meta: { since: "2022-03-25", updatedAt: new Date().toISOString(), drawCount: 0 }, draws: [], main: {}, euro: {}, processedDrawDates: [] };
    ensureDir(OUT_PATH);
    fs.writeFileSync(OUT_PATH, JSON.stringify(out0, null, 2), "utf8");
    console.log("history.json hotové: 0 záznamov (nenašli sa platné riadky)");
    return;
  }

  const updatedAt = new Date().toISOString();
  const drawCount = draws.length;
  const since = draws.at(-1).date;

  const mainStats = {}; for (let n=1;n<=50;n++) mainStats[n] = { count:0, lastSeen:null };
  const euroStats = {}; for (let n=1;n<=12;n++) euroStats[n] = { count:0, lastSeen:null };
  for (const d of draws) {
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
