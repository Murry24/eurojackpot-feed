// scripts/appendToCsv.mjs
// Ak public/feed.json (z fetchLatestOnline) obsahuje ťah, ktorý ešte nie je
// v data/history_<ROK>.csv, pripíše ho tam. Súbor pre nový rok vytvorí sám
// (aj s hlavičkou), takže prechod 2026 -> 2027 nepotrebuje ručný zásah.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FEED = path.resolve("public/feed.json");
const DATA_DIR = path.resolve("data");
const HEADER = "date;main1;main2;main3;main4;main5;euro1;euro2;joker";

function readFeed() {
  try { return JSON.parse(fs.readFileSync(FEED, "utf8")); } catch { return null; }
}

/** Najbližší utorok/piatok PO danom dátume (YYYY-MM-DD). */
export function nextDrawDate(iso) {
  const d = new Date(iso + "T12:00:00Z");
  for (let i = 1; i <= 7; i++) {
    const n = new Date(d.getTime() + i * 86400000);
    const wd = n.getUTCDay(); // 2 = utorok, 5 = piatok
    if (wd === 2 || wd === 5) return n.toISOString().slice(0, 10);
  }
  return null;
}

export const ONLINE_SOURCES = ["tipos.sk", "tipos.sk+lotto.de", "lotto.de"];

/** jackpots.csv: dátum ťahu -> jackpot v tom ťahu. */
export function setJackpotRow(file, date, eur) {
  let rows = [];
  if (fs.existsSync(file)) {
    rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^\d{4}-\d{2}-\d{2};/.test(l));
  }
  const map = new Map(rows.map((l) => [l.slice(0, 10), l]));
  const row = `${date};${Math.round(eur)}`;
  if (map.get(date) === row) return false;
  map.set(date, row);
  const out = ["date;jackpotEUR", ...[...map.keys()].sort().map((k) => map.get(k))];
  fs.writeFileSync(file, out.join("\n") + "\n", "utf8");
  return true;
}

/**
 * Jackpot pre najbližší ťah -> data/jackpots.csv (date;jackpotEUR).
 * Ak už riadok pre ten dátum je, prepíše sumu (lotto.de/TIPOS ju môže spresniť).
 */
function upsertJackpot(feed, drawDate) {
  const eur = Number(feed?.meta?.nextJackpotEUR);
  const next = nextDrawDate(drawDate);
  if (!next || !Number.isFinite(eur) || eur <= 0) return;
  if (setJackpotRow(path.join(DATA_DIR, "jackpots.csv"), next, eur)) {
    console.log(`appendToCsv: jackpot ${next};${Math.round(eur)} -> jackpots.csv`);
  }
}

/** Výherné poradia ťahu -> data/prizes_<ROK>.json ({ "YYYY-MM-DD": [...] }). */
function upsertPrizes(d) {
  if (!Array.isArray(d.prizes) || d.prizes.length !== 12) return;
  const file = path.join(DATA_DIR, `prizes_${d.date.slice(0, 4)}.json`);
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, "utf8")); } catch { all = {}; }
  if (JSON.stringify(all[d.date]) === JSON.stringify(d.prizes)) return;
  // podrobnejšie poradia z TIPOS (krajiny výhercov) neprepisuj súhrnom z lotto.de
  const onlyEU = (ps) => ps.every((p) => (p.winners ?? []).every((w) => w.country === "EU"));
  if (all[d.date] && !onlyEU(all[d.date]) && onlyEU(d.prizes)) return;
  all[d.date] = d.prizes;
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + "\n", "utf8");
  console.log(`appendToCsv: výherné poradia ${d.date} -> ${path.basename(file)}`);
}

function main() {
  const feed = readFeed();
  if (!ONLINE_SOURCES.includes(feed?.source)) {
    console.log("appendToCsv: feed nie je z online zdroja, nič nepripisujem.");
    return;
  }
  const d = feed.draws?.[0];
  if (!d?.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      d.main?.length !== 5 || d.euro?.length !== 2) {
    console.log("appendToCsv: neplatný ťah vo feede, preskakujem.", d);
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  upsertJackpot(feed, d.date);
  upsertPrizes(d);

  const year = d.date.slice(0, 4);
  const file = path.join(DATA_DIR, `history_${year}.csv`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text.trim()) text = HEADER + "\n";

  const exists = text.split(/\r?\n/).some((l) => l.trim().startsWith(d.date + ";"));
  if (exists) {
    console.log(`appendToCsv: ${d.date} už v ${path.basename(file)} je.`);
    return;
  }

  const row = [d.date, ...d.main, ...d.euro, d.joker ?? ""].join(";");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  if (!text.endsWith("\n")) text += nl;

  // vlož riadok tak, aby súbor ostal zoradený podľa dátumu
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [head, ...rows] = lines;
  rows.push(row);
  rows.sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)));
  fs.writeFileSync(file, [head, ...rows].join(nl) + nl, "utf8");
  console.log(`appendToCsv: pridaný ${row} -> ${path.basename(file)}`);
}

// spusti len pri priamom volaní (nie pri importe z testu)
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
