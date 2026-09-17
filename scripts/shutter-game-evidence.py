#!/usr/bin/env python3
"""Focused evidence post-step for the game shutter smoke.

Reads the A/B captures the runner wrote into the evidence dir and produces:
  * changed-pixel count / bbox / IoU for the DETERMINISTIC on|off pair
    (vhs=off + light clock frozen, so the only delta is the exposure resolve);
  * a 3-up crop (on | off | on-again) around the changed region;
  * the shipped-VHS spray on/off count for reference, flagged as
    VHS-temporal-contaminated (the whole frame differs, not just the blood).

Usage: python3 scripts/shutter-game-evidence.py <evidenceDir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence'
PAD = 40
THRESH = 8


def load(name):
    return np.asarray(Image.open(os.path.join(OUT, name)).convert('RGB')).astype(np.int16)


def changed(a, b, thresh=THRESH):
    return np.abs(a - b).max(axis=2) > thresh


def bbox(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def iou(m1, m2):
    inter = np.logical_and(m1, m2).sum()
    union = np.logical_or(m1, m2).sum()
    return float(inter) / float(union) if union else 0.0


def crop3up(a, b, c, box, path, scale=3):
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(a.shape[1] - 1, x1 + PAD); y1 = min(a.shape[0] - 1, y1 + PAD)
    strip = np.concatenate(
        [a[y0:y1 + 1, x0:x1 + 1], np.full((y1 - y0 + 1, 2, 3), 255, np.int16),
         b[y0:y1 + 1, x0:x1 + 1], np.full((y1 - y0 + 1, 2, 3), 255, np.int16),
         c[y0:y1 + 1, x0:x1 + 1]], axis=1,
    ).astype(np.uint8)
    img = Image.fromarray(strip)
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(path)
    return [int(x0), int(y0), int(x1), int(y1)]


def main():
    report = {}
    on = load('game-40-ab-on.png')
    off = load('game-41-ab-off.png')
    on2 = load('game-42-ab-on-again.png')
    m1 = changed(on, off)
    m2 = changed(on2, off)
    box = bbox(np.logical_or(m1, m2))
    report['deterministicAB'] = {
        'threshold': THRESH,
        'changedPxOnVsOff': int(m1.sum()),
        'changedPxOnAgainVsOff': int(m2.sum()),
        'changedMaskIoU': round(iou(m1, m2), 4),
        'bbox': box,
        'crop': crop3up(on, off, on2, box, os.path.join(OUT, 'game-70-ab-3up.png')) if box else None,
        'note': 'vhs=off + light clock frozen; delta is the exposure resolve',
    }
    # Shipped-VHS reference pair: whole-frame VHS temporal drift dominates, so
    # only the count is recorded, not a crop.
    try:
        s_on = load('game-10-spray-on-02.png')
        s_off = load('game-20-spray-off.png')
        report['shippedVhsSpray'] = {
            'threshold': THRESH,
            'changedPx': int(changed(s_on, s_off).sum()),
            'note': 'shipped VHS owns temporal blending; whole-frame drift dominates',
        }
    except FileNotFoundError:
        pass
    with open(os.path.join(OUT, 'game-image-diff.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
