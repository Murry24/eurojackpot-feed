// tools/merge_history.js
import * as fs from "node:fs/promises";
import * as path from "node:path";

const PUBLIC = path.join(process.cwd(), "public");
const feedFile = path.join(PUBLIC, "feed.json");
const historyFile = path.join(PUBLIC, "history.json");
const outFile = path.join(PUBLIC, "merged.json");

async function run() {
  try {
    const feed = JSON.parse(await fs.readFile(feedFile, "utf8"));
    const history = JSON.parse(await fs.readFile(historyFile, "utf8"));

    // zlúčime draws z history + feed
    const merged = {
      meta: {
        generatedAt: new Date().toISOString(),
        source: "merge(history+feed)",
      },
      draws: [
        ...(history.draws || []),
        ...(feed.draws || []),
      ],
    };

    await fs.writeFile(outFile, JSON.stringify(merged, null, 2), "utf8");
    console.log("Merged history + feed →", outFile);
  } catch (e) {
    console.error("Merge failed:", e);
    process.exit(1);
  }
}

run();
