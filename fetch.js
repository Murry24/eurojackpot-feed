// fetch.js — vygeneruje public/feed.json
import { load } from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";

async function getHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function parseYear(year) {
  const url = `https://www.euro-jackpot.net/results-archive-${year}`;
  const html = await getHtml(url);
  const $ = load(html);   // ← použijeme load z cheerio
  const out = [];

  // POZOR: selektory sú ilustračné; ak stránka zmení HTML, treba doladiť
  $(".archive .result, .result, .draw").each((_, el) => {
    const dateTxt = $(el).find(".date, time, .draw-date").first().text().trim();
    const dt = new Date(dateTxt);
    if (String(dt) === "Invalid Date") return;

    const nums = [];
    $(el)
      .find(".balls li, .numbers li, .ball")
      .each((__, li) => {
        const n = parseInt($(li).text().trim(), 10);
        if (!Number.isNaN(n)) nums.push(n);
      });

    if (nums.length >= 7) {
      out.push({
        date: dt.toISOString().slice(0, 10),
        main: nums.slice(0, 5),
        euro: nums.slice(5, 7),
      });
    }
  });

  return out;
}

function dedupeSort(list) {
  const map = new Map();
  for (const d of list) map.set(`${d.date}|${d.main}|${d.euro}`, d);
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function build() {
  const years = [2022, 2023, 2024, 2025];
  let all = [];
  for (const y of years) {
    const part = await parseYear(y);
    all = all.concat(part);
  }
  // filter po zmene pravidiel
  const filtered = dedupeSort(all).filter((x) => x.date >= "2022-03-25");

  mkdirSync("public", { recursive: true });
  writeFileSync("public/feed.json", JSON.stringify(filtered, null, 2), "utf-8");
  console.log(`Wrote public/feed.json with ${filtered.length} draws`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

