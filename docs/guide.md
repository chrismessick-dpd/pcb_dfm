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

1. Drop a package on the page. Checks run straight away. The **Inspection** panel draws your board's
   layer stack and lights up the layers each check is reading. During the long raster pass you can
   watch each part of each layer glow as it's analyzed. Findings drop onto their layer as red or
   amber pins, and a small drawing shows what the check measures. A bar along the top shows the
   progress and time. When the run is done, the pins stay, each layer shows its count, and selecting
   a layer shows its worst finding on the board. Warnings are triangles and errors are dots, here and
   everywhere else. The full log is folded away under it.
2. **Overview** shows the totals for each area. While the checks run, the layer stack beside them lights what each step looks at; the bar under it marks each step to come. Once they finish, that bar is the steps it ran: press or slide along it, or use the left and right arrow keys, to read one that went by too fast (**← Summary** comes back); with a step shown, **Open board** goes straight to its first error or warning. **Findings** lists every issue with its severity;
   select one to see it on a small preview of the board, and select the preview to zoom into it on
   the **Board**, with its layer turned on. **Board** draws the board (drag to pan; scroll, or pinch on a phone or tablet, to zoom; the up and down arrow keys step through its findings list): click a finding and it zooms to the spot (or click a mark on the board to pick out its finding in the list), fading the layers above it so
   inner-layer problems stay visible. **Realistic** shows the board as it will be built: green mask,
   gold pads and white silkscreen.
   To add your own finding, press the speech-bubble button at the top right of the board, then click
   the spot. Pick **Error**, **Warning** or **Info**, write the note (the first line is its title) and
   press **Post** (or Ctrl+Enter; Esc cancels). Review notes are listed under **Review notes** with the
   checks' findings, show on the board as bubbles on the side they were placed, are kept with the run
   (also through **Run checks again**), and go to Signoff EE as one issue each when you send, Info
   notes included (as Minor). Open a note's detail to delete it.
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
  Fab & Release checklist, with the run and board locations attached. First it stores the slimmed
  package and run in that project's private repo under `fabcheck/<projectId>/`, after a confirm
  that names the repo (Cancel keeps everything in this browser).
  - The panel says which repo the run will be stored in, or why it can't (for example no token in
    this tab: tick "Remember the token" in Signoff EE's Settings, or open Fabcheck from Signoff EE).
    If storing fails, nothing is sent; **Send without storing** sends the issues anyway, and
    **Store in project** under Recent runs stores the run later.
  - **Runs stored with this project** lists every run sent to the project, to reopen earlier
    revisions.
  - **Details**, beside the Send button, lists each issue it would write: its title in Signoff,
    Major or Minor, the check, the checklist section, whether it's new or updates one sent before
    (with the reviewer's Fixed or Waived), and its findings under a fold. Untick an issue to leave
    it out. A left-out issue stays as it is in Signoff and never gets a "no longer found" note. The
    list also names earlier issues that will get that note.
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
  loads `demo/fabcheck-sample-board.zip`: a scrubbed copy of a 4-layer Dovetail board, built by
  `tools/make_sample.py` from the original package (which stays off the repo). The script removes
  everything identifying (bottom silkscreen except the Dovetail mark, drawings, reports with local
  paths, the part number), trims each check to one finding, and plants a few more problems. It
  refuses to write the zip if a local path, the client or the part number is still in any file. In
  the demo:
  - suite links go to the Signoff demos;
  - Send to Signoff writes into the Signoff EE demo (`signoff.demo.` in localStorage) and never to
    GitHub;
  - runs and profiles use their own storage (`fabcheck-demo` database, `fabcheck.demo.` keys);
  - a Signoff issue link that arrives without `?demo` reopens in the demo when the run belongs to a
    demo project.
- Defaults are typical values, not any fab house's. For a real build, use a custom profile with the
  fab's published capabilities, and record the source in the profile's notes.
