/* Inspection stage: an exploded 3D view of the package's layer stack beside the run. The layers a
   step reads glow; raster jobs light the part of the board each worker is analyzing, live; findings
   drop onto their layer as pins (and stay, as a map of the run, when it is done); hole checks light
   the board's real drill hits; a detail drawing shows what the step measures, at the profile's limit;
   and a bar along the bottom shows the run's progress. */
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
    const step = Math.max(2, Math.floor(pts.length / 2 / 160)) * 2, uv = [];
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
    return `<g class="pin ${c}${fresh ? ' new' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><ellipse class="pin-ring" rx="7" ry="3.2"/><ellipse class="pin-dot" rx="2.4" ry="1.3"/></g>`;
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
  const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

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
    const cu = R.filter(r => r.kind === 'copper' || r.kind === 'plane');
    const f = !done && e.stage ? focus(e.stage.label, e.stage.module) : {};
    let svg = `<svg class="stk" viewBox="0 0 ${VW} ${H}" role="img" aria-label="Layer stack">`;
    svg += '<defs><linearGradient id="stk-scan" x1="0" x2="1"><stop offset="0" stop-color="var(--stk-glow)" stop-opacity="0"/><stop offset="0.5" stop-color="var(--stk-glow)" stop-opacity="0.5"/><stop offset="1" stop-color="var(--stk-glow)" stop-opacity="0"/></linearGradient></defs>';
    // Dielectric between neighboring copper layers, drawn first so the layers sit on it.
    for (let i = 0; i + 1 < cu.length; i++) svg += `<polygon class="stk-core" points="${poly(s.uv, cu[i].y + 6)}"/>`;
    // Back to front: bottom layers first, so upper ones overlap them.
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i], c = per.get(r.file), on = !done && lit(f, r);
      const sev = c ? (c.error ? 'error' : c.warn ? 'warn' : '') : '';
      svg += `<g class="stk-layer k-${r.kind}${sev ? ' sev-' + sev : ''}${on ? ' on' : ''}${on && f.scan ? ' scan' : ''}${done ? ' done' : ''}" data-file="${esc(r.file)}" data-kind="${r.kind}" data-side="${r.side || ''}"${done ? ` data-act="stage-layer" tabindex="0"` : ''}>`;
      svg += `<polygon class="stk-edge" points="${poly(s.uv, r.y, r.kind === 'silk' ? 1.5 : 3)}"/><polygon class="stk-face" points="${poly(s.uv, r.y)}"/>`;
      svg += `<clipPath id="stk-clip-${i}"><polygon points="${poly(s.uv, r.y)}"/></clipPath>`;
      svg += `<g clip-path="url(#stk-clip-${i})"><rect class="stk-scan" x="${-FACE_W}" y="${r.y - 4}" width="${FACE_W}" height="${DEPTH + 8}" fill="url(#stk-scan)"/>`;
      if (r.kind === 'copper' || r.kind === 'plane') svg += `<g class="stk-holes">${drillDots(pkg, r)}</g>`;
      svg += `<g class="stk-fx">${run && !done ? run.jobs.filter(j => j.layer === r.file && j.state).map(j => jobSvg(s, r, j)).join('') : ''}</g></g>`;
      svg += `<g class="stk-pins">${(pins.get(r.file) || []).map(p => pinSvg(r, p)).join('')}</g>`;
      // Label in the column on the right, level with the layer's middle, with a leader to it.
      const ly = r.y + DEPTH / 2 + 4, [ex] = proj(1, 0.5, r.y);
      svg += `<line class="stk-lead" x1="${(ex + 4).toFixed(1)}" y1="${(ly - 4).toFixed(1)}" x2="${LBL_X - 4}" y2="${(ly - 4).toFixed(1)}"/>`;
      if (c) svg += `<text class="stk-n ${c.error ? 'e' : 'w'}" x="${LBL_X}" y="${ly.toFixed(1)}">${c.error || c.warn}</text>`;
      else if (done) svg += `<text class="stk-n ok" x="${LBL_X}" y="${ly.toFixed(1)}">✓</text>`;
      svg += `<text class="stk-lbl" x="${LBL_X + (done ? 30 : 0)}" y="${ly.toFixed(1)}">${esc(r.label)}</text></g>`;
    }
    svg += `<polygon class="stk-outline" points="${poly(s.uv, R[0].y)}"/></svg>`;

    const st = e.stage || {};
    const nE = e.findings.filter(x => x.severity === 'error').length, nW = e.findings.filter(x => x.severity === 'warn').length;
    const right = done
      ? `<div class="stg-eyebrow">Inspection finished</div><div class="stg-title">${plural(nE, 'error')} · ${plural(nW, 'warning')}</div><div class="stg-desc">Each pin is a finding, on its layer. Select a layer to see it on the board.</div>`
      : `<div class="stg-eyebrow" id="stg-mod">${esc(modTitle(st.module))}</div><div class="stg-title" id="stg-title">${esc(st.label || 'Reading the package')}</div><div class="stg-desc" id="stg-desc">${esc(explain(st.label, st.module, prof))}</div>` +
        `<div class="stg-detail" id="stg-detail" data-key="${f.detail || ''}">${detail(f.detail, prof)}</div>`;
    const cls = ['card', 'stage', done ? 'is-done' : 'is-running'];
    if (f.holes) cls.push('holes-' + f.holes);
    if (f.edge) cls.push('edge-on');
    if (f.raster) cls.push('raster-on');
    return `<div class="${cls.join(' ')}" id="stage"><div class="stage-art">${svg}</div><div class="stage-side">${right}</div>${progHtml(e)}</div>`;
  }

  // The bar along the bottom: found so far on the left, jobs, percent and time on the right.
  function progHtml(e) {
    const run = e.live, done = e.status === 'ready';
    if (!run || (done && run.ms == null)) return '';
    return `<div class="stg-prog${done ? ' done' : ''}" id="stg-prog"><div class="stg-bar"><i id="stg-fill" style="transform:scaleX(${done ? 1 : run.frac.toFixed(4)})"></i></div>` +
      `<div class="stg-meta"><span id="stg-found">${foundText(e)}</span><span id="stg-time">${timeText(e)}</span></div></div>`;
  }
  // Running totals; once done the title has the counts, so the bar only keeps its time.
  function foundText(e) {
    const n = e.live.n;
    if (e.status === 'ready') return '';
    if (!n.error && !n.warn) return 'Nothing found yet';
    return [n.error && `<b class="e">●</b> ${plural(n.error, 'error')}`, n.warn && `<b class="w">●</b> ${plural(n.warn, 'warning')}`].filter(Boolean).join('<span class="sep"></span>') + ' so far';
  }
  function timeText(e) {
    const run = e.live;
    if (e.status === 'ready') return `Finished in ${(run.ms / 1000).toFixed(1)} s`;
    const jobs = run.jobs.length ? `${run.jobs.filter(j => j.state === 'done').length} of ${run.jobs.length} raster jobs<span class="sep"></span>` : '';
    return `${jobs}${Math.floor(run.frac * 100)}%<span class="sep"></span>${clock(performance.now() - run.t0)}`;
  }

  // Light up what the current step looks at, without redrawing the stage.
  function update(e, prof) {
    const root = document.getElementById('stage');
    if (!root || !e.stage) return;
    const { module, label } = e.stage, f = focus(label, module);
    for (const g of root.querySelectorAll('.stk-layer')) {
      const r = { file: g.dataset.file, kind: g.dataset.kind, side: g.dataset.side }, on = lit(f, r);
      g.classList.toggle('on', on);
      g.classList.toggle('scan', !!(on && f.scan));
    }
    root.classList.remove('holes-all', 'holes-npth');
    if (f.holes) root.classList.add('holes-' + f.holes);
    root.classList.toggle('edge-on', !!f.edge);
    root.classList.toggle('raster-on', !!f.raster);
    if (!f.raster) for (const j of root.querySelectorAll('.fx-job')) j.remove();
    const set = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
    set('stg-mod', modTitle(module));
    set('stg-title', label || '');
    set('stg-desc', explain(label, module, prof));
    const fig = document.getElementById('stg-detail');
    if (fig && fig.dataset.key !== (f.detail || '')) { fig.dataset.key = f.detail || ''; fig.innerHTML = detail(f.detail, prof); }
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
    const R = rows(e.pkg), hit = new Map(), add = [];
    for (const f of fresh) {
      if (f.severity === 'error' || f.severity === 'warn') run.n[f.severity]++;
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
    progress(e);
  }

  // The bar and its text.
  function progress(e) {
    const run = e.live;
    if (!run || e.status === 'ready') return;
    const fill = document.getElementById('stg-fill');
    if (!fill) return;
    fill.style.transform = `scaleX(${run.frac.toFixed(4)})`;
    const a = document.getElementById('stg-found'), b = document.getElementById('stg-time');
    const fa = foundText(e), tb = timeText(e);
    if (a && a.innerHTML !== fa) a.innerHTML = fa;
    if (b && b.innerHTML !== tb) b.innerHTML = tb;
  }

  Fab.stage = { html, update, focus, job, found, progress, detail };
})(window.Fab);
