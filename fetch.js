// fetch.js – builduje public/feed.json zo stránky TIPOS Eurojackpot
// Node 20 má globálne fetch; nepotrebujeme node-fetch.
// Cheerio použijeme cez ESM: import * as cheerio from 'cheerio'

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

const PAGE_URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";

function toInt(x) {
  if (x == null) return null;
  // odstráň medzery, bodky a €; zamen čiarku za bodku
  const clean = String(x).replace(/[^\d,.-]/g, "").replace(",", ".");
  // vezmeme len celé eurá (pred desatinnou čiarkou)
  const m = clean.match(/^(\d+(?:\.\d+)?)/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseMoneyEUR(text) {
  // "61 000 000,00 €" -> 61000000
  const onlyDigits = String(text).replace(/[^\d]/g, "");
  return onlyDigits ? parseInt(onlyDigits, 10) : null;
}

function parseSkDate(d) {
  // "29. 08. 2025" -> "2025-08-29"
  const m = String(d).trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const pad = (s) => s.toString().padStart(2, "0");
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

function sortNums(arr) {
  return [...arr].sort((a, b) => a - b);
}

async function getLatest() {
  const res = await fetch(PAGE_URL, { headers: { "User-Agent": "Mozilla/5.0 (Eurojackpot Feed Builder)" }});
  if (!res.ok) throw new Error(`HTTP ${res.status} at TIPOS`);
  const html = await res.text();

  const $ = cheerio.load(html);

  // Dátum
  const dateStr = $('#results-date .date input[name="date"]').attr("value") || "";
  const isoDate = parseSkDate(dateStr);
  if (!isoDate) throw new Error(`Neviem prečítať dátum z "${dateStr}"`);

  // Čísla
  const main = [];
  const euro = [];

  $('#results li').each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const valAttr = $li.attr("data-value");
    const t = valAttr ?? $li.text();
    const num = parseInt(String(t).trim(), 10);
    if (!Number.isFinite(num)) return;
    if (isAdditional) euro.push(num);
    else main.push(num);
  });

  if (main.length !== 5 || euro.length !== 2) {
    console.warn("Upozornenie: Neočakávaný počet čísel", { main, euro });
  }

  const mainSorted = sortNums(main);
  const euroSorted = sortNums(euro);

  // Joker (nepovinné do feedu, ale vieme pridať)
  const jokerDigits = $('#results-joker li label')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .join("");

  // Jackpot
  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').text();
  const nextJackpotEUR = parseMoneyEUR(jackpotText); // napr. 61000000

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: nextJackpotEUR ?? null,
    },
    draws: [
      {
        date: isoDate,
        main: mainSorted,
        euro: euroSorted,
        // ak chceš joker aj v appke, doplň si políčko do modelu
        joker: jokerDigits || undefined,
      },
    ],
  };
}

async function main() {
  const data = await getLatest();

  const outDir = path.join(process.cwd(), "public");
  const outFile = path.join(outDir, "feed.json");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");
  console.log("Wrote:", outFile);
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
