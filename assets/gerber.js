// RS-274X / Gerber X2 parser. Produces primitives in mm.
// Covers what Altium and most CAD tools emit: FS, MO, AD (C/R/O/P/macro), AM (1,4,5,7,20,21,22),
// G01/G02/G03, G74/G75, G36/G37, LP, SR, D01/D02/D03, X2 attributes (also the "G04 #@!" comment form).
(function (Fab) {
  'use strict';
  const G = Fab.geo;

  // ---- macro expression evaluator (no eval: input files are untrusted) ----
  function evalExpr(src, vars) {
    let i = 0;
    const s = src.replace(/\s+/g, '');
    function peek() { return s[i]; }
    function num() {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?|^[0-9]+\./.exec(s.slice(i));
      if (!m) throw new Error('bad number in macro expression: ' + src);
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function atom() {
      const c = peek();
      if (c === '(') { i++; const v = expr(); if (s[i] === ')') i++; return v; }
      if (c === '-') { i++; return -atom(); }
      if (c === '+') { i++; return atom(); }
      if (c === '$') {
        i++;
        const m = /^\d+/.exec(s.slice(i));
        i += m ? m[0].length : 0;
        const v = vars[m ? +m[0] : 0];
        return v == null ? 0 : v;
      }
      return num();
    }
    function term() {
      let v = atom();
      for (;;) {
        const c = peek();
        if (c === 'x' || c === 'X' || c === '*') { i++; v *= atom(); }
        else if (c === '/') { i++; v /= atom(); }
        else return v;
      }
    }
    function expr() {
      let v = term();
      for (;;) {
        const c = peek();
        if (c === '+') { i++; v += term(); }
        else if (c === '-') { i++; v -= term(); }
        else return v;
      }
    }
    if (!s) return 0;
    return expr();
  }

  // ---- shapes (aperture geometry relative to flash origin, mm) ----
  // {t:'c', x, y, r, on} | {t:'p', pts:[x,y,...] (ccw), on}
  function rectPts(w, h, cx, cy, rot) {
    const hw = w / 2, hh = h / 2;
    const raw = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
    const out = [];
    for (let i = 0; i < 8; i += 2) {
      const [x, y] = G.rot(raw[i] + cx, raw[i + 1] + cy, 0);
      out.push(x, y);
    }
    return rotPts(out, rot);
  }
  function rotPts(pts, rot) {
    if (!rot) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i += 2) { const p = G.rot(pts[i], pts[i + 1], rot); out.push(p[0], p[1]); }
    return out;
  }
  function circlePts(cx, cy, r, n) {
    const out = [];
    n = n || 32;
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    return out;
  }
  function obroundPts(w, h) {
    if (Math.abs(w - h) < 1e-9) return circlePts(0, 0, w / 2, 32);
    const pts = [];
    if (w > h) {
      const r = h / 2, d = (w - h) / 2;
      pts.push(d, -r); pts.push(...G.arcPoints(d, 0, r, -Math.PI / 2, Math.PI / 2, false, 0.002));
      pts.push(-d, r); pts.push(...G.arcPoints(-d, 0, r, Math.PI / 2, 3 * Math.PI / 2, false, 0.002));
    } else {
      const r = w / 2, d = (h - w) / 2;
      pts.push(r, d); pts.push(...G.arcPoints(0, d, r, 0, Math.PI, false, 0.002));
      pts.push(-r, -d); pts.push(...G.arcPoints(0, -d, r, Math.PI, 2 * Math.PI, false, 0.002));
    }
    return pts;
  }
  function thermalPolys(cx, cy, od, id, gap, rot) {
    const Ro = od / 2, Ri = id / 2, g = gap / 2, polys = [];
    if (g >= Ro) return polys;
    for (let q = 0; q < 4; q++) {
      const base = q * Math.PI / 2;
      const ao0 = Math.asin(Math.min(1, g / Ro)), ao1 = Math.PI / 2 - ao0;
      const pts = [Ro * Math.cos(ao0), Ro * Math.sin(ao0)];
      pts.push(...G.arcPoints(0, 0, Ro, ao0, ao1, false, 0.002));
      if (g < Ri) {
        const ai0 = Math.asin(g / Ri), ai1 = Math.PI / 2 - ai0;
        pts.push(Ri * Math.cos(ai1), Ri * Math.sin(ai1));
        pts.push(...G.arcPoints(0, 0, Ri, ai1, ai0, true, 0.002));
      } else {
        pts.push(g, g);
      }
      const out = [];
      for (let i = 0; i < pts.length; i += 2) {
        const p = G.rot(pts[i], pts[i + 1], base * 180 / Math.PI);
        out.push(p[0] + cx, p[1] + cy);
      }
      polys.push(rotPts(out, rot));
    }
    return polys;
  }
  function hull(points) { // points: [[x,y]...] -> flat ccw
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1));
    const out = []; for (const q of h) out.push(q[0], q[1]);
    return out;
  }

  function macroShapes(blocks, params, u, warn) {
    const vars = {};
    params.forEach((v, i) => { vars[i + 1] = v; });
    const shapes = [];
    for (let blk of blocks) {
      blk = blk.trim();
      if (!blk || blk[0] === '0' && (blk.length === 1 || blk[1] === ' ' || blk[1] === ',')) continue;
      const asg = /^\$(\d+)\s*=(.*)$/.exec(blk);
      if (asg) { vars[+asg[1]] = evalExpr(asg[2], vars); continue; }
      const f = blk.split(',').map(x => x.trim());
      const code = parseInt(f[0], 10);
      const a = f.slice(1).map(x => evalExpr(x, vars));
      const on = a[0] !== 0;
      switch (code) {
        case 1: { const [x, y] = G.rot(a[2] * u, a[3] * u, a[4] || 0); shapes.push({ t: 'c', x, y, r: a[1] * u / 2, on }); break; }
        case 20: case 2: {
          const w = a[1] * u, x1 = a[2] * u, y1 = a[3] * u, x2 = a[4] * u, y2 = a[5] * u, rot = a[6] || 0;
          const L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
          const pts = rotPts(rectPts(L, w, 0, 0, ang).map((v, i) => v + (i % 2 ? (y1 + y2) / 2 : (x1 + x2) / 2)), rot);
          shapes.push({ t: 'p', pts: G.ccw(pts), on }); break;
        }
        case 21: {
          const w = a[1] * u, h = a[2] * u, cx = a[3] * u, cy = a[4] * u, rot = a[5] || 0;
          shapes.push({ t: 'p', pts: G.ccw(rotPts(rectPts(w, h, cx, cy, 0), rot)), on }); break;
        }
        case 22: {
          const w = a[1] * u, h = a[2] * u, x = a[3] * u, y = a[4] * u, rot = a[5] || 0;
          shapes.push({ t: 'p', pts: G.ccw(rotPts(rectPts(w, h, x + w / 2, y + h / 2, 0), rot)), on }); break;
        }
        case 4: {
          const n = Math.round(a[1]); const pts = [];
          for (let i = 0; i <= n; i++) pts.push(a[2 + i * 2] * u, a[3 + i * 2] * u);
          pts.length -= 2; // last point repeats the first
          const rot = a[2 + (n + 1) * 2] || 0;
          shapes.push({ t: 'p', pts: G.ccw(rotPts(pts, rot)), on }); break;
        }
        case 5: {
          const n = Math.round(a[1]), cx = a[2] * u, cy = a[3] * u, r = a[4] * u / 2, rot = a[5] || 0;
          const pts = [];
          for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; pts.push(cx + r * Math.cos(t), cy + r * Math.sin(t)); }
          shapes.push({ t: 'p', pts: G.ccw(rotPts(pts, rot)), on }); break;
        }
        case 7: {
          // Thermal: cx, cy, outer dia, inner dia, gap, rot (no exposure parameter)
          const v = f.slice(1).map(x => evalExpr(x, vars));
          for (const p of thermalPolys(v[0] * u, v[1] * u, v[2] * u, v[3] * u, v[4] * u, v[5] || 0)) shapes.push({ t: 'p', pts: G.ccw(p), on: true, thermal: true });
          break;
        }
        case 6: {
          const v = f.slice(1).map(x => evalExpr(x, vars));
          shapes.push({ t: 'c', x: v[0] * u, y: v[1] * u, r: v[2] * u / 2, on: true });
          warn('Moiré macro primitive approximated as a disc');
          break;
        }
        default: warn('Unsupported macro primitive ' + code);
      }
    }
    return shapes;
  }

  function apertureShapes(tpl, params, macros, u, warn) {
    switch (tpl) {
      case 'C': return [{ t: 'c', x: 0, y: 0, r: params[0] * u / 2, on: true }];
      case 'R': return [{ t: 'p', pts: rectPts(params[0] * u, params[1] * u, 0, 0, 0), on: true }];
      case 'O': return [{ t: 'p', pts: G.ccw(obroundPts(params[0] * u, params[1] * u)), on: true }];
      case 'P': {
        const r = params[0] * u / 2, n = Math.round(params[1]), rot = params[2] || 0, pts = [];
        for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n + rot * Math.PI / 180; pts.push(r * Math.cos(t), r * Math.sin(t)); }
        return [{ t: 'p', pts, on: true }];
      }
      default: {
        const m = macros[tpl];
        if (!m) { warn('Unknown aperture template ' + tpl); return []; }
        return macroShapes(m, params, u, warn);
      }
    }
  }

  function shapesBBox(shapes) {
    const b = Fab.bbox.empty();
    for (const s of shapes) {
      if (!s.on) continue;
      if (s.t === 'c') { Fab.bbox.addPt(b, s.x - s.r, s.y - s.r); Fab.bbox.addPt(b, s.x + s.r, s.y + s.r); }
      else G.polyBBox(s.pts, b);
    }
    return b;
  }

  function parseAttr(str) { // "TF.FileFunction,Copper,L1,Top" -> {cmd:'TF', name:'.FileFunction', values:[...]}
    const cmd = str.slice(0, 2);
    const parts = str.slice(2).split(',');
    return { cmd, name: parts[0], values: parts.slice(1) };
  }

  // ---- main parser ----
  function parse(text, name) {
    const layer = {
      name, kind: 'gerber', prims: [], apertures: {}, attrs: {}, comments: {}, amparams: {}, warnings: [],
      units: null, format: null, polarity: 'positive', x2: false, physOrder: null, generator: null,
    };
    const warnSet = new Set();
    const warn = m => { if (!warnSet.has(m)) { warnSet.add(m); layer.warnings.push(m); } };

    let fmt = { zero: 'L', mode: 'A', xi: 2, xd: 4, yi: 2, yd: 4 };
    let u = 1; // mm per file unit
    const macros = {};
    let curAp = null, interp = 1, quadrant = 'multi', dark = true, region = false, contour = null, contours = [];
    let x = 0, y = 0;
    let apAttrs = {};
    let regionFn = null;
    let sr = null;

    function coord(s, isX) {
      if (s == null) return null;
      let v;
      if (s.indexOf('.') >= 0) v = parseFloat(s);
      else {
        let sign = 1;
        if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
        const ii = isX ? fmt.xi : fmt.yi, dd = isX ? fmt.xd : fmt.yd;
        if (fmt.zero === 'T') while (s.length < ii + dd) s += '0';
        v = sign * parseInt(s, 10) / Math.pow(10, dd);
      }
      return v * u;
    }
    function ijc(s, isX) { return s == null ? 0 : coord(s, isX); }

    function flushContour() {
      if (contour && contour.length >= 6) contours.push(contour);
      contour = null;
    }

    function addPrim(p) { p.dark = dark; layer.prims.push(p); }

    function srClose() {
      if (!sr) return;
      const base = layer.prims.slice(sr.start);
      for (let ix = 0; ix < sr.nx; ix++) for (let iy = 0; iy < sr.ny; iy++) {
        if (!ix && !iy) continue;
        const dx = ix * sr.dx, dy = iy * sr.dy;
        for (const p of base) layer.prims.push(translate(p, dx, dy));
      }
      sr = null;
    }

    function handleExtended(block) {
      const blocks = block.split('*').map(b => b.trim()).filter(Boolean);
      if (!blocks.length) return;
      const first = blocks[0];
      const code = first.slice(0, 2);
      if (code === 'AM') { macros[first.slice(2)] = blocks.slice(1); return; }
      for (const b of blocks) handleExtCmd(b);
    }

    function handleExtCmd(b) {
      const code = b.slice(0, 2);
      switch (code) {
        case 'FS': {
          const m = /^FS([LTD]?)([AI]?)(?:N\d+)?(?:G\d+)?X(\d)(\d)Y(\d)(\d)/.exec(b);
          if (m) {
            fmt = { zero: m[1] === 'T' ? 'T' : 'L', mode: m[2] || 'A', xi: +m[3], xd: +m[4], yi: +m[5], yd: +m[6] };
            layer.format = `${fmt.xi}.${fmt.xd}`;
            if (fmt.mode === 'I') warn('Incremental coordinates (FS…I) are deprecated');
          }
          break;
        }
        case 'MO': u = /IN/.test(b) ? 25.4 : 1; layer.units = u === 1 ? 'mm' : 'inch'; break;
        case 'AD': {
          const m = /^ADD(\d+)([^,]+),?(.*)$/.exec(b);
          if (!m) break;
          const code = +m[1], tpl = m[2];
          const params = m[3] ? m[3].split(/X/i).filter(s => s !== '').map(Number) : [];
          const shapes = apertureShapes(tpl, params, macros, u, warn);
          const bb = shapesBBox(shapes);
          const ap = {
            code, tpl, params, shapes, bbox: bb, w: bb[2] - bb[0], h: bb[3] - bb[1],
            dia: tpl === 'C' ? params[0] * u : null,
            hasClear: shapes.some(s => !s.on), fn: apAttrs['.AperFunction'] ? apAttrs['.AperFunction'].join(',') : null,
            amparams: layer.amparams[code] || null,
          };
          layer.apertures[code] = ap;
          break;
        }
        case 'LP': dark = b[2] !== 'C'; break;
        case 'SR': {
          srClose();
          const m = /X(\d+)Y(\d+)I([\d.]+)J([\d.]+)/.exec(b);
          if (m && (+m[1] > 1 || +m[2] > 1)) sr = { nx: +m[1], ny: +m[2], dx: +m[3] * u, dy: +m[4] * u, start: layer.prims.length };
          break;
        }
        case 'TF': case 'TA': case 'TO': case 'TD': attr(b); break;
        case 'IP': if (/NEG/.test(b)) layer.polarity = 'negative'; break;
        case 'LR': case 'LM': case 'LS': warn('Aperture transformation (' + code + ') ignored'); break;
        case 'IN': case 'LN': case 'AS': case 'MI': case 'OF': case 'SF': case 'IR': break;
        default: break;
      }
    }

    function attr(b) {
      const a = parseAttr(b);
      if (a.cmd === 'TF') {
        layer.x2 = true;
        layer.attrs[a.name] = a.values;
        if (a.name === '.FilePolarity' && /Negative/i.test(a.values[0])) layer.polarity = 'negative';
        if (a.name === '.GenerationSoftware') layer.generator = a.values.join(' ');
      } else if (a.cmd === 'TA') apAttrs[a.name] = a.values;
      else if (a.cmd === 'TD') { if (!a.name) apAttrs = {}; else delete apAttrs[a.name]; }
    }

    function handleComment(c) {
      // c is the text after G04
      const t = c.trim();
      if (t.startsWith('#@!')) {
        const b = t.slice(3).trim();
        const a = parseAttr(b);
        if (a.cmd === 'TF') {
          layer.attrs[a.name] = a.values;
          if (a.name === '.FilePolarity' && /Negative/i.test(a.values[0])) layer.polarity = 'negative';
          if (a.name === '.GenerationSoftware') layer.generator = a.values.join(' ');
        } else if (a.cmd === 'TA') apAttrs[a.name] = a.values;
        else if (a.cmd === 'TD') { if (!a.name) apAttrs = {}; else delete apAttrs[a.name]; }
        return;
      }
      if (t.startsWith(':AMPARAMS|') || t.startsWith('AMPARAMS|')) {
        const kv = {};
        for (const part of t.split('|')) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
        if (kv.DCode) layer.amparams[+kv.DCode] = kv;
        return;
      }
      const m = /^(Layer_Physical_Order|Layer_Color)=(\S+)/.exec(t);
      if (m) {
        layer.comments[m[1]] = m[2];
        if (m[1] === 'Layer_Physical_Order') layer.physOrder = +m[2];
      }
    }

    function interpolate(nx, ny, I, J) {
      if (region) {
        if (!contour) contour = [x, y];
        if (interp === 1) contour.push(nx, ny);
        else { const a = arcGeom(x, y, nx, ny, I, J); contour.push(...G.arcPoints(a.cx, a.cy, a.r, a.a0, a.a1, a.cw, 0.002)); contour[contour.length - 2] = nx; contour[contour.length - 1] = ny; }
        return;
      }
      if (!curAp) { warn('Draw without aperture'); return; }
      if (interp === 1) addPrim({ k: 'L', x1: x, y1: y, x2: nx, y2: ny, ap: curAp });
      else { const a = arcGeom(x, y, nx, ny, I, J); addPrim(Object.assign({ k: 'A', x1: x, y1: y, x2: nx, y2: ny, ap: curAp }, a)); }
    }

    function arcGeom(x1, y1, x2, y2, I, J) {
      const cw = interp === 2;
      let cx, cy;
      if (quadrant === 'multi') { cx = x1 + I; cy = y1 + J; }
      else {
        // Single quadrant: pick signs so the center is equidistant and the sweep is <= 90°.
        let best = null;
        for (const sx of [1, -1]) for (const sy of [1, -1]) {
          const ccx = x1 + sx * Math.abs(I), ccy = y1 + sy * Math.abs(J);
          const r1 = Math.hypot(x1 - ccx, y1 - ccy), r2 = Math.hypot(x2 - ccx, y2 - ccy);
          let sw = Math.atan2(y2 - ccy, x2 - ccx) - Math.atan2(y1 - ccy, x1 - ccx);
          if (cw) { while (sw > 0) sw -= 2 * Math.PI; } else { while (sw < 0) sw += 2 * Math.PI; }
          const err = Math.abs(r1 - r2) + (Math.abs(sw) > Math.PI / 2 + 1e-6 ? 1e3 : 0);
          if (!best || err < best.err) best = { err, cx: ccx, cy: ccy };
        }
        cx = best.cx; cy = best.cy;
      }
      const r = Math.hypot(x1 - cx, y1 - cy);
      let a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
      const full = Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9 && quadrant === 'multi';
      if (full) a1 = a0 + (cw ? -2 * Math.PI : 2 * Math.PI);
      return { cx, cy, r, a0, a1, cw };
    }

    function handleWord(w) {
      if (!w) return;
      if (w.startsWith('G04') || w.startsWith('G4 ') || w === 'G4') { handleComment(w.slice(3)); return; }
      if (w === 'M02' || w === 'M2' || w === 'M00' || w === 'M01') { srClose(); return; }
      const re = /([GDMXYIJ])([+-]?[0-9.]*)/g;
      let m, X = null, Y = null, I = null, J = null, D = null;
      while ((m = re.exec(w))) {
        const c = m[1], v = m[2];
        if (c === 'G') {
          const g = parseInt(v, 10);
          if (g === 1) interp = 1; else if (g === 2) interp = 2; else if (g === 3) interp = 3;
          else if (g === 36) { region = true; contours = []; contour = null; regionFn = apAttrs['.AperFunction'] ? apAttrs['.AperFunction'].join(',') : null; }
          else if (g === 37) {
            flushContour();
            if (contours.length) addPrim({ k: 'R', contours: contours.map(c2 => G.ccw(c2)), fn: regionFn });
            region = false; contours = [];
          }
          else if (g === 74) quadrant = 'single'; else if (g === 75) quadrant = 'multi';
          else if (g === 70) { u = 25.4; layer.units = layer.units || 'inch'; }
          else if (g === 71) { u = 1; layer.units = layer.units || 'mm'; }
          else if (g === 91) warn('Incremental mode (G91) not supported');
        } else if (c === 'X') X = v; else if (c === 'Y') Y = v; else if (c === 'I') I = v; else if (c === 'J') J = v;
        else if (c === 'D') D = parseInt(v, 10);
        else if (c === 'M') { if (+v === 2) srClose(); }
      }
      const nx = X != null ? coord(X, true) : x, ny = Y != null ? coord(Y, false) : y;
      if (D == null && (X != null || Y != null)) D = 1; // modal D01 (deprecated but common)
      if (D == null) return;
      if (D >= 10) { curAp = layer.apertures[D] || null; if (!curAp) warn('Undefined aperture D' + D); return; }
      if (D === 1) interpolate(nx, ny, ijc(I, true), ijc(J, false));
      else if (D === 2) { if (region) { flushContour(); contour = [nx, ny]; } }
      else if (D === 3) { if (curAp) addPrim({ k: 'F', x: nx, y: ny, ap: curAp }); }
      x = nx; y = ny;
    }

    // tokenizer
    const n = text.length;
    let i = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === '%') {
        const j = text.indexOf('%', i + 1);
        if (j < 0) break;
        handleExtended(text.slice(i + 1, j).replace(/[\r\n]/g, ''));
        i = j + 1;
      } else if (ch === '\r' || ch === '\n' || ch === ' ' || ch === '\t') {
        i++;
      } else {
        const j = text.indexOf('*', i);
        if (j < 0) break;
        handleWord(text.slice(i, j).replace(/[\r\n]/g, ''));
        i = j + 1;
      }
    }
    srClose();

    layer.bbox = Fab.bbox.empty();
    for (const p of layer.prims) { p.bbox = primBBox(p); layer.bbox = Fab.bbox.union(layer.bbox, p.bbox); }
    return layer;
  }

  function translate(p, dx, dy) {
    const q = Object.assign({}, p);
    if (p.k === 'F') { q.x += dx; q.y += dy; }
    else if (p.k === 'L' || p.k === 'A') { q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; if (p.k === 'A') { q.cx += dx; q.cy += dy; } }
    else if (p.k === 'R') q.contours = p.contours.map(c => c.map((v, i) => v + (i % 2 ? dy : dx)));
    return q;
  }

  function apHalf(ap) { return ap ? Math.max(Math.abs(ap.bbox[0]), Math.abs(ap.bbox[1]), Math.abs(ap.bbox[2]), Math.abs(ap.bbox[3])) : 0; }

  function primBBox(p) {
    if (p.k === 'F') { const b = p.ap.bbox; return [p.x + b[0], p.y + b[1], p.x + b[2], p.y + b[3]]; }
    if (p.k === 'L') { const h = apHalf(p.ap); return [Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h]; }
    if (p.k === 'A') {
      const h = apHalf(p.ap);
      const b = Fab.bbox.empty();
      Fab.bbox.addPt(b, p.x1, p.y1);
      const pts = G.arcPoints(p.cx, p.cy, p.r, p.a0, p.a1, p.cw, 0.01);
      G.polyBBox(pts, b);
      return Fab.bbox.grow(b, h);
    }
    const b = Fab.bbox.empty();
    for (const c of p.contours) G.polyBBox(c, b);
    return b;
  }

  // Width of a drawn primitive (trace width) or null.
  function drawWidth(p) {
    if (p.k !== 'L' && p.k !== 'A') return null;
    if (p.ap.tpl === 'C') return p.ap.dia;
    return Math.min(p.ap.w, p.ap.h);
  }

  // Outline of a line drawn with a rectangular aperture: convex hull of the rect at both ends.
  function rectSweep(p) {
    const b = p.ap.bbox, pts = [];
    for (const [px, py] of [[p.x1, p.y1], [p.x2, p.y2]]) for (const [ox, oy] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) pts.push([px + ox, py + oy]);
    return hull(pts);
  }

  // Polygons/circles of a primitive in absolute coordinates (dark shapes only), for geometry tests.
  function primShapes(p) {
    if (p.k === 'F') return p.ap.shapes.filter(s => s.on).map(s => s.t === 'c' ? { t: 'c', x: s.x + p.x, y: s.y + p.y, r: s.r } : { t: 'p', pts: s.pts.map((v, i) => v + (i % 2 ? p.y : p.x)) });
    if (p.k === 'R') return p.contours.map(c => ({ t: 'p', pts: c }));
    const w = drawWidth(p);
    if (p.k === 'L') {
      if (p.ap.tpl === 'R') return [{ t: 'p', pts: rectSweep(p) }];
      return [{ t: 's', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, r: w / 2 }];
    }
    const pts = [p.x1, p.y1].concat(G.arcPoints(p.cx, p.cy, p.r, p.a0, p.a1, p.cw, 0.005));
    const out = [];
    for (let i = 0; i + 3 < pts.length; i += 2) out.push({ t: 's', x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3], r: w / 2 });
    return out;
  }

  Fab.gerber = { parse, primBBox, primShapes, drawWidth, rectSweep, hull, evalExpr, circlePts };
})(window.Fab);
