// fetch.js  — ESM
import { writeFile, readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "public", "feed.json");

// ---- Helpers --------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // TIPOS vracia HTML s týmto UA spoľahlivejšie
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  return await res.text();
}

function toIntArray(arr) {
  return arr
    .map((x) => String(x).replace(/[^\d]/g, ""))
    .filter(Boolean)
    .map((x) => parseInt(x, 10));
}

function parseEur(text) {
  // "61 000 000,00 €" -> 61000000
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

// ---- Parsovanie TIPOS -----------------------------------------------------

async function getFromTipos() {
  const URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";
  const html = await fetchText(URL);
  const $ = load(html);

  // Dátum (input s value "29. 08. 2025")
  const dateStr = $('div#results-date input[name="date"]').attr("value")?.trim();
  if (!dateStr) throw new Error("TIPOS: nerozpoznaný dátum");
  // prevedieme "29. 08. 2025" -> "2025-08-29"
  const [d, m, y] = dateStr.replace(/\s+/g, "").split(".");
  const isoDate = `${y}-${m}-${d}`;

  // Hlavné čísla (li bez additional)
  const main = toIntArray(
    $("#results li")
      .filter((_, el) => !$(el).attr("data-additional"))
      .map((_, el) => $(el).text().trim())
      .get()
  ).sort((a, b) => a - b);

  // Euro čísla (li s additional)
  const euro = toIntArray(
    $('#results li[data-additional="true"]')
      .map((_, el) => $(el).text().trim())
      .get()
  ).sort((a, b) => a - b);

  // Joker (šesť číslic)
  const joker = $("#results-joker li")
    .map((_, el) => $(el).text().trim())
    .get()
    .join("");

  // Jackpot (label for="EurojackpotPart_Jackpot")
  const jackpotText = $('label[for="EurojackpotPart_Jackpot"]').text().trim();
  const nextJackpotEUR = parseEur(jackpotText);

  return {
    nextJackpotEUR,
    draw: { date: isoDate, main, euro, joker: joker || null },
    source: "tipos",
  };
}

// ---- Fallback: nech workflow nepadne --------------------------------------

async function readExistingOrEmpty() {
  try {
    const txt = await readFile(OUT, "utf8");
    return JSON.parse(txt);
  } catch {
    return {
      meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null, source: "none" },
      draws: [],
    };
  }
}

// ---- Hlavný beh -----------------------------------------------------------

async function main() {
  try {
    const t = await getFromTipos();

    const feed = {
      meta: {
        generatedAt: new Date().toISOString(),
        nextJackpotEUR: t.nextJackpotEUR,
        source: t.source,
      },
      draws: [
        {
          date: t.draw.date,
          main: t.draw.main,
          euro: t.draw.euro,
          ...(t.draw.joker ? { joker: t.draw.joker } : {}),
        },
      ],
    };

    await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n", "utf8");
    console.log(`Wrote ${OUT}`);
  } catch (err) {
    console.warn(`[fetch] failed: ${err.message}`);
    const fallback = await readExistingOrEmpty();
    fallback.meta.generatedAt = new Date().toISOString();
    await writeFile(OUT, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    console.log(`Wrote fallback ${OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
