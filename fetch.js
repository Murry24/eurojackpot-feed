// fetch.js — jednoduchý scraper výsledkov Eurojackpotu
// Používa: Node 20 (global fetch) + cheerio
// Výstup uloží do: data/latest.json

import fs from "fs/promises";
import path from "path";
import cheerio from "cheerio";

// 1) Zdrojová stránka s výsledkami.
// Nastav si vlastný zdroj cez premennú prostredia FEED_URL (v GitHub Action nižšie).
const FEED_URL = process.env.FEED_URL || "https://www.eurojackpot.org/en/results/";

// 2) Pomocná funkcia: uloženie JSON
async function saveJSON(obj, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(obj, null, 2), "utf8");
  console.log("Saved:", outPath);
}

function parseNumbersFromHtml(html) {
  const $ = cheerio.load(html);

  // --- PRÍKLAD PARSOVANIA ---
  // Toto je univerzálna logika, ktorá hľadá „guľôčky“ s číslami a skúsi z nich poskladať 5 + 2.
  // Ak má tvoja zdrojová stránka konkrétne selektory (napr. .ball, .euro-ball), uprav tu.
  const allNums = [];

  // Vezmeme text z elementov, ktoré často obsahujú čísla žrebov
  $("*, *:before, *:after").each((_, el) => {
    const t = $(el).text().trim();
    if (!t) return;
    // zachyť 1–2 ciferné čísla ako samostatné tokeny
    const matches = t.match(/\b\d{1,2}\b/g);
    if (matches) {
      matches.forEach(n => allNums.push(Number(n)));
    }
  });

  // Heuristika: nájdi okno, kde je 5 čísel (1–50) + hneď po ňom 2 „euro“ čísla (1–12).
  // Pre jednoduchosť berieme prvú takúto postupnosť.
  for (let i = 0; i + 6 < allNums.length; i++) {
    const five = allNums.slice(i, i + 5);
    const two = allNums.slice(i + 5, i + 7);
    const okFive = five.every(n => n >= 1 && n <= 50);
    const okTwo = two.every(n => n >= 1 && n <= 12);
    if (okFive && okTwo) {
      return {
        numbers: five.sort((a, b) => a - b),
        euroNumbers: two.sort((a, b) => a - b)
      };
    }
  }

  // Ak nič nenašlo, vráť prázdny výsledok (uprav selektory vyššie)
  return { numbers: [], euroNumbers: [] };
}

(async () => {
  console.log("Fetching:", FEED_URL);
  const res = await fetch(FEED_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; eurojackpot-feed/1.0)" }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

  const html = await res.text();
  const parsed = parseNumbersFromHtml(html);

  const out = {
    source: FEED_URL,
    fetchedAt: new Date().toISOString(),
    ...parsed
  };

  await saveJSON(out, "data/latest.json");
})();
