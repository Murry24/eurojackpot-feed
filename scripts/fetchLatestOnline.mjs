// scripts/fetchLatestOnline.mjs
// Node 20 má global fetch, netreba knižnicu na HTTP
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio"; // ⬅️ správny import (žiadny default)

// Primárny zdroj – TIPOS výsledky Eurojackpotu
const URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function toISO(dStr) {
  // podporíme "16.09.2025" aj "2025-09-16"
  const m1 = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dStr);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dStr);
  if (m2) return dStr;
  // fallback: skús new Date
  const dt = new Date(dStr);
  if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return null;
}

function intsFrom($, nodes) {
  return nodes
    .map((_, el) => $(el).text().trim())
    .get()
    .map((s) => parseInt(s.replace(/[^\d]/g, ""), 10))
    .filter((n) => Number.isFinite(n));
}

function pickNumbersFromHtml($) {
  // Skús typické UL/LI skupiny s číslami
  let candidate = null;

  $("ul, ol").each((_, ul) => {
    const nums = intsFrom($, $(ul).find("li"));
    if (nums.length >= 7) {
      // Hľadáme 5 hlavných (1..50) a 2 euro (1..12)
      const main = nums.slice(0, 5).filter((n) => n >= 1 && n <= 50);
      const euro = nums.slice(5, 7).filter((n) => n >= 1 && n <= 12);
      if (main.length === 5 && euro.length === 2) {
        candidate = { main: [...main].sort((a, b) => a - b), euro: [...euro].sort((a, b) => a - b) };
        return false; // break
      }
    }
  });

  if (candidate) return candidate;

  // Fallback – vyťahni všetky čísla z textu a hľadaj prvý úsek 7 čísel
  const allNums = $.text()
    .split(/[^0-9]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  for (let i = 0; i + 6 < allNums.length; i++) {
    const main = allNums.slice(i, i + 5).filter((n) => n >= 1 && n <= 50);
    const euro = allNums.slice(i + 5, i + 7).filter((n) => n >= 1 && n <= 12);
    if (main.length === 5 && euro.length === 2) {
      return { main: [...main].sort((a, b) => a - b), euro: [...euro].sort((a, b) => a - b) };
    }
  }
  return null;
}

function pickDateFromHtml($) {
  // Skús nájsť dátum v bežných formátoch
  const text = $.text();
  const m = text.match(/(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/);
  return m ? toISO(m[1]) : null;
}

async function main() {
  const res = await fetch(URL, { headers: { "User-Agent": "github-actions-eurojackpot" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pri načítaní ${URL}`);
  const html = await res.text();
  const $ = load(html);

  const dateISO = pickDateFromHtml($);
  const numbers = pickNumbersFromHtml($);

  if (!dateISO || !numbers) {
    console.log("fetchLatestOnline: nepodarilo sa spoľahlivo zistiť dátum alebo čísla.");
    // necháme workflow pokračovať, ale vytlačíme debug
    console.log("dateISO:", dateISO, "numbers:", numbers);
    return; // neprepíšeme feed.json, nech prebehne fallback z CSV
  }

  const out = {
    meta: {
      since: "2022-01-07",
      updatedAt: new Date().toISOString(),
      nextJackpotEUR: null
    },
    draws: [
      {
        date: dateISO,
        main: numbers.main,
        euro: numbers.euro
      }
    ]
  };

  const OUT = path.resolve("public/feed.json");
  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("fetchLatestOnline: OK, posledný ťah:", dateISO, numbers);
}

main().catch((e) => {
  console.error("fetchLatestOnline ERROR:", e.message);
  // Nechceme zhodiť celý workflow – CSV fallback to ešte vie zachrániť
  process.exitCode = 0;
});
