// fetch.js  — generuje ./public/feed.json
// Node >= 20 (global fetch), "type":"module" v package.json
import fs from "node:fs/promises";
import path from "node:path";
import cheerio from "cheerio";

const YEARS_BACK = 10; // koľko rokov dozadu ťahať archív
const OUT_DIR = "public";
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// Primárne zdroje
const NEXT_API = "https://media.lottoland.com/api/drawings/euroJackpot"; // JSON (last/next)
const ARCHIVE_YEAR = (y) =>
  `https://www.euro-jackpot.net/en/results-archive-${y}`;

// ----------------- helpers -----------------

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
  // napr. "Friday 22 August 2025" alebo "22 August 2025"
  const m = s.trim().toLowerCase().match(
    /(\d{1,2})\s+([a-z]+)\s+(\d{4})/
  );
  if (!m) return null;
  const day = Number(m[1]);
  const mon = monthMap[m[2]];
  const year = Number(m[3]);
  if (!mon) return null;
  return toISO(year, mon, day);
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function validDraw(d) {
  if (!d || !d.date) return false;
  if (!Array.isArray(d.main) || !Array.isArray(d.euro)) return false;
  if (d.main.length !== 5 || d.euro.length !== 2) return false;
  // rozsahy
  if (d.main.some((n) => n < 1 || n > 50)) return false;
  if (d.euro.some((n) => n < 1 || n > 12)) return false;
  return true;
}

// ----------------- fetch next jackpot -----------------

async function fetchNextJackpotEUR() {
  try {
    const r = await fetch(NEXT_API, { headers: { "User-Agent": "EJ-Guru/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    // štruktúra býva: { next: { date, jackpot: { value: 61000000, currency: "EUR" } } }
    const v =
      j?.next?.jackpot?.value ??
      j?.next?.jackpot ??
      j?.next?.estimatedJackpot ??
      null;
    if (typeof v === "number") return Math.round(v);
    return null;
  } catch {
    return null;
  }
}

// ----------------- scrape archive per year -----------------

async function fetchYear(year) {
  const url = ARCHIVE_YEAR(year);
  const r = await fetch(url, { headers: { "User-Agent": "EJ-Guru/1.0" } });
  if (!r.ok) {
    console.warn(`Archive ${year}: HTTP ${r.status}`);
    return [];
  }
  const html = await r.text();
  const $ = cheerio.load(html);

  const out = [];

  // Stránka euro-jackpot.net používa archívnu tabuľku/zoznam po riadkoch.
  // Zoberieme elementy, ktoré zrejme reprezentujú jeden ťah.
  // Budeme hľadať: text s dátumom + 7 čísel (5+2).
  // - rada: pre istotu prebehneme všetky riadky s <tr> a aj bloky s class obsahujúcou "result" alebo "archive".
  const candidates = new Set();

  $("tr, li, .result, .results, .archive, .archive__row").each((_, el) => {
    candidates.add(el);
  });

  for (const el of candidates) {
    const $row = $(el);
    const text = $row.text().replace(/\s+/g, " ").trim();
    if (!text) continue;

    // nájdi dátum
    const dateISO = parseDateHuman(text);
    if (!dateISO) continue;

    // vyber čísla z textu: všetky dvojciferné/jednociferné (max 2 číslice) oddelené medzerami
    const nums = (text.match(/\b\d{1,2}\b/g) || []).map(Number);

    // heuristika: vyber kombináciu 5 čísel v 1..50 + 2 čísel v 1..12 v poradí výskytu
    const mains = [];
    const euros = [];
    for (const n of nums) {
      if (mains.length < 5 && n >= 1 && n <= 50) {
        mains.push(n);
      } else if (mains.length >= 5 && euros.length < 2 && n >= 1 && n <= 12) {
        euros.push(n);
      }
      if (mains.length === 5 && euros.length === 2) break;
    }
    if (mains.length === 5 && euros.length === 2) {
      mains.sort((a, b) => a - b);
      euros.sort((a, b) => a - b);
      out.push({ date: dateISO, main: mains, euro: euros });
    }
  }

  return out;
}

// ----------------- main -----------------

async function main() {
  const now = new Date();
  const nextJackpotEUR = await fetchNextJackpotEUR();

  // zozbieraj roky (aktuálny a 9 predtým)
  const years = [];
  for (let i = 0; i < YEARS_BACK; i++) {
    years.push(now.getFullYear() - i);
  }

  let draws = [];
  for (const y of years) {
    const yearDraws = await fetchYear(y);
    draws = draws.concat(yearDraws);
  }

  // odstraň duplicity podľa dátumu
  draws = uniqBy(draws, (d) => d.date);
  // validuj
  draws = draws.filter(validDraw);
  // sort
  draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // výstupný JSON
  const out = {
    meta: {
      source: "eurojackpot.net + lottoland.com (scraped)",
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: nextJackpotEUR ?? null,
    },
    draws,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Saved ${draws.length} draws → ${OUT_FILE} (nextJackpotEUR=${out.meta.nextJackpotEUR ?? "null"})`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

