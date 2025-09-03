// fetch.js – TIPOS -> fallback eurojackpot.org -> fallback keep-last
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cheerio from "cheerio";

const OUT_DIR = path.join(process.cwd(), "public");
const OUT_FILE = path.join(OUT_DIR, "feed.json");

// Primárne URL (TIPOS)
const TIPOS_URLS = [
  "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry",
  "https://www.tipos.sk/loterie/eurojackpot",
];

// Záložné URL (oficiálny Eurojackpot – anglická verzia)
const OFFICIAL_URLS = [
  "https://www.eurojackpot.org/en/results",           // výsledky
  "https://www.eurojackpot.org/en",                   // fallback landing
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

const sortNums = (arr) => [...arr].sort((a, b) => a - b);
const clampInt = (x) => (Number.isFinite(x) ? x | 0 : NaN);

function parseMoneyEUR(text) {
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

function findIsoDateLoosely(text) {
  // nájde dd[./ ]mm[./ ]yyyy kdekoľvek a prekonvertuje
  const m = String(text).match(
    /(\d{1,2})[.\-/ ]\s*(\d{1,2})[.\-/ ]\s*(\d{4})/
  );
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const pad = (s) => s.toString().padStart(2, "0");
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: REQ_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  const html = await res.text();
  if (!html || html.length < 1000) throw new Error(`Too short HTML at ${url}`);
  return html;
}

async function tryMany(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      return { html, url };
    } catch (e) {
      lastErr = e;
      console.warn("[fetch] fallback:", e.message);
    }
  }
  throw lastErr || new Error("All candidates failed");
}

/** ---------- PARSERY ---------- **/

function parseFromTipos(html) {
  const $ = cheerio.load(html);

  const dateStr =
    $('#results-date .date input[name="date"]').attr("value") ||
    $('#results-date .date input[name="tiposDate"]')
      .attr("value")
      ?.split(",")[0] ||
    "";

  const isoDate =
    parseSkDate(dateStr) || findIsoDateLoosely($("#results-date").text());
  if (!isoDate) throw new Error(`TIPOS: unknown date: "${dateStr}"`);

  const main = [];
  const euro = [];

  $("#results li").each((_, el) => {
    const $li = $(el);
    const isAdditional = $li.attr("data-additional") === "true";
    const valAttr = $li.attr("data-value");
    const t = (valAttr ?? $li.text()).trim();
    const n = clampInt(parseInt(t, 10));
    if (!Number.isFinite(n)) return;
    (isAdditional ? euro : main).push(n);
  });

  if (main.length < 5 || euro.length < 2) {
    throw new Error(
      `TIPOS: bad numbers main=${main} euro=${euro} (HTML changed?)`
    );
  }

  const joker = $("#results-joker li label")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("");

  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').text();
  const nextJackpotEUR = parseMoneyEUR(jackpotText);

  return {
    date: isoDate,
    main: sortNums(main).slice(0, 5),
    euro: sortNums(euro).slice(0, 2),
    joker: joker || undefined,
    nextJackpotEUR:
      Number.isFinite(nextJackpotEUR) && nextJackpotEUR > 0
        ? nextJackpotEUR
        : null,
  };
}

function parseFromOfficial(html) {
  const $ = cheerio.load(html);

  // --- Dátum ---
  // Skúsime niečo ako <time datetime="2025-08-29"> alebo text “Friday 29/08/2025”
  let isoDate =
    $('time[datetime]').attr('datetime') ||
    findIsoDateLoosely($("time").first().attr("datetime") || "") ||
    findIsoDateLoosely($("main").text());

  if (!isoDate) throw new Error("Official: no date found");

  // --- Čísla ---
  // Často bývajú main balls: .numbers__ball (bez extra triedy) a euro: .numbers__euro alebo .numbers__ball--euro
  let main = $(".numbers__ball")
    .not(".numbers__euro,.numbers__ball--euro")
    .map((_, el) => parseInt($(el).text().trim(), 10))
    .get()
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 50);

  let euro = $(".numbers__euro, .numbers__ball--euro")
    .map((_, el) => parseInt($(el).text().trim(), 10))
    .get()
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);

  // Ak selektory nesadli, heuristika: zober prvých 7 čísel z textu, rozdeľ 5 + 2 podľa rozsahu
  if (main.length < 5 || euro.length < 2) {
    const allNums = ($("main").text() || $("body").text())
      .match(/\d{1,2}/g)
      ?.map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n)) || [];

    const mains = [];
    const euros = [];
    for (const n of allNums) {
      if (mains.length < 5 && n >= 1 && n <= 50) mains.push(n);
      else if (euros.length < 2 && n >= 1 && n <= 12) euros.push(n);
      if (mains.length >= 5 && euros.length >= 2) break;
    }
    if (mains.length >= 5 && euros.length >= 2) {
      main = mains;
      euro = euros;
    }
  }

  if (main.length < 5 || euro.length < 2) {
    throw new Error(
      `Official: bad numbers main=${main} euro=${euro} (HTML changed?)`
    );
  }

  // Jackpot – na oficiále býva text "Jackpot €61 Million", skúsme vytiahnuť najväčšiu “€ ...” hodnotu
  let nextJackpotEUR = null;
  const moneyHits = ($("main").text() || $("body").text()).match(
    /€\s?[\d\s.,]+/g
  );
  if (moneyHits && moneyHits.length) {
    // vyber najväčšie
    let max = 0;
    for (const m of moneyHits) {
      const v = parseMoneyEUR(m);
      if (Number.isFinite(v) && v > max) max = v;
    }
    nextJackpotEUR = max || null;
  }

  return {
    date: isoDate,
    main: sortNums(main).slice(0, 5),
    euro: sortNums(euro).slice(0, 2),
    joker: undefined,
    nextJackpotEUR,
  };
}

/** ---------- MAIN FLOW ---------- **/

async function writeJson(obj) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(obj, null, 2), "utf8");
  console.log("Wrote", OUT_FILE);
}

async function build() {
  let metaSource = "unknown";
  let latest;

  try {
    const { html } = await tryMany(TIPOS_URLS);
    latest = parseFromTipos(html);
    metaSource = "tipos";
  } catch (e1) {
    console.warn("[TIPOS failed]", e1.message);
    try {
      const { html } = await tryMany(OFFICIAL_URLS);
      latest = parseFromOfficial(html);
      metaSource = "eurojackpot.org";
    } catch (e2) {
      console.error("[Official failed]", e2.message);
      // Fallback – nechaj starý feed alebo kostru
      try {
        const prev = await fs.readFile(OUT_FILE, "utf8");
        console.warn("Keeping previous public/feed.json");
        await fs.writeFile(OUT_FILE, prev, "utf8");
        return;
      } catch {
        const empty = {
          meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null, source: metaSource },
          draws: [],
        };
        await writeJson(empty);
        return;
      }
    }
  }

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: latest.nextJackpotEUR,
      source: metaSource,
    },
    draws: [
      {
        date: latest.date, // "YYYY-MM-DD"
        main: latest.main,
        euro: latest.euro,
        ...(latest.joker ? { joker: latest.joker } : {}),
      },
    ],
  };

  await writeJson(out);
}

build().catch(async (e) => {
  console.error("Build crash:", e);
  // poslať kostru, aby job nepadol
  try {
    const prev = await fs.readFile(OUT_FILE, "utf8");
    await fs.writeFile(OUT_FILE, prev, "utf8");
  } catch {
    const empty = {
      meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null, source: "crash" },
      draws: [],
    };
    await writeJson(empty);
  }
});
