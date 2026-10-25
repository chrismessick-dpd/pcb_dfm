# Fabcheck: PCB package DFM

**User guide:** [docs/guide.md](docs/guide.md), with a customer-shareable overview and an FTE section on architecture and use.

A browser tool that opens an Altium fabrication/assembly package (`.zip` or folder) and checks it the
way a fab and an assembler would. All processing happens in the browser tab, so no files are uploaded.

- Design, check catalog and phasing: [docs/design.md](docs/design.md)
- Fab rule defaults, their sources and the 2026-10 audit: [docs/fab-rules.md](docs/fab-rules.md)
- To use it, open `index.html` (or host the folder) and drop a package onto the page.
- For development, run the local server below. It serves the tool, plus a read-only sample folder, so
  `?pkg=` can load a package without drag and drop:

```bash
python tools/serve.py --port 8767 --samples "C:/path/to/packages"
```

Then open `http://127.0.0.1:8767/pcb_dfm/?pkg=/__sample/<package>.zip`. Repeat `?pkg=` to open a
baseline and a candidate together for the Revisions tab. The server serves the whole tools folder,
so Signoff EE is at `/ee_design_review/` and the Signoff hub at `/signoff/` on the same origin. The tools link to each other from
their sidebars and share the light/dark setting (Signoff's `signoff.v1.settings` key).

## Versions

Run records carry a hash of the tool files (`assets/version.js`). After changing `index.html` or
anything in `assets/`, run `python tools/stamp_version.py` (`--check` in CI or pre-commit).

## Look and feel

Fabcheck uses Signoff EE's stylesheet verbatim (`assets/suite.css`) with Fabcheck-only rules in
`assets/styles.css`. It also vendors the Signoff engine's `github.js` and `model.js` (`assets/vendor/`)
to store runs in a project's repo. After Signoff changes them, run `python tools/sync_vendor.py`
(`--check` verifies the copies).

Libraries come from cdnjs, pinned to exact versions: JSZip 3.10.1 and SheetJS 0.18.5. The Gerber,
Excellon, PnP and BOM parsing is written for this tool (`assets/`).
