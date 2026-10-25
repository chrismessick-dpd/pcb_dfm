# Fabcheck: user guide

**Part 1** can be shared with customers. **Part 2** is for Dovetail FTEs.

---

## Part 1: Fabcheck at a glance

Fabcheck checks a PCB fabrication and assembly package the way a board house and an assembler
would, before you send it. Drop in an Altium package (`.zip` or folder), and it reads the
Gerbers, drill files, pick-and-place, BOM, IPC-356 netlist and ODB++. It then reports what's
wrong, and where.

**Your files never leave your computer.** Everything is processed inside the browser tab; nothing
is uploaded.

**What it checks**

| Area | Examples |
| --- | --- |
| Package | Missing or extra layers, units, outline, drill report, layer count vs stackup |
| Assembly | Pick-and-place vs BOM vs copper: designators, DNP, quantities, parts on pads, rotation, pin 1 |
| BOM | Missing part numbers, duplicates, values or footprints that disagree, manufacturer and part-type mismatches |
| Fabrication DFM | Trace width and spacing, annular ring, drill and aspect ratio, hole spacing, copper-to-edge, slivers, mask dams, silkscreen on pads, via-in-pad, BGA pads, outline corners, copper balance |

**Using it**

1. Drop a package on the page. Checks run straight away, with a live log.
2. **Overview** shows the totals for each area. **Findings** lists every issue with its severity.
   **Board** draws the board: click a finding and it zooms to the spot.
3. Pick a **fab profile**: *Prototype*, *Standard* or *Advanced (HDI-lite)*. Each is a set of
   typical industry limits, with their sources documented. Or make your own for a specific fab
   house on the **Fab rules** page: copy a profile, adjust the limits, and note the fab's
   capability document. Changing a limit re-checks the board straight away.
4. **Revisions** compares two packages (what changed in the BOM, placements, copper and drill).
   **Archive** checks the package's integrity.
5. Every run is kept in your browser under **Recent runs**, so you can come back to it.

The **BOM & assembly checks** list explains every non-numeric check: what it looks for, the data it
reads and an example finding.

---

## Part 2: for Dovetail FTEs

### Where things live

| | |
| --- | --- |
| Tool | `pcb_dfm` repo (folder `C:\Dovetail\tools\pcb_dfm`) |
| Design and check catalog | `docs/design.md` |
| Rule defaults and sources (the 2026-10 audit) | `docs/fab-rules.md` |
| Link with Signoff EE | `ee_design_review/docs/fabcheck-link.md` |
| Suite-wide picture | `signoff/docs/guide.md` |

### Architecture

- **Static, client-side app.** Open `index.html` or host the folder. JSZip and SheetJS come from
  cdnjs at pinned versions. Gerber, Excellon, pick-and-place, BOM, IPC-356 and ODB++ parsing are
  written for this tool (`assets/`). The checks are in `assets/checks/`.
- **Rules are data.** The built-in profiles are in `assets/profiles.js`. Custom profiles are kept in
  the browser and shared with the team as `fabcheck/profiles/<id>.json` in the EE data repo,
  merged rule by rule. Each run saves a **full copy of the rules it used**, so editing a profile
  never changes an old run's results.
- **Runs** are kept in the browser's storage (IndexedDB `fabcheck`): the run record, the slimmed
  package and the findings.
- **Send to Signoff EE** writes errors and warnings into a Signoff EE project as issues on the
  Fab & Release checklist, with the run and board locations attached. It also uploads the slimmed
  package and run to that project's repo under `fabcheck/<projectId>/`.
  - Re-sending identical files uploads nothing.
  - Moving a project into a shared repo carries these files along.
  - Signoff's **Open in Fabcheck** links reopen the run zoomed to the spot. They load it from this
    browser if it's there, otherwise from the repo, otherwise they ask for the package and check
    its fingerprint.
- **Shared look.** `assets/suite.css` and `assets/vendor/{model,github}.js` are copied from Signoff
  EE. After Signoff changes them, run `python tools/sync_vendor.py`.

### Development

```bash
python tools/serve.py --port 8767 --samples "C:/path/to/packages"
```

Then open `http://127.0.0.1:8767/pcb_dfm/?pkg=/__sample/<package>.zip`. The sample packages
are served read-only and never copied into the repo; the `.gitignore` keeps `*.zip` and
`samples/` out. After changing the tool, run `python tools/stamp_version.py`.

### Notes

- Fabcheck is public: it shows in the Signoff demos and for contractors as well as FTEs, and is a
  showcase for customers. It never uploads a package, which is its main selling point.
- **Demo mode** (`index.html?demo`): a banner with a Reset button, and "Try a sample board", which
  loads `demo/fabcheck-sample-board.zip`. That package is a synthetic 2-layer board drawn by
  `tools/make_sample.py` with a few planted problems; it is not a client design. In the demo:
  - suite links go to the Signoff demos;
  - Send to Signoff writes into the Signoff EE demo (`signoff.demo.` in localStorage) and never to
    GitHub;
  - runs and profiles use their own storage (`fabcheck-demo` database, `fabcheck.demo.` keys);
  - a Signoff issue link that arrives without `?demo` reopens in the demo when the run belongs to a
    demo project.
- Defaults are typical values, not any fab house's. For a real build, use a custom profile with the
  fab's published capabilities, and record the source in the profile's notes.
