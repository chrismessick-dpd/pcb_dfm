// ODB++ component layers (steps/<step>/layers/comp_+_top|bot/components) from an extracted odb/ tree.
// Gives each placed component its part name, mount type, .no_pop flag and pin (toeprint) positions.
(function (Fab) {
  'use strict';

  function parseComponents(text, side) {
    const comps = [];
    const attrNames = {};
    let units = 1, cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^UNITS\s*=\s*INCH/i.test(line)) { units = 25.4; continue; }
      const an = /^@(\d+)\s+(\S+)/.exec(line);
      if (an) { attrNames[an[1]] = an[2]; continue; }
      if (line.startsWith('CMP ')) {
        const [body, attrs] = line.split(';');
        const f = body.trim().split(/\s+/);
        // CMP <pkg_ref> <x> <y> <rot> <mirror> <comp_name> <part_name...>
        cur = {
          side, des: f[6], part: f.slice(7).join(' '), x: +f[2] * units, y: +f[3] * units, rot: +f[4],
          attrs: {}, pins: [],
        };
        for (const a of (attrs || '').split(',')) {
          const m = /^\s*(\d+)(?:=(.*))?$/.exec(a);
          if (!m) continue;
          const name = attrNames[m[1]] || '@' + m[1];
          cur.attrs[name] = m[2] == null ? true : m[2];
        }
        cur.noPop = !!cur.attrs['.no_pop'];
        // .comp_mount_type: 1 = SMT, 2 = through-hole, 3 = pressfit (ODB++ enum, 0 = other)
        cur.mount = { 1: 'smt', 2: 'tht', 3: 'pressfit' }[cur.attrs['.comp_mount_type']] || 'other';
        comps.push(cur);
        continue;
      }
      if (cur && (line.startsWith('TOP ') || line.startsWith('TOR '))) {
        const f = line.split(/\s+/);
        cur.pins.push({ n: +f[1], x: +f[2] * units, y: +f[3] * units, name: f[8] || f[1] });
      }
    }
    return comps;
  }

  // Find component files among the package files. Returns {comps, source} or null.
  function fromFiles(files) {
    const hits = files.filter(f => /\/steps\/[^/]+\/layers\/comp_\+_(top|bot)\/components(\.z)?$/i.test(f.path));
    if (!hits.length) return null;
    const comps = [];
    for (const f of hits) {
      if (/\.z$/i.test(f.path)) continue; // compressed variant: not handled yet
      const side = /comp_\+_bot/i.test(f.path) ? 'bottom' : 'top';
      comps.push(...parseComponents(f.text(), side));
    }
    const root = hits[0].path.replace(/\/steps\/.*$/i, '');
    return { comps, root };
  }

  Fab.odb = { parseComponents, fromFiles };
})(window.Fab);
