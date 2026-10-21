#!/usr/bin/env python3
"""Nearest open food pantry for Milledgeville, GA.

CLI:      python3 pantry.py "31061"        (ZIP, landmark, or street address)
SMS sim:  python3 pantry.py --serve        (POST /sms with Body=..., Twilio-style TwiML reply)
"""
import base64, hashlib, hmac, json, math, os, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
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


def locate(text):
    q = text.strip().lower()
    for key, pt in PLACES.items():
        if key in q:
            return pt
    # Fall back to the free US Census geocoder for street addresses.
    try:
        addr = text if "ga" in q else f"{text}, Milledgeville, GA"
        url = ("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"
               + urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current", "format": "json"}))
        with urllib.request.urlopen(url, timeout=6) as r:
            m = json.load(r)["result"]["addressMatches"]
        if m:
            return m[0]["coordinates"]["y"], m[0]["coordinates"]["x"]
    except Exception:
        pass
    return None


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
    where = locate(text)
    if not where:
        return "Sorry, I couldn't find that place. Text a ZIP (31061), a landmark (GCSU), or a street address."
    rows = []
    for p in PANTRIES:
        st, when = status(p, now)
        rows.append((st != "open", when or datetime.max.replace(tzinfo=TZ), miles(where, (p["lat"], p["lng"])), p, st, when))
    # Open now first (nearest), then soonest to open.
    open_now = sorted([r for r in rows if not r[0]], key=lambda r: r[2])
    later = sorted([r for r in rows if r[0]], key=lambda r: (r[1], r[2]))
    lines = []
    for i, (_, _, d, p, st, when) in enumerate((open_now + later)[:3]):
        head = f"OPEN NOW until {fmt(when, now)}" if st == "open" else f"Closed, opens {fmt(when, now)}"
        note = f" ({p['note']})" if p.get("note") else ""
        line = f"{p['name']} - {head}\n{p['address']} - {d:.1f} mi\n{p['phone']}{note}"
        if i == 0:  # directions link on the top result only, to keep the text short
            line += f"\nhttps://www.google.com/maps/dir/?api=1&destination={p['lat']},{p['lng']}"
        lines.append(line)
    foot = "Hours change; call first. Reply with another ZIP to search again."
    return "\n\n".join(lines) + "\n\n" + foot


def valid_twilio_signature(url, params, signature):
    """Twilio signs url + each POST param (sorted by key) with HMAC-SHA1 of the auth token."""
    token = os.environ["TWILIO_AUTH_TOKEN"].encode()
    data = url + "".join(k + v for k, v in sorted(params.items()))
    expected = base64.b64encode(hmac.new(token, data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(expected, signature)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        # Signature check is on whenever TWILIO_AUTH_TOKEN is set; PUBLIC_URL must be the exact URL Twilio calls.
        if os.environ.get("TWILIO_AUTH_TOKEN"):
            params = {k: v[0] for k, v in urllib.parse.parse_qs(body, keep_blank_values=True).items()}
            sig = self.headers.get("X-Twilio-Signature", "")
            if not valid_twilio_signature(os.environ.get("PUBLIC_URL", ""), params, sig):
                self.send_response(403)
                self.end_headers()
                return
        text = urllib.parse.parse_qs(body).get("Body", [""])[0]
        reply = answer(text) if text.strip() else "Text a ZIP code or address to find the nearest open food pantry."
        esc = reply.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        out = f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{esc}</Message></Response>'.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/xml")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        host = os.environ.get("HOST", "127.0.0.1")
        print(f"Listening on http://{host}:8080/sms")
        HTTPServer((host, 8080), Handler).serve_forever()
    elif len(sys.argv) > 1:
        print(answer(" ".join(sys.argv[1:])))
    else:
        sys.exit(__doc__)
