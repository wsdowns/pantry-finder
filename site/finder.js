// Port of pantry.py's schedule/distance logic. Times are handled as "naive" Eastern wall-clock
// milliseconds (Date.UTC of the Eastern clock fields), so DST never shifts a pantry's posted hours.
(function (root) {
  const PLACES = {
    "31061": [33.09, -83.23], "31062": [33.05, -83.22], "31059": [33.0801, -83.2321],
    "gcsu": [33.0801, -83.233], "georgia college": [33.0801, -83.233],
    "gmc": [33.079, -83.231], "georgia military college": [33.079, -83.231],
    "downtown": [33.0801, -83.2321], "central state": [33.0514, -83.2198],
  };
  const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;

  function etNow(d = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    }).formatToParts(d);
    const g = (t) => +parts.find((x) => x.type === t).value;
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  }

  const dayStart = (ms) => ms - (((ms % DAY) + DAY) % DAY);
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const clock = (s) => { const [h, m] = s.split(":").map(Number); return h * HOUR + m * MIN; };

  // Open windows [start, end] for one pantry on the day beginning at dayMs.
  function windowsOn(p, dayMs) {
    if ((p.closures || []).includes(isoDate(dayMs))) return [];
    const dt = new Date(dayMs);
    const weekday = (dt.getUTCDay() + 6) % 7, nth = Math.floor((dt.getUTCDate() - 1) / 7) + 1;
    return p.schedule
      .filter((s) => s.weekday === weekday && (s.nth === undefined || s.nth === nth))
      .map((s) => [dayMs + clock(s.start), dayMs + clock(s.end)]);
  }

  // {state:"open", when:closesAt} or {state:"closed", when:nextOpen|null}; looks 60 days ahead.
  function status(p, nowMs) {
    let next = null;
    for (let d = 0; d <= 60; d++) {
      for (const [s, e] of windowsOn(p, dayStart(nowMs) + d * DAY)) {
        if (s <= nowMs && nowMs < e) return { state: "open", when: e };
        if (s > nowMs && (next === null || s < next)) next = s;
      }
      if (next !== null) break;
    }
    return { state: "closed", when: next };
  }

  function miles(a, b) {
    const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 +
      Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(h));
  }

  function locate(text) {
    const q = String(text).trim().toLowerCase();
    for (const k of Object.keys(PLACES)) if (q.includes(k)) return PLACES[k];
    return null;
  }

  // Open-now first (nearest), then soonest to open (nearest breaks ties).
  function rank(where, nowMs, pantries) {
    const rows = pantries.map((p) => ({ p, ...status(p, nowMs), dist: miles(where, [p.lat, p.lng]) }));
    const open = rows.filter((r) => r.state === "open").sort((a, b) => a.dist - b.dist);
    const later = rows.filter((r) => r.state !== "open")
      .sort((a, b) => (a.when ?? Infinity) - (b.when ?? Infinity) || a.dist - b.dist);
    return [...open, ...later];
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    let h = d.getUTCHours();
    const m = d.getUTCMinutes(), ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")}${ap}`;
  }
  function fmt(ms, nowMs) {
    const diff = Math.round((dayStart(ms) - dayStart(nowMs)) / DAY);
    if (diff === 0) return `today ${fmtTime(ms)}`;
    if (diff === 1) return `tomorrow ${fmtTime(ms)}`;
    const dt = new Date(ms);
    return `${WD[dt.getUTCDay()]} ${MO[dt.getUTCMonth()]} ${dt.getUTCDate()} ${fmtTime(ms)}`;
  }
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // --- Text line and phone line: ports of pantry.py's answer() and voice(), so the demo matches the real lines. ---
  const DELIVERY_WORDS = ["deliver", "homebound", "can't get out", "cant get out", "bring food", "meals on wheels"];

  function speakPhone(phone) {
    const [main, ext = ""] = phone.split("ext.");
    const d = main.replace(/\D/g, "");
    const parts = d.length === 10 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6)] : [d];
    const e = ext.replace(/\D/g, "");
    return parts.map((x) => x.split("").join(" ")).join(", ") + (e ? ", extension " + e.split("").join(" ") : "");
  }

  function deliveryAnswer(delivery) {
    const blocks = delivery.map((d) =>
      `${d.name}\n${d.phone || d.website || ""}\n${d.who}${d.hours ? "\n" + d.hours : ""}`);
    return "Food delivery in Baldwin County (mostly for seniors 60+ or homebound):\n\n" + blocks.join("\n\n") +
      "\n\nCall to confirm who qualifies. Text a ZIP to find pantries instead.";
  }

  function smsAnswer(text, nowMs, pantries, delivery) {
    if (DELIVERY_WORDS.some((w) => text.toLowerCase().includes(w))) return deliveryAnswer(delivery);
    const where = locate(text);
    if (!where) return "Sorry, I couldn't find that place. Text a ZIP (31061), a landmark (GCSU), or a street address.";
    const lines = rank(where, nowMs, pantries).slice(0, 3).map((r, i) => {
      const head = r.state === "open" ? `OPEN NOW until ${fmt(r.when, nowMs)}` : `Closed, opens ${fmt(r.when, nowMs)}`;
      const note = r.p.note ? ` (${r.p.note})` : "";
      let line = `${r.p.name} - ${head}\n${r.p.address} - ${r.dist.toFixed(1)} mi\n${r.p.phone}${note}`;
      if (i === 0) line += `\nhttps://www.google.com/maps/dir/?api=1&destination=${r.p.lat},${r.p.lng}`;
      return line;
    });
    return lines.join("\n\n") + "\n\nHours change; call first. Reply with another ZIP to search again.";
  }

  // One step of the phone line. Returns {say:[...], ask:{prompt,digits,step,ctx}|undefined, end?:true}.
  function ivr(step, digits, ctx, nowMs, pantries, delivery) {
    const menu = { say: ["Welcome to Milledgeville food help."],
      ask: { prompt: "Press 1 to find a food pantry near you. Press 2 for home delivery.", digits: 1, step: "menu", ctx: {} } };
    const askZip = (say) => ({ say, ask: { prompt: "Enter your 5 digit ZIP code.", digits: 5, step: "zip", ctx: {} } });
    if (!step) return menu;
    if (step === "menu") {
      if (digits === "1") return askZip([]);
      if (digits === "2") {
        return { end: true, say: ["Home delivery is mostly for seniors or people who cannot leave home. Please call to confirm who qualifies.",
          ...delivery.filter((d) => d.phone).map((d) => `${d.name}. ${speakPhone(d.phone)}. ${d.who}`), "Goodbye."] };
      }
      return menu;
    }
    if (step === "zip") {
      const where = PLACES[digits];
      if (!where) return askZip(["Sorry, I only know Milledgeville ZIP codes, such as 3 1 0 6 1."]);
      const top = rank(where, nowMs, pantries).slice(0, 2);
      const say = top.map((r) => `${r.p.name}, ${r.dist.toFixed(1)} miles away, at ${r.p.address}. ` +
        (r.state === "open" ? `It is open now, until ${fmt(r.when, nowMs)}.` : `It is closed. It opens ${fmt(r.when, nowMs)}.`) +
        ` Phone: ${speakPhone(r.p.phone)}.`);
      const conn = top.find((r) => r.state === "open" && r.p.forward);
      let opts = "Press 2 to hear this again. Press 9 to start over.";
      if (conn) opts = `Press 1 to be connected to ${conn.p.name} now. ` + opts;
      return { say, ask: { prompt: opts, digits: 1, step: "pick", ctx: { zip: digits, n: conn ? pantries.indexOf(conn.p) : -1 } } };
    }
    if (step === "pick") {
      const p = ctx.n >= 0 ? pantries[ctx.n] : null;
      const ok = !!(p && p.forward && status(p, nowMs).state === "open");
      if (digits === "1") {
        return { end: true, connected: ok, say: ok ? [`Connecting you to ${p.name}. They are volunteers, so please be patient.`]
          : ["Sorry, that pantry has just closed. Please call back during their hours. Goodbye."] };
      }
      if (digits === "2") return ivr("zip", ctx.zip, {}, nowMs, pantries, delivery);
      return menu;
    }
    return menu;
  }

  root.Finder = { PLACES, etNow, windowsOn, status, miles, locate, rank, fmt, fmtTime, dayStart, DAY, HOUR,
    smsAnswer, deliveryAnswer, ivr, speakPhone };
  if (typeof module !== "undefined") module.exports = root.Finder;
})(typeof window !== "undefined" ? window : globalThis);
