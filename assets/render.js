// Canvas renderer: Path2D per layer polarity group, pan/zoom, top/bottom view, markers.
(function (Fab) {
  'use strict';

  // Build cached Path2D groups for a Gerber layer.
  function buildPaths(layer) {
    if (layer._groups) return layer._groups;
    const groups = [];
    let g = null;
    function group(dark) {
      if (!g || g.dark !== dark) { g = { dark, fill: new Path2D(), strokes: new Map(), knock: null, n: 0 }; groups.push(g); }
      return g;
    }
    function addPoly(path, pts, ox, oy) {
      path.moveTo(pts[0] + ox, pts[1] + oy);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i] + ox, pts[i + 1] + oy);
      path.closePath();
    }
    function addShape(path, s, ox, oy) {
      if (s.t === 'c') { path.moveTo(s.x + ox + s.r, s.y + oy); path.arc(s.x + ox, s.y + oy, s.r, 0, 2 * Math.PI, false); path.closePath(); }
      else addPoly(path, s.pts, ox, oy);
    }
    function stroke(gr, w) {
      const k = w.toFixed(5);
      let p = gr.strokes.get(k);
      if (!p) { p = { w, path: new Path2D() }; gr.strokes.set(k, p); }
      return p.path;
    }
    for (const p of layer.prims) {
      const gr = group(p.dark);
      gr.n++;
      if (p.k === 'F') {
        if (p.ap.hasClear) {
          // Apertures with exposure-off primitives are composed separately so the clear parts only
          // cut their own flash.
          if (!gr.knock) gr.knock = { fill: new Path2D(), clear: new Path2D() };
          for (const s of p.ap.shapes) addShape(s.on ? gr.knock.fill : gr.knock.clear, s, p.x, p.y);
        } else for (const s of p.ap.shapes) addShape(gr.fill, s, p.x, p.y);
      } else if (p.k === 'R') {
        for (const c of p.contours) addPoly(gr.fill, c, 0, 0);
      } else if (p.k === 'L' || p.k === 'A') {
        if (p.ap.tpl === 'R' && p.k === 'L') { addPoly(gr.fill, Fab.gerber.rectSweep(p), 0, 0); continue; }
        const w = Fab.gerber.drawWidth(p);
        if (p.k === 'L' && p.x1 === p.x2 && p.y1 === p.y2) {
          gr.fill.moveTo(p.x1 + w / 2, p.y1); gr.fill.arc(p.x1, p.y1, w / 2, 0, 2 * Math.PI); gr.fill.closePath();
          continue;
        }
        const path = stroke(gr, w);
        path.moveTo(p.x1, p.y1);
        if (p.k === 'L') path.lineTo(p.x2, p.y2);
        else path.arc(p.cx, p.cy, p.r, p.a0, p.a1, p.cw);
      }
    }
    layer._groups = groups;
    return groups;
  }

  // Paint a Gerber layer's image in opaque black onto ctx (whose canvas must be clear). Shared by the
  // viewer and the DFM rasterizer, so both see the same copper. setModel(ctx) applies the mm→pixel
  // transform; knock is a scratch canvas the same size as ctx's, for apertures with clear parts.
  function paintLayer(ctx, layer, setModel, boardPath, knock) {
    // Only copper is inverted. A negative soldermask file means "dark = no mask", so its drawn
    // features already are the openings this layer shows.
    const neg = layer.polarity === 'negative' && layer.fn === 'copper';
    ctx.save();
    setModel(ctx);
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (neg) { ctx.globalCompositeOperation = 'source-over'; ctx.fill(boardPath); }
    for (const g of buildPaths(layer)) {
      const add = g.dark !== neg;
      ctx.globalCompositeOperation = add ? 'source-over' : 'destination-out';
      ctx.fill(g.fill);
      for (const s of g.strokes.values()) { ctx.lineWidth = s.w; ctx.stroke(s.path); }
      if (g.knock) {
        const k = knock.getContext('2d');
        k.setTransform(1, 0, 0, 1, 0, 0);
        k.clearRect(0, 0, knock.width, knock.height);
        setModel(k);
        k.fillStyle = '#000';
        k.globalCompositeOperation = 'source-over'; k.fill(g.knock.fill);
        k.globalCompositeOperation = 'destination-out'; k.fill(g.knock.clear);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(knock, 0, 0); ctx.restore();
      }
    }
    ctx.restore();
  }

  function outlinePath(outline) {
    const p = new Path2D();
    if (!outline) return p;
    const add = pts => { p.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]); p.closePath(); };
    add(outline.board.pts);
    return p;
  }

  class Viewer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.scratch = document.createElement('canvas');
      this.knockC = document.createElement('canvas');
      this.layers = []; // {id, label, layer|null, kind, color, alpha, visible}
      this.view = { cx: 0, cy: 0, scale: 10, flip: false };
      this.markers = [];
      this.highlight = null;
      this.overlays = [];
      this._raf = 0;
      this._bindEvents();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
    }

    setPackage(pkg) {
      this.pkg = pkg;
      this.boardPath = outlinePath(pkg.layers.outline);
      this._fitted = false;
      this.fit();
    }

    resize() {
      const r = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.dpr = dpr;
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      for (const c of [this.canvas, this.scratch, this.knockC]) { c.width = Math.round(this.W * dpr); c.height = Math.round(this.H * dpr); }
      this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
      // The board pane may have been hidden when the package loaded; fit once it has a size.
      if (this.pkg && !this._fitted && r.width > 10 && r.height > 10) { this.fit(); return; }
      this.draw();
    }

    fit(bb) {
      bb = bb || (this.pkg && this.pkg.boardBBox);
      if (!Fab.bbox.valid(bb) || this.W < 10) return;
      this._fitted = true;
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      this.view.cx = (bb[0] + bb[2]) / 2; this.view.cy = (bb[1] + bb[3]) / 2;
      this.view.scale = Math.min(this.W / (w * 1.08 || 1), this.H / (h * 1.08 || 1));
      this.draw();
    }

    focus(bb, minSpan) {
      minSpan = minSpan || 3;
      const c = Fab.bbox.center(bb);
      const w = Math.max(bb[2] - bb[0], minSpan), h = Math.max(bb[3] - bb[1], minSpan);
      this.fit([c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2]);
    }

    toScreen(x, y) {
      const v = this.view;
      return [this.W / 2 + (v.flip ? -1 : 1) * (x - v.cx) * v.scale, this.H / 2 - (y - v.cy) * v.scale];
    }
    toModel(sx, sy) {
      const v = this.view;
      return [v.cx + (v.flip ? -1 : 1) * (sx - this.W / 2) / v.scale, v.cy - (sy - this.H / 2) / v.scale];
    }

    _applyModel(ctx) {
      const v = this.view, d = this.dpr, f = v.flip ? -1 : 1;
      ctx.setTransform(f * v.scale * d, 0, 0, -v.scale * d, (this.W / 2 - f * v.cx * v.scale) * d, (this.H / 2 + v.cy * v.scale) * d);
    }

    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }

    _drawGerber(ctx, layer) {
      paintLayer(ctx, layer, c => this._applyModel(c), this.boardPath, this.knockC);
    }

    _drawDrills(ctx, plated) {
      const pkg = this.pkg;
      ctx.save();
      this._applyModel(ctx);
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'round';
      const p = new Path2D();
      for (const h of pkg.hits) if (h.plated === plated && h.dia) { p.moveTo(h.x + h.dia / 2, h.y); p.arc(h.x, h.y, h.dia / 2, 0, 2 * Math.PI); p.closePath(); }
      ctx.fill(p);
      for (const s of pkg.slots) if (s.plated === plated && s.dia) {
        ctx.lineWidth = s.dia; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
      }
      ctx.restore();
    }

    _drawOutline(ctx) {
      ctx.save();
      this._applyModel(ctx);
      ctx.lineWidth = 1.2 / this.view.scale;
      ctx.strokeStyle = '#000';
      ctx.stroke(this.boardPath);
      const o = this.pkg.layers.outline;
      if (o) for (const c of o.cutouts) {
        ctx.beginPath(); ctx.moveTo(c.pts[0], c.pts[1]);
        for (let i = 2; i < c.pts.length; i += 2) ctx.lineTo(c.pts[i], c.pts[i + 1]);
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }

    _draw() {
      const ctx = this.ctx, d = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const css = getComputedStyle(document.documentElement);
      ctx.fillStyle = css.getPropertyValue('--canvas-bg').trim() || '#1c1c1e';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.pkg) return;
      // Substrate
      ctx.save(); this._applyModel(ctx);
      ctx.fillStyle = css.getPropertyValue('--board').trim() || '#16302f';
      ctx.fill(this.boardPath);
      ctx.restore();
      const sc = this.scratch.getContext('2d');
      const order = this.layers.slice().filter(l => l.visible);
      // Draw far side first so the near side sits on top.
      order.sort((a, b) => this._z(a) - this._z(b));
      for (const L of order) {
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, this.scratch.width, this.scratch.height);
        if (L.kind === 'gerber') this._drawGerber(sc, L.layer);
        else if (L.kind === 'pth') this._drawDrills(sc, true);
        else if (L.kind === 'npth') this._drawDrills(sc, false);
        else if (L.kind === 'outline') this._drawOutline(sc);
        else continue;
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-in';
        sc.fillStyle = L.color;
        sc.fillRect(0, 0, this.scratch.width, this.scratch.height);
        ctx.globalAlpha = L.alpha;
        ctx.drawImage(this.scratch, 0, 0);
        ctx.globalAlpha = 1;
      }
      this._drawOverlays(ctx);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      this._drawMarkers(ctx);
      this._drawScale(ctx);
    }

    _z(L) {
      // Stack order seen from the current side.
      const flip = this.view.flip;
      const sideZ = s => s === 'top' ? (flip ? 0 : 2) : s === 'bottom' ? (flip ? 2 : 0) : 1;
      const typeZ = { copper: 0, paste: 1, mask: 2, silk: 3, pth: 4, npth: 4, outline: 5, other: 0.5 };
      if (L.kind === 'pth' || L.kind === 'npth') return 50;
      if (L.kind === 'outline') return 60;
      const l = L.layer;
      return sideZ(l.side) * 10 + (typeZ[l.fn] != null ? typeZ[l.fn] : 0.5);
    }

    _drawOverlays(ctx) {
      for (const o of this.overlays) if (o.visible !== false) o.draw(ctx, this);
    }

    _drawMarkers(ctx) {
      const h = this.highlight;
      if (!h) return;
      ctx.save();
      ctx.strokeStyle = '#ff375f'; ctx.lineWidth = 2;
      if (h.bbox) {
        const [x0, y0] = this.toScreen(h.bbox[0], h.bbox[1]), [x1, y1] = this.toScreen(h.bbox[2], h.bbox[3]);
        const pad = 6;
        ctx.strokeRect(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.abs(x1 - x0) + 2 * pad, Math.abs(y1 - y0) + 2 * pad);
      }
      if (h.at) {
        const [x, y] = this.toScreen(h.at.x, h.at.y);
        ctx.beginPath(); ctx.arc(x, y, 14, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 22, y);
        ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 8); ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 22); ctx.stroke();
      }
      ctx.restore();
    }

    _drawScale(ctx) {
      const target = 100 / this.view.scale; // mm in ~100px
      const p = Math.pow(10, Math.floor(Math.log10(target)));
      const step = [1, 2, 5, 10].map(k => k * p).find(v => v >= target) || target;
      const px = step * this.view.scale;
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      const x = 16, y = this.H - 16;
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(Fab.fmtLen(step >= 1 ? step : +step.toPrecision(2)), x + 4, y - 8);
      ctx.restore();
    }

    _bindEvents() {
      const c = this.canvas;
      let drag = null;
      c.addEventListener('wheel', e => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const [mx, my] = this.toModel(sx, sy);
        const k = Math.exp(-e.deltaY * 0.0015);
        this.view.scale = Math.min(5000, Math.max(0.5, this.view.scale * k));
        const [nx, ny] = this.toModel(sx, sy);
        this.view.cx += mx - nx; this.view.cy += my - ny;
        this.draw();
      }, { passive: false });
      c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false }; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect();
        const [mx, my] = this.toModel(e.clientX - r.left, e.clientY - r.top);
        if (this.onHover) this.onHover(mx, my);
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.view.cx = drag.cx - (this.view.flip ? -1 : 1) * dx / this.view.scale;
        this.view.cy = drag.cy + dy / this.view.scale;
        this.draw();
      });
      c.addEventListener('pointerup', e => {
        if (drag && !drag.moved && this.onClick) {
          const r = c.getBoundingClientRect();
          const [mx, my] = this.toModel(e.clientX - r.left, e.clientY - r.top);
          this.onClick(mx, my);
        }
        drag = null;
      });
      c.addEventListener('dblclick', () => this.fit());
    }
  }

  Fab.render = { Viewer, buildPaths, paintLayer, outlinePath };
})(window.Fab);
