// Package-level checks: inventory, missing items, set consistency, drill report, alignment.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;

  function* run(pkg, out) {
    const cat = 'Package';
    const L = pkg.layers;
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: cat, check, severity, title, detail }, extra || {})));

    // ---- missing items ----
    yield 'Missing items';
    const need = [
      [L.top, 'error', 'Top copper'], [L.bottom, 'error', 'Bottom copper'],
      [L.mask.top, 'error', 'Top solder mask'], [L.mask.bottom, 'error', 'Bottom solder mask'],
      [L.silk.top, 'warn', 'Top silkscreen'],
      [L.outline && !L.outline.board.synthetic, 'error', 'Board outline (closed profile)'],
      [pkg.drills.length, 'error', 'NC drill (Excellon)'],
      [pkg.pnp, 'warn', 'Pick-and-place'], [pkg.bom, 'warn', 'BOM'],
    ];
    for (const [ok, sev, what] of need) if (!ok) add('missing', sev, 'Missing: ' + what, 'The package has no file recognized as ' + what.toLowerCase() + '.');
    const has = t => pkg.files.some(f => f.cls.type === t);
    const rec = [
      [L.paste.top || L.paste.bottom, 'Paste layer'], [has('fab-pdf'), 'Fabrication drawing (PDF)'], [has('assy-pdf'), 'Assembly drawing (PDF)'],
      [pkg.ipc356, 'IPC-D-356 netlist (needed for electrical test)'], [pkg.drr, 'Drill report'],
      [has('odb') || has('odb-archive') || has('ipc2581'), 'ODB++ or IPC-2581'],
    ];
    for (const [ok, what] of rec) if (!ok) add('missing', 'info', 'Not included: ' + what, 'Recommended but not required.');

    // ---- gerber sets ----
    yield 'Gerber sets';
    if (pkg.sets.length > 1) {
      add('sets', 'info', `${pkg.sets.length} Gerber sets in package`,
        `Using ${pkg.set.dir} (${pkg.set.x2 ? 'Gerber X2' : 'RS-274X'}, ${pkg.set.files.length} files). Also found: ` +
        pkg.sets.slice(1).map(s => `${s.dir} (${s.x2 ? 'X2' : '274X'}, ${s.files.length} files)`).join(', ') +
        '. Make sure the fab only receives one set, or say which one is authoritative.');
      const cu = pkg.sets.map(s => s.copper);
      if (new Set(cu).size > 1) add('sets', 'error', 'Gerber sets disagree on copper layer count', 'Copper layers per set: ' + pkg.sets.map(s => `${s.dir}: ${s.copper}`).join(', '));
    }

    // SameCoordinates GUID within the active set
    const guids = new Map();
    for (const f of pkg.set.files) {
      const g = f.layer.attrs['.SameCoordinates'];
      if (g && g[0]) { if (!guids.has(g[0])) guids.set(g[0], []); guids.get(g[0]).push(f.name); }
    }
    if (guids.size > 1) add('guid', 'error', 'Gerber files come from different output runs',
      'TF.SameCoordinates differs within ' + pkg.set.dir + ': ' + [...guids.entries()].map(([g, fs]) => `${g.slice(0, 8)}… (${fs.length} files)`).join(', '));
    else if (guids.size === 1) add('guid', 'info', 'Gerber set shares one coordinate GUID', 'All ' + [...guids.values()][0].length + ' files declare the same TF.SameCoordinates.');

    // ---- copper count ----
    yield 'Copper layer count';
    const nCu = L.copper.length;
    const counts = [`Gerber: ${nCu}`];
    let mismatch = false;
    const x2max = Math.max(0, ...L.copper.map(l => (l.attrs['.FileFunction'] && l.side === 'bottom') ? parseInt(String(l.attrs['.FileFunction'][1]).replace('L', ''), 10) : 0));
    if (x2max) { counts.push(`X2 bottom index: L${x2max}`); if (x2max !== nCu) mismatch = true; }
    if (pkg.ipc356) {
      const t = pkg.ipc356.text();
      const m = /Layer Stackup -+\s*\n([\s\S]*?)C\s+-{10,}/.exec(t);
      if (m) {
        const n = m[1].split(/\r?\n/).map(s => s.replace(/^C\s*/, '').trim()).filter(Boolean).length;
        counts.push(`IPC-356 stackup: ${n}`);
        if (n !== nCu) mismatch = true;
      }
    }
    add('layers', mismatch ? 'error' : 'info', mismatch ? 'Copper layer count disagrees between files' : `${nCu}-layer board`, counts.join(' · '));

    // ---- units / format ----
    yield 'Units and format';
    const units = new Set(pkg.set.files.map(f => f.layer.units || '?'));
    const fmts = new Set(pkg.set.files.map(f => f.layer.format || '?'));
    add('units', units.size > 1 || units.has('?') ? 'warn' : 'info', 'Gerber units: ' + [...units].join(', '),
      'Formats: ' + [...fmts].join(', ') + '. Drill: ' + pkg.drills.map(f => `${f.name} ${f.drill.units || '?'} ${f.drill.format || ''} ${f.drill.zeros || ''}`).join('; '));
    for (const f of pkg.drills) if (!f.drill.units) add('units', 'warn', 'Drill file has no unit declaration', f.name + ' does not state METRIC or INCH; the fab will have to guess.');
    for (const f of pkg.set.files) for (const w of f.layer.warnings) add('parse', 'warn', 'Gerber parse note: ' + f.name, w);
    for (const f of pkg.files) if (f.cls.error) add('parse', 'error', 'Could not read ' + f.name, f.cls.error);

    // ---- drill report vs drill files ----
    yield 'Drill report vs drill files';
    if (pkg.drr && pkg.drills.length) {
      const tools = [];
      for (const f of pkg.drills) for (const t of Object.values(f.drill.tools)) tools.push(t);
      const bad = [];
      let total = 0;
      for (const r of pkg.drr) {
        total += r.count;
        // Same tool number and size first (Altium numbers tools consistently across files), else size only.
        const sameSize = tools.filter(t => t.dia != null && Math.abs(t.dia - r.dia) < 0.0015 && (t.plated !== false) === r.plated);
        const byNum = sameSize.filter(t => t.t === r.tool);
        const cands = byNum.length ? byNum : sameSize;
        const got = cands.reduce((s, t) => s + (r.type === 'Slot' ? t.slots : t.hits), 0);
        if (got !== r.count) bad.push(`T${r.tool} ${r.dia} mm ${r.plated ? 'PTH' : 'NPTH'} ${r.type}: report ${r.count}, drill files ${got}`);
      }
      if (bad.length) add('drr', 'error', 'Drill files disagree with drill report', bad.join('\n'));
      else add('drr', 'info', 'Drill files match the drill report', `${pkg.drr.length} tools, ${total} holes.`);
    }

    // ---- outline and extents ----
    yield 'Outline and extents';
    const o = L.outline;
    if (o && !o.board.synthetic) {
      const open = o.loops.filter(l => !l.closed);
      if (open.length) add('outline', 'warn', `Outline layer has ${open.length} open path(s)`, 'On ' + o.file.name + '. Open segments next to the profile can be read as extra routing.');
      const bb = o.board.bbox;
      add('outline', 'info', `Board ${(bb[2] - bb[0]).toFixed(2)} × ${(bb[3] - bb[1]).toFixed(2)} mm`,
        `Outline from ${o.file.name}${o.cutouts.length ? `, ${o.cutouts.length} internal cutout(s)` : ''}.`, { bbox: bb });
      const outside = [];
      for (const h of pkg.hits) if (!C.insideBoard(o, h.x, h.y)) outside.push(h);
      for (const h of C.capped(outside, 20).shown) add('extents', 'error', `Drill hit outside the board (⌀${h.dia} mm)`, `At ${h.x.toFixed(3)}, ${h.y.toFixed(3)} mm.`, { at: { x: h.x, y: h.y } });
      if (outside.length > 20) add('extents', 'error', `…and ${outside.length - 20} more drill hits outside the board`, '');
      for (const lay of L.copper) {
        if (lay.polarity === 'negative' || !Fab.bbox.valid(lay.bbox)) continue;
        if (!Fab.bbox.contains(bb, lay.bbox, 0.01)) add('extents', 'warn', 'Copper extends past the outline bounding box', lay.file.name, { bbox: lay.bbox, layer: lay.file.name });
      }
    } else if (o) add('outline', 'error', 'No closed board outline found', 'Using the copper extents instead. Checks that need the edge are approximate.');

    // ---- drill ↔ copper alignment ----
    yield 'Drill ↔ copper alignment';
    if (L.top && pkg.hits.length) {
      const plated = pkg.hits.filter(h => h.plated);
      let onPad = 0;
      for (const h of plated) if (C.primsAt(L.top, h.x, h.y).length) onPad++;
      const pct = plated.length ? onPad / plated.length : 1;
      add('align', pct < 0.6 ? 'error' : pct < 0.95 ? 'warn' : 'info',
        pct < 0.6 ? 'Drill file does not line up with copper' : `${Math.round(pct * 100)}% of plated holes land on top copper`,
        `${onPad} of ${plated.length} plated hits are covered by top copper.` + (pct < 0.6 ? ' Check the drill origin, units and zero suppression.' : ''));
    }
    return;
  }

  C.package = C.runner(run);
})(window.Fab);
