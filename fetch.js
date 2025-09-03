// fetch.js – TIPOS Eurojackpot -> public/feed.json (presné parsovanie JACKPOTU)
// Node 20+ (fetch je vstavaný). Závislosť: cheerio ^1.0.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

const OUT_DIR = path.join(process.cwd(), "public");
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// TIPOS môže občas vrátiť 404; skúšame 2 URL
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

// --- utils ---
const sortNums = (a) => [...a].sort((x, y) => x - y);

/** Z "29. 08. 2025" -> "2025-08-29" */
function parseSkDate(d) {
  const m = String(d ?? "").trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const pad = (s) => s.toString().padStart(2, "0");
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

/**
 * Z textu typu "61 000 000,00 €" vytiahni PRVÝ peňažný token.
 * - berieme len prvý match (nie všetky čísla z celej stránky!)
 * - 1 000 000,00 -> 1000000 (centy ignorujeme)
 */
function parseJackpotEURStrict(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\u00A0/g, " "); // NBSP -> space
  // prvý token v tvare 1 234 567,89 alebo 1.234.567,89 alebo 1234567,89 (€, voliteľné)
  const m = cleaned.match(/(\d{1,3}(?:[ .]\d{3})*(?:,\d+)?)/);
  if (!m) return null;

  let token = m[1];                // napr. "61 000 000,00"
  token = token.replace(/[ .]/g, ""); // "61000000,00"
  // oddelovač ","
  const parts = token.split(",");
  const whole = parts[0];          // "61000000"
  const val = parseInt(whole, 10);
  if (!Number.isFinite(val)) return null;

  // bezpečnostný interval 1–120 mil.
  if (val < 1_000_000 || val > 120_000_000) return null;
  return val;
}

async function fetchHtmlWithFallback() {
  let lastErr;
  for (const url of TIPOS_URLS) {
    try {
      const res = await fetch(url, { headers: REQ_HEADERS, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
      const html = await res.text();
      if (!html || html.length < 1000) throw new Error(`Too short HTML at ${url}`);
      return { html, url };
    } catch (e) {
      lastErr = e;
      console.warn("[TIPOS] fallback:", e.message);
    }
  }
  throw lastErr || new Error("All TIPOS URLs failed");
}

function parseTipos(html) {
  const $ = cheerio.load(html);

  // 1) Dátum
  const dateStr =
    $('#results-date .date input[name="date"]').attr("value") ||
    $('#results-date .date input[name="tiposDate"]').attr("value")?.split(",")[0] ||
    "";
  const isoDate = parseSkDate(dateStr);
  if (!isoDate) throw new Error(`Neviem prečítať dátum z "${dateStr}"`);

  // 2) Výherné čísla (presne podľa tvojho snippet-u)
  const main = [];
  const euro = [];
  $("#results li").each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const t = ($li.attr("data-value") ?? $li.text()).trim();
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return;
    (isAdditional ? euro : main).push(n);
  });

  if (main.length !== 5 || euro.length !== 2) {
    throw new Error(`Neočakávaný počet čísel: main=${main} euro=${euro}`);
  }

  // 3) JOKER (voliteľné)
  const joker = $("#results-joker li label")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("");

  // 4) JACKPOT – BER IBA z konkrétneho prvku!
  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').first().text().trim();
  const nextJackpotEUR = parseJackpotEURStrict(jackpotText); // presné a bezpečné

  return {
    date: isoDate,
    main: sortNums(main),
    euro: sortNums(euro),
    joker: joker || undefined,
    nextJackpotEUR: nextJackpotEUR ?? null,
  };
}

async function build() {
  try {
    const { html } = await fetchHtmlWithFallback();
    const latest = parseTipos(html);

    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        nextJackpotEUR: latest.nextJackpotEUR,
        source: "tipos",
      },
      draws: [
        {
          date: latest.date,
          main: latest.main,
          euro: latest.euro,
          ...(latest.joker ? { joker: latest.joker } : {}),
        },
      ],
    };

    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
    console.log("Wrote", OUT_FILE);
  } catch (e) {
    console.error("Build failed:", e.message);

    // Fallback: nechaj posledný validný feed (ak existuje), aby appka nezostala prázdna
    try {
      const prev = await fs.readFile(OUT_FILE, "utf8");
      await fs.writeFile(OUT_FILE, prev, "utf8");
      console.warn("Keeping previous feed.json (fallback).");
    } catch {
      const empty = {
        meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null, source: "fallback" },
        draws: [],
      };
      await fs.mkdir(OUT_DIR, { recursive: true });
      await fs.writeFile(OUT_FILE, JSON.stringify(empty, null, 2), "utf8");
      console.warn("Wrote empty feed.json (no previous data).");
    }
  }
}

build();
