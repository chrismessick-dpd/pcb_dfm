// Pick-and-place and BOM parsers.
(function (Fab) {
  'use strict';

  function unq(s) {
    s = (s || '').trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).replace(/""/g, '"');
    return s.trim();
  }

  function csvRows(text, delim) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  const PNP_COLS = {
    designator: /^(designator|refdes|ref|reference)$/i,
    comment: /^(comment|value|val)$/i,
    layer: /^(layer|side|tb)$/i,
    footprint: /^(footprint|package|pattern)$/i,
    x: /^(cent(?:er|re)-x|mid ?x|posx|x|center x|ref-x)(\(.*\))?$/i,
    y: /^(cent(?:er|re)-y|mid ?y|posy|y|center y|ref-y)(\(.*\))?$/i,
    rotation: /^(rotation|rot|angle)$/i,
    description: /^description$/i,
  };

  function mapCols(header) {
    const idx = {};
    header.forEach((h, i) => {
      const k = h.trim().replace(/\s+/g, ' ');
      for (const [key, re] of Object.entries(PNP_COLS)) if (idx[key] == null && re.test(k)) idx[key] = i;
    });
    return idx;
  }

  function parsePnp(text, name) {
    const res = { name, kind: 'pnp', parts: [], units: 'mm', warnings: [], meta: {} };
    const lines = text.split(/\r?\n/);
    const unitLine = lines.find(l => /Units used:/i.test(l));
    if (unitLine) res.units = /mil/i.test(unitLine) ? 'mil' : /inch/i.test(unitLine) ? 'inch' : 'mm';
    for (const key of ['Date', 'Time', 'Revision', 'Variant']) {
      const l = lines.find(s => new RegExp('^' + key + ':', 'i').test(s.trim()));
      if (l) res.meta[key.toLowerCase()] = l.split(':').slice(1).join(':').trim();
    }
    const hi = lines.findIndex(l => /designator/i.test(l) && /(center|mid|ref)[- ]?x|posx/i.test(l));
    if (hi < 0) { res.warnings.push('No header row with Designator / Center-X found'); return res; }
    const header = lines[hi];
    let rows, cols;
    if (/","|^"/.test(header) || (header.split(',').length > 4 && header.indexOf(',') >= 0)) {
      rows = csvRows(lines.slice(hi).join('\n'), ',');
      cols = mapCols(rows[0]);
      rows = rows.slice(1);
    } else {
      // Fixed-width Altium text: slice by header column offsets (fields may contain lone quotes).
      const starts = [];
      const re = /\S+/g; let m;
      while ((m = re.exec(header))) starts.push(m.index);
      const names = starts.map((s, i) => header.slice(s, starts[i + 1]).trim());
      cols = mapCols(names);
      rows = lines.slice(hi + 1).filter(l => l.trim()).map(l => starts.map((s, i) => l.slice(s, starts[i + 1] != null ? starts[i + 1] : undefined)));
    }
    const hx = header.match(/\((mil|mm|inch|in)\)/i);
    if (hx) res.units = hx[1].toLowerCase() === 'mm' ? 'mm' : hx[1].toLowerCase() === 'mil' ? 'mil' : 'inch';
    const k = res.units === 'mil' ? 0.0254 : res.units === 'inch' ? 25.4 : 1;
    for (const r of rows) {
      const get = key => cols[key] != null ? unq(r[cols[key]]) : '';
      const des = get('designator');
      if (!des) continue;
      const lay = get('layer');
      const p = {
        des, comment: get('comment'), footprint: get('footprint'), description: get('description'),
        side: /^(b|bot|bottom|bottomlayer)$/i.test(lay) ? 'bottom' : 'top',
        layerRaw: lay,
        x: parseFloat(get('x').replace(/[^\d.+-]/g, '')) * k,
        y: parseFloat(get('y').replace(/[^\d.+-]/g, '')) * k,
        rot: parseFloat(get('rotation')) || 0,
      };
      if (!isFinite(p.x) || !isFinite(p.y)) { res.warnings.push('Unreadable coordinates for ' + des); continue; }
      res.parts.push(p);
    }
    return res;
  }

  // ---- BOM ----
  const BOM_COLS = {
    designator: /^(designator|designators|refdes|reference|references|ref des)$/i,
    qty: /^(quantity|qty|count)$/i,
    name: /^(name|comment|libref|part|part name)$/i,
    value: /^value$/i,
    description: /^description$/i,
    footprint: /^(footprint|package|pcb footprint)$/i,
    mfr: /^(manufacturer 1|manufacturer|mfr|mfg|manufacturer name)$/i,
    mpn: /^(manufacturer part number 1|manufacturer part number|mpn|mfr part ?#?|mfr\.? p\/?n|part number|mfg part number)$/i,
    mfr2: /^manufacturer 2$/i,
    mpn2: /^manufacturer part number 2$/i,
    lifecycle: /^(manufacturer lifecycle 1|lifecycle|lifecycle status|part status)$/i,
    revStatus: /^revision status$/i,
    supplier: /^(supplier 1|supplier)$/i,
    spn: /^(supplier part number 1|supplier part number)$/i,
    dnp: /^(dnp|do not place|fitted|not fitted|populate|dni|variant)$/i,
  };

  function expandDesignators(s) {
    const out = [];
    for (let tok of String(s || '').split(/[,;\s]+/)) {
      tok = tok.trim();
      if (!tok) continue;
      const m = /^([A-Za-z_]+)(\d+)-(?:([A-Za-z_]+))?(\d+)$/.exec(tok);
      if (m && (!m[3] || m[3] === m[1]) && +m[4] >= +m[2] && +m[4] - +m[2] < 1000) {
        for (let i = +m[2]; i <= +m[4]; i++) out.push(m[1] + i);
      } else out.push(tok);
    }
    return out;
  }

  // rows: array of arrays (one sheet). Returns parsed BOM or null if no Designator header.
  function bomFromRows(rows, name, sheet) {
    const hi = rows.findIndex(r => r && r.some(c => BOM_COLS.designator.test(String(c == null ? '' : c).trim())));
    if (hi < 0) return null;
    const header = rows[hi].map(c => String(c == null ? '' : c).trim());
    const idx = {};
    header.forEach((h, i) => { for (const [k, re] of Object.entries(BOM_COLS)) if (idx[k] == null && re.test(h)) idx[k] = i; });
    const lines = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => c == null || String(c).trim() === '')) continue;
      const get = k => idx[k] != null && row[idx[k]] != null ? String(row[idx[k]]).trim() : '';
      const des = expandDesignators(get('designator'));
      const line = {
        row: r + 1, des, qtyRaw: get('qty'), qty: get('qty') === '' ? null : Number(get('qty')),
        name: get('name'), value: get('value'), description: get('description'), footprint: get('footprint'),
        mfr: get('mfr'), mpn: get('mpn'), mfr2: get('mfr2'), mpn2: get('mpn2'), lifecycle: get('lifecycle'),
        revStatus: get('revStatus'), supplier: get('supplier'), spn: get('spn'), dnpRaw: get('dnp'),
      };
      const d = line.dnpRaw.toLowerCase();
      const dnpHeader = idx.dnp != null ? header[idx.dnp].toLowerCase() : '';
      line.dnp = dnpHeader === 'fitted' ? /not|no|false|0/.test(d) : /^(y|yes|true|1|dnp|dni|not fitted|x)$/.test(d);
      if (!des.length && !line.mpn && !line.name) continue;
      lines.push(line);
    }
    return { name, kind: 'bom', sheet, header, cols: idx, lines, hasMfr2: idx.mfr2 != null, warnings: [] };
  }

  function parseBom(file) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS (XLSX) failed to load from the CDN');
    let wb;
    if (/\.csv$|\.txt$/i.test(file.name)) wb = XLSX.read(file.text(), { type: 'string', raw: true });
    else wb = XLSX.read(file.bytes, { type: 'array' });
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
      const bom = bomFromRows(rows, file.name, sn);
      if (bom && bom.lines.length) return bom;
    }
    return null;
  }

  Fab.assembly = { parsePnp, parseBom, expandDesignators, csvRows };
})(window.Fab);
