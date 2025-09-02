// fetch.js  (ESM, Node >= 18)
import fs from "node:fs/promises";
import * as cheerio from "cheerio";

/**
 * Tu si nastav zdroj – môžeš použiť oficiálny web a scrapovať,
 * alebo vlastný endpoint s JSON. Nižšie je ukážka s "fake"
 * hodnotami, aby workflow prešiel. Keď budeš mať reálny zdroj,
 * naplň polia `draws` podľa reality.
 */
async function getLatest() {
  // --- ukážkový zdroj (sem dosadíš reálny fetch) ---
  // const res = await fetch("https://.../posledny-vysledok");
  // const html = await res.text();
  // const $ = cheerio.load(html);
  // ... naparsuj čísla a dátum ...
  // return { date: "2025-08-29", main: [3,5,19,23,48], euro: [1,5], nextJackpotEUR: 61000000 };

  // Dočasný stabilný výstup (kým nenapojíš reálny zdroj)
  return {
    date: "2025-08-29",
    main: [3, 5, 19, 23, 48],
    euro: [1, 5],
    nextJackpotEUR: 61000000,
  };
}

function toFeed({ date, main, euro, nextJackpotEUR }) {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR,
    },
    draws: [
      {
        date,          // ISO: "YYYY-MM-DD" – tvoj kód v appke to už akceptuje
        main,          // [int,int,int,int,int]
        euro,          // [int,int]
      },
    ],
  };
}

async function main() {
  const latest = await getLatest();
  const feed = toFeed(latest);

  // zapíš do public/feed.json (GitHub Pages bude čítať z /public)
  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/feed.json", JSON.stringify(feed, null, 2), "utf8");

  console.log("feed.json written:", feed);
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});

