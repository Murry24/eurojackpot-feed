// fetch.js  — Node 20+, package.json má "type":"module", dep: cheerio
import fs from "node:fs/promises";
import path from "node:path";
import cheerio from "cheerio";

const YEARS_BACK = 10;                 // koľko rokov dozadu scrapovať archív
const OUT_DIR = "public";
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// Zdroje
const LOTTO_JSON = "https://media.lottoland.com/api/drawings/euroJackpot";
const EJ_ARCHIVE = (y) => `https://www.euro-jackpot.net/en/results-archive-${y}`;
const EJ_RESULTS_PAGE = (p) => `https://www.euro-jackpot.net/en/results?p=${p}`;

// --- utils -------------------------------------------------------------------

const H = { "User-Agent": "EuroJackpot-Guru/1.0 (+github actions)", "Accept-Language": "en" };

const monthMap = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const toISO = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function parseHumanDate(text) {
  const t = text.toLowerCase().replace(/,/g, " ");
  // 22 August 2025
  let m = t.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (m) {
    const day = +m[1], mon = monthMap[m[2]] || 0, year = +m[3];
    if (day && mon && year) return toISO(year, mon, day);
  }
  // 22/08/2025 alebo 22.08.2025
  m = t.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (m) {
    const day = +m[1], mon = +m[2], year = +m[3];
    if (day && mon && year) return toISO(year, mon, day);
  }
  return null;
}
const uniqBy = (arr, key) => {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
};
function validDraw(d) {
  return d && d.date && Array.isArray(d.main) && Array.isArray(d.euro)
    && d.main.length === 5 && d.euro.length === 2
    && d.main.every(n => n>=1 && n<=50) && d.euro.every(n => n>=1 && n<=12);
}
function normalize(main, euro) {
  const m = [...new Set(main.map(Number))].sort((a,b)=>a-b);
  const e = [...new Set(euro.map(Number))].sort((a,b)=>a-b);
  return { m, e };
}
function tryAdd(list, date, main, euro) {
  const { m, e } = normalize(main, euro);
  const d = { date, main: m, euro: e };
  if (validDraw(d)) list.push(d);
}

// --- 1) jackpot + posledný ťah z JSON ---------------------------------------

async function fetchLottolandJson() {
  try {
    const r = await fetch(LOTTO_JSON, { headers: H });
    if (!r.ok) { console.warn("Lottoland HTTP:", r.status); return { jackpot: null, last: null }; }
    const j = await r.json();

    const jackpot =
      j?.next?.jackpot?.value ??
      j?.next?.jackpot ??
      j?.next?.estimatedJackpot ?? null;
    let nextJackpotEUR = typeof jackpot === "number" ? Math.round(jackpot) : null;

    let last = null;
    if (j?.last) {
      // známe polia bývajú: j.last.date, j.last.numbers[], j.last.euroNumbers[]
      const ds = (j.last.date || j.last.drawingDate || "").toString();
      const dateISO = ds.length >= 10 ? ds.slice(0, 10) : parseHumanDate(ds);
      const main = j.last.numbers || j.last.winningNumbers || [];
      const euro = j.last.euroNumbers || j.last.additionalNumbers || [];
      if (dateISO) {
        const d = { date: dateISO, main: (main||[]).map(Number), euro: (euro||[]).map(Number) };
        if (validDraw(d)) last = d;
      }
    }
    return { jackpot: nextJackpotEUR, last };
  } catch (e) {
    console.warn("Lottoland error:", e?.message || e);
    return { jackpot: null, last: null };
  }
}

// --- 2) archív podľa rokov ---------------------------------------------------

function parseArchiveHtml(html) {
  const $ = cheerio.load(html);
  const out = [];
  // Skús rôzne štruktúry
  const rows = $('tr, .archive__row, .result, .results-list__item').toArray();
  for (const el of rows) {
    const $row = $(el);
    const text = $row.text().replace(/\s+/g, " ").trim();
    const dateISO = parseHumanDate(text);
    if (!dateISO) continue;

    // Pokus 1: čísla v balíčkoch .ball / .euro-ball
    const balls = $row.find('.ball, .lottery-ball, .result__ball, .results-ball').toArray().map(b => +$(b).text().trim()).filter(Number.isFinite);
    const euroBalls = $row.find('.euro, .euro-ball, .result__euro, .results-euro').toArray().map(b => +$(b).text().trim()).filter(Number.isFinite);

    if (balls.length >= 5 && euroBalls.length >= 2) {
      tryAdd(out, dateISO, balls.slice(0,5), euroBalls.slice(0,2));
      continue;
    }

    // Pokus 2: bruteforce – vezmi všetky 1–2 ciferné čísla z riadku, vyber 5 + 2 podľa rozsahov
    const nums = (text.match(/\b\d{1,2}\b/g) || []).map(Number);
    const main = []; const euro = [];
    for (const n of nums) {
      if (main.length < 5 && n>=1 && n<=50) main.push(n);
      else if (main.length >= 5 && euro.length < 2 && n>=1 && n<=12) euro.push(n);
      if (main.length === 5 && euro.length === 2) break;
    }
    if (main.length === 5 && euro.length === 2) {
      tryAdd(out, dateISO, main, euro);
    }
  }
  return out;
}

async function fetchArchiveYear(year) {
  const url = EJ_ARCHIVE(year);
  try {
    const r = await fetch(url, { headers: H });
    if (!r.ok) { console.warn(`Archive ${year} HTTP:`, r.status); return []; }
    const html = await r.text();
    const arr = parseArchiveHtml(html);
    console.log(`Archive ${year}: ${arr.length}`);
    return arr;
  } catch (e) {
    console.warn(`Archive ${year} error:`, e?.message || e);
    return [];
  }
}

// --- 3) fallback – stránkované "results" -------------------------------------

async function fetchResultsPages(maxPages = 8) {
  let list = [];
  for (let p = 1; p <= maxPages; p++) {
    const url = EJ_RESULTS_PAGE(p);
    try {
      const r = await fetch(url, { headers: H });
      if (!r.ok) { console.warn(`Results page ${p} HTTP:`, r.status); continue; }
      const html = await r.text();
      const arr = parseArchiveHtml(html);
      console.log(`Results page ${p}: ${arr.length}`);
      list = list.concat(arr);
    } catch (e) {
      console.warn(`Results page ${p} error:`, e?.message || e);
    }
  }
  return list;
}

// --- main --------------------------------------------------------------------

async function main() {
  const meta = {
    source: "euro-jackpot.net (scrape) + lottoland.com (jackpot/last)",
    generatedAt: new Date().toISOString(),
    nextJackpotEUR: null,
  };

  // 1) jackpot + last
  const l = await fetchLottolandJson();
  meta.nextJackpotEUR = l.jackpot ?? null;

  // 2) archív rokov
  const yearNow = new Date().getFullYear();
  let draws = [];
  for (let i = 0; i < YEARS_BACK; i++) {
    const y = yearNow - i;
    const arr = await fetchArchiveYear(y);
    draws = draws.concat(arr);
  }

  // 3) fallback – ak archív dal málo, dohoď “results” strany
  if (draws.length < 50) { // arbitráž: málo údajov → skús fallback
    const more = await fetchResultsPages(10);
    draws = draws.concat(more);
  }

  // 4) pridaj aspoň posledný ťah z JSON, ak chýba rovnaký dátum
  if (l.last) {
    const exists = draws.some(d => d.date === l.last.date);
    if (!exists) draws.push(l.last);
  }

  // 5) deduplikácia + validácia + zoradenie
  draws = uniqBy(draws, d => d.date).filter(validDraw)
    .sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({ meta, draws }, null, 2), "utf8");
  console.log(`Saved ${draws.length} draws → ${OUT_FILE}`);
  process.exit(0);
}

// airbag — ak by sa stalo čokoľvek, vždy vytvorme minimálny feed
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
  } finally {
    process.exit(0);
  }
});

