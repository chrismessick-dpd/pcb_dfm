// Flex checks: coverlay openings, stiffeners and the flexible area. They run at the end of the DFM
// module, only for a flex package (X2 mechanical layers typed as coverlay or stiffener; see
// classify.js otherRole and docs/flex.md). Findings are in their own category, 'Flex'.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;
  const G = Fab.geo;
  const MAX = 40;
  const T = { sample: 0.02, coveredPad: 0.5, anchored: 0.02, webPair: 3.0, webStep: 0.01, pourArea: 1.0, stackLen: 1.0, stackAngle: 5, ring: 16 };

  // Pads on an outer copper layer: flashes marked as pads in X2 (any *Pad but ViaPad), or every flash
  // that is not on a via when the layer has no X2 aperture functions.
  function padsOf(lay, pkg, prof) {
    if (!lay) return [];
    const x2 = lay.prims.some(p => p.k === 'F' && p.ap && p.ap.fn);
    const vias = pkg.hits.filter(h => h.plated && h.dia <= prof.viaMaxDrill);
    const onVia = p => vias.some(h => Math.hypot(h.x - p.x, h.y - p.y) < 0.01);
    return lay.prims.filter(p => p.k === 'F' && p.dark && (x2 ? /Pad/i.test(p.ap.fn || '') && !/ViaPad/i.test(p.ap.fn) : !onVia(p)));
  }

  function* run(pkg, prof, out) {
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'Flex', check, severity, title, detail }, extra || {})));
    const L = pkg.layers, fx = pkg.flex, o = L.outline;
    if (!fx) return;
    const fmt = v => Fab.fmtLen(v, 3);
    const real = o && !o.board.synthetic;
    const inBoard = (x, y) => !real || C.insideBoard(o, x, y);
    const bb = pkg.boardBBox;

    // ---- what covers each side ----
    yield 'Flex: layers and cover';
    const cover = {};
    for (const side of ['top', 'bottom']) {
      const cu = L[side];
      cover[side] = fx.coverlay[side] ? 'coverlay' : pkg.onBoard(L.mask[side]) ? 'solder mask' : cu ? 'nothing (no coverlay, no mask openings)' : 'no copper';
    }
    const stiff = fx.stiffener;
    add('flex', 'info', 'Flex board', `Top: ${cover.top}. Bottom: ${cover.bottom}. ` +
      (stiff.length ? `Stiffener: ${stiff.map(l => l.file.name + (l.file.cls.side ? ` (${l.file.cls.side})` : '')).join(', ')}.` : 'No stiffener drawn.') +
      (L.bend.length ? ` Bend lines on ${L.bend.map(l => l.file.name).join(', ')}.` : '') +
      ` Checked with ${fmt(prof.coverlayExp)} coverlay opening clearance, ${fmt(prof.coverlayWeb)} coverlay web and ${fmt(prof.flexKeepaway)} keep-away from stiffener edges.`);

    if (prof.thickness > 0.6) add('flex', 'warn', `Checked as a ${fmt(prof.thickness)} thick board`, 'A flex is about 0.1 to 0.3 mm thick. Choose the Flex HDI profile (or a flex profile of your own), or set the board thickness, so drill aspect ratios and limits fit a flex.');

    // ---- coverlay openings ----
    for (const side of ['top', 'bottom']) {
      const cov = L.coverlay[side];
      if (!fx.coverlay[side] || !bb) continue;
      yield `Coverlay openings · ${cov.file.name}`;
      // Does the layer draw the film (a region over the board, openings cut out) or the openings
      // (like a mask)? Whichever covers less than half the board is the openings.
      let n = 0, drawn = 0;
      for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
        const x = bb[0] + (i + 0.5) * (bb[2] - bb[0]) / 40, y = bb[1] + (j + 0.5) * (bb[3] - bb[1]) / 40;
        if (!inBoard(x, y)) continue;
        n++; if (C.copperAt(cov, x, y)) drawn++;
      }
      const film = n && drawn / n > 0.5;
      const covered = (x, y) => inBoard(x, y) && (film ? C.copperAt(cov, x, y) : !C.copperAt(cov, x, y));
      const pads = padsOf(L[side], pkg, prof);
      const under = [], close = [], anchored = [], open = [];
      let minClear = Infinity;
      for (const p of pads) {
        const sh = C.shapes(p), lim = prof.coverlayExp;
        const g = Fab.bbox.grow(p.bbox, lim + T.sample * 2);
        const st = Math.min(T.sample, Math.max(0.005, Math.min(p.ap.w, p.ap.h) / 8));
        let inN = 0, inCov = 0, d = Infinity;
        for (let x = g[0]; x <= g[2]; x += st) for (let y = g[1]; y <= g[3]; y += st) {
          const inside = sh.some(s => C.inShape(s, x, y));
          if (!inside) {
            let dd = Infinity;
            for (const s of sh) dd = Math.min(dd, C.ptDist(s, x, y));
            if (dd > lim + T.sample) continue;
            if (covered(x, y) && dd < d) d = dd;
          } else { inN++; if (covered(x, y)) inCov++; }
        }
        const frac = inN ? inCov / inN : 0;
        if (frac > T.coveredPad) under.push({ p, frac });
        else if (frac > T.anchored) anchored.push(p);
        else { open.push(p); if (d < minClear) minClear = d; if (d < lim - 1e-4) close.push({ p, d }); }
      }
      const name = cov.file.name;
      add('coverlay', 'info', `${name}: ${pads.length} pads on ${side}`, `Coverlay drawn as ${film ? 'film (openings cut out)' : 'openings'}. ${open.length} pads in openings` +
        (isFinite(minClear) ? `, closest coverlay ${fmt(Math.max(0, minClear))} from a pad` : '') + `; ${anchored.length} anchored (coverlay overlaps the pad edge); ${under.length} covered.`, { layer: name });
      for (const u of under.slice(0, MAX)) add('coverlay', 'error', `Pad under coverlay on ${side}`, `${Math.round(u.frac * 100)}% of a ${Fab.fmtSize(u.p.ap.w, u.p.ap.h, 2)} pad is covered by ${name}. It can't be soldered.`, { at: { x: u.p.x, y: u.p.y }, layer: name });
      close.sort((a, b) => a.d - b.d);
      for (const c of close.slice(0, MAX)) add('coverlay', 'warn', `Coverlay ${fmt(Math.max(0, c.d))} from a pad`, `${name}, ${Fab.fmtSize(c.p.ap.w, c.p.ap.h, 2)} pad. Required ${fmt(prof.coverlayExp)} so coverlay registration doesn't cover the pad; or overlap the pad edge on purpose (anchoring).`, { at: { x: c.p.x, y: c.p.y }, layer: name, value: Math.max(0, c.d), limit: prof.coverlayExp });
      if (close.length > MAX) add('coverlay', 'warn', `…${close.length - MAX} more pads close to the coverlay`, '');

      // Web: a strip of coverlay between two openings, measured on the line between neighboring pads.
      if (prof.coverlayWeb > 0 && open.length > 1) {
        const grid = new G.Grid(T.webPair);
        for (const p of open) grid.insert(p, [p.x, p.y, p.x, p.y]);
        const webs = [], seen = new Set();
        for (const a of open) for (const b of grid.query([a.x - T.webPair, a.y - T.webPair, a.x + T.webPair, a.y + T.webPair])) {
          if (a === b || seen.has(b.i + ':' + a.i)) continue;
          seen.add(a.i + ':' + b.i);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len > T.webPair || len < 1e-6) continue;
          const steps = Math.ceil(len / T.webStep);
          let run = null, prev = false;
          for (let k = 0; k <= steps; k++) {
            const x = a.x + (b.x - a.x) * k / steps, y = a.y + (b.y - a.y) * k / steps, c = covered(x, y);
            if (c && !prev) run = k;
            if (!c && prev && run != null && run > 0) {
              const w = (k - run) * len / steps;
              if (w < prof.coverlayWeb - 1e-4) webs.push({ x: a.x + (b.x - a.x) * (run + k) / 2 / steps, y: a.y + (b.y - a.y) * (run + k) / 2 / steps, w });
            }
            prev = c;
          }
        }
        // Lines between different pad pairs cross the same strip: keep the narrowest per spot.
        webs.sort((p, q) => p.w - q.w);
        for (let i = 0; i < webs.length; i++) for (let j = webs.length - 1; j > i; j--) if (Math.hypot(webs[i].x - webs[j].x, webs[i].y - webs[j].y) < 0.25) webs.splice(j, 1);
        for (const w of webs.slice(0, MAX)) add('coverlay-web', 'warn', `Coverlay web ${fmt(w.w)} between openings`, `${name}. Below ${fmt(prof.coverlayWeb)} the strip can tear off or shift; open the pads as one gang opening, or space them out.`, { at: { x: w.x, y: w.y }, layer: name, value: w.w, limit: prof.coverlayWeb });
        if (webs.length > MAX) add('coverlay-web', 'warn', `…${webs.length - MAX} more narrow coverlay webs`, '');
      }
    }

    // ---- stiffeners ----
    yield 'Stiffeners';
    const stiffAt = (x, y) => stiff.some(l => C.copperAt(l, x, y));
    const parts = (pkg.pnp && pkg.pnp.parts || []).filter(p => isFinite(p.gx));
    if (!stiff.length) {
      if (parts.length) add('stiffener', 'info', 'No stiffener drawn', `${parts.length} placed part(s) sit on the flex with no stiffener layer. Connectors and fine-pitch parts usually need one behind them.`);
    } else {
      // Inside the outline.
      if (real) {
        const { grid } = C.outlineSegs(o);
        let worst = null;
        for (const l of stiff) for (const p of l.prims) {
          if (!p.dark || !Fab.bbox.overlaps(p.bbox, bb)) continue;
          const pts = p.k === 'R' ? [].concat(...p.contours) : p.k === 'L' || p.k === 'A' ? [p.x1, p.y1, p.x2, p.y2] : [p.x, p.y];
          for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1];
            if (C.insideBoard(o, x, y)) continue;
            let d = Infinity;
            for (const s of grid.query([x - 2, y - 2, x + 2, y + 2])) d = Math.min(d, G.ptSeg(x, y, s.a[0], s.a[1], s.b[0], s.b[1]));
            if (!isFinite(d)) d = 2;
            if (d > 0.05 && (!worst || d > worst.d)) worst = { x, y, d, l };
          }
        }
        if (worst) add('stiffener', 'warn', `Stiffener ${fmt(worst.d)} past the board outline`, `${worst.l.file.name}. A stiffener is cut to the flex outline or pulled back from it; check the drawing.`, { at: { x: worst.x, y: worst.y }, layer: worst.l.file.name, value: worst.d });
      }
      // Parts with a stiffener behind them (either side).
      const bare = parts.filter(p => inBoard(p.gx, p.gy) && !stiffAt(p.gx, p.gy));
      const conn = bare.filter(p => /^(J|P|CN|CON|X)\d/i.test(p.des));
      for (const p of conn.slice(0, MAX)) add('stiffener', 'warn', `${p.des} has no stiffener behind it`, `Connector on ${p.side} with no stiffener under it. Mating forces flex the joints; add a stiffener on the other side.`, { at: { x: p.gx, y: p.gy }, refs: [p.des], side: p.side });
      const rest = bare.filter(p => !conn.includes(p));
      if (rest.length) add('stiffener', 'info', `${rest.length} part(s) without a stiffener`, rest.slice(0, 30).map(p => p.des).join(', ') + (rest.length > 30 ? ' …' : '') + '. Fine for small passives in a static area; larger or fine-pitch parts usually need one.', { refs: rest.slice(0, 30).map(p => p.des) });
      if (parts.length && !bare.length) add('stiffener', 'info', `All ${parts.length} placed part(s) have a stiffener behind them`, '');
    }

    // Pads and vias near a stiffener edge or a bend line: the flex bends right there.
    yield 'Stiffener edges and bend lines';
    if (stiff.length || L.bend.length) {
      const near = [];
      const targets = [];
      for (const side of ['top', 'bottom']) for (const p of padsOf(L[side], pkg, prof)) targets.push({ x: p.x, y: p.y, r: Math.max(p.ap.w, p.ap.h) / 2, what: `${side} pad`, refs: null });
      for (const h of pkg.hits) if (h.plated && h.dia <= prof.viaMaxDrill) targets.push({ x: h.x, y: h.y, r: h.dia / 2, what: 'via' });
      const bendIdx = L.bend.length ? L.bend.map(l => C.index(l)) : [];
      for (const t of targets) {
        if (!inBoard(t.x, t.y)) continue;
        const R = t.r + prof.flexKeepaway;
        let edge = false;
        if (stiff.length) {
          const c0 = stiffAt(t.x, t.y);
          for (let k = 0; k < T.ring && !edge; k++) {
            const a = 2 * Math.PI * k / T.ring, x = t.x + R * Math.cos(a), y = t.y + R * Math.sin(a);
            if (inBoard(x, y) && stiffAt(x, y) !== c0) edge = 'stiffener edge';
          }
        }
        if (!edge) for (let b = 0; b < bendIdx.length && !edge; b++) for (const p of bendIdx[b].query([t.x - R, t.y - R, t.x + R, t.y + R])) if (p.dark && C.primDistToPoint(p, t.x, t.y) < R) { edge = 'bend line'; break; }
        if (edge) near.push({ t, edge });
      }
      for (const n of near.slice(0, MAX)) add('flex-edge', 'warn', `${n.t.what[0].toUpperCase() + n.t.what.slice(1)} within ${fmt(prof.flexKeepaway)} of a ${n.edge}`, `The flex bends at a ${n.edge}; copper joints and plated holes there crack. Move it at least ${fmt(prof.flexKeepaway)} away (from the pad or via edge).`, { at: { x: n.t.x, y: n.t.y }, limit: prof.flexKeepaway });
      if (near.length > MAX) add('flex-edge', 'warn', `…${near.length - MAX} more pads and vias near a stiffener edge or bend line`, '');
      if (!near.length) add('flex-edge', 'info', 'No pads or vias near a stiffener edge or bend line', `Keep-away ${fmt(prof.flexKeepaway)}.`);
    }

    // ---- the flexible area (inside the board, no stiffener) ----
    yield 'Flexible area';
    if (stiff.length) {
      const flexAt = (x, y) => inBoard(x, y) && !stiffAt(x, y);
      const vias = pkg.hits.filter(h => h.plated && flexAt(h.x, h.y));
      if (vias.length) {
        add('flex-area', 'info', `${vias.length} plated hole(s) in the flexible area`, 'Where the flexible area bends, keep vias out of it. Fine in a part that stays flat.', { at: vias[0] });
        for (const h of vias.slice(0, 10)) add('flex-area', 'info', `Via in the flexible area`, `⌀${Fab.fmtLen(h.dia)}. Keep it out of the bend.`, { at: h });
      }
      for (const lay of L.copper) {
        let area = 0, first = null;
        for (const p of lay.prims) {
          if (p.k !== 'R' || !p.dark || !p.contours.length) continue;
          const c = Fab.bbox.center(p.bbox);
          if (!flexAt(c.x, c.y)) continue;
          const a = Math.abs(G.area(p.contours[0]));
          if (a >= T.pourArea) { area += a; first = first || p; }
        }
        if (area) add('flex-area', 'info', `${lay.file.name}: ${area.toFixed(1)} mm² of solid copper in the flexible area`, 'Solid pours stiffen the flex and crack when it bends; use hatched (cross-hatched) copper where it bends.', { bbox: first.bbox, layer: lay.file.name });
      }
      // Traces stacked on top of each other on the two outer layers (the I-beam effect).
      if (L.top && L.bottom) {
        const segs = l => l.prims.filter(p => p.k === 'L' && p.dark && (!p.ap.fn || /Conductor/i.test(p.ap.fn)));
        const bot = segs(L.bottom), idx = new G.Grid(1.0);
        for (const b of bot) idx.insert(b, b.bbox);
        let total = 0;
        const hits = [];
        for (const t of segs(L.top)) {
          const tl = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
          if (tl < T.stackLen) continue;
          const mx = (t.x1 + t.x2) / 2, my = (t.y1 + t.y2) / 2;
          if (!flexAt(mx, my)) continue;
          const ux = (t.x2 - t.x1) / tl, uy = (t.y2 - t.y1) / tl, wt = Fab.gerber.drawWidth(t) || 0;
          for (const b of idx.query(Fab.bbox.grow(t.bbox, 0.2))) {
            const bl = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
            if (bl < 1e-6) continue;
            const cos = Math.abs(((b.x2 - b.x1) * ux + (b.y2 - b.y1) * uy) / bl);
            if (cos < Math.cos(T.stackAngle * Math.PI / 180)) continue;
            const off = Math.abs(-(((b.x1 + b.x2) / 2) - t.x1) * uy + (((b.y1 + b.y2) / 2) - t.y1) * ux);
            if (off > (wt + (Fab.gerber.drawWidth(b) || 0)) / 2) continue;
            const s1 = (b.x1 - t.x1) * ux + (b.y1 - t.y1) * uy, s2 = (b.x2 - t.x1) * ux + (b.y2 - t.y1) * uy;
            const ov = Math.min(tl, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2));
            if (ov >= T.stackLen) { total += ov; hits.push({ x: mx, y: my, ov }); }
          }
        }
        if (hits.length) {
          add('flex-area', 'info', `Traces stacked on both layers in the flexible area: ${total.toFixed(1)} mm`, 'A trace right over a trace on the other side makes an I-beam that resists bending and cracks first. Stagger them where the flex bends.', { at: hits[0] });
          for (const h of hits.sort((a, b) => b.ov - a.ov).slice(0, 10)) add('flex-area', 'info', `Stacked traces, ${h.ov.toFixed(1)} mm`, 'Top and bottom traces overlap here.', { at: { x: h.x, y: h.y } });
        }
      }
    }
  }

  C.flexSteps = run;
  C.flex = C.runner(run);
})(window.Fab);
