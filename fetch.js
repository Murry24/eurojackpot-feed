// fetch.js — generuje ./public/feed.json (Node 20+, "type":"module")
import fs from "node:fs/promises";
import path from "node:path";
import cheerio from "cheerio";

const YEARS_BACK = 10;
const OUT_DIR = "public";
const OUT_FILE = path.join(OUT_DIR, "feed.json");

const NEXT_API = "https://media.lottoland.com/api/drawings/euroJackpot";
const ARCHIVE_YEAR = (y) => `https://www.euro-jackpot.net/en/results-archive-${y}`;

const monthMap = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function toISO(y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}
function parseDateHuman(s) {
  const m = s.trim().toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = monthMap[m[2]];
  const year = Number(m[3]);
  if (!mon) return null;
  return toISO(year, mon, day);
}
function uniqBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
function validDraw(d) {
  return d && d.date && Array.isArray(d.main) && Array.isArray(d.euro)
    && d.main.length === 5 && d.euro.length === 2
    && d.main.every(n => n>=1 && n<=50) && d.euro.every(n => n>=1 && n<=12);
}

async function fetchNextJackpotEUR() {
  try {
    const r = await fetch(NEXT_API, { headers: { "User-Agent": "EJ-Guru/1.0" } });
    if (!r.ok) { console.warn("Jackpot HTTP:", r.status); return null; }
    const j = await r.json();
    const v = j?.next?.jackpot?.value ?? j?.next?.jackpot ?? j?.next?.estimatedJackpot ?? null;
    return typeof v === "number" ? Math.round(v) : null;
  } catch (e) {
    console.warn("Jackpot error:", e?.message || e);
    return null;
  }
}

async function fetchYear(year) {
  const url = ARCHIVE_YEAR(year);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "EJ-Guru/1.0" } });
    if (!r.ok) { console.warn(`Archive ${year}: HTTP ${r.status}`); return []; }
    const html = await r.text();
    const $ = cheerio.load(html);
    const out = [];
    const cand = new Set();
    $("tr, li, .result, .results, .archive, .archive__row").each((_, el) => cand.add(el));
    for (const el of cand) {
      const $row = $(el);
      const text = $row.text().replace(/\s+/g, " ").trim();
      if (!text) continue;
      const dateISO = parseDateHuman(text);
      if (!dateISO) continue;
      const nums = (text.match(/\b\d{1,2}\b/g) || []).map(Number);
      const mains = [], euros = [];
      for (const n of nums) {
        if (mains.length < 5 && n >= 1 && n <= 50) mains.push(n);
        else if (mains.length >= 5 && euros.length < 2 && n >= 1 && n <= 12) euros.push(n);
        if (mains.length === 5 && euros.length === 2) break;
      }
      if (mains.length === 5 && euros.length === 2) {
        mains.sort((a,b)=>a-b); euros.sort((a,b)=>a-b);
        out.push({ date: dateISO, main: mains, euro: euros });
      }
    }
    console.log(`Year ${year}: parsed ${out.length}`);
    return out;
  } catch (e) {
    console.warn(`Archive ${year} error:`, e?.message || e);
    return [];
  }
}

async function main() {
  const now = new Date();
  const meta = {
    source: "eurojackpot.net (scrape) + lottoland.com (jackpot)",
    generatedAt: now.toISOString(),
    nextJackpotEUR: null,
  };

  // jackpot
  meta.nextJackpotEUR = await fetchNextJackpotEUR();
  console.log("nextJackpotEUR:", meta.nextJackpotEUR);

  // roky
  const years = Array.from({length: YEARS_BACK}, (_,i)=> now.getFullYear()-i);

  let draws = [];
  for (const y of years) {
    const d = await fetchYear(y);
    draws = draws.concat(d);
  }

  draws = uniqBy(draws, d => d.date).filter(validDraw)
    .sort((a,b)=> a.date<b.date ? -1 : a.date>b.date ? 1 : 0);

  const out = { meta, draws };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Saved ${draws.length} draws → ${OUT_FILE}`);

  // vždy success – aj keď je draws prázdny
  process.exit(0);
}

main().catch(async (e) => {
  console.error("FATAL:", e?.stack || e);
  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(
      OUT_FILE,
      JSON.stringify({ meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null }, draws: [] }, null, 2),
      "utf8"
    );
    console.log("Wrote empty feed.json after fatal error.");
    process.exit(0);
  } catch {
    process.exit(0);
  }
});

