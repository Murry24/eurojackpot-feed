// scripts/fetchLatestOnline.mjs
// Node 20 má global fetch
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

// ====== 1) TU DOPLŇ SVOJE ZDROJE (aspoň 2) ======
// Príklady (prepíš za svoje reálne URL):
// - Oficiál: "https://www.eurojackpot.org/en/results"  (alebo lokálna jazyková mutácia)
// - Operátor: "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry"
// - Agregátor: "https://www.lottery.net/eurojackpot/results"
const SOURCES = [
  // PRIMARY
  // "https://.....",
  // BACKUP A
  // "https://.....",
  // BACKUP B (voliteľné)
  // "https://....."
];

// ====== pomocné ======
const OUT = path.resolve("public/feed.json");
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

function onlyUnique(arr) {
  return Array.from(new Set(arr)); // poradie zachováme
}
function isTueOrFri(isoDate) {
  const d = new Date(isoDate + "T12:00:00Z");
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  return wd === 2 || wd === 5; // Tue or Fri
}

function toISO(dStr) {
  if (!dStr) return null;
  // 16.09.2025
  let m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dStr.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // 2025-09-16
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dStr.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "16 September 2025", "September 16, 2025", atď.
  const dt = new Date(dStr);
  if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return null;
}

function intsFrom($, nodes) {
  return nodes
    .map((_, el) => $(el).text().trim())
    .get()
    .map((s) => parseInt(String(s).replace(/[^\d]/g, ""), 10))
    .filter((n) => Number.isFinite(n));
}

// ====== PARSERY ======
function tryJsonLD(html) {
  const $ = load(html);
  const blocks = $('script[type="application/ld+json"]').toArray();
  let candidate = null;

  for (const b of blocks) {
    let data;
    try { data = JSON.parse($(b).contents().text()); } catch { continue; }
    const arr = Array.isArray(data) ? data : [data];

    for (const obj of arr) {
      // hľadaj polia s číslami / dátumom pod rôznymi kľúčmi
      const date =
        obj.date || obj.datePublished || obj.startDate || obj.endDate || obj["@timestamp"];
      const main =
        obj.mainNumbers || obj.main || obj.numbers || obj.drawNumbers || obj["numbers_drawn"];
      const euro =
        obj.euroNumbers || obj.euro || obj.bonus || obj.starNumbers || obj["euro_numbers"];

      const dateISO = toISO(date);
      const mainArr = Array.isArray(main) ? main.map((n) => +n) : [];
      const euroArr = Array.isArray(euro) ? euro.map((n) => +n) : [];

      if (dateISO && mainArr.length >= 5 && euroArr.length >= 2) {
        candidate = {
          date: dateISO,
          main: onlyUnique(mainArr).slice(0, 5).sort((a, b) => a - b),
          euro: onlyUnique(euroArr).slice(0, 2).sort((a, b) => a - b),
        };
        break;
      }
    }
    if (candidate) break;
  }
  return candidate;
}

function tryListBlocks(html) {
  const $ = load(html);
  // Hľadaj UL/OL so 7+ číslami (5 hlavných + 2 euro)
  let found = null;
  $("ul,ol").each((_, ul) => {
    const nums = intsFrom($, $(ul).find("li"));
    if (nums.length >= 7) {
      const main = nums.slice(0, 5).filter((n) => n >= 1 && n <= 50);
      const euro = nums.slice(5, 7).filter((n) => n >= 1 && n <= 12);
      if (main.length === 5 && euro.length === 2) {
        found = {
          main: onlyUnique(main).slice(0, 5).sort((a, b) => a - b),
          euro: onlyUnique(euro).slice(0, 2).sort((a, b) => a - b),
        };
        return false; // break
      }
    }
  });

  // Dátum – skús bežné regexy po celom texte
  const txt = load(html).text();
  const dm = txt.match(/(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/);
  const dateISO = dm ? toISO(dm[1]) : null;

  return found && dateISO ? { date: dateISO, ...found } : null;
}

function tryRegexFallback(html) {
  const txt = load(html).text();
  const dm = txt.match(/(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/);
  const dateISO = dm ? toISO(dm[1]) : null;
  if (!dateISO) return null;

  const allNums = txt
    .split(/[^0-9]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));

  for (let i = 0; i + 6 < allNums.length; i++) {
    const main = allNums.slice(i, i + 5).filter((n) => n >= 1 && n <= 50);
    const euro = allNums.slice(i + 5, i + 7).filter((n) => n >= 1 && n <= 12);
    if (main.length === 5 && euro.length === 2) {
      return {
        date: dateISO,
        main: onlyUnique(main).slice(0, 5).sort((a, b) => a - b),
        euro: onlyUnique(euro).slice(0, 2).sort((a, b) => a - b),
      };
    }
  }
  return null;
}

async function fetchHtml(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "eurojackpot-fetcher/1.0 (+github-actions)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

function isValidDraw(d) {
  if (!d?.date || !Array.isArray(d.main) || !Array.isArray(d.euro)) return false;
  if (d.main.length !== 5 || d.euro.length !== 2) return false;
  if (!d.main.every((n) => n >= 1 && n <= 50)) return false;
  if (!d.euro.every((n) => n >= 1 && n <= 12)) return false;
  if (!isTueOrFri(d.date)) return false;
  // bez duplicít
  if (new Set(d.main).size !== 5) return false;
  if (new Set(d.euro).size !== 2) return false;
  return true;
}

async function getFromSource(url) {
  const html = await fetchHtml(url);
  // poradie: JSON-LD -> listy -> regex fallback
  const cand =
    tryJsonLD(html) ||
    tryListBlocks(html) ||
    tryRegexFallback(html);

  return cand && isValidDraw(cand) ? cand : null;
}

async function main() {
  if (!SOURCES.length) {
    console.log("fetchLatestOnline: SOURCES je prázdne – doplň URL do skriptu.");
    return;
  }

  // Zober aspoň 2 zhodné výsledky (consensus)
  const results = [];
  for (const url of SOURCES) {
    try {
      const d = await getFromSource(url);
      if (d) {
        console.log("OK from:", url, d);
        results.push({ url, d });
      } else {
        console.log("NO DATA from:", url);
      }
    } catch (e) {
      console.log("FAIL from:", url, e.message);
    }
  }

  if (!results.length) {
    console.log("fetchLatestOnline: žiadny zdroj neposkytol platný výsledok.");
    return; // necháme CSV fallback
  }

  // consensus: nájdi kombináciu, ktorú uviedlo >1 zdroj (alebo ber prvú, ak je len jedna)
  const key = (x) => `${x.d.date}|${x.d.main.join(',')}|${x.d.euro.join(',')}`;
  const counts = new Map();
  for (const r of results) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
  const bestKey = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const pick = results.find((r) => key(r) === bestKey).d;

  const out = {
    meta: { since: "2022-01-07", updatedAt: new Date().toISOString(), nextJackpotEUR: null },
    draws: [ pick ]
  };

  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("fetchLatestOnline: zapísané do feed.json:", out.draws[0]);
}

main().catch((e) => {
  console.error("fetchLatestOnline ERROR:", e);
  // nezhadzuj workflow – CSV fallback stále prebehne
  process.exitCode = 0;
});
