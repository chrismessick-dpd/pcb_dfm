// File ingestion: dropped files/folders, picked files, zip archives, or a URL (dev ?pkg=).
// Everything stays in memory in this tab; nothing is uploaded.
(function (Fab) {
  'use strict';

  function makeFile(path, bytes) {
    path = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const name = path.split('/').pop();
    const dot = name.lastIndexOf('.');
    let txt = null;
    return {
      path, name, ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : '', size: bytes.length, bytes,
      text() { return txt == null ? (txt = Fab.decodeText(bytes)) : txt; },
    };
  }

  async function expandZip(bytes, prefix) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load from the CDN');
    const zip = await JSZip.loadAsync(bytes);
    const out = [];
    const entries = Object.values(zip.files).filter(e => !e.dir);
    for (const e of entries) {
      const data = await e.async('uint8array');
      out.push(makeFile((prefix ? prefix + '/' : '') + e.name, data));
    }
    return out;
  }

  // Top-level zips are expanded. Zips found inside a package (e.g. ODB++ archives) are kept as files.
  async function fromBlobs(items) {
    let files = [];
    let source = null;
    for (const it of items) {
      const bytes = new Uint8Array(await it.blob.arrayBuffer());
      if (/\.zip$/i.test(it.path) && !/\//.test(it.path.replace(/^\/+/, ''))) {
        files = files.concat(await expandZip(bytes, ''));
        // Keep the archive itself: the Archive tab hashes it and compares it with other copies.
        if (items.length === 1) source = { name: it.path, bytes };
      } else files.push(makeFile(it.path, bytes));
    }
    files = stripCommonRoot(files);
    files.source = source;
    return files;
  }

  function stripCommonRoot(files) {
    if (files.length < 2) return files;
    const first = files[0].path.split('/');
    let n = 0;
    while (n < first.length - 1 && files.every(f => f.path.split('/')[n] === first[n] && f.path.split('/').length > n + 1)) n++;
    if (n) for (const f of files) f.path = f.path.split('/').slice(n).join('/');
    return files;
  }

  // A drop's DataTransfer is only readable during the drop event; afterwards the browser empties it.
  // Call this synchronously in the handler and pass the result to fromDrop() later.
  function captureDrop(dt) {
    const entries = [];
    if (dt.items) for (const it of dt.items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) entries.push(e); }
    return { entries, files: Array.from(dt.files || []) };
  }

  // Dropped files come straight from drop.files: FileSystemEntry.file() can fail in Chrome with an
  // EncodingError ("A URI supplied to the API was malformed…") for some Windows paths. Entries are
  // only walked for dropped folders, which have no other API.
  async function fromDrop(drop) {
    const items = [];
    const entries = drop.entries;
    const byName = new Map(drop.files.map(f => [f.name, f]));
    if (entries.some(e => e.isDirectory)) {
      const failed = [];
      const walk = async (entry, path) => {
        if (entry.isFile) {
          const direct = !path && byName.get(entry.name);
          try {
            const blob = direct || await new Promise((res, rej) => entry.file(res, rej));
            items.push({ path: path + entry.name, blob });
          } catch (e) { failed.push(path + entry.name); }
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          let batch;
          do {
            batch = await new Promise((res, rej) => reader.readEntries(res, rej));
            for (const e of batch) await walk(e, path + entry.name + '/');
          } while (batch.length);
        }
      };
      for (const e of entries) await walk(e, '');
      if (failed.length && !items.length) throw new Error(`The browser could not read the dropped folder (${failed.length} files). Use "Choose folder…" instead.`);
      const files = await fromBlobs(items);
      files.unread = failed;
      return files;
    }
    for (const f of drop.files) items.push({ path: f.name, blob: f });
    return fromBlobs(items);
  }

  async function fromDataTransfer(dt) { return fromDrop(captureDrop(dt)); }

  async function fromFileList(list) {
    return fromBlobs(Array.from(list).map(f => ({ path: f.webkitRelativePath || f.name, blob: f })));
  }

  async function fromUrl(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Fetch failed: ' + r.status + ' ' + url);
    const blob = await r.blob();
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'package.zip';
    return fromBlobs([{ path: name, blob }]);
  }

  Fab.loader = { captureDrop, fromDrop, fromDataTransfer, fromFileList, fromUrl, makeFile };
})(window.Fab);
