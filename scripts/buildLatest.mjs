// scripts/buildLatest.mjs
import fs from "node:fs";
import path from "node:path";

const CSV_PATH  = path.resolve("data/history.csv"); // vstup so všetkými ťahmi
const OUT_PATH  = path.resolve("public/feed.json");  // výstup pre appku (posledný ťah)

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

// CSV parser – podporí ; aj ,
function parseCsvToDraws(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length && !l.startsWith("#"));

  if (!lines.length) return [];

  const header = lines[0];
  const sep = header.includes(";") ? ";" : ",";
  const cols = header.split(sep).map((c) => c.trim().toLowerCase());
  const idx = (name) => cols.findIndex((c) => c === name);

  const need = ["date","m1","m2","m3","m4","m5","e1","e2"];
  for (const n of need) {
    if (idx(n) === -1) {
      throw new Error(`CSV: chýba stĺpec "${n}". Hlavička: ${header}`);
    }
  }
  const jIdx = idx("joker"); // voliteľné

  const toInt = (s) => {
    const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : -1;
  };

  const draws = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map((x) => x.trim());
    if (parts.length < need.length) continue;

    const dateStr = parts[idx("date")];
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;

    const main = [toInt(parts[idx("m1")]), toInt(parts[idx("m2")]), toInt(parts[idx("m3")]), toInt(parts[idx("m4")]), toInt(parts[idx("m5")])]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);

    const euro = [toInt(parts[idx("e1")]), toInt(parts[idx("e2")])]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);

    const joker = jIdx >= 0 ? String(parts[jIdx] || "").trim() : "";

    if (main.length === 5 && euro.length === 2) {
      draws.push({
        date: d.toISOString().slice(0, 10), // YYYY-MM-DD
        main,
        euro,
        ...(joker ? { joker } : {}),
      });
    }
  }

  // najnovší navrch
  draws.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return draws;
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Nenájdené: ${CSV_PATH}. Pridaj data/history.csv s hlavičkou "date;m1;m2;m3;m4;m5;e1;e2;joker"`);
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const draws = parseCsvToDraws(raw);
  if (!draws.length) {
    throw new Error("CSV neobsahuje platné riadky.");
  }

  const latest = draws[0];

  // Pozn.: nextJackpotEUR nevieme spoľahlivo z CSV → necháme null.
  const out = {
    meta: {
      since: draws[draws.length - 1].date,
      updatedAt: new Date().toISOString(),
      nextJackpotEUR: null
    },
    draws: [ latest ]
  };

  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`feed.json hotový – posledný ťah: ${latest.date}`);
}

main();
