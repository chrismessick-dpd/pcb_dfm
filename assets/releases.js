// The fab package (docs/fab-package.md, docs/signoff-revisions.md): what Fabcheck and the fab and
// assembly houses need, not everything the CAD tool wrote, laid out as one zip with Fabrication/ and
// Assembly/ folders. Send stores it with the run; the Files tab exports it for anyone.
(function (Fab) {
  'use strict';

  const WARN_MB = 25, MAX_MB = 90; // GitHub's blob API refuses 100 MB; the browser base64s each blob in memory

  // What goes in the fab package, by classifier type: [in by default, group, why]. Per-file overrides come from
  // Send's Details. Kept in one place so the picks, the docs and storage can't drift.
  const SET = {
    gerber: [true, 'fab', 'Gerber'], drill: [true, 'fab', 'NC drill'], 'drill-report': [true, 'fab', 'drill report'],
    ipc356: [true, 'fab', 'IPC-356 netlist, for electrical test'], ipc2581: [true, 'fab', 'IPC-2581'],
    'fab-pdf': [true, 'fab', 'fabrication drawing'],
    // A second image format makes the fab ask which one wins (Ucamco, docs/fab-package.md): off
    // unless the fab or assembly house asks for ODB++.
    'odb-archive': [false, 'fab', 'ODB++: a second image format beside the Gerbers; tick it if the fab or assembler wants ODB++'],
    odb: [false, 'fab', 'ODB++ (folder): a second image format beside the Gerbers'],
    pnp: [true, 'assembly', 'pick-and-place'], bom: [true, 'assembly', 'BOM'], 'assy-pdf': [true, 'assembly', 'assembly drawing'],
    pdf: [true, 'other', 'PDF (often schematics or notes)'], text: [true, 'other', 'notes'],
    report: [false, 'other', 'Altium report or log: the fab house doesn\'t need it'],
    archive: [false, 'other', 'nested archive'],
    other: [false, 'other', 'image, CAD or unrecognized file'],
  };

  // Default pick and reason per file. ODB++ is kept once: Altium often writes the same data as a
  // .tgz, a .zip and an extracted odb/ folder.
  function defaults(files) {
    const odbArchives = files.filter(f => f.cls && f.cls.type === 'odb-archive' && !f.stub && f.size)
      .sort((a, b) => (/\.tgz$|\.tar\.gz$/i.test(b.name) - /\.tgz$|\.tar\.gz$/i.test(a.name)) || a.path.localeCompare(b.path));
    const keepOdb = odbArchives[0] || null;
    const out = new Map();
    for (const f of files) {
      const t = (f.cls && f.cls.type) || 'other';
      let [on, group, why] = SET[t] || SET.other;
      if (t === 'odb-archive' && keepOdb && f !== keepOdb) { on = false; why = 'another copy of the ODB++ data (' + keepOdb.name + ' is kept)'; }
      if (t === 'odb' && keepOdb) { on = false; why = 'ODB++ folder, already in ' + keepOdb.name; }
      // Drill data goes once: Excellon, or Gerber drill files, not both (Ucamco).
      if (t === 'gerber' && f.cls.fn === 'drill-gerber') { on = !files.some(x => x.cls && x.cls.type === 'drill'); why = on ? 'Gerber drill file' : 'Gerber drill file: a second copy of the Excellon drill data; tick it if the fab wants Gerber drill'; }
      if (!f.size) { on = false; why = 'empty file'; }
      const avail = !f.stub;
      if (!avail) { on = false; why = 'not kept in this browser: drop the package in again to include it'; }
      if (f.size > MAX_MB * 1048576) { on = false; why = `over ${MAX_MB} MB, too large to store`; }
      out.set(f.path, { on, group, why, avail, big: f.size > WARN_MB * 1048576 });
    }
    return out;
  }

  // The same entries always zip to the same bytes: sorted paths, one fixed date, fixed DEFLATE level.
  // JSZip 3 writes DOS times from the date's UTC fields, so the time zone doesn't matter.
  async function zip(entries, date) {
    const z = new JSZip();
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
    for (const e of entries.slice().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) z.file(e.path, e.bytes, { date: d, binary: true, createFolders: false });
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  }

  const stem = n => String(n || 'package').replace(/\.(zip|tgz|tar\.gz)$/i, '');
  const safe = s => String(s || '').trim().replace(/[^\w.+-]+/g, '-').replace(/^-+|-+$/g, '');
  // What changed against a baseline, in one line (the Revisions tab).
  function changes(cmp, delta, baseId) {
    const out = { base: baseId || null };
    if (cmp) {
      out.layers = cmp.gerber ? cmp.gerber.filter(g => g.status !== 'same').map(g => ({ layer: g.layer, status: g.status, added: g.added || 0, removed: g.removed || 0 })) : null;
      out.bom = cmp.bom ? cmp.bom.added.length + cmp.bom.removed.length + cmp.bom.changed.reduce((s, g) => s + g.des.length, 0) : null;
      out.placements = cmp.pnp ? cmp.pnp.moved.length + cmp.pnp.added.length + cmp.pnp.removed.length : null;
      out.drill = cmp.drill ? cmp.drill.added.length + cmp.drill.removed.length : null;
    }
    if (delta) out.findings = { fixed: delta.fixed.length, new: delta.added.length, same: delta.same.length };
    return out;
  }
  function changesText(c) {
    if (!c) return '';
    const n = (v, one, many) => v + ' ' + (v === 1 ? one : many);
    const parts = [];
    if (c.layers) {
      // Altium names layers <project>.GTL, .GP3…: when they all share that stem, the extension is
      // what tells them apart. Otherwise (DT-1042_Copper_Top.gbr) the whole name does.
      const names = c.layers.map(l => l.layer.split(/[\\/]/).pop());
      const stem = x => x.lastIndexOf('.') > 0 ? x.slice(0, x.lastIndexOf('.')) : null;
      const same = names.length > 1 && stem(names[0]) && names.every(x => stem(x) === stem(names[0]));
      const short = same ? names.map(x => x.slice(stem(x).length + 1)) : names;
      parts.push(names.length ? n(names.length, 'layer', 'layers') + ' changed (' + short.slice(0, 6).join(', ') + (short.length > 6 ? `, +${short.length - 6} more` : '') + ')' : 'Gerbers same');
    }
    for (const [k, one, many] of [['bom', 'BOM line', 'BOM lines'], ['placements', 'placement', 'placements'], ['drill', 'drill hit', 'drill hits']]) {
      if (c[k] == null) continue;
      parts.push(c[k] ? n(c[k], one, many) + ' changed' : (k === 'bom' ? 'BOM' : k === 'drill' ? 'drill' : 'placements') + ' same');
    }
    if (c.findings) parts.push([c.findings.fixed && n(c.findings.fixed, 'finding fixed', 'findings fixed'), c.findings.new && n(c.findings.new, 'new finding', 'new findings')].filter(Boolean).join(', ') || 'findings unchanged');
    return parts.join('; ');
  }

  // ---- The fab package as Fabcheck writes it (docs/fab-package.md) ----
  // One zip shaped like an Altium manufacturing folder: <PN>-<REV>_manufacturing/ with Fabrication/
  // (Gerber, NC Drill, Netlist…) and Assembly/ (BOM, Pick Place), files named by function, and a
  // README listing each file's SHA-256. Files keep their bytes; the run record lists every name.

  // Part number and revision from a package name: "PCB-1042-03_manufacturing" → PCB-1042, 03.
  function suggestPnRev(name) {
    const tok = stem(baseNameOf(name)).split(/[_ ]/)[0] || '';
    const m = /^(.+?)[-_.](?:rev[-_]?)?([A-Z]{1,2}|\d{1,2})$/.exec(tok);
    return m ? { pn: m[1], rev: m[2] } : { pn: tok, rev: '' };
  }
  function baseNameOf(p) { return String(p || '').split(/[\\/]/).pop(); }

  const SIDE = { top: 'Top', bottom: 'Bottom' };
  const FAB = 'Fabrication', GBR = 'Fabrication/Gerber', NC = 'Fabrication/NC Drill';
  // Where a file goes: [folder, name without the PN-REV prefix, keep the name as it is].
  function role(f, pkg) {
    const c = f.cls || {}, t = c.type, ext = (f.ext || '').toLowerCase();
    const keepExt = n => n + (ext ? '.' + ext : '');
    const other = pkg && pkg.set && c.set && c.set !== pkg.set.dir ? '_' + safe(baseNameOf(c.set)) : '';
    if (t === 'gerber') {
      const side = SIDE[c.side] || '';
      if (c.fn === 'copper') {
        const n = (f.layer && f.layer.cuOrder) || c.cu || '';
        return [GBR, `L${n}_${c.side === 'top' || c.side === 'bottom' ? side : 'Inner'}${other}.gbr`];
      }
      if (c.fn === 'mask') return [GBR, `Mask_${side}${other}.gbr`];
      if (c.fn === 'silk') return [GBR, `Silk_${side}${other}.gbr`];
      if (c.fn === 'paste') return [GBR, `Paste_${side}${other}.gbr`];
      if (c.fn === 'outline' || c.outline) return [GBR, `Outline${other}.gbr`];
      if (c.fn === 'keepout') return [GBR, `Keepout${other}.gbr`];
      if (c.fn === 'mech') return [GBR, `Mech${c.mech || ''}${other}.gbr`];
      if (c.fn === 'drill-gerber') return [NC, `Drill_${c.plated === false ? 'NPTH' : c.plated ? 'PTH' : 'Holes'}${other}.gbr`];
      const m = /^gm(\d+)$/.exec(ext);
      if (m) return [GBR, `Mech${m[1]}${other}.gbr`];
      return [GBR, c.x2fn ? safe(c.x2fn.replace(/,/g, '_')) + other + '.gbr' : safe(f.name)];
    }
    if (t === 'drill') {
      const pl = new Set(Object.values((f.drill || {}).tools || {}).filter(x => x.hits || x.slots).map(x => x.plated));
      return [NC, `${pl.size === 1 ? (pl.has(true) ? 'PTH' : pl.has(false) ? 'NPTH' : 'Drill') : 'Drill'}.drl`];
    }
    if (t === 'drill-report') return [NC, keepExt('Drill_Report')];
    if (t === 'ipc356') return ['Fabrication/Netlist', 'IPC356.ipc'];
    if (t === 'ipc2581') return ['Fabrication/IPC-2581', keepExt('IPC2581')];
    if (t === 'odb-archive') return ['Fabrication/ODB', /\.(tgz|tar\.gz)$/i.test(f.name) ? 'ODB.tgz' : keepExt('ODB')];
    // An ODB++ folder keeps its own tree and names, or it isn't ODB++ any more.
    if (t === 'odb') { const i = f.path.toLowerCase().lastIndexOf('odb/'), rest = f.path.slice(i); return ['Fabrication/ODB/' + rest.slice(0, rest.lastIndexOf('/')), baseNameOf(rest), true]; }
    if (t === 'fab-pdf') return [FAB, 'FAB.pdf'];
    if (t === 'assy-pdf') return ['Assembly', 'ASSY.pdf'];
    if (t === 'bom') return ['Assembly/BOM', keepExt('BOM')];
    if (t === 'pnp') return ['Assembly/Pick Place', keepExt('PNP')];
    if (t === 'pdf') return ['Documentation', safe(f.name)];
    if (t === 'text') return ['', 'Notes_' + safe(f.name)];
    return ['Other', safe(f.name)];
  }

  // Paths made unique (L2_Inner.gbr, L2_Inner-2.gbr); the README's path is taken first.
  function uniquer(root) {
    const used = new Set([(root + '/README.txt').toLowerCase()]);
    return p => {
      if (!used.has(p.toLowerCase())) { used.add(p.toLowerCase()); return p; }
      const dot = p.lastIndexOf('.'), a = dot > p.lastIndexOf('/') ? p.slice(0, dot) : p, b = dot > p.lastIndexOf('/') ? p.slice(dot) : '';
      for (let i = 2; ; i++) if (!used.has((a + '-' + i + b).toLowerCase())) { used.add((a + '-' + i + b).toLowerCase()); return a + '-' + i + b; }
    };
  }

  function plan(entry, picks, pn, rev) {
    const id = (safe(pn) || safe(stem(entry.label))) + (safe(rev) ? '-' + safe(rev) : '');
    const pre = id + '_', root = id + '_manufacturing', uniq = uniquer(root);
    const files = [];
    const order = (entry.files || []).filter(f => picks.has(f.path) && !f.stub).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (const f of order) {
      const [folder, name, keep] = role(f, entry.pkg);
      files.push({ path: f.path, to: uniq(root + '/' + (folder ? folder + '/' : '') + (keep ? name : pre + name)) });
    }
    return { pre, root, files };
  }

  // The package's README: what the board is, where things are, and every file with its SHA-256.
  function readme(ctx, root, list) {
    const L = [];
    L.push(`${ctx.pn || ctx.name}${ctx.rev ? ' rev ' + ctx.rev : ''}: fabrication and assembly data`);
    L.push(`${ctx.head || 'Exported by Fabcheck'}, ${ctx.date}`);
    L.push('');
    if (ctx.board) L.push(`Board: ${ctx.board}`);
    if (ctx.gerber) L.push(`Gerber: ${ctx.gerber}. Drill: Excellon. All files share one origin.`);
    if (ctx.pnp) L.push(`Pick-and-place: ${ctx.pnp}`);
    if (ctx.dnp) L.push(`Do not place: ${ctx.dnp}`);
    L.push('');
    L.push('Fabrication/ has what the board house needs: Gerber, NC Drill, the netlist and the fabrication drawing.');
    L.push('Assembly/ has what the assembly house needs: BOM, Pick Place and the assembly drawing (paste layers are in Fabrication/Gerber).');
    L.push('');
    L.push('Files (SHA-256):');
    for (const f of list.slice().sort((a, b) => a.to < b.to ? -1 : 1)) L.push(`  ${f.to.slice(root.length + 1)}  ${f.size} bytes  ${f.sha256}`);
    L.push('');
    L.push('Written by Fabcheck from the released package; file contents are as the CAD tool wrote them.');
    return L.join('\r\n') + '\r\n';
  }

  // What the README says about the board, from the open package (fixed when the version is made).
  function context(entry, form, sent) {
    const pkg = entry.pkg || {}, run = entry.run || {}, L = pkg.layers || {};
    const bb = pkg.boardBBox;
    const t = run.settings && run.settings.thickness;
    const dnp = pkg.bom ? [...new Set(pkg.bom.lines.filter(l => l.dnp).flatMap(l => l.des))].sort(Fab.natCmp) : [];
    return {
      pn: form.pn, rev: form.rev, name: stem(entry.label), label: form.label.trim(), title: (form.title || '').trim(), date: sent,
      board: bb && Fab.bbox.valid(bb) ? `${(bb[2] - bb[0]).toFixed(2)} × ${(bb[3] - bb[1]).toFixed(2)} mm, ${(L.copper || []).length} copper layers${t ? ', ' + t + ' mm thick' : ''}` : '',
      gerber: pkg.set && pkg.set.files && pkg.set.files.length ? (pkg.set.x2 ? 'Gerber X2' : 'RS-274X') : '',
      pnp: pkg.pnp ? `${pkg.pnp.parts.length} placements, ${pkg.pnp.units || 'mm'}` : '',
      dnp: dnp.length ? (dnp.length > 60 ? dnp.slice(0, 60).join(', ') + `, and ${dnp.length - 60} more (see the BOM)` : dnp.join(', ')) : '',
    };
  }

  async function packageZip(lay, bytesOf, date) {
    const entries = lay.files.map(f => ({ path: f.to, bytes: bytesOf(f.path) }));
    entries.push({ path: lay.root + '/README.txt', bytes: new TextEncoder().encode(lay.readme) });
    return { name: lay.root + '.zip', bytes: await zip(entries, date) };
  }

  // The fab package of an open package: form { pn, rev, picks, head }. head is the README's second
  // line (what the package is: a run sent to Signoff, an export). Files keep their bytes; the zip
  // is the same for the same files on the same day. Resolves { name, bytes, sha256, root, files },
  // files listing each original path, its path in the zip, size and SHA-256.
  async function packageFor(entry, form) {
    const picked = (entry.files || []).filter(f => form.picks.has(f.path) && !f.stub);
    if (!picked.length) throw new Error('no files are picked for the fab package');
    const meta = new Map();
    for (const f of picked) meta.set(f.path, { bytes: f.bytes, size: f.size, sha256: await Fab.archive.sha256(f.bytes) });
    const p = plan(entry, form.picks, form.pn, form.rev);
    const date = new Date();
    const files = p.files.map(f => ({ path: f.path, to: f.to, size: meta.get(f.path).size, sha256: meta.get(f.path).sha256 }));
    const ctx = Object.assign(context(entry, { pn: form.pn, rev: form.rev, label: '' }, date.toISOString().slice(0, 10)), { head: form.head || '' });
    const z = await packageZip({ root: p.root, files: p.files, readme: readme(ctx, p.root, files) }, path => meta.get(path).bytes, date);
    return { name: z.name, bytes: z.bytes, sha256: await Fab.archive.sha256(z.bytes), root: p.root, files };
  }

  Fab.releases = { SET, WARN_MB, MAX_MB, defaults, zip, changes, changesText, suggestPnRev, role, plan, packageFor };
})(window.Fab);
