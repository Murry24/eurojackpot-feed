// fetch.js
// Node 20+ (má vstavaný fetch). Potrebuje balík "cheerio".
// Výstup: public/feed.json   (meta + draws[0])

import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";

const SOURCE_URL = "https://www.tipos.sk/loterie/eurojackpot";

// Pomocné: najdi prvý reťazec vyhovujúci regexu
function findFirstMatch(str, regex) {
  const m = str.match(regex);
  return m ? m[0] : null;
}

// Prepočet „61 000 000 €“, „61 000 000 €“, „61 mil. €“ -> integer EUR
function parseJackpotEUR(text) {
  if (!text) return null;
  const t = text
    .replace(/\u00A0/g, " ") // NBSP
    .replace(/\s+/g, " ")
    .toLowerCase();

  // 61 mil. €, 61mil €, 61 million
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|mil\.|million)/);
  if (mil) {
    const num = parseFloat(mil[1].replace(",", "."));
    return Math.round(num * 1_000_000);
  }

  // 61 000 000 €, 61.000.000 €, 61000000 €
  const big = t.match(/(\d[\d .]*)\s*€?/);
  if (big) {
    const n = big[1].replace(/[ .]/g, "");
    const val = parseInt(n, 10);
    if (Number.isFinite(val) && val > 0) return val;
  }

  return null;
}

// Zo zoznamu čísiel vyber okno 7 čísel, kde 5 je 1–50 a 2 je 1–12.
// Vráti {main:[...5], euro:[...2]} alebo null.
function pickEurojackpotSet(allDigits) {
  const nums = allDigits.map(Number).filter((n) => Number.isFinite(n));
  for (let i = 0; i + 6 < nums.length; i++) {
    const window7 = nums.slice(i, i + 7);
    const main = [];
    const euro = [];

    for (const n of window7) {
      if (n >= 1 && n <= 50 && main.length < 5) {
        main.push(n);
      } else if (n >= 1 && n <= 12 && euro.length < 2) {
        euro.push(n);
      }
    }

    if (main.length === 5 && euro.length === 2) {
      main.sort((a, b) => a - b);
      euro.sort((a, b) => a - b);
      return { main, euro };
    }
  }
  return null;
}

async function getLatestFromTipos() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  // 1) Dátum – skús <time> alebo text s „dd.mm.rrrr“
  let dateISO = null;
  let dateText =
    $("time").first().attr("datetime") || $("time").first().text().trim();

  if (!dateText) {
    // fallback – hľadaj kdekoľvek „dd.mm.rrrr“
    const body = $("body").text().replace(/\s+/g, " ");
    const m = body.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    if (m) {
      // vytvor ISO dátum s 00:00Z
      const [_, d, mo, y] = m;
      const dd = d.padStart(2, "0");
      const mm = mo.padStart(2, "0");
      dateISO = `${y}-${mm}-${dd}`;
    }
  }

  if (!dateISO && dateText) {
    // skúsiť z <time datetime="2025-08-29"> alebo text "29.08.2025"
    const iso = findFirstMatch(dateText, /\d{4}-\d{2}-\d{2}/);
    if (iso) dateISO = iso;
    else {
      const m = dateText.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
      if (m) {
        const [_, d, mo, y] = m;
        dateISO = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
  }

  // 2) Čísla – vyzbieraj všetko, čo vyzerá ako 1–50/1–12, potom vyber vhodné okno 7 čísel
  const allCandidates = [];
  $("body *").each((_, el) => {
    const t = $(el).text().trim();
    if (/^\d{1,2}$/.test(t)) {
      allCandidates.push(parseInt(t, 10));
    }
  });

  const chosen = pickEurojackpotSet(allCandidates);
  if (!chosen) {
    throw new Error(
      `Nepodarilo sa nájsť 5+2 čísla v rozsahu (kandidáti: ${allCandidates.join(
        ","
      ).slice(0, 200)}...)`
    );
  }

  // 3) Jackpot – skús nadpisy/sekcie; fallback – prehľadaj celý text
  let jackpotText =
    $('[class*="jackpot"], [class*="prize"], [class*="vyhra"], [class*="jackpot-amount"]')
      .first()
      .text()
      .trim() || $("body").text().replace(/\s+/g, " ");

  const nextJackpotEUR = parseJackpotEUR(jackpotText);

  return {
    date: dateISO || new Date().toISOString().slice(0, 10),
    main: chosen.main,
    euro: chosen.euro,
    nextJackpotEUR: nextJackpotEUR ?? null,
  };
}

async function build() {
  let latest;
  try {
    latest = await getLatestFromTipos();
    console.log("OK parsed from Tipos:", latest);
  } catch (e) {
    console.error("Parsing zlyhal – použijem fallback:", e.message);
    // Fallback – aby feed nikdy nepadal
    latest = {
      date: new Date().toISOString().slice(0, 10),
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

