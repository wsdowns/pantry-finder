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
The map is Leaflet 1.9.4 (vendored in `site/vendor/leaflet/`, checked against the published SRI hashes) on OpenStreetMap tiles. Pins, distance rings and the route line are drawn by our code. Pins are keyboard-accessible (Enter or Space jumps to the pantry card), one-finger drag is off on touch screens so the page still scrolls, and the zoom buttons are 44px.
- OpenStreetMap's public tile server is fine for a demo and light use but not for heavy traffic ([usage policy](https://operations.osmfoundation.org/policies/tiles/)). Before a real launch, switch the tile URL in `site/app.js` to a hosted tile provider or your own tiles.
- Tile requests show visitors' IP addresses to the tile server; the page says so under the map. If the tiles can't load (offline), the pins, rings and distances still work and a note appears.
Tests: `node --test site/finder.test.js` (mirrors the Python tests so site and text line agree).
Host it free on GitHub Pages, Netlify, or Cloudflare Pages by publishing the `site/` folder.

## Demo script (about 3 minutes, works with no Twilio and with every pantry closed)
1. **The problem (20s).** Open the site. "Food assistance is scattered across Facebook pages, directories and phone trees, and the hours are short: Chard Wray is open about 9 hours a week."
2. **Time machine (40s).** Click "Tue 10am: two open": map pins turn green, cards say Open now. Then "Sat 3pm: all closed" to show it never sends anyone to a locked door. Use the day buttons and slider to scrub the week.
3. **Map (20s).** Click a pin; the page jumps to its card with hours, directions and a tap-to-call number. Search "GCSU" to move the "You" marker.
4. **Text line (40s).** In "Try the text line", tap `31061`, then `delivery`. "This is the same code that answers real texts. A test checks the website and the text line give identical answers."
5. **Phone line (40s).** Press Call, 1, then 31061. Tick "Read aloud" to hear it. Press 1 to be connected to the open pantry (in the browser it stops at "the call would now ring the pantry"; the real line dials it).
6. **Honesty slide (20s).** "Sources disagree on several pantries (see `pantries.json`), so we list only what sources agree on and tell people to call first. Next step is phone confirmation and pantry opt-in."

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

## Voice line and call forwarding
`POST /voice` is the phone line: menu (1 = pantry near you, 2 = home delivery), the caller keys a ZIP, hears the two best pantries, and can be connected to one.
- **Forwarding is on by default** for every pantry, to its published `phone` (no opt-in needed). Calls are forwarded only while that pantry is open by its listed hours; otherwise the caller hears when it opens. In `pantries.json`, `"forward": false` turns it off for one pantry and `"forward": "+1478XXXXXXX"` overrides the number.
- Caveats: Chard Wray's and MIA's published numbers are still unconfirmed (sources conflict), and the person answering is often a volunteer. By default the pantry sees the caller's own number as caller ID.
- Point the number's "A call comes in" webhook at `POST https://<public-host>/voice`.
- Twilio signs the full URL including `?step=...`, so for signature checking set `PUBLIC_BASE_URL=https://<public-host>` (scheme + host, no trailing slash). `PUBLIC_URL` still works for `/sms` alone.

## Twilio account notes (as of 2026-10-21)
- Number seen in the console: toll-free +1 (888) 702-4919, SMS/MMS/Voice enabled.
- **That number's incoming-message webhook currently points at ChurchTrakr** (`app.churchtrakr.com/_api/platform/crm/sms-inbound`). Repointing it would stop texts reaching ChurchTrakr. Use a separate number for this project, or confirm with the account owner before changing it.
- Toll-free numbers need toll-free verification before the public can text them reliably.
- Not published anywhere yet; `site/config.js` is intentionally still empty.

## Data caveats
- Hours come from pantry sites, Lemontree, and findhelp (reviewed Oct 2026). Call pantries to confirm before launch, and re-check periodically.
- First Presbyterian's coordinates and the ZIP/landmark center points are approximate, so distances are rough.
- Street-address lookup (website, text simulator and real text line) uses the free US Census geocoder and needs internet. It is optional; ZIP and landmark search never leave the page. The page tells people the address goes to the Census Bureau and is not stored.
  - The Census can match a different address than typed (it turned `210 S Wayne St` into `210 N Wayne St`), so every address answer shows the matched address first.
  - Addresses more than 40 miles from downtown Milledgeville are rejected.
  - Central State campus addresses (454/472 Broad St) are not in the Census data, so they don't match.
  - The browser can't call the geocoder normally (no CORS headers), so the website uses its script-tag (JSONP) form and uses only the two coordinate numbers from the reply.
- Not handled yet: STOP/HELP keywords (Twilio handles basic opt-out itself), holidays, closures.
