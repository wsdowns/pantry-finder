import unittest
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


class Signature(unittest.TestCase):
    def test_signature(self):
        import base64, hashlib, hmac, os
        os.environ["TWILIO_AUTH_TOKEN"] = "t"
        sig = base64.b64encode(hmac.new(b"t", b"http://x/smsBody31061", hashlib.sha1).digest()).decode()
        self.assertTrue(pantry.valid_twilio_signature("http://x/sms", {"Body": "31061"}, sig))
        self.assertFalse(pantry.valid_twilio_signature("http://x/sms", {"Body": "31062"}, sig))


if __name__ == "__main__":
    unittest.main()
