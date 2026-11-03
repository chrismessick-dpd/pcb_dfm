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
      // Layer files share the project's name: show only what tells them apart (GTL, GP3).
      const names = c.layers.map(l => l.layer.split(/[\\/]/).pop());
      let pre = names.length > 1 ? names.reduce((p, x) => { while (x.indexOf(p) !== 0) p = p.slice(0, -1); return p; }) : names.length ? names[0].replace(/[^._-]*$/, '') : '';
      pre = pre.replace(/[^._-]*$/, '');
      const short = names.map(x => x.slice(pre.length) || x);
      parts.push(names.length ? n(names.length, 'layer', 'layers') + ' changed (' + short.slice(0, 6).join(', ') + (short.length > 6 ? `, +${short.length - 6} more` : '') + ')' : 'Gerbers same');
    }
    for (const [k, one, many] of [['bom', 'BOM line', 'BOM lines'], ['placements', 'placement', 'placements'], ['drill', 'drill hit', 'drill hits']]) {
      if (c[k] == null) continue;
      parts.push(c[k] ? n(c[k], one, many) + ' changed' : (k === 'bom' ? 'BOM' : k === 'drill' ? 'drill' : 'placements') + ' same');
    }
    if (c.findings) parts.push([c.findings.fixed && n(c.findings.fixed, 'finding fixed', 'findings fixed'), c.findings.new && n(c.findings.new, 'new finding', 'new findings')].filter(Boolean).join(', ') || 'findings unchanged');
    return parts.join('; ');
  }

  Fab.releases = { STATUS, SET, WARN_MB, MAX_MB, defaults, zip, build, assemble, changes, changesText, downloadName };
})(window.Fab);
