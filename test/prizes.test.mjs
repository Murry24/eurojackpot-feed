// Test čítania výherných poradí z TIPOS (spustíš: npm test)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { load } from "cheerio";
import { parsePrizes, parseEurDecimal } from "../scripts/fetchLatestOnline.mjs";

test("výherné poradia z TIPOS tabuľky", () => {
  const p = parsePrizes(load(fs.readFileSync(new URL("./prizes.fixture.html", import.meta.url), "utf8")));
  assert.equal(p.length, 12);
  assert.deepEqual(
    { tier: p[0].tier, hits: p[0].hits, amountEUR: p[0].amountEUR },
    { tier: 1, hits: "5+2", amountEUR: 10000000 },
  );
  assert.equal(p[8].hits, "3+1");
  assert.equal(p[8].amountEUR, 20);
  assert.equal(p[8].winnersSK, 481);
  assert.equal(p[1].winners.length, 3);
});

test("sumy v eurách", () => {
  assert.equal(parseEurDecimal("4 903,20 €"), 4903.2);
  assert.equal(parseEurDecimal("9,20 €"), 9.2);
  assert.equal(parseEurDecimal("—"), null);
});
