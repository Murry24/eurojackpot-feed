// tools/build_history.js
// Node 20+ (ESM), žiadne externé závislosti okrem cheerio (už ho v projekte máš).
// Zoberie archív Eurojackpotu od 2022 po aktuálny rok zo stránky euro-jackpot.net
// a zapíše do data/history.json vo formáte, ktorý používa tvoja appka.

import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { load as cheerioLoad } from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "data");
const OUT_FILE = resolve(OUT_DIR, "history.json");

// roky 2022..aktuálny
const firstYear = 2022;
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => firstYear + i);

// archívne URL (pr. https://www.euro-jackpot.net/results-archive-2024)
const ARCHIVE_URL = (y) => `https://www.euro-jackpot.net/results-archive-${y}`;

// --- pomocné ---
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);

// "Friday 30 December 2022" / "30 December 2022" / "December 30 2022" -> "2022-12-30"
function toISO(dateText) {
  if (!dateText) return null;
  const s = dateText.toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)/g, "$1").trim();

  // varianty: "30 december 2022" alebo "december 30 2022"
  let m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (!m) m = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})$/i);
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

// tolerančný zber 7 čísel z bloku (5 main + 2 euro)
function grabSevenNumbers($scope) {
  const nums = [];
  // typicky sú v <li>/<span> atď.
  $scope.find("li, span, strong, b, em, i, div").each((_, el) => {
    const t = $scope($(el)).text().trim();
    if (/^\d+$/.test(t)) nums.push(parseInt(t, 10));
  });
  // fallback aj z plain textu
  if (nums.length < 7) {
    const raw = $scope.text().replace(/\s+/g, " ");
    const inline = (raw.match(/\b\d+\b/g) || []).map((x) => parseInt(x, 10));
    if (inline.length > nums.length) nums.splice(0, nums.length, ...inline);
  }
  return nums;
}

async function fetchYear(y) {
  const url = ARCHIVE_URL(y);
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);

  const html = await res.text();
  const $ = cheerioLoad(html);

  // nájdi "riadtky/sekcie" s dátumami – stránka ich má v rôznych kontajneroch,
  // preto ideme tolerantne: hľadáme elementy obsahujúce názov mesiaca a potom čísla
  const out = [];
  $("*").each((_, el) => {
    const $el = $(el);
    const txt = $el.text().toLowerCase();
    if (!/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(txt)) {
      return;
    }
    const iso = toISO(txt);
    if (!iso) return;

    const nums = grabSevenNumbers($el);
    if (nums.length >= 7) {
      const main = nums.slice(0, 5).sort((a, b) => a - b);
      const euro = nums.slice(5, 7).sort((a, b) => a - b);
      const mainOk = main.every((n) => n >= 1 && n <= 50);
      const euroOk = euro.every((n) => n >= 1 && n <= 12);
      if (mainOk && euroOk) out.push({ date: iso, main, euro, joker: null });
    }
  });

  // unikát podľa dátumu (posledný zápis vyhráva)
  const byDate = new Map();
  for (const d of out) byDate.set(d.date, d);
  return Array.from(byDate.values());
}

async function main() {
  const all = [];
  for (const y of YEARS) {
    try {
      const arr = await fetchYear(y);
      console.log(`year ${y}: ${arr.length} draws`);
      all.push(...arr);
    } catch (e) {
      console.warn(`year ${y} failed: ${e.message}`);
    }
  }

  // odstrániť nadbytočnosti, budúcnosť a zoradiť
  const today = new Date().toISOString().slice(0, 10);
  const uniq = new Map();
  for (const d of all) {
    if (!d?.date) continue;
    if (d.date > today) continue;
    uniq.set(d.date, d);
  }
  const draws = Array.from(uniq.values()).sort((a, b) => a.date.localeCompare(b.date));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify({ draws }, null, 2) + "\n",
    "utf8"
  );

  console.log(`Wrote ${OUT_FILE} (${draws.length} draws)`);
}

main().catch((e) => {
  console.error("build_history failed:", e);
  process.exit(1);
});
