import os
import unittest
import urllib.parse
from datetime import datetime

import pantry

TZ = pantry.TZ
CHARD = next(p for p in pantry.PANTRIES if p["name"].startswith("Chard"))
MIA = next(p for p in pantry.PANTRIES if p["name"].startswith("MIA"))


def at(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=TZ)


class Schedule(unittest.TestCase):
    def test_open_during_hours(self):
        st, end = pantry.status(CHARD, at(2026, 10, 21, 10))  # Wednesday
        self.assertEqual(st, "open")
        self.assertEqual(end, at(2026, 10, 21, 12))

    def test_closed_opens_next_day(self):
        st, nxt = pantry.status(CHARD, at(2026, 10, 21, 13))
        self.assertEqual((st, nxt), ("closed", at(2026, 10, 22, 9)))

    def test_end_time_is_exclusive(self):
        self.assertEqual(pantry.status(CHARD, at(2026, 10, 21, 12))[0], "closed")

    def test_third_thursday_only(self):
        self.assertEqual(pantry.status(MIA, at(2026, 10, 15, 8, 30))[0], "open")      # 3rd Thu
        self.assertEqual(pantry.status(MIA, at(2026, 10, 8, 8, 30))[0], "closed")     # 2nd Thu
        self.assertEqual(pantry.status(MIA, at(2026, 10, 22, 8, 30))[0], "closed")    # 4th Thu

    def test_next_third_thursday_across_month(self):
        _, nxt = pantry.status(MIA, at(2026, 10, 21, 10))
        self.assertEqual(nxt, at(2026, 11, 19, 8))

    def test_closure_skips_date(self):
        p = dict(CHARD, closures=["2026-10-22"])
        _, nxt = pantry.status(p, at(2026, 10, 21, 13))
        self.assertEqual(nxt, at(2026, 10, 27, 9))  # Thu 22 skipped, Fri/Sat/Sun/Mon closed, next Tue

    def test_dst_fall_back_day(self):
        # Clocks fall back Sun Nov 1 2026; Tuesday Nov 3 hours must still read 9am local.
        _, nxt = pantry.status(CHARD, at(2026, 11, 1, 12))
        self.assertEqual((nxt.hour, nxt.minute), (9, 0))
        self.assertEqual(nxt.date().isoformat(), "2026-11-03")


class Answer(unittest.TestCase):
    def test_open_pantry_listed_first_with_directions(self):
        out = pantry.answer("31062", at(2026, 10, 21, 10))
        self.assertTrue(out.startswith("Chard Wray Food Pantry - OPEN NOW"))
        self.assertEqual(out.count("google.com/maps/dir"), 1)

    def test_miles_sanity(self):
        self.assertAlmostEqual(pantry.miles((33.0, -83.0), (33.0, -83.0)), 0)
        self.assertTrue(0.9 < pantry.miles((33.0, -83.0), (34.0, -83.0)) / 69 < 1.1)


class Delivery(unittest.TestCase):
    def test_keyword_returns_delivery_options(self):
        for msg in ("delivery", "Can you DELIVER food to me", "I'm homebound", "can't get out"):
            out = pantry.answer(msg, at(2026, 10, 21, 10))
            self.assertIn("Food delivery in Baldwin County", out)
            self.assertIn("(478) 451-0445", out)
            self.assertIn("2-1-1", out)

    def test_zip_still_finds_pantries(self):
        self.assertIn("Chard Wray", pantry.answer("31061", at(2026, 10, 21, 10)))

    def test_every_option_has_a_way_to_reach_them(self):
        for d in pantry.DELIVERY:
            self.assertTrue(d.get("phone") or d.get("website"), d["name"])


class Address(unittest.TestCase):
    NOW = at(2026, 10, 21, 10)

    def with_geocode(self, result, text="210 S Wayne St"):
        orig = pantry.geocode
        pantry.geocode = lambda t: result
        try:
            return pantry.answer(text, self.NOW)
        finally:
            pantry.geocode = orig

    def test_matched_address_is_shown_back(self):
        # The Census really did turn "210 S Wayne St" into "210 N WAYNE ST"; the caller must be able to see that.
        out = self.with_geocode(((33.0834, -83.2278), "210 N WAYNE ST, MILLEDGEVILLE, GA, 31061"))
        self.assertTrue(out.startswith("Matched address: 210 N Wayne St, Milledgeville, GA, 31061\n\n"))
        self.assertIn("Chard Wray", out)

    def test_directions_start_from_the_address_given(self):
        # Without an origin, Google starts from the phone's own location (which was showing Marietta).
        out = self.with_geocode(((33.0824, -83.2217), "204 E HANCOCK ST, MILLEDGEVILLE, GA, 31061"), "204 E Hancock Street")
        links = [l for l in out.split() if l.startswith("https://www.google.com/maps/dir/")]
        self.assertEqual(len(links), 1)
        self.assertIn("&origin=204%20E%20Hancock%20St%2C%20Milledgeville%2C%20GA%2C%2031061", links[0])
        self.assertIn("destination=", links[0])

    def test_zip_directions_have_no_origin(self):
        out = pantry.answer("31061", self.NOW)
        self.assertNotIn("origin=", out)

    def test_far_away_address_is_rejected(self):
        out = self.with_geocode(((33.7490, -84.3880), "1 PEACHTREE ST, ATLANTA, GA, 30303"))
        self.assertIn("outside the Milledgeville area", out)
        self.assertNotIn("Chard Wray", out)

    def test_unmatched_address(self):
        self.assertIn("couldn't find that place", self.with_geocode(None))

    def test_zip_never_calls_the_geocoder(self):
        orig = pantry.geocode
        pantry.geocode = lambda t: self.fail("geocoder should not run for a ZIP")
        try:
            self.assertIn("Chard Wray", pantry.answer("31061", self.NOW))
        finally:
            pantry.geocode = orig


class Directions(unittest.TestCase):
    MIA = next(p for p in pantry.PANTRIES if p["name"].startswith("MIA"))

    def test_uses_the_place_google_resolves_when_we_have_it(self):
        url = pantry.directions_url(CHARD)
        self.assertIn("destination=Chard%20Wray%20Food%20Pantry%2C%20454%20Broad%20St", url)
        self.assertNotIn("origin=", url)  # no start known: Google uses the device's location

    def test_falls_back_to_exact_coordinates(self):
        # Google doesn't find MIA by name, so a text destination would be a guess.
        self.assertNotIn("maps_query", self.MIA)
        self.assertIn(f"destination={self.MIA['lat']},{self.MIA['lng']}", pantry.directions_url(self.MIA))

    def test_origin_is_added_and_encoded(self):
        url = pantry.directions_url(CHARD, "Georgia College & State University, Milledgeville, GA")
        self.assertTrue(url.endswith("&origin=Georgia%20College%20%26%20State%20University%2C%20Milledgeville%2C%20GA"))

    def test_first_presbyterian_is_where_google_puts_it(self):
        fp = next(p for p in pantry.PANTRIES if p["name"].startswith("First Presbyterian"))
        self.assertAlmostEqual(fp["lat"], 33.0795, places=3)
        self.assertAlmostEqual(fp["lng"], -83.2260, places=3)


class Voice(unittest.TestCase):
    WED_10 = at(2026, 10, 21, 10)
    WED_13 = at(2026, 10, 21, 13)
    MIA = next(p for p in pantry.PANTRIES if p["name"].startswith("MIA"))
    FP = next(p for p in pantry.PANTRIES if p["name"].startswith("First Presbyterian"))
    NB = next(p for p in pantry.PANTRIES if p["name"].startswith("New Beginnings"))

    def tearDown(self):
        for p in pantry.PANTRIES + pantry.DELIVERY:
            p.pop("forward", None)

    @staticmethod
    def words(xml):
        import re
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml))

    def nav(self, digits, i, kind="pantry", zip_code="31062", now=None):
        return pantry.voice("nav", digits=digits, zip_code=zip_code, n=str(i), kind=kind, now=now or self.WED_10)

    # --- voice quality ---
    def test_menu(self):
        out = pantry.voice("", now=self.WED_10)
        self.assertIn("<Gather", out)
        self.assertIn("Welcome to Milledgeville food assistance", out)

    def test_every_say_uses_the_neural_voice(self):
        for xml in (pantry.voice(), pantry.voice("zip", digits="31062", now=self.WED_10), pantry.voice("menu", digits="2")):
            self.assertGreater(xml.count("<Say"), 0)
            self.assertEqual(xml.count("<Say"), xml.count('<Say voice="Polly.Joanna-Neural"'))

    def test_phone_numbers_are_spoken_as_phone_numbers(self):
        self.assertEqual(pantry._phone("(478) 414-1126"), '<say-as interpret-as="telephone">4784141126</say-as>')
        self.assertEqual(pantry._phone("(478) 453-4111 ext. 2"),
                         '<say-as interpret-as="telephone">4784534111</say-as>, extension <say-as interpret-as="digits">2</say-as>')
        self.assertEqual(pantry._phone("211"), '<say-as interpret-as="digits">211</say-as>')

    def test_spoken_words(self):
        self.assertEqual(pantry.spoken_address(CHARD), "472 Broad Street in Milledgeville")
        self.assertEqual(pantry.spoken_address(self.FP), "210 South Wayne Street in Milledgeville")
        self.assertEqual(pantry.spoken_address(self.NB), "200 Southside Drive in Milledgeville")
        self.assertEqual(pantry.spoken_address(self.MIA), "133 Old River Bridge Road Southeast in Milledgeville")
        self.assertEqual(pantry.spoken_distance(0.1), "less than a quarter mile away")
        self.assertEqual(pantry.spoken_distance(1.04), "1 mile away")
        self.assertEqual(pantry.spoken_distance(2.66), "2.7 miles away")
        self.assertEqual([pantry.spoken_clock(at(2026, 10, 21, h, m)) for h, m in ((12, 0), (9, 0), (9, 30), (13, 15))],
                         ["noon", "9 AM", "9:30 AM", "1:15 PM"])
        self.assertEqual(pantry.spoken_when(at(2026, 10, 21, 12), self.WED_10), "today at noon")
        self.assertEqual(pantry.spoken_when(at(2026, 10, 22, 9), self.WED_10), "tomorrow at 9 AM")
        self.assertEqual(pantry.spoken_when(at(2026, 10, 27, 9, 30), self.WED_10), "Tuesday at 9:30 AM")
        self.assertEqual(pantry.spoken_when(at(2026, 11, 19, 8), self.WED_10), "Thursday, November 19 at 8 AM")
        self.assertEqual(pantry.spoken_text("Hot meal Mon-Fri"), "Hot meal Monday through Friday")

    # --- pantries: one at a time, nearest first ---
    def test_zip_reads_only_the_nearest_pantry_and_offers_the_keys(self):
        xml = pantry.voice("zip", digits="31062", now=self.WED_10)
        text = self.words(xml)
        self.assertIn("Chard Wray", text)
        for other in ("New Beginnings", "First Presbyterian", "M I A"):
            self.assertNotIn(other, text)
        for key in ("Press 1", "Press 2", "Press 3", "Press 9"):
            self.assertIn(key, text)
        self.assertIn('numDigits="1"', xml)
        self.assertIn("voice?step=nav&amp;list=pantry&amp;zip=31062&amp;n=0", xml)
        self.assertIn("Gather", xml.split("Chard Wray")[0])        # spoken inside the Gather, so a key press can interrupt it

    def test_each_zip_walks_nearest_to_farthest_and_the_last_ends_the_list(self):
        for zip_code in ("31061", "31062", "31059"):
            expected = [(p.get("spoken_name") or p["name"]).split(".")[0] for p, *_ in pantry.by_distance(pantry.PLACES[zip_code], self.WED_10)]
            self.assertEqual(sorted(set(expected)), sorted(expected))
            heard, xml = [], pantry.voice("zip", digits=zip_code, now=self.WED_10)
            for i in range(len(expected)):
                text = self.words(xml)
                heard.append(next(n for n in expected if n in text))
                if i + 1 < len(expected):
                    self.assertIn("Press 3 for the next closest", text)
                    xml = self.nav("3", i, zip_code=zip_code)
            self.assertEqual(heard, expected, zip_code)
            self.assertIn("That is the last pantry I have", text)
            self.assertNotIn("Press 3", text)

    def test_distances_really_increase(self):
        for zip_code in ("31061", "31062", "31059"):
            d = [r[3] for r in pantry.by_distance(pantry.PLACES[zip_code], self.WED_10)]
            self.assertEqual(d, sorted(d))

    def test_two_repeats_the_same_pantry(self):
        self.assertIn("New Beginnings", self.words(self.nav("2", 1)))
        self.assertIn("n=1", self.nav("2", 1))

    def test_unknown_key_repeats_and_three_on_the_last_stays_put(self):
        self.assertIn("Chard Wray", self.words(self.nav("7", 0)))
        last = len(pantry.PANTRIES) - 1
        out = self.words(self.nav("3", last))
        self.assertIn("M I A", out)
        self.assertIn("last pantry", out)

    def test_nine_starts_over(self):
        self.assertIn("Welcome to Milledgeville food assistance", self.nav("9", 1))

    def test_connect_works_open_or_closed_with_a_warning_when_closed(self):
        self.assertEqual(pantry.forward_number(CHARD), "+14784141126")
        open_menu = self.words(pantry.voice("zip", digits="31062", now=self.WED_10))
        self.assertIn("Press 1 to be connected.", open_menu)
        self.assertNotIn("closed, so you can leave a message", open_menu)
        dial = self.nav("1", 0)
        self.assertIn('<Dial timeout="25"', dial)
        self.assertIn("+14784141126", dial)
        self.assertNotIn("voicemail", dial)
        closed_menu = self.words(pantry.voice("zip", digits="31062", now=self.WED_13))
        self.assertIn("They are closed, so you can leave a message", closed_menu)
        closed = self.nav("1", 0, now=self.WED_13)
        self.assertIn('<Dial timeout="45"', closed)
        self.assertIn("you may reach a voicemail", closed)

    def test_forward_false_removes_connect_for_that_pantry(self):
        CHARD["forward"] = False
        self.assertIsNone(pantry.forward_number(CHARD))
        self.assertNotIn("Press 1", self.words(pantry.voice("zip", digits="31062", now=self.WED_10)))
        self.assertIn("could not connect", self.nav("1", 0))
        self.assertNotIn("<Dial", self.nav("1", 0))

    def test_unknown_zip_asks_again(self):
        out = pantry.voice("zip", digits="90210", now=self.WED_10)
        self.assertIn("only know Milledgeville ZIP", out)
        self.assertNotIn("<Dial", out)
        self.assertIn("Gather", out)

    def test_bad_inputs_do_not_crash(self):
        for n in ("abc", "99", "-1", ""):
            self.assertIn("<Response>", pantry.voice("nav", digits="1", zip_code="31062", n=n, kind="pantry", now=self.WED_10))
        self.assertIn("Welcome", pantry.voice("nav", digits="3", zip_code="99999", n="0", kind="pantry", now=self.WED_10))

    # --- delivery: the same flow ---
    def test_delivery_flow_one_at_a_time_with_the_same_keys(self):
        first = pantry.voice("menu", digits="2", now=self.WED_10)
        text = self.words(first)
        self.assertIn("mostly for seniors", text)
        self.assertIn("Baldwin County Senior Citizens Center", text)
        self.assertIn("Monday through Friday", text)
        self.assertNotIn("Mon-Fri", text)
        for key in ("Press 1", "Press 2", "Press 3", "Press 9"):
            self.assertIn(key, text)
        self.assertNotIn("Overview", text)                     # only the first option
        self.assertIn("voice?step=nav&amp;list=delivery&amp;n=0", first)
        count = len(pantry.DELIVERY)
        for i in range(count):
            out = pantry.voice("nav", digits="2", n=str(i), kind="delivery", now=self.WED_10)
            self.assertNotIn("Mon-Fri", out)
            self.assertNotIn("Mon-Thu", out)
        last = self.words(pantry.voice("nav", digits="2", n=str(count - 1), kind="delivery"))
        self.assertIn("Two one one", last)
        self.assertIn("That is the last option I have", last)
        self.assertNotIn("Press 3", last)
        self.assertNotIn("Press 1", last)                      # 2-1-1 can't be dialed from a call, so no connect
        self.assertIn('<say-as interpret-as="digits">211</say-as>', pantry.voice("nav", digits="2", n=str(count - 1), kind="delivery"))

    def test_delivery_option_without_a_phone_is_read_but_not_connectable(self):
        mow = next(i for i, d in enumerate(pantry.DELIVERY) if not d.get("phone"))
        out = pantry.voice("nav", digits="2", n=str(mow), kind="delivery")
        text = self.words(out)
        self.assertIn("Meals on Wheels", text)
        self.assertNotIn("Phone number", text)
        self.assertNotIn("Press 1", text)
        self.assertIn("could not connect", pantry.voice("nav", digits="1", n=str(mow), kind="delivery"))

    def test_delivery_connect_and_walk(self):
        dial = pantry.voice("nav", digits="1", n="0", kind="delivery", now=self.WED_13)
        self.assertIn('<Dial timeout="30"', dial)
        self.assertIn("+14784510445", dial)
        self.assertIn("Overview", self.words(pantry.voice("nav", digits="3", n="0", kind="delivery")))
        self.assertIn("Welcome", pantry.voice("nav", digits="9", n="0", kind="delivery"))

    # --- plumbing ---
    def test_follow_up_addresses_stay_under_the_public_prefix(self):
        # The bug a real call found: "/voice?step=menu" resolves to https://host/voice, skipping nginx's /line/ prefix (404).
        # Resolve every action the way Twilio does, from the URL it called, and require the prefix.
        import re
        from urllib.parse import urljoin
        called = "https://example.test/line/voice"
        calls = [dict(), dict(step="menu", digits="1"), dict(step="menu", digits="2"), dict(step="menu", digits="9"),
                 dict(step="zip", digits="31062"), dict(step="zip", digits="90210"),
                 dict(step="nav", digits="1", n="0", zip_code="31062", kind="pantry"),
                 dict(step="nav", digits="1", n="0", zip_code="31062", kind="pantry", now=self.WED_13),
                 dict(step="nav", digits="3", n="0", zip_code="31062", kind="pantry"),
                 dict(step="nav", digits="2", n="1", kind="delivery"), dict(step="nav", digits="1", n="0", kind="delivery")]
        found = 0
        for kw in calls:
            kw.setdefault("now", self.WED_10)
            for action in re.findall(r'action="([^"]+)"', pantry.voice(**kw)):
                found += 1
                resolved = urljoin(called, action.replace("&amp;", "&"))
                self.assertTrue(resolved.startswith("https://example.test/line/voice?step="), f"{action} -> {resolved}")
        self.assertGreaterEqual(found, 8)

    def test_after_dial(self):
        self.assertIn("no one picked up", pantry.voice("after", dial_status="no-answer"))
        self.assertIn("<Hangup/>", pantry.voice("after", dial_status="completed"))

    def test_all_steps_are_wellformed_xml(self):
        from xml.dom import minidom
        calls = [dict(), dict(step="menu", digits="1"), dict(step="menu", digits="2"), dict(step="zip", digits="31061"),
                 dict(step="zip", digits="00000"), dict(step="after", dial_status="busy")]
        calls += [dict(step="nav", digits=k, n=str(i), zip_code="31059", kind="pantry") for k in "12379" for i in range(4)]
        calls += [dict(step="nav", digits=k, n=str(i), kind="delivery") for k in "12379" for i in range(len(pantry.DELIVERY))]
        for kw in calls:
            minidom.parseString(pantry.voice(now=self.WED_10, **kw))


class Server(unittest.TestCase):
    """Runs the real HTTP server and calls it the way Twilio does (behind an nginx /line prefix that is stripped)."""
    BASE = "https://example.test/line"

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import ThreadingHTTPServer
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), pantry.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def post(self, path, form, signature=None):
        import urllib.error, urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=urllib.parse.urlencode(form).encode(), method="POST")
        if signature is not None:
            req.add_header("X-Twilio-Signature", signature)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, ""

    @staticmethod
    def sign(url, form, token="secret"):
        import base64, hashlib, hmac
        data = url + "".join(k + v for k, v in sorted(form.items()))
        return base64.b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()

    def test_health(self):
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health") as r:
            self.assertEqual((r.status, r.read()), (200, b"ok\n"))

    def test_unsigned_is_refused_in_production_even_without_a_token(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"REQUIRE_SIGNATURE": "1"}, clear=False):
            os.environ.pop("TWILIO_AUTH_TOKEN", None)
            self.assertEqual(self.post("/voice", {"CallSid": "x"})[0], 503)

    def test_wrong_signature_is_rejected_and_right_one_is_answered(self):
        from unittest import mock
        env = {"TWILIO_AUTH_TOKEN": "secret", "PUBLIC_BASE_URL": self.BASE, "REQUIRE_SIGNATURE": "1"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(self.post("/voice", {"CallSid": "x"}, "not-a-signature")[0], 403)
            self.assertEqual(self.post("/voice", {"CallSid": "x"})[0], 403)
            form = {"CallSid": "CA1", "From": "+14785550100"}
            status, body = self.post("/voice", form, self.sign(self.BASE + "/voice", form))
            self.assertEqual(status, 200)
            self.assertIn("Welcome to Milledgeville food assistance", body)
            # a ZIP step with a query string, signed over the full public URL including the query
            form = {"CallSid": "CA1", "Digits": "31062"}
            status, body = self.post("/voice?step=zip", form, self.sign(self.BASE + "/voice?step=zip", form))
            self.assertEqual(status, 200)
            self.assertIn("Chard Wray", body)

    def test_signature_for_a_different_path_is_rejected(self):
        from unittest import mock
        env = {"TWILIO_AUTH_TOKEN": "secret", "PUBLIC_BASE_URL": self.BASE}
        with mock.patch.dict(os.environ, env):
            form = {"CallSid": "CA1"}
            self.assertEqual(self.post("/voice", form, self.sign(self.BASE + "/sms", form))[0], 403)


class Signature(unittest.TestCase):
    def test_signature(self):
        import base64, hashlib, hmac, os
        os.environ["TWILIO_AUTH_TOKEN"] = "t"
        sig = base64.b64encode(hmac.new(b"t", b"http://x/smsBody31061", hashlib.sha1).digest()).decode()
        self.assertTrue(pantry.valid_twilio_signature("http://x/sms", {"Body": "31061"}, sig))
        self.assertFalse(pantry.valid_twilio_signature("http://x/sms", {"Body": "31062"}, sig))


if __name__ == "__main__":
    unittest.main()
