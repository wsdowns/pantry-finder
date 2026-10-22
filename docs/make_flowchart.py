#!/usr/bin/env python3
"""Builds site/flowchart/phone-line-flowchart.svg, the presentation flowchart of how a call works.

Self-contained SVG (fonts and logo embedded). Change the wording or layout below and rerun:
    python3 docs/make_flowchart.py
Then render the PNG for slides with docs/render_flowchart.sh.
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "flowchart" / "phone-line-flowchart.svg"

# Palette: Georgia College green and navy, plus the logo's gold.
G, GD, SAGE, BG, LINE = "#005028", "#003319", "#b3d1a9", "#f4f7f2", "#cfdcc9"
INK, MUTED, NAVY, GOLD, OPEN, PALE = "#14231a", "#4d5f54", "#003366", "#c79a2a", "#00642f", "#e6efe2"
NAVY_PALE, NAVY_LINE = "#eaf0f7", "#a8bdd6"

b64 = lambda path: base64.b64encode(Path(path).read_bytes()).decode()

# Circular logo mark, cut from the full logo.
full = Image.open(ROOT / "site" / "logo-full.webp").convert("RGB")
cx, cy, r = 279.5, 238, 214
mark = full.crop((round(cx - r), round(cy - r), round(cx + r), round(cy + r))).convert("RGBA")
mask = Image.new("L", mark.size, 0)
ImageDraw.Draw(mask).ellipse((0, 0, mark.size[0] - 1, mark.size[1] - 1), fill=255)
mark.putalpha(mask)
buf = io.BytesIO()
mark.resize((260, 260), Image.LANCZOS).save(buf, "PNG", optimize=True)
LOGO = base64.b64encode(buf.getvalue()).decode()

parts = []
add = parts.append


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=21, fill=INK, font="Mulish", weight=600, anchor="start", extra=""):
    add(f'<text x="{x}" y="{y}" font-family="{font}, sans-serif" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}" {extra}>{esc(s)}</text>')


def lines(x, y, rows, size=21, fill=INK, step=27, anchor="start", weight=600):
    for i, s in enumerate(rows):
        text(x, y + i * step, s, size, fill, "Mulish", weight, anchor)


def rect(x, y, w, h, rx=16, fill="#fff", stroke=LINE, sw=2, extra=""):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')


def diamond(cx_, cy_, hw, hh, fill=PALE, stroke=G, sw=3.5):
    add(f'<polygon points="{cx_ - hw},{cy_} {cx_},{cy_ - hh} {cx_ + hw},{cy_} {cx_},{cy_ + hh}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')


def arrow(d, color=G, sw=4, marker="ah"):
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#{marker})"/>')


def badge(x, y, label, fill=G, r_=20, size=24):
    add(f'<circle cx="{x}" cy="{y}" r="{r_}" fill="{fill}" stroke="#fff" stroke-width="3"/>')
    text(x, y + size * 0.36, label, size, "#fff", "Oswald", 700, "middle")


def title(x, y, s, color=G, size=24, anchor="start"):
    text(x, y, s, size, color, "Oswald", 600, anchor, 'letter-spacing="1"')


# ------------------------------------------------------------------ canvas
W, H = 1920, 1080
add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add(f'<defs><style>'
    f'@font-face{{font-family:"Mulish";src:url(data:font/woff2;base64,{b64(ROOT / "site/fonts/mulish-latin.woff2")}) format("woff2");font-weight:200 1000}}'
    f'@font-face{{font-family:"Oswald";src:url(data:font/woff2;base64,{b64(ROOT / "site/fonts/oswald-latin.woff2")}) format("woff2");font-weight:200 700}}'
    f'</style>'
    f'<marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{G}"/></marker>'
    f'<marker id="an" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{NAVY}"/></marker>'
    f'<filter id="sh" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#003319" flood-opacity="0.12"/></filter>'
    f'</defs>')
add(f'<rect width="{W}" height="{H}" fill="{BG}"/>')

# ------------------------------------------------------------------ header
add(f'<image href="data:image/png;base64,{LOGO}" x="45" y="30" width="100" height="100"/>')
text(172, 84, "HOW A CALL WORKS", 58, GD, "Oswald", 700, extra='letter-spacing="1.5"')
text(172, 126, "No app. No internet. No sign-up. Works on any phone.", 27, MUTED, "Mulish", 600)
rect(1420, 40, 450, 90, 45, G, G, 0, 'filter="url(#sh)"')
text(1645, 106, "(844) 670-4047", 54, "#fff", "Oswald", 600, "middle", 'letter-spacing="1"')

# ------------------------------------------------------------------ left column: start, greeting, menu, legend
rect(50, 185, 290, 88, 44, G, G, 0, 'filter="url(#sh)"')
text(195, 224, "A NEIGHBOR CALLS", 28, "#fff", "Oswald", 600, "middle", 'letter-spacing="1"')
text(195, 255, "from any phone", 21, SAGE, "Mulish", 700, "middle")
arrow("M195,275 V310")

rect(50, 312, 290, 162, 18, "#fff", LINE, 2, 'filter="url(#sh)"')
title(72, 346, "GREETING", G, 22)
lines(72, 378, ["“Welcome to Milledgeville", "food assistance. Press 1 for", "a food pantry, 2 for home", "delivery.”"], 20, INK, 26)
arrow("M195,476 V520")

diamond(195, 612, 142, 90, PALE, G, 4)
title(195, 606, "CALLER PRESSES", G, 20, "middle")
text(195, 646, "1  or  2", 38, GD, "Oswald", 700, "middle")

# fork to the two lanes
arrow("M337,612 H382 V350 H428")
arrow("M337,612 H382 V735 H428", NAVY, 4, "an")
badge(382, 470, "1", G)
badge(382, 672, "2", NAVY)

# key legend
rect(50, 716, 290, 196, 18, "#fff", LINE, 2, 'filter="url(#sh)"')
title(195, 750, "EVERY LIST, SAME KEYS", GD, 19, "middle")
for i, (k, label) in enumerate([("1", "Connect me"), ("2", "Say it again"), ("3", "Next closest"), ("9", "Start over")]):
    y = 782 + i * 36
    badge(86, y, k, GD, 16, 20)
    text(116, y + 7, label, 22, INK, "Mulish", 700)

# ------------------------------------------------------------------ pantry lane
rect(400, 165, 1470, 372, 28, "#fff", SAGE, 2.5, 'filter="url(#sh)"')
rect(428, 148, 380, 46, 23, G, G, 0)
title(618, 181, "PRESS 1  ·  FOOD PANTRY", "#fff", 25, "middle")

# A: enter ZIP
rect(430, 290, 230, 120, 16, PALE, G, 3)
title(545, 324, "ENTER ZIP", G, 23, "middle")
lines(545, 354, ["Caller keys a", "5-digit ZIP"], 21, INK, 25, "middle")
text(545, 398, "31061 · 31062 · 31059", 17, MUTED, "Mulish", 700, "middle")
arrow("M662,350 H698")

# B: reads one pantry
rect(700, 255, 350, 190, 16, "#fff", G, 3.5)
title(875, 292, "READS ONE PANTRY", G, 25, "middle")
lines(875, 326, ["Nearest to the ZIP first,", "then farther out", "Name · distance · address", "Open now, or when it opens", "Phone number"], 20, INK, 27, "middle")
arrow("M1052,350 H1066")

# keys diamond
diamond(1193, 350, 127, 90, PALE, G, 4)
title(1193, 345, "CALLER PRESSES", G, 19, "middle")
text(1193, 383, "1 · 2 · 3 · 9", 30, GD, "Oswald", 700, "middle")

# connect
arrow("M1322,350 H1358")
badge(1340, 318, "1", G, 18, 22)
rect(1360, 250, 470, 200, 16, PALE, G, 3.5)
title(1595, 288, "CONNECTS THE CALL", G, 25, "middle")
add(f'<circle cx="1392" cy="334" r="10" fill="{OPEN}"/>')
text(1414, 341, "Open: rings the pantry now", 21, INK, "Mulish", 700)
add(f'<circle cx="1392" cy="388" r="9" fill="#fff" stroke="{GOLD}" stroke-width="5"/>')
text(1414, 388, "Closed: warns it may be voicemail,", 21, INK, "Mulish", 700)
text(1414, 415, "rings longer so a message can be left", 21, INK, "Mulish", 700)

# loop 2 / 3 and start over
arrow("M1193,262 V222 H875 V253")
text(905, 207, "2  say it again   ·   3  next closest, farther out each time", 21, G, "Mulish", 800)
arrow("M1193,442 V478")
rect(1043, 480, 300, 46, 23, "#fff", G, 2.5, 'stroke-dasharray="7 5"')
text(1193, 511, "9  ·  Start over → main menu", 21, GD, "Mulish", 800, "middle")

# ------------------------------------------------------------------ delivery lane
rect(400, 562, 1470, 345, 28, "#fff", NAVY_LINE, 2.5, 'filter="url(#sh)"')
rect(428, 545, 420, 46, 23, NAVY, NAVY, 0)
title(638, 578, "PRESS 2  ·  HOME DELIVERY", "#fff", 25, "middle")

rect(430, 665, 230, 140, 16, NAVY_PALE, NAVY, 3)
title(545, 699, "SHORT INTRO", NAVY, 23, "middle")
lines(545, 729, ["Mostly for seniors", "and people who", "can’t get out"], 20, INK, 25, "middle")
arrow("M662,735 H698", NAVY, 4, "an")

rect(700, 648, 350, 174, 16, "#fff", NAVY, 3.5)
title(875, 685, "READS ONE PROGRAM", NAVY, 25, "middle")
lines(875, 719, ["Name and who qualifies", "Hours to call", "Phone number", "Five programs, in order"], 20, INK, 27, "middle")
arrow("M1052,735 H1066", NAVY, 4, "an")

diamond(1193, 735, 127, 90, NAVY_PALE, NAVY, 4)
title(1193, 730, "CALLER PRESSES", NAVY, 19, "middle")
text(1193, 768, "1 · 2 · 3 · 9", 30, NAVY, "Oswald", 700, "middle")

arrow("M1322,735 H1358", NAVY, 4, "an")
badge(1340, 703, "1", NAVY, 18, 22)
rect(1360, 640, 470, 190, 16, NAVY_PALE, NAVY, 3.5)
title(1595, 678, "CONNECTS THE CALL", NAVY, 25, "middle")
lines(1384, 716, ["Rings the program’s office,", "wherever there is a phone number.", "2-1-1 and Meals on Wheels are", "read aloud only (dial 211 yourself)."], 21, INK, 27, weight=700)

arrow("M1193,647 V612 H875 V646", NAVY, 4, "an")
text(905, 599, "2  say it again   ·   3  next program", 21, NAVY, "Mulish", 800)
arrow("M1193,827 V853", NAVY, 4, "an")
rect(1043, 855, 300, 44, 22, "#fff", NAVY, 2.5, 'stroke-dasharray="7 5"')
text(1193, 885, "9  ·  Start over → main menu", 21, NAVY, "Mulish", 800, "middle")

# ------------------------------------------------------------------ behind the scenes
rect(50, 934, 1820, 116, 26, GD, GD, 0, 'filter="url(#sh)"')
title(88, 984, "BEHIND", SAGE, 30)
title(88, 1018, "THE SCENES", SAGE, 30)
cards = [("TWILIO", ["A toll-free number", "answers every call"]),
         ("OUR SERVER", ["Checks the call really", "came from Twilio"]),
         ("LIVE HOURS", ["Open or closed is worked", "out at the moment of the call"]),
         ("CLEAR VOICE", ["A neural voice reads it,", "then connects the call"])]
for i, (head, body) in enumerate(cards):
    x = 322 + i * 387
    title(x, 976, head, SAGE, 24)
    lines(x, 1006, body, 20, "#fff", 26, weight=600)
    if i < 3:
        add(f'<path d="M{x + 342},981 l16,12 l-16,12" fill="none" stroke="{SAGE}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')

add("</svg>")
OUT.write_text("\n".join(parts), encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
