// fetch.js – TIPOS Eurojackpot -> public/feed.json
// Node 20+, závislost: cheerio ^1.0.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

const OUT_DIR = path.join(process.cwd(), "public");
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// primární zdroje TIPOS
const TIPOS_URLS = [
  "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry",
  "https://www.tipos.sk/loterie/eurojackpot",
];

const REQ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
  Referer: "https://www.google.com/",
  Connection: "keep-alive",
};

const sortNums = (a) => [...a].sort((x, y) => x - y);

// "61 000 000,00 €" | "61 mil. €" -> číslo EUR
function parseEuroAmount(text) {
  if (!text) return null;
  let t = String(text).replace(/\u00A0/g, " ").trim().toLowerCase();

  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|mil\.|million)/i);
  if (mil) {
    const num = parseFloat(mil[1].replace(",", "."));
    if (Number.isFinite(num)) return Math.round(num * 1_000_000);
  }

  const m = t.match(/(\d[\d\s.,]*)/);
  if (m) {
    let s = m[1].trim();
    s = s.replace(/[\s.]/g, "");
    s = s.replace(",", ".");
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
  // 1) volitelné přesměrování přes proměnnou prostředí (pro testy)
  const envUrl = process.env.SOURCE_URL;
  if (envUrl) {
    const res = await fetch(envUrl, { headers: REQ_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${envUrl}`);
    const txt = await res.text();
    // pokud je to rovnou JSON (např. naše feed.json), vrať ho jako „HTML“
    try {
      JSON.parse(txt);
      return `<!--JSON-->\n${txt}`;
    } catch {
      return txt;
    }
  }

  // 2) TIPOS
  let lastErr;
  for (const url of TIPOS_URLS) {
    try {
      const res = await fetch(`${url}?nocache=${Date.now()}`, { headers: REQ_HEADERS, redirect: "follow" });
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

function parseTipos(htmlOrJson) {
  // Pokud je to JSON (naše feed.json), jen ho vrať
  if (htmlOrJson.startsWith("<!--JSON-->")) {
    const json = JSON.parse(htmlOrJson.replace("<!--JSON-->\n", ""));
    return json;
  }

  const $ = cheerio.load(htmlOrJson);

  // datum
  const dateStr =
    $('#results-date .date input[name="date"]').attr("value") ||
    $('#results-date .date input[name="tiposDate"]').attr("value")?.split(",")[0] ||
    "";
  const isoDate = parseSkDate(dateStr);
  if (!isoDate) throw new Error(`Neviem prečítať dátum z "${dateStr}"`);

  // čísla
  const main = [];
  const euro = [];
  $("#results li").each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const valAttr = $li.attr("data-value");
    const raw = (valAttr ?? $li.text()).trim();
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    (isAdditional ? euro : main).push(n);
  });
  if (main.length < 5 || euro.length < 2) {
    throw new Error(`Neočakávaný počet čísel: main=${main} euro=${euro}`);
  }

  // joker (nepovinné)
  const joker = $("#results-joker li label")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("");

  // jackpot
  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').text();
  const nextJackpotEUR = parseEuroAmount(jackpotText);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: nextJackpotEUR ?? null,
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
