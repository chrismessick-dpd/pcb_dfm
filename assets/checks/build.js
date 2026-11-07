// Build consistency: are all outputs from the same Altium variant, does the ODB++ component data agree
// with the BOM and pick-and-place, and does the stencil (paste) match what is fitted?
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;
  const norm = s => String(s || '').trim().toLowerCase();
  const T = { odbMove: 0.05, thtPin: 0.05, shown: 30, pasteCenter: 0.15 };
  // Library names that are not part numbers ("Resistor_100k_+/-1%_0603…", "empty_part_name").
  const GENERIC = /resistor|capacitor|inductor|header|empty_part|%|\s/i;

  C.define('Assembly', 'checks/build.js', [
    { check: 'variant', name: 'Build variant', looks: 'Whether every output comes from the same Altium variant, and whether outputs made without a variant still carry parts the BOM leaves off.',
      sev: { error: 'outputs come from different variants', warn: 'no variant, but placed parts have no BOM line', info: 'the variant in use' },
      uses: ['Variant names in output headers (PnP, BOM, Gerber comments)', 'BOM', 'Pick-and-place'], example: 'Outputs come from different variants: Production vs [No Variations]' },
    { check: 'odb', name: 'ODB++ vs BOM and pick-and-place', looks: 'ODB++ component data against the BOM (fitted, not placed, missing) and the pick-and-place (side, position).',
      sev: { error: 'a fitted part is marked not placed or missing in ODB++, or the sides disagree', warn: 'parts placed in ODB++ but not on the BOM, or PnP parts missing from ODB++', info: 'counts, and position offsets (normal for connectors)' },
      uses: ['ODB++ components (extracted odb/ tree)', 'BOM', 'Pick-and-place'], rules: () => [`Positions agree within ${Fab.fmtLen(T.odbMove)}; larger offsets on the same side are listed as info, since ODB++ uses the footprint origin.`, `Pad-only designators (${C.pattern(C.PAD_ONLY)}) are skipped.`],
      example: 'R33 is on the BOM but ODB++ marks it not placed' },
    { check: 'odb-pn', name: 'ODB++ part vs BOM part number', looks: "The board's part name in ODB++ against the BOM's part number and name.", sev: { warn: 'it names a different part' },
      uses: ['ODB++ component part name', 'BOM MPN, name, MPN 2'], rules: () => [`Generic library names are skipped: containing ${C.pattern(GENERIC).split('|').join(', ')} or a space, or with more than one underscore.`,
        'Names that start with a digit are value labels ("10K, 0402"); the BOM audit compares their value with the part number (check value).',
        'Letters and digits only are compared, so punctuation does not count; a name that is the part number without its packaging suffix (BSS138 for BSS138LT1G), or with a library prefix (IC_…), matches.'],
      example: 'BOM row 11: MPN TLV70033DDCR ≠ board part TLV70033DDCT' },
    { check: 'paste', name: 'Paste per pin', looks: 'Stencil apertures on every SMD pin of fitted parts, and none on unfitted parts.',
      sev: { error: 'an unfitted part gets paste, or a fitted part gets none on any pad', warn: 'a fitted part has some SMD pads without paste, or a test point gets paste (or none, when the BOM fits it)', info: 'how many parts were checked' }, uses: ['ODB++ component pins', 'Paste layers', 'BOM DNP', 'Copper pads'],
      rules: () => [`Pins within ${Fab.fmtLen(T.thtPin)} of a drill hit are through-hole and need no paste.`, 'Windowed paste inside an exposed/thermal pad counts for that pad.', 'Test points (by designator TP#, a TP/TEST_POINT/TESTPAD footprint, or a "Test Point" comment or ODB++ part name) are warnings, not errors: unfitted with paste, or fitted by the BOM with none. The Findings list folds them into one row.',
        `Fiducials and mounting holes are skipped; the first ${T.shown} parts with some pads missing paste are listed.`],
      example: 'J4 is not fitted but the stencil prints paste on 6 pad(s)' },
    { check: 'paste-center', name: 'Placement vs pasted pads', looks: 'Parts with paste on only some of their pads (alternate-position footprints): whether the pick-and-place point is the center of the pasted pads, where the part actually goes.',
      sev: { warn: 'the placement is off the pasted pads', info: 'every such part is placed on its pasted pads' }, uses: ['ODB++ component pins', 'Paste layers', 'Pick-and-place X/Y'],
      rules: () => [`Off when the center of the pasted pads is more than ${Fab.fmtLen(T.pasteCenter)} from the pick-and-place point.`, 'Needs at least two pasted pads and at least one without paste. Connectors are skipped (unpasted shell or peg pads are usual).'],
      example: 'R9: placement is 0.50 mm (19.7 mil) from the pads that get paste' },
  ]);

  function* run(pkg, out) {
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'Assembly', check, severity, title, detail }, extra || {})));
    const bom = pkg.bom, pnp = pkg.pnp, odb = pkg.odb;
    const bomDes = new Map();
    if (bom) for (const l of bom.lines) for (const d of l.des) if (!bomDes.has(d)) bomDes.set(d, l);
    const fitted = d => bomDes.has(d) && !bomDes.get(d).dnp;
    const padOnly = d => C.isPadOnly(pkg, d);

    // ---- variant ----
    yield 'Variant';
    if (pkg.variants.length) {
      const names = [...new Set(pkg.variants.map(v => v.variant || '(no variant)'))];
      const list = pkg.variants.map(v => `${v.source.split('/').slice(-2).join('/')}: ${v.variant || 'no variant'}`).join('\n');
      if (names.length > 1) add('variant', 'error', 'Outputs come from different variants: ' + names.join(' vs '), list + '\nFab/assembly outputs that ignore the variant still carry not-fitted parts (paste, ODB++ placement).');
      else add('variant', 'info', 'All outputs from ' + (names[0] === '(no variant)' ? 'no variant' : 'variant "' + names[0] + '"'), list);
      const noVariant = pkg.variants.some(v => !v.variant);
      const unlisted = pnp && bom ? pnp.parts.filter(p => !bomDes.has(p.des) && !padOnly(p.des)) : [];
      if (noVariant && unlisted.length) add('variant', 'warn', 'Outputs were generated without a variant, but the BOM leaves parts off',
        `${unlisted.length} placed part(s) have no BOM line (${unlisted.slice(0, 12).map(p => p.des).join(', ')}${unlisted.length > 12 ? '…' : ''}). ` +
        'Generate every output from a variant that marks them Not Fitted (in Altium also enable "allow fabrication output variations"), so the stencil and ODB++ drop them.');
    }

    if (!odb || !odb.comps.length) {
      if (pkg.files.some(f => f.cls.type === 'odb' || f.cls.type === 'odb-archive')) add('odb', 'info', 'ODB++ present but no component layers found', 'Only extracted odb/ trees are read in this version.');
      return;
    }

    // ---- ODB++ vs PnP / BOM ----
    yield 'ODB++ vs PnP / BOM';
    const comps = odb.comps;
    const byDes = new Map(comps.map(c => [c.des, c]));
    const noPop = comps.filter(c => c.noPop);
    add('odb', 'info', `ODB++: ${comps.length} components, ${noPop.length} flagged not placed`, (noPop.length ? 'Not placed: ' + noPop.map(c => c.des).sort(Fab.natCmp).join(', ') + '. ' : '') + `From ${odb.root}.`);

    if (bom) {
      const inBomNoPop = noPop.filter(c => fitted(c.des));
      for (const c of inBomNoPop) add('odb', 'error', `${c.des} is on the BOM but ODB++ marks it not placed`, `${c.part}. The assembler's machine data will skip it.`, { refs: [c.des] });
      const placedNoBom = comps.filter(c => !c.noPop && !bomDes.has(c.des) && !padOnly(c.des));
      if (placedNoBom.length) add('odb', 'warn', `${placedNoBom.length} part(s) placed in ODB++ but not on the BOM`, placedNoBom.map(c => `${c.des} (${c.part})`).sort(Fab.natCmp).join(', ') + '. Either add BOM lines or mark them Not Fitted in the variant used for every output.', { refs: placedNoBom.map(c => c.des) });
      const missing = [...bomDes.keys()].filter(d => fitted(d) && !byDes.has(d));
      if (missing.length) add('odb', 'error', `${missing.length} BOM designator(s) missing from ODB++`, missing.join(', '), { refs: missing });
      // Part number: the board's part name should be the BOM MPN (or its Name)
      const badPn = [];
      for (const c of comps) {
        const l = bomDes.get(c.des);
        if (!l || c.noPop) continue;
        if (!l.mpn) continue;   // the BOM audit's mpn check already reports the missing part number
        const ok = [l.mpn, l.name, l.mpn2].some(pn => Fab.parts.samePn(c.part, pn));
        // Generic library names ("Resistor_100k_+/-1%_0603…", "empty_part_name") are not part numbers,
        // and value labels ("10K,_0402", "4.7uF,_X5R") are compared by value in the BOM audit.
        const generic = GENERIC.test(c.part) || (c.part.match(/_/g) || []).length > 1 || Fab.parts.isValueLabel(c.part);
        if (!ok && !generic) badPn.push({ c, l });
      }
      const byLine = new Map();
      for (const b of badPn) { if (!byLine.has(b.l)) byLine.set(b.l, []); byLine.get(b.l).push(b.c); }
      for (const [l, cs] of byLine) add('odb-pn', 'warn', `BOM row ${l.row}: MPN ${l.mpn} ≠ board part ${cs[0].part}`,
        `${cs.map(c => c.des).join(', ')}. The board data (ODB++) names a different part than the BOM's part number column; a buyer purchases from the BOM. Confirm the substitution is equivalent.`, { refs: cs.map(c => c.des), row: l.row });
    }

    if (pnp) {
      const moved = [], absent = [];
      const off = (pkg.assembly && pkg.assembly.offset) || { dx: 0, dy: 0 };
      for (const p of pnp.parts) {
        const c = byDes.get(p.des);
        if (!c) { absent.push(p.des); continue; }
        const d = Math.hypot(c.x - p.gx, c.y - p.gy);
        if (d > T.odbMove || c.side !== p.side) moved.push({ p, c, d });
      }
      if (absent.length) add('odb', 'warn', `${absent.length} PnP designator(s) not in ODB++`, absent.join(', '));
      for (const m of moved.filter(m => m.c.side !== m.p.side)) add('odb', 'error', `${m.p.des}: PnP says ${m.p.side}, ODB++ says ${m.c.side}`, m.c.part, { at: { x: m.p.gx, y: m.p.gy }, refs: [m.p.des] });
      // The PnP point is the footprint center while ODB++ uses the footprint origin, so offsets on
      // connectors are normal. List them for reference only.
      const offs = moved.filter(m => m.c.side === m.p.side);
      if (!moved.length) add('odb', 'info', 'Pick-and-place matches ODB++ positions and sides', `${pnp.parts.length} placements within ${Fab.fmtLen(T.odbMove)}.`);
      else if (offs.length) add('odb', 'info', `${offs.length} part(s) have a different PnP center than ODB++ origin`,
        offs.slice(0, 20).map(m => `${m.p.des} ${Fab.fmtLen(m.d, 2)}`).join(', ') + '. Normal when a footprint origin is not its center (connectors); a reason to double-check if it is a passive.', { refs: offs.map(m => m.p.des) });
    }

    // ---- paste per pin ----
    yield 'Paste per pin';
    const paste = pkg.layers.paste;
    if (paste.top || paste.bottom) {
      const fittedNoPaste = [], unfittedPaste = [], partial = [];
      const holes = new C.__HitIndex(pkg.hits);
      let checked = 0;
      const used = new Set();
      for (const c of comps) {
        if (c.mount === 'tht') continue;
        const layer = paste[c.side];
        if (!layer) continue;
        const isFitted = bom ? fitted(c.des) && !c.noPop : !c.noPop;
        // Pins on a drill hit are through-hole (e.g. a USB shell); they get no paste.
        const smdPins = c.pins.filter(pin => !holes.near(pin.x, pin.y, T.thtPin));
        const cu = c.side === 'top' ? pkg.layers.top : pkg.layers.bottom;
        const hits = smdPins.map(pin => {
          const h = C.primsAt(layer, pin.x, pin.y);
          if (h.length || !cu || cu.polarity === 'negative') return h;
          // Windowed paste on an exposed/thermal pad: paste apertures inside the pad but not on its center.
          const pad = C.primsAt(cu, pin.x, pin.y, p => p.k === 'F')[0];
          if (!pad) return h;
          return [...C.index(layer).query(pad.bbox)].filter(q => q.dark && Fab.bbox.contains(pad.bbox, q.bbox, 0.01));
        });
        hits.forEach(h => h.forEach(p => used.add(p)));
        const withPaste = hits.filter(h => h.length).length;
        // Test points are pad-only, but paste on one is still worth a warning (a solder bump under the
        // probe, a Tag-Connect pad that must stay flat), and so is none on one the BOM fits.
        const tp = C.isTestPoint(pkg, c.des);
        if (isFitted) {
          checked++;
          if (smdPins.length && withPaste < smdPins.length && (!padOnly(c.des) || (tp && bom && !withPaste))) fittedNoPaste.push({ c, missing: smdPins.length - withPaste, of: smdPins.length, tp });
          // Some pads pasted and some not (an alternate-position footprint): the part sits on the pasted ones.
          if (withPaste >= 2 && withPaste < smdPins.length && !padOnly(c.des)) partial.push({ c, pins: smdPins.filter((p, i) => hits[i].length), of: smdPins.length });
        } else if (withPaste && (!padOnly(c.des) || tp)) unfittedPaste.push({ c, n: withPaste, tp });
      }
      for (const u of unfittedPaste) {
        if (u.tp) add('paste', 'warn', `${u.c.des} is not fitted but the stencil prints paste on ${u.n} pad(s)`, `Test point, ${u.c.part} (${u.c.side}). Paste leaves a solder bump on the pad: fine if the fixture's probes want one, but a Tag-Connect or pogo-pin pad must stay flat. Remove it from the paste layer if it isn't wanted.`, { at: { x: u.c.x, y: u.c.y }, refs: [u.c.des], side: u.c.side });
        else add('paste', 'error', `${u.c.des} is not fitted but the stencil prints paste on ${u.n} pad(s)`, `${u.c.part} (${u.c.side}). Solder on unfitted pads (e.g. Tag-Connect or debug headers) causes bridges and poor probe contact. Generate the paste layers from the build variant.`, { at: { x: u.c.x, y: u.c.y }, refs: [u.c.des], side: u.c.side });
      }
      for (const f of fittedNoPaste.filter(f => f.tp)) add('paste', 'warn', `${f.c.des}: the BOM fits this test point but it gets no paste`, `${f.c.part} (${f.c.side}). A soldered test point (a loop or SMD pin) needs paste; a bare pad doesn't, and then it needs no BOM line.`, { at: { x: f.c.x, y: f.c.y }, refs: [f.c.des], side: f.c.side });
      // A fitted part with no paste on any pad cannot be reflowed: the stencil is missing its apertures.
      for (const f of fittedNoPaste.filter(f => !f.tp && f.missing === f.of)) add('paste', 'error', `${f.c.des}: none of its ${f.of} SMD pads get paste`, `${f.c.part} (${f.c.side}). The stencil has no apertures for this part, so it can't be soldered in reflow. Check the paste layer of its footprint (paste mask expansion, or pads set to no paste).`, { at: { x: f.c.x, y: f.c.y }, refs: [f.c.des], side: f.c.side });
      for (const f of fittedNoPaste.filter(f => !f.tp && f.missing < f.of).slice(0, T.shown)) add('paste', 'warn', `${f.c.des}: ${f.missing} of ${f.of} SMD pads have no paste`, `${f.c.part} (${f.c.side}). Confirm it is intended (e.g. a battery contact pad, or the unused position of an alternate-position footprint); windowed paste on thermal pads is already recognized.`, { at: { x: f.c.x, y: f.c.y }, refs: [f.c.des], side: f.c.side });
      let orphan = 0;
      for (const side of ['top', 'bottom']) if (paste[side]) for (const p of paste[side].prims) if (p.dark && !used.has(p)) orphan++;
      add('paste', 'info', `Paste checked on ${checked} fitted SMD parts`, `${fittedNoPaste.length} with missing paste, ${unfittedPaste.length} unfitted with paste. ${orphan} paste feature(s) not on any component pin center (windowed thermal pads produce some).`);

      // ---- placement vs pasted pads ----
      // On an alternate-position footprint (a 0 Ω that can sit on pads 1-2 or 1-3) the pick-and-place
      // point is the footprint's center, but the part goes on the pads that get paste.
      const placedAt = new Map(((pnp && pnp.parts) || []).filter(p => p.gx != null).map(p => [p.des, p]));
      const offPaste = [];
      for (const q of partial) {
        const p = placedAt.get(q.c.des);
        if (!p || C.connectorLike(p.des, p.description)) continue;
        const b = Fab.bbox.empty();
        for (const pin of q.pins) Fab.bbox.addPt(b, pin.x, pin.y);
        const ctr = Fab.bbox.center(b), d = Math.hypot(ctr.x - p.gx, ctr.y - p.gy);
        if (d > T.pasteCenter) offPaste.push({ q, p, ctr, d });
      }
      for (const o of offPaste.slice(0, T.shown)) add('paste-center', 'warn', `${o.p.des}: placement is ${Fab.fmtLen(o.d, 2)} from the pads that get paste`,
        `${o.q.pins.length} of ${o.q.of} pads get paste (${o.q.pins.map(pin => pin.name || pin.pin || '?').join(', ')}), centered at ${o.ctr.x.toFixed(3)}, ${o.ctr.y.toFixed(3)} mm; the pick-and-place says ${o.p.gx.toFixed(3)}, ${o.p.gy.toFixed(3)} mm (${o.p.footprint}). ` +
        'The machine centers the part on the pick-and-place point, so it would land between positions. Move the footprint origin to the fitted position, or give the assembler the corrected point.',
        { at: { x: o.ctr.x, y: o.ctr.y }, refs: [o.p.des], side: o.p.side });
      if (partial.length && !offPaste.length) add('paste-center', 'info', `${partial.length} part(s) with paste on only some pads are placed on their pasted pads`, partial.map(q => q.c.des).sort(Fab.natCmp).join(', ') + '.', { refs: partial.map(q => q.c.des) });
    }
    return;
  }

  C.build = C.runner(run);
})(window.Fab);
