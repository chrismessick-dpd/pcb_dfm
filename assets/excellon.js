// Excellon NC drill parser -> { tools, hits, slots } in mm.
// Handles METRIC/INCH, LZ/TZ zero suppression, Altium ;FILE_FORMAT and ;TYPE=PLATED comments,
// G85 slots and routed slots (G00 … M15 G01 … M16).
(function (Fab) {
  'use strict';

  function parse(text, name) {
    const res = { name, kind: 'excellon', tools: {}, hits: [], slots: [], units: null, zeros: null, format: null, warnings: [], platedHint: null };
    const lines = text.split(/\r?\n/);
    let u = 1, zeros = 'LZ', fi = null, fd = null, inHeader = false, plating = null;
    let tool = null, x = 0, y = 0, rout = false, toolDown = false, incremental = false;
    if (/npth|non.?plated/i.test(name)) res.platedHint = false;
    else if (/(^|[^n])pth|plated/i.test(name)) res.platedHint = true;

    function num(s, isX) {
      if (s == null || s === '') return null;
      let v;
      if (s.indexOf('.') >= 0) v = parseFloat(s);
      else {
        let sign = 1;
        if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1; s = s.slice(1); }
        const I = fi != null ? fi : (u === 1 ? 3 : 2), D = fd != null ? fd : (u === 1 ? 3 : 4);
        if (zeros === 'LZ') { while (s.length < I + D) s += '0'; } // leading zeros kept, trailing suppressed
        v = sign * parseInt(s, 10) / Math.pow(10, D);
      }
      return v * u;
    }

    function coords(line) {
      const mx = /X([+-]?[\d.]+)/.exec(line), my = /Y([+-]?[\d.]+)/.exec(line);
      let nx = mx ? num(mx[1], true) : null, ny = my ? num(my[1], false) : null;
      if (incremental) { nx = nx != null ? x + nx : x; ny = ny != null ? y + ny : y; }
      else { if (nx == null) nx = x; if (ny == null) ny = y; }
      return [nx, ny];
    }

    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] === ';') {
        const ff = /FILE_FORMAT\s*=\s*(\d+):(\d+)/i.exec(line);
        if (ff) { fi = +ff[1]; fd = +ff[2]; res.format = `${fi}:${fd}`; }
        const ty = /TYPE\s*=\s*(NON_PLATED|PLATED|NPTH|PTH)/i.exec(line);
        if (ty) plating = !/NON|NPTH/i.test(ty[1]);
        const x2 = /#@!\s*TF\.FileFunction,(\w+)/.exec(line);
        if (x2) res.platedHint = !/NonPlated/i.test(x2[1]);
        continue;
      }
      if (line === 'M48') { inHeader = true; continue; }
      if (line === '%' || line === 'M95') { inHeader = false; continue; }
      const unit = /^(METRIC|INCH)(?:,(LZ|TZ))?(?:,(0+)\.(0+))?/.exec(line);
      if (unit) {
        u = unit[1] === 'INCH' ? 25.4 : 1; res.units = unit[1] === 'INCH' ? 'inch' : 'mm';
        if (unit[2]) zeros = unit[2];
        if (unit[3]) { fi = unit[3].length; fd = unit[4].length; res.format = `${fi}:${fd}`; }
        continue;
      }
      if (line === 'M71') { u = 1; res.units = 'mm'; continue; }
      if (line === 'M72') { u = 25.4; res.units = 'inch'; continue; }
      const tdef = /^T(\d+)(?:[FSBH][\d.]*)*C([\d.]+)/.exec(line);
      if (tdef && (inHeader || /C/.test(line))) {
        const t = +tdef[1];
        res.tools[t] = { t, dia: parseFloat(tdef[2]) * u, plated: plating != null ? plating : res.platedHint, hits: 0, slots: 0 };
        continue;
      }
      if (inHeader) continue;
      if (/^G90/.test(line)) { incremental = false; continue; }
      if (/^G91/.test(line)) { incremental = true; continue; }
      if (/^G05|^G81/.test(line)) { rout = false; continue; }
      if (/^T(\d+)$/.test(line) || /^T(\d+)[^C]*$/.test(line) && !/[XY]/.test(line)) {
        const t = parseInt(line.slice(1), 10);
        tool = t === 0 ? null : (res.tools[t] || (res.tools[t] = { t, dia: null, plated: res.platedHint, hits: 0, slots: 0 }));
        continue;
      }
      if (line === 'M15') { toolDown = true; continue; }
      if (line === 'M16' || line === 'M17') { toolDown = false; continue; }
      if (line === 'M30' || line === 'M00') continue;
      if (/^G00/.test(line)) { rout = true; [x, y] = coords(line); continue; }
      if (/^G0[123]/.test(line)) {
        const [nx, ny] = coords(line);
        if (toolDown && tool) { res.slots.push({ x1: x, y1: y, x2: nx, y2: ny, tool: tool.t }); tool.slots++; }
        x = nx; y = ny;
        if (/^G0[23]/.test(line)) res.warnings.push('Arc rout moves approximated as straight slots');
        continue;
      }
      const g85 = /^(.*)G85(.*)$/.exec(line);
      if (g85) {
        const [x1, y1] = coords(g85[1]); x = x1; y = y1;
        const [x2, y2] = coords(g85[2]);
        if (tool) { res.slots.push({ x1, y1, x2, y2, tool: tool.t }); tool.slots++; }
        x = x2; y = y2;
        continue;
      }
      if (/^[XY]/.test(line)) {
        const [nx, ny] = coords(line);
        x = nx; y = ny;
        if (rout && toolDown) continue;
        if (tool) { res.hits.push({ x, y, tool: tool.t }); tool.hits++; }
        continue;
      }
    }
    res.zeros = zeros;
    for (const h of res.hits) { const t = res.tools[h.tool]; h.dia = t.dia; h.plated = t.plated !== false; }
    for (const s of res.slots) { const t = res.tools[s.tool]; s.dia = t.dia; s.plated = t.plated !== false; }
    res.bbox = Fab.bbox.empty();
    for (const h of res.hits) Fab.bbox.addPt(res.bbox, h.x, h.y);
    for (const s of res.slots) { Fab.bbox.addPt(res.bbox, s.x1, s.y1); Fab.bbox.addPt(res.bbox, s.x2, s.y2); }
    return res;
  }

  // Altium .DRR report -> [{tool, dia, count, type, plated}]
  function parseDrr(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^T(\d+)\s+([\d.]+)mm.*?\s(Round|Slot|Square)\s+(\d+)\s+(PTH|NPTH)/.exec(line.trim());
      if (m) rows.push({ tool: +m[1], dia: +m[2], type: m[3], count: +m[4], plated: m[5] === 'PTH' });
    }
    return rows;
  }

  Fab.excellon = { parse, parseDrr };
})(window.Fab);
