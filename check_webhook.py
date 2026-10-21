#!/usr/bin/env python3
"""Check the live Twilio voice webhook the way Twilio calls it.

Needs the Twilio Auth Token: read from TWILIO_AUTH_TOKEN, or typed when asked. It is never printed or saved.
Usage: python3 check_webhook.py [BASE_URL]      (default https://3-14-120-244.sslip.io/line)
"""
import base64, getpass, hashlib, hmac, os, sys, urllib.error, urllib.parse, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://3-14-120-244.sslip.io/line").rstrip("/")
TOKEN = os.environ.get("TWILIO_AUTH_TOKEN") or getpass.getpass("Twilio Auth Token (hidden): ")


def call(path, form, good_signature=True):
    url = BASE + path
    data = url + "".join(k + v for k, v in sorted(form.items()))
    sig = base64.b64encode(hmac.new(TOKEN.encode(), data.encode(), hashlib.sha1).digest()).decode() if good_signature else "wrong"
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method="POST", headers={"X-Twilio-Signature": sig})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""


CHECKS = [
    ("a signed call is answered with the menu", "/voice", {"CallSid": "CAcheck"}, True, 200, "Welcome to Milledgeville food assistance"),
    ("a signed ZIP step reads the nearest pantry", "/voice?step=zip", {"CallSid": "CAcheck", "Digits": "31062"}, True, 200, "Chard Wray"),
    ("pressing 3 moves on to the next closest", "/voice?step=nav&list=pantry&zip=31062&n=0", {"CallSid": "CAcheck", "Digits": "3"}, True, 200, "New Beginnings"),
    ("delivery: pressing 2 on the menu then 3 moves on", "/voice?step=nav&list=delivery&n=0", {"CallSid": "CAcheck", "Digits": "3"}, True, 200, "Overview"),
    ("a request with a wrong signature is refused", "/voice", {"CallSid": "CAcheck"}, False, 403, ""),
]
HINTS = {503: "the server has no TWILIO_AUTH_TOKEN yet: add it to /etc/pantry-line.env and restart pantry-line",
         403: "the token on the server differs from this one, or PUBLIC_BASE_URL in /etc/pantry-line.env differs from " + BASE,
         404: "the address is wrong, or nginx isn't forwarding /line/ to the service"}

failed = 0
for name, path, form, good, want, text in CHECKS:
    status, body = call(path, form, good)
    ok = status == want and text in body
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"  (got HTTP {status}; {HINTS.get(status, 'unexpected response')})"))
print("\nAll good: point the Twilio number at " + BASE + "/voice" if not failed else f"\n{failed} check(s) failed.")
sys.exit(1 if failed else 0)
