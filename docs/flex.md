# Flex boards: audit of Fabcheck's checks

Fabcheck was built for rigid boards. This page audits every check against flex and HDI flex
packages, and lists what to add or change. It started from one real package (2026-11-04): a
2-layer HDI flex from Altium Designer 26, Gerber X2, with ODB++, IPC-D-356, a BOM, and pick-and-place.
No client names, part numbers, or board dimensions belong on this page. The repo is public.

## What an Altium flex package looks like

- **Mechanical layers carry the flex data.** In Gerber X2, Altium writes each mechanical layer as
  `%TF.FileFunction,Other,<layer type>*%`, using the layer type set in the layer stack. The package
  had:
  - `Other,Design_Outline` (GM1)
  - `Other,Coverlay_Top` (GM4)
  - `Other,Coverlay_Bottom` (GM5)
  - `Other,Stiffener_Top` (GM20)
  - `Other,Fab_Notes` (GM30, the fab drawing frame and notes)
- **The board profile was missing.** Altium's X2 board profile (`FileFunction,Profile`, written as
  `.GM`; the Generator package has one) was not in the package. The output job's status report lists
  13 generated files, and none of them is a profile, so Fabcheck's "missing" finding was right. Why
  Altium didn't write it is not known yet. The output settings showed it as included, and the package
  came from a release snapshot, which may have run a different OutJob or configuration.
- **Every layer carries a layer-name label below the board.** The label is text, outside the outline,
  on copper, mask, paste, silkscreen, and every mechanical layer. On some layers it is the only content:
  the top mask (top is covered by coverlay), the top paste and the bottom coverlay.
- **Coverlay and mask are mixed.** The top is covered by coverlay: a full-board region with no
  openings. The bottom uses photoimageable solder mask (fine-pitch parts). The bottom coverlay layer
  is empty.
- **Stiffeners sit opposite the parts.** The parts are bottom-side; the top stiffener has two regions,
  and the gap between them is presumably the bend zone.
- **ODB++ names the coverlay.** It calls it `TOP_COVERLAY` and types it as `SOLDER_MASK`.

## Fixed now (2026-11-04)

- **Outline from an X2 mechanical layer.** `classify.js` now treats an X2 `Other,…` layer whose type
  names an outline, profile, or board shape as the outline, after a real profile. If copper strays
  outside it (the layer-name labels), it still wins; the `extents` check reports that copper.
  Findings on the six reference packages (demo sample, both demo boards, Handle, both Generators;
  Standard and Advanced) are identical before and after.
- **Isometric stage.** `stage.js` `shape()` kept every other outline vertex, so a 4-corner outline
  (the copper-extents stand-in used when no outline is found) became a line, and the layer stack drew
  as thin lines. It now keeps every vertex until an outline has more than 160 points.

## The current checks on a flex

Most errors on this package came from the profile, not the board. With the outline found, there are
101 errors on Prototype (6/6 mil), 82 on Standard and 3 on Advanced. The 3 are one aspect-ratio
error, from the default thickness, and two BOM lines with no part number. HDI flex needs its own profile (see *Profile* below).

| Check | On a flex | Change |
|---|---|---|
| `missing` (mask) | A side covered by coverlay has no real mask, or a mask file with only a label. | Accept coverlay as the cover for a side. Say which. |
| `missing` (outline) | Works now with Design_Outline. Other layer types may name it differently. | See *Outline picker*. |
| `outline` | OK. | — |
| `extents` | Flags the layer-name labels as copper past the outline. | Tell labels outside the board from real copper; make the labels info. |
| `structure` | OK. | — |
| `layers` | OK for flex. Rigid-flex needs the stack per region, which Gerber can't carry. | Read the stack from ODB++ or IPC-2581 later. |
| `trace`, `spacing`, `sliver` | Right checks; HDI flex limits are finer. | New profile. |
| `edge` (copper to edge) | Flex fabs usually ask for more pull-back than rigid (cut by die or laser). | Profile value. |
| `isolated` | OK once the outline is found. With the copper-extents stand-in, the labels showed up as 19 islands. | — |
| `drill`, `ring` | Right checks; HDI values. Laser microvias need their own drill and ring limits. | Profile; microvia rules (already on the open list). |
| `aspect` | Wrong: it uses the 1.6 mm default thickness (10.5:1 here). A flex is about 0.1 to 0.3 mm thick. | Set the thickness per run (the tab bar field). For a flex, ask for it, or default from the profile. The field's `min` is 0.2 mm, too thick for a single-layer flex. |
| `hole-gap`, `hole-edge`, `npth`, `slot` | OK; profile values. | — |
| `castellation` | Rare on flex. | — |
| `mask`, `mask-dam` | Right on the mask side. On the coverlay side, every via shows as "tented" because the mask file is empty. | Run the mask checks on the side's real cover. Coverlay needs its own checks (below). |
| `via-in-pad` | OK. | — |
| `silk`, `silk-pad` | Silkscreen on coverlay is usually coarser and less accurate. | Profile value. |
| `bga-pad` | Fired on a fine-pitch board-to-board connector whose pads Altium marks `BGAPad`. | Fine; the HDI limit decides. |
| `thermal` | OK. | — |
| `outline-corner` | Info today. On a flex a sharp inside corner starts a tear. | Warn on flex, and ask for a radius or a tear stop. |
| `copper-balance` | Means warpage on rigid; on flex the concern is different. | Skip on flex. |
| Assembly, BOM, pins, build | Unchanged by flex. | — |

## Built (2026-11-04, second round)

Tried on a made-up flex, `demo/thermostat-sensor-flex.zip` (`tools/make_flex_demo.py`, DT-1045 rev A in
the Smart Thermostat demo story). Its docstring lists the planted problems; the Flex HDI profile finds
exactly those (10 warnings, no errors). The real package this page started from was no longer on disk,
so it has not been re-run.

- **Flex detection.** `classify.js` `otherRole` reads the X2 `Other,<type>` of mechanical layers:
  coverlay, stiffener, bend lines, and the outline. `pkg.layers.coverlay` / `stiffener` / `bend`,
  `pkg.flex` (which of them draw inside the board), `pkg.onBoard(layer)`.
  - The Overview's facts say "2-layer flex" and where the outline came from.
  - The board's layer list names coverlay and stiffener layers, with their own colors.
  - The stage draws coverlay and stiffener slabs, and leaves out a mask with nothing on the board.
  - The fab package names them `Coverlay_Top.gbr`, `Stiffener_Top.gbr`, `Bend_Lines.gbr`.
- **Flex HDI and HDI profiles**, sourced in `fab-rules.md`. A flex package with no remembered profile
  opens on Flex HDI. The board thickness field now goes down to 0.05 mm.
- **Laser microvias** (`minMicrovia`, `ringMicrovia`): plated holes under the minimum drill but at least
  the laser minimum are laser vias (info), and their ring is checked against the microvia ring.
- **Package checks.** Coverlay counts as a side's cover for "Missing: solder mask". `extents` tells
  copper clear of the board (labels, coupons) from copper crossing the edge: the first is info. New
  `empty-layer` (info): a layer that draws nothing inside the board.
- **DFM.** Sharp inside corners are a warning on flex; copper balance is not warned on flex; the mask
  checks skip a side covered by coverlay with no mask openings.
- **Flex checks** (`checks/flex.js`, category Flex, run at the end of DFM):
  - `flex`: what covers each side, the stiffeners, the limits used.
  - `coverlay`: per pad, whether it sits in an opening, is anchored (coverlay over its edge), or is
    covered (error), and the clearance to the coverlay (warn under `coverlayExp`). Works whether the
    layer draws the film or the openings.
  - `coverlay-web`: strips of coverlay between openings narrower than `coverlayWeb`, measured on the
    line between neighboring pads.
  - `stiffener`: a stiffener past the outline; connectors (J, P, CN, CON, X) with no stiffener behind
    them (warn), other parts (info).
  - `flex-edge`: pads and vias within `flexKeepaway` of a stiffener edge or a bend line.
  - `flex-area` (info), in the board outside every stiffener: plated holes, solid pours over 1 mm²,
    traces stacked on both layers for 1 mm or more.
- **Outline picker.** The Overview's facts end with "Outline from …  Change" ("not found  Pick" when
  there is none, and the picker opens by itself). It shows every file in the Gerber set with a closed
  loop, drawn small, with its X2 function and size. The pick is kept in the run's settings
  (`settings.outline`, a file path) and used when the run is reopened.
- **Revisions** keys X2 `Other` layers by their function too.

Still open:
- The bend zone is guessed as "not under a stiffener". With a bend-line layer only the keep-away uses it.
- Trace direction across a bend, trace corners, and teardrops in the flexible area.
- Microvia aspect ratio and stacked microvias (need the dielectric and drill spans).
- Rigid-flex (below).
- Signoff EE's demo doesn't link to the flex demo; it's in Fabcheck's demo only.

## What to add (the plan, before the second round)

### 1. Know it's a flex (small, first)

- Detect flex from X2 `Other,Coverlay_*`, `Other,Stiffener_*`, an ODB++ layer named coverlay, or a
  thickness under about 0.4 mm.
- Give those layers names and roles: in the Files tab, on the board as layers with their own colors,
  on the stage as their own slabs, and in the fab package (`releases.js` `role`) as `Coverlay_Top.gbr`,
  not `Other_Coverlay_Top.gbr`.
- Show "Flex" in the package header, and use a flex profile by default.
- Add a check for an empty layer: a layer whose only content lies outside the board (here the top
  mask and the bottom coverlay). Info: "Bottom coverlay has nothing on the board". It catches a
  forgotten opening layer as easily as a side with no coverlay.

### 2. Outline picker (Chris's idea)

When Fabcheck isn't sure which file is the outline, it should ask:
- **When:** no profile and no outline-typed layer, or the outline found doesn't enclose most of the
  copper.
- **How:** show the candidates as small renders: mechanical and `Other` layers with a closed loop.
  Each has its file name, X2 function, and the board size it gives.
- **Then:** keep the choice with the run, so a re-run and a revision use it. Show which file the
  outline came from, and a "Change" link, next to the board size.

Today's case didn't need it, since the X2 header says `Design_Outline`. It's for RS-274X packages and
for other layer type names.

### 3. Coverlay checks

Coverlay is a drilled or laser-cut film, not a photoimaged mask, so its limits are coarser:
- **Opening to pad:** clearance, to allow for coverlay registration.
- **Web between openings:** the narrowest coverlay strip between two openings. Below it, the fab
  gang-opens a row of pads.
- **Pad anchoring:** coverlay overlapping each pad's edge, or anchor tabs (spurs), so pads don't lift
  in a bend.
- **Polarity:** work out whether the layer draws the openings or the film. On this package it draws
  the film (a full-board region), so openings are holes in it.

### 4. Stiffeners and the bend zone

- **The stiffener stays inside the outline.** It should also pull back from it.
- **Parts sit on a stiffener.** Each connector and fine-pitch part, from the pick-and-place, should
  have a stiffener behind it on the other side. Stiffeners on the same side as the part also count
  (FR4 around a connector).
- **Stiffener edges are stress risers.** No pads, vias, or plated holes within a set distance of a
  stiffener edge.
- **Bend zone:** the flex outside every stiffener (for rigid-flex, outside the rigid regions). In it,
  check for:
  - vias, pads, or plated holes (error);
  - solid copper pours (hatch them);
  - traces not crossing at right angles to the bend;
  - corners in traces;
  - top and bottom traces stacked on top of each other (stagger them, the I-beam rule);
  - pads and vias at the edge of the zone without teardrops.
- **A declared bend line wins.** If a package has a bend-line layer, use it instead of guessing from
  the stiffener gap. To verify: how Altium exports bend lines.

### 5. Profile: HDI flex

A new built-in profile, *Flex HDI*, with every value sourced in `fab-rules.md`. Sources to read:
- IPC-2223 (flex design);
- IPC-6013 (flex qualification);
- the published flex capability pages of a few flex fabs (PCBWay, JLCPCB, Sierra Circuits, and
  others).

It needs these rules, some of them new:
- trace, space, drill, and ring (HDI flex);
- laser microvia drill and ring;
- copper to edge (die or laser cut);
- coverlay opening clearance and minimum web (new);
- stiffener keep-away for pads and vias (new);
- bend-zone rules (new; mostly yes or no);
- minimum inside-corner radius;
- a default thickness of about 0.1 to 0.2 mm.

No numbers here until they're sourced. Microvias on rigid HDI boards are already on the open list,
and the two profiles should share the microvia rules.

### 6. Revisions between two flex packages

`revisions.js` `layerKey` keys a layer by function, side, copper index, and mechanical number. Every
X2 `Other,…` layer gets the same key (`other:::`), so the Map keeps only the last of them, and the
coverlay, stiffener, outline, and notes layers aren't compared one to one. Adding `x2fn` to the key
fixes that. It also changes revision results for existing X2 packages that have `Other` layers, so
check them first.

### 7. Later: rigid-flex

Gerber can't say which region of the board has which layers. That probably needs ODB++ or IPC-2581;
to verify: what each one carries for a rigid-flex stack. Fabcheck reads ODB++ only for components
today.

## Order

1. Know it's a flex (1), with the empty-layer check and the labels outside the board made info in
   `extents`. Small.
2. The Flex HDI profile (5), once its values are sourced.
3. Coverlay checks (3), then stiffener and bend-zone checks (4).
4. The outline picker (2), when a package needs it, and the Revisions key (6).
5. Rigid-flex (7).

Six more flex boards are being reviewed on 2026-11-04. Add what they show to this page.
