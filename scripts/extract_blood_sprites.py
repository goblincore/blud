#!/usr/bin/env python3
"""Extract Blood (Build engine) sprite tiles into PNGs.

Reads BLOOD.RFF to recover PALETTE.DAT, then parses TILES*.ART files and
writes per-file contact sheets (HTML) plus individual PNGs. Dev-only
placeholder asset tooling.

See docs/dev-notes/2026-04-20-blood-sprite-extraction.md for the policy
around extracted Blood assets. Placeholders only, never ship.

Usage:
  python extract_blood_sprites.py <blood-dir> [--out DIR] [--art NAME]
"""
from __future__ import annotations
import argparse
import struct
from pathlib import Path

from PIL import Image


def read_palette_from_rff(rff_path: Path) -> bytes:
    data = rff_path.read_bytes()
    if data[:4] != b"RFF\x1a":
        raise ValueError(f"not an RFF file: magic {data[:4]!r}")
    version, fat_offset, num_files = struct.unpack_from("<III", data, 4)
    print(f"  RFF v0x{version:08x}  FAT@{fat_offset}  numFiles={num_files}")

    fat_raw = data[fat_offset : fat_offset + num_files * 48]
    # Blood RFF v3.1 FAT encryption: XOR each byte with (startKey + (i >> 1)) & 0xFF.
    # startKey is recovered from fat_raw[0] because Reserved[0] is always 0x00.
    start_key = fat_raw[0]
    fat = bytes(
        b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat_raw)
    )
    print(f"  FAT decryption startKey=0x{start_key:02x}")

    for i in range(num_files):
        entry = fat[i * 48 : (i + 1) * 48]
        offset, size = struct.unpack_from("<II", entry, 16)
        ext = entry[33:36]
        name = entry[36:44].rstrip(b"\x00 ")
        try:
            name_s = name.decode("ascii")
            ext_s = ext.decode("ascii")
        except UnicodeDecodeError:
            continue
        if name_s == "BLOOD" and ext_s == "PAL":
            print(f"  found BLOOD.PAL @ {offset}  size {size}")
            return data[offset : offset + 768]

    raise ValueError("BLOOD.PAL not found in RFF")


def palette_to_rgb(palette_768: bytes) -> bytes:
    # Blood's BLOOD.PAL is stored at 8-bit precision per channel — max byte
    # value observed is ~231, well above the 6-bit 0–63 range that
    # classic Build-engine docs (Shikadi wiki) describe. Use bytes as-is.
    return bytes(palette_768)


def read_art_file(art_path: Path):
    data = art_path.read_bytes()
    version, _unused, start, end = struct.unpack_from("<IIII", data, 0)
    if version != 1:
        raise ValueError(f"unexpected ART version {version} in {art_path.name}")
    n = end - start + 1
    off = 16
    sizx = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    sizy = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    _picanm = struct.unpack_from(f"<{n}I", data, off); off += n * 4
    tiles = []
    cur = off
    for i in range(n):
        w, h = sizx[i], sizy[i]
        if w == 0 or h == 0:
            tiles.append((start + i, w, h, None))
            continue
        tile_data = data[cur : cur + w * h]
        cur += w * h
        tiles.append((start + i, w, h, tile_data))
    return start, end, tiles


def tile_to_image(w: int, h: int, tile_data: bytes, palette_rgb: bytes) -> Image.Image:
    # ART pixel data is column-major; Pillow P-mode wants row-major.
    row_major = bytearray(w * h)
    for col in range(w):
        base_src = col * h
        for row in range(h):
            row_major[row * w + col] = tile_data[base_src + row]
    img = Image.new("P", (w, h))
    img.frombytes(bytes(row_major))
    img.putpalette(palette_rgb)
    img.info["transparency"] = 255  # Build-engine convention: index 255 = fullbright transparent
    return img


CELL_TMPL = (
    '<div class="cell"><div class="tile">{img}</div>'
    '<div class="n">{n}</div><div class="s">{w}x{h}</div></div>'
)


def dump_contact_sheet(
    art_name: str,
    start: int,
    tiles: list,
    out_dir: Path,
    palette_rgb: bytes,
    cols: int = 16,
    thumb_max: int = 96,
) -> None:
    tiles_dir = out_dir / f"{art_name}_tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for tile_num, w, h, tdata in tiles:
        if tdata is None:
            img_html = '<div class="empty"></div>'
        else:
            img = tile_to_image(w, h, tdata, palette_rgb)
            png_path = tiles_dir / f"{tile_num:05d}.png"
            img.save(png_path)
            scale = min(1, thumb_max / max(w, h))
            tw = max(1, int(w * scale))
            th = max(1, int(h * scale))
            img_html = (
                f'<img src="{tiles_dir.name}/{tile_num:05d}.png" '
                f'style="width:{tw}px;height:{th}px">'
            )
        items.append(CELL_TMPL.format(img=img_html, n=tile_num, w=w, h=h))
    inner = "".join(items)
    style = (
        "body{background:#111;color:#ccc;font:12px ui-monospace,monospace;margin:0;padding:16px}"
        "h1{font-size:14px;margin:0 0 12px;color:#eee}"
        f".grid{{display:grid;grid-template-columns:repeat({cols},minmax(0,1fr));gap:6px}}"
        ".cell{display:flex;flex-direction:column;align-items:center;padding:4px;"
        "border:1px solid #333;background:#1a1a1a}"
        ".tile{min-height:48px;display:flex;align-items:center;justify-content:center}"
        "img{image-rendering:pixelated;background:repeating-linear-gradient(45deg,#222,#222 4px,#2a2a2a 4px,#2a2a2a 8px)}"
        ".empty{width:48px;height:48px;background:#0a0a0a}"
        ".n{color:#8cf;margin-top:3px}.s{color:#777;font-size:10px}"
        "a{color:#8cf}"
    )
    doc = (
        f'<!doctype html><meta charset="utf-8"><title>{art_name}</title>'
        f'<style>{style}</style>'
        f'<h1>{art_name} — tiles {start}–{start + len(tiles) - 1} '
        f'<a href="index.html">[index]</a></h1>'
        f'<div class="grid">{inner}</div>'
    )
    (out_dir / f"{art_name}.html").write_text(doc)
    non_empty = sum(1 for t in tiles if t[3] is not None)
    print(f"  {art_name}: {len(tiles)} tiles ({non_empty} non-empty)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("blood_dir", help="Blood data dir (contains BLOOD.RFF + TILES*.ART)")
    ap.add_argument("--out", default="/tmp/blud-sprite-scan")
    ap.add_argument("--art", help="Only process this ART (e.g. tiles010.art)")
    args = ap.parse_args()

    blood_dir = Path(args.blood_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"reading BLOOD.RFF in {blood_dir}")
    palette = read_palette_from_rff(blood_dir / "BLOOD.RFF")
    (out_dir / "BLOOD.PAL").write_bytes(palette)
    palette_rgb = palette_to_rgb(palette)

    art_files = sorted(
        {p for p in blood_dir.glob("tiles*.art")}
        | {p for p in blood_dir.glob("TILES*.ART")}
    )
    if args.art:
        art_files = [p for p in art_files if p.name.lower() == args.art.lower()]

    print(f"processing {len(art_files)} ART files → {out_dir}")
    index_entries = []
    for art_path in art_files:
        start, end, tiles = read_art_file(art_path)
        dump_contact_sheet(art_path.stem, start, tiles, out_dir, palette_rgb)
        non_empty = sum(1 for t in tiles if t[3] is not None)
        index_entries.append((art_path.stem, start, end, non_empty))

    links = "".join(
        f'<li><a href="{name}.html">{name}</a> — tiles {s}–{e} ({ne} non-empty)</li>'
        for name, s, e, ne in index_entries
    )
    style = "body{background:#111;color:#ccc;font:13px ui-monospace,monospace;padding:16px}a{color:#8cf}"
    (out_dir / "index.html").write_text(
        f'<!doctype html><meta charset="utf-8"><title>Blud sprite scan</title>'
        f'<style>{style}</style>'
        f'<h1>Blud — Blood sprite scan</h1>'
        f'<p>Browse each ART file, note the tile-number range for the enemy/object you need, '
        f'then re-run with <code>--art tilesNNN.art</code> and harvest PNGs from the _tiles/ dir.</p>'
        f'<ul>{links}</ul>'
    )
    print(f"done. open file://{out_dir.resolve()}/index.html")


if __name__ == "__main__":
    main()
