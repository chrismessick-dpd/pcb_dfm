# PCB DFM — design

Working name: **Fabcheck**. A browser tool that opens an Altium fabrication/assembly package and
reports what a fab and assembly house would push back on. It is meant to replace the ad-hoc package
reviews we have been doing by hand, and to be good enough to show customers later, in the same way PCB
vendors give away their DFM viewers.

## Goals and constraints

- **Client-side only.** Files are read with `FileReader` / `JSZip` in the page and are never uploaded.
  This is the main selling point if customers use it.
- **Static files, no build step.** The tool is `index.html` plus plain JS/CSS. It can be opened from disk
  (`file://`) or hosted on any static host.
  - Because of `file://`, Chrome and Edge block local ES-module imports and `new Worker('x.js')`.
    Our own code therefore uses classic `<script>` tags that share one `window.Fab` namespace.
    Heavy work runs on the main thread in slice 1. If it needs a worker later, the worker is created
    from a Blob URL.
- **CDN libraries pinned to exact versions** (cdnjs):
  - `jszip@3.10.1` reads zip packages.
  - `xlsx@0.18.5` (SheetJS) reads BOMs in `.xlsx`/`.xls`/`.csv`.
  - Later phases: `pako@2.1.0` for ODB++ `.tgz` and `pdf.js` for previewing the fab drawing.
- **Metric first.** Everything is converted to mm on parse. Mil is shown only as a secondary readout.
- **Style** matches the Signoff design-review tool: system font, `#f5f5f7` canvas, white rounded cards,
  translucent sidebar, Dovetail teal `#004952` accent, and dark mode via `prefers-color-scheme`.

## Architecture

```
index.html
assets/
  styles.css           tokens + layout (Apple-like, light/dark)
  app.js               UI shell: load, tabs, findings list, wiring
  util.js              Fab namespace, text decoding, geometry helpers
  loader.js            zip/folder/file ingestion -> {path, bytes, text()}
  classify.js          file classification + package inventory/missing-item checks
  gerber.js            RS-274X/X2 parser -> Layer {primitives, apertures, attrs, bbox}
  excellon.js          NC drill parser -> {tools, hits, slots}
  assembly.js          pick-and-place + BOM parsers
  odb.js               ODB++ component layers (part names, .no_pop, pin positions)
  parts.js             offline passive part-number decoder + description parser
  ipc356.js            IPC-D-356 netlist parser with unit calibration
  raster.js            raster geometry engine (spacing, slivers, islands, mask dams)
  archive.js           package SHA-256, nested ODB++ archives, copy compare
  revisions.js         baseline vs current diff (BOM, placements, Gerber, drill)
  signoff.js           Send to Signoff EE (writes Signoff's localStorage format)
  render.js            canvas renderer (Path2D per layer, pan/zoom, markers)
  checks/
    package.js         inventory, units/format, coordinate GUIDs, drill report agreement
    assembly.js        PnP <-> BOM <-> Gerber cross-checks, BOM audit
    build.js           variant, ODB++ components vs BOM/PnP, paste per pin
    pins.js            IPC-356 pin-1 orientation and pad center vs placement
    dfm.js             geometric DFM checks
  profiles.js          fab rules catalog and built-in profiles (prototype / standard / advanced)
docs/design.md
tools/serve.py         dev server (serves the tool and an optional sample folder)
```

The data flow is a pipeline of pure functions over one `Package` object:

`ingest → classify → parse (gerber/excellon/pnp/bom) → align → checks → findings[] → UI`.

Every finding has the same shape, so the UI only has to know one format:

```js
{ id, check, category, severity: 'error'|'warn'|'info', title, detail,
  layer?, at?: {x, y}, bbox?: [x0, y0, x1, y1], value?, limit?, refs?: ['R12'] }
```

Clicking a finding with `at` or `bbox` zooms the render there, turns on its layer and drops a marker.

### Gerber parsing: custom, not tracespace

We considered `@tracespace/parser` + `@tracespace/plotter`. We are writing our own parser for these
reasons:
- DFM needs a geometry model we control: primitives in mm, with the aperture function, polarity and
  macro parameters attached. tracespace's plot tree is aimed at SVG output, so we would still need to
  re-derive that geometry.
- Altium only emits a small subset: `FS`, `MO`, `AD` (C/R/O/P), `AM` (primitives 1, 4, 5, 7, 20, 21),
  `G01/02/03`, `G75`, `G36/37`, `LP`, `D01/02/03` and `SR`. It also writes X2 attributes either as
  `%TF…%` or, in 274X files, as `G04 #@! TF…` comments. Covering that is a few hundred lines.
- We avoid a dependency on an alpha-version ESM package.

tracespace stays an option as a second opinion renderer for files from other CAD tools.

Primitive model (all in mm):

| kind     | fields                                   | from                     |
|----------|------------------------------------------|--------------------------|
| `flash`  | x, y, aperture → shape polygons / circle | D03                      |
| `line`   | x1, y1, x2, y2, aperture                 | D01 in G01               |
| `arc`    | x1, y1, x2, y2, cx, cy, cw, aperture     | D01 in G02/G03           |
| `region` | contours (arcs flattened)                | G36/G37                  |

Each primitive also carries `dark` (LP), `fn` (X2 AperFunction) and its source line number.
Negative files (`FilePolarity,Negative`, used for Altium plane layers) are flagged on the layer. The
renderer fills the board profile and then clears the features.

### Excellon

Excellon files come in several flavours, so the parser does not assume one:
- Header: `METRIC|INCH`, `LZ|TZ`, `;FILE_FORMAT=i:d`, tool table `TnnC<dia>`, and Altium's
  `;TYPE=PLATED|NON_PLATED` comment, which marks plating per tool.
- Body: coordinates may carry a decimal point or have zeros suppressed (leading or trailing, per the
  `LZ`/`TZ` flag). Slots come either from `G85` or from rout blocks (`G00 … M15 G01 … M16`).
- The result is cross-checked against the Altium `.DRR` drill report (count per tool).

### Coordinate alignment

Gerber, drill, PnP and IPC-356 data can each use a different origin. For PnP we try a short list of
candidate offsets: zero, the profile's bottom-left corner, and the drill-file origin. We keep the one that
puts the most SMD placements next to copper pads on their stated side. If that offset is not zero, we
report it as a finding.

## Check catalog

Severity reflects what a fab or assembler would do: **error** means it will be rejected or built wrong,
**warn** means a query or yield risk, and **info** is context. The slice column is when a check is built;
"1" is this session.

### A. Package (inventory and consistency)

| Check | Slice |
|---|---|
| Classify every file: layer type, side, copper index, units, format, generator, X2 function | 1 |
| Missing essentials: top/bottom copper, mask, silk, outline, PTH drill, PnP, BOM | 1 |
| Missing recommended items: paste, fab drawing, IPC-356 netlist, drill report, ODB++/IPC-2581 | 1 |
| Two Gerber sets present (274X and X2); pick X2 and report it | 1 |
| `TF.SameCoordinates` GUID differs within a set (files from mixed output runs) | 1 |
| Copper layer count agrees across Gerber, drill report, IPC-356 stackup and ODB matrix | 1 (Gerber vs drill vs IPC-356) |
| Drill file per-tool hit counts match `.DRR` | 1 |
| Units and format declared and consistent; mixed inch/mm noted | 1 |
| Board outline is closed; drill and copper extents fit inside it | 1 |
| Gerber 274X set vs X2 set are geometrically the same (XOR) | 3 |

### B. Assembly cross-check (PnP ↔ BOM ↔ Gerber)

| Check | Slice |
|---|---|
| Each placed designator is in the BOM, and each BOM designator is placed | 1 |
| BOM line quantity equals its designator count | 1 |
| DNP: in PnP but not BOM (or flagged DNP/Not Fitted) is reported as DNP, not as an error | 1 |
| PnP comment vs BOM Name/MPN, and footprint consistent per BOM line | 1 |
| Placement inside the board outline | 1 |
| SMD pads (copper/paste flashes) near the placement on its stated side, and not only on the other side | 1 |
| Rotation sanity for 2-terminal parts: pad axis vs rotation, compared within the footprint's population | 1 |
| Pin 1 / polarity: IPC-356 pin 1 direction (in the footprint frame, from the PnP rotation) consistent across every part with the same footprint; outliers, typically 180°, flagged | 2 (shipped) |
| Pin 1 vs silkscreen polarity marker | 3 |
| Placement center vs IPC-356 pad center (pad bounding box); connectors listed separately | 2 (shipped) |

### B2. Build consistency (variant, ODB++ components, stencil)

These checks were taken from a manual release audit done earlier on the same kind of packages. That
audit found real problems which only show up when the BOM, the PnP, the ODB++ component data and the
paste layer are read together. Examples: outputs generated without the build variant, which left
paste on unfitted Tag-Connect pads, and BOM part-number substitutions that did not match the board
data.

| Check | Slice |
|---|---|
| Variant named in each status report and in the PnP header; mixed variants, or "no variant" while the BOM leaves parts off | 1 |
| ODB++ `comp_+_top/bot`: `.no_pop` agrees with the BOM; placed in ODB++ but not on the BOM; on the BOM but missing from ODB++ | 1 |
| ODB++ part name vs BOM MPN (substitutions), ignoring generic library names | 1 |
| PnP vs ODB++ position and side (side error; centroid-vs-origin offsets listed as info) | 1 |
| Paste per pin (from ODB++ toeprints): fitted SMD pins have paste (windowed thermal pads recognized); unfitted parts have none; paste not on any pin | 1 |
| ODB++ `.tgz`/`.zip` archives match the extracted `odb/` tree; package SHA-256; compare with another copy | 1 |
| Revision compare: two packages, or the package BOM vs a previously used BOM. Lists added/removed designators, changed MPN/footprint/description, and Gerber geometry diffs per layer | 1 (first cut) |

### C. BOM audit (offline)

| Check | Slice |
|---|---|
| Missing MPN or manufacturer | 1 |
| Duplicate designators across lines | 1 |
| Same MPN on several lines with different values or footprints | 1 |
| Name/Comment looks like an MPN but differs from MPN 1 | 1 |
| Lifecycle / revision status: Obsolete, EOL, NRND, Last Time Buy, Deleted | 1 |
| Single-source summary: no Manufacturer 2 column, or it is empty | 1 |
| Size code mismatch: 0402/0603/0805… in footprint vs description/MPN | 1 |
| Part number decoded offline vs description: value, voltage, dielectric, tolerance (Cal-Chip, Yageo, Murata, Samsung, KEMET, AVX, TDK, Vishay, Panasonic, Stackpole passives) | 1 |
| Manufacturer column vs part-number prefix (e.g. a KEMET number listed as Yageo) | 1 |
| Value column vs part type (pF on a diode, kΩ on an LED) | 1 |
| BOM has no Manufacturer / MPN column | 1 |
| Missing description parameters for alternate sourcing (dielectric, tolerance, current rating) | 2 |
| "No substitution without approval" candidates (soft-termination, high-voltage, automotive, crystals) | 2 |
| Online lifecycle/stock (Octopart/DigiKey). Opt-in only, because it sends MPNs off the machine | 4 |

### D. Fabrication DFM

| Check | Method | Slice |
|---|---|---|
| Minimum trace width (Conductor apertures / D01 draws) | vector | 1 |
| Minimum drill, maximum drill, aspect ratio (thickness ÷ drill) | vector | 1 |
| Minimum slot width, plated and non-plated | vector | 1 |
| Hole to hole (vias and other holes), duplicate hits, hole to board edge, castellated holes | vector | audit 2026-10 |
| Annular ring on outer layers (PTH and via) | vector: flash at hit | 1 |
| Starved thermals (spoke width, spoke count) from relief macros | vector | 1 |
| Copper to board edge, positive layers | vector: primitive ↔ profile polyline | 1 |
| Copper to board edge, layers with clear-polarity cut-outs or negative planes | sampled: polarity-aware copper probe along outline normals (0.05 mm × 0.02 mm) | 1 |
| NPTH to copper (pads that fit inside the hole are noted, not flagged) | vector | 1 |
| Solder mask expansion per pad (mask flash vs copper flash), tented vias, pads with no opening | vector | 1 |
| Solder mask dam between *flashed* openings | vector shape distance | 1 |
| Silkscreen line width minimum | vector | 1 |
| Silkscreen over exposed pads (flash and region openings), and closer than the silk-to-pad clearance | vector | 1 |
| Sharp inside corners of the outline and cutouts (router radius) | vector | audit 2026-10 |
| BGA pad size (X2 BGAPad) | vector | audit 2026-10 |
| Solder mask dam involving region openings | raster gap between openings | 2 (shipped) |
| Copper-to-copper spacing (separate copper areas) | raster feature transform, sub-pixel measurement | 2 (shipped) |
| Copper necks, wedges and sub-pixel hairlines in pours, pads and planes | raster ridge analysis | 2 (shipped) |
| Acid traps (acute internal angle < 90° at copper junctions) | vector on track graph | 2 |
| Via in pad (via hit inside a pasted SMD/BGA pad; checked against the profile's fill/cap setting) | vector | audit 2026-10 |
| Isolated / unconnected copper (islands without drill or pad) | raster connected components | 2 (shipped) |
| Copper balance per layer and symmetry across the stack | raster area | audit 2026-10 |
| Minimum silk text height | vector (stroke clustering) | 3 |
| Drill to copper on inner layers (other nets) | raster | 3 |
| Panelization / fiducials / tooling holes | vector | 3 |

#### Raster geometry engine (`assets/raster.js`)

Spacing-type checks need geometry on the union of shapes, so they run on a raster:
- **Painting.** Each layer is painted with the same canvas painter as the board view
  (`Fab.render.paintLayer`), so clear polarity, negative planes and macro apertures match what the
  user sees. Tiles are 2048 px, at 25 µm/px (or minimum space ÷ 5 if that is finer), with a margin
  wider than the limit, so a gap is measured in only one tile.
- **Spacing.** Label copper with 8-connected components, then run an exact Euclidean feature
  transform (Felzenszwalb–Huttenlocher, with argmin), which gives each background pixel its nearest
  copper pixel. Neighboring background pixels whose nearest pixels belong to different components lie
  on the medial line of a gap.
  - The gap is measured **sub-pixel**: integrate the uncovered fraction (1 − alpha) along the line
    between the two copper points.
  - Calibrated on synthetic Gerbers it is within about ±3 µm at 25 µm/px. Findings within 5 µm of
    the limit count as passing.
- **Hairlines.** Copper thinner than a pixel (for example, where an edge pull-back and a via clearance
  almost meet on a plane) splits one area in two on the raster. The coverage profile across the
  "gap" gives it away: it never drops to background, or it shows a bump. These are reported as
  hairline slivers, not spacing.
- **Slivers.** Ridge pixels of the inside distance transform, with background on both sides of the
  ridge, narrower than the minimum trace.
  - **Necks:** narrowest point wider than 2 px. Reported one by one.
  - **Wedges:** copper tapering to a point. Summarized per layer.
  - Narrow *drawn traces* are left to the exact vector check.
- **Isolated copper.** A whole-board raster at ≥ 25 µm/px. Components with no plated hole, no flashed
  pad and no pad region are islands; those over 0.05 mm² are reported.
- **Mask dams.** The spacing method on the mask layer (openings as features). Dams between two flashed
  openings stay with the exact vector check.

Cost is about 0.4 s per copper layer on a 43 × 67 mm board, and about 2 s per layer on a
100 × 100 mm board, on the main thread with the console updating per layer. A Blob-URL Web Worker is
the next step if boards get bigger.

### Fab rules and capability profiles (`assets/profiles.js`, Fab rules page)

**The rules.** 28 rules in six groups:

| Group | Rules |
|---|---|
| Copper | trace, space, copper to edge, smallest isolated copper reported, BGA pad |
| Drill & vias | minimum drill, aspect ratio, PTH ring, via ring, largest via drill, plated slot, non-plated slot, via-to-via and hole-to-hole spacing, hole to edge, castellated hole, via in pad allowed, NPTH to copper |
| Solder mask | expansion, dam |
| Silkscreen | line, silk to pad, text height (kept, not checked yet) |
| Thermals | spoke width, spoke count |
| Board | inside-corner radius, copper balance, default thickness |

Each rule has a plain-English name, a unit (mm first, with mil alongside), a one-line description,
the checks that use it, and a plausible range.

**Built-in profiles.** These are read-only industry defaults: typical values, not any vendor's
numbers. Every value, its source and the date it was checked are in [fab-rules.md](fab-rules.md)
(audit of 2026-10-24); values no source states are marked there as rules of thumb.

There is no full microvia HDI profile. Fabcheck has no microvia checks yet, so its limits would
mislead.

**Custom profiles.** "Duplicate and edit" works from any profile.
- A custom profile keeps a base built-in and per-rule overrides, each stamped `{v, at, by}` like
  Signoff's records. It also has a name and a source/notes field (fab house, capability doc or URL,
  date). Fabcheck never supplies vendor numbers.
- Edited rules show the base value with a Reset button; "Reset all" resets the whole profile.
- Profiles can be renamed, deleted, and exported or imported as JSON.
- **Validation:** a value must be positive (mask expansion may be zero) and a count a whole number.
  Fabcheck warns when a value is outside the plausible range, when space is below trace, when the via
  ring exceeds the PTH ring, or when the largest via drill is below the minimum drill.
- **Re-checking:** changing the active profile, or editing one of its rules, re-runs the checks on the
  open package.
- **Memory:** the last profile used is remembered per package name and per Signoff project, and picked
  for the next run.

**BOM & assembly checks** (second tab of the Fab rules page) list the package, assembly and BOM
checks read-only: they are logic, not numbers.
- Each check module declares its checks with `C.define(category, source, [...])` next to the code
  that raises them: name, what it looks for, the severities and when each is raised, the package
  data it uses, an example finding, and `rules()`.
- `rules()` builds its text from the same constants the code uses (thresholds in a `T` object,
  named patterns such as `C.PAD_ONLY`, the lifecycle patterns and `Fab.parts.PREFIX_MFR`), so the list
  can't drift from the code.
- `C.audit` warns in the console when a finding's check or severity isn't declared.
- A finding's check name links to its entry, and an entry links back to that check's findings in the
  open package.

**Team sharing** uses `fabcheck/profiles/<id>.json` in the FTE data repo, which is found as in
`repo.js`, through the vendored `listTree` / `blobBytes` / `putFiles`.
- On open and after edits, Fabcheck pulls the team's profiles, merges them per rule (the newer
  `at` wins, ties broken by `by`), and pushes what is newer locally.
- Files are written as key-sorted JSON, so an unchanged profile never commits.
- With no token or no write access, profiles stay in the browser and the page says so.

**Reproducibility.** `run.settings` carries `profile`, `profileName` and `rules`, a full copy of every
value used (contract: docs/fabcheck-link.md).
- Reopening or reproducing a run pins those rules, never the profile as it is now.
- The page says "Profile edited since this run" when they differ, or that the profile isn't on this
  computer.
- Runs without `rules` fall back to the built-in profile they name.
- Rules added after a run was made fall back to the built-in profile the run named (or Standard), and the
  console lists them: their checks did not exist when the run was made.
- The Signoff issue text names the profile.

## UI

Fabcheck shares Signoff's design system. `assets/suite.css` is Signoff's stylesheet copied verbatim
(`tools/sync_suite_css.py`), and `assets/styles.css` adds only Fabcheck's own parts. Each tool's
sidebar links to the other under "Dovetail tools", and the two share the light/dark setting.

- **Sidebar.** Open packages, listed like Signoff's projects, with error/warning badges and a spinner
  while checks run. Several packages can be open at once, which is what the Revisions and Archive
  tabs compare.
- **Overview.** Stats, one card per check category, the fab profile and thickness controls, and a
  **live run log**. The package build and every check module are generators that yield a label
  before each step. The pipeline runs one step, prints its result (errors and warnings, plus the first
  few hits) with timings, and repaints before the next.
- **Findings.** Signoff-style sections with severity and category filters. Clicking a finding opens the
  inspector, and "Show on board" zooms to it.
- **Board.** Layer list, the canvas (pan/zoom, top/bottom, placements), and a findings rail. This is
  where the interactive DFM work (spacing engine, measure tools) lands next.
- **Assembly / BOM / Files.** Tables, including ODB++ placement status.
- **Revisions.** Compare against a baseline package (or a lone BOM): BOM designators
  added/removed/changed (grouped by identical change), placements moved/rotated/re-footprinted,
  Gerber geometry per layer (primitive signatures rounded to 1 µm, so re-ordered files compare equal),
  and drill hits.
- **Archive.** SHA-256 of the package archive (WebCrypto, with a JS fallback for `file://`), nested
  ODB++ `.zip`/`.tgz` vs the extracted `odb/` tree, and a byte-for-byte comparison with another copy.

Routing is `#/<view>`, so links and the back button work.

### Send to Signoff EE (`assets/signoff.js`)

Fabcheck writes errors and warnings into a board's Signoff EE review. It writes into Signoff's working
copy in `localStorage` (`signoff.v1.projects`, `signoff.v1.dirty`), in Signoff's own format, so
Signoff's normal Sync pushes them. Both tools must be served from the same origin, which is the case
when both are served from the tools folder.

- **One issue per check and severity.** Each becomes a project custom check on the Fabrication &
  Release checklist, with every location in its hint. It is mapped to a section: Fab Package & Gerber
  Files, Drill/Vias & Plating, Solder Mask & Silkscreen, Final DRC & DFM, or Release & Version Control.
  Errors become Major, warnings Minor.
- **Stable ids** per project and check (`xfc…`). Sending again updates the same issue (the reviewer's
  status and resolution are kept) and adds a comment with the new count. Issues that a later run no
  longer finds get one "no longer found" comment.
- **Records are stamped** (`updatedAt`/`updatedBy` = Signoff's user name) and the project is marked
  dirty. Signoff is set to open the project's Findings page next.
- **Open Signoff tabs:** Signoff EE merges `signoff.v1.projects` and `dirty` written by another tab
  (storage event, `mergeProjects`), and follows `signoff.v1.ui` view requests. An open Signoff tab
  picks up sent issues without a reload.

### Kept runs and links with Signoff EE (`assets/store.js`)

The contract shared with Signoff EE is `ee_design_review/docs/fabcheck-link.md`. Fabcheck follows it:

- **Kept runs.** Every finished run is saved in IndexedDB (database `fabcheck`), and the home page
  lists Recent runs. Each run has:
  - a run record (id, time, by, Fabcheck version from `assets/version.js`, package key/sha256/name/size,
    settings, summary, `stored`);
  - compact findings;
  - the slimmed package, kept once per package key.
- **Slimming.** Fabcheck keeps every file it parses by content. Files whose type comes only from their
  name or path are listed in the manifest only: PDFs, nested archives, ODB++ files other than
  `comp_+_top/bot/components`, and images or CAD files. A re-run restores them as empty placeholders, so
  classification and findings are identical.
  - Verified on two sample packages: sample A gives 81 = 81 findings, and sample B 310 = 310.
  - Sample A keeps 25 of 80 files: 0.91 MB of a 1.71 MB zip.
  - Sample B keeps 30 of 68 files: 5.26 MB of a 9.05 MB zip.
- **Deep links.** `#/board?run=…&project=…&repo=…&check=…&x=…&y=…&layer=…` resolves the run in order:
  1. IndexedDB, which opens the stored findings without re-running and re-parses only to place parts;
  2. the project's repo (stage 2);
  3. otherwise the run record on the Signoff issue (`source.run` in `signoff.v1.projects`). Fabcheck
     then asks for that package by name and sha256.

  A dropped package is fingerprint-checked and re-run with the run's settings. A match keeps the
  original run id and notes whether the findings differ, and whether the Fabcheck version changed. A
  mismatch is saved as a new run.
- **Opening the link.** The Board view zooms to x, y, turns on the layer, selects the nearest finding of
  that check, and marks the check's findings ("Linked check").
- **Windows.** Fabcheck names its window `dovetail-fabcheck`. "Back to Signoff EE" writes
  `signoff.v1.ui` and opens `dovetail-signoff-ee`.
- **Send to Signoff.** It puts `source.run` and up to 50 `source.locations` on each issue.

**Stage 2: storing runs in the project's repo (`assets/repo.js`).** After Send to Signoff, the run is
also stored in the project's home repository, found the way Signoff EE finds it: the shared repo from
`signoff.v1.roster`, else `signoff.v1.homes`, else `settings.owner/dataRepo` under `dataPath`. Layout:

```
fabcheck/<projectId>/packages/<key>/manifest.json
fabcheck/<projectId>/packages/<key>/files/<path inside the package>
fabcheck/<projectId>/runs/<runId>.json
```

- **Writing** uses the Signoff engine's `GitHubStore.putFiles`. `assets/vendor/github.js` and
  `model.js` are vendored by `tools/sync_vendor.py`, with `--check`; that script also copies `suite.css`.
  - Files already in the repo are skipped.
  - The console shows progress and the commit link.
  - Once stored, `stored: {repo, dir}` is set on the kept run and on every Signoff issue that carries it.
    Those issues are stamped and marked dirty, so Signoff's Sync shares the location.
- **When the run can't be stored** (no token, no write access, or a page opened from disk without
  WebCrypto), it stays in this browser and the console says why. The issues are always sent.
- **Deep links** with `repo` and `project` read the run and its package from the repo when this
  browser doesn't have them, then cache both in IndexedDB.
- **Measured** with the fake GitHub in `tests/fake-github.js`:

  | | Sample A | Sample B |
  |---|---|---|
  | First upload | 27 files, 0.92 MB | 32 files, 5.28 MB |
  | Stored by git (zlib estimate) | ≈0.28 MB | ≈1.57 MB |
  | Same package again | 0 bytes, no commit | 0 bytes, no commit |
  | New run of a stored package | its run file only (31 KB for sample A) | its run file only |

## Phasing

1. **Slice 1 (this session).** Load (zip, files, dev `?pkg=` URL), classify, parse Gerber, Excellon,
   PnP and BOM, render, PnP/BOM/Gerber cross-check, BOM audit, and the vector DFM checks marked 1 above.
2. **Slice 2 (in progress).** Shipped:
   - the raster engine (spacing, slivers, hairlines, isolated copper, region mask dams), with board
     overlay rings;
   - the IPC-356 pin-1 and pad-center checks;
   - Send to Signoff EE (below).

   Still to come: editable profiles, findings export (CSV/JSON), and a Web Worker for big boards.
3. **Slice 3.** ODB++ (`.tgz`/folder) and IPC-2581 ingest as alternative sources, plus a 274X vs X2 XOR
   diff, panel checks, silk text height, and an embedded fab-drawing PDF preview with notes extraction.
4. **Slice 4.** Optional online part data (opt-in, clearly labeled as leaving the machine), a hosted
   demo build, and a branded report PDF.

## Test data

Slice 1 was checked against five real Altium packages. Three of them had already been audited by
hand: an early package, a release candidate, and a final release, each from a different revision.
Fabcheck reproduced that audit's verdicts. Two of the packages are described in more detail:
- One has 274X and X2 sets, split round and slot drill files, an xlsx BOM, ODB++ and IPC-356, with
  4 layers and negative planes.
- The other is 274X only, 6 layers, with a csv BOM, and inner pours that use clear-polarity cut-outs.

Both are client data. They are **not** copied into this folder, and they are not named in anything
that ships. `tools/serve.py` serves a sample directory read-only, so the page can be pointed at it
with `?pkg=`.

Ground truth used:
- `.DRR` per-tool hole counts against the Excellon parse.
- `TF.SameCoordinates` agreement within a set.
- Visual alignment of drills, outline and placements.
- Individual findings cross-checked against the 274X set and the ODB++ `features`.

**Not yet verified:** opening `index.html` straight from disk (`file://`). The code avoids the known
blockers (classic scripts only, no ES modules, no workers).
