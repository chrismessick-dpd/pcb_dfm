# Revisions move to Signoff (design)

Status (2026-11-03): **design agreed with Chris; Fabcheck's side is built** on the `release-tags`
branch. It supersedes the versions UI in `docs/releases.md`. The Signoff side is not built yet; it
goes in `ee_design_review` on a branch of its own, by that repo's session. Nothing goes to `main`
until Chris says so.

**Fabcheck's side, as built:**
- **Send stores one commit** with exactly the run record (now with `package.zip`), the fab package
  zip and the board pictures (`repo.js` `store`; `releases.js` `packageFor`). It writes no loose
  files and no `releases/` records.
- **Removed:** the versions UI, the home page's Versions, version records in the browser,
  `source.release`, and all repo reads for runs (`fetchRun`, `listRuns`, the trusted-repo list).
- **The hand-off** (`store.js` `takeHandoff`, `purgeHandoff`; `openRunLink`) opens a run Signoff
  left in IndexedDB `dovetail-handoff`. The entry is taken when read, so a failed open needs
  another click in Signoff.
- **Revisions** compares against open packages and runs kept in this browser.
- **The Archive tab** says whether this package was checked before in this browser.
- **Verified** with `tests/fake-github.js` on the real DFM-fixed package:
  - sign-in, then one commit of five files: the zip (its SHA-256 matches `package.zip`), the run
    and three pictures;
  - the issues carry the run with its zip;
  - a hand-off in a browser with no token and no kept run opens the run on the Board, zoomed to
    the linked check, with the stored findings and no request to GitHub.

  In demo mode, Send writes issues only, and the Files tab export saves the structured zip.

## Why

Chris tried tagging and storing releases in Fabcheck and found it the wrong home:
- Signoff already is the board's review: one project, one private repo, records that sync and
  merge between people, and a roadmap item for review rounds.
- Fabcheck is a general, public tool, and should touch the private repos as little as possible.

## Decisions

1. **Revisions live in Signoff.** They are tags on Fabcheck runs stored with the board: "3.1 ·
   sent for quote", "3.2 · DFM updates, used for builds". Review rounds (a checklist snapshot,
   with open issues carried forward) come later. The records are shaped so a round can be added
   on top.
2. **A new tab** in Signoff, after Findings. The Overview shows the latest revision.
3. **In the shared engine.** EE is the first tool to list runs (from Fabcheck). ME and FW get the
   same revision records later, with their own sources: Partcheck packages and firmware builds.
4. **Signoff downloads directly.** Fabcheck writes to the project's repo once, at Send, and
   Signoff never sends anyone back to Fabcheck to get a package.

## What Fabcheck does

Fabcheck checks a package and sends the issues. On Send it stores, in one commit:

```
fabcheck/<projectId>/runs/<runId>.json           run record + findings + "package" (below)
fabcheck/<projectId>/packages/<key>/<root>.zip   the fab package, as the Files-tab export builds it
fabcheck/<projectId>/preview/…                   board pictures, as now
```

- **One zip per package.** The zip is the structured fab package:
  - `<PN>-<REV>_manufacturing/`, with `Fabrication/` (Gerber, NC Drill, Netlist, FAB drawing)
    and `Assembly/` (BOM, Pick Place, ASSY drawing);
  - one README listing each file's SHA-256 (`docs/fab-package.md`).

  Part number, revision, and the files to keep are set under Send's Details, as now.
- **The run record gains `package.zip`:** `{ "path", "name", "sha256", "size", "root", "files":
  [{ "path": original, "to": in the zip, "sha256", "size" }] }`. Signoff needs nothing else to
  list a run's contents or to check a download.
- **No more loose files** for new runs. Today's per-file storage (`packages/<key>/files/…`) stops,
  and runs already stored keep theirs. The repo cost is about the same: git compresses the loose
  files, and the zip is compressed already.
- **Fabcheck drops:**
  - the Version field, the Versions list, statuses, and Edit;
  - the home page's Versions, `releases/<id>.json`, and `source.release` on issues.
- **Fabcheck keeps:**
  - Send's file picks and part number and revision, which feed the zip;
  - the Files-tab export (anyone, no repo);
  - the structure checks, Revisions compare and findings delta, and the aperture fix;
  - "Which package is this?", against runs kept in the browser.
- **Reopening a stored run from Signoff's "Open in Fabcheck"** is a hand-off in the browser:
  Signoff reads, and Fabcheck doesn't (see *Chris's answers*).

## What Signoff does (engine; EE first)

### The Revisions tab

- **The list:** every Fabcheck run stored with the project, read from `fabcheck/<id>/runs/*.json`
  (newest first; one row per package, older runs of the same package folded under it).
- **A row shows:**
  - date, who, package name, findings counts;
  - its revision tag, if it has one.
- **Expanding a row shows:**
  - the run's files grouped as in the zip (from `package.zip.files`), with sizes;
  - the issues it raised or updated (Fabcheck issues whose `source.run.id` is this run);
  - Open in Fabcheck;
  - Download.
- **Download** reads `package.zip.path` with the engine's `GitHubStore` (`readBytes`), checks its
  SHA-256 against the record, and saves it. Runs stored before this change have no zip and offer
  Open in Fabcheck only.
- **Tag as revision** on a row: label (suggested next: 3.1 → 3.2), title, status, fab house, date
  sent, order ref, notes.
  - Status is **Sent to fab**, **Used for builds** or **Withdrawn**. An untagged run is just a
    run.
  - "Superseded by" is derived from order, and shows beside the status.
- **The Overview** shows the latest revision and its status beside the progress ring and board
  picture, for example "3.2 · used for builds".

### The record

A new collection in the project document, merged like every other record (`updatedAt`,
`updatedBy`, tombstones), so two people tagging at once don't clash:

```json
"revisions": {
  "v…": { "id": "v…", "label": "3.2", "title": "DFM updates", "status": "built",
          "source": { "tool": "fabcheck", "run": "r…", "package": { "key": "…", "sha256": "…", "name": "…" },
                      "zip": { "path": "…", "sha256": "…", "size": 0 } },
          "fab": { "house": "", "sentAt": "2026-10-29", "ref": "" }, "notes": "",
          "createdAt": "…", "updatedAt": "…", "updatedBy": "…", "deleted": false }
}
```

- **`source`** is generic (`tool` plus that tool's fields), so ME and FW can tag their own things
  later.
- **A review round** later adds `round: { checklist snapshot, carried issues }`. The tag fields
  don't change.
- **Untrusted.** Enum fields go through `model.oneOf`, text is escaped, and paths are checked,
  like other review data (EE's *Security*).
- **The project summary** gains `revisions: [{ label, status, sentAt }]` (deterministic, no "now"),
  so Signoff PL can show what was built for each EVT, DVT, or PVT build later.

### Issues

- Fabcheck no longer knows a run's tag when it sends. Comments name the package, as before R4.
- **Signoff shows the tag beside "From Fabcheck"** on an issue, when the run it came from is a
  revision: "from 3.2 · DFM updates".

### Migration (additive)

- Chris's real project has a `releases/<id>.json` record (3.1) written by the branch.
- **Import, never move.** On first read, the Revisions tab imports each such record as a revision
  of the run it names: label, title, status (`sent` / `built` / `withdrawn`, with `checked` and
  `candidate` becoming no tag), and fab fields. The files stay where they are.
- **Old releases have no zip.** A revision imported from one offers Open in Fabcheck until its
  package is sent again.

## Order of work

1. **Fabcheck (`release-tags`):**
   - Send uploads the zip and `package.zip`.
   - Remove the versions UI and the `releases/` writes. Keep export, picks, and compare.
   - Tests with `tests/fake-github.js`; demo unchanged.
2. **Contract:** update `ee_design_review/docs/fabcheck-link.md` with `package.zip`, and drop
   `releases/` and `source.release`. That's done in EE's branch.
3. **Signoff engine (EE branch):**
   - the revisions records, the tab, Download, the Overview line, and the issue tag;
   - the summary field and the import;
   - tests, then sync into ME and FW (tab hidden where no source lists runs).
4. **Demo:** the EE demo board gets two runs and one revision, with Signoff PL's snapshot
   regenerated, per the suite CLAUDE.md demo rules.

## Chris's answers (2026-11-03)

1. **Reads move to Signoff; Fabcheck only writes.**
   - Fabcheck no longer reads runs, packages, or anything else back from a project's repo.
   - It still writes at Send: the commit itself reads the branch's current tree, and the access
     check asks GitHub whether the token can push. Both are part of writing.
   - "Open in Fabcheck" from Signoff becomes a hand-off in the browser (below).
   - Team fab profiles (`syncProfiles`, in the FTE data repo) are the one read left in Fabcheck.
     They're shared settings, not project data, and move to Signoff later.
2. **Old runs and files don't matter yet** (still in development). No conversion and no import:
   the branch's `releases/3.1` record and the runs stored before the zip can be ignored. That
   replaces *Migration* above.
3. **Labels:** free text, with the next one suggested.

### Hand-off: Signoff opens a run in Fabcheck without Fabcheck reading the repo

Both tools are served from one origin, so they share browser storage.
1. Signoff reads the run record and its package zip with its own token.
2. It writes them to IndexedDB database `dovetail-handoff`, store `runs`, keyed by run id:
   `{ id, run, findings, zip: Uint8Array, at }`.
3. It opens `../pcb_dfm/index.html#/board?run=<id>&project=<id>&check=…&x=…&y=…&layer=…` in
   Fabcheck's window. These are today's deep-link parameters, without `repo`.

Fabcheck then resolves the run in this order:
1. its own kept runs, as now;
2. the hand-off: it opens the zip, shows the stored findings, and places the parts, then deletes
   the entry;
3. otherwise it asks for the package to be dropped in, as now.

Entries older than a day are cleared whenever Fabcheck starts. Contractors use it the same way:
Signoff reads the zip with their token, from their review repo.
