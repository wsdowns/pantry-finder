(() => {
  const F = window.Finder, P = window.PANTRIES, D = window.DELIVERY || [], H = window.HOTLINE || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dowOf = (ms) => (new Date(ms).getUTCDay() + 6) % 7;
  const stamp = (ms) => F.fmt(ms, ms).replace(/^today /, `${DOW[dowOf(ms)]} `); // "Tue 9:30am" style for the label
  const longStamp = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) + " " + F.fmtTime(ms);
  };

  let where = F.PLACES.downtown, label = "downtown Milledgeville";
  let demo = null;                     // null = live; otherwise a naive-ET ms the time machine chose
  const nowMs = () => (demo ?? F.etNow());

  // ---------- Phone section: shows the number once configured ----------
  (function hotline() {
    if (!H.display || !H.tel) return;
    const box = $("help"), num = $("hl-num"), btns = $("hl-btns");
    box.classList.remove("soon");
    $("hl-kicker").textContent = H.voiceEnabled ? "Text or call for help" : "Text for help";
    num.textContent = H.display; num.href = "tel:" + H.tel;
    $("hl-text").textContent = H.voiceEnabled
      ? "Text your ZIP code and we text back the nearest open pantry. Prefer to talk? Call and press your ZIP on the keypad."
      : "Text your ZIP code and we text back the nearest open pantry. No app or internet needed.";
    btns.innerHTML = `<a class="btn" href="sms:${esc(H.tel)}?body=31061">💬 Text us</a>` +
      (H.voiceEnabled ? `<a class="btn ghost" href="tel:${esc(H.tel)}">📞 Call</a>` : "");
    const bc = $("barcall");
    bc.classList.remove("soon"); bc.href = H.voiceEnabled ? "tel:" + H.tel : "sms:" + H.tel + "?body=31061";
    bc.textContent = (H.voiceEnabled ? "📞 " : "💬 ") + H.display;
  })();

  // ---------- Pantry cards ----------
  function weekHtml(p, now) {
    const base = F.dayStart(now);
    let out = "";
    for (let i = 0; i < 7; i++) {
      const dayMs = base + i * F.DAY, w = F.windowsOn(p, dayMs);
      const name = i === 0 ? "Today" : DOW[dowOf(dayMs)];
      const t = w.length ? F.fmtTime(w[0][0]).replace(":00", "").replace(/[ap]m/, "") + "–" + F.fmtTime(w[0][1]).replace(":00", "") : "·";
      out += `<div class="day${w.length ? " on" : ""}${i === 0 ? " today" : ""}"><b>${name}</b>${t}</div>`;
    }
    return `<div class="week" role="img" aria-label="Next 7 days of hours">${out}</div>`;
  }

  function renderCards(rows, now, animate) {
    $("list").innerHTML = rows.map((r, i) => {
      const p = r.p, open = r.state === "open", idx = P.indexOf(p);
      const status = open ? `Open now · until ${F.fmt(r.when, now)}`
        : r.when ? `Closed · opens ${F.fmt(r.when, now)}` : "Check hours";
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
      return `<article class="card${open ? " is-open" : ""}" id="card-${idx}" style="${animate ? `animation-delay:${i * 70}ms` : "animation:none"}">
        <div class="top"><h2>${esc(p.name)}</h2>
          <span class="status${open ? " open" : ""}"><span class="dot"></span>${esc(status)}</span></div>
        <p class="meta">${esc(p.address)} · ${r.dist.toFixed(1)} mi away</p>
        ${p.note ? `<span class="note">${esc(p.note)}</span>` : ""}
        ${weekHtml(p, now)}
        <div class="actions"><a class="dir" href="${dir}" target="_blank" rel="noopener">🧭 Directions</a>
          <a class="tel" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">📞 ${esc(p.phone)}</a></div>
      </article>`;
    }).join("");
  }

  // ---------- Map (no tiles, so it works offline and on stage) ----------
  function renderMap(rows) {
    const W = 640, Ht = 380, pad = 64, NS = "http://www.w3.org/2000/svg";
    const pts = [where, ...P.map((p) => [p.lat, p.lng])];
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length, kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * kx), ys = pts.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-6), (Ht - 2 * pad) / Math.max(maxY - minY, 1e-6));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (Ht - (maxY - minY) * sc) / 2;
    const X = (p) => ox + (p[1] * kx - minX) * sc, Y = (p) => oy + (-p[0] - minY) * sc;
    const stateOf = new Map(rows.map((r) => [r.p, r]));
    let g = "";
    for (let x = 0; x <= W; x += 64) g += `<line class="grid" x1="${x}" y1="0" x2="${x}" y2="${Ht}"/>`;
    for (let y = 0; y <= Ht; y += 64) g += `<line class="grid" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
    const ux = X(where), uy = Y(where);
    for (const mi of [1, 2, 3]) {
      const r = (mi / 69) * sc;
      g += `<circle class="ring" cx="${ux}" cy="${uy}" r="${r}"/><text class="ringlbl" x="${ux + r * 0.71 + 3}" y="${uy - r * 0.71 - 3}">${mi} mi</text>`;
    }
    const best = rows[0];
    if (best) g += `<line class="path" x1="${ux}" y1="${uy}" x2="${X([best.p.lat, best.p.lng])}" y2="${Y([best.p.lat, best.p.lng])}"/>`;
    for (const r of rows) {
      const p = r.p, cx = X([p.lat, p.lng]), cy = Y([p.lat, p.lng]), open = r.state === "open";
      // A pin near "You" puts its label on the side away from you, so the two labels never collide.
      const up = Math.hypot(cx - ux, cy - uy) < 70 ? cy < uy : cy > Ht / 2;
      const nm = p.name.replace(" - Maddox Investing in America", "").replace(" Church Pantry", " Pantry");
      g += `<g class="pin ${open ? "open" : "closed"}" data-i="${P.indexOf(p)}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${open ? "open now" : "closed"}">` +
        (open ? `<circle class="halo" cx="${cx}" cy="${cy}" r="11"/>` : "") +
        `<circle class="dot" cx="${cx}" cy="${cy}" r="11"/>` +
        `<text class="lbl" x="${cx}" y="${cy + (up ? -19 : 29)}" text-anchor="middle">${esc(nm)}</text></g>`;
    }
    g += `<circle class="you" cx="${ux}" cy="${uy}" r="8"/><text class="youlbl" x="${ux}" y="${uy - 15}" text-anchor="middle">You</text>`;
    $("map").innerHTML = g;
    $("map").querySelectorAll(".pin").forEach((pin) => {
      const go = () => {
        const c = $("card-" + pin.dataset.i);
        if (!c) return;
        c.scrollIntoView({ behavior: "smooth", block: "center" });
        c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
      };
      pin.addEventListener("click", go);
      pin.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ---------- Time machine ----------
  let selDay = 0, selMin = 600;
  const baseDay = () => F.dayStart(F.etNow());
  function buildDays() {
    $("tmdays").innerHTML = [...Array(7)].map((_, i) => {
      const ms = baseDay() + i * F.DAY;
      return `<button type="button" data-d="${i}">${i === 0 ? "Today" : DOW[dowOf(ms)]}</button>`;
    }).join("");
    $("tmdays").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { selDay = +b.dataset.d; applyDemo(); }));
  }
  function syncTm() {
    const n = nowMs();
    $("tmlabel").textContent = (demo ? "Demo: " : "Live: ") + longStamp(n);
    $("tmlabel").classList.toggle("demo", demo !== null);
    $("tmlive").hidden = demo === null;
    $("tmdays").querySelectorAll("button").forEach((b) => b.classList.toggle("on", demo !== null && +b.dataset.d === selDay));
    $("tmtime").value = Math.min(1200, Math.max(360, demo !== null ? selMin : Math.floor((n - F.dayStart(n)) / 60000)));
    $("trynote").textContent = demo ? `(Using demo time: ${longStamp(n)})` : "";
  }
  function applyDemo() { demo = baseDay() + selDay * F.DAY + selMin * 60000; update(false); }
  function setDemoAt(ms) {
    const off = Math.round((F.dayStart(ms) - baseDay()) / F.DAY);
    selDay = off >= 0 && off < 7 ? off : -1;
    selMin = Math.floor((ms - F.dayStart(ms)) / 60000);
    demo = ms; update(false);
  }
  const nextWhere = (pred, hh, mm) => {
    for (let d = 0; d < 70; d++) {
      const day = baseDay() + d * F.DAY, dt = new Date(day);
      if (pred(dowOf(day), Math.floor((dt.getUTCDate() - 1) / 7) + 1)) return day + hh * F.HOUR + mm * 60000;
    }
    return null;
  };
  const PRESETS = [
    ["Tue 10am: two open", () => nextWhere((w) => w === 1, 10, 0)],
    ["Thu 12:30pm: New Beginnings", () => nextWhere((w) => w === 3, 12, 30)],
    ["3rd Thu 8:30am: MIA", () => nextWhere((w, n) => w === 3 && n === 3, 8, 30)],
    ["Sat 3pm: all closed", () => nextWhere((w) => w === 5, 15, 0)],
  ];
  $("tmpresets").innerHTML = PRESETS.map(([t], i) => `<button class="chip" type="button" data-p="${i}">${t}</button>`).join("");
  $("tmpresets").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const ms = PRESETS[+b.dataset.p][1](); if (ms) setDemoAt(ms); }));
  $("tmtime").addEventListener("input", (e) => { selMin = +e.target.value; if (selDay < 0) selDay = 0; applyDemo(); });
  $("tmlive").addEventListener("click", () => { demo = null; update(false); });

  // ---------- Search ----------
  function update(animate = false) {
    const now = nowMs(), rows = F.rank(where, now, P);
    $("msg").textContent = `Showing pantries near ${label}.`;
    renderCards(rows, now, animate);
    renderMap(rows);
    syncTm();
  }
  function search(text) {
    const pt = F.locate(text);
    if (!pt) { $("msg").textContent = "Try a Milledgeville ZIP (31061, 31062, 31059) or a place like GCSU or downtown."; return; }
    where = pt; label = String(text).trim(); update(true);
  }
  $("form").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
  document.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { $("q").value = b.dataset.q; search(b.dataset.q); }));
  $("loc").addEventListener("click", () => {
    if (!navigator.geolocation) { $("msg").textContent = "Location isn't available here. Try a ZIP code."; return; }
    $("msg").textContent = "Finding you...";
    navigator.geolocation.getCurrentPosition(
      (pos) => { where = [pos.coords.latitude, pos.coords.longitude]; label = "your location"; update(true); },
      () => { $("msg").textContent = "Couldn't get your location. Try a ZIP code."; },
      { timeout: 8000 });
  });

  // ---------- Delivery section ----------
  $("dlist").innerHTML = D.map((d) => {
    const act = d.phone
      ? `<a class="call" href="tel:${esc(d.phone.replace(/[^\d+]/g, "").replace(/(\d{10})(\d+)/, "$1,$2"))}">📞 ${esc(d.phone)}</a>`
      : `<a class="call" href="${esc(d.website)}" target="_blank" rel="noopener">Visit website</a>`;
    return `<div class="dcard"><h3>${esc(d.name)}</h3><p>${esc(d.who)}</p>${d.hours ? `<small>${esc(d.hours)}</small>` : ""}${act}</div>`;
  }).join("");

  // ---------- Text line simulator ----------
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">Open directions</a>');
  const addMsg = (cls, html) => { const m = document.createElement("div"); m.className = "bub " + cls; m.innerHTML = html; $("msgs").appendChild(m); $("msgs").scrollTop = 1e9; return m; };
  function sendText(text) {
    text = text.trim(); if (!text) return;
    addMsg("me", esc(text));
    const typing = addMsg("bot typing", "• • •");
    setTimeout(() => {
      let reply = F.smsAnswer(text, nowMs(), P, D);
      if (reply.startsWith("Sorry, I couldn't find")) reply += "\n\n(This demo knows ZIPs and landmarks. The live line also takes street addresses.)";
      typing.remove(); addMsg("bot", linkify(reply));
    }, 650);
  }
  $("smschips").innerHTML = ["31061", "GCSU", "delivery", "I'm homebound"].map((t) => `<button class="chip" type="button">${esc(t)}</button>`).join("");
  $("smschips").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => sendText(b.textContent)));
  $("smsform").addEventListener("submit", (e) => { e.preventDefault(); sendText($("smsin").value); $("smsin").value = ""; });
  addMsg("bot", "Hi! Text a ZIP code, a place like GCSU, or the word delivery, and I'll find food.");

  // ---------- Phone line simulator ----------
  const call = { active: false, step: "", ctx: {}, expect: 0, buf: "" };
  const line = (cls, t) => { const d = document.createElement("div"); d.className = "cline " + cls; d.textContent = t; $("callscreen").appendChild(d); $("callscreen").scrollTop = 1e9; };
  const voiceOn = () => $("speak").checked && "speechSynthesis" in window;
  function speak(texts) {
    if (!voiceOn()) return;
    window.speechSynthesis.cancel();
    texts.forEach((t) => { const u = new SpeechSynthesisUtterance(t); u.rate = 0.95; window.speechSynthesis.speak(u); });
  }
  const pantriesForCall = () => (!$("fwd").checked ? P : P.map((p) => ({ ...p, forward: "+1-demo" })));
  function run(out) {
    const said = [...out.say]; if (out.ask) said.push(out.ask.prompt);
    out.say.forEach((t) => line("", "📞 " + t));
    if (out.ask) { line("", "📞 " + out.ask.prompt); call.step = out.ask.step; call.ctx = out.ask.ctx || {}; call.expect = out.ask.digits; call.buf = ""; keybuf(); }
    speak(said);
    if (out.end) { line("sys", out.connected ? "(Demo: the call would now ring the pantry.)" : "Call ended."); hangup(false); }
  }
  function keybuf() { $("keybuf").textContent = call.buf ? call.buf : (call.active && call.expect ? "_ ".repeat(call.expect).trim() : " "); }
  function startCall() {
    $("callscreen").innerHTML = ""; call.active = true; $("callgo").disabled = true; $("callstop").disabled = false;
    run(F.ivr("", "", {}, nowMs(), pantriesForCall(), D));
  }
  function hangup(manual = true) {
    if (manual && call.active) line("sys", "You hung up.");
    call.active = false; call.expect = 0; call.buf = ""; keybuf();
    $("callgo").disabled = false; $("callstop").disabled = true;
    if ("speechSynthesis" in window && manual) window.speechSynthesis.cancel();
  }
  function press(d) {
    if (!call.active || !call.expect) return;
    call.buf += d; keybuf();
    if (call.buf.length >= call.expect) {
      const digits = call.buf; line("you", "You pressed " + digits);
      const step = call.step, ctx = call.ctx; call.expect = 0;
      run(F.ivr(step, digits, ctx, nowMs(), pantriesForCall(), D));
    }
  }
  $("pad").innerHTML = "123456789*0#".split("").map((k) => `<button type="button" data-k="${k}">${k}</button>`).join("");
  $("pad").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => press(b.dataset.k)));
  $("callgo").addEventListener("click", startCall);
  $("callstop").addEventListener("click", () => hangup(true));

  // ---------- Go ----------
  buildDays();
  const n0 = F.etNow(); selMin = Math.floor((n0 - F.dayStart(n0)) / 60000);
  update(true);
  setInterval(() => { if (demo === null) update(false); }, 60000);
})();
