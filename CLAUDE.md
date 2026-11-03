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
  Node). CDN libs pinned with SRI hashes: JSZip 3.10.1, SheetJS xlsx 0.20.3 (cdn.sheetjs.com), pako 2.1.0.
  Changing one means a new `integrity` hash in `index.html`; the CSP there lists the allowed hosts. Script order is in
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
- Raster kernels (labeling, distance transforms, gaps, slivers, islands) run in a Blob-URL worker pool
  built from the same functions (`prepareRaster` in `raster.js`); the DFM generator yields
  `{ label, wait }` for the app to await, and `C.runner` (`out.sync`) keeps everything on the main
  thread. Speed changes must leave findings identical: run every check step on the committed code
  (`git archive HEAD` into a scratch folder, served alongside) and on the new code, and diff every
  finding (check, severity, title, detail, layer, location, value, box). See *Speed* in `design.md`.
- `assets/stage.js` draws the Overview's inspection stage, at the top of the page: the layer stack
  lit by the running step, a glowing patch per raster worker job (`prepareRaster(..., watch)`, passed
  as `out.watch`; metadata only, findings identical with it), finding pins per layer, real drill hits,
  a dimensioned detail drawing per DFM step, a weighted progress bar with the run's steps marked
  along it (a step slider once the run is done), and start/finish transitions.
  Live state is `entry.live` (`entry.run` is the saved run record; don't reuse the name). A
  re-render keeps the `#stage` node while `data-key` (entry id + status) is unchanged.
- Showing a finding on the board goes through `jumpPlan` in `app.js` (side, layers to turn on,
  layer to dim above, inner layer → no realistic look). `focusFinding` applies it to the board; the
  inspector's preview (`showPreview`, a second `Viewer` on a copy of the layer list) applies it to
  the copy, and `openFromPreview` zooms the preview's snapshot into the board's framing.
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
build/pins/bom/dfm`). The demo sample shows one finding per check except `sliver`, which has 14 real plane necks (29
non-info; 16 before neck classification by shape, 2026-10-31).

Before every commit: `python tools/stamp_version.py` (writes `assets/version.js`) and
`python tools/sync_vendor.py --check`. Commit and push to `main` when the task says so.

Browser-pane gotchas:
- A hash-only navigation doesn't reload the page; load another URL (e.g. `README.md`) first.
- A stale tab holding an IndexedDB connection blocks a delete, and later opens hang. Close old tabs.
- The pane is often hidden, so long scripts time out: start work with a flag on `window` and poll.
- Clean test data afterwards (localStorage `fabcheck.*` / `signoff.*`, IndexedDB databases).
- While the pane is hidden, CSS animations stay at their first frame (things that fade in look
  missing in screenshots). Check with the pane displayed, or disable the animation for the check.
- To catch a moment of the stage mid-run, poll for its state from a script (e.g. `.fx-job` count,
  `fx-exit` class) every few ms, then screenshot or zoom.

## State (2026-10-31) and open items

Done: kept runs and deep links with Signoff EE (stages 1–2), editable/shared fab profiles, the
2026-10 rules audit and new checks, BOM & assembly checks tab, mil after lengths, collapsible
sidebar, demo mode with the scrubbed Handle sample.

Merged 2026-11-01: the `stage-glow` branch (inspection stage with live raster glow, finding pins,
detail drawings, progress bar and transitions; finding preview; board fly-to; warning triangles)
and the `security` branch (trusted deep-link repos, `cleanFinding`, SRI, SheetJS 0.20.3, CSP).
Findings identical to `961ae01` on the demo (all three profiles) and both Generator packages.

Store-first Send (2026-11-01, pushed to `main` as `3a132d9`; on `release-tags` the stored-runs list,
"Store in project" and every repo read are gone, see below): Send to Signoff confirms (names the private repo
and size; Cancel keeps everything in the browser), stores the run, then writes the issues with
`stored` set; if storing fails nothing is sent unless "Send without storing". The Send panel shows
the target repo or why it can't store (`repoRuns.readiness`/`probe`), and lists the runs stored with
the project (`listRuns`). Recent runs has "Store in project" (`storeKept`). Signoff EE shows "Open in
Fabcheck" to contractors too (Chris, 2026-11-01). Verified with `tests/fake-github.js` (it now answers
the repo-info GET). The two real projects' runs were never stored; Chris chose re-sending new runs
over backfilling.

Board previews (2026-11-01): storing a run also writes `preview/top.webp`, `bottom.webp` and
`index.json` beside the runs (`boardPreviews` in `app.js`, drawn off screen with the viewer's `bare`
flag: realistic look, transparent, no scale bar; written in `repo.js` `store`). Signoff PL shows
them on its tiles. Contract: EE's `docs/fabcheck-link.md`, *Board previews*.

Branch `release-tags` (2026-11-03, pushed, not merged): fab packages and the move of revisions to
Signoff. Read `docs/signoff-revisions.md` first; `docs/releases.md` is the history (superseded).
- **Send stores one commit:** the run record (with `package.zip`: path, SHA-256, size, root, and
  each file's original path and path in the zip), the fab package zip and the board pictures
  (`repo.js` `store`).
- **Fabcheck only writes** to project repos. Signoff reads runs and packages back, and hands a
  run to Fabcheck in the browser (IndexedDB `dovetail-handoff`; `store.js` `takeHandoff`, used by
  `openRunLink`). Team fab profiles (`syncProfiles`) are the one read left.
- **Send asks for GitHub sign-in** on first use (`showSignIn`, `repo.js` `signIn`; same token keys
  as Signoff EE).
- **The fab package** (`releases.js` `packageFor`, `role`, `plan`) is one zip,
  `<PN>-<REV>_manufacturing/` with `Fabrication/` (Gerber, NC Drill, Netlist, FAB drawing) and
  `Assembly/` (BOM, Pick Place, ASSY drawing). Files are named by function, and a README lists
  each file's SHA-256. This was Chris's choice over flat archives.
  - What goes in: `SET` and `defaults`, picked under Send's Details. ODB++ and Gerber drill files
    are off by default.
  - The Files tab exports the same package for anyone.
- **Revisions** compares against open packages and kept runs, with a change scope and the findings
  delta (`revisions.findingsDelta`). Apertures compare by shape (`apKey`), because Altium's D-code
  macro names made about 200 unchanged pads look changed.
- **New info-only Package check `structure`:** two image formats, drill data in two formats, a
  drill file mixing plating, local paths in headers. The demo boards' errors and warnings are
  unchanged; info rose by one each, and EE's demo run record still says info 36.
- **Next:** Signoff's Revisions tab, in `ee_design_review` on its own branch (by that repo's
  session), per `docs/signoff-revisions.md`. Then a live Send with a real token. Merge only when
  Chris says so.

Open:
- Not built yet: acid traps (needs a trace graph), text-height check, microvia/HDI profile, revision
  Gerber diff beyond what `revisions.js` does, ODB++ archive vs folder equality.
- The bottom-side pin-1 rule is unverified (no sample with 3+ bottom parts sharing a footprint).

Demo boards (2026-11-02): `tools/make_demo_boards.py` writes two made-up Smart Thermostat packages,
`demo/thermostat-main-pcba.zip` (DT-1042 rev B, Signoff EE `pdemo7`) and
`demo/thermostat-display-board.zip` (DT-1043 rev A, `pdemo11`), plus `demo/boards.js` (their fixed
run ids `rdemo1042b` / `rdemo1043a`, SHA-256 and settings). Deterministic; `--check` verifies the
committed files. Each board's planted problems are listed in the script's docstring, and the
Standard profile finds exactly those (main: 4 errors, 13 warnings; display: 1 error, 5 warnings).
In demo mode the start page offers both boards, and a deep link naming a demo run id opens and
re-runs its board (`demoRun` in `app.js`), so Signoff EE's demo issues and pictures land here.
If you change the script: rerun it, regenerate EE's demo issues and pictures (`config.js`
`demo.projects[0].fabcheck`, `assets/demo-previews/*.webp`, also copied to PL), bump EE's demo
`VERSION` and regenerate PL's snapshot.

Suite context: the folder above holds a `CLAUDE.md` for the whole suite, covering engine
vendoring, project summaries and the demo suite. The vendored `model.js`/`github.js` were last
synced at ee_design_review `ae10959`. They add `project.summary`, which Fabcheck's writes keep as
is, and `cfg.merge`.
