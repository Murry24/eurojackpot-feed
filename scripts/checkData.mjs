// scripts/checkData.mjs
// Kontrola histórie v data/history_*.csv:
//  - každý riadok má 5 rôznych hlavných čísel (1–50) a 2 rôzne Euro čísla (1–12)
//  - žiadny dátum nie je dvakrát
//  - nechýba žiadny ťah (piatky; od 29. 3. 2022 aj utorky)
// Bez parametra len vypíše varovania (GitHub ich ukáže pri behu).
// S parametrom --strict skončí chybou (používa to `npm test`).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DATA_DIR = path.resolve("data");

export function checkData(dir = DATA_DIR, today = new Date()) {
  const problems = [];
  const dates = new Set();
  const files = fs.readdirSync(dir).filter((f) => /^history_\d{4}\.csv$/.test(f)).sort();
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines.slice(1)) {
      const p = line.split(";");
      const date = p[0];
      const main = p.slice(1, 6).map((x) => parseInt(x, 10));
      const euro = p.slice(6, 8).map((x) => parseInt(x, 10));
      const ok =
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        main.every((n) => n >= 1 && n <= 50) && new Set(main).size === 5 &&
        euro.every((n) => n >= 1 && n <= 12) && new Set(euro).size === 2;
      if (!ok) problems.push(`${f}: chybný riadok „${line}“`);
      if (dates.has(date)) problems.push(`${f}: ${date} je zapísaný dvakrát`);
      dates.add(date);
    }
  }
  if (dates.size) {
    const first = [...dates].sort()[0];
    const d = new Date(first + "T12:00:00Z");
    // posledný ťah, ktorý už určite mal byť zapísaný (deň predtým)
    const until = new Date(today.getTime() - 86400000);
    while (d <= until) {
      const iso = d.toISOString().slice(0, 10);
      const wd = d.getUTCDay();
      const expected = wd === 5 || (wd === 2 && iso >= "2022-03-29");
      if (expected && !dates.has(iso)) problems.push(`chýba ťah ${iso}`);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return { count: dates.size, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const strict = process.argv.includes("--strict");
  const { count, problems } = checkData();
  console.log(`checkData: ${count} ťahov, problémov: ${problems.length}`);
  for (const p of problems) console.log(`::warning::${p}`);
  if (strict && problems.length) process.exit(1);
}
