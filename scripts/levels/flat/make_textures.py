# scripts/levels/flat/make_textures.py
"""Textures for the Flat. Plain python3 (Pillow, numpy), not Blender:

    python3 scripts/levels/flat/make_textures.py

Writes PNGs of 1024 px or less into assets-source/levels/flat-textures/ (the exporter refuses larger).
Stone colour and normal come from the kit's baked Bryce rock (assets-source/levels/kit-textures/rock-color.png, one tile = 1 m)
and the wet and rust runs of the look-dev's stain maps (docs/dev-notes/2026-10-01-flat-room-lookdev/room.py 228-253).
PNG row 0 is the TOP of the image (the highest z).
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import flat_layout as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ROCK = os.path.join(ROOT, "assets-source/levels/kit-textures/rock-color.png")
LOOKDEV = os.path.join(ROOT, "docs/dev-notes/2026-10-01-flat-room-lookdev")
IDYLL = os.path.join(ROOT, "docs/dev-notes/2026-10-01-flat-emergence-lookdev/view-bryce-moody.png")
OUT = os.path.join(ROOT, "assets-source/levels/flat-textures")
CASTLE = np.array((1.45, 1.45, 1.45), np.float32)     # castle stone a step lighter than the baked rock (room.py 266 used 1.6/1.55/1.45; the engine's warm ambient wants it neutral)


def save(arr, name):
    """PNG, or JPEG for `.jpg` names: the embedded art file stays small, and 4:4:4 keeps a normal map's channels clean."""
    os.makedirs(OUT, exist_ok=True)
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    if name.endswith(".jpg"):
        im.save(os.path.join(OUT, name), quality=90, subsampling=0)
    else:
        im.save(os.path.join(OUT, name))
    print("wrote", name, arr.shape[1], "x", arr.shape[0])


def rock():
    return np.asarray(Image.open(ROCK).convert("RGB"), np.float32) / 255.0


def lin(c):
    """sRGB to linear light: the look-dev's colour maths (tints, mixes) ran in linear, so ours does too."""
    return np.power(c, 2.2)


def srgb(c):
    return np.power(np.clip(c, 0, 1), 1 / 2.2)


def tile_to(img, w_m, h_m, px):
    """The 1 m rock tile repeated to cover w_m x h_m metres in a px x px image (anisotropic when w_m != h_m)."""
    tw, th = max(1, round(px / w_m)), max(1, round(px / h_m))
    tile = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS), np.float32) / 255.0
    return np.tile(tile, (int(np.ceil(px / th)), int(np.ceil(px / tw)), 1))[:px, :px]


def smooth_noise(px, cells, seed):
    g = np.random.default_rng(seed).random((cells + 1, cells + 1)).astype(np.float32)
    return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((px, px), Image.BICUBIC), np.float32) / 255.0


def stain_map(w_m, h_m, sources, seed, ppm=200):
    """Wet (R) and rust (G) runs down a wall, in z-up rows (row 0 = z 0). Ported from room.py 228-253, then resized."""
    W, H = int(w_m * ppm), int(h_m * ppm)
    img = np.zeros((H, W, 2), np.float32)
    rnd = np.random.default_rng(seed)
    for (u, z, spread, length, strength) in sources:
        for _ in range(int(40 * spread / 0.1) + 8):
            x = int((u + rnd.normal(0, spread)) * ppm)
            top = int((z + rnd.normal(0, 0.03)) * ppm)
            run = int(length * ppm * rnd.uniform(0.3, 1.0))
            wpx = int(rnd.integers(1, 4))
            rust = rnd.uniform(0.0, 1.0)
            for yy in range(max(0, top - run), min(H, top)):
                t = (top - yy) / max(run, 1)
                a = strength * (1 - t) ** 1.5 * rnd.uniform(0.6, 1.0)
                x0, x1 = max(0, x - wpx), min(W, x + wpx)
                if x0 < x1:
                    img[yy, x0:x1, 0] = np.maximum(img[yy, x0:x1, 0], a)
                    img[yy, x0:x1, 1] = np.maximum(img[yy, x0:x1, 1], a * rust)
                x += int(rnd.integers(-1, 2)) if rnd.random() < 0.08 else 0
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.sqrt(((xx / ppm - u) / (spread * 2.5)) ** 2 + ((yy / ppm - z) / (spread * 2.0)) ** 2)
        img[..., 0] = np.maximum(img[..., 0], strength * 0.6 * np.clip(1 - d, 0, 1))
    k = 3                                                   # soften across the run (room.py 249-251)
    for c in (0, 1):
        cs = np.cumsum(np.pad(img[..., c], ((0, 0), (k, k)), mode="edge"), axis=1)
        img[..., c] = (cs[:, 2 * k:] - cs[:, :-2 * k]) / (2 * k)
    return img


def normal_from_height(h, strength):
    """Tangent-space normal (OpenGL, +green up) from a height field whose row 0 is the top."""
    gy, gx = np.gradient(h)
    n = np.dstack((-gx * strength, gy * strength, np.ones_like(h)))
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def make_stone(name, w_m, h_m, px=1024, tint=(1.0, 1.0, 1.0), courses=None, stains=None, damp=True, seed=0):
    """name_color.jpg and name_normal.jpg: castle stone over a w_m x h_m metre area (z up, row 0 the top)."""
    base = tile_to(rock(), w_m, h_m, px)
    col = np.clip(lin(base) * np.array(tint, np.float32) * CASTLE, 0, 1)
    height = base.mean(axis=2)
    zz = (1.0 - (np.arange(px)[:, None] + 0.5) / px) * h_m * np.ones((1, px), np.float32)      # metres above the base
    xx = (np.arange(px)[None, :] + 0.5) / px * w_m * np.ones((px, 1), np.float32)
    if courses:
        bw, bh = courses
        row = np.floor(zz / bh)
        fx = ((xx + (row % 2) * bw * 0.5) / bw) % 1.0
        fy = (zz / bh) % 1.0
        d = np.minimum.reduce([fx * bw, (1 - fx) * bw, fy * bh, (1 - fy) * bh])               # metres to the nearest mortar line
        mortar = np.clip(1.0 - d / 0.012, 0, 1)
        col = col * (1 - 0.9 * mortar[..., None]) + mortar[..., None] * np.array((0.03, 0.028, 0.025), np.float32) * 0.9
        height = height - 0.6 * mortar
    if damp:
        dz = np.clip((0.55 - zz) / 0.5, 0, 1) * 0.75 * (0.3 + 0.7 * smooth_noise(px, 12, seed + 7))
        col = col * (1 - dz[..., None]) + dz[..., None] * np.array((0.025, 0.032, 0.018), np.float32)
    if stains:
        st = stain_map(w_m, h_m, stains, seed)
        st = np.stack([np.asarray(Image.fromarray(st[..., c]).resize((px, px), Image.BICUBIC), np.float32) for c in (0, 1)], axis=2)
        st = np.flipud(st)                                                                     # z-up rows -> PNG rows
        rust, wet = st[..., 1:2], st[..., 0:1] * 0.85
        col = col * (1 - rust) + rust * np.array((0.2, 0.075, 0.02), np.float32)
        col = col * (1 - wet) + wet * np.array((0.018, 0.016, 0.01), np.float32)
    save(srgb(col), f"{name}_color.jpg")
    save(normal_from_height(height, 6.0), f"{name}_normal.jpg")


def make_tatami(px=512):
    """Aged igusa straw: fine weave lines (one tile is 0.9 m), faded green-gold (room.py 327-342)."""
    n = smooth_noise(px, 8, 3)[..., None]
    col = np.array((0.24, 0.20, 0.08), np.float32) * (1 - n) + np.array((0.42, 0.40, 0.18), np.float32) * n
    u = (np.arange(px)[None, :] / px * 90) % 1.0
    line = (np.abs(u - 0.5) * 2) ** 3 * 0.55
    col = col * (1 - line[..., None]) + line[..., None] * np.array((0.16, 0.13, 0.05), np.float32)
    save(srgb(col * np.ones((px, 1, 1), np.float32)), "tatami.jpg")


def make_quilt(px=512):
    """The kawaii quilt: the look-dev's own tile if textures.py runs here (it wants Hiragino for the posters), else a plain pink one."""
    tmp = os.path.join(ROOT, ".lab-tmp", "flat-quilt")
    os.makedirs(tmp, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(LOOKDEV, "textures.py"), tmp], check=False, capture_output=True)
    src = os.path.join(tmp, "quilt.png")
    if os.path.exists(src):
        arr = np.asarray(Image.open(src).convert("RGB").resize((px, px), Image.LANCZOS), np.float32) / 255.0
    else:
        yy, xx = np.mgrid[0:px, 0:px] / px
        dots = (np.sin(xx * 6.283 * 6) * np.sin(yy * 6.283 * 6) > 0.6).astype(np.float32)[..., None]
        arr = np.array((0.95, 0.72, 0.8), np.float32) * (1 - dots) + dots * np.array((1.0, 0.95, 0.97), np.float32)
    save(arr, "quilt.png")


def make_books():
    """An 8-stripe palette (room.py SPINES, 1209-1215 neighbourhood): a book's UVs point at its stripe."""
    pal = [(0.85, 0.1, 0.15), (0.1, 0.25, 0.7), (0.95, 0.8, 0.2), (0.15, 0.6, 0.35), (0.95, 0.95, 0.92), (0.1, 0.1, 0.12),
           (0.9, 0.45, 0.65), (0.4, 0.75, 0.95), (0.6, 0.2, 0.7)]
    arr = np.zeros((16, 9 * 16, 3), np.float32)
    for i, c in enumerate(pal):
        arr[:, i * 16:(i + 1) * 16] = c
    save(srgb(arr), "books.png")


def make_view():
    im = Image.open(IDYLL).convert("RGB")
    im.thumbnail((1024, 1024), Image.LANCZOS)
    save(np.asarray(im, np.float32) / 255.0, "view.jpg")


def periodic_noise(px, scale, seed):
    """Band-limited noise that tiles in both axes (FFT-filtered), 0..1. `scale`: cycles across the image at the cutoff."""
    rnd = np.random.default_rng(seed)
    f = np.fft.fft2(rnd.standard_normal((px, px)))
    fy = np.fft.fftfreq(px)[:, None] * px
    fx = np.fft.fftfreq(px)[None, :] * px
    f *= np.exp(-((np.hypot(fx, fy) / scale) ** 2))
    n = np.real(np.fft.ifft2(f))
    return (n - n.min()) / (n.max() - n.min())


def make_shell(px=1024):
    """The iMac's amber shell (room.py giger_shell_material, 904-936): bile-amber glow with dark-red veins. UV u = round the body (tiles), v = along it."""
    th = periodic_noise(px, 5, 11)[..., None]
    glow = lin_mix(np.array((0.95, 0.24, 0.05), np.float32), np.array((1.0, 0.50, 0.16), np.float32), th)      # deeper than the look-dev's numbers: the engine's lamps and alpha lighten it
    n1, n2 = periodic_noise(px, 14, 21), periodic_noise(px, 36, 22)
    vein = np.maximum(np.clip(1 - np.abs(n1 - 0.5) / 0.05, 0, 1), np.clip(1 - np.abs(n2 - 0.5) / 0.03, 0, 1) * 0.9)[..., None]
    col = glow * (1 - vein) + vein * np.array((0.28, 0.02, 0.02), np.float32)
    save(srgb(col), "shell_color.jpg")


def lin_mix(a, b, t):
    return a * (1 - t) + b * t


def make_screen(px=(1024, 768)):
    """The screen: the Night Train frame with scanlines (room.py 939-952: sin over the height, 0.55 to 1.0) and a lift, standing in for emission strength 2.6
    (the engine caps emission at 1). Needs screen-source.png (scripts/capture-flat-screen.sh)."""
    src = os.path.join(OUT, "screen-source.png")
    im = np.asarray(Image.open(src).convert("RGB").resize(px, Image.LANCZOS), np.float32) / 255.0
    v = (np.arange(px[1])[:, None] + 0.5) / px[1]
    lines = 0.55 + 0.45 * (np.sin(v * 1300.0) + 1) / 2
    save(np.clip(np.power(im, 0.6) * lines[..., None] * 1.3, 0, 1), "screen.jpg")      # gamma 0.6 lifts the moody frame's shadows: a CRT glows


def make_door(w=512, h=1024):
    """Oak planks for the front door. One image is the leaf: 0.8 m wide, 2.05 m up to the arch's crown (so the aspect is 0.39). Six planks, each its own
    tint, vertical grain, dark gaps between."""
    n = 6
    rnd = np.random.default_rng(5)
    x = (np.arange(w)[None, :] + 0.5) / w
    plank = np.minimum(np.floor(x * n), n - 1).astype(int)
    tint = (0.75 + 0.5 * rnd.random(n))[plank]                                  # per-plank brightness, (1, w)
    fine = periodic_noise(1024, 70, 3)[:96]                                   # fine across, stretched along the plank: vertical grain
    grain = np.asarray(Image.fromarray((fine * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    fx = (x * n) % 1.0
    gap = np.clip(1 - np.minimum(fx, 1 - fx) / 0.018, 0, 1)                     # dark seams between planks
    col = np.array((0.30, 0.14, 0.06), np.float32) * (tint * (0.55 + 0.9 * grain))[..., None]
    col = col * (1 - gap[..., None]) + gap[..., None] * np.array((0.015, 0.008, 0.004), np.float32)
    save(srgb(col), "door_oak.jpg")


def make_bath_tile(px=1024):
    """Small square wall tiles, 10 cm each (one image is 1 m): a dingy pale green, a grey grout, grime. No damp band: the image repeats every metre."""
    n = 10
    x = (np.arange(px)[None, :] + 0.5) / px * n
    y = (np.arange(px)[:, None] + 0.5) / px * n
    fx, fy = x % 1.0, y % 1.0
    d = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    grout = np.clip(1 - d / 0.035, 0, 1)[..., None]
    rnd = np.random.default_rng(8)
    tint = (0.85 + 0.15 * rnd.random((n, n)))[np.floor(y).astype(int) % n, np.floor(x).astype(int) % n]
    base = np.array((0.42, 0.50, 0.44), np.float32) * tint[..., None] * (0.75 + 0.25 * periodic_noise(px, 6, 31))[..., None]
    col = base * (1 - grout) + grout * np.array((0.10, 0.10, 0.09), np.float32)
    save(srgb(col), "bath_tile.jpg")


def make_bath_floor(px=512):
    """The bathroom floor: 20 cm tiles in a dark, grimy checker (one image is 1 m)."""
    n = 5
    x = (np.arange(px)[None, :] + 0.5) / px * n
    y = (np.arange(px)[:, None] + 0.5) / px * n
    checker = ((np.floor(x) + np.floor(y)) % 2)[..., None]
    d = np.minimum(np.minimum(x % 1.0, 1 - x % 1.0), np.minimum(y % 1.0, 1 - y % 1.0))
    grout = np.clip(1 - d / 0.03, 0, 1)[..., None]
    base = np.array((0.07, 0.08, 0.07), np.float32) * (1 - checker) + np.array((0.15, 0.16, 0.14), np.float32) * checker
    base = base * (0.7 + 0.3 * periodic_noise(px, 8, 41))[..., None]
    save(srgb(base * (1 - grout) + grout * np.array((0.03, 0.03, 0.03), np.float32)), "bath_floor.jpg")


def make_mirror_glass(w=256, h=384):
    """The mirror's dark polished glass: a deep warm black, a vignette and two painted glints. It reflects nothing yet (the planar mirror is a later spike)."""
    yy, xx = np.mgrid[0:h, 0:w]
    u, v = xx / w, yy / h
    vig = (0.55 + 0.45 * (1 - np.clip(np.hypot((u - 0.5) * 1.5, (v - 0.5) * 1.05), 0, 1)))[..., None]
    glint = (np.exp(-((u + 0.6 * v - 0.55) / 0.08) ** 2) * 0.5 + np.exp(-((u + 0.6 * v - 0.95) / 0.03) ** 2) * 0.35)[..., None]
    col = np.array((0.014, 0.011, 0.012), np.float32) * vig + glint * np.array((0.50, 0.40, 0.32), np.float32) * 0.45
    save(srgb(col), "mirror_glass.jpg")


if __name__ == "__main__":
    for key in ("n", "e", "w", "s", "eh", "wh"):
        make_stone(f"wall_{key}", L.WALL_W[key], L.WALL_H, 1024, stains=L.STAINS[key] or None, seed={"n": 1, "e": 2, "w": 3, "s": 5, "eh": 6, "wh": 7}[key])
    make_stone("vault", 1.68, 0.96, 1024, tint=(0.95, 0.93, 0.9), courses=(0.42, 0.24), damp=False)   # UV = metres / (1.68, 0.96)
    make_stone("flag", 1.8, 1.8, 1024, tint=(0.85, 0.85, 0.85), courses=(0.6, 0.45))                  # UV = metres / 1.8
    make_stone("dark", 1.0, 1.0, 512, tint=(0.8, 0.78, 0.74), damp=False)                              # UV = metres
    make_tatami()
    make_quilt()
    make_books()
    make_view()
    make_shell()
    make_screen()
    make_door()
    make_bath_tile()
    make_bath_floor()
    make_mirror_glass()
