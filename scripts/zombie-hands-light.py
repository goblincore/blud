#!/usr/bin/env python3
# scripts/zombie-hands-light.py — the light ALONG the zombie's arm, forearm into hand, read off game frames
# (zombie hands redo, 2026-11-22; frames and points from scripts/zombie-hands-capture.mjs).
#
# The owner's second reason for rejecting the mesh hands: they did not match the marched flesh's light. On one frame
# that shows as a STEP in the light where the forearm meets the hand. This samples a 5x5 box at each projected point
# down the forearm's axis (bone t 0.4 -> 1.5), as Rec.709 luma of the sRGB pixel and as mean RGB, and reports:
#   forearm  mean over t 0.65-0.85 (the forearm, short of the wrist)
#   hand     mean over t 1.05-1.20 (the palm / hand, past the wrist)
#   step     hand / forearm (1.00 = same light; the forearm and hand face the camera alike on these framings)
#   jump     the largest change between neighbouring samples across the wrist (t 0.85-1.10), against the median
#            neighbour change along the forearm: a seam shows as a jump many times the forearm's own
# Pixels the line leaves the body at (background) are flagged by a big luma drop and should be read by eye.
#
#   python3 scripts/zombie-hands-light.py <dir> [name ...]   -> prints a table, writes <name>-probe.png (the dots)
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

d = sys.argv[1]
names = sys.argv[2:] or sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json'))
for n in names:
    img = np.asarray(Image.open(f'{d}/{n}.png').convert('RGB')).astype(np.float64)
    pts = json.load(open(f'{d}/{n}.json'))['points']
    rows = []
    for p in pts:
        x, y = int(round(p['x'])), int(round(p['y']))
        if not (2 <= x < img.shape[1] - 2 and 2 <= y < img.shape[0] - 2):
            continue
        box = img[y - 2:y + 3, x - 2:x + 3].reshape(-1, 3).mean(0)
        rows.append((p['t'], 0.2126 * box[0] + 0.7152 * box[1] + 0.0722 * box[2], box))
    if not rows:
        print(f'{n}: no points on screen'); continue
    t = np.array([r[0] for r in rows]); L = np.array([r[1] for r in rows])
    fore = L[(t >= 0.65) & (t <= 0.85)]; hand = L[(t >= 1.05) & (t <= 1.20)]
    dl = np.abs(np.diff(L)); tm = (t[:-1] + t[1:]) / 2
    fore_d = np.median(dl[(tm >= 0.45) & (tm <= 0.85)]) if np.any((tm >= 0.45) & (tm <= 0.85)) else float('nan')
    wrist_d = dl[(tm >= 0.85) & (tm <= 1.10)].max() if np.any((tm >= 0.85) & (tm <= 1.10)) else float('nan')
    rgbf = np.mean([r[2] for r in rows if 0.65 <= r[0] <= 0.85], 0) if len(fore) else [0, 0, 0]
    rgbh = np.mean([r[2] for r in rows if 1.05 <= r[0] <= 1.20], 0) if len(hand) else [0, 0, 0]
    print(f'{n:16s} forearm {fore.mean():6.1f}  hand {hand.mean():6.1f}  step {hand.mean() / fore.mean():5.2f}  '
          f'jump {wrist_d:5.1f} (forearm neighbour median {fore_d:4.1f})  rgb fore {np.round(rgbf).astype(int)} hand {np.round(rgbh).astype(int)}')
    print('   profile t:L ' + ' '.join(f'{a:.2f}:{b:.0f}' for a, b in zip(t, L)))
    im = Image.open(f'{d}/{n}.png').convert('RGB'); dr = ImageDraw.Draw(im)
    for p in pts:
        c = (0, 255, 0) if p['t'] <= 0.85 else (255, 255, 0) if p['t'] < 1.05 else (255, 0, 255)
        dr.ellipse([p['x'] - 2, p['y'] - 2, p['x'] + 2, p['y'] + 2], outline=c)
    im.save(f'{d}/{n}-probe.png')
