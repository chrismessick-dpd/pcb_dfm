// Stage 2 of the Fabcheck ↔ Signoff EE link (ee_design_review/docs/fabcheck-link.md): store a run in
// the project's home repository when it is sent, and read runs back from there for deep links.
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

  // Whether a run sent to this project can be stored, from this browser alone: where it would go,
  // or why it can't. `probe` then asks GitHub whether this token can write there.
  function readiness(projectId) {
    const h = home(projectId);
    if (!window.Signoff || !window.Signoff.GitHubStore) return { ok: false, repo: h.repo, text: 'the GitHub engine did not load' };
    if (!token()) return { ok: false, repo: h.repo, text: 'there is no GitHub token in this tab. Signoff EE keeps its token in its own tab unless "Remember the token" is ticked in its Settings: tick it there, or open Fabcheck from Signoff EE' };
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

  // Store a run and its package in the project's home repo: done before Send writes the issues, so
  // they carry where it is (and again from "Store in project" for a run sent without it). Never
  // throws. Resolves { ok: true, stored, res } or { ok: false, why }.
  // opts.extra: more files for the same commit (a release's); opts.previews false keeps the board
  // pictures as they are (an older release mustn't replace the latest board's); opts.message.
  async function upload(entry, projectId, log, opts) {
    opts = opts || {};
    const run = entry.run, pkgRec = entry.pkgRec;
    if (!run || !pkgRec) return { ok: false, why: 'the run was not kept in this browser' };
    const ready = readiness(projectId);
    if (!ready.ok) { log('warn', `Not stored: ${ready.text}.`); return { ok: false, why: ready.text }; }
    const h = home(projectId);
    const stored = { repo: h.repo, dir: h.dir };
    const runRec = Object.assign({}, run, { stored });
    const pdir = h.dir + 'packages/' + pkgRec.key + '/';
    const files = pkgRec.files.map(f => ({ path: pdir + 'files/' + f.path, bytes: f.bytes }));
    files.push({ path: pdir + 'manifest.json', text: json(pkgRec.manifest) });
    const stored1 = await Fab.store.getRun(run.id);
    files.push({ path: h.dir + 'runs/' + run.id + '.json', text: json({ run: runRec, findings: (stored1 && stored1.findings) || Fab.store.compactFindings(entry.findings) }) });
    // The latest run's board pictures, for Signoff PL. Only a run open in this tab has the parsed
    // board to draw, so "Store in project" for a kept run leaves the previews as they were.
    const shots = opts.previews !== false && Fab.boardPreviews ? await Fab.boardPreviews(entry).catch(() => []) : [];
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
    for (const f of opts.extra || []) files.push(f);
    const bytes = files.reduce((n, f) => n + (f.bytes ? f.bytes.length : f.text.length), 0);
    log('step', `Storing run ${run.id} in ${h.repo}/${h.dir}`);
    log('dim', `         ${files.length} files (${(bytes / 1048576).toFixed(2)} MB before compression); files already there are skipped`);
    try {
      let last = 0;
      const res = await storeFor(h.repo, h.branch).putFiles(files, {
        message: opts.message || `Fabcheck: store run ${run.id} (${pkgRec.name})`,
        onProgress: (done, total) => { if (done === total || done - last >= Math.max(1, Math.ceil(total / 5))) { last = done; log('dim', `         uploaded ${done} of ${total} new files`); } },
        onRetry: n => log('dim', `         someone else pushed first; retrying (${n})`),
      });
      log('ok', res.pushed ? `Stored in ${h.repo}: ${res.pushed} file(s) written, ${res.skipped} already there${res.commitUrl ? ' · ' + res.commitUrl : ''}` : `Already stored in ${h.repo}: all ${res.skipped} files were there; nothing uploaded`);
      entry.run = runRec;
      await Fab.store.updateRun(run.id, { run: runRec });
      markStored(run.id, stored, projectId);
      return { ok: true, stored, res };
    } catch (err) {
      const why = err.status === 404 || err.status === 403 ? `this token can't write to ${h.repo}` : (err.message || String(err));
      log('warn', `Not stored in ${h.repo}: ${why}.`);
      return { ok: false, why };
    }
  }

  // "Store in project" for a kept run that was sent without being stored.
  async function storeKept(runId, log) {
    const kept = await Fab.store.getRun(runId);
    const pkgRec = kept && await Fab.store.getPackage(kept.run.package.key);
    if (!kept || !pkgRec) return { ok: false, why: 'that run is no longer in this browser' };
    if (!kept.sentTo || !kept.sentTo.projectId) return { ok: false, why: 'that run was never sent to a Signoff EE project' };
    return upload({ run: kept.run, pkgRec, findings: [] }, kept.sentTo.projectId, log);
  }

  // ---- fab releases (docs/releases.md) ----
  //   <dir>releases/<id>.json                       the release record (without local fields)
  //   <dir>packages/<key>/files/<path>              its files, beside the run's slimmed package
  const LOCAL = ['syncedAt'];
  const forRepo = rec => { const o = Object.assign({}, rec); for (const k of LOCAL) delete o[k]; return o; };
  const HEX = /^[0-9a-f]{64}$/;
  // A release record read from a repo that contractors can write to: the shape Fabcheck relies on,
  // or null. Text is escaped where it's shown.
  function cleanRelease(r) {
    if (!r || typeof r !== 'object' || !/^l[a-z0-9]+$/.test(r.id) || typeof r.label !== 'string') return null;
    if (!r.package || !HEX.test(r.package.sha256 || '') || !/^[0-9a-f]{16}$/.test(r.package.key || '')) return null;
    // File paths become entry names in a zip that goes to a fab house: relative, forward slashes only.
    const okPath = p => typeof p === 'string' && p && !/(^|\/)\.\.(\/|$)|^[\/\\]|\\|:/.test(p);
    if (!Array.isArray(r.files) || !r.files.every(f => f && okPath(f.path) && HEX.test(f.sha256 || ''))) return null;
    if (!r.download || !HEX.test(r.download.sha256 || '') || !/^\d{4}-\d{2}-\d{2}$/.test(r.download.date || '')) return null;
    const str = v => typeof v === 'string' ? v : '';
    const num = v => +v || 0;
    const cnt = v => v == null ? null : num(v);
    const c = r.changes && typeof r.changes === 'object' ? r.changes : null;
    const changes = c && {
      base: /^l[a-z0-9]+$/.test(c.base || '') ? c.base : null,
      layers: Array.isArray(c.layers) ? c.layers.filter(l => l && typeof l.layer === 'string').map(l => ({ layer: l.layer, status: str(l.status), added: num(l.added), removed: num(l.removed) })) : null,
      bom: cnt(c.bom), placements: cnt(c.placements), drill: cnt(c.drill),
      findings: c.findings && typeof c.findings === 'object' ? { fixed: num(c.findings.fixed), new: num(c.findings.new), same: num(c.findings.same) } : undefined,
    };
    // R5 layout: archive names are paths in a zip too, and each archive has a hash; else dropped.
    const L = r.layout && typeof r.layout === 'object' ? r.layout : null;
    const paths = new Set(r.files.map(f => f.path));
    const arch = a => a && typeof a === 'object' && HEX.test(a.sha256 || '') && /^[\w.+-]+\.zip$/.test(a.name || '') ? { name: a.name, sha256: a.sha256, size: num(a.size) } : null;
    const layout = L && Array.isArray(L.files) && typeof L.pre === 'string' && /^[\w.+-]*$/.test(L.pre) && L.readme && typeof L.readme === 'object' && arch(L.fab) &&
      L.files.every(f => f && paths.has(f.path) && (f.fab == null || okPath(f.fab)) && (f.assy == null || okPath(f.assy)))
      ? { v: 1, pn: str(L.pn), rev: str(L.rev), pre: L.pre, files: L.files.map(f => ({ path: f.path, fab: f.fab || undefined, assy: f.assy || undefined })),
        readme: { fab: str(L.readme.fab), assy: str(L.readme.assy) }, fab: arch(L.fab), assy: arch(L.assy) || undefined } : null;
    const s = r.summary && typeof r.summary === 'object' ? { error: num(r.summary.error), warn: num(r.summary.warn), info: num(r.summary.info) } : null;
    return Object.assign({}, r, {
      package: { key: r.package.key, sha256: r.package.sha256, name: str(r.package.name) || 'package', size: num(r.package.size) },
      changes, summary: s, layout, project: undefined, stored: undefined,
      title: str(r.title), notes: str(r.notes), by: str(r.by), updatedBy: str(r.updatedBy), at: str(r.at), updatedAt: str(r.updatedAt) || str(r.at),
      status: ['candidate', 'sent', 'built', 'withdrawn'].includes(r.status) ? r.status : 'sent',
      fab: { house: str((r.fab || {}).house), sentAt: str((r.fab || {}).sentAt), ref: str((r.fab || {}).ref) },
      supersedes: /^l[a-z0-9]+$/.test(r.supersedes || '') ? r.supersedes : null,
      run: /^r[a-z0-9]+$/.test(r.run || '') ? r.run : null,
      files: r.files.map(f => ({ path: f.path, size: +f.size || 0, sha256: f.sha256 })),
      download: { name: str(r.download.name).replace(/[\\/]/g, '_') || 'release.zip', sha256: r.download.sha256, size: +r.download.size || 0, date: r.download.date },
    });
  }

  async function write(h, files, message, log) {
    try {
      const res = await storeFor(h.repo, h.branch).putFiles(files, { message, onRetry: n => log('dim', `         someone else pushed first; retrying (${n})`) });
      log('ok', res.pushed ? `Stored in ${h.repo}: ${res.pushed} file(s) written, ${res.skipped} already there${res.commitUrl ? ' · ' + res.commitUrl : ''}` : `Already stored in ${h.repo}`);
      return { ok: true, res };
    } catch (err) {
      const why = err.status === 404 || err.status === 403 ? `this token can't write to ${h.repo}` : (err.message || String(err));
      log('warn', `Not stored in ${h.repo}: ${why}.`);
      return { ok: false, why };
    }
  }

  // Store a release with the project: its files, its record, and its run (with the run's slimmed
  // package) when this browser still has it. The board pictures stay as they are: this may be an
  // older release being back-filled. Never throws.
  async function storeRelease(rec, projectId, log) {
    const ready = readiness(projectId);
    if (!ready.ok) return { ok: false, why: ready.text };
    const h = home(projectId);
    const stored = { repo: h.repo, dir: h.dir };
    const out = Object.assign({}, rec, { project: projectId, stored });
    const pdir = h.dir + 'packages/' + rec.package.key + '/files/';
    const extra = [];
    for (const f of rec.files) {
      const b = await Fab.store.getBlob(f.sha256);
      if (!b) return { ok: false, why: `${f.path} is not in this browser` };
      extra.push({ path: pdir + f.path, bytes: b });
    }
    extra.push({ path: h.dir + 'releases/' + rec.id + '.json', text: json(forRepo(out)) });
    const message = `Fabcheck: store release ${rec.label} (${rec.package.name})`;
    const kept = rec.run && await Fab.store.getRun(rec.run);
    const pkgRec = kept && await Fab.store.getPackage(kept.run.package.key);
    const got = kept && pkgRec ? await upload({ run: kept.run, pkgRec, findings: [] }, projectId, log, { extra, previews: false, message })
      : await write(h, extra, message, log);
    if (!got.ok) return got;
    const local = Object.assign(out, { syncedAt: out.updatedAt });
    await Fab.store.saveRelease(local);
    return { ok: true, stored, rec: local };
  }

  // Save an edit (status, notes) of a stored release. If the repo's copy changed since this browser
  // last read it, nothing is written and the repo's copy comes back to take instead.
  async function saveReleaseEdit(rec, log) {
    if (!rec.stored || !rec.project) return { ok: false, why: 'not stored with a project' };
    const ready = readiness(rec.project);
    if (!ready.ok) return { ok: false, why: ready.text };
    const h = home(rec.project);
    try {
      const raw = await storeFor(h.repo, h.branch).readBytes(h.dir + 'releases/' + rec.id + '.json');
      const remote = raw && cleanRelease(JSON.parse(new TextDecoder().decode(raw)));
      if (remote && remote.updatedAt && rec.syncedAt && remote.updatedAt > rec.syncedAt) {
        return { ok: false, conflict: Object.assign(remote, { project: rec.project, stored: { repo: h.repo, dir: h.dir }, syncedAt: remote.updatedAt }) };
      }
    } catch (err) { return { ok: false, why: err.message || String(err) }; }
    const got = await write(h, [{ path: h.dir + 'releases/' + rec.id + '.json', text: json(forRepo(rec)) }], `Fabcheck: ${rec.label} is ${rec.status}`, log || (() => {}));
    if (!got.ok) return got;
    rec.syncedAt = rec.updatedAt;
    await Fab.store.saveRelease(rec);
    return { ok: true, rec };
  }

  // Read the project's releases into this browser: records only, files come when downloaded. A
  // record newer in the repo replaces this browser's. Resolves { repo, releases }.
  async function pullReleases(projectId) {
    const ready = readiness(projectId);
    if (!ready.ok) throw new Error(ready.text);
    const h = home(projectId);
    const store = storeFor(h.repo, h.branch);
    const entries = (await store.listTree(h.dir + 'releases/')).filter(e => /\/l[a-z0-9]+\.json$/.test(e.path));
    const td = new TextDecoder(), out = [];
    for (const e of entries) {
      let r = null;
      try { r = cleanRelease(JSON.parse(td.decode(await store.blobBytes(e.sha)))); } catch (err) { /* skip unreadable */ }
      if (!r) continue;
      const local = await Fab.store.getRelease(r.id);
      if (local && (local.updatedAt || '') >= (r.updatedAt || '')) { out.push(local); continue; }
      const rec = Object.assign(r, { project: projectId, stored: { repo: h.repo, dir: h.dir }, syncedAt: r.updatedAt });
      await Fab.store.saveRelease(rec);
      out.push(rec);
    }
    return { repo: h.repo, releases: out };
  }

  // Bring a stored release's files into this browser from the project's repo, checking each against
  // its SHA-256. Resolves the number of files read.
  async function fetchReleaseFiles(rec, log) {
    if (!rec.project) throw new Error('that release is not stored with a project');
    const ready = readiness(rec.project);
    if (!ready.ok) throw new Error(ready.text);
    const h = home(rec.project);
    const store = storeFor(h.repo, h.branch);
    const pdir = h.dir + 'packages/' + rec.package.key + '/files/';
    const entries = await store.listTree(pdir);
    const blobs = [];
    for (const f of rec.files) {
      if (await Fab.store.getBlob(f.sha256)) continue;
      const b = await store.readBytes(pdir + f.path, entries);
      if (!b) throw new Error(`${f.path} is missing from ${h.repo}`);
      if (await Fab.archive.sha256(b) !== f.sha256) throw new Error(`${f.path} in ${h.repo} doesn't match its recorded SHA-256`);
      blobs.push({ sha256: f.sha256, bytes: b });
    }
    if (blobs.length) {
      await Fab.store.saveRelease((await Fab.store.getRelease(rec.id)) || rec, blobs);
      if (log) log('ok', `Read ${blobs.length} file(s) of ${rec.label} from ${h.repo}`);
    }
    return blobs.length;
  }

  // The runs stored for a project, newest first: run records only, read from its home repo.
  async function listRuns(projectId) {
    const h = home(projectId), ready = readiness(projectId);
    if (!ready.ok) throw new Error(ready.text);
    const store = storeFor(h.repo, h.branch);
    const entries = (await store.listTree(h.dir + 'runs/')).filter(e => /\/r[a-z0-9]+\.json$/.test(e.path));
    const td = new TextDecoder(), out = [];
    for (const e of entries) {
      try {
        const run = JSON.parse(td.decode(await store.blobBytes(e.sha))).run;
        if (run && /^r[a-z0-9]+$/.test(run.id) && run.package) out.push(run);
      } catch (err) { /* skip unreadable */ }
    }
    return { repo: h.repo, runs: out.sort((a, b) => String(b.at).localeCompare(String(a.at))) };
  }

  // Put `stored` on the run record of the project's Signoff issues that carry this run, so others can
  // open it. Only that project: the same run sent to another project is stored apart from it.
  function markStored(runId, stored, projectId) {
    const all = load('projects', {});
    const dirty = load('dirty', {});
    const who = ((load('settings', {}) || {}).user) || 'Fabcheck';
    const t = new Date().toISOString();
    let changed = false;
    for (const p of Object.values(all)) for (const [id, c] of Object.entries(p.custom || {})) {
      if (projectId && p.id !== projectId) continue;
      if (!c.source || !c.source.run || c.source.run.id !== runId || (c.source.run.stored && c.source.run.stored.repo === stored.repo)) continue;
      p.custom[id] = Object.assign({}, c, { source: Object.assign({}, c.source, { run: Object.assign({}, c.source.run, { stored }) }), updatedAt: t, updatedBy: who });
      dirty[p.id] = t;
      changed = true;
    }
    if (changed) { localStorage.setItem(NS + 'projects', JSON.stringify(all)); localStorage.setItem(NS + 'dirty', JSON.stringify(dirty)); }
  }

  // A run from the repo named in a deep link, cached in IndexedDB. Resolves {stored, pkgRec} or null.
  async function fetchRun(q, log) {
    if (!window.Signoff || !window.Signoff.GitHubStore || !q.repo || !q.project || !trusted(q.repo, q.project)) return null;
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
  // Repos a deep link may read a run from: the project's home, or this suite's own EE data and
  // shared review repos (same owner, EE's prefix). A link can name any repo, and a repo outside
  // the account could hand Fabcheck anything; one inside it is still only data (see cleanFinding).
  function trusted(repo, projectId) {
    const s = load('settings', {}) || {};
    const r = String(repo || '').toLowerCase(), parts = r.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    if (projectId && r === home(projectId).repo.toLowerCase()) return true;
    const owner = (s.owner || ((window.SIGNOFF_CONFIG || {}).repos || {}).owner || 'chrismessick-dpd').toLowerCase();
    const prefix = (s.prefix || 'review-ee-').toLowerCase();
    return parts[0] === owner && (parts[1] === (s.dataRepo || 'ee_design_review_data').toLowerCase() || parts[1].indexOf(prefix) === 0);
  }

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

  Fab.repoRuns = Fab.DEMO ? null : { home, trusted, readiness, probe, upload, storeKept, storeRelease, saveReleaseEdit, pullReleases, fetchReleaseFiles, cleanRelease, listRuns, fetchRun, markStored, dataRepo, syncProfiles, isFte, setFetch: f => { fetchImpl = f; } };
})(window.Fab);
