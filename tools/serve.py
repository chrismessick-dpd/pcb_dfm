"""Dev server for Fabcheck.

Serves the Dovetail tools folder (the parent of pcb_dfm), so Fabcheck and Signoff share one origin:
they link to each other and share the light/dark setting. Optionally serves a folder of sample
packages read-only at /__sample/. Sample packages are client data and stay where they are; nothing
is copied into this repo.

    python tools/serve.py --samples "C:/path/to/packages" --port 8767

Then open http://127.0.0.1:8767/pcb_dfm/?pkg=/__sample/<package>.zip (repeat ?pkg= to open a
baseline and a candidate together). Signoff is at http://127.0.0.1:8767/ee_design_review/.
"""
import argparse
import functools
import http.server
import os
import posixpath
import urllib.parse

TOOL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(TOOL)  # the tools folder that holds pcb_dfm/ and ee_design_review/


class Handler(http.server.SimpleHTTPRequestHandler):
    samples = None

    def translate_path(self, path):
        path = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if path.startswith('/__sample/') and self.samples:
            rel = posixpath.normpath(path[len('/__sample/'):]).lstrip('/')
            if rel.startswith('..'):
                return os.path.join(ROOT, '__nope__')
            return os.path.join(self.samples, *rel.split('/'))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        self.send_error(405)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8767)
    ap.add_argument('--samples', help='folder served read-only at /__sample/')
    a = ap.parse_args()
    Handler.samples = os.path.abspath(a.samples) if a.samples else None
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', a.port), handler) as srv:
        print(f'Fabcheck at http://127.0.0.1:{a.port}/{os.path.basename(TOOL)}/  samples: {Handler.samples or "-"}')
        srv.serve_forever()


if __name__ == '__main__':
    main()
