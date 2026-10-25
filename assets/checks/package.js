// Package-level checks: inventory, missing items, set consistency, drill report, alignment.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;

  // [what, severity, present?]
  const REQUIRED = [
    ['Top copper', 'error', (pkg, L) => L.top], ['Bottom copper', 'error', (pkg, L) => L.bottom],
    ['Top solder mask', 'error', (pkg, L) => L.mask.top], ['Bottom solder mask', 'error', (pkg, L) => L.mask.bottom],
    ['Top silkscreen', 'warn', (pkg, L) => L.silk.top],
    ['Board outline (closed profile)', 'error', (pkg, L) => L.outline && !L.outline.board.synthetic],
    ['NC drill (Excellon)', 'error', pkg => pkg.drills.length],
    ['Pick-and-place', 'warn', pkg => pkg.pnp], ['BOM', 'warn', pkg => pkg.bom],
  ];
  const has = (pkg, t) => pkg.files.some(f => f.cls.type === t);
  const RECOMMENDED = [
    ['Paste layer', (pkg, L) => L.paste.top || L.paste.bottom], ['Fabrication drawing (PDF)', pkg => has(pkg, 'fab-pdf')],
    ['Assembly drawing (PDF)', pkg => has(pkg, 'assy-pdf')], ['IPC-D-356 netlist (needed for electrical test)', pkg => pkg.ipc356],
    ['Drill report', pkg => pkg.drr], ['ODB++ or IPC-2581', pkg => has(pkg, 'odb') || has(pkg, 'odb-archive') || has(pkg, 'ipc2581')],
  ];
  const T = { drrDia: 0.0015, alignError: 0.6, alignWarn: 0.95, extentsTol: 0.01, shown: 20 };

  C.define('Package', 'checks/package.js', [
    { check: 'missing', name: 'Missing files', looks: 'Whether the package has each file a fab and assembler need, and the ones that are recommended.',
      sev: { error: 'a required fab file is missing', warn: 'top silkscreen, pick-and-place or BOM is missing', info: 'a recommended file is not included' },
      uses: ['File classification (names, Gerber X2 file functions)'],
      rules: () => ['Required: ' + REQUIRED.map(r => `${r[0]} (${r[1]})`).join(', ') + '.', 'Recommended: ' + RECOMMENDED.map(r => r[0]).join(', ') + '.'],
      example: 'Missing: Bottom solder mask' },
    { check: 'sets', name: 'Gerber sets', looks: 'More than one set of Gerbers in the package, and whether the sets agree on the copper layer count.',
      sev: { error: 'the sets have different copper layer counts', info: 'more than one set was found' },
      uses: ['Gerber files grouped by folder'], rules: () => ['The first set found (Gerber X2 preferred) is the one checked.'],
      example: '2 Gerber sets in package' },
    { check: 'guid', name: 'One output run', looks: 'Whether every Gerber in the set comes from the same CAD output run.',
      sev: { error: 'files declare different coordinate GUIDs', info: 'all files share one' }, uses: ['Gerber X2 attribute TF.SameCoordinates'],
      example: 'Gerber files come from different output runs' },
    { check: 'layers', name: 'Copper layer count', looks: 'The copper layer count in the Gerbers against the X2 layer index and the IPC-356 stackup.',
      sev: { error: 'the counts disagree', info: 'the count, when they agree' }, uses: ['Gerber copper layers', 'X2 .FileFunction', 'IPC-356 stackup comment'],
      example: 'Copper layer count disagrees between files' },
    { check: 'units', name: 'Units and format', looks: 'Gerber units and coordinate formats, and whether each drill file states its units.',
      sev: { warn: 'mixed or unknown units, or a drill file with no unit declaration', info: 'the units and formats in use' }, uses: ['Gerber %MO / %FS', 'Excellon METRIC / INCH header'],
      example: 'Drill file has no unit declaration' },
    { check: 'parse', name: 'File parsing', looks: 'Files that could not be read, and notes the Gerber parser raised.',
      sev: { error: 'a file could not be read', warn: 'the parser noted something unusual' }, uses: ['Every file in the package'],
      example: 'Gerber parse note: board.GTL' },
    { check: 'drr', name: 'Drill report vs drill files', looks: 'Hole counts per tool in the drill report against the drill files.',
      sev: { error: 'any tool count differs', info: 'all counts match' }, uses: ['Altium drill report (.DRR)', 'Excellon drill files'],
      rules: () => [`Tools match by tool number and size first, else by size (within ${Fab.fmtLen(T.drrDia)}) and plating.`],
      example: 'Drill files disagree with drill report' },
    { check: 'outline', name: 'Board outline', looks: 'A closed board outline, open paths on the outline layer, and the board size.',
      sev: { error: 'no closed outline was found', warn: 'the outline layer has open paths', info: 'board size and cutouts' }, uses: ['Outline / profile Gerber'],
      example: 'Outline layer has 2 open path(s)' },
    { check: 'extents', name: 'Board extents', looks: 'Drill hits outside the board and copper past the outline.',
      sev: { error: 'a drill hit is outside the board', warn: 'a copper layer reaches past the outline bounding box' }, uses: ['Outline', 'Drill files', 'Copper layers'],
      rules: () => [`Copper may pass the outline box by ${Fab.fmtLen(T.extentsTol)}.`, `The first ${T.shown} hits outside are listed.`],
      example: `Drill hit outside the board: ⌀${Fab.fmtLen(0.3)}` },
    { check: 'align', name: 'Drill to copper alignment', looks: 'Whether plated holes land on top copper, which shows the drill file and Gerbers share an origin and units.',
      sev: { error: `under ${T.alignError * 100}% land on copper`, warn: `under ${T.alignWarn * 100}% land on copper`, info: 'the share that lands' }, uses: ['Drill files', 'Top copper'],
      example: 'Drill file does not line up with copper' },
  ]);

  function* run(pkg, out) {
    const cat = 'Package';
    const L = pkg.layers;
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: cat, check, severity, title, detail }, extra || {})));

    // ---- missing items ----
    yield 'Missing items';
    for (const [what, sev, ok] of REQUIRED) if (!ok(pkg, L)) add('missing', sev, 'Missing: ' + what, 'The package has no file recognized as ' + what.toLowerCase() + '.');
    for (const [what, ok] of RECOMMENDED) if (!ok(pkg, L)) add('missing', 'info', 'Not included: ' + what, 'Recommended but not required.');

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
        const sameSize = tools.filter(t => t.dia != null && Math.abs(t.dia - r.dia) < T.drrDia && (t.plated !== false) === r.plated);
        const byNum = sameSize.filter(t => t.t === r.tool);
        const cands = byNum.length ? byNum : sameSize;
        const got = cands.reduce((s, t) => s + (r.type === 'Slot' ? t.slots : t.hits), 0);
        if (got !== r.count) bad.push(`T${r.tool} ${Fab.fmtLen(r.dia)} ${r.plated ? 'PTH' : 'NPTH'} ${r.type}: report ${r.count}, drill files ${got}`);
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
      add('outline', 'info', `Board ${Fab.fmtSize(bb[2] - bb[0], bb[3] - bb[1], 2)}`,
        `Outline from ${o.file.name}${o.cutouts.length ? `, ${o.cutouts.length} internal cutout(s)` : ''}.`, { bbox: bb });
      const outside = [];
      for (const h of pkg.hits) if (!C.insideBoard(o, h.x, h.y)) outside.push(h);
      for (const h of C.capped(outside, T.shown).shown) add('extents', 'error', `Drill hit outside the board: ⌀${Fab.fmtLen(h.dia)}`, `At ${h.x.toFixed(3)}, ${h.y.toFixed(3)} mm.`, { at: { x: h.x, y: h.y } });
      if (outside.length > T.shown) add('extents', 'error', `…and ${outside.length - T.shown} more drill hits outside the board`, '');
      for (const lay of L.copper) {
        if (lay.polarity === 'negative' || !Fab.bbox.valid(lay.bbox)) continue;
        if (!Fab.bbox.contains(bb, lay.bbox, T.extentsTol)) add('extents', 'warn', 'Copper extends past the outline bounding box', lay.file.name, { bbox: lay.bbox, layer: lay.file.name });
      }
    } else if (o) add('outline', 'error', 'No closed board outline found', 'Using the copper extents instead. Checks that need the edge are approximate.');

    // ---- drill ↔ copper alignment ----
    yield 'Drill ↔ copper alignment';
    if (L.top && pkg.hits.length) {
      const plated = pkg.hits.filter(h => h.plated);
      let onPad = 0;
      for (const h of plated) if (C.primsAt(L.top, h.x, h.y).length) onPad++;
      const pct = plated.length ? onPad / plated.length : 1;
      add('align', pct < T.alignError ? 'error' : pct < T.alignWarn ? 'warn' : 'info',
        pct < T.alignError ? 'Drill file does not line up with copper' : `${Math.round(pct * 100)}% of plated holes land on top copper`,
        `${onPad} of ${plated.length} plated hits are covered by top copper.` + (pct < T.alignError ? ' Check the drill origin, units and zero suppression.' : ''));
    }
    return;
  }

  C.package = C.runner(run);
})(window.Fab);
