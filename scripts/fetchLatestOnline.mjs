// scripts/fetchLatestOnline.mjs
// Stiahne posledné žrebovanie Eurojackpotu z TIPOS (dátum, čísla, joker, jackpot)
// a zapíše ho do public/feed.json.
//
// Pôvodne sa čísla brali z https://www.eurojackpot.org/en/results – táto stránka
// prestala existovať (HTTP 404), preto sa od prelomu 2025/2026 nič neťahalo
// a workflow padal na CSV fallback. TIPOS má všetko na jednej stránke.
//
// Node 20: global fetch
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const OUT = path.resolve("public/feed.json");

const TIPOS_URLS = [
  "https://www.tipos.sk/loterie/eurojackpot",
  "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry",
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// ---------- utils ----------
export function parseSkDate(str) {
  // „13. 11. 2026“ alebo „13. 11. 2026, 46. týždeň“ -> „2026-11-13“
  const m = String(str ?? "").match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function parseEurAmount(txt) {
  // „75 000 000,00 €“ -> 75000000 ; „61 mil. €“ -> 61000000
  if (!txt) return null;
  const t = String(txt).replace(/ | /g, " ").trim().toLowerCase();
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|million)/);
  if (mil) return Math.round(parseFloat(mil[1].replace(",", ".")) * 1_000_000);
  const m = t.match(/(\d[\d\s.]*)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isTueOrFri(iso) {
  const wd = new Date(iso + "T12:00:00Z").getUTCDay();
  return wd === 2 || wd === 5;
}

export function nextDrawDateFrom(iso) {
  const d = new Date(iso + "T12:00:00Z");
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 2 && d.getUTCDay() !== 5);
  return d.toISOString().slice(0, 10);
}

// ---------- TIPOS parser ----------
export function parseTipos(html) {
  const $ = load(html);

  const dateRaw =
    $('#results-date input[name="date"]').attr("value") ||
    $('#results-date input[name="tiposDate"]').attr("value") ||
    "";
  const date = parseSkDate(dateRaw);
  if (!date) throw new Error(`neviem prečítať dátum z "${dateRaw}"`);
  if (!isTueOrFri(date)) throw new Error(`dátum ${date} nie je utorok/piatok`);

  const main = [];
  const euro = [];
  $("#results li").each((_, el) => {
    const $li = $(el);
    const n = parseInt(($li.attr("data-value") ?? $li.text()).trim(), 10);
    if (!Number.isFinite(n)) return;
    ($li.attr("data-additional") === "true" ? euro : main).push(n);
  });
  if (main.length !== 5 || euro.length !== 2) {
    throw new Error(`neočakávaný počet čísel: main=[${main}] euro=[${euro}]`);
  }
  if (main.some((n) => n < 1 || n > 50) || euro.some((n) => n < 1 || n > 12)) {
    throw new Error(`čísla mimo rozsahu: main=[${main}] euro=[${euro}]`);
  }

  const jokerDigits = $("#results-joker li")
    .toArray()
    .map((li) => $(li).text().trim())
    .filter(Boolean);
  const joker = jokerDigits.length === 6 ? jokerDigits.join("") : null;

  const jackpotCandidates = [
    $("label[for='EurojackpotPart_Jackpot']").first().text(),
    $("p.intro-winning.eurojackpot strong").first().text(),
    $(".winner-jackpot strong").first().text(),
  ];
  let jackpotEUR = null;
  for (const t of jackpotCandidates) {
    const v = parseEurAmount(t);
    if (v) { jackpotEUR = v; break; }
  }

  return {
    date,
    main: main.sort((a, b) => a - b),
    euro: euro.sort((a, b) => a - b),
    joker,
    jackpotEUR,
  };
}

async function fetchHtml(url) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}nocache=${Date.now()}`, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 1000) throw new Error("príliš krátke HTML");
  return html;
}

// ---------- main ----------
async function main() {
  let latest = null;
  for (const url of TIPOS_URLS) {
    try {
      latest = parseTipos(await fetchHtml(url));
      console.log("TIPOS OK:", url);
      break;
    } catch (e) {
      console.log("TIPOS zlyhal:", url, "-", e.message);
    }
  }
  if (!latest) {
    console.log("Žiadne čísla online -> použije sa CSV fallback.");
    return;
  }

  const out = {
    meta: {
      since: "2022-01-07",
      updatedAt: new Date().toISOString(),
      nextJackpotEUR: latest.jackpotEUR,
      nextDrawDate: nextDrawDateFrom(latest.date),
    },
    draws: [
      {
        date: latest.date,
        main: latest.main,
        euro: latest.euro,
        ...(latest.joker ? { joker: latest.joker } : {}),
      },
    ],
    source: "tipos.sk",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("feed.json zapísaný:", out.draws[0], "jackpot:", latest.jackpotEUR);
}

// spusti len pri priamom volaní (nie pri importe v teste)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fetchLatestOnline.mjs")) {
  main().catch((e) => {
    console.error("fetchLatestOnline ERROR:", e);
    process.exitCode = 0; // workflow pokračuje CSV fallbackom
  });
}
