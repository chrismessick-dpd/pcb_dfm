# Fab rule defaults: sources and audit

The three built-in profiles (`assets/profiles.js`) are **typical** values, not any fab house's. This page
records where each default comes from, so a reviewer can see why Fabcheck flags what it flags.

Audit date: **2026-10-24**. All sources below were read on that date.

- Metric first; mil in brackets where the source is in mil (1 mil = 0.0254 mm).
- Where sources disagree, the default takes the **conservative** (larger) value of the mainstream sources
  for that class, unless the note says otherwise.
- **Rule of thumb** marks a default that no source we found states as a number. These are judgment
  calls and are the first values to replace with a fab house's own numbers in a custom profile.

## Sources

| Key | Source | What it gives |
|---|---|---|
| JLC | JLCPCB, PCB capabilities, jlcpcb.com/capabilities/pcb-capabilities | Most rows: trace/space, drills, rings, hole spacing, slots, mask, silk, BGA, castellations |
| PCBWay-S | PCBWay, standard PCB capabilities (pcbway.com) | Standard trace/space, drill, ring, half-hole, silk |
| PCBWay-A | PCBWay, advanced PCB capabilities (pcbway.com) | Aspect ratio by process, hole spacing, rings by copper weight, edge, slots, castellations, BGA, mask |
| OSH | OSH Park, services, docs.oshpark.com/services | 2-, 4- and 6-layer trace/space, drill, ring |
| AC | Advanced Circuits, standard capabilities (4pcb.com) | Trace/space, hole, silk line, scoring clearance |
| Sierra | Sierra Circuits, PCB capabilities (protoexpress.com) | Standard and advanced trace/space, drill, aspect ratio, ring, V-score edge, mask dam, slot |
| MacroFab | MacroFab, PCB design guidelines (macrofab.com) | Router bit size for inside corners |
| IPC-6012 | IPC-6012 (via Altium and JLCPCB articles; the standard itself was not read) | Acceptance annular ring by class |
| IPC-2221 | IPC-2221 (via secondary articles; the standard itself was not read) | Land size formula; Table 6-1 conductor spacing |

Eurocircuits was checked too. Its pattern-class table is published only as an image, so no numbers from it
are used.

## Every default

Values in mm unless noted. P = Prototype, S = Standard, A = Advanced.

| Rule | P | S | A | Source and reasoning |
|---|---|---|---|---|
| Minimum trace width | 0.152 | 0.127 | 0.075 | P: OSH 2-layer 6 mil. S: OSH 4-layer 5 mil, AC 5 mil. A: Sierra advanced 3 mil. JLC and PCBWay-S go to 0.10 |
| Minimum copper spacing | 0.152 | 0.127 | 0.075 | Same sources as trace. Disagreement: PCBWay-A lists 0.15 outer space at 1 oz, PCBWay-S lists 0.10; S stays at the 5 mil most houses state. All are above IPC-2221 B2 (0.1 mm, external uncoated, low voltage) |
| Copper to board edge | 0.40 | 0.30 | 0.20 | P: covers V-scoring (JLC 0.4 to a V-cut; AC 0.015 in = 0.38). S: above PCBWay-A normal 0.25. A: JLC 0.2 to a routed edge, PCBWay-A medium 0.20 |
| Smallest isolated copper reported | 0.05 mm² | 0.05 mm² | 0.05 mm² | **Rule of thumb.** A reporting threshold, not a fab limit |
| Minimum drill | 0.30 | 0.25 | 0.15 | P: above OSH 2-layer 10 mil; **rule of thumb** margin. S: OSH 10 mil, AC 0.010 in (0.254). A: JLC 0.15, PCBWay-S 0.15 |
| Maximum aspect ratio | 8:1 | 8:1 | 10:1 | S: PCBWay-A ≤8 normal process. A: Sierra 10:1, PCBWay-A medium 8–10. JLC does not state one |
| Annular ring, plated holes | 0.25 | 0.20 | 0.10 | P: JLC 1–2 layer recommended 0.25, PCBWay-A 0.25 at 1 oz. S: JLC multilayer recommended 0.20, PCBWay-A 0.20 at 0.5 oz. A: Sierra 4 mil |
| Annular ring, vias | 0.15 | 0.13 | 0.075 | P: PCBWay-S 0.15, JLC multilayer minimum 0.15. S: PCBWay-A normal 0.13; OSH 2-layer 5 mil. A: Sierra advanced 3 mil |
| Largest drill treated as a via | 0.45 | 0.45 | 0.45 | PCBWay-A defines vias as holes ≤0.45 mm for its spacing rules. A classification setting, not a limit |
| Minimum plated slot width | 0.50 | 0.50 | 0.35 | JLC 0.5 (2-layer), 0.35 (multilayer); PCBWay-A 0.5 |
| Minimum non-plated slot width | 1.0 | 1.0 | 0.80 | P, S: JLC 1.0. A: PCBWay-A 0.8 |
| Via to via hole spacing | 0.30 | 0.28 | 0.20 | Drill wall to drill wall. S: PCBWay-A 0.28. A: JLC 0.2. P: **rule of thumb** margin over S |
| Hole to hole spacing | 0.50 | 0.45 | 0.33 | When a component hole or slot is involved. S: JLC pad hole to pad hole 0.45 (PCBWay-A 0.41 normal). A: PCBWay-A high process 0.33. P: **rule of thumb** margin over S |
| Hole to board edge | 0.50 | 0.50 | 0.40 | **Rule of thumb.** No source found states a number; JLC and PCBWay give copper to edge only |
| Minimum castellated hole | 0.50 | 0.50 | 0.40 | P, S: JLC 0.5, PCBWay-A normal ≥0.5. A: PCBWay-S half-hole 0.4, PCBWay-A medium 0.4–0.5 |
| Via in pad allowed | no | no | yes | **Rule of thumb.** Filled and capped vias (POFV) are an extra-cost process at quick-turn houses and routine at advanced shops |
| Non-plated hole to copper | 0.30 | 0.25 | 0.20 | A: JLC NPTH to track 0.2. P, S: **rule of thumb** margins over it |
| Minimum mask expansion | 0 | 0 | 0 | JLC applies 1:1 mask (no expansion); PCBWay-A gives a 0.05 minimum opening. 0 flags only openings smaller than the pad |
| Minimum mask dam | 0.13 | 0.10 | 0.075 | P: JLC black/white 0.13. S: JLC green 0.10, PCBWay-A green 0.10. A: Sierra green 3 mil. Colored mask needs more (PCBWay-A ≥0.11, Sierra 5 mil) |
| Minimum silkscreen line | 0.15 | 0.15 | 0.127 | P, S: JLC ≥0.15, PCBWay-S 0.15. A: AC 0.005 in |
| Silkscreen to pad | 0.15 | 0.15 | 0.15 | JLC pad to silkscreen 0.15. Silk *on* a pad warns; closer than this is an info line, since fabs clip it |
| Minimum text height | 1.0 | 1.0 | 0.80 | P, S: JLC 1.0. A: PCBWay-S 0.8. Kept with the profile; not checked yet |
| Minimum thermal spoke width | 0.25 | 0.20 | 0.15 | **Rule of thumb.** No fab states one; S matches typical CAD defaults |
| Minimum spoke count | 2 | 2 | 2 | **Rule of thumb** |
| Minimum BGA pad | 0.30 | 0.30 | 0.28 | P, S: PCBWay-A ≥0.30 with HASL. A: PCBWay-A ≥0.28 with ENIG. JLC goes to 0.20 |
| Outline inside-corner radius | 0.50 | 0.50 | 0.40 | P, S: MacroFab's 1.0 mm router bit. A: **rule of thumb** (a forum post cites a 0.8 mm bit). Reported as info |
| Copper balance, symmetric layers | 25 points | 25 points | 25 points | **Rule of thumb.** No source gives a number |
| Default board thickness | 1.6 | 1.6 | 1.6 | The usual default finished thickness; only used for aspect ratio, and set per run |

## What changed in this audit

| Rule | Was (P / S / A) | Now | Why |
|---|---|---|---|
| Minimum drill, S | 0.20 | 0.25 | OSH and AC state 10 mil; 0.20 was below several mainstream houses |
| Aspect ratio, S / A | 10 / 12 | 8 / 10 | PCBWay-A puts 10:1 in its medium process and 12:1 in its high process |
| Ring PTH, P / S | 0.20 / 0.15 | 0.25 / 0.20 | JLC's recommended values (its 0.15 / 0.18 are absolute minimums) |
| Ring via, S | 0.10 | 0.13 | PCBWay-A normal process |
| Mask dam, P | 0.12 | 0.13 | JLC black/white |
| Silk text, S / A | 0.80 / 0.60 | 1.0 / 0.80 | JLC 1.0; PCBWay-S 0.8 |
| Silk line, A | 0.10 | 0.127 | AC 0.005 in; no source went to 0.10 |
| Slot, P / A | 0.60 / 0.45 | 0.50 / 0.35 | Now "plated slot"; JLC 0.5 / 0.35. Non-plated slots got their own rule |
| Largest via drill, S / A | 0.40 / 0.30 | 0.45 | PCBWay-A's via definition; one value for all profiles |
| Prototype description | | | No longer says "nearly every fab can build it" |

## New rules and checks

| Check | Rule(s) | Severity | Notes |
|---|---|---|---|
| `hole-gap` | via to via, hole to hole | warn; error when holes overlap or are drilled twice at one spot | Holes and slots, wall to wall |
| `hole-edge` | hole to board edge | warn; error below half | Drill wall to the outline or a cutout |
| `castellation` | minimum castellated hole | info when present; error when too small | Plated holes cut by the outline |
| `slot` | non-plated slot width | warn | The old slot check now applies to plated slots only |
| `npth` | NPTH to copper | as before | Now includes non-plated slots |
| `silk-pad` | silkscreen to pad | info | Silk near a pad but not on it |
| `bga-pad` | minimum BGA pad | warn | Pads with X2 function BGAPad |
| `via-in-pad` | via in pad allowed | warn per pad; info when allowed | Only pads with paste: test points and other unpasted pads are listed as info |
| `outline-corner` | inside-corner radius | info | Sharp concave corners of the outline, every sharp corner of a cutout |
| `copper-balance` | copper balance | info per board; warn per mirrored layer pair | Raster coverage inside the outline |

## Candidates not added

- **Acid traps.** Needs the trace graph and junction angles; Fabcheck has no trace graph yet.
- **Separate inner and outer layer limits.** Sources give finer inner limits; one value that matches the
  outer limit is the conservative choice.
- **Copper weight.** Limits grow with copper weight (JLC 0.16 mm space at 2 oz, mask dam 0.20 at 2 oz),
  but copper weight is not in the Gerbers. Enter heavier-copper numbers in a custom profile.
- **IPC class selector.** IPC-6012 rings (Class 3 external 0.05 mm, internal 0.025 mm, no breakout;
  Class 2 allows 90° breakout) are acceptance values for the finished board, not design values. The
  IPC-2221 land formula (land = hole + 2 × ring + fabrication allowance, 0.2 mm at Level C) yields design
  values above all three profiles' rings.
- **Text height check.** Needs stroke clustering into characters; the rule is kept.

## Old runs

A run stores every rule it used in `run.settings.rules`. Reopening it pins those rules. Rules added since
(the ones above) were not in the run; they fall back to the built-in profile the run named (or Standard),
and the console says that their checks did not exist when the run was made.
