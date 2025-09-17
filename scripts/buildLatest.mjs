// scripts/buildLatest.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const OUT_PATH = path.resolve("public/feed.json");

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function listHistoryCsvs() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^history_\d{4}\.csv$/i.test(f))
    .map(f => path.join(DATA_DIR, f))
    .sort(); // 2022 .. 2025
}

function parseCsvToDraws(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (!lines.length) return [];
  const header = lines[0];
  const sep = header.includes(";") ? ";" : ",";
  const cols = header.split(sep).map(c => c.trim().toLowerCase());
  const idx = (n) => cols.findIndex(c => c === n);
  const need = ["date","m1","m2","m3","m4","m5","e1","e2"];
  for (const n of need) if (idx(n) === -1) throw new Error(`CSV: chýba stĺpec "${n}".`);
  const jIdx = idx("joker");
  const toInt = (s) => { const n = parseInt(String(s).replace(/[^\d]/g,""),10); return Number.isFinite(n)?n:-1; };

  const draws = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(x => x.trim());
    if (parts.length < need.length) continue;
    const d = new Date(parts[idx("date")]); if (isNaN(d)) continue;
    const main = [1,2,3,4,5].map((k,ii)=>toInt(parts[idx(`m${ii+1}`)])).filter(n=>n>0).sort((a,b)=>a-b);
    const euro = [1,2].map((k,ii)=>toInt(parts[idx(`e${ii+1}`)])).filter(n=>n>0).sort((a,b)=>a-b);
    const joker = jIdx>=0 ? String(parts[jIdx]||"").trim() : "";
    if (main.length===5 && euro.length===2) {
      draws.push({ date: d.toISOString().slice(0,10), main, euro, ...(joker?{joker}:{}) });
    }
  }
  return draws;
}

function loadAllDrawsFromCsvs() {
  const files = listHistoryCsvs();
  if (!files.length) return [];
  let all = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      all = all.concat(parseCsvToDraws(raw));
    } catch (e) {
      console.warn("CSV skip:", f, e.message);
    }
  }
  // najnovšie navrch
  all.sort((a,b)=> (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all;
}

function main() {
  const draws = loadAllDrawsFromCsvs();
  if (!draws.length) {
    console.log("buildLatest: nenašiel som žiadne history_*.csv – preskakujem bez chyby.");
    return;
  }
  const out = {
    meta: {
      since: draws.at(-1).date,
      updatedAt: new Date().toISOString(),
      nextJackpotEUR: null
    },
    draws: [draws[0]] // iba posledný ťah
  };
  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`feed.json hotový – posledný ťah: ${out.draws[0].date}`);
}
main();

