"""Copy the shared Signoff files Fabcheck uses into this repo, unchanged except for a header.

    python tools/sync_vendor.py           # re-copy
    python tools/sync_vendor.py --check   # exit 1 if any copy differs from ee_design_review

- assets/suite.css            Signoff EE's stylesheet (look and feel)
- assets/vendor/model.js      Signoff engine model (GitHubStore needs it)
- assets/vendor/github.js     Signoff engine GitHub storage: putFiles / listTree / readBytes
                              for storing runs in a project's repo (docs/fabcheck-link.md there)
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "ee_design_review"
FILES = [
    ("assets/styles.css", "assets/suite.css"),
    ("assets/model.js", "assets/vendor/model.js"),
    ("assets/github.js", "assets/vendor/github.js"),
]


def header(src):
    return (f"/* Vendored from ee_design_review/{src} (Signoff EE) by tools/sync_vendor.py.\n"
            "   Do not edit here: change it there and re-run the script. */\n")


def main():
    check = "--check" in sys.argv
    stale = []
    for src, dst in FILES:
        want = header(src) + (SRC / src).read_text(encoding="utf-8")
        path = ROOT / dst
        have = path.read_text(encoding="utf-8") if path.exists() else None
        if have == want:
            continue
        if check:
            stale.append(dst)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(want, encoding="utf-8", newline="\n")
            print(f"copied {src} -> {dst}")
    if check:
        if stale:
            print("stale vendored files: " + ", ".join(stale) + " (run python tools/sync_vendor.py)")
            sys.exit(1)
        print("vendored files are current")


if __name__ == "__main__":
    main()
