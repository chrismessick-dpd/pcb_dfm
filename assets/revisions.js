// Revision compare: what changed between a baseline package (or a BOM on its own) and the current one.
(function (Fab) {
  'use strict';
  const norm = s => String(s || '').trim().toLowerCase();

  function bomMap(pkg) {
    const m = new Map();
    if (pkg.bom) for (const l of pkg.bom.lines) for (const d of l.des) if (!m.has(d)) m.set(d, l);
    return m;
  }

  function bomDiff(a, b) {
    const ma = bomMap(a), mb = bomMap(b);
    const added = [], removed = [], changed = [];
    for (const [d, lb] of mb) {
      const la = ma.get(d);
      if (!la) { added.push({ des: d, line: lb }); continue; }
      const fields = [];
      for (const [k, label] of [['mpn', 'MPN'], ['mfr', 'Manufacturer'], ['name', 'Name'], ['value', 'Value'], ['description', 'Description'], ['footprint', 'Footprint']]) {
        if (norm(la[k]) !== norm(lb[k]) && (la[k] || lb[k])) fields.push({ field: label, from: la[k], to: lb[k] });
      }
      if (!!la.dnp !== !!lb.dnp) fields.push({ field: 'DNP', from: la.dnp ? 'yes' : 'no', to: lb.dnp ? 'yes' : 'no' });
      if (fields.length) changed.push({ des: d, fields, line: lb });
    }
    for (const [d, la] of ma) if (!mb.has(d)) removed.push({ des: d, line: la });
    // Group changed designators that share the same change, as a reviewer would read them.
    const groups = new Map();
    for (const c of changed) {
      const key = c.fields.map(f => f.field + ':' + f.from + '→' + f.to).join('|');
      if (!groups.has(key)) groups.set(key, { fields: c.fields, des: [] });
      groups.get(key).des.push(c.des);
    }
    const sortD = l => l.sort((x, y) => Fab.natCmp(x.des || x, y.des || y));
    return { added: sortD(added), removed: sortD(removed), changed: [...groups.values()].map(g => (sortD(g.des), g)) };
  }

  function pnpDiff(a, b) {
    if (!a.pnp || !b.pnp) return null;
    const ma = new Map(a.pnp.parts.map(p => [p.des, p])), mb = new Map(b.pnp.parts.map(p => [p.des, p]));
    const moved = [], added = [], removed = [];
    for (const [d, pb] of mb) {
      const pa = ma.get(d);
      if (!pa) { added.push(pb); continue; }
      const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const rot = ((pb.rot - pa.rot) % 360 + 360) % 360;
      if (dist > 0.005 || rot > 0.01 || pa.side !== pb.side || norm(pa.footprint) !== norm(pb.footprint))
        moved.push({ des: d, dist, rot, side: pa.side !== pb.side ? pa.side + '→' + pb.side : null, footprint: norm(pa.footprint) !== norm(pb.footprint) ? pa.footprint + ' → ' + pb.footprint : null, at: { x: pb.gx != null ? pb.gx : pb.x, y: pb.gy != null ? pb.gy : pb.y } });
    }
    for (const d of ma.keys()) if (!mb.has(d)) removed.push(ma.get(d));
    return { moved: moved.sort((x, y) => Fab.natCmp(x.des, y.des)), added, removed };
  }

  // Geometry signature per primitive, rounded to 1 µm, so re-ordered or re-numbered files compare equal.
  function primKey(p) {
    const r = v => Math.round(v * 1000);
    const ap = p.ap ? p.ap.tpl + ':' + r(p.ap.w) + 'x' + r(p.ap.h) : '';
    if (p.k === 'F') return `F${p.dark ? '' : 'C'}|${r(p.x)},${r(p.y)}|${ap}`;
    if (p.k === 'L' || p.k === 'A') {
      let a = [r(p.x1), r(p.y1)], b = [r(p.x2), r(p.y2)];
      if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
      return `${p.k}${p.dark ? '' : 'C'}|${a}|${b}|${ap}${p.k === 'A' ? '|' + r(p.cx) + ',' + r(p.cy) : ''}`;
    }
    return `R${p.dark ? '' : 'C'}|` + p.contours.map(c => c.length / 2 + ':' + r(c[0]) + ',' + r(c[1])).join(';');
  }

  function layerKey(f) {
    const c = f.cls;
    return [c.fn, c.side || '', c.fn === 'copper' ? f.layer.cuOrder || c.cu || '' : '', c.fn === 'mech' ? c.mech || '' : ''].join(':');
  }

  function gerberDiff(a, b) {
    const la = new Map(a.set.files.map(f => [layerKey(f), f])), lb = new Map(b.set.files.map(f => [layerKey(f), f]));
    const rows = [];
    for (const [k, fb] of lb) {
      const fa = la.get(k);
      if (!fa) { rows.push({ layer: fb.name, status: 'added' }); continue; }
      const count = prims => { const m = new Map(); for (const p of prims) { const s = primKey(p); m.set(s, (m.get(s) || 0) + 1); } return m; };
      const ca = count(fa.layer.prims), cb = count(fb.layer.prims);
      const addedP = [], removedP = [];
      const byKeyB = new Map(); for (const p of fb.layer.prims) { const s = primKey(p); if (!byKeyB.has(s)) byKeyB.set(s, p); }
      const byKeyA = new Map(); for (const p of fa.layer.prims) { const s = primKey(p); if (!byKeyA.has(s)) byKeyA.set(s, p); }
      for (const [s, n] of cb) if ((ca.get(s) || 0) < n) addedP.push(byKeyB.get(s));
      for (const [s, n] of ca) if ((cb.get(s) || 0) < n) removedP.push(byKeyA.get(s));
      const bb = Fab.bbox.empty();
      for (const p of addedP.concat(removedP)) { const q = p.bbox; Fab.bbox.addPt(bb, q[0], q[1]); Fab.bbox.addPt(bb, q[2], q[3]); }
      rows.push({ layer: fb.name, base: fa.name, status: addedP.length || removedP.length ? 'changed' : 'same', added: addedP.length, removed: removedP.length, bbox: Fab.bbox.valid(bb) ? bb : null, layerRef: fb.layer });
    }
    for (const [k, fa] of la) if (!lb.has(k)) rows.push({ layer: fa.name, status: 'removed' });
    return rows;
  }

  function drillDiff(a, b) {
    const key = h => `${h.plated ? 'P' : 'N'}${h.dia}@${Math.round(h.x * 1000)},${Math.round(h.y * 1000)}`;
    const sa = new Set(a.hits.map(key)), sb = new Set(b.hits.map(key));
    return { added: b.hits.filter(h => !sa.has(key(h))), removed: a.hits.filter(h => !sb.has(key(h))) };
  }

  function compare(a, b) {
    return {
      bom: a.bom && b.bom ? bomDiff(a, b) : null,
      pnp: pnpDiff(a, b),
      gerber: a.set && b.set && a.set.files.length && b.set.files.length ? gerberDiff(a, b) : null,
      drill: a.hits && b.hits && (a.hits.length || b.hits.length) ? drillDiff(a, b) : null,
    };
  }

  Fab.revisions = { compare, bomDiff, pnpDiff, gerberDiff, drillDiff };
})(window.Fab);
