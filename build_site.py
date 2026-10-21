#!/usr/bin/env python3
"""Regenerate site/data.js from pantries.json (the single source of truth). Run after editing the data."""
import json
from pathlib import Path

root = Path(__file__).parent
src = json.loads((root / "pantries.json").read_text())
data, delivery = src["pantries"], src["delivery"]
(root / "site" / "data.js").write_text(
    "window.PANTRIES = " + json.dumps(data, indent=2) + ";\n"
    "window.DELIVERY = " + json.dumps(delivery, indent=2) + ";\n")
print(f"wrote site/data.js ({len(data)} pantries, {len(delivery)} delivery options)")
