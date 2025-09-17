// scripts/mergeHistory.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const FEED_PATH = path.resolve("public/feed.json");
const OUT_PATH = path.resolve("public/history.json");

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function readJsonSafe(p){ try { return JSON.parse(fs.readFileSync(p,"utf8")); } catch { return null; } }

function listHistoryCsvs() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^history_\d{4}\.csv$/i.test(f))
    .map(f => path.join(DATA_DIR, f))
    .sort();
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
  if (!lines.length) return [];
  const header = lines[0];
  const sep = header.includes(";") ? ";" : ",";
  const cols = header.split(sep).map(c=>c.trim().toLowerCase());
  const idx = (n)=>cols.findIndex(c=>c===n);
  const need = ["date","m1","m2","m3","m4","m5","e1","e2"];
  for (const n of need) if (idx(n)===-1) throw new Error(`CSV: chýba "${n}"`);
  const jIdx = idx("joker");
  const toInt = (s)=>{ const n=parseInt(String(s).replace(/[^\d]/g,""),10); return Number.isFinite(n)?n:-1; };

  const arr=[];
  for (let i=1;i<lines.length;i++){
    const parts = lines[i].split(sep).map(x=>x.trim());
    if (parts.length < need.length) continue;
    const d = new Date(parts[idx("date")]); if (isNaN(d)) continue;
    const main=[1,2,3,4,5].map((_,ii)=>toInt(parts[idx(`m${ii+1}`)])).filter(n=>n>0).sort((a,b)=>a-b);
    const euro=[1,2].map((_,ii)=>toInt(parts[idx(`e${ii+1}`)])).filter(n=>n>0).sort((a,b)=>a-b);
    const joker = jIdx>=0 ? String(parts[jIdx]||"").trim() : "";
    if (main.length===5 && euro.length===2){
      arr.push({ date:d.toISOString().slice(0,10), main, euro, ...(joker?{joker}:{}) });
    }
  }
  return arr;
}

function loadAllDraws() {
  const files = listHistoryCsvs();
  if (!files.length) return [];
  let all = [];
  for (const f of files) {
    try { all = all.concat(parseCsv(fs.readFileSync(f,"utf8"))); }
    catch (e) { console.warn("CSV skip:", f, e.message); }
  }
  all.sort((a,b)=> (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all;
}

function main() {
  const draws = loadAllDraws();
  if (!draws.length) {
    console.log("mergeHistory: nenašiel som history_*.csv – preskakujem bez chyby.");
    return;
  }

  const updatedAt = new Date().toISOString();
  const drawCount = draws.length;
  const since = draws.at(-1).date;

  // agregáty (ponecháme kvôli webu)
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
