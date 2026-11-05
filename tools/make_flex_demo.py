"""Build the made-up Smart Thermostat sensor flex, a test and demo package for Fabcheck's flex checks.

    python tools/make_flex_demo.py            write demo/thermostat-sensor-flex.zip
    python tools/make_flex_demo.py --check    fail if the committed file is out of date

Nothing here comes from a real design. DT-1045 rev A is a 2-layer HDI flex that joins the Acme Climate
Smart Thermostat's main board to a remote temperature sensor. It is laid out like an Altium release of
a flex, as Altium writes one in Gerber X2 (see docs/flex.md):
  - mechanical layers typed Design_Outline (GM1), Coverlay_Top (GM4), Coverlay_Bottom (GM5),
    Stiffener_Top (GM20) and Stiffener_Bottom (GM21), and no board profile file;
  - a layer-name label below the board on every layer;
  - top covered by coverlay (a film with openings), bottom by solder mask (the fine-pitch connector),
    and an empty bottom coverlay layer.

Planted problems (the Flex HDI profile finds these):
  - no board profile: the outline comes from the Design_Outline layer;
  - a notch in the outline with sharp inside corners (tear risk);
  - C1's pad 1 opening only 0.03 mm over the pad; webs of coverlay between C1 and R1 under 0.5 mm;
  - J2 (top, at the sensor end) with no stiffener behind it;
  - layer labels below the board (copper outside the board), an empty bottom coverlay layer;
  - a via 0.5 mm from the top stiffener's edge;
  - a laser via with a thin capture ring;
  - vias, a solid pour and traces stacked on both layers in the flexible area.
"""
import hashlib
import io
import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_demo_boards import Gerber, text_strokes, status, DATE  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'demo' / 'thermostat-sensor-flex.zip'
B = dict(name='DT-1045 Sensor Flex', file='DT-1045', rev='A', guid='5B0E7C21-9D3A-4F10-8E45-1045A0000001', variant=None)
W, H = 40.0, 12.0
NOTCH = (18.0, 22.0, 10.0)                       # x1, x2, depth from the bottom (sharp inside corners)
OUTLINE = [(0, 0), (W, 0), (W, H), (NOTCH[1], H), (NOTCH[1], NOTCH[2]), (NOTCH[0], NOTCH[2]), (NOTCH[0], H), (0, H)]
STIFF_TOP = [(0, 0), (10, 0), (10, H), (0, H)]   # behind J1 (bottom)
STIFF_BOT = [(28, 0), (36, 0), (36, H), (28, H)]  # behind U1, C1, R1 (top); J2 is past its end

# Parts: (des, side, x, y, pads [(pin, x, y, w, h)], comment, footprint, mpn, mfr, desc)
def row(x0, y0, n, pitch, w, h, vertical=True):
    return [(str(i + 1), x0 if vertical else x0 + i * pitch, y0 + i * pitch if vertical else y0, w, h) for i in range(n)]

PARTS = [
    ('J1', 'bottom', 5.5, 6.0, row(5.5, 4.75, 6, 0.5, 1.2, 0.25), 'FH19C-6S-0.5SH(10)', 'FPC-6P-0.5', 'FH19C-6S-0.5SH(10)', 'Hirose', 'CONN FFC BOTTOM 6POS 0.50MM R/A'),
    ('U1', 'top', 32.5, 6.0, [('1', 31.9, 5.5, 0.25, 0.6), ('2', 31.9, 6.0, 0.25, 0.6), ('3', 31.9, 6.5, 0.25, 0.6),
                              ('4', 33.1, 6.5, 0.25, 0.6), ('5', 33.1, 6.0, 0.25, 0.6), ('6', 33.1, 5.5, 0.25, 0.6)],
     'TMP117AIDRVR', 'WSON-6', 'TMP117AIDRVR', 'Texas Instruments', 'SENSOR DIGITAL -55C-150C 6WSON'),
    ('C1', 'top', 30.0, 9.0, [('1', 29.52, 9.0, 0.5, 0.6), ('2', 30.48, 9.0, 0.5, 0.6)], 'GRM155R71C104KA88D', 'C0402', 'GRM155R71C104KA88D', 'Murata', 'CAP CER 0.1UF 16V X7R 0402'),
    ('R1', 'top', 31.9, 9.0, [('1', 31.42, 9.0, 0.5, 0.6), ('2', 32.38, 9.0, 0.5, 0.6)], 'RC0402FR-0710KL', 'R0402', 'RC0402FR-0710KL', 'Yageo', 'RES SMD 10K OHM 1% 1/16W 0402'),
    ('J2', 'top', 38.6, 6.0, row(38.6, 3.75, 4, 1.5, 1.2, 0.6), 'AC-FPC-04-1.5', 'FPC-4P-1.5', 'AC-FPC-04-1.5', 'Acme Connect', 'CONN FPC TOP 4POS 1.50MM, sensor end'),
]
TIGHT = ('C1', '1')        # its coverlay opening is only 0.03 mm over the pad
VIAS = [  # (x, y, drill, pad)  through vias; 0.15 mm are laser vias
    (11.5, 4.75, 0.15, 0.30), (11.5, 5.25, 0.15, 0.30), (11.5, 5.75, 0.15, 0.22),   # thin ring (0.035 mm)
    (11.5, 6.25, 0.15, 0.30), (11.5, 6.75, 0.15, 0.30), (11.5, 7.25, 0.15, 0.30),
    (10.5, 2.0, 0.25, 0.55),   # 0.5 mm from the top stiffener's edge
    (20.0, 3.0, 0.25, 0.55),   # in the flexible area
    (26.5, 3.0, 0.25, 0.55), (26.5, 8.0, 0.25, 0.55),
]
TOP_TRACES = [[(11.5, 4.75), (26.5, 4.75), (31.0, 5.5), (31.9, 5.5)], [(11.5, 5.75), (13.0, 6.25), (26.5, 6.25), (31.9, 6.0)],
              [(11.5, 6.75), (26.5, 6.75), (31.0, 6.5), (31.9, 6.5)], [(33.1, 6.0), (36.5, 6.0), (38.6, 6.75)],
              [(33.1, 5.5), (36.5, 4.5), (38.6, 3.75)], [(30.48, 9.0), (31.42, 9.0)], [(29.52, 9.0), (29.0, 8.0), (26.5, 8.0)]]
BOT_TRACES = [[(5.5, 4.75), (11.5, 4.75)], [(5.5, 5.25), (11.5, 5.25)], [(5.5, 5.75), (11.5, 5.75)], [(5.5, 6.25), (11.5, 6.25)],
              [(5.5, 6.75), (11.5, 6.75)], [(5.5, 7.25), (11.5, 7.25)],
              [(11.5, 5.25), (26.5, 5.25)], [(11.5, 6.25), (26.5, 6.25)],   # under the top traces: stacked
              [(11.5, 7.25), (20.0, 7.25), (20.0, 3.0), (26.5, 3.0)], [(17.0, 1.6), (20.0, 1.6), (20.0, 3.0)]]
POUR = [(13.0, 0.8), (17.0, 0.8), (17.0, 2.4), (13.0, 2.4)]   # solid copper on the bottom, flexible area
TRACE_W = 0.127


def label(g, text, fn='NonConductor', w=0.15):
    for pl in text_strokes(text, 0.0, -3.0, 1.0):
        g.path(w, pl, fn)


def pads(side):
    for des, s, x, y, ps, *_ in PARTS:
        if s == side:
            for pin, px, py, w, h in ps:
                yield des, pin, px, py, w, h


def gerbers():
    out = {}
    f = B['file']
    for side, ext, order, fn in (('top', 'GTL', 1, 'Copper,L1,Top,Signal'), ('bottom', 'GBL', 2, 'Copper,L2,Bot,Signal')):
        g = Gerber(B, fn, order=order)
        for des, pin, x, y, w, h in pads(side):
            g.flash(x, y, 'R', w, h, 'SMDPad,CuDef')
        for x, y, d, pad in VIAS:
            g.flash(x, y, 'C', pad, pad, 'ViaPad')
        for t in (TOP_TRACES if side == 'top' else BOT_TRACES):
            g.path(TRACE_W, t)
        if side == 'bottom':
            g.region(POUR)
        label(g, 'L%d %s' % (order, side.upper()), 'NonConductor')
        out['%s.%s' % (f, ext)] = g.text()
    # Masks (negative: flashes are openings). Top is covered by coverlay, so its mask is only a label.
    for side, ext in (('top', 'GTS'), ('bottom', 'GBS')):
        g = Gerber(B, 'Soldermask,%s' % ('Top' if side == 'top' else 'Bot'), polarity='Negative')
        if side == 'bottom':
            for des, pin, x, y, w, h in pads(side):
                g.flash(x, y, 'R', w + 0.1, h + 0.1, 'SMDPad,CuDef')
        label(g, 'MASK ' + side.upper(), None)
        out['%s.%s' % (f, ext)] = g.text()
    for side, ext in (('top', 'GTP'), ('bottom', 'GBP')):
        g = Gerber(B, 'Paste,%s' % ('Top' if side == 'top' else 'Bot'))
        for des, pin, x, y, w, h in pads(side):
            if des != 'J2':
                g.flash(x, y, 'R', w * 0.9, h * 0.9, 'SMDPad,CuDef')
        label(g, 'PASTE ' + side.upper(), None)
        out['%s.%s' % (f, ext)] = g.text()
    for side, ext in (('top', 'GTO'), ('bottom', 'GBO')):
        g = Gerber(B, 'Legend,%s' % ('Top' if side == 'top' else 'Bot'))
        if side == 'top':
            for pl in text_strokes('DT-1045 A', 13.0, 8.6, 1.0):
                g.path(0.15, pl, None)
        label(g, 'SILK ' + side.upper(), None)
        out['%s.%s' % (f, ext)] = g.text()
    # Mechanical layers, as Altium types them.
    g = Gerber(B, 'Other,Design_Outline')
    g.path(0.1, OUTLINE + [OUTLINE[0]], None)
    label(g, 'OUTLINE', None)
    out['%s.GM1' % f] = g.text()
    g = Gerber(B, 'Other,Coverlay_Top')
    g.region(OUTLINE, None)
    g.pol('C')
    for des, pin, x, y, w, h in pads('top'):
        if des == 'U1':
            continue
        e = 0.03 if (des, pin) == TIGHT else 0.10
        g.flash(x, y, 'R', w + 2 * e, h + 2 * e, None)
    g.flash(32.5, 6.0, 'R', 1.75, 1.8, None)   # U1: one gang opening
    g.pol('D')
    label(g, 'COVERLAY TOP', None)
    out['%s.GM4' % f] = g.text()
    g = Gerber(B, 'Other,Coverlay_Bottom')
    label(g, 'COVERLAY BOTTOM', None)
    out['%s.GM5' % f] = g.text()
    for name, poly, ext in (('Stiffener_Top', STIFF_TOP, 'GM20'), ('Stiffener_Bottom', STIFF_BOT, 'GM21')):
        g = Gerber(B, 'Other,' + name)
        g.region(poly, None)
        label(g, name.upper().replace('_', ' '), None)
        out['%s.%s' % (f, ext)] = g.text()
    return out


def drill():
    tools = sorted({round(d, 3) for _, _, d, _ in VIAS})
    c = lambda v: '%08d' % int(round(v * 1e4))
    lines = ['M48', ';FILE_FORMAT=4:4', 'METRIC,LZ', ';TYPE=PLATED'] + ['T%02dF00S00C%.4f' % (i + 1, t) for i, t in enumerate(tools)] + ['%', 'G90', 'G05']
    rep = ['-' * 130, 'NCDrill File Report For: %s.PcbDoc   11/04/2026  3:42:00 PM' % B['file'], '-' * 130, '',
           'Layer Pair : Top Layer to Bottom Layer', 'ASCII RoundHoles File : %s.TXT' % B['file'], '',
           'Tool       Hole Size               Hole Tolerance               Hole Type       Hole Count   Plated         Tool Travel', '-' * 130]
    for i, t in enumerate(tools):
        lines.append('T%02d' % (i + 1))
        hs = [(x, y) for x, y, d, _ in VIAS if round(d, 3) == t]
        lines += ['X%sY%s' % (c(x), c(y)) for x, y in sorted(hs, key=lambda h: (h[1], h[0]))]
        size = '%smm (%dmil)' % (('%.3f' % t).rstrip('0').rstrip('.'), round(t / 0.0254))
        rep.append('T%-6d %-24s %-28s %-15s %-12d %-14s 0.00mm (0.00inch)' % (i + 1, size, '', 'Round', len(hs), 'PTH'))
    lines.append('M30')
    rep += ['-' * 130, 'Totals' + ' ' * 78 + str(len(VIAS)), '', 'Total Processing Time (hh:mm:ss) : 00:00:00', '']
    return '\n'.join(lines) + '\n', '\n'.join(rep)


def pnp():
    head = ('Designator', 'Comment', 'Layer', 'Footprint', 'Center-X(mm)', 'Center-Y(mm)', 'Rotation', 'Description')
    rows = [(d, cm, 'TopLayer' if s == 'top' else 'BottomLayer', fp, '%.3f' % x, '%.3f' % y, '0', '"%s"' % desc) for d, s, x, y, _, cm, fp, mpn, mfr, desc in PARTS if mpn]
    widths = [max(len(r[i]) for r in rows + [head]) + 1 for i in range(len(head))]
    fmt = lambda r: ''.join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip()
    out = ['Altium Designer Pick and Place Locations', '%s %s' % (B['name'], B['rev']), '', '=' * 120, 'File Design Information:', '',
           'Date:       04/11/26', 'Time:       15:42', 'Revision:   %s' % B['rev'], 'Variant:    No variations', 'Units used: mm', '', fmt(head)]
    return '\n'.join(out + [fmt(r) for r in rows]) + '\n'


def bom():
    head = ['Comment', 'Description', 'Designator', 'Footprint', 'Quantity', 'Manufacturer 1', 'Manufacturer Part Number 1', 'Manufacturer Lifecycle 1']
    rows = [[cm, desc, d, fp, '1', mfr, mpn, 'Volume Production'] for d, s, x, y, _, cm, fp, mpn, mfr, desc in PARTS if mpn]
    q = lambda s: '"' + s.replace('"', '""') + '"'
    return '\n'.join(','.join(q(c) for c in r) for r in [head] + rows) + '\n'


def package():
    top = OUT.name[:-4] + '/'
    files = {}
    gb = gerbers()
    for name, text in gb.items():
        files['Manufacturing/Fabrication/GerberX2/' + name] = text
    drl, drr = drill()
    files['Manufacturing/Fabrication/NC Drill/%s.TXT' % B['file']] = drl
    files['Manufacturing/Fabrication/NC Drill/%s.DRR' % B['file']] = drr
    files['Manufacturing/Fabrication/Status Report.Txt'] = status(B, ('Gerber X2 Files', 'GerberX2'), sorted(gb))
    files['Manufacturing/Assembly/Pick Place/Pick Place for %s.txt' % B['file']] = pnp()
    files['Manufacturing/Assembly/BOM/Bill of Materials-%s.csv' % B['file']] = bom()
    files['README.txt'] = ('Fabcheck demo flex: %s, rev %s.\n' % (B['name'], B['rev']) +
                           'Made up for the Dovetail Signoff demo (Acme Climate Smart Thermostat). Not a real design.\n'
                           'Made by tools/make_flex_demo.py in the pcb_dfm repository.\n')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            zi = zipfile.ZipInfo(top + name, DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, files[name].replace('\n', '\r\n').encode('utf-8'))
    return buf.getvalue()


def main():
    data = package()
    if '--check' in sys.argv:
        if not OUT.exists() or OUT.read_bytes() != data:
            raise SystemExit('Out of date: %s. Run python tools/make_flex_demo.py' % OUT.name)
        print('Flex demo up to date.')
        return
    OUT.write_bytes(data)
    print('%-32s %8d bytes  sha256 %s' % (OUT.name, len(data), hashlib.sha256(data).hexdigest()[:16]))


if __name__ == '__main__':
    main()
