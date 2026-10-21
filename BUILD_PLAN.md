# Build Plan: Milledgeville Pantry Line

Status legend: [x] done, [ ] to do, [?] waiting on Twilio detail from teammate.

## Decisions so far
- Channel: SMS first. Voice is an add-on (no carrier registration needed, so it can launch sooner). No MMS.
- Scope: Milledgeville / Baldwin County, GA. Four pantries seeded.
- Stack: Python standard library only; data in `pantries.json`.

## Phase 0: Prototype (done)
- [x] Finder logic: ZIP / landmark / address, open-now and next-open, nth-weekday rules
- [x] Twilio-style SMS webhook with signature check
- [x] README for the Twilio handoff

## Phase 1: Data you can trust (before any public launch)
- [ ] Call each of the 4 pantries; confirm hours, address, requirements, and whether they want to be listed
- [ ] Verify First Presbyterian coordinates (currently approximate)
- [ ] Look for pantries we missed (churches, GCSU campus pantry, Baldwin County/senior services, mobile distributions)
- [ ] Decide an owner and cadence for re-checking hours (suggest monthly), and a "last verified" date per pantry
- Done when: every listed pantry has a human-confirmed date in `pantries.json`

## Phase 2: Texting live  [?]
Waiting on teammate for: Twilio account/number, registration type and approval status, hosting choice, public URL.
- [ ] Carrier registration submitted (long pole: days to weeks)
- [ ] Deploy server on an always-on host (not a laptop); set `HOST`, `TWILIO_AUTH_TOKEN`, `PUBLIC_URL`
- [ ] Point the number's webhook at `POST /sms`
- [ ] Test from a verified phone while registration is pending
- Done when: a real text returns correct pantries, and an unsigned request returns 403

## Phase 3: Reply quality
- [x] Add a directions link for the top result (replies are multi-segment SMS; fine, but keep it to one link)
- [x] Friendly reply to unrecognized input (STOP/HELP are handled by Twilio itself)
- [x] Holidays and one-off closures (`closures` list per pantry in `pantries.json`)
- [ ] Spanish replies if the community needs it (confirm with pantries)
- [x] Unit tests for schedule logic (nth weekday, month boundaries, DST, closures, signature): `python3 -m unittest`

## Phase 4: Voice line (optional, can run in parallel with Phase 2)
- [x] `/voice` webhook: menu, ZIP by keypad, reads top 2 pantries aloud, home-delivery option
- [x] Call forwarding to a pantry, only while open and only if `forward` is set in `pantries.json` (none set yet)
- [ ] Offer to text the details to the caller (needs Twilio REST credentials)
- [x] Same signature check (use `PUBLIC_BASE_URL`)
- [ ] Get each pantry's OK and a confirmed number before enabling `forward`
- Can go live before SMS registration clears

## Phase 5: Operate
- [ ] Log (without storing phone numbers longer than needed) queries and "no result" cases to see what people ask for
- [ ] Privacy line in the first reply; do not keep message content with identifying details
- [ ] Simple uptime check and an alert to one person
- [ ] Outreach: flyers/QR code at pantries, GCSU, libraries, churches, senior services
- [ ] Pantry contact for corrections (a phone/email printed on the flyer)

## Risks
- Stale hours send someone to a closed pantry. Mitigation: phase 1 verification, "call first" in every reply, last-verified date.
- Carrier registration delay. Mitigation: voice line and verified-number testing in the meantime.
- Single point of failure on one laptop or one person. Mitigation: real hosting and a named owner for the data.

## Open questions for the Twilio detail
1. Which number type and registration path (A2P 10DLC vs toll-free), and who is the registered organization?
2. Where will it be hosted, and what is the public URL?
3. Who owns the Twilio account and gets billing alerts?
4. Do we want voice, and if so on the same number or a separate one?
