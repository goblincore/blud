#!/usr/bin/env python3
"""Post-step for the Task-3 flying-gib shutter evidence.

Scans the evidence dir for `t3-<scenario>__<variant>.png` files the harness
wrote and, for every scenario with a `sharp` (or `off`) reference, measures the
changed-pixel area against the blur variants and writes tight 3-up crops at the
densest changed window. Also measures the deterministic OFF noise floor
(`on-a` vs `on-b` at the same frozen instant) so the ON/OFF signal can be shown
to exceed it.

Usage: python3 scripts/shutter-game-task3-evidence.py <evidenceDir>
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence'
PAD = 48
THRESH = 8
SCALE = 2

FILE_RE = re.compile(r'^t3-(?P<scenario>.+?)__(?P<variant>[a-z0-9-]+)\.png$')


def load(name):
    return np.asarray(Image.open(os.path.join(OUT, name)).convert('RGB')).astype(np.int16)


def changed(a, b, thresh=THRESH):
    return np.abs(a - b).max(axis=2) > thresh


def bbox(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def bbox_dims(box):
    return None if box is None else [box[2] - box[0] + 1, box[3] - box[1] + 1]


def crop_row(imgs, box, path, scale=SCALE):
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(imgs[0].shape[1] - 1, x1 + PAD); y1 = min(imgs[0].shape[0] - 1, y1 + PAD)
    parts = []
    sep = np.full((y1 - y0 + 1, 3, 3), 255, np.int16)
    for i, im in enumerate(imgs):
        if i:
            parts.append(sep)
        parts.append(im[y0:y1 + 1, x0:x1 + 1])
    strip = np.concatenate(parts, axis=1).astype(np.uint8)
    img = Image.fromarray(strip)
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    img.save(path)


def tight_window(mask, size=220, step=12):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    best = None
    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    for cx in range(max(0, x_min - size // 2), min(mask.shape[1] - size, x_max), step):
        for cy in range(max(0, y_min - size // 2), min(mask.shape[0] - size, y_max), step):
            n = int(mask[cy:cy + size, cx:cx + size].sum())
            if best is None or n > best[0]:
                best = (n, cx, cy)
    if best is None:
        return None
    _, cx, cy = best
    return [cx, cy, cx + size - 1, cy + size - 1]


def main():
    files = {}
    for p in glob.glob(os.path.join(OUT, 't3-*.png')):
        m = FILE_RE.match(os.path.basename(p))
        if m:
            files.setdefault(m.group('scenario'), {})[m.group('variant')] = os.path.basename(p)

    out = {'threshold': THRESH, 'scenarios': {}}
    for scenario, variants in sorted(files.items()):
        ref = 'sharp' if 'sharp' in variants else ('off' if 'off' in variants else None)
        if ref is None:
            continue
        base = load(variants[ref])
        row = {'reference': ref, 'referenceFile': variants[ref], 'variants': {}}
        for vid, vfile in sorted(variants.items()):
            if vid == ref:
                continue
            img = load(vfile)
            mask = changed(base, img)
            box = bbox(mask)
            entry = {
                'file': vfile,
                'changedPx': int(mask.sum()),
                'bbox': box,
                'bboxDims': bbox_dims(box),
            }
            row['variants'][vid] = entry
        # Tight 3-up: reference | strongest | second strongest.
        order = sorted(row['variants'].items(), key=lambda kv: -kv[1]['changedPx'])
        if order:
            picks = [ref] + [k for k, _ in order[:2]]
            imgs = [load(variants[k]) for k in picks if k in variants]
            mask = changed(base, load(variants[order[0][0]]))
            box = tight_window(mask) or bbox(mask)
            if box and len(imgs) >= 2:
                crop_row(imgs, box, os.path.join(OUT, f't3tight-{scenario}-{"-".join(picks)}.png'))
                row['tight'] = f't3tight-{scenario}-{"-".join(picks)}.png'
                row['tightBox'] = box
        out['scenarios'][scenario] = row

    # Deterministic noise floor: on-a vs on-b against a common frame.
    det = files.get('gibdet', {})
    if 'on-a' in det and 'on-b' in det and 'off' in det:
        a, b, off = load(det['on-a']), load(det['on-b']), load(det['off'])
        out['deterministic'] = {
            'onA_vs_onB_noisePx': int(changed(a, b).sum()),
            'onA_vs_off_changedPx': int(changed(a, off).sum()),
            'onB_vs_off_changedPx': int(changed(b, off).sum()),
        }
        out['deterministic']['signalToNoise'] = (
            round(out['deterministic']['onA_vs_off_changedPx']
                  / max(1, out['deterministic']['onA_vs_onB_noisePx']), 2)
        )

    with open(os.path.join(OUT, 'task3-image-diff.json'), 'w') as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
