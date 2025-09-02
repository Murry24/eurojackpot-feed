// fetch.js – robustnejší scraper TIPOS Eurojackpot
// Node 20 (má fetch built-in). Potrebuje len "cheerio".
// Výstup: public/feed.json v tvare:
// {
//   meta: { generatedAt, nextJackpotEUR },
//   draws: [{ date:"YYYY-MM-DD", main:[5], euro:[2] }]
// }

import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";

const SOURCE_URL = "https://www.tipos.sk/loterie/eurojackpot";

// ---------- helpers ----------
function clampJackpot(eur) {
  if (!Number.isFinite(eur)) return null;
  if (eur < 5_000_000 || eur > 120_000_000) return null;
  return Math.round(eur);
}

function parseJackpotEUR(text) {
  if (!text) return null;
  const t = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").toLowerCase();

  // 61 mil. € / 61million
  const m1 = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|mil\.|million)/i);
  if (m1) {
    const v = parseFloat(m1[1].replace(",", "."));
    return clampJackpot(v * 1_000_000);
  }

  // 61 000 000 € / 61.000.000 €
  const m2 = t.match(/(\d[\d .]{4,})\s*€?/);
  if (m2) {
    const v = parseInt(m2[1].replace(/[ .]/g, ""), 10);
    return clampJackpot(v);
  }

  return null;
}

// vráť posledný utorok/piatok (Europe/Bratislava) <= today
function fallbackEJDate() {
  const now = new Date();
  // 2 = utorok, 5 = piatok
  const target = [2, 5];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const wd = d.getDay(); // 0 ne, 1 po, 2 ut...
    if (target.includes(wd)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

// skontroluj, že pole obsahuje presne n rôznych čísiel v rozsahu <a..b>
function inRangeDistinct(arr, n, a, b) {
  const s = new Set(arr);
  if (s.size !== n) return false;
  for (const v of s) if (v < a || v > b) return false;
  return true;
}

// z celého zoznamu kandidátov nájdi "najkompaktnejší" blok 7–12, z ktorého
// vieš zostaviť 5 hlavných (1..50) a 2 euro (1..12), všetko rôzne
function pickEurojackpotSet(candidates) {
  const nums = candidates.map(Number).filter(n => Number.isFinite(n));
  let best = null; // {main, euro, span}

  for (let L = 7; L <= 12; L++) {
    for (let i = 0; i + L <= nums.length; i++) {
      const win = nums.slice(i, i + L);

      // rozdeľ podľa rozsahov a potom hľadaj kombináciu bez duplicit
      const mains = win.filter(n => n >= 1 && n <= 50);
      const euros = win.filter(n => n >= 1 && n <= 12);

      // hrubý filter – musíme mať aspoň 5 kandidátov main a 2 euro
      if (mains.length < 5 || euros.length < 2) continue;

      // odstráň duplicity zachovaním poradia
      const uniqInOrder = (arr) => {
        const seen = new Set();
        const out = [];
        for (const n of arr) if (!seen.has(n)) { seen.add(n); out.push(n); }
        return out;
      };

      const uniqMain = uniqInOrder(mains);
      const uniqEuro = uniqInOrder(euros);

      if (uniqMain.length >= 5 && uniqEuro.length >= 2) {
        const main5 = uniqMain.slice(0, 5).sort((a,b)=>a-b);
        const euro2 = uniqEuro.slice(0, 2).sort((a,b)=>a-b);

        if (
          inRangeDistinct(main5, 5, 1, 50) &&
          inRangeDistinct(euro2, 2, 1, 12)
        ) {
          const span = L;
          if (!best || span < best.span) {
            best = { main: main5, euro: euro2, span };
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// ---------- main scraping ----------
async function getLatestFromTipos() {
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

  // 1) získaj kandidátne čísla z celej stránky
  const candidates = [];
  $("body *").each((_, el) => {
    const t = $(el).text().trim();
    if (/^\d{1,2}$/.test(t)) candidates.push(parseInt(t, 10));
  });

  const chosen = pickEurojackpotSet(candidates);
  if (!chosen) {
    throw new Error(`Nenašiel som 5+2 validné čísla (kandidátov: ${candidates.length})`);
  }

  // 2) dátum – skús time/dátum v blízkosti čísel, inak fallback
  let dateISO = null;
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const mDate = bodyText.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (mDate) {
    const [_, d, mo, y] = mDate;
    dateISO = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (!dateISO) {
    const dt = $("time").first().attr("datetime") || $("time").first().text();
    if (dt) {
      const iso = (dt.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
      if (iso) dateISO = iso;
    }
  }
  if (!dateISO) dateISO = fallbackEJDate();

  // 3) jackpot – skús špecifickejšie selektory, potom celé <body>
  let jackpotText =
    $('[class*="jackpot"], [class*="vyhra"], [class*="prize"], [class*="jackpot-amount"]')
      .first()
      .text()
      .trim();
  if (!jackpotText) jackpotText = bodyText;

  const nextJackpotEUR = parseJackpotEUR(jackpotText);

  return {
    date: dateISO,
    main: chosen.main,
    euro: chosen.euro,
    nextJackpotEUR: nextJackpotEUR,
  };
}

async function build() {
  let latest;
  try {
    latest = await getLatestFromTipos();
    console.log("OK parsed:", latest);
  } catch (e) {
    console.error("Parsing zlyhal, dávam fallback:", e.message);
    latest = {
      date: fallbackEJDate(),
      main: [3, 5, 19, 23, 48],
      euro: [1, 5],
      nextJackpotEUR: 61_000_000,
    };
  }

  const out = {
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
  await writeFile("public/feed.json", JSON.stringify(out, null, 2), "utf8");
  console.log("✅ public/feed.json uložený.");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

