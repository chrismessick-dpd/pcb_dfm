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
    const fmt = v => v.toFixed(3) + ' mm';
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
      add('trace', 'info', `${name}: min trace ${fmt(all[0].w)}`, 'Trace widths used: ' + all.map(x => `${x.w.toFixed(3)} (${x.prims.length})`).join(', ') + ' mm.', { layer: name });
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
      add('drill', 'info', `Smallest drill ${fmt(tlist[0].dia)}`, `${tlist.length} drill sizes. Aspect ratio at ${prof.thickness} mm thickness: ${minP ? (prof.thickness / minP.dia).toFixed(1) + ':1 for the smallest plated hole' : 'n/a'}.`);
    }
    for (const t of tlist) {
      const h = t.hits[0];
      if (t.dia < prof.minDrill - 1e-6) add('drill', 'error', `Drill ${fmt(t.dia)} below ${fmt(prof.minDrill)}`, `${t.hits.length} ${t.plated ? 'plated' : 'non-plated'} hole(s). Needs laser or a finer drill class.`, { at: h, value: t.dia, limit: prof.minDrill });
      const ar = prof.thickness / t.dia;
      if (t.plated && ar > prof.maxAspect) add('aspect', 'error', `Aspect ratio ${ar.toFixed(1)}:1 for ⌀${t.dia} mm`, `Above ${prof.maxAspect}:1 at ${prof.thickness} mm board thickness. ${t.hits.length} hole(s).`, { at: h, value: ar, limit: prof.maxAspect });
    }
    for (const s of pkg.slots) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + s.dia;
      if (s.dia < prof.minSlot - 1e-6) add('slot', 'warn', `Slot width ${fmt(s.dia)} below ${fmt(prof.minSlot)}`, `Slot length ${len.toFixed(3)} mm. Narrow slots need a small router bit; check with the fab.`, { bbox: [Math.min(s.x1, s.x2) - s.dia / 2, Math.min(s.y1, s.y2) - s.dia / 2, Math.max(s.x1, s.x2) + s.dia / 2, Math.max(s.y1, s.y2) + s.dia / 2], value: s.dia, limit: prof.minSlot });
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
    if (isFinite(ringMin.v)) add('ring', 'info', `Smallest outer annular ring ${fmt(ringMin.v)}`, `⌀${ringMin.h.dia} mm hole on ${ringMin.lay.file.name}. Limits: PTH ${prof.ringPth}, via ${prof.ringVia} mm.`, { at: ringMin.h });
    ringFail.sort((a, b) => a.ring - b.ring);
    for (const r of ringFail.slice(0, MAX)) add('ring', r.ring < 0 ? 'error' : r.ring < r.limit / 2 ? 'error' : 'warn',
      `${r.ring < 0 ? 'Breakout' : 'Annular ring ' + fmt(r.ring)} on ⌀${r.h.dia} mm ${r.slot ? 'slot' : r.isVia ? 'via' : 'PTH'}`,
      `${r.lay.file.name}. Required ${fmt(r.limit)}.` + (r.pad ? ` Pad ${r.pad.toFixed(3)} mm${r.fn ? ' (' + r.fn.split(',')[0] + ')' : ''}${r.pad <= r.h.dia ? ', no larger than the hole' : ''}.` : ''),
      { at: { x: r.h.x, y: r.h.y }, layer: r.lay.file.name, value: r.ring, limit: r.limit });
    if (ringFail.length > MAX) add('ring', 'warn', `…${ringFail.length - MAX} more annular ring findings`, '');
    if (noPad.length) {
      for (const n of noPad.slice(0, 10)) add('ring', 'warn', `Plated hole ⌀${n.h.dia} mm without copper on ${n.lay.side}`, `${n.lay.file.name} has no copper at this hole. Plating needs a pad on both outer layers.`, { at: n.h, layer: n.lay.file.name });
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
          `Spoke widths ${[...new Set(styles.map(a => a.Width))].join(', ')}; air gaps ${[...new Set(styles.map(a => a.Gap))].join(', ')}; spokes ${[...new Set(styles.map(a => a.Entries))].join(', ')}.`, { layer: lay.file.name });
      }
      for (const [code, ps] of used) {
        const a = ps[0].ap.amparams;
        const spoke = parseFloat(a.Width), gap = parseFloat(a.Gap), n = parseInt(a.Entries, 10);
        const bad = [];
        if (isFinite(spoke) && spoke < prof.minSpoke - 1e-6) bad.push(`spoke width ${spoke} mm < ${prof.minSpoke}`);
        if (isFinite(n) && n < prof.minSpokes) bad.push(`${n} spoke(s)`);
        if (isFinite(gap) && gap < prof.minSpace - 1e-6) bad.push(`air gap ${gap} mm < ${prof.minSpace}`);
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
      for (const c of clusters.slice(0, MAX)) add('edge', c.d < lim / 2 ? 'error' : 'warn', `Copper ≈${fmt(c.d)} from board edge`, `${lay.file.name} (${how}; sampled every ${step} mm, ±${depthStep} mm). Required ${fmt(lim)}. ${(c.n * step).toFixed(1)} mm of edge affected.`, { bbox: Fab.bbox.grow(c.bbox, 0.2), layer: lay.file.name, value: c.d, limit: lim });
      if (!clusters.length && isFinite(closest)) add('edge', 'info', `${lay.file.name}: closest copper to edge ≈${fmt(closest)}`, `${how}, sampled. Required ${fmt(lim)}.`, { layer: lay.file.name });
    }

    // ---- NPTH to copper ----
    yield 'NPTH to copper';
    const npth = pkg.hits.filter(h => !h.plated);
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
          if (d < lim - 1e-4) add('npth', 'warn', `Copper ≈${fmt(d)} from NPTH ⌀${h.dia} mm`, `${lay.file.name} (probed; layer has clear-polarity features). Required ${fmt(lim)}.`, { at: h, layer: lay.file.name, value: d, limit: lim });
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
        if (d < lim - 1e-4) add('npth', d <= 0 ? 'error' : 'warn', d <= 0 ? `Copper inside NPTH ⌀${h.dia} mm` : `Copper ${fmt(d)} from NPTH ⌀${h.dia} mm`, `${lay.file.name}. Required ${fmt(lim)}. Unplated holes need a copper pull-back.`, { at: h, layer: lay.file.name, value: d, limit: lim });
      }
    }
    if (drilledAway.length) {
      const holes = new Set(drilledAway.map(x => x.h));
      add('npth', 'info', `${holes.size} NPTH hole(s) carry a pad no larger than the hole`,
        'The pad is drilled away, so this is harmless, but some fabs query copper on unplated holes. Pad sizes: ' +
        [...new Set(drilledAway.map(x => x.p.ap.w.toFixed(3) + ' in ⌀' + x.h.dia))].join(', ') + ' mm.', { at: [...holes][0] });
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
        add('mask', 'info', `${side} mask expansion ${vals[0].toFixed(3)} … ${vals[vals.length - 1].toFixed(3)} mm`, `${exps.length} pads with a matching mask opening. Median ${vals[vals.length >> 1].toFixed(3)} mm.`);
      }
      for (const e of exps.filter(e => e.ex < prof.minMaskExp - 1e-4).slice(0, MAX)) add('mask', 'warn', `Mask opening smaller than pad (${fmt(e.ex)})`, `${mask.file.name}. Solder-mask-defined pad; fine for some BGAs, otherwise a mistake.`, { at: e.p, layer: mask.file.name, value: e.ex });
      if (tented.via) add('mask', 'info', `${tented.via} tented vias on ${side}`, 'Vias without a mask opening. Confirm tenting or plugging is on the fab drawing.');
      for (const p of tented.pad.slice(0, 20)) add('mask', 'warn', `Pad without mask opening on ${side}`, `${cu.file.name}: ${p.ap.tpl} ${p.ap.w.toFixed(3)} × ${p.ap.h.toFixed(3)} mm pad is covered by mask.`, { at: p, layer: cu.file.name });

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
      const hitOpen = new Map();
      for (const p of silk.prims) {
        if (!p.dark) continue;
        const cand = og.query(p.bbox);
        if (!cand.size) continue;
        for (const q of cand) {
          if (hitOpen.has(q)) continue;
          if (!Fab.bbox.overlaps(p.bbox, q.bbox)) continue;
          let touch = false;
          for (const a of C.shapes(p)) { for (const b of C.shapes(q)) if (C.shapeDist(a, b) <= 0) { touch = true; break; } if (touch) break; }
          if (touch) hitOpen.set(q, p);
        }
      }
      const list = [...hitOpen.keys()];
      for (const q of list.slice(0, MAX)) add('silk-pad', 'warn', `Silkscreen over exposed pad on ${side}`, `${silk.file.name} prints into a mask opening. The fab will clip it, or ink ends up on the pad.`, { bbox: q.bbox, layer: silk.file.name });
      if (list.length > MAX) add('silk-pad', 'warn', `…${list.length - MAX} more pads with silkscreen on ${side}`, '');
    }

    // ---- raster engine: spacing, slivers, isolated copper, region mask dams ----
    if (Fab.raster && pkg.boardBBox && typeof document !== 'undefined') {
      for (const lay of L.copper) {
        yield `Spacing and slivers · ${lay.file.name}`;
        const r = Fab.raster.copperSpacing(pkg, lay, prof, add, MAX);
        if (!r.gaps && !r.slivers) add('spacing', 'info', `${lay.file.name}: no spacing or sliver problems`, `Checked on a ${Math.round(r.res * 1000)} µm raster against ${prof.minSpace} mm spacing and ${prof.minTrace} mm width.`, { layer: lay.file.name });
      }
      for (const lay of L.copper) {
        yield `Isolated copper · ${lay.file.name}`;
        Fab.raster.islands(pkg, lay, prof, add, MAX);
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
