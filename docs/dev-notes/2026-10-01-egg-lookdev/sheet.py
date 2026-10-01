import sys
from PIL import Image, ImageDraw
# usage: sheet.py out.png cols label=path ...
out, cols = sys.argv[1], int(sys.argv[2])
items = [a.split('=', 1) for a in sys.argv[3:]]
ims = [(l, Image.open(p).convert('RGB')) for l, p in items]
w, h = ims[0][1].size; bar = 22
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (w * cols, (h + bar) * rows), (16, 16, 16)); d = ImageDraw.Draw(s)
for k, (l, im) in enumerate(ims):
    x, y = (k % cols) * w, (k // cols) * (h + bar)
    d.text((x + 6, y + 5), l, fill=(235, 235, 235)); s.paste(im, (x, y + bar))
s.save(out)
