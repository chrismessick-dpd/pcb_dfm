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
    [/^(CC|RC|RT|AC|CQ)\d{4}/i, ['yageo']],
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

  const fmtCap = v => v >= 1e-6 ? +(v / 1e-6).toPrecision(3) + ' µF' : v >= 1e-9 ? +(v / 1e-9).toPrecision(3) + ' nF' : +(v / 1e-12).toPrecision(3) + ' pF';
  const fmtRes = v => v >= 1e6 ? +(v / 1e6).toPrecision(3) + ' MΩ' : v >= 1e3 ? +(v / 1e3).toPrecision(3) + ' kΩ' : +v.toPrecision(3) + ' Ω';

  Fab.parts = { decode, parseDesc, expectedMfr, fmtCap, fmtRes, PREFIX_MFR };
})(window.Fab);
