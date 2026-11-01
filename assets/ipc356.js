// IPC-D-356(A) netlist parser: one record per pad (317 = through-hole, 327 = SMD) with net, refdes, pin,
// access side and position. Units are calibrated against the Gerbers, because "UNITS CUST" without a
// number is ambiguous between exporters.
(function (Fab) {
  'use strict';

  function parse(text) {
    const recs = [];
    let units = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('P  UNITS')) { units = line.slice(8).trim(); continue; }
      const op = line.slice(0, 3);
      if (op !== '317' && op !== '327' && op !== '017' && op !== '027') continue;
      const xy = /X([ +-])(\d{6})Y([ +-])(\d{6})/.exec(line);
      if (!xy) continue;
      const acc = /A(\d\d)X/.exec(line);
      const hole = /D(\d{4})([PU])/.exec(line.slice(30, 45));
      const rot = /R(\d{3})/.exec(line.slice(xy.index + 16));
      const size = /X(\d{4})(?:Y(\d{4}))?/.exec(line.slice(xy.index + 16));
      recs.push({
        through: op[1] === '1', net: line.slice(3, 17).trim(), des: line.slice(20, 26).trim(), pin: line.slice(27, 31).trim(),
        xr: (xy[1] === '-' ? -1 : 1) * +xy[2], yr: (xy[3] === '-' ? -1 : 1) * +xy[4], access: acc ? +acc[1] : 0,
        holeR: hole ? +hole[1] : 0, plated: hole ? hole[2] === 'P' : null,
        wr: size ? +size[1] : 0, hr: size && size[2] ? +size[2] : size ? +size[1] : 0, rot: rot ? +rot[1] : 0,
      });
    }
    return { units, recs };
  }

  // Pick the unit scale (mm per count) that puts the most pads on copper or plated holes.
  function calibrate(net, pkg) {
    const C = Fab.checks;
    const cands = [['0.0001 in', 0.00254], ['0.001 mm', 0.001], ['0.001 in', 0.0254], ['0.01 mm', 0.01]];
    const sample = net.recs.filter(r => r.des !== 'VIA').filter((r, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0);
    const holes = new C.__HitIndex(pkg.hits.filter(h => h.plated));
    let best = null;
    for (const [label, k] of cands) {
      let hit = 0;
      for (const r of sample) {
        const x = r.xr * k, y = r.yr * k;
        const lay = r.access === 1 ? pkg.layers.top : r.access > 1 ? pkg.layers.bottom : null;
        if (holes.near(x, y, 0.05) || (lay && lay.polarity !== 'negative' && C.primsAt(lay, x, y).length) || (!lay && pkg.layers.top && C.primsAt(pkg.layers.top, x, y).length)) hit++;
      }
      if (!best || hit > best.hit) best = { label, k, hit, of: sample.length };
    }
    return best;
  }

  // Every netlist point (pads and vias) in board mm with its net, or null when there is no netlist
  // or it doesn't line up with the Gerbers. access 0 = through all layers, 1 = top, more = bottom.
  function points(pkg) {
    if (pkg._netPoints !== undefined) return pkg._netPoints;
    let out = null;
    if (pkg.ipc356) {
      const net = parse(pkg.ipc356.text());
      const cal = net.recs.length ? calibrate(net, pkg) : null;
      if (cal && cal.hit >= cal.of * 0.5) out = net.recs.filter(r => r.net && r.net !== 'N/C').map(r => ({ x: r.xr * cal.k, y: r.yr * cal.k, net: r.net, side: r.access === 0 ? null : r.access === 1 ? 'top' : 'bottom' }));
    }
    return (pkg._netPoints = out);
  }

  Fab.ipc356 = { parse, calibrate, points };
})(window.Fab);
