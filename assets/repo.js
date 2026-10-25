// Stage 2 of the Fabcheck ↔ Signoff EE link (ee_design_review/docs/fabcheck-link.md): store a sent
// run in the project's home repository, and read runs back from there for deep links.
//
//   <dataPath>fabcheck/<projectId>/packages/<key>/manifest.json
//   <dataPath>fabcheck/<projectId>/packages/<key>/files/<path inside the package>
//   <dataPath>fabcheck/<projectId>/runs/<runId>.json        { run, findings }
//
// Writes go through the Signoff engine's GitHubStore.putFiles (assets/vendor/github.js), which skips
// files already there, so re-sending a package uploads nothing new.
(function (Fab) {
  'use strict';
  const NS = 'signoff.v1.';
  const load = (k, d) => { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const token = () => { try { return sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''; } catch (e) { return ''; } };
  let fetchImpl = null; // tests inject a fake GitHub here

  // The project's home repo and the directory for its runs, as Signoff EE decides it.
  function home(projectId) {
    const s = load('settings', {}) || {};
    const roster = load('roster', {}) || {};
    const homes = load('homes', {}) || {};
    const owner = s.owner || ((window.SIGNOFF_CONFIG || {}).repos || {}).owner || 'chrismessick-dpd';
    const dataRepo = s.dataRepo || 'ee_design_review_data';
    const shared = roster.shared && roster.shared[projectId] && roster.shared[projectId].repo;
    const repo = shared || homes[projectId] || owner + '/' + dataRepo;
    const isData = repo.toLowerCase() === (owner + '/' + dataRepo).toLowerCase();
    const dataPath = isData && s.dataPath ? s.dataPath.replace(/\/+$/, '') + '/' : '';
    return { repo, dir: dataPath + 'fabcheck/' + projectId + '/', branch: s.branch || 'main' };
  }

  function storeFor(repo, branch) {
    const [owner, name] = repo.split('/');
    return new window.Signoff.GitHubStore({ owner, repo: name, branch: branch || 'main', token: token() }, fetchImpl || undefined);
  }

  const json = o => JSON.stringify(o, null, 1);

  // Upload after Send to Signoff. Never throws: problems are logged and the run stays local.
  async function upload(entry, projectId, log) {
    const run = entry.run, pkgRec = entry.pkgRec;
    if (!run || !pkgRec) return null;
    if (!window.Signoff || !window.Signoff.GitHubStore) { log('warn', 'Run kept in this browser only: the GitHub engine did not load.'); return null; }
    if (!token()) { log('warn', 'Run kept in this browser only: no GitHub token in Signoff EE (set one in its Settings). The issues were sent.'); return null; }
    if (!(window.crypto && crypto.subtle)) { log('warn', 'Run kept in this browser only: storing needs a secure page (http://localhost or https), not a file opened from disk.'); return null; }
    const h = home(projectId);
    const stored = { repo: h.repo, dir: h.dir };
    const runRec = Object.assign({}, run, { stored });
    const pdir = h.dir + 'packages/' + pkgRec.key + '/';
    const files = pkgRec.files.map(f => ({ path: pdir + 'files/' + f.path, bytes: f.bytes }));
    files.push({ path: pdir + 'manifest.json', text: json(pkgRec.manifest) });
    const stored1 = await Fab.store.getRun(run.id);
    files.push({ path: h.dir + 'runs/' + run.id + '.json', text: json({ run: runRec, findings: (stored1 && stored1.findings) || Fab.store.compactFindings(entry.findings) }) });
    const bytes = files.reduce((n, f) => n + (f.bytes ? f.bytes.length : f.text.length), 0);
    log('step', `Storing run ${run.id} in ${h.repo}/${h.dir}`);
    log('dim', `         ${files.length} files (${(bytes / 1048576).toFixed(2)} MB before compression); files already there are skipped`);
    try {
      let last = 0;
      const res = await storeFor(h.repo, h.branch).putFiles(files, {
        message: `Fabcheck: store run ${run.id} (${pkgRec.name})`,
        onProgress: (done, total) => { if (done === total || done - last >= Math.max(1, Math.ceil(total / 5))) { last = done; log('dim', `         uploaded ${done} of ${total} new files`); } },
        onRetry: n => log('dim', `         someone else pushed first; retrying (${n})`),
      });
      log('ok', res.pushed ? `Stored in ${h.repo}: ${res.pushed} file(s) written, ${res.skipped} already there${res.commitUrl ? ' · ' + res.commitUrl : ''}` : `Already stored in ${h.repo}: all ${res.skipped} files were there; nothing uploaded`);
      entry.run = runRec;
      await Fab.store.updateRun(run.id, { run: runRec });
      markStored(run.id, stored);
      return res;
    } catch (err) {
      const why = err.status === 404 || err.status === 403 ? `no write access to ${h.repo} with this token` : (err.message || String(err));
      log('warn', `Run kept in this browser only: could not store it in ${h.repo} (${why}). The issues were sent.`);
      return null;
    }
  }

  // Put `stored` on the run record of every Signoff issue that carries this run, so others can open it.
  function markStored(runId, stored) {
    const all = load('projects', {});
    const dirty = load('dirty', {});
    const who = ((load('settings', {}) || {}).user) || 'Fabcheck';
    const t = new Date().toISOString();
    let changed = false;
    for (const p of Object.values(all)) for (const [id, c] of Object.entries(p.custom || {})) {
      if (!c.source || !c.source.run || c.source.run.id !== runId || (c.source.run.stored && c.source.run.stored.repo === stored.repo)) continue;
      p.custom[id] = Object.assign({}, c, { source: Object.assign({}, c.source, { run: Object.assign({}, c.source.run, { stored }) }), updatedAt: t, updatedBy: who });
      dirty[p.id] = t;
      changed = true;
    }
    if (changed) { localStorage.setItem(NS + 'projects', JSON.stringify(all)); localStorage.setItem(NS + 'dirty', JSON.stringify(dirty)); }
  }

  // A run from the repo named in a deep link, cached in IndexedDB. Resolves {stored, pkgRec} or null.
  async function fetchRun(q, log) {
    if (!window.Signoff || !window.Signoff.GitHubStore || !q.repo || !q.project) return null;
    const store = storeFor(q.repo, 'main');
    const entries = await store.listTree('');
    const runPath = entries.find(e => e.path.endsWith('fabcheck/' + q.project + '/runs/' + q.run + '.json'));
    if (!runPath) return null;
    const dir = runPath.path.slice(0, runPath.path.length - ('runs/' + q.run + '.json').length);
    const td = new TextDecoder();
    const doc = JSON.parse(td.decode(await store.readBytes(runPath.path, entries)));
    const key = doc.run.package.key;
    const pdir = dir + 'packages/' + key + '/';
    const manifest = JSON.parse(td.decode(await store.readBytes(pdir + 'manifest.json', entries)));
    const files = [];
    for (const e of manifest.files.filter(x => x.stored)) {
      const b = await store.readBytes(pdir + 'files/' + e.path, entries);
      if (!b) throw new Error('Stored package is missing ' + e.path);
      files.push({ path: e.path, bytes: b });
    }
    const pkgRec = { key, sha256: manifest.sha256, name: manifest.name, size: manifest.size, manifest, files };
    await Fab.store.putPackage(pkgRec);
    await Fab.store.putRun({ id: doc.run.id, run: doc.run, findings: doc.findings, sentTo: { projectId: q.project } });
    if (log) log('ok', `Read run ${doc.run.id} from ${q.repo}`);
    return { stored: { run: doc.run, findings: doc.findings, where: q.repo, sentTo: { projectId: q.project } }, pkgRec };
  }

  // Key-sorted JSON, so the same profile always serializes to the same bytes (no needless commits).
  const canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => (a[x] = v[x], a), {}) : v, 1);

  // ---- team fab profiles: <dataPath>fabcheck/profiles/<id>.json in the FTE data repo ----
  function dataRepo() {
    const s = load('settings', {}) || {};
    const owner = s.owner || ((window.SIGNOFF_CONFIG || {}).repos || {}).owner || 'chrismessick-dpd';
    const repo = owner + '/' + (s.dataRepo || 'ee_design_review_data');
    const dataPath = s.dataPath ? s.dataPath.replace(/\/+$/, '') + '/' : '';
    return { repo, dir: dataPath + 'fabcheck/profiles/', branch: s.branch || 'main' };
  }

  // Pull the team's profiles, merge them per rule into this browser's, and push what is newer here.
  // Resolves { state: 'shared' | 'local' | 'error', text }.
  let syncing = null;
  function syncProfiles() {
    if (syncing) return syncing;
    syncing = (async () => {
      if (!window.Signoff || !window.Signoff.GitHubStore) return { state: 'local', text: 'Kept in this browser only: the GitHub engine did not load.' };
      if (!token()) return { state: 'local', text: 'Kept in this browser only: no GitHub token in Signoff EE, so profiles are not shared with the team.' };
      if (!(window.crypto && crypto.subtle)) return { state: 'local', text: 'Kept in this browser only: sharing needs a page served over http://localhost or https.' };
      const d = dataRepo();
      try {
        const store = storeFor(d.repo, d.branch);
        const entries = (await store.listTree(d.dir)).filter(e => /\.json$/.test(e.path));
        const td = new TextDecoder(), remote = {};
        for (const e of entries) {
          try { const p = JSON.parse(td.decode(await store.blobBytes(e.sha))); if (p && p.id) remote[p.id] = p; } catch (err) { /* skip unreadable */ }
        }
        Fab.rules.mergeIn(Object.values(remote));
        const mine = Fab.rules.all();
        const files = Object.values(mine).filter(p => !remote[p.id] || canon(p) !== canon(remote[p.id]))
          .map(p => ({ path: d.dir + p.id + '.json', text: canon(p) }));
        let pushed = 0;
        if (files.length) pushed = (await store.putFiles(files, { message: `Fabcheck: update ${files.length} fab profile(s)` })).pushed;
        const n = Object.values(mine).filter(p => !(p.deleted && p.deleted.v)).length;
        return { state: 'shared', text: `Shared with the team in ${d.repo}: ${n} custom profile(s)${pushed ? `, ${pushed} updated just now` : ''}.` };
      } catch (err) {
        const why = err.status === 404 || err.status === 403 ? `this token can't write to ${d.repo}` : (err.message || String(err));
        return { state: 'error', text: `Kept in this browser only: ${why}.` };
      }
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // Whether this browser's token is an FTE's, as Signoff EE last found at sync: EE records the
  // token's fingerprint and whether that token could open its data repo. No request is made.
  function isFte() {
    const t = token(), M = window.Signoff && window.Signoff.model;
    if (!t || !M || !M.tokenTag) return false;
    return (load('settings', {}) || {}).tokenTag === M.tokenTag(t) && load('dataAccess', '') === 'ok';
  }

  Fab.repoRuns = Fab.DEMO ? null : { home, upload, fetchRun, markStored, dataRepo, syncProfiles, isFte, setFetch: f => { fetchImpl = f; } };
})(window.Fab);
