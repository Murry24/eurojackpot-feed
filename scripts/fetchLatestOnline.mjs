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

/** „4 903,20 €“ -> 4903.2 ; „10 000 000,00 €“ -> 10000000 (presne aj s centami). */
export function parseEurDecimal(txt) {
  if (!txt) return null;
  const t = String(txt).replace(/[\u00a0\u202f\s]/g, "").replace("€", "");
  const m = t.match(/^(\d+)(?:,(\d{1,2}))?$/);
  if (!m) return null;
  const v = parseInt(m[1], 10) + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) / 100 : 0);
  return Number.isFinite(v) ? v : null;
}

/**
 * Výherné poradia z tabuľky v #tab-eurojackpot:
 * [{ tier: 1, hits: "5+2", amountEUR: 10000000, winners: [{count:1, country:"Švédsko"}], winnersSK: 0 }, ...]
 * Pri nižších poradiach TIPOS uvádza len výhercov zo Slovenska.
 */
export function parsePrizes($) {
  const prizes = [];
  $("#tab-eurojackpot table tbody tr").each((_, tr) => {
    const td = $(tr).find("td");
    if (td.length < 3) return;
    const tier = parseInt($(td[0]).text(), 10);
    const hits = $(td[1]).text().replace(/\s+/g, "");
    if (!Number.isFinite(tier) || !/^\d\+\d$/.test(hits)) return;
    const amountEUR = parseEurDecimal($(td[2]).text());
    const winners = [];
    $(td[3]).find("span").each((__, sp) => {
      const s = $(sp).text().replace(/\s+/g, " ").trim();
      const m = s.match(/^(\d+)\s*x\s*(.+)$/i);
      if (m) winners.push({ count: parseInt(m[1], 10), country: m[2].trim() });
    });
    const winnersSK = winners
      .filter((w) => /slovensk/i.test(w.country))
      .reduce((a, w) => a + w.count, 0);
    prizes.push({ tier, hits, amountEUR, winners, winnersSK });
  });
  prizes.sort((a, b) => a.tier - b.tier);
  // kontrola: musí to byť 12 poradí, inak radšej nič (aby appka neukazovala nezmysly)
  return prizes.length === 12 ? prizes : [];
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

  let prizes = [];
  try {
    prizes = parsePrizes($);
  } catch {
    prizes = [];
  }

  return {
    date,
    prizes,
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

// ---------- lotto.de (oficiálny zdroj, kontrola + záloha) ----------
export const LOTTODE_URL = "https://www.lotto.de/api/stats/entities.eurojackpot/last";

/** Dátum ťahu v čase Bratislavy/Berlína (drawDate je polnoc CET v ms). */
function isoInEurope(ms) {
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** JSON z lotto.de -> { date, main, euro, prizes, jackpotEUR } (alebo vyhodí chybu). */
export function parseLottoDe(j) {
  if (!j || !Array.isArray(j.drawNumbersCollection)) throw new Error("lotto.de: chýbajú čísla");
  const date = isoInEurope(j.drawDate);
  if (!isTueOrFri(date)) throw new Error(`lotto.de: dátum ${date} nie je utorok/piatok`);
  const main = j.drawNumbersCollection.filter((x) => x.drawNumberType === 0).map((x) => x.drawNumber).sort((a, b) => a - b);
  const euro = j.drawNumbersCollection.filter((x) => x.drawNumberType === 1).map((x) => x.drawNumber).sort((a, b) => a - b);
  if (main.length !== 5 || euro.length !== 2) throw new Error(`lotto.de: main=[${main}] euro=[${euro}]`);
  if (main.some((n) => n < 1 || n > 50) || euro.some((n) => n < 1 || n > 12)) throw new Error("lotto.de: čísla mimo rozsahu");
  let prizes = (j.oddsCollection ?? [])
    .map((o) => ({
      tier: o.winningClass,
      hits: String(o.winningClassDescription?.winningClassShortName ?? "").replace(/\s+/g, ""),
      amountEUR: typeof o.odds === "number" ? o.odds : null,
      winners: [{ count: o.numberOfWinners ?? 0, country: "EU" }],
      winnersSK: 0,
    }))
    .filter((p) => p.tier >= 1 && p.tier <= 12 && /^\d\+\d$/.test(p.hits))
    .sort((a, b) => a.tier - b.tier);
  if (prizes.length !== 12) prizes = [];
  // jackpotNew = ďalší jackpot v miliónoch (10–120 mil.)
  const jn = Number(j.jackpotNew);
  const jackpotEUR = jn >= 10 && jn <= 120 ? jn * 1_000_000 : null;
  return { date, main, euro, joker: null, prizes, jackpotEUR };
}

/**
 * Rozhodne, čo zapísať: TIPOS je hlavný (má Joker a SK výhercov), lotto.de kontroluje.
 * Vracia { latest, source, warning }.
 */
export function pickLatest(tipos, lotto) {
  if (tipos && lotto) {
    if (tipos.date === lotto.date) {
      const same = tipos.main.join() === lotto.main.join() && tipos.euro.join() === lotto.euro.join();
      if (!same) {
        return { latest: null, source: null, warning: `NEZHODA ${tipos.date}: TIPOS ${tipos.main}+${tipos.euro} vs lotto.de ${lotto.main}+${lotto.euro} – nič nezapisujem` };
      }
      const prizes = tipos.prizes?.length ? tipos.prizes : lotto.prizes;
      return { latest: { ...tipos, prizes, jackpotEUR: tipos.jackpotEUR ?? lotto.jackpotEUR }, source: "tipos.sk+lotto.de", warning: null };
    }
    if (lotto.date > tipos.date) {
      return { latest: lotto, source: "lotto.de", warning: `TIPOS ešte nemá ťah ${lotto.date}, beriem lotto.de` };
    }
    return { latest: tipos, source: "tipos.sk", warning: `lotto.de ešte nemá ťah ${tipos.date} (neoverené)` };
  }
  if (tipos) return { latest: tipos, source: "tipos.sk", warning: "lotto.de nedostupné (neoverené)" };
  if (lotto) return { latest: lotto, source: "lotto.de", warning: "TIPOS nedostupný, beriem lotto.de" };
  return { latest: null, source: null, warning: "žiadny online zdroj" };
}

// ---------- main ----------
async function main() {
  let tipos = null;
  for (const url of TIPOS_URLS) {
    try {
      tipos = parseTipos(await fetchHtml(url));
      console.log("TIPOS OK:", url);
      break;
    } catch (e) {
      console.log("TIPOS zlyhal:", url, "-", e.message);
    }
  }
  let lotto = null;
  try {
    const res = await fetch(`${LOTTODE_URL}?nocache=${Date.now()}`, { headers: { ...HEADERS, Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lotto = parseLottoDe(await res.json());
    console.log("lotto.de OK:", lotto.date, lotto.main, lotto.euro);
  } catch (e) {
    console.log("lotto.de zlyhal:", e.message);
  }

  const { latest, source, warning } = pickLatest(tipos, lotto);
  if (warning) console.log(`::warning::${warning}`);
  if (!latest) {
    console.log("Žiadne overené čísla online -> použije sa CSV fallback.");
    return;
  }

  const out = {
    meta: {
      since: "2012-03-23",
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
        ...(latest.prizes?.length ? { prizes: latest.prizes } : {}),
      },
    ],
    source,
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
