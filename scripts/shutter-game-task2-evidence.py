#!/usr/bin/env python3
"""Post-step for the Task-2 in-game shutter evidence.

Scans the evidence dir for `t2-<scenario>-<variant>.png` files the harness wrote
and, for every scenario with a `sharp` frame, measures the changed-pixel area and
bounding box against the blur variants, then writes side-by-side crops. It also
measures the deterministic OFF noise floor (`det-on-a` vs `det-on-b` vs `det-off`)
so the ON/OFF signal can be shown to exceed temporal AA/VHS noise.

Usage: python3 scripts/shutter-game-task2-evidence.py <evidenceDir>
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence'
PAD = 36
THRESH = 8
SCALE = 2

FILE_RE = re.compile(r'^t2-(?P<scenario>.+?)__(?P<variant>[a-z0-9-]+)\.png$')


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
    if box is None:
        return None
    return [box[2] - box[0] + 1, box[3] - box[1] + 1]


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
    return [int(x0), int(y0), int(x1), int(y1)]


def tight_window(mask, size=200, step=10):
    """(changedPx, x, y) of the densest size x size window, via an integral image."""
    m = mask.astype(np.int64)
    ii = np.cumsum(np.cumsum(m, 0), 1)
    h, w = mask.shape
    sw, sh = min(size, w), min(size, h)
    best = (0, 0, 0)
    for y in range(0, h - sh + 1, step):
        for x in range(0, w - sw + 1, step):
            s = ii[y + sh - 1, x + sw - 1]
            if y > 0:
                s -= ii[y - 1, x + sw - 1]
            if x > 0:
                s -= ii[y + sh - 1, x - 1]
            if x > 0 and y > 0:
                s += ii[y - 1, x - 1]
            if s > best[0]:
                best = (int(s), x, y)
    return best


def main():
    files = {}
    for p in glob.glob(os.path.join(OUT, 't2-*.png')):
        m = FILE_RE.match(os.path.basename(p))
        if m:
            files.setdefault(m.group('scenario'), {})[m.group('variant')] = os.path.basename(p)

    report = {'threshold': THRESH, 'scenarios': {}, 'pairs': {}}

    for scenario, variants in sorted(files.items()):
        sharp_name = variants.get('sharp')
        entry = {'files': variants}
        rec = {}
        if sharp_name:
            sharp = load(sharp_name)
            for vid in ('m44', 'm67', 'm100'):
                if vid in variants:
                    v = load(variants[vid])
                    mask = changed(sharp, v)
                    box = bbox(mask)
                    rec[vid] = {
                        'changedPx': int(mask.sum()),
                        'bbox': box,
                        'bboxDims': bbox_dims(box),
                        'changedFrac': round(float(mask.mean()), 5),
                    }
            if 'm44' in variants and 'm67' in variants:
                m44 = changed(sharp, load(variants['m44']))
                m67 = changed(sharp, load(variants['m67']))
                inter = np.logical_and(m44, m67).sum()
                union = np.logical_or(m44, m67).sum()
                rec['m44_vs_m67_iou'] = round(float(inter) / float(union), 4) if union else 0.0
                rec['m67_minus_m44_changedPx'] = int(np.logical_and(m67, ~m44).sum())
                # A 3-up crop over the union of both changed regions.
                union_box = bbox(np.logical_or(m44, m67))
                if union_box:
                    out_name = f't2strip-{scenario}-sharp-m44-m67.png'
                    rec['strip'] = crop_row([sharp, load(variants['m44']), load(variants['m67'])], union_box,
                                            os.path.join(OUT, out_name))
                    rec['stripFile'] = out_name
                # A tighter, more legible crop around the densest changed window.
                px, tx, ty = tight_window(m44)
                if px > 0:
                    h, w = sharp.shape[:2]
                    tbox = (tx, ty, min(w - 1, tx + 199), min(h - 1, ty + 199))
                    tname = f't2tight-{scenario}-sharp-m44-m67.png'
                    rec['tightCrop'] = crop_row([sharp, load(variants['m44']), load(variants['m67'])], tbox,
                                                os.path.join(OUT, tname), scale=3)
                    rec['tightFile'] = tname
        entry['vsSharp'] = rec
        report['scenarios'][scenario] = entry

    # Deterministic OFF noise floor vs ON signal.
    det = files.get('det', {})
    if det.get('off') and det.get('on-a') and det.get('on-b'):
        off = load(det['off'])
        on_a = load(det['on-a'])
        on_b = load(det['on-b'])
        noise = changed(on_a, on_b)
        sig_a = changed(on_a, off)
        sig_b = changed(on_b, off)
        box = bbox(np.logical_or(sig_a, sig_b))
        report['det'] = {
            'note': 'vhs=off + render clocks held; delta is the exposure resolve',
            'onA_vs_onB_noise_changedPx': int(noise.sum()),
            'onA_vs_off_changedPx': int(sig_a.sum()),
            'onB_vs_off_changedPx': int(sig_b.sum()),
            'signal_to_noise_changedPx': round(float(max(sig_a.sum(), sig_b.sum())) / max(1, int(noise.sum())), 3),
            'bbox': box,
            'bboxDims': bbox_dims(box),
        }
        if det.get('cap200'):
            report['det']['cap200_vs_off_changedPx'] = int(changed(load(det['cap200']), off).sum())
        if det.get('m67'):
            report['det']['m67_vs_off_changedPx'] = int(changed(load(det['m67']), off).sum())
        if box:
            out_name = 't2strip-det-on-a-off-on-b-m67.png'
            imgs = [on_a, off, on_b]
            if det.get('m67'):
                imgs.append(load(det['m67']))
            report['det']['strip'] = crop_row(imgs, box, os.path.join(OUT, out_name))
            report['det']['stripFile'] = out_name
            report['det']['order'] = ['on-a', 'off', 'on-b', 'm67'][:len(imgs)]
        # Tight deterministic crop: sharp | m44 | m67 around the densest window.
        px, tx, ty = tight_window(sig_a)
        if px > 0:
            h, w = off.shape[:2]
            tbox = (tx, ty, min(w - 1, tx + 259), min(h - 1, ty + 259))
            tname = 't2tight-det-sharp-m44-m67.png'
            report['det']['tightCrop'] = crop_row(
                [off, on_a, load(det['m67']) if det.get('m67') else on_a], tbox,
                os.path.join(OUT, tname), scale=3)
            report['det']['tightFile'] = tname

    # parity scenario: sharp vs zero must be near-identical.
    par = files.get('parity', {})
    if par.get('sharp') and par.get('zero'):
        mask = changed(load(par['sharp']), load(par['zero']))
        report['parity'] = {
            'sharp_vs_zero_changedPx': int(mask.sum()),
            'changedFrac': round(float(mask.mean()), 6),
            'note': 'shipped VHS on; residual is VHS temporal history, not the resolve',
        }

    # deterministic parity: vhs=off, sharp -> zero -> sharp2. zero routes to the
    # fused sharp path, so sharp!=zero and sharp!=sharp2 must both be ~0.
    dp = files.get('detparity', {})
    if dp.get('sharp') and dp.get('zero') and dp.get('sharp2'):
        sharp = load(dp['sharp'])
        zero = load(dp['zero'])
        sharp2 = load(dp['sharp2'])
        noise = changed(sharp, sharp2)
        sig = changed(sharp, zero)
        report['detparity'] = {
            'sharp_vs_zero_changedPx': int(sig.sum()),
            'sharp_vs_sharp2_noise_changedPx': int(noise.sum()),
            'sharp_vs_zero_changedFrac': round(float(sig.mean()), 8),
            'sharp_vs_sharp2_changedFrac': round(float(noise.mean()), 8),
            'note': 'vhs=off; zero-exposure must render the fused sharp goo',
        }

    # empty-bypass parity: vhs=off + a cleared sim. Blur on must equal sharp.
    st = files.get('still', {})
    if st.get('sharp') and st.get('m44'):
        sharp = load(st['sharp'])
        sig44 = changed(sharp, load(st['m44']))
        sig100 = changed(sharp, load(st['m100'])) if st.get('m100') else None
        noise = changed(sharp, load(st['sharp2'])) if st.get('sharp2') else None
        report['still'] = {
            'blurOn44_vs_sharp_changedPx': int(sig44.sum()),
            'blurOn100_vs_sharp_changedPx': int(sig100.sum()) if sig100 is not None else None,
            'sharp_vs_sharp2_noise_changedPx': int(noise.sum()) if noise is not None else None,
            'note': 'vhs=off, sim cleared: the empty fast path returns the sharp frame',
        }

    with open(os.path.join(OUT, 'task2-image-diff.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
