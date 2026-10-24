"""Re-copy Signoff's stylesheet into assets/suite.css so Fabcheck keeps the same look.

    python tools/sync_suite_css.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "ee_design_review" / "assets" / "styles.css"
DST = ROOT / "assets" / "suite.css"
HEADER = ("/* Vendored from ee_design_review/assets/styles.css (Signoff) so Fabcheck shares its tokens and components.\n"
          "   Do not edit here: re-copy with tools/sync_suite_css.py when Signoff's stylesheet changes. */\n")

DST.write_text(HEADER + SRC.read_text(encoding="utf-8"), encoding="utf-8")
print(f"Copied {SRC} -> {DST}")
