# Milledgeville Food Pantry Finder

Text a ZIP, landmark (GCSU, downtown), or street address; get the nearest open pantries with hours and phone numbers.

## Files
- `pantry.py` - finder logic plus a Twilio-style SMS webhook. Python 3.9+, standard library only.
- `pantries.json` - the data. Edit this to add or fix pantries. Weekday: Mon=0. `nth` means the nth weekday of the month.

## Try it
```
python3 pantry.py "31061"
python3 pantry.py "GCSU"
```

## Website
`site/` is a static page (no backend). After editing `pantries.json` run `python3 build_site.py` to refresh `site/data.js`.
Preview: `cd site && python3 -m http.server 8765`, then open http://localhost:8765.
When the Twilio number exists, fill in `site/config.js` (display, tel, and `voiceEnabled: true` once the voice line is live). Until then the page shows "coming soon".
Tests: `node --test site/finder.test.js` (mirrors the Python tests so site and text line agree).
Host it free on GitHub Pages, Netlify, or Cloudflare Pages by publishing the `site/` folder.

## Closures
Add `"closures": ["2026-11-26"]` (ISO dates) to a pantry in `pantries.json` to skip that day. Run `python3 -m unittest` after editing the code.

## Run the SMS webhook
```
python3 pantry.py --serve
```
Listens on `POST /sms`, reads Twilio's `Body` field, replies with TwiML.

## Wiring up Twilio
1. Register for A2P 10DLC / toll-free verification first. Carrier approval can take days to weeks, so start early. Until then only verified numbers can text it.
2. Expose the server publicly (ngrok for a demo; a small always-on server for real use). For a server, set `HOST=0.0.0.0`.
3. In Twilio, set the number's "A message comes in" webhook to `POST https://<public-host>/sms`.
4. Turn on signature checking so only Twilio can call it:
```
export TWILIO_AUTH_TOKEN=<your auth token>
export PUBLIC_URL=https://<public-host>/sms   # must match the URL Twilio calls exactly
python3 pantry.py --serve
```
When `TWILIO_AUTH_TOKEN` is unset, checking is off (fine for local testing). If you sit behind a proxy that changes the URL, `PUBLIC_URL` must still be the URL Twilio was configured with.

## Data caveats
- Hours come from pantry sites, Lemontree, and findhelp (reviewed Oct 2026). Call pantries to confirm before launch, and re-check periodically.
- First Presbyterian's coordinates and the ZIP/landmark center points are approximate, so distances are rough.
- Street-address lookup uses the free US Census geocoder and needs internet.
- Not handled yet: STOP/HELP keywords (Twilio handles basic opt-out itself), holidays, closures.
