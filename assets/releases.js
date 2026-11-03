// Fab releases (docs/releases.md): a named package that was, or will be, sent to a fab house. A
// release keeps the release set (what Fabcheck and the fab and assembly houses need, not everything
// Altium wrote) and downloads it as the same zip every time, so its sha256 can be quoted.
(function (Fab) {
  'use strict';

  const STATUS = [['candidate', 'Candidate'], ['sent', 'Sent to fab'], ['built', 'Built'], ['withdrawn', 'Withdrawn']];
  const WARN_MB = 25, MAX_MB = 90; // GitHub's blob API refuses 100 MB; the browser base64s each blob in memory

  // The release set, by classifier type: [in by default, group, why]. Per-file overrides come from
  // the tag form. Kept in one place so the form, the docs and storage can't drift.
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
  const downloadName = (pkgName, label) => safe(stem(pkgName)) + (safe(label) ? '_' + safe(label) : '') + '.zip';
  const newId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Build a release from an open package. form: { label, title, status, fab: {house, sentAt, ref},
  // notes, supersedes, picks: Set of paths }. Resolves { rec, blobs } without saving anything.
  async function build(entry, form, by) {
    const files = entry.files.filter(f => form.picks.has(f.path) && !f.stub);
    if (!files.length) throw new Error('No files picked for the release');
    const listed = [];
    for (const f of files) listed.push({ path: f.path, size: f.size, sha256: await Fab.archive.sha256(f.bytes), bytes: f.bytes });
    const at = new Date();
    const sent = /^\d{4}-\d{2}-\d{2}$/.test((form.fab || {}).sentAt || '') ? new Date(form.fab.sentAt + 'T12:00:00Z') : at;
    const bytes = await zip(listed, sent);
    const run = entry.run || {};
    // R5: the fab and assembly archives, named by function, each with its README.
    const p = plan(entry, form.picks, form.pn, form.rev);
    const byPath = new Map(listed.map(f => [f.path, f]));
    const ctx = context(entry, form, sent.toISOString().slice(0, 10));
    const lay = { v: 1, pn: (form.pn || '').trim(), rev: (form.rev || '').trim(), pre: p.pre, files: p.files, readme: {} };
    for (const which of ['fab', 'assy']) {
      const list = p.files.filter(f => f[which]).map(f => ({ name: f[which], size: byPath.get(f.path).size, sha256: byPath.get(f.path).sha256 }));
      if (list.length) lay.readme[which] = readme(which, ctx, list);
    }
    const zips = await layoutZips(lay, path => byPath.get(path).bytes, sent);
    for (const which of Object.keys(zips)) lay[which] = { name: zips[which].name, sha256: await Fab.archive.sha256(zips[which].bytes), size: zips[which].bytes.length };
    const rec = {
      v: 1, id: newId(), label: form.label.trim(), title: (form.title || '').trim(), status: form.status || 'sent',
      package: run.package || { key: entry.pkgRec && entry.pkgRec.key, sha256: entry.pkgRec && entry.pkgRec.sha256, name: entry.label, size: 0 },
      run: run.id || null,
      summary: run.summary || null,
      supersedes: form.supersedes || null,
      fab: { house: ((form.fab || {}).house || '').trim(), sentAt: (form.fab || {}).sentAt || '', ref: ((form.fab || {}).ref || '').trim() },
      notes: (form.notes || '').trim(),
      files: listed.map(f => ({ path: f.path, size: f.size, sha256: f.sha256 })),
      download: { name: downloadName(run.package ? run.package.name : entry.label, form.label), sha256: await Fab.archive.sha256(bytes), size: bytes.length, date: sent.toISOString().slice(0, 10) },
      changes: form.changes || null,
      layout: lay,
      project: (entry.sentTo && entry.sentTo.projectId) || null,
      stored: null,
      at: at.toISOString(), by: by || '', updatedAt: at.toISOString(), updatedBy: by || '',
    };
    return { rec, blobs: listed.map(f => ({ sha256: f.sha256, bytes: f.bytes })) };
  }

  // Rebuild the download from the release's files and check every hash on the way. getBlob(sha256)
  // resolves the bytes or null. Resolves { name, bytes } or throws naming what is wrong.
  async function assemble(rec, getBlob) {
    const entries = [];
    for (const f of rec.files) {
      const b = await getBlob(f.sha256);
      if (!b) throw new Error(`${f.path} is not in this browser`);
      if (await Fab.archive.sha256(b) !== f.sha256) throw new Error(`${f.path} doesn't match its recorded SHA-256`);
      entries.push({ path: f.path, bytes: b });
    }
    const bytes = await zip(entries, new Date(rec.download.date + 'T12:00:00Z'));
    const sha = await Fab.archive.sha256(bytes);
    if (sha !== rec.download.sha256) throw new Error(`the rebuilt zip's SHA-256 (${sha.slice(0, 12)}…) isn't the recorded one (${rec.download.sha256.slice(0, 12)}…)`);
    return { name: rec.download.name, bytes };
  }

  // Rebuild the fab or assembly archive (R5) and check it against its recorded SHA-256.
  async function assembleLayout(rec, which, getBlob) {
    const lay = rec.layout;
    if (!lay || !lay[which]) throw new Error(`${rec.label} has no ${which === 'fab' ? 'fabrication' : 'assembly'} archive`);
    const byPath = new Map(rec.files.map(f => [f.path, f])), bytes = new Map();
    for (const f of lay.files.filter(x => x[which])) {
      const meta = byPath.get(f.path);
      const b = meta && await getBlob(meta.sha256);
      if (!b) throw new Error(`${f.path} is not in this browser`);
      if (await Fab.archive.sha256(b) !== meta.sha256) throw new Error(`${f.path} doesn't match its recorded SHA-256`);
      bytes.set(f.path, b);
    }
    const one = { pre: lay.pre, files: lay.files.filter(x => x[which]).map(x => ({ path: x.path, [which]: x[which] })), readme: lay.readme };
    const got = (await layoutZips(one, p => bytes.get(p), new Date(rec.download.date + 'T12:00:00Z')))[which];
    const sha = await Fab.archive.sha256(got.bytes);
    if (sha !== lay[which].sha256) throw new Error(`the rebuilt ${got.name} (${sha.slice(0, 12)}…) isn't the recorded one (${lay[which].sha256.slice(0, 12)}…)`);
    return got;
  }

  // What changed against the superseded release, in one line for the history.
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

  // ---- R5: the package laid out the way fab houses ask for it (docs/fab-package.md) ----
  // Two flat archives, <PN>-<REV>_FAB.zip and _ASSY.zip, files named by function, each with a
  // generated README. Files keep their bytes; only names change, and the record keeps both.

  // Part number and revision from a package name: "PCB-1042-03_manufacturing" → PCB-1042, 03.
  function suggestPnRev(name) {
    const tok = stem(baseNameOf(name)).split(/[_ ]/)[0] || '';
    const m = /^(.+?)[-_.](?:rev[-_]?)?([A-Z]{1,2}|\d{1,2})$/.exec(tok);
    return m ? { pn: m[1], rev: m[2] } : { pn: tok, rev: '' };
  }
  function baseNameOf(p) { return String(p || '').split(/[\\/]/).pop(); }

  const SIDE = { top: 'Top', bottom: 'Bottom' };
  // Where a file goes and what it's called (without the PN-REV prefix): [name, fab, assy].
  function role(f, pkg) {
    const c = f.cls || {}, t = c.type, ext = (f.ext || '').toLowerCase();
    const keepExt = n => n + (ext ? '.' + ext : '');
    const other = pkg && pkg.set && c.set && c.set !== pkg.set.dir ? '_' + safe(baseNameOf(c.set)) : '';
    if (t === 'gerber') {
      const side = SIDE[c.side] || '';
      if (c.fn === 'copper') {
        const n = (f.layer && f.layer.cuOrder) || c.cu || '';
        const outer = c.side === 'top' || c.side === 'bottom';
        return [`L${n}_${outer ? side : 'Inner'}${other}.gbr`, true, outer];
      }
      if (c.fn === 'mask') return [`Mask_${side}${other}.gbr`, true, true];
      if (c.fn === 'silk') return [`Silk_${side}${other}.gbr`, true, true];
      if (c.fn === 'paste') return [`Paste_${side}${other}.gbr`, false, true];
      if (c.fn === 'outline' || c.outline) return [`Outline${other}.gbr`, true, true];
      if (c.fn === 'keepout') return [`Keepout${other}.gbr`, true, false];
      if (c.fn === 'mech') return [`Mech${c.mech || ''}${other}.gbr`, true, false];
      if (c.fn === 'drill-gerber') return [`Drill_${c.plated === false ? 'NPTH' : c.plated ? 'PTH' : 'Holes'}${other}.gbr`, true, false];
      const m = /^gm(\d+)$/.exec(ext);
      if (m) return [`Mech${m[1]}${other}.gbr`, true, false];
      return [c.x2fn ? safe(c.x2fn.replace(/,/g, '_')) + other + '.gbr' : safe(f.name), true, false];
    }
    if (t === 'drill') {
      const pl = new Set(Object.values((f.drill || {}).tools || {}).filter(x => x.hits || x.slots).map(x => x.plated));
      const kind = pl.size === 1 ? (pl.has(true) ? 'PTH' : pl.has(false) ? 'NPTH' : 'Drill') : 'Drill';
      return [`${kind}.drl`, true, false];
    }
    if (t === 'drill-report') return [keepExt('Drill_Report'), true, false];
    if (t === 'ipc356') return ['IPC356.ipc', true, false];
    if (t === 'ipc2581') return [keepExt('IPC2581'), true, false];
    if (t === 'odb-archive') return [/\.(tgz|tar\.gz)$/i.test(f.name) ? 'ODB.tgz' : keepExt('ODB'), true, false];
    if (t === 'odb') { const i = f.path.toLowerCase().lastIndexOf('odb/'); return ['ODB/' + f.path.slice(i + 4), true, false]; }
    if (t === 'fab-pdf') return ['FAB.pdf', true, false];
    if (t === 'assy-pdf') return ['ASSY.pdf', false, true];
    if (t === 'bom') return [keepExt('BOM'), false, true];
    if (t === 'pnp') return [keepExt('PNP'), false, true];
    if (t === 'text') return ['Notes_' + safe(f.name), true, false];
    return [safe(f.name), true, false];
  }

  // The layout of a release: names in each archive, made unique (L2_Inner.gbr, L2_Inner-2.gbr).
  function plan(entry, picks, pn, rev) {
    const pre = (safe(pn) || safe(stem(entry.label))) + (safe(rev) ? '-' + safe(rev) : '') + '_';
    // The generated README's name is taken first, so no package file can overwrite it in the zip.
    const used = { fab: new Set([(pre + 'README.txt').toLowerCase()]), assy: new Set([(pre + 'README.txt').toLowerCase()]) };
    const uniq = (set, n) => {
      if (!used[set].has(n.toLowerCase())) { used[set].add(n.toLowerCase()); return n; }
      const dot = n.lastIndexOf('.'), a = dot > 0 ? n.slice(0, dot) : n, b = dot > 0 ? n.slice(dot) : '';
      for (let i = 2; ; i++) if (!used[set].has((a + '-' + i + b).toLowerCase())) { used[set].add((a + '-' + i + b).toLowerCase()); return a + '-' + i + b; }
    };
    const files = [];
    const order = (entry.files || []).filter(f => picks.has(f.path) && !f.stub).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (const f of order) {
      const [name, fab, assy] = role(f, entry.pkg);
      const o = { path: f.path };
      if (fab) o.fab = uniq('fab', pre + name);
      if (assy) o.assy = uniq('assy', pre + name);
      files.push(o);
    }
    return { pre, files };
  }

  // A plain-text README for one archive: what the board is and every file with its SHA-256.
  function readme(which, ctx, list) {
    const L = [];
    L.push(`${ctx.pn || ctx.name}${ctx.rev ? ' rev ' + ctx.rev : ''}: ${which === 'fab' ? 'fabrication' : 'assembly'} data`);
    L.push(`Release ${ctx.label}${ctx.title ? ' (' + ctx.title + ')' : ''}, ${ctx.date}`);
    L.push('');
    if (ctx.board) L.push(`Board: ${ctx.board}`);
    if (ctx.gerber) L.push(`Gerber: ${ctx.gerber}. Drill: Excellon. All files share one origin.`);
    if (which === 'assy') {
      if (ctx.pnp) L.push(`Pick-and-place: ${ctx.pnp}`);
      if (ctx.dnp) L.push(`Do not place: ${ctx.dnp}`);
      L.push('Fabrication layers are included so this set stands alone.');
    }
    L.push('');
    L.push('Files (SHA-256):');
    for (const f of list) L.push(`  ${f.name}  ${f.size} bytes  ${f.sha256}`);
    L.push('');
    L.push('Written by Fabcheck from the released package; file contents are as the CAD tool wrote them.');
    return L.join('\r\n') + '\r\n';
  }

  // What the README says about the board, from the open package (fixed at tag time).
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

  // Build both archives from (path → bytes) and a layout. Resolves { fab, assy } as { name, bytes }.
  async function layoutZips(lay, bytesOf, date) {
    const out = {};
    for (const which of ['fab', 'assy']) {
      const fs = lay.files.filter(f => f[which]);
      if (!fs.length) continue;
      const entries = fs.map(f => ({ path: f[which], bytes: bytesOf(f.path) }));
      entries.push({ path: lay.pre + 'README.txt', bytes: new TextEncoder().encode(lay.readme[which]) });
      out[which] = { name: lay.pre + (which === 'fab' ? 'FAB' : 'ASSY') + '.zip', bytes: await zip(entries, date) };
    }
    return out;
  }

  Fab.releases = { STATUS, SET, WARN_MB, MAX_MB, defaults, zip, build, assemble, assembleLayout, changes, changesText, downloadName, suggestPnRev, role, plan };
})(window.Fab);
