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
  const NS = Fab.signoffNs;
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
  // A group's issue id: one per check and severity, or one per review note (its own id, whatever its
  // severity becomes), or one per check and severity for the findings waived in Fabcheck.
  const groupId = (projectId, g) => g.note ? stableId(projectId, 'note:' + g.note, 'note') : g.waived ? stableId(projectId, 'waived:' + g.check, g.severity) : stableId(projectId, g.check, g.severity);
  // Fab checklist section for a finding (fab.json section ids and titles).
  const SECTIONS = { 'g-fil': 'Fab Package & Gerber Files', 'f-drl': 'Drill, Vias & Plating', 'f-msk': 'Solder Mask & Silkscreen', 'g-drc': 'Final DRC & DFM', 'g-rel': 'Release & Version Control' };
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

  // Group errors and warnings by check and severity. `key` (check|severity) names a group across
  // re-runs, the way stableId does in a project. A review note is a group of its own (`note`: its id),
  // so each becomes its own Signoff issue. Info findings stay in Fabcheck, except review notes: a
  // reviewer wrote those to be read, so Info notes go too (as Minor).
  // waiverOf(f), when given, returns the waiver rule of a finding the reviewer waived in Fabcheck
  // (waivers.js), else null. Waived findings make groups of their own (`waived: true`, key
  // `waived|check|severity`, `rules` beside `list`), which Signoff keeps as reference rows, counted
  // nowhere (custom `reference: true`; ee_design_review model.js). The app leaves them unticked.
  function plan(findings, waiverOf) {
    const groups = new Map();
    for (const f of findings) {
      if ((f.severity === 'info' && f.category !== 'Review') || f.check === 'internal') continue;
      const note = f.category === 'Review' ? f.id : null;
      const w = waiverOf && !note ? waiverOf(f) : null;
      const k = note ? 'note|' + note : (w ? 'waived|' : '') + f.check + '|' + f.severity;
      if (!groups.has(k)) groups.set(k, Object.assign({ key: k, check: f.check, severity: f.severity, category: f.category, note, list: [] }, w ? { waived: true, rules: [] } : {}));
      const g = groups.get(k);
      g.list.push(f);
      if (w) g.rules.push(w);
    }
    // Errors, warnings, and notes first; the waived groups after them.
    return [...groups.values()].sort((a, b) => (a.waived ? 1 : 0) - (b.waived ? 1 : 0) || (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) || b.list.length - a.list.length);
  }
  // The reasons a waived group's rules give.
  const reasonsOf = rules => [...new Set((rules || []).map(r => r.reason).filter(Boolean))].map(r => `"${r}"`).join('; ');

  // The Signoff issue's title for a group.
  function issueText(g) {
    if (g.note) return `Review note: ${g.list[0].title}`;
    const n = g.list.length;
    return `${g.waived ? 'Waived in Fabcheck' : 'Fabcheck'}: ${g.list[0].title.replace(/^…/, '')}${n > 1 ? ` (+${n - 1} more)` : ''}`;
  }

  // What sending would do in a project, without writing: per group, whether its issue is new,
  // updates one sent before (keeping the reviewer's resolution) or re-raises a deleted one; and the
  // earlier Fabcheck issues that would be noted as no longer found. Groups left out still count as
  // found, so they never get that note.
  function preview(slug, groups) {
    const p = load('projects', {})[slug];
    if (!p) return null;
    const custom = p.custom || {}, items = p.items || {};
    const rows = groups.map(g => {
      const id = groupId(p.id, g), c = custom[id];
      return { group: g, id, text: issueText(g), section: SECTIONS[sectionFor(g.list[0])], severity: g.waived ? 'reference' : g.severity === 'error' ? 'major' : 'minor',
        state: !c ? 'new' : c.deleted ? 'deleted' : 'update', resolution: c && !c.deleted && !g.waived ? (items[id] || {}).resolution || '' : '' };
    });
    const seen = new Set(rows.map(r => r.id));
    return { rows, gone: goneIds(p, seen).map(id => custom[id].text), dropped: droppedRefs(p, seen).map(id => custom[id].text) };
  }

  // Earlier Fabcheck issues, still open, that this run didn't find (`seen` holds the ids it did).
  function goneIds(p, seen) {
    const custom = p.custom || {}, items = p.items || {};
    return Object.keys(custom).filter(id => {
      const c = custom[id], st = items[id] || {};
      return c.source && c.source.tool === 'fabcheck' && !c.deleted && !c.reference && !seen.has(id) && st.status === 'issue' && !st.resolution && !c.source.gone;
    });
  }
  // Reference rows (waived findings sent to keep) whose findings this run no longer has waived:
  // fixed, or unwaived and sent as issues again. They are only copies, so they are removed.
  function droppedRefs(p, seen) {
    const custom = p.custom || {};
    return Object.keys(custom).filter(id => { const c = custom[id]; return c.reference === true && c.source && c.source.tool === 'fabcheck' && !c.deleted && !seen.has(id); });
  }

  function where(f) {
    const c = f.at || (f.bbox && Fab.bbox.center(f.bbox));
    return c ? ` (${c.x.toFixed(2)}, ${c.y.toFixed(2)} mm${f.layer ? ', ' + f.layer : ''})` : '';
  }

  // Write the groups into the project, except those whose key is in `skip`: they are left as they
  // are in Signoff and still count as found. Returns {created, updated, resolvedNotes, skipped}.
  function send(slug, groups, source, skip) {
    const all = load('projects', {});
    const p = all[slug];
    if (!p) throw new Error('That Signoff project is no longer in this browser.');
    const dirty = load('dirty', {});
    const who = user(), t = now();
    p.custom = p.custom || {}; p.items = p.items || {}; p.comments = p.comments || {};
    const seen = new Set(groups.map(g => groupId(p.id, g)));
    const picked = groups.filter(g => !(skip && skip.has(g.key)));
    let created = 0, updated = 0, resolvedNotes = 0;
    const comment = (item, text) => { const id = uid('c'); p.comments[id] = stamp({ id, item, author: who, at: t, text }, who); };
    // Signoff names the revision a run is tagged as; Fabcheck names the package it checked.
    const on = source.label;
    for (const g of picked) {
      const id = groupId(p.id, g);
      const first = g.list[0];
      const n = g.list.length;
      const text = issueText(g);
      const lines = g.list.slice(0, 25).map(f => `• ${f.title}${where(f)}`);
      if (n > 25) lines.push(`• … ${n - 25} more`);
      const hint = g.note
        ? `Review note${first.author ? ' by ' + first.author : ''} on ${on}, placed on the board in Fabcheck${where(first)}${first.side ? ', ' + first.side + ' side' : ''}.\n\n${first.title.endsWith('…') && first.detail ? first.detail : [first.title, first.detail].filter(Boolean).join('\n')}`
        : `${n} ${g.severity === 'error' ? 'error' : 'warning'}${n === 1 ? '' : 's'} from Fabcheck check "${g.check}" on ${on}${source.sha ? ' (SHA-256 ' + source.sha.slice(0, 12) + '…)' : ''}${source.profileName ? ', fab profile "' + source.profileName + '"' : ''}` +
          (g.waived ? `, waived in Fabcheck (${reasonsOf(g.rules)}). Kept for reference: not an issue, and not counted` : '') +
          `.\n${first.detail || ''}\n\n${lines.join('\n')}`;
      const refs = [...new Set(g.list.flatMap(f => f.refs || []))].slice(0, 40).join(', ');
      const severity = g.severity === 'error' ? 'major' : 'minor';
      const existing = p.custom[id];
      p.custom[id] = stamp(Object.assign({}, existing || { id, createdAt: t }, { id, checklist: 'fab', section: sectionFor(first), text, hint, severity, deleted: false, ...(g.waived ? { reference: true } : {}), source: {
        tool: 'fabcheck', check: g.check, gone: false, run: source.run || null,
        // Up to 50 clickable locations per check (contract: docs/fabcheck-link.md); the rest stay in the hint.
        locations: g.list.filter(f => f.at || f.bbox).slice(0, 50).map(f => { const c = f.at || Fab.bbox.center(f.bbox); return { x: +c.x.toFixed(4), y: +c.y.toFixed(4), layer: f.layer || null, label: f.title }; }),
      } }), who);
      const prev = p.items[id] || {};
      if (g.waived) {
        // A reference row: always waived, never an open issue (Signoff counts it nowhere).
        p.items[id] = stamp(Object.assign({}, prev, { status: 'issue', severity, resolution: 'waived', ref: refs || prev.ref || '', text, checklist: 'fab' }), who);
        comment(id, `${!existing || existing.deleted ? 'Waived in Fabcheck' : 'Still waived in Fabcheck'} on ${on}: ${n} finding${n === 1 ? '' : 's'} (${reasonsOf(g.rules)}). Kept for reference.`);
        if (!existing || existing.deleted) created++; else updated++;
      } else if (!existing || existing.deleted) {
        p.items[id] = stamp(Object.assign({}, prev, { status: 'issue', severity, resolution: '', ref: refs, text, checklist: 'fab' }), who);
        comment(id, g.note ? `Review note from Fabcheck on ${on}.` : `Raised by Fabcheck from ${on}: ${n} finding${n === 1 ? '' : 's'}.`);
        created++;
      } else {
        // Keep the reviewer's status and resolution; refresh the wording and say what the new run saw.
        p.items[id] = stamp(Object.assign({}, prev, { text, ref: refs || prev.ref, checklist: 'fab' }), who);
        comment(id, g.note ? `Review note sent again from Fabcheck on ${on}.` : `Fabcheck re-run on ${on}: still ${n} finding${n === 1 ? '' : 's'}.`);
        updated++;
      }
    }
    // Issues Fabcheck raised before that this run no longer finds open. When the check's findings
    // are waived in Fabcheck now, the note says so (the reviewer decides whether to mark it Waived).
    const waivedNow = new Map(groups.filter(g => g.waived).map(g => [g.check, g]));
    for (const id of goneIds(p, seen)) {
      const c = p.custom[id], wg = waivedNow.get(c.source.check);
      comment(id, c.source.check === 'note' ? `Review note no longer in Fabcheck's run on ${on} (deleted). Mark it Fixed if that is expected.`
        : wg ? `Fabcheck re-run on ${on}: no longer open there; ${wg.list.length} finding${wg.list.length === 1 ? ' is' : 's are'} waived in Fabcheck (${reasonsOf(wg.rules)}). Mark it Waived if that is expected.`
        : `Fabcheck re-run on ${on}: no longer found. Mark it Fixed if that is expected.`);
      p.custom[id] = stamp(Object.assign({}, c, { source: Object.assign({}, c.source, { gone: true }) }), who);
      resolvedNotes++;
    }
    // Reference rows whose findings are no longer waived: removed (tombstoned; Signoff merges deletions).
    let dropped = 0;
    for (const id of droppedRefs(p, seen)) { p.custom[id] = stamp(Object.assign({}, p.custom[id], { deleted: true }), who); dropped++; }
    all[slug] = p;
    dirty[p.id] = t;
    save('projects', all);
    save('dirty', dirty);
    // Open the project's Findings page next time Signoff loads.
    const ui = load('ui', {}) || {};
    save('ui', Object.assign(ui, { slug, view: 'findings' }));
    return { created, updated, resolvedNotes, dropped, skipped: groups.length - picked.length, projectId: p.id, slug, name: (p.meta || {}).name };
  }

  // Show a project's Findings in Signoff EE, in this tab (the suite's tools hand over in one tab;
  // Fabcheck keeps its runs, so Back returns to them).
  function openFindings(projectId) {
    const all = load('projects', {});
    const slug = Object.keys(all).find(k => all[k].id === projectId);
    if (!slug) return false;
    // Opened from Signoff EE ("Open in Fabcheck"): go back to the tab it came from, and Signoff
    // puts back the open check and the scroll (fabReturn, ee_design_review app.js). Otherwise
    // (after a Send, say) the board's Findings tab.
    const ret = load('fabReturn', null);
    const view = ret && ret.project === projectId && typeof ret.view === 'string' && ret.view ? ret.view : 'findings';
    if (view === 'findings') try { localStorage.removeItem(NS + 'fabReturn'); } catch (e) { /* storage blocked */ }
    save('ui', Object.assign(load('ui', {}) || {}, { slug, view, home: false }));
    location.href = Fab.demoHref('../ee_design_review/index.html');
    return true;
  }
  function projectById(id) { const all = load('projects', {}); const slug = Object.keys(all).find(k => all[k].id === id); return slug ? Object.assign({ slug }, all[slug]) : null; }

  Fab.signoff = { projects, plan, preview, send, sectionFor, stableId, openFindings, projectById };
})(window.Fab);
