// Fabrication DFM checks (vector). Spacing-type checks on the union of copper come in slice 2.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;
  const G = Fab.geo;
  const MAX = 40; // individual findings per check

  function* run(pkg, prof, out) {
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'DFM', check, severity, title, detail }, extra || {})));
    const L = pkg.layers;
    const fmt = v => Fab.fmtLen(v, 3), fl = Fab.fmtLen, dia = d => '⌀' + Fab.fmtLen(d);
    // Relief attributes carry their unit ("0.254mm", "10mil").
    const attrLen = t => { const m = /^\s*([\d.]+)\s*(mm|mil|in)?\s*$/i.exec(t || ''); return m ? fl(+m[1] * ({ mil: 0.0254, in: 25.4 }[(m[2] || 'mm').toLowerCase()] || 1)) : t; };
    const outer = [L.top, L.bottom].filter(l => l && l.polarity !== 'negative');

    // ---- minimum trace width ----
    yield 'Minimum trace width';
    for (const lay of L.copper) {
      if (lay.polarity === 'negative') continue;
      const widths = new Map();
      for (const p of lay.prims) {
        if ((p.k !== 'L' && p.k !== 'A') || !p.dark) continue;
        if (p.ap.fn && !/Conductor/i.test(p.ap.fn)) continue;
        const w = Fab.gerber.drawWidth(p);
        if (!w) continue;
        const k = w.toFixed(4);
        if (!widths.has(k)) widths.set(k, { w, prims: [] });
        widths.get(k).prims.push(p);
      }
      const all = [...widths.values()].sort((a, b) => a.w - b.w);
      if (!all.length) continue;
      const name = lay.file.name;
      add('trace', 'info', `${name}: min trace ${fmt(all[0].w)}`, 'Trace widths used: ' + all.map(x => `${fmt(x.w)} ×${x.prims.length}`).join(', ') + '.', { layer: name });
      for (const x of all) {
        if (x.w >= prof.minTrace - 1e-6) break;
        const shown = x.prims.slice(0, 10);
        for (const p of shown) add('trace', 'error', `Trace ${fmt(x.w)} below ${fmt(prof.minTrace)}`, `${name}, ${x.prims.length} segment(s) at this width.`, { layer: name, bbox: p.bbox, value: x.w, limit: prof.minTrace });
      }
    }

    // ---- drills ----
    yield 'Drills';
    const tools = new Map();
    for (const h of pkg.hits) { const k = (h.plated ? 'P' : 'N') + h.dia; if (!tools.has(k)) tools.set(k, { dia: h.dia, plated: h.plated, hits: [] }); tools.get(k).hits.push(h); }
    const tlist = [...tools.values()].sort((a, b) => a.dia - b.dia);
    if (tlist.length) {
      const minP = tlist.find(t => t.plated);
      add('drill', 'info', `Smallest drill ${fmt(tlist[0].dia)}`, `${tlist.length} drill sizes. Aspect ratio at ${fl(prof.thickness)} thickness: ${minP ? (prof.thickness / minP.dia).toFixed(1) + ':1 for the smallest plated hole' : 'n/a'}.`);
    }
    for (const t of tlist) {
      const h = t.hits[0];
      if (t.dia < prof.minDrill - 1e-6) add('drill', 'error', `Drill ${fmt(t.dia)} below ${fmt(prof.minDrill)}`, `${t.hits.length} ${t.plated ? 'plated' : 'non-plated'} hole(s). Needs laser or a finer drill class.`, { at: h, value: t.dia, limit: prof.minDrill });
      const ar = prof.thickness / t.dia;
      if (t.plated && ar > prof.maxAspect) add('aspect', 'error', `Aspect ratio ${ar.toFixed(1)}:1 for ${dia(t.dia)}`, `Above ${prof.maxAspect}:1 at ${fl(prof.thickness)} board thickness. ${t.hits.length} hole(s).`, { at: h, value: ar, limit: prof.maxAspect });
    }
    for (const s of pkg.slots) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + s.dia;
      if (s.plated && s.dia < prof.minSlot - 1e-6) add('slot', 'warn', `Plated slot width ${fmt(s.dia)} below ${fmt(prof.minSlot)}`, `Slot length ${fmt(len)}. Narrow slots need a small router bit; check with the fab.`, { bbox: [Math.min(s.x1, s.x2) - s.dia / 2, Math.min(s.y1, s.y2) - s.dia / 2, Math.max(s.x1, s.x2) + s.dia / 2, Math.max(s.y1, s.y2) + s.dia / 2], value: s.dia, limit: prof.minSlot });
      if (len / s.dia < 2) add('slot', 'warn', `Slot length/width ${(len / s.dia).toFixed(2)} is under 2`, 'Short slots tend to drift; many fabs require length ≥ 2× width.', { at: { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 } });
    }

    // ---- annular ring (outer layers, flashed pads) ----
    yield 'Annular ring';
    const ringFail = [], noPad = [];
    let ringMin = { v: Infinity };
    for (const h of pkg.hits) {
      if (!h.plated) continue;
      const isVia = h.dia <= prof.viaMaxDrill;
      const limit = isVia ? prof.ringVia : prof.ringPth;
      for (const lay of outer) {
        const prims = C.primsAt(lay, h.x, h.y, p => p.k === 'F');
        if (!prims.length) {
          if (!C.primsAt(lay, h.x, h.y).length) noPad.push({ h, lay });
          continue;
        }
        const ring = C.depthAt(prims, h.x, h.y) - h.dia / 2;
        if (ring < ringMin.v) ringMin = { v: ring, h, lay };
        const pad = prims.reduce((a, p) => Math.max(a, Math.min(p.ap.w, p.ap.h)), 0);
        if (ring < limit - 1e-4) ringFail.push({ h, lay, ring, limit, isVia, pad, fn: prims[0].ap.fn });
      }
    }
    for (const lay of outer) for (const s of pkg.slots) if (s.plated) {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      const prims = C.primsAt(lay, mx, my, p => p.k === 'F');
      if (!prims.length) continue;
      // Ring at the slot ends: distance from each end center to the pad edge, minus the radius.
      let ring = Infinity;
      for (const [ex, ey] of [[s.x1, s.y1], [s.x2, s.y2]]) ring = Math.min(ring, C.depthAt(prims, ex, ey) - s.dia / 2);
      if (ring < prof.ringPth - 1e-4) ringFail.push({ h: { x: mx, y: my, dia: s.dia }, lay, ring, limit: prof.ringPth, isVia: false, slot: true });
    }
    if (isFinite(ringMin.v)) add('ring', 'info', `Smallest outer annular ring ${fmt(ringMin.v)}`, `${dia(ringMin.h.dia)} hole on ${ringMin.lay.file.name}. Limits: PTH ${fl(prof.ringPth)}, via ${fl(prof.ringVia)}.`, { at: ringMin.h });
    ringFail.sort((a, b) => a.ring - b.ring);
    for (const r of ringFail.slice(0, MAX)) add('ring', r.ring < 0 ? 'error' : r.ring < r.limit / 2 ? 'error' : 'warn',
      `${r.ring < 0 ? 'Breakout' : 'Annular ring ' + fmt(r.ring)} on ${dia(r.h.dia)} ${r.slot ? 'slot' : r.isVia ? 'via' : 'PTH'}`,
      `${r.lay.file.name}. Required ${fmt(r.limit)}.` + (r.pad ? ` Pad ${fmt(r.pad)}${r.fn ? ', ' + r.fn.split(',')[0] : ''}${r.pad <= r.h.dia ? ', no larger than the hole' : ''}.` : ''),
      { at: { x: r.h.x, y: r.h.y }, layer: r.lay.file.name, value: r.ring, limit: r.limit });
    if (ringFail.length > MAX) add('ring', 'warn', `…${ringFail.length - MAX} more annular ring findings`, '');
    if (noPad.length) {
      for (const n of noPad.slice(0, 10)) add('ring', 'warn', `Plated hole ${dia(n.h.dia)} without copper on ${n.lay.side}`, `${n.lay.file.name} has no copper at this hole. Plating needs a pad on both outer layers.`, { at: n.h, layer: n.lay.file.name });
      if (noPad.length > 10) add('ring', 'warn', `…${noPad.length - 10} more plated holes without outer copper`, '');
    }

    // ---- thermal reliefs (Altium relief macro parameters) ----
    yield 'Thermal reliefs';
    for (const lay of L.copper) {
      const used = new Map();
      for (const p of lay.prims) if (p.k === 'F' && p.ap.amparams && /Relief/i.test(p.ap.amparams.Shape || '')) {
        if (!used.has(p.ap.code)) used.set(p.ap.code, []);
        used.get(p.ap.code).push(p);
      }
      if (used.size) {
        const styles = [...used.values()].map(ps => ps[0].ap.amparams);
        add('thermal', 'info', `${lay.file.name}: ${[...used.values()].reduce((s, ps) => s + ps.length, 0)} thermal reliefs`,
          `Spoke widths ${[...new Set(styles.map(a => attrLen(a.Width)))].join(', ')}; air gaps ${[...new Set(styles.map(a => attrLen(a.Gap)))].join(', ')}; spokes ${[...new Set(styles.map(a => a.Entries))].join(', ')}.`, { layer: lay.file.name });
      }
      for (const [code, ps] of used) {
        const a = ps[0].ap.amparams;
        const spoke = parseFloat(a.Width), gap = parseFloat(a.Gap), n = parseInt(a.Entries, 10);
        const bad = [];
        if (isFinite(spoke) && spoke < prof.minSpoke - 1e-6) bad.push(`spoke width ${fl(spoke)} < ${fl(prof.minSpoke)}`);
        if (isFinite(n) && n < prof.minSpokes) bad.push(`${n} spoke(s)`);
        if (isFinite(gap) && gap < prof.minSpace - 1e-6) bad.push(`air gap ${fl(gap)} < ${fl(prof.minSpace)}`);
        if (bad.length) add('thermal', 'warn', `Thermal relief D${code}: ${bad.join(', ')}`, `${lay.file.name}, ${ps.length} pad(s). A starved thermal can crack or fail to plate; a narrow air gap etches poorly.`, { at: ps[0], layer: lay.file.name });
      }
    }

    // ---- copper to board edge ----
    yield 'Copper to board edge';
    const o = L.outline;
    if (o && !o.board.synthetic) {
      const { grid, segs } = C.outlineSegs(o);
      for (const lay of L.copper) {
        if (C.hasClear(lay)) { edgeBySampling(lay, segs); continue; }
        const hits = [];
        let closest = { d: Infinity };
        const reach = Math.max(prof.copperToEdge, 1.0);
        for (const p of lay.prims) {
          if (!p.dark) continue;
          const near = grid.query(Fab.bbox.grow(p.bbox, reach));
          if (!near.size) continue;
          let d = Infinity, at = null;
          for (const s of near) for (const sh of C.shapes(p)) {
            const v = C.segDist(sh, s.a, s.b);
            if (v < d) { d = v; at = s; }
          }
          if (d < closest.d) closest = { d, p };
          if (d < prof.copperToEdge - 1e-4) hits.push({ p, d });
        }
        if (isFinite(closest.d) && !hits.length) add('edge', 'info', `${lay.file.name}: closest copper to edge ${fmt(closest.d)}`, `Required ${fmt(prof.copperToEdge)}.`, { bbox: closest.p.bbox, layer: lay.file.name });
        hits.sort((a, b) => a.d - b.d);
        for (const h of hits.slice(0, MAX)) add('edge', h.d < prof.copperToEdge / 2 ? 'error' : 'warn', `Copper ${fmt(h.d)} from board edge`, `${lay.file.name}. Required ${fmt(prof.copperToEdge)}. Routing can expose or burr this copper.`, { bbox: h.p.bbox, layer: lay.file.name, value: h.d, limit: prof.copperToEdge });
        if (hits.length > MAX) add('edge', 'warn', `…${hits.length - MAX} more copper-to-edge findings on ${lay.file.name}`, '');
      }
    }

    // Layers with clear-polarity cut-outs or negative polarity: probe for copper along inward/outward
    // normals of the outline instead of measuring primitives.
    function edgeBySampling(lay, segs) {
      const step = 0.1, depthStep = 0.02, lim = prof.copperToEdge, reach = lim + 0.3;
      const found = [];
      let closest = Infinity;
      const neg = lay.polarity === 'negative';
      for (const s of segs) {
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const nx = -dy / len, ny = dx / len;
        const n = Math.max(1, Math.ceil(len / step));
        for (let i = 0; i <= n; i++) {
          const px = s.a[0] + dx * i / n, py = s.a[1] + dy * i / n;
          // On a positive layer copper can be no closer than the nearest dark primitive, so start there.
          let t0 = 0;
          if (!neg) {
            let d0 = Infinity;
            for (const p of C.index(lay).query([px - reach, py - reach, px + reach, py + reach])) if (p.dark) { d0 = Math.min(d0, C.primDistToPoint(p, px, py)); if (d0 === 0) break; }
            if (d0 > reach) continue;
            t0 = Math.max(0, Math.floor(d0 / depthStep) * depthStep);
          }
          for (let t = t0; t <= reach + 1e-9; t += depthStep) {
            let hit = false;
            for (const sg of [1, -1]) if (C.copperAt(lay, px + sg * nx * t, py + sg * ny * t, o)) { hit = true; break; }
            if (hit) {
              if (t < closest) closest = t;
              if (t < lim - 1e-4) found.push({ x: px, y: py, d: t });
              break;
            }
          }
        }
      }
      // Merge neighboring samples into one finding per stretch of edge.
      const clusters = [];
      for (const f of found) {
        const c = clusters.find(c => Math.hypot(c.x - f.x, c.y - f.y) < 1.5);
        if (c) { c.bbox = Fab.bbox.addPt(c.bbox, f.x, f.y); c.d = Math.min(c.d, f.d); c.n++; c.x = f.x; c.y = f.y; }
        else clusters.push({ x: f.x, y: f.y, d: f.d, n: 1, bbox: [f.x, f.y, f.x, f.y] });
      }
      clusters.sort((a, b) => a.d - b.d);
      const how = lay.polarity === 'negative' ? 'negative plane' : 'clear-polarity cut-outs';
      for (const c of clusters.slice(0, MAX)) add('edge', c.d < lim / 2 ? 'error' : 'warn', `Copper ≈${fmt(c.d)} from board edge`, `${lay.file.name} (${how}; sampled every ${fl(step)}, ±${fl(depthStep)}). Required ${fmt(lim)}. ${fl(+(c.n * step).toFixed(1))} of edge affected.`, { bbox: Fab.bbox.grow(c.bbox, 0.2), layer: lay.file.name, value: c.d, limit: lim });
      if (!clusters.length && isFinite(closest)) add('edge', 'info', `${lay.file.name}: closest copper to edge ≈${fmt(closest)}`, `${how}, sampled. Required ${fmt(lim)}.`, { layer: lay.file.name });
    }

    // ---- NPTH to copper ----
    yield 'NPTH to copper';
    const npth = pkg.hits.filter(h => !h.plated);
    for (const s of pkg.slots) if (!s.plated) {
      const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 0.25));
      for (let k = 0; k <= n; k++) npth.push({ x: s.x1 + (s.x2 - s.x1) * k / n, y: s.y1 + (s.y2 - s.y1) * k / n, dia: s.dia, plated: false, slot: true });
    }
    const drilledAway = [];
    for (const lay of outer) {
      const idx = C.index(lay);
      for (const h of npth) {
        const r = h.dia / 2, lim = prof.npthToCopper;
        let d = Infinity;
        if (C.hasClear(lay)) {
          // Pours cleared by later clear-polarity features: probe rings around the hole instead.
          // Start just outside the hole wall so a pad that exactly fits the hole is not counted.
          outer: for (let t = 0.01; t <= lim + 1e-9; t += 0.02) {
            const rr = r + t, n = Math.max(24, Math.ceil(2 * Math.PI * rr / 0.05));
            for (let k = 0; k < n; k++) {
              const a = 2 * Math.PI * k / n;
              if (C.copperAt(lay, h.x + rr * Math.cos(a), h.y + rr * Math.sin(a), o)) { d = t; break outer; }
            }
          }
          if (d < lim - 1e-4) add('npth', 'warn', `Copper ≈${fmt(d)} from NPTH ${dia(h.dia)}`, `${lay.file.name} (probed; layer has clear-polarity features). Required ${fmt(lim)}.`, { at: h, layer: lay.file.name, value: d, limit: lim });
          continue;
        }
        for (const p of idx.query([h.x - r - lim, h.y - r - lim, h.x + r + lim, h.y + r + lim])) {
          if (!p.dark) continue;
          // A flashed pad that fits inside the hole is drilled away entirely: note it, don't flag it.
          if (p.k === 'F') {
            const b = p.ap.bbox;
            const reach = p.ap.tpl === 'C' ? p.ap.dia / 2 : Math.hypot(Math.max(-b[0], b[2]), Math.max(-b[1], b[3]));
            if (Math.hypot(p.x - h.x, p.y - h.y) + reach <= r + 0.005) { drilledAway.push({ h, lay, p }); continue; }
          }
          d = Math.min(d, C.primDistToPoint(p, h.x, h.y) - r);
        }
        if (d < lim - 1e-4) add('npth', d <= 0 ? 'error' : 'warn', d <= 0 ? `Copper inside NPTH ${dia(h.dia)}` : `Copper ${fmt(d)} from NPTH ${dia(h.dia)}`, `${lay.file.name}. Required ${fmt(lim)}. Unplated holes need a copper pull-back.`, { at: h, layer: lay.file.name, value: d, limit: lim });
      }
    }
    if (drilledAway.length) {
      const holes = new Set(drilledAway.map(x => x.h));
      add('npth', 'info', `${holes.size} NPTH hole(s) carry a pad no larger than the hole`,
        'The pad is drilled away, so this is harmless, but some fabs query copper on unplated holes. Pad sizes: ' +
        [...new Set(drilledAway.map(x => fmt(x.p.ap.w) + ' in ' + dia(x.h.dia)))].join(', ') + '.', { at: [...holes][0] });
    }

    // ---- solder mask expansion and dams (flashed pads) ----
    yield 'Solder mask expansion and dams';
    for (const side of ['top', 'bottom']) {
      const cu = side === 'top' ? L.top : L.bottom, mask = L.mask[side];
      if (!cu || !mask || cu.polarity === 'negative') continue;
      const midx = C.index(mask);
      const exps = [], tented = { via: 0, pad: [] };
      for (const p of cu.prims) {
        if (p.k !== 'F' || !p.dark) continue;
        const isVia = /ViaPad/i.test(p.ap.fn || '') || (!p.ap.fn && pkg.hits.some(h => h.plated && h.dia <= prof.viaMaxDrill && Math.abs(h.x - p.x) < 0.005 && Math.abs(h.y - p.y) < 0.005));
        let m = null;
        for (const q of midx.query([p.x - 0.01, p.y - 0.01, p.x + 0.01, p.y + 0.01])) if (q.k === 'F' && Math.abs(q.x - p.x) < 0.005 && Math.abs(q.y - p.y) < 0.005) { m = q; break; }
        if (!m) {
          if (isVia) tented.via++;
          else if (!C.primsAt(mask, p.x, p.y).length) tented.pad.push(p);
          continue;
        }
        const ex = Math.min((m.ap.w - p.ap.w) / 2, (m.ap.h - p.ap.h) / 2);
        exps.push({ p, m, ex, isVia });
      }
      if (exps.length) {
        const vals = exps.map(e => e.ex).sort((a, b) => a - b);
        add('mask', 'info', `${side} mask expansion ${fmt(vals[0])} … ${fmt(vals[vals.length - 1])}`, `${exps.length} pads with a matching mask opening. Median ${fmt(vals[vals.length >> 1])}.`);
      }
      for (const e of exps.filter(e => e.ex < prof.minMaskExp - 1e-4).slice(0, MAX)) add('mask', 'warn', `Mask opening smaller than pad by ${fmt(-e.ex)}`, `${mask.file.name}. Solder-mask-defined pad; fine for some BGAs, otherwise a mistake.`, { at: e.p, layer: mask.file.name, value: e.ex });
      if (tented.via) add('mask', 'info', `${tented.via} tented vias on ${side}`, 'Vias without a mask opening. Confirm tenting or plugging is on the fab drawing.');
      for (const p of tented.pad.slice(0, 20)) add('mask', 'warn', `Pad without mask opening on ${side}`, `${cu.file.name}: ${p.ap.tpl} ${Fab.fmtSize(p.ap.w, p.ap.h, 3)} pad is covered by mask.`, { at: p, layer: cu.file.name });

      // Mask dams between neighboring flashed openings
      const opens = mask.prims.filter(q => q.k === 'F' && q.dark);
      const dams = [];
      const g = new G.Grid(1.0);
      opens.forEach(q => g.insert(q, q.bbox));
      const seenPair = new Set();
      for (const q of opens) for (const r of g.query(Fab.bbox.grow(q.bbox, prof.minMaskDam))) {
        if (r === q) continue;
        const key = q.i < r.i ? q.i + ':' + r.i : r.i + ':' + q.i;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        let d = Infinity;
        for (const a of C.shapes(q)) for (const b of C.shapes(r)) d = Math.min(d, C.shapeDist(a, b));
        if (d > 1e-4 && d < prof.minMaskDam - 1e-4) dams.push({ q, r, d });
      }
      dams.sort((a, b) => a.d - b.d);
      for (const dm of dams.slice(0, MAX)) add('mask-dam', 'warn', `Mask dam ${fmt(dm.d)} on ${side}`, `${mask.file.name}. Below ${fmt(prof.minMaskDam)}; the web between these openings will flake off or be removed (gang relief).`, { bbox: Fab.bbox.union(dm.q.bbox, dm.r.bbox), layer: mask.file.name, value: dm.d, limit: prof.minMaskDam });
      if (dams.length > MAX) add('mask-dam', 'warn', `…${dams.length - MAX} more mask dams on ${side}`, '');
    }

    // ---- silkscreen ----
    yield 'Silkscreen';
    for (const side of ['top', 'bottom']) {
      const silk = L.silk[side];
      if (!silk) continue;
      const widths = new Map();
      for (const p of silk.prims) if ((p.k === 'L' || p.k === 'A') && p.dark) {
        const w = Fab.gerber.drawWidth(p);
        const k = w.toFixed(4);
        if (!widths.has(k)) widths.set(k, { w, n: 0, p });
        widths.get(k).n++;
      }
      const ws = [...widths.values()].sort((a, b) => a.w - b.w);
      for (const x of ws) if (x.w < prof.minSilkLine - 1e-6) add('silk', 'warn', `Silkscreen line ${fmt(x.w)} on ${side}`, `${x.n} stroke(s) below ${fmt(prof.minSilkLine)}; they may not print.`, { bbox: x.p.bbox, layer: silk.file.name, value: x.w, limit: prof.minSilkLine });

      // Silk over exposed pads (mask openings)
      const mask = L.mask[side];
      if (!mask) continue;
      const opens = mask.prims.filter(q => q.dark && (q.k === 'F' || q.k === 'R'));
      const og = new G.Grid(1.0);
      opens.forEach(q => og.insert(q, q.bbox));
      const hitOpen = new Map(), nearOpen = new Map();
      const clr = prof.silkToPad || 0;
      for (const p of silk.prims) {
        if (!p.dark) continue;
        const cand = og.query(Fab.bbox.grow(p.bbox, clr));
        if (!cand.size) continue;
        for (const q of cand) {
          if (hitOpen.has(q)) continue;
          if (!Fab.bbox.overlaps(Fab.bbox.grow(p.bbox, clr), q.bbox)) continue;
          let d = Infinity;
          for (const a of C.shapes(p)) { for (const b of C.shapes(q)) { d = Math.min(d, C.shapeDist(a, b)); if (d <= 0) break; } if (d <= 0) break; }
          if (d <= 0) { hitOpen.set(q, p); nearOpen.delete(q); }
          else if (d < clr - 1e-4 && (!nearOpen.has(q) || d < nearOpen.get(q).d)) nearOpen.set(q, { d });
        }
      }
      const list = [...hitOpen.keys()];
      for (const q of list.slice(0, MAX)) add('silk-pad', 'warn', `Silkscreen over exposed pad on ${side}`, `${silk.file.name} prints into a mask opening. The fab will clip it, or ink ends up on the pad.`, { bbox: q.bbox, layer: silk.file.name });
      if (list.length > MAX) add('silk-pad', 'warn', `…${list.length - MAX} more pads with silkscreen on ${side}`, '');
      // Closer than the clearance but not touching: fabs clip the ink, so this is a heads-up, not a defect.
      if (nearOpen.size) {
        const near = [...nearOpen.entries()].sort((a, b) => a[1].d - b[1].d);
        add('silk-pad', 'info', `${near.length} pad(s) with silkscreen closer than ${fmt(clr)} on ${side}`,
          `Closest ${fmt(near[0][1].d)}. Fabs clip legend ink back to their pad clearance, so parts of these marks may be trimmed.`, { bbox: near[0][0].bbox, layer: silk.file.name, value: near[0][1].d, limit: clr });
      }
    }

    // ---- holes: spacing, board edge, castellations, slot widths ----
    yield 'Holes: spacing, board edge, castellations';
    {
      const holes = pkg.hits.map(h => ({ kind: 'hit', x1: h.x, y1: h.y, x2: h.x, y2: h.y, r: (h.dia || 0) / 2, plated: h.plated, via: h.plated && h.dia <= prof.viaMaxDrill, src: h }))
        .concat(pkg.slots.map(s => ({ kind: 'slot', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, r: (s.dia || 0) / 2, plated: s.plated, via: false, src: s })));
      const bbOf = h => [Math.min(h.x1, h.x2) - h.r, Math.min(h.y1, h.y2) - h.r, Math.max(h.x1, h.x2) + h.r, Math.max(h.y1, h.y2) + h.r];
      const mid = h => ({ x: (h.x1 + h.x2) / 2, y: (h.y1 + h.y2) / 2 });
      const grid = new G.Grid(2.0);
      holes.forEach((h, i) => { h.i = i; grid.insert(h, bbOf(h)); });
      const reach = Math.max(prof.holeGap, prof.viaHoleGap);
      const close = [], dup = [];
      for (const a of holes) for (const b of grid.query(Fab.bbox.grow(bbOf(a), reach))) {
        if (b.i <= a.i) continue;
        const centers = a.kind === 'hit' && b.kind === 'hit' ? Math.hypot(a.x1 - b.x1, a.y1 - b.y1) : G.segSeg([a.x1, a.y1], [a.x2, a.y2], [b.x1, b.y1], [b.x2, b.y2]);
        const gap = centers - a.r - b.r;
        const lim = a.via && b.via ? prof.viaHoleGap : prof.holeGap;
        if (centers < 0.005 && a.kind === 'hit' && b.kind === 'hit') dup.push({ a, b });
        else if (gap < lim - 1e-4) close.push({ a, b, gap, lim, vias: a.via && b.via });
      }
      for (const d of dup.slice(0, MAX)) add('hole-gap', 'error', `Two holes drilled at the same spot: ${dia(d.a.src.dia)} and ${dia(d.b.src.dia)}`, 'Stacked drill hits break the bit or leave a ragged hole; remove the duplicate.', { at: { x: d.a.x1, y: d.a.y1 } });
      close.sort((p, q) => p.gap - q.gap);
      for (const c of close.slice(0, MAX)) {
        const m1 = mid(c.a), m2 = mid(c.b);
        add('hole-gap', c.gap < 0 ? 'error' : 'warn', c.gap < 0 ? 'Holes overlap' : `Hole to hole ${fmt(c.gap)}${c.vias ? ' (vias)' : ''}`,
          `Drill wall to drill wall between ${dia(c.a.src.dia)} and ${dia(c.b.src.dia)} ${c.a.kind === 'slot' || c.b.kind === 'slot' ? 'slot/hole' : 'holes'}. Required ${fmt(c.lim)}; closer holes crack the web between them or wander into each other.`,
          { bbox: Fab.bbox.grow([Math.min(m1.x, m2.x), Math.min(m1.y, m2.y), Math.max(m1.x, m2.x), Math.max(m1.y, m2.y)], 0.3), value: c.gap, limit: c.lim });
      }
      if (close.length > MAX) add('hole-gap', 'warn', `…${close.length - MAX} more hole-to-hole findings`, '');
      if (!close.length && !dup.length && holes.length) add('hole-gap', 'info', 'Hole spacing passes', `${holes.length} holes and slots checked: vias ${fmt(prof.viaHoleGap)}, others ${fmt(prof.holeGap)} wall to wall.`);

      const o = L.outline;
      if (o && !o.board.synthetic) {
        const { grid: og } = C.outlineSegs(o);
        const castell = [], nearEdge = [];
        for (const h of holes) {
          let d = Infinity;
          for (const s of og.query(Fab.bbox.grow(bbOf(h), prof.holeToEdge + 0.5))) d = Math.min(d, G.segSeg([h.x1, h.y1], [h.x2, h.y2], s.a, s.b));
          if (!isFinite(d)) continue;
          if (d < h.r - 0.01) { if (h.plated) castell.push({ h, d }); continue; } // cut by the edge: a castellation (plated) or an edge notch
          const wall = d - h.r;
          if (wall < prof.holeToEdge - 1e-4) nearEdge.push({ h, wall });
        }
        nearEdge.sort((p, q) => p.wall - q.wall);
        for (const n of nearEdge.slice(0, MAX)) add('hole-edge', n.wall < prof.holeToEdge / 2 ? 'error' : 'warn', `${n.h.plated ? 'Plated' : 'Non-plated'} hole ${fmt(n.wall)} from the board edge`,
          `${dia(n.h.src.dia)} ${n.h.kind}. Required ${fmt(prof.holeToEdge)} from drill wall to the outline or a cutout; closer holes can break out when the board is routed.`, { at: mid(n.h), value: n.wall, limit: prof.holeToEdge });
        if (nearEdge.length > MAX) add('hole-edge', 'warn', `…${nearEdge.length - MAX} more holes near the edge`, '');
        if (castell.length) {
          const small = castell.filter(c => c.h.r * 2 < prof.minCastellation - 1e-4);
          add('castellation', 'info', `${castell.length} castellated (half) hole(s) on the board edge`, `Plated holes cut by the outline. Order the castellated / plated half-hole option and call it out on the fab drawing.`, { at: mid(castell[0].h) });
          for (const c of small.slice(0, MAX)) add('castellation', 'error', `Castellated hole ${dia(c.h.src.dia)} is below ${fmt(prof.minCastellation)}`, 'Small half-holes tear their plating when the edge is routed.', { at: mid(c.h), value: c.h.src.dia, limit: prof.minCastellation });
        }
      }
      for (const s of pkg.slots) if (!s.plated && s.dia < prof.minNpthSlot - 1e-6) add('slot', 'warn', `Non-plated slot ${fmt(s.dia)} wide, below ${fmt(prof.minNpthSlot)}`, 'Unplated slots are routed; most fabs need a wider router bit than for plated slots.', { bbox: [Math.min(s.x1, s.x2) - s.dia / 2, Math.min(s.y1, s.y2) - s.dia / 2, Math.max(s.x1, s.x2) + s.dia / 2, Math.max(s.y1, s.y2) + s.dia / 2], value: s.dia, limit: prof.minNpthSlot });
    }

    // ---- outline inside corners ----
    yield 'Outline inside corners';
    if (L.outline && !L.outline.board.synthetic && prof.minInsideRadius > 0) {
      const o = L.outline, found = [];
      // Sharp vertices only: arcs are flattened into many short segments with small turns.
      const scan = (pts, insideIsLeft) => {
        const n = pts.length / 2;
        for (let i = 0; i < n; i++) {
          const a = (i + n - 1) % n, b = (i + 1) % n;
          const ax = pts[2 * i] - pts[2 * a], ay = pts[2 * i + 1] - pts[2 * a + 1], bx = pts[2 * b] - pts[2 * i], by = pts[2 * b + 1] - pts[2 * i + 1];
          const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
          if (la < 0.15 || lb < 0.15) continue;
          const cross = ax * by - ay * bx, turn = Math.abs(Math.atan2(cross, ax * bx + ay * by)) * 180 / Math.PI;
          if (turn < 30) continue;
          if ((cross < 0) === insideIsLeft) found.push({ x: pts[2 * i], y: pts[2 * i + 1], turn });
        }
      };
      const ccw = pts => G.area(pts) > 0;
      scan(o.board.pts, ccw(o.board.pts));          // concave corners of the board
      for (const c of o.cutouts) scan(c.pts, !ccw(c.pts)); // every corner of a cutout is an inside corner for the router
      for (const f of found.slice(0, MAX)) add('outline-corner', 'info', 'Sharp inside corner in the outline',
        `The router leaves a radius of about ${fmt(prof.minInsideRadius)} here. Draw that radius in the outline if a part must fit into the corner.`, { at: { x: f.x, y: f.y }, value: 0, limit: prof.minInsideRadius });
      if (found.length > MAX) add('outline-corner', 'info', `…${found.length - MAX} more sharp inside corners`, '');
    }

    // ---- pads: BGA size, vias in pads ----
    yield 'BGA pads and vias in pads';
    for (const lay of outer) {
      const small = new Map();
      for (const p of lay.prims) if (p.k === 'F' && p.dark && /BGAPad/i.test(p.ap.fn || '')) {
        const sz = Math.min(p.ap.w, p.ap.h);
        if (sz < prof.minBgaPad - 1e-4) { const k = sz.toFixed(3); if (!small.has(k)) small.set(k, []); small.get(k).push(p); }
      }
      for (const [k, ps] of small) add('bga-pad', 'warn', `BGA pads ${fmt(+k)}, below ${fmt(prof.minBgaPad)}`, `${lay.file.name}: ${ps.length} pad(s). Small BGA lands need ENIG and tighter registration; check with the fab.`, { at: { x: ps[0].x, y: ps[0].y }, layer: lay.file.name, value: +k, limit: prof.minBgaPad });
      // Only pads that get paste are solder joints; an unpasted pad (a test point) with a via is fine.
      const paste = L.paste && L.paste[lay.side], pg = new G.Grid(2.0);
      if (paste) for (const q of paste.prims) if (q.dark) pg.insert(q, q.bbox);
      const pasted = p => { if (!paste) return true; for (const q of pg.query(p.bbox)) if (Fab.bbox.overlaps(q.bbox, p.bbox)) return true; return false; };
      const inPad = [];
      let bare = 0;
      for (const h of pkg.hits) {
        if (!h.plated || h.dia > prof.viaMaxDrill) continue;
        // An SMD or BGA pad that contains the via but is not the via's own pad.
        const host = C.primsAt(lay, h.x, h.y, p => p.k === 'F' && (/SMDPad|BGAPad/i.test(p.ap.fn || '') || (!p.ap.fn && Math.hypot(p.x - h.x, p.y - h.y) > 0.01)));
        if (!host.length) continue;
        if (pasted(host[0])) inPad.push({ h, p: host[0] }); else bare++;
      }
      if (bare) add('via-in-pad', 'info', `${bare} via(s) in pads without paste on ${lay.side}`, 'Test points and other unpasted pads: no solder joint, so an open via does no harm.', { layer: lay.file.name });
      if (!inPad.length) continue;
      // One finding per pad: a thermal pad with an array of vias is one decision, not twenty.
      const byPad = new Map();
      for (const v of inPad) { if (!byPad.has(v.p)) byPad.set(v.p, []); byPad.get(v.p).push(v.h); }
      if (prof.viaInPad) add('via-in-pad', 'info', `${inPad.length} via(s) in ${byPad.size} SMD/BGA pad(s) on ${lay.side}`, 'Allowed by this profile: order them filled and capped (plated over, POFV) and say so on the fab drawing.', { at: inPad[0].h, layer: lay.file.name });
      else for (const [p, hs] of [...byPad].slice(0, MAX)) add('via-in-pad', 'warn', hs.length > 1 ? `${hs.length} vias in one pad on ${lay.side}` : `Via in pad on ${lay.side}`,
        `${dia(hs[0].dia)} via${hs.length > 1 ? 's' : ''} inside a ${Fab.fmtSize(p.ap.w, p.ap.h, 2)} pad. Open vias wick solder away from the joint; fill and cap them (an advanced process), tent them from the far side for a thermal pad, or move them off the pad.`, { at: hs[0], bbox: Fab.bbox.grow(p.bbox, 0.2), layer: lay.file.name });
      if (!prof.viaInPad && byPad.size > MAX) add('via-in-pad', 'warn', `…${byPad.size - MAX} more pads with vias on ${lay.side}`, '');
    }

    // ---- raster engine: spacing, slivers, isolated copper, region mask dams ----
    if (Fab.raster && pkg.boardBBox && typeof document !== 'undefined') {
      for (const lay of L.copper) {
        yield `Spacing and slivers · ${lay.file.name}`;
        const r = Fab.raster.copperSpacing(pkg, lay, prof, add, MAX);
        if (!r.gaps && !r.slivers) add('spacing', 'info', `${lay.file.name}: no spacing or sliver problems`, `Checked on a ${Math.round(r.res * 1000)} µm raster against ${fl(prof.minSpace)} spacing and ${fl(prof.minTrace)} width.`, { layer: lay.file.name });
      }
      const cover = [];
      for (const lay of L.copper) {
        yield `Isolated copper · ${lay.file.name}`;
        cover.push(Fab.raster.islands(pkg, lay, prof, add, MAX).copperArea);
      }
      // Copper balance: layers mirrored about the stackup center (top/bottom, L2/Ln-1, ...).
      const o = L.outline;
      if (o && !o.board.synthetic && L.copper.length >= 2) {
        const area = o.board.area - o.cutouts.reduce((t, c) => t + c.area, 0);
        const pct = cover.map(a => Math.min(100, 100 * a / area));
        add('copper-balance', 'info', 'Copper coverage by layer', L.copper.map((l, i) => `${l.file.name} ${pct[i].toFixed(0)}%`).join(' · ') + '. Approximate: includes pads, traces and pours inside the outline.');
        const n = L.copper.length;
        for (let i = 0; i < Math.floor(n / 2); i++) {
          const j = n - 1 - i, d = Math.abs(pct[i] - pct[j]);
          if (d > prof.maxCopperImbalance) add('copper-balance', 'warn', `Copper imbalance ${d.toFixed(0)} points between ${L.copper[i].file.name} and ${L.copper[j].file.name}`,
            `${pct[i].toFixed(0)}% vs ${pct[j].toFixed(0)}% coverage on layers that mirror each other in the stackup. Uneven copper bows and twists the board in reflow; add copper thieving or pour on the lighter layer. Limit ${prof.maxCopperImbalance} points.`, { layer: L.copper[pct[i] < pct[j] ? i : j].file.name, value: d, limit: prof.maxCopperImbalance });
        }
      }
      for (const side of ['top', 'bottom']) {
        const mask = L.mask[side];
        if (!mask) continue;
        yield `Mask dams (regions) · ${mask.file.name}`;
        Fab.raster.maskDams(pkg, mask, prof, add, MAX);
      }
    }
    return;
  }

  C.dfm = C.runner(run);
})(window.Fab);
