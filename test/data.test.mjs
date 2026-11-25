// Test: história ťahov je v poriadku a nové pomocné funkcie fungujú (npm test)
import test from "node:test";
import assert from "node:assert/strict";
import { checkData } from "../scripts/checkData.mjs";
import { nextDrawDate } from "../scripts/appendToCsv.mjs";

test("história: každý riadok má 5+2 platné čísla a žiadny dátum nie je dvakrát", () => {
  const { count, problems } = checkData();
  assert.ok(count > 400);
  // chýbajúce ťahy (napr. dnešný ešte nezapísaný) tu neriešime, len chybné/duplicitné riadky
  assert.deepEqual(problems.filter((p) => !p.startsWith("chýba ťah")), []);
});

test("najbližšie žrebovanie po ťahu", () => {
  assert.equal(nextDrawDate("2026-11-20"), "2026-11-24"); // piatok -> utorok
  assert.equal(nextDrawDate("2026-11-24"), "2026-11-27"); // utorok -> piatok
});
