// scripts/appendToCsv.mjs
// Ak public/feed.json (z fetchLatestOnline) obsahuje ťah, ktorý ešte nie je
// v data/history_<ROK>.csv, pripíše ho tam. Súbor pre nový rok vytvorí sám
// (aj s hlavičkou), takže prechod 2026 -> 2027 nepotrebuje ručný zásah.
import fs from "node:fs";
import path from "node:path";

const FEED = path.resolve("public/feed.json");
const DATA_DIR = path.resolve("data");
const HEADER = "date;main1;main2;main3;main4;main5;euro1;euro2;joker";

function readFeed() {
  try { return JSON.parse(fs.readFileSync(FEED, "utf8")); } catch { return null; }
}

function main() {
  const feed = readFeed();
  if (feed?.source !== "tipos.sk") {
    console.log("appendToCsv: feed nie je z online zdroja, nič nepripisujem.");
    return;
  }
  const d = feed.draws?.[0];
  if (!d?.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      d.main?.length !== 5 || d.euro?.length !== 2) {
    console.log("appendToCsv: neplatný ťah vo feede, preskakujem.", d);
    return;
  }

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

main();
