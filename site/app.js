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
  // Where Directions start. null = unknown, so Google uses the device's own location (we only assume downtown for the map).
  let origin = null;
  const PLACE_ORIGIN = { gcsu: "Georgia College & State University", "georgia college": "Georgia College & State University",
    gmc: "Georgia Military College", "georgia military college": "Georgia Military College", downtown: "Downtown Milledgeville",
    "central state": "Central State Hospital" };
  function originForPlace(text) {
    const q = String(text).trim().toLowerCase(), key = Object.keys(F.PLACES).find((k) => q.includes(k));
    if (!key) return null;
    return /^\d{5}$/.test(key) ? `${key}, Milledgeville, GA` : (PLACE_ORIGIN[key] ? `${PLACE_ORIGIN[key]}, Milledgeville, GA` : null);
  }
  let demo = null;                     // null = live; otherwise a naive-ET ms the time machine chose
  const nowMs = () => (demo ?? F.etNow());

  // ---------- Phone section: shows the number once configured ----------
  (function hotline() {
    const voice = !!H.voiceEnabled, text = !!H.textEnabled;
    if (!H.display || !H.tel || (!voice && !text)) return;
    const box = $("help"), num = $("hl-num"), btns = $("hl-btns");
    box.classList.remove("soon");
    $("hl-kicker").textContent = voice && text ? "Text or call for help" : voice ? "Call for help" : "Text for help";
    num.textContent = H.display; num.href = "tel:" + H.tel;
    $("hl-text").textContent = voice && text
      ? "Text your ZIP code and we text back the nearest open pantry. Prefer to talk? Call and press your ZIP on the keypad."
      : voice
        ? "Call and press your ZIP code on the keypad. You'll hear the nearest open pantry, and we can connect you to it. No app or internet needed."
        : "Text your ZIP code and we text back the nearest open pantry. No app or internet needed.";
    const callBtn = `<a class="btn" href="tel:${esc(H.tel)}"><span aria-hidden="true">📞</span> Call</a>`;
    const textBtn = `<a class="btn${voice ? " ghost" : ""}" href="sms:${esc(H.tel)}?body=31061"><span aria-hidden="true">💬</span> Text us</a>`;
    btns.innerHTML = (voice ? callBtn : "") + (text ? textBtn : "");
    const bc = $("barcall");
    bc.classList.remove("soon"); bc.href = voice ? "tel:" + H.tel : "sms:" + H.tel + "?body=31061";
    bc.innerHTML = `<span aria-hidden="true">${voice ? "📞" : "💬"}</span> ${esc(H.display)}`;
    bc.setAttribute("aria-label", (voice ? "Call " : "Text ") + H.display);
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
      const dir = F.directionsUrl(p, origin);
      return `<article class="card${open ? " is-open" : ""}" id="card-${idx}" style="${animate ? `animation-delay:${i * 70}ms` : "animation:none"}">
        <div class="top"><h2>${esc(p.name)}</h2>
          <span class="status${open ? " open" : ""}"><span class="dot"></span>${esc(status)}</span></div>
        <p class="meta">${esc(p.address)} · ${r.dist.toFixed(1)} mi away</p>
        ${p.note ? `<span class="note">${esc(p.note)}</span>` : ""}
        ${weekHtml(p, now)}
        <div class="actions"><a class="dir" href="${dir}"${origin ? "" : ' data-nostart="1"'} target="_blank" rel="noopener" aria-label="Directions to ${esc(p.name)} (opens in a new tab)"><span aria-hidden="true">🧭</span> Directions</a>
          <a class="tel" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}" aria-label="Call ${esc(p.name)} at ${esc(p.phone)}"><span aria-hidden="true">📞</span> ${esc(p.phone)}</a></div>
      </article>`;
    }).join("");
  }

  // ---------- Map (Leaflet + OpenStreetMap; pins, rings and the route line are drawn by us) ----------
  let map = null, mapLayer = null;
  const hasLeaflet = typeof L !== "undefined";
  // Short names keep pin labels from running off small maps; full names stay on the cards and in aria-labels.
  const shortName = (n) => n.replace(" - Maddox Investing in America", "").replace(" Church Pantry", "").replace(" Food Pantry", "")
    .replace(" Outreach Ministries", "");
  function goToCard(idx) {
    const c = $("card-" + idx);
    if (!c) return;
    c.scrollIntoView({ behavior: "smooth", block: "center" });
    c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
    c.setAttribute("tabindex", "-1"); c.focus({ preventScroll: true }); // keyboard and screen-reader users land on the card
  }
  function ensureMap() {
    if (map || !hasLeaflet) return;
    // One-finger drag is off on touch screens so the page still scrolls past the map; pinch and the +/- buttons zoom.
    map = L.map("map", { scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false, zoomSnap: 0.5 }).setView(where, 13);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
    tiles.on("tileerror", () => { $("mapnote").hidden = false; });
    tiles.on("tileload", () => { $("mapnote").hidden = true; });
    mapLayer = L.layerGroup().addTo(map);
    map.on("moveend zoomend", placeLabels);
  }
  function renderMap(rows) {
    if (!hasLeaflet) { $("map").textContent = "The map couldn't load. Every pantry is listed below."; return; }
    ensureMap(); mapLayer.clearLayers();
    for (const mi of [1, 2, 3]) {
      L.circle(where, { radius: mi * 1609.34, className: "ring", weight: 1.5, dashArray: "5 6", opacity: 0.6, fill: false, interactive: false }).addTo(mapLayer);
    }
    // Straight line to the nearest pantry that is open now (the list is open-first, nearest-first). Nothing open, no line.
    if (rows[0] && rows[0].state === "open") L.polyline([where, [rows[0].p.lat, rows[0].p.lng]], { className: "route", weight: 3, dashArray: "2 8", opacity: 0.9, interactive: false }).addTo(mapLayer);
    for (const r of rows) {
      const p = r.p, open = r.state === "open", idx = P.indexOf(p), name = `${p.name}, ${open ? "open now" : "closed"}. Show details.`;
      const icon = L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11],
        html: `<div class="pinwrap ${open ? "open" : "closed"}"><span class="pdot"></span><span class="plabel"><b>${esc(shortName(p.name))}</b><i>${open ? "Open now" : "Closed"}</i></span></div>` });
      const m = L.marker([p.lat, p.lng], { icon, title: name, keyboard: true, zIndexOffset: open ? 500 : 0 }).on("click", () => goToCard(idx)).addTo(mapLayer);
      const el = m.getElement();
      el.setAttribute("aria-label", name);
      // Leaflet doesn't turn Enter into a click for custom pins, so keyboard users get it from us.
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToCard(idx); } });
    }
    L.marker(where, { icon: L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div class="ymark"><span class="ydot"></span><span class="ylabel">You</span></div>' }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(mapLayer);
    map.invalidateSize();
    map.fitBounds(L.latLngBounds([where, ...P.map((p) => [p.lat, p.lng])]).pad(0.3), { animate: false, maxZoom: 15 });
    placeLabels();
  }
  // Pins in the right part of the map get their label on the left, so labels never run off the edge.
  function placeLabels() {
    if (!map) return;
    const w = map.getSize().x;
    const left = $("map").getBoundingClientRect().left;
    document.querySelectorAll("#map .pinwrap").forEach((pw) => {
      const label = pw.querySelector(".plabel");
      label.style.whiteSpace = ""; label.style.maxWidth = "";            // measure at natural width
      const px = pw.closest(".leaflet-marker-icon").getBoundingClientRect().left - left, lw = label.offsetWidth;
      const fitsRight = px + 28 + lw <= w - 6, fitsLeft = px - 6 - lw >= 6;
      pw.classList.toggle("left", !fitsRight && fitsLeft);
      if (!fitsRight && !fitsLeft) { label.style.whiteSpace = "normal"; label.style.maxWidth = Math.max(110, w - px - 34) + "px"; } // wrap, don't clip
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
    $("tmdays").querySelectorAll("button").forEach((b) => {
      const on = demo !== null && +b.dataset.d === selDay;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    });
    const mins = Math.min(1200, Math.max(360, demo !== null ? selMin : Math.floor((n - F.dayStart(n)) / 60000)));
    $("tmtime").value = mins;
    $("tmtime").setAttribute("aria-valuetext", F.fmtTime(F.dayStart(n) + mins * 60000));
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
  // Directions with no known start point would let Google guess (on a computer, often from the internet connection, so a
  // wrong city). Instead, ask for a start first, with a one-tap way to let Google use the phone's own location.
  let waitingForStart = false;
  function askForStart(href) {
    waitingForStart = true;
    $("startskip").href = href;
    $("startprompt").hidden = false;
    $("form").scrollIntoView({ behavior: "smooth", block: "start" }); // search box at the top, prompt just below it
    $("q").focus({ preventScroll: true });
  }
  $("list").addEventListener("click", (e) => {
    const a = e.target.closest("a.dir[data-nostart]");
    if (!a) return;
    e.preventDefault();
    askForStart(a.href);
  });
  $("startloc").addEventListener("click", () => $("loc").click());

  function update(animate = false) {
    const now = nowMs(), rows = F.rank(where, now, P);
    $("msg").textContent = `Showing pantries near ${label}.`;
    if (origin) {
      $("startprompt").hidden = true;
      if (waitingForStart) { $("msg").textContent += " Tap Directions again to start from here."; waitingForStart = false; }
    }
    renderCards(rows, now, animate);
    renderMap(rows);
    syncTm();
  }
  // Street-address lookup uses the U.S. Census Bureau geocoder. It sends no CORS headers, so we use its script-tag (JSONP)
  // form; only the two coordinate numbers from the reply are ever used.
  const looksLikeAddress = (t) => /^\d+\s+\S+/.test(String(t).trim()) && String(t).trim().length >= 6;
  function geocode(text) {
    return new Promise((resolve) => {
      const q = /\bga\b|georgia/i.test(text) ? text : text + ", Milledgeville, GA";
      const cb = "_gc" + Date.now() + Math.floor(Math.random() * 1e4), s = document.createElement("script");
      let t;
      const done = (v) => { clearTimeout(t); delete window[cb]; s.remove(); resolve(v); };
      t = setTimeout(() => done(null), 8000);
      window[cb] = (data) => {
        try {
          const m = data.result.addressMatches[0], lat = Number(m.coordinates.y), lng = Number(m.coordinates.x);
          // The Census can match a different address than typed (S Wayne St -> N Wayne St), so we return it to show back.
          done(Number.isFinite(lat) && Number.isFinite(lng) ? { pt: [lat, lng], matched: niceAddress(String(m.matchedAddress)) } : null);
        } catch (e) { done(null); }
      };
      s.onerror = () => done(null);
      s.src = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=" + encodeURIComponent(q) +
        "&benchmark=Public_AR_Current&format=jsonp&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  const inArea = (pt) => F.miles(F.PLACES.downtown, pt) <= 40;
  const niceAddress = (a) => a.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(", Ga,", ", GA,");

  async function search(text) {
    const pt = F.locate(text);
    if (pt) { where = pt; label = String(text).trim(); origin = originForPlace(text); update(true); return; }
    if (looksLikeAddress(text)) {
      $("msg").textContent = "Looking up that address...";
      const g = await geocode(text);
      if (!g) { $("msg").textContent = "We couldn't find that address. Check the spelling, add the ZIP, or search by ZIP code."; return; }
      if (!inArea(g.pt)) { $("msg").textContent = "That address looks to be outside the Milledgeville area. Try a ZIP code instead."; return; }
      where = g.pt; label = g.matched; origin = g.matched; update(true); return;
    }
    $("msg").textContent = "Try a ZIP (31061, 31062, 31059), a street address, or a place like GCSU or downtown.";
  }
  $("form").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
  document.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { $("q").value = b.dataset.q; search(b.dataset.q); }));
  $("loc").addEventListener("click", () => {
    if (!navigator.geolocation) { $("msg").textContent = "Location isn't available here. Try a ZIP code."; return; }
    $("msg").textContent = "Finding you...";
    navigator.geolocation.getCurrentPosition(
      (pos) => { where = [pos.coords.latitude, pos.coords.longitude]; label = "your location"; origin = `${where[0]},${where[1]}`; update(true); },
      () => { $("msg").textContent = "Couldn't get your location. Try a ZIP code."; },
      { timeout: 8000 });
  });

  // ---------- Delivery section ----------
  $("dlist").innerHTML = D.map((d) => {
    const act = d.phone
      ? `<a class="call" href="tel:${esc(d.phone.replace(/[^\d+]/g, "").replace(/(\d{10})(\d+)/, "$1,$2"))}" aria-label="Call ${esc(d.name)} at ${esc(d.phone)}"><span aria-hidden="true">📞</span> ${esc(d.phone)}</a>`
      : `<a class="call" href="${esc(d.website)}" target="_blank" rel="noopener" aria-label="Visit the ${esc(d.name)} website (opens in a new tab)">Visit website</a>`;
    return `<div class="dcard"><h3>${esc(d.name)}</h3><p>${esc(d.who)}</p>${d.hours ? `<small>${esc(d.hours)}</small>` : ""}${act}</div>`;
  }).join("");

  // ---------- Text line simulator ----------
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">Open directions</a>');
  const addMsg = (cls, html) => { const m = document.createElement("div"); m.className = "bub " + cls; m.innerHTML = html; $("msgs").appendChild(m); $("msgs").scrollTop = 1e9; return m; };
  function sendText(text) {
    text = text.trim(); if (!text) return;
    addMsg("me", esc(text));
    const typing = addMsg("bot typing", "• • •");
    setTimeout(async () => {
      let reply = F.smsAnswer(text, nowMs(), P, D);
      if (reply.startsWith("Sorry, I couldn't find") && looksLikeAddress(text)) {
        const g = await geocode(text);
        reply = g && inArea(g.pt) ? `Matched address: ${g.matched}\n\n` + F.smsAnswer(text, nowMs(), P, D, g.pt, g.matched)
          : "Sorry, I couldn't find that address. Try adding the ZIP code, or text a ZIP like 31061.";
      }
      typing.remove(); addMsg("bot", linkify(reply));
    }, 650);
  }
  $("smschips").innerHTML = ["31061", "GCSU", "delivery"].map((t) => `<button class="chip" type="button">${esc(t)}</button>`).join("");
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
  const pantriesForCall = () => P;
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
  $("pad").innerHTML = "123456789*0#".split("").map((k) => `<button type="button" data-k="${k}" aria-label="Key ${k === "*" ? "star" : k === "#" ? "pound" : k}">${k}</button>`).join("");
  $("pad").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => press(b.dataset.k)));
  $("callgo").addEventListener("click", startCall);
  $("callstop").addEventListener("click", () => hangup(true));

  // ---------- Go ----------
  buildDays();
  const n0 = F.etNow(); selMin = Math.floor((n0 - F.dayStart(n0)) / 60000);
  update(true);
  setInterval(() => { if (demo === null) update(false); }, 60000);
})();
