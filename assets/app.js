/* Fabcheck app: packages, the check pipeline with its live console, and the views. */
(function (Fab) {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = Fab.esc;
  const C = Fab.checks;

  const ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    pkg: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/></svg>',
    chev: '<svg class="sec-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>',
  };

  const VIEWS = [
    ['overview', 'Overview'], ['findings', 'Findings'], ['board', 'Board'], ['assembly', 'Assembly'],
    ['bom', 'BOM'], ['files', 'Files'], ['revisions', 'Revisions'], ['archive', 'Archive'], ['rules', 'Fab rules'],
  ];
  const CATS = [
    ['Package', 'Package', 'Files, layer sets, units, drill report and outline'],
    ['Assembly', 'Build & assembly', 'Pick-and-place, BOM, ODB++, variant and stencil'],
    ['BOM', 'BOM audit', 'Part numbers, descriptions, manufacturers and lifecycle'],
    ['DFM', 'Fabrication DFM', 'Traces, drills, rings, edge, mask and silkscreen'],
    // Shown for flex packages (coverlay or stiffener layers).
    ['Flex', 'Flex', 'Coverlay openings, stiffeners and the flexible area'],
    // Placed on the board by a reviewer (the note button on the board), not found by a check.
    ['Review', 'Review notes', 'Notes placed on the board by reviewers'],
  ];
  const COLORS = {
    copper: { top: '#e8a33d', bottom: '#4f8ff7', inner: ['#30c48d', '#c46ee0', '#e0d24f', '#5ad1e6', '#ef7a7a', '#9fa8ff'] },
    mask: { top: '#3fd18b', bottom: '#59a6ff' }, silk: { top: '#f5f5f7', bottom: '#ffd60a' },
    paste: { top: '#b8b8be', bottom: '#8e8e96' }, other: '#8e8e93',
    coverlay: { top: '#d4a72c', bottom: '#b58cff' }, stiffener: '#9aa4ad',
  };

  const state = {
    pkgs: [], active: null, view: 'overview', filter: { error: true, warn: true, info: false }, cat: null, check: null, q: '',
    closed: new Set(), tpOpen: new Set(), sel: null, showPnp: true,
    waivedOpen: false, wvForm: null, // the Waived fold on Findings; the finding whose waive form is open
    sim: null, // the Waive similar panel's working state
    placing: false, draft: null, // review notes: waiting for a click on the board; the note being written
    profile: 'standard', thickness: 1.6,
    repoProbe: new Map(), // per Signoff project id: write access to its repo
    baseCache: new Map(), // Revisions baselines read from kept runs, by key
  };
  let seq = 0;
  let viewer = null;
  const active = () => state.pkgs.find(p => p.id === state.active) || null;

  // ── Theme: shared with Signoff (same key), so both tools switch together ──
  // The light/dark theme is the suite's, under one fixed key in the demo too (Chris, 2026-11-08: the
  // demo tour flipped between light and dark as it moved between tools that kept it apart).
  const SETTINGS_KEY = 'signoff.v1.settings';
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function readTheme() { try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}).theme || 'auto'; } catch (e) { return 'auto'; } }
  function writeTheme(t) {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; s.theme = t; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  const isDark = t => t === 'dark' || (t !== 'light' && !!(darkQuery && darkQuery.matches));
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#theme-btn');
    if (b) { b.innerHTML = isDark(t) ? ICON.sun : ICON.moon; b.title = isDark(t) ? 'Light mode' : 'Dark mode'; }
    if (viewer) viewer.draw();
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(readTheme()));
  window.addEventListener('storage', e => { if (e.key === SETTINGS_KEY) applyTheme(readTheme()); });

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 3200);
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const tick = () => new Promise(r => { let done = false; requestAnimationFrame(() => { done = true; r(); }); setTimeout(() => { if (!done) r(); }, 40); });
  // Rules for a run: a run being reopened or reproduced uses its own saved copy (entry.pinned); otherwise
  // the selected profile, with the board thickness set for the run.
  const profile = entry => {
    if (entry && entry.pinned) return Object.assign({}, entry.pinned.rules, { thickness: entry.pinned.thickness || entry.pinned.rules.thickness });
    const r = Fab.rules.resolve(state.profile) || Fab.rules.resolve('standard');
    return Object.assign({}, r.values, { thickness: state.thickness });
  };
  const isFlexProfile = id => { const r = Fab.rules.resolve(id); return !!r && r.base === 'flex'; };
  const profileName = entry => entry && entry.pinned ? entry.pinned.name : (Fab.rules.resolve(state.profile) || Fab.rules.resolve('standard')).name;
  const runProfileName = settings => settings.profileName || (Fab.profiles[settings.profile] || {}).label || settings.profile;
  // Pin a run's saved rules; note when the profile it came from has been edited since.
  function pinRun(entry, settings) {
    const rules = Fab.rules.rulesOfRun(settings);
    entry.pinned = { id: settings.profile, name: runProfileName(settings), rules, thickness: settings.thickness };
    const cur = Fab.rules.resolve(settings.profile);
    entry.pinned.editedSince = !!(settings.rules && cur && Fab.rules.RULES.some(r => r.key !== 'thickness' && r.key in settings.rules && cur.values[r.key] !== rules[r.key]));
    entry.pinned.missing = !cur;
    entry.pinned.added = Fab.rules.newSince(settings);
    state.thickness = settings.thickness || rules.thickness;
  }
  // Rules added to Fabcheck after the run was made: their checks didn't exist then.
  function logAdded(entry) {
    const a = entry.pinned && entry.pinned.added;
    if (!a || !a.length) return;
    const base = (Fab.rules.BUILTIN[entry.pinned.id] || Fab.rules.BUILTIN.standard).label;
    log(entry, 'dim', `         ${a.length} rule(s) were added to Fabcheck after this run (${a.map(r => r.name.toLowerCase()).join(', ')}). Their checks didn't exist then; a re-run uses the ${base} defaults for them.`);
  }
  const baseName = s => String(s).replace(/\.(zip|tgz)$/i, '');

  // ── Sidebar ──
  // Slides over the page on narrow windows; on wide ones it collapses away until opened again.
  const SIDE_KEY = 'fabcheck.ui.sideCollapsed';
  const narrow = window.matchMedia ? window.matchMedia('(max-width: 860px)') : { matches: false };
  function toggleSidebar() {
    if (narrow.matches) { $('#app').classList.toggle('nav-open'); return; }
    const on = !$('#app').classList.contains('side-collapsed');
    $('#app').classList.toggle('side-collapsed', on);
    try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  // On a narrow window a tap outside the open menu (on its scrim, suite.css) closes it and goes
  // no further, as in Signoff EE and Loom.
  document.addEventListener('click', e => {
    const app = $('#app');
    if (!app.classList.contains('nav-open') || e.target !== app) return; // the scrim is #app's ::after
    app.classList.remove('nav-open'); e.preventDefault(); e.stopPropagation();
  }, true);

  // The board's layers panel: its width (dragged from the board's left edge) and whether it is
  // folded to a strip, remembered in this browser. layersUi(set) saves set, then applies the result.
  const LAYERS_KEY = 'fabcheck.ui.layers', LAY_MIN = 160, LAY_MAX = 480;
  function layersUi(set) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}') || {}; } catch (e) { /* storage blocked */ }
    if (set) { s = Object.assign(s, set); try { localStorage.setItem(LAYERS_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }
    const bv = $('#board-view');
    bv.classList.toggle('layers-collapsed', !!s.folded);
    if (s.w) bv.style.setProperty('--lay-w', s.w + 'px'); else bv.style.removeProperty('--lay-w');
    return s;
  }
  function bindLayersResize() {
    const grip = $('#lay-resize'), bv = $('#board-view');
    const setW = w => { w = Math.round(Math.max(LAY_MIN, Math.min(LAY_MAX, w))); bv.style.setProperty('--lay-w', w + 'px'); return w; };
    grip.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      bv.classList.add('resizing');
      const left = bv.getBoundingClientRect().left;
      let w = 0;
      const move = m => { w = setW(m.clientX - left); };
      const end = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        bv.classList.remove('resizing');
        if (w) layersUi({ w });
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    });
    grip.addEventListener('dblclick', () => layersUi({ w: 0 }));
    grip.addEventListener('keydown', ev => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      layersUi({ w: setW($('#layers-pane').getBoundingClientRect().width + (ev.key === 'ArrowRight' ? 16 : -16)) });
    });
    layersUi();
  }

  // ── Console ──
  function log(entry, cls, text) {
    const line = { t: performance.now() - entry.t0, cls, text };
    entry.log.push(line);
    if (entry.id === state.active) {
      const body = $('#console-body');
      if (body) {
        const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
        body.insertAdjacentHTML('beforeend', lineHtml(line));
        if (stick) body.scrollTop = body.scrollHeight;
      }
      const last = $('#log-last');
      if (last && headline(line)) last.textContent = text;
    }
  }
  // Lines worth showing in the collapsed log: steps and results, not their detail lines.
  const headline = l => l.cls !== 'dim' && !/^\s|^…/.test(l.text);
  function lineHtml(l) { return `<div class="ln ${l.cls}"><span class="t">${(l.t / 1000).toFixed(2)}s</span><span class="x">${esc(l.text)}</span></div>`; }
  function setProgress(entry, p) {
    entry.progress = p;
    if (entry.id === state.active) {
      const bar = $('#console-progress');
      if (bar) bar.style.width = Math.round(p * 100) + '%';
      if (entry.live && Fab.stage) Fab.stage.progress(entry);
    }
  }

  function describe(f) {
    const c = f.cls;
    if (c.error) return ['err', `${f.path}: ${c.error}`];
    if (f.layer) return ['dim', `Gerber   ${f.name.padEnd(34)} ${[c.fn, c.side, c.fn === 'copper' && f.layer.physOrder ? 'L' + f.layer.physOrder : '', f.layer.polarity === 'negative' ? 'negative' : ''].filter(Boolean).join(' ')} · ${f.layer.prims.length} primitives · ${f.layer.x2 ? 'X2' : '274X'} ${f.layer.format || ''} ${f.layer.units || ''}`];
    if (f.drill) return ['dim', `Drill    ${f.name.padEnd(34)} ${f.drill.hits.length} hits, ${f.drill.slots.length} slots, ${Object.keys(f.drill.tools).length} tools · ${f.drill.units || '?'} ${f.drill.format || ''} ${f.drill.zeros || ''}`];
    if (f.pnp) return ['dim', `PnP      ${f.name.padEnd(34)} ${f.pnp.parts.length} placements · ${f.pnp.units}${f.pnp.meta.variant ? ' · variant ' + f.pnp.meta.variant : ''}`];
    if (f.bom) return ['dim', `BOM      ${f.name.padEnd(34)} ${f.bom.lines.length} lines · sheet "${f.bom.sheet}"`];
    if (f.drr) return ['dim', `Report   ${f.name.padEnd(34)} drill report, ${f.drr.length} tools`];
    return null;
  }

  // ── Pipeline: read → parse (per file) → checks (per step) ──
  // opts.stored: a kept run ({run, findings}) whose package files getFiles returns; its findings are shown
  //   as stored (the fast assembly step re-runs only to place parts).
  // opts.expect: a run record this upload should reproduce (fingerprint check, run's settings).
  // opts.link: deep-link parameters to apply when the package is ready.
  async function openPackage(getFiles, label, opts) {
    opts = opts || {};
    label = baseName(label);
    const entry = { id: 'p' + (++seq), label, status: 'loading', pkg: null, findings: [], log: [], t0: performance.now(), progress: 0, expect: opts.expect || null, link: opts.link || null };
    state.pkgs.push(entry);
    const prev = active();
    state.active = entry.id;
    if (prev && prev.status === 'ready' && !entry.baseline) entry.baseline = 'p:' + prev.id;
    go('overview');
    log(entry, 'step', `Opening ${label}`);
    await tick();
    try {
      const files = await getFiles();
      if (!files.length) throw new Error('No files were received. Try the Open button, or drop the .zip again.');
      if (files.unread && files.unread.length) log(entry, 'warn', `The browser could not read ${plural(files.unread.length, 'dropped file')}: ${files.unread.slice(0, 5).join(', ')}${files.unread.length > 5 ? ' …' : ''}`);
      const bytes = files.reduce((s, f) => s + f.size, 0);
      log(entry, 'ok', `Read ${plural(files.length, 'file')} (${(bytes / 1048576).toFixed(1)} MB)${files.source ? ' from ' + files.source.name : ''} in memory`);
      log(entry, 'step', 'Classifying and parsing');
      const kept = (opts.stored && opts.stored.run) || (opts.expect && opts.expect.run) || null;
      entry.outlinePick = (kept && kept.settings && kept.settings.outline) || null;
      const g = Fab.classify.buildSteps(files, { outline: entry.outlinePick });
      let r, i = 0, last = performance.now();
      const skipped = new Map();
      while (!(r = g.next()).done) {
        const f = r.value;
        i++;
        const d = describe(f);
        if (d) log(entry, d[0], d[1]);
        else skipped.set(f.cls.type, (skipped.get(f.cls.type) || 0) + 1);
        setProgress(entry, 0.3 * i / files.length);
        if (performance.now() - last > 30) { await tick(); last = performance.now(); }
      }
      const pkg = r.value;
      pkg.source = files.source;
      entry.pkg = pkg;
      entry.files = files;
      if (opts.pkgRec) entry.pkgRec = opts.pkgRec;
      if (skipped.size) log(entry, 'dim', `         + ${[...skipped].map(([t, n]) => `${n} ${t}`).join(', ')}`);
      const bb = pkg.boardBBox;
      log(entry, 'ok', `Using ${pkg.set.x2 ? 'Gerber X2' : 'RS-274X'} set "${pkg.set.dir}": ${pkg.layers.copper.length} copper layers` +
        (bb ? `, board ${Fab.fmtSize(bb[2] - bb[0], bb[3] - bb[1], 2)}` : '') +
        (pkg.odb ? `, ODB++ components ${pkg.odb.comps.length}` : ''));
      renderSidebar();
      if (opts.stored) restoreRun(entry, opts.stored);
      else {
        const settings = opts.expect && opts.expect.run.settings;
        if (settings) {
          pinRun(entry, settings);
          log(entry, 'dim', `Using the run's own rules: ${entry.pinned.name}, ${Fab.fmtLen(entry.pinned.thickness)}${settings.rules ? '' : ' (run made before rules were saved; using the built-in profile)'}`);
          logAdded(entry);
        } else {
          // Default to the profile last used for this package or this Signoff project.
          const pid = opts.link && opts.link.project;
          const sug = Fab.rules.suggest({ projectId: pid, pkgName: entry.label });
          // A flex package runs on a flex profile: the remembered one if it is flex-based, else Flex HDI
          // (packages are often all called "Fabrication", so a rigid profile remembered by name loses).
          // A rigid package doesn't inherit Flex HDI from the flex opened before it.
          const use = id => { state.profile = id; state.thickness = Fab.rules.resolve(id).values.thickness; };
          if (pkg.flex && !(sug && isFlexProfile(sug))) {
            if (!isFlexProfile(state.profile)) use('flex');
            log(entry, 'dim', `Flex layers found (coverlay or stiffener): using ${Fab.rules.resolve(state.profile).name}${sug ? ` rather than ${Fab.rules.resolve(sug).name}, the profile last used for ${pid ? 'this project' : 'this package'}` : ''}`);
          } else if (sug && sug !== state.profile) { use(sug); log(entry, 'dim', `Using ${Fab.rules.resolve(sug).name}, the profile last used for ${pid ? 'this project' : 'this package'}`); }
          else if (!sug && !pkg.flex && isFlexProfile(state.profile)) { use('standard'); log(entry, 'dim', `Not a flex: using ${Fab.rules.resolve('standard').name}`); }
        }
        await runChecks(entry);
      }
      if (entry.link) applyLink(entry, entry.link);
    } catch (err) {
      console.error(err);
      entry.status = 'error'; entry.error = String(err && err.message || err);
      log(entry, 'err', 'Failed: ' + entry.error);
      renderAll();
    }
  }

  async function runChecks(entry, reason) {
    const pkg = entry.pkg;
    const prof = profile(entry);
    entry.status = 'running';
    // Review notes are a reviewer's, not the checks': they stay through a re-run.
    const notes = entry.findings.filter(f => f.category === 'Review');
    entry.findings = [];
    if (reason) log(entry, 'step', reason);
    // Parts the reviewer set as test points, fiducials or mounting holes (Treat as…) count as such.
    const kinds = Fab.waivers.kinds(scopeOf(entry));
    C.setPartKinds(pkg, kinds);
    entry.kindsAt = kindsSig(pkg.partKinds);
    if (kinds.length) log(entry, 'dim', `         Part types set in Fabcheck: ${kinds.map(Fab.waivers.describeKind).join('; ')}`);
    entry.stage = { module: 'package', label: null };
    const t0 = performance.now();
    const run = entry.live = { t0, frac: 0, jobs: [], pins: [], n: { error: 0, warn: 0 }, fx: 'enter', steps: [], pick: null };
    const modules = [
      ['Package', C.package.steps, [pkg], 'package'],
      ['Assembly', C.assembly.steps, [pkg, prof], 'assembly'],
      ['Build consistency', C.build.steps, [pkg], 'build'],
      ['Pins (IPC-356)', C.pins.steps, [pkg], 'pins'],
      ['BOM audit', C.bom.steps, [pkg], 'bom'],
      [`Fabrication DFM (${profileName(entry)}${entry.pinned ? ", run's saved rules" : ''}, ${Fab.fmtLen(prof.thickness)})`, C.dfm.steps, [pkg, prof], 'dfm'],
    ];
    // The inspection stage follows the step being run.
    const live = () => entry.id === state.active && Fab.stage;
    // Each labeled step is kept (run.steps), with where it began on the bar, so the stage can go back to it.
    const stage = (module, label) => {
      entry.stage = { module, label };
      if (label) run.steps.push({ module, label, n: { error: 0, warn: 0 }, a: units / total });
      if (live()) Fab.stage.update(entry, prof);
    };
    // Progress in work units, weighted by how long steps take: 1 per step, 3 per copper layer's
    // spacing step, and the raster pass about as much as everything else, filled by the area of
    // its finished jobs. A module that returns early jumps to its end.
    const nCu = pkg.layers.copper.length, nMask = ['top', 'bottom'].filter(s => pkg.layers.mask[s]).length;
    const most = { package: 7, assembly: 5, build: 3, pins: 3, bom: 3, dfm: 11 + 4 * nCu + nMask };
    const other = Object.values(most).reduce((a, b) => a + b, 0), rasterUnits = Math.round(1.2 * other);
    most.dfm += rasterUnits;
    const total = other + rasterUnits;
    // The steps laid along the bar before they run, where the fill will reach each (as fractions):
    // the same units, in the order the modules yield them. A step a module skips puts the rest of
    // that module's marks one step out; the stage marks the steps run where they actually began.
    run.plan = [];
    let at = 0;
    const slot = (module, w, n = 1) => { for (let i = 0; i < n; i++) { run.plan.push({ module, a: at / total }); at += w; } };
    for (const m of ['package', 'assembly', 'build', 'pins', 'bom']) slot(m, 1, most[m]);
    slot('dfm', 1, 11); slot('dfm', rasterUnits); slot('dfm', 3, nCu); slot('dfm', 1, nCu); slot('dfm', 1, nMask);
    let base = 0, units = 0;
    renderAll();
    const advance = u => { units = Math.min(u, base); run.frac = units / total; setProgress(entry, 0.3 + 0.7 * run.frac); };
    // Ticks the bar's clock; stops itself once the run ends, however it ends.
    const clock = setInterval(() => { if (entry.status !== 'running' || entry.live !== run) clearInterval(clock); else if (live()) Fab.stage.progress(entry); }, 500);
    for (const [name, gen, args, key] of modules) {
      log(entry, 'step', name);
      stage(key, null);
      await tick();
      const out = [], start = base;
      base += most[key];
      // Raster jobs as the workers take them and finish them, for the stage and the bar.
      out.watch = (ev, job) => {
        if (ev === 'plan') { job.jobs.forEach((j, i) => { j._i = i; }); run.jobs = job.jobs; run.px = job.jobs.reduce((t, j) => t + j.px, 0); run.pxDone = 0; }
        else if (ev === 'start') job.state = 'on';
        else { job.state = 'done'; run.pxDone += job.px; advance(run.rasterAt + rasterUnits * run.pxDone / run.px); }
        if (live()) Fab.stage.job(entry, ev, job);
      };
      const g = gen(...args, out);
      let label = null, seen = 0, ts = performance.now(), weight = 0;
      for (;;) {
        let r;
        try { r = g.next(); } catch (e) {
          console.error(e);
          out.push(Fab.finding({ category: 'Package', check: 'internal', severity: 'error', title: `Check failed: ${label || name}`, detail: String(e && e.stack || e) }));
          r = { done: true };
        }
        const fresh = out.slice(seen);
        seen = out.length;
        if (label || fresh.length) reportStep(entry, label || 'Summary', fresh, performance.now() - ts);
        if (fresh.length && Fab.stage) Fab.stage.found(entry, fresh, live());
        if (r.done) break;
        ts = performance.now();
        // The step before this one is done.
        advance(units + weight);
        // A step may hand back work running elsewhere (raster tiles in workers) to wait for.
        if (r.value && r.value.wait) {
          label = r.value.label; weight = 0; run.rasterAt = units;
          stage(key, label);
          await r.value.wait;
          advance(run.rasterAt + rasterUnits);
          run.jobs = [];
        } else {
          label = r.value; weight = /^Spacing and slivers/.test(label) ? 3 : 1;
          stage(key, label);
        }
        await tick();
      }
      advance(start + most[key]);
      C.audit(out);
      C.markTestPoints(entry.pkg, out);
      entry.findings.push(...out);
    }
    clearInterval(clock);
    run.ms = performance.now() - t0;
    entry.stage = null;
    attachLocations(pkg, entry.findings);
    const n = s => entry.findings.filter(f => f.severity === s).length;
    setProgress(entry, 1);
    log(entry, 'done', `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${plural(n('error'), 'error')}, ${plural(n('warn'), 'warning')}, ${n('info')} info`);
    entry.findings.push(...notes);
    entry.status = 'ready';
    run.fx = 'exit';
    entry.revCache = null;
    renderAll();
    await saveRun(entry);
  }

  // Keep the run in this browser (IndexedDB): run record, compact findings, slimmed package.
  async function saveRun(entry) {
    try {
      if (!entry.pkgRec) entry.pkgRec = await Fab.store.packageRecord(entry.files, entry.files.source, entry.label);
      const pkgRec = entry.pkgRec;
      const prof = profile(entry);
      const settings = entry.pinned
        ? { profile: entry.pinned.id, profileName: entry.pinned.name, rules: Object.assign({}, entry.pinned.rules), thickness: prof.thickness, variant: null }
        : { profile: state.profile, profileName: profileName(entry), rules: Object.assign({}, prof), thickness: prof.thickness, variant: null };
      if (entry.outlinePick) settings.outline = entry.outlinePick;
      // Part types change what the checks find, so a run keeps the ones it was made with.
      if (entry.pkg.partKinds && entry.pkg.partKinds.length) settings.partKinds = entry.pkg.partKinds.map(k => Object.assign({}, k));
      let run = Fab.store.runRecord(entry, pkgRec, settings);
      const extra = { sentTo: entry.sentTo || null };
      const exp = entry.expect;
      if (exp) {
        if (pkgRec.sha256 !== exp.run.package.sha256) {
          log(entry, 'warn', `This is not the package that made run ${exp.run.id}: its SHA-256 is ${pkgRec.sha256.slice(0, 12)}…, the run's is ${exp.run.package.sha256.slice(0, 12)}…. Saved as a new run instead.`);
        } else {
          const was = exp.run.summary || {}, now = run.summary;
          const same = exp.run.demo || (was.error === now.error && was.warn === now.warn && was.info === now.info);
          const nowVersion = run.tool.version, vChanged = (exp.run.tool || {}).version !== nowVersion;
          // Keep the original id and record, so links from Signoff keep working.
          extra.rerun = { at: run.at, version: run.tool.version, summary: now, differs: !same };
          run = Object.assign({}, exp.run, exp.run.demo ? { summary: now } : {});
          log(entry, same ? 'ok' : 'warn', `Package matches run ${run.id} (SHA-256 ${pkgRec.sha256.slice(0, 12)}…). ` +
            (same ? 'Same findings as the original run.' : `Findings differ from the original run (${was.error}/${was.warn}/${was.info} then, ${now.error}/${now.warn}/${now.info} now, errors/warnings/info)` +
              (vChanged ? `: Fabcheck changed since (${(exp.run.tool || {}).version} → ${nowVersion}).` : '.')));
          entry.rerunDiffers = !same;
          if (exp.project) extra.sentTo = extra.sentTo || { projectId: exp.project.id, name: (exp.project.meta || {}).name };
          entry.sentTo = extra.sentTo;
        }
        entry.expect = null;
      }
      await Fab.store.saveRun(run, entry.findings, pkgRec, extra);
      state.keptRuns = null; // Revisions offers kept runs as baselines
      entry.run = run;
      const kept = pkgRec.files.reduce((n, f) => n + f.bytes.length, 0);
      const left = pkgRec.manifest.files.filter(f => !f.stored).length;
      log(entry, 'ok', `Saved run ${run.id} in this browser: ${pkgRec.files.length} of ${pkgRec.manifest.files.length} files kept (${(kept / 1048576).toFixed(2)} MB of ${(pkgRec.size / 1048576).toFixed(2)} MB)` + (left ? `, ${left} listed only (drawings, nested archives, unused ODB++ data)` : ''));
      renderAll();
    } catch (err) {
      console.error(err);
      log(entry, 'warn', 'Could not keep this run in the browser: ' + (err && err.message || err));
    }
  }

  // Stored findings come from IndexedDB or a project's repo, which contractors can write to.
  // Keep the fields the views use as plain data: known severities and categories, strings as
  // strings, coordinates as numbers.
  const SEVS = ['error', 'warn', 'info'];
  const finite = v => typeof v === 'number' && isFinite(v);
  function cleanFinding(f) {
    f = Object.assign({}, f && typeof f === 'object' ? f : {});
    f.id = String(f.id == null ? '' : f.id);
    f.severity = SEVS.includes(f.severity) ? f.severity : 'info';
    if (!CATS.some(c => c[0] === f.category)) f.category = 'Package';
    for (const k of ['check', 'title', 'detail', 'layer', 'side', 'author', 'created']) if (f[k] != null && typeof f[k] !== 'string') f[k] = String(f[k]);
    if (f.at && !(finite(f.at.x) && finite(f.at.y))) delete f.at;
    if (f.bbox && !(Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(finite))) delete f.bbox;
    if (f.refs != null) f.refs = Array.isArray(f.refs) ? f.refs.map(String) : [];
    if (f.value != null && !finite(f.value) && !(typeof f.value === 'string' && isFinite(f.value))) delete f.value;
    if (f.row != null && !finite(f.row)) delete f.row;
    if (f.tp != null) f.tp = f.tp === true;
    return f;
  }

  // Show a kept run: its stored findings, with the board parsed and parts placed.
  function restoreRun(entry, stored) {
    const run = stored.run;
    entry.run = run; entry.sentTo = stored.sentTo || null;
    pinRun(entry, run.settings || {});
    const kinds = Array.isArray((run.settings || {}).partKinds) ? run.settings.partKinds.filter(k => k && typeof k.pattern === 'string' && /^(tp|fid|mh)$/.test(k.kind) && /^(des|footprint)$/.test(k.by)) : [];
    C.setPartKinds(entry.pkg, kinds);
    entry.kindsAt = kindsSig(entry.pkg.partKinds);
    try { C.assembly(entry.pkg, profile(entry)); C.pins(entry.pkg); } catch (e) { console.error(e); }
    entry.findings = (Array.isArray(stored.findings) ? stored.findings : []).map(cleanFinding);
    const c = run.summary || {};
    log(entry, 'ok', `Opened run ${run.id} from ${stored.where || 'this browser'}: ${new Date(run.at).toLocaleString()}${run.by ? ' by ' + run.by : ''}, ${entry.pinned.name}, ${Fab.fmtLen(run.settings.thickness)}`);
    if (entry.pinned.editedSince) log(entry, 'warn', `Profile "${entry.pinned.name}" has been edited since this run; the run keeps the rules it was made with.`);
    else if (entry.pinned.missing) log(entry, 'dim', `         Profile "${entry.pinned.name}" isn't on this computer; the run's saved rules are used.`);
    logAdded(entry);
    log(entry, 'dim', `         ${c.error} errors, ${c.warn} warnings, ${c.info} info as stored with the run. "Run checks again" re-checks with this Fabcheck (${(window.FABCHECK_VERSION || {}).hash || 'dev'}; run made with ${(run.tool || {}).version}).`);
    if (stored.rerun && stored.rerun.differs) log(entry, 'warn', `A re-run on ${new Date(stored.rerun.at).toLocaleDateString()} with Fabcheck ${stored.rerun.version} found different results.`);
    entry.status = 'ready';
    renderAll();
  }

  function reportStep(entry, label, fresh, ms) {
    const e = fresh.filter(f => f.severity === 'error'), w = fresh.filter(f => f.severity === 'warn');
    const cls = e.length ? 'err' : w.length ? 'warn' : 'ok';
    const summary = e.length || w.length ? [e.length && plural(e.length, 'error'), w.length && plural(w.length, 'warning')].filter(Boolean).join(', ') : 'passed';
    log(entry, cls, `${label} · ${summary} · ${Math.round(ms)} ms`);
    const show = e.concat(w);
    for (const f of show.slice(0, 4)) log(entry, 'dim', `    ${f.severity === 'error' ? '✗' : '⚠'} ${f.title}`);
    if (show.length > 4) log(entry, 'dim', `    … ${show.length - 4} more`);
  }

  // Findings that only name designators get the placement's location.
  function attachLocations(pkg, fs) {
    const parts = new Map(((pkg.pnp && pkg.pnp.parts) || []).map(p => [p.des, p]));
    for (const f of fs) if (!f.at && !f.bbox && f.refs && f.refs.length) {
      const ps = f.refs.map(r => parts.get(r)).filter(p => p && p.gx != null);
      if (ps.length === 1) { f.at = { x: ps[0].gx, y: ps[0].gy }; f.side = f.side || ps[0].side; }
      else if (ps.length > 1) { const b = Fab.bbox.empty(); for (const p of ps) Fab.bbox.addPt(b, p.gx, p.gy); f.bbox = b; f.side = f.side || ps[0].side; }
    }
  }

  // ── Routing ──
  // Navigate synchronously (pushState fires no hashchange), so callers can act on the new view at once.
  function go(view) {
    if (location.hash !== '#/' + view) history.pushState(null, '', location.pathname + location.search + '#/' + view);
    route();
  }
  function route() {
    const v = (location.hash.match(/^#\/(\w+)/) || [])[1];
    state.view = VIEWS.some(x => x[0] === v) ? v : 'overview';
    closeInspector();
    renderAll();
    const q = hashParams();
    if (q.run) openRunLink(Object.assign(q, { view: state.view }));
  }

  // Deep link (contract: ee_design_review/docs/fabcheck-link.md):
  //   #/board?run=<runId>&project=<projectId>&repo=<owner/repo>&check=<check>&x=<mm>&y=<mm>&layer=<layer>
  function hashParams() {
    const m = /^#\/\w+\?(.*)$/.exec(location.hash);
    return m ? Object.fromEntries(new URLSearchParams(m[1])) : {};
  }

  // Resolve a run: this browser first, then (stage 2) the project's repo, else ask for the package.
  async function openRunLink(q) {
    const have = state.pkgs.find(e => e.run && e.run.id === q.run && e.status === 'ready');
    if (have) { state.active = have.id; applyLink(have, q); return; }
    if (state.resolving === q.run) return;
    state.resolving = q.run;
    // A demo board's button on the start page: run it again, even if this browser keeps that run.
    const live = state.liveRun === q.run;
    state.liveRun = null;
    try {
      const stored = live ? null : await Fab.store.getRun(q.run);
      const pkgRec = stored && await Fab.store.getPackage(stored.run.package.key);
      if (stored && pkgRec) {
        await openPackage(async () => Fab.store.restoreFiles(pkgRec), stored.run.package.name, { stored, pkgRec, link: q });
        return;
      }
      // A demo board's fixed run (Signoff EE's demo links to these): open the board and run it again.
      const board = demoBoards().find(b => b.run === q.run);
      if (board) {
        await openPackage(() => Fab.loader.fromUrl(board.file), board.name, { expect: { run: demoRun(board), project: Fab.signoff.projectById(board.project) }, link: q });
        return;
      }
      const known = stored ? { run: stored.run, project: null } : Fab.store.runFromSignoff(q.run);
      // A link from a Signoff EE demo issue that arrived without ?demo: the run lives in the demo.
      if (!known && !Fab.DEMO && Fab.store.runFromSignoff(q.run, 'signoff.demo.')) {
        location.replace(location.pathname + (location.search ? location.search + '&demo' : '?demo') + location.hash);
        return;
      }
      // Opened from Signoff, which read the run and its fab package with its own token and left them
      // here: Fabcheck never reads a project's repo (docs/signoff-revisions.md, hand-off).
      const ho = await Fab.store.takeHandoff(q.run).catch(err => { console.warn('Hand-off not readable', err); return null; });
      if (ho && ho.run && ho.zip && ho.run.id === q.run) {
        const name = (ho.run.package && ho.run.package.zip && ho.run.package.zip.name) || 'package.zip';
        const stored = { run: ho.run, findings: ho.findings, where: 'Signoff EE', sentTo: q.project ? { projectId: q.project } : null };
        await openPackage(() => Fab.loader.fromBlobs([{ path: name, blob: new Blob([ho.zip]) }]), ho.run.package.name || name, { stored, link: q });
        return;
      }
      const entry = { id: 'p' + (++seq), label: known ? baseName(known.run.package.name) : 'Run ' + q.run, status: 'needs', pkg: null, findings: [], log: [], t0: performance.now(), progress: 0, need: { runId: q.run, known, link: q } };
      state.pkgs.push(entry);
      state.active = entry.id;
      history.replaceState(null, '', location.pathname + location.search + '#/overview');
      state.view = 'overview';
      renderAll();
    } finally { state.resolving = null; }
  }

  // The run record of a demo board, as Signoff EE's demo has it on its issues (its summary is the run's own).
  function demoRun(b) {
    const rules = Object.assign({}, Fab.rules.resolve(b.profile).values, { thickness: b.thickness });
    return {
      id: b.run, at: new Date().toISOString(), by: 'Morgan Lee', demo: true,
      tool: { name: 'Fabcheck', version: (window.FABCHECK_VERSION || {}).hash || 'dev' },
      package: { key: b.key, sha256: b.sha256, name: b.name, size: b.size },
      settings: { profile: b.profile, profileName: Fab.rules.resolve(b.profile).name, rules, thickness: b.thickness, variant: null }, summary: null, stored: null,
    };
  }

  // A layer named in a link: its file name, Fabcheck's label ("L1 Top copper"), or a plain name such as
  // "Top copper", "Bottom mask", "L2" or "Inner copper 2".
  function matchLayer(name) {
    const n = String(name).trim().toLowerCase();
    const gl = viewer.layers.filter(l => l.layer);
    const hit = gl.find(l => l.layer.file.name.toLowerCase() === n) || gl.find(l => l.label.toLowerCase() === n) ||
      gl.find(l => l.label.toLowerCase().endsWith(' ' + n));
    if (hit) return hit.layer;
    const fn = /copper|signal|plane/.test(n) ? 'copper' : /mask/.test(n) ? 'mask' : /silk|legend|overlay/.test(n) ? 'silk' : /paste/.test(n) ? 'paste' : null;
    const side = /\btop\b/.test(n) ? 'top' : /\b(bot|bottom)\b/.test(n) ? 'bottom' : /\b(inner|int)\b/.test(n) ? 'inner' : null;
    const num = /(?:^l|\b)(\d+)\b/.exec(n);
    const byNum = num && gl.find(l => l.layer.fn === 'copper' && l.layer.cuOrder === +num[1]);
    if (byNum && (!fn || fn === 'copper')) return byNum.layer;
    const cand = gl.find(l => (!fn || l.layer.fn === fn) && (!side || l.layer.side === side) && (fn || side));
    return cand ? cand.layer : null;
  }

  // Board zoomed to the link's location, with the linked check's findings picked out.
  function applyLink(entry, q) {
    state.active = entry.id;
    state.focusCheck = q.check || null;
    state.check = null;
    state.filter = { error: true, warn: true, info: true };
    state.q = '';
    // A link to another view with no place or check (the suite's demo tour: #/overview?run=…, so the
    // run's animation plays on the stage) stays on that view; the rest go to the board.
    if (q.view && q.view !== 'board' && !q.check && q.x == null) { go(q.view); return; }
    go('board');
    const layer = q.layer && viewer && matchLayer(q.layer);
    if (q.x != null && q.y != null && isFinite(+q.x) && isFinite(+q.y)) {
      const near = entry.findings.filter(f => (!q.check || f.check === q.check) && (f.at || f.bbox))
        .map(f => { const c = f.at || Fab.bbox.center(f.bbox); return { f, d: Math.hypot(c.x - q.x, c.y - q.y), off: layer && f.layer && f.layer !== layer.file.name ? 1 : 0 }; })
        .sort((a, b) => a.off - b.off || a.d - b.d)[0];
      if (near && near.d < 0.5) focusFinding(near.f);
      else focusFinding({ id: 'link', at: { x: +q.x, y: +q.y }, layer: layer ? layer.file.name : null });
    } else if (q.check) {
      const f = entry.findings.find(x => x.check === q.check && (x.at || x.bbox));
      if (f) focusFinding(f);
    }
  }

  // ── Keeping scroll position ──
  // Redraws rebuild HTML, which would reset scrollers to the top. redraw() keeps them when the same
  // view is drawn again (same key), and starts at the top when the key changes (another view, package
  // or profile). Inner scrollers (sideways table strips, the findings rail, the console) are matched by
  // class and order; the console stays pinned to the bottom when it was there.
  const SCROLLERS = ['table-wrap', 'rail-list', 'console-body'];
  // Instant, even where the stylesheet asks for smooth scrolling (Signoff's .main does).
  const jump = (el, top, left) => el.scrollTo({ top, left: left == null ? el.scrollLeft : left, behavior: 'instant' });
  const scrollKeys = {};
  function redraw(root, key, fill) {
    const outer = root.id === 'page' ? $('#main') : root;
    const same = scrollKeys[root.id] === key;
    const inner = {};
    if (same) for (const cls of SCROLLERS) inner[cls] = [...root.getElementsByClassName(cls)].map(el => ({ top: el.scrollTop, left: el.scrollLeft, atEnd: el.scrollHeight - el.scrollTop - el.clientHeight < 40 }));
    const top = outer.scrollTop, left = outer.scrollLeft;
    fill();
    scrollKeys[root.id] = key;
    if (same) {
      jump(outer, top, left);
      for (const cls of SCROLLERS) [...root.getElementsByClassName(cls)].forEach((el, i) => {
        const was = (inner[cls] || [])[i];
        if (cls === 'console-body' && (!was || was.atEnd)) { jump(el, el.scrollHeight); return; }
        if (was) jump(el, was.top, was.left);
      });
      if (root.id === 'page') state.pendingTop = top; // content that loads later (recent runs) restores it again
    } else {
      jump(outer, 0, 0);
      state.pendingTop = null;
      for (const el of root.getElementsByClassName('console-body')) jump(el, el.scrollHeight);
    }
  }
  const pageKey = e => [state.view, e ? e.id : '', e ? e.status === 'needs' : '', state.view === 'rules' ? (state.rulesTab === 'checks' ? 'checks' : state.rulesSel || state.profile) : ''].join('|');

  // Scroll a row into view only if it is hidden, without moving the list otherwise.
  function revealRow(row) {
    if (!row) return;
    const list = row.closest('.rail-list');
    if (!list) return;
    const r = row.getBoundingClientRect(), b = list.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) row.scrollIntoView({ block: 'nearest' });
  }

  // ── Rendering ──
  function renderAll() {
    renderSidebar();
    renderToolbar();
    const e = active();
    const boardOn = !!e && e.status !== 'loading' && !!e.pkg && state.view === 'board';
    $('#board-view').hidden = !boardOn;
    $('#page').hidden = boardOn;
    $('#rules-link').classList.toggle('active', state.view === 'rules');
    if (boardOn) { renderBoard(e); return; }
    const pageEl = $('#page');
    redraw(pageEl, pageKey(e), () => {
      if (state.view === 'rules') { pageEl.innerHTML = rulesHtml(); return; }
      if (!e) { pageEl.innerHTML = emptyHtml(); return; }
      if (e.status === 'needs') { pageEl.innerHTML = needsHtml(e); return; }
      const page = {
        overview: overviewHtml, findings: findingsHtml, assembly: assemblyHtml, bom: bomHtml, files: filesHtml,
        revisions: revisionsHtml, archive: archiveHtml, board: overviewHtml,
      }[state.view];
      // The stage keeps its own node while it shows the same run in the same state, so a re-render
      // (the save after a run, say) doesn't restart its transitions or drop live effects.
      const kept = $('#stage');
      pageEl.innerHTML = page(e);
      const fresh = $('#stage');
      if (kept && fresh && kept.dataset.key === fresh.dataset.key) fresh.replaceWith(kept);
    });
    if (e && Fab.stage && state.view === 'overview') { if (e.stage) Fab.stage.update(e, profile(e)); else Fab.stage.paint(e, profile(e)); }
    if (!e && state.view !== 'rules') loadRecent();
    if (e && state.view === 'archive') loadArchive(e);
  }

  function renderSidebar() {
    $('#pkg-list').innerHTML = state.pkgs.map(e => {
      const live = liveCounts(e), n = s => live[s];
      const busy = e.status === 'loading' || e.status === 'running';
      const sub = e.status === 'needs' ? 'Waiting for its package' : e.status === 'error' ? 'Could not read' : !e.pkg ? 'Reading…' : busy ? 'Checking…' :
        [e.pkg.layers.copper.length && e.pkg.layers.copper.length + ' layers', e.pkg.pnp && e.pkg.pnp.parts.length + ' parts', e.pkg.bom && e.pkg.bom.lines.length + ' BOM lines'].filter(Boolean).join(' · ') || 'No board data';
      const right = busy ? '<span class="pkg-spin"></span>' : `<span class="pkg-sev">${n('error') ? `<span class="e">${n('error')}</span>` : ''}${n('warn') ? `<span class="w">${n('warn')}</span>` : ''}</span>`;
      return `<button class="proj${e.id === state.active ? ' active' : ''}" data-act="select" data-id="${e.id}" title="${esc(e.label)}">
        <span class="pkg-icon">${ICON.pkg}</span>
        <span class="proj-body"><span class="proj-name">${esc(e.label)}</span><span class="proj-sub">${esc(sub)}</span></span>${right}</button>`;
    }).join('') || '<div class="side-empty">No packages open. Drop a fab package .zip anywhere on this window.</div>';
  }

  function renderToolbar() {
    const e = active();
    const seg = $('#view-seg');
    seg.hidden = !e;
    if (!e) return;
    const live = liveCounts(e), nf = live.error + live.warn, hasErr = live.error > 0;
    seg.innerHTML = VIEWS.map(([k, label]) => `<button class="${state.view === k ? 'on' : ''}" data-view="${k}" role="tab">${label}` +
      (k === 'findings' && nf ? `<span class="count">${nf}</span>${hasErr ? '<span class="dot"></span>' : ''}` : '') + '</button>').join('');
  }

  // A scrubbed Dovetail board made by tools/make_sample.py, with planted problems. Fetched from this site, so
  // the buttons only show when the page is served (not opened from file://). The demo also has the suite's
  // made-up Smart Thermostat boards (tools/make_demo_boards.py, demo/boards.js), which Signoff EE's demo opens.
  const SAMPLE = 'demo/fabcheck-sample-board.zip';
  const demoBoards = () => Fab.DEMO ? Fab.demoBoards || [] : [];
  const sampleButtons = () => Fab.DEMO && location.protocol !== 'file:'
    ? demoBoards().map(b => `<button class="btn" data-act="sample" data-file="${esc(b.file)}" data-name="${esc(b.name)}">${esc(b.label)}</button>`).join('') +
      `<button class="btn" data-act="sample" data-file="${SAMPLE}" data-name="fabcheck-sample-board.zip">${demoBoards().length ? 'Another sample board' : 'Try a sample board'}</button>`
    : '';

  function emptyHtml() {
    return `<div class="page"><div class="drop" id="drop">
      <div class="empty-art">${ICON.upload}</div>
      <h2>Check a fab package before it goes out</h2>
      <p>Drop an Altium output .zip or folder anywhere on this window: Gerber (RS-274X or X2), NC drill, pick-and-place, BOM, ODB++ and drawings.</p>
      <div class="actions"><button class="btn btn-primary" data-act="open">Choose .zip…</button><button class="btn" data-act="open-dir">Choose folder…</button>${sampleButtons()}</div>
      <div class="drop-tiles">
        <div><b>Package</b>Every file classified; missing items, units, drill report</div>
        <div><b>Build</b>PnP, BOM and ODB++ agree; variant and stencil</div>
        <div><b>BOM</b>Part numbers decoded against descriptions</div>
        <div><b>DFM</b>Traces, drills, rings, edge, mask, silk</div>
      </div>
      <div class="foot">${ICON.lock} ${Fab.DEMO ? 'Files are read in this browser tab and never uploaded. In this demo, runs and anything sent to Signoff EE stay in this browser.' : 'Files are read in this browser tab. Runs are kept in this browser; only "Send to Signoff EE" stores a package, in that project\'s private repository.'}</div>
    </div><div id="recent"></div></div>`;
  }

  // Recent runs kept in this browser (IndexedDB), on the home page.
  async function loadRecent() {
    let runs = [];
    try { runs = await Fab.store.recentRuns(); } catch (e) { return; }
    const el = $('#recent');
    if (!el || !runs.length) return;
    const pill = (n, cls) => n ? `<span class="pill ${cls}">${n}</span>` : '';
    el.innerHTML = `<div class="section-title">Recent runs <span class="chips"><span class="chip">${plural(runs.length, 'run')} in this browser</span></span></div>
      <div class="card table-wrap"><table class="table compact"><thead><tr><th>Package</th><th>Run</th><th>Settings</th><th>Findings</th><th>Signoff EE</th><th></th></tr></thead><tbody>` +
      runs.map(r => {
        const run = r.run, c = run.summary || {};
        return `<tr data-act="open-run" data-id="${run.id}"><td><b style="font-weight:500">${esc(baseName(run.package.name))}</b><div class="muted mono">${run.package.sha256.slice(0, 12)}… · ${(run.package.size / 1048576).toFixed(1)} MB</div></td>` +
          `<td>${esc(new Date(run.at).toLocaleString())}<div class="muted">${esc(run.by || '')}${run.stored ? ' · stored in ' + esc(run.stored.repo) : ' · this browser only'}</div></td>` +
          `<td>${esc(runProfileName(run.settings))}<div class="muted">${Fab.fmtLen(run.settings.thickness)}</div></td>` +
          `<td>${pill(c.error, 'error')}${pill(c.warn, 'warn')}${pill(c.info, '')}${r.rerun && r.rerun.differs ? '<div class="muted">re-run differed</div>' : ''}</td>` +
          `<td>${r.sentTo ? esc(r.sentTo.name || r.sentTo.projectId) : '<span class="muted">not sent</span>'}</td>` +
          `<td><button class="btn btn-plain" data-act="delete-run" data-id="${esc(run.id)}">Delete</button></td></tr>`;
      }).join('') + '</tbody></table></div>';
    if (state.pendingTop != null) { jump($('#main'), state.pendingTop); state.pendingTop = null; }
  }

  async function openStoredRun(id) {
    const stored = await Fab.store.getRun(id);
    const pkgRec = stored && await Fab.store.getPackage(stored.run.package.key);
    if (!stored || !pkgRec) { toast('That run is no longer in this browser'); return; }
    const have = state.pkgs.find(e => e.run && e.run.id === id);
    if (have) { state.active = have.id; go('overview'); return; }
    await openPackage(async () => Fab.store.restoreFiles(pkgRec), stored.run.package.name, { stored, pkgRec });
  }

  // A deep link to a run this browser doesn't have: say which package made it and take a drop.
  function needsHtml(e) {
    const k = e.need.known, run = k && k.run;
    let h = `<div class="page">` + pageHead(e, 'Fabcheck run', run ? baseName(run.package.name) : 'Run ' + e.need.runId, run ? `Run ${esc(run.id)}<span class="sep">·</span>${esc(new Date(run.at).toLocaleString())}${run.by ? '<span class="sep">·</span>' + esc(run.by) : ''}` : '');
    if (signoffProject(e)) h += `<p style="margin:-14px 0 18px"><button class="btn" data-act="back-signoff">Back to Signoff EE</button></p>`;
    h += `<div class="drop" style="margin-top:0"><div class="empty-art">${ICON.upload}</div>`;
    if (run) {
      h += `<h2>Drop the package that made this run</h2><p>This run isn't stored in this browser${run.stored ? ' and could not be read from ' + esc(run.stored.repo) : ''}. Drop <b>${esc(run.package.name)}</b> (${(run.package.size / 1048576).toFixed(2)} MB) and Fabcheck checks its fingerprint and re-runs it with the run's settings.</p>
        <dl class="kv" style="text-align:left;max-width:520px;margin:0 auto 18px"><dt>SHA-256</dt><dd class="hash">${esc(run.package.sha256)}</dd><dt>Settings</dt><dd>${esc(runProfileName(run.settings))}, ${Fab.fmtLen(run.settings.thickness)}${run.settings.rules ? ' (rules saved with the run)' : ''}</dd><dt>Fabcheck</dt><dd>${esc((run.tool || {}).version || '?')} (this one: ${esc((window.FABCHECK_VERSION || {}).hash || 'dev')})</dd><dt>Findings then</dt><dd>${run.summary.error} errors, ${run.summary.warn} warnings, ${run.summary.info} info</dd></dl>`;
    } else {
      h += `<h2>Run ${esc(e.need.runId)} isn't available</h2><p>It isn't stored in this browser, and no Signoff EE issue in this browser names it. Open the issue's project in Signoff EE here first, or drop the package to check it afresh.</p>`;
    }
    h += `<div class="actions"><button class="btn btn-primary" data-act="open">Choose .zip…</button><button class="btn" data-act="open-dir">Choose folder…</button></div></div>`;
    return h + '</div>';
  }

  function counts(fs) { const c = { error: 0, warn: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; }

  // ── Waivers (waivers.js) ──
  // Rules live per Signoff project, or per package name for a run linked to none. Which findings they
  // waive is worked out once per change (rules, findings, package) and kept on the entry.
  const scopeOf = e => { const pid = signoffProject(e); return pid ? 'project:' + pid : 'pkg:' + e.label; };
  function wv(e) {
    const scope = scopeOf(e), key = Fab.waivers.version + '|' + scope + '|' + e.findings.length;
    if (e._wv && e._wv.key === key && e._wv.findings === e.findings && e._wv.pkg === e.pkg) return e._wv;
    const rules = Fab.waivers.rules(scope);
    return (e._wv = Object.assign(Fab.waivers.apply(e.pkg, e.findings, rules), { key, findings: e.findings, pkg: e.pkg, rules, scope }));
  }
  // A finding's waiver ({ rule, state: 'waived' | 'new' }), or null; a stale one doesn't count.
  const waiverOf = (e, f) => { const s = wv(e).by.get(f.id); return s && s.state !== 'stale' ? s : null; };
  const staleOf = (e, f) => { const s = wv(e).by.get(f.id); return s && s.state === 'stale' ? s : null; };
  const isWaived = (e, f) => !!waiverOf(e, f);
  const activeOf = (e, fs) => { const by = wv(e).by; return fs.filter(f => { const s = by.get(f.id); return !s || s.state === 'stale'; }); };
  const waivedOf = (e, fs) => { const by = wv(e).by; return fs.filter(f => { const s = by.get(f.id); return s && s.state !== 'stale'; }); };
  // Errors, warnings and info still to deal with: what every total shows. Waived ones are counted apart.
  const liveCounts = (e, fs) => counts(activeOf(e, fs || e.findings));
  const sendPlan = e => Fab.signoff.plan(e.findings, f => { const w = waiverOf(e, f); return w ? w.rule : null; });
  const fmtDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString(); };
  // A measured value in its check's unit (most are lengths).
  const unitFor = check => ({ aspect: v => +v.toFixed(2) + ':1', isolated: v => +v.toFixed(3) + ' mm²', 'copper-balance': v => +v.toFixed(1) + ' points' }[check] || (v => Fab.fmtLen(+v.toFixed(3))));
  // The part types set for this run's scope, as the checks take them, for comparing with a run's.
  const kindsSig = list => JSON.stringify((list || []).map(k => [k.kind, k.by, k.pattern]));

  // ── Check matrix ──
  // Every check as a cell, one row per category, colored by its worst finding and counted, so a
  // problem shows at a glance however long the lists get. Clean checks show too: seeing what passed
  // is half the point. A click filters Findings to that check.
  const DFM_CHECKS = [
    ['trace', 'Trace width'], ['sliver', 'Slivers and necks'], ['spacing', 'Copper spacing'], ['thermal', 'Thermal reliefs'], ['edge', 'Copper to edge'],
    ['isolated', 'Isolated copper'], ['bga-pad', 'BGA pads'], ['drill', 'Drill size'], ['microvia', 'Laser microvias'], ['aspect', 'Aspect ratio'],
    ['ring', 'Annular ring'], ['slot', 'Slots'], ['hole-gap', 'Hole spacing'], ['hole-edge', 'Hole to edge'], ['castellation', 'Castellations'],
    ['via-in-pad', 'Via in pad'], ['npth', 'NPTH to copper'], ['mask', 'Mask openings'], ['mask-dam', 'Mask dams'], ['silk', 'Silkscreen lines'],
    ['silk-pad', 'Silkscreen on pads'], ['outline-corner', 'Outline corners'], ['copper-balance', 'Copper balance'],
  ];
  const FLEX_CHECKS = [['flex', 'Flex detected'], ['flex-area', 'Flexible area'], ['coverlay', 'Coverlay openings'], ['coverlay-web', 'Coverlay webs'], ['stiffener', 'Stiffeners'], ['flex-edge', 'Stiffener and bend keep-away']];
  const CHECK_NAMES = { note: 'Review notes', internal: 'Internal' };
  // The cells of one category: declared checks in their order, then any other check that found something.
  function matrixChecks(cat, fs) {
    const base = C.CATALOGED.includes(cat) ? C.catalog.filter(d => d.category === cat).map(d => [d.check, d.name])
      : cat === 'DFM' ? DFM_CHECKS : cat === 'Flex' ? FLEX_CHECKS : [];
    const seen = new Set(base.map(b => b[0]));
    const extra = [...new Set(fs.map(f => f.check))].filter(k => !seen.has(k)).map(k => [k, CHECK_NAMES[k] || k]);
    return base.concat(extra);
  }
  const worst = c => c.error ? 'error' : c.warn ? 'warn' : c.info ? 'info' : 'clean';
  // Findings shows it small (numbered squares, names on hover) unless the viewer asked for names.
  // Hidden for now (Chris, 2026-11-07): not ready to host. With it off, the Overview shows the older
  // card per category and Findings has no matrix; the check filter still comes from Fab rules.
  const SHOW_MATRIX = false;
  const MX_KEY = Fab.fabcheckNs + 'matrixNames';
  const mxNames = () => { try { return localStorage.getItem(MX_KEY) === '1'; } catch (err) { return false; } };
  function matrixHtml(e, where) {
    const busy = e.status !== 'ready' && e.status !== 'error';
    const pkg = e.pkg, mini = where === 'findings' && !mxNames();
    let h = `<div class="card mx${where === 'findings' ? ' mx-compact' : ''}${mini ? ' mx-mini' : ''}" role="group" aria-label="Checks and results">`;
    if (where === 'findings') h += `<div class="mx-key"><span><i class="mx-sw error"></i>Errors</span><span><i class="mx-sw warn"></i>Warnings</span><span><i class="mx-sw info"></i>Info only</span><span><i class="mx-sw clean"></i>Nothing found</span>${wv(e).by.size ? '<span><i class="mx-sw waived"></i>All waived</span>' : ''}` +
      `<span class="mx-key-end">${state.check ? `<button class="link-btn" data-act="mx-clear">Show all checks</button>` : ''}<button class="link-btn" data-act="mx-names">${mini ? 'Show check names' : 'Compact'}</button></span></div>`;
    for (const [cat, title, desc] of CATS) {
      const all = e.findings.filter(f => f.category === cat);
      if (cat === 'Review' && !all.length) continue;
      if (cat === 'Flex' && !(pkg && pkg.flex) && !all.length) continue;
      // Waived findings don't color a cell; a check whose problems are all waived shows as waived.
      const fs = activeOf(e, all), nw = all.length - fs.length;
      const cc = counts(fs), checks = matrixChecks(cat, all);
      const head = `<button class="mx-head${state.cat === cat && !state.check && state.view === 'findings' ? ' on' : ''}" data-act="cat" data-cat="${cat}" title="${esc(desc)}">` +
        `<span class="mx-title"><span class="dot ${busy ? '' : cc.error ? 'error' : cc.warn ? 'warn' : 'ok'}"></span>${esc(title)}</span>` +
        `<span class="mx-sum">${busy && !all.length ? 'Waiting' : [cc.error && `<b class="t-error">${cc.error}</b> err`, cc.warn && `<b class="t-warn">${cc.warn}</b> warn`, `${cc.info} info`, nw && `${nw} waived`].filter(Boolean).join(' · ')}</span></button>`;
      const cells = checks.map(([check, name]) => {
        const mine = all.filter(f => f.check === check), c = counts(activeOf(e, mine)), cw = mine.length - (c.error + c.warn + c.info);
        let w = busy && !mine.length ? 'wait' : worst(c);
        if ((w === 'clean' || w === 'info') && cw) w = 'waived';
        const key = cat + '/' + check, n = w === 'error' ? c.error : w === 'warn' ? c.warn : w === 'info' ? c.info : '';
        const tip = `${name} (${check}): ` + (c.error + c.warn + c.info ? [c.error && plural(c.error, 'error'), c.warn && plural(c.warn, 'warning'), c.info && c.info + ' info'].filter(Boolean).join(', ') : w === 'wait' ? 'not run yet' : w === 'waived' ? '' : 'nothing found') +
          (cw ? `${c.error + c.warn + c.info ? ', ' : ''}${cw} waived` : '');
        return `<button class="mx-cell ${w}${state.check === key ? ' on' : ''}" data-act="mx-check" data-key="${esc(key)}" title="${esc(tip)}" aria-label="${esc(tip)}">` +
          (mini ? `<span class="mx-n">${w === 'clean' || w === 'wait' ? '' : w === 'waived' ? '✓' : n}</span></button>` :
          `<span class="mx-name">${esc(name)}</span><span class="mx-n">${w === 'clean' || w === 'waived' ? '✓' : w === 'wait' ? '' : n}${w === 'error' && c.warn ? `<small>+${c.warn}</small>` : ''}</span></button>`);
      }).join('');
      h += `<div class="mx-row">${head}<div class="mx-cells">${cells}</div></div>`;
    }
    return h + '</div>';
  }

  function pageHead(e, eyebrow, title, sub, actions) {
    return `<div class="page-head"><div class="page-head-text"><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${esc(title)}</h1>` +
      (sub ? `<div class="page-sub">${sub}</div>` : '') + `</div>${actions ? `<div class="chips" style="flex:none">${actions}</div>` : ''}</div>`;
  }

  // The outline picker: every file in the Gerber set with a closed loop, drawn small, to pick the one
  // that is the board outline. Shown when no outline was found, or from "Change" in the head.
  function outlinePickerHtml(e) {
    const pkg = e.pkg, o = pkg.layers.outline, cur = o && o.file ? o.file.path : null;
    const cards = pkg.outlineCands.map(c => {
      const b = c.loop.bbox, w = b[2] - b[0], hgt = b[3] - b[1], s = 100 / Math.max(w, hgt, 1e-6);
      const pts = [];
      for (let i = 0; i < c.loop.pts.length; i += 2) pts.push(((c.loop.pts[i] - b[0]) * s + (100 - w * s) / 2).toFixed(1) + ',' + ((b[3] - c.loop.pts[i + 1]) * s + (100 - hgt * s) / 2).toFixed(1));
      const fnText = c.file.cls.x2fn || c.file.cls.fn;
      return `<button class="card op-card${c.file.path === cur ? ' on' : ''}" data-act="outline-use" data-path="${esc(c.file.path)}">` +
        `<svg viewBox="-4 -4 108 108" class="op-svg"><polygon points="${pts.join(' ')}"/></svg>` +
        `<div class="op-name">${esc(c.file.name)}</div><div class="muted">${esc(fnText)}</div><div class="muted">${Fab.fmtSize(w, hgt, 1)}</div></button>`;
    }).join('');
    const why = o && o.board.synthetic ? 'No board outline was found, so the checks are using the copper extents. If one of these is the outline, pick it.' : 'The board outline comes from the highlighted file. Pick another if that one is wrong.';
    return `<div class="card op-panel"><div class="op-head"><div><b>Board outline</b><div class="muted">${why} The choice is kept with the run.</div></div>` +
      `<button class="btn" data-act="outline-close">Close</button></div><div class="op-grid">${cards || '<div class="muted">No file in the Gerber set has a closed loop.</div>'}</div></div>`;
  }

  // Rebuild the package with another outline file, and re-check.
  function useOutline(e, path) {
    if (!e || !e.files || e.status !== 'ready') return;
    const source = e.pkg.source;
    e.outlinePick = path;
    e.pkg = Fab.classify.build(e.files, { outline: path });
    e.pkg.source = source;
    state.outlinePicker = null;
    const o = e.pkg.layers.outline;
    runChecks(e, `Outline set to ${o && o.file ? o.file.name : path}`);
  }

  function overviewHtml(e) {
    const pkg = e.pkg, c = liveCounts(e), busy = e.status !== 'ready' && e.status !== 'error';
    const wc = counts(waivedOf(e, e.findings)), fresh = [...wv(e).by.values()].filter(s => s.state === 'new').length;
    const chips = [];
    if (pkg) {
      const bb = pkg.boardBBox;
      if (pkg.set.files.length) chips.push(pkg.set.x2 ? 'Gerber X2' : 'RS-274X');
      if (pkg.layers.copper.length) chips.push(pkg.layers.copper.length + '-layer' + (pkg.flex ? ' flex' : ''));
      if (bb) chips.push(Fab.fmtSize(bb[2] - bb[0], bb[3] - bb[1], 1));
      const v = (pkg.variants || []).find(x => x.variant);
      chips.push(v ? 'Variant ' + v.variant : (pkg.variants || []).length ? 'No variant' : null);
      if (pkg.odb) chips.push('ODB++');
    }
    // A compact head: "Fab package" and the name on one line, the package's facts on one line below.
    const facts = chips.filter(Boolean).map(t => `<span>${esc(t)}</span>`);
    if (e.pinned) facts.push(`<span class="ov-note">${e.pinned.editedSince ? 'Profile edited since this run' : "Run's saved rules"}</span>`);
    if (pkg && pkg.layers.outline && e.status === 'ready') {
      const o = pkg.layers.outline;
      facts.push(`<span>Outline ${o.board.synthetic ? '<b class="ov-warn">not found</b>' : 'from ' + esc(o.file.name)} <button class="link-btn" data-act="outline-pick">${o.board.synthetic ? 'Pick' : 'Change'}</button></span>`);
    }
    const head = `<div class="page-head ov-head"><div class="page-head-text"><div class="ov-title"><span class="eyebrow">Fab package</span>` +
      `<h1 class="page-title" title="${esc(e.label)}">${esc(e.label)}</h1></div>${facts.length ? `<div class="ov-meta">${facts.join('<i class="sep">·</i>')}</div>` : ''}</div>`;
    const stageOn = !!(Fab.stage && pkg && pkg.boardBBox && pkg.layers.copper.length && (e.status === 'running' || e.status === 'ready'));
    const back = signoffProject(e) ? `<button class="btn" data-act="back-signoff">Back to Signoff EE</button>` : '';
    // The fab profile sits with the button that re-checks with it.
    const actions = back + profileSelect(e) + `<button class="btn" data-act="rerun"${busy || !pkg ? ' disabled' : ''}>Run checks again</button>` +
      // "Open board" lives in the inspection stage; without one (no board drawn), it stays up here.
      (stageOn ? '' : `<button class="btn btn-primary" data-act="view" data-view="board"${!pkg ? ' disabled' : ''}>Open board</button>`);
    let h = `<div class="page wide">` + head + `<div class="chips ov-actions">${actions}</div></div>`;
    if (pkg && e.status === 'ready' && (state.outlinePicker === e.id || (pkg.layers.outline && pkg.layers.outline.board.synthetic && pkg.outlineCands.length && state.outlinePicker !== 'closed:' + e.id))) h += outlinePickerHtml(e);
    const stat = (cls, n, label, sev) => `<button class="card stat ${cls}" style="border:none;text-align:left" data-act="sev" data-sev="${sev}"><div class="stat-num">${busy ? '–' : n}</div><div class="stat-label">${label}${!busy && wc[sev] ? `<span class="stat-waived">+${wc[sev]} waived</span>` : ''}</div></button>`;
    // The inspection stage leads the page, with its log folded under it; the totals follow.
    const stageHtml = Fab.stage && pkg && (e.status === 'running' || e.status === 'ready') ? Fab.stage.html(e, profile(e)) : '';
    if (stageHtml) h += stageHtml + logHtml(e, busy);
    h += `<div class="grid grid-4${stageHtml ? ' after-stage' : ''}">${stat('issue', c.error, 'Errors', 'error')}${stat('warn', c.warn, 'Warnings', 'warn')}${stat('info', c.info, 'Info', 'info')}<div class="card stat"><div class="stat-num">${pkg ? pkg.files.length : '–'}</div><div class="stat-label">Files in package</div></div></div>`;
    if (!busy && fresh) h += `<div class="card wv-alert"><span class="dot warn"></span><div>${plural(fresh, 'finding')} newly matched by a waiver rule. They're waived, but nobody has looked at them yet.</div><button class="btn" data-act="waived-show">Review</button></div>`;
    if (SHOW_MATRIX) h += `<div class="section-title">Checks <span class="muted mx-hint">Each box is one check; a click lists its findings.</span></div>` + matrixHtml(e, 'overview');
    else {
      h += `<div class="section-title">Checks</div><div class="grid grid-3">`;
      for (const [cat, title, desc] of CATS) {
        if (cat === 'Review' && !e.findings.some(f => f.category === cat)) continue;
        if (cat === 'Flex' && !(pkg && pkg.flex) && !e.findings.some(f => f.category === cat)) continue;
        const fs = e.findings.filter(f => f.category === cat), cc = liveCounts(e, fs), nw = fs.length - (cc.error + cc.warn + cc.info), tot = cc.error + cc.warn + cc.info || 1;
        h += `<button class="card cl-card cat-card" data-act="cat" data-cat="${cat}"><div class="cl-card-top"><div><div class="cl-card-title">${title}</div><div class="cl-card-desc">${desc}</div></div>` +
          `<span class="dot ${busy ? '' : cc.error ? 'error' : cc.warn ? 'warn' : 'ok'}" style="margin-top:6px"></span></div>` +
          // A finished check with no errors or warnings shows as a full "done" bar, like the run progress.
          (!busy && e.status === 'ready' && !cc.error && !cc.warn ? `<div class="bar"><i class="b-done" style="width:100%"></i></div>` :
            `<div class="bar"><i class="b-issue" style="width:${cc.error / tot * 100}%"></i><i class="b-warn" style="width:${cc.warn / tot * 100}%"></i><i class="b-info" style="width:${cc.info / tot * 100}%"></i></div>`) +
          `<div class="cl-card-foot"><span><b>${cc.error}</b> errors</span><span><b>${cc.warn}</b> warnings</span><span><b>${cc.info}</b> info</span>${nw ? `<span>${nw} waived</span>` : ''}</div></button>`;
      }
      h += `</div>`;
    }
    if (e.status === 'ready') h += signoffHtml(e);
    if (!stageHtml) h += `<div class="section-title">Run log <span class="chips"><span class="chip">${busy ? 'Running' : e.status === 'error' ? 'Failed' : 'Finished'}</span></span></div>` + consoleHtml(e);
    return h + '</div>';
  }

  // The run log, collapsed to its latest line beside the stage; it remembers being opened.
  function logHtml(e, busy) {
    const last = (e.log.filter(headline).pop() || { text: '' }).text;
    return `<details class="logbox"${state.logOpen ? ' open' : ''}><summary><span class="chip">${busy ? 'Running' : e.status === 'error' ? 'Failed' : 'Finished'}</span><b>Run log</b><span class="log-last" id="log-last">${esc(last)}</span></summary>` + consoleHtml(e) + `</details>`;
  }

  function consoleHtml(e, tall) {
    return `<div class="console${tall ? ' tall' : ''}"><div class="console-head"><b>fabcheck</b><span>${esc(e.label)}</span><span class="spacer"></span><button data-act="copy-log">Copy</button></div>` +
      `<div class="console-progress"><i id="console-progress" style="width:${Math.round(e.progress * 100)}%"></i></div>` +
      `<div class="console-body" id="console-body">${e.log.map(lineHtml).join('')}${e.status === 'ready' || e.status === 'error' ? '' : '<div class="ln"><span class="t"></span><span class="cursor"></span></div>'}</div></div>`;
  }

  // The Signoff EE project this run belongs to: sent there, or opened from one of its issues.
  function signoffProject(e) {
    return (e.sentTo && e.sentTo.projectId) || (e.link && e.link.project) || (e.need && e.need.link && e.need.link.project) || null;
  }

  // ── Fab rules ──
  function profileSelect(e) {
    const cur = e && e.pinned ? e.pinned.id : state.profile;
    const ps = Fab.rules.list();
    const opt = p => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}</option>`;
    let h = `<label class="tb-field">Fab profile <select data-act="profile">`;
    if (e && e.pinned && !Fab.rules.resolve(cur)) h += `<option value="" selected>${esc(e.pinned.name)} (run's saved rules)</option>`;
    h += `<optgroup label="Industry defaults">${ps.filter(p => p.builtin).map(opt).join('')}</optgroup>`;
    const mine = ps.filter(p => !p.builtin);
    if (mine.length) h += `<optgroup label="Custom">${mine.map(opt).join('')}</optgroup>`;
    return h + '</select></label>';
  }

  // Make a profile the active one and re-check the open package with it.
  function useProfile(id) {
    const r = Fab.rules.resolve(id);
    if (!r) return;
    const e = active();
    state.profile = id;
    state.thickness = r.values.thickness;
    if (e && e.pkg) {
      e.pinned = null;
      Fab.rules.remember(id, { pkgName: e.label, projectId: signoffProject(e) });
      if (e.status === 'ready') runChecks(e, `Profile changed to ${r.name}`);
    }
    renderAll();
  }

  let rerunTimer = 0, syncTimer = 0;
  // After a rule edit: re-check the open package if it uses this profile, and share with the team.
  function rulesEdited(id, what) {
    const e = active();
    clearTimeout(rerunTimer);
    if (what && e && e.status === 'ready' && !e.pinned && state.profile === id) {
      state.thickness = Fab.rules.resolve(id).values.thickness;
      rerunTimer = setTimeout(() => runChecks(e, what), 700);
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncProfiles, 2000);
  }
  async function syncProfiles() {
    if (!Fab.repoRuns) return;
    state.profileSync = { state: 'busy', text: "Checking the team's profiles…" };
    if (state.view === 'rules') renderAll();
    state.profileSync = await Fab.repoRuns.syncProfiles();
    if (state.view === 'rules') renderAll();
  }

  // The tab bar, with the board thickness on its right: the one DFM input that belongs to the board,
  // not the fab. Changing it re-checks the open package.
  const rulesTabs = () => {
    const e = active();
    return `<div class="rules-bar"><div class="seg rules-tabs" role="tablist">${[['profiles', 'Fab profiles'], ['checks', 'BOM & assembly checks']].map(([k, l]) =>
      `<button class="${(state.rulesTab || 'profiles') === k ? 'on' : ''}" data-act="rules-tab" data-tab="${k}" role="tab">${l}</button>`).join('')}</div>` +
      `<label class="tb-field" title="Finished thickness of the open board, used for aspect ratio. Changing it re-checks the open package; the profile's default thickness applies otherwise.">Board thickness <input data-act="thickness" type="number" step="0.01" min="0.05" max="6" value="${e && e.pinned ? e.pinned.thickness : state.thickness}"> mm</label></div>`;
  };

  // Show a check's catalog entry (from a finding's check tag).
  function showCheckDoc(key) {
    state.rulesTab = 'checks';
    state.checkSel = key;
    closeInspector();
    go('rules');
    const el = document.getElementById('chk-' + key);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  // A finding's check name: a link to its catalog entry when there is one.
  const checkTag = f => C.describe(f.category, f.check)
    ? `<button class="tag tag-link" data-act="check-doc" data-key="${esc(f.category + '/' + f.check)}" title="What this check looks for">${esc(f.check)}</button>`
    : `<span class="tag">${esc(f.check)}</span>`;

  // Read-only list of the package, assembly and BOM checks, generated from the check modules' own declarations.
  function checksHtml() {
    const e = active();
    const n = e && e.findings ? key => e.findings.filter(f => f.category + '/' + f.check === key).length : null;
    const sevs = [['error', 'Error'], ['warn', 'Warning'], ['info', 'Info']];
    let h = `<div class="page wide">` + pageHead(null, 'Fab rules', 'BOM & assembly checks', 'What Fabcheck looks for in the package, the build data and the BOM. These are logic, not numbers, so they are not editable; this list is generated from the checks themselves.') + rulesTabs();
    for (const [cat, title, sub] of CATS.filter(c => C.CATALOGED.includes(c[0]))) {
      const defs = C.catalog.filter(d => d.category === cat);
      h += `<div class="card sec"><div class="sec-head" style="cursor:default"><div class="sec-title">${esc(title)}<small>${defs.length} checks · ${esc(sub)}</small></div></div><div class="sec-body">`;
      for (const d of defs) {
        const rules = d.rules ? d.rules() : [];
        const hits = n ? n(d.key) : 0;
        h += `<div class="item check-doc${state.checkSel === d.key ? ' sel' : ''}" id="chk-${esc(d.key)}" style="cursor:default"><div>
          <div class="item-text"><b>${esc(d.name)}</b> <span class="tag">${esc(d.check)}</span></div>
          <div class="item-detail">${esc(d.looks)}</div>
          <div class="check-sev">${sevs.filter(([k]) => d.sev[k]).map(([k, l]) => `<div><span class="pill ${k === 'info' ? '' : k}">${l}</span>${esc(d.sev[k])}</div>`).join('')}</div>
          <div class="item-sub"><span>Uses: ${esc(d.uses.join(' · '))}</span></div>
          ${rules.length ? `<ul class="check-rules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          <div class="item-sub"><span>Example: “${esc(d.example)}”</span><span class="mono">${esc(d.source)}</span></div></div>
          <div class="item-right">${hits ? `<button class="btn btn-plain" data-act="check-findings" data-key="${esc(d.key)}">${plural(hits, 'finding')} in ${esc(e.label)}</button>` : ''}</div></div>`;
      }
      h += '</div></div>';
    }
    return h + '<p class="note">In patterns, # is a digit, {n} repeats the item before it n times, | separates alternatives, and case is ignored.</p></div>';
  }

  function rulesHtml() {
    if (state.rulesTab === 'checks') return checksHtml();
    const ps = Fab.rules.list();
    if (!state.rulesSel || !Fab.rules.resolve(state.rulesSel)) state.rulesSel = state.profile;
    const sel = Fab.rules.resolve(state.rulesSel) || ps[0];
    const e = active();
    const usedBy = e && e.pkg ? (e.pinned ? e.pinned.id : state.profile) : null;
    const item = p => {
      const sub = (p.builtin ? 'Typical values, read-only' : `From ${p.baseName} · ${Object.keys(p.edited).length} changed`) + (p.id === usedBy ? ' · in use' : '');
      return `<button class="proj${p.id === sel.id ? ' active' : ''}" data-act="rules-sel" data-id="${esc(p.id)}" title="${esc(p.name + ' · ' + sub)}"><span class="proj-body"><span class="proj-name">${esc(p.name)}</span><span class="proj-sub">${esc(sub)}</span></span></button>`;
    };
    const sync = state.profileSync;
    let h = `<div class="page wide">` + pageHead(null, 'Fab rules', 'Fab capability profiles', "The limits the DFM checks use. Start from an industry default, then duplicate it and enter a fab house's capability numbers.") + rulesTabs();
    h += `<div class="rules-layout"><div><div class="card" style="padding:8px">
      <div class="side-head"><span class="side-label">Industry defaults</span></div>${ps.filter(p => p.builtin).map(item).join('')}
      <div class="side-head" style="margin-top:8px"><span class="side-label">Custom</span><button class="btn btn-plain" style="padding:2px 6px;font-size:12px" data-act="profile-import">Import…</button></div>
      ${ps.filter(p => !p.builtin).map(item).join('') || '<div class="side-empty">None yet. Duplicate a profile to make one.</div>'}</div>
      <p class="note">${sync ? `<span class="dot ${sync.state === 'shared' ? 'ok' : sync.state === 'error' ? 'warn' : sync.state === 'busy' ? 'info' : ''}" style="margin-right:6px"></span>${esc(sync.text)}` : 'Custom profiles are kept in this browser.'}</p></div>`;
    h += `<div><div class="card" style="padding:18px 20px;margin-bottom:14px">`;
    if (sel.builtin) {
      h += `<div class="eyebrow">Industry default · typical values</div><h2 style="font:600 20px var(--display);margin:2px 0 6px">${esc(sel.name)}</h2>` +
        `<p style="margin:0 0 12px;color:var(--text-2)">${esc(sel.desc || '')} These are typical values, not any particular fab house's. To match a fab house, duplicate this profile and enter the numbers from its capability sheet.</p>`;
    } else {
      const n = sel.notes || {};
      h += `<div class="eyebrow">Custom profile · from ${esc(sel.baseName)}</div>
        <input class="input" data-act="profile-name" value="${esc(sel.name)}" style="font:600 18px var(--display);margin:4px 0 12px">
        <div class="row2"><div class="field"><label>Fab house / source</label><input class="input" data-act="profile-note" data-key="source" value="${esc(n.source || '')}" placeholder="e.g. the fab house's capability page"></div>
        <div class="field"><label>Capability doc or URL</label><input class="input" data-act="profile-note" data-key="url" value="${esc(n.url || '')}" placeholder="https://… or document number"></div></div>
        <div class="row2"><div class="field"><label>Date of the numbers</label><input class="input" data-act="profile-note" data-key="date" value="${esc(n.date || '')}" placeholder="e.g. 2026-10"></div>
        <div class="field"><label>Notes</label><input class="input" data-act="profile-note" data-key="text" value="${esc(n.text || '')}" placeholder="2-layer, 1 oz, HASL…"></div></div>`;
    }
    h += `<div class="chips">${e && e.pkg ? (sel.id === usedBy ? `<span class="chip accent">In use for ${esc(e.label)}</span>` : `<button class="btn btn-primary" data-act="profile-use" data-id="${esc(sel.id)}">Use for ${esc(e.label)}</button>`) : ''}
      <button class="btn" data-act="profile-dup" data-id="${esc(sel.id)}">${sel.builtin ? 'Duplicate and edit' : 'Duplicate'}</button>
      <button class="btn" data-act="profile-export" data-id="${esc(sel.id)}">Export JSON</button>
      ${sel.builtin ? '' : `<button class="btn" data-act="profile-reset-all" data-id="${esc(sel.id)}"${Object.keys(sel.edited).length ? '' : ' disabled'}>Reset all to ${esc(sel.baseName)}</button><button class="btn btn-danger" data-act="profile-delete" data-id="${esc(sel.id)}">Delete</button>`}</div></div>`;
    const base = Fab.rules.resolve(sel.base);
    for (const g of Fab.rules.GROUPS) {
      h += `<div class="card sec"><div class="sec-head" style="cursor:default"><div class="sec-title">${esc(g)}</div></div><div class="sec-body">`;
      for (const r of Fab.rules.RULES.filter(x => x.group === g)) {
        const v = sel.values[r.key], bv = base.values[r.key], edited = !sel.builtin && v !== bv;
        const issues = Fab.rules.validate(r.key, v, sel.values);
        const unit = { mm: 'mm', mm2: 'mm²', ratio: ': 1', count: '', pct: '% points' }[r.unit];
        h += `<div class="item rule-row" style="cursor:default"><div class="rule-name"><b>${esc(r.name)}</b><div class="muted">${esc(r.desc)}</div>
          <div class="item-sub">${r.checks.length ? 'Used by ' + r.checks.map(c => `<span class="tag">${esc(c)}</span>`).join('') : '<span class="muted">Not checked yet</span>'}</div></div>
          <div class="rule-val"><div><input class="input" type="number" step="${r.unit === 'count' ? 1 : r.unit === 'ratio' ? 0.5 : 0.001}" data-act="rule" data-key="${r.key}" value="${v}"${sel.builtin ? ' disabled' : ''}><span class="unit">${unit}</span></div>
            ${r.unit === 'mm' ? `<div class="muted">${Fab.mil(v)}</div>` : ''}
            ${edited ? `<div class="muted rule-base">${esc(sel.baseName)}: ${esc(Fab.rules.fmtVal(r, bv))} <button class="btn btn-plain" style="padding:0 4px;font-size:12px" data-act="rule-reset" data-key="${r.key}">Reset</button></div>` : ''}
            ${issues.map(i => `<div class="rule-${i.level}">${esc(i.text)}</div>`).join('')}</div></div>`;
      }
      h += '</div></div>';
    }
    return h + '</div></div></div>';
  }

  // ── Send to Signoff ──
  // One issue per check and severity. Details lists them, each with a checkbox; the keys left out
  // (check|severity, so they survive a re-run) are in e.signoffSkip. Waived findings, sent as
  // reference rows, start unticked: a waived group's key goes into the skip set the first time it
  // shows (e.signoffSeen), and from then on follows its box.
  function sendSkip(e, groups) {
    const skip = e.signoffSkip || (e.signoffSkip = new Set()), seen = e.signoffSeen || (e.signoffSeen = new Set());
    for (const g of groups) if (g.waived && !seen.has(g.key)) { seen.add(g.key); skip.add(g.key); }
    return skip;
  }
  function signoffHtml(e) {
    const groups = sendPlan(e);
    const skip = sendSkip(e, groups);
    let h =`<div class="section-title">Send to Signoff EE</div><div class="card" style="padding:18px 20px">`;
    const projects = Fab.signoff.projects();
    const signedIn = !Fab.repoRuns || Fab.repoRuns.signedIn();
    if (!projects.length) {
      if (Fab.DEMO) return h + `<p style="margin:0 0 12px;color:var(--text-2)">No Signoff EE demo projects in this browser yet. Open the <a href="${Fab.demoHref('../ee_design_review/index.html')}" style="color:var(--accent)">Signoff EE demo</a> once (it sets up its sample projects in this browser), then come back.</p></div>`;
      // Fabcheck is a public tool: this is only for people who review boards in Signoff.
      return h + `<p style="margin:0 0 12px;color:var(--text-2)">For design reviews in Signoff EE: send this run's issues to a board's review, with the fab package, which Signoff keeps as one of the board's revisions. ${signedIn ? 'Open <a href="../ee_design_review/index.html" style="color:var(--accent)">Signoff EE</a> once at this same address (it keeps its projects in this browser), then come back.' : 'Sign in with GitHub, then open Signoff EE once at this same address.'}</p>` +
        (signedIn ? '' : `<button class="btn" data-act="gh-signin">Sign in with GitHub…</button>`) + '</div>';
    }
    // The board's project: the one this run was sent to or opened from, else a guess from the package
    // name (e.g. PCB-1042-03 → board PCB-1042).
    if (!e.signoffSlug || !projects.some(p => p.slug === e.signoffSlug)) {
      const lab = e.label.toLowerCase(), pid = signoffProject(e);
      const guess = (pid && projects.find(p => p.id === pid)) || projects.find(p => [p.meta.board, p.meta.name].some(s => s && lab.includes(String(s).toLowerCase().replace(/\s+/g, '')))) ||
        projects.find(p => (p.meta.checklists || []).includes('fab')) || projects[0];
      e.signoffSlug = guess.slug;
    }
    const target = projects.find(p => p.slug === e.signoffSlug);
    const pv = Fab.signoff.preview(e.signoffSlug, groups);
    const pickedAll = pv.rows.filter(r => !skip.has(r.group.key)), nRef = pickedAll.filter(r => r.group.waived).length;
    const picked = pickedAll.filter(r => !r.group.waived), nIssues = pv.rows.filter(r => !r.group.waived).length;
    const major = picked.filter(r => r.severity === 'major').length, fresh = picked.filter(r => r.state !== 'update').length;
    const infoNotes = picked.some(r => r.group.severity === 'info');
    const sevs = [major && `${major} Major from errors`, picked.length - major && `${picked.length - major} Minor from warnings${infoNotes ? ' and Info notes' : ''}`].filter(Boolean).join(', ');
    const news = [fresh && `${fresh} new`, picked.length - fresh && `${picked.length - fresh} updating ${picked.length - fresh === 1 ? 'an issue' : 'issues'} sent before`].filter(Boolean).join(', ');
    const issues = !nIssues ? 'No errors, warnings or review notes to send; earlier Fabcheck issues get a "no longer found" note.' : picked.length ? `Sends ${picked.length < nIssues ? picked.length + ' of ' : ''}${plural(nIssues, 'issue')} to the Fabrication &amp; Release checklist (${sevs}; ${news}).` : `No issues picked, so none are sent (${plural(nIssues, 'issue')} available)${Fab.repoRuns ? '; sending still stores the run and its fab package' : ''}, and earlier issues for these checks stay as they are.`;
    const refNote = nRef ? ` Also sends ${plural(nRef, 'group')} of waived findings, kept in Signoff for reference and counted nowhere.` : pv.rows.some(r => r.group.waived) ? ' Waived findings stay in Fabcheck (tick Waived under Details to send them for reference).' : '';
    h += `<p style="margin:0 0 12px;color:var(--text-2)">${issues}${refNote} Sending again updates the same issues and keeps the reviewer's status. ${Fab.DEMO ? 'In this demo they go to the Signoff EE demo in this browser.' : "Signoff's Sync then pushes the issues, and its Revisions tab lists the stored run, where it can be tagged and downloaded."}</p>
      <div class="filters" style="margin:0"><label class="tb-field" style="font-size:13px">Project <select data-act="signoff-project">${projects.map(p => `<option value="${esc(p.slug)}"${p.slug === e.signoffSlug ? ' selected' : ''}>${esc(p.meta.name)}${p.meta.board ? ' · ' + esc(p.meta.board) : ''}${(p.meta.checklists || []).includes('fab') ? '' : ' (no Fab checklist)'}</option>`).join('')}</select></label>
      <button class="btn btn-primary" data-act="signoff-send"${e.signoffBusy ? ' disabled' : ''}>${e.signoffBusy ? 'Storing…' : 'Send to Signoff EE'}</button><button class="btn so-toggle${e.signoffOpen ? ' open' : ''}" data-act="signoff-details" aria-expanded="${!!e.signoffOpen}">Details${ICON.chev}</button>${e.signoffResult ? `<a class="btn btn-plain" href="${Fab.demoHref('../ee_design_review/index.html')}">Open Signoff EE</a>` : ''}</div>`;
    if (e.signoffOpen) h += (groups.length ? signoffListHtml(e, pv, skip) : '') + (Fab.repoRuns ? filesPickHtml(e) : '');
    if (!(target.meta.checklists || []).includes('fab')) h += `<p class="note">This project doesn't use the Fabrication &amp; Release checklist, so the issues won't show until you add it in the project's details in Signoff EE.</p>`;
    h += storageHtml(e, target.id);
    if (e.signoffBlocked) h += `<div class="note" style="color:var(--warn)">Not sent: the run couldn't be stored (${esc(e.signoffBlocked)}). Without it, Signoff can't list the run or download its package.
      <div style="margin-top:8px"><button class="btn" data-act="signoff-send">Try again</button> <button class="btn btn-plain" data-act="signoff-send-anyway">Send without storing</button></div></div>`;
    if (e.signoffResult) h += `<p class="note" style="color:var(--pass)">${esc(e.signoffResult)}</p>`;
    if (Fab.repoRuns && signedIn) h += `<p class="note">Signed in to GitHub in this browser. <button class="btn btn-plain" style="padding:0 4px;font-size:12px" data-act="gh-signout">Sign out</button> (Signoff EE shares the sign-in)</p>`;
    return h + '</div>';
  }

  // Send to Signoff stores the run with its fab package in the project's repo first, so every issue
  // carries where the run is, and Signoff lists it (docs/signoff-revisions.md). If it can't be
  // stored, nothing is sent until the user picks "Send without storing".
  // A wait that says what it is doing: a card over the page with a spinner, a step line and a bar
  // (styles: .busy in suite.css, from Signoff EE). The spinner keeps turning while the zip is built.
  // Returns { step(text, fraction), stop(text, actions), close() }; actions are [label, fn, primary].
  function busyCard(title) {
    const old = document.getElementById('busy-wrap'); if (old) old.remove();
    const w = document.createElement('div');
    w.className = 'sheet-wrap'; w.id = 'busy-wrap';
    w.innerHTML = `<div class="sheet busy" role="status" aria-live="polite"><div class="busy-row"><span class="busy-spin" aria-hidden="true"></span><div style="flex:1;min-width:0">` +
      `<div class="busy-title">${esc(title)}</div><div class="busy-step"></div><div class="busy-bar"><i></i></div></div></div><div class="busy-acts"></div></div>`;
    document.body.appendChild(w);
    const card = w.firstChild, stepEl = w.querySelector('.busy-step'), bar = w.querySelector('.busy-bar i'), acts = w.querySelector('.busy-acts');
    const close = () => w.remove();
    return {
      step(text, frac) { stepEl.textContent = text; if (frac != null) bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; },
      stop(text, actions, newTitle) {
        card.classList.add('done'); stepEl.textContent = text;
        if (newTitle) w.querySelector('.busy-title').textContent = newTitle;
        acts.innerHTML = '';
        for (const [label, fn, primary] of actions || [['Close', null, true]]) {
          const b = document.createElement('button');
          b.className = 'btn' + (primary ? ' btn-primary' : ''); b.textContent = label;
          b.addEventListener('click', () => { close(); if (fn) fn(); }); acts.appendChild(b);
        }
        const p = acts.querySelector('.btn-primary'); if (p) p.focus();
      },
      close,
    };
  }
  // Let the card paint before work that holds the main thread (requestAnimationFrame stalls in a hidden tab).
  const paint = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
  window.addEventListener('pageshow', ev => { if (ev.persisted) { const b = document.getElementById('busy-wrap'); if (b) b.remove(); } });

  async function sendToSignoff(e, anyway) {
    if (e.signoffBusy) return;
    const target = Fab.signoff.projects().find(p => p.slug === e.signoffSlug);
    if (!target) { toast('That Signoff project is no longer in this browser'); return; }
    // Fabcheck is a public tool: GitHub sign-in comes only when someone sends.
    if (Fab.repoRuns && !anyway && !Fab.repoRuns.signedIn()) { showSignIn(() => sendToSignoff(e, anyway)); return; }
    e.signoffBlocked = null; e.signoffResult = null;
    state.repoProbe.delete(target.id);
    let card = null;
    if (Fab.repoRuns && e.run && !anyway) {
      if (!e.files || e.files.some(f => f.stub)) { toast('This package was reopened from a kept run, so its drawings and other fab files are not here. Drop the package in again to send it.'); return; }
      let pkg;
      card = busyCard('Sending to Signoff EE');
      card.step('Building the fab package…', 0.05);
      await paint();
      try {
        const f = verForm(e);
        pkg = await Fab.releases.packageFor(e, { pn: f.pn, rev: f.rev, picks: f.picks, head: `Sent to Signoff EE by Fabcheck (run ${e.run.id})` });
      } catch (err) { card.stop('Could not make the fab package: ' + (err.message || err), null, 'Not sent'); return; }
      // The confirm names the package's size, so the card steps aside for it.
      card.close();
      if (!confirmStore(Fab.repoRuns.home(target.id).repo, pkg)) return;
      e.signoffBusy = true; renderAll();
      card = busyCard('Sending to Signoff EE');
      card.step('Drawing pictures of the board…', 0.15);
      await paint();
      const got = await Fab.repoRuns.store(e, target.id, pkg, (cls, t) => log(e, cls, t), (t, frac) => card.step(t, frac));
      e.signoffBusy = false;
      if (!got.ok) { e.signoffBlocked = got.why; renderAll(); card.stop(`The run couldn't be stored (${got.why}). Nothing was sent; the Send panel offers to send without storing.`, null, 'Not sent'); return; }
    } else {
      card = busyCard('Sending to Signoff EE');
    }
    card.step('Writing the issues into Signoff EE…', 0.95);
    await paint();
    try {
      const run = e.run ? Object.assign({}, e.run) : null;
      // A run stored with another project isn't stored with this one.
      if (run && run.stored && Fab.repoRuns) {
        const h = Fab.repoRuns.home(target.id);
        if (run.stored.repo !== h.repo || run.stored.dir !== h.dir) run.stored = null;
      }
      const plan = sendPlan(e);
      sendSkip(e, plan);
      const r = Fab.signoff.send(e.signoffSlug, plan, { label: e.label, sha: run ? run.package.sha256 : null, run, profileName: run ? run.settings.profileName : profileName(e) }, e.signoffSkip);
      if (run) Fab.rules.remember(run.settings.profile, { projectId: r.projectId });
      // Waivers made before the run was linked to this project (kept under the package name) come along.
      const was = scopeOf(e);
      e.sentTo = { projectId: r.projectId, name: r.name };
      if (Fab.waivers.mergeScope(was, scopeOf(e))) log(e, 'dim', `         Waivers made for ${e.label} now belong to "${r.name}" too.`);
      if (run) await Fab.store.updateRun(run.id, { sentTo: e.sentTo });
      e.signoffResult = `Sent to "${r.name}": ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} left out` : ''}${r.resolvedNotes ? `, ${r.resolvedNotes} earlier issue(s) noted as no longer found` : ''}${r.dropped ? `, ${r.dropped} reference row(s) removed` : ''}. ${Fab.DEMO ? 'Open Signoff EE to see them.' : 'Sync in Signoff EE to push them; its Revisions tab lists the run.'}`;
      log(e, 'ok', e.signoffResult);
      if (anyway) log(e, 'warn', 'Sent without storing: Signoff can\'t list this run or download its package until it is sent again and stored.');
      card.stop(e.signoffResult, [['Stay in Fabcheck', null], ['Open in Signoff EE', () => Fab.signoff.openFindings(r.projectId), true]], 'Sent to Signoff EE');
    } catch (err) { card.stop('Could not send: ' + err.message, null, 'Not sent'); }
    renderAll();
  }

  // GitHub sign-in, asked for the first time someone sends (Fabcheck is otherwise a public tool).
  // The token goes where Signoff EE keeps it, so one sign-in covers both.
  function showSignIn(next) {
    if (!Fab.repoRuns || document.getElementById('signin')) return;
    const w = document.createElement('div');
    w.className = 'sheet-wrap'; w.id = 'signin';
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="si-title"><div class="sheet-head"><h2 id="si-title">Sign in to GitHub</h2>
      <p>Signoff keeps each board's review in a private GitHub repository. To store the run and its fab package there and send issues, Fabcheck needs a GitHub token that can write to those repositories. It stays in this browser and is sent only to GitHub.</p></div>
      <div class="sheet-body"><label class="tb-field" style="font-size:13px;display:flex;flex-direction:column;align-items:stretch;gap:4px">Personal access token<input id="si-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
      <p class="note"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--accent)">Create a token on GitHub</a>: fine-grained, with access to your Signoff repositories and Contents set to read and write. Signoff EE uses the same token.</p>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="si-remember"> Remember it after closing the browser (avoid on shared computers)</label>
      <p class="note" id="si-msg" role="status"></p></div>
      <div class="sheet-foot"><button class="btn" data-si="cancel">Cancel</button><button class="btn btn-primary" data-si="ok">Sign in</button></div></div>`;
    document.body.appendChild(w);
    const input = w.querySelector('#si-token'), msg = w.querySelector('#si-msg');
    const close = () => { w.remove(); document.removeEventListener('keydown', onKey); };
    const submit = async () => {
      msg.style.color = ''; msg.textContent = 'Checking with GitHub…';
      try {
        const login = await Fab.repoRuns.signIn(input.value, w.querySelector('#si-remember').checked);
        close(); state.repoProbe.clear();
        toast(`Signed in to GitHub as ${login}`);
        renderAll();
        if (next) next();
      } catch (err) {
        msg.style.color = 'var(--warn)';
        msg.textContent = err.status === 401 ? 'GitHub didn\'t accept that token (mistyped, expired or revoked?).' : 'Couldn\'t sign in: ' + (err.message || err);
      }
    };
    const onKey = ev => { if (ev.key === 'Escape') close(); if (ev.key === 'Enter' && ev.target === input) submit(); };
    document.addEventListener('keydown', onKey);
    w.addEventListener('click', ev => { if (ev.target === w || ev.target.closest('[data-si="cancel"]')) close(); else if (ev.target.closest('[data-si="ok"]')) submit(); });
    input.focus();
  }

  // Nothing leaves the browser without saying where it goes; Cancel keeps it all here.
  function confirmStore(repo, pkg) {
    return confirm(`This run, its findings and the fab package (${pkg.name}: ${plural(pkg.files.length, 'file')}, ${(pkg.bytes.length / 1048576).toFixed(2)} MB), plus top and bottom pictures of the board, will be stored in the private repository ${repo}, where everyone with access to the project can open and download them.\n\nOK to store them and send the issues. Cancel to keep everything in this browser.`);
  }

  // Where Send will store the run, or why it can't, from a cached check of the project's repo.
  function storageHtml(e, projectId) {
    if (!Fab.repoRuns) return '';
    if (!e.run) return `<p class="note">This run wasn't kept in this browser, so it can't be stored with the issues.</p>`;
    if (!Fab.repoRuns.signedIn()) return `<p class="note">Sending stores the run and its fab package in ${esc(Fab.repoRuns.home(projectId).repo)}, the project's private repository, and asks you to sign in to GitHub first.</p>`;
    const pr = state.repoProbe.get(projectId);
    if (!pr) {
      state.repoProbe.set(projectId, { busy: true });
      Fab.repoRuns.probe(projectId).then(r => { state.repoProbe.set(projectId, r); renderAll(); });
    }
    if (!pr || pr.busy) return `<p class="note">Checking access to ${esc(Fab.repoRuns.home(projectId).repo)}…</p>`;
    if (!pr.ok) return `<p class="note" style="color:var(--warn)">Can't store the run in ${esc(pr.repo)}: ${esc(pr.text)}.</p>`;
    if (e.run.stored && e.run.stored.repo === pr.repo && e.run.package.zip) return `<p class="note">This run and its fab package are stored in ${esc(pr.repo)}.</p>`;
    return `<p class="note">Sending stores this run and its fab package in ${esc(pr.repo)}, the project's private repository, where Signoff EE lists it and anyone with access to the project can download it.</p>`;
  }

  // The issues Send would write, one row each: what Signoff will show, where it goes, whether it's
  // new, and its findings (the first 25, as in the issue's hint) under a fold.
  // Which "all of this kind" box on Send's list an issue belongs to.
  // Waived groups have their own box (unticked by default); All issues leaves them as they are.
  const sendKind = g => g.waived ? 'waived' : g.note ? 'notes' : g.severity;
  function signoffListHtml(e, pv, skip) {
    const says = { new: 'New issue', deleted: 'Re-raises a deleted issue', update: 'Updates the issue sent before' };
    const saysRef = { new: 'New reference row', deleted: 'Brings back a removed reference row', update: 'Updates the reference row sent before' };
    const all = pv.rows.filter(r => !r.group.waived).every(r => !skip.has(r.group.key));
    // All issues, or all errors / all warnings: ticked when every issue of that kind is picked.
    // Errors and Warnings are the checks' issues; Review notes are the reviewers' notes, of any severity.
    const sevBox = (sev, label) => {
      const rows = pv.rows.filter(r => sendKind(r.group) === sev);
      if (!rows.length) return '';
      return `<label class="so-all"><input type="checkbox" id="so-${sev}" data-act="signoff-sev" data-sev="${sev}"${rows.every(r => !skip.has(r.group.key)) ? ' checked' : ''}> ${label} (${rows.length})</label>`;
    };
    let h = `<div class="so-list"><div class="so-alls"><label class="so-all"><input type="checkbox" id="so-all" data-act="signoff-all"${all ? ' checked' : ''}> All issues</label>${sevBox('error', 'Errors')}${sevBox('warn', 'Warnings')}${sevBox('notes', 'Review notes')}${sevBox('waived', 'Waived, for reference')}</div>`;
    pv.rows.forEach((r, i) => {
      const g = r.group, n = g.list.length, on = !skip.has(g.key);
      h += `<div class="so-row${on ? '' : ' off'}"><input type="checkbox" id="so-${i}" data-act="signoff-pick" data-key="${esc(g.key)}"${on ? ' checked' : ''}>` +
        `<div><label class="item-text" for="so-${i}">${esc(r.text)}</label>` +
        `<div class="item-sub">${g.waived ? '<span class="res waived">Waived · reference</span>' : `<span class="sev ${r.severity}">${r.severity === 'major' ? 'Major' : 'Minor'}</span>`}${checkTag(g.list[0])}<span>${esc(r.section)}</span><span>${(g.waived ? saysRef : says)[r.state]}${r.resolution ? ` <span class="res ${r.resolution}">${r.resolution === 'fixed' ? 'Fixed' : 'Waived'}</span>` : ''}</span></div>` +
        `<details class="so-locs" data-key="${esc(g.key)}"${e.signoffShown && e.signoffShown.has(g.key) ? ' open' : ''}><summary>${g.note ? 'Review note' : plural(n, (g.waived ? 'waived ' : '') + (g.severity === 'error' ? 'error' : 'warning'))}</summary><ul>` +
        g.list.slice(0, 25).map(f => { const w = whereText(f); return `<li>${esc(f.title)}${w || f.layer ? `<span class="muted"> · ${[w, f.layer].filter(Boolean).map(esc).join(', ')}</span>` : ''}</li>`; }).join('') +
        (n > 25 ? `<li class="muted">… ${n - 25} more</li>` : '') + `</ul></details></div></div>`;
    });
    if (pv.gone.length) h += `<div class="so-gone">Sent before and not found by this run, so each gets a "no longer found" note: ${pv.gone.map(t => `<b>${esc(t)}</b>`).join(', ')}.</div>`;
    if (pv.dropped && pv.dropped.length) h += `<div class="so-gone">Reference rows sent before whose findings aren't waived any more, so they are removed: ${pv.dropped.map(t => `<b>${esc(t)}</b>`).join(', ')}.</div>`;
    return h + '</div>';
  }

  // ── Findings view ──
  // After a filter change: a selected finding the filters now hide is no longer selected, so the
  // board drops its crosshair and the dimming that served it. Selecting a finding brings them back.
  // (Selections that aren't findings, such as a part or a deep-link point, are left alone.)
  function dropHiddenSel(e) {
    const f = e && state.sel && e.findings.find(x => x.id === state.sel);
    if (!f) return;
    const fc = state.focusCheck;
    if (visibleFindings(e).includes(f) && (!fc || f.check === fc)) return;
    state.sel = null;
    if (viewer) { viewer.highlight = null; viewer.focusLayer = null; }
  }

  function visibleFindings(e) {
    const q = state.q.trim().toLowerCase();
    // The category and check filters belong to Findings, which shows them (the category bar, the chip);
    // the board rail has no control for them, so it keeps only severity and search (and its own
    // focusCheck, from deep links).
    const onFindings = state.view === 'findings', cat = onFindings ? state.cat : null, chk = onFindings ? state.check : null;
    return e.findings.filter(f => state.filter[f.severity] && (!cat || f.category === cat) && (!chk || f.category + '/' + f.check === chk) &&
      (!q || (f.check + ' ' + f.title + ' ' + (f.detail || '') + ' ' + (f.refs || []).join(' ') + ' ' + (f.layer || '')).toLowerCase().includes(q)));
  }
  function whereText(f) {
    if (f.at) return `${f.at.x.toFixed(2)}, ${f.at.y.toFixed(2)} mm`;
    if (f.bbox) return `${((f.bbox[0] + f.bbox[2]) / 2).toFixed(2)}, ${((f.bbox[1] + f.bbox[3]) / 2).toFixed(2)} mm`;
    return '';
  }
  // The severity filter, the same on Findings and beside the board: symbol, name and count. In a
  // narrow list "Warnings" becomes "Warn".
  const sevButtons = c => ['error', 'warn', 'info'].map(s => `<button class="${state.filter[s] ? 'on' : ''}" data-act="sev-toggle" data-sev="${s}"><span class="dot ${s}"></span>${s === 'warn' ? '<span class="sev-long">Warnings</span><span class="sev-short">Warn</span>' : { error: 'Errors', info: 'Info' }[s]}<span class="count">${c[s]}</span></button>`).join('');

  function findingsHtml(e) {
    const c = liveCounts(e);
    const order = { error: 0, warn: 1, info: 2 };
    const sevSeg = sevButtons(c);
    const catSeg = [[null, 'All']].concat(CATS.map(x => [x[0], x[1]])).map(([k, l]) => `<button class="${state.cat === k ? 'on' : ''}" data-act="cat-filter" data-cat="${k || ''}">${l}</button>`).join('');
    const nWaived = waivedOf(e, e.findings).length;
    let h = `<div class="page">` + pageHead(e, 'Findings', e.label, `${plural(c.error, 'error')}<span class="sep">·</span>${plural(c.warn, 'warning')}<span class="sep">·</span>${c.info} info${nWaived ? `<span class="sep">·</span>${nWaived} waived` : ''}`);
    if (SHOW_MATRIX) h += matrixHtml(e, 'findings');
    const chk = state.check && state.check.split('/'), chkName = chk && ((matrixChecks(chk[0], []).find(x => x[0] === chk[1]) || [])[1] || chk[1]);
    h += `<div class="filters"><div class="search">${ICON.search}<input id="f-search" type="search" placeholder="Filter findings" value="${esc(state.q)}"></div><div class="seg sev-seg">${sevSeg}</div><div class="seg">${catSeg}</div>` +
      (chk ? `<span class="chip chip-x">Check: ${esc(chkName)}<button class="icon-btn" data-act="mx-clear" aria-label="Show all checks">${ICON.close}</button></span>` : '') + `</div>`;
    const shown = visibleFindings(e), fs = activeOf(e, shown), waived = waivedOf(e, shown);
    if (e.status !== 'ready') h += `<div class="card" style="padding:16px;margin-bottom:14px;color:var(--text-3)">Checks are still running; the list fills in as they finish.</div>`;
    const row = f => {
      const where = whereText(f), w = waiverOf(e, f), st = !w && staleOf(e, f);
      const tags = w ? `<span class="wv-tag${w.state === 'new' ? ' new' : ''}">${w.state === 'new' ? 'New match · ' : 'Waived · '}${esc(w.rule.reason || '')}</span>` : st ? `<span class="wv-tag stale">Waiver out of date</span>` : '';
      return `<div class="item f-row${state.sel === f.id ? ' sel' : ''}${w ? ' waived' : ''}" data-act="finding" data-id="${esc(f.id)}"><span class="dot ${esc(f.severity)}"></span>` +
        `<div><div class="item-text">${esc(f.title)}</div>${f.detail ? `<div class="item-detail">${esc(f.detail)}</div>` : ''}<div class="item-sub">${checkTag(f)}${f.layer ? `<span>${esc(f.layer)}</span>` : ''}${tags}</div></div>` +
        `<div class="item-right">${where ? `<span class="loc">${where}</span>` : ''}</div></div>`;
    };
    for (const [cat, title] of CATS) {
      const list = fs.filter(f => f.category === cat).sort((a, b) => order[a.severity] - order[b.severity]);
      if (!list.length) continue;
      const cc = counts(list);
      h += `<div class="card sec${state.closed.has(cat) ? ' collapsed' : ''}" data-cat="${cat}"><div class="sec-head" data-act="toggle-sec">${ICON.chev}<div class="sec-title">${title}<small>${list.length} shown</small></div><div class="sec-meta">${cc.error ? `<span class="pill error">${cc.error}</span>` : ''}${cc.warn ? `<span class="pill warn">${cc.warn}</span>` : ''}</div></div><div class="sec-body">`;
      // Errors and warnings that are only about test points fold into one row (closed until opened),
      // after the other errors and warnings, so dozens of probe pads don't bury the rest.
      const tps = list.filter(f => f.tp), rest = list.filter(f => !f.tp);
      for (const f of rest.filter(f => f.severity !== 'info')) h += row(f);
      if (tps.length) {
        const open = state.tpOpen.has(cat) || tps.some(f => f.id === state.sel), tc = counts(tps);
        const des = [...new Set(tps.flatMap(f => f.refs || []))].sort(Fab.natCmp);
        h += `<div class="tp-group${open ? ' open' : ''}" data-cat="${cat}"><div class="item tp-head" data-act="tp-toggle">${ICON.chev}` +
          `<div><div class="item-text">Test points<small>${plural(tps.length, 'finding')} on ${plural(des.length, 'test point')}</small></div>` +
          `<div class="item-detail">${esc(des.slice(0, 24).join(', ') + (des.length > 24 ? ' …' : ''))}</div></div>` +
          `<div class="item-right">${tc.error ? `<span class="pill error">${tc.error}</span>` : ''}${tc.warn ? `<span class="pill warn">${tc.warn}</span>` : ''}</div></div>` +
          `<div class="tp-body">${open ? tps.map(row).join('') : ''}</div></div>`;
      }
      for (const f of rest.filter(f => f.severity === 'info')) h += row(f);
      h += `</div></div>`;
    }
    if (!fs.length) h += `<div class="empty"><h2>${waived.length ? 'Nothing left to look at' : 'Nothing to show'}</h2><p>${waived.length ? 'Every finding these filters show is waived.' : 'No findings match these filters.'}</p></div>`;
    if (waived.length) h += waivedHtml(e, waived, row);
    return h + waiversHtml(e) + '</div>';
  }

  // The waived findings these filters show, in one fold at the end of the page (closed until opened,
  // and opened for a selected finding inside it). New matches of a rule come first.
  function waivedHtml(e, list, row) {
    const order = { error: 0, warn: 1 };
    const isNew = f => (waiverOf(e, f) || {}).state === 'new';
    const fresh = list.filter(isNew).length, cc = counts(list);
    const open = state.waivedOpen || list.some(f => f.id === state.sel);
    let body = '';
    if (open) {
      for (const [cat, title] of CATS) {
        const fs = list.filter(f => f.category === cat).sort((a, b) => (isNew(b) - isNew(a)) || order[a.severity] - order[b.severity]);
        if (fs.length) body += `<div class="cat-label wv-cat">${title} · ${fs.length}</div>` + fs.map(row).join('');
      }
    }
    return `<div class="card sec wv-sec${open ? '' : ' collapsed'}" id="waived-sec"><div class="sec-head" data-act="waived-toggle">${ICON.chev}<div class="sec-title">Waived<small>${plural(list.length, 'finding')}</small></div>` +
      `<div class="sec-meta">${fresh ? `<span class="pill warn" title="Matched by a rule since it was made: waived, but not looked at yet">${fresh} new</span>` : ''}${cc.error ? `<span class="pill muted">${cc.error} err</span>` : ''}${cc.warn ? `<span class="pill muted">${cc.warn} warn</span>` : ''}</div></div>` +
      `<div class="sec-body">${body}</div></div>`;
  }

  // The waiver rules and part types of this run's scope, with what each matches now.
  function waiversHtml(e) {
    const W = Fab.waivers, scope = scopeOf(e), rules = W.rules(scope), kinds = W.kinds(scope);
    if (!rules.length && !kinds.length) return '';
    const hits = wv(e).hits, pid = signoffProject(e);
    const where = pid ? `the Signoff project ${esc((Fab.signoff.projects().find(p => p.id === pid) || { meta: { name: pid } }).meta.name)}` : `packages named ${esc(e.label)}`;
    let h = `<div class="section-title">Waivers <span class="muted mx-hint">Kept in this browser for ${where}; they apply to every run of it.</span></div><div class="card wv-list">`;
    for (const r of rules) {
      const hit = hits.get(r.id) || { n: 0, fresh: 0, found: new Set() };
      const lost = r.kind === 'one' && hit.found.size < r.items.length;
      const fmt = r.check ? unitFor(r.check.split('/')[1]) : null;
      const now = hit.n ? `${hit.n} waived now${hit.fresh ? `, <b class="t-warn">${hit.fresh} new</b>` : ''}` : lost ? 'Not found in this run' : 'Matches nothing in this run';
      h += `<div class="wv-rule"><div><div class="item-text">${esc(r.reason || '(no reason)')}</div>` +
        `<div class="item-sub"><span>${esc(W.describe(r, fmt))}</span><span>${esc([r.by, fmtDate(r.at)].filter(Boolean).join(' · '))}</span><span>${now}</span></div></div>` +
        `<div class="wv-rule-acts">${hit.fresh ? `<button class="btn btn-plain" data-act="rule-ok" data-rule="${esc(r.id)}">Looks fine</button>` : ''}` +
        `${r.kind === 'similar' ? `<button class="btn btn-plain" data-act="rule-edit" data-rule="${esc(r.id)}">Edit</button>` : ''}<button class="btn btn-plain" data-act="rule-remove" data-rule="${esc(r.id)}">Remove</button></div></div>`;
    }
    for (const k of kinds) {
      const parts = e.pkg ? W.kindParts(e.pkg, k) : [];
      h += `<div class="wv-rule"><div><div class="item-text">${esc(W.describeKind(k))}</div>` +
        `<div class="item-sub"><span>Part type, not a waiver. ${parts.length ? 'Applies to ' + esc(parts.slice(0, 12).join(', ') + (parts.length > 12 ? ' …' : '')) : 'No part in this package matches.'}</span>${k.reason ? `<span>${esc(k.reason)}</span>` : ''}<span>${esc([k.who, fmtDate(k.at)].filter(Boolean).join(' · '))}</span></div></div>` +
        `<div class="wv-rule-acts"><button class="btn btn-plain" data-act="kind-remove" data-kind="${esc(k.id)}">Remove</button></div></div>`;
    }
    if (e.status === 'ready' && e.pkg && kindsSig(kinds) !== e.kindsAt) h += `<div class="wv-rule wv-rerun"><div class="item-text">The part types changed since this run's checks ran.</div><div class="wv-rule-acts"><button class="btn" data-act="rerun">Run checks again</button></div></div>`;
    return h + '</div>';
  }

  // ── Inspector ──
  function openInspector(f) {
    state.sel = f.id;
    document.querySelectorAll('[data-act="finding"]').forEach(el => el.classList.toggle('sel', el.dataset.id === f.id));
    const kv = [];
    // Most measured values are lengths; a few checks measure something else.
    const unit = unitFor(f.check);
    if (f.value != null && isFinite(f.value)) kv.push(['Measured', typeof f.value === 'number' ? unit(f.value) : f.value]);
    if (f.limit != null) kv.push(['Limit', unit(f.limit)]);
    if (f.layer) kv.push(['Layer', f.layer]);
    const where = whereText(f);
    if (where) kv.push(['Location', where + (f.side ? ' · ' + f.side : '')]);
    if (f.refs && f.refs.length) kv.push(['Designators', f.refs.slice(0, 40).join(', ') + (f.refs.length > 40 ? ' …' : '')]);
    if (f.row) kv.push(['BOM row', f.row]);
    const note = f.category === 'Review';
    if (note && f.author) kv.push(['By', f.author]);
    if (note && f.created && !isNaN(Date.parse(f.created))) kv.push(['Added', new Date(f.created).toLocaleString()]);
    $('#inspector').innerHTML = `<div class="insp-head"><span class="insp-crumb">${esc(f.category)} · ${C.describe(f.category, f.check) ? `<a href="#" data-act="check-doc" data-key="${esc(f.category + '/' + f.check)}">${esc(f.check)}</a>` : esc(f.check)}</span><button class="icon-btn" data-act="close-insp" aria-label="Close">${ICON.close}</button></div>
      <div class="insp-body"><span class="pill ${f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warn' : 'accent'}">${{ error: 'Error', warn: 'Warning', info: 'Info' }[f.severity]}</span>
      <div class="insp-title">${esc(f.title)}</div>${f.detail ? `<div class="insp-detail">${esc(f.detail)}</div>` : ''}
      ${waiverStatusHtml(active(), f)}
      ${located(f) ? `<button class="insp-preview" data-act="show-on-board" data-id="${esc(f.id)}" aria-label="Open on the board"><span class="insp-prev-slot"></span><span class="insp-prev-layer"></span><span class="insp-prev-go">Open on board →</span></button>` : ''}
      ${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${waiverActionsHtml(active(), f)}
      ${note ? `<p style="margin-top:14px"><button class="btn" data-act="note-delete" data-id="${esc(f.id)}">Delete note</button></p>` : ''}</div>`;
    $('#inspector').classList.add('open');
    if (located(f)) showPreview(active(), f);
    const ta = $('#wv-reason');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  // ── Waiving from the inspector ──
  // Under the title: whether the finding is waived (and by what), or was and has changed since.
  function waiverStatusHtml(e, f) {
    if (!e || !Fab.waivers.isWaivable(f)) return '';
    const w = waiverOf(e, f), st = !w && staleOf(e, f);
    const meta = r => esc([r.by, fmtDate(r.at)].filter(Boolean).join(' · '));
    if (w) {
      const r = w.rule, fmt = r.check ? unitFor(r.check.split('/')[1]) : null;
      return `<div class="wv-box waived"><div class="wv-head">${w.state === 'new' ? 'Waived: new match' : 'Waived'}</div><div class="wv-reason">${esc(r.reason || '(no reason)')}</div>` +
        `<div class="wv-meta">${meta(r)}${r.kind === 'similar' ? ` · rule: ${esc(Fab.waivers.describe(r, fmt))}` : ''}</div>` +
        (w.state === 'new' ? `<div class="wv-meta wv-new">The rule didn't match this finding when it was made (or last looked at). Check it belongs with the others.</div>` : '') + `</div>`;
    }
    if (st) {
      const was = st.was, sev = { error: 'an error', warn: 'a warning' }[was.sev] || was.sev;
      return `<div class="wv-box stale"><div class="wv-head">Waived before, but the finding changed</div>` +
        `<div class="wv-meta">Then it was ${sev}: <i>${esc(was.title)}</i>${was.detail && was.detail !== f.detail ? `<br><span class="wv-was">${esc(was.detail)}</span>` : ''}</div>` +
        `<div class="wv-reason">${esc(st.rule.reason || '')}</div><div class="wv-meta">${meta(st.rule)}</div></div>`;
    }
    return '';
  }
  // At the bottom: Waive / Waive similar / Treat as…, or Unwaive and the rule's own buttons.
  function waiverActionsHtml(e, f) {
    if (!e || !Fab.waivers.isWaivable(f) || e.status !== 'ready') return '';
    const w = waiverOf(e, f), st = !w && staleOf(e, f), id = esc(f.id);
    if (w) {
      const r = w.rule, n = (wv(e).hits.get(r.id) || { n: 0 }).n;
      return `<div class="wv-acts">${w.state === 'new' ? `<button class="btn btn-primary" data-act="rule-ok" data-rule="${esc(r.id)}" data-id="${id}">Looks fine</button>` : ''}` +
        `<button class="btn" data-act="unwaive" data-id="${id}">Unwaive</button>` +
        (r.kind === 'similar' ? `<button class="btn btn-plain" data-act="rule-edit" data-rule="${esc(r.id)}">Edit rule…</button><button class="btn btn-plain" data-act="rule-remove" data-rule="${esc(r.id)}">Remove rule (${n})</button>` : '') + `</div>`;
    }
    if (state.wvForm === f.id) {
      const prev = st ? st.rule.reason || '' : '';
      return `<div class="wv-form"><label class="wv-label" for="wv-reason">Why is this one acceptable?</label><textarea id="wv-reason" rows="3" placeholder="Required. For example: tag-connect pads, paste removed on purpose">${esc(prev)}</textarea>` +
        `<div class="wv-acts"><button class="btn btn-primary" data-act="waive-do" data-id="${id}"${prev.trim() ? '' : ' disabled'}>Waive</button><button class="btn btn-plain" data-act="waive-cancel">Cancel</button><span class="wv-key">Ctrl+Enter</span></div></div>`;
    }
    return `<div class="wv-acts"><button class="btn" data-act="waive-open" data-id="${id}" title="W">${st ? 'Waive again' : 'Waive'}</button>` +
      `<button class="btn" data-act="waive-sim" data-id="${id}" title="Shift+W">Waive similar…</button>` +
      (f.refs && f.refs.length ? `<button class="btn btn-plain" data-act="kind-open" data-id="${id}" title="Set these parts as test points, fiducials or mounting holes">Treat as…</button>` : '') +
      (st ? `<button class="btn btn-plain" data-act="waive-drop" data-id="${id}">Drop old waiver</button>` : '') + `</div>`;
  }
  const waiveUser = () => noteUser() || '';
  // Triage keeps moving: the finding after the selected one in the list (or before it, at the end),
  // to select once the selected one is waived. Read from the rows shown, before the rules change.
  function nextRowAfter(id) {
    const rows = [...document.querySelectorAll('.f-row')].filter(r => r.offsetParent && !r.closest('#waived-sec')).map(r => r.dataset.id);
    const i = rows.indexOf(id);
    return i < 0 ? null : { ids: rows, i };
  }
  function selectNextActive(e, at) {
    if (!at || state.view !== 'findings') return false;
    const left = at.ids.filter(id => { const f = e.findings.find(x => x.id === id); return f && !isWaived(e, f); });
    const id = at.ids.slice(at.i + 1).find(x => left.includes(x)) || at.ids.slice(0, at.i).reverse().find(x => left.includes(x));
    const f = id && e.findings.find(x => x.id === id);
    if (!f) { state.sel = null; closeInspector(); return true; }
    openInspector(f);
    const row = document.querySelector(`.f-row[data-id="${CSS.escape(f.id)}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
    return true;
  }
  // Waive one finding (or waive a changed one again): a rule of its own, matching its subject and words.
  function waiveOne(e, f, reason) {
    const W = Fab.waivers, scope = scopeOf(e), st = staleOf(e, f), next = nextRowAfter(f.id);
    if (st) {
      const r = st.rule;
      W.putRule(scope, Object.assign({}, r, { items: r.items.map(s => s === st.was ? W.snap(f) : s), reason, by: waiveUser(), at: new Date().toISOString() }));
    } else W.addRule(scope, { kind: 'one', check: f.category + '/' + f.check, items: [W.snap(f)], reason, by: waiveUser(), at: new Date().toISOString() });
    state.wvForm = null;
    afterWaiverChange(e, f, 'Waived', next);
  }
  // Unwaive: a one-finding waiver loses that finding; a rule keeps the others and leaves this one out.
  function unwaive(e, f) {
    const W = Fab.waivers, w = waiverOf(e, f);
    if (!w) return;
    const r = w.rule, scope = scopeOf(e);
    if (r.kind === 'one') {
      const items = r.items.filter(s => !W.sameSubject(s, f));
      if (items.length) W.putRule(scope, Object.assign({}, r, { items })); else W.removeRule(scope, r.id);
    } else W.putRule(scope, Object.assign({}, r, { except: (r.except || []).concat([W.snap(f)]), also: (r.also || []).filter(s => !W.sameSubject(s, f)) }));
    afterWaiverChange(e, f, 'Unwaived');
  }
  // A rule's new matches have been looked at: they join what it has seen. With a finding, only that one.
  function ruleLooked(e, ruleId, f) {
    const W = Fab.waivers, scope = scopeOf(e), r = W.rules(scope).find(x => x.id === ruleId);
    if (!r) return;
    const by = wv(e).by;
    const fresh = e.findings.filter(x => { const s = by.get(x.id); return s && s.rule.id === ruleId && s.state === 'new' && (!f || x === f); });
    W.putRule(scope, Object.assign({}, r, { seen: (r.seen || []).concat(fresh.map(W.snap)) }));
    afterWaiverChange(e, f, fresh.length === 1 ? 'Marked as looked at' : `${fresh.length} matches marked as looked at`);
  }
  function removeRule(e, ruleId) {
    const W = Fab.waivers, scope = scopeOf(e), r = W.rules(scope).find(x => x.id === ruleId);
    if (!r) return;
    const n = (wv(e).hits.get(r.id) || { n: 0 }).n;
    if (!confirm(`Remove the waiver "${r.reason || W.describe(r)}"?${n ? ` ${plural(n, 'finding')} it waives will show again.` : ''}`)) return;
    W.removeRule(scope, ruleId);
    afterWaiverChange(e, null, 'Waiver removed');
  }
  // ── Waive similar ──
  // A panel that builds a rule from examples: the details they share start ticked, everything that
  // would be waived is listed before anything is, errors are waived only when ticked, and near
  // misses (findings that fail one detail) show what the rule leaves out. Examples come from the
  // lists in the panel (+ Example), so the board's selection is left alone.
  function openSimilar(e, f, ruleId) {
    const W = Fab.waivers;
    if (!e || !e.pkg || e.status !== 'ready') return;
    const rule = ruleId ? W.rules(scopeOf(e)).find(r => r.id === ruleId) : null;
    let examples = f ? [f] : [];
    if (rule && !examples.length) {
      const by = wv(e).by, mine = e.findings.filter(x => (by.get(x.id) || {}).rule === rule);
      examples = mine.slice(0, 1);
    }
    const check = rule ? rule.check : f.category + '/' + f.check;
    const s = state.sim = {
      eid: e.id, examples, check: check || (examples[0] && examples[0].category + '/' + examples[0].check), anyCheck: !!rule && !rule.check,
      facets: {}, warn: true, errorsAll: false, tick: new Map(), reason: rule ? rule.reason || '' : '', editing: rule ? rule.id : null, margin: 5,
    };
    if (rule) {
      // Editing: the rule's own facets, ticked; the rest proposed from the example, unticked.
      const prop = examples.length ? W.propose(e.pkg, examples, s.margin) : {};
      for (const d of W.FACETS) {
        const v = (rule.facets || {})[d.key];
        if (v != null) s.facets[d.key] = Object.assign({}, prop[d.key] || {}, { value: v, on: true, kept: d.kind === 'near' });
        else if (prop[d.key]) s.facets[d.key] = Object.assign({}, prop[d.key], { on: false });
      }
      s.warn = (rule.sevs || []).includes('warn');
      s.errorsAll = (rule.sevs || []).includes('error');
      for (const x of e.findings) {
        if (!W.isWaivable(x)) continue;
        if ((rule.except || []).some(sn => W.sameSubject(sn, x))) s.tick.set(x.id, false);
        else if ((rule.also || []).some(sn => W.sameSubject(sn, x))) s.tick.set(x.id, true);
      }
    } else s.facets = W.propose(e.pkg, examples, s.margin);
    renderSimilar(true);
  }

  const simEntry = () => state.sim && state.pkgs.find(p => p.id === state.sim.eid);
  // The facets ticked, as a rule asks for them.
  function simFacets(s) {
    const out = {};
    for (const d of Fab.waivers.FACETS) {
      const x = s.facets[d.key];
      if (!x || !x.on) continue;
      if (d.kind === 'range') { if (x.value && (x.value.min != null || x.value.max != null)) out[d.key] = { min: x.value.min, max: x.value.max }; }
      else if (d.kind === 'near') { if (x.value) out[d.key] = x.value; }
      else if (String(x.value || '').trim()) out[d.key] = String(x.value).trim();
    }
    return out;
  }
  // Candidates, matches and near misses for the panel as it stands.
  function simResults(e, s) {
    const W = Fab.waivers, by = wv(e).by, facets = simFacets(s);
    const ck = f => f.category + '/' + f.check;
    let already = 0;
    const cands = [];
    for (const f of e.findings) {
      if (!W.isWaivable(f) || (!s.anyCheck && ck(f) !== s.check)) continue;
      const w = by.get(f.id);
      if (w && w.state !== 'stale' && w.rule.id !== s.editing) { if (!W.fails(facets, W.facetsOf(e.pkg, f)).length) already++; continue; }
      cands.push(f);
    }
    const matches = [], near = [], other = [];
    for (const f of cands) {
      const fl = W.fails(facets, W.facetsOf(e.pkg, f));
      if (!fl.length) matches.push(f); else if (fl.length === 1) near.push({ f, fl }); else other.push({ f, fl });
    }
    const ticked = f => s.tick.has(f.id) ? s.tick.get(f.id) : f.severity === 'warn' ? s.warn : s.errorsAll || s.examples.includes(f);
    return { facets, cands, matches, near, other, already, ticked };
  }

  function renderSimilar(full) {
    const e = simEntry(), s = state.sim;
    if (!e || !s) return;
    const W = Fab.waivers;
    let wrap = document.getElementById('sim-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sheet-wrap'; wrap.id = 'sim-wrap';
      wrap.innerHTML = `<div class="sheet sim" role="dialog" aria-modal="true" aria-labelledby="sim-title"><div class="sheet-head"><h2 id="sim-title"></h2>` +
        `<p>Tick what the findings must share. Everything that would be waived is listed on the right first. Errors are waived only when you tick them.</p></div>` +
        `<div class="sim-body"><div class="sim-left" id="sim-left"></div><div class="sim-right" id="sim-right"></div></div>` +
        `<div class="sheet-foot"><span class="sim-count" id="sim-count"></span><span class="spacer"></span><button class="btn" data-sim="cancel">Cancel</button><button class="btn btn-primary" data-sim="save"></button></div></div>`;
      document.body.appendChild(wrap);
      bindSimilar(wrap);
      full = true;
    }
    wrap.querySelector('#sim-title').textContent = s.editing ? 'Edit waiver rule' : 'Waive similar findings';
    const res = simResults(e, s);
    if (full) wrap.querySelector('#sim-left').innerHTML = simLeftHtml(e, s, res);
    wrap.querySelector('#sim-right').innerHTML = simRightHtml(e, s, res);
    const n = res.matches.filter(res.ticked).length;
    const checks = new Set(res.matches.filter(res.ticked).map(f => f.category + '/' + f.check)).size;
    const save = wrap.querySelector('[data-sim="save"]');
    save.textContent = s.editing ? `Save rule (${n})` : `Waive ${plural(n, 'finding')}`;
    save.disabled = !n || !s.reason.trim();
    wrap.querySelector('#sim-count').innerHTML = !s.reason.trim() ? 'A reason is required.' : checks > 1 ? `<b class="t-warn">Across ${checks} checks.</b>` : '';
  }

  function simLeftHtml(e, s, res) {
    const W = Fab.waivers, ck = s.check ? s.check.split('/') : null;
    let h = '';
    if (s.examples.length) {
      h += `<div class="sim-lab">Examples</div><div class="sim-exs">` + s.examples.map(f => `<span class="sim-ex"><span class="dot ${f.severity}"></span><span class="sim-ex-t" title="${esc(f.title)}">${esc(f.title)}</span>` +
        (s.examples.length > 1 ? `<button class="icon-btn" data-sim="ex-remove" data-id="${esc(f.id)}" aria-label="Remove example">${ICON.close}</button>` : '') + `</span>`).join('') + `</div>` +
        `<p class="note">Add more with <b>+ Example</b> in the lists; what they all share is ticked.</p>`;
    }
    h += `<div class="sim-lab">Findings must share</div>`;
    h += `<div class="sim-f locked"><label class="check"><input type="checkbox" checked disabled> Check</label><span class="sim-val">${s.anyCheck ? '<b class="t-warn">Any check</b>' : ck ? `${esc(ck[1])} <span class="muted">(${esc(ck[0])})</span>` : ''}</span>` +
      `<label class="check sim-any" title="Waive findings of other checks too"><input type="checkbox" data-sim="any"${s.anyCheck ? ' checked' : ''}> Any check</label></div>`;
    const unit = s.check ? unitFor(s.check.split('/')[1]) : (v => String(v));
    for (const d of W.FACETS) {
      const x = s.facets[d.key];
      if (!x) continue;
      const on = `<label class="check"><input type="checkbox" data-sim="on" data-key="${d.key}"${x.on ? ' checked' : ''}> ${d.label}</label>`;
      let input = '';
      if (d.kind === 'range') {
        const v = x.value || {};
        input = `<span class="sim-range"><input class="sim-in num" type="number" step="any" data-sim="min" data-key="${d.key}" value="${v.min != null ? +v.min.toFixed(4) : ''}" placeholder="any" aria-label="Lowest"> to <input class="sim-in num" type="number" step="any" data-sim="max" data-key="${d.key}" value="${v.max != null ? +v.max.toFixed(4) : ''}" placeholder="any" aria-label="Highest"></span>`;
      } else if (d.kind === 'near') {
        input = x.kept && !s.examples.length ? '<span class="muted">as saved</span>' : `<span class="sim-range">within <input class="sim-in num" type="number" step="any" min="0" data-sim="margin" value="${s.margin}" aria-label="Margin in mm"> mm</span>`;
      } else input = `<input class="sim-in" data-sim="val" data-key="${d.key}" value="${esc(x.value || '')}" spellcheck="false" aria-label="${d.label}">`;
      const shown = d.kind === 'range' && x.shown ? 'Examples: ' + x.shown.split(', ').map(v => unit(+v)).join(', ') : x.shown && (x.differs || s.examples.length > 1 || d.kind === 'exact') ? 'Examples: ' + x.shown : '';
      h += `<div class="sim-f${x.on ? ' on' : ''}">${on}${input}${shown ? `<div class="sim-shown">${esc(shown)}</div>` : ''}</div>`;
    }
    h += `<p class="note">In patterns, * stands for any characters and ? for one; case is ignored.</p>`;
    h += `<div class="sim-lab">Severity</div><div class="sim-sev"><label class="check"><input type="checkbox" data-sim="warn"${s.warn ? ' checked' : ''}> Warnings</label>` +
      `<label class="check"><input type="checkbox" data-sim="errors"${s.errorsAll ? ' checked' : ''}> All errors that match, now and later</label></div>`;
    h += `<div class="sim-lab"><label for="sim-reason">Reason</label></div><textarea id="sim-reason" data-sim="reason" rows="3" placeholder="Required. Why are these acceptable?">${esc(s.reason)}</textarea>`;
    return h;
  }

  function simRightHtml(e, s, res) {
    const W = Fab.waivers, unit = s.check ? unitFor(s.check.split('/')[1]) : (v => String(+(+v).toFixed(4)));
    const label = k => (W.FACETS.find(d => d.key === k) || { label: k }).label.toLowerCase();
    const valOf = f => { const fc = W.facetsOf(e.pkg, f); return fc.value != null ? unit(fc.value) : ''; };
    const exBtn = f => s.examples.includes(f) ? '<span class="sim-tag">Example</span>' : `<button class="btn btn-plain sim-add" data-sim="ex-add" data-id="${esc(f.id)}">+ Example</button>`;
    const line = (f, right, box) => `<div class="sim-row">${box || '<span></span>'}<span class="dot ${f.severity}"></span><span class="sim-t" title="${esc(f.detail || '')}">${esc(f.title)}</span>` +
      `<span class="sim-d">${esc([whereText(f), f.layer, valOf(f)].filter(Boolean).join(' · '))}</span><span class="sim-r">${right || ''}</span></div>`;
    const tickBox = f => `<input type="checkbox" data-sim="tick" data-id="${esc(f.id)}"${res.ticked(f) ? ' checked' : ''} aria-label="Waive this one">`;
    const warns = res.matches.filter(f => f.severity === 'warn'), errs = res.matches.filter(f => f.severity === 'error');
    const n = res.matches.filter(res.ticked).length;
    let h = `<div class="sim-sum"><b>${n}</b> of ${res.matches.length} ${res.matches.length === 1 ? 'match' : 'matches'} will be waived` +
      (res.already ? `<span class="muted"> · ${res.already} more already waived by other rules</span>` : '') + `</div>`;
    h += simHistogram(e, s, res, unit);
    const CAP = 300;
    const list = (title, items, note, extra) => items.length ? `<div class="sim-sec"><div class="sim-sec-h">${title} <span class="muted">${items.length}</span>${extra || ''}</div>${note ? `<p class="note">${note}</p>` : ''}` +
      items.slice(0, CAP).join('') + (items.length > CAP ? `<div class="muted sim-more">… ${items.length - CAP} more</div>` : '') + `</div>` : '';
    h += list('Warnings', warns.map(f => line(f, exBtn(f), tickBox(f))), s.warn ? '' : 'Warnings are left out (Severity).');
    h += list('Errors', errs.map(f => line(f, exBtn(f), tickBox(f))), s.errorsAll ? 'Every error that matches is waived, including ones a later run finds.' : 'Not waived unless ticked. Tick them one by one, or tick “All errors that match”.',
      !s.errorsAll && errs.some(f => !res.ticked(f)) ? ` <button class="link-btn" data-sim="tick-errors">Tick these ${errs.length}</button>` : '');
    if (!res.matches.length) h += `<div class="sim-empty">Nothing matches every ticked detail.</div>`;
    h += list('Near misses', res.near.map(({ f, fl }) => line(f, `<span class="sim-why">differs in ${esc(label(fl[0]))}</span>${exBtn(f)}`)), 'Fail one ticked detail, so they stay as they are. Make one an example to widen the rule.');
    if (res.other.length) h += `<details class="sim-sec"><summary class="sim-sec-h">Other findings of ${s.anyCheck ? 'these checks' : 'this check'} <span class="muted">${res.other.length}</span></summary>` +
      res.other.slice(0, CAP).map(({ f, fl }) => line(f, `<span class="sim-why">differs in ${esc(fl.map(label).join(', '))}</span>${exBtn(f)}`)).join('') + `</details>`;
    return h;
  }

  // Where the matched values sit among this check's findings: one bar per bin, matched in color,
  // the rest gray, and the ticked range shaded. Outliers in a batch show at a glance.
  function simHistogram(e, s, res, unit) {
    const W = Fab.waivers;
    const vals = res.cands.map(f => ({ f, v: W.facetsOf(e.pkg, f).value })).filter(x => x.v != null);
    if (vals.length < 3 || s.anyCheck) return '';
    const lo = Math.min(...vals.map(x => x.v)), hi = Math.max(...vals.map(x => x.v));
    if (!(hi > lo)) return '';
    const N = 28, bins = Array.from({ length: N }, () => ({ all: 0, hit: 0 }));
    const bi = v => Math.min(N - 1, Math.floor((v - lo) / (hi - lo) * N));
    const hit = new Set(res.matches.filter(res.ticked));
    for (const x of vals) { const b = bins[bi(x.v)]; b.all++; if (hit.has(x.f)) b.hit++; }
    const top = Math.max(...bins.map(b => b.all)), W_ = 300, H = 44, bw = W_ / N;
    const r = (s.facets.value && s.facets.value.on && s.facets.value.value) || null;
    const xOf = v => Math.max(0, Math.min(W_, (v - lo) / (hi - lo) * W_));
    let svg = `<svg class="sim-hist" viewBox="0 0 ${W_} ${H + 2}" preserveAspectRatio="none" aria-hidden="true">`;
    if (r) svg += `<rect class="sim-hist-range" x="${xOf(r.min != null ? r.min : lo)}" y="0" width="${Math.max(1, xOf(r.max != null ? r.max : hi) - xOf(r.min != null ? r.min : lo))}" height="${H}"/>`;
    bins.forEach((b, i) => {
      if (!b.all) return;
      const h1 = Math.max(2, b.all / top * H), h2 = b.hit / top * H;
      svg += `<rect class="sim-hist-all" x="${i * bw + 1}" y="${H - h1}" width="${bw - 2}" height="${h1}"/>`;
      if (b.hit) svg += `<rect class="sim-hist-hit" x="${i * bw + 1}" y="${H - h2}" width="${bw - 2}" height="${Math.max(2, h2)}"/>`;
    });
    return svg + `</svg><div class="sim-hist-ax"><span>${esc(unit(lo))}</span><span class="muted">measured, this check</span><span>${esc(unit(hi))}</span></div>`;
  }

  function bindSimilar(wrap) {
    const close = () => { wrap.remove(); state.sim = null; document.removeEventListener('keydown', onKey, true); };
    const onKey = ev => {
      if (!document.getElementById('sim-wrap')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopPropagation(); saveSimilar(close); }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', ev => {
      const s = state.sim, e = simEntry();
      if (!s || !e) return;
      if (ev.target === wrap) { close(); return; }
      const t = ev.target.closest('[data-sim]');
      if (!t) return;
      const k = t.dataset.sim, f = t.dataset.id && e.findings.find(x => x.id === t.dataset.id);
      if (k === 'cancel') close();
      else if (k === 'save') saveSimilar(close);
      else if (k === 'ex-add' && f) { s.examples.push(f); if (!s.anyCheck && f.category + '/' + f.check !== s.check) s.anyCheck = true; reproposeSimilar(e, s); }
      else if (k === 'ex-remove' && f) { s.examples = s.examples.filter(x => x !== f); reproposeSimilar(e, s); }
      else if (k === 'tick-errors') { for (const x of simResults(e, s).matches) if (x.severity === 'error') s.tick.set(x.id, true); renderSimilar(); }
    });
    wrap.addEventListener('change', ev => {
      const s = state.sim, e = simEntry(), t = ev.target;
      if (!s || !e || !t.dataset.sim) return;
      const k = t.dataset.sim, x = t.dataset.key && s.facets[t.dataset.key];
      if (k === 'on' && x) { x.on = t.checked; renderSimilar(true); }
      else if (k === 'any') { s.anyCheck = t.checked; renderSimilar(true); }
      else if (k === 'warn') { s.warn = t.checked; renderSimilar(); }
      else if (k === 'errors') { s.errorsAll = t.checked; if (t.checked) for (const [id, v] of s.tick) if (!v) s.tick.delete(id); renderSimilar(); }
      else if (k === 'tick') s.tick.set(t.dataset.id, t.checked), renderSimilar();
    });
    wrap.addEventListener('input', ev => {
      const s = state.sim, e = simEntry(), t = ev.target;
      if (!s || !e || !t.dataset.sim) return;
      const k = t.dataset.sim, x = t.dataset.key && s.facets[t.dataset.key];
      if (k === 'reason') { s.reason = t.value; renderSimilar(); return; }
      if (k === 'val' && x) { x.value = t.value; if (!x.on && t.value.trim()) { x.on = true; t.closest('.sim-f').classList.add('on'); t.closest('.sim-f').querySelector('[data-sim="on"]').checked = true; } }
      else if ((k === 'min' || k === 'max') && x) { x.value = Object.assign({}, x.value); x.value[k] = t.value === '' ? null : parseFloat(t.value); }
      else if (k === 'margin') {
        s.margin = Math.max(0, parseFloat(t.value) || 0);
        const p = Fab.waivers.propose(e.pkg, s.examples, s.margin).near;
        if (p && s.facets.near) s.facets.near.value = p.value;
      } else return;
      renderSimilar();
    });
  }
  // New examples: propose again, keeping what was ticked by hand where the proposal still has the facet.
  function reproposeSimilar(e, s) {
    const prop = Fab.waivers.propose(e.pkg, s.examples, s.margin);
    for (const k of Object.keys(prop)) if (s.facets[k] && s.facets[k].kept) prop[k] = s.facets[k];
    s.facets = prop;
    renderSimilar(true);
  }
  function saveSimilar(close) {
    const e = simEntry(), s = state.sim, W = Fab.waivers;
    if (!e || !s || !s.reason.trim()) return;
    const res = simResults(e, s), hit = res.matches.filter(res.ticked);
    if (!hit.length) return;
    const sevs = [s.warn && 'warn', s.errorsAll && 'error'].filter(Boolean);
    // Subjects the rule holds that this run doesn't have (other revisions) are kept as they were.
    const old = s.editing ? W.rules(scopeOf(e)).find(r => r.id === s.editing) : null;
    const keep = list => ((old && old[list]) || []).filter(sn => !res.cands.some(f => W.sameSubject(sn, f)));
    const rule = {
      kind: 'similar', check: s.anyCheck ? null : s.check, facets: res.facets, sevs,
      also: keep('also').concat(hit.filter(f => !sevs.includes(f.severity)).map(W.snap)),
      except: keep('except').concat(res.matches.filter(f => !res.ticked(f) && sevs.includes(f.severity)).map(W.snap)),
      seen: keep('seen').concat(hit.map(W.snap)),
      reason: s.reason.trim(), by: waiveUser(), at: new Date().toISOString(),
    };
    const f = e.findings.find(x => x.id === state.sel), next = f && nextRowAfter(f.id);
    if (old) W.putRule(scopeOf(e), Object.assign({ id: old.id }, rule)); else W.addRule(scopeOf(e), rule);
    close();
    afterWaiverChange(e, f, old ? 'Waiver rule saved' : `Waived ${plural(hit.length, 'finding')}`, next);
  }

  // ── Treat as a test point, fiducial or mounting hole ──
  // Not a waiver: the reviewer says what the parts are, and the checks run again knowing it.
  function openKind(e, f) {
    const W = Fab.waivers;
    if (!e || !e.pkg || !f.refs || !f.refs.length) return;
    const fc = W.facetsOf(e.pkg, f);
    const k = { kind: 'tp', by: 'des', pattern: f.refs.length === 1 ? f.refs[0] : W.cover(f.refs) || f.refs[0], fp: fc.footprint.length === 1 ? fc.footprint[0] : '', reason: '' };
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap'; wrap.id = 'kind-wrap';
    const names = { tp: 'Test point', fid: 'Fiducial', mh: 'Mounting hole' };
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="kind-title"><div class="sheet-head"><h2 id="kind-title">Treat as…</h2>` +
      `<p>Says what these parts are, rather than waiving findings: the checks run again expecting no BOM line or paste on them, and test point findings fold into one row. It applies to every run of this board.</p></div>` +
      `<div class="sheet-body"><div class="seg kind-seg" role="radiogroup">${Object.keys(names).map(x => `<button data-k="kind" data-v="${x}" role="radio">${names[x]}</button>`).join('')}</div>` +
      `<div class="kind-by"><label class="check"><input type="radio" name="kind-by" value="des" checked> Designators</label><input class="sim-in" id="kind-des" value="${esc(k.pattern)}" spellcheck="false"></div>` +
      (k.fp ? `<div class="kind-by"><label class="check"><input type="radio" name="kind-by" value="footprint"> Footprint</label><input class="sim-in" id="kind-fp" value="${esc(k.fp)}" spellcheck="false"></div>` : '') +
      `<p class="note">* stands for any characters, ? for one.</p><div class="kind-parts" id="kind-parts"></div>` +
      `<label class="wv-label" for="kind-reason">Note (optional)</label><input class="sim-in wide" id="kind-reason" placeholder="For example: tag-connect footprint pads"></div>` +
      `<div class="sheet-foot"><button class="btn" data-k="cancel">Cancel</button><button class="btn btn-primary" data-k="ok"></button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    const read = () => { const by = (wrap.querySelector('input[name="kind-by"]:checked') || {}).value || 'des'; return { kind: k.kind, by, pattern: (by === 'footprint' ? wrap.querySelector('#kind-fp') : wrap.querySelector('#kind-des')).value.trim() }; };
    const paint = () => {
      const cur = read(), parts = cur.pattern ? W.kindParts(e.pkg, cur) : [];
      for (const b of wrap.querySelectorAll('[data-k="kind"]')) { const on = b.dataset.v === k.kind; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
      wrap.querySelector('#kind-parts').innerHTML = parts.length ? `<b>${plural(parts.length, 'part')}</b>: ${esc(parts.slice(0, 40).join(', ') + (parts.length > 40 ? ' …' : ''))}` : '<span class="t-warn">No part in this package matches.</span>';
      const ok = wrap.querySelector('[data-k="ok"]');
      ok.textContent = parts.length === 1 ? `Treat ${parts[0]} as a ${W.KIND_NAMES[k.kind]}` : `Treat ${parts.length} parts as ${W.KIND_NAMES[k.kind]}s`;
      ok.disabled = !parts.length;
    };
    wrap.addEventListener('input', paint);
    wrap.addEventListener('change', paint);
    wrap.addEventListener('click', ev => {
      if (ev.target === wrap) { close(); return; }
      const t = ev.target.closest('[data-k]');
      if (!t) return;
      if (t.dataset.k === 'kind') { k.kind = t.dataset.v; paint(); }
      else if (t.dataset.k === 'cancel') close();
      else if (t.dataset.k === 'ok') {
        const cur = read();
        W.addKind(scopeOf(e), Object.assign(cur, { reason: wrap.querySelector('#kind-reason').value.trim(), who: waiveUser(), at: new Date().toISOString() }));
        close();
        closeInspector(); state.sel = null;
        runChecks(e, `Re-running checks: ${W.describeKind(cur)}`);
        toast(`${W.describeKind(cur)}: checks running again`);
      }
    });
    paint();
    wrap.querySelector('#kind-des').focus();
  }

  // Re-render after a rule changed, keeping the inspector on the finding it was about, and keep the
  // run's record in step (its findings don't change; the browser's waivers did).
  // `next` (nextRowAfter, read before the change): when the selected finding is now waived, select
  // the next one still to look at instead, so the Waived fold stays closed.
  function afterWaiverChange(e, f, msg, next) {
    e._wv = null;
    if (next && f && state.sel === f.id && isWaived(e, f)) state.sel = null;
    renderAll();
    if (next && f && !state.sel && selectNextActive(e, next)) { if (msg) toast(msg); return; }
    if (f && $('#inspector').classList.contains('open') && state.sel === f.id) openInspector(f);
    if (msg) toast(msg);
  }
  function closeInspector() { $('#inspector').classList.remove('open'); }
  const located = f => !!(f && (f.at || f.bbox));

  // The finding as the board will show it, small, in the inspector: the same layers, side, dimming
  // and framing, drawn by its own viewer on a copy of the board's layer list.
  let preview = null;
  function showPreview(e, f) {
    const slot = $('#inspector .insp-prev-slot');
    if (!slot || !e || !e.pkg) return;
    if (!preview) {
      const box = document.createElement('div');
      box.className = 'insp-canvas';
      box.appendChild(document.createElement('canvas'));
      preview = new Fab.render.Viewer(box.firstChild);
      preview.box = box;
      preview.overlays.push({ draw: drawPlacements }, { draw: drawFindingMarks });
    }
    const v = preview;
    slot.appendChild(v.box);
    v.layers = (e.layers || (e.layers = layerEntries(e.pkg))).map(l => Object.assign({}, l));
    if (v.pkg !== e.pkg) v.setPackage(e.pkg);
    v.view.flip = !!(viewer && viewer.pkg === e.pkg && viewer.view.flip);
    const plan = jumpPlan(v.layers, f, v.view.flip);
    if (plan.side) { v.view.flip = plan.side === 'bottom'; sideVisibility(v.layers, plan.side); }
    for (const L of plan.on) L.visible = true;
    v.focusLayer = plan.focusLayer;
    v.photo = !!(viewer && viewer.pkg === e.pkg && viewer.photo) && !plan.inner;
    v.highlight = highlightOf(f);
    v.resize();
    v.focus(focusBox(f), 2.5);
    const tag = $('#inspector .insp-prev-layer');
    if (tag) tag.textContent = plan.entry ? plan.entry.label + (plan.focusLayer && v.layers.some(L => L.visible && v._covers(L)) ? ' · covering layers dimmed' : '') : (v.view.flip ? 'Bottom side' : 'Top side');
  }

  // Pictures of the board for Signoff PL, stored with a run (ee_design_review/docs/fabcheck-link.md,
  // "Board previews"): the realistic look of each outer side, 640 px wide, transparent around the
  // board, drawn off screen by a viewer of its own. Resolves [] when there's no outline to frame.
  async function boardPreviews(e) {
    if (!e || !e.pkg || !Fab.bbox.valid(e.pkg.boardBBox)) return [];
    const bb = e.pkg.boardBBox, W = 640, H = Math.max(160, Math.min(640, Math.round(W * (bb[3] - bb[1]) / (bb[2] - bb[0] || 1))));
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;height:${H}px;pointer-events:none`;
    box.appendChild(document.createElement('canvas'));
    document.body.appendChild(box);
    try {
      const v = new Fab.render.Viewer(box.firstChild), out = [];
      v.photo = true; v.bare = true;
      v.setPackage(e.pkg);
      for (const side of ['top', 'bottom']) {
        v.layers = layerEntries(e.pkg);
        sideVisibility(v.layers, side);
        v.view.flip = side === 'bottom';
        v.resize(); v.fit(); v._draw();
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(v.canvas, 0, 0, W, H);
        const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.86));
        if (blob) out.push({ key: side, type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H });
      }
      return out;
    } finally { box.remove(); }
  }
  Fab.boardPreviews = boardPreviews;

  // From the preview to the board: the preview's picture grows into the board's own framing of the
  // finding (both are centered on it), then fades into the live board drawn underneath.
  function openFromPreview(f) {
    const v = preview, from = v && v.canvas.isConnected ? v.canvas.getBoundingClientRect() : null;
    let shot = null;
    if (from && from.width > 10 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shot = document.createElement('canvas');
      shot.width = v.canvas.width; shot.height = v.canvas.height;
      shot.getContext('2d').drawImage(v.canvas, 0, 0);
    }
    const pscale = v ? v.view.scale : 0;
    focusFinding(f);
    if (!shot || !viewer) return;
    const to = $('#canvas').getBoundingClientRect(), k = viewer.view.scale / pscale;
    shot.className = 'zoom-shot';
    Object.assign(shot.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.appendChild(shot);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const a = shot.animate([
      { transform: 'none', opacity: 1, borderRadius: '10px' },
      { opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0, borderRadius: '0px' },
    ], { duration: 560, easing: 'cubic-bezier(0.35, 0.7, 0.2, 1)', fill: 'forwards' });
    a.onfinish = a.oncancel = () => shot.remove();
  }

  // ── Board view ──
  function layerEntries(pkg) {
    const L = pkg.layers, out = [];
    let inner = 0;
    for (const l of L.copper) {
      const color = l.side === 'top' ? COLORS.copper.top : l.side === 'bottom' ? COLORS.copper.bottom : COLORS.copper.inner[inner++ % COLORS.copper.inner.length];
      out.push({ label: `L${l.cuOrder} ${l.side === 'top' ? 'Top' : l.side === 'bottom' ? 'Bottom' : 'Inner'} copper${l.polarity === 'negative' ? ' (plane)' : ''}`, kind: 'gerber', layer: l, color, alpha: 0.85, side: l.side, visible: l.side === 'top' });
    }
    for (const fn of ['paste', 'mask', 'silk']) for (const side of ['top', 'bottom']) {
      const l = L[fn][side];
      if (l) out.push({ label: `${side === 'top' ? 'Top' : 'Bottom'} ${fn === 'mask' ? 'mask openings' : fn === 'silk' ? 'silkscreen' : 'paste'}`, kind: 'gerber', layer: l, color: COLORS[fn][side], alpha: fn === 'mask' ? 0.35 : fn === 'paste' ? 0.6 : 0.95, side, visible: side === 'top' && fn === 'silk' });
    }
    for (const l of L.other) {
      const c = l.file.cls, side = c.side === 'top' ? 'Top' : c.side === 'bottom' ? 'Bottom' : '';
      const named = c.role === 'coverlay' ? `${side} coverlay` : c.role === 'stiffener' ? `${side} stiffener`.trim() : c.role === 'bend' ? 'Bend lines' : null;
      const color = c.role === 'coverlay' ? COLORS.coverlay[c.side] || COLORS.coverlay.top : c.role === 'stiffener' ? COLORS.stiffener : COLORS.other;
      out.push({ label: named ? `${named} (${l.file.name})` : l.file.name, kind: 'gerber', layer: l, color, alpha: named ? 0.45 : 0.8, visible: false, other: true });
    }
    if (pkg.hits.some(h => h.plated) || pkg.slots.some(s => s.plated)) out.push({ label: 'Plated holes', kind: 'pth', color: '#0b0c0e', alpha: 1, visible: true });
    if (pkg.hits.some(h => !h.plated) || pkg.slots.some(s => !s.plated)) out.push({ label: 'Non-plated holes', kind: 'npth', color: '#0b0c0e', alpha: 1, visible: true });
    out.push({ label: 'Board outline', kind: 'outline', color: '#ffd60a', alpha: 0.9, visible: true });
    return out;
  }

  function ensureViewer() {
    if (viewer) return viewer;
    viewer = new Fab.render.Viewer($('#canvas'));
    viewer.onHover = (x, y) => {
      $('#coords').textContent = `X ${x.toFixed(3)}  Y ${y.toFixed(3)} mm`;
      viewer.canvas.style.cursor = markAt(x, y) ? 'pointer' : '';
    };
    viewer.onClick = (x, y) => {
      if (state.placing) { startNote(x, y); return; }
      const f = markAt(x, y); if (f) selectFinding(f); else pickPart(x, y);
    };
    viewer.overlays.push({ draw: drawPlacements }, { draw: drawFindingMarks }, { draw: drawNoteDraft });
    return viewer;
  }

  function renderBoard(e) {
    const v = ensureViewer();
    if (v.pkg !== e.pkg) { v.layers = e.layers || (e.layers = layerEntries(e.pkg)); v.highlight = null; setSide('top', true); v.setPackage(e.pkg); }
    v.resize();
    if (state.draft && state.draft.entry !== e.id) cancelNote();
    const nb = $('#note-btn');
    nb.disabled = e.status !== 'ready';
    if (nb.disabled && state.placing) setPlacing(false);
    renderLayers(e);
    renderRail(e);
  }

  function renderLayers(e) {
    const pane = $('#layers-pane');
    const folded = $('#board-view').classList.contains('layers-collapsed');
    redraw(pane, e.id, () => { pane.innerHTML = `<div class="side-head"><span class="side-label">Layers</span><button class="btn btn-plain" style="padding:2px 6px;font-size:12px" data-act="layers-all" id="layers-all">${layersAllLabel()}</button>` +
      `<button class="lay-fold" data-act="layers-fold" aria-label="${folded ? 'Show' : 'Hide'} the layers panel" title="${folded ? 'Show' : 'Hide'} layers"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button></div>` +
      viewer.layers.map((l, i) => `<label class="lay"${l.other ? ' style="opacity:.7"' : ''}><input type="checkbox" data-layer="${i}"${l.visible ? ' checked' : ''}><span class="sw" style="background:${l.color}"></span><span class="nm" title="${esc(l.layer ? l.layer.file.name : l.label)}">${esc(l.label)}</span></label>`).join(''); });
  }

  // "Hide all" while any layer shows; "Show all" once every layer is hidden.
  const layersAllLabel = () => viewer.layers.some(l => l.visible) ? 'Hide all' : 'Show all';
  function syncLayersAll() { const b = $('#layers-all'); if (b) b.textContent = layersAllLabel(); }

  function renderRail(e) {
    const c = liveCounts(e);
    const chips = sevButtons(c);
    const fc = state.focusCheck;
    let h = `<div class="rail-head">${signoffProject(e) ? '<button class="btn btn-plain" style="align-self:flex-start;padding:2px 6px" data-act="back-signoff">← Back to Signoff EE</button>' : ''}` +
      (fc ? `<div class="chips"><span class="chip accent">Linked check: ${esc(fc)}</span><button class="btn btn-plain" style="padding:2px 6px;font-size:12px" data-act="clear-focus">Show all</button></div>` : '') +
      `<div class="seg sev-seg full">${chips}</div><div class="search" style="max-width:none">${ICON.search}<input id="rail-search" type="search" placeholder="Filter" value="${esc(state.q)}"></div></div><div class="rail-list">`;
    const order = { error: 0, warn: 1, info: 2 };
    // Waived findings stay off the board's list and marks (Findings lists them in their own fold).
    const fs = activeOf(e, visibleFindings(e)).filter(f => (f.at || f.bbox) && (!fc || f.check === fc));
    const nw = waivedOf(e, visibleFindings(e)).filter(located).length;
    for (const [cat, title] of CATS) {
      const list = fs.filter(f => f.category === cat).sort((a, b) => order[a.severity] - order[b.severity]);
      if (!list.length) continue;
      h += `<div class="cat-label">${title} · ${list.length}</div>`;
      for (const f of list) h += `<div class="rf${state.sel === f.id ? ' sel' : ''}" data-act="board-finding" data-id="${esc(f.id)}"><span class="dot ${esc(f.severity)}"></span><div class="rf-t">${esc(f.title)}</div><div class="rf-d">${esc(whereText(f))}${f.layer ? ' · ' + esc(f.layer) : ''}</div></div>`;
    }
    if (!fs.length) h += `<div class="side-empty">No located findings match the filter.</div>`;
    if (nw) h += `<div class="side-empty wv-rail">${plural(nw, 'waived finding')} not shown. <button class="link-btn" data-act="waived-show">List them</button></div>`;
    const rail = $('#rail');
    redraw(rail, e.id, () => { rail.innerHTML = h + '</div>'; });
    revealRow(rail.querySelector('.rf.sel'));
  }

  // Selection change only: move the highlight instead of rebuilding the list.
  function selectRailRow(id) {
    const rows = $('#rail').querySelectorAll('.rf');
    let row = null;
    rows.forEach(r => { const on = r.dataset.id === id; r.classList.toggle('sel', on); if (on) row = r; });
    revealRow(row);
    return !!row;
  }

  function setSide(side, quiet) {
    if (!viewer) return;
    if (state.draft && state.draft.side !== side) cancelNote();
    viewer.view.flip = side === 'bottom';
    for (const b of $('#side-seg').children) b.classList.toggle('on', b.dataset.side === side);
    if (!quiet) {
      sideVisibility(viewer.layers, side);
      renderLayers(active());
    }
    viewer.draw();
  }
  // Looking from one side: that side's copper and silkscreen on, the other side's outer layers off.
  function sideVisibility(layers, side) {
    for (const L of layers) if ((L.side === 'top' || L.side === 'bottom') && L.layer) {
      if (L.layer.fn === 'copper' || L.layer.fn === 'silk') L.visible = L.side === side;
      else L.visible = L.visible && L.side === side;
    }
  }

  // What showing a finding takes, worked out on a layer list without changing it: the side to look
  // from (null to stay), the layers to turn on (its own layer; for DFM checks without one, the holes
  // or the outline they measure), the layer whose covering layers are dimmed, and whether it is on an
  // inner layer (the realistic look shows only the outer side). The board and the preview both use it.
  const HOLE_CHECKS = new Set(['drill', 'aspect', 'slot', 'hole-gap', 'hole-edge', 'castellation', 'npth', 'ring', 'via-in-pad']);
  const EDGE_CHECKS = new Set(['outline-corner', 'edge', 'hole-edge', 'castellation']);
  function jumpPlan(layers, f, flip) {
    const entry = f.layer && layers.find(l => l.layer && l.layer.file.name === f.layer);
    let side = f.side;
    if (entry && (entry.side === 'top' || entry.side === 'bottom')) side = entry.side;
    const on = entry ? [entry] : [];
    if (!entry && f.category === 'DFM') {
      if (HOLE_CHECKS.has(f.check)) on.push(...layers.filter(l => l.kind === 'pth' || l.kind === 'npth'));
      if (EDGE_CHECKS.has(f.check)) on.push(...layers.filter(l => l.kind === 'outline'));
    }
    // With every drawn layer hidden ("Hide all"), a finding without a layer of its own would land on
    // an empty board: bring back its side's copper (and silkscreen, for parts) and the outline.
    if (!entry && !layers.some(l => l.visible && l.kind === 'gerber')) {
      const s = side || (flip ? 'bottom' : 'top'), part = f.category === 'Assembly' || f.category === 'BOM' || String(f.id).startsWith('part-');
      on.push(...layers.filter(l => l.layer && l.side === s && (l.layer.fn === 'copper' || (part && l.layer.fn === 'silk'))));
      on.push(...layers.filter(l => l.kind === 'outline'));
    }
    return {
      entry, on, focusLayer: entry ? entry.layer : null,
      side: side && (side === 'bottom') !== flip ? side : null,
      inner: !!entry && entry.side !== 'top' && entry.side !== 'bottom',
    };
  }
  const highlightOf = f => ({ at: f.at ? { x: f.at.x, y: f.at.y } : null, bbox: f.bbox || null });
  // A finding at a point (a part, a pad) is framed with a few millimeters around it, so the
  // parts nearby show where on the board it is; one with an extent gets a small margin.
  const focusBox = f => f.bbox ? Fab.bbox.grow(f.bbox, Math.max(0.5, (f.at && f.at.dia) || 0))
    : Fab.bbox.grow([f.at.x, f.at.y, f.at.x, f.at.y], Math.max(4, (f.at && f.at.dia) || 0));

  function focusFinding(f) {
    const e = active();
    state.sel = f.id;
    closeInspector();
    // Already on the board (moving from one finding to the next): fly there, so it's clear where.
    const onBoard = state.view === 'board' && !!viewer && viewer.pkg === e.pkg;
    if (!onBoard) go('board'); else renderBoard(e);
    const plan = jumpPlan(viewer.layers, f, viewer.view.flip);
    if (plan.side) setSide(plan.side);
    // Its layer is turned on if it was off; layers between the viewer and it are dimmed.
    for (const L of plan.on) L.visible = true;
    viewer.focusLayer = plan.focusLayer;
    if (viewer.photo && plan.inner) { viewer.photo = false; const b = $('#photo-btn'); if (b) b.classList.remove('on'); }
    renderLayers(e);
    if (!selectRailRow(f.id)) renderRail(e);
    viewer.highlight = highlightOf(f);
    if (onBoard) viewer.flyTo(focusBox(f), 2.5); else viewer.focus(focusBox(f), 2.5);
  }

  function drawPlacements(ctx, v) {
    const e = active();
    if (!e || !state.showPnp || !e.pkg || !e.pkg.pnp) return;
    const pkg = e.pkg, side = v.view.flip ? 'bottom' : 'top', d = v.dpr;
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const issues = new Map(((pkg.assembly && pkg.assembly.rows) || []).map(r => [r.part, r.issues]));
    const labels = v.view.scale > 18;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (const p of pkg.pnp.parts) {
      if (p.side !== side || p.gx == null) continue;
      const [x, y] = v.toScreen(p.gx, p.gy);
      if (x < -20 || y < -20 || x > v.W + 20 || y > v.H + 20) continue;
      const bad = (issues.get(p) || []).length;
      ctx.strokeStyle = bad ? '#ff453a' : 'rgba(100, 220, 230, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
      const a = (p.rot * Math.PI / 180) * (v.view.flip ? -1 : 1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 9 * (v.view.flip ? -1 : 1), y - Math.sin(a) * 9); ctx.stroke();
      if (labels) { ctx.fillStyle = bad ? '#ff8a80' : 'rgba(200, 245, 250, 0.95)'; ctx.fillText(p.des, x, y - 7); }
    }
    ctx.restore();
  }

  // The located findings that pass the filter, on layers that are showing, with where their marks
  // sit on screen. The selected one is included (the highlight draws it).
  function findingMarks(v) {
    const e = active(), out = [];
    if (!e) return out;
    const shown = new Set(v.layers.filter(l => l.visible && l.layer).map(l => l.layer.file.name));
    const side = v.view.flip ? 'bottom' : 'top';
    const by = wv(e).by;
    for (const f of visibleFindings(e)) {
      if (!(f.at || f.bbox)) continue;
      { const s = by.get(f.id); if (s && s.state !== 'stale' && f.id !== state.sel) continue; }
      if (f.layer ? !shown.has(f.layer) : (f.side && f.side !== side)) continue;
      const c = f.at || Fab.bbox.center(f.bbox);
      const [x, y] = v.toScreen(c.x, c.y);
      if (x < -10 || y < -10 || x > v.W + 10 || y > v.H + 10) continue;
      out.push({ f, x, y, hot: !!state.focusCheck && f.check === state.focusCheck });
    }
    return out;
  }

  // The finding whose mark is under a board point (mm): the nearest within a few pixels, with the
  // linked check's marks ahead of the dimmed ones.
  function markAt(mx, my) {
    if (!viewer || !viewer.pkg) return null;
    const [px, py] = viewer.toScreen(mx, my);
    let best = null, bd = 11;
    for (const m of findingMarks(viewer)) {
      const dd = Math.hypot(m.x - px, m.y - py) + (state.focusCheck && !m.hot ? 4 : 0);
      if (dd < bd) { bd = dd; best = m.f; }
    }
    return best;
  }

  // Clicking a mark picks its finding out in the list and on the board, leaving the view where it is.
  function selectFinding(f) {
    const e = active();
    state.sel = f.id;
    $('#tip').style.display = 'none';
    if (!selectRailRow(f.id)) {
      // Not listed under the linked check: show every check, so its row is there.
      state.focusCheck = null;
      renderRail(e);
    }
    viewer.focusLayer = jumpPlan(viewer.layers, f, viewer.view.flip).focusLayer;
    viewer.highlight = highlightOf(f);
    viewer.draw();
  }

  // A ring per located finding that passes the filter, on layers that are showing.
  function drawFindingMarks(ctx, v) {
    const color = { error: '#ff453a', warn: '#ff9f0a', info: '#3fc1cf' };
    const d = v.dpr;
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 2;
    for (const { f, x, y, hot } of findingMarks(v)) {
      if (f.id === state.sel) continue;
      ctx.strokeStyle = color[f.severity];
      ctx.globalAlpha = state.focusCheck && !hot ? 0.35 : 1;
      ctx.lineWidth = hot ? 3 : 2;
      const r = hot ? 9 : 6;
      ctx.beginPath();
      // Review notes are speech bubbles, in their severity's color, with the tail on the spot.
      if (f.category === 'Review') { noteBubble(ctx, x, y, hot ? 1.3 : 1); ctx.fillStyle = color[f.severity]; const a = ctx.globalAlpha; ctx.globalAlpha = a * 0.28; ctx.fill(); ctx.globalAlpha = a; }
      // Warnings are triangles, errors and info circles: the shape tells them apart without color.
      else if (f.severity === 'warn') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.75); ctx.lineTo(x - r * 1.1, y + r * 0.75); ctx.closePath(); }
      else ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Review notes ──
  // A reviewer's note on a spot of the board: a finding in the Review category, kept with the run
  // (IndexedDB), shown and sent like the checks' findings. The button at the board's top right arms
  // placing; the next click on the board opens the composer there.
  const checksOnly = fs => fs.filter(f => f.category !== 'Review');
  const NOTE_SEVS = [['error', 'Error'], ['warn', 'Warning'], ['info', 'Info']];
  function noteBubble(ctx, x, y, k) {
    // Body above the spot, tail down to it.
    const w = 8 * k, t = y - 15 * k, b = y - 5 * k, r = 2.5 * k;
    ctx.beginPath();
    ctx.moveTo(x - w + r, t); ctx.lineTo(x + w - r, t); ctx.quadraticCurveTo(x + w, t, x + w, t + r);
    ctx.lineTo(x + w, b - r); ctx.quadraticCurveTo(x + w, b, x + w - r, b);
    ctx.lineTo(x + 3 * k, b); ctx.lineTo(x, y); ctx.lineTo(x - 3 * k, b);
    ctx.lineTo(x - w + r, b); ctx.quadraticCurveTo(x - w, b, x - w, b - r);
    ctx.lineTo(x - w, t + r); ctx.quadraticCurveTo(x - w, t, x - w + r, t);
    ctx.closePath();
  }
  function setPlacing(on) {
    state.placing = on;
    const b = $('#note-btn');
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    $('#board-wrap').classList.toggle('placing', on);
    if (on) { $('#tip').style.display = 'none'; toast('Click the board where the note goes (Esc cancels)'); }
  }
  function startNote(x, y) {
    const e = active();
    setPlacing(false);
    if (!e || e.status !== 'ready') return;
    state.draft = { entry: e.id, x, y, side: viewer.view.flip ? 'bottom' : 'top', sev: 'warn', text: '' };
    const pop = $('#note-pop');
    pop.innerHTML = `<div class="np-head"><span>Review note · ${x.toFixed(2)}, ${y.toFixed(2)} mm · ${state.draft.side === 'top' ? 'Top' : 'Bottom'}</span><button class="icon-btn" data-act="note-cancel" aria-label="Cancel">${ICON.close}</button></div>` +
      `<div class="seg" role="radiogroup" aria-label="Severity">${NOTE_SEVS.map(([k, l]) => `<button role="radio" data-act="note-sev" data-sev="${k}" class="${k === 'warn' ? 'on' : ''}" aria-checked="${k === 'warn'}"><span class="dot ${k}"></span>${l}</button>`).join('')}</div>` +
      `<textarea id="note-text" placeholder="What should be looked at or changed here?" aria-label="Note"></textarea>` +
      `<div class="np-foot"><span class="np-key">Ctrl+Enter posts</span><button class="btn btn-plain" data-act="note-cancel">Cancel</button><button class="btn btn-primary" data-act="note-post" disabled>Post</button></div>`;
    pop.hidden = false;
    viewer.draw();
    $('#note-text').focus();
  }
  function cancelNote() {
    state.draft = null;
    const pop = $('#note-pop');
    pop.hidden = true; pop.innerHTML = '';
    if (viewer) viewer.draw();
  }
  // The pin of the note being written, with the composer kept beside it as the board pans and zooms.
  function drawNoteDraft(ctx, v) {
    const d = state.draft, pop = $('#note-pop');
    if (!d || v !== viewer || pop.hidden) return;
    const [x, y] = v.toScreen(d.x, d.y), dpr = v.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    noteBubble(ctx, x, y, 1.3);
    ctx.fillStyle = { error: '#ff453a', warn: '#ff9f0a', info: '#3fc1cf' }[d.sev];
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    const W = pop.offsetWidth || 280, H = pop.offsetHeight || 200, m = 10;
    let left = x + 16, top = y - 24;
    if (left + W > v.W - m) left = x - 16 - W;
    left = Math.max(m, Math.min(v.W - W - m, left));
    top = Math.max(m, Math.min(v.H - H - m, top));
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function noteUser() { try { return (JSON.parse(localStorage.getItem(Fab.signoffNs + 'settings') || '{}') || {}).user || ''; } catch (err) { return ''; } }
  function postNote() {
    const e = active(), d = state.draft;
    const text = d ? d.text.trim() : '';
    if (!e || !d || !text || d.entry !== e.id) return;
    const line = text.split('\n')[0].trim(), title = line.length > 90 ? line.slice(0, 89).trimEnd() + '…' : line;
    const f = {
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), category: 'Review', check: 'note', severity: d.sev,
      // The title is the first line; the detail holds the rest, or all of it when the title was cut short.
      title, detail: title === line ? text.slice(text.indexOf('\n') + 1 || text.length).trim() : text, at: { x: +d.x.toFixed(4), y: +d.y.toFixed(4) }, side: d.side,
      author: noteUser(), created: new Date().toISOString(),
    };
    e.findings.push(f);
    cancelNote();
    // The new note must show: its severity on, and no filter that hides it.
    state.filter[f.severity] = true;
    if (state.cat && state.cat !== 'Review') state.cat = null;
    if (state.focusCheck && state.focusCheck !== 'note') state.focusCheck = null;
    if (state.q && !visibleFindings(e).includes(f)) state.q = '';
    state.sel = f.id;
    viewer.highlight = highlightOf(f); viewer.focusLayer = null;
    renderAll();
    persistNotes(e).then(ok => toast(ok ? 'Review note added' : 'Review note added for this session; it could not be kept in this browser'));
  }
  function deleteNote(e, id) {
    const f = e && e.findings.find(x => x.id === id && x.category === 'Review');
    if (!f || !confirm(`Delete the review note "${f.title}"?`)) return;
    e.findings = e.findings.filter(x => x !== f);
    if (state.sel === id) { state.sel = null; if (viewer) { viewer.highlight = null; viewer.focusLayer = null; } }
    closeInspector();
    renderAll();
    persistNotes(e).then(ok => toast(ok ? 'Review note deleted' : 'Deleted for this session; the kept run could not be updated'));
  }
  // Write the run's findings back to its kept record. A run opened from Signoff isn't kept yet: keep it
  // now, under its own id. Resolves false when that can't be done.
  async function persistNotes(e) {
    e.revCache = null;
    if (!e.run) return false;
    try {
      if (await Fab.store.updateRun(e.run.id, { findings: Fab.store.compactFindings(e.findings) })) return true;
      if (!e.files) return false;
      if (!e.pkgRec) e.pkgRec = await Fab.store.packageRecord(e.files, e.files.source, e.label);
      await Fab.store.saveRun(e.run, e.findings, e.pkgRec, { sentTo: e.sentTo || null });
      state.keptRuns = null;
      return true;
    } catch (err) { console.error(err); return false; }
  }

  function pickPart(x, y) {
    const e = active(), tip = $('#tip');
    if (!e || !e.pkg.pnp) return;
    const side = viewer.view.flip ? 'bottom' : 'top';
    let best = null, bd = 8 / viewer.view.scale + 0.3;
    for (const p of e.pkg.pnp.parts) if (p.side === side && p.gx != null) { const dd = Math.hypot(p.gx - x, p.gy - y); if (dd < bd) { bd = dd; best = p; } }
    if (!best) { tip.style.display = 'none'; return; }
    const row = e.pkg.assembly.rows.find(r => r.part === best), line = row && row.line;
    tip.innerHTML = `<b>${esc(best.des)}</b> · ${esc(best.side)} · ${best.rot}°<br>${esc(best.comment)}<br><span style="opacity:.7">${esc(best.footprint)}</span>` +
      (line ? `<br>BOM row ${line.row}: ${esc(line.mfr)} ${esc(line.mpn)}` : '<br><span style="color:#ff8a80">Not in BOM</span>') +
      (row && row.issues.length ? `<br><span style="color:#ff8a80">${esc(row.issues.join(', '))}</span>` : '');
    tip.style.display = 'block';
  }

  // ── Tables ──
  function assemblyHtml(e) {
    const pkg = e.pkg;
    let h = `<div class="page wide">` + pageHead(e, 'Assembly', e.label, pkg && pkg.pnp ? `${plural(pkg.pnp.parts.length, 'placement')} from ${esc(pkg.pnp.name)}<span class="sep">·</span>${esc(pkg.pnp.units)}` : '');
    if (!pkg || !pkg.pnp || !pkg.assembly) return h + `<div class="empty"><h2>No pick-and-place</h2><p>${pkg ? 'This package has no pick-and-place file.' : 'Still reading the package.'}</p></div></div>`;
    const rows = pkg.assembly.rows.slice().sort((a, b) => (b.issues.length > 0) - (a.issues.length > 0) || Fab.natCmp(a.part.des, b.part.des));
    const odb = new Map(((pkg.odb && pkg.odb.comps) || []).map(c => [c.des, c]));
    h += `<div class="card table-wrap"><table class="table compact"><thead><tr><th>Designator</th><th>Side</th><th class="num">X mm</th><th class="num">Y mm</th><th class="num">Rot</th><th>Footprint</th><th>Comment</th><th>BOM MPN</th>${pkg.odb ? '<th>ODB++</th>' : ''}<th>Status</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const p = r.part, l = r.line, o = odb.get(p.des);
      const st = r.issues.length ? r.issues.map(s => `<span class="pill ${/outside|side|BOM/.test(s) ? 'error' : 'warn'}">${esc(s)}</span>`).join('') : (l && l.dnp ? '<span class="pill">DNP</span>' : '<span class="pill ok">ok</span>');
      h += `<tr data-act="part" data-i="${i}"><td class="mono">${esc(p.des)}</td><td>${esc(p.side)}</td><td class="num">${p.gx.toFixed(3)}</td><td class="num">${p.gy.toFixed(3)}</td><td class="num">${p.rot}</td><td class="mono">${esc(p.footprint)}</td><td>${esc(p.comment)}</td><td class="mono">${l ? esc(l.mpn) : '<span class="pill error">missing</span>'}</td>` +
        (pkg.odb ? `<td>${o ? (o.noPop ? '<span class="pill">not placed</span>' : '<span class="pill ok">placed</span>') : '<span class="pill warn">absent</span>'}</td>` : '') + `<td>${st}</td></tr>`;
    });
    state.asmRows = rows;
    return h + '</tbody></table></div></div>';
  }

  function bomHtml(e) {
    const pkg = e.pkg, bom = pkg && pkg.bom;
    let h = `<div class="page wide">` + pageHead(e, 'Bill of materials', e.label, bom ? `${esc(bom.name)}<span class="sep">·</span>${plural(bom.lines.length, 'line')}` : '');
    if (!bom) return h + `<div class="empty"><h2>No BOM</h2><p>This package has no BOM spreadsheet with a Designator column.</p></div></div>`;
    const desToRow = new Map();
    for (const l of bom.lines) for (const d of l.des) desToRow.set(d, l.row);
    const byRow = new Map();
    for (const f of e.findings) {
      if ((f.category !== 'BOM' && f.category !== 'Assembly') || f.severity === 'info') continue;
      const rowsHit = new Set();
      if (f.row) rowsHit.add(f.row); else if (f.refs) for (const r of f.refs) if (desToRow.has(r)) rowsHit.add(desToRow.get(r));
      for (const r of rowsHit) { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(f); }
    }
    h += `<div class="card table-wrap"><table class="table compact"><thead><tr><th class="num">Row</th><th>Designators</th><th class="num">Qty</th><th>Name / value</th><th>Manufacturer</th><th>MPN</th><th>Lifecycle</th><th>Issues</th></tr></thead><tbody>`;
    for (const l of bom.lines) {
      const iss = [...new Map((byRow.get(l.row) || []).map(f => [f.check + f.severity, f])).values()];
      h += `<tr data-act="bom-row" data-row="${l.row}"><td class="num muted">${l.row}</td><td class="mono" style="max-width:260px">${esc(l.des.join(', '))}</td><td class="num">${esc(l.qtyRaw)}</td><td>${esc(l.name)}${l.value ? `<div class="muted">${esc(l.value)}</div>` : ''}</td><td>${esc(l.mfr)}</td><td class="mono">${esc(l.mpn)}</td><td>${esc(l.lifecycle)}${l.revStatus ? `<div class="muted">${esc(l.revStatus)}</div>` : ''}</td><td>${iss.map(f => `<span class="pill ${esc(f.severity)}" title="${esc(f.title)}">${esc(f.check)}</span>`).join('')}</td></tr>`;
    }
    return h + '</tbody></table></div></div>';
  }

  function filesHtml(e) {
    const pkg = e.pkg;
    let h = `<div class="page wide">` + pageHead(e, 'Package contents', e.label, pkg ? `${plural(pkg.files.length, 'file')}<span class="sep">·</span>Active Gerber set ${esc(pkg.set.dir)}` : '');
    if (!pkg) return h + '</div>';
    // Anyone can export the package laid out the way fab houses ask, without storing anything.
    if (e.files && !e.files.some(f => f.stub)) h += `<div class="card" style="padding:14px 18px;margin-bottom:14px"><div class="filters" style="margin:0"><b style="font-weight:600">Export as a fab package</b><button class="btn" data-act="export">Download</button></div>` +
      `<p class="note">One zip with Fabrication (Gerber, NC Drill, netlist, drawing) and Assembly (BOM, Pick Place, drawing) folders, files named by function, and a README listing each file's SHA-256: what the fab and assembly houses need, not everything the CAD tool wrote. Made in this browser; nothing is uploaded.</p></div>`;
    const odb = pkg.files.filter(f => f.cls.type === 'odb');
    const rows = pkg.files.filter(f => f.cls.type !== 'odb').sort((a, b) => a.path.localeCompare(b.path));
    const fn = f => {
      const c = f.cls;
      if (c.type !== 'gerber') return esc(c.note || '');
      let s = esc([c.fn, c.side, c.fn === 'copper' && f.layer.cuOrder ? 'L' + f.layer.cuOrder : '', f.layer.polarity === 'negative' ? 'negative' : ''].filter(Boolean).join(' · '));
      if (c.outline) s += ' <span class="pill ok">outline</span>';
      return s;
    };
    h += `<div class="card table-wrap"><table class="table compact"><thead><tr><th>File</th><th>Type</th><th>Function</th><th>Units / format</th><th class="num">Size</th><th>Notes</th></tr></thead><tbody>`;
    for (const f of rows) {
      const c = f.cls, notes = [];
      if (c.type === 'gerber') notes.push(c.active ? '<span class="pill ok">active set</span>' : '<span class="pill">other set</span>');
      if (c.x2) notes.push('<span class="pill">X2</span>');
      if (f.drill) notes.push(`${f.drill.hits.length} hits, ${f.drill.slots.length} slots`);
      if (f.pnp) notes.push(plural(f.pnp.parts.length, 'placement'));
      if (f.bom) notes.push(plural(f.bom.lines.length, 'line'));
      if (c.error) notes.push(`<span class="pill error">${esc(c.error)}</span>`);
      h += `<tr><td class="mono">${esc(f.path)}</td><td><span class="pill ${['gerber', 'drill', 'pnp', 'bom'].includes(c.type) ? 'accent' : ''}">${esc(c.type)}</span></td><td>${fn(f)}</td><td>${esc([c.units, c.format].filter(Boolean).join(' · '))}</td><td class="num">${(f.size / 1024).toFixed(1)} kB</td><td>${notes.join(' ')}</td></tr>`;
    }
    if (odb.length) h += `<tr><td class="mono">${esc(odb[0].path.replace(/\/odb\/.*$/i, '/odb/'))}…</td><td><span class="pill">odb</span></td><td>ODB++ tree</td><td></td><td class="num">${(odb.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} kB</td><td>${odb.length} files${pkg.odb ? `, ${pkg.odb.comps.length} components read` : ''}</td></tr>`;
    return h + '</tbody></table></div></div>';
  }

  // ── Revisions ──
  // ── The fab package (docs/fab-package.md) ──
  // What the fab and assembly houses need, as one zip with Fabrication/ and Assembly/ folders. Send
  // stores it with the run (Signoff lists, tags and downloads it); the Files tab exports it for anyone.
  const who = () => { try { return (JSON.parse(localStorage.getItem(Fab.signoffNs + 'settings') || '{}') || {}).user || ''; } catch (err) { return ''; } };
  const pkgSha = e => (e.run && e.run.package.sha256) || (e.pkgRec && e.pkgRec.sha256) || null;

  // What goes in the package, set under Send's Details: part number and revision (they start every
  // file name) and the files, ticked as Fab.releases.SET says.
  function verForm(e) {
    if (!e.verForm) {
      const d = Fab.releases.defaults(e.files || []);
      const pr = Fab.releases.suggestPnRev((e.run && e.run.package.name) || e.label);
      e.verForm = { pn: pr.pn, rev: pr.rev, picks: new Set([...d].filter(([, v]) => v.on).map(([p]) => p)) };
    }
    return e.verForm;
  }

  function filesPickHtml(e) {
    const f = verForm(e);
    const d = Fab.releases.defaults(e.files || []);
    const byPath = new Map((e.files || []).map(x => [x.path, x]));
    const picked = [...f.picks].filter(p => byPath.has(p) && d.get(p).avail);
    const mb = picked.reduce((n, p) => n + byPath.get(p).size, 0) / 1048576;
    const field = (k, label, attrs) => `<label class="tb-field" style="font-size:13px;display:flex;flex-direction:column;align-items:stretch;gap:3px">${label}<input data-rel="${k}" value="${esc(f[k] || '')}" ${attrs || ''}></label>`;
    let h = `<div style="margin-top:16px;font-weight:600">The fab package</div>` +
      `<p class="note" style="margin-top:2px">What the fab and assembly houses need, not everything the CAD tool wrote: one zip with Fabrication and Assembly folders, files named by part number and revision. Sending stores it with the run, and Signoff EE lists and downloads it.</p>` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:8px">` +
      field('pn', 'Part number', 'placeholder="PCB-1042"') + field('rev', 'Revision', 'placeholder="B"') + `</div>`;
    // Grouped as a fab house reads a package.
    const groups = [['fab', 'Fabrication'], ['assembly', 'Assembly'], ['other', 'Other files']];
    h += `<div class="table-wrap" style="margin-top:10px;max-height:340px;overflow:auto"><table class="table compact"><thead><tr><th></th><th>File</th><th class="num">Size</th><th>Why</th></tr></thead><tbody>`;
    let i = 0;
    for (const [g, title] of groups) {
      const fs = (e.files || []).filter(x => d.get(x.path).group === g).sort((a, b) => Fab.natCmp(a.path, b.path));
      if (!fs.length) continue;
      h += `<tr><td colspan="4" style="font-weight:600;padding-top:10px">${title}</td></tr>`;
      for (const x of fs) {
        const v = d.get(x.path), id = 'relf-' + (i++);
        h += `<tr><td><input type="checkbox" id="${id}" data-act="rel-pick" data-path="${esc(x.path)}"${f.picks.has(x.path) && v.avail ? ' checked' : ''}${v.avail && x.size <= Fab.releases.MAX_MB * 1048576 ? '' : ' disabled'}></td>` +
          `<td class="mono" style="font-size:12px"><label for="${id}">${esc(x.path)}</label></td><td class="num">${x.size >= 1048576 ? (x.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(x.size / 1024)) + ' kB'}</td>` +
          `<td class="muted"${v.big ? ' style="color:var(--warn)"' : ''}>${esc(v.why)}${v.big ? ` (over ${Fab.releases.WARN_MB} MB)` : ''}</td></tr>`;
      }
    }
    h += `</tbody></table></div><p class="note">${plural(picked.length, 'file')}, ${mb.toFixed(2)} MB before compression.</p>`;
    const stubs = (e.files || []).filter(x => x.stub).length;
    if (stubs) h += `<p class="note" style="color:var(--warn)">${plural(stubs, 'file')} of this package aren't kept in this browser (it was reopened from a kept run). Drop the package in again to include them.</p>`;
    return h;
  }

  // Save a zip the browser made (the Files tab export).
  function saveZip(name, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Export the open package as the fab package, made here and saved, nothing stored.
  async function exportPackage(e) {
    try {
      const f = verForm(e);
      const z = await Fab.releases.packageFor(e, { pn: f.pn, rev: f.rev, picks: f.picks });
      saveZip(z.name, z.bytes);
      toast(`Saved ${z.name}`);
    } catch (err) { toast('Not exported: ' + (err.message || err)); }
  }

  // ── Revisions: what changed against a baseline ──
  // Baselines are keyed p:<open package> or r:<kept run>. A kept run is parsed again from this
  // browser without re-running. Tagging runs as a board's revisions is Signoff EE's (docs/signoff-revisions.md).
  function loadKeptRuns() {
    if (state.keptRuns || state.keptRunsBusy) return;
    state.keptRunsBusy = true;
    Fab.store.recentRuns().catch(() => []).then(rs => { state.keptRuns = rs; state.keptRunsBusy = false; renderAll(); });
  }

  function baselineOptions(e) {
    const sha = pkgSha(e), opts = [];
    for (const p of state.pkgs) if (p.id !== e.id && p.pkg && pkgSha(p) !== sha) opts.push({ key: 'p:' + p.id, label: p.label, group: 'Open packages' });
    for (const k of state.keptRuns || []) if (k.run.package.sha256 !== sha) opts.push({ key: 'r:' + k.run.id, label: baseName(k.run.package.name) + ' · ' + new Date(k.run.at).toLocaleDateString(), group: 'Runs in this browser', at: k.run.at });
    return opts;
  }

  // The baseline a reviewer most likely wants: the package opened before this one, else the latest
  // other run kept in this browser.
  function defaultBaseline(e, opts) {
    const open = opts.filter(o => o.key[0] === 'p');
    if (open.length) return open[open.length - 1].key;
    const kept = opts.filter(o => o.key[0] === 'r').sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return kept.length ? kept[0].key : null;
  }

  async function loadBaseline(key) {
    const k = await Fab.store.getRun(key.slice(2));
    const pk = k && await Fab.store.getPackage(k.run.package.key);
    if (!pk) throw new Error('that run is no longer in this browser');
    return { pkg: Fab.classify.build(Fab.store.restoreFiles(pk)), findings: k.findings, label: baseName(k.run.package.name) };
  }

  // One line on what changed, then the changed layers: the check before re-sending a fix.
  function scopeHtml(rc) {
    const ch = Fab.releases.changes(rc.res, rc.delta, null);
    const layers = (rc.res.gerber || []).filter(g => g.status !== 'same');
    const same = (rc.res.gerber || []).length - layers.length;
    const quiet = !layers.length && !ch.bom && !ch.placements && !ch.drill;
    let h = `<div class="card" style="padding:14px 18px;margin-bottom:14px"><div style="font-weight:600;margin-bottom:6px">Since ${esc(rc.label || 'the baseline')}: ${quiet ? 'no changes to the artwork, drill, BOM or placements' : esc(Fab.releases.changesText(ch))}</div>`;
    if (layers.length) h += `<div class="chips" style="flex-wrap:wrap;gap:6px">${layers.map(g => `<span class="pill ${g.status === 'changed' ? 'warn' : 'error'}" title="${esc(g.layer)}">${esc(g.layer.split(/[\\/]/).pop())}${g.status === 'changed' ? ` +${g.added} −${g.removed}` : ' ' + g.status}</span>`).join('')}${same ? `<span class="pill ok">${plural(same, 'layer')} same</span>` : ''}</div>`;
    if (layers.length) h += `<p class="note">Show on a layer under Gerber geometry puts its changes on the board; a fixed or new finding below jumps to its place.</p>`;
    return h + '</div>';
  }

  // Findings fixed and new against the baseline's run.
  function findingsDeltaHtml(rc) {
    let h = `<div class="section-title">Findings</div>`;
    if (!rc.delta) return h + `<div class="card" style="padding:14px 18px;color:var(--text-3)">The baseline has no kept run, so there are no findings to compare.</div>`;
    const d = rc.delta;
    const sevOrder = { error: 0, warn: 1, info: 2 };
    const rows = (fs, kind) => fs.slice().sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]).slice(0, 60).map(f =>
      `<tr${f.at ? ` data-act="rev-find" data-x="${+f.at.x}" data-y="${+f.at.y}" data-layer="${esc(f.layer || '')}"` : ''}><td><span class="pill ${kind === 'fixed' ? 'ok' : f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warn' : ''}">${kind === 'fixed' ? 'fixed' : 'new'}</span></td><td><span class="pill ${f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warn' : ''}">${esc(f.severity)}</span></td><td class="mono">${esc(f.check)}</td><td class="mono">${esc((f.layer || '').split(/[\\/]/).pop())}</td><td>${esc(f.title)}</td></tr>`).join('');
    const more = n => n > 60 ? `<tr><td colspan="5" class="muted">and ${n - 60} more</td></tr>` : '';
    h += `<div class="card" style="padding:12px 18px;margin-bottom:10px">${d.fixed.length || d.added.length ? `<b>${d.fixed.length}</b> fixed, <b>${d.added.length}</b> new, ${d.same.length} unchanged` : `No change: all ${d.same.length} findings are the same`} <span class="muted">(matched by check, severity and layer within 0.25 mm)</span></div>`;
    if (d.fixed.length || d.added.length) h += `<div class="card table-wrap"><table class="table compact"><thead><tr><th></th><th>Severity</th><th>Check</th><th>Layer</th><th>Finding</th></tr></thead><tbody>${rows(d.fixed, 'fixed')}${more(d.fixed.length)}${rows(d.added, 'new')}${more(d.added.length)}</tbody></table></div>`;
    return h;
  }

  function revisionsHtml(e) {
    loadKeptRuns();
    const opts = baselineOptions(e);
    let h = `<div class="page wide">` + pageHead(e, 'Revisions', e.label, 'What changed against a baseline: Gerber geometry, drill, BOM, placements and findings. Tagging runs as the board\'s revisions is in Signoff EE.');
    if (!opts.length) return h + `<div class="card" style="padding:28px;text-align:center"><div class="empty-art">${ICON.upload}</div><h2 style="font:600 19px var(--display);margin:12px 0 6px">Open a baseline to compare against</h2><p style="color:var(--text-2);margin:0 auto 18px;max-width:52ch">Open the previous release package, or just the BOM that was used last time. It joins the package list, and this page shows the differences. Runs kept in this browser are offered here too.</p><button class="btn btn-primary" data-act="open">Open baseline…</button></div></div>`;
    if (!e.baseline || !opts.some(o => o.key === e.baseline)) e.baseline = defaultBaseline(e, opts);
    const groups = [...new Set(opts.map(o => o.group))];
    h += `<div class="section-title">Compare</div><div class="filters"><label class="tb-field" style="font-size:13px">Baseline <select data-act="baseline">${groups.map(g => `<optgroup label="${esc(g)}">${opts.filter(o => o.group === g).map(o => `<option value="${esc(o.key)}"${o.key === e.baseline ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select></label><button class="btn" data-act="open">Open another…</button></div>`;
    if (!e.pkg) return h + '</div>';
    const key = e.baseline;
    if (!e.revCache || e.revCache.key !== key) {
      // An open package can re-run, so it's never cached; the rest are fixed once read.
      if (key[0] === 'p') state.baseCache.delete(key);
      const c = key[0] === 'p' ? (() => { const p = state.pkgs.find(x => x.id === key.slice(2)); return p && p.pkg ? { pkg: p.pkg, findings: Fab.store.compactFindings(p.findings), label: p.label } : { error: 'that package is no longer open' }; })() : state.baseCache.get(key);
      if (!c) {
        state.baseCache.set(key, { busy: true });
        loadBaseline(key).then(b => state.baseCache.set(key, b), err => state.baseCache.set(key, { error: err.message || String(err) })).then(() => renderAll());
      }
      if (!c || c.busy) return h + `<div class="card" style="padding:18px;color:var(--text-3)">Reading the baseline…</div></div>`;
      if (c.error) { state.baseCache.delete(key); return h + `<div class="card" style="padding:18px;color:var(--warn)">Couldn't read the baseline: ${esc(c.error)}.</div></div>`; }
      e.revCache = { key, res: Fab.revisions.compare(c.pkg, e.pkg), delta: c.findings && e.findings ? Fab.revisions.findingsDelta(checksOnly(c.findings), Fab.store.compactFindings(checksOnly(e.findings))) : null, label: c.label };
    }
    const r = e.revCache.res;
    h += scopeHtml(e.revCache);
    const stat = (n, label, cls) => `<div class="card stat ${cls || ''}"><div class="stat-num">${n}</div><div class="stat-label">${label}</div></div>`;
    const bomN = r.bom ? r.bom.added.length + r.bom.removed.length + r.bom.changed.reduce((s, g) => s + g.des.length, 0) : '–';
    const gerN = r.gerber ? r.gerber.filter(x => x.status !== 'same').length : '–';
    h += `<div class="grid grid-4">${stat(bomN, 'BOM designators changed')}${stat(r.pnp ? r.pnp.moved.length + r.pnp.added.length + r.pnp.removed.length : '–', 'Placements changed')}${stat(gerN, 'Gerber layers changed')}${stat(r.drill ? r.drill.added.length + r.drill.removed.length : '–', 'Drill hits changed')}</div>`;
    if (r.bom) {
      h += `<div class="section-title">BOM</div><div class="card table-wrap"><table class="table compact"><thead><tr><th>Change</th><th>Designators</th><th>Detail</th></tr></thead><tbody>`;
      const rows = [];
      if (r.bom.added.length) rows.push(`<tr><td><span class="pill ok">added</span></td><td class="mono">${esc(r.bom.added.map(x => x.des).join(', '))}</td><td>${esc([...new Set(r.bom.added.map(x => x.line.mpn || x.line.name))].join(', '))}</td></tr>`);
      if (r.bom.removed.length) rows.push(`<tr><td><span class="pill error">removed</span></td><td class="mono">${esc(r.bom.removed.map(x => x.des).join(', '))}</td><td>${esc([...new Set(r.bom.removed.map(x => x.line.mpn || x.line.name))].join(', '))}</td></tr>`);
      for (const g of r.bom.changed) rows.push(`<tr><td><span class="pill warn">changed</span></td><td class="mono">${esc(g.des.join(', '))}</td><td>${g.fields.map(f => `<div><b>${esc(f.field)}</b>: ${esc(f.from || '–')} → ${esc(f.to || '–')}</div>`).join('')}</td></tr>`);
      h += (rows.join('') || '<tr><td colspan="3" class="muted">No BOM differences.</td></tr>') + '</tbody></table></div>';
    }
    if (r.pnp) {
      h += `<div class="section-title">Placements</div><div class="card table-wrap"><table class="table compact"><thead><tr><th>Designator</th><th>Change</th></tr></thead><tbody>`;
      const rows = r.pnp.moved.map(m => `<tr data-act="rev-at" data-x="${m.at.x}" data-y="${m.at.y}"><td class="mono">${esc(m.des)}</td><td>${[m.dist > 0.005 ? `moved ${Fab.fmtLen(m.dist, 3)}` : '', m.rot ? `rotated ${m.rot}°` : '', m.side ? `side ${m.side}` : '', m.footprint ? `footprint ${m.footprint}` : ''].filter(Boolean).map(esc).join(' · ')}</td></tr>`);
      if (r.pnp.added.length) rows.push(`<tr><td class="mono">${esc(r.pnp.added.map(p => p.des).join(', '))}</td><td><span class="pill ok">added</span></td></tr>`);
      if (r.pnp.removed.length) rows.push(`<tr><td class="mono">${esc(r.pnp.removed.map(p => p.des).join(', '))}</td><td><span class="pill error">removed</span></td></tr>`);
      h += (rows.join('') || '<tr><td colspan="2" class="muted">No placement differences.</td></tr>') + '</tbody></table></div>';
    }
    if (r.gerber) {
      h += `<div class="section-title">Gerber geometry</div><div class="card table-wrap"><table class="table compact"><thead><tr><th>Layer</th><th>Status</th><th class="num">Added</th><th class="num">Removed</th><th></th></tr></thead><tbody>`;
      r.gerber.forEach((g, i) => {
        h += `<tr><td class="mono">${esc(g.layer)}</td><td><span class="pill ${g.status === 'same' ? 'ok' : g.status === 'changed' ? 'warn' : 'error'}">${g.status === 'same' ? 'same geometry' : g.status}</span></td><td class="num">${g.added != null ? g.added : ''}</td><td class="num">${g.removed != null ? g.removed : ''}</td><td>${g.bbox ? `<button class="btn btn-plain" data-act="rev-layer" data-i="${i}">Show</button>` : ''}</td></tr>`;
      });
      h += '</tbody></table></div><p class="note">Primitives are compared by geometry (rounded to 1 µm), so a re-ordered or re-numbered file with the same artwork shows as "same geometry".</p>';
    }
    if (r.drill && (r.drill.added.length || r.drill.removed.length)) h += `<div class="section-title">Drill</div><div class="card" style="padding:14px 18px">${r.drill.added.length} hits added, ${r.drill.removed.length} removed.</div>`;
    h += findingsDeltaHtml(e.revCache);
    return h + '</div>';
  }

  // "Have I checked this package before?": runs kept in this browser with the same SHA-256. Which
  // revision a package is lives in Signoff EE.
  function checkedBeforeHtml(e) {
    loadKeptRuns();
    const sha = (e.archive && e.archive.fingerprint && e.archive.fingerprint.sha256) || pkgSha(e);
    const ms = (state.keptRuns || []).filter(k => k.run.package.sha256 === sha && (!e.run || k.run.id !== e.run.id));
    return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--hair)"><b style="font-weight:600">Checked before</b> ` +
      (ms.length ? ms.map(k => `<div>${esc(new Date(k.run.at).toLocaleString())}${k.sentTo ? ', sent to ' + esc(k.sentTo.name || k.sentTo.projectId) : ''}</div>`).join('')
        : '<span class="muted">No other run of this package is kept in this browser.</span>') + '</div>';
  }

  // ── Archive ──
  function archiveHtml(e) {
    let h = `<div class="page wide">` + pageHead(e, 'Archive checks', e.label, 'Fingerprint the package, check nested ODB++ archives against the extracted tree, and compare with another copy.');
    const a = e.archive;
    if (!e.pkg) return h + '</div>';
    if (!a) return h + `<div class="card" style="padding:18px;color:var(--text-3)">Hashing and unpacking nested archives…</div></div>`;
    h += `<div class="section-title">Fingerprint</div><div class="card" style="padding:16px 18px">` + (a.fingerprint
      ? `<dl class="kv" style="margin:0"><dt>Archive</dt><dd>${esc(a.fingerprint.name)}</dd><dt>Size</dt><dd>${a.fingerprint.size.toLocaleString()} bytes</dd><dt>SHA-256</dt><dd class="hash">${a.fingerprint.sha256} <button class="btn btn-plain" data-act="copy" data-text="${a.fingerprint.sha256}">Copy</button></dd></dl>`
      : '<span class="muted">Opened as loose files, so there is no single archive to fingerprint.</span>') + checkedBeforeHtml(e) + '</div>';
    h += `<div class="section-title">Nested archives</div>`;
    if (!a.archives.length) h += `<div class="card" style="padding:16px 18px;color:var(--text-3)">No nested archives in this package.</div>`;
    else {
      h += `<div class="card table-wrap"><table class="table compact"><thead><tr><th>Archive</th><th class="num">Entries</th><th>Against odb/ folder (${a.treeFiles} files)</th></tr></thead><tbody>`;
      for (const x of a.archives) {
        const d = x.diff;
        const st = x.error ? `<span class="pill error">${esc(x.error)}</span>` : !d ? '<span class="muted">No ODB++ content to compare</span>' :
          d.changed.length || d.onlyA.length || d.onlyB.length ? `<span class="pill error">differs</span> ${d.changed.length} changed, ${d.onlyA.length} only in archive, ${d.onlyB.length} only in folder<div class="muted mono">${esc(d.changed.concat(d.onlyA, d.onlyB).slice(0, 8).join('\n'))}</div>` : `<span class="pill ok">identical</span> ${d.same} files`;
        h += `<tr><td class="mono">${esc(x.file)}</td><td class="num">${x.entries != null ? x.entries : ''}</td><td>${st}</td></tr>`;
      }
      h += '</tbody></table></div>';
    }
    const others = state.pkgs.filter(p => p.id !== e.id && p.pkg);
    h += `<div class="section-title">Compare with another copy</div><div class="card" style="padding:16px 18px">`;
    if (!others.length) h += `<p style="margin:0 0 12px;color:var(--text-2)">Open the copy you are about to send (for example the one in the Altium project folder) and Fabcheck confirms it is byte-for-byte the same.</p><button class="btn" data-act="open">Open copy…</button>`;
    else {
      h += `<label class="tb-field" style="font-size:13px">Copy <select data-act="copy-with">${others.map(p => `<option value="${p.id}"${p.id === e.copyWith ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label> <button class="btn btn-primary" data-act="compare-copy">Compare</button>`;
      const c = e.copyResult;
      if (c) {
        const d = c.files;
        h += `<div style="margin-top:14px">` + (c.identical ? `<span class="pill ok">identical</span> Same SHA-256 (${c.hashA.slice(0, 16)}…).` :
          d.changed.length || d.onlyA.length || d.onlyB.length ? `<span class="pill error">different</span> ${d.changed.length} files changed, ${d.onlyA.length} only here, ${d.onlyB.length} only in the copy.<div class="muted mono" style="margin-top:6px;white-space:pre-wrap">${esc(d.changed.concat(d.onlyA.map(x => '+ ' + x), d.onlyB.map(x => '- ' + x)).slice(0, 30).join('\n'))}</div>` :
            `<span class="pill ok">same contents</span> All ${d.same} files are byte-identical, but the archives themselves differ (zip metadata).`) + '</div>';
      }
    }
    return h + '</div></div>';
  }
  async function loadArchive(e) {
    if (e.archive || e.archiveBusy || !e.pkg) return;
    e.archiveBusy = true;
    try { e.archive = await Fab.archive.inspect(e.pkg, t => log(e, 'dim', t)); }
    catch (err) { e.archive = { archives: [], fingerprint: null, treeFiles: 0, error: String(err) }; }
    e.archiveBusy = false;
    if (state.view === 'archive' && e.id === state.active) renderAll();
  }

  // ── Events ──
  function onClick(ev) {
    const t = ev.target.closest('[data-act],[data-view]');
    if (!t) {
      // A click on blank space in the main area (nothing to click or type in, no text being
      // selected; the board's canvas picks findings) closes an open finding inspector.
      if ($('#inspector').classList.contains('open') && ev.target.closest('#main') &&
        !ev.target.closest('a, button, input, select, textarea, label, summary, [contenteditable], [role="button"], [tabindex], tr, canvas, svg, .sheet-wrap') &&
        !String(window.getSelection())) closeInspector();
      return;
    }
    const e = active();
    if (t.dataset.view && !t.dataset.act) { go(t.dataset.view); return; }
    switch (t.dataset.act) {
      case 'open': $('#file-zip').click(); break;
      case 'open-dir': $('#file-dir').click(); break;
      case 'select': state.active = t.dataset.id; state.sel = null; $('#app').classList.remove('nav-open'); renderAll(); break;
      case 'view': go(t.dataset.view); break;
      case 'theme': { const th = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(th); applyTheme(th); break; }
      case 'nav': toggleSidebar(); break;
      case 'rerun':
        if (!e || !e.pkg || e.status !== 'ready') break;
        // A demo board's run keeps its fixed id when run again (saveRun's expect: same package), so the
        // demo links, Send's project and the suite tour's steps still know it (Chris, 2026-11-08: the
        // tour asks for a re-run on the Main PCBA).
        if (e.run && e.run.demo && !e.expect) e.expect = { run: e.run, project: null };
        runChecks(e, 'Re-running checks');
        break;
      case 'outline-pick': state.outlinePicker = e ? e.id : null; renderAll(); break;
      case 'outline-close': state.outlinePicker = e ? 'closed:' + e.id : null; renderAll(); break;
      case 'outline-use': useOutline(e, t.dataset.path); break;
      case 'sev': state.filter = { error: false, warn: false, info: false }; state.filter[t.dataset.sev] = true; state.cat = null; state.check = null; go('findings'); break;
      case 'cat': state.cat = t.dataset.cat; state.check = null; state.filter = { error: true, warn: true, info: true }; state.closed.delete(t.dataset.cat); go('findings'); break;
      case 'mx-check': {
        // A matrix cell: Findings for that check only; the same cell again shows everything.
        const key = t.dataset.key, cat = key.split('/')[0];
        if (state.check === key && state.view === 'findings') { state.check = null; state.cat = null; }
        else { state.check = key; state.cat = cat; state.q = ''; state.filter = { error: true, warn: true, info: true }; state.closed.delete(cat); }
        dropHiddenSel(e);
        if (state.view === 'findings') renderAll(); else go('findings');
        break;
      }
      case 'mx-clear': state.check = null; state.cat = null; dropHiddenSel(e); renderAll(); break;
      case 'mx-names': try { localStorage.setItem(MX_KEY, mxNames() ? '0' : '1'); } catch (err) { /* storage blocked */ } renderAll(); break;
      case 'sev-toggle': state.filter[t.dataset.sev] = !state.filter[t.dataset.sev]; dropHiddenSel(e); if (state.view === 'board') { renderRail(e); viewer.draw(); } else renderAll(); break;
      case 'cat-filter': state.cat = t.dataset.cat || null; state.check = null; dropHiddenSel(e); renderAll(); break;
      case 'tp-toggle': {
        const cat = t.closest('.tp-group').dataset.cat, open = !t.closest('.tp-group').classList.contains('open');
        state.tpOpen[open ? 'add' : 'delete'](cat);
        // Closing the group hides its selected finding, so drop the selection with it.
        if (!open && e && e.findings.some(f => f.id === state.sel && f.tp && f.category === cat)) { state.sel = null; closeInspector(); if (viewer) { viewer.highlight = null; viewer.focusLayer = null; } }
        renderAll();
        break;
      }
      case 'toggle-sec': { const s = t.closest('.sec'); s.classList.toggle('collapsed'); state.closed[s.classList.contains('collapsed') ? 'add' : 'delete'](s.dataset.cat); break; }
      case 'finding': if (state.wvForm !== t.dataset.id) state.wvForm = null; openInspector(e.findings.find(f => f.id === t.dataset.id)); break;
      // Waivers (waivers.js): the inspector's buttons, the Waived fold and the Waivers list.
      case 'waive-open': { const f = e.findings.find(x => x.id === t.dataset.id); if (f) { state.wvForm = f.id; openInspector(f); } break; }
      case 'waive-cancel': { state.wvForm = null; const f = e.findings.find(x => x.id === state.sel); if (f) openInspector(f); break; }
      case 'waive-do': { const f = e.findings.find(x => x.id === t.dataset.id), r = $('#wv-reason'); if (f && r && r.value.trim()) waiveOne(e, f, r.value.trim()); break; }
      case 'waive-sim': { const f = e.findings.find(x => x.id === t.dataset.id); if (f) openSimilar(e, f); break; }
      case 'waive-drop': {
        const f = e.findings.find(x => x.id === t.dataset.id), st = f && staleOf(e, f);
        if (!st) break;
        const items = st.rule.items.filter(s => s !== st.was);
        if (items.length) Fab.waivers.putRule(scopeOf(e), Object.assign({}, st.rule, { items })); else Fab.waivers.removeRule(scopeOf(e), st.rule.id);
        afterWaiverChange(e, f, 'Old waiver dropped');
        break;
      }
      case 'unwaive': { const f = e.findings.find(x => x.id === t.dataset.id); if (f) unwaive(e, f); break; }
      case 'rule-ok': ruleLooked(e, t.dataset.rule, t.dataset.id ? e.findings.find(x => x.id === t.dataset.id) : null); break;
      case 'rule-edit': openSimilar(e, null, t.dataset.rule); break;
      case 'rule-remove': removeRule(e, t.dataset.rule); break;
      case 'kind-open': { const f = e.findings.find(x => x.id === t.dataset.id); if (f) openKind(e, f); break; }
      case 'kind-remove': {
        const k = Fab.waivers.kinds(scopeOf(e)).find(x => x.id === t.dataset.kind);
        if (!k || !confirm(`Stop treating ${Fab.waivers.describeKind(k).replace(/^\w/, c => c.toLowerCase())}? The checks run again.`)) break;
        Fab.waivers.removeKind(scopeOf(e), k.id);
        if (e.status === 'ready' && e.pkg) { closeInspector(); state.sel = null; runChecks(e, `Re-running checks: no longer ${Fab.waivers.describeKind(k).replace(/^\w/, c => c.toLowerCase())}`); } else renderAll();
        break;
      }
      case 'waived-toggle': {
        const sel = e.findings.find(x => x.id === state.sel);
        const open = state.waivedOpen || !!(sel && isWaived(e, sel) && visibleFindings(e).includes(sel));
        if (open && sel && isWaived(e, sel)) { state.sel = null; closeInspector(); if (viewer) { viewer.highlight = null; viewer.focusLayer = null; } }
        state.waivedOpen = !open;
        renderAll();
        break;
      }
      case 'waived-show': {
        // Every waived error and warning, the fold open, scrolled to.
        state.waivedOpen = true; state.cat = null; state.check = null; state.q = ''; state.filter.error = true; state.filter.warn = true;
        go('findings');
        const sec = $('#waived-sec'); if (sec) sec.scrollIntoView({ block: 'start' });
        break;
      }
      case 'close-insp': closeInspector(); break;
      case 'show-on-board': openFromPreview(e.findings.find(f => f.id === t.dataset.id)); break;
      case 'board-finding': focusFinding(e.findings.find(f => f.id === t.dataset.id)); break;
      case 'fit': viewer.highlight = null; viewer.focusLayer = null; viewer.fit(); break;
      case 'pnp': state.showPnp = !state.showPnp; t.classList.toggle('on', state.showPnp); viewer.draw(); break;
      case 'note-mode': if (e && e.status === 'ready') { cancelNote(); setPlacing(!state.placing); } break;
      case 'note-cancel': cancelNote(); break;
      case 'note-post': postNote(); break;
      case 'note-delete': deleteNote(e, t.dataset.id); break;
      case 'note-sev':
        if (state.draft) {
          state.draft.sev = t.dataset.sev;
          for (const b of t.parentNode.children) { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
          viewer.draw();
        }
        break;
      case 'photo': viewer.photo = !viewer.photo; t.classList.toggle('on', viewer.photo); viewer.draw(); break;
      case 'layers-all': { const on = !viewer.layers.some(l => l.visible); viewer.layers.forEach(l => { l.visible = on; }); renderLayers(e); viewer.draw(); break; }
      case 'layers-fold': layersUi({ folded: !$('#board-view').classList.contains('layers-collapsed') }); renderLayers(e); break;
      case 'part': { const p = state.asmRows[+t.dataset.i].part; focusFinding({ id: 'part-' + p.des, at: { x: p.gx, y: p.gy }, side: p.side }); break; }
      case 'rev-at': focusFinding({ id: 'rev', at: { x: +t.dataset.x, y: +t.dataset.y } }); break;
      case 'rev-find': focusFinding({ id: 'rev', at: { x: +t.dataset.x, y: +t.dataset.y }, layer: t.dataset.layer || undefined }); break;
      case 'rev-layer': { const g = e.revCache.res.gerber[+t.dataset.i]; focusFinding({ id: 'rev', bbox: g.bbox, layer: g.layerRef.file.name }); break; }
      case 'stage-open': {
        // With a step picked on the stage: its first error with a place (else its first warning),
        // shown the way a selected finding is. Otherwise, or with none placed, the board as it is.
        const fs = Fab.stage.stepFindings(e).filter(located);
        const best = fs.find(f => f.severity === 'error') || fs[0];
        if (best) focusFinding(best); else go('board');
        break;
      }
      case 'stage-layer': {
        const file = t.dataset.file;
        // The layer's worst finding with a place, shown the way a selected finding is; a layer
        // without one opens alone on the board.
        const sev = { error: 0, warn: 1, info: 2 };
        const best = e.findings.filter(f => f.layer === file && located(f)).sort((a, b) => sev[a.severity] - sev[b.severity])[0];
        if (best) { focusFinding(best); break; }
        go('board');
        const L = viewer.layers.find(l => l.layer && l.layer.file.name === file);
        if (L && (L.side === 'top' || L.side === 'bottom')) setSide(L.side, true);
        for (const l of viewer.layers) if (l.kind === 'gerber') l.visible = l === L;
        renderLayers(e); viewer.draw();
        break;
      }
      case 'copy-log': copyText(e.log.map(l => `${(l.t / 1000).toFixed(2).padStart(7)}s  ${l.text}`).join('\n')); break;
      case 'copy': copyText(t.dataset.text); break;
      case 'signoff-send': case 'signoff-send-anyway': sendToSignoff(e, t.dataset.act === 'signoff-send-anyway'); break;
      case 'export': exportPackage(e); break;
      case 'gh-signin': showSignIn(); break;
      case 'gh-signout':
        if (confirm('Sign out of GitHub in this browser? Signoff EE shares the sign-in, so it signs out too.')) { Fab.repoRuns.signOut(); state.repoProbe.clear(); renderAll(); }
        break;
      case 'signoff-details': e.signoffOpen = !e.signoffOpen; renderAll(); break;
      case 'back-signoff': {
        const pid = (e.sentTo && e.sentTo.projectId) || (e.link && e.link.project) || (e.need && e.need.link && e.need.link.project);
        // Signoff opens in this tab: a check still running would stop.
        if (state.pkgs.some(p => p.status === 'running' || p.status === 'loading') && !confirm('A check is still running. Leave Fabcheck for Signoff EE anyway? It will stop.')) break;
        if (!Fab.signoff.openFindings(pid)) toast('That project is not in Signoff EE in this browser');
        break;
      }
      case 'open-run': if (!ev.target.closest('[data-act="delete-run"]')) openStoredRun(t.dataset.id); break;
      case 'delete-run':
        if (confirm('Delete this run and, if no other run uses it, its stored package from this browser?')) Fab.store.deleteRun(t.dataset.id).then(() => { state.keptRuns = null; renderAll(); });
        break;
      case 'sample': {
        // A demo board opens by its fixed run, as Signoff EE's demo links do, so it runs on Overview as that
        // run, tied to its Signoff EE board (Send picks it); the demo tour starts a run here (Chris, 2026-11-08).
        const db = Fab.DEMO && demoBoards().find(x => x.run && x.file === t.dataset.file);
        // Clicked, it always runs live, never a stored copy of that run (Chris, 2026-11-08: the tour should
        // show the package loading and its checks running): openRunLink skips the stored run for it.
        if (db) { state.liveRun = db.run; location.hash = '#/overview?run=' + encodeURIComponent(db.run) + '&project=' + encodeURIComponent(db.project); break; }
        openPackage(() => Fab.loader.fromUrl(t.dataset.file || SAMPLE), t.dataset.name || 'fabcheck-sample-board.zip'); break;
      }
      case 'rules-sel': state.rulesSel = t.dataset.id; renderAll(); break;
      case 'rules-tab': state.rulesTab = t.dataset.tab; state.checkSel = null; renderAll(); break;
      case 'check-doc': ev.preventDefault(); showCheckDoc(t.dataset.key); break;
      case 'check-findings': {
        const [cat, check] = t.dataset.key.split('/');
        state.q = ''; state.check = cat + '/' + check; state.cat = cat; state.filter = { error: true, warn: true, info: true };
        state.closed.delete(cat);
        go('findings');
        break;
      }
      case 'profile-use': useProfile(t.dataset.id); break;
      case 'profile-dup': {
        const src = Fab.rules.resolve(t.dataset.id);
        const name = prompt('Name the new profile (for example the fab house and stackup):', src.builtin ? src.name.replace(/\s*\(.*\)$/, '') + ' – custom' : src.name + ' (copy)');
        if (!name) break;
        state.rulesSel = Fab.rules.create(t.dataset.id, name.trim());
        rulesEdited(state.rulesSel, `New profile ${name.trim()}`);
        renderAll();
        break;
      }
      case 'profile-export': {
        const r = Fab.rules.resolve(t.dataset.id);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([Fab.rules.exportJson(r.id)], { type: 'application/json' }));
        a.download = r.name.replace(/[^\w.-]+/g, '_') + '.fabcheck-profile.json';
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'profile-import': $('#file-profile').click(); break;
      case 'profile-reset-all':
        if (confirm("Reset every rule to the base profile's value?")) { Fab.rules.resetAll(t.dataset.id); rulesEdited(t.dataset.id, 'Profile reset to its base'); renderAll(); }
        break;
      case 'profile-delete': {
        const r = Fab.rules.resolve(t.dataset.id);
        if (!confirm(`Delete profile "${r.name}"? Runs made with it keep their own copy of its rules.`)) break;
        Fab.rules.remove(r.id);
        if (state.profile === r.id) useProfile(r.base);
        state.rulesSel = r.base;
        rulesEdited(r.id, ''); renderAll();
        break;
      }
      case 'rule-reset': {
        const r = Fab.rules.RULES.find(x => x.key === t.dataset.key);
        Fab.rules.resetRule(state.rulesSel, r.key);
        rulesEdited(state.rulesSel, `${r.name} reset`); renderAll();
        break;
      }
      case 'clear-focus': state.focusCheck = null; renderRail(e); viewer.draw(); break;
      case 'home': state.active = null; history.pushState(null, '', location.pathname + location.search + '#/overview'); route(); break;
      case 'compare-copy': {
        const other = state.pkgs.find(p => p.id === ($('[data-act="copy-with"]') || {}).value);
        if (!other) break;
        e.copyWith = other.id;
        Fab.archive.compareCopies(e.pkg, other.pkg).then(r => { e.copyResult = r; renderAll(); });
        break;
      }
      default: break;
    }
  }
  function copyText(s) { navigator.clipboard.writeText(s).then(() => toast('Copied'), () => toast('Copy failed')); }

  function init() {
    applyTheme(readTheme());
    if (Fab.DEMO) {
      document.querySelectorAll('.side-tools a.side-link').forEach(a => a.setAttribute('href', Fab.demoHref(a.getAttribute('href'))));
      const banner = $('#demo-banner');
      banner.hidden = false;
      document.body.classList.add('has-banner');
      banner.innerHTML = 'You’re exploring a demo of Fabcheck, Dovetail’s fab package DFM tool. Files never leave this browser.<button id="reset-demo">Reset demo</button>';
      banner.querySelector('#reset-demo').addEventListener('click', async () => {
        for (const k of Object.keys(localStorage)) if (k.indexOf(Fab.fabcheckNs) === 0) localStorage.removeItem(k);
        await Fab.store.clearAll().catch(() => {});
        location.reload();
      });
    }
    // A token or project home set in Signoff EE meanwhile: check where runs can be stored again.
    window.addEventListener('storage', ev => {
      if (ev.key === 'signoff.token' || ev.key === Fab.signoffNs + 'settings' || ev.key === Fab.signoffNs + 'homes' || ev.key === Fab.signoffNs + 'roster') { state.repoProbe.clear(); renderAll(); }
    });
    document.addEventListener('click', onClick);
    document.addEventListener('toggle', ev => {
      if (!ev.target.matches) return;
      if (ev.target.matches('details.logbox')) state.logOpen = ev.target.open;
      // Keep a Send to Signoff issue's findings open across re-renders.
      const e = active();
      if (ev.target.matches('details.so-locs') && e) (e.signoffShown || (e.signoffShown = new Set()))[ev.target.open ? 'add' : 'delete'](ev.target.dataset.key);
    }, true);
    document.addEventListener('change', ev => {
      const e = active();
      if (ev.target.matches('[data-act="profile"]')) useProfile(ev.target.value);
      if (ev.target.matches('[data-act="rule"]')) {
        const r = Fab.rules.RULES.find(x => x.key === ev.target.dataset.key);
        const prof = Fab.rules.resolve(state.rulesSel);
        const v = parseFloat(ev.target.value);
        const errs = Fab.rules.validate(r.key, v, prof.values).filter(i => i.level === 'error');
        if (errs.length) { toast(`${r.name}: ${errs[0].text}`); renderAll(); return; }
        if (v === Fab.rules.resolve(prof.base).values[r.key]) Fab.rules.resetRule(prof.id, r.key); else Fab.rules.setRule(prof.id, r.key, v);
        rulesEdited(prof.id, `${r.name} set to ${Fab.rules.fmtVal(r, v)} in ${prof.name}`);
        renderAll();
      }
      if (ev.target.matches('[data-act="profile-name"]') && ev.target.value.trim()) { Fab.rules.rename(state.rulesSel, ev.target.value.trim()); rulesEdited(state.rulesSel, ''); renderAll(); }
      if (ev.target.matches('[data-act="profile-note"]')) { Fab.rules.setNotes(state.rulesSel, { [ev.target.dataset.key]: ev.target.value.trim() }); rulesEdited(state.rulesSel, ''); }
      if (ev.target.matches('[data-act="thickness"]')) {
        state.thickness = parseFloat(ev.target.value) || 1.6;
        if (e && e.pinned) e.pinned.thickness = state.thickness;
        if (e && e.status === 'ready') runChecks(e, `Board thickness set to ${Fab.fmtLen(state.thickness)}`);
      }
      if (ev.target.matches('[data-act="signoff-project"]')) { e.signoffSlug = ev.target.value; e.signoffResult = null; renderAll(); }
      if (ev.target.matches('[data-act="signoff-pick"], [data-act="signoff-all"], [data-act="signoff-sev"]')) {
        // All issues: every group but the waived ones, which keep their own box.
        if (ev.target.dataset.act === 'signoff-all') { const plan = sendPlan(e); sendSkip(e, plan); for (const g of plan) if (!g.waived) e.signoffSkip[ev.target.checked ? 'delete' : 'add'](g.key); }
        else if (ev.target.dataset.act === 'signoff-sev') {
          // Every issue of one kind (Errors, Warnings, Review notes) in or out; the others stay as they are.
          for (const g of sendPlan(e)) if (sendKind(g) === ev.target.dataset.sev) e.signoffSkip[ev.target.checked ? 'delete' : 'add'](g.key);
        } else e.signoffSkip[ev.target.checked ? 'delete' : 'add'](ev.target.dataset.key);
        // Keep focus on the box, so the next one is a Tab away.
        const id = ev.target.id;
        renderAll();
        const el = document.getElementById(id); if (el) el.focus({ preventScroll: true });
      }
      if (ev.target.matches('[data-act="baseline"]')) { e.baseline = ev.target.value; e.revCache = null; renderAll(); }
      if (ev.target.matches('[data-rel]') && e) verForm(e)[ev.target.dataset.rel] = ev.target.value;
      if (ev.target.matches('[data-act="rel-pick"]') && e) {
        verForm(e).picks[ev.target.checked ? 'add' : 'delete'](ev.target.dataset.path);
        const id = ev.target.id;
        renderAll();
        const el = document.getElementById(id); if (el) el.focus({ preventScroll: true });
      }
      if (ev.target.matches('[data-layer]')) { viewer.layers[+ev.target.dataset.layer].visible = ev.target.checked; viewer.draw(); syncLayersAll(); }
    });
    document.addEventListener('input', ev => {
      if (ev.target.id === 'note-text') { if (state.draft) state.draft.text = ev.target.value; $('#note-pop [data-act="note-post"]').disabled = !ev.target.value.trim(); return; }
      if (ev.target.id === 'wv-reason') { const b = $('#inspector [data-act="waive-do"]'); if (b) b.disabled = !ev.target.value.trim(); return; }
      // Send's part number and revision keep what is typed, so a re-render (a log line) doesn't lose it.
      if (ev.target.matches('[data-rel]')) { const e = active(); if (e) verForm(e)[ev.target.dataset.rel] = ev.target.value; return; }
      if (ev.target.id === 'f-search' || ev.target.id === 'rail-search') {
        state.q = ev.target.value;
        dropHiddenSel(active());
        const pos = ev.target.selectionStart, id = ev.target.id;
        if (id === 'rail-search') { renderRail(active()); if (viewer) viewer.draw(); } else renderAll();
        const el = document.getElementById(id); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      }
    });
    $('#side-seg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) setSide(b.dataset.side); });
    // Copy the FileList before clearing the input (clearing it empties the list).
    // A run waiting for its package takes the next upload as that package.
    const waiting = () => {
      const a = active();
      if (!a || a.status !== 'needs') return {};
      state.pkgs = state.pkgs.filter(x => x !== a);
      return a.need.known ? { expect: a.need.known, link: a.need.link } : { link: a.need.link };
    };
    $('#file-zip').addEventListener('change', ev => { const fl = Array.from(ev.target.files); ev.target.value = ''; if (fl.length) openPackage(() => Fab.loader.fromFileList(fl), fl.length === 1 ? fl[0].name : plural(fl.length, 'file'), waiting()); });
    $('#file-dir').addEventListener('change', ev => { const fl = Array.from(ev.target.files); ev.target.value = ''; if (fl.length) openPackage(() => Fab.loader.fromFileList(fl), (fl[0].webkitRelativePath || '').split('/')[0] || 'Folder', waiting()); });
    let dragDepth = 0;
    document.addEventListener('dragenter', ev => { ev.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    document.addEventListener('dragover', ev => ev.preventDefault());
    document.addEventListener('drop', ev => {
      ev.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
      // Capture now: the DataTransfer is emptied once this handler returns.
      const drop = Fab.loader.captureDrop(ev.dataTransfer);
      const n = drop.entries.length || drop.files.length;
      if (!n) return;
      const first = drop.entries[0] || drop.files[0];
      openPackage(() => Fab.loader.fromDrop(drop), n === 1 ? first.name : plural(n, 'item'), waiting());
    });
    // The composer's own keys: Ctrl+Enter (Cmd+Enter) posts, Esc drops the note.
    $('#note-pop').addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelNote(); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); postNote(); }
    });
    document.addEventListener('keydown', ev => {
      // The inspector's waive form: Ctrl+Enter (Cmd+Enter) waives, Esc closes the form.
      if (ev.target.id === 'wv-reason') {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); const b = $('#inspector [data-act="waive-do"]'); if (b && !b.disabled) b.click(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); const b = $('#inspector [data-act="waive-cancel"]'); if (b) b.click(); }
        return;
      }
      if (ev.target.matches('input, select, textarea')) return;
      if (document.querySelector('.sheet-wrap')) return; // a panel is open: its own keys
      if (ev.key === 'Escape' && (state.placing || state.draft)) { setPlacing(false); cancelNote(); return; }
      if (ev.key === 'Escape') closeInspector();
      // W waives the finding in the inspector (asks why); Shift+W opens Waive similar.
      if ((ev.key === 'w' || ev.key === 'W') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && $('#inspector').classList.contains('open')) {
        const e = active(), f = e && e.findings.find(x => x.id === state.sel);
        if (f && e.status === 'ready' && Fab.waivers.isWaivable(f) && !isWaived(e, f)) {
          ev.preventDefault();
          if (ev.shiftKey) openSimilar(e, f); else { state.wvForm = f.id; openInspector(f); }
        }
        return;
      }
      // Board: up and down step through the findings list, in its order, each shown as if selected.
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && state.view === 'board' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const rows = [...$('#rail').querySelectorAll('.rf')], e = active();
        if (!rows.length || !e) return;
        ev.preventDefault();
        const i = rows.findIndex(r => r.dataset.id === state.sel), down = ev.key === 'ArrowDown';
        const next = rows[i < 0 ? (down ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + (down ? 1 : -1)))];
        if (next.dataset.id !== state.sel) focusFinding(e.findings.find(f => f.id === next.dataset.id));
        return;
      }
      // Findings: the same keys step through the rows shown (folded sections skipped), opening each in the inspector.
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && state.view === 'findings' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const rows = [...document.querySelectorAll('.f-row')].filter(r => r.offsetParent), e = active();
        if (!rows.length || !e) return;
        ev.preventDefault();
        const i = rows.findIndex(r => r.dataset.id === state.sel), down = ev.key === 'ArrowDown';
        const next = rows[i < 0 ? (down ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + (down ? 1 : -1)))];
        const f = e.findings.find(x => x.id === next.dataset.id);
        if (f && f.id !== state.sel) { openInspector(f); next.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      if (ev.key === 'o' && !ev.ctrlKey && !ev.metaKey) $('#file-zip').click();
      else if (ev.key === '[' && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); toggleSidebar(); }
    });
    // Applied on narrow windows too (suite.css only hides it above 860 px), so widening the window
    // later shows the sidebar as it was left.
    try { if (localStorage.getItem(SIDE_KEY) === '1') $('#app').classList.add('side-collapsed'); } catch (e) { /* storage blocked */ }
    bindLayersResize();
    $('#file-profile').addEventListener('change', async ev => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      try { state.rulesSel = Fab.rules.importJson(await f.text()); rulesEdited(state.rulesSel, ''); toast('Profile imported'); renderAll(); }
      catch (err) { toast('Could not import: ' + err.message); }
    });
    syncProfiles();
    // Runs Signoff handed over but nobody opened.
    Fab.store.purgeHandoff().catch(() => {});
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    route();
    // Dev helper: ?pkg=<url> (repeatable) loads packages served from the same origin (tools/serve.py).
    const urls = new URLSearchParams(location.search).getAll('pkg');
    (async () => { for (const u of urls) await openPackage(() => Fab.loader.fromUrl(u), decodeURIComponent(u.split('/').pop())); })();
  }

  // ── Tool updates (as in Signoff EE) ──
  // A page left open keeps running the version it loaded. Now and then (5 s after opening, every
  // 5 minutes, when the tab comes back into view) it asks this site which version it serves now.
  // If that's another one, it reloads into it, but only while nothing is open or running: a
  // loaded package isn't kept across a reload, so with one open it waits and asks again later.
  // The new page says "Tool updated". If the site serves the same version, or can't be reached,
  // the page stays as it is. A version it already reloaded for is never tried twice.
  // The scripts carry no ?v= stamp, so the browser's copies are refreshed before the reload.
  const UPDATE_KEY = 'signoff.toolUpdate.' + location.pathname;   // sessionStorage: { tried, from }
  const haveVersion = () => (window.FABCHECK_VERSION || {}).hash;
  let updateWaiting = '', updateBusy = false;
  function updateMemo(v) {
    try {
      if (v === undefined) return JSON.parse(sessionStorage.getItem(UPDATE_KEY) || '{}') || {};
      sessionStorage.setItem(UPDATE_KEY, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function pageIdle() {
    const a = document.activeElement;
    const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    return !typing && !document.hidden && !document.querySelector('.sheet-wrap, .menu, dialog[open]') && !state.pkgs.length;
  }
  async function reloadWhenIdle() {
    if (!updateWaiting) return;
    if (!pageIdle()) { setTimeout(reloadWhenIdle, 30000); return; }
    if (updateMemo({ tried: updateWaiting, from: haveVersion() }) === null) { updateWaiting = ''; return; }
    const own = u => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } };
    const urls = [location.href.split('#')[0]]
      .concat([...document.scripts].map(s => s.src), [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href))
      .filter(u => u && own(u));
    await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    location.reload();
  }
  function checkForUpdate() {
    const have = haveVersion();
    if (!have || updateBusy || updateWaiting || !window.fetch) return;
    updateBusy = true;
    fetch('assets/version.js?nc=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : '')
      .then(text => {
        updateBusy = false;
        const m = /(?:hash"?\s*:\s*|VERSION\s*=\s*)["']([0-9a-f]+)["']/.exec(text || '');
        if (!m || m[1] === have || (updateMemo() || {}).tried === m[1]) return;
        updateWaiting = m[1];
        reloadWhenIdle();
      }, () => { updateBusy = false; });
  }
  {
    const memo = updateMemo() || {};
    if (memo.from && memo.from !== haveVersion()) { updateMemo({ tried: memo.tried }); setTimeout(() => toast('Tool updated'), 300); }
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  }

  Fab.app = { state, get viewer() { return viewer; }, openPackage, runChecks };
  init();
})(window.Fab);
