/* Inspection stage: an exploded 3D view of the package's layer stack beside the run, lighting up
   the layer and the feature each check step measures (a layer being scanned, a via's pads or barrel,
   the outline), and summing up findings per layer when the run is done. */
(function (Fab) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Geometry of the drawing (SVG units). Each layer is the board outline seen from above and in front.
  const VW = 600, FACE_W = 250, SKEW = 110, DEPTH = 58, X0 = 14, TOP = 18;
  const GAP = { copper: 24, mask: 15, silk: 15 };
  // Labels sit in a column right of the stack: counts first, then the layer's name.
  const LBL_X = X0 + FACE_W + SKEW + 18;

  // Layers top to bottom, with the drawing's row for each.
  function rows(pkg) {
    const L = pkg.layers, out = [];
    const add = (kind, layer, label) => { if (layer) out.push({ kind, layer, label, file: layer.file.name }); };
    add('silk', L.silk.top, 'Top silkscreen');
    add('mask', L.mask.top, 'Top solder mask');
    for (const l of L.copper) add(l.polarity === 'negative' ? 'plane' : 'copper', l, `L${l.cuOrder} ${l.side === 'top' ? 'top' : l.side === 'bottom' ? 'bottom' : l.polarity === 'negative' ? 'plane' : 'inner'} copper`);
    add('mask', L.mask.bottom, 'Bottom solder mask');
    add('silk', L.silk.bottom, 'Bottom silkscreen');
    let y = TOP;
    out.forEach((r, i) => {
      if (i) y += r.kind === 'silk' || out[i - 1].kind === 'silk' ? GAP.silk : r.kind === 'mask' || out[i - 1].kind === 'mask' ? GAP.mask : GAP.copper;
      r.y = y;
    });
    return out;
  }

  // Outline normalized to the unit square (u across, v front to back), simplified for drawing.
  function shape(pkg) {
    if (pkg._stageShape) return pkg._stageShape;
    const bb = pkg.boardBBox, o = pkg.layers.outline;
    const w = bb[2] - bb[0], h = bb[3] - bb[1], s = Math.max(w, h);
    let pts = o && o.board && o.board.pts && o.board.pts.length >= 6 ? o.board.pts : [bb[0], bb[1], bb[2], bb[1], bb[2], bb[3], bb[0], bb[3]];
    const step = Math.max(2, Math.floor(pts.length / 2 / 160)) * 2, uv = [];
    for (let i = 0; i < pts.length; i += step) uv.push([(pts[i] - bb[0]) / s + (1 - w / s) / 2, (pts[i + 1] - bb[1]) / s + (1 - h / s) / 2]);
    const toUV = (x, y) => [(x - bb[0]) / s + (1 - w / s) / 2, (y - bb[1]) / s + (1 - h / s) / 2];
    return (pkg._stageShape = { uv, toUV });
  }
  const proj = (u, v, y) => [X0 + u * FACE_W + v * SKEW, y + (1 - v) * DEPTH];
  const poly = (uv, y, dy) => uv.map(([u, v]) => { const [x, yy] = proj(u, v, y); return x.toFixed(1) + ',' + (yy + (dy || 0)).toFixed(1); }).join(' ');
  function ellipse(u, v, y, rx, cls, extra) {
    const [x, yy] = proj(u, v, y);
    return `<ellipse class="${cls}" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" rx="${rx}" ry="${(rx * 0.42).toFixed(1)}"${extra || ''}/>`;
  }

  // A real via near the board center, and a non-plated hole if there is one.
  function holes(pkg, prof) {
    const bb = pkg.boardBBox, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const near = (list) => list.reduce((b, h) => { const d = Math.hypot(h.x - cx, h.y - cy); return !b || d < b.d ? { h, d } : b; }, null);
    const via = near(pkg.hits.filter(h => h.plated && h.dia <= (prof ? prof.viaMaxDrill : 0.45))) || near(pkg.hits.filter(h => h.plated));
    const np = near(pkg.hits.filter(h => !h.plated));
    const s = shape(pkg);
    return { via: via ? s.toUV(via.h.x, via.h.y) : [0.5, 0.5], npth: np ? s.toUV(np.h.x, np.h.y) : null };
  }

  // What a step looks at: which rows light up and which parts of the via.
  function focus(label, module) {
    const l = label || '';
    const m = /·\s*(.+)$/.exec(l), file = m ? m[1].trim() : null;
    if (/^Raster analysis/.test(l)) return { kinds: ['copper', 'plane', 'mask'], scan: true };
    if (/^(Spacing and slivers|Isolated copper)/.test(l)) return { file, scan: true };
    if (/^Mask dams/.test(l)) return { file, scan: true };
    if (module !== 'dfm') return { kinds: module === 'package' ? ['silk', 'mask', 'copper', 'plane'] : ['silk', 'mask'], outer: true };
    const map = [
      [/^Minimum trace width/, { kinds: ['copper'] }],
      [/^Drills/, { via: ['barrel'] }],
      [/^Annular ring/, { via: ['pad', 'ring'], outer: true }],
      [/^Thermal reliefs/, { kinds: ['plane'], via: ['antipad'] }],
      [/^Copper to board edge/, { kinds: ['copper', 'plane'], edge: true }],
      [/^NPTH to copper/, { npth: true, outer: true }],
      [/^Solder mask/, { kinds: ['mask'], via: ['pad'] }],
      [/^Silkscreen/, { kinds: ['silk'] }],
      [/^Holes/, { via: ['barrel'], npth: true, edge: true }],
      [/^Outline inside corners/, { edge: true }],
      [/^BGA pads/, { outer: true, via: ['pad'] }],
    ];
    for (const [re, f] of map) if (re.test(l)) return f;
    return {};
  }

  // Short explanations, with the profile's own limits.
  function explain(label, module, prof) {
    const L = Fab.fmtLen, l = label || '';
    if (/^Raster analysis/.test(l)) return 'Every copper and mask layer is painted and analyzed at once in background workers: copper-to-copper gaps, narrow necks, unconnected copper and mask webs.';
    if (/^Spacing and slivers/.test(l)) return `Gaps between copper of different nets under ${L(prof.minSpace)}, and copper necks under ${L(prof.minTrace)}, with any neck that would cut part of a plane off.`;
    if (/^Isolated copper/.test(l)) return `Copper with no pad, via or plated hole on it, from ${prof.isoMinArea} mm² up.`;
    if (/^Mask dams/.test(l)) return `Solder mask webs between openings under ${L(prof.minMaskDam)}.`;
    const dfm = {
      'Minimum trace width': `Drawn traces under ${L(prof.minTrace)}.`,
      Drills: `Holes under ${L(prof.minDrill)}, and plated holes deeper than ${prof.maxAspect}:1 at ${L(prof.thickness)} thick.`,
      'Annular ring': `Copper left around each plated hole on the outer layers: ${L(prof.ringPth)} for parts, ${L(prof.ringVia)} for vias.`,
      'Thermal reliefs': `Spoke width and count, and air gaps, of plane connections.`,
      'Copper to board edge': `Copper within ${L(prof.copperToEdge)} of the routed outline or a cutout.`,
      'NPTH to copper': `Copper within ${L(prof.npthToCopper)} of an unplated hole.`,
      'Solder mask expansion and dams': `Mask openings against their pads, tented vias, and webs under ${L(prof.minMaskDam)}.`,
      Silkscreen: `Lines under ${L(prof.minSilkLine)} and ink on exposed pads.`,
      'Holes: spacing, board edge, castellations': `Drill walls under ${L(prof.holeGap)} apart, holes near the edge, and half-holes on it.`,
      'Outline inside corners': `Inside corners the router rounds to about ${L(prof.minInsideRadius)}.`,
      'BGA pads and vias in pads': `BGA lands under ${L(prof.minBgaPad)}, and open vias in pasted pads.`,
    };
    if (module === 'dfm') return dfm[l] || '';
    return { package: 'Every file classified, and the layer set checked for what a fab needs.', assembly: 'Pick-and-place, BOM and Gerbers cross-checked part by part.', build: 'Variant, ODB++ components and stencil checked against each other.', pins: 'Pin 1 and pad centers from the IPC-356 netlist.', bom: 'Part numbers, descriptions, manufacturers and lifecycle.' }[module] || '';
  }

  const MODULES = [['package', 'Package'], ['assembly', 'Assembly'], ['build', 'Build'], ['pins', 'Pins'], ['bom', 'BOM'], ['dfm', 'Fab DFM']];

  // The whole stage. e.stage = { module, label } while running; per-layer counts once done.
  function html(e, prof) {
    const pkg = e.pkg;
    if (!pkg || !pkg.boardBBox || !pkg.layers.copper.length) return '';
    const R = rows(pkg), s = shape(pkg), hl = holes(pkg, prof);
    const H = R[R.length - 1].y + DEPTH + 30;
    const done = e.status === 'ready';
    const per = new Map();
    if (done) for (const f of e.findings) if (f.layer && f.severity !== 'info') {
      const c = per.get(f.layer) || { error: 0, warn: 0 };
      c[f.severity]++; per.set(f.layer, c);
    }
    const cu = R.filter(r => r.kind === 'copper' || r.kind === 'plane');
    let svg = `<svg class="stk" viewBox="0 0 ${VW} ${H}" role="img" aria-label="Layer stack">`;
    svg += '<defs><linearGradient id="stk-scan" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset="0.5" stop-color="var(--accent)" stop-opacity="0.55"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
    // Dielectric between neighboring copper layers, drawn first so the layers sit on it.
    for (let i = 0; i + 1 < cu.length; i++) svg += `<polygon class="stk-core" points="${poly(s.uv, cu[i].y + 6)}"/>`;
    // Back to front: bottom layers first, so upper ones overlap them.
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i], c = per.get(r.file);
      const sev = c ? (c.error ? 'error' : c.warn ? 'warn' : '') : '';
      svg += `<g class="stk-layer k-${r.kind}${sev ? ' sev-' + sev : ''}${done ? ' done' : ''}" data-file="${esc(r.file)}" data-kind="${r.kind}"${done ? ` data-act="stage-layer" tabindex="0"` : ''}>`;
      svg += `<polygon class="stk-edge" points="${poly(s.uv, r.y, r.kind === 'silk' ? 1.5 : 3)}"/><polygon class="stk-face" points="${poly(s.uv, r.y)}"/>`;
      svg += `<clipPath id="stk-clip-${i}"><polygon points="${poly(s.uv, r.y)}"/></clipPath><rect class="stk-scan" clip-path="url(#stk-clip-${i})" x="${-FACE_W}" y="${r.y - 4}" width="${FACE_W}" height="${DEPTH + 8}" fill="url(#stk-scan)"/>`;
      // The via where it crosses this layer: pads on signal copper, a clearance on planes, openings in mask.
      const [u, v] = hl.via;
      if (r.kind === 'copper') svg += ellipse(u, v, r.y, 11, 'stk-pad') + ellipse(u, v, r.y, 5.5, 'stk-hole');
      else if (r.kind === 'plane') svg += ellipse(u, v, r.y, 13, 'stk-antipad') + ellipse(u, v, r.y, 5.5, 'stk-hole');
      else if (r.kind === 'mask') svg += ellipse(u, v, r.y, 12, 'stk-open');
      if (hl.npth && (r.kind === 'copper' || r.kind === 'plane')) svg += ellipse(hl.npth[0], hl.npth[1], r.y, 8, 'stk-npth');
      // Label in the column on the right, level with the layer's middle, with a leader to it.
      const ly = r.y + DEPTH / 2 + 4, [ex] = proj(1, 0.5, r.y);
      svg += `<line class="stk-lead" x1="${(ex + 4).toFixed(1)}" y1="${(ly - 4).toFixed(1)}" x2="${LBL_X - 4}" y2="${(ly - 4).toFixed(1)}"/>`;
      if (c) svg += `<text class="stk-n ${c.error ? 'e' : 'w'}" x="${LBL_X}" y="${ly.toFixed(1)}">${c.error || c.warn}</text>`;
      else if (done) svg += `<text class="stk-n ok" x="${LBL_X}" y="${ly.toFixed(1)}">✓</text>`;
      svg += `<text class="stk-lbl" x="${LBL_X + (done ? 30 : 0)}" y="${ly.toFixed(1)}">${esc(r.label)}</text></g>`;
    }
    // The via's barrel through the copper, and the ring band on the outer pads.
    if (cu.length) {
      const [u, v] = hl.via, [x, y1] = proj(u, v, cu[0].y), [, y2] = proj(u, v, cu[cu.length - 1].y);
      svg += `<g class="stk-via"><rect class="stk-barrel" x="${(x - 5.5).toFixed(1)}" y="${y1.toFixed(1)}" width="11" height="${(y2 - y1).toFixed(1)}" rx="2"/>`;
      for (const r of [cu[0], cu[cu.length - 1]]) svg += ellipse(u, v, r.y, 8.5, 'stk-ring');
      svg += `</g>`;
    }
    svg += `<polygon class="stk-outline" points="${poly(s.uv, R[0].y)}"/></svg>`;

    const st = e.stage || {};
    const mods = MODULES.map(([k, t]) => {
      const i = MODULES.findIndex(x => x[0] === st.module), j = MODULES.findIndex(x => x[0] === k);
      const cls = done || (i >= 0 && j < i) ? 'done' : j === i ? 'on' : '';
      return `<li class="${cls}">${t}</li>`;
    }).join('');
    const right = done
      ? `<div class="stg-eyebrow">Inspection finished</div><div class="stg-title">${e.findings.filter(f => f.severity === 'error').length} errors · ${e.findings.filter(f => f.severity === 'warn').length} warnings</div><div class="stg-desc">Counts per layer are beside the stack. Select a layer to see it on the board.</div>`
      : `<div class="stg-eyebrow" id="stg-mod">${esc((MODULES.find(x => x[0] === st.module) || [, 'Starting'])[1])}</div><div class="stg-title" id="stg-title">${esc(st.label || 'Reading the package')}</div><div class="stg-desc" id="stg-desc">${esc(explain(st.label, st.module, prof))}</div>`;
    return `<div class="card stage${done ? ' is-done' : ' is-running'}" id="stage"><div class="stage-art">${svg}</div><div class="stage-side">${right}<ol class="stg-mods" id="stg-mods">${mods}</ol></div></div>`;
  }

  // Light up what the current step looks at, without redrawing the stage.
  function update(e, prof) {
    const root = document.getElementById('stage');
    if (!root || !e.stage) return;
    const { module, label } = e.stage, f = focus(label, module);
    for (const g of root.querySelectorAll('.stk-layer')) {
      const k = g.dataset.kind, on = (f.file && g.dataset.file === f.file) || (f.kinds && f.kinds.includes(k)) ||
        (f.outer && (k === 'copper' || k === 'mask' || k === 'silk') && /top|bottom/i.test(g.querySelector('.stk-lbl').textContent));
      g.classList.toggle('on', !!on);
      g.classList.toggle('scan', !!(on && f.scan));
    }
    const via = root.querySelector('.stk-via');
    if (via) {
      via.classList.toggle('barrel-on', !!(f.via && f.via.includes('barrel')));
      via.classList.toggle('ring-on', !!(f.via && f.via.includes('ring')));
    }
    root.classList.toggle('pad-on', !!(f.via && f.via.includes('pad')));
    root.classList.toggle('antipad-on', !!(f.via && f.via.includes('antipad')));
    root.classList.toggle('npth-on', !!f.npth);
    root.classList.toggle('edge-on', !!f.edge);
    const set = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
    set('stg-mod', (MODULES.find(x => x[0] === module) || [, ''])[1]);
    set('stg-title', label || '');
    set('stg-desc', explain(label, module, prof));
    const mods = document.getElementById('stg-mods');
    if (mods) {
      const i = MODULES.findIndex(x => x[0] === module);
      [...mods.children].forEach((li, j) => { li.className = j < i ? 'done' : j === i ? 'on' : ''; });
    }
  }

  Fab.stage = { html, update, focus };
})(window.Fab);
