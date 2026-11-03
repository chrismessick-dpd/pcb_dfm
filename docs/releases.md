# Fab releases: tagged, stored, downloadable packages (plan)

Status (2026-11-03, branch `release-tags`):
- **Phase R1 (local releases) is built.** It was verified on the demo board and on a real pair
  of packages, before and after a fab DFM fix.
- **Phase R2 (stored releases) is built.** It was verified with `tests/fake-github.js`.
- **Phase R3 (Revisions as release history) is built.** It was verified on the real pair and in
  demo mode.
- **Phase R5 (the ideal package) is built.** It was verified on the demo boards and the real pair.
- **Phase R4 (the Signoff link) is built.** It was verified in a test origin with a made-up Signoff
  project. The contract changes for Signoff EE and PL are proposals below.

What fab houses ask for, with sources, is in `docs/fab-package.md`.

## Versions: one path, not two (2026-11-03, after Chris tried R1–R5)

Chris stored a real release, and the Send panel showed two stored runs next to it. That read as
two kinds of stored file that could diverge. So "release" and "Send" are now one thing, a
**version** of the package in a Signoff project. The record format is unchanged.

- **Send creates or updates the version.** The Send panel has a **Version** field, filled with
  this package's version if it has one, else the next name after the project's latest
  (`nextLabel`: v1.1 → v1.2, 3.1 → 3.2, rev B → rev C). Sending stores the run and the version
  (record and fab files) in one commit (`repo.js` `storeRelease` with the open package, so the
  board pictures go too), then writes the issues.
  - Re-sending the same package updates its version: the new run and an optional rename.
  - **Store version only** does the same without the issues, which is how an older package is
    back-filled.
- **Details** under Send covers both the issues to send and, for a new version, the part
  number, revision and files to keep (`filesPickHtml`).
- **A new version starts as Checked.** It can be marked later, from the same menu, as **Sent
  to fab** (today's date unless one is given), **Used for builds** or **Withdrawn**. **Edit**
  changes the name, title, fab house, date sent, reference and notes. "Superseded by" shows
  beside the status instead of replacing it.
- **One list, "Versions of \<project>".** It replaces both "Runs stored with this project" and
  the separate Fab release section and tag form. Each row:
  - **Download** (the fab package, below) and **As sent**;
  - the package's SHA-256;
  - the change summary.

  Runs stored before versions existed show as **Unnamed** rows, with Open. Sending that package
  again, or Store version only, names it. Nothing already in a repo is rewritten.
- **Fabcheck stays a public tool.** Send sits at the bottom of the Overview.
  - Without Signoff projects in the browser, it explains what it's for and offers **Sign in with
    GitHub**.
  - Clicking Send without a token opens a sign-in sheet (`showSignIn`; `repo.js` `signIn` checks
    the token with GitHub's `/user`). The token is stored the way Signoff EE stores it, in this
    tab or remembered, so one sign-in covers both tools.
  - **Sign out** under Send signs out of both.
- **Anyone can export** the open package as the fab package from the Files tab, made in the
  browser and not stored.
- **Wording:** issue comments name the version ("Raised by Fabcheck from version 3.1"), and the
  home page, Revisions and Archive say "version".
- **Verified** with `tests/fake-github.js` (which now answers `/user`) on the real pair:
  - sign-in refuses a bad token, then continues into the send;
  - 3.1 is stored in one commit with its run, 22 files and the pictures;
  - 3.2 is suggested next, supersedes 3.1 and carries the change summary;
  - the sliver issue gets "no longer found";
  - marking 3.1 Sent to fab and editing 3.2 are written to the repo;
  - re-sending 3.2 updates it without a new version;
  - a pre-version run lists as Unnamed;
  - the Files tab export saves the fab package.

  Demo mode keeps versions locally with no sign-in, and the public view without projects shows
  the sign-in offer.

## One fab package, with folders (2026-11-03)

Chris didn't want separate fab and assembly downloads. A version now downloads as one zip shaped
like the Altium manufacturing folders he uses, laid out as `docs/fab-package.md` shows:
`<PN>-<REV>_manufacturing/` with `Fabrication/` (`Gerber/`, `NC Drill/`, `Netlist/`, the FAB
drawing) and `Assembly/` (`BOM/`, `Pick Place/`, the ASSY drawing), plus one README.

- **The record (`layout.v` 2):** `{pn, rev, pre, root, files [{path, to}], readme, zip {name,
  sha256, size}}`. `to` is the full path inside the zip; `releases.js` `role` returns `[folder,
  name]`.
  - Paste layers sit in `Fabrication/Gerber` with the rest, so nothing is duplicated.
  - An ODB++ folder keeps its own tree and names.
- **Versions made with the two-archive layout** (`layout.v` 1, like the first real 3.1) download
  in the new structure too. `fromTwoArchives` maps their names to folders, and the README keeps
  their board lines. There's no recorded hash for that zip, so each file is checked instead.
- **`cleanRelease`** keeps a v2 layout only if every `to` is a safe path inside `root/`.
- **The Files tab export** is one Download of the same package. Its README says "Exported by
  Fabcheck" instead of naming a version.
- **Verified:**
  - the real DFM-fixed package exports as `<PN>-<REV>_manufacturing.zip`, with 22 files in
    Fabrication (Gerber, NC Drill, Netlist) and Assembly (BOM, Pick Place), plus the README;
  - a two-archive record of the same files converts to exactly the same paths;
  - a demo Send gives one Download whose zip matches its recorded SHA-256 twice;
  - a tampered `to` is rejected.

## Why

A board's fab package rarely goes out once. A typical history:

1. The released design's package goes to the fab house as the **candidate**. In the demo story:
   DT-1042 rev B-1, "release candidate".
2. The fab house's own DFM finds something. For example, an inner plane is joined to the rest of the
   pour only by a sliver. Part shortages cause the same kind of churn on the assembly side.
3. The Gerbers are fixed and the package regenerated and re-sent: DT-1042 rev B-2, "DFM updates".
   **This** is what gets built.

Two packages were sent, and both matter. The second is the one to reorder from, and the first
explains why the second exists. Today only the person who made them has them, as zips on their
own disk that are easily lost. The goal:

- **Tag** a package with a release name and a note, such as "rev B-2, DFM updates".
- **Store** what Fabcheck and the fab house need, with the project, not on someone's disk.
- **Compare** a release with the one before it. The comparison should show that only the plane
  changed, and that the sliver finding went away.
- **Download** the package for the fab house from Fabcheck, later, from any computer with access.

## What exists today

- **Runs are kept** in IndexedDB with a slimmed package (`store.js`).
- **Send to Signoff stores the run first.** It goes in the project's private repo, under
  `fabcheck/<projectId>/` (`repo.js`). Sending again updates the same issues (stable `xfc…` ids) and
  notes the ones that are no longer found. The DFM-update case already works on the issue side.
- **Revisions compares only packages open in this tab:** BOM, placements, Gerber geometry and
  drill hits (`revisions.js`).
- **The stored package is not a fab package.** Slimming keeps only what Fabcheck parses by content:
  - it drops the fab and assembly drawings (PDF), nested archives (the ODB++ zip or tgz), most of
    the ODB++ tree, and images and CAD files;
  - a re-run doesn't need them, but the fab house does.

## Concepts

| | What it is | Identity |
| --- | --- | --- |
| **Package** | The files as uploaded | `key` (first 16 hex digits of the upload's sha256) |
| **Run** | One check of a package with given settings | run id; immutable |
| **Release** | A name for a package that was (or will be) sent to a fab house | release id; label and status editable |

A release points at a **package**, with the run that checked it as evidence. It does not point at a
run, because one package can be run several times: another profile, another thickness, a newer
Fabcheck. Re-running keeps the same release. A new package needs a new release.

## The release set: what is stored for a release

There are two sets per package:

- **Fabcheck set:** today's slimmed files. This is what a re-run needs, and it is stored on every
  Send, as now.
- **Release set:** the Fabcheck set plus what the fab house and assembler need. It is stored only
  when a package is tagged.

Anything not in either set stays on the uploader's disk, and the manifest still lists its name,
size and sha256.

Proposed defaults, by classifier type (`classify.js`):

| Type | Fabcheck set | Release set | Notes |
| --- | --- | --- | --- |
| `gerber`, `drill` | yes | yes | Both 274X and X2 if both are present (see the open questions) |
| `pnp`, `bom` | yes | yes | |
| `ipc356` | yes | yes | Netlist for the fab's electrical test |
| `drill-report` (`.DRR`) | yes | yes | |
| `fab-pdf`, `assy-pdf` | no | **yes** | The fab and assembly drawings |
| `pdf` (other) | no | ask | Ticked by default; often schematics, sometimes notes |
| `odb-archive` | no | off; one copy if ticked | A second image format beside the Gerbers. Fabs then ask which one wins (Ucamco, see `fab-package.md`). Tick it when the fab or assembler asks for ODB++ |
| `odb` tree | `comp_+_*` only | off | Copies of the archive |
| `ipc2581` | yes (small) | yes | |
| `text` (`.txt`, `.csv`) | yes | yes | READMEs and fab notes |
| `report` (Altium `.REP`, `.LOG`, `.html`, status reports, `.LDP`) | yes | no | Fabcheck reads variants from these; the fab house doesn't need them |
| `archive` (other nested zips) | no | ask | Unticked by default |
| `other` (images, STEP, DXF, DWG) | no | no | Unticked; can be ticked per file |

- **Per-file override.** The tag dialog lists the release set with sizes and checkboxes, ticked as
  in the table above. Unticking a file is remembered per package. The defaults table lives in one
  object next to `keep()`, so the dialog, the docs and storage can't drift.
- **Size limits.** GitHub's blob API refuses files over 100 MB, and a browser base64-encodes every
  blob in memory.
  - A file over 25 MB gets a warning in the dialog.
  - A file over 90 MB can't be tagged and must be unticked.
  - A large ODB++ archive is the likely case.
- **Every release costs its full size.** Release files go in the package's existing
  `packages/<key>/files/` folder. Checked on a real pair of packages, before and after a fab DFM
  fix, regenerated from Altium a week apart: all 68 files differ byte for byte, unchanged layers
  included. The reasons:
  - each Gerber X2 file carries a new `%TF.SameCoordinates` GUID;
  - reports and ODB++ carry the date and time;
  - the pick-and-place file carries the VCS revision;
  - one new aperture renumbers every D-code after it.

  So git can't share unchanged files between two releases, and each release adds its whole
  release set, a few MB. That's still fine for a repo, so the plan doesn't try to deduplicate.
- **ODB++ often comes three times.** The real package had the ODB++ data as a `.tgz`, a `.zip` and
  an extracted `odb/` tree (about 3.4 MB of copies). The release set keeps exactly one copy.

## The download, and its hash

- **Built from the release set:** the release's files at their original paths, in one zip named
  `<package name>_<label>.zip` (for example `DT-1042_revB-2.zip`). Nothing is added to the zip by
  default. A fab house shouldn't find a Fabcheck file in its package (see the open questions).
- **Deterministic.** Entries are sorted by path, with a fixed date (the release's date) and fixed
  DEFLATE settings in JSZip 3.10.1, so the same release always downloads as the same bytes.
- **Two hashes, stated plainly:**
  - **Download sha256.** It is recorded in the release when it's tagged. Quote this one in a PO or
    an email, and Fabcheck checks it on every download.
  - **Upload sha256** (the package key). It is kept for provenance. It never matches the download,
    because the download is rebuilt from fewer files, and the UI says so beside it.
- **Verified.** Each file's sha256 is checked against the manifest before zipping. A mismatch stops
  the download and names the file.
- **"Which release is this?"** Dropping a zip on the Archive tab looks it up against the project's
  releases, by download sha256 or by upload sha256. That answers "is the file on my desktop the one
  that was built?".

## Release record and storage

A release:

```json
{
  "v": 1,
  "id": "l<time36><rand>",
  "label": "rev B-2",
  "title": "DFM updates",
  "status": "candidate | sent | built | withdrawn",
  "package": { "key": "…", "sha256": "…", "name": "…", "size": 0 },
  "run": "r…",
  "supersedes": "l…",
  "fab": { "house": "", "sentAt": "2026-10-28", "ref": "" },
  "notes": "Fab DFM: L3 plane joined by a sliver near U4; widened the neck.",
  "files": [{ "path": "…", "size": 0, "sha256": "…" }],
  "download": { "name": "DT-1042_revB-2.zip", "sha256": "…", "size": 0 },
  "changes": { "base": "l…", "layers": ["L3"], "bom": 0, "placements": 0, "drill": 0, "findings": { "fixed": 1, "new": 0 } },
  "at": "…", "by": "…", "updatedAt": "…", "updatedBy": "…"
}
```

Field notes:
- `status`:
  - `candidate`: tagged, not sent yet.
  - `sent`: sent to the fab house.
  - `built`: what was built.
  - `withdrawn`: tagged by mistake.
  - **Superseded** is shown, not stored: it means a later release's `supersedes` names this one.
- `changes`: a summary of the compare with `supersedes`, made at tag time, so the history reads
  without re-parsing anything.
- `files` and `download` are fixed at tag time. A different file set is a new release.
- `label`, `title`, `status`, `fab` and `notes` can be edited. A release is never deleted, only
  withdrawn, so review data is never lost.

Storage:
- **Repo:** `fabcheck/<projectId>/releases/<id>.json`, one file per release.
  - Writes are additive, and two people tagging at once can't collide.
  - Signoff's share-move already carries `fabcheck/<projectId>/` across.
  - Files go under `packages/<key>/files/<path>`, beside the run's slimmed package.
  - **Storing** a release also stores its run when this browser has it. It doesn't touch the
    board pictures, because the release may be an older one being back-filled (`storeRelease`).
  - **An edit** (`saveReleaseEdit`):
    - reads the repo's copy first;
    - if that copy was changed since this browser last read it (`updatedAt` later than the local
      `syncedAt`), writes nothing and shows the repo's copy instead;
    - otherwise writes with `putFiles`.

    Two edits within the same second can still race.
  - **Reading** (`pullReleases`) brings the project's records into this browser. A file comes
    from the repo only when it's downloaded (`fetchReleaseFiles`), and each is checked against its
    SHA-256.
  - **Records read from a repo** go through `cleanRelease`, because contractors can write there:
    - ids, hashes and dates must have the expected shape;
    - `changes`, `summary` and the package name are rebuilt from typed fields;
    - file paths must be relative, with forward slashes, no `..` and no drive letter, because they
      become entry names in a zip that goes to a fab house.
  - **Sharing a project keeps its releases.** Signoff EE's `moveFabcheck` (`workspace.js`) copies
    everything under `fabcheck/<projectId>/` as bytes, so `releases/` and the release files move
    with it (checked 2026-11-03).
- **This browser:** IndexedDB stores `releases` and `blobs` (`VER` 1 → 2 in `store.js`).
  - Release files are kept by SHA-256 in `blobs`, so releases that share a file keep it once.
  - `syncedAt` is local only; it's never written to the repo.
  - A release with no project yet stays local until it's stored, like an unsent run.
- **Demo mode:** local only (`Fab.repoRuns` is null). Tag, compare and download all work, so the
  demo can show the whole flow.

## Workflow

### Tag

- **Where.** A **Tag release…** button sits on the Overview beside Send, and on the Revisions tab.
  Recent runs gets the same action, for a package kept from earlier.
- **The dialog:**
  - label, title, status (default *sent*), fab house, date sent, notes;
  - **Supersedes**, which defaults to the project's latest release of the same board;
  - the release-set file list.
- **Saving the tag:**
  - it shows the `changes` summary against the superseded release;
  - the store confirm names the repo, the files and their size, as Send's does today.
- **Store without sending.** Tagging stores the release (and its run) with the project, but doesn't
  write any Signoff issues.
  - That's needed for back-filling an older package.
  - Sending an older package after a newer one would re-raise issues the newer one had fixed.
  - If the release being sent is older than the one last sent, Send warns.

### Send to Signoff, with a release

- The issue `source` gains `release: { id, label, title }`.
- Fabcheck's comments name the release instead of the file name:
  - *"Fabcheck re-run on rev B-2 (DFM updates): no longer found."*
  - *"Raised by Fabcheck from rev B-1 (release candidate): 1 finding."*
- Nothing else changes. Issue ids, the reviewer's status, and the no-longer-found note work as now.

### The demo story end to end

The demo gets a second package for the main board: the rev B-1 candidate, with a sliver planted
in the L3 plane. Today's main board is rev B-2, the fixed one (see R3 under *Phases*).

1. **The candidate.** Open the rev B candidate and run it. Tag it "rev B-1", *release candidate*,
   status *sent*, with the fab house and date. Send to Signoff.
2. **The fab house reports a sliver plane.** Fix it and open the new package. Revisions compares it
   with rev B-1:
   - only L3 changed (+12 / −3 primitives) and the ODB++ archive;
   - BOM, placements and drill are identical;
   - findings: the `sliver` error on L3 is fixed, and nothing is new.
3. **Tag the fix.** Tag it "rev B-2", *DFM updates*, superseding rev B-1, and send to Signoff. The
   sliver issue gets "no longer found".
4. **The board is built.** Mark rev B-2 *built*. Rev B-1 shows *superseded*.
5. **Reorder.** Months later, Revisions › rev B-2 › **Download** gives the same zip, with the same
   sha256 as the one recorded.

## Revisions tab

The tab becomes the board's **release history**, with the compare below it.

1. **The project.** It comes from the run's `sentTo` or the deep link, or from a picker like the
   Send panel's.
2. **History.** One row per release, newest first:
   - label, title and status chip;
   - date, by, and the fab house;
   - findings pills;
   - the `changes` one-liner, for example "L3 changed; BOM, drill, placements same; 1 error fixed";
   - actions: **Open**, **Compare**, **Download** and **Edit**.

   Untagged runs stored with the project fold under a "Runs not tagged" row, with **Tag** on each.
3. **Compare.** The baseline picker lists open packages, the project's releases and its stored runs.
   - A stored baseline loads from IndexedDB, or from the repo through `fetchRun`'s path, and is
     parsed with `classify.build` only, without a re-run.
   - The default baseline is the latest release that isn't this package.
4. **Change scope**, a new block above today's tables. On the real pair it reads:
   - one part's footprint swapped (copper, paste, mask and silk at that part, plus 5 cutouts on the
     bottom copper);
   - 4 clearance lines on one inner plane, which is the DFM fix;
   - everything else identical.

   That pair showed the compare's first bug. Altium names each macro aperture after its D-code
   (`ROUNDEDRECTD55`), so one new aperture made about 200 unchanged pads look changed. Comparing
   apertures by shape fixed it (`revisions.js` `apKey`, 2026-11-03).

   The block itself: In one line it says which of the BOM,
   placements, each Gerber layer, drill and ODB++ changed. Green means "only what you meant", for a
   reviewer to confirm before re-sending. Today's BOM, placements, Gerber and drill tables stay as
   they are.
5. **Findings delta**, new: findings marked fixed, new or unchanged against the baseline's run.
   - Two findings are the same if they share the check, severity and layer and lie within 0.25 mm of
     each other. A finding without a location matches on check and title.
   - Each fixed or new finding jumps to the board, like today's `rev-at` rows.

## Phase R5: Fabcheck writes the ideal package

The release set is today's Altium output, minus what doesn't belong in it. R5 goes further: the
download is laid out the way `docs/fab-package.md` recommends, whatever folder Altium wrote.

**As built (2026-11-03):**
- A release row offers **Fab zip**, **Assembly zip** and **As sent**.
- Names come from `releases.js` `role`:
  - copper `L<n>_Top|Inner|Bottom.gbr`;
  - `Mask_`, `Silk_` and `Paste_` per side;
  - `Outline.gbr` and `Mech<n>.gbr`;
  - `PTH.drl`, `NPTH.drl`, or `Drill.drl` when a file mixes plating;
  - `Drill_PTH.gbr` and `Drill_NPTH.gbr` for Gerber drill;
  - `Drill_Report`, `IPC356.ipc`, `FAB.pdf`, `ASSY.pdf`, `BOM` and `PNP`;
  - `Notes_<name>` for the package's own text files.
- **Every name gets the `<PN>-<REV>_` prefix.** Part number and revision are suggested from the
  package name (`suggestPnRev`) and can be edited on the tag form.
- **Assembly copies fab layers.** The assembly archive gets the outer copper, masks, silk, outline
  and paste, so it stands alone.
- **Duplicate names** get `-2`. The generated README's name is reserved, so a package's own
  README can't overwrite it.
- **Gerber drill files are off by default** when Excellon is present (send drill data once).
- **The record keeps the layout.** `rec.layout` holds each file's archive name, the README texts
  and each archive's SHA-256. A download rebuilds the archive and checks it.
  - `cleanRelease` keeps a stored layout only if its names are safe zip paths and its files are
    the release's own.
- **New info-only Package check `structure`:**
  - Gerber with ODB++ or IPC-2581;
  - Excellon with Gerber drill;
  - a drill file mixing plated and non-plated holes;
  - a local path in the first 4 kB of a text file.
- **Findings on the real package:**
  - ODB++ three times;
  - the round-holes drill file mixes plating;
  - Altium wrote the output file's full local path into the pick-and-place header.
- **The same bytes:** files keep their exact bytes, and the same release always downloads as the
  same zips.
- **Demo boards:** errors and warnings are unchanged (4/13 and 1/5). Info rose by one on each,
  because both demo drill files mix plating.

- **Two archives, each flat:** `<PN>-<REV>_FAB.zip` and `<PN>-<REV>_ASSY.zip`.
  - Files are renamed by function: the classifier already knows each layer's function, side and
    copper order.
  - Each archive holds one image format.
- **A generated `README.txt` in each archive:**
  - the file list with each file's SHA-256;
  - board size, layer count, thickness and the fab profile used;
  - the pick-and-place origin and units;
  - for the assembly archive, the BOM's DNP list.

  This answers open question 7 below: a readme the fab house can read, not a Fabcheck file.
- **Part number and revision** come from the release (two new fields, suggested from the package
  name).
- **The original paths stay in the release record**, so the as-sent layout can still be rebuilt.
- **Hashes:** the download's SHA-256 is still the one to quote. The renamed files are byte for
  byte the originals, apart from the readme.
- **The checks in `fab-package.md`** that Fabcheck doesn't have yet join the Package checks:
  - one board per archive;
  - one image format;
  - a plated and non-plated drill split;
  - a `.gbrjob` present;
  - part number and revision consistent;
  - no local paths in headers.

## Contract changes in other repos (proposals only)

Fabcheck's sessions don't edit these repos. Each change goes to that repo's own session. As of R4
(2026-11-03), Fabcheck already writes the following; the contract doc doesn't describe it yet.

- **`ee_design_review/docs/fabcheck-link.md`.** Add to *Stage 2*'s layout:

  ```
  fabcheck/<projectId>/releases/<releaseId>.json      a fab release (docs/releases.md in pcb_dfm)
  fabcheck/<projectId>/packages/<key>/files/<path>    also holds a release's files
  ```

  - **The record:**
    - `id` (`l…`), `label`, `title`, `status` (`candidate`, `sent`, `built` or `withdrawn`);
    - `package {key, sha256, name, size}`, `run`, `supersedes`;
    - `fab {house, sentAt, ref}`, `notes`;
    - `files [{path, size, sha256}]`;
    - `download {name, sha256, size, date}`;
    - `layout {pn, rev, pre, files [{path, fab, assy}], readme {fab, assy}, fab {name, sha256, size}, assy {…}}`;
    - `changes`;
    - `at`, `by`, `updatedAt`, `updatedBy`.
  - **Readers** must treat it as untrusted. Fabcheck's `cleanRelease` (`repo.js`) is the reference.
  - **Sharing** a project already moves `releases/` with the rest of `fabcheck/<projectId>/`
    (`moveFabcheck`).
  - **Issues:** a Fabcheck issue's `source` gains `release: {id, label, title} | null`, the release
    the sent package was tagged as. Comments and the hint name it ("Raised by Fabcheck from
    release rev B-1 (release candidate)") instead of the file name.
- **Signoff EE.** Optionally show `source.release.label` on Fabcheck issues and beside the run
  link, and say "superseded" when the project has a later release.
- **Signoff EE demo.** The main board's stored run summary (`config.js`, `rdemo1042b`) says
  `info: 36`. Fabcheck now finds 37, because the new `structure` check notes the demo's mixed
  plating. Errors and warnings are unchanged. Updating it is optional; it's display only.
- **Signoff PL:** read `fabcheck/<projectId>/releases/*.json` to show, per board Part, the release
  that was built for each EVT, DVT or PVT build, with a Download link for FTEs. This is the natural
  home for "what did we actually build". It's a later phase, after Phase 3 gates.

## Phases

| Phase | Scope | Proof |
| --- | --- | --- |
| **R1: Local releases** | The release set (defaults and per-file overrides); the `releases` IndexedDB store (VER 2); the tag dialog; deterministic download from this browser; Recent runs shows tags; the findings delta in the summary. **Done.** | Demo: tag, download twice, same sha256. Real pair: the defaults drop the duplicate ODB++ copies, the empty files and the reports. "Since rev 1": 6 layers changed, all at the swapped part except the plane fix; the sliver error fixed; one new spacing warning. Runs and their slimmed packages are unchanged |
| **R2: Stored releases** | `releases/<id>.json` and release files in the repo; edit with the `updatedAt` check; store without send (**Store with** on a release row); the project's releases on the Overview and the home page (**Get its releases**); download from the repo with per-file sha256 checks; a warning on sending a superseded release. **Done.** | `tests/fake-github.js`, run through the UI: storing writes one commit with the release, its run and 19 files, and no board pictures. A status edit is written. An edit after someone else's newer one keeps theirs and says so. A browser with nothing local reads the record, then 17 files on download, and the zip's sha256 matches. A record with `..` in a path or a bad id is ignored. Sending the superseded rev B-1 asks first, and Cancel sends nothing |
| **R3: Revisions history** | The history list, stored and tagged baselines, the change scope and the findings delta. **Done.** Baselines are open packages, releases and runs kept in this browser (`p:`, `l:` and `r:` keys). A release's baseline is parsed from its kept package, or from the release's own files when it was tagged elsewhere, read from the repo if needed. The default baseline is what this package's release supersedes | The real pair: rev 2's default baseline is rev 1. The scope reads "6 layers changed (GBL, GP3, GTL, GTO, GTP, GTS); 1 BOM line changed; 1 placement changed; drill same; 1 finding fixed, 1 new finding", the same with the baseline built from the release's files alone. A fixed or new finding jumps to the board. **Not done:** the demo's rev B-1 candidate zip with a planted sliver (`make_demo_boards.py`), so the demo can tell this story |
| **R5: Ideal package** | Flat fab and assembly archives with function-based names and a generated readme; part number and revision on the release; the new package checks. **Done.** | Real pair: `<PN>-<REV>_FAB.zip` holds 18 files (6 copper layers by order, masks, silk, outline, Mech5, PTH and mixed drill, drill report, IPC-356, FAB.pdf, README; the Gerber drill files are left out). `_ASSY.zip` holds 13 (ASSY.pdf, BOM, PNP, outer copper, masks, silk, paste, outline, README). The structure check finds all four problems there. Both download twice to the same SHA-256. A tampered layout is dropped. **Not checked:** opening the archives in an outside Gerber viewer |
| **R4: Signoff link** | `source.release` and the release name in comments; the "Which release is this?" lookup on the Archive tab; the contract proposals handed to EE's and PL's sessions. **Done.** | Sent the demo main board, tagged rev B-1 (release candidate), to a made-up Signoff project. Its 8 issues carry `source.release`, and the hint and comment read "…from release rev B-1 (release candidate)". The "still found" and "no longer found" comments use the same name. The release's own Fab zip, dropped back in, is recognized as "rev B-1 (release candidate): its Fab zip", on the Overview and the Archive tab. Fabcheck reads that Fab zip with the same DFM and package findings as the original; only pick-and-place and BOM are missing, because they're in the Assembly zip |

## Back-filling a real board

A real board whose candidate went out before Fabcheck stored runs can be back-filled once R2 is
in:
1. Drop the candidate zip, run it, and tag it with its real sent date, status *sent*. Use **Store
   only**, not Send.
2. Drop the DFM-fixed zip, run it, and tag it as superseding the first. Then Send.
3. Mark it *built*.

The order matters. Back-filling with Send would put the candidate's findings back on the issues.

## Open questions for Chris

1. **The release set defaults.** Are the drawings, one ODB++ archive, IPC-356, `.DRR` and text
   files right? Should other PDFs (often schematics) be in by default, and should Altium reports be
   out?
2. **274X and X2.** When a package has both sets, keep both, or only the set that was actually sent?
3. **ODB++.** It's off by default now, because research says two image formats make fabs ask which
   one wins. Does your fab or assembler want it? If so, it can be ticked per release, or made the
   default per fab house.
4. **Size.** Is a 90 MB per-file ceiling (warning at 25 MB) fine, or should big ODB++ archives go to
   GitHub Releases assets instead? That avoids repo growth, but browser uploads there are unproven
   (CORS on `uploads.github.com`), so it would need a probe first.
5. **Labels.** Free text ("rev B-2"), or a scheme Fabcheck can sort and suggest? One scheme:
   board rev plus a sequence number, with the next number filled in.
6. **Immutability.** Files and the download are fixed per release, and label, title and status can
   be edited. Should a *built* release lock its label too?
7. **A note inside the zip.** R1 downloads only the fab files. R5 proposes a generated
   `README.txt`, which fab houses ask for anyway. Is that OK?
8. **Tagging without Signoff.** Should tagging require a Signoff EE project, or can a release live
   only in this browser until there is one? The proposal allows local releases.
