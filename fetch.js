// fetch.js
import cheerio from "cheerio";

async function getHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {signal: ctrl.signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function parseYear(year) {
  const url = `https://www.euro-jackpot.net/results-archive-${year}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const out = [];
  // POZOR: selektory sú ilustračné – ak stránka zmení HTML, upravíme.
  $(".archive .result, .result, .draw").each((_, el) => {
    const dateTxt = $(el).find(".date, time, .draw-date").first().text().trim();
    const dt = new Date(dateTxt);
    if (String(dt) === "Invalid Date") return;

    const nums = [];
    $(el).find(".balls li, .numbers li, .ball").each((__, li) => {
      const n = parseInt($(li).text().trim(), 10);
      if (!Number.isNaN(n)) nums.push(n);
    });
    if (nums.length >= 7) {
      out.push({
        date: dt.toISOString().slice(0,10),
        main: nums.slice(0,5),
        euro: nums.slice(5,7),
      });
    }
  });
  return out;
}

function dedupeSort(list) {
  const map = new Map();
  for (const d of list) map.set(`${d.date}|${d.main}|${d.euro}`, d);
  return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));
}

const years = [2022, 2023, 2024, 2025];
let all = [];
for (const y of years) {
  const part = await parseYear(y);
  all = all.concat(part);
}
const filtered = dedupeSort(all).filter(x => x.date >= "2022-03-25");

// zapíš JSON do súboru feed.json
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
writeFileSync("public/feed.json", JSON.stringify(filtered, null, 2), "utf-8");
console.log(`Wrote public/feed.json with ${filtered.length} draws`);

