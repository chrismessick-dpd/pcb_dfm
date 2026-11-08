# Fab rule defaults: sources and audit

The three built-in profiles (`assets/profiles.js`) are **typical** values, not any fab house's. This page
records where each default comes from, so a reviewer can see why Fabcheck flags what it flags.

Audit date: **2026-10-24**. All sources below were read on that date.

- Metric first, with mil in brackets for lengths (1 mil = 0.0254 mm). Sources quoted in mil keep their mil figure.
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
| OSH | OSH Park, services, docs.oshpark.com/services | 2-, 4-, and 6-layer trace/space, drill, ring |
| AC | Advanced Circuits, standard capabilities (4pcb.com) | Trace/space, hole, silk line, scoring clearance |
| Sierra | Sierra Circuits, PCB capabilities (protoexpress.com) | Standard and advanced trace/space, drill, aspect ratio, ring, V-score edge, mask dam, slot |
| MacroFab | MacroFab, PCB design guidelines (macrofab.com) | Router bit size for inside corners |
| IPC-6012 | IPC-6012 (via Altium and JLCPCB articles; the standard itself was not read) | Acceptance annular ring by class |
| IPC-2221 | IPC-2221 (via secondary articles; the standard itself was not read) | Land size formula; Table 6-1 conductor spacing |

Eurocircuits was checked too. Its pattern-class table is published only as an image, so no numbers from it
are used.

## Every default

Values in mm, with mil in brackets for lengths, unless noted. P = Prototype, S = Standard, A = Advanced.

| Rule | P | S | A | Source and reasoning |
|---|---|---|---|---|
| Minimum trace width | 0.152 (6 mil) | 0.127 (5 mil) | 0.075 (3 mil) | P: OSH 2-layer 6 mil. S: OSH 4-layer 5 mil, AC 5 mil. A: Sierra advanced 3 mil. JLC and PCBWay-S go to 0.10 |
| Minimum copper spacing | 0.152 (6 mil) | 0.127 (5 mil) | 0.075 (3 mil) | Same sources as trace. Disagreement: PCBWay-A lists 0.15 outer space at 1 oz, PCBWay-S lists 0.10; S stays at the 5 mil most houses state. All are above IPC-2221 B2 (0.1 mm (3.9 mil), external uncoated, low voltage) |
| Copper to board edge | 0.40 (15.7 mil) | 0.30 (11.8 mil) | 0.20 (7.9 mil) | P: covers V-scoring (JLC 0.4 to a V-cut; AC 0.015 in = 0.38). S: above PCBWay-A normal 0.25. A: JLC 0.2 to a routed edge, PCBWay-A medium 0.20 |
| Smallest isolated copper reported | 0.05 mm² | 0.05 mm² | 0.05 mm² | **Rule of thumb.** A reporting threshold, not a fab limit |
| Minimum drill | 0.30 (11.8 mil) | 0.25 (9.8 mil) | 0.15 (5.9 mil) | P: above OSH 2-layer 10 mil; **rule of thumb** margin. S: OSH 10 mil, AC 0.010 in (0.254). A: JLC 0.15, PCBWay-S 0.15 |
| Maximum aspect ratio | 8:1 | 8:1 | 10:1 | S: PCBWay-A ≤8 normal process. A: Sierra 10:1, PCBWay-A medium 8–10. JLC does not state one |
| Annular ring, plated holes | 0.25 (9.8 mil) | 0.20 (7.9 mil) | 0.10 (3.9 mil) | P: JLC 1–2 layer recommended 0.25, PCBWay-A 0.25 at 1 oz. S: JLC multilayer recommended 0.20, PCBWay-A 0.20 at 0.5 oz. A: Sierra 4 mil |
| Annular ring, vias | 0.15 (5.9 mil) | 0.13 (5.1 mil) | 0.075 (3 mil) | P: PCBWay-S 0.15, JLC multilayer minimum 0.15. S: PCBWay-A normal 0.13; OSH 2-layer 5 mil. A: Sierra advanced 3 mil |
| Largest drill treated as a via | 0.45 (17.7 mil) | 0.45 (17.7 mil) | 0.45 (17.7 mil) | PCBWay-A defines vias as holes ≤0.45 mm (17.7 mil) for its spacing rules. A classification setting, not a limit |
| Minimum plated slot width | 0.50 (19.7 mil) | 0.50 (19.7 mil) | 0.35 (13.8 mil) | JLC 0.5 (2-layer), 0.35 (multilayer); PCBWay-A 0.5 |
| Minimum non-plated slot width | 1.0 (39 mil) | 1.0 (39 mil) | 0.80 (31 mil) | P, S: JLC 1.0. A: PCBWay-A 0.8 |
| Via to via hole spacing | 0.30 (11.8 mil) | 0.28 (11 mil) | 0.20 (7.9 mil) | Drill wall to drill wall. S: PCBWay-A 0.28. A: JLC 0.2. P: **rule of thumb** margin over S |
| Hole to hole spacing | 0.50 (19.7 mil) | 0.45 (17.7 mil) | 0.33 (13 mil) | When a component hole or slot is involved. S: JLC pad hole to pad hole 0.45 (PCBWay-A 0.41 normal). A: PCBWay-A high process 0.33. P: **rule of thumb** margin over S |
| Hole to board edge | 0.50 (19.7 mil) | 0.50 (19.7 mil) | 0.40 (15.7 mil) | **Rule of thumb.** No source found states a number; JLC and PCBWay give copper to edge only |
| Minimum castellated hole | 0.50 (19.7 mil) | 0.50 (19.7 mil) | 0.40 (15.7 mil) | P, S: JLC 0.5, PCBWay-A normal ≥0.5. A: PCBWay-S half-hole 0.4, PCBWay-A medium 0.4–0.5 |
| Via in pad allowed | no | no | yes | **Rule of thumb.** Filled and capped vias (POFV) are an extra-cost process at quick-turn houses and routine at advanced shops |
| Non-plated hole to copper | 0.30 (11.8 mil) | 0.25 (9.8 mil) | 0.20 (7.9 mil) | A: JLC NPTH to track 0.2. P, S: **rule of thumb** margins over it |
| Minimum mask expansion | 0 (0 mil) | 0 (0 mil) | 0 (0 mil) | JLC applies 1:1 mask (no expansion); PCBWay-A gives a 0.05 minimum opening. 0 flags only openings smaller than the pad |
| Minimum mask dam | 0.13 (5.1 mil) | 0.10 (3.9 mil) | 0.075 (3 mil) | P: JLC black/white 0.13. S: JLC green 0.10, PCBWay-A green 0.10. A: Sierra green 3 mil. Colored mask needs more (PCBWay-A ≥0.11, Sierra 5 mil) |
| Minimum silkscreen line | 0.15 (5.9 mil) | 0.15 (5.9 mil) | 0.127 (5 mil) | P, S: JLC ≥0.15, PCBWay-S 0.15. A: AC 0.005 in |
| Silkscreen to pad | 0.15 (5.9 mil) | 0.15 (5.9 mil) | 0.15 (5.9 mil) | JLC pad to silkscreen 0.15. Silk *on* a pad warns; closer than this is an info line, since fabs clip it |
| Minimum text height | 1.0 (39 mil) | 1.0 (39 mil) | 0.80 (31 mil) | P, S: JLC 1.0. A: PCBWay-S 0.8. Kept with the profile; not checked yet |
| Minimum thermal spoke width | 0.25 (9.8 mil) | 0.20 (7.9 mil) | 0.15 (5.9 mil) | **Rule of thumb.** No fab states one; S matches typical CAD defaults |
| Minimum spoke count | 2 | 2 | 2 | **Rule of thumb** |
| Minimum BGA pad | 0.30 (11.8 mil) | 0.30 (11.8 mil) | 0.28 (11 mil) | P, S: PCBWay-A ≥0.30 with HASL. A: PCBWay-A ≥0.28 with ENIG. JLC goes to 0.20 |
| Outline inside-corner radius | 0.50 (19.7 mil) | 0.50 (19.7 mil) | 0.40 (15.7 mil) | P, S: MacroFab's 1.0 mm (39 mil) router bit. A: **rule of thumb** (a forum post cites a 0.8 mm (31 mil) bit). Reported as info |
| Copper balance, symmetric layers | 25 points | 25 points | 25 points | **Rule of thumb.** No source gives a number |
| Default board thickness | 1.6 (63 mil) | 1.6 (63 mil) | 1.6 (63 mil) | The usual default finished thickness; only used for aspect ratio, and set per run |

## HDI and Flex HDI profiles (2026-11-04)

Two more built-ins, for HDI boards with laser microvias and for flex and HDI flex, and five new rules.
Sources were read on 2026-11-04. **[search only]** marks a figure seen only in a search summary, not on
the page.

| Key | Source | What it gives |
|---|---|---|
| JLC-F | JLCPCB, flex PCB capabilities, jlcpcb.com/capabilities/flex-pcb-capabilities | Flex trace/space, drill, rings, coverlay expansion and bridge, copper to edge, outline tolerance, stiffeners, silk, thickness |
| JLC-blog2 | JLCPCB blog, FPC design rules (jlcpcb.com/blog/fpc-design-rules) | Stiffener overlap beyond pads, via to edge |
| PCBWay-F | PCBWay, FPC and rigid-flex capabilities (pcbway.com/FPC-Rigid-Flex-PCB.html) | Coverlay bridge, outline tolerance |
| PCBWay-H | PCBWay, HDI PCB (pcbway.com/hdi-pcb.html) | Laser via, mechanical drill, trace/space |
| Sierra-H | Sierra Circuits, HDI manufacturing capabilities (protoexpress.com) | Laser drill, capture pad, aspect ratio, HDI trace/space, mechanical drill |
| Sierra-F | Sierra Circuits, flex and rigid-flex (protoexpress.com) | Flex laser drill, trace/space, mechanical drill, LPI on flex |
| Sierra-CL | Sierra Circuits, what is coverlay (protoexpress.com/kb) | Coverlay dam, trace to opening |
| Sierra-2223 | Sierra Circuits blog on IPC-2223 violations | Bend ratios; bend-zone rules (hatched planes, perpendicular and staggered traces, teardrops); vias near stiffener edges crack |
| NextPCB | NextPCB, HDI product page | Laser via aspect ratio, outer/inner trace, filled via |
| OSH-F | OSH Park, flex service (docs.oshpark.com/services/flex) | Flex trace/space, drill, ring, mask web, copper to edge, tool radius |
| Epec-HD | Epec, feature sizes for coverlay and soldermask in high-density flex | Coverlay expansion and web, minimum openings, LPI on flex |
| Rush | Rush PCB, "Flex DFM guidelines part 2" (PCD&F) | Coverlay dam and registration, punched edge, inside-corner radius |

| Rule | HDI | Flex HDI | Source and reasoning |
|---|---|---|---|
| Minimum trace width / spacing | 0.075 (3 mil) | 0.102 (4 mil) | HDI: as Advanced (JLC HDI 3/3 mil; Sierra-H 3.5/3 mil inner). Flex: JLC-F 4 mil at 1 oz (3.5 mil at ½ oz), Sierra-F 3.5 mil; OSH-F 6 mil is the outlier |
| Minimum drill (mechanical) | 0.15 (5.9 mil) | 0.20 (7.9 mil) | HDI: Sierra-H, PCBWay-H, JLC 0.15. Flex: **rule of thumb** above Sierra-F 0.18; JLC-F regular 0.30, PCBWay-F 0.10 |
| Minimum laser microvia (new) | 0.127 (5 mil) | 0.15 (5.9 mil) | HDI: Sierra-H standard 5 mil (advanced and PCBWay-H 4 mil). Flex: Sierra-F 6 mil (single source). 0 in P/S/A: no laser vias |
| Annular ring, laser microvias (new) | 0.064 (2.5 mil) | 0.064 (2.5 mil) | Sierra-H capture pad = drill + 5 mil standard. Advanced Circuits gives drill + 8 mil [search only] |
| Annular ring, vias | 0.075 (3 mil) | 0.127 (5 mil) | HDI: as Advanced. Flex: OSH-F 5 mil; JLC-F pad ≥ hole + 0.2 (0.10 ring) |
| Annular ring, plated holes | 0.10 (3.9 mil) | 0.25 (9.8 mil) | HDI: as Advanced. Flex: JLC-F 0.25 recommended (0.18 minimum) |
| Copper to board edge | 0.20 (7.9 mil) | 0.30 (11.8 mil) | Flex: JLC-F 0.30 to a laser-cut edge (its blog says 0.2); OSH-F recommends 0.381, requires 0.152; Rush punched 0.20 |
| Minimum mask dam | 0.075 (3 mil) | 0.10 (3.9 mil) | Flex LPI: OSH-F 4 mil web, Epec-HD 4 mil, Sierra-F 3–4 mil, Rush 0.075 |
| Via in pad allowed | yes | yes | Filled and capped at HDI and flex HDI shops (JLC filled 0.15–0.55; NextPCB ≤ 0.45) |
| Outline inside-corner radius | 0.40 (15.7 mil) | 0.50 (19.7 mil) | Flex: OSH-F interior tool 1.01 mm (radius ≈ 0.5); Rush 0.2 standard; Sierra-F cutter 0.483. A warning on flex packages (tear risk), info on rigid |
| Coverlay opening to pad (new) | 0.10 | 0.10 (3.9 mil) | JLC-F 0.1 per side; Epec-HD ≥ 3 mil; Rush registration ±0.20 (single source) |
| Minimum coverlay web (new) | 0.50 | 0.50 (19.7 mil) | JLC-F removes bridges under 0.5; Epec-HD ≈ 0.51. Others allow less: PCBWay-F 0.20, Sierra-CL 0.25, Rush 0.30 / 0.25 |
| Pads and vias from a stiffener edge or bend line (new) | 1.0 | 1.0 (39 mil) | **Rule of thumb**, from JLC-blog2 (stiffener ≥ 1.0 past the pad). Sierra-2223 says vias near a stiffener edge crack, no number. IPC-2223C via to rigid–flex transition 1.27 mm (Epec, citing it) |
| Default board thickness | 1.6 (63 mil) | 0.20 (7.9 mil) | Flex: JLC-F 2-layer 0.11–0.20 without stiffener |
| Everything else | as Advanced | as Standard | Flex sources give no number for slots, hole spacing, thermals, castellations, or BGA pads, so Flex HDI keeps Standard's (BGA pad: Advanced's 0.28) |

The new rules in Prototype, Standard, and Advanced: laser microvia 0 (none), ring 0.064, and the three
flex rules as in Flex HDI (they apply only to flex packages).

**Where sources disagree:** coverlay web runs from 0.20 mm (PCBWay-F) to 0.51 mm (Epec-HD); JLC's
capabilities page and blog disagree on flex copper to edge (0.3 vs 0.2); microvia aspect ratio is 0.75:1
at the fabs (Sierra-H, Sierra-F) and 1:1 in IPC-2226 (secondary) and NextPCB; bend ratios vary widely
(single layer 3–6× at PCBWay-F, 6× at JLC-F and Sierra-2223, 10× at OSH-F).

**Not checked yet:** microvia aspect ratio (needs the dielectric thickness), stacked vs staggered
microvias (needs drill spans), bend radius (needs the bend), teardrops.

## What changed in this audit

| Rule | Was (P / S / A) | Now | Why |
|---|---|---|---|
| Minimum drill, S | 0.20 (7.9 mil) | 0.25 (9.8 mil) | OSH and AC state 10 mil; 0.20 was below several mainstream houses |
| Aspect ratio, S / A | 10 / 12 | 8 / 10 | PCBWay-A puts 10:1 in its medium process and 12:1 in its high process |
| Ring PTH, P / S | 0.20 / 0.15 (7.9 / 5.9 mil) | 0.25 / 0.20 (9.8 / 7.9 mil) | JLC's recommended values (its 0.15 / 0.18 are absolute minimums) |
| Ring via, S | 0.10 (3.9 mil) | 0.13 (5.1 mil) | PCBWay-A normal process |
| Mask dam, P | 0.12 (4.7 mil) | 0.13 (5.1 mil) | JLC black/white |
| Silk text, S / A | 0.80 / 0.60 (31 / 24 mil) | 1.0 / 0.80 (39 / 31 mil) | JLC 1.0; PCBWay-S 0.8 |
| Silk line, A | 0.10 (3.9 mil) | 0.127 (5 mil) | AC 0.005 in; no source went to 0.10 |
| Slot, P / A | 0.60 / 0.45 (24 / 17.7 mil) | 0.50 / 0.35 (19.7 / 13.8 mil) | Now "plated slot"; JLC 0.5 / 0.35. Non-plated slots got their own rule |
| Largest via drill, S / A | 0.40 / 0.30 (15.7 / 11.8 mil) | 0.45 (17.7 mil) | PCBWay-A's via definition; one value for all profiles |
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
| `copper-balance` | copper balance | info per board; warn per mirrored layer pair | Raster coverage inside the outline. Not warned on flex |
| `microvia` | laser microvia, ring | info per laser drill size | Plated holes under the minimum drill but at least the laser minimum; their ring uses the microvia ring |
| `coverlay`, `coverlay-web`, `flex-edge` | the three flex rules | warn; error for a pad under coverlay | Flex packages only; see docs/flex.md |

## Candidates not added

- **Acid traps.** Needs the trace graph and junction angles; Fabcheck has no trace graph yet.
- **Separate inner and outer layer limits.** Sources give finer inner limits; one value that matches the
  outer limit is the conservative choice.
- **Copper weight.** Limits grow with copper weight (JLC 0.16 mm (6.3 mil) space at 2 oz, mask dam 0.20 at 2 oz),
  but copper weight is not in the Gerbers. Enter heavier-copper numbers in a custom profile.
- **IPC class selector.** IPC-6012 rings (Class 3 external 0.05 mm (2 mil), internal 0.025 mm (1 mil), no breakout;
  Class 2 allows 90° breakout) are acceptance values for the finished board, not design values. The
  IPC-2221 land formula (land = hole + 2 × ring + fabrication allowance, 0.2 mm (7.9 mil) at Level C) yields design
  values above all three profiles' rings.
- **Text height check.** Needs stroke clustering into characters; the rule is kept.

## Old runs

A run stores every rule it used in `run.settings.rules`. Reopening it pins those rules. Rules added since
(the ones above) were not in the run; they fall back to the built-in profile the run named (or Standard),
and the console says that their checks did not exist when the run was made.
