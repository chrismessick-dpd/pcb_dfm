# Fabcheck (pcb_dfm): notes for Claude

Fabcheck is a browser tool that opens an Altium fab/assembly package (zip or folder) and checks it the
way a fab and an assembler would: package inventory, PnP ↔ BOM ↔ Gerber ↔ ODB++ cross-checks, a BOM
audit, and Gerber/drill DFM against editable fab profiles. It is part of the Dovetail Signoff suite and
is **public**: https://chrismessick-dpd.github.io/pcb_dfm/ (GitHub Pages from `main`, `.nojekyll`).

Read first: `docs/design.md` (architecture, check catalog, every decision), `docs/guide.md` (user
guide, FTE section, demo mode), `docs/fab-rules.md` (every fab-rule default with its source).

## Hard rules

- **Client-side only.** Packages are read in the tab and never uploaded; the only network use is
  Send to Signoff's run storage in a project's private repo (off in demo mode). Keep it that way.
- **No customer data in the repo.** `.gitignore` blocks `*.zip`, `*.tgz` and `samples/`. The one
  exception is `demo/fabcheck-sample-board.zip`, built by `tools/make_sample.py` from the Handle V4
  package, which stays on Chris's machine (path in the local hand-over notes). The script scrubs it
  and refuses to write if a local path or a word from `tools/sample-forbid.txt` (git-ignored: client
  name, part numbers, date) remains. Chris approved publishing that scrubbed board (2026-10-24); don't
  add other client data. This repo is public: client names, part numbers and local paths never go
  in code, docs or commit messages.
- **Don't edit other repos** (`ee_design_review`, `me_design_review`, `signoff`): their own sessions
  own them. Fabcheck vendors from Signoff EE with `tools/sync_vendor.py` (`--check` to verify).
- **Never** put a token in a page or commit. Don't touch Robotrxai / RMix / queue repos. Ask Chris
  before creating GitHub repos.
- American English, metric first. Every length shown is `Fab.fmtLen(mm)` → "0.084 mm (3.3 mil)"
  (`Fab.fmtSize` for pairs); coordinates, areas and µm stay metric only.

## Code layout and conventions

- Static HTML + classic scripts sharing `window.Fab` (works from `file://`; no modules, no build, no
  Node). CDN libs pinned: JSZip 3.10.1, SheetJS xlsx 0.18.5, pako 2.1.0. Script order is in
  `index.html`.
- `assets/app.js` is the UI (views: overview, findings, board, assembly, bom, files, revisions,
  archive, rules). Re-render through `renderAll()`; `redraw(root, key, fill)` keeps scroll position.
- Check modules (`assets/checks/*.js`) are generators: `yield 'step label'`, push findings via
  `add(check, severity, title, detail, extra)`. `C.runner(gen)` drains one; the app runs `.steps`
  for the live console.
- Package, assembly and BOM checks are declared with `C.define(category, source, [...])` next to the
  code; thresholds live in a `T` object and named patterns, and `rules()` reads them, so the
  "BOM & assembly checks" tab can't drift. `C.audit` warns on undeclared findings. Add a declaration
  whenever you add one of these checks.
- DFM limits come from `assets/profiles.js` (`Fab.rules`): 28 rules, built-ins Prototype / Standard /
  Advanced. A new rule needs an entry in `RULES`, a value in all three built-ins, a row in
  `docs/fab-rules.md` with its source (or "rule of thumb"), and its check id in `checks`. Old runs
  fall back to the run's built-in for rules they lack (`rulesOfRun`, `newSince`).
- Storage: IndexedDB `fabcheck` (runs + slimmed packages), `fabcheck.v1.*` and Signoff's
  `signoff.v1.*` in localStorage. Demo mode (`?demo`, `Fab.DEMO`) swaps to `fabcheck-demo`,
  `fabcheck.demo.*` and `signoff.demo.*`, and sets `Fab.repoRuns = null` (no GitHub).
- Signoff link contract: `ee_design_review/docs/fabcheck-link.md` (deep links
  `#/board?run=&project=&repo=&check=&x=&y=&layer=`, `source.run` on issues).

## Running and verifying

```bash
python tools/serve.py --port 8767 --samples "C:/path/to/packages"
```

Serves the tools folder; open `http://127.0.0.1:8767/pcb_dfm/?pkg=/__sample/<path>.zip` (or
`?pkg=demo/fabcheck-sample-board.zip`, `?demo`). The reference packages (Handle V4 and the
Generator) and the samples folder are listed in the local hand-over notes, not here. Verify changes
by running the checks in the browser and comparing per-check counts
(script: load with `Fab.loader.fromUrl`, `Fab.classify.build`, then `Fab.checks.package/assembly/
build/pins/bom/dfm`). The demo sample shows exactly one finding per check (16 non-info).

Before every commit: `python tools/stamp_version.py` (writes `assets/version.js`) and
`python tools/sync_vendor.py --check`. Commit and push to `main` when the task says so.

Browser-pane gotchas:
- A hash-only navigation doesn't reload the page; load another URL (e.g. `README.md`) first.
- A stale tab holding an IndexedDB connection blocks a delete, and later opens hang. Close old tabs.
- The pane is often hidden, so long scripts time out: start work with a flag on `window` and poll.
- Clean test data afterwards (localStorage `fabcheck.*` / `signoff.*`, IndexedDB databases).

## State (2026-10-24) and open items

Done: kept runs and deep links with Signoff EE (stages 1–2), editable/shared fab profiles, the
2026-10 rules audit and new checks, BOM & assembly checks tab, mil after lengths, collapsible
sidebar, demo mode with the scrubbed Handle sample.

Open:
- Not built yet: acid traps (needs a trace graph), text-height check, microvia/HDI profile, revision
  Gerber diff beyond what `revisions.js` does, ODB++ archive vs folder equality.
- The bottom-side pin-1 rule is unverified (no sample with 3+ bottom parts sharing a footprint).
- The suite's demos (Signoff EE, ME, PL) now share one made-up product, a Smart Thermostat. The
  Fabcheck demo board is still the scrubbed sample, so it isn't part of that story yet. A made-up
  thermostat board package would fix that; see `../CLAUDE.md`.

Suite context: the folder above holds a `CLAUDE.md` for the whole suite, covering engine
vendoring, project summaries and the demo suite. The vendored `model.js`/`github.js` were last
synced at ee_design_review `ae10959`. They add `project.summary`, which Fabcheck's writes keep as
is, and `cfg.merge`.
