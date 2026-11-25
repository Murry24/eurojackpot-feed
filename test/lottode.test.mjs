import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseLottoDe, pickLatest } from "../scripts/fetchLatestOnline.mjs";

const j = JSON.parse(fs.readFileSync(new URL("./lottode_last.fixture.json", import.meta.url), "utf8"));

test("lotto.de: čísla, dátum a 12 poradí", () => {
  const r = parseLottoDe(j);
  assert.equal(r.date, "2026-11-24");
  assert.deepEqual(r.main, [22, 32, 35, 36, 40]);
  assert.deepEqual(r.euro, [3, 9]);
  assert.equal(r.prizes.length, 12);
  assert.equal(r.prizes[0].hits, "5+2");
  assert.equal(r.prizes[0].amountEUR, 10000000);
  assert.equal(r.prizes[11].hits, "2+1");
});

test("pickLatest: zhoda, nezhoda, výpadky", () => {
  const l = parseLottoDe(j);
  const t = { ...l, joker: "528807", prizes: [], jackpotEUR: 15000000 };
  const ok = pickLatest(t, l);
  assert.equal(ok.source, "tipos.sk+lotto.de");
  assert.equal(ok.latest.joker, "528807");
  assert.equal(ok.latest.prizes.length, 12); // doplnené z lotto.de
  const bad = pickLatest({ ...t, euro: [3, 10] }, l);
  assert.equal(bad.latest, null);
  assert.match(bad.warning, /NEZHODA/);
  assert.equal(pickLatest(null, l).source, "lotto.de");
  assert.equal(pickLatest(t, null).source, "tipos.sk");
  assert.equal(pickLatest({ ...t, date: "2026-11-20" }, l).source, "lotto.de");
  assert.equal(pickLatest(null, null).latest, null);
});
