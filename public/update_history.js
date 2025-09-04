// update_history.js – inkrementálne udržiavanie public/history.json z public/feed.json

import * as fs from "node:fs/promises";
import * as path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public");
const FEED_FILE = path.join(OUT_DIR, "feed.json");
const HIST_FILE = path.join(OUT_DIR, "history.json");

function ensureMap(rangeMax) {
  const m = {};
  for (let i = 1; i <= rangeMax; i++) {
    m[i] = { count: 0, lastSeen: null };
  }
  return m;
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
  // 1) načítaj feed (posledný žreb)
  const feed = await readJsonSafe(FEED_FILE, null);
  if (!feed || !Array.isArray(feed.draws) || feed.draws.length === 0) {
    console.warn("[history] No draws in feed.json – nothing to update.");
    return;
  }
  const last = feed.draws[0]; // náš fetch.js dáva posledný žreb ako prvý

  // 2) načítaj existujúcu históriu alebo vytvor prázdnu
  const nowIso = new Date().toISOString();
  let hist = await readJsonSafe(HIST_FILE, {
    meta: { since: "2022-03-25", updatedAt: null, drawCount: 0 },
    main: ensureMap(50),
    euro: ensureMap(12),
    processedDrawDates: []
  });

  // 3) idempotentne skontroluj dátum
  const date = String(last.date);
  if (hist.processedDrawDates.includes(date)) {
    console.log(`[history] draw ${date} is already processed – skip.`);
  } else {
    // 4) inkrementuj main
    for (const n of (last.main || [])) {
      const key = String(n);
      if (hist.main[key]) {
        hist.main[key].count += 1;
        hist.main[key].lastSeen = date;
      }
    }
    // 5) inkrementuj euro
    for (const n of (last.euro || [])) {
      const key = String(n);
      if (hist.euro[key]) {
        hist.euro[key].count += 1;
        hist.euro[key].lastSeen = date;
      }
    }

    hist.meta.drawCount += 1;
    hist.meta.updatedAt = nowIso;
    hist.processedDrawDates.push(date);
    // udržuj rozumnú dĺžku (nepovinné)
    if (hist.processedDrawDates.length > 10000) {
      hist.processedDrawDates = hist.processedDrawDates.slice(-10000);
    }

    console.log(`[history] appended draw ${date}`);
  }

  // 6) zapíš späť
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(HIST_FILE, JSON.stringify(hist, null, 2), "utf8");
  console.log("Wrote", HIST_FILE);
}

main().catch((e) => {
  console.error("[history] failed:", e);
  process.exit(1);
});
