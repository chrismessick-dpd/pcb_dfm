// Kept runs (contract: ee_design_review/docs/fabcheck-link.md). Every finished run is saved in
// IndexedDB with its run record, findings and the slimmed package, so it reopens without the
// original upload and can be stored in a Signoff project's repo.
(function (Fab) {
  'use strict';
  const DB = Fab.DEMO ? 'fabcheck-demo' : 'fabcheck', VER = 1;

  // ---- IndexedDB ----
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('runs')) d.createObjectStore('runs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('packages')) d.createObjectStore('packages', { keyPath: 'key' });
      };
      r.onsuccess = () => {
        // Let another tab delete or upgrade the database (the demo's Reset) instead of blocking it.
        r.result.onversionchange = () => { r.result.close(); dbp = null; };
        res(r.result);
      };
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const put = (store, v) => tx(store, 'readwrite', s => s.put(v));
  const get = (store, k) => tx(store, 'readonly', s => s.get(k));
  const all = store => tx(store, 'readonly', s => s.getAll());
  const del = (store, k) => tx(store, 'readwrite', s => s.delete(k));

  // ---- slimming ----
  // Files whose classification depends only on name or path can be left out and stood in for by an
  // empty placeholder: a re-run classifies the placeholder the same way, so findings are identical.
  // Everything Fabcheck parses by content is kept.
  function keep(f) {
    const t = f.cls && f.cls.type;
    if (/^(pdf|fab-pdf|assy-pdf)$/.test(t)) return [false, 'drawing (PDF)'];
    if (t === 'archive' || t === 'odb-archive') return [false, 'nested archive (its contents are in the package)'];
    if (t === 'odb' && !/\/steps\/[^/]+\/layers\/comp_\+_(top|bot)\/components$/i.test(f.path)) return [false, 'ODB++ data Fabcheck does not read'];
    if (t === 'other' && /^(png|jpe?g|bmp|gif|step|stp|dxf|dwg|igs|iges)$/.test(f.ext)) return [false, 'image or CAD file'];
    if (f.size > 60e6) return [false, 'too large to inspect'];
    return [true, ''];
  }

  // sha256 of the original upload: the zip's bytes, or for loose files the sorted "path\tsha256" lines.
  async function manifest(files, source, name) {
    const entries = [];
    for (const f of files) {
      const [stored, reason] = keep(f);
      entries.push({ path: f.path, size: f.size, sha256: await Fab.archive.sha256(f.bytes), stored, reason: reason || undefined });
    }
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const sha256 = source ? await Fab.archive.sha256(source.bytes)
      : await Fab.archive.sha256(new TextEncoder().encode(entries.map(e => e.path + '\t' + e.sha256).join('\n')));
    const size = source ? source.bytes.length : files.reduce((s, f) => s + f.size, 0);
    return { key: sha256.slice(0, 16), sha256, name: source ? source.name : name, size, files: entries };
  }

  // Package record for IndexedDB (and later the repo): manifest + the stored files' bytes.
  async function packageRecord(files, source, name) {
    const m = await manifest(files, source, name);
    const byPath = new Map(files.map(f => [f.path, f]));
    return { key: m.key, sha256: m.sha256, name: m.name, size: m.size, manifest: m, files: m.files.filter(e => e.stored).map(e => ({ path: e.path, bytes: byPath.get(e.path).bytes })) };
  }

  // Files for a re-run: the stored ones plus empty placeholders for the rest.
  function restoreFiles(rec) {
    const stored = new Map(rec.files.map(f => [f.path, f.bytes]));
    const out = rec.manifest.files.map(e => {
      const f = Fab.loader.makeFile(e.path, stored.get(e.path) || new Uint8Array(0));
      if (!stored.has(e.path)) { f.size = e.size; f.stub = true; }
      return f;
    });
    out.source = null;
    return out;
  }

  // Findings without references to parser objects (findings may point at primitives or drill hits).
  function compactFindings(fs) {
    return fs.map(f => {
      const o = { id: f.id, category: f.category, check: f.check, severity: f.severity, title: f.title, detail: f.detail };
      if (f.at) o.at = f.at.dia != null ? { x: f.at.x, y: f.at.y, dia: f.at.dia } : { x: f.at.x, y: f.at.y };
      for (const k of ['bbox', 'layer', 'value', 'limit', 'refs', 'side', 'row']) if (f[k] != null) o[k] = f[k];
      return o;
    });
  }

  const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function runRecord(entry, pkgRec, settings) {
    const c = { error: 0, warn: 0, info: 0 };
    for (const f of entry.findings) c[f.severity]++;
    const by = ((() => { try { return JSON.parse(localStorage.getItem(Fab.signoffNs + 'settings') || '{}'); } catch (e) { return {}; } })().user) || '';
    return {
      id: newId(), at: new Date().toISOString(), by,
      tool: { name: 'Fabcheck', version: (window.FABCHECK_VERSION || {}).hash || 'dev' },
      package: { key: pkgRec.key, sha256: pkgRec.sha256, name: pkgRec.name, size: pkgRec.size },
      settings, summary: c, stored: null,
    };
  }

  async function saveRun(run, findings, pkgRec, extra) {
    if (!(await get('packages', pkgRec.key))) await put('packages', pkgRec);
    await put('runs', Object.assign({ id: run.id, run, findings: compactFindings(findings) }, extra || {}));
  }

  async function updateRun(id, patch) {
    const r = await get('runs', id);
    if (!r) return null;
    Object.assign(r, patch);
    await put('runs', r);
    return r;
  }

  async function recentRuns() {
    const rs = await all('runs');
    return rs.sort((a, b) => b.run.at.localeCompare(a.run.at));
  }

  // Delete a run, and its package when no other run uses it.
  async function deleteRun(id) {
    const r = await get('runs', id);
    await del('runs', id);
    if (r && !(await all('runs')).some(x => x.run.package.key === r.run.package.key)) await del('packages', r.run.package.key);
  }

  // A run record named on a Signoff EE issue (source.run), when this browser has never seen the run.
  function runFromSignoff(runId, ns) {
    let projects = {};
    try { projects = JSON.parse(localStorage.getItem((ns || Fab.signoffNs) + 'projects') || '{}'); } catch (e) { /* ignore */ }
    for (const p of Object.values(projects)) for (const c of Object.values(p.custom || {})) {
      if (c.source && c.source.run && c.source.run.id === runId) return { run: c.source.run, project: p };
    }
    return null;
  }

  // Drop this database (the demo's Reset). Closes the open connection first so the delete isn't blocked.
  async function clearAll() {
    if (dbp) { try { (await dbp).close(); } catch (e) { /* never opened */ } dbp = null; }
    await new Promise(res => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }

  Fab.store = {
    clearAll, keep, manifest, packageRecord, restoreFiles, compactFindings, runRecord, saveRun, updateRun, recentRuns, deleteRun, runFromSignoff,
    getRun: id => get('runs', id), getPackage: key => get('packages', key), putRun: v => put('runs', v), putPackage: v => put('packages', v),
  };
})(window.Fab);
