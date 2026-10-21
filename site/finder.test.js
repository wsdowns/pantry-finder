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

test("text line accepts coordinates for a looked-up street address", () => {
  const now = at(2026, 10, 21, 10);
  const here = F.PLACES["31062"];
  assert.strictEqual(F.smsAnswer("472 Broad St", now, P, DELIVERY, here), F.smsAnswer("31062", now, P, DELIVERY));
  assert.ok(F.smsAnswer("472 Broad St", now, P, DELIVERY).startsWith("Sorry, I couldn't find"));
});

test("directions link matches pantry.py: resolvable name when known, coordinates otherwise, origin encoded", () => {
  const mia2 = P.find((p) => p.name.startsWith("MIA"));
  assert.ok(F.directionsUrl(chard).includes("destination=Chard%20Wray%20Food%20Pantry%2C%20454%20Broad%20St"));
  assert.ok(!F.directionsUrl(chard).includes("origin="));
  assert.ok(F.directionsUrl(mia2).includes(`destination=${mia2.lat},${mia2.lng}`));
  assert.ok(F.directionsUrl(chard, "Georgia College & State University, Milledgeville, GA")
    .endsWith("&origin=Georgia%20College%20%26%20State%20University%2C%20Milledgeville%2C%20GA"));
  const py = execFileSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})\nimport pantry\n` +
    `p = [x for x in pantry.PANTRIES if x['name'].startswith('Chard')][0]\nprint(pantry.directions_url(p, 'A & B, Milledgeville, GA'), end='')`]).toString();
  assert.strictEqual(F.directionsUrl(chard, "A & B, Milledgeville, GA"), py);
});

test("directions link starts from the matched address, and only then", () => {
  const now = at(2026, 10, 21, 10);
  const withAddr = F.smsAnswer("204 E Hancock Street", now, P, DELIVERY, [33.0824, -83.2217], "204 E Hancock St, Milledgeville, GA, 31061");
  const link = withAddr.split(/\s+/).find((w) => w.startsWith("https://www.google.com/maps/dir/"));
  assert.ok(link.includes("&origin=204%20E%20Hancock%20St%2C%20Milledgeville%2C%20GA%2C%2031061"), link);
  assert.ok(!F.smsAnswer("31061", now, P, DELIVERY).includes("origin="));
});

const expectedOrder = (zip, now) => F.byDistance(F.PLACES[zip], now, P).map((r) => r.p);

test("spoken words match pantry.py (addresses, distances, clock, when, text)", () => {
  const times = [[2026, 10, 21, 12, 0], [2026, 10, 21, 9, 0], [2026, 10, 22, 9, 0], [2026, 10, 27, 9, 30], [2026, 11, 19, 8, 0], [2026, 10, 21, 13, 15]];
  const dists = [0.05, 0.19, 0.2, 0.96, 1.04, 2.66];
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(ROOT)})\nimport pantry\nfrom datetime import datetime\nT = pantry.TZ\n` +
    `now = datetime(2026, 10, 21, 10, 0, tzinfo=T)\ntimes = ${JSON.stringify(times)}\n` +
    `print(json.dumps({"addr": [pantry.spoken_address(p) for p in pantry.PANTRIES], "dist": [pantry.spoken_distance(d) for d in ${JSON.stringify(dists)}],` +
    ` "clock": [pantry.spoken_clock(datetime(*t, tzinfo=T)) for t in times], "when": [pantry.spoken_when(datetime(*t, tzinfo=T), now) for t in times],` +
    ` "text": pantry.spoken_text("Hot meal Mon-Fri, calls Mon-Thu")}))`;
  const py = JSON.parse(execFileSync("python3", ["-I", "-c", code]).toString());
  assert.deepStrictEqual(P.map(F.spokenAddress), py.addr);
  assert.deepStrictEqual(dists.map(F.spokenDistance), py.dist);
  assert.deepStrictEqual(times.map((t) => F.spokenClock(at(...t))), py.clock);
  assert.deepStrictEqual(times.map((t) => F.spokenWhen(at(...t), at(2026, 10, 21, 10))), py.when);
  assert.strictEqual(F.spokenText("Hot meal Mon-Fri, calls Mon-Thu"), py.text);
});

test("phone line: ZIP reads one pantry at a time, nearest first, with keys 1/2/3/9", () => {
  const now = at(2026, 10, 21, 10);
  assert.ok(F.ivr("", "", {}, now, P, DELIVERY).ask.prompt.startsWith("Press 1"));
  assert.ok(F.ivr("zip", "90210", {}, now, P, DELIVERY).say[0].includes("only know"));
  for (const zip of ["31061", "31062", "31059"]) {
    const order = expectedOrder(zip, now);
    let turn = F.ivr("zip", zip, {}, now, P, DELIVERY);
    for (let i = 0; i < order.length; i++) {
      const text = turn.say.join(" ");
      assert.ok(text.includes(order[i].spoken_name || order[i].name), `${zip} #${i}`);
      assert.ok(order.filter((_, j) => j !== i).every((o) => !text.includes(o.spoken_name || o.name)), "only one pantry per turn");
      assert.ok(turn.ask.prompt.includes("Press 2 to hear this one again") && turn.ask.prompt.includes("Press 9 to start over"));
      if (i + 1 < order.length) {
        assert.ok(turn.ask.prompt.includes("Press 3 for the next closest"));
        turn = F.ivr("nav", "3", turn.ask.ctx, now, P, DELIVERY);
      }
    }
    assert.ok(turn.say.join(" ").includes("That is the last pantry I have") && !turn.ask.prompt.includes("Press 3"));
    assert.ok(F.ivr("nav", "3", turn.ask.ctx, now, P, DELIVERY).say.join(" ").includes("last pantry"));   // 3 on the last stays put
  }
  const t1 = F.ivr("zip", "31062", {}, now, P, DELIVERY);
  assert.deepStrictEqual(F.ivr("nav", "2", t1.ask.ctx, now, P, DELIVERY).say, t1.say);           // 2 repeats
  assert.deepStrictEqual(F.ivr("nav", "7", t1.ask.ctx, now, P, DELIVERY).say, t1.say);           // unknown key repeats
  assert.ok(F.ivr("nav", "9", t1.ask.ctx, now, P, DELIVERY).say[0].startsWith("Welcome"));       // 9 starts over
});

test("phone line: connect works open or closed (voicemail warning), forward:false removes it", () => {
  const now = at(2026, 10, 21, 10), later = at(2026, 10, 21, 13);
  assert.strictEqual(F.forwardNumber(chard), "+14784141126");
  assert.strictEqual(F.forwardNumber({ phone: "(478) 453-4111 ext. 2" }), "+14784534111");
  assert.strictEqual(F.forwardNumber({ phone: "211" }), null);
  assert.strictEqual(F.forwardNumber({ website: "https://x.test" }), null);                       // no phone at all: no crash
  const open = F.ivr("zip", "31062", {}, now, P, DELIVERY);
  assert.ok(open.ask.prompt.includes("Press 1 to be connected.") && !open.ask.prompt.includes("leave a message"));
  const c1 = F.ivr("nav", "1", open.ask.ctx, now, P, DELIVERY);
  assert.ok(c1.connected && !c1.say[0].includes("voicemail"));
  const closed = F.ivr("zip", "31062", {}, later, P, DELIVERY);
  assert.ok(closed.ask.prompt.includes("They are closed, so you can leave a message"));
  const c2 = F.ivr("nav", "1", closed.ask.ctx, later, P, DELIVERY);
  assert.ok(c2.connected && c2.say[0].includes("you may reach a voicemail"));
  const off = P.map((p) => (p === chard ? { ...p, forward: false } : p));
  const offTurn = F.ivr("zip", "31062", {}, now, off, DELIVERY);
  assert.ok(!offTurn.ask.prompt.includes("Press 1"));
  const refused = F.ivr("nav", "1", offTurn.ask.ctx, now, off, DELIVERY);
  assert.ok(!refused.connected && refused.say[0].includes("could not connect"));
});

test("phone line: delivery is read one at a time with the same keys", () => {
  const now = at(2026, 10, 21, 10);
  let turn = F.ivr("menu", "2", {}, now, P, DELIVERY);
  assert.ok(turn.say.join(" ").includes("mostly for seniors") && turn.say.join(" ").includes("Baldwin County Senior Citizens Center"));
  assert.ok(turn.say.join(" ").includes("Monday through Friday") && !turn.say.join(" ").includes("Mon-Fri"));
  assert.ok(["Press 1", "Press 2", "Press 3", "Press 9"].every((k) => turn.ask.prompt.includes(k)));
  assert.ok(!turn.say.join(" ").includes("Overview"));                                           // only the first option
  for (let i = 0; i + 1 < DELIVERY.length; i++) turn = F.ivr("nav", "3", turn.ask.ctx, now, P, DELIVERY);
  const text = turn.say.join(" ");
  assert.ok(text.includes("Two one one") && text.includes("That is the last option I have"));
  assert.ok(!turn.ask.prompt.includes("Press 3") && !turn.ask.prompt.includes("Press 1"));      // 2-1-1 is not connectable
  const mowIdx = DELIVERY.findIndex((d) => !d.phone);
  const mow = F.ivr("nav", "3", { kind: "delivery", i: mowIdx - 1 }, now, P, DELIVERY);
  assert.ok(mow.say.join(" ").includes("Meals on Wheels") && !mow.say.join(" ").includes("Phone number") && !mow.ask.prompt.includes("Press 1"));
  const dial = F.ivr("nav", "1", { kind: "delivery", i: 0 }, now, P, DELIVERY);
  assert.ok(dial.connected && dial.say[0].includes("Baldwin County Senior Citizens Center"));
  assert.ok(F.ivr("nav", "9", { kind: "delivery", i: 0 }, now, P, DELIVERY).say[0].startsWith("Welcome"));
});

test("speakPhone", () => {
  assert.strictEqual(F.speakPhone("(478) 453-4111 ext. 2"), "4 7 8, 4 5 3, 4 1 1 1, extension 2");
  assert.strictEqual(F.speakPhone("211"), "2 1 1");
});
test("locate", () => {
  assert.deepStrictEqual(F.locate("GCSU"), F.PLACES.gcsu);
  assert.strictEqual(F.locate("nowhere"), null);
});
