/* Inspection stage: an exploded 3D view of the package's layer stack beside the run. The layers a
   step reads glow; raster jobs light the part of the board each worker is analyzing, live; findings
   drop onto their layer as pins (and stay, as a map of the run, when it is done); hole checks light
   the board's real drill hits; a detail drawing shows what the step measures, at the profile's limit;
   and a bar along the top shows the run's progress, with its steps marked along it; once the run
   is done, the bar's steps can be slid along to go back to one. */
(function (Fab) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Geometry of the drawing (SVG units). Each layer is the board outline seen from above and in front.
  const VW = 600, FACE_W = 250, SKEW = 110, DEPTH = 58, X0 = 14, TOP = 18;
  const GAP = { copper: 24, mask: 15, silk: 15 };
  // Labels sit in a column right of the stack: counts first, then the layer's name.
  const LBL_X = X0 + FACE_W + SKEW + 18;
  const PINS_PER_LAYER = 150, DRILLS = 240;

  // Layers top to bottom, with the drawing's row for each.
  function rows(pkg) {
    const L = pkg.layers, out = [];
    const add = (kind, layer, label, side) => { if (layer) out.push({ kind, layer, label, side, file: layer.file.name }); };
    add('silk', L.silk.top, 'Top silkscreen', 'top');
    add('mask', L.mask.top, 'Top solder mask', 'top');
    for (const l of L.copper) add(l.polarity === 'negative' ? 'plane' : 'copper', l, `L${l.cuOrder} ${l.side === 'top' ? 'top' : l.side === 'bottom' ? 'bottom' : l.polarity === 'negative' ? 'plane' : 'inner'} copper`, l.side);
    add('mask', L.mask.bottom, 'Bottom solder mask', 'bottom');
    add('silk', L.silk.bottom, 'Bottom silkscreen', 'bottom');
    let y = TOP;
    out.forEach((r, i) => {
      if (i) y += r.kind === 'silk' || out[i - 1].kind === 'silk' ? GAP.silk : r.kind === 'mask' || out[i - 1].kind === 'mask' ? GAP.mask : GAP.copper;
      r.y = y; r.i = i;
    });
    return out;
  }
  const outer = r => r.side === 'top' || r.side === 'bottom';

  // Outline normalized to the unit square (u across, v front to back), simplified for drawing.
  function shape(pkg) {
    if (pkg._stageShape) return pkg._stageShape;
    const bb = pkg.boardBBox, o = pkg.layers.outline;
    const w = bb[2] - bb[0], h = bb[3] - bb[1], s = Math.max(w, h);
    let pts = o && o.board && o.board.pts && o.board.pts.length >= 6 ? o.board.pts : [bb[0], bb[1], bb[2], bb[1], bb[2], bb[3], bb[0], bb[3]];
    const step = Math.max(1, Math.floor(pts.length / 2 / 160)) * 2, uv = [];
    for (let i = 0; i < pts.length; i += step) uv.push([(pts[i] - bb[0]) / s + (1 - w / s) / 2, (pts[i + 1] - bb[1]) / s + (1 - h / s) / 2]);
    const toUV = (x, y) => [(x - bb[0]) / s + (1 - w / s) / 2, (y - bb[1]) / s + (1 - h / s) / 2];
    return (pkg._stageShape = { uv, toUV });
  }
  const proj = (u, v, y) => [X0 + u * FACE_W + v * SKEW, y + (1 - v) * DEPTH];
  const pts = list => list.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const poly = (uv, y, dy) => pts(uv.map(([u, v]) => { const [x, yy] = proj(u, v, y); return [x, yy + (dy || 0)]; }));

  // Real drill hits, thinned to a few hundred, as dots on the copper.
  function drills(pkg) {
    if (pkg._stageDrills) return pkg._stageDrills;
    // Every unplated hole (there are few), and an even sample of the plated ones.
    const s = shape(pkg), hits = pkg.hits || [], out = [];
    const pth = hits.filter(h => h.plated), np = hits.filter(h => !h.plated).slice(0, 60);
    const every = Math.max(1, Math.ceil(pth.length / DRILLS));
    for (let i = 0; i < pth.length; i += every) { const [u, v] = s.toUV(pth[i].x, pth[i].y); out.push({ u, v, plated: true }); }
    for (const h of np) { const [u, v] = s.toUV(h.x, h.y); out.push({ u, v, plated: false }); }
    return (pkg._stageDrills = out);
  }
  function drillDots(pkg, r) {
    let h = '';
    for (const d of drills(pkg)) {
      const [x, y] = proj(d.u, d.v, r.y);
      h += `<ellipse class="${d.plated ? 'stk-drill' : 'stk-npth'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${d.plated ? 1.4 : 2.6}" ry="${d.plated ? 0.65 : 1.2}" style="--dl:${((d.u + 1 - d.v) * 0.7).toFixed(2)}s"/>`;
    }
    return h;
  }

  // What a step looks at: which rows light up, the holes, the outline, and its detail drawing.
  function focus(label, module) {
    const l = label || '';
    const m = /·\s*(.+)$/.exec(l), file = m ? m[1].trim() : null;
    if (/^Raster analysis/.test(l)) return { kinds: ['copper', 'plane', 'mask'], raster: true, detail: 'spacing' };
    if (/^Spacing and slivers/.test(l)) return { file, scan: true, detail: 'spacing' };
    if (/^Isolated copper/.test(l)) return { file, scan: true, detail: 'island' };
    if (/^Mask dams/.test(l)) return { file, scan: true, detail: 'mask' };
    if (module !== 'dfm') return { kinds: module === 'package' ? ['silk', 'mask', 'copper', 'plane'] : ['silk', 'mask'], outer: true };
    const map = [
      [/^Minimum trace width/, { kinds: ['copper'], detail: 'trace' }],
      [/^Drills/, { kinds: ['copper', 'plane'], holes: 'all', detail: 'drill' }],
      [/^Annular ring/, { kinds: ['copper'], outer: true, holes: 'all', detail: 'ring' }],
      [/^Thermal reliefs/, { kinds: ['plane'], holes: 'all', detail: 'thermal' }],
      [/^Copper to board edge/, { kinds: ['copper', 'plane'], edge: true, detail: 'edge' }],
      [/^NPTH to copper/, { kinds: ['copper', 'plane'], holes: 'npth', detail: 'npth' }],
      [/^Solder mask/, { kinds: ['mask'], detail: 'mask' }],
      [/^Silkscreen/, { kinds: ['silk'], detail: 'silk' }],
      [/^Holes/, { kinds: ['copper', 'plane'], holes: 'all', edge: true, detail: 'holes' }],
      [/^Outline inside corners/, { edge: true, detail: 'corner' }],
      [/^BGA pads/, { kinds: ['copper'], outer: true, holes: 'all', detail: 'bga' }],
    ];
    for (const [re, f] of map) if (re.test(l)) return f;
    return {};
  }
  const lit = (f, r) => !!((f.file && r.file === f.file) || (f.kinds && f.kinds.includes(r.kind) && (!f.outer || outer(r))) ||
    (f.outer && !f.kinds && outer(r)));

  // The DFM module's fixed steps, in order (dfm.js yields them).
  const DFM_STEPS = ['Minimum trace width', 'Drills', 'Annular ring', 'Thermal reliefs', 'Copper to board edge', 'NPTH to copper',
    'Solder mask expansion and dams', 'Silkscreen', 'Holes: spacing, board edge, castellations', 'Outline inside corners', 'BGA pads and vias in pads'];
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

  // ---- detail drawings: what the step measures, dimensioned with the profile's limit ----
  function detail(key, prof) {
    if (!key) return '';
    const L = Fab.fmtLen;
    const rect = (c, x, y, w, h, rx) => `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
    const circ = (c, x, y, r) => `<circle class="${c}" cx="${x}" cy="${y}" r="${r}"/>`;
    // Dimension lines: arrows both ends, with short extension ticks.
    const dimH = (x1, x2, y) => `<path class="d-dim" d="M${x1} ${y - 5}v10M${x2} ${y - 5}v10"/><line class="d-dim" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-start="url(#d-ar)" marker-end="url(#d-ar)"/>`;
    const dimV = (x, y1, y2) => `<path class="d-dim" d="M${x - 5} ${y1}h10M${x - 5} ${y2}h10"/><line class="d-dim" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" marker-start="url(#d-ar)" marker-end="url(#d-ar)"/>`;
    const d = {
      trace: [rect('d-fr', 0, 0, 220, 76) + rect('d-cu', 0, 14, 220, 20) + rect('d-cu', 0, 48, 220, 7) + dimV(150, 48, 55),
        [`Trace width ≥ ${L(prof.minTrace)}`]],
      drill: [rect('d-fr', 30, 14, 160, 50) + rect('d-cu', 30, 11, 160, 3) + rect('d-cu', 30, 64, 160, 3) + rect('d-cu', 96, 11, 28, 56) + rect('d-hole', 102, 11, 16, 56) + dimH(102, 118, 4) + dimV(204, 11, 67),
        [`Drill ≥ ${L(prof.minDrill)}`, `Depth : drill ≤ ${prof.maxAspect}:1`]],
      ring: [rect('d-fr', 0, 0, 220, 76) + circ('d-cu', 110, 38, 30) + circ('d-hole', 110, 38, 15) + dimH(125, 140, 38),
        [`Ring ≥ ${L(prof.ringVia)} via`, `≥ ${L(prof.ringPth)} part`]],
      thermal: [rect('d-cu', 0, 0, 220, 76) + circ('d-gap', 110, 38, 27) + rect('d-cu', 106, 6, 8, 64) + rect('d-cu', 78, 34, 64, 8) + circ('d-cu', 110, 38, 17) + circ('d-hole', 110, 38, 8) + dimH(106, 114, 4),
        ['Spoke width, spoke count', 'and the air gap around the pad']],
      edge: [rect('d-fr', 0, 0, 170, 76) + rect('d-cu', 0, 14, 136, 48) + `<line class="d-edge" x1="170" y1="0" x2="170" y2="76"/>` + dimH(136, 170, 38),
        [`Copper to edge ≥ ${L(prof.copperToEdge)}`]],
      npth: [rect('d-fr', 0, 0, 220, 76) + circ('d-hole', 70, 38, 20) + rect('d-cu', 124, 18, 96, 40, 3) + dimH(90, 124, 38),
        [`Copper to NPTH ≥ ${L(prof.npthToCopper)}`]],
      mask: [rect('d-fr', 0, 0, 220, 76) + rect('d-mask', 0, 0, 220, 76) + rect('d-cu', 40, 20, 50, 36, 2) + rect('d-cu', 130, 20, 50, 36, 2) + rect('d-open', 35, 15, 60, 46, 3) + rect('d-open', 125, 15, 60, 46, 3) + dimH(95, 125, 38),
        [`Mask dam ≥ ${L(prof.minMaskDam)}`]],
      silk: [rect('d-fr', 0, 0, 220, 76) + rect('d-mask', 0, 0, 220, 76) + rect('d-cu', 130, 16, 56, 44, 2) + rect('d-silk', 10, 35, 104, 5) + dimV(70, 35, 40) + `<path class="d-bad" d="M140 22l36 32M176 22l-36 32"/>`,
        [`Silk line ≥ ${L(prof.minSilkLine)}`, 'No ink on exposed pads']],
      holes: [rect('d-fr', 0, 0, 220, 76) + circ('d-cu', 78, 38, 22) + circ('d-hole', 78, 38, 14) + circ('d-cu', 142, 38, 22) + circ('d-hole', 142, 38, 14) + dimH(92, 128, 38),
        [`Hole wall to wall ≥ ${L(prof.holeGap)}`]],
      // The router can't reach into the corner: it leaves a fillet of board, its own radius.
      corner: [`<path class="d-fr" d="M0 0H150V22A18 18 0 0 0 168 40H220V76H0Z"/><path class="d-ghost" d="M150 22V40H168"/><path class="d-edge" d="M150 0V22A18 18 0 0 0 168 40H220"/>` +
        `<line class="d-dim" x1="168" y1="22" x2="155.3" y2="34.7" marker-end="url(#d-ar)"/>` + circ('d-arrow', 168, 22, 1.5),
        [`Inside corners round to ≈ ${L(prof.minInsideRadius)}`]],
      bga: [rect('d-fr', 0, 0, 220, 76) + [0, 1, 2, 3, 4, 5].map(i => [0, 1, 2].map(j => circ(i === 3 && j === 1 ? 'd-cu d-hot' : 'd-cu', 45 + i * 26, 12 + j * 26, 8)).join('')).join('') + circ('d-hole', 123, 38, 3.5) + dimH(37, 53, 64),
        [`BGA land ≥ ${L(prof.minBgaPad)}`, 'Open vias in pasted pads']],
      spacing: [rect('d-fr', 0, 0, 220, 76) + `<path class="d-cu" d="M0 10H44V33H72V10H104V66H72V41H44V66H0Z"/>` + rect('d-cu', 114, 10, 106, 56) + dimH(104, 114, 38) + dimV(58, 33, 41),
        [`Gap ≥ ${L(prof.minSpace)}`, `Neck ≥ ${L(prof.minTrace)}`]],
      island: [rect('d-cu', 0, 0, 220, 76) + rect('d-gap', 70, 12, 80, 52, 4) + rect('d-cu d-hot', 92, 26, 36, 24, 2),
        [`Copper with nothing on it`, `from ${prof.isoMinArea} mm²`]],
    }[key];
    if (!d) return '';
    const [art, cap] = d;
    return `<svg class="stg-fig" viewBox="0 -2 220 ${82 + cap.length * 13}" role="img" aria-label="${esc(cap.join(', '))}">` +
      `<defs><marker id="d-ar" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L6 3L0 6Z" class="d-arrow"/></marker><clipPath id="d-clip"><rect x="0" y="0" width="220" height="76" rx="6"/></clipPath></defs>` +
      `<g clip-path="url(#d-clip)">${art}</g>` + cap.map((t, i) => `<text class="d-cap" x="110" y="${92 + i * 13}">${esc(t)}</text>`).join('') + `</svg>`;
  }

  // ---- live effects ----
  // A raster job's patch on its layer: its area of the board, and a line sweeping across it.
  function jobSvg(s, r, job) {
    const b = job.box, c = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => s.toUV(x, y));
    const u0 = c[0][0], u1 = c[1][0], v0 = c[0][1], v1 = c[2][1], w = Math.min(0.025, (u1 - u0) / 4);
    const patch = pts(c.map(([u, v]) => proj(u, v, r.y)));
    const sweep = pts([[u0, v0], [u0 + w, v0], [u0 + w, v1], [u0, v1]].map(([u, v]) => proj(u, v, r.y)));
    return `<g class="fx-job${job.state === 'done' ? ' done' : ''}" data-j="${job._i}"><polygon class="fx-patch" points="${patch}"/><polygon class="fx-sweep" points="${sweep}" style="--d:${((u1 - u0 - w) * FACE_W).toFixed(1)}px"/></g>`;
  }

  // Where a finding sits in the stack: its own layer, else its side's copper (DFM, package) or silk (assembly).
  function pinOf(pkg, R, f) {
    if (f.severity === 'info') return null;
    const at = f.at || (f.bbox && { x: (f.bbox[0] + f.bbox[2]) / 2, y: (f.bbox[1] + f.bbox[3]) / 2 });
    if (!at || !isFinite(at.x) || !isFinite(at.y)) return null;
    const side = f.side === 'bottom' ? 'bottom' : 'top';
    const r = (f.layer && R.find(x => x.file === f.layer)) ||
      ((f.category === 'Assembly' || f.category === 'BOM') && R.find(x => x.kind === 'silk' && x.side === side)) ||
      R.find(x => (x.kind === 'copper' || x.kind === 'plane') && x.side === side) || R.find(x => x.kind === 'copper');
    if (!r) return null;
    const [u, v] = shape(pkg).toUV(at.x, at.y);
    return { file: r.file, u, v, sev: f.severity };
  }
  function pinSvg(r, p, fresh) {
    const [x, y] = proj(p.u, p.v, r.y), c = p.sev === 'error' ? 'e' : 'w';
    // Warnings stand up as triangles, errors lie flat as dots, so shape tells them apart too.
    const dot = c === 'w' ? '<path class="pin-dot" d="M0 -3.4L3 1.5H-3Z"/>' : `<ellipse class="pin-dot" rx="2.4" ry="1.3"/>`;
    return `<g class="pin ${c}${fresh ? ' new' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><ellipse class="pin-ring" rx="7" ry="3.2"/>${dot}</g>`;
  }
  // Pins by layer, thinned so a layer full of findings stays readable (errors drawn last, on top).
  function pinsByLayer(list) {
    const by = new Map();
    for (const p of list) {
      const a = by.get(p.file) || [], key = Math.round(p.u * 120) + ',' + Math.round(p.v * 120);
      if (!a.seen) a.seen = new Map();
      const had = a.seen.get(key);
      if (had) { if (p.sev === 'error') had.sev = 'error'; continue; }
      if (a.length >= PINS_PER_LAYER) continue;
      const q = Object.assign({}, p); a.seen.set(key, q); a.push(q); by.set(p.file, a);
    }
    for (const a of by.values()) a.sort((x, y) => (x.sev === 'error') - (y.sev === 'error'));
    return by;
  }

  const MODULES = [['package', 'Package'], ['assembly', 'Assembly'], ['build', 'Build'], ['pins', 'Pins'], ['bom', 'BOM'], ['dfm', 'Fab DFM']];
  const modTitle = m => { const i = MODULES.findIndex(x => x[0] === m); return i < 0 ? 'Starting' : `${MODULES[i][1]} · ${i + 1} of ${MODULES.length}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // At the finish: rings in the board's plane open out from the middle of the stack, each at its own
  // size and pace (one closes in instead), with a soft flash at the center.
  function burst(R) {
    const [cx, cy] = proj(0.5, 0.5, (R[0].y + R[R.length - 1].y) / 2);
    const rings = [[95, 0, 0.9], [150, 0.08, 1.25], [205, 0.2, 1.6], [125, 0.32, 1.05]];
    return `<g class="stk-burst" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})">` +
      rings.map(([rx, d, t], i) => `<ellipse class="${i === 3 ? 'in' : 'out'}" rx="${rx}" ry="${(rx * 0.42).toFixed(1)}" style="animation-duration:${t}s;animation-delay:${d}s"/>`).join('') +
      `<ellipse class="core" rx="36" ry="15"/></g>`;
  }

  // The whole stage. e.stage = { module, label } while running; e.live holds the live state.
  function html(e, prof) {
    const pkg = e.pkg;
    if (!pkg || !pkg.boardBBox || !pkg.layers.copper.length) return '';
    const R = rows(pkg), s = shape(pkg), run = e.live;
    const H = R[R.length - 1].y + DEPTH + 16;
    const done = e.status === 'ready';
    const per = new Map();
    if (done) for (const f of e.findings) if (f.layer && f.severity !== 'info') {
      const c = per.get(f.layer) || { error: 0, warn: 0 };
      c[f.severity]++; per.set(f.layer, c);
    }
    const pins = pinsByLayer(done ? e.findings.map(f => pinOf(pkg, R, f)).filter(Boolean) : (run ? run.pins : []));
    // The run's opening or closing transition plays once, on the render that asks for it.
    const fx = run && run.fx;
    if (run) run.fx = null;
    const mid = (R.length - 1) / 2;
    const cu = R.filter(r => r.kind === 'copper' || r.kind === 'plane');
    cur = { e, prof };
    // The step shown: one picked on the bar, else the one running (none once done).
    const st = shown(e), f = st ? focus(st.label, st.module) : {};
    let svg = `<svg class="stk" viewBox="0 0 ${VW} ${H}" role="img" aria-label="Layer stack">`;
    svg += '<defs><linearGradient id="stk-scan" x1="0" x2="1"><stop offset="0" stop-color="var(--stk-glow)" stop-opacity="0"/><stop offset="0.5" stop-color="var(--stk-glow)" stop-opacity="0.5"/><stop offset="1" stop-color="var(--stk-glow)" stop-opacity="0"/></linearGradient></defs>';
    // Dielectric between neighboring copper layers, drawn first so the layers sit on it.
    for (let i = 0; i + 1 < cu.length; i++) svg += `<polygon class="stk-core" points="${poly(s.uv, cu[i].y + 6)}"/>`;
    // Back to front: bottom layers first, so upper ones overlap them.
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i], c = per.get(r.file), on = !!st && lit(f, r);
      const sev = c ? (c.error ? 'error' : c.warn ? 'warn' : '') : '';
      svg += `<g class="stk-layer k-${r.kind}${sev ? ' sev-' + sev : ''}${on ? ' on' : ''}${on && f.scan ? ' scan' : ''}${done ? ' done' : ''}" data-file="${esc(r.file)}" data-kind="${r.kind}" data-side="${r.side || ''}"${done ? ` data-act="stage-layer" tabindex="0"` : ''}${fx ? ` style="--i:${i};--sq:${((mid - i) * 4).toFixed(1)}px"` : ''}>`;
      svg += `<polygon class="stk-edge" points="${poly(s.uv, r.y, r.kind === 'silk' ? 1.5 : 3)}"/><polygon class="stk-face" points="${poly(s.uv, r.y)}"/>`;
      svg += `<clipPath id="stk-clip-${i}"><polygon points="${poly(s.uv, r.y)}"/></clipPath>`;
      svg += `<g clip-path="url(#stk-clip-${i})"><rect class="stk-scan" x="${-FACE_W}" y="${r.y - 4}" width="${FACE_W}" height="${DEPTH + 8}" fill="url(#stk-scan)"/>`;
      if (r.kind === 'copper' || r.kind === 'plane') svg += `<g class="stk-holes">${drillDots(pkg, r)}</g>`;
      svg += `<g class="stk-fx">${run && !done ? run.jobs.filter(j => j.layer === r.file && j.state).map(j => jobSvg(s, r, j)).join('') : ''}</g></g>`;
      svg += `<g class="stk-pins">${(pins.get(r.file) || []).map(p => pinSvg(r, p)).join('')}</g>`;
      // Label in the column on the right, level with the layer's middle, with a leader to it.
      const ly = r.y + DEPTH / 2 + 4, [ex] = proj(1, 0.5, r.y);
      svg += `<line class="stk-lead" x1="${(ex + 4).toFixed(1)}" y1="${(ly - 4).toFixed(1)}" x2="${LBL_X - 4}" y2="${(ly - 4).toFixed(1)}"/>`;
      if (c) svg += `<text class="stk-n ${c.error ? 'e' : 'w'}" x="${LBL_X}" y="${ly.toFixed(1)}">${c.error ? '●' : '▲'} ${c.error || c.warn}</text>`;
      else if (done) svg += `<text class="stk-n ok" x="${LBL_X}" y="${ly.toFixed(1)}">✓</text>`;
      svg += `<text class="stk-lbl" x="${LBL_X + (done ? 36 : 0)}" y="${ly.toFixed(1)}">${esc(r.label)}</text></g>`;
    }
    svg += `<polygon class="stk-outline" points="${poly(s.uv, R[0].y)}"/>${fx === 'exit' ? burst(R) : ''}</svg>`;

    // The way into the board, under the summary once the run is done (it fades in with the finish).
    // With a step picked, it opens on that step's first error or warning (the app's 'stage-open').
    const open = `<div class="stg-actions"><button class="btn btn-primary" data-act="stage-open">Open board <span aria-hidden="true">→</span></button></div>`;
    const cls = ['card', 'stage', done ? 'is-done' : 'is-running'];
    if (fx) cls.push('fx-' + fx);
    if (f.holes) cls.push('holes-' + f.holes);
    if (f.edge) cls.push('edge-on');
    if (f.raster) cls.push('raster-on');
    if (picked(e)) cls.push('picked');
    // The bar sits along the top, so the words changing height below it never move it.
    const from = done && fx === 'exit' && run.runH ? ` data-shrink="1" style="height:${run.runH}px"` : '';
    return `<div class="${cls.join(' ')}" id="stage" data-key="${esc(e.id + ':' + e.status)}"${from}>${progHtml(e, fx)}<div class="stage-art">${svg}</div>` +
      `<div class="stage-side"><div class="stg-text" data-mode="${st ? 'step' : 'sum'}">${textHtml(e, prof, st, f)}</div>${done ? open : ''}</div></div>`;
  }

  // The words beside the stack: the step shown, or the run's summary once it is done.
  function textHtml(e, prof, st, f) {
    if (!st) {
      const nE = e.findings.filter(x => x.severity === 'error').length, nW = e.findings.filter(x => x.severity === 'warn').length;
      return `<div class="stg-eyebrow">Inspection finished</div><div class="stg-title">${plural(nE, 'error')} · ${plural(nW, 'warning')}</div><div class="stg-desc">Each pin is a finding, on its layer. Select a layer to see it on the board.</div>`;
    }
    return `<div class="stg-eyebrow" id="stg-mod">${esc(eyebrow(e, st))}</div><div class="stg-title" id="stg-title">${esc(st.label || 'Reading the package')}</div><div class="stg-desc" id="stg-desc">${esc(explain(st.label, st.module, prof))}</div>` +
      `<div class="stg-step-n" id="stg-step-n">${stepFound(e)}</div>` +
      `<div class="stg-detail" id="stg-detail" data-key="${f.detail || ''}">${detail(f.detail, prof)}</div>`;
  }

  // ---- steps on the bar: marked where the fill will reach them before they run; once the run is
  // done, one segment per step it ran, slid along to go back to the steps that went by too fast to
  // read. run.pick is the index in run.steps of the step shown, or null for the summary. ----
  let cur = null; // the entry and profile of the stage on the page
  const picked = e => { const run = e.live; return run && run.pick != null ? run.steps[run.pick] || null : null; };
  const shown = e => picked(e) || (e.status === 'ready' ? null : e.stage);
  const canPick = e => e.status === 'ready' && e.live && e.live.steps && e.live.steps.length;
  function eyebrow(e, st) {
    const run = e.live;
    return picked(e) ? `${modTitle(st.module).split(' · ')[0]} · step ${run.pick + 1} of ${run.steps.length}` : modTitle(st.module);
  }
  // What the picked step found (the summary has the totals).
  function stepFound(e) {
    const p = picked(e);
    if (!p) return '';
    if (!p.n.error && !p.n.warn) return '<b class="ok">✓</b> Nothing found in this step';
    return [p.n.error && `<b class="e">●</b> ${plural(p.n.error, 'error')}`, p.n.warn && `<b class="w">▲</b> ${plural(p.n.warn, 'warning')}`].filter(Boolean).join('<span class="sep"></span>') + ' in this step';
  }
  // Running: a tick at each planned step (taller where a module starts). Done: a segment per step run,
  // all one width so each is easy to land on; at the finish they open out from where they ran.
  function stepsHtml(e, fx) {
    const run = e.live, done = e.status === 'ready';
    if (!done) return marks(run).map((p, i, l) => i ? `<span class="${l[i - 1].module !== p.module ? 'm0' : ''}" style="left:${(p.a * 100).toFixed(2)}%"></span>` : '').join('');
    return run.steps.map((s, i, l) => {
      const sev = s.n.error ? ' e' : s.n.warn ? ' w' : '', next = l[i + 1] ? l[i + 1].a : 1;
      return `<span data-i="${i}" class="${i && l[i - 1].module !== s.module ? 'm0' : ''}${sev}" title="${esc(s.label)}"${fx === 'exit' ? ` style="flex-grow:${Math.max(0.01, (next - s.a) * l.length).toFixed(3)}"` : ''}></span>`;
    }).join('');
  }
  // The marks while running: the steps run where they began, then the plan's for the steps to come
  // (in the module running, those after the ones it has run).
  function marks(run) {
    const ran = run.steps, now = ran.length ? ran[ran.length - 1].module : null;
    const started = new Set(ran.map(s => s.module));
    let k = ran.filter(s => s.module === now).length;
    return ran.concat((run.plan || []).filter(p => p.module === now ? k-- <= 0 : !started.has(p.module)));
  }
  // Redraw the marks when a step starts (one the plan didn't expect, or skipped, moves them).
  function marksSync(e) {
    const box = document.getElementById('stg-steps');
    if (!box || e.status === 'ready') return;
    const tints = [...box.querySelectorAll('b')];
    box.innerHTML = stepsHtml(e);
    for (const t of tints) box.appendChild(t);
  }
  // Mark the step shown, on the bar, under it and for screen readers.
  function barSync(e) {
    const box = document.getElementById('stg-steps');
    if (!box || !canPick(e)) return;
    const run = e.live, at = run.pick != null ? run.pick : -1;
    [...box.children].forEach((b, i) => b.classList.toggle('cur', i === at));
    // Just finished: the segments drawn where their steps ran open out to one width each.
    if (box.firstElementChild && box.firstElementChild.style.flexGrow) requestAnimationFrame(() => requestAnimationFrame(() => { for (const b of box.children) b.style.flexGrow = ''; }));
    const st = shown(e), bar = document.getElementById('stg-bar');
    bar.setAttribute('aria-valuenow', at < 0 ? run.steps.length + 1 : at + 1);
    bar.setAttribute('aria-valuetext', st ? st.label || '' : 'Summary');
    const hint = document.getElementById('stg-found'), h = hintHtml(e);
    if (hint && hint.innerHTML !== h) hint.innerHTML = h;
  }
  function hintHtml(e) {
    return picked(e) ? '<button type="button" class="stg-now" id="stg-now">← Summary</button>' : 'Select DFM step details';
  }

  // Show the step picked on the bar (null: the summary).
  function pick(i) {
    if (!cur || !canPick(cur.e)) return;
    const e = cur.e, run = e.live;
    run.pick = i == null ? null : Math.max(0, Math.min(run.steps.length - 1, i));
    paint(e, cur.prof);
  }
  // Where each segment was when the press began ([left, right, index]), so a step that changes the
  // page's layout can't move the target under the finger.
  function segBoxes(box) {
    return [...box.children].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.right, +b.dataset.i]; });
  }
  function segAt(boxes, x) {
    let best = null, d = Infinity;
    for (const [l, r, i] of boxes) {
      const dd = x < l ? l - x : x > r ? x - r : 0;
      if (dd < d) { d = dd; best = i; }
    }
    return best;
  }
  // Press and slide along the bar (a vertical swipe still scrolls the page). From the keyboard, left
  // and right step through anywhere on the page (unless typing); Home, End and Escape on the bar.
  document.addEventListener('pointerdown', ev => {
    const bar = ev.target.closest && ev.target.closest('#stg-bar');
    if (!bar || !cur || !canPick(cur.e)) return;
    ev.preventDefault();
    try { bar.setPointerCapture(ev.pointerId); } catch (_) { /* a synthetic pointer */ }
    const boxes = segBoxes(document.getElementById('stg-steps'));
    let last = null;
    const go = x => {
      const i = segAt(boxes, x);
      if (i != null && i !== last) { last = i; pick(i); }
    };
    const was = cur.e.live.pick;
    go(ev.clientX);
    const move = m => go(m.clientX);
    const end = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', end); bar.removeEventListener('pointercancel', cancel); };
    // The browser took the touch as a scroll of the page: put back what was shown before the press.
    const cancel = () => { end(); pick(was); };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', cancel);
  });
  document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('#stg-now')) pick(null); });
  document.addEventListener('keydown', ev => {
    if (!cur || !canPick(cur.e) || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const onBar = !!(ev.target.closest && ev.target.closest('#stg-bar'));
    if (!onBar) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      const t = ev.target, stage = document.getElementById('stage');
      if (!stage || !stage.offsetParent || (t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) return;
    }
    // The summary sits between the last step and the first, so the arrows go round.
    const run = cur.e.live, n = run.steps.length, at = run.pick != null ? run.pick : n;
    const next = i => (i + n + 1) % (n + 1), to = { ArrowLeft: next(at - 1), ArrowRight: next(at + 1), Home: 0, End: n - 1, Escape: n }[ev.key];
    if (to === undefined) return;
    ev.preventDefault();
    pick(to === n ? null : to);
  });

  // Light up the step shown and write its words, without redrawing the stage.
  function paint(e, prof) {
    const root = document.getElementById('stage');
    if (!root) return;
    cur = { e, prof };
    const st = shown(e), f = st ? focus(st.label, st.module) : {};
    for (const g of root.querySelectorAll('.stk-layer')) {
      const r = { file: g.dataset.file, kind: g.dataset.kind, side: g.dataset.side }, on = !!st && lit(f, r);
      g.classList.toggle('on', on);
      g.classList.toggle('scan', !!(on && f.scan));
    }
    root.classList.remove('holes-all', 'holes-npth');
    if (f.holes) root.classList.add('holes-' + f.holes);
    root.classList.toggle('edge-on', !!f.edge);
    root.classList.toggle('raster-on', !!f.raster);
    root.classList.toggle('picked', !!picked(e));
    // Worker patches stay while the raster pass runs, whatever step is shown.
    const now = e.status !== 'ready' && e.stage ? focus(e.stage.label, e.stage.module) : {};
    if (!now.raster) for (const j of root.querySelectorAll('.fx-job')) j.remove();
    words(e, prof, root, st, f);
    if (e.status === 'running') holdRun(e, prof, root);
    else if (root.dataset.shrink) shrink(root);
    barSync(e);
  }
  // The words beside the stack for the step shown, changed in place.
  function words(e, prof, root, st, f) {
    const text = root.querySelector('.stg-text'), mode = st ? 'step' : 'sum';
    if (text && text.dataset.mode !== mode) { text.dataset.mode = mode; text.innerHTML = textHtml(e, prof, st, f); }
    else if (st) {
      const set = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
      set('stg-mod', eyebrow(e, st));
      set('stg-title', st.label || '');
      set('stg-desc', explain(st.label, st.module, prof));
      const n = document.getElementById('stg-step-n'), h = stepFound(e);
      if (n && n.innerHTML !== h) n.innerHTML = h;
      const fig = document.getElementById('stg-detail');
      if (fig && fig.dataset.key !== (f.detail || '')) { fig.dataset.key = f.detail || ''; fig.innerHTML = detail(f.detail, prof); }
    }
  }

  // While the checks run, the stage holds one height, so it doesn't jump from step to step: the
  // tallest of the steps it will show, measured at the start by writing each one's words in turn
  // (the DFM steps, which have drawings and the longest words; file names from this package), and
  // grown if a step still comes out taller. At the finish it eases down to the summary (shrink).
  function probes(pkg) {
    const L = pkg.layers, cu = L.copper, mk = ['top', 'bottom'].map(s => L.mask[s]).filter(Boolean);
    const long = a => a.reduce((x, l) => l.file.name.length > x.length ? l.file.name : x, '');
    return DFM_STEPS.concat([`Raster analysis · ${cu.length} copper and ${mk.length} mask layers in parallel`,
      `Spacing and slivers · ${long(cu)}`, `Isolated copper · ${long(cu)}`, mk.length ? `Mask dams (regions) · ${long(mk)}` : null])
      .filter(Boolean).map(label => ({ module: 'dfm', label })).concat([{ module: 'assembly', label: 'Comments, footprints and size codes' }]);
  }
  function holdRun(e, prof, root) {
    if (root._runH == null) {
      let max = 0;
      for (const st of probes(e.pkg)) { words(e, prof, root, st, focus(st.label, st.module)); max = Math.max(max, root.offsetHeight); }
      const st = shown(e);
      words(e, prof, root, st, st ? focus(st.label, st.module) : {});
      root._runH = max;
    }
    root._runH = Math.max(root._runH, root.offsetHeight);
    root.style.minHeight = root._runH + 'px';
    if (e.live) e.live.runH = root._runH;
  }
  // The finished stage starts at the running one's height (html) and eases to its own. Driven a
  // frame at a time: the save right after a run takes the stage out of the page and puts it back,
  // which would cancel a CSS transition.
  function shrink(root) {
    delete root.dataset.shrink;
    const from = root.offsetHeight;
    root.style.height = '';
    const to = root.offsetHeight;
    if (from <= to || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    root.style.height = from + 'px';
    const t0 = performance.now() + 300, ms = 700;
    const step = now => {
      const k = Math.min(1, Math.max(0, (now - t0) / ms)), ease = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { root.style.height = ''; return; }
      root.style.height = (from + (to - from) * ease).toFixed(1) + 'px';
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The bar along the top: found so far on the left, jobs, percent and time on the right.
  function progHtml(e, fx) {
    const run = e.live, done = e.status === 'ready';
    if (!run || (done && run.ms == null)) return '';
    const steps = `<div class="stg-steps" id="stg-steps">${run.steps ? stepsHtml(e, fx) : ''}</div>`;
    // A finished run's bar is a slider over its steps, with the summary after the last.
    const slider = canPick(e) ? ` tabindex="0" role="slider" aria-orientation="horizontal" aria-label="Step shown" aria-valuemin="1" aria-valuemax="${run.steps.length + 1}"` : '';
    return `<div class="stg-prog${done ? ' done' : ''}${canPick(e) ? ' steps' : ''}" id="stg-prog"><div class="stg-bar" id="stg-bar"${slider}><i class="stg-fill" id="stg-fill" style="transform:scaleX(${done ? 1 : run.frac.toFixed(4)})"></i>${done ? '' : `<b class="stg-run" id="stg-run" style="width:${(run.frac * 100).toFixed(2)}%"><s></s></b>`}${steps}</div>` +
      `<div class="stg-meta"><span id="stg-found">${foundText(e)}</span><span><span id="stg-time">${timeText(e)}</span>${done ? '' : clockHtml(run)}</span></div></div>`;
  }
  // Running totals; once done the title has the counts, so the bar keeps its time and, when its
  // steps can be picked, says so.
  function foundText(e) {
    const n = e.live.n;
    if (e.status === 'ready') return canPick(e) ? hintHtml(e) : '';
    if (!n.error && !n.warn) return 'Nothing found yet';
    return [n.error && `<b class="e">●</b> ${plural(n.error, 'error')}`, n.warn && `<b class="w">▲</b> ${plural(n.warn, 'warning')}`].filter(Boolean).join('<span class="sep"></span>') + ' so far';
  }
  function timeText(e) {
    const run = e.live;
    if (e.status === 'ready') return `Finished in ${(run.ms / 1000).toFixed(1)} s`;
    const jobs = run.jobs.length ? `${run.jobs.filter(j => j.state === 'done').length} of ${run.jobs.length} raster jobs<span class="sep"></span>` : '';
    return `${jobs}${Math.floor(run.frac * 100)}%<span class="sep"></span>`;
  }
  // The run's clock (m:ss), as columns of digits that slide by CSS transform animations, started at
  // the run's start. The browser runs those off the main thread, so the clock keeps ticking while a
  // long check step blocks the page (a clock written from script would stop until the step ends).
  function clockHtml(run) {
    const col = (n, s) => `<span style="animation-duration:${s}s;animation-timing-function:steps(${n})">${Array.from({ length: n }, (_, i) => `<i>${i}</i>`).join('')}</span>`;
    return `<span class="stg-clock" style="--t:${(-(performance.now() - run.t0) / 1000).toFixed(3)}s">${col(60, 3600)}<i>:</i>${col(6, 60)}${col(10, 10)}</span>`;
  }

  // The run moved on to a new step: show it (unless one is picked on the bar), without redrawing.
  function update(e, prof) {
    if (!document.getElementById('stage') || !e.stage) return;
    paint(e, prof);
    marksSync(e);
    progress(e);
  }

  // A raster job taken by a worker ('start') or finished ('done').
  function job(e, ev, j) {
    if (ev === 'plan') return;
    const root = document.getElementById('stage');
    if (!root) return;
    const g = [...root.querySelectorAll('.stk-layer')].find(x => x.dataset.file === j.layer);
    if (!g) return;
    if (ev === 'start') {
      const R = rows(e.pkg), r = R.find(x => x.file === j.layer), fx = g.querySelector('.stk-fx');
      const t = document.createElementNS(SVGNS, 'g');
      t.innerHTML = jobSvg(shape(e.pkg), r, j);
      fx.appendChild(t.firstChild);
    } else {
      const el = g.querySelector(`.fx-job[data-j="${j._i}"]`);
      if (el) el.classList.add('done');
    }
    progress(e);
  }

  // Findings from the step just run: pins on their layers, and a flash of their color there.
  function found(e, fresh, show) {
    const run = e.live;
    if (!run) return;
    // Counted against the step that found them; a module's findings before its first step have none.
    const step = e.stage && e.stage.label && run.steps ? run.steps[run.steps.length - 1] : null;
    const R = rows(e.pkg), hit = new Map(), add = [];
    for (const f of fresh) {
      if (f.severity === 'error' || f.severity === 'warn') {
        run.n[f.severity]++;
        if (step) { step.n[f.severity]++; (step.f || (step.f = [])).push(f); }
      }
      const p = pinOf(e.pkg, R, f);
      if (!p) continue;
      run.pins.push(p); add.push(p);
      if (hit.get(p.file) !== 'error') hit.set(p.file, p.sev);
    }
    if (!show) return;
    const root = document.getElementById('stage');
    if (!root) return;
    // Findings without a place light the layers the step was looking at.
    if (!hit.size && fresh.some(f => f.severity === 'error' || f.severity === 'warn')) {
      const sev = fresh.some(f => f.severity === 'error') ? 'error' : 'warn';
      for (const g of root.querySelectorAll('.stk-layer.on')) hit.set(g.dataset.file, sev);
    }
    const shown = new Map();
    for (const p of add) shown.set(p.file, (shown.get(p.file) || 0) + 1);
    for (const g of root.querySelectorAll('.stk-layer')) {
      const file = g.dataset.file, sev = hit.get(file);
      if (!sev) continue;
      g.classList.remove('hit-error', 'hit-warn');
      void g.getBBox();
      g.classList.add('hit-' + sev);
      clearTimeout(g._hit);
      g._hit = setTimeout(() => g.classList.remove('hit-error', 'hit-warn'), 1800);
      // New pins, up to the per-layer cap, with a ping as they land.
      const box = g.querySelector('.stk-pins'), r = R.find(x => x.file === file);
      if (!box || !r) continue;
      const room = Math.max(0, PINS_PER_LAYER - box.childElementCount);
      const list = add.filter(p => p.file === file).slice(0, room), t = document.createElementNS(SVGNS, 'g');
      t.innerHTML = list.map(p => pinSvg(r, p, true)).join('');
      while (t.firstChild) box.appendChild(t.firstChild);
    }
    stepTint(e);
    const n = document.getElementById('stg-step-n'), h = stepFound(e);
    if (n && n.innerHTML !== h) n.innerHTML = h;
    progress(e);
  }

  // While running, a step that found something tints its stretch of the bar.
  function stepTint(e) {
    const run = e.live, box = document.getElementById('stg-steps');
    if (!box || e.status === 'ready' || !run.steps.length) return;
    const s = run.steps[run.steps.length - 1], sev = s.n.error ? 'e' : s.n.warn ? 'w' : '';
    if (!sev) return;
    let el = box.querySelector(`b[data-i="${run.steps.length - 1}"]`);
    if (!el) {
      el = document.createElement('b');
      el.dataset.i = run.steps.length - 1;
      el.style.left = (s.a * 100).toFixed(2) + '%';
      box.appendChild(el);
    }
    el.className = sev;
  }
  // Each tint runs from its step's start to where the next step began (or the fill's head).
  function tintSync(e) {
    const run = e.live, box = document.getElementById('stg-steps');
    if (!box) return;
    for (const el of box.querySelectorAll('b')) {
      const i = +el.dataset.i, next = run.steps[i + 1];
      el.style.width = (((next ? next.a : run.frac) - run.steps[i].a) * 100).toFixed(2) + '%';
    }
  }

  // The bar and its text.
  function progress(e) {
    const run = e.live;
    if (!run || e.status === 'ready') return;
    const fill = document.getElementById('stg-fill');
    if (!fill) return;
    fill.style.transform = `scaleX(${run.frac.toFixed(4)})`;
    const head = document.getElementById('stg-run');
    if (head) head.style.width = (run.frac * 100).toFixed(2) + '%';
    tintSync(e);
    const a = document.getElementById('stg-found'), b = document.getElementById('stg-time');
    const fa = foundText(e), tb = timeText(e);
    if (a && a.innerHTML !== fa) a.innerHTML = fa;
    if (b && b.innerHTML !== tb) b.innerHTML = tb;
  }

  // The errors and warnings the picked step found, in the order found (none with the summary shown).
  const stepFindings = e => { const p = picked(e); return p ? p.f || [] : []; };

  Fab.stage = { html, update, paint, focus, job, found, progress, detail, stepFindings };
})(window.Fab);
