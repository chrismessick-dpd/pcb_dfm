// Assembly cross-check (PnP ↔ BOM ↔ Gerber) and BOM audit.
(function (Fab) {
  'use strict';
  const C = Fab.checks;
  const F = Fab.finding;
  const G = Fab.geo;

  // ---- size codes ----
  const METRIC2IMP = { '0402': '01005', '0603': '0201', '1005': '0402', '1608': '0603', '2012': '0805', '3216': '1206', '3225': '1210', '4532': '1812', '5025': '2010', '6332': '2512' };
  const IMP = ['01005', '0201', '0402', '0603', '0805', '1206', '1210', '1812', '2010', '2512'];
  const MPN_SIZE = [
    [/^(GRM|GCM|GRT|GJM|GCJ|GQM)(03|15|18|21|31|32)/i, m => ({ '03': '0201', '15': '0402', '18': '0603', '21': '0805', '31': '1206', '32': '1210' })[m[2]]],
    [/^GMC(02|04|10|21|31|32)/i, m => ({ '02': '0201', '04': '0402', '10': '0603', '21': '0805', '31': '1206', '32': '1210' })[m[2]]],
    [/^(RC|CC|AC|RT|RL|CQ|AF)(0201|0402|0603|0805|1206|1210|2010|2512)/i, m => m[2]],
    [/^(ERJ|ERA)-?(1G|2G|2R|3G|3E|6G|6E|8G|8E|14|12)/i, m => ({ '1G': '0201', '2G': '0402', '2R': '0402', '3G': '0603', '3E': '0603', '6G': '0805', '6E': '0805', '8G': '1206', '8E': '1206', '14': '1210', '12': '1812' })[m[2].toUpperCase()]],
    [/^CRCW(0201|0402|0603|0805|1206|1210|2010|2512)/i, m => m[1]],
    [/^C(0402|0603|0805|1206|1210)C/i, m => m[1]],
    // Susumu thin film: the metric size in the part number (RG1608 is an 0603).
    [/^(RG|RR|PRG)(1005|1608|2012|3216|3225|5025)/i, m => METRIC2IMP[m[2]]],
    // Murata ferrites, inductors and NTCs: BLM18, LQM18, NCP15…
    [/^(BLM|LQM|LQG|LQW|LQP|NCP|NFM)(03|15|18|21|31)/i, m => ({ '03': '0201', '15': '0402', '18': '0603', '21': '0805', '31': '1206' })[m[2]]],
    [/^RK73[BHZ](1E|1J|2A|2B)/i, m => ({ '1E': '0402', '1J': '0603', '2A': '0805', '2B': '1206' })[m[1].toUpperCase()]],
    [/^CL(03|05|10|21|31|32)/i, m => ({ '03': '0201', '05': '0402', '10': '0603', '21': '0805', '31': '1206', '32': '1210' })[m[1]]],
  ];
  function footprintSize(fp) {
    if (!fp) return null;
    let m = /(\d{4,5})\((\d{4})\)/.exec(fp);
    if (m && IMP.includes(m[1])) return m[1];
    m = /^(RESC|CAPC|INDC|LEDC|DIOC|RESM|CAPM|FUSC|BEADC)(\d{4})/i.exec(fp);
    if (m) return METRIC2IMP[m[2]] || null;
    m = /(?:^|[^\d])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[^\d]|$)/.exec(fp);
    return m ? m[1] : null;
  }
  function textSizes(desc) {
    const out = new Set();
    if (!desc) return out;
    const d = desc.replace(/\((\d{4})\s*metric\)/ig, (s, mm) => { if (METRIC2IMP[mm]) out.add(METRIC2IMP[mm]); return ' '; });
    for (const m of d.matchAll(/(?:^|[^\d.])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![\d.])(?!\s*metric)/ig)) out.add(m[1]);
    return out;
  }
  function mpnSize(mpn) {
    for (const [re, fn] of MPN_SIZE) { const m = re.exec(mpn || ''); if (m) return fn(m) || null; }
    return null;
  }

  const looksLikeMpn = s => !!s && s.length >= 6 && !/\s/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s);
  const norm = s => String(s || '').trim().toLowerCase();

  const T = { padNear: 2.5, padFar: 8, pairCenter: 0.03, rotGroup: 3, rotOutliers: 1 / 4, valueTol: 0.011, absTolBelow: 10e-12, fpPrefix: 4, shown: 30 };
  const LC_ERROR = /obsolete|end of life|eol|nrnd|not recommended|last time|discontinued/;
  const LC_WARN = /deleted|unknown|preview|new product/;
  const REV_BAD = /deleted|obsolete/i;
  const DECODED = 'Cal-Chip GMC, Yageo CC/RC/RT, Murata GRM/GCM, Samsung CL, KEMET, AVX, TDK, Vishay CRCW, Panasonic ERJ and Stackpole RMCF passives';
  const re = C.pattern;
  const sizeFamilies = () => MPN_SIZE.map(([r]) => re(r).replace(/^\^/, '').replace(/\(\?:?/g, '(').replace(/\(([^)]*)\)\(.*$/, '$1').replace(/\(([^)]*)\).*$/, '$1')).join(', ');

  C.define('Assembly', 'checks/assembly.js', [
    { check: 'origin', name: 'Pick-and-place origin', looks: 'Whether the pick-and-place coordinates land on pads as they are, or only after a shift.',
      sev: { warn: 'the placements line up only with an offset', info: 'they share the Gerber origin' }, uses: ['Pick-and-place X/Y', 'Top and bottom copper pads', 'Drill file extents'],
      rules: () => [`Tries no shift, the board lower-left corner, its negative and the drill lower-left corner; keeps the one that puts the most parts within ${Fab.fmtLen(T.padNear)} of a pad.`],
      example: 'Pick-and-place uses a different origin than the Gerbers' },
    { check: 'placement', name: 'Placements vs pads', looks: 'Parts placed outside the board, on the wrong side, or far from any pad.',
      sev: { error: 'outside the board, or no pads on its side but pads on the other', warn: `no pads on its side within ${Fab.fmtLen(T.padFar)}` }, uses: ['Pick-and-place X/Y, layer', 'Copper pads', 'Board outline'],
      rules: () => [`Looks for a pad within ${Fab.fmtLen(T.padNear)} on the placement side; vias are not pads.`],
      example: 'R12: no pads on bottom, but there are on the other side' },
    { check: 'rotation', name: 'Two-terminal rotation', looks: 'Two-pad parts whose rotation is 90° off from the other parts with the same footprint and side.',
      sev: { warn: 'a part disagrees with the majority of its footprint group', info: 'how many parts were checked' }, uses: ['Pick-and-place rotation, footprint', 'Copper pad pairs'],
      rules: () => [`A pad pair counts when its midpoint is within ${Fab.fmtLen(T.pairCenter)} of the placement and both pads have the same shape.`,
        `Groups of at least ${T.rotGroup} parts; a part is flagged only when at most ${Math.round(T.rotOutliers * 100)}% of its group disagree. Convention-free: no fixed 0° definition.`],
      example: 'C41: rotation 90° is 90° off from its pads' },
    { check: 'bom-pnp', name: 'Pick-and-place vs BOM', looks: 'Designators placed but not on the BOM, and BOM designators with no placement.',
      sev: { error: 'a fitted BOM designator has no placement', warn: 'a placed part has no BOM line', info: 'test points and fiducials without a BOM line, or everything matches' },
      uses: ['BOM designators, DNP', 'Pick-and-place designators'], rules: () => [`Pad-only parts without a BOM line are info, not warnings: designators ${re(C.PAD_ONLY)}, footprints ${re(C.PAD_ONLY_FP)}, or a comment or ODB++ part name such as "Test Point" or "Fiducial".`],
      example: 'U7 is in the BOM but has no placement' },
    { check: 'dnp', name: 'DNP parts placed', looks: 'Parts marked do-not-populate that still appear in the pick-and-place.', sev: { info: 'lists them' },
      uses: ['BOM DNP / Fitted column', 'Pick-and-place'], example: '3 DNP part(s) appear in the pick-and-place' },
    { check: 'footprint', name: 'One footprint per BOM line', looks: 'BOM lines whose designators use different footprints in the pick-and-place.', sev: { warn: 'a line has more than one footprint' },
      uses: ['BOM designators', 'Pick-and-place footprint'], example: 'BOM row 14 (GRM155R71C104KA88D) uses 2 different footprints' },
    { check: 'comment', name: 'Comment vs BOM', looks: "Pick-and-place comments that don't match the BOM line's name, part number or value.", sev: { warn: 'a comment matches none of them' },
      uses: ['Pick-and-place comment', 'BOM name, MPN, value'], rules: () => ['Compared only when the BOM has a name column or the comment looks like a part number (6+ characters, letters and digits, no spaces).',
        'Letters and digits only; the part number without its packaging suffix, or with a library prefix, matches.', 'A comment that states a value for a part number Fabcheck decodes is compared by value instead (BOM audit, check value).'],
      example: 'PnP comment differs from BOM row 22' },
    { check: 'package', name: 'Package size code', looks: 'The size code of the footprint (0402, 0603…) against the description and the size the part number implies.',
      sev: { error: 'the part number is another size than the footprint', warn: 'the description disagrees with the footprint', info: 'how many lines were checked' }, uses: ['Pick-and-place footprint', 'BOM description', 'BOM MPN'],
      rules: () => ['Footprint: IPC names (RESC1005…, converted from metric), "0603(1608)" or a bare size code.', 'Description: a size code, or "(1005 metric)".', 'Part number families with a size field: ' + sizeFamilies() + '.'],
      example: 'Package mismatch on BOM row 9: footprint 0402' },
  ]);

  C.define('BOM', 'checks/assembly.js', [
    { check: 'summary', name: 'BOM summary', looks: 'Lines, designators and columns found.', sev: { info: 'always' }, uses: ['BOM file'], example: 'BOM: 84 lines, 312 designators' },
    { check: 'designator', name: 'Designators present', looks: 'BOM lines with no designators.', sev: { error: 'a line has none' }, uses: ['BOM designator column'], example: 'BOM row 31 has no designators' },
    { check: 'qty', name: 'Quantity vs designators', looks: 'Lines whose quantity differs from their designator count.', sev: { error: 'they differ' }, uses: ['BOM quantity, designators'], example: 'BOM row 5: quantity 4 but 3 designators' },
    { check: 'duplicate', name: 'Duplicate designators', looks: 'A designator on two BOM lines.', sev: { error: 'any duplicate' }, uses: ['BOM designators'], example: 'C12 appears on two BOM rows' },
    { check: 'mpn', name: 'Part numbers present', looks: 'A manufacturer part number column, and a part number on every fitted line.', sev: { error: 'no MPN column, or a fitted line without one' },
      uses: ['BOM MPN column'], rules: () => ['Recognizes "Manufacturer Part Number 1", "MPN", "Mfr Part #" and similar headers.'], example: 'BOM row 40: no manufacturer part number' },
    { check: 'mfr', name: 'Manufacturers present', looks: 'A manufacturer column, and a manufacturer on every fitted line with a part number.', sev: { warn: 'missing column or cell' },
      uses: ['BOM manufacturer column'], example: 'BOM has no Manufacturer column' },
    { check: 'name-mpn', name: 'Name vs part number', looks: 'A Name/Comment cell that holds a different part number than the MPN column.', sev: { warn: 'they differ' },
      uses: ['BOM name, MPN, MPN 2'], rules: () => ['The name counts as a part number when it is 6+ characters, has letters and digits and no spaces.'], example: 'BOM row 12: part name LM3480IM3 ≠ MPN LM3480IM3-5.0' },
    { check: 'lifecycle', name: 'Lifecycle', looks: "Lifecycle and library revision states that put the part's supply at risk.",
      sev: { error: 'obsolete, end of life, NRND or last-time buy', warn: 'deleted, unknown, preview or new, or a deleted/obsolete library revision' }, uses: ['BOM lifecycle column', 'Altium component revision status'],
      rules: () => [`Error when the lifecycle matches: ${LC_ERROR.source.split('|').join(', ')}.`, `Warning when it matches: ${LC_WARN.source.split('|').join(', ')}.`, `Warning when the revision status matches: ${REV_BAD.source.split('|').join(', ')}.`],
      example: 'BOM row 18: TPS62130RGTR lifecycle "NRND"' },
    { check: 'mpn-dup', name: 'One line per part number', looks: 'The same part number on several BOM lines. Assemblers ask for one line per part; lines that disagree on footprint or pad count mean one line has the wrong part number.',
      sev: { error: 'the lines use different footprints or pad counts', warn: 'the lines are split anyway (usually by a different comment)' },
      uses: ['BOM MPN, footprint, comment', 'Pick-and-place footprint, comment', 'ODB++ or IPC-356 pad counts'], example: 'MPN TLV75533PDBVR is on 2 BOM rows with different footprints' },
    { check: 'value', name: 'Value on the board data', looks: "The value written for each part in the pick-and-place (comment, description) and ODB++ (part name), against the value its part number decodes to.",
      sev: { error: 'a part is marked with another value than its part number', info: 'how many parts were compared' },
      uses: ['BOM MPN (decoded offline)', 'Pick-and-place comment and description', 'ODB++ part name'],
      rules: () => ['Decodes ' + DECODED + '.', `Values match within ${+(T.valueTol * 100).toFixed(1)}%.`, 'Size codes, tolerances and ratings are ignored, so "4K7, 0402" reads as 4.7 kΩ; on resistors a bare number is ohms ("680" is 680 Ω).', 'Texts that are the part number itself, or state no value, are skipped.'],
      example: 'BOM row 4: RC0402FR-0710KL is 10 kΩ, but R1 is marked 4.7 kΩ' },
    { check: 'fp-name', name: 'Footprint named for another part', looks: 'A footprint whose name carries a part number other than the BOM line\'s (IC_OPT3001DNPR on a TMP117AIDRVR), a sign it was copied from that part.',
      sev: { warn: 'the footprint names another part' }, uses: ['BOM MPN, footprint', 'Pick-and-place footprint'],
      rules: () => ['Library prefixes (IC_, HRS_, JST_, XTAL_, FP-…) are dropped. A name counts as a part number only with 8+ letters and digits, a letter run followed by 3+ digits, no decimal point, no size code (0402, 2012…), no pin count (-16P) and no package word (QFN, SON, BGA, SOT…, IPC-7351 names, TI designators such as DSG0008A).',
        `It names the same part when it shares ${T.fpPrefix}+ leading letters and digits with the part number, or holds the part number with X as a wildcard (a family footprint such as LTST-C19X for LTST-C190).`],
      example: 'U1: footprint IC_OPT3001DNPR is named for OPT3001DNPR, not TMP117AIDRVR' },
    { check: 'pkg-code', name: 'Package code vs footprint', looks: "The package a TI part number ends in (TPS62162DSGR → DSG, a SON) against the package family its footprint names.",
      sev: { warn: 'the families differ', info: 'how many parts were checked' }, uses: ['BOM MPN, manufacturer', 'Footprint name'],
      rules: () => ['TI orderable part numbers end in a package designator and a reel letter (R or T, optionally Q1). Designators known: ' + Object.keys(Fab.parts.TI_FAMILY).join(', ') + '.', 'QFN and SON count as one family. Footprints named after the part itself are skipped.'],
      example: 'BOM row 26: TPS62162DSGR is a SON (DSG), but its footprint SOT-23-6 is a SOT-23' },
    { check: 'pins', name: 'Pin count vs pads', looks: 'A pin count stated in a description ("6-SON", "64LQFP", "SOT-89-5", "8 pins") against the pads the part has on the board.',
      sev: { warn: 'they differ', info: 'how many parts were checked' }, uses: ['BOM and pick-and-place description', 'ODB++ component pins or IPC-356 pads'],
      rules: () => ['One extra pad is allowed (an exposed thermal pad).', `Connectors are skipped (designators ${re(C.CONNECTOR_DES)}, or a description naming a connector, header or socket): shells and pegs add pads.`],
      example: 'U4: 8 pads, but the description says 6-SON' },
    { check: 'single-source', name: 'Single-source lines', looks: 'Lines with no approved alternate.', sev: { info: 'lists them' }, uses: ['BOM Manufacturer 2 / MPN 2 columns'], example: '61 of 84 BOM lines are single-source' },
    { check: 'pn-desc', name: 'Part number vs description', looks: 'Passive part numbers decoded offline (value, voltage, dielectric, tolerance) against the description and value columns.',
      sev: { error: 'value or voltage disagrees', warn: 'dielectric or tolerance disagrees', info: 'how many lines were decoded' }, uses: ['BOM MPN, description, value'],
      rules: () => ['Decodes ' + DECODED + '.', `Values match within ${+(T.valueTol * 100).toFixed(1)}%.`, `Below ${T.absTolBelow * 1e12} pF the tolerance letter is absolute (pF), so tolerance is not compared.`],
      example: 'BOM row 7: GRM155R71C104KA88D disagrees with its description' },
    { check: 'mfr-prefix', name: 'Manufacturer vs part-number prefix', looks: 'A part number whose prefix belongs to a different manufacturer than the one listed.', sev: { warn: 'the listed manufacturer does not match' },
      uses: ['BOM MPN, manufacturer'], rules: () => ['Part numbers starting with:'].concat(Fab.parts.PREFIX_MFR.map(([r, names]) => `${re(r)} → ${names[0].replace(/^\w/, c => c.toUpperCase())}`)),
      example: 'BOM row 3: CL05A105KA5NQNC listed as made by Murata' },
    { check: 'value-type', name: 'Value vs part type', looks: 'A Value cell that does not fit the designator class: a resistance on a capacitor, a capacitance on a resistor or diode, ohms on an LED.',
      sev: { warn: 'it does not fit' }, uses: ['BOM value, designators'], rules: () => ['Class from the designator prefix (C, R, D, DS, LED).', 'Capacitance: a number ending in F. Resistance: Ω, ohm, a bare number or R/k/M notation.'],
      example: 'BOM row 26: value "2pF" on a D part' },
    { check: 'encoding', name: 'Lost characters', looks: 'Cells where µ, ± or Ω were lost in export (shown as �).', sev: { info: 'counts them' }, uses: ['BOM value, description, name'], example: '6 BOM cell(s) contain lost characters (�)' },
  ]);

  // ---- PnP origin alignment ----
  function padIndex(pkg, side, prof) {
    const layer = side === 'top' ? pkg.layers.top : pkg.layers.bottom;
    const pads = [];
    const viaHits = new C.__HitIndex(pkg.hits.filter(h => h.plated && h.dia <= prof.viaMaxDrill));
    if (layer && layer.polarity !== 'negative') for (const p of layer.prims) {
      if (p.k !== 'F' || !p.dark) continue;
      const fn = p.ap.fn || '';
      if (/ViaPad/i.test(fn)) continue;
      if (!fn && viaHits.near(p.x, p.y, 0.01)) continue;
      pads.push({ x: p.x, y: p.y, key: C.flashKey(p.ap), w: p.ap.w, h: p.ap.h, prim: p });
    }
    for (const h of pkg.hits) if (h.plated && h.dia > prof.viaMaxDrill) pads.push({ x: h.x, y: h.y, key: 'H' + h.dia, w: h.dia, h: h.dia, tht: true });
    const grid = new G.Grid(2.0);
    for (const p of pads) grid.insert(p, [p.x, p.y, p.x, p.y]);
    return { pads, near(x, y, r) { return [...grid.query([x - r, y - r, x + r, y + r])].filter(p => Math.hypot(p.x - x, p.y - y) <= r); } };
  }

  C.__HitIndex = class {
    constructor(hits) { this.grid = new G.Grid(1.0); for (const h of hits) this.grid.insert(h, [h.x, h.y, h.x, h.y]); }
    near(x, y, r) { for (const h of this.grid.query([x - r, y - r, x + r, y + r])) if (Math.hypot(h.x - x, h.y - y) <= r) return h; return null; }
  };

  function nearest(idx, x, y, r) {
    let best = null, bd = Infinity;
    for (const p of idx.near(x, y, r)) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best ? { pad: best, d: bd } : null;
  }

  function alignPnp(pkg, idx) {
    const parts = pkg.pnp.parts;
    const bb = pkg.boardBBox || [0, 0, 0, 0];
    const cands = [[0, 0, 'none'], [bb[0], bb[1], 'board lower-left'], [-bb[0], -bb[1], 'negative board lower-left']];
    if (pkg.hits.length && Fab.bbox.valid(pkg.drills[0].drill.bbox)) {
      const db = pkg.drills[0].drill.bbox;
      cands.push([db[0], db[1], 'drill lower-left']);
    }
    let best = null;
    for (const [dx, dy, label] of cands) {
      let score = 0;
      for (const p of parts) if (nearest(idx[p.side], p.x + dx, p.y + dy, T.padNear)) score++;
      if (!best || score > best.score) best = { dx, dy, label, score };
    }
    return best;
  }

  function* runCross(pkg, prof, out) {
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'Assembly', check, severity, title, detail }, extra || {})));
    const pnp = pkg.pnp, bom = pkg.bom;
    pkg.assembly = { rows: [] };
    yield 'Pick-and-place origin';
    if (!pnp) return;

    const idx = { top: padIndex(pkg, 'top', prof), bottom: padIndex(pkg, 'bottom', prof) };
    const al = alignPnp(pkg, idx);
    pkg.assembly.offset = al;
    if (al.dx || al.dy) add('origin', 'warn', 'Pick-and-place uses a different origin than the Gerbers',
      `Placements line up when shifted by (${al.dx.toFixed(3)}, ${al.dy.toFixed(3)}) mm (${al.label}). Tell the assembler which origin to use.`);
    else add('origin', 'info', 'Pick-and-place and Gerbers share an origin', `${al.score} of ${pnp.parts.length} placements have pads nearby with no offset. PnP units: ${pnp.units}.`);

    for (const p of pnp.parts) { p.gx = p.x + al.dx; p.gy = p.y + al.dy; }

    // BOM map
    const bomDes = new Map();
    if (bom) for (const line of bom.lines) for (const d of line.des) if (!bomDes.has(d)) bomDes.set(d, line);
    const placed = new Map(pnp.parts.map(p => [p.des, p]));

    // Placement geometry
    yield 'Placements vs pads';
    const outline = pkg.layers.outline;
    for (const p of pnp.parts) {
      const row = { part: p, line: bomDes.get(p.des) || null, issues: [] };
      pkg.assembly.rows.push(row);
      const at = { x: p.gx, y: p.gy };
      const ex = { at, refs: [p.des], side: p.side };
      if (outline && !outline.board.synthetic && !C.insideBoard(outline, p.gx, p.gy)) {
        row.issues.push('outside board');
        add('placement', 'error', `${p.des} is placed outside the board`, `${p.gx.toFixed(3)}, ${p.gy.toFixed(3)} mm on ${p.side}.`, ex);
        continue;
      }
      const same = nearest(idx[p.side], p.gx, p.gy, T.padNear);
      const other = nearest(idx[p.side === 'top' ? 'bottom' : 'top'], p.gx, p.gy, T.padNear);
      if (!same) {
        const far = nearest(idx[p.side], p.gx, p.gy, T.padFar);
        if (other && !other.pad.tht && !far) {
          row.issues.push('side?');
          add('placement', 'error', `${p.des}: no pads on ${p.side}, but there are on the other side`, `Footprint ${p.footprint}. Check the Layer column in the PnP.`, ex);
        } else if (!far) {
          row.issues.push('no pads');
          add('placement', 'warn', `${p.des}: no ${p.side} pads within ${Fab.fmtLen(T.padFar)}`, `Footprint ${p.footprint}. Wrong origin, side or a part without copper?`, ex);
        }
      }
      // Two-terminal pad pair centered on the placement (used for the rotation check).
      const cand = idx[p.side].near(p.gx, p.gy, 3).filter(q => !q.tht);
      let pair = null;
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (Math.hypot(mx - p.gx, my - p.gy) > T.pairCenter) continue;
        const sep = Math.hypot(a.x - b.x, a.y - b.y);
        const score = sep + (a.key === b.key ? 0 : 10);
        if (!pair || score < pair.score) pair = { a, b, sep, score };
      }
      if (pair && pair.a.key === pair.b.key) {
        const axis = (Math.atan2(pair.b.y - pair.a.y, pair.b.x - pair.a.x) * 180 / Math.PI + 360) % 180;
        p.padAxis = axis;
        p.rotDelta = Math.round((((p.rot - axis) % 180 + 180) % 180) / 90) % 2 * 90;
      }
    }

    // Rotation consistency within each footprint population
    yield 'Rotation';
    const groups = new Map();
    for (const p of pnp.parts) if (p.rotDelta != null) {
      const k = p.footprint + '|' + p.side;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const checkedGroups = [...groups.values()].filter(ps => ps.length >= T.rotGroup);
    add('rotation', 'info', `Rotation checked on ${checkedGroups.reduce((s, ps) => s + ps.length, 0)} two-terminal parts in ${checkedGroups.length} footprint groups`,
      'Each part\'s rotation is compared with the axis of its two pads, relative to the other parts with the same footprint and side (convention-free).');
    for (const [k, ps] of groups) {
      if (ps.length < T.rotGroup) continue;
      const cnt = { 0: 0, 90: 0 };
      for (const p of ps) cnt[p.rotDelta]++;
      const major = cnt[0] >= cnt[90] ? 0 : 90;
      const odd = ps.filter(p => p.rotDelta !== major);
      if (odd.length && odd.length <= ps.length * T.rotOutliers) for (const p of odd) {
        const row = pkg.assembly.rows.find(r => r.part === p);
        if (row) row.issues.push('rotation?');
        add('rotation', 'warn', `${p.des}: rotation ${p.rot}° is 90° off from its pads`,
          `The other ${ps.length - odd.length} ${p.footprint} parts on ${p.side} have rotation matching the pad axis; this one has pads at ${p.padAxis.toFixed(0)}°.`,
          { at: { x: p.gx, y: p.gy }, refs: [p.des] });
      }
    }

    if (!bom) return;

    // PnP ↔ BOM
    yield 'Pick-and-place vs BOM';
    const notInBom = [], notPlaced = [], dnpPlaced = [];
    for (const p of pnp.parts) {
      const line = bomDes.get(p.des);
      if (!line) notInBom.push(p);
      else if (line.dnp) dnpPlaced.push(p);
    }
    for (const [d, line] of bomDes) if (!placed.has(d) && !line.dnp) notPlaced.push({ d, line });
    // Test points, fiducials and mounting holes usually have no BOM line on purpose.
    const padOnly = p => C.isPadOnly(pkg, p.des);
    const quiet = notInBom.filter(padOnly);
    if (quiet.length) add('bom-pnp', 'info', `${quiet.length} test point / fiducial placement(s) have no BOM line`,
      quiet.map(p => p.des).sort(Fab.natCmp).join(', ') + '. Fine if they are bare pads; remove them from the PnP or mark them "No BOM" so the assembler does not ask.', { refs: quiet.map(p => p.des) });
    for (const p of notInBom.filter(p => !padOnly(p))) {
      const row = pkg.assembly.rows.find(r => r.part === p); if (row) row.issues.push('not in BOM');
      add('bom-pnp', 'warn', `${p.des} is placed but not in the BOM`, `"${p.comment}" (${p.footprint}). If it is DNP, mark it so; otherwise the BOM is missing a line.`, { at: { x: p.gx, y: p.gy }, refs: [p.des] });
    }
    for (const { d, line } of notPlaced) add('bom-pnp', 'error', `${d} is in the BOM but has no placement`, `BOM row ${line.row}: ${line.mpn || line.name}. The assembler will not know where it goes.`, { refs: [d] });
    if (dnpPlaced.length) add('dnp', 'info', `${dnpPlaced.length} DNP part(s) appear in the pick-and-place`, dnpPlaced.map(p => p.des).join(', ') + '. Confirm the assembler skips them.');
    if (!notInBom.length && !notPlaced.length) add('bom-pnp', 'info', 'Every placement is in the BOM and every BOM designator is placed', `${pnp.parts.length} placements, ${bomDes.size} BOM designators.`);

    // Comment / footprint agreement per line
    yield 'Comments, footprints and size codes';
    let sizeChecked = 0;
    for (const line of bom.lines) {
      const parts = line.des.map(d => placed.get(d)).filter(Boolean);
      if (!parts.length) continue;
      const fps = new Set(parts.map(p => p.footprint));
      if (fps.size > 1) add('footprint', 'warn', `BOM row ${line.row} (${line.mpn || line.name}) uses ${fps.size} different footprints`, [...fps].map(fp => fp + ': ' + parts.filter(p => p.footprint === fp).map(p => p.des).join(', ')).join('\n'), { refs: line.des });
      const names = [line.name, line.mpn, line.value, line.mpn2].filter(Boolean);
      // A generic PnP comment ("Capacitor 100 nF …") can only be compared when the BOM has a name column
      // or the comment itself is a part number. A comment that states a value for a part number Fabcheck
      // decodes is compared by value in the BOM audit (check value), and a missing part number is the
      // mpn check's.
      const dec = line.mpn ? Fab.parts.decode(line.mpn) : null;
      const byValue = p => dec && dec.value != null && Fab.parts.valueOf(p.comment, dec.kind) != null;
      const comparable = p => line.mpn && (bom.cols.name != null || looksLikeMpn(p.comment)) && !byValue(p);
      const badC = parts.filter(p => p.comment && comparable(p) && !names.some(n => norm(n) === norm(p.comment) || Fab.parts.samePn(p.comment, n)));
      if (badC.length) add('comment', 'warn', `PnP comment differs from BOM row ${line.row}`, badC.slice(0, 8).map(p => `${p.des}: "${p.comment}"`).join(', ') + ` vs BOM "${line.name || line.mpn}".`, { refs: badC.map(p => p.des) });
      // Size code: footprint vs description / MPN
      const fpSize = footprintSize(parts[0].footprint);
      const dSizes = textSizes(line.description);
      const mSize = mpnSize(line.mpn);
      if (fpSize && (dSizes.size || mSize)) sizeChecked++;
      if (fpSize && (dSizes.size && !dSizes.has(fpSize) || mSize && mSize !== fpSize)) {
        // The part number decides what is bought, so a part number of another size is an error.
        add('package', mSize && mSize !== fpSize ? 'error' : 'warn', `Package mismatch on BOM row ${line.row}: footprint ${fpSize}`,
          `${line.mpn || line.name}: footprint ${parts[0].footprint} is ${fpSize}, but ` +
          [dSizes.size && !dSizes.has(fpSize) ? `the description says ${[...dSizes].join('/')}` : '', mSize && mSize !== fpSize ? `the MPN implies ${mSize}` : ''].filter(Boolean).join(' and ') + '.',
          { refs: line.des });
      }
    }
    add('package', 'info', `Package size code checked on ${sizeChecked} BOM lines`, 'Footprint size (0402, 0603…) compared with the size in the description and the one implied by the MPN.');
    return;
  }

  // Part number vs description, manufacturer vs part-number prefix, and value vs part type.
  function auditPart(l, ref, add) {
    const P = Fab.parts;
    if (!l.mpn || l.dnp) return;
    const dec = P.decode(l.mpn);
    if (dec) {
      decoded.n++;
      const d = P.parseDesc(l.description + ' ' + (l.value || ''));
      const bad = [];
      const near = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * T.valueTol;
      if (dec.kind === 'C' && dec.value && d.cap && !near(dec.value, d.cap)) bad.push(`value ${P.fmtCap(dec.value)} vs ${P.fmtCap(d.cap)}`);
      if (dec.kind === 'R' && dec.value != null && d.res != null && !near(dec.value, d.res)) bad.push(`value ${P.fmtRes(dec.value)} vs ${P.fmtRes(d.res)}`);
      if (dec.kind === 'C' && dec.volt && d.volt && dec.volt !== d.volt) bad.push(`voltage ${dec.volt} V vs ${d.volt} V`);
      if (dec.kind === 'C' && dec.diel && d.diel && dec.diel !== d.diel) bad.push(`dielectric ${dec.diel} vs ${d.diel}`);
      // Below 10 pF the B/C/D tolerance letters are absolute (pF), not percent.
      const absTol = dec.kind === 'C' && dec.value && dec.value < T.absTolBelow;
      if (dec.tol && d.tol && !absTol && dec.tol !== d.tol) bad.push(`tolerance ±${dec.tol}% vs ±${d.tol}%`);
      if (bad.length) add('pn-desc', bad.some(b => /^(value|voltage)/.test(b)) ? 'error' : 'warn',
        `BOM row ${l.row}: ${l.mpn} disagrees with its description`,
        `Part number decodes to ${bad.map(b => b.split(' vs ')[0]).join(', ')}; the description/value says ${bad.map(b => b.split(' vs ')[1]).join(', ')}. ${l.des.join(', ')}`, ref);
    }
    const exp = P.expectedMfr(l.mpn);
    if (exp && l.mfr && !exp.some(k => norm(l.mfr).includes(k))) add('mfr-prefix', 'warn', `BOM row ${l.row}: ${l.mpn} listed as made by ${l.mfr}`,
      `That part-number prefix belongs to ${exp[0].replace(/^\w/, c => c.toUpperCase())}. ${l.des.join(', ')}`, ref);
    // Value column vs part type (e.g. "2pF" on a diode, "12kΩ" on an LED)
    const v = l.value || '';
    const cls = (l.des[0] || '').replace(/\d.*$/, '').toUpperCase();
    const isCap = /F$/i.test(v.replace(/\s/g, '')) && /\d/.test(v), isRes = /(Ω|ohm|\d[kKmM]?$|\dR\d|\d[kKM]\d)/i.test(v) && !/F$/i.test(v) && /\d/.test(v);
    const wrong = (cls === 'C' && isRes && !isCap) || (cls === 'R' && isCap) || (/^(D|DS|LED)$/.test(cls) && (isCap || /(Ω|ohm)/i.test(v)));
    if (wrong) add('value-type', 'warn', `BOM row ${l.row}: value "${v}" on a ${cls} part`, `${l.mpn} — the Value column does not fit the part type. ${l.des.join(', ')}`, ref);
  }
  const decoded = { n: 0 };

  function* runBom(pkg, out) {
    decoded.n = 0;
    const bom = pkg.bom;
    if (!bom) return;
    yield 'BOM lines';
    const add = (check, severity, title, detail, extra) => out.push(F(Object.assign({ category: 'BOM', check, severity, title, detail }, extra || {})));
    if (bom.cols.mfr == null) add('mfr', 'warn', 'BOM has no Manufacturer column', 'Part numbers without a manufacturer are ambiguous for some buyers; add "Manufacturer 1" to the BOM template.');
    if (bom.cols.mpn == null) add('mpn', 'error', 'BOM has no manufacturer part number column', 'Columns found: ' + bom.header.filter(Boolean).join(', ') + '.');
    add('summary', 'info', `BOM: ${bom.lines.length} lines, ${bom.lines.reduce((s, l) => s + l.des.length, 0)} designators`, `${bom.name}${bom.sheet ? ' (sheet "' + bom.sheet + '")' : ''}. Columns: ${bom.header.filter(Boolean).join(', ')}.`);

    const seen = new Map();
    const byMpn = new Map();
    let lostChars = 0;
    for (const l of bom.lines) {
      const ref = { refs: l.des, row: l.row };
      if (!l.des.length) add('designator', 'error', `BOM row ${l.row} has no designators`, l.mpn || l.name, ref);
      if (l.qty != null && !isNaN(l.qty) && l.qty !== l.des.length) add('qty', 'error', `BOM row ${l.row}: quantity ${l.qtyRaw} but ${l.des.length} designators`, l.des.join(', '), ref);
      for (const d of l.des) { if (seen.has(d)) add('duplicate', 'error', `${d} appears on two BOM rows`, `Rows ${seen.get(d)} and ${l.row}.`, { refs: [d] }); else seen.set(d, l.row); }
      if (!l.dnp && !l.mpn) add('mpn', 'error', `BOM row ${l.row}: no manufacturer part number`, `${l.name} — ${l.des.join(', ')}`, ref);
      if (!l.dnp && l.mpn && !l.mfr && bom.cols.mfr != null) add('mfr', 'warn', `BOM row ${l.row}: no manufacturer`, l.mpn, ref);
      if (l.mpn) { const k = norm(l.mpn); if (!byMpn.has(k)) byMpn.set(k, []); byMpn.get(k).push(l); }
      if (looksLikeMpn(l.name) && l.mpn && norm(l.name) !== norm(l.mpn) && norm(l.name) !== norm(l.mpn2)) {
        add('name-mpn', 'warn', `BOM row ${l.row}: part name ${l.name} ≠ MPN ${l.mpn}`,
          `The Name/Comment column holds a different part number than Manufacturer Part Number 1 (${l.mfr || '?'}). Confirm which part is intended. ${l.des.join(', ')}`, ref);
      }
      const lc = norm(l.lifecycle);
      if (LC_ERROR.test(lc)) add('lifecycle', 'error', `BOM row ${l.row}: ${l.mpn} lifecycle "${l.lifecycle}"`, l.des.join(', '), ref);
      else if (LC_WARN.test(lc)) add('lifecycle', 'warn', `BOM row ${l.row}: ${l.mpn} lifecycle "${l.lifecycle}"`, l.des.join(', '), ref);
      if (REV_BAD.test(l.revStatus)) add('lifecycle', 'warn', `BOM row ${l.row}: component revision status "${l.revStatus}"`, `${l.mpn || l.name} — the library item behind this line is marked ${l.revStatus}. ${l.des.join(', ')}`, ref);
      for (const s of [l.value, l.description, l.name]) if (s && s.indexOf('�') >= 0) lostChars++;
      auditPart(l, ref, add);
    }
    // Board data per designator: the placement (footprint, comment, description) and the pad count.
    const placed = new Map(((pkg.pnp && pkg.pnp.parts) || []).map(p => [p.des, p]));
    const comps = new Map(((pkg.odb && pkg.odb.comps) || []).map(c => [c.des, c]));
    const padsOf = d => {
      const c = comps.get(d);
      if (c && c.pins && c.pins.length) return c.pins.length;
      const n = pkg.netlist && pkg.netlist.byDes.get(d);
      return n ? n.length : null;
    };
    const fpsOf = l => [...new Set([l.footprint].concat(l.des.map(d => (placed.get(d) || {}).footprint)).filter(Boolean))];
    const atOf = l => { const p = l.des.map(d => placed.get(d)).find(p => p && p.gx != null); return p ? { at: { x: p.gx, y: p.gy }, side: p.side } : {}; };

    for (const [k, ls] of byMpn) if (ls.length > 1) {
      const rows = ls.map(l => {
        const fps = fpsOf(l), pads = [...new Set(l.des.map(padsOf).filter(n => n != null))];
        const comments = [...new Set((l.name ? [l.name] : l.des.map(d => (placed.get(d) || {}).comment)).filter(Boolean))];
        return { l, fps, pads, comments };
      });
      const fpSet = new Set(rows.flatMap(r => r.fps.map(norm))), padSet = new Set(rows.flatMap(r => r.pads));
      const list = rows.map(r => `Row ${r.l.row} (${r.l.des.join(', ')}): ${r.fps.join(' / ') || 'no footprint'}` + (r.pads.length ? `, ${r.pads.join('/')} pads` : '') + (r.comments.length ? `, comment "${r.comments.join('" / "')}"` : '')).join('\n');
      if (fpSet.size > 1 || padSet.size > 1) {
        add('mpn-dup', 'error', `MPN ${ls[0].mpn} is on ${ls.length} BOM rows with different ${fpSet.size > 1 ? 'footprints' : 'pad counts'}`,
          list + '\nOne part number cannot fit two different footprints, so one row probably has the wrong part number. Check each row\'s comment or ODB++ part name for the part that was meant.', { refs: ls.flatMap(l => l.des), row: ls[0].row });
      } else {
        const cs = new Set(rows.flatMap(r => r.comments.map(norm)));
        add('mpn-dup', 'warn', `MPN ${ls[0].mpn} is on ${ls.length} BOM rows`,
          list + '\n' + (cs.size > 1 ? 'The BOM split them because their comments differ. If the comments are right, one row needs another part number; if the part number is right, fix the comment and the rows merge.' : 'Assemblers ask for one line per part number; merge them.'),
          { refs: ls.flatMap(l => l.des), row: ls[0].row });
      }
    }

    // ---- value written on the board data vs the decoded part number ----
    // One line per designator and value: C7: 22 nF in the PnP comment "…", the ODB++ part "…".
    const groupBad = (bad, fmt) => {
      const g = new Map();
      for (const b of bad) { const k = b.d + '|' + fmt(b.v); if (!g.has(k)) g.set(k, []); g.get(k).push(b); }
      return [...g.values()].map(bs => `${bs[0].d}: ${fmt(bs[0].v)} in the ` + bs.map(b => `${b.src} "${b.text}"`).join(', ')).join('\n');
    };
    yield 'Values on the board data';
    const P = Fab.parts;
    const near = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * T.valueTol;
    let compared = 0;
    for (const l of bom.lines) {
      if (!l.mpn || l.dnp) continue;
      const dec = P.decode(l.mpn);
      if (!dec || dec.value == null) continue;
      const fmt = v => dec.kind === 'C' ? P.fmtCap(v) : P.fmtRes(v);
      const bad = [];
      for (const d of l.des) {
        const p = placed.get(d), c = comps.get(d);
        const srcs = (p ? [['PnP comment', p.comment], ['PnP description', p.description]] : []).concat(c ? [['ODB++ part', c.part]] : []);
        let seen = false;
        for (const [src, text] of srcs) {
          if (!text || P.samePn(text, l.mpn)) continue;
          const v = P.valueOf(text, dec.kind);
          if (v == null) continue;
          seen = true;
          if (!near(v, dec.value)) bad.push({ d, src, text, v });
        }
        if (seen) compared++;
      }
      if (!bad.length) continue;
      const ds = [...new Set(bad.map(b => b.d))];
      add('value', 'error', `BOM row ${l.row}: ${l.mpn} is ${fmt(dec.value)}, but ${ds.join(', ')} ${ds.length > 1 ? 'are' : 'is'} marked ${[...new Set(bad.map(b => fmt(b.v)))].join(' / ')}`,
        groupBad(bad, fmt) + `\nThe assembler buys and fits the part number (${fmt(dec.value)}). If the marked value is the one intended, the BOM line needs another part number; if not, fix the comment in the schematic.`,
        Object.assign({ refs: ds, row: l.row }, atOf({ des: ds })));
    }
    add('value', 'info', `Values compared on ${compared} parts`, `Pick-and-place comments and descriptions${comps.size ? ' and ODB++ part names' : ''} that state a value, against the value the part number decodes to (offline; ${DECODED}).`);

    // ---- footprint names, package codes and pin counts ----
    yield 'Footprints vs part numbers';
    let tiChecked = 0, pinChecked = 0;
    const pinBad = [];
    for (const l of bom.lines) {
      if (l.dnp) continue;
      const ref = { refs: l.des, row: l.row };
      const pns = [l.mpn, l.mpn2].filter(Boolean);
      const fps = fpsOf(l);
      if (pns.length) for (const fp of fps) {
        const toks = P.fpPartTokens(fp);
        const own = toks.some(t => pns.some(pn => P.namesPart(t, pn, T.fpPrefix)));
        const other = toks.filter(t => !pns.some(pn => P.namesPart(t, pn, T.fpPrefix)));
        if (other.length && !own) add('fp-name', 'warn', `${l.des.slice(0, 6).join(', ')}${l.des.length > 6 ? '…' : ''}: footprint ${fp} is named for ${other[0]}, not ${l.mpn}`,
          `BOM row ${l.row}. A footprint named after another part was usually copied from it. Confirm the land pattern matches ${l.mpn}'s datasheet (pad count, pitch, body size), then rename it, or the assembler will keep asking.`, Object.assign({}, ref, atOf(l)));
        // TI package designator vs the footprint's package family.
        const ti = l.mpn && P.tiPackage(l.mpn, l.mfr);
        const fam = ti && !own ? P.fpFamily(fp) : null;
        if (fam) {
          tiChecked++;
          if (!P.sameFamily(fam, ti.family)) add('pkg-code', 'warn', `BOM row ${l.row}: ${l.mpn} is a ${ti.family} (${ti.code}), but its footprint ${fp} is a ${fam}`,
            `${l.des.join(', ')}. TI part numbers end in their package designator; ${ti.code} is a ${ti.family} package. Either the part number names the wrong package option, or the footprint belongs to another part.`, Object.assign({}, ref, atOf(l)));
        }
      }
      // Pin count in a description vs the pads on the board.
      for (const d of l.des) {
        const p = placed.get(d);
        if (C.connectorLike(d, l.description) || C.connectorLike(d, p && p.description)) continue;
        const n = padsOf(d);
        if (n == null) continue;
        const texts = [['BOM description', l.description], ['PnP description', p && p.description]].filter(([, t]) => t);
        const stated = [];
        for (const [src, t] of texts) for (const c of P.pinCounts(t)) stated.push({ src, c, t });
        if (!stated.length) continue;
        pinChecked++;
        if (!stated.some(s => n === s.c || n === s.c + 1)) pinBad.push({ d, n, stated, l, p });
      }
    }
    for (const b of pinBad.slice(0, T.shown)) {
      const says = [...new Set(b.stated.map(s => s.c))].join(' or ');
      add('pins', 'warn', `${b.d}: ${b.n} pads, but the description says ${says} pins`,
        `BOM row ${b.l.row} (${b.l.mpn || b.l.name || '?'}). ` + [...new Set(b.stated.map(s => `${s.src}: "${s.t.length > 90 ? s.t.slice(0, 90) + '…' : s.t}"`))].join('\n') +
        '\nThe footprint, the part number or the description is for another package.', Object.assign({ refs: [b.d], row: b.l.row }, b.p && b.p.gx != null ? { at: { x: b.p.gx, y: b.p.gy }, side: b.p.side } : {}));
    }
    if (tiChecked) add('pkg-code', 'info', `Package code compared with the footprint on ${tiChecked} TI part(s)`, 'The package designator at the end of each TI part number against the package family its footprint names.');
    if (pinChecked) add('pins', 'info', `Pin count compared with pads on ${pinChecked} part(s)`, 'Pin counts stated in BOM and pick-and-place descriptions against the pads each part has (ODB++ or IPC-356).');
    if (!bom.hasMfr2) add('single-source', 'info', 'Every BOM line is single-source', 'There is no Manufacturer 2 / MPN 2 column, so no approved alternates are listed.');
    else {
      const single = bom.lines.filter(l => !l.dnp && l.mpn && !l.mpn2);
      if (single.length) add('single-source', 'info', `${single.length} of ${bom.lines.length} BOM lines are single-source`, single.map(l => l.mpn).join(', '));
    }
    add('pn-desc', 'info', `Part number decoded and compared with the description on ${decoded.n} BOM lines`, `Covers ${DECODED} (offline).`);
    if (lostChars) add('encoding', 'info', `${lostChars} BOM cell(s) contain lost characters (�)`, 'Characters such as µ, ± or Ω were not exported correctly. Values like "10�F" are ambiguous to a buyer.');
    return;
  }

  C.assembly = C.runner(runCross);
  C.bom = C.runner(runBom);
  C.sizes = { footprintSize, textSizes, mpnSize };
})(window.Fab);
