// scripts/buildLatest.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const OUT_PATH = path.resolve("public/feed.json");

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

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

  // 1) pokus: názvy m1..m5, e1..e2, joker
  const want = ["date","m1","m2","m3","m4","m5","e1","e2"];
  const haveNamed = want.every(n => idx(n) >= 0);
  const dateStr = haveNamed ? parts[idx("date")] : parts[0];

  const d = new Date(dateStr);
  if (isNaN(d)) return null;

  const nums = [];
  if (haveNamed) {
    for (const n of ["m1","m2","m3","m4","m5","e1","e2"]) {
      const v = parseInt(String(parts[idx(n)] ?? "").replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(v)) nums.push(v);
    }
  } else {
    // 2) fallback: zober prvých 7 čísel po dátume
    for (let i = 1; i < parts.length; i++) {
      const v = parseInt(String(parts[i]).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(v)) nums.push(v);
      if (nums.length === 7) break;
    }
  }
  if (nums.length < 7) return null;

  const main = nums.slice(0, 5).sort((a,b)=>a-b);
  const euro = nums.slice(5, 7).sort((a,b)=>a-b);

  // joker ak vieme
  let joker = "";
  const jIdx = cols.findIndex(c => c === "joker");
  if (jIdx >= 0 && parts[jIdx] != null) {
    joker = String(parts[jIdx]).trim();
  }

  return {
    date: d.toISOString().slice(0, 10),
    main, euro,
    ...(joker ? { joker } : {})
  };
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
    console.log("buildLatest: nenašiel som žiadne platné riadky v data/history_*.csv");
    return;
  }
  const out = {
    meta: { since: draws.at(-1).date, updatedAt: new Date().toISOString(), nextJackpotEUR: null },
    draws: [draws[0]],
  };
  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`feed.json hotový – posledný ťah: ${out.draws[0].date}`);
}
main();
