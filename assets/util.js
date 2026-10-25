// Shared namespace and small helpers. Classic script (no modules) so the tool works from file://.
window.Fab = window.Fab || {};

(function (Fab) {
  'use strict';

  // ---- demo mode (?demo) ----
  // The public demo keeps everything in its own storage: Signoff EE's demo namespace, a separate
  // run database and profile keys. Nothing reaches GitHub. Suite links go to the other demos.
  Fab.DEMO = /[?&]demo\b/.test(location.search);
  Fab.signoffNs = Fab.DEMO ? 'signoff.demo.' : 'signoff.v1.';
  Fab.fabcheckNs = Fab.DEMO ? 'fabcheck.demo.' : 'fabcheck.v1.';
  Fab.demoHref = href => !Fab.DEMO || /[?&]demo\b/.test(href) ? href : href.replace(/^([^?#]*)(\?[^#]*)?/, (m, path, q) => path + (q ? q + '&demo' : '?demo'));

  // ---- text ----
  Fab.decodeText = function (bytes) {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (utf8.indexOf('�') === -1) return utf8;
    // Altium writes ANSI (windows-1252) for PnP/BOM/reports; fall back when UTF-8 is not clean.
    try { return new TextDecoder('windows-1252').decode(bytes); } catch (e) { return utf8; }
  };

  Fab.mm = function (v, digits) {
    if (v == null || !isFinite(v)) return '–';
    return v.toFixed(digits == null ? 3 : digits) + ' mm';
  };
  // Lengths read in mm with mil after them: "0.084 mm (3.3 mil)", "1.6 mm (63 mil)".
  // Mil: one decimal under 20 mil, whole numbers from 20 up, no trailing ".0".
  const milNum = mm => { const m = mm / 0.0254; return String(Math.abs(m) < 20 ? +m.toFixed(1) : Math.round(m)); };
  Fab.mil = function (mm) { return milNum(mm) + ' mil'; };
  // digits: fixed decimals for the mm value; omitted, the value prints as given (up to 4 decimals).
  const mmNum = (v, digits) => digits == null ? String(+(+v).toFixed(4)) : (+v).toFixed(digits);
  Fab.fmtLen = function (mm, digits) {
    if (mm == null || !isFinite(mm)) return '–';
    return `${mmNum(mm, digits)} mm (${Fab.mil(mm)})`;
  };
  // A pair of lengths, "1.20 × 0.80 mm (47 × 31 mil)".
  Fab.fmtSize = function (w, h, digits) {
    return `${mmNum(w, digits)} × ${mmNum(h, digits)} mm (${milNum(w)} × ${milNum(h)} mil)`;
  };
  Fab.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  // ---- bbox ----
  Fab.bbox = {
    empty() { return [Infinity, Infinity, -Infinity, -Infinity]; },
    addPt(b, x, y) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; return b; },
    union(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; },
    grow(b, d) { return [b[0] - d, b[1] - d, b[2] + d, b[3] + d]; },
    valid(b) { return b && isFinite(b[0]) && b[2] >= b[0]; },
    overlaps(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; },
    contains(a, b, tol) { tol = tol || 0; return b[0] >= a[0] - tol && b[1] >= a[1] - tol && b[2] <= a[2] + tol && b[3] <= a[3] + tol; },
    center(b) { return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 }; },
  };

  // ---- geometry ----
  const G = Fab.geo = {};

  G.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  G.ptSeg = function (px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  function orient(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }

  G.segsIntersect = function (a, b, c, d) {
    const d1 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
    const d2 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
    const d3 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
    const d4 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };

  G.segSeg = function (a, b, c, d) {
    if (G.segsIntersect(a, b, c, d)) return 0;
    return Math.min(
      G.ptSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
      G.ptSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
      G.ptSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
      G.ptSeg(d[0], d[1], a[0], a[1], b[0], b[1]));
  };

  // pts: flat [x0,y0,x1,y1,...] closed implicitly
  G.inPoly = function (px, py, pts) {
    let inside = false;
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  G.ptPolyEdge = function (px, py, pts) {
    let m = Infinity;
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
      const d = G.ptSeg(px, py, pts[j], pts[j + 1], pts[i], pts[i + 1]);
      if (d < m) m = d;
    }
    return m;
  };

  G.area = function (pts) {
    let a = 0;
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1];
    return a / 2;
  };

  G.ccw = function (pts) {
    if (G.area(pts) >= 0) return pts;
    const out = new Array(pts.length);
    for (let i = 0, n = pts.length; i < n; i += 2) { out[i] = pts[n - 2 - i]; out[i + 1] = pts[n - 1 - i]; }
    return out;
  };

  G.polyBBox = function (pts, b) {
    b = b || Fab.bbox.empty();
    for (let i = 0; i < pts.length; i += 2) Fab.bbox.addPt(b, pts[i], pts[i + 1]);
    return b;
  };

  // Flatten an arc into points (excluding start, including end). Angles in radians, cw = clockwise.
  G.arcPoints = function (cx, cy, r, a0, a1, cw, tol) {
    tol = tol || 0.005;
    let sweep = a1 - a0;
    if (cw) { while (sweep >= 0) sweep -= 2 * Math.PI; } else { while (sweep <= 0) sweep += 2 * Math.PI; }
    const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 4;
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 8)));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const a = a0 + sweep * i / n;
      out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return out;
  };

  G.rot = function (x, y, deg) {
    if (!deg) return [x, y];
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  };

  // Uniform grid spatial index over bboxes.
  G.Grid = class {
    constructor(cell) { this.cell = cell; this.map = new Map(); }
    _keys(b, fn) {
      const c = this.cell;
      const x0 = Math.floor(b[0] / c), y0 = Math.floor(b[1] / c), x1 = Math.floor(b[2] / c), y1 = Math.floor(b[3] / c);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(x + ',' + y);
    }
    insert(item, b) { this._keys(b, k => { let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(item); }); }
    query(b) {
      const out = new Set();
      this._keys(b, k => { const l = this.map.get(k); if (l) for (const it of l) out.add(it); });
      return out;
    }
  };

  // ---- findings ----
  let fid = 0;
  Fab.finding = function (f) {
    f.id = 'f' + (++fid);
    f.severity = f.severity || 'warn';
    return f;
  };

  // Natural sort for designators (R2 < R10).
  Fab.natCmp = function (a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };
})(window.Fab);
