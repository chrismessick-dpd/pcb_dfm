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
  // along the line through them, using the anti-aliased coverage for sub-pixel edges. The line runs
  // past a and b until coverage is full copper: a and b are only half covered or more, and stopping at
  // their centers drops up to half a pixel of gap at each end (a true 0.127 mm gap read 0.112 mm).
  function subpixelGap(R, a, b) {
    const { alpha, W, H } = R;
    const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : alpha[yy * W + xx];
    const cov = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
    // How far past an end (up to 1.5 px) the coverage takes to reach full copper.
    const reach = (x, y, s) => { let t = 0; while (t < 1.5 && cov(x + s * ux * t, y + s * uy * t) < 250) t += 0.25; return t; };
    const ea = reach(ax, ay, -1), eb = reach(bx, by, 1), span = ea + len + eb;
    const n = Math.max(2, Math.ceil(span * 4));
    let gap = 0;
    const prof = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n * span - ea;
      const v = cov(ax + ux * t, ay + uy * t);
      gap += (1 - v / 255) * span / n;
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

  // Net of each connected region, from netlist points that land on it: label -> net name, or '?' when
  // two nets land on one region (the netlist and Gerbers disagree there).
  function netsOf(R, lab, seeds) {
    const { W, H, res } = R, out = new Map();
    for (const s of seeds) {
      const i = Math.floor((s.x - R.x0) / res), j = Math.floor((R.ytop - s.y) / res);
      if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) continue;
      let l = lab[j * W + i];
      for (let d = 0; !l && d < 9; d++) l = lab[(j - 1 + Math.floor(d / 3)) * W + i - 1 + d % 3];
      if (!l) continue;
      const n = out.get(l);
      if (n === undefined) out.set(l, s.net); else if (n !== s.net) out.set(l, '?');
    }
    return out;
  }

  // Gaps narrower than limPx between different connected regions of R.mask. With seeds (netlist
  // points), each gap also gets the nets of its two sides (na, nb), where known.
  function gaps(R, interior, lim, seeds, raw) {
    const { mask, W, H, res } = R;
    const { lab } = label(mask, W, H);
    const nets = seeds ? netsOf(R, lab, seeds) : null;
    const netOf = l => { const n = nets && nets.get(l); return n && n !== '?' ? n : null; };
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
        pts.push({ key: Math.min(la, lb) + ':' + Math.max(la, lb), x: mx, y: my, v: gpx * res, hair: m.hair, a: [ax, ay], b: [bx, by], na: netOf(la), nb: netOf(lb) });
      }
    }
    return raw ? pts : cluster(pts, 1.0);
  }

  // Morphological opening of the copper by a disc of radius rho px: the copper at least 2·rho wide.
  // Returns the opened mask; dist is the inside distance transform of mask (px²).
  function opening(mask, dist, W, H, rho) {
    const r2 = rho * rho, g = rho + 0.5, R = Math.ceil(g), offs = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= g * g) offs.push([dx, dy]);
    // Grow the core back by rho with a disc: rho is a few pixels, so this is much cheaper than a
    // second distance transform. Pixels in the core are open already.
    const open = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      if (dist[i] > r2) { open[i] = 1; continue; }
      for (const [dx, dy] of offs) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && dist[yy * W + xx] > r2) { open[i] = 1; break; }
      }
    }
    return open;
  }

  // Width in px of the copper at pixel p: the shortest chord through p over 16 directions, each
  // integrating the anti-aliased coverage outward until it reaches background on both sides.
  function crossWidth(R, p, maxPx) {
    const { alpha, W, H } = R;
    const px = p % W, py = Math.floor(p / W);
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : alpha[yy * W + xx];
    const cov = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      return ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy) / 255;
    };
    const step = 0.25;
    let best = null;
    for (let k = 0; k < 16; k++) {
      const ux = Math.cos(k * Math.PI / 16), uy = Math.sin(k * Math.PI / 16);
      let w = cov(px, py) * step, ok = true;
      for (const s of [1, -1]) {
        let done = false;
        for (let t = step; t <= maxPx; t += step) {
          const v = cov(px + s * ux * t, py + s * uy * t);
          if (v < 0.03) { done = true; break; }
          w += v * step;
        }
        if (!done) { ok = false; break; }
      }
      if (ok && (best == null || w < best)) best = w;
    }
    return best;
  }

  // Copper narrower than lim: ridge pixels (local maxima of the inside distance) with a small width,
  // and background on both sides. The two-sided test drops staircase bumps on edges, where the point
  // mirrored across the ridge from the nearest background lies deep inside copper.
  // Each sliver is then classified by shape, not width: thin copper (outside the opening by lim) that
  // meets wide copper in two or more places is a neck that carries copper through, however narrow;
  // thin copper that meets it once is a wedge or finger that dead-ends.
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
      pts.push({ key: 's', x: mx, y: my, v: w, p, t: 0 });
    }
    if (!pts.length) return [];
    // Shape analysis, only for tiles with thin copper to classify.
    const open = opening(mask, dist, W, H, lim / res / 2);
    const thin = new Uint8Array(W * H);
    for (let i = 0; i < thin.length; i++) if (mask[i] && !open[i]) thin[i] = 1;
    const tl = label(thin, W, H).lab;
    // Contact pixels: thin pixels next to wide copper, grouped into separate contacts.
    const touch = new Uint8Array(W * H), side = new Map();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!thin[p]) continue;
      for (const q of [p - 1, p + 1, p - W, p + W, p - W - 1, p - W + 1, p + W - 1, p + W + 1]) if (open[q]) { touch[p] = 1; side.set(p, q); break; }
    }
    const cl = label(touch, W, H).lab, contacts = new Map(); // thin component -> Map(contact -> wide pixel)
    for (const [p, q] of side) {
      const t = tl[p];
      if (!contacts.has(t)) contacts.set(t, new Map());
      const m = contacts.get(t);
      if (!m.has(cl[p])) m.set(cl[p], q);
    }
    for (const s of pts) if (thin[s.p]) s.t = tl[s.p];
    // Necks: one finding per thin component, at its narrowest ridge pixel, with no minimum size (a
    // short neck between two round clearances has only a pixel or two of ridge).
    // The pixel-quantized width can't rank ridge pixels a pixel or two wide, so measure each one.
    const maxPx = lim / res + 4;
    const necks = new Map(), rest = [];
    for (const s of pts) {
      const c = s.t && contacts.get(s.t);
      if (!c || c.size < 2) { rest.push(s); continue; }
      const sw = crossWidth(R, s.p, maxPx);
      if (sw != null) s.v = sw * res;
      const n = necks.get(s.t);
      if (!n) necks.set(s.t, Object.assign({ n: 1, bbox: [s.x, s.y, s.x, s.y] }, s));
      else { n.n++; Fab.bbox.addPt(n.bbox, s.x, s.y); if (s.v < n.v) Object.assign(n, { x: s.x, y: s.y, v: s.v, p: s.p }); }
    }
    // The ends of a neck, where it widens back toward lim, can survive the opening. Their ridge pixels
    // belong to that neck, not to a second finding beside it.
    const own = (s) => {
      const x = s.p % W, y = Math.floor(s.p / W);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const n = thin[yy * W + xx] && necks.get(tl[yy * W + xx]);
        if (n) return n;
      }
      return null;
    };
    for (let i = rest.length - 1; i >= 0; i--) {
      const n = own(rest[i]);
      if (n) { n.n++; Fab.bbox.addPt(n.bbox, rest[i].x, rest[i].y); rest.splice(i, 1); }
    }
    const out = [];
    for (const n of necks.values()) {
      n.neck = true;
      n.sides = [...contacts.get(n.t).values()].map(q => R.mm(q));
      out.push(n);
    }
    for (const c of cluster(rest, 0.5)) {
      if (c.n < 3) continue;
      if (c.v >= 2 * res) { const sw = crossWidth(R, c.p, maxPx); if (sw != null) c.v = sw * res; }
      out.push(c);
    }
    return out;
  }

  // Connected areas of the copper at least about lim wide, on a whole-board raster: labels of the
  // opening by a little under lim/2, so copper close to the limit still counts as a connection at this
  // coarser raster. Shared by the neck and gap tests on a layer, so it is built once per check run.
  function wide(pkg, layer, lim) {
    const c = layer._wide;
    if (c && c.lim === lim && c.pkg === pkg) return c;
    const bb = Fab.bbox.grow(pkg.boardBBox, 0.2);
    const res = Math.max(0.025, Math.sqrt((bb[2] - bb[0]) * (bb[3] - bb[1]) / 12e6));
    const W = Math.ceil((bb[2] - bb[0]) / res), H = Math.ceil((bb[3] - bb[1]) / res);
    const R = rasterize(pkg, layer, bb[0], bb[1], W, H, res);
    const { dist } = featureTransform(R.mask, W, H, 0);
    const { lab, n } = label(opening(R.mask, dist, W, H, 0.75 * lim / res / 2), W, H);
    return (layer._wide = { pkg, lim, bb, res, W, H, ytop: R.ytop, lab, n });
  }

  // Which necks are the only copper joining two areas: label the copper at least lim wide on a
  // whole-board raster (tiles are too small to see a plane's other connections) and look up each
  // side of each neck. Sets s.split = { area, holes } for the smallest area cut off.
  function splits(pkg, layer, lim, necks) {
    const { bb, res, W, H, ytop, lab, n } = wide(pkg, layer, lim);
    const px = (x, y) => [Math.floor((x - bb[0]) / res), Math.floor((ytop - y) / res)];
    const at = (x, y) => {
      const [i, j] = px(x, y), seen = new Map();
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = i + dx, yy = j + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const l = lab[yy * W + xx];
        if (l) seen.set(l, (seen.get(l) || 0) + 1 / (1 + dx * dx + dy * dy));
      }
      let best = 0, bw = 0;
      for (const [l, w] of seen) if (w > bw) { best = l; bw = w; }
      return best;
    };
    let area = null, holes = null;
    for (const s of necks) {
      const ls = [...new Set(s.sides.map(([x, y]) => at(x, y)).filter(Boolean))];
      if (ls.length < 2) continue;
      if (!area) {
        area = new Float64Array(n + 1); holes = new Int32Array(n + 1);
        for (let i = 0; i < lab.length; i++) if (lab[i]) area[lab[i]] += res * res;
        const hit = (x, y) => { const [i, j] = px(x, y); if (i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i]) holes[lab[j * W + i]]++; };
        for (const h of pkg.hits) if (h.plated) hit(h.x, h.y);
      }
      const l = ls.reduce((a, b) => area[a] <= area[b] ? a : b);
      s.split = { area: area[l], holes: holes[l] };
    }
  }

  // Marks gaps and hairlines whose two sides are one connected area of copper at least lim wide on a
  // whole-board raster (g.joined). Thin copper is opened away first, so a hairline, or a gap that
  // closes up on this coarser raster, can't count as the connection.
  function joined(pkg, layer, lim, list) {
    const { bb, res, W, H, ytop, lab } = wide(pkg, layer, lim);
    // Nearest wide copper within three pixels of a point.
    const at = (x, y) => {
      const i = Math.floor((x - bb[0]) / res), j = Math.floor((ytop - y) / res);
      for (let d = 0; d <= 3; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        const ii = i + dx, jj = j + dy;
        if (ii >= 0 && jj >= 0 && ii < W && jj < H && lab[jj * W + ii]) return lab[jj * W + ii];
      }
      return 0;
    };
    for (const g of list) {
      const d = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1, ux = (g.b[0] - g.a[0]) / d, uy = (g.b[1] - g.a[1]) / d;
      // Walk away from the gap on each side until wide copper (up to 0.5 mm): next to a hairline the
      // copper tapers in from both sides and is thin for a while.
      const walk = (x, y, s) => { for (let t = 2 * res; t <= 0.5; t += res) { const l = at(x + s * ux * t, y + s * uy * t); if (l) return l; } return 0; };
      const la = walk(g.a[0], g.a[1], -1), lb = walk(g.b[0], g.b[1], 1);
      if (la && la === lb) g.joined = true;
    }
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
    // Netlist points on this layer: through-hole pads and vias reach every layer, SMD pads one side.
    const pts = Fab.ipc356 && Fab.ipc356.points(pkg);
    const seeds = pts && pts.filter(p => !p.side || p.side === layer.side);
    let gapsAll = [], thin = [];
    for (const t of tiles(bb, res, margin)) {
      const R = rasterize(pkg, layer, t.x0, t.y0, t.W, t.H, res);
      gapsAll = gapsAll.concat(gaps(R, t.interior, prof.minSpace, seeds));
      thin = thin.concat(slivers(R, t.interior, prof.minTrace));
    }
    const tol = `measured on a ${Math.round(res * 1000)} µm raster with sub-pixel edges, about ±5 µm`;
    gapsAll = gapsAll.filter(g => g.v < prof.minSpace - TOL);
    // Near the limit the coarse reading depends on the gap's angle to the pixel grid and runs up to
    // 6 µm low, which turned a board drawn at exactly the limit into hundreds of findings. Re-measure
    // those gaps on a small 4 µm patch, which agrees with the Gerber geometry to about 1 µm.
    // A narrow coarse gap can also be copper joined by a hairline too thin for the coarse raster: if the
    // patch shows no gap and its two sides connected, it is a hairline, not a gap.
    // Patches are 1 mm squares shared by nearby gaps, painted with only the primitives that reach them
    // (painting the whole layer per gap took over a minute on a dense board).
    const fr = Math.min(0.004, res / 4), half = 0.5, inner = half - prof.minSpace - 0.1, N = Math.ceil(2 * half / fr);
    let P = null;
    const cell = g => Math.floor(g.x / (2 * inner)) * 1e4 + Math.floor(g.y / (2 * inner));
    for (const g of gapsAll.slice().sort((a, b) => cell(a) - cell(b))) {
      if (g.hair) continue;
      if (!P || Math.abs(g.x - P.cx) > inner || Math.abs(g.y - P.cy) > inner) {
        // Centered on the gap's grid cell, so every gap in the cell shares this patch.
        const cx = (Math.floor(g.x / (2 * inner)) + 0.5) * 2 * inner, cy = (Math.floor(g.y / (2 * inner)) + 0.5) * 2 * inner;
        const box = [cx - half, cy - half, cx + half, cy + half];
        const part = Object.assign(Object.create(layer), { prims: layer.prims.filter(p => !p.bbox || (p.bbox[0] <= box[2] && p.bbox[2] >= box[0] && p.bbox[1] <= box[3] && p.bbox[3] >= box[1])), _groups: null });
        P = { cx, cy, F: rasterize(pkg, part, box[0], box[1], N, N, fr) };
        P.all = gaps(P.F, [box[0] + 0.1, box[1] + 0.1, box[2] - 0.1, box[3] - 0.1], prof.minSpace, null, true).filter(f => !f.hair);
        P.lab = null;
      }
      const F = P.F;
      const fine = P.all.filter(f => Math.abs(f.x - g.x) < 0.06 && Math.abs(f.y - g.y) < 0.06).sort((a, b) => a.v - b.v)[0];
      if (fine) { g.v = fine.v; g.a = fine.a; g.b = fine.b; g.x = fine.x; g.y = fine.y; continue; }
      const lab = P.lab || (P.lab = label(F.mask, N, N).lab);
      const at = (x, y) => {
        const i = Math.floor((x - F.x0) / fr), j = Math.floor((F.ytop - y) / fr);
        for (let d = 0; d <= 3; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
          const ii = i + dx, jj = j + dy;
          if (ii >= 0 && jj >= 0 && ii < N && jj < N && lab[jj * N + ii]) return lab[jj * N + ii];
        }
        return 0;
      };
      const la = at(g.a[0], g.a[1]);
      if (la && la === at(g.b[0], g.b[1])) g.hair = true; else g.v = Infinity;
    }
    gapsAll = gapsAll.filter(g => g.v < prof.minSpace - TOL);
    // Copper with no netlist point on it (a sliver of plane between two clearances) has no net, but
    // when both sides are one connected area on the whole layer they are the same net by definition.
    // A hairline's sides are tested the same way: joined elsewhere, it only loses a sliver of copper.
    const unknown = gapsAll.filter(g => g.hair || !g.na || !g.nb);
    if (unknown.length) joined(pkg, layer, prof.minTrace, unknown);
    // Sub-pixel copper between two clearances splits the copper in the raster; it is a sliver.
    const hair = gapsAll.filter(g => g.hair);
    gapsAll = gapsAll.filter(g => !g.hair);
    // Like necks, a hairline is an error only when it is the only copper joining its two sides.
    hair.sort((a, b) => !!a.joined - !!b.joined);
    for (const g of hair.slice(0, MAX)) add('sliver', g.joined ? 'warn' : 'error', g.joined ? 'Copper hairline narrower than the raster' : 'Copper hairline narrower than the raster is the only link between two areas',
      `${name}: a hairline of ${neg ? 'plane' : 'pour'} copper, thinner than ${Math.round(res * 1000)} µm, is left between two clearances (for example where an edge pull-back and a via clearance almost meet). ${g.joined ? 'The copper on both sides joins elsewhere, so only the sliver is at risk: it can flake off. Widen a clearance so they overlap, or leave it for the fab to remove.' : 'Nothing else joins the copper on its two sides, so if it etches through, one side is cut off. Give that copper a full-width connection.'}`,
      { at: { x: g.x, y: g.y }, bbox: Fab.bbox.grow([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])], 0.15), layer: name });
    // With an IPC-356 netlist: different nets are errors (a bridge shorts them), the same net is a
    // warning (e.g. a ground thermal pad and its ring). Areas with no netlist point keep the width rule.
    const kind = g => g.joined ? 3 : !g.na || !g.nb ? 1 : g.na === g.nb ? 2 : 0;
    gapsAll.sort((a, b) => kind(a) - kind(b) || a.v - b.v);
    for (const g of gapsAll.slice(0, MAX)) {
      const k = kind(g), title = `Copper spacing ≈${Fab.fmtLen(g.v, 3)}`;
      const at = { at: { x: g.x, y: g.y }, bbox: Fab.bbox.grow([Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1])], 0.15), layer: name, value: g.v, limit: prof.minSpace };
      if (k === 0) add('spacing', 'error', `${title} between nets ${g.na} and ${g.nb}`,
        `${name}: copper on ${g.na} and ${g.nb} closer than ${Fab.fmtLen(prof.minSpace)} (${tol}). A copper bridge here shorts the two nets.`, at);
      else if (k === 2) add('spacing', 'warn', `${title}, same net ${g.na}`,
        `${name}: two copper areas on ${g.na} closer than ${Fab.fmtLen(prof.minSpace)} (${tol}). A bridge would not short anything, but the fab may still flag the gap.`, at);
      else if (k === 3) add('spacing', 'warn', `${title}, same copper area`,
        `${name}: copper closer than ${Fab.fmtLen(prof.minSpace)} to itself (${tol}): the two sides join elsewhere on the layer, so they are one net. The fab may still flag the gap.`, at);
      else add('spacing', g.v < prof.minSpace * 0.8 ? 'error' : 'warn', title,
        `${name}: two separate copper areas closer than ${Fab.fmtLen(prof.minSpace)} (${tol}).${seeds ? ' The netlist has no pad or via on at least one of them, so the nets are unknown.' : ''}`, at);
    }
    if (gapsAll.length > MAX) {
      const rest = gapsAll.slice(MAX), same = rest.filter(g => kind(g) >= 2).length;
      add('spacing', 'warn', `…${rest.length} more spacing findings on ${name}`, same ? `${same} of them between copper on the same net.` : '');
    }
    // Narrow drawn traces are already reported by the vector trace check; keep pours, pads and planes.
    if (!neg) thin = thin.filter(s => !Fab.checks.primsAt(layer, s.x, s.y, p => p.k === 'L' || p.k === 'A').length);
    // A wedge (copper tapering to a point, e.g. where a round clearance meets a straight one) dead-ends
    // and narrows to about one pixel. A neck carries copper through (it meets wide copper on two sides),
    // or is a finger wider than that. Report necks one by one, wedges as a summary.
    const wedges = thin.filter(s => !s.neck && s.v < 2 * res);
    const necks = thin.filter(s => (s.neck || s.v >= 2 * res) && s.v < prof.minTrace - TOL);
    const through = necks.filter(s => s.neck);
    if (through.length) splits(pkg, layer, prof.minTrace, through);
    necks.sort((a, b) => (!!b.split - !!a.split) || a.v - b.v);
    for (const s of necks.slice(0, MAX)) {
      const at = { at: { x: s.x, y: s.y }, bbox: Fab.bbox.grow(s.bbox, 0.15), layer: name, value: s.v, limit: prof.minTrace };
      if (s.split) add('sliver', 'error', `Copper neck ≈${Fab.fmtLen(s.v, 3)} wide is the only link to ${s.split.area.toFixed(1)} mm² of ${neg ? 'plane' : 'copper'}`,
        `${name}: ${neg ? 'plane' : 'pour/pad'} copper narrows below ${Fab.fmtLen(prof.minTrace)} here (${tol}), and the area on one side (about ${s.split.area.toFixed(1)} mm², ${plural(s.split.holes, 'plated hole')}) joins the rest only through copper this narrow. If it etches through, that area is cut off. Move or shrink the clearances so the plane keeps a full-width path.`, at);
      // Necks between neighboring clearances are common in dense via fields and only lose a little
      // copper if they etch through; they are errors only when they cut an area off (above).
      else add('sliver', 'warn', `Copper neck ≈${Fab.fmtLen(s.v, 3)} wide`,
        `${name}: ${neg ? 'plane' : 'pour/pad'} copper narrows below ${Fab.fmtLen(prof.minTrace)} here (${tol}). It may etch through or lift; the copper around it stays connected.`, at);
    }
    if (necks.length > MAX) add('sliver', 'warn', `…${necks.length - MAX} more copper necks on ${name}`, '');
    if (wedges.length) {
      const w0 = wedges[0];
      add('sliver', 'info', `${name}: ${plural(wedges.length, 'copper wedge')} tapering to a point`,
        `Where two clearances or a clearance and the edge pull-back meet at a shallow angle, the copper between them tapers to nothing. Fabs usually remove these slivers; fix them in the design if the fab drawing forbids edits. First at ${w0.x.toFixed(2)}, ${w0.y.toFixed(2)} mm.`,
        { at: { x: w0.x, y: w0.y }, bbox: Fab.bbox.grow(w0.bbox, 0.3), layer: name });
    }
    delete layer._wide; // about 4 bytes per board pixel; only needed during this check
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
