#!/usr/bin/env python3
"""Join composed labels into one print strip with dotted cut-marks between
them, so the printer's feed-to-cutter blank (~20 mm) is paid once per batch
instead of once per label.

Usage: concat.py <out.png> <label1.png> [label2.png ...]
"""
import sys
from PIL import Image, ImageDraw

out, files = sys.argv[1], sys.argv[2:]
imgs = [Image.open(f).convert("1") for f in files]
h = max(i.height for i in imgs)
SEP = 13                      # gap between labels; dotted cut line in the middle

w = sum(i.width for i in imgs) + SEP * (len(imgs) - 1)
strip = Image.new("1", (w, h), 1)
d = ImageDraw.Draw(strip)
x = 0
for k, im in enumerate(imgs):
    strip.paste(im, (x, (h - im.height) // 2))
    x += im.width
    if k < len(imgs) - 1:
        cut = x + SEP // 2
        for y in range(0, h, 7):
            d.line([(cut, y), (cut, min(y + 3, h - 1))], fill=0)
        x += SEP
strip.save(out)
print(f"strip: {w}x{h}px = {w / 180 * 25.4:.0f} mm of tape, {len(imgs)} labels")
