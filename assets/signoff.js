// Send to Signoff EE: write Fabcheck errors and warnings into a board's Signoff review as issues on
// the Fabrication & Release checklist. Signoff keeps its working copy in localStorage (same origin
// as Fabcheck when both are served from the tools folder); writing there in Signoff's own format,
// stamped and marked dirty, lets Signoff's normal Sync push the issues.
//
// Format (ee_design_review/assets/model.js and app.js):
//   signoff.v1.projects  slug -> project { id, meta, items, sections, comments, custom }
//   signoff.v1.dirty     project id -> ISO time of the last unsynced edit
//   custom[id]   { id, checklist, section, text, hint, severity, createdAt, updatedAt, updatedBy }
//   items[id]    { status: 'issue', severity, resolution: '', ref, text, checklist, updatedAt, updatedBy }
//   comments[id] { id, item, author, at, text, updatedAt, updatedBy }
(function (Fab) {
  'use strict';
  const NS = 'signoff.v1.';
  const now = () => new Date().toISOString();
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load(key, fallback) { try { const v = localStorage.getItem(NS + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, value) { localStorage.setItem(NS + key, JSON.stringify(value)); }
  function user() { return (load('settings', {}) || {}).user || 'Fabcheck'; }
  function stamp(rec, who) { rec.updatedAt = now(); rec.updatedBy = who; return rec; }

  // Stable id per board + Fabcheck check, so re-sending updates the same Signoff issue.
  function stableId(projectId, check, severity) {
    let h = 2166136261;
    for (const c of projectId + '|' + check + '|' + severity) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'xfc' + (h >>> 0).toString(36);
  }

  // Fab checklist section for a finding (fab.json section ids).
  function sectionFor(f) {
    if (f.category === 'Package') return 'g-fil';
    if (f.category === 'Assembly' || f.category === 'BOM') return 'g-rel';
    if (/^(drill|aspect|slot|ring|npth)$/.test(f.check)) return 'f-drl';
    if (/^(mask|mask-dam|silk|silk-pad)$/.test(f.check)) return 'f-msk';
    return 'g-drc';
  }

  function projects() {
    const all = load('projects', {});
    return Object.keys(all).map(slug => Object.assign({ slug }, all[slug])).filter(p => p && p.meta && !p.meta.archived)
      .sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
  }

  // Group errors and warnings by check and severity.
  function plan(findings) {
    const groups = new Map();
    for (const f of findings) {
      if (f.severity === 'info' || f.check === 'internal') continue;
      const k = f.check + '|' + f.severity;
      if (!groups.has(k)) groups.set(k, { check: f.check, severity: f.severity, category: f.category, list: [] });
      groups.get(k).list.push(f);
    }
    return [...groups.values()].sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) || b.list.length - a.list.length);
  }

  function where(f) {
    const c = f.at || (f.bbox && Fab.bbox.center(f.bbox));
    return c ? ` (${c.x.toFixed(2)}, ${c.y.toFixed(2)} mm${f.layer ? ', ' + f.layer : ''})` : '';
  }

  // Write the groups into the project. Returns {created, updated, resolvedNotes}.
  function send(slug, groups, source) {
    const all = load('projects', {});
    const p = all[slug];
    if (!p) throw new Error('That Signoff project is no longer in this browser.');
    const dirty = load('dirty', {});
    const who = user(), t = now();
    p.custom = p.custom || {}; p.items = p.items || {}; p.comments = p.comments || {};
    const seen = new Set();
    let created = 0, updated = 0, resolvedNotes = 0;
    const comment = (item, text) => { const id = uid('c'); p.comments[id] = stamp({ id, item, author: who, at: t, text }, who); };
    for (const g of groups) {
      const id = stableId(p.id, g.check, g.severity);
      seen.add(id);
      const first = g.list[0];
      const n = g.list.length;
      const text = `Fabcheck: ${first.title.replace(/^…/, '')}${n > 1 ? ` (+${n - 1} more)` : ''}`;
      const lines = g.list.slice(0, 25).map(f => `• ${f.title}${where(f)}`);
      if (n > 25) lines.push(`• … ${n - 25} more`);
      const hint = `${n} ${g.severity === 'error' ? 'error' : 'warning'}${n === 1 ? '' : 's'} from Fabcheck check "${g.check}" on ${source.label}${source.sha ? ' (SHA-256 ' + source.sha.slice(0, 12) + '…)' : ''}.\n${first.detail || ''}\n\n${lines.join('\n')}`;
      const refs = [...new Set(g.list.flatMap(f => f.refs || []))].slice(0, 40).join(', ');
      const severity = g.severity === 'error' ? 'major' : 'minor';
      const existing = p.custom[id];
      p.custom[id] = stamp(Object.assign({}, existing || { id, createdAt: t }, { id, checklist: 'fab', section: sectionFor(first), text, hint, severity, deleted: false, source: { tool: 'fabcheck', check: g.check, gone: false } }), who);
      const prev = p.items[id] || {};
      if (!existing || existing.deleted) {
        p.items[id] = stamp(Object.assign({}, prev, { status: 'issue', severity, resolution: '', ref: refs, text, checklist: 'fab' }), who);
        comment(id, `Raised by Fabcheck from ${source.label}: ${n} finding${n === 1 ? '' : 's'}.`);
        created++;
      } else {
        // Keep the reviewer's status and resolution; refresh the wording and say what the new run saw.
        p.items[id] = stamp(Object.assign({}, prev, { text, ref: refs || prev.ref, checklist: 'fab' }), who);
        comment(id, `Fabcheck re-run on ${source.label}: still ${n} finding${n === 1 ? '' : 's'}.`);
        updated++;
      }
    }
    // Issues Fabcheck raised before that this run no longer finds.
    for (const id of Object.keys(p.custom)) {
      const c = p.custom[id];
      if (!c.source || c.source.tool !== 'fabcheck' || c.deleted || seen.has(id)) continue;
      const st = p.items[id] || {};
      if (st.status !== 'issue' || st.resolution || c.source.gone) continue;
      comment(id, `Fabcheck re-run on ${source.label}: no longer found. Mark it Fixed if that is expected.`);
      p.custom[id] = stamp(Object.assign({}, c, { source: Object.assign({}, c.source, { gone: true }) }), who);
      resolvedNotes++;
    }
    all[slug] = p;
    dirty[p.id] = t;
    save('projects', all);
    save('dirty', dirty);
    // Open the project's Findings page next time Signoff loads.
    const ui = load('ui', {}) || {};
    save('ui', Object.assign(ui, { slug, view: 'findings' }));
    return { created, updated, resolvedNotes };
  }

  Fab.signoff = { projects, plan, send, sectionFor, stableId };
})(window.Fab);
