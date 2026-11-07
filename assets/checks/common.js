// Geometry queries shared by the checks.
(function (Fab) {
  'use strict';
  const G = Fab.geo;
  const C = Fab.checks = Fab.checks || {};

  // Check modules are generators that yield a label before each step and push findings into `out`.
  // runner() wraps one so callers get a plain function returning the findings; `.steps` keeps the
  // generator for the live console, which runs the steps one at a time and repaints between them.
  C.runner = function (gen) {
    // out.sync tells a check not to yield work to wait for ({ label, wait }); only steps() callers await.
    const fn = function () { const out = []; out.sync = true; const g = gen(...arguments, out); while (!g.next().done); C.audit(out); return out; };
    fn.steps = gen;
    return fn;
  };

  // Catalog of the logic checks (package, assembly, BOM). Each module declares its checks next to the
  // code that raises them; the Fab rules page lists them read-only. `rules` is a function so the
  // thresholds it shows are read from the same constants the code uses.
  C.catalog = [];
  // Test points, fiducials and mounting holes: placed, but usually no BOM line and no paste on purpose.
  C.PAD_ONLY = /^(TP|FID|FD|MH|H|MTG)\d+$/i;
  // Many designs name test points by their net (TP_VBUS, SWDIO_TP, DBG_TX), so the footprint and the
  // part name count too: a TP_/TESTPOINT/FIDUCIAL/MOUNTING_HOLE footprint, or a "Test Point" comment.
  C.PAD_ONLY_FP = /^(TP|TEST[_ -]?P(OINT|AD)|FID|FIDUCIAL|MH|MTG|MOUNT(ING)?[_ -]?HOLE)([_ -]|\d|$)/i;
  C.PAD_ONLY_NAME = /^(test[_ -]?point|tp|fiducial|mounting[_ -]?hole)$/i;
  // The pad-only designators of a package (from the PnP and ODB++), worked out once per package.
  C.padOnlySet = function (pkg) {
    if (pkg._padOnly) return pkg._padOnly;
    const s = new Set();
    const name = t => C.PAD_ONLY_NAME.test(String(t || '').trim());
    for (const p of (pkg.pnp && pkg.pnp.parts) || []) if (C.PAD_ONLY.test(p.des) || C.PAD_ONLY_FP.test(p.footprint || '') || name(p.comment)) s.add(p.des);
    for (const c of (pkg.odb && pkg.odb.comps) || []) if (C.PAD_ONLY.test(c.des) || name(c.part)) s.add(c.des);
    return (pkg._padOnly = s);
  };
  C.isPadOnly = (pkg, des) => C.PAD_ONLY.test(des) || C.padOnlySet(pkg).has(des);
  // Connectors and mechanical parts: shells, pegs and mounting tabs add pads, and their origin is often
  // not their pad center. By designator (J1, JBATT, CN3, X2…) or a description naming a connector.
  C.CONNECTOR_DES = /^(J|CN|CON|X|SW|BT|LS|BZ|MH|P\d)/i;
  C.CONNECTOR_DESC = /\b(conn|connector|header|socket|receptacle|plug|terminal)s?\b/i;
  C.connectorLike = (des, desc) => C.CONNECTOR_DES.test(des || '') || C.CONNECTOR_DESC.test(desc || '');
  C.CATALOGED = ['Package', 'Assembly', 'BOM'];
  C.define = function (category, source, defs) {
    for (const d of defs) C.catalog.push(Object.assign({ category, source, key: category + '/' + d.check }, d));
  };
  // A pattern as the catalog shows it: # is a digit, {n} repeats, | separates alternatives, a leading ^ dropped.
  C.pattern = r => r.source.replace(/\^/g, '').replace(/\\d/g, '#').replace(/\|\\s|\\s\|?/g, '').replace(/\$/g, '');
  C.describe = (category, check) => C.catalog.find(d => d.category === category && d.check === check) || null;
  // A finding the catalog does not declare (or with a severity it does not list) means the list drifted.
  const warned = new Set();
  C.audit = function (findings) {
    for (const f of findings) {
      if (!C.CATALOGED.includes(f.category) || f.check === 'internal') continue;
      const d = C.describe(f.category, f.check);
      const k = f.category + '/' + f.check + '/' + f.severity;
      if ((!d || !d.sev[f.severity]) && !warned.has(k)) { warned.add(k); console.warn('Check catalog: undeclared ' + k); }
    }
  };

  // Spatial index of a layer's primitives (cached on the layer).
  C.index = function (layer) {
    if (layer._index) return layer._index;
    const grid = new G.Grid(2.0);
    layer.prims.forEach((p, i) => { p.i = i; grid.insert(p, p.bbox); });
    return (layer._index = grid);
  };

  C.shapes = function (p) { return p._shapes || (p._shapes = Fab.gerber.primShapes(p)); };

  function inShape(s, x, y) {
    if (s.t === 'c') return Math.hypot(x - s.x, y - s.y) <= s.r + 1e-9;
    if (s.t === 's') return G.ptSeg(x, y, s.x1, s.y1, s.x2, s.y2) <= s.r + 1e-9;
    return G.inPoly(x, y, s.pts);
  }
  // Distance from an inside point to the shape's edge (0 if outside).
  function depth(s, x, y) {
    if (s.t === 'c') return Math.max(0, s.r - Math.hypot(x - s.x, y - s.y));
    if (s.t === 's') return Math.max(0, s.r - G.ptSeg(x, y, s.x1, s.y1, s.x2, s.y2));
    return G.inPoly(x, y, s.pts) ? G.ptPolyEdge(x, y, s.pts) : 0;
  }
  // Distance from a point to a shape (0 if inside).
  function ptDist(s, x, y) {
    if (s.t === 'c') return Math.max(0, Math.hypot(x - s.x, y - s.y) - s.r);
    if (s.t === 's') return Math.max(0, G.ptSeg(x, y, s.x1, s.y1, s.x2, s.y2) - s.r);
    return G.inPoly(x, y, s.pts) ? 0 : G.ptPolyEdge(x, y, s.pts);
  }
  // Distance from a segment to a shape (0 if touching).
  function segDist(s, a, b) {
    if (s.t === 'c') return Math.max(0, G.ptSeg(s.x, s.y, a[0], a[1], b[0], b[1]) - s.r);
    if (s.t === 's') return Math.max(0, G.segSeg(a, b, [s.x1, s.y1], [s.x2, s.y2]) - s.r);
    if (G.inPoly(a[0], a[1], s.pts)) return 0;
    let m = Infinity;
    const P = s.pts;
    for (let i = 0, n = P.length, j = n - 2; i < n; j = i, i += 2) {
      const d = G.segSeg(a, b, [P[j], P[j + 1]], [P[i], P[i + 1]]);
      if (d < m) m = d;
      if (m === 0) break;
    }
    return m;
  }
  // Distance between two shapes (0 if overlapping).
  function shapeDist(s1, s2) {
    if (s1.t === 'c') return Math.max(0, ptDist(s2, s1.x, s1.y) === 0 ? 0 : ptDistToEdge(s2, s1.x, s1.y) - s1.r);
    if (s1.t === 's') return Math.max(0, segDist(s2, [s1.x1, s1.y1], [s1.x2, s1.y2]) - s1.r);
    if (s2.t !== 'p') return shapeDist(s2, s1);
    // polygon-polygon
    if (G.inPoly(s1.pts[0], s1.pts[1], s2.pts) || G.inPoly(s2.pts[0], s2.pts[1], s1.pts)) return 0;
    let m = Infinity;
    const P = s1.pts;
    for (let i = 0, n = P.length, j = n - 2; i < n; j = i, i += 2) {
      const d = segDist(s2, [P[j], P[j + 1]], [P[i], P[i + 1]]);
      if (d < m) m = d;
      if (m === 0) break;
    }
    return m;
  }
  function ptDistToEdge(s, x, y) {
    if (s.t === 'c') return Math.abs(Math.hypot(x - s.x, y - s.y) - s.r);
    if (s.t === 's') return G.ptSeg(x, y, s.x1, s.y1, s.x2, s.y2) - s.r;
    return G.ptPolyEdge(x, y, s.pts);
  }

  C.inShape = inShape; C.depth = depth; C.ptDist = ptDist; C.segDist = segDist; C.shapeDist = shapeDist;

  // Primitives of a layer that cover point (x, y).
  C.primsAt = function (layer, x, y, filter) {
    const out = [];
    for (const p of C.index(layer).query([x, y, x, y])) {
      if (!p.dark) continue;
      if (filter && !filter(p)) continue;
      if (C.shapes(p).some(s => inShape(s, x, y))) out.push(p);
    }
    return out;
  };

  // Is there copper at (x, y)? Honours clear polarity (the last primitive covering the point wins)
  // and negative layers (image inverted inside the board).
  C.copperAt = function (layer, x, y, outline) {
    let last = null;
    for (const p of C.index(layer).query([x, y, x, y])) {
      if (last && p.i < last.i) continue;
      if (C.shapes(p).some(s => inShape(s, x, y))) last = p;
    }
    const drawn = !!(last && last.dark);
    if (layer.polarity === 'negative') return !drawn && (!outline || C.insideBoard(outline, x, y));
    return drawn;
  };
  C.hasClear = function (layer) {
    if (layer._hasClear == null) layer._hasClear = layer.prims.some(p => !p.dark) || layer.polarity === 'negative';
    return layer._hasClear;
  };

  // Largest inscribed distance from (x,y) to the edge of any covering primitive (lower bound on the
  // distance to the copper boundary of the union).
  C.depthAt = function (prims, x, y) {
    let m = 0;
    for (const p of prims) for (const s of C.shapes(p)) { const d = depth(s, x, y); if (d > m) m = d; }
    return m;
  };

  C.primDistToPoint = function (p, x, y) {
    let m = Infinity;
    for (const s of C.shapes(p)) { const d = ptDist(s, x, y); if (d < m) m = d; }
    return m;
  };

  // Polyline segments of the board outline (board + cutouts), indexed.
  C.outlineSegs = function (outline) {
    if (outline._segs) return outline._segs;
    const segs = [], grid = new G.Grid(2.0);
    for (const loop of [outline.board].concat(outline.cutouts)) {
      const P = loop.pts;
      for (let i = 0, n = P.length, j = n - 2; i < n; j = i, i += 2) {
        const s = { a: [P[j], P[j + 1]], b: [P[i], P[i + 1]] };
        s.bbox = [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])];
        segs.push(s); grid.insert(s, s.bbox);
      }
    }
    return (outline._segs = { segs, grid });
  };

  // Point in polygon (G.inPoly's crossing test) using only the edges whose y-span covers py: edges are
  // bucketed by y once per loop, and an edge outside the bucket can't cross, so the result is the same.
  // The sampled edge checks call this hundreds of thousands of times per plane layer.
  const BAND = 0.5;
  function yIndex(pts) {
    const ys = [];
    for (let i = 1; i < pts.length; i += 2) ys.push(pts[i]);
    const y0 = Math.min(...ys), n = Math.floor((Math.max(...ys) - y0) / BAND) + 1, bins = Array.from({ length: n }, () => []);
    for (let i = 0, m = pts.length, j = m - 2; i < m; j = i, i += 2) {
      const a = Math.floor((Math.min(pts[i + 1], pts[j + 1]) - y0) / BAND), b = Math.floor((Math.max(pts[i + 1], pts[j + 1]) - y0) / BAND);
      for (let k = a; k <= b; k++) bins[k].push(i, j);
    }
    return { y0, bins };
  }
  function inPolyIdx(px, py, pts, idx) {
    const k = Math.floor((py - idx.y0) / BAND);
    if (k < 0 || k >= idx.bins.length) return false;
    const e = idx.bins[k];
    let inside = false;
    for (let q = 0; q < e.length; q += 2) {
      const i = e[q], j = e[q + 1];
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  C.insideBoard = function (outline, x, y) {
    const ix = outline._yidx || (outline._yidx = [outline.board].concat(outline.cutouts).map(l => yIndex(l.pts)));
    if (!inPolyIdx(x, y, outline.board.pts, ix[0])) return false;
    for (let c = 0; c < outline.cutouts.length; c++) if (inPolyIdx(x, y, outline.cutouts[c].pts, ix[c + 1])) return false;
    return true;
  };

  // Cap the number of individual findings per check; return the rest as a count.
  C.capped = function (list, n) { return { shown: list.slice(0, n), more: Math.max(0, list.length - n) }; };

  C.flashKey = function (ap) { return ap.tpl + ':' + ap.w.toFixed(4) + 'x' + ap.h.toFixed(4); };
})(window.Fab);
