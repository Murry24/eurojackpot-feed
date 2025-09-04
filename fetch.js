// fetch.js – Node 20+, bez externých závislostí
// Sťahuje posledný výsledok a jackpot z TIPOS, spojí s data/history.json,
// zoradí a zapíše do public/feed.json

import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

// ------- Nastavenia zdrojov ------- //
const TIPOS_URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";

// ------- Pomocné funkcie ------- //
function toISODateFromSk(s) {
  // "29. 08. 2025" -> "2025-08-29"
  const m = s.match(/(\d{2})\.\s*(\d{2})\.\s*(\d{4})/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function parseMoneyEUR(str) {
  // "61 000 000,00 €" -> 61000000
  if (!str) return null;
  const hasComma = str.includes(",");
  const digits = str.replace(/[^\d]/g, ""); // len číslice
  if (!digits) return null;
  if (hasComma) {
    // posledné 2 sú desatinné miesta
    if (digits.length <= 2) return 0;
    return Math.round(Number(digits.slice(0, -2)));
  }
  return Number(digits);
}

function uniqueByDate(draws) {
  const map = new Map();
  for (const d of draws) map.set(d.date, d);
  return [...map.values()];
}

function sortByDateAsc(draws) {
  return draws.sort((a, b) => a.date.localeCompare(b.date));
}

// ------- Parsovanie TIPOS HTML ------- //
function parseTipos(html) {
  // Dátum
  const dateInput = html.match(
    /<div id="results-date"[\s\S]*?<input[^>]*name="date"[^>]*value="([^"]+)"/
  );
  const isoDate = dateInput ? toISODateFromSk(dateInput[1]) : null;

  // UL výsledkov – vyberieme blok a z neho čísla
  const ulMatch = html.match(/<ul id="results"[^>]*>([\s\S]*?)<\/ul>/);
  if (!ulMatch) throw new Error("UL #results not found");
  const ul = ulMatch[1];

  const values = [...ul.matchAll(/data-value="(\d+)"/g)].map((m) => Number(m[1]));
  if (values.length < 7) {
    throw new Error(`Not enough numbers in UL: got ${values.length}`);
  }
  const main = values.slice(0, 5).sort((a, b) => a - b);
  const euro = values.slice(-2).sort((a, b) => a - b);

  // Joker (voliteľný)
  let joker = null;
  const jokerBlock = html.match(/<ul id="results-joker"[^>]*>([\s\S]*?)<\/ul>/);
  if (jokerBlock) {
    const jnums = [...jokerBlock[1].matchAll(/<label[^>]*>(\d)<\/label>/g)].map(
      (m) => m[1]
    );
    if (jnums.length >= 6) {
      joker = jnums.join("").slice(0, 6);
    }
  }

  // Jackpot
  const jackMatch = html.match(
    /<label[^>]*for="EurojackpotPart_Jackpot"[^>]*>([^<]+)<\/label>/
  );
  const nextJackpotEUR = parseMoneyEUR(jackMatch ? jackMatch[1] : null);

  if (!isoDate) throw new Error("Draw date not found");

  return {
    date: isoDate,
    main,
    euro,
    joker,
    nextJackpotEUR: Number.isFinite(nextJackpotEUR) ? nextJackpotEUR : null,
  };
}

// ------- Hlavná logika ------- //
async function getLatest() {
  const resp = await fetch(TIPOS_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
      "accept-language": "sk,en;q=0.8",
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} at TIPOS`);
  }

  const html = await resp.text();
  return parseTipos(html);
}

async function readHistory() {
  try {
    const raw = await readFile(resolve("data/history.json"), "utf8");
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.draws)) return j.draws;
  } catch (_) {
    // ignoruj – história nie je povinná
  }
  return [];
}

async function main() {
  const outPath = resolve("public/feed.json");
  await mkdir(resolve("public"), { recursive: true });

  let latest;
  try {
    latest = await getLatest();
  } catch (e) {
    console.error("[fetch] TIPOS failed:", e.message);
    // Ak by si chcel mať fallback, môžeš ho sem doplniť.
    // Zatiaľ necháme skončiť s chybou, nech je to viditeľné v Actions.
    throw e;
  }

  const history = await readHistory();

  const draws = uniqueByDate(
    sortByDateAsc([
      ...history.map((d) => ({
        date: d.date,
        main: d.main.slice().sort((a, b) => a - b),
        euro: d.euro.slice().sort((a, b) => a - b),
        joker: d.joker ?? null,
      })),
      {
        date: latest.date,
        main: latest.main,
        euro: latest.euro,
        joker: latest.joker ?? null,
      },
    ])
  );

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: latest.nextJackpotEUR ?? null,
    },
    draws,
  };

  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
