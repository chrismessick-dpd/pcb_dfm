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
    ['bom', 'BOM'], ['files', 'Files'], ['revisions', 'Revisions'], ['archive', 'Archive'],
  ];
  const CATS = [
    ['Package', 'Package', 'Files, layer sets, units, drill report and outline'],
    ['Assembly', 'Build & assembly', 'Pick-and-place, BOM, ODB++, variant and stencil'],
    ['BOM', 'BOM audit', 'Part numbers, descriptions, manufacturers and lifecycle'],
    ['DFM', 'Fabrication DFM', 'Traces, drills, rings, edge, mask and silkscreen'],
  ];
  const COLORS = {
    copper: { top: '#e8a33d', bottom: '#4f8ff7', inner: ['#30c48d', '#c46ee0', '#e0d24f', '#5ad1e6', '#ef7a7a', '#9fa8ff'] },
    mask: { top: '#3fd18b', bottom: '#59a6ff' }, silk: { top: '#f5f5f7', bottom: '#ffd60a' },
    paste: { top: '#b8b8be', bottom: '#8e8e96' }, other: '#8e8e93',
  };

  const state = {
    pkgs: [], active: null, view: 'overview', filter: { error: true, warn: true, info: false }, cat: null, q: '',
    closed: new Set(), sel: null, showPnp: true, profile: 'standard', thickness: 1.6,
  };
  let seq = 0;
  let viewer = null;
  const active = () => state.pkgs.find(p => p.id === state.active) || null;

  // ── Theme: shared with Signoff (same key), so both tools switch together ──
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
  const profile = () => Object.assign({}, Fab.profiles[state.profile], { thickness: state.thickness });
  const baseName = s => String(s).replace(/\.(zip|tgz)$/i, '');

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
    }
  }
  function lineHtml(l) { return `<div class="ln ${l.cls}"><span class="t">${(l.t / 1000).toFixed(2)}s</span><span class="x">${esc(l.text)}</span></div>`; }
  function setProgress(entry, p) {
    entry.progress = p;
    if (entry.id === state.active) { const bar = $('#console-progress'); if (bar) bar.style.width = Math.round(p * 100) + '%'; }
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
  async function openPackage(getFiles, label) {
    label = baseName(label);
    const entry = { id: 'p' + (++seq), label, status: 'loading', pkg: null, findings: [], log: [], t0: performance.now(), progress: 0 };
    state.pkgs.push(entry);
    const prev = active();
    state.active = entry.id;
    if (prev && prev.status === 'ready' && !entry.baseline) entry.baseline = prev.id;
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
      const g = Fab.classify.buildSteps(files);
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
      if (skipped.size) log(entry, 'dim', `         + ${[...skipped].map(([t, n]) => `${n} ${t}`).join(', ')}`);
      const bb = pkg.boardBBox;
      log(entry, 'ok', `Using ${pkg.set.x2 ? 'Gerber X2' : 'RS-274X'} set "${pkg.set.dir}": ${pkg.layers.copper.length} copper layers` +
        (bb ? `, board ${(bb[2] - bb[0]).toFixed(2)} × ${(bb[3] - bb[1]).toFixed(2)} mm` : '') +
        (pkg.odb ? `, ODB++ components ${pkg.odb.comps.length}` : ''));
      renderSidebar();
      await runChecks(entry);
    } catch (err) {
      console.error(err);
      entry.status = 'error'; entry.error = String(err && err.message || err);
      log(entry, 'err', 'Failed: ' + entry.error);
      renderAll();
    }
  }

  async function runChecks(entry, reason) {
    const pkg = entry.pkg;
    const prof = profile();
    entry.status = 'running';
    entry.findings = [];
    if (reason) log(entry, 'step', reason);
    renderSidebar();
    const modules = [
      ['Package', C.package.steps, [pkg]],
      ['Assembly', C.assembly.steps, [pkg, prof]],
      ['Build consistency', C.build.steps, [pkg]],
      ['Pins (IPC-356)', C.pins.steps, [pkg]],
      ['BOM audit', C.bom.steps, [pkg]],
      [`Fabrication DFM (${Fab.profiles[state.profile].label}, ${prof.thickness} mm)`, C.dfm.steps, [pkg, prof]],
    ];
    const totalSteps = 31 + 2 * pkg.layers.copper.length; // fixed steps + raster steps per copper layer
    let done = 0;
    const t0 = performance.now();
    for (const [name, gen, args] of modules) {
      log(entry, 'step', name);
      await tick();
      const out = [];
      const g = gen(...args, out);
      let label = null, seen = 0, ts = performance.now();
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
        if (r.done) break;
        label = r.value; ts = performance.now();
        done++;
        setProgress(entry, 0.3 + 0.7 * Math.min(1, done / totalSteps));
        await tick();
      }
      entry.findings.push(...out);
    }
    attachLocations(pkg, entry.findings);
    const n = s => entry.findings.filter(f => f.severity === s).length;
    setProgress(entry, 1);
    log(entry, 'done', `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${plural(n('error'), 'error')}, ${plural(n('warn'), 'warning')}, ${n('info')} info`);
    entry.status = 'ready';
    entry.revCache = null;
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
  }

  // ── Rendering ──
  function renderAll() {
    renderSidebar();
    renderToolbar();
    const e = active();
    const boardOn = !!e && e.status !== 'loading' && !!e.pkg && state.view === 'board';
    $('#board-view').hidden = !boardOn;
    $('#page').hidden = boardOn;
    if (!e) { $('#page').innerHTML = emptyHtml(); return; }
    if (boardOn) { renderBoard(e); return; }
    const page = {
      overview: overviewHtml, findings: findingsHtml, assembly: assemblyHtml, bom: bomHtml, files: filesHtml,
      revisions: revisionsHtml, archive: archiveHtml, board: overviewHtml,
    }[state.view];
    $('#page').innerHTML = page(e);
    const body = $('#console-body');
    if (body) body.scrollTop = body.scrollHeight;
    if (state.view === 'archive') loadArchive(e);
  }

  function renderSidebar() {
    $('#pkg-list').innerHTML = state.pkgs.map(e => {
      const n = s => e.findings.filter(f => f.severity === s).length;
      const busy = e.status === 'loading' || e.status === 'running';
      const sub = e.status === 'error' ? 'Could not read' : !e.pkg ? 'Reading…' : busy ? 'Checking…' :
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
    const nf = e.findings.filter(f => f.severity === 'error' || f.severity === 'warn').length;
    const hasErr = e.findings.some(f => f.severity === 'error');
    seg.innerHTML = VIEWS.map(([k, label]) => `<button class="${state.view === k ? 'on' : ''}" data-view="${k}" role="tab">${label}` +
      (k === 'findings' && nf ? `<span class="count">${nf}</span>${hasErr ? '<span class="dot"></span>' : ''}` : '') + '</button>').join('');
  }

  function emptyHtml() {
    return `<div class="page"><div class="drop" id="drop">
      <div class="empty-art">${ICON.upload}</div>
      <h2>Check a fab package before it goes out</h2>
      <p>Drop an Altium output .zip or folder anywhere on this window: Gerber (RS-274X or X2), NC drill, pick-and-place, BOM, ODB++ and drawings.</p>
      <div class="actions"><button class="btn btn-primary" data-act="open">Choose .zip…</button><button class="btn" data-act="open-dir">Choose folder…</button></div>
      <div class="drop-tiles">
        <div><b>Package</b>Every file classified; missing items, units, drill report</div>
        <div><b>Build</b>PnP, BOM and ODB++ agree; variant and stencil</div>
        <div><b>BOM</b>Part numbers decoded against descriptions</div>
        <div><b>DFM</b>Traces, drills, rings, edge, mask, silk</div>
      </div>
      <div class="foot">${ICON.lock} Files are read in this browser tab and never uploaded.</div>
    </div></div>`;
  }

  function counts(fs) { const c = { error: 0, warn: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; }

  function pageHead(e, eyebrow, title, sub, actions) {
    return `<div class="page-head"><div class="page-head-text"><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${esc(title)}</h1>` +
      (sub ? `<div class="page-sub">${sub}</div>` : '') + `</div>${actions ? `<div class="chips" style="flex:none">${actions}</div>` : ''}</div>`;
  }

  function overviewHtml(e) {
    const pkg = e.pkg, c = counts(e.findings), busy = e.status !== 'ready' && e.status !== 'error';
    const chips = [];
    if (pkg) {
      const bb = pkg.boardBBox;
      if (pkg.set.files.length) chips.push(pkg.set.x2 ? 'Gerber X2' : 'RS-274X');
      if (pkg.layers.copper.length) chips.push(pkg.layers.copper.length + '-layer');
      if (bb) chips.push(`${(bb[2] - bb[0]).toFixed(1)} × ${(bb[3] - bb[1]).toFixed(1)} mm`);
      const v = (pkg.variants || []).find(x => x.variant);
      chips.push(v ? 'Variant ' + v.variant : (pkg.variants || []).length ? 'No variant' : null);
      if (pkg.odb) chips.push('ODB++');
    }
    const sub = `<div class="chips">${chips.filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join('')}<span class="chip accent">${esc(Fab.profiles[state.profile].label)}</span></div>`;
    const actions = `<button class="btn" data-act="rerun"${busy || !pkg ? ' disabled' : ''}>Run checks again</button><button class="btn btn-primary" data-act="view" data-view="board"${!pkg ? ' disabled' : ''}>Open board</button>`;
    let h = `<div class="page wide">` + pageHead(e, 'Fab package', e.label, sub, actions);
    const stat = (cls, n, label, sev) => `<button class="card stat ${cls}" style="border:none;text-align:left" data-act="sev" data-sev="${sev}"><div class="stat-num">${busy ? '–' : n}</div><div class="stat-label">${label}</div></button>`;
    h += `<div class="grid grid-4">${stat('issue', c.error, 'Errors', 'error')}${stat('warn', c.warn, 'Warnings', 'warn')}${stat('info', c.info, 'Info', 'info')}<div class="card stat"><div class="stat-num">${pkg ? pkg.files.length : '–'}</div><div class="stat-label">Files in package</div></div></div>`;
    h += `<div class="section-title">Checks<span class="chips">` +
      `<label class="tb-field">Fab profile <select data-act="profile">${Object.entries(Fab.profiles).map(([k, p]) => `<option value="${k}"${k === state.profile ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>` +
      `<label class="tb-field">Board thickness <input data-act="thickness" type="number" step="0.1" min="0.2" max="6" value="${state.thickness}"> mm</label></span></div><div class="grid grid-3">`;
    for (const [cat, title, desc] of CATS) {
      const fs = e.findings.filter(f => f.category === cat), cc = counts(fs), tot = fs.length || 1;
      h += `<button class="card cl-card cat-card" data-act="cat" data-cat="${cat}"><div class="cl-card-top"><div><div class="cl-card-title">${title}</div><div class="cl-card-desc">${desc}</div></div>` +
        `<span class="dot ${busy ? '' : cc.error ? 'error' : cc.warn ? 'warn' : 'ok'}" style="margin-top:6px"></span></div>` +
        `<div class="bar"><i class="b-issue" style="width:${cc.error / tot * 100}%"></i><i class="b-warn" style="width:${cc.warn / tot * 100}%"></i><i class="b-info" style="width:${cc.info / tot * 100}%"></i></div>` +
        `<div class="cl-card-foot"><span><b>${cc.error}</b> errors</span><span><b>${cc.warn}</b> warnings</span><span><b>${cc.info}</b> info</span></div></button>`;
    }
    h += `</div>`;
    if (e.status === 'ready') h += signoffHtml(e);
    h += `<div class="section-title">Run log <span class="chips"><span class="chip">${busy ? 'Running' : e.status === 'error' ? 'Failed' : 'Finished'}</span></span></div>` + consoleHtml(e);
    return h + '</div>';
  }

  function consoleHtml(e, tall) {
    return `<div class="console${tall ? ' tall' : ''}"><div class="console-head"><b>fabcheck</b><span>${esc(e.label)}</span><span class="spacer"></span><button data-act="copy-log">Copy</button></div>` +
      `<div class="console-progress"><i id="console-progress" style="width:${Math.round(e.progress * 100)}%"></i></div>` +
      `<div class="console-body" id="console-body">${e.log.map(lineHtml).join('')}${e.status === 'ready' || e.status === 'error' ? '' : '<div class="ln"><span class="t"></span><span class="cursor"></span></div>'}</div></div>`;
  }

  // ── Send to Signoff ──
  function signoffHtml(e) {
    const groups = Fab.signoff.plan(e.findings);
    const errs = groups.filter(g => g.severity === 'error').length, warns = groups.length - errs;
    let h = `<div class="section-title">Send to Signoff EE</div><div class="card" style="padding:18px 20px">`;
    const projects = Fab.signoff.projects();
    if (!projects.length) {
      return h + `<p style="margin:0 0 12px;color:var(--text-2)">No Signoff EE projects in this browser yet. Open <a href="../ee_design_review/index.html" style="color:var(--accent)">Signoff EE</a> once at this same address (it keeps its projects in this browser), then come back.</p></div>`;
    }
    if (!groups.length) return h + `<p style="margin:0;color:var(--text-2)">No errors or warnings to send.</p></div>`;
    // Guess the board's project from the package name (e.g. PCB-1042-03 → board PCB-1042).
    if (!e.signoffSlug || !projects.some(p => p.slug === e.signoffSlug)) {
      const lab = e.label.toLowerCase();
      const guess = projects.find(p => [p.meta.board, p.meta.name].some(s => s && lab.includes(String(s).toLowerCase().replace(/\s+/g, '')))) || projects[0];
      e.signoffSlug = guess.slug;
    }
    h += `<p style="margin:0 0 12px;color:var(--text-2)">Adds ${plural(groups.length, 'issue')} (${errs} from errors as Major, ${warns} from warnings as Minor) to the Fabrication &amp; Release checklist, one per check with every location listed. Sending again updates the same issues and notes what changed. Signoff's Sync then pushes them.</p>
      <div class="filters" style="margin:0"><label class="tb-field" style="font-size:13px">Project <select data-act="signoff-project">${projects.map(p => `<option value="${esc(p.slug)}"${p.slug === e.signoffSlug ? ' selected' : ''}>${esc(p.meta.name)}${p.meta.board ? ' · ' + esc(p.meta.board) : ''}${(p.meta.checklists || []).includes('fab') ? '' : ' (no Fab checklist)'}</option>`).join('')}</select></label>
      <button class="btn btn-primary" data-act="signoff-send">Send to Signoff EE</button>${e.signoffResult ? `<a class="btn btn-plain" href="../ee_design_review/index.html">Open Signoff EE</a>` : ''}</div>`;
    const target = projects.find(p => p.slug === e.signoffSlug);
    if (target && !(target.meta.checklists || []).includes('fab')) h += `<p class="note">This project doesn't use the Fabrication &amp; Release checklist, so the issues won't show until you add it in the project's details in Signoff EE.</p>`;
    if (e.signoffResult) h += `<p class="note" style="color:var(--pass)">${esc(e.signoffResult)}</p>`;
    return h + '</div>';
  }

  // ── Findings view ──
  function visibleFindings(e) {
    const q = state.q.trim().toLowerCase();
    return e.findings.filter(f => state.filter[f.severity] && (!state.cat || f.category === state.cat) &&
      (!q || (f.title + ' ' + (f.detail || '') + ' ' + (f.refs || []).join(' ') + ' ' + (f.layer || '')).toLowerCase().includes(q)));
  }
  function whereText(f) {
    if (f.at) return `${f.at.x.toFixed(2)}, ${f.at.y.toFixed(2)} mm`;
    if (f.bbox) return `${((f.bbox[0] + f.bbox[2]) / 2).toFixed(2)}, ${((f.bbox[1] + f.bbox[3]) / 2).toFixed(2)} mm`;
    return '';
  }
  function findingsHtml(e) {
    const c = counts(e.findings);
    const order = { error: 0, warn: 1, info: 2 };
    const sevSeg = ['error', 'warn', 'info'].map(s => `<button class="${state.filter[s] ? 'on' : ''}" data-act="sev-toggle" data-sev="${s}"><span class="dot ${s}"></span>${{ error: 'Errors', warn: 'Warnings', info: 'Info' }[s]}<span class="count">${c[s]}</span></button>`).join('');
    const catSeg = [[null, 'All']].concat(CATS.map(x => [x[0], x[1]])).map(([k, l]) => `<button class="${state.cat === k ? 'on' : ''}" data-act="cat-filter" data-cat="${k || ''}">${l}</button>`).join('');
    let h = `<div class="page">` + pageHead(e, 'Findings', e.label, `${plural(c.error, 'error')}<span class="sep">·</span>${plural(c.warn, 'warning')}<span class="sep">·</span>${c.info} info`);
    h += `<div class="filters"><div class="search">${ICON.search}<input id="f-search" type="search" placeholder="Filter findings" value="${esc(state.q)}"></div><div class="seg sev-seg">${sevSeg}</div><div class="seg">${catSeg}</div></div>`;
    const fs = visibleFindings(e);
    if (e.status !== 'ready') h += `<div class="card" style="padding:16px;margin-bottom:14px;color:var(--text-3)">Checks are still running; the list fills in as they finish.</div>`;
    for (const [cat, title] of CATS) {
      const list = fs.filter(f => f.category === cat).sort((a, b) => order[a.severity] - order[b.severity]);
      if (!list.length) continue;
      const cc = counts(list);
      h += `<div class="card sec${state.closed.has(cat) ? ' collapsed' : ''}" data-cat="${cat}"><div class="sec-head" data-act="toggle-sec">${ICON.chev}<div class="sec-title">${title}<small>${list.length} shown</small></div><div class="sec-meta">${cc.error ? `<span class="pill error">${cc.error}</span>` : ''}${cc.warn ? `<span class="pill warn">${cc.warn}</span>` : ''}</div></div><div class="sec-body">`;
      for (const f of list) {
        const where = whereText(f);
        h += `<div class="item f-row${state.sel === f.id ? ' sel' : ''}" data-act="finding" data-id="${f.id}"><span class="dot ${f.severity}"></span>` +
          `<div><div class="item-text">${esc(f.title)}</div>${f.detail ? `<div class="item-detail">${esc(f.detail)}</div>` : ''}<div class="item-sub"><span class="tag">${esc(f.check)}</span>${f.layer ? `<span>${esc(f.layer)}</span>` : ''}</div></div>` +
          `<div class="item-right">${where ? `<span class="loc">${where}</span>` : ''}</div></div>`;
      }
      h += `</div></div>`;
    }
    if (!fs.length) h += `<div class="empty"><h2>Nothing to show</h2><p>No findings match these filters.</p></div>`;
    return h + '</div>';
  }

  // ── Inspector ──
  function openInspector(f) {
    state.sel = f.id;
    document.querySelectorAll('[data-act="finding"]').forEach(el => el.classList.toggle('sel', el.dataset.id === f.id));
    const kv = [];
    if (f.value != null && isFinite(f.value)) kv.push(['Measured', typeof f.value === 'number' ? (+f.value.toFixed(4)) + (f.check === 'aspect' ? ':1' : ' mm') : f.value]);
    if (f.limit != null) kv.push(['Limit', f.limit + (f.check === 'aspect' ? ':1' : ' mm')]);
    if (f.layer) kv.push(['Layer', f.layer]);
    const where = whereText(f);
    if (where) kv.push(['Location', where + (f.side ? ' · ' + f.side : '')]);
    if (f.refs && f.refs.length) kv.push(['Designators', f.refs.slice(0, 40).join(', ') + (f.refs.length > 40 ? ' …' : '')]);
    if (f.row) kv.push(['BOM row', f.row]);
    $('#inspector').innerHTML = `<div class="insp-head"><span class="insp-crumb">${esc(f.category)} · ${esc(f.check)}</span><button class="icon-btn" data-act="close-insp" aria-label="Close">${ICON.close}</button></div>
      <div class="insp-body"><span class="pill ${f.severity === 'error' ? 'error' : f.severity === 'warn' ? 'warn' : 'accent'}">${{ error: 'Error', warn: 'Warning', info: 'Info' }[f.severity]}</span>
      <div class="insp-title">${esc(f.title)}</div>${f.detail ? `<div class="insp-detail">${esc(f.detail)}</div>` : ''}
      ${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${f.at || f.bbox ? `<button class="btn btn-primary" data-act="show-on-board" data-id="${f.id}">Show on board</button>` : ''}</div>`;
    $('#inspector').classList.add('open');
  }
  function closeInspector() { $('#inspector').classList.remove('open'); }

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
    for (const l of L.other) out.push({ label: l.file.name, kind: 'gerber', layer: l, color: COLORS.other, alpha: 0.8, visible: false, other: true });
    if (pkg.hits.some(h => h.plated) || pkg.slots.some(s => s.plated)) out.push({ label: 'Plated holes', kind: 'pth', color: '#0b0c0e', alpha: 1, visible: true });
    if (pkg.hits.some(h => !h.plated) || pkg.slots.some(s => !s.plated)) out.push({ label: 'Non-plated holes', kind: 'npth', color: '#0b0c0e', alpha: 1, visible: true });
    out.push({ label: 'Board outline', kind: 'outline', color: '#ffd60a', alpha: 0.9, visible: true });
    return out;
  }

  function ensureViewer() {
    if (viewer) return viewer;
    viewer = new Fab.render.Viewer($('#canvas'));
    viewer.onHover = (x, y) => { $('#coords').textContent = `X ${x.toFixed(3)}  Y ${y.toFixed(3)} mm`; };
    viewer.onClick = (x, y) => pickPart(x, y);
    viewer.overlays.push({ draw: drawPlacements }, { draw: drawFindingMarks });
    return viewer;
  }

  function renderBoard(e) {
    const v = ensureViewer();
    if (v.pkg !== e.pkg) { v.layers = e.layers || (e.layers = layerEntries(e.pkg)); v.highlight = null; setSide('top', true); v.setPackage(e.pkg); }
    v.resize();
    renderLayers(e);
    renderRail(e);
  }

  function renderLayers(e) {
    $('#layers-pane').innerHTML = `<div class="side-head"><span class="side-label">Layers</span><button class="btn btn-plain" style="padding:2px 6px;font-size:12px" data-act="layers-off">Hide all</button></div>` +
      viewer.layers.map((l, i) => `<label class="lay"${l.other ? ' style="opacity:.7"' : ''}><input type="checkbox" data-layer="${i}"${l.visible ? ' checked' : ''}><span class="sw" style="background:${l.color}"></span><span class="nm" title="${esc(l.layer ? l.layer.file.name : l.label)}">${esc(l.label)}</span></label>`).join('');
  }

  function renderRail(e) {
    const c = counts(e.findings);
    const chips = ['error', 'warn', 'info'].map(s => `<button class="${state.filter[s] ? 'on' : ''}" data-act="sev-toggle" data-sev="${s}"><span class="dot ${s}"></span>${c[s]}</button>`).join('');
    let h = `<div class="rail-head"><div class="seg sev-seg">${chips}</div><div class="search" style="max-width:none">${ICON.search}<input id="rail-search" type="search" placeholder="Filter" value="${esc(state.q)}"></div></div><div class="rail-list">`;
    const order = { error: 0, warn: 1, info: 2 };
    const fs = visibleFindings(e).filter(f => f.at || f.bbox);
    for (const [cat, title] of CATS) {
      const list = fs.filter(f => f.category === cat).sort((a, b) => order[a.severity] - order[b.severity]);
      if (!list.length) continue;
      h += `<div class="cat-label">${title} · ${list.length}</div>`;
      for (const f of list) h += `<div class="rf${state.sel === f.id ? ' sel' : ''}" data-act="board-finding" data-id="${f.id}"><span class="dot ${f.severity}"></span><div class="rf-t">${esc(f.title)}</div><div class="rf-d">${esc(whereText(f))}${f.layer ? ' · ' + esc(f.layer) : ''}</div></div>`;
    }
    if (!fs.length) h += `<div class="side-empty">No located findings match the filter.</div>`;
    $('#rail').innerHTML = h + '</div>';
  }

  function setSide(side, quiet) {
    if (!viewer) return;
    viewer.view.flip = side === 'bottom';
    for (const b of $('#side-seg').children) b.classList.toggle('on', b.dataset.side === side);
    if (!quiet) {
      for (const L of viewer.layers) if ((L.side === 'top' || L.side === 'bottom') && L.layer) {
        if (L.layer.fn === 'copper' || L.layer.fn === 'silk') L.visible = L.side === side;
        else L.visible = L.visible && L.side === side;
      }
      renderLayers(active());
    }
    viewer.draw();
  }

  function focusFinding(f) {
    const e = active();
    state.sel = f.id;
    closeInspector();
    if (state.view !== 'board') go('board'); else renderBoard(e);
    let side = f.side;
    const entry = f.layer && viewer.layers.find(l => l.layer && l.layer.file.name === f.layer);
    if (entry) { entry.visible = true; if (entry.side === 'top' || entry.side === 'bottom') side = entry.side; }
    if (side && (side === 'bottom') !== viewer.view.flip) setSide(side);
    if (entry) entry.visible = true;
    renderLayers(e);
    renderRail(e);
    const bb = f.bbox || [f.at.x, f.at.y, f.at.x, f.at.y];
    viewer.highlight = { at: f.at ? { x: f.at.x, y: f.at.y } : null, bbox: f.bbox || null };
    viewer.focus(Fab.bbox.grow(bb, Math.max(0.5, (f.at && f.at.dia) || 0)), 2.5);
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

  // A ring per located finding that passes the filter, on layers that are showing.
  function drawFindingMarks(ctx, v) {
    const e = active();
    if (!e) return;
    const shown = new Set(v.layers.filter(l => l.visible && l.layer).map(l => l.layer.file.name));
    const side = v.view.flip ? 'bottom' : 'top';
    const color = { error: '#ff453a', warn: '#ff9f0a', info: '#3fc1cf' };
    const d = v.dpr;
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 2;
    for (const f of visibleFindings(e)) {
      if (!(f.at || f.bbox) || f.id === state.sel) continue;
      if (f.layer ? !shown.has(f.layer) : (f.side && f.side !== side)) continue;
      const c = f.at || Fab.bbox.center(f.bbox);
      const [x, y] = v.toScreen(c.x, c.y);
      if (x < -10 || y < -10 || x > v.W + 10 || y > v.H + 10) continue;
      ctx.strokeStyle = color[f.severity];
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
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
      h += `<tr data-act="bom-row" data-row="${l.row}"><td class="num muted">${l.row}</td><td class="mono" style="max-width:260px">${esc(l.des.join(', '))}</td><td class="num">${esc(l.qtyRaw)}</td><td>${esc(l.name)}${l.value ? `<div class="muted">${esc(l.value)}</div>` : ''}</td><td>${esc(l.mfr)}</td><td class="mono">${esc(l.mpn)}</td><td>${esc(l.lifecycle)}${l.revStatus ? `<div class="muted">${esc(l.revStatus)}</div>` : ''}</td><td>${iss.map(f => `<span class="pill ${f.severity}" title="${esc(f.title)}">${esc(f.check)}</span>`).join('')}</td></tr>`;
    }
    return h + '</tbody></table></div></div>';
  }

  function filesHtml(e) {
    const pkg = e.pkg;
    let h = `<div class="page wide">` + pageHead(e, 'Package contents', e.label, pkg ? `${plural(pkg.files.length, 'file')}<span class="sep">·</span>Active Gerber set ${esc(pkg.set.dir)}` : '');
    if (!pkg) return h + '</div>';
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
  function revisionsHtml(e) {
    const others = state.pkgs.filter(p => p.id !== e.id && p.pkg);
    let h = `<div class="page wide">` + pageHead(e, 'Revision compare', e.label, 'What changed against a baseline: BOM lines, placements, Gerber geometry and drill hits.');
    if (!others.length) return h + `<div class="card" style="padding:28px;text-align:center"><div class="empty-art">${ICON.upload}</div><h2 style="font:600 19px var(--display);margin:12px 0 6px">Open a baseline to compare against</h2><p style="color:var(--text-2);margin:0 auto 18px;max-width:52ch">Open the previous release package, or just the BOM that was used last time. It joins the package list, and this page shows the differences.</p><button class="btn btn-primary" data-act="open">Open baseline…</button></div></div>`;
    if (!e.baseline || !others.some(p => p.id === e.baseline)) e.baseline = others[others.length - 1].id;
    const base = state.pkgs.find(p => p.id === e.baseline);
    h += `<div class="filters"><label class="tb-field" style="font-size:13px">Baseline <select data-act="baseline">${others.map(p => `<option value="${p.id}"${p.id === base.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label><button class="btn" data-act="open">Open another…</button></div>`;
    if (!e.pkg || !base.pkg) return h + '</div>';
    const key = base.id;
    if (!e.revCache || e.revCache.key !== key) e.revCache = { key, res: Fab.revisions.compare(base.pkg, e.pkg) };
    const r = e.revCache.res;
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
      const rows = r.pnp.moved.map(m => `<tr data-act="rev-at" data-x="${m.at.x}" data-y="${m.at.y}"><td class="mono">${esc(m.des)}</td><td>${[m.dist > 0.005 ? `moved ${m.dist.toFixed(3)} mm` : '', m.rot ? `rotated ${m.rot}°` : '', m.side ? `side ${m.side}` : '', m.footprint ? `footprint ${m.footprint}` : ''].filter(Boolean).map(esc).join(' · ')}</td></tr>`);
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
    return h + '</div>';
  }

  // ── Archive ──
  function archiveHtml(e) {
    let h = `<div class="page wide">` + pageHead(e, 'Archive checks', e.label, 'Fingerprint the package, check nested ODB++ archives against the extracted tree, and compare with another copy.');
    const a = e.archive;
    if (!e.pkg) return h + '</div>';
    if (!a) return h + `<div class="card" style="padding:18px;color:var(--text-3)">Hashing and unpacking nested archives…</div></div>`;
    h += `<div class="section-title">Fingerprint</div><div class="card" style="padding:16px 18px">` + (a.fingerprint
      ? `<dl class="kv" style="margin:0"><dt>Archive</dt><dd>${esc(a.fingerprint.name)}</dd><dt>Size</dt><dd>${a.fingerprint.size.toLocaleString()} bytes</dd><dt>SHA-256</dt><dd class="hash">${a.fingerprint.sha256} <button class="btn btn-plain" data-act="copy" data-text="${a.fingerprint.sha256}">Copy</button></dd></dl>`
      : '<span class="muted">Opened as loose files, so there is no single archive to fingerprint.</span>') + '</div>';
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
    if (!t) return;
    const e = active();
    if (t.dataset.view && !t.dataset.act) { go(t.dataset.view); return; }
    switch (t.dataset.act) {
      case 'open': $('#file-zip').click(); break;
      case 'open-dir': $('#file-dir').click(); break;
      case 'select': state.active = t.dataset.id; state.sel = null; $('#app').classList.remove('nav-open'); renderAll(); break;
      case 'view': go(t.dataset.view); break;
      case 'theme': { const th = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(th); applyTheme(th); break; }
      case 'nav': $('#app').classList.toggle('nav-open'); break;
      case 'rerun': if (e && e.pkg && e.status === 'ready') runChecks(e, 'Re-running checks'); break;
      case 'sev': state.filter = { error: false, warn: false, info: false }; state.filter[t.dataset.sev] = true; state.cat = null; go('findings'); break;
      case 'cat': state.cat = t.dataset.cat; state.filter = { error: true, warn: true, info: true }; go('findings'); break;
      case 'sev-toggle': state.filter[t.dataset.sev] = !state.filter[t.dataset.sev]; if (state.view === 'board') { renderRail(e); viewer.draw(); } else renderAll(); break;
      case 'cat-filter': state.cat = t.dataset.cat || null; renderAll(); break;
      case 'toggle-sec': { const s = t.closest('.sec'); s.classList.toggle('collapsed'); state.closed[s.classList.contains('collapsed') ? 'add' : 'delete'](s.dataset.cat); break; }
      case 'finding': openInspector(e.findings.find(f => f.id === t.dataset.id)); break;
      case 'close-insp': closeInspector(); break;
      case 'show-on-board': closeInspector(); focusFinding(e.findings.find(f => f.id === t.dataset.id)); break;
      case 'board-finding': focusFinding(e.findings.find(f => f.id === t.dataset.id)); break;
      case 'fit': viewer.highlight = null; viewer.fit(); break;
      case 'pnp': state.showPnp = !state.showPnp; t.classList.toggle('on', state.showPnp); viewer.draw(); break;
      case 'layers-off': viewer.layers.forEach(l => { l.visible = false; }); renderLayers(e); viewer.draw(); break;
      case 'part': { const p = state.asmRows[+t.dataset.i].part; focusFinding({ id: 'part-' + p.des, at: { x: p.gx, y: p.gy }, side: p.side }); break; }
      case 'rev-at': focusFinding({ id: 'rev', at: { x: +t.dataset.x, y: +t.dataset.y } }); break;
      case 'rev-layer': { const g = e.revCache.res.gerber[+t.dataset.i]; focusFinding({ id: 'rev', bbox: g.bbox, layer: g.layerRef.file.name }); break; }
      case 'copy-log': copyText(e.log.map(l => `${(l.t / 1000).toFixed(2).padStart(7)}s  ${l.text}`).join('\n')); break;
      case 'copy': copyText(t.dataset.text); break;
      case 'signoff-send': {
        try {
          const r = Fab.signoff.send(e.signoffSlug, Fab.signoff.plan(e.findings), { label: e.label, sha: e.archive && e.archive.fingerprint && e.archive.fingerprint.sha256 });
          const name = (Fab.signoff.projects().find(p => p.slug === e.signoffSlug) || { meta: {} }).meta.name;
          e.signoffResult = `Sent to "${name}": ${r.created} new, ${r.updated} updated${r.resolvedNotes ? `, ${r.resolvedNotes} earlier issue(s) noted as no longer found` : ''}. Sync in Signoff EE to push them.`;
          log(e, 'ok', e.signoffResult);
          toast('Sent to Signoff EE');
        } catch (err) { toast('Could not send: ' + err.message); }
        renderAll();
        break;
      }
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
    document.addEventListener('click', onClick);
    document.addEventListener('change', ev => {
      const e = active();
      if (ev.target.matches('[data-act="profile"]')) {
        state.profile = ev.target.value;
        if (e && e.status === 'ready') runChecks(e, `Profile changed to ${Fab.profiles[state.profile].label}`);
      }
      if (ev.target.matches('[data-act="thickness"]')) {
        state.thickness = parseFloat(ev.target.value) || 1.6;
        if (e && e.status === 'ready') runChecks(e, `Board thickness set to ${state.thickness} mm`);
      }
      if (ev.target.matches('[data-act="signoff-project"]')) { e.signoffSlug = ev.target.value; e.signoffResult = null; renderAll(); }
      if (ev.target.matches('[data-act="baseline"]')) { e.baseline = ev.target.value; e.revCache = null; renderAll(); }
      if (ev.target.matches('[data-layer]')) { viewer.layers[+ev.target.dataset.layer].visible = ev.target.checked; viewer.draw(); }
    });
    document.addEventListener('input', ev => {
      if (ev.target.id === 'f-search' || ev.target.id === 'rail-search') {
        state.q = ev.target.value;
        const pos = ev.target.selectionStart, id = ev.target.id;
        if (id === 'rail-search') { renderRail(active()); if (viewer) viewer.draw(); } else renderAll();
        const el = document.getElementById(id); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      }
    });
    $('#side-seg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) setSide(b.dataset.side); });
    // Copy the FileList before clearing the input (clearing it empties the list).
    $('#file-zip').addEventListener('change', ev => { const fl = Array.from(ev.target.files); ev.target.value = ''; if (fl.length) openPackage(() => Fab.loader.fromFileList(fl), fl.length === 1 ? fl[0].name : plural(fl.length, 'file')); });
    $('#file-dir').addEventListener('change', ev => { const fl = Array.from(ev.target.files); ev.target.value = ''; if (fl.length) openPackage(() => Fab.loader.fromFileList(fl), (fl[0].webkitRelativePath || '').split('/')[0] || 'Folder'); });
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
      openPackage(() => Fab.loader.fromDrop(drop), n === 1 ? first.name : plural(n, 'item'));
    });
    document.addEventListener('keydown', ev => {
      if (ev.target.matches('input, select, textarea')) return;
      if (ev.key === 'Escape') closeInspector();
      if (ev.key === 'o' && !ev.ctrlKey && !ev.metaKey) $('#file-zip').click();
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    route();
    // Dev helper: ?pkg=<url> (repeatable) loads packages served from the same origin (tools/serve.py).
    const urls = new URLSearchParams(location.search).getAll('pkg');
    (async () => { for (const u of urls) await openPackage(() => Fab.loader.fromUrl(u), decodeURIComponent(u.split('/').pop())); })();
  }

  Fab.app = { state, get viewer() { return viewer; }, openPackage, runChecks };
  init();
})(window.Fab);
