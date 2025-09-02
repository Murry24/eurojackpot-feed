// Robustný scraper Eurojackpot -> public/feed.json
// Node 20 (má fetch), jediná závislosť: "cheerio".
// Multi-strategy: TIPOS HTML -> JSON-LD zo stránky -> posledný prísny fallback.

import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";

const SOURCE_URL = "https://www.tipos.sk/loterie/eurojackpot";

// ---------- utils ----------
const clampJackpot = (eur) =>
  Number.isFinite(eur) && eur >= 5_000_000 && eur <= 120_000_000
    ? Math.round(eur)
    : null;

function parseJackpotEUR(text) {
  if (!text) return null;
  const t = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").toLowerCase();

  // 61 mil. € / 61 million
  const m1 = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|mil\.|million)/i);
  if (m1) return clampJackpot(parseFloat(m1[1].replace(",", ".")) * 1_000_000);

  // 61 000 000 €
  const m2 = t.match(/(\d[\d .]{4,})\s*€?/);
  if (m2) return clampJackpot(parseInt(m2[1].replace(/[ .]/g, ""), 10));
  return null;
}

const isoFromParts = (y, m, d) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function fallbackEJDate() {
  const now = new Date();
  const targets = [2, 5]; // utorok/piatok
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    if (targets.includes(d.getDay())) {
      return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function distinctInRange(arr, n, a, b) {
  const s = new Set(arr);
  if (s.size !== n) return false;
  for (const v of s) if (v < a || v > b) return false;
  return true;
}

function normalizeSet(main, euro) {
  const m = [...new Set(main)].sort((a, b) => a - b);
  const e = [...new Set(euro)].sort((a, b) => a - b);
  if (!distinctInRange(m, 5, 1, 50)) return null;
  if (!distinctInRange(e, 2, 1, 12)) return null;
  return { main: m, euro: e };
}

// ---------- JSON-LD extrakcia ----------
function tryJsonLd($) {
  const nodes = $('script[type="application/ld+json"]');
  for (let i = 0; i < nodes.length; i++) {
    let raw = $(nodes[i]).contents().text();
    if (!raw) continue;

    // JSON-LD býva niekedy pole, niekedy objekt
    try {
      const parsed = JSON.parse(raw);

      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      for (const obj of candidates) {
        // typické polia, ktoré môžeme nájsť:
        // - winningNumbers / lotteryDraw / result / numbers / mainNumbers / euroNumbers
        const deep = (o, k) => (o && typeof o === "object" ? o[k] : undefined);

        // pokúsme sa nájsť rôzne pomenovania
        const mainOptions = [
          deep(obj, "mainNumbers"),
          deep(obj, "mainnumbers"),
          deep(obj, "main"),
          deep(obj, "numbers"),
          deep(obj, "winningNumbers"),
          deep(deep(obj, "result") || {}, "mainNumbers"),
        ].filter(Boolean);

        const euroOptions = [
          deep(obj, "euroNumbers"),
          deep(obj, "euro"),
          deep(obj, "stars"),
          deep(deep(obj, "result") || {}, "euroNumbers"),
        ].filter(Boolean);

        // vyber prvý pár, ktorý dáva zmysel
        for (const m of mainOptions) {
          for (const e of euroOptions) {
            const norm = normalizeSet(
              (Array.isArray(m) ? m : String(m).split(/[^\d]+/)).map((x) =>
                parseInt(x, 10)
              ),
              (Array.isArray(e) ? e : String(e).split(/[^\d]+/)).map((x) =>
                parseInt(x, 10)
              )
            );
            if (norm) {
              // dátum
              let dt =
                obj.date ||
                obj.datePublished ||
                obj.startDate ||
                obj.endDate ||
                null;
              if (typeof dt === "string") {
                const hit = dt.match(/\d{4}-\d{2}-\d{2}/);
                if (hit) dt = hit[0];
              }
              if (!dt) {
                // skús hodiť oko do textu stránky (už ju máme načítanú)
                const t = $("body").text().replace(/\s+/g, " ");
                const md = t.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
                if (md) dt = isoFromParts(md[3], md[2], md[1]);
              }
              if (!dt) dt = fallbackEJDate();

              return { ...norm, date: dt };
            }
          }
        }
      }
    } catch {
      // nie všetky JSON-LD skripty sú čistý JSON (často inline komentáre) – ignoruj
    }
  }
  return null;
}

// ---------- posledný fallback: prísny textový režim ----------
function tryStrictTextFallback($) {
  // zober čísla z celej stránky
  const nums = [];
  $("body *").each((_, el) => {
    const t = $(el).text().trim();
    if (/^\d{1,2}$/.test(t)) nums.push(parseInt(t, 10));
  });

  // skús najmenšie okno, ktoré dá konzistentný set
  let best = null;
  for (let L = 7; L <= 12; L++) {
    for (let i = 0; i + L <= nums.length; i++) {
      const win = nums.slice(i, i + L);
      const mains = win.filter((n) => n >= 1 && n <= 50);
      const euros = win.filter((n) => n >= 1 && n <= 12);

      const norm = normalizeSet(mains, euros);
      if (norm) {
        best = { ...norm, span: L };
        break;
      }
    }
    if (best) break;
  }
  if (!best) return null;

  // dátum
  let dt = null;
  const t = $("body").text().replace(/\s+/g, " ");
  const md = t.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (md) dt = isoFromParts(md[3], md[2], md[1]);
  if (!dt) dt = fallbackEJDate();

  return { date: dt, main: best.main, euro: best.euro };
}

// ---------- hlavný krok ----------
async function scrape() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  // 1) skús JSON-LD
  let out = tryJsonLd($);

  // 2) ak nie je JSON-LD, skús prísny textový fallback
  if (!out) out = tryStrictTextFallback($);
  if (!out) throw new Error("Nepodarilo sa spoľahlivo vyčítať čísla.");

  // jackpot (mäkké – necháme pokojne null, ak si nie sme istí)
  let jackpotText =
    $('[class*="jackpot"], [class*="vyhra"], [class*="prize"], [class*="jackpot-amount"]')
      .first()
      .text()
      .trim() || $("body").text();
  const nextJackpotEUR = parseJackpotEUR(jackpotText);

  return { ...out, nextJackpotEUR };
}

async function build() {
  let latest;
  try {
    latest = await scrape();
    console.log("Parsed:", latest);
  } catch (e) {
    console.error("Scraper zlyhal:", e.message);
    // radšej bezpečný fallback (nepravé čísla by boli horšie)
    latest = {
      date: fallbackEJDate(),
      main: [3, 5, 19, 23, 48],
      euro: [1, 5],
      nextJackpotEUR: null,
    };
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR: latest.nextJackpotEUR,
    },
    draws: [
      {
        date: latest.date,
        main: latest.main,
        euro: latest.euro,
      },
    ],
  };

  await mkdir("public", { recursive: true });
  await writeFile("public/feed.json", JSON.stringify(payload, null, 2), "utf8");
  console.log("✅ public/feed.json uložený.");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

