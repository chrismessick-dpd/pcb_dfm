// Fab rules: the limits the DFM checks use, grouped as fab houses quote them.
// Built-in profiles are typical industry values (not any vendor's datasheet) and read-only. Custom
// profiles start from one of them; each edited rule is stamped (at/by) so two people's edits merge per
// rule, like Signoff's records. Runs keep a full copy of the rules they used (docs/fabcheck-link.md).
(function (Fab) {
  'use strict';

  // ---- rule catalog ----
  // unit: 'mm' | 'mm2' | 'ratio' | 'count'. lo/hi: plausible range (outside it, warn). zero: 0 allowed.
  const RULES = [
    { key: 'minTrace', group: 'Copper', name: 'Minimum trace width', unit: 'mm', lo: 0.05, hi: 0.5, checks: ['trace', 'sliver'], desc: 'Narrowest copper trace or neck the fab etches reliably.' },
    { key: 'minSpace', group: 'Copper', name: 'Minimum copper spacing', unit: 'mm', lo: 0.05, hi: 0.5, checks: ['spacing', 'thermal'], desc: 'Smallest gap between separate copper features, including thermal-relief air gaps.' },
    { key: 'copperToEdge', group: 'Copper', name: 'Copper to board edge', unit: 'mm', lo: 0.1, hi: 1.5, checks: ['edge'], desc: 'Pull-back of copper from the routed outline and cutouts.' },
    { key: 'isoMinArea', group: 'Copper', name: 'Smallest isolated copper reported', unit: 'mm2', lo: 0.001, hi: 10, checks: ['isolated'], desc: 'Unconnected copper islands smaller than this are ignored.' },
    { key: 'minDrill', group: 'Drill & vias', name: 'Minimum drill', unit: 'mm', lo: 0.1, hi: 1.0, checks: ['drill'], desc: 'Smallest mechanical drill (finished hole size).' },
    { key: 'maxAspect', group: 'Drill & vias', name: 'Maximum aspect ratio', unit: 'ratio', lo: 4, hi: 20, checks: ['aspect'], desc: 'Board thickness divided by the smallest plated drill.' },
    { key: 'ringPth', group: 'Drill & vias', name: 'Annular ring, plated holes', unit: 'mm', lo: 0.05, hi: 0.5, checks: ['ring'], desc: 'Copper left around a component through-hole after drilling.' },
    { key: 'ringVia', group: 'Drill & vias', name: 'Annular ring, vias', unit: 'mm', lo: 0.03, hi: 0.4, checks: ['ring'], desc: 'Copper left around a via after drilling.' },
    { key: 'viaMaxDrill', group: 'Drill & vias', name: 'Largest drill treated as a via', unit: 'mm', lo: 0.15, hi: 0.8, checks: ['ring', 'mask', 'placement', 'paste'], desc: 'Plated holes up to this size are vias (via ring, tenting); larger ones are component holes.' },
    { key: 'minSlot', group: 'Drill & vias', name: 'Minimum plated slot width', unit: 'mm', lo: 0.3, hi: 3, checks: ['slot'], desc: 'Narrowest plated slot.' },
    { key: 'minNpthSlot', group: 'Drill & vias', name: 'Minimum non-plated slot width', unit: 'mm', lo: 0.5, hi: 3, checks: ['slot'], desc: 'Narrowest unplated (routed) slot.' },
    { key: 'viaHoleGap', group: 'Drill & vias', name: 'Via to via hole spacing', unit: 'mm', lo: 0.1, hi: 1, checks: ['hole-gap'], desc: 'Drill wall to drill wall between two vias.' },
    { key: 'holeGap', group: 'Drill & vias', name: 'Hole to hole spacing', unit: 'mm', lo: 0.2, hi: 1.5, checks: ['hole-gap'], desc: 'Drill wall to drill wall when a component hole or slot is involved.' },
    { key: 'holeToEdge', group: 'Drill & vias', name: 'Hole to board edge', unit: 'mm', lo: 0.2, hi: 2, checks: ['hole-edge'], desc: 'Drill wall to the routed outline or a cutout, so the hole does not break out.' },
    { key: 'minCastellation', group: 'Drill & vias', name: 'Minimum castellated hole', unit: 'mm', lo: 0.3, hi: 2, checks: ['castellation'], desc: 'Smallest plated half-hole on the board edge.' },
    { key: 'viaInPad', group: 'Drill & vias', name: 'Via in pad allowed', unit: 'count', lo: 0, hi: 1, zero: true, checks: ['via-in-pad'], desc: '1 if the fab fills and caps vias in pads (POFV); 0 to flag every via in an SMD pad.' },
    { key: 'npthToCopper', group: 'Drill & vias', name: 'Non-plated hole to copper', unit: 'mm', lo: 0.1, hi: 1.0, checks: ['npth'], desc: 'Clearance from an unplated hole to any copper.' },
    { key: 'minMaskExp', group: 'Solder mask', name: 'Minimum mask expansion', unit: 'mm', lo: 0, hi: 0.2, zero: true, checks: ['mask'], desc: 'How far a mask opening must exceed its pad on each side (0 means flush).' },
    { key: 'minMaskDam', group: 'Solder mask', name: 'Minimum mask dam', unit: 'mm', lo: 0.05, hi: 0.3, checks: ['mask-dam'], desc: 'Narrowest strip of mask between two openings that stays on the board.' },
    { key: 'minSilkLine', group: 'Silkscreen', name: 'Minimum silkscreen line', unit: 'mm', lo: 0.07, hi: 0.4, checks: ['silk'], desc: 'Thinnest legend stroke that prints.' },
    { key: 'silkToPad', group: 'Silkscreen', name: 'Silkscreen to pad', unit: 'mm', lo: 0.05, hi: 0.5, checks: ['silk-pad'], desc: 'Clearance from legend ink to an exposed pad (mask opening).' },
    { key: 'minSilkText', group: 'Silkscreen', name: 'Minimum text height', unit: 'mm', lo: 0.4, hi: 3, checks: [], desc: 'Smallest legible legend text (kept with the profile; not checked yet).' },
    { key: 'minSpoke', group: 'Thermals', name: 'Minimum thermal spoke width', unit: 'mm', lo: 0.1, hi: 0.6, checks: ['thermal'], desc: 'Narrowest copper spoke tying a pad to a plane.' },
    { key: 'minSpokes', group: 'Thermals', name: 'Minimum spoke count', unit: 'count', lo: 1, hi: 8, checks: ['thermal'], desc: 'Fewest spokes per thermal relief.' },
    { key: 'minBgaPad', group: 'Copper', name: 'Minimum BGA pad', unit: 'mm', lo: 0.15, hi: 0.8, checks: ['bga-pad'], desc: 'Smallest BGA land (pads marked BGAPad in Gerber X2).' },
    { key: 'minInsideRadius', group: 'Board', name: 'Outline inside-corner radius', unit: 'mm', lo: 0.2, hi: 2, zero: true, checks: ['outline-corner'], desc: 'Radius the router leaves in an inside corner of the outline or a cutout.' },
    { key: 'maxCopperImbalance', group: 'Board', name: 'Copper balance, symmetric layers', unit: 'pct', lo: 5, hi: 60, checks: ['copper-balance'], desc: 'Largest difference in copper coverage (percentage points) between layers mirrored about the stackup center.' },
    { key: 'thickness', group: 'Board', name: 'Default board thickness', unit: 'mm', lo: 0.4, hi: 3.2, checks: ['aspect'], desc: 'Finished thickness used for aspect ratio unless set for the run.' },
  ];
  const GROUPS = ['Copper', 'Drill & vias', 'Solder mask', 'Silkscreen', 'Thermals', 'Board'];

  // ---- built-in industry defaults (typical values, not a vendor's numbers) ----
  const BUILTIN = {
    prototype: {
      label: 'Prototype (relaxed, 6/6 mil)',
      desc: 'Relaxed class for the widest choice of fabs: 6 mil trace and space (OSH Park 2-layer), 0.3 mm drills, generous rings. Sources: docs/fab-rules.md.',
      minTrace: 0.152, minSpace: 0.152, minDrill: 0.30, maxAspect: 8,
      ringPth: 0.25, ringVia: 0.15, copperToEdge: 0.40, npthToCopper: 0.30,
      minMaskExp: 0.0, minMaskDam: 0.13, minSilkLine: 0.15, minSilkText: 1.0, silkToPad: 0.15,
      minSpoke: 0.25, minSpokes: 2, minSlot: 0.50, minNpthSlot: 1.0, thickness: 1.6, viaMaxDrill: 0.45, isoMinArea: 0.05,
      viaHoleGap: 0.30, holeGap: 0.50, holeToEdge: 0.50, minCastellation: 0.50, viaInPad: 0,
      minBgaPad: 0.30, minInsideRadius: 0.50, maxCopperImbalance: 25,
    },
    standard: {
      label: 'Standard (quick-turn)',
      desc: 'Limits most mainstream quick-turn houses meet: 5 mil trace and space, 0.25 mm drills, 8:1 aspect ratio. Sources: docs/fab-rules.md.',
      minTrace: 0.127, minSpace: 0.127, minDrill: 0.25, maxAspect: 8,
      ringPth: 0.20, ringVia: 0.13, copperToEdge: 0.30, npthToCopper: 0.25,
      minMaskExp: 0.0, minMaskDam: 0.10, minSilkLine: 0.15, minSilkText: 1.0, silkToPad: 0.15,
      minSpoke: 0.20, minSpokes: 2, minSlot: 0.50, minNpthSlot: 1.0, thickness: 1.6, viaMaxDrill: 0.45, isoMinArea: 0.05,
      viaHoleGap: 0.28, holeGap: 0.45, holeToEdge: 0.50, minCastellation: 0.50, viaInPad: 0,
      minBgaPad: 0.30, minInsideRadius: 0.50, maxCopperImbalance: 25,
    },
    advanced: {
      label: 'Advanced (HDI-lite)',
      desc: 'Advanced shop without microvias: 3 mil trace and space, 0.15 mm mechanical drills, filled vias in pads. Sources: docs/fab-rules.md.',
      minTrace: 0.075, minSpace: 0.075, minDrill: 0.15, maxAspect: 10,
      ringPth: 0.10, ringVia: 0.075, copperToEdge: 0.20, npthToCopper: 0.20,
      minMaskExp: 0.0, minMaskDam: 0.075, minSilkLine: 0.127, minSilkText: 0.80, silkToPad: 0.15,
      minSpoke: 0.15, minSpokes: 2, minSlot: 0.35, minNpthSlot: 0.80, thickness: 1.6, viaMaxDrill: 0.45, isoMinArea: 0.05,
      viaHoleGap: 0.20, holeGap: 0.33, holeToEdge: 0.40, minCastellation: 0.40, viaInPad: 1,
      minBgaPad: 0.28, minInsideRadius: 0.40, maxCopperImbalance: 25,
    },
  };
  // Older code and runs refer to Fab.profiles[id].label and values.
  Fab.profiles = BUILTIN;

  // ---- custom profiles (localStorage, merged per field) ----
  const KEY = Fab.fabcheckNs + 'profiles', LAST = Fab.fabcheckNs + 'lastProfile';
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };
  const now = () => new Date().toISOString();
  const who = () => ((load(Fab.signoffNs + 'settings', {}) || {}).user) || 'Fabcheck';
  const stamp = v => ({ v, at: now(), by: who() });
  const newer = (a, b) => !a ? b : !b ? a : (a.at !== b.at ? (a.at > b.at ? a : b) : ((a.by || '') >= (b.by || '') ? a : b));

  let customs = load(KEY, {});
  const listeners = [];
  const changed = () => { save(KEY, customs); listeners.forEach(f => f()); };

  function mergeProfile(a, b) {
    if (!a) return b;
    if (!b) return a;
    const rules = {};
    for (const k of new Set([...Object.keys(a.rules || {}), ...Object.keys(b.rules || {})])) rules[k] = newer((a.rules || {})[k], (b.rules || {})[k]);
    return {
      id: a.id, base: a.base || b.base, createdAt: a.createdAt < b.createdAt ? a.createdAt : b.createdAt, createdBy: a.createdBy || b.createdBy,
      name: newer(a.name, b.name), notes: newer(a.notes, b.notes), deleted: newer(a.deleted, b.deleted), rules,
    };
  }

  const isBuiltin = id => Object.prototype.hasOwnProperty.call(BUILTIN, id);
  const live = p => p && !(p.deleted && p.deleted.v);

  // Effective profile: { id, name, builtin, base, baseName, values, notes, edited: {key: true} }
  function resolve(id) {
    if (isBuiltin(id)) return { id, name: BUILTIN[id].label, builtin: true, base: id, baseName: BUILTIN[id].label, values: pick(BUILTIN[id]), desc: BUILTIN[id].desc, edited: {} };
    const p = customs[id];
    if (!live(p)) return null;
    const base = BUILTIN[p.base] ? p.base : 'standard';
    const values = pick(BUILTIN[base]), edited = {};
    for (const [k, r] of Object.entries(p.rules || {})) if (r && r.v != null && k in values) { values[k] = r.v; if (r.v !== BUILTIN[base][k]) edited[k] = r; }
    return { id, name: p.name.v, builtin: false, base, baseName: BUILTIN[base].label, values, notes: (p.notes && p.notes.v) || {}, edited, raw: p };
  }
  const pick = src => { const o = {}; for (const r of RULES) o[r.key] = src[r.key]; return o; };

  function list() {
    const out = Object.keys(BUILTIN).map(resolve);
    for (const id of Object.keys(customs)) { const r = resolve(id); if (r) out.push(r); }
    return out;
  }

  function create(fromId, name) {
    const src = resolve(fromId) || resolve('standard');
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const t = now(), by = who();
    const rules = {};
    for (const [k, v] of Object.entries(src.values)) if (v !== BUILTIN[src.base][k]) rules[k] = { v, at: t, by };
    customs[id] = { id, base: src.base, createdAt: t, createdBy: by, name: { v: name || src.name + ' (copy)', at: t, by }, notes: { v: Object.assign({ source: '', url: '', date: '', text: '' }, src.notes || {}), at: t, by }, deleted: { v: false, at: t, by }, rules };
    changed();
    return id;
  }
  function setRule(id, key, value) { const p = customs[id]; if (!p) return; p.rules = p.rules || {}; p.rules[key] = stamp(value); changed(); }
  function resetRule(id, key) { setRule(id, key, null); }
  function resetAll(id) { const p = customs[id]; if (!p) return; for (const k of Object.keys(p.rules || {})) p.rules[k] = stamp(null); changed(); }
  function rename(id, name) { const p = customs[id]; if (p) { p.name = stamp(name); changed(); } }
  function setNotes(id, notes) { const p = customs[id]; if (p) { p.notes = stamp(Object.assign({}, (p.notes && p.notes.v) || {}, notes)); changed(); } }
  function remove(id) { const p = customs[id]; if (p) { p.deleted = stamp(true); changed(); } }

  function exportJson(id) {
    const r = resolve(id);
    return JSON.stringify({ fabcheckProfile: 1, name: r.name, base: r.base, notes: r.notes || {}, rules: r.values }, null, 2);
  }
  function importJson(text) {
    const d = JSON.parse(text);
    if (!d || d.fabcheckProfile !== 1 || !d.rules) throw new Error('Not a Fabcheck profile file');
    const id = create(isBuiltin(d.base) ? d.base : 'standard', d.name || 'Imported profile');
    for (const r of RULES) if (typeof d.rules[r.key] === 'number' && d.rules[r.key] !== BUILTIN[customs[id].base][r.key]) customs[id].rules[r.key] = stamp(d.rules[r.key]);
    if (d.notes) customs[id].notes = stamp(Object.assign({ source: '', url: '', date: '', text: '' }, d.notes));
    changed();
    return id;
  }

  // Problems with a value: [{level: 'error'|'warn', text}].
  function validate(key, value, values) {
    const r = RULES.find(x => x.key === key), out = [];
    if (value == null || !isFinite(value)) return [{ level: 'error', text: 'Enter a number.' }];
    if (value < 0 || (value === 0 && !r.zero)) out.push({ level: 'error', text: r.zero ? 'Must be zero or more.' : 'Must be more than zero.' });
    else if (value < r.lo || value > r.hi) out.push({ level: 'warn', text: `Unusual: most fabs are between ${fmtVal(r, r.lo)} and ${fmtVal(r, r.hi)}.` });
    if (r.unit === 'count' && Math.round(value) !== value) out.push({ level: 'error', text: 'Must be a whole number.' });
    const v = Object.assign({}, values, { [key]: value });
    if (key === 'minSpace' && v.minSpace < v.minTrace) out.push({ level: 'warn', text: `Below the minimum trace width (${v.minTrace} mm); fabs rarely etch gaps finer than their lines.` });
    if (key === 'ringVia' && v.ringVia > v.ringPth) out.push({ level: 'warn', text: 'Larger than the plated-hole ring; via rings are usually the smaller of the two.' });
    if (key === 'viaMaxDrill' && v.viaMaxDrill < v.minDrill) out.push({ level: 'warn', text: 'Smaller than the minimum drill, so no hole counts as a via.' });
    return out;
  }
  function fmtVal(r, v) {
    if (r.unit === 'mm') return Fab.fmtLen(+(+v).toFixed(3));
    if (r.unit === 'mm2') return `${+v.toFixed(3)} mm²`;
    if (r.unit === 'ratio') return `${+v.toFixed(2)}:1`;
    if (r.unit === 'pct') return `${+v.toFixed(1)} points`;
    return String(v);
  }

  // Last profile used, per Signoff project and per package name.
  function remember(id, { projectId, pkgName }) {
    const l = load(LAST, { byProject: {}, byPackage: {} });
    if (projectId) l.byProject[projectId] = id;
    if (pkgName) l.byPackage[pkgName] = id;
    save(LAST, l);
  }
  function suggest({ projectId, pkgName }) {
    const l = load(LAST, { byProject: {}, byPackage: {} });
    for (const id of [projectId && l.byProject[projectId], pkgName && l.byPackage[pkgName]]) if (id && resolve(id)) return id;
    return null;
  }

  // Effective rules for a run's settings: its own copy, else the built-in profile it names.
  // Rules added after a run was made fall back to the run's built-in profile (or Standard).
  function rulesOfRun(settings) {
    const base = pick(BUILTIN[(settings && settings.profile) in BUILTIN ? settings.profile : 'standard']);
    return settings && settings.rules ? Object.assign(base, settings.rules) : base;
  }
  // Rules the run did not record because they were added to Fabcheck since.
  function newSince(settings) {
    if (!settings || !settings.rules) return [];
    return RULES.filter(r => !(r.key in settings.rules));
  }

  // Merge profiles from elsewhere (the team's data repo). Returns ids whose merged form differs from `incoming`.
  function mergeIn(incoming) {
    const differ = [];
    let any = false;
    for (const p of incoming) {
      const m = mergeProfile(customs[p.id], p);
      if (JSON.stringify(m) !== JSON.stringify(customs[p.id])) { customs[p.id] = m; any = true; }
      if (JSON.stringify(m) !== JSON.stringify(p)) differ.push(p.id);
    }
    if (any) changed();
    return differ;
  }

  Fab.rules = {
    RULES, GROUPS, BUILTIN, isBuiltin, resolve, list, create, setRule, resetRule, resetAll, rename, setNotes, remove,
    exportJson, importJson, validate, fmtVal, remember, suggest, rulesOfRun, newSince, mergeIn, mergeProfile,
    all: () => customs, onChange: f => listeners.push(f), reload: () => { customs = load(KEY, {}); },
  };
})(window.Fab);
