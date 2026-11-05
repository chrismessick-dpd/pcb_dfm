"""Build the Smart Thermostat demo boards, made up from scratch for the suite demo.

    python tools/make_demo_boards.py            write demo/thermostat-*.zip and demo/boards.js
                                                (and the sensor flex, from tools/make_flex_demo.py)
    python tools/make_demo_boards.py --check    fail if the committed files are out of date

Nothing here comes from a real design. The boards tell the suite demo's story (see ../CLAUDE.md,
*Demo suite*): the Acme Climate Smart Thermostat's Main PCBA (DT-1042 rev B, Signoff EE `pdemo7`) and
Display & Sensor Board (DT-1043 rev A, `pdemo11`). Each package is laid out like an Altium release:
Gerber X2, NC drill with its report, pick-and-place, BOM, IPC-356 netlist and status reports.

Planted problems, so a run has something to say (and Signoff EE's demo issues point at them):
  Main PCBA:   a 0.10 mm trace under the Wi-Fi module; USB-C shell pads and slots too close to the
               board edge; D3/D4 polarity marks printed over their pads; a via with a thin ring next
               to U4; mask dams under J2's 0.5 mm pitch pads; D2 placed 180° off; C41 (added in rev
               B) without a part number; K2 marked NRND.
  Display:     vias drilled at 0.20 mm under U3; a via in U3's thermal pad; NPTH display pegs too
               close to copper; a 0.10 mm silkscreen logo; a copper island left in the pour; R7's
               footprint says 0402 while its part number is 0603.

The output is deterministic (fixed dates, sorted zip entries), so the packages' SHA-256 only changes
when this script does. demo/boards.js lists the boards and their fixed demo run ids for Fabcheck's
demo, which opens a board when a Signoff EE demo link names its run.
"""
import hashlib
import io
import json
import math
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / 'demo'
DATE = (2026, 10, 27, 15, 42, 0)
GEN = '%TF.GenerationSoftware,Altium Limited,Altium Designer,26.9.1 (10)*%'

# ── stroke font (0..4 wide, 0..6 high), for the silkscreen ──────────────────
FONT = {
    'A': [[(0, 0), (0, 4), (2, 6), (4, 4), (4, 0)], [(0, 3), (4, 3)]],
    'B': [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)], [(3, 3), (4, 2), (4, 1), (3, 0), (0, 0)]],
    'C': [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)]],
    'D': [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 1), (3, 0), (0, 0)]],
    'E': [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    'F': [[(0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    'G': [[(4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0), (3, 0), (4, 1), (4, 3), (2, 3)]],
    'H': [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    'I': [[(1, 0), (3, 0)], [(2, 0), (2, 6)], [(1, 6), (3, 6)]],
    'J': [[(0, 1), (1, 0), (2, 0), (3, 1), (3, 6)]],
    'K': [[(0, 0), (0, 6)], [(4, 6), (0, 2)], [(1, 3), (4, 0)]],
    'L': [[(0, 6), (0, 0), (4, 0)]],
    'M': [[(0, 0), (0, 6), (2, 3), (4, 6), (4, 0)]],
    'N': [[(0, 0), (0, 6), (4, 0), (4, 6)]],
    'O': [[(1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 1), (3, 0), (1, 0)]],
    'P': [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)]],
    'Q': [[(1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 1), (3, 0), (1, 0)], [(2, 2), (4, 0)]],
    'R': [[(0, 0), (0, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)], [(2, 3), (4, 0)]],
    'S': [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5)]],
    'T': [[(0, 6), (4, 6)], [(2, 6), (2, 0)]],
    'U': [[(0, 6), (0, 1), (1, 0), (3, 0), (4, 1), (4, 6)]],
    'V': [[(0, 6), (2, 0), (4, 6)]],
    'W': [[(0, 6), (1, 0), (2, 3), (3, 0), (4, 6)]],
    'X': [[(0, 0), (4, 6)], [(0, 6), (4, 0)]],
    'Y': [[(0, 6), (2, 3), (4, 6)], [(2, 3), (2, 0)]],
    'Z': [[(0, 6), (4, 6), (0, 0), (4, 0)]],
    '0': [[(1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 1), (3, 0), (1, 0)], [(0, 1), (4, 5)]],
    '1': [[(1, 5), (2, 6), (2, 0)], [(1, 0), (3, 0)]],
    '2': [[(0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (0, 0), (4, 0)]],
    '3': [[(0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (4, 2), (4, 1), (3, 0), (1, 0), (0, 1)], [(1, 3), (3, 3)]],
    '4': [[(3, 0), (3, 6), (0, 2), (4, 2)]],
    '5': [[(4, 6), (0, 6), (0, 3), (3, 3), (4, 2), (4, 1), (3, 0), (0, 0)]],
    '6': [[(4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)]],
    '7': [[(0, 6), (4, 6), (1, 0)]],
    '8': [[(1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (1, 3), (0, 2), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3)]],
    '9': [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 4), (1, 3), (4, 3)]],
    '-': [[(1, 3), (3, 3)]],
    '+': [[(0, 3), (4, 3)], [(2, 1), (2, 5)]],
    '.': [[(2, 0), (2, 0.4)]],
    '/': [[(0, 0), (4, 6)]],
    '~': [[(0, 3), (1, 4), (3, 2), (4, 3)]],
}


def text_strokes(s, x, y, h, anchor='l', rot=0):
    """Polylines for text of cap height h at (x, y) (left/center of the baseline)."""
    k = h / 6.0
    adv = 5.5 * k
    width = len(s) * adv - 1.5 * k
    x0 = {'l': 0, 'c': -width / 2, 'r': -width}[anchor]
    out = []
    for i, ch in enumerate(s.upper()):
        for pl in FONT.get(ch, []):
            pts = [(x0 + i * adv + px * k, py * k) for px, py in pl]
            out.append([rot_pt(p, rot, x, y) for p in pts])
    return out


def rot_pt(p, rot, ox=0.0, oy=0.0, mirror=False):
    x, y = p
    if mirror:
        x = -x
    a = math.radians(rot)
    c, s = math.cos(a), math.sin(a)
    return (ox + x * c - y * s, oy + x * s + y * c)


# ── footprints ────────────────────────────────────────────────────────────
# Pads: (pin, x, y, shape, w, h, drill). shape R (rectangle), O (obround), C (circle).
# drill > 0 is a plated through-hole; a (w, l) tuple is a plated slot (vertical in the footprint).
class Fp:
    def __init__(self, name, pads, body, paste=1.0, outline=None, pin1=None, ep_paste=None):
        self.name, self.pads, self.body = name, pads, body
        self.paste = paste          # paste scale for SMD pads
        self.outline = outline      # silk rectangle (w, h), default body + 0.4
        self.pin1 = pin1            # silk pin-1 dot (x, y), or None
        self.ep_paste = ep_paste    # windowed paste for an exposed pad: (pin, n per side)


def two_pin(name, pitch, w, h, body):
    return Fp(name, [('1', -pitch / 2, 0, 'R', w, h, 0), ('2', pitch / 2, 0, 'R', w, h, 0)], body)


def qfn(name, n_side, pitch, size, pad_w, pad_l, ep):
    pads, pin = [], 1
    span = (n_side - 1) * pitch
    edge = size / 2 - pad_l / 2 + 0.1
    for side in range(4):
        for i in range(n_side):
            t = -span / 2 + i * pitch
            if side == 0:
                pads.append((str(pin), -edge, span / 2 - i * pitch, 'R', pad_l, pad_w, 0))
            elif side == 1:
                pads.append((str(pin), t, -edge, 'R', pad_w, pad_l, 0))
            elif side == 2:
                pads.append((str(pin), edge, -span / 2 + i * pitch, 'R', pad_l, pad_w, 0))
            else:
                pads.append((str(pin), -t, edge, 'R', pad_w, pad_l, 0))
            pin += 1
    pads.append((str(pin), 0, 0, 'R', ep, ep, 0))
    return Fp(name, pads, (size, size), pin1=(-size / 2 - 0.5, size / 2 + 0.2), ep_paste=(str(pin), 2))


def sot23(name, n):
    if n == 3:
        pads = [('1', -0.95, -1.1, 'R', 0.6, 0.8, 0), ('2', 0.95, -1.1, 'R', 0.6, 0.8, 0), ('3', 0, 1.1, 'R', 0.6, 0.8, 0)]
    else:
        pads = [(str(i + 1), -0.95 + 0.95 * i, -1.15, 'R', 0.55, 0.9, 0) for i in range(3)] + \
               [(str(6 - i), -0.95 + 0.95 * i, 1.15, 'R', 0.55, 0.9, 0) for i in range(3)]
    return Fp(name, pads, (2.9, 1.6), outline=(3.4, 1.2), pin1=(-1.9, -1.1))


def header_row(name, n, pitch, drill, pad, square=True):
    pads = []
    for i in range(n):
        x = -(n - 1) * pitch / 2 + i * pitch
        pads.append((str(i + 1), x, 0, 'R' if (i == 0 and square) else 'C', pad, pad, drill))
    return Fp(name, pads, (n * pitch + 1.0, 6.0))


def ffc(name, n, pitch, pad_w, pad_l):
    pads = []
    span = (n - 1) * pitch
    for i in range(n):
        pads.append((str(i + 1), -span / 2 + i * pitch, 0, 'R', pad_w, pad_l, 0))
    pads.append(('MH1', -span / 2 - 2.0, -2.3, 'R', 1.8, 2.2, 0))
    pads.append(('MH2', span / 2 + 2.0, -2.3, 'R', 1.8, 2.2, 0))
    return Fp(name, pads, (span + 6.0, 5.2), outline=(span + 7.2, 5.4), pin1=(-span / 2, 1.2))


def usbc():
    pads = []
    names = ['A1', 'A4', 'B8', 'A5', 'B7', 'A6', 'A7', 'B6', 'A8', 'B5', 'B4', 'B1']
    xs = [-3.2, -2.4, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.4, 3.2]
    for nm, x in zip(names, xs):
        w = 0.6 if abs(x) > 2 else 0.3
        pads.append((nm, x, 3.6, 'R', w, 1.15, 0))
    for nm, x, y in (('S1', -4.32, 0.0), ('S2', 4.32, 0.0), ('S3', -4.32, 3.0), ('S4', 4.32, 3.0)):
        pads.append((nm, x, y, 'O', 1.1, 2.1 if y == 0 else 1.9, (0.6, 1.6 if y == 0 else 1.4)))
    return Fp('USB-C-16P', pads, (8.94, 7.3), outline=(9.6, 0.1))


def wifi_module():
    # 13.2 x 16.6 mm module; antenna end at +y (no copper under it).
    pads, pin = [], 1
    for i in range(13):
        pads.append((str(pin), -6.2, 5.6 - i * 0.8, 'R', 0.8, 0.4, 0)); pin += 1
    for i in range(9):
        pads.append((str(pin), -3.2 + i * 0.8, -7.9, 'R', 0.4, 0.8, 0)); pin += 1
    for i in range(13):
        pads.append((str(pin), 6.2, -4.0 + i * 0.8, 'R', 0.8, 0.4, 0)); pin += 1
    for i in range(3):
        for j in range(3):
            pads.append((str(pin), -1.8 + i * 1.8, -2.4 + j * 1.8, 'R', 1.2, 1.2, 0)); pin += 1
    return Fp('ESP32-C3-MINI-1', pads, (13.2, 16.6), outline=(13.6, 17.0), pin1=(-7.2, 5.6))


FP = {
    'R0402': two_pin('R0402', 1.0, 0.6, 0.5, (1.0, 0.5)),
    'C0402': two_pin('C0402', 1.0, 0.6, 0.5, (1.0, 0.5)),
    'R0603': two_pin('R0603', 1.6, 0.9, 0.95, (1.6, 0.8)),
    'C0603': two_pin('C0603', 1.6, 0.9, 0.95, (1.6, 0.8)),
    'C0805': two_pin('C0805', 1.9, 1.2, 1.4, (2.0, 1.25)),
    'C1206': two_pin('C1206', 3.0, 1.6, 1.8, (3.2, 1.6)),
    'LED0603': Fp('LED0603', [('1', -0.8, 0, 'R', 0.9, 0.95, 0), ('2', 0.8, 0, 'R', 0.9, 0.95, 0)], (1.6, 0.8), pin1=(-1.8, 0)),
    'SOD-123': Fp('SOD-123', [('1', -1.6, 0, 'R', 0.9, 1.2, 0), ('2', 1.6, 0, 'R', 0.9, 1.2, 0)], (2.7, 1.6), pin1=(-2.7, 0)),
    'IND-4x4': two_pin('IND-4x4', 3.4, 1.4, 3.6, (4.0, 4.0)),
    'SOT-23': sot23('SOT-23', 3),
    'SOT-23-6': sot23('SOT-23-6', 6),
    'QFN-32': qfn('QFN-32-5x5', 8, 0.5, 5.0, 0.25, 0.8, 3.1),
    'QFN-20': qfn('QFN-20-4x4', 5, 0.5, 4.0, 0.25, 0.8, 2.1),
    'DFN-6': Fp('DFN-6-1.5', [(str(i + 1), -0.65, 0.5 - i * 0.5, 'R', 0.5, 0.25, 0) for i in range(3)] +
                [(str(6 - i), 0.65, 0.5 - i * 0.5, 'R', 0.5, 0.25, 0) for i in range(3)], (1.5, 1.5), outline=(2.2, 2.2), pin1=(-1.3, 0.9)),
    'ODFN-6': Fp('ODFN-6-2x2', [(str(i + 1), -0.9, 0.65 - i * 0.65, 'R', 0.6, 0.35, 0) for i in range(3)] +
                 [(str(6 - i), 0.9, 0.65 - i * 0.65, 'R', 0.6, 0.35, 0) for i in range(3)], (2.0, 2.0), outline=(2.8, 2.6), pin1=(-1.6, 1.1)),
    'TB-2P': header_row('TB-5.08-2P', 2, 5.08, 1.3, 2.4),
    'TB-3P': header_row('TB-5.08-3P', 3, 5.08, 1.3, 2.4),
    'FUSE-TR5': Fp('FUSE-TR5', [('1', -2.54, 0, 'C', 1.8, 1.8, 0.8), ('2', 2.54, 0, 'C', 1.8, 1.8, 0.8)], (8.4, 4.0), outline=(8.8, 4.4)),
    'MOV-7D': Fp('MOV-7D', [('1', -2.5, 0, 'C', 1.8, 1.8, 0.8), ('2', 2.5, 0, 'C', 1.8, 1.8, 0.8)], (9.0, 4.0), outline=(9.4, 4.4)),
    'SIP-4-ACDC': Fp('SIP-4-ACDC', [('1', -11.0, 0, 'R', 2.0, 2.0, 1.0), ('2', -7.5, 0, 'C', 2.0, 2.0, 1.0),
                                    ('3', 7.5, 0, 'C', 2.0, 2.0, 1.0), ('4', 11.0, 0, 'C', 2.0, 2.0, 1.0)], (26.0, 10.0), outline=(26.4, 10.4)),
    'RELAY-SLIM': Fp('RELAY-SLIM', [('NO', -9.0, 0, 'C', 2.4, 2.4, 1.3), ('COM', -4.0, 0, 'C', 2.4, 2.4, 1.3),
                                    ('A1', 6.4, 0, 'R', 1.7, 1.7, 0.9), ('A2', 8.9, 0, 'C', 1.7, 1.7, 0.9)], (20.4, 5.2), outline=(20.8, 5.6)),
    'FFC-24P-0.5': ffc('FFC-24P-0.5', 24, 0.5, 0.28, 1.3),
    'FFC-24P-0.5-D': ffc('FFC-24P-0.5', 24, 0.5, 0.25, 1.3),
    'FPC-18P-0.5': ffc('FPC-18P-0.5', 18, 0.5, 0.25, 1.2),
    'USB-C': usbc(),
    'WIFI': wifi_module(),
    'FID': Fp('FID-1.0', [('1', 0, 0, 'C', 1.0, 1.0, 0)], (2.0, 2.0), outline=(0, 0)),
    'TP': Fp('TP-1.0', [('1', 0, 0, 'C', 1.0, 1.0, 0)], (1.0, 1.0), outline=(0, 0)),
    'KEY-9': Fp('KEY-9', [('1', 0, 0, 'C', 9.0, 9.0, 0)], (9.0, 9.0), outline=(0, 0)),
}


class Part:
    def __init__(self, des, fp, x, y, rot=0, side='top', mpn='', mfr='', desc='', comment=None, lifecycle='Volume Production',
                 pnp_rot=None, value=''):
        self.des, self.fp, self.x, self.y, self.rot, self.side = des, FP[fp], x, y, rot, side
        self.mpn, self.mfr, self.desc, self.comment, self.lifecycle = mpn, mfr, desc, comment if comment is not None else mpn, lifecycle
        if mpn and self.comment and mpn.startswith(self.comment):
            self.comment = mpn   # Altium's Comment is the part number
        self.pnp_rot = rot if pnp_rot is None else pnp_rot   # the rotation the pick-and-place reports
        self.value = value

    def pad_xy(self, px, py):
        return rot_pt((px, py), self.rot, self.x, self.y, mirror=self.side == 'bottom')

    def pads(self):
        """Board-frame pads: (pin, x, y, shape, w, h, drill)."""
        out = []
        quarter = round(self.rot / 90) % 2 == 1
        for pin, px, py, shape, w, h, drill in self.fp.pads:
            x, y = self.pad_xy(px, py)
            if quarter:
                w, h = h, w
                if isinstance(drill, tuple):
                    drill = (drill[0], drill[1], 'h')
            out.append((pin, x, y, shape, w, h, drill))
        return out


# ── the boards ────────────────────────────────────────────────────────────
Y, M, SAM, KEM, TDK = 'Yageo', 'Murata', 'Samsung Electro-Mechanics', 'KEMET', 'TDK'


def r0402(des, x, y, val, code, rot=0, side='top'):
    return Part(des, 'R0402', x, y, rot, side, 'RC0402FR-07' + code + 'L', Y, f'RES SMD {val} 1% 1/16W 0402', value=val)


def c0402(des, x, y, rot=0, side='top', val='100nF'):
    pn = {'100nF': ('GRM155R71C104KA88D', 'CAP CER 0.1UF 16V X7R 0402'), '1uF': ('GRM155R61A105KE15D', 'CAP CER 1UF 10V X5R 0402'),
          '10nF': ('GRM155R71H103KA88D', 'CAP CER 10NF 50V X7R 0402')}[val]
    return Part(des, 'C0402', x, y, rot, side, pn[0], M, pn[1], value=val)


def c0805(des, x, y, rot=0, val='10uF'):
    pn = {'10uF': ('CL21A106KAYNNNE', 'CAP CER 10UF 25V X5R 0805'), '22uF': ('CL21A226MAQNNNE', 'CAP CER 22UF 25V X5R 0805')}[val]
    return Part(des, 'C0805', x, y, rot, 'top', pn[0], SAM, pn[1], value=val)


def main_board():
    b = dict(name='DT-1042 Main PCBA', file='DT-1042', number='DT-1042', rev='B', w=80.0, h=50.7, r=2.0, layers=4, thickness=1.6,
             guid='6F1C2A9E-4B7D-4E21-9C3A-1042B0000001', zip='thermostat-main-pcba.zip', label='Main PCBA (DT-1042 rev B)',
             variant='Production', run='rdemo1042b', project='pdemo7')
    P = []
    # Mains side (left): input, fuse, MOV, AC/DC module, relays and their output terminal.
    P += [Part('J1', 'TB-2P', 5.0, 38.0, 90, mpn='1729128', mfr='Phoenix Contact', desc='TERM BLK 2POS SIDE ENTRY 5.08MM PCB', comment='MKDS 1,5/2-5,08'),
          Part('F1', 'FUSE-TR5', 13.0, 44.5, 0, mpn='37211000411', mfr='Littelfuse', desc='FUSE BRD MNT 1A 250VAC RADIAL TR5', comment='TR5 1A T'),
          Part('RV1', 'MOV-7D', 13.0, 33.0, 0, mpn='V275LA4P', mfr='Littelfuse', desc='VARISTOR 430V 1.2KA DISC 7MM'),
          Part('PS1', 'SIP-4-ACDC', 31.0, 40.0, 0, mpn='RAC02-05SK', mfr='RECOM Power', desc='AC/DC CONVERTER 5V 2W SIP-4'),
          Part('K1', 'RELAY-SLIM', 19.0, 19.0, 0, mpn='HF46F-G/5-HS1', mfr='Hongfa', desc='RELAY GEN PURPOSE SPST 5A 5V'),
          Part('K2', 'RELAY-SLIM', 19.0, 10.0, 0, mpn='HF46F-G/5-HS1', mfr='Hongfa', desc='RELAY GEN PURPOSE SPST 5A 5V', lifecycle='NRND'),
          Part('J4', 'TB-3P', 3.5, 14.0, 90, mpn='1729131', mfr='Phoenix Contact', desc='TERM BLK 3POS SIDE ENTRY 5.08MM PCB', comment='MKDS 1,5/3-5,08')]
    # Relay drivers.
    P += [Part('Q1', 'SOT-23', 34.0, 19.0, 0, mpn='MMBT3904LT1G', mfr='onsemi', desc='TRANS NPN 40V 0.2A SOT23'),
          Part('Q2', 'SOT-23', 34.0, 10.0, 0, mpn='MMBT3904LT1G', mfr='onsemi', desc='TRANS NPN 40V 0.2A SOT23'),
          Part('D1', 'SOD-123', 29.5, 23.5, 0, mpn='1N4148W-7-F', mfr='Diodes Incorporated', desc='DIODE GEN PURP 100V 300MA SOD123'),
          # D2 is the planted pin-1 error: the copper is turned 180°, the pick-and-place says 0°.
          Part('D2', 'SOD-123', 29.5, 5.0, 180, pnp_rot=0, mpn='1N4148W-7-F', mfr='Diodes Incorporated', desc='DIODE GEN PURP 100V 300MA SOD123'),
          Part('D5', 'SOD-123', 48.0, 44.0, 0, mpn='1N4148W-7-F', mfr='Diodes Incorporated', desc='DIODE GEN PURP 100V 300MA SOD123'),
          r0402('R1', 37.5, 19.0, '1k', '1K', 90), r0402('R2', 37.5, 10.0, '1k', '1K', 90)]
    # Low-voltage side (right): 3V3 buck, MCU, Wi-Fi module, USB-C, display connector, LEDs.
    P += [Part('U7', 'SOT-23-6', 47.0, 34.0, 180, mpn='TPS62162DSGR', mfr='Texas Instruments', desc='IC REG BUCK 3.3V 1A'),
          Part('L1', 'IND-4x4', 47.0, 28.5, 0, mpn='XAL4020-222MEB', mfr='Coilcraft', desc='FIXED IND 2.2UH 5.5A 35 MOHM SMD', comment='2.2uH'),
          c0805('C1', 51.5, 34.0, 90), c0805('C2', 51.5, 28.5, 90, '22uF'), c0402('C3', 44.0, 31.5, 90),
          Part('U4', 'QFN-32', 56.0, 18.0, 0, mpn='STM32G071KBU6', mfr='STMicroelectronics', desc='IC MCU 32BIT 128KB FLASH 32UFQFPN'),
          c0402('C4', 52.0, 22.5, 0), c0402('C5', 60.0, 22.5, 0), c0402('C6', 52.0, 13.5, 0), c0402('C7', 60.0, 13.5, 0),
          # C41: the 1 µF added beside U4's VDDA in rev B, still without a part number.
          Part('C41', 'C0402', 50.5, 18.0, 90, mpn='', mfr='', desc='CAP CER 1UF 10V X5R 0402', comment='1uF', value='1uF'),
          r0402('R12', 63.0, 20.0, '2.2k', '2K2', 270), r0402('R13', 64.5, 20.0, '2.2k', '2K2', 270),
          Part('U1', 'WIFI', 66.5, 39.6, 0, mpn='ESP32-C3-MINI-1-N4', mfr='Espressif Systems', desc='RF TXRX MOD WIFI/BT SMD 4MB'),
          c0805('C8', 57.5, 41.5, 90), c0402('C9', 56.5, 37.5, 0),
          Part('J3', 'USB-C', 57.0, 1.25, 0, mpn='USB4105-GF-A', mfr='GCT', desc='CONN RCPT USB2.0 TYPE-C 16POS SMD'),
          r0402('R14', 52.0, 7.5, '5.1k', '5K1', 90), r0402('R15', 62.0, 7.5, '5.1k', '5K1', 90),
          Part('J2', 'FFC-24P-0.5', 71.5, 15.0, 90, mpn='FH12-24S-0.5SH(55)', mfr='Hirose', desc='CONN FFC BOTTOM 24POS 0.50MM R/A'),
          Part('D3', 'LED0603', 64.0, 3.5, 0, mpn='150060GS75000', mfr='Wurth Elektronik', desc='LED GREEN CLEAR 0603 SMD', comment='Green'),
          Part('D4', 'LED0603', 67.5, 3.5, 0, mpn='150060RS75000', mfr='Wurth Elektronik', desc='LED RED CLEAR 0603 SMD', comment='Red'),
          r0402('R16', 64.0, 6.0, '1k', '1K'), r0402('R17', 67.5, 6.0, '1k', '1K'),
          Part('FID1', 'FID', 44.0, 3.0, 0, comment='Fiducial', desc='Fiducial'), Part('FID2', 'FID', 36.0, 47.7, 0, comment='Fiducial', desc='Fiducial'),
          Part('TP1', 'TP', 42.0, 23.0, 0, comment='TP', desc='Test point 5V'), Part('TP2', 'TP', 44.5, 23.0, 0, comment='TP', desc='Test point 3V3'),
          Part('TP3', 'TP', 47.0, 23.0, 0, comment='TP', desc='Test point GND')]
    # Bottom side: bulk and a few decoupling capacitors.
    P += [c0402('C10', 56.0, 11.5, 0, 'bottom', '10nF'), c0402('C11', 73.0, 30.0, 90, 'bottom'),
          Part('C12', 'C1206', 45.5, 40.0, 90, 'bottom', 'CL31A476MQHNNNE', SAM, 'CAP CER 47UF 6.3V X5R 1206', value='47uF')]
    b['parts'] = P
    b['nets'] = {
        'AC_L': ['J1.2', 'F1.1'], 'AC_LF': ['F1.2', 'RV1.1', 'PS1.1', 'K1.COM', 'K2.COM', 'J4.2'], 'AC_N': ['J1.1', 'RV1.2', 'PS1.2'],
        'OUT1': ['K1.NO', 'J4.3'], 'OUT2': ['K2.NO', 'J4.1'],
        'GND': ['PS1.4', 'Q1.2', 'Q2.2', 'U7.2', 'C1.2', 'C2.2', 'C3.2', 'U4.33', 'U4.4', 'C4.2', 'C5.2', 'C6.2', 'C7.2', 'C41.2', 'C8.2', 'C9.2',
                'J3.A1', 'J3.B1', 'J3.S1', 'J3.S2', 'J3.S3', 'J3.S4', 'R14.2', 'R15.2', 'J2.1', 'J2.24', 'J2.MH1', 'J2.MH2', 'TP3.1', 'C10.2', 'C11.2', 'C12.2',
                'U1.1', 'U1.2', 'U1.11', 'U1.14', 'U1.36', 'U1.37', 'U1.38', 'U1.39', 'U1.40', 'U1.41', 'U1.42', 'U1.43', 'U1.44'],
        '5V': ['PS1.3', 'K1.A1', 'K2.A1', 'D1.1', 'D2.1', 'U7.5', 'C3.1', 'J3.A4', 'J3.B4', 'D5.2', 'TP1.1', 'C12.1'],
        '3V3': ['U7.4', 'L1.1', 'C1.1', 'C2.1', 'U4.1', 'U4.17', 'C4.1', 'C5.1', 'C6.1', 'C7.1', 'C10.1', 'C41.1', 'U1.3', 'C8.1', 'C9.1', 'C11.1',
                'R12.1', 'R13.1', 'J2.2', 'J2.3', 'TP2.1'],
        'SW': ['U7.6', 'L1.2'], 'RLY1': ['K1.A2', 'D1.2', 'Q1.3'], 'RLY2': ['K2.A2', 'D2.2', 'Q2.3'],
        'RLY1_B': ['Q1.1', 'R1.1'], 'RLY2_B': ['Q2.1', 'R2.1'], 'RLY1_EN': ['R1.2', 'U4.9'], 'RLY2_EN': ['R2.2', 'U4.10'],
        'I2C_SCL': ['R12.2', 'U4.22', 'J2.5'], 'I2C_SDA': ['R13.2', 'U4.21', 'J2.6'], 'UART_TX': ['U4.25', 'U1.27'], 'UART_RX': ['U4.26', 'U1.28'],
        'USB_DP': ['J3.A6', 'U4.12'], 'USB_DN': ['J3.A7', 'U4.11'], 'CC1': ['J3.A5', 'R14.1'], 'CC2': ['J3.B5', 'R15.1'],
        'LED_G': ['D3.1', 'R16.1'], 'LED_R': ['D4.1', 'R17.1'], 'LED_GA': ['R16.2', 'U4.14'], 'LED_RA': ['R17.2', 'U4.15'],
    }
    # Traces: (layer, width, [points]); a string point is a pad. Layers: 1 top, 4 bottom.
    T = []
    T += [(1, 1.5, ['J1.2', (7.5, 43.0), 'F1.1']), (1, 1.5, ['F1.2', (19.0, 44.5), (20.0, 43.5), 'PS1.1']),
          (1, 1.5, ['RV1.1', (10.5, 36.5), (13.0, 39.0), (18.0, 39.0), 'PS1.1']), (1, 1.5, ['J1.1', (7.0, 35.46), (7.0, 30.0), (15.5, 30.0), 'RV1.2']),
          (1, 1.5, ['RV1.2', (23.5, 33.0), 'PS1.2']),
          (1, 1.5, ['J4.3', (6.0, 19.08), 'K1.NO']), (1, 1.5, ['J4.1', (6.0, 8.92), 'K2.NO']),
          (4, 1.5, ['J4.2', (12.5, 14.0), (15.0, 16.5), 'K1.COM']), (4, 1.5, [(12.5, 14.0), (15.0, 11.5), 'K2.COM']),
          (4, 1.5, ['K1.COM', (15.0, 26.0), (18.0, 29.0), (18.0, 37.5), 'PS1.1'])]
    T += [(1, 0.5, ['PS1.3', (38.5, 34.0), (41.0, 31.5), (41.0, 26.0), 'TP1.1']), (1, 0.5, ['K1.A1', (25.4, 23.5), 'D1.1']),
          (1, 0.3, ['K1.A2', (29.0, 20.1), 'Q1.3']), (1, 0.3, ['K2.A2', (29.0, 11.1), 'Q2.3']),
          (1, 0.3, ['D1.2', (31.1, 20.1)]), (1, 0.3, ['D2.2', 'K2.A2']),
          (1, 0.25, ['Q1.1', (33.05, 16.0), (37.5, 16.0), 'R1.1']), (1, 0.25, ['Q2.1', (33.05, 7.0), (37.5, 7.0), 'R2.1']),
          (1, 0.5, ['U7.6', (48.7, 31.2), 'L1.2']), (1, 0.5, ['U7.4', (46.05, 31.2), 'L1.1']),
          (1, 0.5, ['L1.1', (45.3, 25.5), (44.5, 24.7), 'TP2.1']),
          (1, 0.25, ['R12.2', (63.0, 18.75), (58.6, 18.75)]), (1, 0.25, ['R13.2', (64.5, 18.25), (58.6, 18.25)]),
          (1, 0.25, ['D3.1', (63.5, 4.8), 'R16.1']), (1, 0.25, ['D4.1', (67.0, 4.8), 'R17.1'])]
    # The planted thin trace: UART from U4 to the module, 0.10 mm for its last stretch.
    T += [(1, 0.25, ['U4.25', (57.75, 21.3), (62.2, 21.3), (62.2, 26.0), (74.0, 26.0)]),
          (1, 0.10, [(74.0, 26.0), (74.0, 38.8), 'U1.27'])]
    b['traces'] = T
    # Vias: (x, y, net). Fan-out vias are added per pad below; these are extras (stitching).
    b['vias'] = [(42.0, 46.0, 'GND'), (50.0, 46.0, 'GND'), (78.0, 42.0, 'GND'), (78.0, 8.0, 'GND'), (78.0, 25.0, 'GND'), (42.0, 6.0, 'GND'),
                 (50.0, 2.5, 'GND'), (70.0, 2.0, 'GND'), (66.0, 10.0, 'GND'), (48.0, 10.0, 'GND'), (55.0, 28.0, 'GND')]
    # The planted thin ring: one via drilled 0.30 mm in a 0.50 mm pad, beside U4.
    b['thin_via'] = (54.0, 23.5, 'GND')
    b['npth'] = [(4.0, 4.0, 3.2), (76.0, 4.0, 3.2), (4.0, 46.7, 3.2), (76.0, 46.7, 3.2)]
    # Isolation slot under the AC/DC module (rev B fix for pcb-iso-1): a routed cutout.
    b['cutouts'] = [('slot', 29.0, 36.5, 29.0, 43.5, 1.6)]
    b['mains'] = [(0, 0), (19.0, 0), (19.0, 27.0), (29.0, 27.0), (29.0, 50.7), (0, 50.7)]
    b['keepout'] = [(59.4, 47.9, 73.6, 50.7)]   # antenna end of U1
    lv = [(31.5, 0.8), (79.2, 0.8), (79.2, 49.9), (31.5, 49.9)]
    b['plane_clear'] = [(0, 0), (31.0, 0), (31.0, 50.7), (0, 50.7)]   # planes only under the low-voltage side
    b['pours'] = {}   # no pours: the outer layers stay balanced
    b['planes'] = {2: 'GND', 3: '3V3'}
    b['silk_text'] = [('DT-1042 REV B', 40.0, 47.4, 1.2, 'l'), ('ACME CLIMATE', 21.0, 2.5, 1.2, 'c'), ('~230V', 11.0, 25.4, 1.4, 'c'),
                      ('L', 1.3, 41.0, 1.0, 'c'), ('N', 1.3, 35.0, 1.0, 'c')]
    b['silk_text_bottom'] = [('DT-1042 B', 60.0, 25.0, 1.2, 'c'), ('DOVETAIL DEMO', 60.0, 21.5, 1.0, 'c')]
    # Polarity marks over the LED pads (pt4 in the Signoff EE demo): the bar sits on the cathode pad.
    b['silk_marks'] = [[(62.9, 3.0), (62.9, 4.0)], [(66.4, 3.0), (66.4, 4.0)]]
    b['mask_dam'] = ('J2', ['10', '11'])
    return b


def display_board():
    b = dict(name='DT-1043 Display & Sensor Board', file='DT-1043', number='DT-1043', rev='A', w=72.0, h=45.8, r=2.0, layers=2, thickness=1.0,
             guid='6F1C2A9E-4B7D-4E21-9C3A-1043A0000001', zip='thermostat-display-board.zip', label='Display & Sensor Board (DT-1043 rev A)',
             variant=None, run='rdemo1043a', project='pdemo11')
    P = [Part('J1', 'FFC-24P-0.5-D', 36.0, 4.5, 0, 'bottom', mpn='FH12-24S-0.5SH(55)', mfr='Hirose', desc='CONN FFC BOTTOM 24POS 0.50MM R/A', comment='FH12-24S'),
         Part('J2', 'FPC-18P-0.5', 36.0, 41.5, 180, mpn='FH34SRJ-18S-0.5SH(50)', mfr='Hirose', desc='CONN FPC BOTTOM 18POS 0.50MM R/A', comment='FH34SRJ-18S'),
         Part('U3', 'QFN-20', 18.0, 25.0, 0, mpn='CAP1214-1-AP-TR', mfr='Microchip Technology', desc='IC TOUCH SENSOR 14CH 20QFN', comment='CAP1214'),
         c0402('C1', 14.0, 25.0, 90), c0402('C2', 22.0, 25.0, 90, val='1uF'),
         Part('U7', 'SOT-23-6', 52.0, 26.0, 0, mpn='TPS61169DCKR', mfr='Texas Instruments', desc='IC LED DRIVER BOOST 1.2MHZ', comment='TPS61169'),
         Part('L2', 'IND-4x4', 52.0, 20.5, 0, mpn='XAL4020-222MEB', mfr='Coilcraft', desc='FIXED IND 2.2UH 5.5A 35 MOHM SMD', comment='2.2uH'),
         Part('D1', 'SOD-123', 57.0, 22.0, 90, mpn='BAT54HT1G', mfr='onsemi', desc='DIODE SCHOTTKY 30V 200MA SOD123', comment='BAT54H'),
         c0805('C3', 57.0, 28.0, 90), c0402('C4', 48.5, 26.0, 90),
         # U5 sits 6 mm from the boost inductor (sch-therm-4 in the Signoff EE demo).
         Part('U5', 'DFN-6', 58.0, 16.0, 0, mpn='SHT40-AD1B-R2', mfr='Sensirion', desc='SENSOR HUMID/TEMP 3.3V I2C 1.6% DFN', comment='SHT40'),
         c0402('C5', 60.5, 16.0, 90),
         Part('U6', 'ODFN-6', 36.0, 34.0, 0, mpn='OPT3001DNPR', mfr='Texas Instruments', desc='SENSOR AMBIENT LIGHT I2C USON-6', comment='OPT3001'),
         c0402('C6', 33.5, 34.0, 90),
         r0402('R1', 40.0, 24.0, '2.2k', '2K2', 90), r0402('R2', 41.5, 24.0, '2.2k', '2K2', 90), r0402('R3', 24.0, 26.0, '10k', '10K', 90),
         r0402('R4', 54.5, 30.5, '10k', '10K'), r0402('R5', 49.0, 30.5, '100k', '100K'),
         # R7: the footprint and placement say 0402; the part number is an 0603 (pn-desc mismatch).
         Part('R7', 'R0402', 61.0, 30.5, 0, mpn='RC0603FR-0710RL', mfr=Y, desc='RES SMD 10 OHM 1% 1/16W 0402', value='10'),
         Part('FID1', 'FID', 4.0, 40.0, 0, comment='Fiducial', desc='Fiducial'), Part('FID2', 'FID', 68.0, 6.0, 0, comment='Fiducial', desc='Fiducial'),
         Part('FID3', 'FID', 66.0, 41.0, 0, comment='Fiducial', desc='Fiducial')]
    for i, x in enumerate((12.0, 28.0, 44.0, 60.0)):
        P.append(Part('KEY%d' % (i + 1), 'KEY-9', x, 8.5, 0, comment='Touch key', desc='Capacitive touch key, copper'))
    b['parts'] = P
    b['nets'] = {
        'GND': ['J1.1', 'J1.24', 'J1.MH1', 'J1.MH2', 'J2.1', 'J2.18', 'J2.MH1', 'J2.MH2', 'U3.21', 'U3.5', 'C1.2', 'C2.2', 'U7.2', 'C3.2', 'C4.2',
                'U5.5', 'C5.2', 'U6.3', 'C6.2', 'R5.2'],
        '3V3': ['J1.2', 'J1.3', 'U3.15', 'C1.1', 'C2.1', 'U7.5', 'C4.1', 'U5.4', 'C5.1', 'U6.1', 'C6.1', 'R1.1', 'R2.1', 'R3.1', 'J2.2'],
        'I2C_SCL': ['J1.5', 'R1.2', 'U3.11', 'U5.3', 'U6.4'], 'I2C_SDA': ['J1.6', 'R2.2', 'U3.12', 'U5.1', 'U6.6'],
        'TOUCH_INT': ['U3.13', 'R3.2', 'J1.7'], 'KEY1': ['KEY1.1', 'U3.6'], 'KEY2': ['KEY2.1', 'U3.7'], 'KEY3': ['KEY3.1', 'U3.8'], 'KEY4': ['KEY4.1', 'U3.9'],
        'BL_SW': ['U7.1', 'L2.2', 'D1.1'], 'BL_VOUT': ['D1.2', 'C3.1', 'J2.17'], 'BL_FB': ['U7.3', 'R7.2', 'J2.16'], 'BL_PWM': ['U7.4', 'R4.1', 'J1.8'],
        'BL_EN': ['R4.2', 'R5.1'], 'VIN_BL': ['L2.1', 'U7.6'],
    }
    T = [(1, 0.25, ['U3.6', (17.0, 21.5), (12.0, 16.5), (12.0, 13.0)]), (1, 0.25, ['U3.7', (17.5, 17.0), (28.0, 17.0), (28.0, 13.0)]),
         (1, 0.25, ['U3.8', (18.0, 18.0), (44.0, 18.0), (44.0, 13.0)]), (1, 0.25, ['U3.9', (18.5, 19.0), (47.0, 19.0), (60.0, 13.0)]),
         (1, 0.5, ['U7.1', (51.05, 23.5), (53.7, 23.5), 'L2.2']), (1, 0.5, ['L2.2', (55.0, 20.5), 'D1.1']), (1, 0.5, ['D1.2', (57.0, 26.55)]),
         (1, 0.25, ['R1.2', (40.0, 33.35), 'U6.4']), (1, 0.25, ['R2.2', (41.5, 34.65), 'U6.6']),
         (2, 0.25, [(20.0, 30.0), (24.0, 34.0), (31.0, 34.0)]), (2, 0.25, [(46.5, 29.5), (46.5, 37.4), (40.0, 37.4)])]
    b['traces'] = T
    b['vias'] = [(6.0, 20.0, 'GND'), (6.0, 30.0, 'GND'), (66.0, 20.0, 'GND'), (66.0, 30.0, 'GND'), (36.0, 26.0, 'GND'), (26.0, 30.0, 'GND'),
                 (46.0, 34.0, 'GND'), (20.0, 30.0, 'TOUCH_INT'), (31.0, 34.0, 'TOUCH_INT'), (46.5, 29.5, 'BL_PWM'), (40.0, 37.4, 'BL_PWM')]
    # 0.20 mm vias under U3 (the drill check) and one in its thermal pad (via in pad).
    b['small_vias'] = [(16.0, 28.6, 'GND'), (20.0, 28.6, 'GND'), (16.0, 21.4, 'GND'), (20.0, 21.4, 'GND')]
    b['pad_via'] = (18.5, 25.5, 'GND')
    b['npth'] = [(3.5, 3.5, 2.7), (68.5, 42.3, 2.7)]
    # Pegs for the display bracket, too close to the copper beside them.
    b['pegs'] = [(30.0, 38.5, 1.6), (42.0, 38.5, 1.6)]
    b['cutouts'] = [('slot', 62.5, 15.0, 62.5, 19.0, 1.0)]   # thermal slot beside U5
    b['keepout'] = []
    b['pours'] = {}
    b['island'] = [(8.0, 41.6), (11.0, 41.6), (11.0, 43.0), (8.0, 43.0)]   # a copper scrap left on the bottom
    b['planes'] = {}
    b['silk_text'] = [('DT-1043 REV A', 4.0, 44.0, 1.0, 'l'), ('ACME', 56.0, 40.0, 1.2, 'l')]
    b['silk_text_bottom'] = [('DT-1043 A', 54.0, 34.0, 1.2, 'c'), ('DOVETAIL DEMO', 54.0, 31.0, 1.0, 'c')]
    b['thin_silk'] = ('ACME', 56.0, 37.6, 1.0)   # 0.10 mm strokes
    b['silk_marks'] = []
    return b


# ── geometry built from a board ───────────────────────────────────────────
def build(b):
    parts = {p.des: p for p in b['parts']}
    pad_of = {}
    for p in b['parts']:
        for pad in p.pads():
            pad_of[p.des + '.' + pad[0]] = (p, pad)
    net_of = {}
    for net, pins in b['nets'].items():
        for pin in pins:
            if pin not in pad_of:
                raise SystemExit('%s: unknown pin %s in net %s' % (b['name'], pin, net))
            net_of[pin] = net

    def net(des, pin):
        return net_of.get(des + '.' + pin) or 'Net%s_%s' % (des, pin)

    def pt(x):
        if isinstance(x, str):
            pad = pad_of[x][1]
            return (pad[1], pad[2])
        return x

    nlay = b['layers']
    cu = {i: {'flash': [], 'line': [], 'region': [], 'clear': []} for i in range(1, nlay + 1)}
    top, bot = 1, nlay
    smd = {'top': [], 'bottom': []}       # (x, y, shape, w, h, fn, des, pin)
    holes = []                            # (x, y, dia, plated, kind) kind: via, pad, mount
    slots = []                            # (x1, y1, x2, y2, width, plated)
    netpts = []                           # IPC-356 records
    for p in b['parts']:
        side = top if p.side == 'top' else bot
        for pin, x, y, shape, w, h, drill in p.pads():
            n = net(p.des, pin)
            fn = 'FiducialPad,Local' if p.des.startswith('FID') else 'SMDPad,CuDef'
            if drill:
                for L in range(1, nlay + 1):
                    if L in (top, bot):
                        cu[L]['flash'].append((x, y, shape, w, h, 'ComponentPad', n))
                if isinstance(drill, tuple):
                    dw, dl = drill[0], drill[1]
                    horiz = len(drill) > 2
                    half = (dl - dw) / 2
                    if horiz:
                        slots.append((x - half, y, x + half, y, dw, True))
                    else:
                        slots.append((x, y - half, x, y + half, dw, True))
                    netpts.append(('317', n, p.des, pin, x, y, dw, True, 0, w, h))
                else:
                    holes.append((x, y, drill, True, 'pad', n))
                    netpts.append(('317', n, p.des, pin, x, y, drill, True, 0, w, h))
            else:
                cu[side]['flash'].append((x, y, shape, w, h, fn, n))
                smd[p.side].append((x, y, shape, w, h, fn, p.des, pin))
                if not p.des.startswith('FID') and not p.des.startswith('KEY'):
                    netpts.append(('327', n, p.des, pin, x, y, 0, None, 1 if p.side == 'top' else 2, w, h))
                elif p.des.startswith('KEY'):
                    netpts.append(('327', n, p.des, pin, x, y, 0, None, 1, w, h))

    def add_via(x, y, n, drill=0.25, pad=0.51):
        holes.append((x, y, drill, True, 'via', n))
        for L in range(1, nlay + 1):
            cu[L]['flash'].append((x, y, 'C', pad, pad, 'ViaPad', n))
        netpts.append(('317', n, 'VIA', '', x, y, drill, True, 0, pad, pad))

    for x, y, n in b.get('vias', []):
        add_via(x, y, n)
    for x, y, n in b.get('small_vias', []):
        add_via(x, y, n, 0.2, 0.46)
    if b.get('pad_via'):
        x, y, n = b['pad_via']
        add_via(x, y, n, 0.25, 0.51)
    if b.get('thin_via'):
        x, y, n = b['thin_via']
        add_via(x, y, n, 0.3, 0.5)

    # Fan-out: a short stub and a via for each SMD pad on GND or 3V3, so the planes are reached (and
    # the board looks routed). The via goes out from the part along the pad's axis, as far as it takes
    # to stay clear of every other pad, via and trace.
    obst = []   # (side or None, x0, y0, x1, y1)
    for p in b['parts']:
        for pin, x, y, shape, w, h, drill in p.pads():
            obst.append((None if drill else p.side, x - w / 2, y - h / 2, x + w / 2, y + h / 2))
    for L, w, path in b['traces']:
        pts = [pt(x) for x in path]
        side = 'top' if L == 1 else 'bottom'
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            obst.append((side, min(x1, x2) - w / 2, min(y1, y2) - w / 2, max(x1, x2) + w / 2, max(y1, y2) + w / 2, (x1, y1, x2, y2, w)))
    edge = [(x, y, d) for x, y, d in b['npth'] + b.get('pegs', [])]

    def clear_at(vx, vy, side, own):
        r = 0.255 + 0.2
        if vx < 1.0 or vy < 1.0 or vx > b['w'] - 1.0 or vy > b['h'] - 1.0:
            return False
        if b.get('mains') and point_in(b['mains'], vx, vy):
            return False
        for o in obst:
            if o is own:
                continue
            if len(o) > 5:   # a trace segment: distance to its center line
                x1, y1, x2, y2, w = o[5]
                if seg_dist(vx, vy, x1, y1, x2, y2) < 0.255 + w / 2 + 0.2:
                    return False
                continue
            if o[1] - r < vx < o[3] + r and o[2] - r < vy < o[4] + r:
                return False
        for x, y, dia, plated, kind, n in holes:
            if math.hypot(vx - x, vy - y) < 0.85 + (dia - 0.25) / 2:
                return False
        for x, y, d in edge:
            if math.hypot(vx - x, vy - y) < d / 2 + 0.8:
                return False
        for c in b['cutouts']:
            if seg_dist(vx, vy, c[1], c[2], c[3], c[4]) < c[5] / 2 + 0.8:
                return False
        return True

    for p in b['parts']:
        if p.des.startswith(('FID', 'TP', 'KEY', 'J3', 'U1')):
            continue
        for pin, x, y, shape, w, h, drill in p.pads():
            n = net(p.des, pin)
            if drill or n not in ('GND', '3V3'):
                continue
            if p.fp.ep_paste and pin == p.fp.ep_paste[0]:
                continue  # exposed pads connect through the pins beside them
            own = next(o for o in obst if o[0] == p.side and abs((o[1] + o[3]) / 2 - x) < 1e-6 and abs((o[2] + o[4]) / 2 - y) < 1e-6)
            dx, dy = x - p.x, y - p.y
            if abs(dx) < 1e-6 and abs(dy) < 1e-6:
                dx = 1.0
            # along the pad's long axis first, then the other one
            dirs = []
            if w >= h:
                dirs += [(math.copysign(1, dx or 1), 0), (0, math.copysign(1, dy or 1)), (-math.copysign(1, dx or 1), 0), (0, -math.copysign(1, dy or 1))]
            else:
                dirs += [(0, math.copysign(1, dy or 1)), (math.copysign(1, dx or 1), 0), (0, -math.copysign(1, dy or 1)), (-math.copysign(1, dx or 1), 0)]
            done = False
            for ux, uy in dirs:
                for extra in (0.0, 0.3, 0.6, 0.9, 1.2):
                    reach = (w if ux else h) / 2 + 0.55 + extra
                    vx, vy = round(x + ux * reach, 3), round(y + uy * reach, 3)
                    # the stub must not cross another pad either
                    if not clear_at(vx, vy, p.side, own) or not all(clear_at(x + ux * t, y + uy * t, p.side, own) for t in
                                                                     [(w if ux else h) / 2 + 0.25 + k * 0.2 for k in range(int(extra / 0.2) + 2)] if True):
                        continue
                    L = top if p.side == 'top' else bot
                    cu[L]['line'].append((0.25, [(x, y), (vx, vy)], 'Conductor', n))
                    add_via(vx, vy, n)
                    obst.append((p.side, min(x, vx) - 0.125, min(y, vy) - 0.125, max(x, vx) + 0.125, max(y, vy) + 0.125, (x, y, vx, vy, 0.25)))
                    done = True
                    break
                if done:
                    break

    # Traces.
    for L, w, path in b['traces']:
        pts = [pt(x) for x in path]
        first = next((x for x in path if isinstance(x, str)), None)
        n = net_of.get(first, '') if first else ''
        lay = top if L == 1 else bot
        cu[lay]['line'].append((w, pts, 'Conductor', n))
    if b.get('island'):
        cu[bot]['region'].append((b['island'], 'Conductor', ''))

    # Pours with clearances (0.3 mm), on the layers asked for.
    for L, poly in b.get('pours', {}).items():
        lay = cu[L]
        lay['pour'] = poly
        clear = []
        for x, y, shape, w, h, fn, n in lay['flash']:
            if n != 'GND':
                clear.append(('F', x, y, shape, w + 0.6, h + 0.6))
        for w, pts, fn, n in lay['line']:
            if n != 'GND':
                clear.append(('L', w + 0.6, pts))
        for x, y, d in edge:
            clear.append(('F', x, y, 'C', d + 1.2, d + 1.2))
        for p in b['parts']:
            side = top if p.side == 'top' else bot
            if side == L and (not p.des.startswith(('TP', 'FID', 'KEY', 'J3', 'J1', 'J4', 'F1', 'RV', 'PS', 'K'))):
                bw, bh = p.fp.body
                if round(p.rot / 90) % 2:
                    bw, bh = bh, bw
                clear.append(('F', p.x, p.y, 'R', bw + 1.2, bh + 1.2))
        # slots and cutouts: rectangles kept inside the board, so clearances never reach past the edge
        for x1, y1, x2, y2, dw, plated in slots:
            m = dw / 2 + 0.8
            clear.append(('R', max(0.3, min(x1, x2) - m), max(0.3, min(y1, y2) - m), min(b['w'] - 0.3, max(x1, x2) + m), min(b['h'] - 0.3, max(y1, y2) + m)))
        for c in b['cutouts']:
            m = c[5] / 2 + 0.6
            clear.append(('R', c[1] - m, c[2] - m, c[3] + m, c[4] + m))
        lay['clear'] = clear
    return dict(b=b, parts=parts, cu=cu, smd=smd, holes=holes, slots=slots, netpts=netpts, net=net, pad_of=pad_of)


def seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / L2))
    return math.hypot(px - x1 - t * dx, py - y1 - t * dy)


# ── Gerber writer ─────────────────────────────────────────────────────────
class Gerber:
    def __init__(self, b, function, polarity='Positive', order=None, color=None):
        self.b, self.lines, self.aps, self.next = b, [], {}, 10
        self.body = []
        self.head = [GEN]
        if order:
            self.head.append('G04 Layer_Physical_Order=%d*' % order)
        self.head += ['G04 Layer_Color=%d*' % (color or 0), 'G04 Board_Origin=0|0*', '%FSLAX45Y45*%', '%MOMM*%',
                      '%TF.SameCoordinates,' + b['guid'] + '*%', '%TF.FilePolarity,' + polarity + '*%',
                      '%TF.FileFunction,' + function + '*%', '%TF.Part,Single*%', 'G01*', 'G75*']
        self.cur_ap = None
        self.cur_fn = None
        self.polar = 'D'
        self.thermals = {}

    @staticmethod
    def c(v):
        return str(int(round(v * 1e5)))

    def ap(self, shape, w, h, fn):
        key = (shape, round(w, 5), round(h, 5), fn)
        if key not in self.aps:
            d = self.next
            self.next += 1
            self.aps[key] = d
            if fn and fn != self.cur_fn:
                self.head.append('%TA.AperFunction,' + fn + '*%')
                self.cur_fn = fn
            if shape == 'C':
                self.head.append('%%ADD%dC,%.5f*%%' % (d, w))
            elif shape == 'R':
                self.head.append('%%ADD%dR,%.5fX%.5f*%%' % (d, w, h))
            elif shape == 'O':
                self.head.append('%%ADD%dO,%.5fX%.5f*%%' % (d, w, h))
            elif shape == 'T':   # thermal relief: w = outer, h = inner; spokes 0.254
                self.head.append('%%AMTHD%d*' % d)
                self.head.append('7,0,0,%.5f,%.5f,0.25400,45*' % (w, h))
                self.head.append('%')
                self.head.append('%%ADD%dTHD%d*%%' % (d, d))
        return self.aps[key]

    def use(self, d):
        if d != self.cur_ap:
            self.body.append('D%d*' % d)
            self.cur_ap = d

    def pol(self, p):
        if p != self.polar:
            self.body.append('%%LP%s*%%' % p)
            self.polar = p

    def flash(self, x, y, shape, w, h, fn=None):
        if shape == 'O' and abs(w - h) < 1e-6:
            shape = 'C'
        self.use(self.ap(shape, w, h, fn))
        self.body.append('X%sY%sD03*' % (self.c(x), self.c(y)))

    def path(self, w, pts, fn='Conductor'):
        self.use(self.ap('C', w, w, fn))
        self.body.append('X%sY%sD02*' % (self.c(pts[0][0]), self.c(pts[0][1])))
        for x, y in pts[1:]:
            self.body.append('X%sY%sD01*' % (self.c(x), self.c(y)))

    def region(self, pts, fn='Conductor'):
        if fn and fn != self.cur_fn:
            self.body.append('%TA.AperFunction,' + fn + '*%')
            self.cur_fn = fn
        self.body.append('G36*')
        self.body.append('X%sY%sD02*' % (self.c(pts[0][0]), self.c(pts[0][1])))
        for x, y in pts[1:] + [pts[0]]:
            self.body.append('X%sY%sD01*' % (self.c(x), self.c(y)))
        self.body.append('G37*')

    def outline(self, pts_arcs, w, fn='Profile'):
        """pts_arcs: list of ('L', x, y) / ('A', x, y, cx, cy, ccw) after a start ('M', x, y)."""
        self.use(self.ap('C', w, w, fn))
        for seg in pts_arcs:
            if seg[0] == 'M':
                self.body.append('X%sY%sD02*' % (self.c(seg[1]), self.c(seg[2])))
                lx, ly = seg[1], seg[2]
            elif seg[0] == 'L':
                self.body.append('G01*')
                self.body.append('X%sY%sD01*' % (self.c(seg[1]), self.c(seg[2])))
                lx, ly = seg[1], seg[2]
            else:
                _, x, y, cx, cy, ccw = seg
                self.body.append('G03*' if ccw else 'G02*')
                self.body.append('X%sY%sI%sJ%sD01*' % (self.c(x), self.c(y), self.c(cx - lx), self.c(cy - ly)))
                lx, ly = x, y
        self.body.append('G01*')

    def text(self):
        body = '\n'.join(self.head + self.body)
        md5 = hashlib.md5(body.encode()).hexdigest()
        return body + '\n%TF.MD5,' + md5 + '*%\nM02*\n'


def board_outline(b):
    w, h, r = b['w'], b['h'], b['r']
    return [('M', r, 0), ('L', w - r, 0), ('A', w, r, w - r, r, True), ('L', w, h - r), ('A', w - r, h, w - r, h - r, True),
            ('L', r, h), ('A', 0, h - r, r, h - r, True), ('L', 0, r), ('A', r, 0, r, r, True)]


def slot_outline(x1, y1, x2, y2, wd):
    r = wd / 2   # vertical slot only
    return [('M', x1 - r, y1), ('A', x1 + r, y1, x1, y1, True), ('L', x2 + r, y2), ('A', x2 - r, y2, x2, y2, True), ('L', x1 - r, y1)]


def outline_poly(b, inset=0.0, steps=8):
    w, h, r = b['w'], b['h'], b['r']
    pts = []
    for cx, cy, a0 in ((w - r, r, -90), (w - r, h - r, 0), (r, h - r, 90), (r, r, 180)):
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((cx + (r - inset) * math.cos(a), cy + (r - inset) * math.sin(a)))
    return pts


def silk_for(g, side):
    """Silkscreen strokes for one side: part outlines, pin-1 dots, designators, text."""
    b = g['b']
    out = []
    for p in b['parts']:
        if p.side != side or p.des.startswith(('FID', 'KEY', 'TP')):
            continue
        ow, oh = p.fp.outline or (p.fp.body[0] + 0.4, p.fp.body[1] + 0.4)
        # keep the outline off the pads: grow it past any pad it would cross
        bw, bh = ow / 2, oh / 2
        for pin, px, py, shape, w, h, drill in p.fp.pads:
            if drill:
                continue
            if abs(px) - w / 2 < bw and abs(py) - h / 2 < bh:
                pass
        if ow > 0 and oh > 0:
            pads = p.fp.pads
            clear = 0.3
            segs = []
            # draw the outline as four sides, broken where a pad (plus clearance) is in the way
            corners = [(-bw, -bh), (bw, -bh), (bw, bh), (-bw, bh)]
            for i in range(4):
                a, c = corners[i], corners[(i + 1) % 4]
                n = 60
                run = []
                for k in range(n + 1):
                    t = k / n
                    q = (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)
                    hit = any(abs(q[0] - px) < w / 2 + clear + 0.1 and abs(q[1] - py) < h / 2 + clear + 0.1 for _, px, py, _, w, h, _ in pads)
                    if hit:
                        if len(run) > 1:
                            segs.append(run)
                        run = []
                    else:
                        run.append(q)
                if len(run) > 1:
                    segs.append(run)
            for s in segs:
                out.append((0.15, [p.pad_xy(*q) for q in (s[0], s[-1])]))
        if p.fp.pin1:
            x, y = p.pad_xy(*p.fp.pin1)
            out.append((0.3, [(x, y), (x + 0.001, y)]))
        # designator above the part (in board frame)
        bw2, bh2 = p.fp.body
        if round(p.rot / 90) % 2:
            bw2, bh2 = bh2, bw2
        # above everything the part has (body and pads), clear of its own pads
        ty = max([p.y + bh2 / 2] + [py + ph / 2 + 0.05 for _, _, py, _, _, ph, _ in p.pads()]) + 0.45
        for pl in text_strokes(p.des, p.x if side == 'top' else p.x, ty, 0.8, 'c'):
            if side == 'bottom':
                pl = [(2 * p.x - x, y) for x, y in pl]
            out.append((0.15, pl))
    key = 'silk_text' if side == 'top' else 'silk_text_bottom'
    for s, x, y, h, anchor in b.get(key, []):
        for pl in text_strokes(s, x, y, h, anchor):
            if side == 'bottom':
                cx = x
                pl = [(2 * cx - px, py) for px, py in pl]
            out.append((0.15, pl))
    if side == 'top':
        for m in b.get('silk_marks', []):
            out.append((0.2, m))
        if b.get('thin_silk'):
            s, x, y, h = b['thin_silk']
            for pl in text_strokes(s, x, y, h, 'l'):
                out.append((0.10, pl))
    return out


def gerbers(g):
    b, cu = g['b'], g['cu']
    nlay = b['layers']
    base = b['file']
    files = {}
    names = {1: 'Copper_Signal_Top'}
    if nlay == 4:
        names.update({2: 'Copper_Plane_1', 3: 'Copper_Plane_2', 4: 'Copper_Signal_Bot'})
    else:
        names.update({2: 'Copper_Signal_Bot'})
    mains = b.get('mains')
    for L in range(1, nlay + 1):
        plane = b['planes'].get(L)
        if plane:
            gb = Gerber(b, 'Copper,L%d,Inr,Plane' % L, 'Negative', L, 32768)
            # Negative plane: drawn = cleared. Pull back from the edge and the cutouts, clear the
            # mains area and the antenna keep-out, antipads on other nets, thermals on THT pads of its net.
            gb.outline(board_outline(b), 1.0, 'NonConductor')
            for c in b['cutouts']:
                gb.outline(slot_outline(*c[1:6]), 1.0 + 1.0, 'NonConductor')
            if b.get('plane_clear') or mains:
                gb.region(b.get('plane_clear') or mains, 'NonConductor')
            for k in b.get('keepout', []):
                gb.region([(k[0], k[1]), (k[2], k[1]), (k[2], k[3]), (k[0], k[3])], 'NonConductor')
            for x, y, dia, plated, kind, n in g['holes']:
                if mains and point_in(mains, x, y):
                    continue
                if n == plane and kind == 'pad':
                    gb.flash(x, y, 'T', dia + 0.75, dia + 0.45, 'ComponentPad')
                elif n != plane:
                    gb.flash(x, y, 'C', dia + 0.5, dia + 0.5, 'NonConductor')
            for x1, y1, x2, y2, dw, plated in g['slots']:
                gb.path(dw + 0.5, [(x1, y1), (x2, y2)], 'NonConductor')
            files['%s_%s.gbr' % (base, names[L])] = gb.text()
            continue
        side = 'Top' if L == 1 else ('Bot' if L == nlay else 'Inr')
        gb = Gerber(b, 'Copper,L%d,%s,Signal' % (L, side), 'Positive', L, 255 if L == 1 else 16711680)
        lay = cu[L]
        if lay.get('pour'):
            gb.region(lay['pour'], 'Conductor')
            gb.pol('C')
            for c in lay['clear']:
                if c[0] == 'F':
                    gb.flash(c[1], c[2], c[3], c[4], c[5], 'NonConductor')
                elif c[0] == 'R':
                    gb.region([(c[1], c[2]), (c[3], c[2]), (c[3], c[4]), (c[1], c[4])], 'NonConductor')
                else:
                    gb.path(c[1], c[2], 'NonConductor')
            if mains:
                gb.region(mains, 'NonConductor')
            for k in b.get('keepout', []):
                gb.region([(k[0], k[1]), (k[2], k[1]), (k[2], k[3]), (k[0], k[3])], 'NonConductor')
            gb.pol('D')
        for w, pts, fn, n in lay['line']:
            gb.path(w, pts, fn)
        for x, y, shape, w, h, fn, n in sorted(lay['flash'], key=lambda f: (f[5], f[2], f[3], f[4], f[0], f[1])):
            gb.flash(x, y, shape, w, h, fn)
        for poly, fn, n in lay['region']:
            gb.region(poly, fn)
        files['%s_%s.gbr' % (base, names[L])] = gb.text()

    # Mask: pad + 0.05 per side; vias tented. J2's openings on the main board are 0.1 per side (dams).
    for side, L in (('Top', 1), ('Bot', nlay)):
        gb = Gerber(b, 'Soldermask,%s' % side, 'Negative', None, 8388736)
        dam = b.get('mask_dam')
        for x, y, shape, w, h, fn, n in cu[L]['flash']:
            if fn == 'ViaPad':
                continue
            e = 0.05
            if fn.startswith('Fiducial'):
                e = 0.5
            if dam and any(abs(x - q[1]) < 1e-6 and abs(y - q[2]) < 1e-6 for q in g['parts'][dam[0]].pads() if q[0] in dam[1]):
                e = 0.1
            gb.flash(x, y, shape, w + 2 * e, h + 2 * e, 'SMDPad,CuDef' if fn.startswith('SMD') else fn)
        files['%s_Soldermask_%s.gbr' % (base, side)] = gb.text()
    # Paste: SMD pads of fitted parts; exposed pads windowed.
    for side, sname in (('top', 'Top'), ('bottom', 'Bot')):
        gb = Gerber(b, 'Paste,%s' % sname, 'Positive', None, 8421504)
        for p in b['parts']:
            if p.side != side or p.des.startswith(('FID', 'TP', 'KEY')):
                continue
            ep = p.fp.ep_paste
            for pin, x, y, shape, w, h, drill in p.pads():
                if drill:
                    continue
                if ep and pin == ep[0]:
                    n = ep[1]
                    cw, ch = w / n, h / n
                    for i in range(n):
                        for j in range(n):
                            gb.flash(x - w / 2 + cw * (i + 0.5), y - h / 2 + ch * (j + 0.5), 'R', cw * 0.7, ch * 0.7, 'SMDPad,CuDef')
                    continue
                gb.flash(x, y, shape, w * 0.9, h * 0.9, 'SMDPad,CuDef')
        files['%s_Paste_%s.gbr' % (base, sname)] = gb.text()
    # Legend.
    for side, sname in (('top', 'Top'), ('bottom', 'Bot')):
        gb = Gerber(b, 'Legend,%s' % sname, 'Positive', None, 65535)
        for w, pts in silk_for(g, side):
            gb.path(w, pts, None)
        files['%s_Legend_%s.gbr' % (base, sname)] = gb.text()
    # Profile, with the cutouts.
    gb = Gerber(b, 'Profile,NP', 'Positive', None, 0)
    gb.outline(board_outline(b), 0.0254, 'Profile')
    for c in b['cutouts']:
        gb.outline(slot_outline(*c[1:6]), 0.0254, 'Profile')
    files['%s_Profile.gbr' % base] = gb.text()
    return files


def point_in(poly, x, y):
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


# ── drill ─────────────────────────────────────────────────────────────────
def drill(g):
    b = g['b']
    holes = list(g['holes']) + [(x, y, d, False, 'mount', '') for x, y, d in b['npth']] + [(x, y, d, False, 'peg', '') for x, y, d in b.get('pegs', [])]
    tools = []   # (dia, plated, slot)
    for x, y, d, plated, kind, n in holes:
        k = (round(d, 3), plated, False)
        if k not in tools:
            tools.append(k)
    for x1, y1, x2, y2, w, plated in g['slots']:
        k = (round(w, 3), plated, True)
        if k not in tools:
            tools.append(k)
    tools.sort(key=lambda t: (not t[1], t[2], t[0]))
    tnum = {t: i + 1 for i, t in enumerate(tools)}
    c = lambda v: '%08d' % int(round(v * 1e4))
    lines = ['M48', ';FILE_FORMAT=4:4', 'METRIC,LZ']
    plated_done = False
    for t in tools:
        if t[1] and not plated_done:
            lines.append(';TYPE=PLATED'); plated_done = True
        if not t[1] and (plated_done or t == tools[0]) and ';TYPE=NON_PLATED' not in lines:
            lines.append(';TYPE=NON_PLATED')
        lines.append('T%02dF00S00C%.4f' % (tnum[t], t[0]))
    lines += ['%', 'G90', 'G05']
    counts = {}
    for t in tools:
        lines.append('T%02d' % tnum[t])
        n = 0
        if t[2]:
            for x1, y1, x2, y2, w, plated in g['slots']:
                if (round(w, 3), plated, True) == t:
                    lines.append('X%sY%sG85X%sY%s' % (c(x1), c(y1), c(x2), c(y2))); n += 1
        else:
            for x, y, d, plated, kind, nn in sorted(holes, key=lambda h: (h[1], h[0])):
                if (round(d, 3), plated, False) == t:
                    lines.append('X%sY%s' % (c(x), c(y))); n += 1
        counts[t] = n
    lines.append('M30')
    rep = ['-' * 130, 'NCDrill File Report For: %s.PcbDoc   10/27/2026  3:42:00 PM' % b['file'], '-' * 130, '',
           'Layer Pair : Top Layer to Bottom Layer', 'ASCII RoundHoles File : %s.TXT' % b['file'], '',
           'Tool       Hole Size               Hole Tolerance               Hole Type       Hole Count   Plated         Tool Travel', '-' * 130]
    total = 0
    for t in tools:
        size = '%smm (%dmil)' % (('%.3f' % t[0]).rstrip('0').rstrip('.'), round(t[0] / 0.0254))
        rep.append('T%-6d %-24s %-28s %-15s %-12d %-14s 0.00mm (0.00inch)' % (tnum[t], size, '', 'Slot' if t[2] else 'Round', counts[t], 'PTH' if t[1] else 'NPTH'))
        total += counts[t]
    rep += ['-' * 130, 'Totals' + ' ' * 78 + str(total), '', 'Total Processing Time (hh:mm:ss) : 00:00:00', '']
    return '\n'.join(lines) + '\n', '\n'.join(rep)


# ── assembly ──────────────────────────────────────────────────────────────
def pnp(g):
    b = g['b']
    rows = []
    for p in b['parts']:
        if p.des.startswith('KEY'):
            continue   # copper only, nothing to place
        rows.append((p.des, p.comment, 'TopLayer' if p.side == 'top' else 'BottomLayer', p.fp.name, '%.3f' % p.x, '%.3f' % p.y, '%d' % (p.pnp_rot % 360), '"%s"' % p.desc))
    head = ('Designator', 'Comment', 'Layer', 'Footprint', 'Center-X(mm)', 'Center-Y(mm)', 'Rotation', 'Description')
    widths = [max(len(r[i]) for r in rows + [head]) + 1 for i in range(len(head))]
    fmt = lambda r: ''.join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip()
    out = ['Altium Designer Pick and Place Locations', '%s %s' % (b['name'], b['rev']), '', '=' * 120, 'File Design Information:', '',
           'Date:       27/10/26', 'Time:       15:42', 'Revision:   %s' % b['rev'], 'Variant:    %s' % (b['variant'] or 'No variations'), 'Units used: mm', '', fmt(head)]
    out += [fmt(r) for r in rows]
    return '\n'.join(out) + '\n'


def bom(g):
    b = g['b']
    groups = {}
    for p in b['parts']:
        if p.des.startswith(('FID', 'TP', 'KEY')):
            continue
        k = (p.mpn or ('?' + p.des), p.fp.name, p.desc)
        groups.setdefault(k, []).append(p)
    def dkey(d):
        import re
        m = re.match(r'([A-Z]+)(\d+)', d)
        return (m.group(1), int(m.group(2))) if m else (d, 0)
    rows = []
    for (mpn, fp, desc), ps in groups.items():
        ps.sort(key=lambda p: dkey(p.des))
        p = ps[0]
        rows.append([p.comment, desc, ', '.join(q.des for q in ps), fp, str(len(ps)), p.mfr, p.mpn, p.lifecycle if p.mpn else ''])
    rows.sort(key=lambda r: dkey(r[2].split(',')[0]))
    head = ['Comment', 'Description', 'Designator', 'Footprint', 'Quantity', 'Manufacturer 1', 'Manufacturer Part Number 1', 'Manufacturer Lifecycle 1']
    q = lambda s: '"' + s.replace('"', '""') + '"'
    return '\n'.join(','.join(q(c) for c in r) for r in [head] + rows) + '\n'


def ipc356(g):
    b = g['b']
    out = ['C  Project Name : %s' % b['name'], 'C  Board Name : %s' % b['file'], 'C  Date : 10/27/2026', 'C  ', 'C  --------------- Layer Stackup --------------------', 'C  ']
    out += ['C  Top Layer'] + (['C  Int1 (GND)', 'C  Int2 (3V3)'] if b['layers'] == 4 else []) + ['C  Bottom Layer', 'C  ']
    out += ['P  JOB', 'P  UNITS CUST', 'P  TITLE %s' % b['file'], 'P  NUM 1.0', 'P  REV %s' % b['rev'], 'P  VER IPC-D-356A', 'P  IMAGE PRIMARY']
    u = lambda v: int(round(v / 0.00254))
    for op, net, des, pin, x, y, hole, plated, acc, w, h in sorted(g['netpts'], key=lambda r: (r[1], r[2], r[3], r[4], r[5])):
        hs = 'D%04d%s' % (u(hole), 'P' if plated else 'U') if hole else ' ' * 6
        line = '%s%-14s   %-6s-%-4s %s A%02dX%s%06dY%s%06dX%04dY%04dR000 S%d' % (
            op, net[:14], des, pin, hs, acc, '-' if x < 0 else ' ', u(abs(x)), '-' if y < 0 else ' ', u(abs(y)), u(w), u(h), 0 if acc == 0 else (1 if acc == 1 else 2))
        out.append(line)
    out.append('999')
    return '\n'.join(out) + '\n'


def status(b, kind, files):
    src = ('Variant [%s] of PCB Document [%s.PcbDoc]' % (b['variant'], b['file'])) if b['variant'] else 'PCB Document [%s.PcbDoc]' % b['file']
    out = ['Output: %s' % kind[0], 'Type  : %s' % kind[1], 'From  : ' + src] + ['   Generated File[%s]' % f for f in files] + \
          ['', '', 'Files Generated   : %d' % len(files), 'Documents Printed : 0', '', 'Finished Output Generation At 3:42:05 PM On 10/27/2026', '']
    return '\n'.join(out)


def package(b):
    g = build(b)
    top = b['zip'][:-4] + '/'
    files = {}
    gb = gerbers(g)
    for name, text in gb.items():
        files['Manufacturing/Fabrication/GerberX2/' + name] = text
    drl, drr = drill(g)
    files['Manufacturing/Fabrication/NC Drill/%s.TXT' % b['file']] = drl
    files['Manufacturing/Fabrication/NC Drill/%s.DRR' % b['file']] = drr
    files['Manufacturing/Fabrication/Test Points/Assembly Testpoint Report for %s.ipc' % b['file']] = ipc356(g)
    files['Manufacturing/Fabrication/Status Report.Txt'] = status(b, ('Gerber X2 Files', 'GerberX2'), sorted(gb))
    variant = b['variant'] or 'No variations'
    files['Manufacturing/Assembly/Pick Place/Pick Place for %s(%s).txt' % (b['file'], b['variant'] or 'No variations')] = pnp(g)
    files['Manufacturing/Assembly/BOM/Bill of Materials-%s(%s).csv' % (b['file'], b['variant'] or 'No variations')] = bom(g)
    files['Manufacturing/Assembly/Status Report.Txt'] = status(b, ('Pick and Place Files', 'Pick Place'), ['Pick Place for %s(%s).txt' % (b['file'], variant)])
    files['README.txt'] = ('Fabcheck demo board: %s, rev %s.\n' % (b['name'], b['rev']) +
                           'Made up for the Dovetail Signoff demo (Acme Climate Smart Thermostat). Not a real design.\n'
                           'Made by tools/make_demo_boards.py in the pcb_dfm repository.\n')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            zi = zipfile.ZipInfo(top + name, DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, files[name].replace('\n', '\r\n').encode('utf-8'))
    return buf.getvalue()


def main():
    check = '--check' in sys.argv
    boards = [main_board(), display_board()]
    index = []
    stale = []
    for b in boards:
        data = package(b)
        sha = hashlib.sha256(data).hexdigest()
        out = DEMO / b['zip']
        if check:
            if not out.exists() or out.read_bytes() != data:
                stale.append(out.name)
        else:
            out.write_bytes(data)
        index.append({'run': b['run'], 'project': b['project'], 'file': 'demo/' + b['zip'], 'name': b['zip'], 'label': b['label'],
                      'size': len(data), 'sha256': sha, 'key': sha[:16], 'profile': 'standard', 'thickness': b['thickness']})
        print('%-32s %8d bytes  sha256 %s' % (b['zip'], len(data), sha[:16]))
    # The sensor flex (tools/make_flex_demo.py): Fabcheck's demo only, no Signoff EE run.
    import make_flex_demo
    data = make_flex_demo.package()
    sha = hashlib.sha256(data).hexdigest()
    if check:
        if not make_flex_demo.OUT.exists() or make_flex_demo.OUT.read_bytes() != data:
            stale.append(make_flex_demo.OUT.name)
    else:
        make_flex_demo.OUT.write_bytes(data)
    index.append({'run': None, 'project': None, 'file': 'demo/' + make_flex_demo.OUT.name, 'name': make_flex_demo.OUT.name,
                  'label': 'Sensor Flex (DT-1045 rev A)', 'size': len(data), 'sha256': sha, 'key': sha[:16], 'profile': 'flex', 'thickness': 0.2})
    print('%-32s %8d bytes  sha256 %s' % (make_flex_demo.OUT.name, len(data), sha[:16]))
    js = ('// Made by tools/make_demo_boards.py; do not edit. The demo boards and the fixed run ids that Signoff\n'
          '// EE\'s demo links to (docs/design.md, Demo boards).\n'
          'window.Fab = window.Fab || {};\nFab.demoBoards = ' + json.dumps(index, indent=2) + ';\n')
    jsf = DEMO / 'boards.js'
    if check:
        if not jsf.exists() or jsf.read_text(encoding='utf-8') != js:
            stale.append(jsf.name)
        if stale:
            raise SystemExit('Out of date: ' + ', '.join(stale) + '. Run python tools/make_demo_boards.py')
        print('Demo boards up to date.')
    else:
        jsf.write_text(js, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
