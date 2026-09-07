#!/usr/bin/env python3
"""docs/dev-notes/2026-09-07-per-ray-wound-list/diff.py — PIL diff for the
per-ray wound-list parity gate.

Reads the four captures (off-a/off-b/on/off-c) and counts pixels whose max
per-channel delta exceeds DELTA. The top HUD strip (44 px) is excluded — its
frame EMA ticks even frozen (closeup-woundcull-capture.mjs convention). The
signal is off-a vs on (the wound-list gate); the floor is off-a vs off-b
(same-state noise). The GATE: on-vs-off differing pixels must be <= 1.5x the
off-vs-off floor, and the mask must show no silhouette edges or filled regions
— that verdict is LOOKED at, not read off a number.

Usage:  python3 docs/dev-notes/2026-09-07-per-ray-wound-list/diff.py
Outputs mask PNGs and prints counts.
"""
import os
import sys
from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
DELTA = 8
TOP_SKIP = 44  # HUD strip: its frame EMA ticks even frozen
# FPV weapon region (closeup-woundcull-capture.mjs WEAPON_MASK): the
# hand-held gun/hands still sway subtly even frozen, and it carries no SDF
# wounds, so masking it keeps a bit-identical wound-list gate readable.
WEAPON_MASK = (310, 532, 801, 799)


def load(name):
    img = Image.open(os.path.join(HERE, name)).convert("RGB")
    if img.size != (1280, 800):
        print(f"WARNING: {name} is {img.size}, expected (1280, 800)")
    return img


def mask_region(mp, w, h, box):
    """Zero the mask inside [x0,y0,x1,y1] (scene coordinates, already HUD-cropped).
    Used to exclude the FPV weapon, which is not an SDF-wounded body."""
    x0, y0, x1, y1 = box
    y0m = y0 - TOP_SKIP
    y1m = y1 - TOP_SKIP
    for y in range(max(0, y0m), min(h, y1m + 1)):
        for x in range(max(0, x0), min(w, x1 + 1)):
            mp[x, y] = 0


def diff_mask(a, b):
    """Return (mask, count, max_delta): mask is 'L' image, white where the
    max per-channel delta exceeds DELTA, within the scene region below the HUD
    and outside the FPV weapon region."""
    w, h = a.size
    # crop the HUD strip off, then diff the scene
    a2 = a.crop((0, TOP_SKIP, w, h))
    b2 = b.crop((0, TOP_SKIP, w, h))
    d = ImageChops.difference(a2, b2)
    arr = list(d.getdata())
    mask = Image.new("L", (w, h - TOP_SKIP), 0)
    mp = mask.load()
    count = 0
    max_d = 0
    for i, px in enumerate(arr):
        md = max(px[0], px[1], px[2])
        if md > max_d:
            max_d = md
        if md > DELTA:
            x = i % w
            y = i // w
            mp[x, y] = 255
            count += 1
    # zero the FPV weapon region, recount so the stored count matches the mask
    mask_region(mp, w, h - TOP_SKIP, WEAPON_MASK)
    arr2 = list(mask.getdata())
    count = sum(1 for v in arr2 if v)
    return mask, count, max_d


def save(mask, name):
    mask.save(os.path.join(HERE, name))


def main():
    off_a = load("off-a.png")
    off_b = load("off-b.png")
    on = load("on.png")
    off_c = load("off-c.png")

    floor_mask, floor_count, floor_max = diff_mask(off_a, off_b)
    sig_mask, sig_count, sig_max = diff_mask(off_a, on)
    recheck_mask, recheck_count, recheck_max = diff_mask(off_a, off_c)

    save(floor_mask, "mask-offa-offb.png")
    save(sig_mask, "mask-offa-on.png")
    save(recheck_mask, "mask-offa-offc.png")

    total_px = 1280 * (800 - TOP_SKIP)
    print("parity diff (channel delta > %d, HUD strip %dpx excluded):" % (DELTA, TOP_SKIP))
    print("  off-a vs off-b (same-state NOISE FLOOR): %d px (%.4f%%)  maxD=%d" % (
        floor_count, 100.0 * floor_count / total_px, floor_max))
    print("  off-a vs on     (SIGNAL, wound list):      %d px (%.4f%%)  maxD=%d" % (
        sig_count, 100.0 * sig_count / total_px, sig_max))
    print("  off-a vs off-c  (recheck, back to OFF):    %d px (%.4f%%)  maxD=%d" % (
        recheck_count, 100.0 * recheck_count / total_px, recheck_max))

    ratio = sig_count / floor_count if floor_count else float("inf")
    print("  signal/floor ratio = %.2f  (gate: <= 1.5)" % ratio)
    gate_floor = 1.5 * floor_count
    gate_pass = sig_count <= gate_floor
    print("  gate limit (1.5x floor) = %d px" % gate_floor)
    print("GATE NUMERIC:", "PASS" if gate_pass else "FAIL")
    print("  NOTE: the shape verdict (no silhouette edges / filled regions) is judged by LOOKING at the mask PNGs.")
    print("  masks:", [
        os.path.join(HERE, "mask-offa-offb.png"),
        os.path.join(HERE, "mask-offa-on.png"),
        os.path.join(HERE, "mask-offa-offc.png"),
    ])


if __name__ == "__main__":
    main()
