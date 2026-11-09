#!/usr/bin/env python3
"""Compose a compact tape label: QR on top, name + serial underneath.

Usage: compose.py <qr.png> <out.png> <tape_px> [name] [serial]
The output is <tape_px> tall (the tape's printable height) and only as
wide as its widest element, which keeps the physical label short.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BOOK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
MAX_TEXT_W = 280          # don't let one long name stretch the label forever

qr_png, out_png, tape = sys.argv[1], sys.argv[2], int(sys.argv[3])
name = sys.argv[4] if len(sys.argv) > 4 else ""
serial = ("SN " + sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else ""

GAP = 2
sn_h = 13 if serial else 0
name_h = 17 if name else 0
qr_target = tape - (name_h + sn_h + GAP * ((name != "") + (serial != "")))

qr = Image.open(qr_png).convert("1")
# integer-downscale the QR only if it doesn't fit above the text
if qr.height > qr_target:
    for div in (2, 3, 4):
        if qr.height // div <= qr_target and (qr.height % div) == 0:
            qr = qr.resize((qr.width // div, qr.height // div), Image.NEAREST)
            break
    else:
        qr = qr.resize((qr_target, qr_target), Image.LANCZOS)

def fit(text, path, start, floor=9):
    for size in range(start, floor - 1, -1):
        f = ImageFont.truetype(path, size)
        if f.getbbox(text)[2] <= MAX_TEXT_W:
            return f
    return ImageFont.truetype(path, floor)

fname = fit(name, BOLD, name_h - 2) if name else None
fsn = fit(serial, BOOK, sn_h - 2) if serial else None

w = max([qr.width] +
        ([int(fname.getbbox(name)[2]) + 2] if name else []) +
        ([int(fsn.getbbox(serial)[2]) + 2] if serial else []))
img = Image.new("1", (w, tape), 1)
img.paste(qr, ((w - qr.width) // 2, 0))
d = ImageDraw.Draw(img)
y = qr.height + GAP
if name:
    d.text(((w - fname.getbbox(name)[2]) // 2, y), name, font=fname, fill=0)
    y += name_h + (GAP if serial else 0)
if serial:
    d.text(((w - fsn.getbbox(serial)[2]) // 2, y), serial, font=fsn, fill=0)
img.save(out_png)
print(f"{out_png}: {w}x{tape}px ({w / 180 * 25.4:.0f} mm long)")
