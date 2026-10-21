// Mirrors test_pantry.py so the website and the text line cannot disagree. Run: node --test site/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const F = require("./finder.js");

const P = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "pantries.json"))).pantries;
const chard = P.find((p) => p.name.startsWith("Chard"));
const mia = P.find((p) => p.name.startsWith("MIA"));
const at = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

test("open during hours", () => {
  assert.deepStrictEqual(F.status(chard, at(2026, 10, 21, 10)), { state: "open", when: at(2026, 10, 21, 12) });
});
test("closed opens next day", () => {
  assert.deepStrictEqual(F.status(chard, at(2026, 10, 21, 13)), { state: "closed", when: at(2026, 10, 22, 9) });
});
test("end time is exclusive", () => assert.strictEqual(F.status(chard, at(2026, 10, 21, 12)).state, "closed"));
test("third Thursday only", () => {
  assert.strictEqual(F.status(mia, at(2026, 10, 15, 8, 30)).state, "open");
  assert.strictEqual(F.status(mia, at(2026, 10, 8, 8, 30)).state, "closed");
  assert.strictEqual(F.status(mia, at(2026, 10, 22, 8, 30)).state, "closed");
});
test("next third Thursday across month", () => {
  assert.strictEqual(F.status(mia, at(2026, 10, 21, 10)).when, at(2026, 11, 19, 8));
});
test("closure skips date", () => {
  const p = { ...chard, closures: ["2026-10-22"] };
  assert.strictEqual(F.status(p, at(2026, 10, 21, 13)).when, at(2026, 10, 27, 9));
});
test("DST fall-back week keeps 9am", () => {
  const { when } = F.status(chard, at(2026, 11, 1, 12));
  assert.strictEqual(when, at(2026, 11, 3, 9));
});
test("rank puts open pantry first", () => {
  const r = F.rank(F.locate("31062"), at(2026, 10, 21, 10), P);
  assert.ok(r[0].p.name.startsWith("Chard") && r[0].state === "open");
});
test("fmt", () => {
  const now = at(2026, 10, 21, 10);
  assert.strictEqual(F.fmt(at(2026, 10, 21, 12), now), "today 12:00pm");
  assert.strictEqual(F.fmt(at(2026, 10, 22, 9), now), "tomorrow 9:00am");
  assert.strictEqual(F.fmt(at(2026, 10, 27, 9, 30), now), "Tue, Oct 27 9:30am");
});
test("locate", () => {
  assert.deepStrictEqual(F.locate("GCSU"), F.PLACES.gcsu);
  assert.strictEqual(F.locate("nowhere"), null);
});
