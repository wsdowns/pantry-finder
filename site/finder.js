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
    const day = new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    return `${day} ${fmtTime(ms)}`;
  }

  root.Finder = { PLACES, etNow, windowsOn, status, miles, locate, rank, fmt, fmtTime, dayStart, DAY, HOUR };
  if (typeof module !== "undefined") module.exports = root.Finder;
})(typeof window !== "undefined" ? window : globalThis);
