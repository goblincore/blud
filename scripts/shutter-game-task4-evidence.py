#!/usr/bin/env python3
"""Post-step for the Task-4 combined shutter evidence.

Reads `t4-<scenario>__<variant>.png` pairs the harness wrote and measures:
  * changed-pixel area of each variant against the scenario's sharp/off frame;
  * tight 3-up crops at the densest changed window;
  * for the pure-spin fixture (`spin`), a RADIAL profile of the change: a
    fixed-centre rotation must leave a still centre and smear the rim, so the
    fraction of changed pixels in the inner disc is the rotation-only proxy;
  * for the occlusion leg (`occl`), how much the combined frame differs from
    gib-only inside the gib smear (blood over a blurred gib) and from blood-only
    inside the blood smear (gib over blood) — the ordering artifact.

Usage: python3 scripts/shutter-game-task4-evidence.py <evidenceDir>
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/dev-notes/2026-09-17-shutter-blur-game/evidence'
PAD = 40
THRESH = 8
SCALE = 2
FILE_RE = re.compile(r'^t4-(?P<scenario>.+?)__(?P<variant>[a-z0-9-]+)\.png$')


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


def tight_window(mask, size=240, step=10):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    best = None
    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    for cx in range(max(0, x_min - size // 2), min(max(1, mask.shape[1] - size), x_max), step):
        for cy in range(max(0, y_min - size // 2), min(max(1, mask.shape[0] - size), y_max), step):
            n = int(mask[cy:cy + size, cx:cx + size].sum())
            if best is None or n > best[0]:
                best = (n, cx, cy)
    if best is None:
        return None
    _, cx, cy = best
    return [cx, cy, cx + size - 1, cy + size - 1]


def radial_profile(mask):
    """Changed-pixel radial distribution about the change centroid.

    rmax is the 97th percentile radius, not the max: a handful of stray changed
    pixels elsewhere in the frame would otherwise inflate the normalisation and
    make every distribution read as "inner"."""
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    cx, cy = float(np.median(xs)), float(np.median(ys))
    r = np.hypot(xs - cx, ys - cy)
    rmax = float(np.percentile(r, 97)) or 1.0
    rn = r / rmax
    inner = float((rn < 0.35).mean())
    mid = float(((rn >= 0.35) & (rn < 0.7)).mean())
    outer = float((rn >= 0.7).mean())
    return {'centroid': [round(cx, 1), round(cy, 1)], 'r97Px': round(rmax, 1),
            'innerFrac': round(inner, 3), 'midFrac': round(mid, 3), 'outerFrac': round(outer, 3),
            'changedPx': int(mask.sum())}


def main():
    files = {}
    for p in glob.glob(os.path.join(OUT, 't4-*.png')):
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
            mask = changed(base, load(vfile))
            row['variants'][vid] = {
                'file': vfile,
                'changedPx': int(mask.sum()),
                'bbox': bbox(mask),
                'bboxDims': bbox_dims(bbox(mask)),
            }
        order = sorted(row['variants'].items(), key=lambda kv: -kv[1]['changedPx'])
        if order:
            picks = [ref] + [k for k, _ in order[:2]]
            imgs = [load(variants[k]) for k in picks if k in variants]
            mask = changed(base, load(variants[order[0][0]]))
            box = tight_window(mask) or bbox(mask)
            if box and len(imgs) >= 2:
                name = f't4tight-{scenario}-{"-".join(picks)}.png'
                crop_row(imgs, box, os.path.join(OUT, name))
                row['tight'] = name
                row['tightBox'] = box
        out['scenarios'][scenario] = row

    # Pure-spin radial signature. Reference is the SETTLED blur-off frame
    # (`off`), not the first `sharp` after the VHS switch: the post chain has a
    # one-frame transition that leaves a diffuse component in `sharp`.
    for scen in ('spindet', 'spin'):
        spin = files.get(scen, {})
        ref = 'off' if 'off' in spin else ('sharp' if 'sharp' in spin else None)
        if ref and ('m44' in spin or 'on-a' in spin):
            base = load(spin[ref])
            for vid in ('m44', 'on-a', 'm67'):
                if vid in spin:
                    prof = radial_profile(changed(base, load(spin[vid])))
                    if prof:
                        out.setdefault('spinRadial', {})[f'{scen}:{vid}'] = prof
            break
    # Real-blast rotation radial signature (VHS-off preferred).
    for scen in ('rotheaddet', 'rothead', 'rotlimb', 'rotwide'):
        s = files.get(scen, {})
        ref = 'off' if 'off' in s else ('sharp' if 'sharp' in s else None)
        vid = 'on-a' if 'on-a' in s else 'm44'
        if ref and vid in s:
            prof = radial_profile(changed(load(s[ref]), load(s[vid])))
            if prof:
                out.setdefault('rotationRadial', {})[scen] = prof

    # Combined deterministic attribution + signal/noise.
    for scen in ('combineddet', 'spindet', 'rotheaddet', 'occldet'):
        s = files.get(scen, {})
        baseId = 'off' if 'off' in s else ('sharp' if 'sharp' in s else None)
        if baseId is None:
            continue
        base = load(s[baseId])
        a = 'on-a' if 'on-a' in s else 'both44'
        b = 'on-b' if 'on-b' in s else 'both44b'
        row = {'reference': baseId, 'vsReference': {}}
        for vid, vfile in sorted(s.items()):
            if vid == baseId:
                continue
            row['vsReference'][vid] = int(changed(base, load(vfile)).sum())
        if a in s and b in s:
            row['noise_onA_vs_onB'] = int(changed(load(s[a]), load(s[b])).sum())
            row['signal_onA_vs_ref'] = row['vsReference'].get(a)
            row['signalToNoise'] = round(row['signal_onA_vs_ref'] / max(1, row['noise_onA_vs_onB']), 2)
        out.setdefault('deterministic', {})[scen] = row

    # Occlusion ordering: the combined frame vs each single channel.
    for scen in ('occldet', 'occl'):
        occl = files.get(scen, {})
        if all(k in occl for k in ('sharp', 'gibonly', 'bloodonly', 'both')):
            sharp = load(occl['sharp']); gib = load(occl['gibonly'])
            blood = load(occl['bloodonly']); both = load(occl['both'])
            gibMask = changed(sharp, gib)
            bloodMask = changed(sharp, blood)
            out['occlusion'] = {
                'scenario': scen,
                'gibMaskPx': int(gibMask.sum()),
                'bloodMaskPx': int(bloodMask.sum()),
                'both_vs_gibonly_insideGibMask': int(changed(gib, both)[gibMask].sum()),
                'both_vs_bloodonly_insideBloodMask': int(changed(blood, both)[bloodMask].sum()),
                'both_vs_sharpPx': int(changed(sharp, both).sum()),
            }
            break

    # Mutual-occlusion A/B on ONE frozen frame: the same combined frame with the
    # blurred-gib occluder depth ON vs OFF. `on` must add strictly fewer pixels
    # inside the gib smear than `off` (blood behind a blurred gib is dropped).
    ab = files.get('occlab', {})
    aboff = files.get('occlaboff', {})
    if all(k in ab for k in ('sharp', 'gibonly', 'bloodonly', 'bothocclon')) and 'bothoccloff' in aboff:
        sharp = load(ab['sharp']); gib = load(ab['gibonly']); blood = load(ab['bloodonly'])
        on = load(ab['bothocclon']); off = load(aboff['bothoccloff'])
        gibMask = changed(sharp, gib)
        bloodMask = changed(sharp, blood)
        out['mutualOcclusion'] = {
            'gibMaskPx': int(gibMask.sum()),
            'bloodMaskPx': int(bloodMask.sum()),
            'occluderOn_insideGibMask': int(changed(gib, on)[gibMask].sum()),
            'occluderOff_insideGibMask': int(changed(gib, off)[gibMask].sum()),
            'occluderOn_insideBloodMask': int(changed(blood, on)[bloodMask].sum()),
            'occluderOff_insideBloodMask': int(changed(blood, off)[bloodMask].sum()),
            'on_vs_off_allPx': int(changed(on, off).sum()),
        }

    with open(os.path.join(OUT, 'task4-image-diff.json'), 'w') as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
