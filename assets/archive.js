// Archive checks: package fingerprint, nested archives (ODB++ .zip/.tgz) vs the extracted tree,
// and comparison with another copy of the package. Everything runs in the browser.
(function (Fab) {
  'use strict';

  // ---- SHA-256 (WebCrypto when available; small JS fallback for file:// where it is not) ----
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256js(bytes) {
    const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes); m[n] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
  }
  async function sha256(bytes) {
    if (window.crypto && crypto.subtle) {
      const d = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
    }
    return sha256js(bytes);
  }

  // ---- tar (for .tgz) ----
  function untar(bytes) {
    const out = [];
    const str = (o, l) => { let s = ''; for (let i = o; i < o + l && bytes[i]; i++) s += String.fromCharCode(bytes[i]); return s; };
    let o = 0, longName = null;
    while (o + 512 <= bytes.length) {
      const name0 = str(o, 100);
      if (!name0) break;
      const size = parseInt(str(o + 124, 12).trim() || '0', 8);
      const type = String.fromCharCode(bytes[o + 156] || 48);
      const prefix = str(o + 345, 155);
      const data = bytes.subarray(o + 512, o + 512 + size);
      if (type === 'L') longName = str(o + 512, size);
      else if (type === '0' || type === '\0' || type === '7') {
        out.push({ path: longName || (prefix ? prefix + '/' : '') + name0, bytes: data });
        longName = null;
      } else if (type !== 'x' && type !== 'g') longName = null;
      o += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
  }

  async function readArchive(file) {
    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file.bytes);
      const out = [];
      for (const e of Object.values(zip.files)) if (!e.dir) out.push({ path: e.name, bytes: await e.async('uint8array') });
      return out;
    }
    if (/\.(tgz|tar\.gz)$/i.test(file.name)) {
      if (typeof pako === 'undefined') throw new Error('pako failed to load from the CDN');
      return untar(pako.ungzip(file.bytes));
    }
    return null;
  }

  // Path relative to the ODB++ job root: drop everything up to and including the job folder that
  // holds matrix/, steps/, misc/…
  function odbRel(path) {
    const m = /(?:^|\/)((?:matrix|steps|misc|fonts|symbols|input|wheels|ext|user)\/.*)$/i.exec(path);
    return m ? m[1].toLowerCase() : null;
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function diffTrees(a, b) { // a, b: Map(rel -> bytes)
    const onlyA = [], onlyB = [], changed = [];
    let same = 0;
    for (const [k, v] of a) { if (!b.has(k)) onlyA.push(k); else if (sameBytes(v, b.get(k))) same++; else changed.push(k); }
    for (const k of b.keys()) if (!a.has(k)) onlyB.push(k);
    return { onlyA, onlyB, changed, same };
  }

  // Compare each nested ODB++ archive with the extracted odb/ tree in the package.
  async function inspect(pkg, log) {
    log = log || (() => {});
    const res = { archives: [], fingerprint: null };
    if (pkg.source) {
      res.fingerprint = { name: pkg.source.name, size: pkg.source.bytes.length, sha256: await sha256(pkg.source.bytes) };
      log(`SHA-256 of ${pkg.source.name}: ${res.fingerprint.sha256}`);
    }
    const tree = new Map();
    for (const f of pkg.files) if (f.cls.type === 'odb') { const k = odbRel(f.path); if (k) tree.set(k, f.bytes); }
    for (const f of pkg.files.filter(f => f.cls.type === 'odb-archive' || f.cls.type === 'archive')) {
      const a = { file: f.path, size: f.size };
      try {
        const entries = await readArchive(f);
        if (!entries) { a.error = 'Unsupported archive type'; res.archives.push(a); continue; }
        a.entries = entries.length;
        const m = new Map();
        for (const e of entries) { const k = odbRel(e.path); if (k) m.set(k, e.bytes); }
        a.odbEntries = m.size;
        if (m.size && tree.size) a.diff = diffTrees(m, tree);
        log(`${f.path}: ${entries.length} entries` + (a.diff ? `, ${a.diff.same} identical to odb/, ${a.diff.changed.length} differ, ${a.diff.onlyA.length} only in archive, ${a.diff.onlyB.length} only in folder` : ''));
      } catch (e) { a.error = String(e.message || e); log(`${f.path}: ${a.error}`); }
      res.archives.push(a);
    }
    res.treeFiles = tree.size;
    return res;
  }

  // Compare two loaded packages file by file (byte-exact), plus whole-archive hashes when known.
  async function compareCopies(pa, pb) {
    const out = { hashA: null, hashB: null };
    if (pa.source) out.hashA = await sha256(pa.source.bytes);
    if (pb.source) out.hashB = await sha256(pb.source.bytes);
    const ma = new Map(pa.files.map(f => [f.path, f.bytes])), mb = new Map(pb.files.map(f => [f.path, f.bytes]));
    out.files = diffTrees(ma, mb);
    out.identical = out.hashA && out.hashA === out.hashB;
    return out;
  }

  Fab.archive = { sha256, sha256js, untar, inspect, compareCopies, diffTrees };
})(window.Fab);
