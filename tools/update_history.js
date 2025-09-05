// tools/update_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SRC = path.join(process.cwd(), "data", "history.json");
const OUT_DIR = path.join(process.cwd(), "public");
const OUT = path.join(OUT_DIR, "history.json");

const empty = { draws: [] };

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(SRC, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.draws)) throw new Error("history.json: Bad format");
    await fs.writeFile(OUT, JSON.stringify(parsed, null, 2), "utf8");
    console.log("[history] copied data/history.json -> public/history.json (", parsed.draws.length, "draws )");
  } catch (e) {
    console.warn("[history] missing or invalid data/history.json, writing empty history.json");
    await fs.writeFile(OUT, JSON.stringify(empty, null, 2), "utf8");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
