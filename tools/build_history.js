// tools/build_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_DIR  = path.join(process.cwd(), "public");
const OUT_FILE = path.join(OUT_DIR, "history.json");

// tolerantný parser (číta CSV s , alebo ;, ignoruje header a prázdne riadky)
function parseLine(line) {
  if (!line) return null;
  const raw = line.trim();
  if (!raw) return null;

  // preskoč hlavičky (riadky, čo nezačínajú číslicou roka/deň)
  if (!/^\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/.test(raw)) return null;

  const sep = raw.includes(";") ? ";" : ",";
  const parts = raw.split(sep).map(s => s.trim());

  // prvé pole = dátum (môže byť 2025-09-05 alebo 05.09.2025)
  let date = parts.shift();
  // normalize date na YYYY-MM-DD
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(date)) {
    const [d, m, y] = date.replace(/\./g, "-").split("-").map(x => x.padStart(2, "0"));
    date = `${y}-${m}-${d}`;
  }

  // zvyšok prežeň cez čísla
  const nums = parts
    .map(s => s.replace(/[^\d]/g, ""))
    .filter(s => s.length > 0)
    .map(s => parseInt(s, 10));

  // očakávame 5 + 2 (+ voliteľne joker)
  if (nums.length < 7) return null;

  const main = nums.slice(0, 5).sort((a,b)=>a-b);
  const euro = nums.slice(5, 7).sort((a,b)=>a-b);
  const joker = parts.slice(7).join("").replace(/[^\d]/g, "") || undefined;

  const out = { date, main, euro };
  if (joker) out.joker = joker;
  return out;
}

async function readCsvFile(file) {
  const txt = await fs.readFile(file, "utf8");
  return txt.split(/\r?\n/).map(parseLine).filter(Boolean);
}

function byDateDesc(a, b) {
  return (b.date || "").localeCompare(a.date || "");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // načítaj všetky *.csv v ./data
  let all = [];
  try {
    const files = (await fs.readdir(DATA_DIR)).filter(f => f.toLowerCase().endsWith(".csv"));
    for (const f of files) {
      const rows = await readCsvFile(path.join(DATA_DIR, f));
      all.push(...rows);
    }
  } catch {
    // ak priečinok data neexistuje, necháme prázdnu históriu
  }

  // deduplikácia podľa dátumu (posledný vyhráva)
  const map = new Map();
  for (const d of all) map.set(d.date, d);

  const merged = Array.from(map.values()).sort(byDateDesc);

  await fs.writeFile(OUT_FILE, JSON.stringify({ draws: merged }, null, 2), "utf8");
  console.log(`Built base history -> ${OUT_FILE} (${merged.length} draws)`);
}

main().catch(e => {
  console.error("[build_history] failed:", e);
  process.exit(1);
});
