"""Build the demo's sample package: demo/fabcheck-sample-board.zip.

A small, made-up 2-layer board (no client data) drawn directly as Gerber X2, Excellon, pick-and-place
and a CSV BOM, with a few deliberate problems so the demo has something to show:

  - a 0.10 mm trace and two traces 0.09 mm apart (below Standard's 0.127 mm)
  - a via with a 0.10 mm ring (Standard wants 0.13 mm)
  - a trace 0.15 mm from the board edge (Standard wants 0.30 mm)
  - silkscreen across a resistor pad, and a 0.10 mm silkscreen line
  - R4 placed 90° off from the other resistors
  - BOM: R3's part number says 100k but its value says 10k; C2's Murata part listed as Samsung;
    D1's lifecycle is Obsolete

Run:  python tools/make_sample.py
"""
import io
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'demo' / 'fabcheck-sample-board.zip'
NAME = 'fabcheck-sample'
W, H = 50.0, 35.0
NOTCH = (20.0, 30.0, 31.0)  # x from, x to, y bottom of a notch cut into the top edge


def c(v):
    return str(int(round(v * 1e6)))


class Gerber:
    def __init__(self, function, polarity='Positive'):
        self.lines = ['G04 Fabcheck demo sample: synthetic board, not a real design*',
                      '%TF.GenerationSoftware,Dovetail,make_sample.py,1*%',
                      f'%TF.FileFunction,{function}*%', f'%TF.FilePolarity,{polarity}*%',
                      '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%']
        self.aps = {}
        self.body = []

    def ap(self, shape, fn, *dims):
        key = (shape, fn, dims)
        if key not in self.aps:
            n = 10 + len(self.aps)
            self.aps[key] = n
            if fn:
                self.lines.append(f'%TA.AperFunction,{fn}*%')
            self.lines.append(f'%ADD{n}{shape},' + 'X'.join(f'{d:g}' for d in dims) + '*%')
            if fn:
                self.lines.append('%TD*%')
        return self.aps[key]

    def flash(self, x, y, shape, w, h=None, fn=None):
        n = self.ap(shape, fn, *((w,) if h is None else (w, h)))
        self.body += [f'D{n}*', f'X{c(x)}Y{c(y)}D03*']

    def line(self, pts, width, fn='Conductor'):
        n = self.ap('C', fn, width)
        self.body.append(f'D{n}*')
        self.body.append(f'X{c(pts[0][0])}Y{c(pts[0][1])}D02*')
        for x, y in pts[1:]:
            self.body.append(f'X{c(x)}Y{c(y)}D01*')

    def text(self):
        return '\n'.join(self.lines + ['G01*'] + self.body + ['M02*']) + '\n'


# ---- parts: designator, x, y, rotation, footprint, pads [(dx, dy, w, h)] ----
R0603 = [(-0.8, 0, 0.9, 0.95), (0.8, 0, 0.9, 0.95)]
C0402 = [(-0.5, 0, 0.6, 0.6), (0.5, 0, 0.6, 0.6)]
SOIC8 = [(-2.7, 1.905 - 1.27 * i, 1.55, 0.6) for i in range(4)] + [(2.7, -1.905 + 1.27 * i, 1.55, 0.6) for i in range(4)]
parts = [
    ('R1', 8, 10, 0, 'RESC1608X55N', R0603), ('R2', 8, 14, 0, 'RESC1608X55N', R0603),
    ('R3', 8, 18, 0, 'RESC1608X55N', R0603), ('R4', 8, 22, 0, 'RESC1608X55N', R0603),
    ('C1', 32, 8, 0, 'CAPC1005X55N', C0402), ('C2', 32, 12, 0, 'CAPC1005X55N', C0402), ('C3', 32, 16, 0, 'CAPC1005X55N', C0402),
    ('D1', 32, 22, 0, 'LEDC1608X80N', R0603),
    ('U1', 20, 16, 0, 'SOIC127P600X175-8N', SOIC8),
]
pnp_rot = {'R4': 90}  # the deliberate rotation error
THT = [(44, 15.73), (44, 18.27)]  # J1, 2.54 mm header
VIAS = [(14, 10), (14, 22), (26, 10), (6, 27), (22, 27.29), (8, 33), (26, 22, 0.5)]  # last one: small pad, 0.10 mm ring
NPTH = [(4, 4), (46, 4), (4, 31), (46, 31)]

top, bot = Gerber('Copper,L1,Top,Signal'), Gerber('Copper,L2,Bot,Signal')
mtop, mbot = Gerber('Soldermask,Top', 'Negative'), Gerber('Soldermask,Bot', 'Negative')
silk, paste = Gerber('Legend,Top'), Gerber('Paste,Top')
prof = Gerber('Profile,NP')

pads = {}
for des, x, y, rot, fp, pl in parts:
    for i, (dx, dy, w, h) in enumerate(pl):
        px, py = x + dx, y + dy
        pads[(des, i + 1)] = (px, py)
        top.flash(px, py, 'R', w, h, 'SMDPad,CuDef')
        mtop.flash(px, py, 'R', w + 0.1, h + 0.1)
        paste.flash(px, py, 'R', w, h)
    # Silkscreen outline around each part.
    ext = max(abs(dx) + w / 2 for dx, dy, w, h in pl) + 0.35, max(abs(dy) + h / 2 for dx, dy, w, h in pl) + 0.35
    silk.line([(x - ext[0], y - ext[1]), (x + ext[0], y - ext[1]), (x + ext[0], y + ext[1]), (x - ext[0], y + ext[1]), (x - ext[0], y - ext[1])], 0.15, None)
silk.line([(7.0, 9.4), (7.4, 10.6)], 0.15, None)       # crosses R1 pad 1
silk.line([(29.5, 26), (35, 26)], 0.10, None)          # too thin
for x, y in THT:
    for g in (top, bot):
        g.flash(x, y, 'C', 1.7, None, 'ComponentPad')
    for m in (mtop, mbot):
        m.flash(x, y, 'C', 1.8)
silk.line([(42.6, 14.3), (45.4, 14.3), (45.4, 19.7), (42.6, 19.7), (42.6, 14.3)], 0.15, None)
for v in VIAS:
    x, y, d = (v + (0.6,))[:3]
    for g in (top, bot):
        g.flash(x, y, 'C', d, None, 'ViaPad')

# Traces (0.2 mm), plus the deliberate ones.
T = 0.2
top.line([pads[('R1', 2)], (14, 10)], T)
top.line([pads[('R4', 2)], (14, 22)], T)
top.line([pads[('R2', 2)], (12, 14), (12, 15.365), (pads[('U1', 2)][0] - 1, 15.365), pads[('U1', 2)]], T)
top.line([pads[('R3', 2)], (12, 18), (12, 16.635)], T)
top.line([(12, 16.635), (16, 16.635)], 0.10)  # thin trace
top.line([(16, 16.635), (pads[('U1', 3)][0] - 1, 16.635), pads[('U1', 3)]], T)
top.line([pads[('U1', 8)], (24.5, pads[('U1', 8)][1]), (24.5, 10), (26, 10)], T)
top.line([pads[('C1', 1)], (28, 8), (28, 10), (26, 10)], T)
top.line([pads[('C3', 2)], (36, 16), (36, 15.73), (44, 15.73)], T)
top.line([pads[('D1', 2)], (38, 22), (38, 18.27), (44, 18.27)], T)
top.line([pads[('U1', 5)], (24, pads[('U1', 5)][1]), (24, 22), (26, 22)], T)
# Two traces 0.09 mm apart (edge to edge) for 2 mm: centers 0.29 mm apart at 0.2 mm width. Each ends on a via.
top.line([(6, 27), (14, 27)], T)
top.line([(12, 27.29), (22, 27.29)], T)
# A trace whose end comes within 0.15 mm of the top edge (y = 35).
top.line([(8, 33), (17, 33), (17, 34.75)], T)
bot.line([(14, 10), (14, 22)], T)
bot.line([(26, 10), (40, 10), (44, 15.73)], T)
bot.line([(26, 22), (40, 22), (44, 18.27)], T)

# Outline with a notch in the top edge (two sharp inside corners).
x0, x1, ny = NOTCH
prof.line([(0, 0), (W, 0), (W, H), (x1, H), (x1, ny), (x0, ny), (x0, H), (0, H), (0, 0)], 0.1, 'Profile')


def excellon(plated, holes):
    out = ['M48', f';TYPE={"PLATED" if plated else "NON_PLATED"}', ';FILE_FORMAT=4:4', 'METRIC,LZ']
    tools = sorted({d for _, _, d in holes})
    for i, d in enumerate(tools, 1):
        out.append(f'T{i}C{d:.3f}')
    out.append('%')
    out.append('G90')
    out.append('G05')
    for i, d in enumerate(tools, 1):
        out.append(f'T{i}')
        out += [f'X{x:.4f}Y{y:.4f}' for x, y, dd in holes if dd == d]
    out.append('M30')
    return '\n'.join(out) + '\n'


pth = [(x, y, 1.0) for x, y in THT] + [(v[0], v[1], 0.3) for v in VIAS]
npth = [(x, y, 3.2) for x, y in NPTH]

pnp = ['Pick and Place for fabcheck-sample (synthetic demo board)', 'Units used: mm', '',
       '"Designator","Comment","Layer","Footprint","Center-X(mm)","Center-Y(mm)","Rotation","Description"']
COMMENT = {'R': 'Resistor', 'C': 'Capacitor', 'D': 'LED', 'U': 'Op amp'}
for des, x, y, rot, fp, pl in parts:
    pnp.append(f'"{des}","{COMMENT[des[0]]}","TopLayer","{fp}","{x:.3f}","{y:.3f}","{pnp_rot.get(des, rot)}","{COMMENT[des[0]]}"')
pnp.append(f'"J1","Header 2","TopLayer","HDR1X2","44.000","17.000","90","Header"')

bom = ['Designator,Quantity,Value,Description,Manufacturer,Manufacturer Part Number,Lifecycle',
       '"R1, R2, R4",3,10k,"RES 10K OHM 1% 1/10W 0603",Yageo,RC0603FR-0710KL,Volume Production',
       'R3,1,10k,"RES 10K OHM 1% 1/10W 0603",Yageo,RC0603FR-07100KL,Volume Production',
       '"C1, C3",2,100nF,"CAP CER 100NF 16V X7R 0402",Murata,GRM155R71C104KA88D,Volume Production',
       'C2,1,1uF,"CAP CER 1UF 16V X5R 0402",Samsung,GRM155R61C105KA12D,Volume Production',
       'D1,1,Green,"LED GREEN 0603",Lite-On,LTST-C191KGKT,Obsolete',
       'U1,1,OPA2333,"IC OPAMP 2 CIRCUIT 8SOIC",Texas Instruments,OPA2333AIDR,Volume Production',
       'J1,1,Header 2,"CONN HEADER 2POS 2.54MM",Wurth,61300211121,Volume Production']

files = {
    f'Gerber/{NAME}.GTL': top.text(), f'Gerber/{NAME}.GBL': bot.text(),
    f'Gerber/{NAME}.GTS': mtop.text(), f'Gerber/{NAME}.GBS': mbot.text(),
    f'Gerber/{NAME}.GTO': silk.text(), f'Gerber/{NAME}.GTP': paste.text(),
    f'Gerber/{NAME}.GKO': prof.text(),
    f'NC Drill/{NAME}-RoundHoles-Plated.TXT': excellon(True, pth),
    f'NC Drill/{NAME}-RoundHoles-NonPlated.TXT': excellon(False, npth),
    f'Assembly/Pick Place for {NAME}.csv': '\n'.join(pnp) + '\n',
    f'Assembly/{NAME}-BOM.csv': '\n'.join(bom) + '\n',
    'README.txt': 'Fabcheck demo sample. A synthetic board drawn by tools/make_sample.py; not a real or client design.\n',
}
OUT.parent.mkdir(exist_ok=True)
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in sorted(files):
        info = zipfile.ZipInfo(f'{NAME}/{path}', date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, files[path])
OUT.write_bytes(buf.getvalue())
print(f'wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)')
