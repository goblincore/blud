"""A PSX-era FMV treatment for a still: 320x240 source, soft upscale, chroma bleed, a little block compression and grain.
usage: fmv.py in.png out.png [quality=38]"""
import io, sys, random
from PIL import Image, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
q = int(sys.argv[3]) if len(sys.argv) > 3 else 38
im = Image.open(src).convert('RGB')
W, H = im.size
small = im.resize((320, 240), Image.LANCZOS)
y, cb, cr = small.convert('YCbCr').split()
cb = cb.resize((80, 240), Image.BILINEAR).resize((320, 240), Image.BILINEAR)     # 4:1:1-ish chroma
cr = cr.resize((80, 240), Image.BILINEAR).resize((320, 240), Image.BILINEAR)
small = Image.merge('YCbCr', (y, cb, cr)).convert('RGB')
buf = io.BytesIO(); small.save(buf, 'JPEG', quality=q, subsampling=2); buf.seek(0)
small = Image.open(buf).convert('RGB')
big = small.resize((W, H), Image.BILINEAR).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
px = big.load(); rnd = random.Random(7)
for j in range(0, H):
    for i in range(0, W, 1):
        if rnd.random() < 0.5:
            n = rnd.randint(-5, 5); r, g, b = px[i, j]; px[i, j] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
big.save(dst)
