// File classification and package assembly: which file is which layer, which Gerber set is active,
// board outline extraction, and parsing of everything we understand.
(function (Fab) {
  'use strict';
  const G = Fab.geo;

  const EXT274 = [
    [/^gtl$/, { fn: 'copper', side: 'top' }],
    [/^gbl$/, { fn: 'copper', side: 'bottom' }],
    [/^g(\d+)$/, { fn: 'copper', side: 'inner', sub: 'signal' }],
    [/^gp(\d+)$/, { fn: 'copper', side: 'inner', sub: 'plane' }],
    [/^gto$/, { fn: 'silk', side: 'top' }],
    [/^gbo$/, { fn: 'silk', side: 'bottom' }],
    [/^gts$/, { fn: 'mask', side: 'top' }],
    [/^gbs$/, { fn: 'mask', side: 'bottom' }],
    [/^gtp$/, { fn: 'paste', side: 'top' }],
    [/^gbp$/, { fn: 'paste', side: 'bottom' }],
    [/^gko$/, { fn: 'keepout' }],
    [/^gm(\d*)$/, { fn: 'mech' }],
    [/^gml$/, { fn: 'outline' }],
    [/^gd(\d+)$/, { fn: 'drill-drawing' }],
    [/^gg(\d+)$/, { fn: 'drill-guide' }],
    [/^gpt$/, { fn: 'padmaster', side: 'top' }],
    [/^gpb$/, { fn: 'padmaster', side: 'bottom' }],
  ];

  const NAME_HINTS = [ // fallback for generic .gbr/.ger names (KiCad, Eagle, etc.)
    [/(f[._]cu|top[._ -]?(copper|layer)|copper[._ ]?top|\.cmp$)/i, { fn: 'copper', side: 'top' }],
    [/(b[._]cu|bot(tom)?[._ -]?(copper|layer)|copper[._ ]?bot|\.sol$)/i, { fn: 'copper', side: 'bottom' }],
    [/(in\d+[._]cu|inner)/i, { fn: 'copper', side: 'inner' }],
    [/(f[._]mask|top[._ -]?(solder)?mask|soldermask[._ ]?top)/i, { fn: 'mask', side: 'top' }],
    [/(b[._]mask|bot(tom)?[._ -]?(solder)?mask|soldermask[._ ]?bot)/i, { fn: 'mask', side: 'bottom' }],
    [/(f[._]silks?|top[._ -]?(silk|legend|overlay)|legend[._ ]?top)/i, { fn: 'silk', side: 'top' }],
    [/(b[._]silks?|bot(tom)?[._ -]?(silk|legend|overlay)|legend[._ ]?bot)/i, { fn: 'silk', side: 'bottom' }],
    [/(f[._]paste|top[._ -]?paste|paste[._ ]?top)/i, { fn: 'paste', side: 'top' }],
    [/(b[._]paste|bot(tom)?[._ -]?paste|paste[._ ]?bot)/i, { fn: 'paste', side: 'bottom' }],
    [/(edge[._]cuts|outline|profile|board)/i, { fn: 'outline' }],
  ];

  function fromX2(attrs) {
    const ff = attrs['.FileFunction'];
    if (!ff) return null;
    const [kind, a, b] = ff;
    switch (kind) {
      case 'Copper': {
        const idx = parseInt((a || '').replace(/^L/, ''), 10);
        return { fn: 'copper', side: b === 'Top' ? 'top' : b === 'Bot' ? 'bottom' : 'inner', cu: idx || null, sub: (ff[3] || '').toLowerCase() || null };
      }
      case 'Soldermask': return { fn: 'mask', side: a === 'Top' ? 'top' : 'bottom' };
      case 'Legend': return { fn: 'silk', side: a === 'Top' ? 'top' : 'bottom' };
      case 'Paste': return { fn: 'paste', side: a === 'Top' ? 'top' : 'bottom' };
      case 'Profile': return { fn: 'outline' };
      case 'Plated': case 'NonPlated': return { fn: 'drill-gerber', plated: kind === 'Plated' };
      case 'Drillmap': return { fn: 'drill-drawing' };
      case 'AssemblyDrawing': return { fn: 'assembly-drawing', side: a === 'Top' ? 'top' : 'bottom' };
      case 'Keepout': return { fn: 'keepout' };
      default: return { fn: 'other', x2fn: ff.join(',') };
    }
  }

  // ---- first pass: classify by name and a sniff of the content ----
  function sniff(file) {
    const n = file.name.toLowerCase(), e = file.ext, p = file.path.toLowerCase();
    if (/(^|\/)odb(\/|$)/.test(p) && !/\.(zip|tgz|rep)$/.test(n)) return { type: 'odb', note: 'ODB++ tree' };
    if (/\.tgz$|\.tar\.gz$/.test(n) || (e === 'zip' && /odb/.test(p))) return { type: 'odb-archive', note: 'ODB++ archive (not parsed in this version)' };
    if (e === 'zip') return { type: 'archive', note: 'Nested archive' };
    if (e === 'pdf') {
      if (/fab/.test(n)) return { type: 'fab-pdf', note: 'Fabrication drawing' };
      if (/assy|assembly/.test(n)) return { type: 'assy-pdf', note: 'Assembly drawing' };
      return { type: 'pdf' };
    }
    if (e === 'xlsx' || e === 'xls' || e === 'xlsm') return { type: 'bom' };
    if (e === 'drr') return { type: 'drill-report', note: 'Altium NC drill report' };
    if (e === 'ldp') return { type: 'report', note: 'Altium layer-pair file' };
    if (['rep', 'extrep', 'apr', 'apr_lib', 'log', 'html', 'htm'].includes(e) || /status report/i.test(n)) return { type: 'report' };
    if (['png', 'jpg', 'jpeg', 'bmp', 'step', 'stp', 'dxf', 'dwg'].includes(e)) return { type: 'other' };
    if (file.size > 60e6) return { type: 'other', note: 'Too large to inspect' };
    const head = Fab.decodeText(file.bytes.subarray(0, 4096));
    if (/^\s*M48/m.test(head) || /^;\s*(FILE_FORMAT|TYPE=)/m.test(head) && /^T\d+/m.test(head)) return { type: 'drill' };
    if (/%FS[LTD]?[AI]?X\d\dY\d\d/.test(head) || /%MO(MM|IN)\*%/.test(head) || /^G04 /m.test(head) && /%ADD\d+/.test(head)) return { type: 'gerber' };
    if (/Pick and Place|Pick Place/i.test(head) || /designator/i.test(head) && /(center|mid|ref)[- ]?x/i.test(head)) return { type: 'pnp' };
    if (/^P\s+(JOB|UNITS|VER\s+IPC-D-356)/m.test(head) || /^(317|327|017|027)/m.test(head) && e === 'ipc') return { type: 'ipc356', note: 'IPC-D-356 netlist' };
    if (/<IPC-2581/i.test(head)) return { type: 'ipc2581', note: 'IPC-2581 (not parsed in this version)' };
    if (e === 'csv' && /designator/i.test(head) && /(quantity|qty|manufacturer|part number)/i.test(head)) return { type: 'bom' };
    if (e === 'txt' || e === 'csv') return { type: 'text' };
    return { type: 'other' };
  }

  function gerberFunction(file, layer) {
    const x2 = fromX2(layer.attrs);
    if (x2) return x2;
    for (const [re, info] of EXT274) {
      const m = re.exec(file.ext);
      if (m) {
        const r = Object.assign({}, info);
        if (r.fn === 'copper') r.cu = r.side === 'top' ? 1 : (layer.physOrder || (m[1] ? +m[1] + 1 : null));
        if (r.fn === 'copper' && layer.physOrder) r.cu = layer.physOrder;
        if (r.fn === 'mech') r.mech = m[1] ? +m[1] : null;
        return r;
      }
    }
    for (const [re, info] of NAME_HINTS) if (re.test(file.name)) return Object.assign({}, info);
    return { fn: 'other' };
  }

  // ---- outline loops ----
  function outlineLoops(layer) {
    const edges = [];
    for (const p of layer.prims) {
      if (p.k === 'L') edges.push([p.x1, p.y1, p.x2, p.y2]);
      else if (p.k === 'A') edges.push([p.x1, p.y1].concat(G.arcPoints(p.cx, p.cy, p.r, p.a0, p.a1, p.cw, 0.005)));
      else if (p.k === 'R') for (const c of p.contours) edges.push(c.concat([c[0], c[1]]));
    }
    const tol = 0.01, cell = new Map(), nodes = [];
    const key = (x, y) => Math.round(x / tol) + ',' + Math.round(y / tol);
    function node(x, y) {
      const kx = Math.round(x / tol), ky = Math.round(y / tol);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const l = cell.get((kx + dx) + ',' + (ky + dy));
        if (l) for (const id of l) if (Math.hypot(nodes[id].x - x, nodes[id].y - y) <= tol) return id;
      }
      const id = nodes.length;
      nodes.push({ x, y, edges: [] });
      const k = key(x, y);
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(id);
      return id;
    }
    edges.forEach((e, i) => {
      const a = node(e[0], e[1]), b = node(e[e.length - 2], e[e.length - 1]);
      e.a = a; e.b = b; nodes[a].edges.push(i); nodes[b].edges.push(i);
    });
    const used = new Uint8Array(edges.length), loops = [];
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      // Self-closed edge (full circle or closed region).
      const e0 = edges[i];
      if (e0.a === e0.b) { used[i] = 1; loops.push({ pts: e0.slice(0, -2), closed: true }); continue; }
      const pts = e0.slice(); used[i] = 1;
      const start = e0.a; let cur = e0.b, closed = false;
      for (let guard = 0; guard < edges.length; guard++) {
        if (cur === start) { closed = true; break; }
        const next = nodes[cur].edges.find(j => !used[j]);
        if (next == null) break;
        used[next] = 1;
        const e = edges[next];
        if (e.a === cur) { for (let k = 2; k < e.length; k++) pts.push(e[k]); cur = e.b; }
        else { for (let k = e.length - 4; k >= 0; k -= 2) pts.push(e[k], e[k + 1]); cur = e.a; }
      }
      if (closed) pts.length -= 2;
      loops.push({ pts, closed });
    }
    for (const l of loops) { l.area = l.closed ? Math.abs(G.area(l.pts)) : 0; l.bbox = G.polyBBox(l.pts); }
    return loops;
  }

  // ---- build the package ----
  // A generator: yields each file after it is parsed (for the live console), returns the package.
  function* buildSteps(files) {
    const pkg = { files, gerbers: [], drills: [], sets: [], warnings: [], findings: [] };
    for (const f of files) {
      f.cls = sniff(f);
      try {
        if (f.cls.type === 'gerber') {
          f.layer = Fab.gerber.parse(f.text(), f.name);
          f.layer.file = f;
          Object.assign(f.cls, gerberFunction(f, f.layer));
          f.cls.units = f.layer.units; f.cls.format = f.layer.format; f.cls.x2 = f.layer.x2;
          pkg.gerbers.push(f);
        } else if (f.cls.type === 'drill') {
          f.drill = Fab.excellon.parse(f.text(), f.name);
          f.cls.units = f.drill.units; f.cls.format = f.drill.format;
          pkg.drills.push(f);
        } else if (f.cls.type === 'pnp') {
          f.pnp = Fab.assembly.parsePnp(f.text(), f.name);
          f.cls.units = f.pnp.units;
        } else if (f.cls.type === 'bom') {
          f.bom = Fab.assembly.parseBom(f);
          if (!f.bom) f.cls = { type: 'other', note: 'Spreadsheet without a Designator column' };
        } else if (f.cls.type === 'drill-report') {
          f.drr = Fab.excellon.parseDrr(f.text());
        }
      } catch (err) {
        f.cls.error = String(err && err.message || err);
        console.error(f.path, err);
      }
      yield f;
    }

    // Gerber sets: group by folder; prefer the one with X2 attributes, then the one with most copper.
    const byDir = new Map();
    for (const f of pkg.gerbers) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(f);
    }
    pkg.sets = [...byDir.entries()].map(([dir, fs]) => ({
      dir, files: fs, x2: fs.some(f => f.layer.x2),
      copper: fs.filter(f => f.cls.fn === 'copper').length,
    })).filter(s => s.copper > 0 || s.files.length > 2);
    pkg.sets.sort((a, b) => (b.copper > 0) - (a.copper > 0) || b.x2 - a.x2 || b.copper - a.copper);
    pkg.set = pkg.sets[0] || { dir: '.', files: pkg.gerbers, x2: false, copper: 0 };
    for (const s of pkg.sets) for (const f of s.files) f.cls.set = s.dir;
    for (const f of pkg.gerbers) f.cls.active = pkg.set.files.includes(f);

    const L = pkg.layers = { copper: [], mask: {}, silk: {}, paste: {}, outline: null, other: [] };
    for (const f of pkg.set.files) {
      const c = f.cls, lay = f.layer;
      lay.fn = c.fn; lay.side = c.side; lay.cu = c.cu; lay.sub = c.sub;
      if (c.fn === 'copper') L.copper.push(lay);
      else if (c.fn === 'mask' || c.fn === 'silk' || c.fn === 'paste') L[c.fn][c.side] = lay;
      else L.other.push(lay);
    }
    // Copper order: top, inner by physical order, bottom.
    L.copper.sort((a, b) => (a.side === 'top' ? -1e9 : a.side === 'bottom' ? 1e9 : (a.cu || 0)) - (b.side === 'top' ? -1e9 : b.side === 'bottom' ? 1e9 : (b.cu || 0)));
    L.copper.forEach((l, i) => { l.cuOrder = i + 1; });
    L.top = L.copper.find(l => l.side === 'top');
    L.bottom = L.copper.find(l => l.side === 'bottom');

    // Board outline: X2 profile / GML first, then keep-out and mechanical layers that form a closed loop
    // around the copper.
    const copperBB = L.copper.filter(l => l.polarity !== 'negative').reduce((b, l) => Fab.bbox.union(b, l.bbox), Fab.bbox.empty());
    const cands = pkg.set.files.filter(f => ['outline', 'keepout', 'mech'].includes(f.cls.fn));
    const rank = f => f.cls.fn === 'outline' ? 0 : f.cls.fn === 'keepout' ? 1 : 2;
    cands.sort((a, b) => rank(a) - rank(b) || (a.cls.mech || 99) - (b.cls.mech || 99));
    let best = null;
    for (const f of cands) {
      const loops = outlineLoops(f.layer).filter(l => l.closed && l.area > 1);
      if (!loops.length) continue;
      const enclosing = loops.filter(l => !Fab.bbox.valid(copperBB) || Fab.bbox.contains(l.bbox, copperBB, 0.5));
      if (!enclosing.length) continue;
      enclosing.sort((a, b) => a.area - b.area);
      const board = enclosing[0];
      const holes = loops.filter(l => l !== board && Fab.bbox.contains(board.bbox, l.bbox) && l.area < board.area);
      best = { file: f, layer: f.layer, board, cutouts: holes, loops };
      break;
    }
    if (!best && pkg.set.files.length) {
      const b = Fab.bbox.valid(copperBB) ? copperBB : [0, 0, 1, 1];
      best = { file: null, layer: null, board: { pts: [b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]], bbox: b, area: (b[2] - b[0]) * (b[3] - b[1]), closed: true, synthetic: true }, cutouts: [], loops: [] };
    }
    L.outline = best;
    if (best && best.file) best.file.cls.outline = true;

    // Drills: Excellon files only (drill Gerbers are just pictures of the same data).
    pkg.hits = []; pkg.slots = [];
    for (const f of pkg.drills) { pkg.hits.push(...f.drill.hits); pkg.slots.push(...f.drill.slots); }
    pkg.pnp = (files.find(f => f.pnp && f.pnp.parts.length) || {}).pnp || null;
    pkg.bom = (files.find(f => f.bom) || {}).bom || null;
    pkg.drr = (files.find(f => f.drr) || {}).drr || null;
    pkg.ipc356 = files.find(f => f.cls.type === 'ipc356') || null;
    try { pkg.odb = Fab.odb.fromFiles(files); } catch (e) { pkg.odb = null; pkg.warnings.push('ODB++ components: ' + e.message); }

    // Which Altium variant each output was generated from (status reports and the PnP header).
    pkg.variants = [];
    for (const f of files) {
      if (!/status report/i.test(f.name)) continue;
      for (const m of f.text().matchAll(/From\s*:\s*(?:Variant\s*\[+([^\]]+)\]+\s*of\s*)?PCB Document/gi)) {
        pkg.variants.push({ source: f.path, variant: m[1] || null });
      }
    }
    if (pkg.pnp && pkg.pnp.meta.variant) pkg.variants.push({ source: pkg.pnp.name, variant: /no variation/i.test(pkg.pnp.meta.variant) ? null : pkg.pnp.meta.variant });
    for (const v of pkg.variants) if (v.variant && /no variation/i.test(v.variant)) v.variant = null;
    if (best) pkg.boardBBox = best.board.bbox;
    return pkg;
  }

  function build(files) {
    const g = buildSteps(files);
    let r;
    while (!(r = g.next()).done);
    return r.value;
  }

  Fab.classify = { build, buildSteps, outlineLoops, sniff };
})(window.Fab);
