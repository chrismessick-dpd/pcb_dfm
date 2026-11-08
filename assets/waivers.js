// Waivers: errors and warnings a reviewer has accepted, kept as rules apart from the findings.
//
// A finding's id is a counter that starts again every session, so a waiver names what the finding
// is about instead: its subject (check + designators, or check + layer + place, or check + title)
// and, for one finding, the words it had when it was waived. The rules are matched against the
// findings each time they are shown, so they carry over to re-runs and to new revisions of the board.
//
//   rule (one finding): { id, kind: 'one', check, items: [snap], reason, by, at }
//     A finding with the same subject whose severity, title, or detail changed since is "stale": it
//     shows as active again, with what it said when it was waived.
//   rule (similar):     { id, kind: 'similar', check | null (any check), sevs, facets, also, except, seen, reason, by, at }
//     facets: the details every finding must share (designator, footprint, … see FACETS). sevs: the
//     severities the rule waives (warnings, and errors only when the reviewer ticked them all);
//     also: errors ticked one by one; except: findings left out by hand. seen: the subjects matched
//     when the rule was made or last looked at; a match not among them is "new" and asks for a look.
//   part type:          { id, kind: 'tp' | 'fid' | 'mh', by: 'des' | 'footprint', pattern, reason, who, at }
//     Not a waiver: the checks treat those parts as test points, fiducials, or mounting holes
//     (checks/common.js, C.setPartKinds), so a re-run changes what they find.
//
// Kept in this browser (localStorage, fabcheck.v1.waivers) per scope: a Signoff project, or a
// package name for runs that aren't linked to one. See docs/design.md, "Waivers".
(function (Fab) {
  'use strict';
  const KEY = Fab.fabcheckNs + 'waivers';
  const TOL = 0.25; // mm: the same place, as in Revisions' findings delta

  // ── Storage ──
  let cache = null;
  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cache = null; }
    if (!cache || typeof cache !== 'object' || !cache.scopes) cache = { v: 1, scopes: {} };
    return cache;
  }
  const W = Fab.waivers = { version: 0 };
  function save() {
    W.version++;
    try { localStorage.setItem(KEY, JSON.stringify(load())); return true; } catch (e) { return false; }
  }
  window.addEventListener('storage', ev => { if (ev.key === KEY) { cache = null; W.version++; } });
  const scopeRec = (scope, make) => {
    const s = load().scopes;
    if (!s[scope] && make) s[scope] = { rules: [], kinds: [] };
    return s[scope] || { rules: [], kinds: [] };
  };
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  W.rules = scope => scopeRec(scope).rules;
  W.kinds = scope => scopeRec(scope).kinds;
  W.addRule = (scope, rule) => { rule.id = rule.id || newId('w'); scopeRec(scope, true).rules.push(rule); save(); return rule; };
  W.putRule = (scope, rule) => { const s = scopeRec(scope, true), i = s.rules.findIndex(r => r.id === rule.id); if (i < 0) s.rules.push(rule); else s.rules[i] = rule; save(); return rule; };
  W.removeRule = (scope, id) => { const s = scopeRec(scope, true); s.rules = s.rules.filter(r => r.id !== id); save(); };
  // The same part type twice adds nothing.
  W.addKind = (scope, k) => {
    const s = scopeRec(scope, true), same = s.kinds.find(x => x.kind === k.kind && x.by === k.by && x.pattern.toLowerCase() === k.pattern.toLowerCase());
    if (same) return same;
    k.id = k.id || newId('k'); s.kinds.push(k); save(); return k;
  };
  W.removeKind = (scope, id) => { const s = scopeRec(scope, true); s.kinds = s.kinds.filter(k => k.id !== id); save(); };
  // A run linked to a Signoff project for the first time brings the waivers made under its package name.
  W.mergeScope = (from, to) => {
    if (from === to || !load().scopes[from]) return 0;
    const a = scopeRec(from), b = scopeRec(to, true);
    let n = 0;
    for (const r of a.rules) if (!b.rules.some(x => x.id === r.id)) { b.rules.push(r); n++; }
    for (const k of a.kinds) if (!b.kinds.some(x => x.id === k.id)) { b.kinds.push(k); n++; }
    if (n) save();
    return n;
  };

  // ── Subjects ──
  const isWaivable = f => f && (f.severity === 'error' || f.severity === 'warn') && f.category !== 'Review' && f.check !== 'internal';
  W.isWaivable = isWaivable;
  const checkKey = f => f.category + '/' + f.check;
  const center = f => f.at ? { x: f.at.x, y: f.at.y } : f.bbox ? Fab.bbox.center(f.bbox) : null;
  // What a finding is about, without where exactly: designators if it names any, else its layer (or
  // side) for a finding with a place, else its title.
  function subject(f) {
    if (f.refs && f.refs.length) return checkKey(f) + '|R:' + [...f.refs].sort(Fab.natCmp).join(',') + (f.layer ? '|' + f.layer : '');
    if (center(f)) return checkKey(f) + '|L:' + (f.layer || f.side || '');
    return checkKey(f) + '|T:' + f.title;
  }
  W.snap = function (f) {
    const c = center(f), s = { key: subject(f), sev: f.severity, title: f.title || '', detail: f.detail || '' };
    if (c && !(f.refs && f.refs.length)) { s.x = +c.x.toFixed(4); s.y = +c.y.toFixed(4); }
    return s;
  };
  const sameSubject = (s, f) => {
    if (s.key !== subject(f)) return false;
    if (s.x == null) return true;
    const c = center(f);
    return !!c && Math.hypot(c.x - s.x, c.y - s.y) <= TOL;
  };
  const sameWords = (s, f) => s.sev === f.severity && s.title === (f.title || '') && s.detail === (f.detail || '');
  W.sameSubject = sameSubject;

  // ── Facets: the details a "similar" rule can ask findings to share ──
  // Part details come from the designators a finding names: the PnP (footprint, comment, side), the
  // BOM line (part number, description) and the IPC-356 netlist (nets).
  function partInfo(pkg) {
    if (pkg._partInfo) return pkg._partInfo;
    const m = new Map();
    const get = d => { let r = m.get(d); if (!r) m.set(d, r = { footprint: '', comment: '', side: '', mpn: '', description: '', nets: new Set() }); return r; };
    for (const p of (pkg.pnp && pkg.pnp.parts) || []) { const r = get(p.des); r.footprint = p.footprint || ''; r.comment = p.comment || ''; r.side = p.side || ''; }
    for (const l of (pkg.bom && pkg.bom.lines) || []) for (const d of l.des || []) { const r = get(d); r.mpn = r.mpn || l.mpn || ''; r.description = r.description || l.description || ''; if (!r.footprint) r.footprint = l.footprint || ''; if (!r.comment) r.comment = l.name || l.value || ''; }
    for (const c of (pkg.odb && pkg.odb.comps) || []) { const r = get(c.des); if (!r.side) r.side = c.side || ''; }
    if (pkg.netlist) for (const [d, pins] of pkg.netlist.byDes) { const r = get(d); for (const p of pins) if (p.net && p.net !== 'N/C') r.nets.add(p.net); }
    return (pkg._partInfo = m);
  }
  W.partInfo = partInfo;

  // kind: 'glob' (every value must match the pattern), 'exact' (the same text), 'range' (numbers),
  // 'near' (the finding's place inside a box). `list` facets take every designator's value.
  const FACETS = [
    { key: 'des', label: 'Designator', kind: 'glob', list: true },
    { key: 'footprint', label: 'Footprint', kind: 'glob', list: true },
    { key: 'comment', label: 'Comment', kind: 'glob', list: true },
    { key: 'mpn', label: 'Part number', kind: 'glob', list: true },
    { key: 'description', label: 'Description', kind: 'glob', list: true },
    { key: 'net', label: 'Net', kind: 'glob', list: true },
    { key: 'side', label: 'Side', kind: 'exact' },
    { key: 'layer', label: 'Layer', kind: 'exact' },
    { key: 'title', label: 'Title', kind: 'glob' },
    { key: 'value', label: 'Measured', kind: 'range' },
    { key: 'near', label: 'Nearby', kind: 'near' },
  ];
  W.FACETS = FACETS;

  // A finding's facet values: arrays for list facets (empty when unknown), a string or number otherwise.
  function facetsOf(pkg, f) {
    if (f._facets && f._facets.pkg === pkg) return f._facets;
    const info = pkg ? partInfo(pkg) : new Map();
    const refs = f.refs || [], parts = refs.map(d => info.get(d)).filter(Boolean);
    const vals = k => [...new Set(parts.map(p => p[k]).filter(Boolean))];
    const v = f.value != null && isFinite(f.value) ? Number(f.value) : null;
    const sides = vals('side');
    const fc = {
      pkg, des: refs.slice(), footprint: vals('footprint'), comment: vals('comment'), mpn: vals('mpn'), description: vals('description'),
      net: [...new Set(parts.flatMap(p => [...p.nets]))], side: f.side || (sides.length === 1 ? sides[0] : ''), layer: f.layer || '',
      title: f.title || '', value: v, limit: f.limit != null && isFinite(f.limit) ? Number(f.limit) : null, at: center(f),
    };
    Object.defineProperty(f, '_facets', { value: fc, enumerable: false, configurable: true, writable: true });
    return fc;
  }
  W.facetsOf = facetsOf;

  const reCache = new Map();
  const re = g => { let r = reCache.get(g); if (!r) { r = Fab.globRe(g); if (reCache.size > 500) reCache.clear(); reCache.set(g, r); } return r; };
  // Does a finding pass one facet? Returns false with no value to test: a rule asking for a
  // footprint never matches a finding that names no part.
  function passes(def, want, fc) {
    if (def.kind === 'range') return fc.value != null && (want.min == null || fc.value >= want.min - 1e-9) && (want.max == null || fc.value <= want.max + 1e-9);
    if (def.kind === 'near') return !!fc.at && fc.at.x >= want[0] && fc.at.x <= want[2] && fc.at.y >= want[1] && fc.at.y <= want[3];
    if (def.kind === 'exact') return String(fc[def.key] || '').toLowerCase() === String(want).toLowerCase();
    const r = re(want);
    if (def.list) { const vs = fc[def.key]; return vs.length > 0 && vs.every(x => r.test(x)); }
    return r.test(fc[def.key] || '');
  }
  W.passes = passes;
  // The facets a finding fails (keys), of the ones asked for.
  W.fails = (facets, fc) => FACETS.filter(d => facets[d.key] != null && !passes(d, facets[d.key], fc)).map(d => d.key);

  // Does a similar rule waive this finding? (Before `except`.)
  function similarHit(rule, f, fc) {
    if (rule.check && checkKey(f) !== rule.check) return false;
    if (W.fails(rule.facets || {}, fc).length) return false;
    return (rule.sevs || []).includes(f.severity) || (rule.also || []).some(s => sameSubject(s, f));
  }
  W.similarHit = similarHit;

  // ── Applying the rules to a run's findings ──
  // Returns { by: Map(finding id → { rule, state }), hits: Map(rule id → { n, fresh, found }) }, where
  // state is 'waived', 'new' (a similar rule's match it hadn't seen) or 'stale' (a one-finding
  // waiver whose finding changed; the finding counts as active).
  W.apply = function (pkg, findings, rules) {
    const by = new Map(), hits = new Map();
    for (const r of rules) hits.set(r.id, { n: 0, fresh: 0, found: new Set() });
    if (!rules.length) return { by, hits };
    for (const f of findings) {
      if (!isWaivable(f)) continue;
      let stale = null;
      for (const r of rules) {
        if (r.kind === 'one') {
          if (r.check !== checkKey(f)) continue;
          const i = r.items.findIndex(s => sameSubject(s, f));
          if (i < 0) continue;
          hits.get(r.id).found.add(i);
          if (sameWords(r.items[i], f)) { by.set(f.id, { rule: r, state: 'waived' }); hits.get(r.id).n++; stale = null; break; }
          stale = stale || { rule: r, state: 'stale', was: r.items[i] };
        } else {
          const fc = facetsOf(pkg, f);
          if (!similarHit(r, f, fc) || (r.except || []).some(s => sameSubject(s, f))) continue;
          const fresh = !(r.seen || []).some(s => sameSubject(s, f));
          by.set(f.id, { rule: r, state: fresh ? 'new' : 'waived' });
          const h = hits.get(r.id); h.n++; if (fresh) h.fresh++;
          stale = null;
          break;
        }
      }
      if (stale && !by.has(f.id)) by.set(f.id, stale);
    }
    return { by, hits };
  };

  // ── Building a similar rule from examples ──
  const lcp = a => { if (!a.length) return ''; let p = a[0]; for (const s of a) while (s.toLowerCase().indexOf(p.toLowerCase()) !== 0) p = p.slice(0, -1); return p; };
  const lcs = a => { if (!a.length) return ''; let p = a[0]; for (const s of a) while (!s.toLowerCase().endsWith(p.toLowerCase())) p = p.slice(1); return p; };
  // A pattern covering every text: the text itself when they agree, else what they start and end
  // with around a * ("TCSDA", "TCCLK" → "TC*"). Empty when they share nothing.
  function cover(texts) {
    const t = [...new Set(texts)];
    if (!t.length) return '';
    if (t.length === 1) return t[0];
    const pre = lcp(t), suf = lcs(t.map(s => s.slice(pre.length)));
    return pre || suf ? pre + '*' + suf : '';
  }
  W.cover = cover;

  // What the examples share, facet by facet: { key: { value, on, shown } }. `value` is the proposal
  // (a pattern, a side, a range, a box), `on` whether it starts ticked, `shown` the examples' values
  // as text for the panel. Ticked by default: the details every example has the same of, plus a
  // designator prefix of two or more letters (TC*, TP*; R* alone would take in every resistor).
  W.propose = function (pkg, examples, margin) {
    const fcs = examples.map(f => facetsOf(pkg, f)), out = {}, many = examples.length > 1;
    for (const d of FACETS) {
      if (d.kind === 'range') {
        // No worse than the examples: with a minimum to meet (the value fell short of its limit) the
        // rule asks for at least the examples' lowest value, with a maximum at most their highest, so
        // a worse case of the same check (a 0.02 mm dam among 0.07 mm ones) stays out. Ticked.
        const vs = fcs.map(c => c.value).filter(v => v != null);
        if (vs.length !== fcs.length || !vs.length) continue;
        const lo = Math.min(...vs), hi = Math.max(...vs), shown = vs.map(v => +v.toFixed(4)).join(', ');
        const short = fcs.every(c => c.limit != null && c.value < c.limit), over = fcs.every(c => c.limit != null && c.value > c.limit);
        out[d.key] = short ? { value: { min: lo, max: null }, on: true, shown } : over ? { value: { min: null, max: hi }, on: true, shown } : { value: { min: lo, max: hi }, on: false, shown };
        continue;
      }
      if (d.kind === 'near') {
        const at = fcs.map(c => c.at).filter(Boolean);
        if (at.length === fcs.length && at.length) {
          const m = margin == null ? 5 : margin, b = [Infinity, Infinity, -Infinity, -Infinity];
          for (const p of at) { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); }
          out[d.key] = { value: [b[0] - m, b[1] - m, b[2] + m, b[3] + m], margin: m, on: false, shown: '' };
        }
        continue;
      }
      const per = fcs.map(c => d.list ? c[d.key] : (c[d.key] ? [c[d.key]] : []));
      if (per.some(v => !v.length)) continue; // an example has no value for it
      const flat = per.flat(), distinct = [...new Set(flat.map(s => s.toLowerCase()))];
      const shown = [...new Set(flat)].slice(0, 6).join(', ') + (new Set(flat).size > 6 ? ' …' : '');
      if (d.key === 'des') {
        // One designator: its letters before a number (TP12 → TP*); several: what they start with.
        const lead = flat.length === 1 ? (/^([A-Za-z_]+)\d+$/.exec(flat[0]) || [])[1] : null;
        const value = flat.length === 1 ? (lead ? lead + '*' : flat[0]) : (lcp(flat) ? lcp(flat) + '*' : '');
        const pre = value.replace(/\*.*$/, '');
        out.des = { value, on: /^[A-Za-z_]{2,}/.test(pre) && value.endsWith('*'), shown };
        continue;
      }
      if (d.key === 'title') { const v = cover(flat); out.title = { value: v, on: false, shown: many ? shown : '' }; continue; }
      const one = distinct.length === 1;
      const value = d.kind === 'exact' ? flat[0] : one ? flat[0] : cover(flat);
      // A single example ticks only its footprint and part number: its comment, nets, and side
      // say more about that part than about what is like it.
      const on = one && (many ? d.key !== 'side' && d.key !== 'layer' : d.key === 'footprint' || d.key === 'mpn');
      out[d.key] = { value, on: on && !!value, shown, differs: !one };
    }
    return out;
  };

  // A rule in words, for the Waivers list and the inspector.
  // fmt formats a measured value (the app knows each check's unit).
  W.describe = function (rule, fmt) {
    if (rule.kind === 'one') return rule.items.length === 1 ? 'This finding only' : rule.items.length + ' findings';
    const f = rule.facets || {}, num = fmt || (v => String(+v.toFixed(4)));
    const parts = FACETS.filter(d => f[d.key] != null).map(d => {
      const v = f[d.key];
      if (d.kind === 'range') return v.max == null ? `measured at least ${num(v.min)}` : v.min == null ? `measured at most ${num(v.max)}` : `measured ${num(v.min)} to ${num(v.max)}`;
      if (d.kind === 'near') return 'near the examples';
      return `${d.label.toLowerCase()} ${v}`;
    });
    const sev = (rule.sevs || []).includes('error') ? 'errors and warnings' : (rule.also || []).length ? `warnings and ${rule.also.length} error${rule.also.length === 1 ? '' : 's'}` : 'warnings';
    return `${rule.check ? rule.check.split('/')[1] : 'any check'}, ${sev}` + (parts.length ? ': ' + parts.join(', ') : '');
  };

  // A part type in words.
  const KIND_NAMES = { tp: 'test point', fid: 'fiducial', mh: 'mounting hole' };
  W.KIND_NAMES = KIND_NAMES;
  W.describeKind = k => `${k.by === 'footprint' ? 'Footprint' : 'Designator'} ${k.pattern} as ${KIND_NAMES[k.kind] || k.kind}s`;
  // The parts a part type would take in, by designator.
  W.kindParts = function (pkg, k) {
    const r = Fab.globRe(k.pattern), out = new Set();
    for (const p of (pkg.pnp && pkg.pnp.parts) || []) if (r.test(k.by === 'footprint' ? p.footprint || '' : p.des)) out.add(p.des);
    if (k.by === 'des') for (const c of (pkg.odb && pkg.odb.comps) || []) if (r.test(c.des)) out.add(c.des);
    return [...out].sort(Fab.natCmp);
  };
})(window.Fab);
