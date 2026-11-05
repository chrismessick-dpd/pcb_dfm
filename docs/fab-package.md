# What a fab package should hold (research, 2026-11-03)

This survey covers what fab houses, assembly houses and the Gerber format's owner recommend for a
PCB fabrication and assembly package. It informs Fabcheck's release set (`docs/releases.md`) and
the package Fabcheck will write as its output.

The strongest primary source is Ucamco's guide *PCB Fabrication Data* (Karel Tavernier, V6, 2015),
cited below as "Ucamco" with page numbers:
<https://ucamco.com/files/downloads/file_en/130/pcb-fabrication-data-a-guide_en.pdf>.

**Not verified:**
- **Unreachable requirement pages:** the published file requirements of Würth, Royal Circuits,
  Imagineering and Bay Area Circuits.
- **Aisler:** covered from its forum only.
- **EE forums:** they had little to add beyond the Fedevel forum.

## Where sources agree

1. **Gerber X2 is the baseline.**
   - X2 readers read plain RS-274X, so X2 costs nothing. Ucamco says to always send X2 when the CAD
     tool can (<https://www.ucamco.com/en/gerber/demo-1>).
   - Advanced Circuits, OSH Park, MacroFab and PCBWay all accept or require RS-274X.
   - OSH Park works out layer order from X2 attributes or file extensions.
2. **Plated and non-plated holes go in separate drill files**, one file per drill span, each with
   a full tool table.
   - Sources: Ucamco pp. 22–24; Sierra Circuits
     <https://www.protoexpress.com/blog/pcb-design-output-data-manufacturer-requires/>; Advanced
     Circuits <https://www.advancedpcb.com/en-us/resources/blog/gerber-files-for-pcb-manufacturing/>.
   - OSH Park rejects Altium's binary `.DRL`, drill drawing and drill guide files
     (<https://docs.oshpark.com/design-tools/altium-designer/>).
3. **A fabrication drawing** carries what the image data can't.
   - Contents: outline, drill chart, title block (part number, revision, units), stackup with
     impedance targets, IPC class, material, finish, mask color, special vias, and tolerances.
   - Its notes must match the data, or the fab puts the job on hold.
   - Sources: Sierra Circuits <https://www.protoexpress.com/blog/what-should-pcb-fab-drawing-include/>,
     NCAB <https://www.ncabgroup.com/blog/why-your-standard-pcb-fabrication-notes-needs-updating/>.
4. **A plain-text readme or job file.**
   - Fabs parse text automatically, but not PDF (Ucamco p. 34).
   - Eurocircuits asks for a Gerber job file (`.gbrjob`) with every Gerber set
     (<https://www.eurocircuits.com/Preferred-data-formats>).
   - Screaming Circuits wants a readme covering assembly preferences and approved alternates.
5. **Assembly data from the same revision:** BOM, centroid, assembly drawing and the Gerbers.
   - **BOM:** one MPN per cell, alternates in their own columns, and DNP parts marked with
     quantity 0.
   - **Centroid file:** refdes, X, Y, rotation and side, in mm, from the Gerbers' origin.
   - **No designator ranges** like "R1-R8".
   - Sources: Screaming Circuits
     (<https://www.screamingcircuits.com/faq>), JLCPCB (<https://jlcpcb.com/blog/files-needed-for-pcb-assembly>),
     PCBWay (<https://www.pcbway.com/assembly-file-requirements.html>).
6. **Altium's own release model** (Project Releaser) keeps three things apart:
   - **Source data:** not sent.
   - **Fabrication data:** the `Fabrication.OutJob`.
   - **Assembly data:** the `Assembly.OutJob`, one per variant.
   - It can prefix file names with item and revision, and a release can't be changed once made
     (<https://www.altium.com/documentation/altium-designer/design-project-release>).

## Where sources disagree

- **Gerber and ODB++ together.**
  - Ucamco is against it: no duplicates. Two image formats leave the fab deciding which is valid,
    which it calls especially aggravating (pp. 33, 35).
  - A design-bureau VP says sending both always raises "which do we use", and most fabs default to
    Gerber
    (<https://iconnect007.com/article/129624/who-selects-the-design-data-format-and-why/129627/design>).
  - Sierra Circuits says most fabs now prefer ODB++.
  - No source gives a precedence rule.
  - **Fabcheck's default:** Gerber X2 only, with ODB++ ticked when the fab or assembler asks.
- **Which intelligent format.**
  - Screaming Circuits prefers ODB++ or IPC-2581.
  - Eurocircuits ranks Gerber X3 best for assembly and X2 for bare boards.
  - Robert Feranec (Fedevel forum) sticks to Gerber to share less. ODB++ and IPC-2581 carry every
    net name and layer, and Gerber headers can leak local paths
    (<https://courses.fedevel.com/forum/your-projects/moving-from-gerber-x2-to-odb-or-ipc2581>).
- **Drill format.**
  - Ucamco says to send drill and rout data as Gerber. It finds that Excellon files fail to register
    or are incomplete in a large share of data sets (pp. 17–19).
  - Most fabs still ask for Excellon. Send one, never both.
- **BOM file type.** Ucamco says CSV and never Excel. Screaming Circuits' portal and MacroFab want
  XLSX.
- **IPC-D-356 netlist.** Ucamco says always send it (pp. 27–28), and Sierra Circuits lists it as
  required. Others treat it as optional.
- **Folders.** Eurocircuits wants one flat archive with one design. Altium's Releaser writes a
  folder tree.
- **Schematics.** No assembler requires them. Some EMS guides call them helpful for test and
  rework.

## Proposed layout (Fabcheck's output)

One zip shaped like an Altium manufacturing folder, holding one board and one image format. Every
file name carries `<PN>-<REV>`. Chris chose this over two flat archives (2026-11-03), because it
matches the packages he already sends.

```
<PN>-<REV>_manufacturing.zip
  <PN>-<REV>_manufacturing/
    README.txt                    every file with its SHA-256; board size, layers, thickness;
                                  pick-and-place units; do-not-place parts
    Fabrication/
      <PN>-<REV>_FAB.pdf          fabrication drawing
      Gerber/                     Gerber X2, one per layer: L1_Top … L<n>_Bottom, Mask_, Silk_ and
                                  Paste_ per side, Outline, Coverlay_ and Stiffener_ per side,
                                  Mech<n> (Mech<n>_<type> when X2 names it: Mech30_Fab_Notes)
      NC Drill/                   Excellon PTH.drl and NPTH.drl (one file per span for blind or
                                  buried vias), Drill_Report
      Netlist/                    IPC356.ipc, for electrical test
      ODB/                        only when asked for
    Assembly/
      <PN>-<REV>_ASSY.pdf         assembly drawing
      BOM/                        refdes, qty, MPN, manufacturer, alternates, DNP
      Pick Place/                 refdes, X/Y, rotation, side
```

Eurocircuits asks for a flat zip without folders. For a fab house that insists, the README lists
every file, and the folders hold only a few files each.

Never sent:
- native Altium files and OutJobs;
- reports and logs (status, DRC, `.LDP`, `.REP`);
- aperture lists;
- the binary `.DRL`, drill drawing and drill guide;
- STEP and images;
- a second image format (unless asked for).

### Altium OutJob settings that make that layout easy

- **Gerber X2,** metric, with the same origin and format for every layer.
- **NC drill:** split plated and non-plated, not round and slot holes. Excellon, metric, the same
  origin as the Gerbers.
- **Gerber job file:** turn it on, if this Altium version offers it.
- **Pick-and-place:** CSV, metric, with the center point chosen deliberately (Center, Ref or Pad X/Y
  differ on asymmetric parts:
  <https://www.altium.com/documentation/knowledge-base/altium-designer/calculate-component-pick-and-place-center-of-a-footprint>).
- **File names:** prefix them with the part number and revision, using the Project Releaser's
  naming or the OutJob's output-name field.
- **Container per OutJob:** one container for the fabrication set and one for the assembly set,
  with no ODB++ container unless it's asked for.

## Checks Fabcheck could add

| Check | Source |
| --- | --- |
| One board per archive (no older revision or second design mixed in) | Ucamco, Eurocircuits |
| One image format: not both Gerber and ODB++/IPC-2581; drill as Excellon or Gerber, not both | Ucamco |
| No native CAD files, OutJobs, aperture lists, binary `.DRL`, drill guide/drawing, Office notes in the fab set | Ucamco, OSH Park |
| Plated and non-plated drill split, rather than round/slot | Ucamco, Sierra, Advanced Circuits |
| `.gbrjob` and fab drawing present | Eurocircuits, Sierra |
| Part number and revision agree across file names, readme, drawing and silkscreen | Ucamco, NCAB |
| BOM: one MPN per cell, no designator ranges, DNP quantity 0 | Screaming Circuits, JLCPCB |
| Pick-and-place in mm, every placement inside the outline | JLCPCB |
| No local paths or user names in file headers or comments | Fedevel forum |

Some of these already exist in Fabcheck's package checks. The rest are candidates for after the
release phases.
