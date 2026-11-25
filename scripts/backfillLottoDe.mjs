// scripts/backfillLottoDe.mjs
// Jednorazové (dá sa spustiť znova) doplnenie výherných poradí a jackpotov
// pre všetky ťahy z data/history_*.csv z oficiálneho API lotto.de.
//  - data/prizes_<ROK>.json: doplní chýbajúce ťahy (existujúce z TIPOS nechá)
//  - data/jackpots.csv: jackpot každého ťahu (z lotto.de; údaj pri ťahu X je
//    jackpot nasledujúceho ťahu, preto sa zapíše k ďalšiemu dátumu)
// Kontroluje aj, či čísla z lotto.de sedia s históriou – ak nie, skončí chybou.
// Spustenie: node scripts/backfillLottoDe.mjs [rokOd]
import fs from "node:fs";
import path from "node:path";
import { parseLottoDe } from "./fetchLatestOnline.mjs";
import { setJackpotRow, nextDrawDate } from "./appendToCsv.mjs";

const DATA_DIR = path.resolve("data");
const API = "https://www.lotto.de/api/stats/entities.eurojackpot/draw/";
const fromYear = process.argv[2] ?? "2012";

const draws = [];
for (const f of fs.readdirSync(DATA_DIR).filter((x) => /^history_\d{4}\.csv$/.test(x)).sort()) {
  if (f.slice(8, 12) < fromYear) continue;
  for (const l of fs.readFileSync(path.join(DATA_DIR, f), "utf8").split(/\r?\n/).slice(1)) {
    const p = l.split(";");
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[0])) draws.push({ date: p[0], key: p.slice(1, 8).join(",") });
  }
}

const byYear = {};
const load = (y) => {
  if (!byYear[y]) {
    try { byYear[y] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `prizes_${y}.json`), "utf8")); }
    catch { byYear[y] = {}; }
  }
  return byYear[y];
};

let ok = 0, added = 0, jack = 0;
const bad = [];
for (const [i, d] of draws.entries()) {
  const ts = Date.parse(d.date + "T12:00:00Z");
  let r;
  for (let attempt = 0; attempt < 3 && !r; attempt++) {
    try {
      const res = await fetch(API + ts, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      r = parseLottoDe(await res.json());
    } catch (e) {
      if (attempt === 2) bad.push(`${d.date}: ${e.message}`);
      await new Promise((s) => setTimeout(s, 1000));
    }
  }
  if (!r) continue;
  if (r.date !== d.date || [...r.main, ...r.euro].join(",") !== d.key) {
    bad.push(`${d.date}: lotto.de ${r.date} ${r.main}+${r.euro} ≠ história ${d.key}`);
    continue;
  }
  ok++;
  const all = load(d.date.slice(0, 4));
  if (!all[d.date] && r.prizes.length === 12) { all[d.date] = r.prizes; added++; }
  const next = draws[i + 1]?.date ?? nextDrawDate(d.date);
  if (r.jackpotEUR && setJackpotRow(path.join(DATA_DIR, "jackpots.csv"), next, r.jackpotEUR)) jack++;
  await new Promise((s) => setTimeout(s, 100));
}

for (const [y, all] of Object.entries(byYear)) {
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  fs.writeFileSync(path.join(DATA_DIR, `prizes_${y}.json`), JSON.stringify(sorted, null, 1) + "\n", "utf8");
}
console.log(`backfill: ${ok}/${draws.length} overených, nové poradia: ${added}, jackpoty: ${jack}`);
for (const b of bad) console.log("::warning::" + b);
if (bad.length) process.exitCode = 1;
