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
  assert.strictEqual(F.fmt(at(2026, 10, 27, 9, 30), now), "Tue Oct 27 9:30am");
});

// The demo's text line must say exactly what pantry.py says. Runs the real Python for each case.
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const DELIVERY = JSON.parse(fs.readFileSync(path.join(ROOT, "pantries.json"))).delivery;
const py = (text, y, m, d, h, mi) => execFileSync("python3", ["-I", "-c",
  `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})\nimport pantry\nfrom datetime import datetime\n` +
  `print(pantry.answer(sys.argv[1], datetime(${y},${m},${d},${h},${mi},tzinfo=pantry.TZ)), end="")`, text]).toString();

test("text line matches pantry.py exactly", () => {
  const times = [[2026, 10, 21, 10, 0], [2026, 10, 21, 13, 0], [2026, 10, 17, 15, 0], [2026, 10, 15, 8, 30], [2026, 11, 3, 9, 30]];
  for (const text of ["31061", "31062", "31059", "gcsu", "downtown", "delivery", "I am homebound"]) {
    for (const t of times) {
      assert.strictEqual(F.smsAnswer(text, at(...t), P, DELIVERY), py(text, ...t), `${text} @ ${t}`);
    }
  }
});

test("phone line: menu, ZIP, delivery, connect only when open and enabled", () => {
  const now = at(2026, 10, 21, 10);
  assert.ok(F.ivr("", "", {}, now, P, DELIVERY).ask.prompt.startsWith("Press 1"));
  const del = F.ivr("menu", "2", {}, now, P, DELIVERY);
  assert.ok(del.end && del.say.some((s) => s.includes("4 7 8, 4 5 1, 0 4 4 5")));
  const zip = F.ivr("zip", "31062", {}, now, P, DELIVERY);
  assert.ok(zip.say[0].startsWith("Chard Wray") && zip.say[0].includes("open now"));
  assert.ok(!zip.ask.prompt.includes("connected"));
  const fwd = P.map((p) => (p === chard ? { ...p, forward: "+14785550123" } : p));
  const offer = F.ivr("zip", "31062", {}, now, fwd, DELIVERY);
  assert.ok(offer.ask.prompt.startsWith("Press 1 to be connected to Chard Wray"));
  assert.strictEqual(F.ivr("pick", "1", offer.ask.ctx, now, fwd, DELIVERY).connected, true);
  assert.strictEqual(F.ivr("pick", "1", offer.ask.ctx, at(2026, 10, 21, 13), fwd, DELIVERY).connected, false);
  assert.ok(F.ivr("zip", "90210", {}, now, P, DELIVERY).say[0].includes("only know"));
});

test("speakPhone", () => {
  assert.strictEqual(F.speakPhone("(478) 453-4111 ext. 2"), "4 7 8, 4 5 3, 4 1 1 1, extension 2");
  assert.strictEqual(F.speakPhone("211"), "2 1 1");
});
test("locate", () => {
  assert.deepStrictEqual(F.locate("GCSU"), F.PLACES.gcsu);
  assert.strictEqual(F.locate("nowhere"), null);
});
