// In-memory fake of the GitHub git-data API that GitHubStore uses, for testing run storage without a
// token. Load it in the page, then: const gh = FakeGitHub(); Fab.repoRuns.setFetch(gh.fetch);
// gh.stats counts uploaded blob bytes; gh.deny = true makes writes fail with 403.
(function () {
  'use strict';
  async function sha1Hex(bytes) {
    const d = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function gitSha(body) {
    const head = new TextEncoder().encode('blob ' + body.length + '\0');
    const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length);
    return sha1Hex(all);
  }
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };

  window.FakeGitHub = function () {
    const blobs = new Map(), trees = new Map(), commits = new Map();
    let n = 0;
    const id = p => p + (++n).toString(16).padStart(39, '0');
    const root = id('t'); trees.set(root, new Map());
    const c0 = id('c'); commits.set(c0, { tree: root, parents: [] });
    let head = c0;
    const gh = { stats: { blobPosts: 0, blobBytes: 0, commits: 0 }, deny: false, blobs, trees, commits, get head() { return head; } };
    const ok = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
    const fail = (status, message) => ok({ message }, status);
    gh.fetch = async (url, opts) => {
      const u = new URL(url), m = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : null;
      const p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
      if (gh.deny && m !== 'GET') return fail(403, 'Resource not accessible by personal access token');
      let r;
      if (m === 'GET' && (r = /^\/git\/ref\/heads\/(.+)$/.exec(p))) return ok({ object: { sha: head } });
      if (m === 'GET' && (r = /^\/git\/commits\/(\w+)$/.exec(p))) { const c = commits.get(r[1]); return c ? ok({ sha: r[1], tree: { sha: c.tree } }) : fail(404, 'Not Found'); }
      if (m === 'GET' && (r = /^\/git\/trees\/(\w+)$/.exec(p))) {
        const t = trees.get(r[1]);
        return ok({ tree: [...t].map(([path, e]) => ({ path, type: 'blob', sha: e.sha, size: e.size })) });
      }
      if (m === 'POST' && p === '/git/blobs') {
        const bytes = unb64(body.content);
        const sha = await gitSha(bytes);
        blobs.set(sha, bytes);
        gh.stats.blobPosts++; gh.stats.blobBytes += bytes.length;
        return ok({ sha }, 201);
      }
      if (m === 'GET' && (r = /^\/git\/blobs\/(\w+)$/.exec(p))) { const b = blobs.get(r[1]); return b ? ok({ content: b64(b), encoding: 'base64' }) : fail(404, 'Not Found'); }
      if (m === 'POST' && p === '/git/trees') {
        const t = new Map(trees.get(body.base_tree));
        for (const e of body.tree) {
          if (e.sha === null) { t.delete(e.path); continue; }
          let sha = e.sha;
          if (e.content != null) { const bytes = new TextEncoder().encode(e.content); sha = await gitSha(bytes); blobs.set(sha, bytes); }
          if (!blobs.has(sha)) return fail(422, 'Tree references an unknown blob ' + sha);
          t.set(e.path, { sha, size: blobs.get(sha).length });
        }
        const tid = id('t'); trees.set(tid, t);
        return ok({ sha: tid }, 201);
      }
      if (m === 'POST' && p === '/git/commits') { const cid = id('c'); commits.set(cid, { tree: body.tree, parents: body.parents }); return ok({ sha: cid, html_url: 'https://github.com/fake/commit/' + cid }, 201); }
      if (m === 'PATCH' && (r = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
        const c = commits.get(body.sha);
        if (!c || c.parents[0] !== head) return fail(422, 'Update is not a fast forward');
        head = body.sha; gh.stats.commits++;
        return ok({ object: { sha: head } });
      }
      return fail(404, 'Not Found: ' + m + ' ' + p);
    };
    return gh;
  };
})();
