// fetch.js — vygeneruje public/feed.json (EUROJACKPOT)
// Spúšťané z GitHub Actions; publikuje sa cez GitHub Pages.
//
// 1) Stiahne archívne stránky podľa rokov z euro-jackpot.net
// 2) Skúsi dve stratégie parsovania: (A) cez DOM selektory, (B) regex z celého textu
// 3) Zlúči, odfiltruje staré pravidlá (pred 2022-03-25), uloží public/feed.json
// 4) Fallback: ak by nebolo nič, zapíše ukážkové dáta, aby appka mala čo čítať

import { load } from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";

// --- pomocné ---
async function getHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function toISODate(dateTxt) {
  // skús viac formátov dátumu
  // príklady: "22 March 2025", "22.03.2025", "2025-03-22", "22 March, 2025"
  const tryTxt = String(dateTxt).replace(",", "").trim();
  // 2025-03-22
  if (/^\d{4}-\d{2}-\d{2}$/.test(tryTxt)) return tryTxt;
  // 22.03.2025
  const m1 = tryTxt.match(/^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})$/);
  if (m1) {
    const [ , d, m, y ] = m1;
    const iso = new Date(Number(y), Number(m)-1, Number(d));
    if (!isNaN(+iso)) return iso.toISOString().slice(0,10);
  }
  // 22 March 2025 (angl. názvy mesiacov)
  const iso2 = new Date(tryTxt);
  if (!isNaN(+iso2)) return iso2.toISOString().slice(0,10);
  return null;
}

function pushDraw(out, dateISO, nums) {
  if (!dateISO) return;
  // nums: očakávame aspoň 7 čísel; prvých 5 v 1..50, posledné 2 v 1..12
  if (!Array.isArray(nums) || nums.length < 7) return;
  const main = nums.slice(0,5).map(n => Number(n)).filter(n => n>=1 && n<=50);
  const euro = nums.slice(5,7).map(n => Number(n)).filter(n => n>=1 && n<=12);
  if (main.length !== 5 || euro.length !== 2) return;
  out.push({ date: dateISO, main, euro });
}

// --- stratégia A: DOM selektory ---
function parseWithDom(html) {
  const $ = load(html);
  const out = [];

  // pokus 1: typické kontajnery pre výsledky
  $(".archive .result, .result, .draw, li.result, div.result-row").each((_, el) => {
    const dateTxt =
      $(el).find(".date, time, .draw-date, .result-date").first().text().trim() ||
      $(el).attr("data-date") || "";
    const dateISO = toISODate(dateTxt);

    // čísla v „balls“/„numbers“ elementoch
    const balls = [];
    $(el).find(".balls li, .numbers li, .ball, .result .ball").each((__, li) => {
      const t = $(li).text().trim();
      const n = parseInt(t, 10);
      if (!Number.isNaN(n)) balls.push(n);
    });

    if (dateISO && balls.length >= 7) {
      pushDraw(out, dateISO, balls);
    }
  });

  return out;
}

// --- stratégia B: Regex z celého textu ---
function parseWithRegex(html) {
  const out = [];
  const text = html
    // odstráň skripty/štýly, aby sme mali čistý text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ") // strip tagy
    .replace(/\s+/g, " ")
    .trim();

  // nájdi dátumy a blízko nich 7 čísiel
  const datePatterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,                           // 2025-03-22
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g,               // 22.03.2025
    /\b\d{1,2}\s+[A-Za-z]+\.?\s+\d{4}\b/g               // 22 March 2025 / 22 March. 2025
  ];

  // pre každý match dátumu sa pozrieme dopredu ~200 znakov a vytiahneme 7 čísel
  for (const pat of datePatterns) {
    const re = new RegExp(pat);
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const dateTxt = m[0];
      const dateISO = toISODate(dateTxt);
      if (!dateISO) continue;

      const windowText = text.slice(m.index, m.index + 220); // okno za dátumom
      const nums = [];
      // vytiahni všetky malé celé čísla v okne
      const numRe = /\b\d{1,2}\b/g;
      let nm;
      while ((nm = numRe.exec(windowText)) !== null) {
        const val = parseInt(nm[0], 10);
        nums.push(val);
        if (nums.length >= 10) break; // viac než dosť
      }
      // z týchto čísel skús poskladať prvých 7 ako 5+2
      if (nums.length >= 7) {
        // heuristika: zober prvých 7, potom validuj rozsahy
        pushDraw(out, dateISO, nums.slice(0,7));
      }
    }
  }

  return out;
}

// --- spracovanie jedného roka ---
async function parseYear(year) {
  const url = `https://www.euro-jackpot.net/results-archive-${year}`;
  const html = await getHtml(url);

  let out = parseWithDom(html);

  // ak nič, skús regex
  if (out.length === 0) {
    out = parseWithRegex(html);
  }

  return out;
}

// --- main build ---
async function build() {
  const years = [2022, 2023, 2024, 2025];
  let all = [];
  for (const y of years) {
    try {
      const part = await parseYear(y);
      all = all.concat(part);
      console.log(`Year ${y}: parsed ${part.length} draws`);
    } catch (e) {
      console.warn(`Year ${y}: ${e}`);
    }
  }

  // deduplikácia + sort
  const map = new Map();
  for (const d of all) map.set(`${d.date}|${d.main}|${d.euro}`, d);
  let list = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

  // filter po zmene pravidiel (Euro čísla 1–12, od 2022-03-25)
  list = list.filter(x => x.date >= "2022-03-25");

  // Fallback: ak nič nenašlo, zapíš ukážkový záznam
  if (list.length === 0) {
    console.warn("No draws parsed — writing sample fallback so app can work.");
    list.push({
      date: "2025-08-22",
      main: [1, 12, 23, 34, 45],
      euro: [3, 7]
    });
  }

  mkdirSync("public", { recursive: true });
  writeFileSync("public/feed.json", JSON.stringify(list, null, 2), "utf-8");
  console.log(`Wrote public/feed.json with ${list.length} draws`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});

