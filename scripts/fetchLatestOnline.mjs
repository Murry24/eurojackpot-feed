// scripts/fetchLatestOnline.mjs
// Node 20: global fetch
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const OUT = path.resolve("public/feed.json");
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

const EUROJACKPOT_URL = "https://www.eurojackpot.org/en/results";

// TIPOS zdroje
const TIPOS_URLS = [
  "https://www.tipos.sk/loterie/eurojackpot",
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
function parseEurAmount(txt) {
  if (!txt) return null;
  const cleaned = String(txt).replace(/\u00A0|\u202F/g, " ");
  const m = cleaned.match(/([\d.\s]+)/);
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

// ---------- TIPOS: jackpot + joker + "ďalšie žrebovanie" ----------
async function fetchTiposJackpotAndNext() {
  for (const url of TIPOS_URLS) {
    try {
      const html = await fetchHtml(url);
      const $ = load(html);

      // jackpot
      const candidates = [
        $("p.intro-winning.eurojackpot strong").first().text(),
        $("label[for='EurojackpotPart_Jackpot']").first().text(),
        $(".winner-jackpot strong").first().text(),
      ];
      let jackpotEUR = null;
      for (const t of candidates) {
        const v = parseEurAmount(t);
        if (v) { jackpotEUR = v; break; }
      }

      // joker
      let joker = null;
      const jokerNums = $("#results-joker li").toArray().map(li => $(li).text().trim()).filter(Boolean);
      if (jokerNums.length === 6) {
        joker = jokerNums.join("");
      }

      // ďalšie žrebovanie (deň v texte)
      const dayTxt = $("#drawing-later .day").first().text().trim().toLowerCase();
      let nextByLabel = null;
      if (dayTxt) {
        const map = { "utorok": 2, "piatok": 5, "tuesday": 2, "friday": 5 };
        const target = map[dayTxt];
        if (typeof target === "number") {
          const now = new Date();
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          let add = (target - d.getUTCDay() + 7) % 7;
          if (add === 0) add = 7;
          d.setUTCDate(d.getUTCDate() + add);
          nextByLabel = d.toISOString().slice(0, 10);
        }
      }

      return { jackpotEUR, joker, nextByLabel, source: url };
    } catch (e) {
      console.log("TIPOS fetch failed:", url, e.message);
    }
  }
  return { jackpotEUR: null, joker: null, nextByLabel: null, source: null };
}

// ---------- main ----------
async function main() {
  // 1) čísla z eurojackpot.org
  let latest = null;
  try {
    const html = await fetchHtml(EUROJACKPOT_URL);
    latest = parseEurojackpot(html);
    console.log(latest ? "EUROJACKPOT numbers OK" : "EUROJACKPOT numbers not found");
  } catch (e) {
    console.log("EUROJACKPOT fetch failed:", e.message);
  }
  if (!latest) { console.log("No numbers -> CSV fallback."); return; }

  // 2) jackpot + joker + next z TIPOS
  const { jackpotEUR, joker, nextByLabel } = await fetchTiposJackpotAndNext();
  if (jackpotEUR != null) console.log("TIPOS jackpot EUR:", jackpotEUR);
  if (joker != null) console.log("TIPOS joker:", joker);

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
        joker: joker ?? null,
      }
    ],
    source: "eurojackpot.org + tipos.sk(jackpot+joker)"
  };

  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("feed.json written:", out.draws[0], "meta:", meta);
}

main().catch(e => {
  console.error("fetchLatestOnline ERROR:", e);
  process.exitCode = 0;
});
