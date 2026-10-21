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


# Amazon Polly neural voice (much clearer than Twilio's default). Change it without code: PHONE_VOICE in /etc/pantry-line.env,
# e.g. Polly.Matthew-Neural, Polly.Ruth-Neural, Polly.Danielle-Neural.
VOICE = os.environ.get("PHONE_VOICE", "Polly.Joanna-Neural")


class _Ssml(str):
    """Markup that is already valid SSML. Plain strings get XML-escaped; these pass through."""


def _pause(ms=300):
    return _Ssml(f'<break time="{ms}ms"/>')


def _phone(phone):
    """Spoken phone number: '(478) 453-4111 ext. 2' -> the number as a phone number, then 'extension 2'. '211' -> 2 1 1."""
    main, _, ext = phone.partition("ext.")
    d = re.sub(r"\D", "", main)
    kind = "telephone" if len(d) == 10 else "digits"
    out = f'<say-as interpret-as="{kind}">{d}</say-as>'
    e = re.sub(r"\D", "", ext)
    return _Ssml(out + (f', extension <say-as interpret-as="digits">{e}</say-as>' if e else ""))


def _speech(parts):
    return "".join(p if isinstance(p, _Ssml) else xml_esc(p) for p in parts)


def _say(*parts):
    return f'<Say voice="{xml_esc(VOICE)}">{_speech(parts)}</Say>'


def _gather(parts, action, digits):
    """Everything is spoken inside the Gather, so a caller can press a key at any time without waiting for the end."""
    parts = [parts] if isinstance(parts, str) else parts
    return f'<Gather input="dtmf" numDigits="{digits}" timeout="8" action="{xml_esc(action)}">{_say(*parts)}</Gather>'


def _twiml(*parts):
    return '<?xml version="1.0" encoding="UTF-8"?><Response>' + "".join(parts) + "</Response>"


def forward_number(p):
    """Where a call is forwarded: an explicit 'forward' number, else the entry's published phone (10 digits).
    "forward": false in pantries.json turns forwarding off for that entry."""
    f = p.get("forward")
    if f is False:
        return None
    if f:
        return f
    digits = re.sub(r"\D", "", p.get("phone", "").split("ext.")[0])
    return "+1" + digits if len(digits) == 10 else None


# --- Words for text-to-speech: abbreviations, ZIPs and times read badly if left as written. ---
_ABBR = {"St": "Street", "Dr": "Drive", "Rd": "Road", "Blvd": "Boulevard", "Ave": "Avenue", "Ln": "Lane", "Ct": "Court",
         "Hwy": "Highway", "N": "North", "S": "South", "E": "East", "W": "West",
         "NE": "Northeast", "NW": "Northwest", "SE": "Southeast", "SW": "Southwest"}


_SAY_FIX = (("Mon-Fri", "Monday through Friday"), ("Mon-Thu", "Monday through Thursday"))


def spoken_text(s):
    """Free text from the data (notes, descriptions) with the bits that read badly aloud fixed."""
    for a, b in _SAY_FIX:
        s = s.replace(a, b)
    return s


def spoken_address(p):
    street = p["address"].split(",")[0]
    return " ".join(_ABBR.get(w.rstrip("."), w) for w in street.split()) + " in Milledgeville"


def spoken_distance(d):
    if d < 0.2:
        return "less than a quarter mile away"
    return "1 mile away" if round(d, 1) == 1.0 else f"{d:.1f} miles away"


def spoken_clock(dt):
    h, m, pm = dt.hour % 12 or 12, dt.minute, dt.hour >= 12
    if m == 0 and dt.hour == 12:
        return "noon"
    return f"{h} {'PM' if pm else 'AM'}" if m == 0 else f"{h}:{m:02d} {'PM' if pm else 'AM'}"


def spoken_when(dt, now):
    days = (dt.date() - now.date()).days
    clock = spoken_clock(dt)
    if days == 0:
        return f"today at {clock}"
    if days == 1:
        return f"tomorrow at {clock}"
    if days < 7:
        return f"{dt.strftime('%A')} at {clock}"
    return f"{dt.strftime('%A')}, {dt.strftime('%B')} {dt.day} at {clock}"


def by_distance(where, now):
    """[(pantry, state, when, miles)] from nearest to farthest from the point (the ZIP's center)."""
    rows = []
    for p in PANTRIES:
        st, when = status(p, now)
        rows.append((p, st, when, miles(where, (p["lat"], p["lng"]))))
    return sorted(rows, key=lambda r: r[3])


def _items(kind, zip_code, now):
    if kind == "delivery":
        return DELIVERY
    where = PLACES.get(zip_code)
    return [r[0] for r in by_distance(where, now)] if where else []


def _options(can_connect, closed, has_next, next_label, connect_label="Press 1 to be connected."):
    opts = []
    if can_connect:
        opts.append(connect_label + (" They are closed, so you can leave a message." if closed else ""))
    opts.append("Press 2 to hear this one again.")
    if has_next:
        opts.append(f"Press 3 for the {next_label}.")
    opts.append("Press 9 to start over.")
    return [x for o in opts for x in (o, _pause(250))]


def _turn_pantry(zip_code, i, now):
    """Read ONE pantry (the i-th nearest), then ask what to do next."""
    rows = by_distance(PLACES[zip_code], now)
    p, st, when, d = rows[i]
    open_now, last = st == "open", i + 1 >= len(rows)
    if open_now:
        state = f"It is open now, until {spoken_clock(when)}."
    elif when:
        state = f"It is closed right now. It opens {spoken_when(when, now)}."
    else:
        state = "I do not have its hours."
    info = [f"{p.get('spoken_name') or p['name']}.", _pause(), f"It is {spoken_distance(d)}, at {spoken_address(p)}.", _pause(), state, _pause()]
    if p.get("note"):
        info += [f"Note: {spoken_text(p['note'])}.", _pause()]
    info += ["Phone number:", _pause(150), _phone(p["phone"]), ".", _pause(500)]
    if last:
        info += ["That is the last pantry I have.", _pause(300)]
    info += _options(bool(forward_number(p)), not open_now, not last, "next closest")
    # No leading slash: Twilio resolves these against the URL it called, so they stay under any prefix (nginx /line/).
    return _twiml(_gather(info, f"voice?step=nav&list=pantry&zip={zip_code}&n={i}", 1), _say("We did not get that. Goodbye."))


def _turn_delivery(i, now):
    """Read ONE delivery option, then ask what to do next (same keys as the pantries)."""
    d, last = DELIVERY[i], i + 1 >= len(DELIVERY)
    info = []
    if i == 0:
        info += ["Home delivery is mostly for seniors, or people who cannot leave home. Please call to confirm who qualifies.", _pause(500)]
    info += [f"{d.get('spoken_name') or d['name']}.", _pause(), spoken_text(d["who"]), _pause()]
    hours = d.get("spoken_hours") or d.get("hours")
    if hours:
        info += [f"{hours}.", _pause()]
    if d.get("phone"):
        info += ["Phone number:", _pause(150), _phone(d["phone"]), ".", _pause(500)]
    if last:
        info += ["That is the last option I have.", _pause(300)]
    info += _options(bool(forward_number(d)), False, not last, "next one")
    return _twiml(_gather(info, f"voice?step=nav&list=delivery&n={i}", 1), _say("We did not get that. Goodbye."))


def _connect(kind, item, now):
    number = forward_number(item)
    if not number:
        return _twiml(_say("Sorry, I could not connect that call. Please dial the number I read out. Goodbye."))
    name = item.get("spoken_name") or item["name"]
    if kind == "delivery":
        intro, ring = f"Connecting you to {name}.", 30
    elif status(item, now)[0] == "open":
        intro, ring = f"Connecting you to {name}. They are volunteers, so please be patient.", 25
    else:  # closed: they take messages. Ring longer so a voicemail has time to pick up, and say so.
        intro, ring = (f"Connecting you to {name}. They are closed right now, so you may reach a voicemail. "
                       "Please leave your name and phone number."), 45
    return _twiml(_say(intro), f'<Dial timeout="{ring}" action="voice?step=after">{xml_esc(number)}</Dial>')


def voice(step="", digits="", zip_code="", n="", dial_status="", now=None, kind=""):
    """TwiML for the phone line. step: '' menu, 'menu', 'zip', 'nav' (one item at a time, kind = pantry|delivery), 'after'."""
    now = now or datetime.now(TZ)
    goodbye = _say("We did not get that. Goodbye.")
    ask_zip = _twiml(_gather("Enter your 5 digit ZIP code.", "voice?step=zip", 5), goodbye)
    menu = _twiml(_say("Welcome to Milledgeville food assistance."),
                  _gather("Press 1 to find a food pantry near you. Press 2 for home delivery.", "voice?step=menu", 1), goodbye)
    if step == "":
        return menu
    if step == "menu":
        if digits == "1":
            return ask_zip
        if digits == "2":
            return _turn_delivery(0, now)
        return menu
    if step == "zip":
        if digits not in PLACES or not digits.isdigit():
            return _twiml(_say("Sorry, I only know Milledgeville ZIP codes, such as ", _Ssml('<say-as interpret-as="digits">31061</say-as>'), "."),
                          _gather("Enter your 5 digit ZIP code.", "voice?step=zip", 5), goodbye)
        return _turn_pantry(digits, 0, now)
    if step == "nav":
        kind = "delivery" if kind == "delivery" else "pantry"
        items = _items(kind, zip_code, now)
        if not items:
            return menu
        i = min(max(int(n) if n.isdigit() else 0, 0), len(items) - 1)
        if digits == "1":
            return _connect(kind, items[i], now)
        if digits == "9":
            return menu
        if digits == "3" and i + 1 < len(items):
            i += 1                      # next one; on the last item (or after 2 or any other key) stay on this one
        return _turn_delivery(i, now) if kind == "delivery" else _turn_pantry(zip_code, i, now)
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
                        form.get("DialCallStatus", ""), kind=query.get("list", "")).encode()
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
