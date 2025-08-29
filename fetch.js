// fetch.js – v koreňovom priečinku repo (kde máš aj docs/)
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

async function fetchTiposJackpot() {
  try {
    const res = await fetch("https://www.tipos.sk/loterie/eurojackpot", {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Skúsime nájsť text „Eurojackpot Jackpot 52 000 000,00 €“
    const txt = $("body").text().replace(/\s+/g, " ");
    const m = txt.match(/Eurojackpot\s+Jackpot\s+([\d.\s]+,\d{2})\s*€/i);
    if (!m) return null;

    // "52 000 000,00" -> 52000000
    const eurStr = m[1].replace(/\./g, "").replace(/\s/g, "").replace(",", ".");
    const eur = Math.round(parseFloat(eurStr));
    return Number.isFinite(eur) ? eur : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  // 1) Sem si daj svoj existujúci import CSV/JSON a naplň `draws` (zachovaj svoj kód)
  // Tu ukážková minimálna štruktúra:
  const draws = []; // ← sem naplň svojimi historickými ťahmi (ako doteraz)
  // Každý záznam: { date:"2025-08-26", main:[...5], euro:[...2] }

  // 2) Jackpot z TIPOS
  const nextJackpotEUR = await fetchTiposJackpot();

  // 3) Skladba výstupu
  const out = {
    meta: {
      source: "github: murray24/eurojackpot-feed",
      updated: new Date().toISOString(),
      nextJackpotEUR, // napr. 52000000 (alebo null, ak sa nepodarí)
    },
    draws,
  };

  // 4) Zapíš do docs/feed.json (aby to obsluhovali GitHub Pages)
  const outDir = path.join(process.cwd(), "docs");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "feed.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("OK: docs/feed.json updated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
