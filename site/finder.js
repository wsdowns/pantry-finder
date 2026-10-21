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

  // whereOverride: coordinates already looked up for a street address (the browser geocodes those itself).
  // Mirrors pantry.py's directions_url(): the text Google resolves to the real place (right label), else exact coordinates.
  // Without an origin, Google starts from the device's own location.
  function directionsUrl(p, origin) {
    const dest = p.maps_query ? encodeURIComponent(p.maps_query) : `${p.lat},${p.lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}` + (origin ? `&origin=${encodeURIComponent(origin)}` : "");
  }

  // matchedAddress: the looked-up address, used as the start point of the directions link (like pantry.py).
  function smsAnswer(text, nowMs, pantries, delivery, whereOverride, matchedAddress) {
    if (DELIVERY_WORDS.some((w) => text.toLowerCase().includes(w))) return deliveryAnswer(delivery);
    const where = whereOverride || locate(text);
    if (!where) return "Sorry, I couldn't find that place. Text a ZIP (31061), a landmark (GCSU), or a street address.";
    const lines = rank(where, nowMs, pantries).slice(0, 3).map((r, i) => {
      const head = r.state === "open" ? `OPEN NOW until ${fmt(r.when, nowMs)}` : `Closed, opens ${fmt(r.when, nowMs)}`;
      const note = r.p.note ? ` (${r.p.note})` : "";
      let line = `${r.p.name} - ${head}\n${r.p.address} - ${r.dist.toFixed(1)} mi\n${r.p.phone}${note}`;
      if (i === 0) line += "\n" + directionsUrl(r.p, matchedAddress);
      return line;
    });
    return lines.join("\n\n") + "\n\nHours change; call first. Reply with another ZIP to search again.";
  }

  // Mirrors pantry.py's forward_number(): an explicit number, else the published 10-digit phone; false turns it off.
  function forwardNumber(p) {
    if (p.forward === false) return null;
    if (p.forward) return p.forward;
    const d = (p.phone || "").split("ext.")[0].replace(/\D/g, "");
    return d.length === 10 ? "+1" + d : null;
  }

  // ---- Phone line: port of pantry.py's voice(). One item at a time, nearest first. Plain text for the browser's voice. ----
  const ABBR = { St: "Street", Dr: "Drive", Rd: "Road", Blvd: "Boulevard", Ave: "Avenue", Ln: "Lane", Ct: "Court", Hwy: "Highway",
    N: "North", S: "South", E: "East", W: "West", NE: "Northeast", NW: "Northwest", SE: "Southeast", SW: "Southwest" };
  const SAY_FIX = [["Mon-Fri", "Monday through Friday"], ["Mon-Thu", "Monday through Thursday"]];
  const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHNAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const spokenText = (s) => SAY_FIX.reduce((t, [a, b]) => t.split(a).join(b), s);
  const spokenAddress = (p) => p.address.split(",")[0].split(/\s+/).map((w) => ABBR[w.replace(/\.$/, "")] || w).join(" ") + " in Milledgeville";
  const spokenDistance = (d) => d < 0.2 ? "less than a quarter mile away" : Math.round(d * 10) / 10 === 1 ? "1 mile away" : `${d.toFixed(1)} miles away`;
  function spokenClock(ms) {
    const dt = new Date(ms), h24 = dt.getUTCHours(), m = dt.getUTCMinutes(), h = h24 % 12 || 12, ap = h24 < 12 ? "AM" : "PM";
    if (m === 0 && h24 === 12) return "noon";
    return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
  }
  function spokenWhen(ms, nowMs) {
    const days = Math.round((dayStart(ms) - dayStart(nowMs)) / DAY), c = spokenClock(ms), dt = new Date(ms);
    if (days === 0) return `today at ${c}`;
    if (days === 1) return `tomorrow at ${c}`;
    if (days < 7) return `${DAYNAMES[dt.getUTCDay()]} at ${c}`;
    return `${DAYNAMES[dt.getUTCDay()]}, ${MONTHNAMES[dt.getUTCMonth()]} ${dt.getUTCDate()} at ${c}`;
  }
  const byDistance = (where, nowMs, pantries) =>
    pantries.map((p) => ({ p, ...status(p, nowMs), dist: miles(where, [p.lat, p.lng]) })).sort((a, b) => a.dist - b.dist);

  function options(canConnect, closed, hasNext, nextLabel) {
    const o = [];
    if (canConnect) o.push("Press 1 to be connected." + (closed ? " They are closed, so you can leave a message." : ""));
    o.push("Press 2 to hear this one again.");
    if (hasNext) o.push(`Press 3 for the ${nextLabel}.`);
    o.push("Press 9 to start over.");
    return o.join(" ");
  }

  function pantryTurn(zip, i, nowMs, pantries) {
    const rows = byDistance(PLACES[zip], nowMs, pantries), r = rows[i], p = r.p, open = r.state === "open", last = i + 1 >= rows.length;
    const say = [`${p.spoken_name || p.name}.`, `It is ${spokenDistance(r.dist)}, at ${spokenAddress(p)}.`,
      open ? `It is open now, until ${spokenClock(r.when)}.` : r.when ? `It is closed right now. It opens ${spokenWhen(r.when, nowMs)}.` : "I do not have its hours."];
    if (p.note) say.push(`Note: ${spokenText(p.note)}.`);
    say.push(`Phone number: ${speakPhone(p.phone)}.`);
    if (last) say.push("That is the last pantry I have.");
    return { say, ask: { prompt: options(!!forwardNumber(p), !open, !last, "next closest"), digits: 1, step: "nav", ctx: { kind: "pantry", zip, i } } };
  }

  function deliveryTurn(i, delivery) {
    const d = delivery[i], last = i + 1 >= delivery.length, say = [];
    if (i === 0) say.push("Home delivery is mostly for seniors, or people who cannot leave home. Please call to confirm who qualifies.");
    say.push(`${d.spoken_name || d.name}.`, spokenText(d.who));
    const hours = d.spoken_hours || d.hours;
    if (hours) say.push(`${hours}.`);
    if (d.phone) say.push(`Phone number: ${speakPhone(d.phone)}.`);
    if (last) say.push("That is the last option I have.");
    return { say, ask: { prompt: options(!!forwardNumber(d), false, !last, "next one"), digits: 1, step: "nav", ctx: { kind: "delivery", i } } };
  }

  function connect(kind, item, nowMs) {
    if (!forwardNumber(item)) return { end: true, connected: false, say: ["Sorry, I could not connect that call. Please dial the number I read out. Goodbye."] };
    const name = item.spoken_name || item.name;
    const say = kind === "delivery" ? `Connecting you to ${name}.`
      : status(item, nowMs).state === "open" ? `Connecting you to ${name}. They are volunteers, so please be patient.`
      : `Connecting you to ${name}. They are closed right now, so you may reach a voicemail. Please leave your name and phone number.`;
    return { end: true, connected: true, say: [say] };
  }

  // One step of the phone line. Returns {say:[...], ask:{prompt,digits,step,ctx}|undefined, end?:true, connected?:bool}.
  function ivr(step, digits, ctx, nowMs, pantries, delivery) {
    const menu = { say: ["Welcome to Milledgeville food assistance."],
      ask: { prompt: "Press 1 to find a food pantry near you. Press 2 for home delivery.", digits: 1, step: "menu", ctx: {} } };
    const askZip = (say) => ({ say, ask: { prompt: "Enter your 5 digit ZIP code.", digits: 5, step: "zip", ctx: {} } });
    if (!step) return menu;
    if (step === "menu") {
      if (digits === "1") return askZip([]);
      if (digits === "2") return deliveryTurn(0, delivery);
      return menu;
    }
    if (step === "zip") {
      if (!/^\d{5}$/.test(digits) || !PLACES[digits]) return askZip(["Sorry, I only know Milledgeville ZIP codes, such as 3 1 0 6 1."]);
      return pantryTurn(digits, 0, nowMs, pantries);
    }
    if (step === "nav") {
      const kind = ctx.kind === "delivery" ? "delivery" : "pantry";
      const items = kind === "delivery" ? delivery : PLACES[ctx.zip] ? byDistance(PLACES[ctx.zip], nowMs, pantries).map((r) => r.p) : [];
      if (!items.length) return menu;
      let i = Math.min(Math.max(ctx.i || 0, 0), items.length - 1);
      if (digits === "1") return connect(kind, items[i], nowMs);
      if (digits === "9") return menu;
      if (digits === "3" && i + 1 < items.length) i += 1;   // next; on the last item (or after 2 or any other key) stay put
      return kind === "delivery" ? deliveryTurn(i, delivery) : pantryTurn(ctx.zip, i, nowMs, pantries);
    }
    return menu;
  }

  root.Finder = { PLACES, etNow, windowsOn, status, miles, locate, rank, fmt, fmtTime, dayStart, DAY, HOUR,
    smsAnswer, deliveryAnswer, ivr, speakPhone, forwardNumber, directionsUrl,
    spokenAddress, spokenDistance, spokenClock, spokenWhen, spokenText, byDistance };
  if (typeof module !== "undefined") module.exports = root.Finder;
})(typeof window !== "undefined" ? window : globalThis);
