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
// „120 000 000 €“ -> 120000000
function parseEurAmount(txt) {
  if (!txt) return null;
  // vezmi len "celé" číslo pred čiarkou
  const m = String(txt).match(/([\d\s\.]+)/);
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

// ---------- pomoc: TIPOS jackpot + „ďalšie žrebovanie“ ----------
function extractTiposJackpotAndNext($) {
  // 1) jackpot – viac možností umiestnenia
  const candidates = [
    $("label[for='EurojackpotPart_Jackpot']").text(),
    $("p.intro-winning.eurojackpot strong").text(),                // ⬅️ to, čo si poslal
    $("li.winner-jackpot strong label").text(),                    // iný blok na stránke
    $("*").filter((_, el) => /jackpot/i.test($(el).text())).first().text()
  ];
  let jackpotEUR = null;
  for (const t of candidates) {
    const v = parseEurAmount(t);
    if (v) { jackpotEUR = v; break; }
  }

  // 2) ďalší deň/čas žrebovania
  let nextByLabel = null;
  const dayTxt = $("#drawing-later .day").first().text().trim().toLowerCase(); // „Piatok“
  const timeTxt = $("#drawing-later .time").first().text().trim();             // „20:00“
  if (dayTxt) {
    const map = {
      "pondelok": 1, "utorok": 2, "streda": 3, "štvrtok": 4, "stvrtok": 4,
      "piatok": 5, "sobota": 6, "nedeľa": 0, "nedela": 0,
      "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4,
      "friday": 5, "saturday": 6, "sunday": 0
    };
    const target = map[dayTxt];
    if (typeof target === "number") {
      const now = new Date();
      // prepočítaj na najbližší cieľový deň
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      let add = (target - d.getUTCDay() + 7) % 7;
      if (add === 0) add = 7; // „najbližší ďalší“
      d.setUTCDate(d.getUTCDate() + add);
      nextByLabel = d.toISOString().slice(0, 10);
    }
  }

  return { jackpotEUR, nextByLabel };
}

// ---------- parser: TIPOS (čísel + jackpot + joker + nextDrawDate label) ----------
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

  const { jackpotEUR, nextByLabel } = extractTiposJackpotAndNext($);

  const hasNumbers = date && valid(main, euro) && isTueOrFri(date);
  return {
    date: hasNumbers ? date : null,
    main: hasNumbers ? main : null,
    euro: hasNumbers ? euro : null,
    joker: joker || undefined,
    nextJackpotEUR: jackpotEUR ?? undefined,
    nextDrawLabelDate: nextByLabel ?? undefined,
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
      if (r) { tipos = r; console.log("TIPOS parsed:", url, r.date ? "with numbers" : "jackpot-only"); break; }
    } catch (e) {
      console.log("TIPOS fetch failed:", url, e.message);
    }
  }

  // Výber výsledku (+ doplnenie jackpotu/jokera a nextDrawDate)
  let pick = null;
  if (ej && tipos?.date && tipos?.main && tipos?.euro) {
    if (keyOf(ej) === keyOf(tipos)) {
      pick = { ...ej };
      if (tipos.nextJackpotEUR != null) pick.nextJackpotEUR = tipos.nextJackpotEUR;
      if (tipos.joker) pick.joker = tipos.joker;
      pick.nextDrawLabelDate = tipos.nextDrawLabelDate;
      pick.source = "eurojackpot.org+tipos.sk";
    } else {
      console.log("CONFLICT between sources -> skip write (CSV fallback).");
      return;
    }
  } else {
    pick = ej || (tipos?.date ? { ...tipos } : null);
    if (pick && ej && tipos?.nextJackpotEUR != null) pick.nextJackpotEUR = tipos.nextJackpotEUR;
    if (pick && ej && tipos?.joker) pick.joker = tipos.joker;
    if (pick && tipos?.nextDrawLabelDate) pick.nextDrawLabelDate = tipos.nextDrawLabelDate;
  }

  if (!pick) {
    console.log("No reliable result -> keep CSV fallback.");
    return;
  }

  const meta = {
    since: "2022-01-07",
    updatedAt: new Date().toISOString(),
    nextJackpotEUR: pick.nextJackpotEUR ?? null,
    // preferuj dátum z TIPOS labelu („Piatok o 20:00“), inak dopočítaj z posledného ťahu
    nextDrawDate: pick.nextDrawLabelDate || nextDrawDateFrom(pick.date)
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
  process.exitCode = 0;
});
