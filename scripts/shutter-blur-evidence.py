#!/usr/bin/env python3
"""Task-3 shutter-blur evidence post-processing (PIL + numpy).

For every sharp|candidate|sampled triple the runner captured, it reports:
  * changed pixels vs the sharp frame at max-channel |d| > 8
  * the changed-pixel bounding box
  * IoU of the candidate-changed and sampled-changed masks
  * mean |d| inside the union mask
and writes 3-up (sharp | candidate | sampled) zoomed contact strips for a
chosen list plus a candidate-vs-sampled crop pair for the streak cases.

Usage: python3 scripts/shutter-blur-evidence.py <evidence-dir>
Writes <evidence-dir>/image-diff.json and derived-*.png files.
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def load(d, name):
    return np.asarray(Image.open(os.path.join(d, name)).convert('RGB')).astype(np.int16)


def mask(a, b, thr=8):
    return (np.abs(a - b).max(axis=2) > thr)


def bbox(m):
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def iou(m1, m2):
    inter = int(np.logical_and(m1, m2).sum())
    union = int(np.logical_or(m1, m2).sum())
    return round(inter / union, 4) if union else 1.0


def strip(d, prefix, out, pad=40, scale=3):
    names = [f'{prefix}-sharp.png', f'{prefix}-candidate.png', f'{prefix}-sampled.png']
    if not all(os.path.exists(os.path.join(d, n)) for n in names):
        return None
    imgs = [Image.open(os.path.join(d, n)).convert('RGB') for n in names]
    sa = np.asarray(imgs[0]).astype(np.int16)
    ca = np.asarray(imgs[1]).astype(np.int16)
    ma = mask(sa, ca, 8)
    bb = bbox(ma)
    if bb is None:
        bb = [0, 0, sa.shape[1], sa.shape[0]]
    x0 = max(0, bb[0] - pad)
    y0 = max(0, bb[1] - pad)
    x1 = min(sa.shape[1], bb[2] + pad)
    y1 = min(sa.shape[0], bb[3] + pad)
    crops = [im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * scale, (y1 - y0) * scale), Image.NEAREST) for im in imgs]
    w, h = crops[0].size
    canvas = Image.new('RGB', (w * 3 + 16, h), (0, 0, 0))
    for i, c in enumerate(crops):
        canvas.paste(c, (i * (w + 8), 0))
    canvas.save(os.path.join(d, out))
    return {'file': out, 'crop': [x0, y0, x1, y1], 'size': list(canvas.size)}


def main():
    d = sys.argv[1]
    prefixes = [a[:-len('-sharp.png')] for a in sorted(os.listdir(d)) if a.endswith('-sharp.png')]
    report = {}
    for p in prefixes:
        sharp = os.path.join(d, f'{p}-sharp.png')
        cand = os.path.join(d, f'{p}-candidate.png')
        samp = os.path.join(d, f'{p}-sampled.png')
        if not (os.path.exists(sharp) and os.path.exists(cand) and os.path.exists(samp)):
            continue
        sa, ca, pa = load(d, f'{p}-sharp.png'), load(d, f'{p}-candidate.png'), load(d, f'{p}-sampled.png')
        mc, ms = mask(sa, ca), mask(sa, pa)
        union = np.logical_or(mc, ms)
        report[p] = {
            'candidateChangedPx': int(mc.sum()),
            'sampledChangedPx': int(ms.sum()),
            'candidateBbox': bbox(mc),
            'sampledBbox': bbox(ms),
            'changedMaskIoU': iou(mc, ms),
            'candidateMeanAbsInUnion': round(float(np.abs(sa - ca).max(axis=2)[union].mean()) if union.any() else 0.0, 3),
            'sampledMeanAbsInUnion': round(float(np.abs(sa - pa).max(axis=2)[union].mean()) if union.any() else 0.0, 3),
        }
    strips = {}
    for p, out in [
        ('r13-crossing-1-30', '50-strip-crossing.png'),
        ('r12-burst-1-30', '51-strip-burst.png'),
        ('r18-offcenter-1-30', '52-strip-offcenter.png'),
        ('r14-overlap-closeup-1-30', '53-strip-closeup.png'),
        ('r15-landing-contact-1-60', '54-strip-landing-contact.png'),
        ('r10-bleed-1-60', '55-strip-bleed.png'),
    ]:
        s = strip(d, p, out)
        if s:
            strips[p] = s
    # Candidate-vs-sampled zoom on the crossing streak (the beading check).
    for p, out in [('r13-crossing-1-30', '56-crop-crossing-cand-vs-sampled.png'),
                   ('r12-burst-1-30', '57-crop-burst-cand-vs-sampled.png')]:
        a = os.path.join(d, f'{p}-candidate.png')
        b = os.path.join(d, f'{p}-sampled.png')
        if not (os.path.exists(a) and os.path.exists(b)):
            continue
        ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
        aa, ba = np.asarray(ia).astype(np.int16), np.asarray(ib).astype(np.int16)
        bb = bbox(mask(aa, ba, 8))
        if bb is None:
            continue
        x0, y0, x1, y1 = max(0, bb[0] - 40), max(0, bb[1] - 40), min(800, bb[2] + 40), min(600, bb[3] + 40)
        ca = ia.crop((x0, y0, x1, y1)).resize(((x1 - x0) * 3, (y1 - y0) * 3), Image.NEAREST)
        cb = ib.crop((x0, y0, x1, y1)).resize(((x1 - x0) * 3, (y1 - y0) * 3), Image.NEAREST)
        canvas = Image.new('RGB', (ca.width * 2 + 8, ca.height), (0, 0, 0))
        canvas.paste(ca, (0, 0))
        canvas.paste(cb, (ca.width + 8, 0))
        canvas.save(os.path.join(d, out))
        strips[out] = {'size': list(canvas.size)}
    out = {'prefixes': report, 'strips': strips}
    with open(os.path.join(d, 'image-diff.json'), 'w') as f:
        json.dump(out, f, indent=2)
    for p, v in report.items():
        print(f"{p}: cand {v['candidateChangedPx']}px  sampled {v['sampledChangedPx']}px  IoU {v['changedMaskIoU']}")


if __name__ == '__main__':
    main()
