// IPC-356 pin checks: pin-1 orientation against the placement rotation (polarity), and pad centers
// against placement centers.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;
  const norm360 = a => ((a % 360) + 360) % 360;
  const angDiff = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)); return Math.min(d, 360 - d); };
  const CONNECTOR = /^(J|P|CN|CON|X|SW|BT|TP|FID|FD|MH|H|LS|BZ)\d/i;
  const connectorLike = des => CONNECTOR.test(des);
  const PIN1 = /^(1|A1|A)$/i;
  const T = { centroidMin: 0.25, centroidSpan: 0.1, group: 3, agree: 10, majority: 0.6, reversed: 15, shown: 30, calibrated: 0.5 };

  C.define('Assembly', 'checks/pins.js', [
    { check: 'ipc356', name: 'IPC-356 netlist', looks: 'Whether the netlist is present, lines up with the Gerbers, and covers every placed part.',
      sev: { warn: 'it does not line up, has no pads, or misses placed parts', info: 'not present (pin checks skipped), or its counts' }, uses: ['IPC-D-356 netlist', 'Copper layers', 'Pick-and-place'],
      rules: () => [`Units are calibrated by sampling pads; at least ${T.calibrated * 100}% must land on copper.`, 'Fiducials need no netlist pads.'],
      example: 'Could not line the IPC-356 netlist up with the Gerbers' },
    { check: 'centroid', name: 'Placement vs pad center', looks: "The pick-and-place point against the center of the part's pads.",
      sev: { warn: 'a part is off center', info: 'connectors and mechanical parts that are off center (usual)' }, uses: ['Pick-and-place X/Y', 'IPC-356 pad positions'],
      rules: () => [`Off center when the distance is over ${T.centroidMin} mm or ${T.centroidSpan * 100}% of the pad span, whichever is larger.`, `Connector-like designators (${C.pattern(CONNECTOR)}) are info only.`],
      example: 'U3: placement is 0.62 mm from its pad center' },
    { check: 'pin1', name: 'Pin 1 orientation', looks: 'Pin 1 direction against the placement rotation, compared across all parts that share a footprint and side.',
      sev: { error: 'a part is about 180° off (reversed polarity)', warn: 'a part is off by another angle', info: 'how many parts were checked' }, uses: ['IPC-356 pin numbers and positions', 'Pick-and-place rotation, footprint'],
      rules: () => [`Pin 1 is the pad named ${C.pattern(PIN1).replace(/[()]/g, '').split('|').join(', ')}.`, `Groups of at least ${T.group} parts; the majority angle needs ${T.majority * 100}% of the group within ${T.agree}°.`, `180° ± ${T.reversed}° is an error. The bottom-side rotation convention that gives fewer outliers is used.`],
      example: 'D4: pin 1 is 180° off from the other 11 SOD-123 parts' },
  ]);

  function* run(pkg, out) {
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'Assembly', check, severity, title, detail }, extra || {})));
    yield 'IPC-356 netlist';
    if (!pkg.ipc356) { add('ipc356', 'info', 'No IPC-356 netlist: pin-1 and pad-center checks skipped', 'Add the IPC-D-356 netlist to the package; fabs also need it for electrical test.'); return; }
    const net = Fab.ipc356.parse(pkg.ipc356.text());
    const pins = net.recs.filter(r => r.des && r.des !== 'VIA');
    if (!pins.length) { add('ipc356', 'warn', 'IPC-356 file has no pad records', pkg.ipc356.path); return; }
    const cal = Fab.ipc356.calibrate(net, pkg);
    if (!cal || cal.hit < cal.of * T.calibrated) {
      add('ipc356', 'warn', 'Could not line the IPC-356 netlist up with the Gerbers', `Best unit guess ${cal ? cal.label : '?'} put ${cal ? cal.hit : 0} of ${cal ? cal.of : 0} sampled pads on copper. The netlist may come from a different revision or origin.`);
      return;
    }
    const k = cal.k;
    for (const r of pins) { r.x = r.xr * k; r.y = r.yr * k; }
    const nets = new Set(pins.map(r => r.net).filter(n => n && n !== 'N/C'));
    const byDes = new Map();
    for (const r of pins) { if (!byDes.has(r.des)) byDes.set(r.des, []); byDes.get(r.des).push(r); }
    add('ipc356', 'info', `IPC-356: ${pins.length} pads on ${byDes.size} parts, ${nets.size} nets`, `Units ${net.units || '?'} read as ${cal.label} (${cal.hit} of ${cal.of} sampled pads land on copper).`);
    pkg.netlist = { pins, byDes, cal };
    if (!pkg.pnp) return;

    yield 'Pad centers vs placements';
    const parts = pkg.pnp.parts.filter(p => p.gx != null && byDes.has(p.des));
    const missing = pkg.pnp.parts.filter(p => !byDes.has(p.des) && !/^(FID|FD)\d/i.test(p.des)).map(p => p.des);
    if (missing.length) add('ipc356', 'warn', `${missing.length} placed part(s) have no pads in the IPC-356 netlist`, missing.slice(0, T.shown).join(', ') + '. The netlist may be from another revision.', { refs: missing });
    const off = [];
    for (const p of parts) {
      const ps = byDes.get(p.des);
      if (ps.length < 2) continue;
      const b = Fab.bbox.empty();
      for (const r of ps) Fab.bbox.addPt(b, r.x, r.y);
      const c = Fab.bbox.center(b);
      p.padCenter = c;
      const d = Math.hypot(c.x - p.gx, c.y - p.gy);
      const span = Math.max(b[2] - b[0], b[3] - b[1]);
      if (d > Math.max(T.centroidMin, T.centroidSpan * span)) off.push({ p, d, c });
    }
    const real = off.filter(o => !connectorLike(o.p.des)).sort((a, b) => b.d - a.d);
    for (const o of real.slice(0, T.shown)) add('centroid', 'warn', `${o.p.des}: placement is ${o.d.toFixed(2)} mm from its pad center`,
      `PnP ${o.p.gx.toFixed(3)}, ${o.p.gy.toFixed(3)} mm vs pads centered at ${o.c.x.toFixed(3)}, ${o.c.y.toFixed(3)} mm (${o.p.footprint}). Pick-and-place machines center the part on this point; check the footprint origin.`,
      { at: { x: o.c.x, y: o.c.y }, refs: [o.p.des], side: o.p.side });
    const conn = off.filter(o => connectorLike(o.p.des));
    if (conn.length) add('centroid', 'info', `${conn.length} connector/mechanical part(s) placed off their pad center`, conn.map(o => `${o.p.des} ${o.d.toFixed(2)} mm`).join(', ') + '. Usual for footprints with the origin on a mounting feature; confirm the assembler uses the same reference.', { refs: conn.map(o => o.p.des) });

    yield 'Pin 1 orientation';
    // Pin 1 direction in the footprint's own frame. By construction every instance of a footprint
    // agrees, so an outlier means the placement rotation contradicts the copper (often by 180°).
    // The bottom-side convention differs between exporters, so pick the one that is consistent.
    const local = { top: [], bottom: [] };
    for (const p of parts) {
      const ps = byDes.get(p.des);
      const p1 = ps.find(r => PIN1.test(r.pin));
      if (!p1 || !p.padCenter || ps.length < 2) continue;
      const vx = p1.x - p.padCenter.x, vy = p1.y - p.padCenter.y;
      if (Math.hypot(vx, vy) < 0.1) continue;
      const th = Math.atan2(vy, vx) * 180 / Math.PI;
      local[p.side].push({ p, th });
    }
    const variants = {
      top: [o => norm360(o.th - o.p.rot)],
      bottom: [o => norm360(o.p.rot - o.th), o => norm360(-o.p.rot - o.th)],
    };
    let checked = 0;
    for (const side of ['top', 'bottom']) {
      const list = local[side];
      if (!list.length) continue;
      let bestRes = null;
      for (const f of variants[side]) {
        const groups = new Map();
        for (const o of list) { const key = o.p.footprint; if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ o, a: f(o) }); }
        const outliers = [];
        let n = 0;
        for (const [fp, g] of groups) {
          if (g.length < T.group) continue;
          n += g.length;
          // Majority angle: the member with the most others within 10°.
          let ref = null, refN = -1;
          for (const x of g) { const c = g.filter(y => angDiff(x.a, y.a) <= T.agree).length; if (c > refN) { refN = c; ref = x.a; } }
          if (refN < g.length * T.majority) continue;
          for (const x of g) if (angDiff(x.a, ref) > T.agree) outliers.push({ o: x.o, fp, off: angDiff(x.a, ref), n: g.length });
        }
        if (!bestRes || outliers.length < bestRes.outliers.length) bestRes = { outliers, n };
      }
      checked += bestRes.n;
      for (const x of bestRes.outliers.slice(0, T.shown)) {
        const p = x.o.p;
        add('pin1', Math.abs(x.off - 180) < T.reversed ? 'error' : 'warn', `${p.des}: pin 1 is ${Math.round(x.off)}° off from the other ${x.n - 1} ${p.footprint} parts`,
          `With the pick-and-place rotation of ${p.rot}°, pin 1 of ${p.des} points a different way than on every other ${p.footprint} on the ${side}. ${Math.abs(x.off - 180) < T.reversed ? 'A 180° error reverses polarity.' : 'Check the rotation.'}`,
          { at: { x: p.padCenter.x, y: p.padCenter.y }, refs: [p.des], side });
      }
    }
    add('pin1', 'info', `Pin 1 orientation checked on ${checked} parts`, 'Pin 1 position from the IPC-356 netlist, compared with the pick-and-place rotation across parts that share a footprint.');
  }

  C.pins = C.runner(run);
})(window.Fab);
