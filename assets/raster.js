// Raster geometry engine for DFM checks that need the union of shapes: copper-to-copper spacing,
// slivers/necks, mask dams involving region openings, and isolated copper.
// Layers are painted with the same painter as the board view (so clear polarity, negative planes and
// macro apertures come out identical), then analyzed with connected-component labeling and an exact
// Euclidean feature transform (Felzenszwalb & Huttenlocher), which also records each pixel's nearest
// feature pixel.
(function (Fab) {
  'use strict';
  const INF = 1e20;
  const TOL = 0.005; // mm: gaps within this of the limit count as meeting it (raster accuracy)
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');


  // ---- painting ----
  let canvas = null, knock = null;
  function rasterize(pkg, layer, x0, y0, W, H, res) {
    if (!canvas) { canvas = document.createElement('canvas'); knock = document.createElement('canvas'); }
    canvas.width = W; canvas.height = H; knock.width = W; knock.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ytop = y0 + H * res, s = 1 / res;
    const boardPath = pkg._boardPath || (pkg._boardPath = Fab.render.outlinePath(pkg.layers.outline));
    Fab.render.paintLayer(ctx, layer, c => c.setTransform(s, 0, 0, -s, -x0 * s, ytop * s), boardPath, knock);
    const data = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
    for (let i = 0, j = 3; i < mask.length; i++, j += 4) { alpha[i] = data[j]; mask[i] = data[j] > 127 ? 1 : 0; }
    return { mask, alpha, W, H, x0, ytop, res, mm: (i) => [x0 + ((i % W) + 0.5) * res, ytop - (Math.floor(i / W) + 0.5) * res] };
  }

  // ---- 1-D squared distance transform with argmin ----
  function edt1d(f, n, d, arg, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let r = v[k];
      let s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
      while (s <= z[k]) { k--; r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      d[q] = (q - r) * (q - r) + f[r];
      arg[q] = r;
    }
  }

  // Squared distance (px²) from every pixel to the nearest pixel with mask === want, and that pixel's index.
  function featureTransform(mask, W, H, want) {
    const n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), arg = new Int32Array(n);
    const d1 = new Float32Array(W * H), ny = new Int32Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = mask[y * W + x] === want ? 0 : INF;
      edt1d(f, H, d, arg, v, z);
      for (let y = 0; y < H; y++) { d1[y * W + x] = d[y]; ny[y * W + x] = arg[y]; }
    }
    const dist = new Float32Array(W * H), near = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) f[x] = d1[row + x];
      edt1d(f, W, d, arg, v, z);
      for (let x = 0; x < W; x++) { const ax = arg[x]; dist[row + x] = d[x]; near[row + x] = ny[row + ax] * W + ax; }
    }
    return { dist, near };
  }

  // ---- 8-connected component labeling (union-find) ----
  function label(mask, W, H) {
    const lab = new Int32Array(W * H);
    const parent = [0];
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let l = 0;
      const nb = [x > 0 ? i - 1 : -1, y > 0 && x > 0 ? i - W - 1 : -1, y > 0 ? i - W : -1, y > 0 && x < W - 1 ? i - W + 1 : -1];
      for (const j of nb) if (j >= 0 && lab[j]) { if (!l) l = lab[j]; else if (lab[j] !== l) union(l, lab[j]); }
      if (!l) { l = parent.length; parent.push(l); }
      lab[i] = l;
    }
    const remap = new Int32Array(parent.length);
    let n = 0;
    for (let i = 0; i < lab.length; i++) if (lab[i]) {
      const r = find(lab[i]);
      if (!remap[r]) remap[r] = ++n;
      lab[i] = remap[r];
    }
    return { lab, n };
  }

  // ---- tiling ----
  function tiles(bb, res, margin) {
    const T = 2048; // interior pixels per tile side
    const out = [];
    const wmm = bb[2] - bb[0], hmm = bb[3] - bb[1];
    const nx = Math.max(1, Math.ceil(wmm / (T * res))), ny = Math.max(1, Math.ceil(hmm / (T * res)));
    for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
      const ix0 = bb[0] + ix * T * res, iy0 = bb[1] + iy * T * res;
      const ix1 = Math.min(bb[2], ix0 + T * res), iy1 = Math.min(bb[3], iy0 + T * res);
      out.push({ interior: [ix0, iy0, ix1, iy1], x0: ix0 - margin, y0: iy0 - margin, W: Math.ceil((ix1 - ix0 + 2 * margin) / res), H: Math.ceil((iy1 - iy0 + 2 * margin) / res) });
    }
    return out;
  }
  const inside = (b, x, y) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3];

  // Group points into clusters no farther than r apart (greedy), keeping the smallest value.
  function cluster(points, r) {
    const out = [];
    for (const p of points) {
      let c = null;
      for (const q of out) if (q.key === p.key && Math.hypot(q.x - p.x, q.y - p.y) < r) { c = q; break; }
      if (!c) { out.push(Object.assign({ n: 1, bbox: [p.x, p.y, p.x, p.y] }, p)); continue; }
      c.n++; Fab.bbox.addPt(c.bbox, p.x, p.y);
      if (p.v < c.v) { c.v = p.v; c.x = p.x; c.y = p.y; c.a = p.a; c.b = p.b; }
    }
    return out;
  }

  // Gap length in pixels between copper pixels a and b: integrate the uncovered fraction (1 - alpha)
  // along the line between them, using the anti-aliased coverage for sub-pixel edges.
  function subpixelGap(R, a, b) {
    const { alpha, W, H } = R;
    const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(2, Math.ceil(len * 4));
    let gap = 0;
    const prof = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : alpha[yy * W + xx];
      const v = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      gap += (1 - v / 255) * len / n;
      prof[k] = v;
    }
    // A true gap's coverage is one valley. A hairline of copper thinner than a pixel shows as a bump
    // with lower coverage on both sides of it.
    const minL = new Float32Array(n), minR = new Float32Array(n);
    for (let k = 0, m = 255; k < n; k++) { m = Math.min(m, prof[k]); minL[k] = m; }
    for (let k = n - 1, m = 255; k >= 0; k--) { m = Math.min(m, prof[k]); minR[k] = m; }
    // Also a hairline when the gap is measured along it: coverage never drops to background.
    let hair = minL[n - 1] > 50;
    for (let k = 1; k < n - 1 && !hair; k++) if (prof[k] - minL[k] > 50 && prof[k] - minR[k] > 50) hair = true;
    return { gap, hair };
  }

  // Gaps narrower than limPx between different connected regions of R.mask.
  function gaps(R, interior, lim) {
    const { mask, W, H, res } = R;
    const { lab } = label(mask, W, H);
    const { dist, near } = featureTransform(mask, W, H, 1);
    const limPx = lim / res, band = (limPx / 2 + 2) * (limPx / 2 + 2);
    const pts = [];
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const p = y * W + x;
      if (mask[p] || dist[p] > band) continue;
      for (const q of [p + 1, p + W]) {
        const a = near[p], b = near[q];
        const la = lab[a], lb = lab[b];
        if (!la || !lb || la === lb) continue;
        // Cheap pre-filter on pixel centres (can be one pixel off), then a sub-pixel measurement.
        if (Math.hypot((a % W) - (b % W), Math.floor(a / W) - Math.floor(b / W)) - 1 >= limPx + 1) continue;
        const m = subpixelGap(R, a, b), gpx = m.gap;
        if (gpx >= limPx) continue;
        const [ax, ay] = R.mm(a), [bx, by] = R.mm(b);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (!inside(interior, mx, my)) continue;
        pts.push({ key: Math.min(la, lb) + ':' + Math.max(la, lb), x: mx, y: my, v: gpx * res, hair: m.hair, a: [ax, ay], b: [bx, by] });
      }
    }
    return cluster(pts, 1.0);
  }

  // Copper narrower than lim: ridge pixels (local maxima of the inside distance) with a small width,
  // and background on both sides. The two-sided test drops staircase bumps on edges, where the point
  // mirrored across the ridge from the nearest background lies deep inside copper.
  function slivers(R, interior, lim) {
    const { mask, W, H, res } = R;
    const { dist, near } = featureTransform(mask, W, H, 0);
    const bgNear = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && !mask[yy * W + xx]) return true;
      }
      return false;
    };
    const pts = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      const dp = dist[p];
      const w = (2 * Math.sqrt(dp) - 1) * res;
      if (w >= lim || w <= 0) continue;
      let ridge = true;
      for (const q of [p - 1, p + 1, p - W, p + W, p - W - 1, p - W + 1, p + W - 1, p + W + 1]) if (dist[q] > dp) { ridge = false; break; }
      if (!ridge) continue;
      const nb = near[p];
      if (!bgNear(2 * x - (nb % W), 2 * y - Math.floor(nb / W))) continue;
      const [mx, my] = R.mm(p);
      if (!inside(interior, mx, my)) continue;
      pts.push({ key: 's', x: mx, y: my, v: w });
    }
    return cluster(pts, 0.5).filter(c => c.n >= 3);
  }

  // ---- checks ----
  function pickRes(prof, bb) {
    const want = Math.min(0.025, prof.minSpace / 5);
    return Math.max(want, Math.sqrt(Math.max(1, (bb[2] - bb[0]) * (bb[3] - bb[1])) / 60e6));
  }

  function copperSpacing(pkg, layer, prof, add, MAX) {
    const bb = Fab.bbox.grow(pkg.boardBBox, 0.5);
    const res = pickRes(prof, bb);
    const margin = Math.max(prof.minSpace, prof.minTrace) + 20 * res;
    const name = layer.file.name;
    const neg = layer.polarity === 'negative';
    let gapsAll = [], thin = [];
    for (const t of tiles(bb, res, margin)) {
      const R = rasterize(pkg, layer, t.x0, t.y0, t.W, t.H, res);
      gapsAll = gapsAll.concat(gaps(R, t.interior, prof.minSpace));
      thin = thin.concat(slivers(R, t.interior, prof.minTrace));
    }
    const tol = `measured on a ${Math.round(res * 1000)} µm raster with sub-pixel edges, about ±5 µm`;
    gapsAll = gapsAll.filter(g => g.v < prof.minSpace - TOL);
    // Sub-pixel copper between two clearances splits the copper in the raster; it is a sliver.
    const hair = gapsAll.filter(g => g.hair);
    gapsAll = gapsAll.filter(g => !g.hair);
    for (const g of hair.slice(0, MAX)) add('sliver', 'error', 'Copper hairline narrower than the raster',
      `${name}: a hairline of ${neg ? 'plane' : 'pour'} copper, thinner than ${Math.round(res * 1000)} µm, is left between two clearances (for example where an edge pull-back and a via clearance almost meet). It will flake off; widen the clearance so they overlap, or remove the copper.`,
      { at: { x: g.x, y: g.y }, bbox: Fab.bbox.grow([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])], 0.15), layer: name });
    gapsAll.sort((a, b) => a.v - b.v);
    for (const g of gapsAll.slice(0, MAX)) add('spacing', g.v < prof.minSpace * 0.8 ? 'error' : 'warn', `Copper spacing ≈${Fab.fmtLen(g.v, 3)}`,
      `${name}: two separate copper areas closer than ${Fab.fmtLen(prof.minSpace)} (${tol}).`,
      { at: { x: g.x, y: g.y }, bbox: Fab.bbox.grow([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])], 0.15), layer: name, value: g.v, limit: prof.minSpace });
    if (gapsAll.length > MAX) add('spacing', 'warn', `…${gapsAll.length - MAX} more spacing findings on ${name}`, '');
    // Narrow drawn traces are already reported by the vector trace check; keep pours, pads and planes.
    if (!neg) thin = thin.filter(s => !Fab.checks.primsAt(layer, s.x, s.y, p => p.k === 'L' || p.k === 'A').length);
    // A wedge (copper tapering to a point, e.g. where a round clearance meets a straight one) always
    // narrows to about one pixel; a neck stays wider. Report necks one by one, wedges as a summary.
    const wedges = thin.filter(s => s.v < 2 * res), necks = thin.filter(s => s.v >= 2 * res).sort((a, b) => a.v - b.v);
    for (const s of necks.slice(0, MAX)) add('sliver', s.v < prof.minTrace / 2 ? 'error' : 'warn', `Copper neck ≈${Fab.fmtLen(s.v, 3)} wide`,
      `${name}: ${neg ? 'plane' : 'pour/pad'} copper narrows below ${Fab.fmtLen(prof.minTrace)} here (${tol}). It may etch through or lift.`,
      { at: { x: s.x, y: s.y }, bbox: Fab.bbox.grow(s.bbox, 0.15), layer: name, value: s.v, limit: prof.minTrace });
    if (necks.length > MAX) add('sliver', 'warn', `…${necks.length - MAX} more copper necks on ${name}`, '');
    if (wedges.length) {
      const w0 = wedges[0];
      add('sliver', 'info', `${name}: ${plural(wedges.length, 'copper wedge')} tapering to a point`,
        `Where two clearances or a clearance and the edge pull-back meet at a shallow angle, the copper between them tapers to nothing. Fabs usually remove these slivers; fix them in the design if the fab drawing forbids edits. First at ${w0.x.toFixed(2)}, ${w0.y.toFixed(2)} mm.`,
        { at: { x: w0.x, y: w0.y }, bbox: Fab.bbox.grow(w0.bbox, 0.3), layer: name });
    }
    return { res, gaps: gapsAll.length, slivers: necks.length };
  }

  function maskDams(pkg, layer, prof, add, MAX) {
    const bb = Fab.bbox.grow(pkg.boardBBox, 0.5);
    const res = pickRes(prof, bb);
    const margin = prof.minMaskDam + 20 * res;
    let all = [];
    for (const t of tiles(bb, res, margin)) {
      const R = rasterize(pkg, layer, t.x0, t.y0, t.W, t.H, res);
      all = all.concat(gaps(R, t.interior, prof.minMaskDam));
    }
    all = all.filter(g => g.v < prof.minMaskDam - TOL);
    // Dams between two flashed openings are measured exactly by the vector check already.
    const flashAt = (x, y) => Fab.checks.primsAt(layer, x, y, p => p.k === 'F').length > 0;
    all = all.filter(g => !(flashAt(g.a[0], g.a[1]) && flashAt(g.b[0], g.b[1])));
    all.sort((a, b) => a.v - b.v);
    const name = layer.file.name;
    for (const g of all.slice(0, MAX)) add('mask-dam', 'warn', `Mask dam ≈${Fab.fmtLen(g.v, 3)} next to a region opening`,
      `${name}: the mask web between these openings is below ${Fab.fmtLen(prof.minMaskDam)} (${Math.round(res * 1000)} µm raster, about ±5 µm). It will flake off or be removed.`,
      { at: { x: g.x, y: g.y }, bbox: Fab.bbox.grow([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])], 0.15), layer: name, value: g.v, limit: prof.minMaskDam });
    if (all.length > MAX) add('mask-dam', 'warn', `…${all.length - MAX} more region mask dams on ${name}`, '');
    return { res, count: all.length };
  }

  // Copper areas not connected to any pad, via or plated hole on this layer.
  function islands(pkg, layer, prof, add, MAX) {
    const bb = Fab.bbox.grow(pkg.boardBBox, 0.2);
    const res = Math.max(0.025, Math.sqrt((bb[2] - bb[0]) * (bb[3] - bb[1]) / 12e6));
    const W = Math.ceil((bb[2] - bb[0]) / res), H = Math.ceil((bb[3] - bb[1]) / res);
    const R = rasterize(pkg, layer, bb[0], bb[1], W, H, res);
    const { lab, n } = label(R.mask, W, H);
    const seeded = new Uint8Array(n + 1);
    const seed = (x, y) => {
      const i = Math.floor((R.ytop - y) / res) * W + Math.floor((x - bb[0]) / res);
      if (i >= 0 && i < lab.length && lab[i]) seeded[lab[i]] = 1;
    };
    for (const h of pkg.hits) if (h.plated) seed(h.x, h.y);
    for (const s of pkg.slots) if (s.plated) { seed(s.x1, s.y1); seed(s.x2, s.y2); }
    if (layer.polarity !== 'negative') for (const p of layer.prims) if (p.dark && p.k === 'F') seed(p.x, p.y);
    // Component pads drawn as regions (X2 AperFunction …Pad)
    if (layer.polarity !== 'negative') for (const p of layer.prims) if (p.dark && p.k === 'R' && /Pad/i.test(p.fn || '')) { const c = Fab.bbox.center(p.bbox); seed(c.x, c.y); }
    const area = new Float64Array(n + 1), box = new Map();
    for (let i = 0; i < lab.length; i++) {
      const l = lab[i];
      if (!l || seeded[l]) continue;
      area[l] += res * res;
      const x = bb[0] + ((i % W) + 0.5) * res, y = R.ytop - (Math.floor(i / W) + 0.5) * res;
      const b = box.get(l);
      if (!b) box.set(l, [x, y, x, y]); else Fab.bbox.addPt(b, x, y);
    }
    const found = [...box.entries()].map(([l, b]) => ({ l, b, a: area[l] })).filter(x => x.a >= prof.isoMinArea).sort((x, y) => y.a - x.a);
    const name = layer.file.name;
    for (const f of found.slice(0, MAX)) {
      const c = Fab.bbox.center(f.b);
      add('isolated', 'warn', `Isolated copper, ${f.a.toFixed(2)} mm²`,
        `${name}: copper not connected to any pad, via or plated hole (${Math.round(res * 1000)} µm raster). Remove it, tie it to a net, or confirm it is intentional (text, logo, shield).`,
        { at: { x: c.x, y: c.y }, bbox: Fab.bbox.grow(f.b, 0.2), layer: name, value: f.a });
    }
    if (found.length > MAX) add('isolated', 'warn', `…${found.length - MAX} more isolated copper areas on ${name}`, '');
    let cu = 0;
    for (let i = 0; i < R.mask.length; i++) if (R.mask[i]) cu++;
    return { res, count: found.length, copperArea: cu * res * res };
  }

  Fab.raster = { rasterize, featureTransform, label, gaps, slivers, copperSpacing, maskDams, islands, edt1d };
})(window.Fab);
