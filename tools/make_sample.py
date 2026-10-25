"""Build the demo's sample package, demo/fabcheck-sample-board.zip, from the Handle V4 package.

    python tools/make_sample.py "C:/path/to/<handle package>.zip"

The source package stays on the build machine; only the scrubbed result is committed. The words the
result must not contain (client name, part number, date) are kept out of this public repo: put one per
line in tools/sample-forbid.txt (git-ignored). The script won't run without it.

Scrub (nothing identifying leaves):
  - bottom silkscreen: everything removed except the "Dovetail" mark; "DEMO" is added beside it.
    The ODB++ bottom silkscreen layer is emptied for the same reason.
  - dropped: PDFs (title blocks), Altium reports with local paths (.REP, .LDP), the ODB++ .tgz/.zip
    copies (unscrubbed), and the empty netlist report.
  - pick-and-place: the output path and revision hash are blanked; BOM author cleared.

Tune (one finding per check, so the demo reads cleanly):
  - mounting holes: 5 of the 6 that were wrongly plated become non-plated (one breakout left).
  - 0.65 mm connector holes drilled at 0.60 mm (the ring check keeps only the mounting hole).
  - mask: 2 of 4 connector openings on top shrunk (one mask dam left); all 4 on the bottom.
  - top silkscreen: 0.1016 mm strokes widened to 0.1524 mm (the 0.100 mm one stays); the pin-1 tick
    over one pad removed (the other silk-on-pad stays).
  - BOM: two "Unknown" lifecycles set to Volume Production (one left).
  - planes: necks in the plane clearances opened up, all but one.

Plant (a few more problems):
  - a drill hit duplicated on a via (hole-gap error)
  - a BOM quantity that disagrees with its designators (qty error)
  - R19's description says 47 kΩ while its part number is 4.7 kΩ (pn-desc error)
  - C22 rotated 90° in the pick-and-place (rotation warning)
"""
import io
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'demo' / 'fabcheck-sample-board.zip'
TOP = 'fabcheck-sample-board/'
FORBID = ROOT / 'tools' / 'sample-forbid.txt'

DROP = re.compile(r'\.(pdf|rep|ldp|tgz)$|/ODB/[^/]+\.zip$', re.I)
DOVETAIL_BOX = (0.9, 11.7, 2.8, 19.8)        # mm: the "Dovetail" mark on the bottom silkscreen
ISLANDS = {                                   # copper stranded by those cuts: cleared too (spot, diameter)
    'Handle_Copper_Plane_1.gbr': [((42.06, 6.66), 1.2), ((42.28, 7.96), 0.8)],
    'Handle_Copper_Plane_2.gbr': [((42.06, 6.66), 1.2), ((0.97, 7.56), 0.7)],
}
NECKS = {                                     # neck and hairline spots to open up, by plane (one neck stays)
    'Handle_Copper_Plane_1.gbr': [(41.51, 7.0), (35.33, 17.62), (11.83, 10.42), (37.61, 7.55), (4.46, 22.2), (42.38, 8.42), (42.38, 7.52)],
    'Handle_Copper_Plane_2.gbr': [(0.83, 7.15), (31.16, 21.27), (5.51, 10.95), (41.51, 7.0), (40.38, 20.67), (31.23, 22.47), (2.03, 19.85), (42.38, 10.95), (42.38, 7.52)],
}


# ---------------------------------------------------------------- Gerber editing
class Gerber:
    """Just enough RS-274X to drop, retarget and add objects without disturbing the rest."""

    def __init__(self, text):
        m = re.search(r'%FSLAX(\d)(\d)Y\d\d\*%', text)
        self.dec = int(m.group(2))
        # Tokens: extended blocks %...% and plain words ending in '*'.
        self.tokens = re.findall(r'%[^%]*%|[^%*\s][^*]*\*', text)

    def num(self, s):
        return int(s) / 10 ** self.dec

    def fmt(self, v):
        return str(int(round(v * 10 ** self.dec)))

    def _coord(self, t, x, y):
        mx, my = re.search(r'X(-?\d+)', t), re.search(r'Y(-?\d+)', t)
        return (self.num(mx.group(1)) if mx else x), (self.num(my.group(1)) if my else y)

    def objects(self):
        """Yield ((first, last) token index, kind, points, end point) for draws, flashes and regions."""
        x = y = 0.0
        i, n = 0, len(self.tokens)
        while i < n:
            t = self.tokens[i]
            if t.startswith('G36'):
                j, pts = i + 1, []
                while not self.tokens[j].startswith('G37'):
                    if self.tokens[j][:1] in 'XY':
                        x, y = self._coord(self.tokens[j], x, y)
                        pts.append((x, y))
                    j += 1
                yield (i, j), 'R', pts, (x, y)
                i = j + 1
                continue
            if re.fullmatch(r'D0?3\*', t):
                yield (i, i), 'D3', [(x, y)], (x, y)
                i += 1
                continue
            m = re.search(r'D0?([123])\*$', t)
            if m and t[:1] in 'XYIJG':
                x0, y0 = x, y
                x, y = self._coord(t, x, y)
                if m.group(1) == '1':
                    yield (i, i), 'D1', [(x0, y0), (x, y)], (x, y)
                elif m.group(1) == '3':
                    yield (i, i), 'D3', [(x, y)], (x, y)
            i += 1

    def drop(self, keep):
        """Drop objects for which keep(kind, points) is false, leaving the pen where it was."""
        repl = {}
        for (a, b), kind, pts, end in list(self.objects()):
            if keep(kind, pts):
                continue
            repl[a] = [f'X{self.fmt(end[0])}Y{self.fmt(end[1])}D02*']
            for k in range(a + 1, b + 1):
                repl[k] = []
        out = []
        for k, t in enumerate(self.tokens):
            out += repl.get(k, [t])
        self.tokens = out

    def reflash(self, at, code, tol=0.02):
        """Flash the D03s at the given points with aperture `code` instead."""
        cur, out, x, y = None, [], 0.0, 0.0
        for t in self.tokens:
            m = re.fullmatch(r'D(\d+)\*', t)
            if m and int(m.group(1)) >= 10:            # an aperture select (D01-D03 are operations)
                cur = m.group(1)
            if re.search(r'D0?3\*$', t) and (t[:1] in 'XY' or re.fullmatch(r'D0?3\*', t)):
                if t[:1] in 'XY':
                    x, y = self._coord(t, x, y)
                if any(abs(x - px) < tol and abs(y - py) < tol for px, py in at):
                    out += [f'D{code}*', t, f'D{cur}*']
                    continue
            elif re.search(r'D0?[12]\*$', t) and t[:1] in 'XYIJG':
                x, y = self._coord(t, x, y)
            out.append(t)
        self.tokens = out

    def define(self, code, dia):
        k = next(k for k, t in enumerate(self.tokens) if t.startswith('%ADD'))
        self.tokens.insert(k, f'%ADD{code}C,{dia:.5f}*%')

    def add(self, tokens):
        end = next(k for k in range(len(self.tokens) - 1, -1, -1) if self.tokens[k].startswith('M02'))
        self.tokens[end:end] = ['%LPD*%'] + tokens

    def result(self):
        # The file's MD5 no longer matches the edited content; drop it rather than ship a wrong one.
        return '\n'.join(t for t in self.tokens if not t.startswith('%TF.MD5')) + '\n'


def inside(pts, box):
    return all(box[0] <= x <= box[2] and box[1] <= y <= box[3] for x, y in pts)


def demo_strokes(g, code):
    """"DEMO" in stroke letters, in the bottom-silk column beside "Dovetail": letters advance in -y,
    their tops toward -x, like the original text."""
    glyphs = {
        'D': [[(0, 0), (0, 1.2), (0.5, 1.2), (0.8, 0.9), (0.8, 0.3), (0.5, 0), (0, 0)]],
        'E': [[(0.8, 1.2), (0, 1.2), (0, 0), (0.8, 0)], [(0, 0.6), (0.6, 0.6)]],
        'M': [[(0, 0), (0, 1.2), (0.4, 0.6), (0.8, 1.2), (0.8, 0)]],
        'O': [[(0.25, 0), (0.55, 0), (0.8, 0.25), (0.8, 0.95), (0.55, 1.2), (0.25, 1.2), (0, 0.95), (0, 0.25), (0.25, 0)]],
    }
    base_x, y0, adv = 5.05, 18.9, 1.25
    out = [f'D{code}*']
    for i, ch in enumerate('DEMO'):
        for stroke in glyphs[ch]:
            pts = [(base_x - v, y0 - i * adv - u) for u, v in stroke]
            out.append(f'X{g.fmt(pts[0][0])}Y{g.fmt(pts[0][1])}D02*')
            out += [f'X{g.fmt(x)}Y{g.fmt(y)}D01*' for x, y in pts[1:]]
    return out


def edit_gerbers(files):
    gd = 'Manufacturing/Fabrication/GerberX2/'
    # Bottom silkscreen: only "Dovetail", plus "DEMO".
    g = Gerber(files[gd + 'Handle_Legend_Bot.gbr'])
    g.drop(lambda kind, pts: inside(pts, DOVETAIL_BOX))
    g.define(990, 0.2)
    g.add(demo_strokes(g, 990))
    files[gd + 'Handle_Legend_Bot.gbr'] = g.result()

    # Top silkscreen: widen the 0.1016 mm strokes; remove the pin-1 tick over a pad near (7.0, 9.5).
    g = Gerber(files[gd + 'Handle_Legend_Top.gbr'].replace('%ADD59C,0.10160*%', '%ADD59C,0.15240*%'))
    g.drop(lambda kind, pts: not (kind == 'D1' and inside(pts, (6.85, 9.39, 7.12, 9.66))))
    files[gd + 'Handle_Legend_Top.gbr'] = g.result()

    # Mask: smaller openings on the 0.65 mm connector, leaving one dam on top.
    conn = [(27.559, 11.557), (27.559, 12.827), (27.559, 14.097), (27.559, 15.367)]
    for name, pads in (('Handle_Soldermask_Top.gbr', conn[:2]), ('Handle_Soldermask_Bot.gbr', conn)):
        g = Gerber(files[gd + name])
        g.define(991, 1.05)
        g.reflash(pads, 991)
        files[gd + name] = g.result()

    # Planes are negative: a dark flash clears copper, which opens up a neck.
    for name, spots in NECKS.items():
        g = Gerber(files[gd + name])
        g.define(992, 0.35)
        g.add(['D992*'] + [f'X{g.fmt(x)}Y{g.fmt(y)}D03*' for x, y in spots])
        for k, ((x, y), d) in enumerate(ISLANDS.get(name, [])):
            g.define(993 + k, d)
            g.add([f'D{993 + k}*', f'X{g.fmt(x)}Y{g.fmt(y)}D03*'])
        files[gd + name] = g.result()


# ---------------------------------------------------------------- drill
def edit_drill(files):
    path = 'Manufacturing/Fabrication/NC Drill/Handle.TXT'
    tools, hits, tool, x, y, body = {}, [], None, 0.0, 0.0, False
    for ln in files[path].splitlines():
        m = re.match(r'T(\d+)F00S00C([\d.]+)$', ln)
        if m:
            tools[int(m.group(1))] = float(m.group(2))
        elif ln == '%':
            body = True
        elif body and re.match(r'T\d+$', ln):
            tool = int(ln[1:])
        elif body and ln[:1] in 'XY':
            val = lambda s: int((s + '0' * 8)[:8]) / 1e4          # 4:4, leading zeros kept
            mx, my = re.search(r'X(\d+)', ln), re.search(r'Y(\d+)', ln)
            x = val(mx.group(1)) if mx else x
            y = val(my.group(1)) if my else y
            hits.append([tool, x, y])
    plated = {1: True, 2: True, 3: True, 4: True, 5: True, 6: False, 7: True, 8: False, 9: False}
    tools.update({7: 0.6, 8: 2.0, 9: 3.0})
    near = lambda h, p: abs(h[1] - p[0]) < 0.02 and abs(h[2] - p[1]) < 0.02
    for h in hits:
        if h[0] == 2:
            h[0] = 7                                   # ring fixed: 0.60 mm drill
        elif h[0] == 4:
            h[0] = 8                                   # 2 mm mounting holes: non-plated
        elif h[0] == 5 and not near(h, (40.72, 5.24)):
            h[0] = 9                                   # 3 mm mounting hole: non-plated
    via = next(h for h in hits if h[0] == 1)
    hits.append([1, via[1], via[2]])                   # planted: a duplicate drill hit
    used = [t for t in (1, 2, 7, 3, 4, 5, 6, 8, 9) if any(h[0] == t for h in hits)]
    out = ['M48', ';FILE_FORMAT=4:4', 'METRIC,LZ', ';TYPE=PLATED']
    out += [f'T{t:02d}F00S00C{tools[t]:.4f}' for t in used if plated[t]]
    out.append(';TYPE=NON_PLATED')
    out += [f'T{t:02d}F00S00C{tools[t]:.4f}' for t in used if not plated[t]]
    out += ['%', 'G90', 'G05']
    f = lambda v: f'{int(round(v * 1e4)):08d}'
    for t in used:
        out.append(f'T{t:02d}')
        out += [f'X{f(h[1])}Y{f(h[2])}' for h in hits if h[0] == t]
    out.append('M30')
    files[path] = '\n'.join(out) + '\n'

    # Drill report to match.
    drr = 'Manufacturing/Fabrication/NC Drill/Handle.DRR'
    lines = files[drr].splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('T1 '))
    end = next(i for i in range(start, len(lines)) if lines[i].startswith('---'))
    rows = []
    for t in used:
        n = sum(1 for h in hits if h[0] == t)
        size = f'{tools[t]:g}mm ({round(tools[t] / 0.0254)}mil)'
        rows.append(f'T{t:<6d} {size:<24s}{"":34s}Round{"":13s}{n:<10d}{"PTH" if plated[t] else "NPTH":<15s}0.00mm (0.00inch)')
    lines[start:end] = rows
    tot = next(i for i, l in enumerate(lines) if l.startswith('Totals'))
    lines[tot] = f'Totals{"":78s}{len(hits)}'
    files[drr] = '\n'.join(lines) + '\n'


# ---------------------------------------------------------------- assembly data
def edit_pnp(files):
    path = 'Manufacturing/Assembly/Pick Place/Pick Place for Handle(Build).txt'
    lines = files[path].splitlines()
    lines[1] = 'Fabcheck demo sample'
    lines = [re.sub(r'^(Revision:\s*).*$', r'\1', l) for l in lines]
    # Planted: C22 rotated 90° (its line keeps its column layout).
    col = next(l for l in lines if l.startswith('Designator')).index('Rotation')
    for i, l in enumerate(lines):
        if l.startswith('C22 '):
            rot = int(float(l[col:col + 8]))
            lines[i] = l[:col] + f'{(rot + 90) % 360:<8d}' + l[col + 8:]
    files[path] = '\n'.join(lines) + '\n'


def edit_bom(files):
    path = 'Manufacturing/Assembly/BOM/Bill of Materials-ActiveBOM(Build).xlsx'
    src = zipfile.ZipFile(io.BytesIO(files[path]))
    parts = {n: src.read(n) for n in src.namelist()}
    sst = parts['xl/sharedStrings.xml'].decode('utf-8')
    text = [re.sub(r'<[^>]+>', '', s) for s in re.findall(r'<si>(.*?)</si>', sst, re.S)]
    sheet = parts['xl/worksheets/sheet1.xml'].decode('utf-8')

    def cell(ref):
        return re.search(rf'<c r="{ref}"[^>]*?(?:/>|>.*?</c>)', sheet, re.S)

    def col_of(header):
        m = re.search(rf'<c r="([A-Z]+)1"[^>]*t="s"[^>]*><v>{text.index(header)}</v></c>', sheet)
        return m.group(1)

    def row_of(col, value):
        m = re.search(rf'<c r="{col}(\d+)"[^>]*t="s"[^>]*><v>{text.index(value)}</v></c>', sheet)
        return int(m.group(1))

    def set_cell(ref, xml):
        nonlocal sheet
        m = cell(ref)
        sheet = sheet[:m.start()] + xml + sheet[m.end():]

    def add_string(s):
        nonlocal sst
        text.append(s)
        sst = sst.replace('</sst>', f'<si><t>{s}</t></si></sst>')
        return len(text) - 1

    life, mpn, qty, desc = (col_of(h) for h in ('Manufacturer Lifecycle 1', 'Manufacturer Part Number 1', 'Quantity', 'Description'))
    vol = text.index('Volume Production') if 'Volume Production' in text else add_string('Volume Production')
    for part in ('SWT0315-050025GSA', 'TPT75176H-VS1R'):
        r = row_of(mpn, part)
        set_cell(f'{life}{r}', f'<c r="{life}{r}" t="s"><v>{vol}</v></c>')
    # Planted: R19's description says 47 kΩ (its part number decodes to 4.7 kΩ).
    r = row_of(mpn, 'CRCW04024K70FKED')
    d = text[int(re.search(r'<v>(\d+)</v>', cell(f'{desc}{r}').group(0)).group(1))]
    assert '4.7k' in d, d
    set_cell(f'{desc}{r}', f'<c r="{desc}{r}" t="s"><v>{add_string(d.replace("4.7k", "47k"))}</v></c>')
    # Planted: the quantity on the 220 nF line is one too many.
    r = row_of(mpn, 'CC0402KRX5R6BB224')
    q = cell(f'{qty}{r}').group(0)
    v = re.search(r'<v>(\d+)</v>', q).group(1)
    n = int(text[int(v)]) if 't="s"' in q else int(v)
    set_cell(f'{qty}{r}', f'<c r="{qty}{r}"><v>{n + 1}</v></c>')

    parts['xl/sharedStrings.xml'] = re.sub(r'uniqueCount="\d+"', f'uniqueCount="{len(text)}"', sst).encode('utf-8')
    parts['xl/worksheets/sheet1.xml'] = sheet.encode('utf-8')
    parts['docProps/core.xml'] = re.sub(rb'<dc:creator>.*?</dc:creator>', b'<dc:creator>Fabcheck demo</dc:creator>', parts['docProps/core.xml'])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in src.namelist():
            z.writestr(zipfile.ZipInfo(n, date_time=(2026, 10, 1, 0, 0, 0)), parts[n], zipfile.ZIP_DEFLATED)
    files[path] = buf.getvalue()


def edit_odb(files):
    path = 'Manufacturing/Assembly/ODB/odb/steps/pcb/layers/bottom_overlay/features'
    files[path] = files[path].split('#Layer features')[0] + '#Layer features\n#\n'


# ---------------------------------------------------------------- main
def main(src):
    z = zipfile.ZipFile(src)
    files = {}
    for info in z.infolist():
        if info.is_dir() or DROP.search(info.filename) or info.filename.endswith('handle_netlist.rep'):
            continue
        data = z.read(info.filename)
        files[info.filename] = data if info.filename.lower().endswith('.xlsx') else data.decode('utf-8', 'surrogateescape')
    edit_gerbers(files)
    edit_drill(files)
    edit_pnp(files)
    edit_bom(files)
    edit_odb(files)
    files['README.txt'] = ('Fabcheck demo sample board.\n'
                           'A scrubbed copy of a Dovetail board, with planted problems for the demo.\n'
                           'Made by tools/make_sample.py in the pcb_dfm repository.\n')
    forbid = [w.strip() for w in FORBID.read_text(encoding='utf-8').splitlines() if w.strip()]
    pattern = re.compile('|'.join([r'C:\\', r'Users\\'] + [re.escape(w) for w in forbid]), re.I)
    for name, data in files.items():
        blob = data if isinstance(data, str) else data.decode('latin-1')
        if pattern.search(blob) or pattern.search(name):
            sys.exit(f'refusing to write: {name} still contains a local path or a word from {FORBID.name}')
    OUT.parent.mkdir(exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as out:
        for name in sorted(files):
            data = files[name]
            info = zipfile.ZipInfo(TOP + name, date_time=(2026, 10, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, data.encode('utf-8', 'surrogateescape') if isinstance(data, str) else data)
    OUT.write_bytes(buf.getvalue())
    print(f'wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, {len(files)} files)')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if not FORBID.exists():
        sys.exit(f'missing {FORBID.relative_to(ROOT)}: one forbidden word per line (see the top of this script)')
    main(sys.argv[1])
