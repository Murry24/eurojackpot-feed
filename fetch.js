// fetch.js
// Node 20+ (global fetch). Produkuje public/feed.json v tvare, ktorý appka očakáva.

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = 'public';
const OUT_FILE = path.join(OUT_DIR, 'feed.json');

// Primárny zdroj (Lottoland – dlhodobo stabilný formát)
const LL_URL = 'https://media.lottoland.com/api/drawings/euroJackpot';

// Pomocná: bezpečný sleep (ak by sme chceli retry)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchLottoland() {
  const r = await fetch(LL_URL, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r.json();
}

function mapLLtoFeed(json) {
  // Očakávaná štruktúra: { last: {...}, next: {...}, previous: [...] }
  const draws = [];
  const pushOne = (d) => {
    if (!d) return;
    if (!Array.isArray(d.numbers) || !Array.isArray(d.euroNumbers)) return;
    draws.push({
      date: d.date,                 // "YYYY-MM-DD"
      main: [...d.numbers].sort((a,b)=>a-b),
      euro: [...d.euroNumbers].sort((a,b)=>a-b),
    });
  };

  // posledný ťah
  pushOne(json.last);

  // historické ťahy
  if (Array.isArray(json.previous)) {
    for (const d of json.previous) pushOne(d);
  }

  // meta / jackpot
  let nextJackpotEUR = null;
  try {
    // niekedy je v json.next.jackpot ako číslo v EUR (alebo ako string)
    if (json.next && json.next.jackpot != null) {
      const n = Number(json.next.jackpot);
      if (!Number.isNaN(n)) nextJackpotEUR = n;
    }
  } catch { /* ignore */ }

  // dátumy vzostupne
  draws.sort((a,b)=> (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      nextJackpotEUR,
    },
    draws,
  };
}

async function main() {
  try {
    const raw = await fetchLottoland();

    const feed = mapLLtoFeed(raw);

    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(feed, null, 2), 'utf8');

    console.log(`OK: wrote ${OUT_FILE} with ${feed.draws.length} draws`);
    process.exit(0);
  } catch (e) {
    console.error('Build failed:', e);
    // Ak chceš, nechaj aj „prázdny“ feed s meta, aby Pages vždy niečo publikovali:
    const fallback = {
      meta: { generatedAt: new Date().toISOString(), nextJackpotEUR: null },
      draws: []
    };
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    process.exit(1);
  }
}

main();

