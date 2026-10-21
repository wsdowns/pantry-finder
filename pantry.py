#!/usr/bin/env python3
"""Nearest open food pantry for Milledgeville, GA.

CLI:      python3 pantry.py "31061"        (ZIP, landmark, or street address)
Server:   python3 pantry.py --serve        (POST /sms and POST /voice, Twilio-style TwiML replies)
"""
import base64, hashlib, hmac, json, math, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
_DATA = json.loads((Path(__file__).parent / "pantries.json").read_text())
PANTRIES = _DATA["pantries"]
DELIVERY = _DATA["delivery"]
DELIVERY_WORDS = ("deliver", "homebound", "can't get out", "cant get out", "bring food", "meals on wheels")

# Approximate centers; good enough for ranking pantries, not for turn-by-turn.
PLACES = {
    "31061": (33.0900, -83.2300), "31062": (33.0500, -83.2200), "31059": (33.0801, -83.2321),
    "gcsu": (33.0801, -83.2330), "georgia college": (33.0801, -83.2330),
    "gmc": (33.0790, -83.2310), "georgia military college": (33.0790, -83.2310),
    "downtown": (33.0801, -83.2321), "central state": (33.0514, -83.2198),
}


def locate_known(text):
    """A stored ZIP/landmark center, or None."""
    q = text.strip().lower()
    for key, pt in PLACES.items():
        if key in q:
            return pt
    return None


def geocode(text):
    """((lat, lng), matched address) from the free US Census geocoder, or None. Network errors give None.
    The Census match can differ from what was typed (e.g. S Wayne St -> N Wayne St), so callers show it back."""
    try:
        addr = text if re.search(r"\bga\b|georgia", text, re.I) else f"{text}, Milledgeville, GA"
        url = ("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"
               + urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current", "format": "json"}))
        with urllib.request.urlopen(url, timeout=6) as r:
            m = json.load(r)["result"]["addressMatches"]
        if m:
            return (m[0]["coordinates"]["y"], m[0]["coordinates"]["x"]), m[0]["matchedAddress"]
    except Exception:
        pass
    return None


def locate(text):
    """Point only, for callers that don't need the matched address."""
    return locate_known(text) or (geocode(text) or (None,))[0]


def _nice_address(matched):
    return matched.title().replace(", Ga,", ", GA,")


def directions_url(p, origin=None):
    """Google Maps directions to a pantry. The destination is the text Google resolves to the real place when we
    have one (right name on the route), else exact coordinates. Without an origin Google starts from the device."""
    dest = urllib.parse.quote(p["maps_query"], safe="") if p.get("maps_query") else f"{p['lat']},{p['lng']}"
    url = f"https://www.google.com/maps/dir/?api=1&destination={dest}"
    return url + "&origin=" + urllib.parse.quote(origin, safe="") if origin else url


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def occurrences(sched, day):
    """Yield (start, end) datetimes for one schedule rule on a given date."""
    if day.weekday() != sched["weekday"]:
        return
    if "nth" in sched and (day.day - 1) // 7 + 1 != sched["nth"]:
        return
    h1, m1 = map(int, sched["start"].split(":"))
    h2, m2 = map(int, sched["end"].split(":"))
    yield day.replace(hour=h1, minute=m1, second=0, microsecond=0), day.replace(hour=h2, minute=m2, second=0, microsecond=0)


def status(p, now):
    """('open', closes_at) or ('closed', next_open_at) looking 60 days ahead."""
    nxt = None
    for d in range(61):
        day = now + timedelta(days=d)
        if day.date().isoformat() in p.get("closures", []):
            continue
        for s in p["schedule"]:
            for start, end in occurrences(s, day):
                if start <= now < end:
                    return "open", end
                if start > now and (nxt is None or start < nxt):
                    nxt = start
        if nxt:
            break
    return "closed", nxt


def fmt(dt, now):
    t = dt.strftime("%-I:%M%p").lower()
    if dt.date() == now.date():
        return f"today {t}"
    if dt.date() == (now + timedelta(days=1)).date():
        return f"tomorrow {t}"
    return f"{dt.strftime('%a %b %-d')} {t}"


def ranked(where, now):
    """[(pantry, state, when, miles)]: open now first (nearest), then soonest to open."""
    rows = []
    for p in PANTRIES:
        st, when = status(p, now)
        rows.append((st != "open", when or datetime.max.replace(tzinfo=TZ), miles(where, (p["lat"], p["lng"])), p, st, when))
    open_now = sorted([r for r in rows if not r[0]], key=lambda r: r[2])
    later = sorted([r for r in rows if r[0]], key=lambda r: (r[1], r[2]))
    return [(p, st, when, d) for _, _, d, p, st, when in open_now + later]


def delivery_answer():
    blocks = []
    for d in DELIVERY:
        contact = d.get("phone") or d.get("website", "")
        hours = f"\n{d['hours']}" if d.get("hours") else ""
        blocks.append(f"{d['name']}\n{contact}\n{d['who']}{hours}")
    return ("Food delivery in Baldwin County (mostly for seniors 60+ or homebound):\n\n"
            + "\n\n".join(blocks)
            + "\n\nCall to confirm who qualifies. Text a ZIP to find pantries instead.")


def answer(text, now=None):
    now = now or datetime.now(TZ)
    if any(w in text.lower() for w in DELIVERY_WORDS):
        return delivery_answer()
    where, matched = locate_known(text), None
    if not where:
        found = geocode(text)
        if found:
            where, matched = found
            if miles(PLACES["downtown"], where) > 40:
                return "Sorry, that address looks outside the Milledgeville area. Text a ZIP like 31061 instead."
    if not where:
        return "Sorry, I couldn't find that place. Text a ZIP (31061), a landmark (GCSU), or a street address."
    lines = []
    for i, (p, st, when, d) in enumerate(ranked(where, now)[:3]):
        head = f"OPEN NOW until {fmt(when, now)}" if st == "open" else f"Closed, opens {fmt(when, now)}"
        note = f" ({p['note']})" if p.get("note") else ""
        line = f"{p['name']} - {head}\n{p['address']} - {d:.1f} mi\n{p['phone']}{note}"
        if i == 0:  # directions link on the top result only, to keep the text short
            # start from the address the person gave, not wherever their phone happens to be
            line += "\n" + directions_url(p, _nice_address(matched) if matched else None)
        lines.append(line)
    foot = "Hours change; call first. Reply with another ZIP to search again."
    head = f"Matched address: {_nice_address(matched)}\n\n" if matched else ""
    return head + "\n\n".join(lines) + "\n\n" + foot


def valid_twilio_signature(url, params, signature):
    """Twilio signs url + each POST param (sorted by key) with HMAC-SHA1 of the auth token."""
    token = os.environ["TWILIO_AUTH_TOKEN"].encode()
    data = url + "".join(k + v for k, v in sorted(params.items()))
    expected = base64.b64encode(hmac.new(token, data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(expected, signature)


def xml_esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def speak_phone(phone):
    """'(478) 453-4111 ext. 2' -> '4 7 8, 4 5 3, 4 1 1 1, extension 2' so text-to-speech reads digits."""
    main, _, ext = phone.partition("ext.")
    d = re.sub(r"\D", "", main)
    parts = [d[:3], d[3:6], d[6:]] if len(d) == 10 else [d]
    spoken = ", ".join(" ".join(x) for x in parts)
    ext_digits = re.sub(r"\D", "", ext)
    return spoken + (", extension " + " ".join(ext_digits) if ext_digits else "")


def _say(text):
    return f"<Say>{xml_esc(text)}</Say>"


def _gather(prompt, action, digits):
    return f'<Gather input="dtmf" numDigits="{digits}" timeout="8" action="{xml_esc(action)}">{_say(prompt)}</Gather>'


def _twiml(*parts):
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(parts) + "</Response>"


def forward_number(p):
    """Where a call is forwarded: an explicit 'forward' number, else the pantry's published phone.
    "forward": false in pantries.json turns forwarding off for that pantry."""
    f = p.get("forward")
    if f is False:
        return None
    if f:
        return f
    digits = re.sub(r"\D", "", p["phone"].split("ext.")[0])
    return "+1" + digits if len(digits) == 10 else None


def voice(step="", digits="", zip_code="", n="", dial_status="", now=None):
    """TwiML for the phone line. step: '' menu, 'menu', 'zip', 'pick', 'after'."""
    now = now or datetime.now(TZ)
    goodbye = _say("We did not get that. Goodbye.")
    menu = _twiml(_say("Welcome to Milledgeville food assistance."),
                  _gather("Press 1 to find a food pantry near you. Press 2 for home delivery.", "voice?step=menu", 1), goodbye)
    if step == "":
        return menu
    if step == "menu":
        if digits == "1":
            return _twiml(_gather("Enter your 5 digit ZIP code.", "voice?step=zip", 5), goodbye)
        if digits == "2":
            items = [f"{d['name']}. {speak_phone(d['phone'])}. {d['who']}" for d in DELIVERY if d.get("phone")]
            return _twiml(_say("Home delivery is mostly for seniors or people who cannot leave home. Please call to confirm who qualifies."),
                          *[_say(i) for i in items], _say("Goodbye."))
        return menu
    if step == "zip":
        where = PLACES.get(digits)
        if not where:
            return _twiml(_say("Sorry, I only know Milledgeville ZIP codes, such as 3 1 0 6 1."),
                          _gather("Enter your 5 digit ZIP code.", "voice?step=zip", 5), goodbye)
        top = ranked(where, now)[:2]
        spoken = []
        for p, st, when, d in top:
            when_txt = f"It is open now, until {fmt(when, now)}." if st == "open" else f"It is closed. It opens {fmt(when, now)}."
            spoken.append(f"{p['name']}, {d:.1f} miles away, at {p['address']}. {when_txt} Phone: {speak_phone(p['phone'])}.")
        # Offer to connect even when the pantry is closed: its phone takes messages. The list is open-first, so this is
        # the best open pantry if there is one, else the nearest to open.
        connect = next((p for p, *_ in top if forward_number(p)), None)
        opts = "Press 2 to hear this again. Press 9 to start over."
        if connect:
            opens = status(connect, now)[0] == "open"
            opts = (f"Press 1 to be connected to {connect['name']} now. " if opens else
                    f"Press 1 to be connected to {connect['name']}. It is closed now, so you can leave a message. ") + opts
        idx = PANTRIES.index(connect) if connect else ""
        # No leading slash: Twilio resolves these against the URL it called, so they stay under any prefix (nginx /line/).
        action = f"voice?step=pick&zip={digits}&n={idx}"
        return _twiml(*[_say(s) for s in spoken], _gather(opts, action, 1), _say("Goodbye."))
    if step == "pick":
        if digits == "1" and n.isdigit() and int(n) < len(PANTRIES) and forward_number(PANTRIES[int(n)]):
            p = PANTRIES[int(n)]
            if status(p, now)[0] == "open":
                intro, ring = f"Connecting you to {p['name']}. They are volunteers, so please be patient.", 25
            else:  # closed: ring longer so a voicemail has time to pick up, and say so
                intro, ring = (f"Connecting you to {p['name']}. They are closed right now, so you may reach a voicemail. "
                               "Please leave your name and phone number.", 45)
            return _twiml(_say(intro), f'<Dial timeout="{ring}" action="voice?step=after">{xml_esc(forward_number(p))}</Dial>')
        if digits == "1":
            return _twiml(_say("Sorry, I could not connect that call. Please dial the number I read out. Goodbye."))
        if digits == "2":
            return voice("zip", digits=zip_code, now=now)
        return menu
    if step == "after":
        if dial_status == "completed":
            return _twiml("<Hangup/>")
        return _twiml(_say("Sorry, no one picked up. Please try again later. Goodbye."))
    return menu


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ok = urllib.parse.urlparse(self.path).path == "/health"
        body = b"ok\n" if ok else b"not found\n"
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        form = {k: v[0] for k, v in urllib.parse.parse_qs(body, keep_blank_values=True).items()}
        url = urllib.parse.urlparse(self.path)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        # Signature check is on whenever TWILIO_AUTH_TOKEN is set. Twilio signs the full public URL, so set
        # PUBLIC_BASE_URL (scheme + host, no trailing slash); PUBLIC_URL still works for /sms alone.
        if os.environ.get("TWILIO_AUTH_TOKEN"):
            base = os.environ.get("PUBLIC_BASE_URL")
            full = base + self.path if base else os.environ.get("PUBLIC_URL", "")
            if not valid_twilio_signature(full, form, self.headers.get("X-Twilio-Signature", "")):
                self.send_response(403)
                self.end_headers()
                return
        elif os.environ.get("REQUIRE_SIGNATURE"):
            # Production: never answer unsigned requests, even if the auth token hasn't been added yet.
            self.send_response(503)
            self.end_headers()
            return
        if url.path == "/voice":
            out = voice(query.get("step", ""), form.get("Digits", ""), query.get("zip", ""), query.get("n", ""),
                        form.get("DialCallStatus", "")).encode()
        else:
            text = form.get("Body", "")
            reply = answer(text) if text.strip() else "Text a ZIP code or address to find the nearest open food pantry."
            out = f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{xml_esc(reply)}</Message></Response>'.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/xml")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        host, port = os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "8080"))
        print(f"Listening on http://{host}:{port} (/voice, /sms, /health)", flush=True)
        ThreadingHTTPServer((host, port), Handler).serve_forever()
    elif len(sys.argv) > 1:
        print(answer(" ".join(sys.argv[1:])))
    else:
        sys.exit(__doc__)
