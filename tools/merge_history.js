// tools/merge_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const FEED      = path.join(PUBLIC_DIR, "feed.json");
const HISTORY   = path.join(PUBLIC_DIR, "history.json");

function byDateDesc(a, b) {
  return (b.date || "").localeCompare(a.date || "");
}

async function readJsonSafe(file, fallback) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const latest = await readJsonSafe(FEED,    { draws: [] });
  const hist   = await readJsonSafe(HISTORY, { draws: [] });

  const map = new Map();
  for (const d of hist.draws   || []) map.set(d.date, d);
  for (const d of latest.draws || []) map.set(d.date, d);

  const merged = Array.from(map.values()).sort(byDateDesc);
  const out = { draws: merged };

  await fs.writeFile(HISTORY, JSON.stringify(out, null, 2), "utf8");
  console.log(`Merged -> ${HISTORY} (${merged.length} draws)`);
}

main().catch(e => {
  console.error("merge_history failed:", e);
  process.exit(1);
});
