// Fabcheck's side of storing runs with a Signoff project (docs/signoff-revisions.md): sign in, check
// write access, and store a sent run (record, findings, the fab package zip, board pictures) in the
// project's home repository. Fabcheck only writes here; Signoff reads runs and packages back and hands
// a run to Fabcheck in the browser (Fab.store.takeHandoff).
//
//   <dataPath>fabcheck/<projectId>/runs/<runId>.json                { run, findings }
//   <dataPath>fabcheck/<projectId>/packages/<key>/<root>.zip        the fab package
//   <dataPath>fabcheck/<projectId>/preview/…                        board pictures
//
// Writes go through the Signoff engine's GitHubStore.putFiles (assets/vendor/github.js), which skips
// files already there, so re-sending a package uploads nothing new. Team fab profiles
// (syncProfiles) are the one read left; they move to Signoff later.
(function (Fab) {
  'use strict';
  const NS = 'signoff.v1.';
  const load = (k, d) => { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const token = () => { try { return sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''; } catch (e) { return ''; } };
  let fetchImpl = null; // tests inject a fake GitHub here

  // Sign in the way Signoff EE does (its setToken): one key, in this tab only or remembered, so a
  // token set in either tool works in both. Resolves the GitHub login, or throws.
  const cleanToken = t => String(t || '').replace(/[\s​-‍⁠﻿]/g, '');
  async function signIn(t, remember) {
    t = cleanToken(t);
    if (!t) throw new Error('paste a token first');
    const me = await new window.Signoff.GitHubAccount(t, fetchImpl || undefined).user();
    try {
      sessionStorage.removeItem('signoff.token'); localStorage.removeItem('signoff.token');
      (remember ? localStorage : sessionStorage).setItem('signoff.token', t);
    } catch (e) { /* storage blocked */ }
    probes.clear();
    return me && me.login;
  }
  function signOut() {
    try { sessionStorage.removeItem('signoff.token'); localStorage.removeItem('signoff.token'); } catch (e) { /* storage blocked */ }
    probes.clear();
  }

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

  // Whether a run sent to this project can be stored, from this browser alone: where it would go,
  // or why it can't. `probe` then asks GitHub whether this token can write there.
  function readiness(projectId) {
    const h = home(projectId);
    if (!window.Signoff || !window.Signoff.GitHubStore) return { ok: false, repo: h.repo, text: 'the GitHub engine did not load' };
    if (!token()) return { ok: false, repo: h.repo, signIn: true, text: 'you are not signed in to GitHub in this tab. Send asks you to sign in' };
    if (!(window.crypto && crypto.subtle)) return { ok: false, repo: h.repo, text: 'storing needs a secure page (http://localhost or https), not a file opened from disk' };
    return { ok: true, repo: h.repo };
  }
  const probes = new Map();
  function probe(projectId) {
    const r = readiness(projectId);
    if (!r.ok) return Promise.resolve(r);
    const M = window.Signoff.model;
    const key = r.repo + ' ' + (M && M.tokenTag ? M.tokenTag(token()) : token().length);
    if (!probes.has(key)) {
      probes.set(key, storeFor(r.repo).api('').then(info => info && info.permissions && info.permissions.push === false
        ? { ok: false, repo: r.repo, text: `this token can read ${r.repo} but not write to it` } : r,
      err => {
        if (!(err.status === 401 || err.status === 404 || err.status === 403)) probes.delete(key); // ask again next time
        return { ok: false, repo: r.repo, text: err.status === 401 ? 'GitHub rejected the token (expired or revoked?); set a new one in Signoff EE\'s Settings'
          : err.status === 404 || err.status === 403 ? `this token can't open ${r.repo}` : `GitHub didn't answer (${err.message || err})` };
      }));
    }
    return probes.get(key);
  }

  // Store a run with the project when it's sent: the run record and findings, the fab package as one
  // zip, and the board pictures, in one commit, before Send writes the issues, so they carry where
  // the run is. Fabcheck only writes here: Signoff reads runs and packages back
  // (docs/signoff-revisions.md). pkg: Fab.releases.packageFor's { name, bytes, sha256, root, files }.
  // Never throws. Resolves { ok: true, stored, run, res } or { ok: false, why }.
  // progress(text, fraction), optional, drives Send's progress card.
  async function store(entry, projectId, pkg, log, progress) {
    progress = progress || (() => {});
    const run = entry.run;
    if (!run) return { ok: false, why: 'the run was not kept in this browser' };
    const ready = readiness(projectId);
    if (!ready.ok) { log('warn', `Not stored: ${ready.text}.`); return { ok: false, why: ready.text }; }
    const h = home(projectId);
    const stored = { repo: h.repo, dir: h.dir };
    const zipPath = h.dir + 'packages/' + run.package.key + '/' + pkg.name;
    const zip = { path: zipPath, name: pkg.name, sha256: pkg.sha256, size: pkg.bytes.length, root: pkg.root, files: pkg.files };
    const runRec = Object.assign({}, run, { stored, package: Object.assign({}, run.package, { zip }) });
    const kept = await Fab.store.getRun(run.id);
    const files = [
      { path: zipPath, bytes: pkg.bytes },
      { path: h.dir + 'runs/' + run.id + '.json', text: json({ run: runRec, findings: (kept && kept.findings) || Fab.store.compactFindings(entry.findings) }) },
    ];
    // The board's pictures, for Signoff EE's overview and Signoff PL's tiles.
    const shots = Fab.boardPreviews ? await Fab.boardPreviews(entry).catch(() => []) : [];
    if (shots.length) {
      const images = shots.map(s => {
        const file = s.key + (s.type === 'image/webp' ? '.webp' : '.png');
        files.push({ path: h.dir + 'preview/' + file, bytes: s.bytes });
        return { key: s.key, file, type: s.type, w: s.w, h: s.h };
      });
      // The board's size, so Signoff PL can draw it to scale in its 3D view: the outline's extent
      // in mm, and the run's board thickness.
      const bb = entry.pkg && entry.pkg.boardBBox, t = Number(run.settings && run.settings.thickness);
      const board = bb && Fab.bbox.valid(bb) ? { w: +(bb[2] - bb[0]).toFixed(3), h: +(bb[3] - bb[1]).toFixed(3), t: t > 0 ? t : 1.6 } : undefined;
      files.push({ path: h.dir + 'preview/index.json', text: json({ v: 1, tool: 'fabcheck', runId: run.id, at: run.at || '', hero: images[0].key, images, board }) });
    }
    const bytes = files.reduce((n, f) => n + (f.bytes ? f.bytes.length : f.text.length), 0);
    progress(`Uploading to ${h.repo} (${(bytes / 1048576).toFixed(1)} MB)…`, 0.3);
    log('step', `Storing run ${run.id} in ${h.repo}/${h.dir}`);
    log('dim', `         ${pkg.name} and ${files.length - 1} more files (${(bytes / 1048576).toFixed(2)} MB); files already there are skipped`);
    try {
      let last = 0;
      const res = await storeFor(h.repo, h.branch).putFiles(files, {
        message: `Fabcheck: store run ${run.id} (${run.package.name})`,
        onProgress: (done, total) => { progress(`Uploading to ${h.repo}: ${done} of ${total} new files…`, 0.3 + 0.6 * (total ? done / total : 1)); if (done === total || done - last >= Math.max(1, Math.ceil(total / 5))) { last = done; log('dim', `         uploaded ${done} of ${total} new files`); } },
        onRetry: n => progress(`Someone else pushed first; retrying (${n})…`) || log('dim', `         someone else pushed first; retrying (${n})`),
      });
      log('ok', res.pushed ? `Stored in ${h.repo}: ${res.pushed} file(s) written, ${res.skipped} already there${res.commitUrl ? ' · ' + res.commitUrl : ''}` : `Already stored in ${h.repo}: all ${res.skipped} files were there; nothing uploaded`);
      entry.run = runRec;
      await Fab.store.updateRun(run.id, { run: runRec });
      return { ok: true, stored, run: runRec, res };
    } catch (err) {
      const why = err.status === 404 || err.status === 403 ? `this token can't write to ${h.repo}` : (err.message || String(err));
      log('warn', `Not stored in ${h.repo}: ${why}.`);
      return { ok: false, why };
    }
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

  Fab.repoRuns = Fab.DEMO ? null : { signIn, signOut, signedIn: () => !!token(), home, readiness, probe, store, dataRepo, syncProfiles, isFte, setFetch: f => { fetchImpl = f; } };
})(window.Fab);
