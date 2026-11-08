// Offline decoding of common passive part numbers and of free-text descriptions, so a BOM line's MPN
// can be compared with its description (value, voltage, dielectric, tolerance) without any web lookup.
(function (Fab) {
  'use strict';

  const MURATA_V = { '0J': 6.3, '1A': 10, '1C': 16, '1E': 25, '1V': 35, '1H': 50, '2A': 100, '2D': 200, '2E': 250, '2W': 450, '2J': 630, '3A': 1000 };
  const MURATA_D = { R6: 'X5R', R7: 'X7R', C7: 'X7S', C8: 'X6S', '5C': 'C0G', L8: 'X8L', D7: 'X7T', E7: 'X7U', F5: 'Y5V' };
  const YAGEO_V = { 5: 6.3, 6: 10, 7: 16, 8: 25, 9: 50, 0: 100, 1: 200, 2: 250 };
  const SAMSUNG_V = { R: 4, Q: 6.3, P: 10, O: 16, A: 25, L: 35, B: 50, C: 100, D: 200, E: 250, G: 500, H: 630, I: 1000, J: 2000, K: 3000 };
  const SAMSUNG_D = { A: 'X5R', B: 'X7R', C: 'C0G', F: 'Y5V', X: 'X6S', Y: 'X7S', Z: 'X7T' };
  const KEMET_V = { 9: 6.3, 8: 10, 4: 16, 3: 25, 6: 35, 5: 50, 1: 100, 2: 200, A: 250 };
  const KEMET_D = { G: 'C0G', R: 'X7R', P: 'X5R', U: 'Z5U', V: 'Y5V' };
  const AVX_V = { 4: 4, 6: 6.3, Z: 10, Y: 16, 3: 25, D: 35, 5: 50, 1: 100, 2: 200, 7: 500, C: 600, A: 1000 };
  const AVX_D = { C: 'X7R', A: 'C0G', D: 'X5R', G: 'Y5V', Z: 'X7S' };
  const TOL = { A: 0.05, B: 0.1, C: 0.25, D: 0.5, F: 1, G: 2, J: 5, K: 10, M: 20, Z: 80 };
  const SIZE2 = { '02': '01005', '03': '0201', '04': '0402', '05': '0402', '15': '0402', '10': '0603', '18': '0603', '21': '0805', '31': '1206', '32': '1210', '43': '1812', '55': '2220' };

  // "104" -> 100 nF (in farads); "6R0" -> 6 pF; "R47" -> 0.47 pF
  function capCode(s) {
    if (/R/.test(s)) return parseFloat(s.replace('R', '.')) * 1e-12;
    return parseInt(s.slice(0, 2), 10) * Math.pow(10, +s[2]) * 1e-12;
  }
  // "10K" -> 10e3, "4K7" -> 4700, "22R" -> 22, "0R" -> 0, "1M" -> 1e6
  function resCode(s) {
    const m = /^(\d*)([RKM])(\d*)$/i.exec(s);
    if (!m) return isNaN(+s) ? null : +s;
    const mult = { R: 1, K: 1e3, M: 1e6 }[m[2].toUpperCase()];
    return parseFloat((m[1] || '0') + '.' + (m[3] || '0')) * mult;
  }

  function decode(mpn) {
    const s = String(mpn || '').trim().toUpperCase();
    let m;
    if ((m = /^GMC(\d\d)(X\d[RSTP]|CG|NP|Y5V)(\d\d\d|\dR\d)([A-Z])(\d+)/.exec(s)))
      return { kind: 'C', mfr: 'cal-chip', size: SIZE2[m[1]], diel: m[2] === 'CG' || m[2] === 'NP' ? 'C0G' : m[2], value: capCode(m[3]), tol: TOL[m[4]], volt: +m[5] };
    if ((m = /^CC(\d{4})([A-Z])R(NPO|X\d[RSTP]|Y5V)(\d)B[BN](\d\d\d|\dR\d)/.exec(s)))
      return { kind: 'C', mfr: 'yageo', size: m[1], tol: TOL[m[2]], diel: m[3] === 'NPO' ? 'C0G' : m[3], volt: YAGEO_V[m[4]], value: capCode(m[5]) };
    if ((m = /^G(?:RM|CM|JM|QM|CJ|RT)(\d\d)\w(\w\d|\d\w)(\d\w)(\d\d\d|\dR\d)([A-Z])/.exec(s)))
      return { kind: 'C', mfr: 'murata', size: SIZE2[m[1]], diel: MURATA_D[m[2]], volt: MURATA_V[m[3]], value: capCode(m[4]), tol: TOL[m[5]] };
    if ((m = /^CL(\d\d)([A-Z])(\d\d\d|\dR\d)([A-Z])([A-Z])/.exec(s)))
      return { kind: 'C', mfr: 'samsung', size: SIZE2[m[1]], diel: SAMSUNG_D[m[2]], value: capCode(m[3]), tol: TOL[m[4]], volt: SAMSUNG_V[m[5]] };
    if ((m = /^C(\d{4})C(\d\d\d|\dR\d)([A-Z])([0-9A])([GRPUV])A/.exec(s)))
      return { kind: 'C', mfr: 'kemet', size: m[1], value: capCode(m[2]), tol: TOL[m[3]], volt: KEMET_V[m[4]], diel: KEMET_D[m[5]] };
    if ((m = /^(0201|0402|0603|0805|1206|1210|1812)([0-9A-Z])([ACDGZ])(\d\d\d|\dR\d)([A-Z])A/.exec(s)))
      return { kind: 'C', mfr: 'avx', size: m[1], volt: AVX_V[m[2]], diel: AVX_D[m[3]], value: capCode(m[4]), tol: TOL[m[5]] };
    if ((m = /^C(?:GA|GJ|\d{4})\w*?(X\d[RSTP]|C0G|NP0)(\d[A-Z])(\d\d\d|\dR\d)([A-Z])/.exec(s)) && /^C(GA|GJ|\d{4})/.test(s))
      return { kind: 'C', mfr: 'tdk', diel: m[1] === 'NP0' ? 'C0G' : m[1], volt: MURATA_V[m[2]], value: capCode(m[3]), tol: TOL[m[4]] };
    if ((m = /^R[CT](\d{4})([A-Z])[A-Z]{1,2}-?(?:07|13|10|7W)([0-9RKM]+)L$/.exec(s)))
      return { kind: 'R', mfr: 'yageo', size: m[1], tol: TOL[m[2]], value: resCode(m[3]) };
    if ((m = /^CRCW(\d{4})(\d+[RKM]\d*)([A-Z])/.exec(s)))
      return { kind: 'R', mfr: 'vishay', size: m[1], value: resCode(m[2]), tol: TOL[m[3]] };
    if ((m = /^ERJ-?\w{2,3}([EKJ])([FDBJ]?)(\d+[RKM]?\d*)V$/.exec(s)))
      return { kind: 'R', mfr: 'panasonic', value: m[3].length === 4 && !/[RKM]/.test(m[3]) ? parseInt(m[3].slice(0, 3), 10) * Math.pow(10, +m[3][3]) : m[3].length === 3 && !/[RKM]/.test(m[3]) ? parseInt(m[3].slice(0, 2), 10) * Math.pow(10, +m[3][2]) : resCode(m[3]), tol: m[2] ? TOL[m[2]] : 5 };
    if ((m = /^RMCF(\d{4})([A-Z])T(\d+[RKM]\d*)/.exec(s)))
      return { kind: 'R', mfr: 'stackpole', size: m[1], tol: m[2] === 'Z' ? null : TOL[m[2]], value: resCode(m[3]) };
    return null;
  }

  // Free-text description -> {cap, res, volt, diel, tol}
  function parseDesc(desc) {
    const d = String(desc || '');
    const out = {};
    let m;
    if ((m = /(\d+(?:\.\d+)?)\s*([pnuµμm]?)\s*F\b/i.exec(d.replace(/�(?=F)/g, 'u')))) {
      const k = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, '': 1 }[m[2].toLowerCase()];
      if (k != null) out.cap = parseFloat(m[1]) * k;
    }
    if ((m = /(\d+(?:\.\d+)?)\s*([kKmM]?)\s*(?:Ω|ohms?\b|O\b(?=\s|$))/i.exec(d)) || (m = /\b(\d+)([kKmMR])(\d+)\b/.exec(d))) {
      if (m[3] !== undefined && /^\d+$/.test(m[3]) && /[kKmMR]/.test(m[2])) out.res = parseFloat(m[1] + '.' + m[3]) * ({ k: 1e3, m: 1e6, r: 1 }[m[2].toLowerCase()]);
      else out.res = parseFloat(m[1]) * ({ k: 1e3, m: 1e6, '': 1 }[m[2].toLowerCase()] || 1);
      if (m[2] === 'm' && /mΩ|mohm/i.test(d)) out.res = parseFloat(m[1]) * 1e-3;
    }
    const vs = [...d.matchAll(/(\d+(?:\.\d+)?)\s*V(?:DC|dc)?\b/g)].map(x => parseFloat(x[1]));
    if (vs.length) out.volt = Math.max(...vs);
    if ((m = /\b(X\d[RSTPU]|C0G|COG|NP0|NPO|Y5V|Z5U|X8L)\b/i.exec(d))) out.diel = /^(COG|NP0|NPO)$/i.test(m[1]) ? 'C0G' : m[1].toUpperCase();
    if ((m = /(?:±|\+\/-|�|卤)\s*(\d+(?:\.\d+)?)\s*%/.exec(d)) || (m = /\b(\d+(?:\.\d+)?)%/.exec(d))) out.tol = parseFloat(m[1]);
    return out;
  }

  // Which manufacturer a part-number prefix belongs to (lower-case keywords to look for in the Manufacturer column).
  const PREFIX_MFR = [
    [/^G(RM|CM|JM|QM|CJ|RT)|^BLM|^LQ[GHMW]|^NCP|^NFM/i, ['murata']],
    [/^CL\d\d[A-Z]/i, ['samsung']],
    [/^GMC\d\d/i, ['cal-chip', 'calchip', 'cal chip']],
    [/^(CC|RC|RT|AC|CQ)(0201|0402|0603|0805|1206|1210|1812|2010|2512)/i, ['yageo']],
    [/^C\d{4}C\d{3}/i, ['kemet']],
    [/^(CGA|CGJ|C\d{4}X|MLZ|MPZ|VLS|SPM|NLV)/i, ['tdk']],
    [/^(ERJ|ERA|ERT|EEE|ECA|EEH)/i, ['panasonic']],
    [/^CRCW|^TNPW|^SI\d|^IR/i, ['vishay', 'infineon']],
    [/^LTST|^LTL|^LTW/i, ['lite-on', 'liteon', 'lite on']],
    [/^HSM[A-Z]|^ASMT/i, ['broadcom', 'avago']],
    [/^(0201|0402|0603|0805|1206|1210)\d[A-Z]\d{3}/i, ['avx', 'kyocera']],
    [/^RMCF|^RNCF|^CSR/i, ['stackpole']],
    [/^885\d{6}|^744\d+|^742\d+|^7427/i, ['würth', 'wurth', 'wuerth']],
    [/^(STM32|STM8|LD\d|ESDA|USBLC)/i, ['st', 'stmicro']],
    [/^(TPS|LM\d|TLV|SN74|INA|OPA|ADS)\d/i, ['texas', 'ti']],
  ];
  function expectedMfr(mpn) {
    for (const [re, names] of PREFIX_MFR) if (re.test(mpn || '')) return names;
    return null;
  }

  // ---- values written on the board data (PnP comment and description, ODB++ part name) ----
  // Size codes, tolerances, and ratings are dropped first, so "1K, 0402" reads as 1 kΩ, not 402 Ω.
  const SIZE_TOKENS = /(^|[^\d.])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512|1005|1608|2012|3216|3225|4532|5025|6332)(?![\d.])(\s*metric)?/gi;
  // The capacitance or resistance a text states, in F or Ω; null when it states none.
  function valueOf(text, kind) {
    const t = String(text || '').replace(/_/g, ' ').trim();
    if (!t) return null;
    const d = parseDesc(t);
    if (kind === 'C') return d.cap != null ? d.cap : null;
    if (kind !== 'R') return null;
    if (d.res != null && isFinite(d.res)) return d.res;
    const s = ' ' + t.replace(SIZE_TOKENS, '$1 ').replace(/\d+(\.\d+)?\s*%/g, ' ').replace(/\d+\/\d+\s*W\b/gi, ' ').replace(/\d+(\.\d+)?\s*[mk]?[WV]\b/gi, ' ') + ' ';
    let m = /[\s,;(](\d+(?:\.\d+)?)\s*([kKmM]?)(?=[\s,;)])/.exec(s);
    if (m) return parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1);
    m = /[\s,;(](\d*)([RrKkMm])(\d*)(?=[\s,;)])/.exec(s);
    if (m && (m[1] || m[3])) return parseFloat((m[1] || '0') + '.' + (m[3] || '0')) * { r: 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()];
    return null;
  }
  // A board part name that is a value, not a part number ("10K,_0402", "4.7uF,_X5R", "0", "49.9_kO").
  // The first token (up to a comma, underscore, or space) must be a whole value: 10K, 4.7uF, 2.2uH, 0,
  // 953, 16.2 kO. Part numbers that start with digits (a 0402… capacitor, 1729128) are not.
  const isValueLabel = s => {
    const t = String(s || '').trim().replace(/_/g, ' ');
    const m = /^(\d+(?:\.\d+)?)\s*([pnuµμmkKMRr]?)\s*(F|H|Ω|ohms?|O)?(?=$|[\s,;])/i.exec(t);
    if (!m) return /^\d+[RKM]\d+(?=$|[\s,;])/i.test(t);   // 4K7, 2R2
    return !!(m[2] || m[3]) || m[1].replace('.', '').length <= 4;
  };

  // Two part numbers name the same part: equal letters and digits, or one is the other without its
  // packaging suffix (BSS138 / BSS138LT1G) or with a library prefix (IC_TPS62162DSGR / TPS62162DSGR).
  const alnum = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function samePn(a, b) {
    const x = alnum(a), y = alnum(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length < y.length ? [x, y] : [y, x];
    return s.length >= 6 && (l.startsWith(s) || l.endsWith(s));
  }

  // ---- footprint names ----
  // Package and land-pattern names that look like part numbers but are not (IPC-7351 names, TI package
  // designators such as DSG0008A, generic packages with a pin count).
  const PKG_NAME = /^(RESC|CAPC|INDC|LEDC|DIOC|RESM|CAPM|FUSC|BEADC|SOIC|SOP|SSOP|TSSOP|MSOP|QFN|DFN|SON|BGA|LGA|CSP|WLP|SOT|SOD|TO\d|QFP|LQFP|TQFP|PQFP|PLCC|DIP|SIP|XTAL|CRYSTAL|OSC|IND|CAP|RES|LED|FID|TP|MH|HDR|HEADER|PIN|CONN)/i;
  const PKG_ANY = /(QFN|SON|DFN|BGA|CSP|WLP|SOT|SOIC|QFP|LGA|SOD|DPAK|TSOP|SSOP|MSOP)/i;
  // DSG0008A, RPW0010A-MFG: the designator then a non-alphanumeric or the end (OPT3001DNPR is a part number).
  const TI_PKG = /^[A-Z]{3}\d{4}[A-Z]?([^A-Z0-9]|$)/i;
  // Library prefixes before the part number in a footprint name.
  const FP_PREFIX = /^(IC|U|HRS|JST|XTAL|CONN|MOLEX|TE|SAMTEC|WURTH|WE|TI|ADI|ST|NXP|MURATA|KEMET|AMP|FCI|CUI|GCT)[_ -]/i;
  // Part-number-like tokens in a footprint name ("IC_OPT3001DNPR" → OPT3001DNPR); [] for package and
  // generic names. A token counts only when it reads like a manufacturer part number: 8+ letters and
  // digits, a letter run then 3+ digits, and none of what generic footprint names carry (dimensions with
  // a decimal point, a size code, a pin count such as -16P, package words).
  const SIZE_RUN = /(^|\D)(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512|1005|1608|2012|3216|3225|4532|5025|6332)(\D|$)/;
  function fpPartTokens(fp) {
    const out = [];
    for (let tok of String(fp || '').replace(FP_PREFIX, '').replace(/^FP[_ -]/i, '').split('_')) {
      tok = tok.trim();
      const a = alnum(tok);
      if (a.length < 8 || /^\d/.test(a) || !/[A-Z]{2,}\d{3,}/.test(a) || /\./.test(tok)) continue;
      if (PKG_NAME.test(tok) || PKG_ANY.test(tok) || TI_PKG.test(tok) || /\d+(\.\d+)?X\d/i.test(tok) || SIZE_RUN.test(tok) || /-\d+P(-|$)/i.test(tok)) continue;
      out.push(tok);
    }
    return out;
  }
  // A footprint token names this part: the same part number (samePn), the same family (4+ leading
  // letters and digits in common), or the part number inside it with X as a wildcard (LTST-C19X for
  // LTST-C190, a footprint shared by a family).
  function namesPart(tok, pn, prefix) {
    if (samePn(tok, pn) || commonPrefix(tok, pn) >= (prefix || 4)) return true;
    const t = alnum(tok), p = alnum(pn), need = Math.min(6, p.length);
    for (let i = 0; i + need <= t.length; i++) {
      let k = 0;
      while (k < p.length && i + k < t.length && (t[i + k] === p[k] || t[i + k] === 'X')) k++;
      if (k >= need) return true;
    }
    return false;
  }
  // Letters and digits two part numbers share from the start.
  function commonPrefix(a, b) {
    const x = alnum(a), y = alnum(b);
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    return i;
  }

  // ---- TI package designators ----
  // TI orderable part numbers end in a package designator and a reel letter (TPS62162DSGR → DSG).
  // Only designators with a well-known package family are listed.
  const TI_FAMILY = {
    DBV: 'SOT-23', DDC: 'SOT-23', DCK: 'SC70', DCN: 'SOT-23', DBZ: 'SOT-23', DRL: 'SOT-563', DYY: 'SOT-23',
    DRY: 'SON', DSK: 'SON', DSG: 'SON', DRV: 'SON', DQA: 'SON', DQN: 'SON', DSE: 'SON', DRC: 'SON', DGS: 'MSOP', DGK: 'MSOP',
    DRB: 'SON', DNP: 'SON', DMR: 'SON', DQE: 'SON', DPW: 'SON', DTQ: 'SON',
    RGT: 'QFN', RGE: 'QFN', RTE: 'QFN', RGW: 'QFN', RHB: 'QFN', RGZ: 'QFN', RSA: 'QFN', RTW: 'QFN', RUK: 'QFN', RPW: 'QFN', RNR: 'QFN',
    RWB: 'QFN', RSW: 'QFN', RUG: 'QFN', RSE: 'QFN', RVA: 'QFN', RLT: 'QFN', RUM: 'QFN', RGR: 'QFN', RGY: 'QFN', RSN: 'QFN',
    YBG: 'CSP', YFF: 'CSP', YZF: 'CSP', YBH: 'CSP', YFP: 'CSP', YZP: 'CSP', YKA: 'CSP', YBJ: 'CSP', YZT: 'CSP', YZR: 'CSP', YFA: 'CSP',
    PW: 'TSSOP', PWP: 'TSSOP', DGQ: 'MSOP', DDA: 'SOIC',
  };
  const TI_MPN = /^(TPS|TLV|TLC|TMP|INA|OPA|ADS|DAC|LMR|LMV|LMZ|LM\d|LP\d|LPV|SN74|SN65|TXS|TXB|TCA|TPD|TUSB|BQ\d|DRV|ISO|CSD|UCC|TPA|HDC|OPT|DRV|LMK|CDC|TS3|TS5|TL\d)/i;
  function tiPackage(mpn, mfr) {
    const s = String(mpn || '').trim().toUpperCase();
    if (!(TI_MPN.test(s) || /texas|^ti$/i.test(String(mfr || '').trim()))) return null;
    const m = /([A-Z]{2,3})[RT](Q1)?$/.exec(s);
    if (!m) return null;
    const code = TI_FAMILY[m[1]] ? m[1] : TI_FAMILY[m[1].slice(-2)] && m[1].length === 3 ? m[1].slice(-2) : null;
    return code ? { code, family: TI_FAMILY[code] } : null;
  }
  // The package family a footprint name names, or null. TI designators (DSG0008A) map through TI_FAMILY.
  function fpFamily(fp) {
    const s = String(fp || '').toUpperCase();
    const ti = /(?:^|[^A-Z])([A-Z]{3})\d{4}[A-Z]?(?:[^A-Z0-9]|$)/.exec(s);
    if (ti && TI_FAMILY[ti[1]]) return TI_FAMILY[ti[1]];
    if (/WCSP|WLCSP|WL-CSP|DSBGA|WLP|CSP|BGA/.test(s)) return 'CSP';
    if (/SC-?70|SOT-?323|SOT-?353|SOT-?363/.test(s)) return 'SC70';
    if (/SOT-?563|SOT-?666/.test(s)) return 'SOT-563';
    if (/SOT-?23|SOT23|SOT-?25|SOT-?26|SOT-?323/.test(s)) return 'SOT-23';
    if (/QFN|VQFN|WQFN|UQFN/.test(s)) return 'QFN';
    if (/SON|DFN|WSON|USON|VSON/.test(s)) return 'SON';
    if (/TSSOP|HTSSOP/.test(s)) return 'TSSOP';
    if (/MSOP|VSSOP/.test(s)) return 'MSOP';
    if (/SOIC/.test(s)) return 'SOIC';
    return null;
  }
  // QFN and SON are one family for this comparison: TI calls the same body a QFN or a SON by pin layout.
  const sameFamily = (a, b) => a === b || ([a, b].every(f => f === 'QFN' || f === 'SON'));

  // ---- pin counts stated in text ("6-SON", "64LQFP", "SOT-89-5", "15-WL-CSP", "8 pins") ----
  const PIN_PKG = /(?:^|[^\w.])(\d{1,3})[ -]?(?:PIN[ -]?)?(X?SON|WSON|USON|VSON|DFN|XDFN|UDFN|X2QFN|QFN|UQFN|VQFN|WQFN|WLP|WLCSP|WL-CSP|CSP|DSBGA|UFBGA|BGA|LQFP|TQFP|QFP|SOT-?23|SOIC|TSSOP|MSOP|SSOP|SOP|LGA|SC-?70)\b/gi;
  function pinCounts(text) {
    const t = String(text || ''), out = new Set();
    for (const m of t.matchAll(PIN_PKG)) out.add(+m[1]);
    for (const m of t.matchAll(/\b(?:SOT|SC|TO)-?\d{2,3}-(\d{1,2})\b/gi)) out.add(+m[1]);
    for (const m of t.matchAll(/\b(\d{1,3})[ -]?pins?\b/gi)) out.add(+m[1]);
    return [...out].filter(n => n >= 2);
  }

  const fmtCap = v => v >= 1e-6 ? +(v / 1e-6).toPrecision(3) + ' µF' : v >= 1e-9 ? +(v / 1e-9).toPrecision(3) + ' nF' : +(v / 1e-12).toPrecision(3) + ' pF';
  const fmtRes = v => v >= 1e6 ? +(v / 1e6).toPrecision(3) + ' MΩ' : v >= 1e3 ? +(v / 1e3).toPrecision(3) + ' kΩ' : +v.toPrecision(3) + ' Ω';

  Fab.parts = { decode, parseDesc, expectedMfr, fmtCap, fmtRes, PREFIX_MFR, valueOf, isValueLabel, samePn, alnum, fpPartTokens, commonPrefix, namesPart,
    tiPackage, fpFamily, sameFamily, pinCounts, TI_FAMILY };
})(window.Fab);
