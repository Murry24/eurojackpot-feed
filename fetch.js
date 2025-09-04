// fetch.js  — Node 20+, ESM
// Zber kompletných Eurojackpot ťahov od 2022 po aktuálny rok
// a zápis do public/feed.json vo formáte { meta, draws: [...] }

import fs from "node:fs/promises";
import path from "node:path";
import cheerio from "cheerio";

const OUT_DIR = path.resolve("public");
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// Roky od 2022 po aktuálny
const firstYear = 2022;
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => firstYear + i);

// Primárny archív (HTML) – stabilná statická stránka s ročnými prehľadmi
// Príklady:
//   https://www.euro-jackpot.net/results-archive-2022
//   https://www.euro-jackpot.net/results-archive-2023
//   https://www.euro-jackpot.net/results-archive-2024
const ARCHIVE_URL = (y) => `https://www.euro-jackpot.net/results-archive-${y}`;

// TIPOS (len na jackpot; ak padne 404, preskočíme)
const TIPOS_URL = "https://www.tipos.sk/loterie/eurojackpot";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

// "Friday 30 th December 2022" → "2022-12-30"
function parseDateToISO(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)/g, "$1").trim();
  const m = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})$/i) || s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (!m) return null;

  let day, monthName, year;
  if (isNaN(parseInt(m[1], 10))) {
    // "december 30 2022"
    monthName = m[1];
    day = parseInt(m[2], 10);
    year = parseInt(m[3], 10);
  } else {
    // "30 december 2022"
    day = parseInt(m[1], 10);
    monthName = m[2];
    year = parseInt(m[3], 10);
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Z HTML roka vyextrahuj pole {date, main[5], euro[2]}
async function fetchYear(year) {
  const url = ARCHIVE_URL(year);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Archive HTTP ${res.status} at ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];

  // Stránka má tabuľku / karty s výsledkami; budeme tolerantne hľadať:
  // - dátum v texte riadkov
  // - 7 čísel (5 hlavných + 2 euro)
  // Vyhľadáme bloky, kde sú spolu čísla – a doparujeme k najbližšiemu dátumu nad/pri nich.
  // Toto je robustné pre viac layoutov euro-jackpot.net.

  // Kandidáti na "riadky výsledkov" – divy, li, tr
  const rows = $("tr, li, div")
    .filter((_, el) => {
      const txt = $(el).text().toLowerCase();
      return /\b(tuesday|friday|monday|wednesday|thursday|saturday|sunday)\b/.test(txt) ||
             /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(txt);
    });

  rows.each((_, row) => {
    const $row = $(row);
    const text = $row.text().replace(/\s+/g, " ").trim();

    const iso = parseDateToISO(text);
    if (!iso) return;

    // zozbieraj všetky čísla z tohto bloku – typicky 7 alebo viac
    const nums = [];
    $row.find("li, span, strong, b, em, i, div").each((_, el) => {
      const t = $(el).text().trim();
      if (/^\d+$/.test(t)) nums.push(parseInt(t, 10));
    });

    // Ak nič nenašlo, skús aj plain text riadku:
    if (nums.length < 7) {
      const inline = (text.match(/\b\d+\b/g) || []).map((x) => parseInt(x, 10));
      if (inline.length > nums.length) {
        nums.splice(0, nums.length, ...inline);
      }
    }

    // Potrebujeme aspoň 7 čísel (5+2). Niektoré riadky môžu mať duplicitné zápisy – odfiltrujeme.
    if (nums.length >= 7) {
      const main = nums.slice(0, 5).map((n) => +n).sort((a, b) => a - b);
      const euro = nums.slice(5, 7).map((n) => +n).sort((a, b) => a - b);

      // validácia rozsahov
      const mainOk = main.every((n) => n >= 1 && n <= 50);
      const euroOk = euro.every((n) => n >= 1 && n <= 12);
      if (mainOk && euroOk) {
        out.push({ date: iso, main, euro });
      }
    }
  });

  // odstráň duplicitné dátumy (ak sa našli viackrát), nechaj posledný (najplnší) zápis
  const byDate = new Map();
  for (const d of out) byDate.set(d.date, d);
  return Array.from(byDate.values());
}

// Jackpot z TIPOS (voliteľné)
async function fetchTiposJackpotEUR() {
  try {
    const r = await fetch(TIPOS_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    // nájdi label pre Eurojackpot jackpot a vytiahni sumu v €
    // príklad: <label for="EurojackpotPart_Jackpot">61 000 000,00 €</label>
    const lab = $("#EurojackpotPart_Jackpot").text().trim() ||
                $('label[for="EurojackpotPart_Jackpot"]').text().trim() ||
                $("li.winner-jackpot strong label").first().text().trim();

    if (!lab) return null;
    const digits = lab.replace(/[^\d]/g, ""); // "61000000"
    if (!digits) return null;
    return parseInt(digits, 10);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`[fetch] building archive ${firstYear}..${thisYear}`);

  // 1) načítaj všetky roky
  const all = [];
  for (const y of YEARS) {
    try {
      const yr = await fetchYear(y);
      console.log(`[fetch] year ${y}: ${yr.length} draws`);
      all.push(...yr);
    } catch (e) {
      console.warn(`[fetch] year ${y} failed: ${e}`);
    }
  }

  // 2) zoradiť ASC podľa dátumu a vyhodiť záznamy po dnešku
  const today = new Date().toISOString().slice(0, 10);
  const uniq = new Map(); // podľa date
  for (const d of all) {
    if (!d?.date) continue;
    if (d.date > today) continue;
    uniq.set(d.date, d);
  }
  const draws = Array.from(uniq.values()).sort((a, b) => a.date.localeCompare(b.date));

  // 3) jackpot (voliteľne, neblokuje zápis)
  let nextJackpotEUR = null;
  try {
    nextJackpotEUR = await fetchTiposJackpotEUR();
  } catch {
    nextJackpotEUR = null;
  }

  // 4) zapis
  await fs.mkdir(OUT_DIR, { recursive: true });
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: nextJackpotEUR, // môže byť null
      source: "euro-jackpot.net",
    },
    draws,
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE} with ${draws.length} draws`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

