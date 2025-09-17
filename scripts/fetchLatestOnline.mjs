// scripts/fetchLatestOnline.mjs
// Node 20: global fetch
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const OUT = path.resolve("public/feed.json");
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

const EUROJACKPOT_URL = "https://www.eurojackpot.org/en/results";

// ✅ PRIDANÁ HLAVNÁ STRÁNKA LOTÉRIE NA TIPOS
const TIPOS_URLS = [
  "https://www.tipos.sk/loterie/eurojackpot",                 // <-- tu je <p class="intro-winning eurojackpot"><strong>…</strong>
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
// "120 000 000 €" alebo "120 000 000 €" -> 120000000
function parseEurAmount(txt) {
  if (!txt) return null;
  // nahradíme NBSP/tenkú medzeru atď. za klasickú medzeru
  const cleaned = String(txt).replace(/\u00A0|\u202F/g, " ");
  const m = cleaned.match(/([\d.\s]+)/); // celá časť
  if (!m) return null;
  const major = m[1].replace(/[^\d]/g, "");
  if (!major) return null;
  const n = parseInt(major, 10);
  return Number.isFinite(n) ? n : null;
}
function isTueOrFri(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const wd = d.getUTCDay(); // 2=Tue, 5=Fri
  return wd === 2 || wd === 5;
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
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "eurojackpot-fetcher/1.0 (+github-actions)",
      "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ---------- Eurojackpot.org (čísla) ----------
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

  if (!date || !isTueOrFri(date) || main.length !== 5 || euro.length !== 2) return null;

  return { date, main, euro };
}

// ---------- TIPOS: jackpot + „ďalšie žrebovanie“ ----------
async function fetchTiposJackpotAndNext() {
  for (const url of TIPOS_URLS) {
    try {
      const html = await fetchHtml(url);
      const $ = load(html);

      // jackpot – vyskúšame viac selektorov (v poradí pravdepodobnosti)
      const candidates = [
        $("p.intro-winning.eurojackpot strong").first().text(), // ⬅️ tvoj HTML
        $("label[for='EurojackpotPart_Jackpot']").first().text(),
        $("li.winner-jackpot strong label").first().text(),
        $(".winner-jackpot strong").first().text(),
      ];
      let jackpotEUR = null;
      for (const t of candidates) {
        const v = parseEurAmount(t);
        if (v) { jackpotEUR = v; break; }
      }

      // „Žrebujeme …“ – deň (nepovinné)
      const dayTxt = $("#drawing-later .day").first().text().trim().toLowerCase();
      let nextByLabel = null;
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
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          let add = (target - d.getUTCDay() + 7) % 7;
          if (add === 0) add = 7; // najbližší nasledujúci
          d.setUTCDate(d.getUTCDate() + add);
          nextByLabel = d.toISOString().slice(0, 10);
        }
      }

      return { jackpotEUR, nextByLabel, source: url };
    } catch (e) {
      console.log("TIPOS jackpot fetch failed:", url, e.message);
    }
  }
  return { jackpotEUR: null, nextByLabel: null, source: null };
}

// ---------- main ----------
async function main() {
  // 1) čísla z oficiálneho webu
  let latest = null;
  try {
    const html = await fetchHtml(EUROJACKPOT_URL);
    latest = parseEurojackpot(html);
    console.log(latest ? "EUROJACKPOT numbers OK" : "EUROJACKPOT numbers not found");
  } catch (e) {
    console.log("EUROJACKPOT fetch failed:", e.message);
  }
  if (!latest) { console.log("No numbers -> CSV fallback."); return; }

  // 2) jackpot/next z TIPOS
  const { jackpotEUR, nextByLabel } = await fetchTiposJackpotAndNext();
  if (jackpotEUR != null) console.log("TIPOS jackpot EUR:", jackpotEUR);
  else console.log("TIPOS jackpot not found – leaving null");

  const meta = {
    since: "2022-01-07",
    updatedAt: new Date().toISOString(),
    nextJackpotEUR: jackpotEUR ?? null,
    nextDrawDate: nextByLabel || nextDrawDateFrom(latest.date),
  };

  const out = {
    meta,
    draws: [
      {
        date: latest.date,
        main: latest.main,
        euro: latest.euro,
      }
    ],
    source: "eurojackpot.org + tipos.sk(jackpot)"
  };

  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("feed.json written:", out.draws[0], "meta:", meta);
}

main().catch(e => {
  console.error("fetchLatestOnline ERROR:", e);
  process.exitCode = 0;
});
