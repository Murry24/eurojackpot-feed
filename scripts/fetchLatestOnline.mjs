// scripts/fetchLatestOnline.mjs
// Node 20: global fetch
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const OUT = path.resolve("public/feed.json");
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

const EUROJACKPOT_URL = "https://www.eurojackpot.org/en/results";
const TIPOS_URLS = [
  "https://www.tipos.sk/zrebovanie/eurojackpot",
  "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry",
];

// ---------- utils ----------
function toISO(dStr) {
  if (!dStr) return null;
  let m = dStr.match(/(\d{2})\s*[\.\-\/]\s*(\d{2})\s*[\.\-\/]\s*(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = dStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(dStr);
  return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
}
function parseIntSafe(s) {
  const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : NaN;
}
// „120 000 000,00 €“ -> 120000000
function parseEurAmount(txt) {
  if (!txt) return null;
  const m = String(txt).match(/([\d\s\.]+)(?:,\d{1,2})?\s*€?/);
  if (!m) return null;
  const major = m[1].replace(/[^\d]/g, "");
  if (!major) return null;
  const n = parseInt(major, 10);
  return Number.isFinite(n) ? n : null;
}
function isTueOrFri(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const wd = d.getUTCDay(); // 0..6; 2=Tue, 5=Fri
  return wd === 2 || wd === 5;
}
function valid(main, euro) {
  if (!Array.isArray(main) || !Array.isArray(euro)) return false;
  if (main.length !== 5 || euro.length !== 2) return false;
  if (new Set(main).size !== 5 || new Set(euro).size !== 2) return false;
  if (!main.every(n => n>=1 && n<=50)) return false;
  if (!euro.every(n => n>=1 && n<=12)) return false;
  return true;
}
function nextDrawDateFrom(isoDate) {
  let d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  while (true) {
    const wd = d.getUTCDay();
    if (wd === 2 || wd === 5) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}
function keyOf(d) {
  return d ? `${d.date}|${d.main.join(',')}|${d.euro.join(',')}` : "";
}
async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "eurojackpot-fetcher/1.0 (+github-actions)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ---------- parser: EUROJACKPOT OFFICIAL ----------
function parseEurojackpot(html) {
  const $ = load(html);
  let dateRaw = $(".last-results p span").first().text().trim();
  if (!dateRaw) {
    const opt = $("#date option[selected], #date option").toArray()
      .map(o => $(o).attr("value") || $(o).text())
      .find(v => v && v.match(/\d{2}[\-\.]\d{2}[\-\.]\d{4}/));
    if (opt) dateRaw = opt.replace(/-/g, ".");
  }
  const date = toISO(dateRaw);

  const balls = $("ul.results li.lottery-ball").toArray().map(li => parseIntSafe($(li).text()));
  const main = balls.slice(0, 5).filter(Number.isFinite).sort((a,b)=>a-b);
  const euro = $("ul.results li.lottery-ball.extra").toArray()
                .map(li => parseIntSafe($(li).text()))
                .filter(Number.isFinite).slice(0,2).sort((a,b)=>a-b);

  if (!date || !valid(main, euro) || !isTueOrFri(date)) return null;
  return { date, main, euro, source: "eurojackpot.org" };
}

// ---------- parser: TIPOS (čísel + jackpot + joker) ----------
function parseTipos(html) {
  const $ = load(html);

  let dateRaw = $('#results-date .date input[name="date"]').val()
             || $('#results-date .date input[name="tiposDate"]').val()
             || $(".results-box .date input").first().val()
             || $("input[name='date']").first().val();
  const date = toISO(String(dateRaw || "").trim());

  const main = $("ul#results li:not([data-additional='true'])")
    .map((_, li) => parseIntSafe($(li).attr("data-value") || $(li).text()))
    .get()
    .filter(Number.isFinite)
    .slice(0, 5)
    .sort((a, b) => a - b);

  const euro = $("ul#results li[data-additional='true']")
    .map((_, li) => parseIntSafe($(li).attr("data-value") || $(li).text()))
    .get()
    .filter(Number.isFinite)
    .slice(0, 2)
    .sort((a, b) => a - b);

  const joker = $("#results-joker li label").map((_, el) => $(el).text().trim()).get().join("");

  // jackpot label „Eurojackpot Jackpot“
  const jackpotText = $("label[for='EurojackpotPart_Jackpot']").text() || "";
  const jackpotEur = parseEurAmount(jackpotText);

  // môžeme vrátiť aj keď čísla chýbajú – kvôli jackpotu
  const hasNumbers = date && valid(main, euro) && isTueOrFri(date);
  return {
    date: hasNumbers ? date : null,
    main: hasNumbers ? main : null,
    euro: hasNumbers ? euro : null,
    joker: joker || undefined,
    nextJackpotEUR: jackpotEur || undefined,
    source: "tipos.sk"
  };
}

// ---------- orchestrácia ----------
async function main() {
  // 1) oficiál
  let ej = null;
  try {
    const html = await fetchHtml(EUROJACKPOT_URL);
    ej = parseEurojackpot(html);
    console.log(ej ? "EUROJACKPOT OK" : "EUROJACKPOT no match");
  } catch (e) {
    console.log("EUROJACKPOT fetch failed:", e.message);
  }

  // 2) TIPOS (skús získať čísla aj jackpot)
  let tipos = null;
  for (const url of TIPOS_URLS) {
    try {
      const html = await fetchHtml(url);
      const r = parseTipos(html);
      if (r) { tipos = r; console.log("TIPOS parsed:", url, !!r.date ? "with numbers" : "jackpot-only"); break; }
    } catch (e) {
      console.log("TIPOS fetch failed:", url, e.message);
    }
  }

  // Výber výsledku
  let pick = null;
  if (ej && tipos?.date && tipos?.main && tipos?.euro) {
    if (keyOf(ej) === keyOf(tipos)) {
      pick = { ...ej };
      // doplň jackpot/joker z TIPOS
      if (tipos.nextJackpotEUR != null) pick.nextJackpotEUR = tipos.nextJackpotEUR;
      if (tipos.joker) pick.joker = tipos.joker;
      pick.source = "eurojackpot.org+tipos.sk";
    } else {
      console.log("CONFLICT between sources -> skip write (CSV fallback).");
      return;
    }
  } else {
    pick = ej || (tipos?.date ? { ...tipos } : null);
    // aj keď čísla idú z EJ, skús prilepiť jackpot z TIPOS
    if (pick && ej && tipos?.nextJackpotEUR != null) pick.nextJackpotEUR = tipos.nextJackpotEUR;
    if (pick && ej && tipos?.joker) pick.joker = tipos.joker;
  }

  if (!pick) {
    console.log("No reliable result -> keep CSV fallback.");
    return;
  }

  const meta = {
    since: "2022-01-07",
    updatedAt: new Date().toISOString(),
    nextJackpotEUR: pick.nextJackpotEUR ?? null,
    nextDrawDate: nextDrawDateFrom(pick.date)
  };

  const out = {
    meta,
    draws: [
      {
        date: pick.date,
        main: pick.main,
        euro: pick.euro,
        ...(pick.joker ? { joker: pick.joker } : {})
      }
    ],
    source: pick.source
  };

  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("feed.json written:", out.draws[0], "meta:", meta, "source:", out.source);
}

main().catch(e => {
  console.error("fetchLatestOnline ERROR:", e);
  process.exitCode = 0; // nezhadzuj workflow – CSV fallback to zvládne
});
