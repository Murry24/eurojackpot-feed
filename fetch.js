// fetch.js  — Node 18+/20+ (ESM). Nepotrebuje "node-fetch"; používa vstavaný global fetch.

import { writeFile, readFile, access, mkdir } from "fs/promises";
import { constants as FS } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { load as cheerioLoad } from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "public");
const OUT = resolve(OUT_DIR, "feed.json");
const HISTORY = resolve(__dirname, "data/history.json");

// TIPOS – posledné žrebovanie (verejná stránka s HTML)
const TIPOS_URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";

/* ----------------------------- Pomocné funkcie ---------------------------- */

function parseSkDateToISO(text) {
  // očakávané formáty: "29. 08. 2025" alebo "29.08.2025"
  if (!text) return null;
  const m = text.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (!m) return null;
  const [_, d, mo, y] = m;
  const dd = String(parseInt(d, 10)).padStart(2, "0");
  const mm = String(parseInt(mo, 10)).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function moneyTextToIntEUR(text) {
  // "61 000 000,00 €" -> 61000000 (integer EUR)
  if (!text) return null;
  const cleaned = text
    .replace(/\u00A0/g, " ")    // pevné medzery
    .replace(/\s/g, "")         // všetky medzery
    .replace(/[€]/g, "")        // znak eur
    .replace(/\./g, "")         // prípadné bodky
    .replace(/,/g, ".");        // slovenská desatinná čiarka -> bodka

  const val = Number(cleaned);
  if (Number.isFinite(val)) return Math.round(val); // bezpečne na celé eurá
  return null;
}

async function fileExists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- Scraper TIPOS ------------------------------ */

async function getLatestFromTipos() {
  const r = await fetch(TIPOS_URL, { redirect: "follow" });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} at TIPOS`);
  }
  const html = await r.text();
  const $ = cheerioLoad(html);

  // dátum
  const dateRaw =
    $("#results-date input[name='date']").attr("value") ||
    $(".box-top #results-date input[name='date']").attr("value") ||
    $("input#results-date").attr("value") ||
    "";
  const dateISO = parseSkDateToISO(dateRaw);

  // čísla (main + euro)
  const main = [];
  const euro = [];
  $("#results li").each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const v = Number($li.attr("data-value"));
    if (!Number.isFinite(v)) return;
    if (isAdditional) euro.push(v);
    else main.push(v);
  });
  main.sort((a, b) => a - b);
  euro.sort((a, b) => a - b);

  // Joker (šesť číslic)
  const jokerDigits = [];
  $("#results-joker li label").each((_, el) => {
    const t = $(el).text().trim();
    if (/^\d$/.test(t)) jokerDigits.push(t);
  });
  const joker = jokerDigits.join("") || null;

  // Jackpot
  const jackpotText =
    $(".winner-jackpot label").first().text().trim() ||
    $(".winner-jackpot strong label").first().text().trim();
  const nextJackpotEUR = moneyTextToIntEUR(jackpotText);

  return {
    dateISO,
    main,
    euro,
    joker,
    nextJackpotEUR,
  };
}

/* ----------------------------- Hlavná logika ----------------------------- */

async function main() {
  let latest = null;

  try {
    latest = await getLatestFromTipos();
  } catch (e) {
    console.error("[fetch] failed:", e.message);
  }

  // priprav výstupnú štruktúru
  const feed = {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: latest?.nextJackpotEUR ?? null,
      source: "tipos",
    },
    draws: [],
  };

  // 1) Ak existuje lokálna história, načítaj ju a pridaj do výstupu
  if (await fileExists(HISTORY)) {
    try {
      const raw = await readFile(HISTORY, "utf8");
      const hist = JSON.parse(raw);
      if (Array.isArray(hist.draws)) {
        feed.draws.push(
          ...hist.draws.map((d) => ({
            date: d.date,           // očakáva ISO "YYYY-MM-DD"
            main: d.main ?? [],
            euro: d.euro ?? [],
            joker: d.joker ?? null,
          }))
        );
      }
    } catch (e) {
      console.warn("[fetch] history merge skipped:", e.message);
    }
  }

  // 2) Pridaj najnovší ťah z TIPOS (ak sa podaril) – vyhne sa duplicite podľa dátumu
  if (latest?.dateISO && latest.main?.length === 5 && latest.euro?.length === 2) {
    const exists = feed.draws.some((d) => d.date === latest.dateISO);
    if (!exists) {
      feed.draws.push({
        date: latest.dateISO,
        main: latest.main,
        euro: latest.euro,
        joker: latest.joker,
      });
    }
  }

  // garantuj zoradenie podľa dátumu (vzostupne)
  feed.draws.sort((a, b) => a.date.localeCompare(b.date));

  // vytvor public/ a zapíš JSON
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n", "utf8");

  console.log("Wrote", OUT);
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exitCode = 1;
});
