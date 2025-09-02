// fetch.js
// Node 20+, "type": "module" v package.json
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fetch from "node-fetch";
import cheerio from "cheerio";

// === KONFIG ===
// 1) Nastav a otestuj stabilný zdroj.
// Dočasne nechávam TODO – len sem vlož URL, ktorá vracia posledný ťah a jackpot.
// IDEÁLNE: JSON feed. Ak máš HTML stránku, vieme ju parse-nuť v parseHtmlResults().
const SOURCE_URL = process.env.SOURCE_URL ?? "https://example.com/YOUR-LIVE-SOURCE"; // TODO
// Kam generujeme feed pre GitHub Pages:
const OUT_DIR = "public";
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// Pomocná cesta na predchádzajúci feed (fallback)
const PREV_FILE = OUT_FILE;

// === POMOCNÉ FUNKCIE ===
function isoNow() {
  return new Date().toISOString();
}

// Ak zdroj vracia JSON, prispôsob tento mapper svojmu formátu:
function mapJsonToFeed(json) {
  // OČAKÁVANÝ VÝSTUP:
  // {
  //   meta: { generatedAt: ISO8601, nextJackpotEUR: number|null },
  //   draws: [{ date: "YYYY-MM-DD", main: [5 čísel], euro: [2 čísla] }, ...]
  // }

  // ---- PRÍKLAD MAPPERU (uprav podľa skutočného JSON) ----
  const last = json.lastDraw ?? json.draw ?? json.result ?? null;
  const jp   = json.nextJackpot ?? json.jackpot ?? null;

  if (!last) throw new Error("Zdroj JSON neobsahuje posledný ťah (lastDraw).");

  // Prispôsob poliam:
  const dateStr = last.date ?? last.drawDate; // napr. "2025-08-29"
  const main = last.main ?? last.numbers ?? [];
  const euro = last.euro ?? last.stars ?? last.euronumbers ?? [];

  return {
    meta: {
      generatedAt: isoNow(),
      nextJackpotEUR: jp == null ? null : Number(jp),
    },
    draws: [
      {
        date: dateStr,           // "YYYY-MM-DD"
        main: main.map(Number).sort((a,b)=>a-b),
        euro: euro.map(Number).sort((a,b)=>a-b),
      },
    ],
  };
}

// Ak máš len HTML stránku, uprav tu CSS selektory / regex:
function mapHtmlToFeed(html) {
  const $ = cheerio.load(html);

  // ---- TU SI UPRAV SELEKTORY PODĽA CIEĽA ----
  // Príklad – hľadáme 5 hlavných a 2 euro čísla:
  const main = [];
  const euro = [];

  // PRÍKLAD: $(".main .ball").each((_,el)=> main.push(Number($(el).text().trim())));
  // PRÍKLAD: $(".euro .ball").each((_,el)=> euro.push(Number($(el).text().trim())));

  // PRÍKLAD dátumu a jackpotu:
  // const dateStr = $("time.result-date").attr("datetime")?.slice(0,10) || $("time").first().text().trim();

  // === DOČASNÉ: ak nemáš hotové selektory, hoď sem fixný mini-fallback na otestovanie workflowu ===
  if (main.length === 0 || euro.length === 0) {
    throw new Error("HTML parser nenašiel žrebovanie – uprav selektory v mapHtmlToFeed().");
  }

  const dateStr = new Date().toISOString().slice(0,10);

  // Jackpot – nech je aspoň null, kým ho neparsuješ:
  const nextJackpotEUR = null;

  return {
    meta: { generatedAt: isoNow(), nextJackpotEUR },
    draws: [{ date: dateStr, main: main.sort((a,b)=>a-b), euro: euro.sort((a,b)=>a-b) }],
  };
}

async function downloadLive() {
  const r = await fetch(SOURCE_URL, { headers: { "user-agent": "eurojackpot-feed/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  const ct = r.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const j = await r.json();
    return mapJsonToFeed(j);
  } else {
    const html = await r.text();
    return mapHtmlToFeed(html);
  }
}

async function readPrevFeed() {
  try {
    const txt = await fs.readFile(PREV_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function validateFeed(feed) {
  if (!feed?.meta || !Array.isArray(feed.draws)) throw new Error("Neplatný feed objekt.");
  const d = feed.draws[0];
  if (!d?.date || !Array.isArray(d.main) || !Array.isArray(d.euro)) throw new Error("Neplatný záznam ťahu.");
  if (d.main.length !== 5 || d.euro.length !== 2) throw new Error("Zlý počet čísel (očakávané 5 + 2).");
}

async function main() {
  const prev = await readPrevFeed();

  let feed;
  try {
    feed = await downloadLive();
    validateFeed(feed);
    // Ak máme staršie ťahy uložené, prependneme ich (voliteľné)
    if (prev?.draws?.length) {
      const newDate = feed.draws[0].date;
      const rest = prev.draws.filter(x => x.date !== newDate);
      feed.draws = [...feed.draws, ...rest].slice(0, 50); // udržuj napr. 50 ťahov
      if (feed.meta.nextJackpotEUR == null && prev.meta?.nextJackpotEUR != null) {
        feed.meta.nextJackpotEUR = prev.meta.nextJackpotEUR;
      }
    }
  } catch (e) {
    if (!prev) throw e; // prvý build musí prejsť
    // fallback – necháme posledný platný feed, len aktualizujeme generatedAt
    feed = { ...prev, meta: { ...prev.meta, generatedAt: isoNow() } };
    console.log("WARN: live zdroj zlyhal, použijem fallback posledný feed:", e.message);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(feed, null, 2), "utf8");
  console.log("OK: feed.json napísaný do", OUT_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
