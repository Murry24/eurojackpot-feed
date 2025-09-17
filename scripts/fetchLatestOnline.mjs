import fs from "fs";
import https from "https";
import cheerio from "cheerio";

const URL = "https://www.tipos.sk/loterie/eurojackpot/vysledky-a-vyhry";

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

const html = await fetchPage(URL);
const $ = cheerio.load(html);

// ---- podľa štruktúry stránky TIPOS (nutné doladiť podľa HTML) ----
const date = $(".game-results .date").first().text().trim();
const numbers = $(".game-results .numbers li").map((i, el) => $(el).text().trim()).get();

const main = numbers.slice(0, 5).map(n => parseInt(n, 10));
const euro = numbers.slice(5).map(n => parseInt(n, 10));

const latest = {
  date: date,
  main,
  euro,
};

// uložíme do public/feed_online.json (len pre kontrolu)
fs.writeFileSync("./public/feed_online.json", JSON.stringify(latest, null, 2));
console.log("Fetched latest draw:", latest);
