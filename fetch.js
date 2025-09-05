cd C:\Users\maury\eurojackpot-feed
@'
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

const OUT_DIR = path.join(process.cwd(), "public");
const OUT_FILE = path.join(OUT_DIR, "feed.json");

const TIPOS_URLS = [
  `https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry?nocache=${Date.now()}`,
  `https://www.tipos.sk/loterie/eurojackpot?nocache=${Date.now()}`,
];

const REQ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
  Referer: "https://www.google.com/",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const sortNums = (a) => [...a].sort((x, y) => x - y);

function parseEuroAmount(text) {
  if (!text) return null;
  let t = String(text).replace(/\u00A0/g, " ").trim().toLowerCase();

  // „61 mil.“ / „61 million“
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|mil\.|million)/i);
  if (mil) {
    const num = parseFloat(mil[1].replace(",", "."));
    if (Number.isFinite(num)) return Math.round(num * 1_000_000);
  }

  // „61 000 000,00“ / „61.000.000,00“ / „61 000 000.00“
  const m = t.match(/(\d[\d\s.,]*)/);
  if (m) {
    let s = m[1].trim();
    s = s.replace(/[\s.]/g, ""); // tisícové oddeľovače preč
    s = s.replace(",", ".");     // čiarku na bodku
    const val = parseFloat(s);
    if (Number.isFinite(val)) return Math.round(val);
  }
  return null;
}

function parseSkDate(d) {
  const m = String(d).trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const pad = (s) => s.toString().padStart(2, "0");
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

async function fetchHtmlWithFallback() {
  let lastErr;
  for (const url of TIPOS_URLS) {
    try {
      const res = await fetch(url, { headers: REQ_HEADERS, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
      const html = await res.text();
      if (!html || html.length < 1000) throw new Error(`Too short HTML at ${url}`);
      return html;
    } catch (e) {
      lastErr = e;
      console.warn("[TIPOS] fallback, failed:", e.message);
    }
  }
  throw lastErr || new Error("No TIPOS URL worked");
}

function parseTipos(html) {
  const $ = cheerio.load(html);

  const dateStr =
    $('#results-date .date input[name="date"]').attr("value") ||
    $('#results-date .date input[name="tiposDate"]').attr("value")?.split(",")[0] ||
    "";
  const isoDate = parseSkDate(dateStr);
  if (!isoDate) throw new Error(`Neviem prečítať dátum z "${dateStr}"`);

  const main = [];
  const euro = [];
  $("#results li").each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const raw = ($li.attr("data-value") ?? $li.text()).trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    (isAdditional ? euro : main).push(n);
  });

  if (main.length < 5 || euro.length < 2) {
    throw new Error(`Neočakávaný počet čísel: main=${main} euro=${euro}`);
  }

  const joker = $("#results-joker li label")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("");

  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').text();
  const nextJackpotEUR = parseEuroAmount(jackpotText);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: Number.isFinite(nextJackpotEUR) ? nextJackpotEUR : null,
      source: "tipos",
    },
    draws: [
      {
        date: isoDate,
        main: sortNums(main).slice(0, 5),
        euro: sortNums(euro).slice(0, 2),
        ...(joker ? { joker } : {}),
      },
    ],
  };
}

// JSON fallback (tvoj Pages feed), keď TIPOS zlyhá
async function fetchJsonFallback() {
  const alt = process.env.SOURCE_URL || "https://murry24.github.io/eurojackpot-feed/feed.json";
  try {
    const r = await fetch(alt, { headers: REQ_HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status} at ${alt}`);
    const j = await r.json();
    if (!j?.draws?.length) throw new Error("No draws in fallback JSON");
    // označ, že ide o fallback zdroj
    j.meta = { ...(j.meta || {}), source: "fallback-json" };
    console.warn("[fallback JSON] using:", alt);
    return j;
  } catch (e) {
    console.warn("[fallback JSON] failed:", e.message);
    return null;
  }
}

async function writeJsonSafe(obj) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(obj, null, 2), "utf8");
  console.log("Wrote", OUT_FILE);
}

async function main() {
  try {
    const html = await fetchHtmlWithFallback();
    const data = parseTipos(html);
    await writeJsonSafe(data);
  } catch (e) {
    console.error("Build failed (TIPOS):", e.message);
    const fb = await fetchJsonFallback();
    if (fb) {
      await writeJsonSafe(fb);
      return;
    }
    try {
      const prev = await fs.readFile(OUT_FILE, "utf8");
      console.warn("Keeping previous public/feed.json (fallback).");
      await fs.writeFile(OUT_FILE, prev, "utf8");
    } catch {
      const empty = {
        meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null, source: "fallback-empty" },
        draws: [],
      };
      await writeJsonSafe(empty);
    }
  }
}
main();
'@ | Set-Content -Encoding UTF8 .\fetch.js
