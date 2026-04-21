"""ART tile metadata extraction — tile dimensions + anchor offsets.

Reads Build engine TILES*.ART files and decodes per-tile picanm bitfields.
Used to get pixel dimensions and anchor offsets for sprites referenced by
QAV and SEQ animations.

ART file format (version 1):
  Header (16 bytes): version(i32), unused(i32), start_tile(i32), end_tile(i32)
  Per-tile arrays:
    sizx[]  — u16 × (end - start + 1)
    sizy[]  — u16 × (end - start + 1)
    picanm[] — u32 × (end - start + 1)  (bitfield: anim + offsets)
  Pixel data follows (column-major, indexed color).
"""
from __future__ import annotations

import struct
from pathlib import Path
from typing import Any


def decode_picanm(picanm: int) -> dict[str, int]:
    """Decode a 32-bit picanm field from an ART header.

    Bit layout (Build engine convention):
      bits 0-5   animFrames (6 bits, 0-63)
      bits 6-7   animType   (0=noanim, 1=oscillate, 2=forward, 3=backward)
      bits 8-15  xoffset    (signed int8)
      bits 16-23 yoffset    (signed int8)
      bits 24-27 animSpeed  (4 bits)
      bits 28-31 extra flags
    """
    xoff_raw = (picanm >> 8) & 0xFF
    yoff_raw = (picanm >> 16) & 0xFF
    # Sign-extend 8-bit → int
    xoff = xoff_raw - 256 if xoff_raw >= 128 else xoff_raw
    yoff = yoff_raw - 256 if yoff_raw >= 128 else yoff_raw
    return {
        "animFrames": picanm & 0x3F,
        "animType": (picanm >> 6) & 0x3,
        "xoffset": xoff,
        "yoffset": yoff,
    }


def read_art_meta(art_path: Path) -> list[dict[str, Any]]:
    """Read tile metadata (sizx, sizy, picanm) from a TILES*.ART file.

    Returns list of {picnum, w, h, xoffset, yoffset} — one entry per tile
    in the ART file, including blank tiles (w=h=0).
    """
    data = Path(art_path).read_bytes()
    version, _unused, start, end = struct.unpack_from("<IIII", data, 0)
    if version != 1:
        raise ValueError(f"unexpected ART version {version} in {art_path.name}")
    n = end - start + 1
    off = 16
    sizx = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    sizy = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    picanm = struct.unpack_from(f"<{n}I", data, off); off += n * 4
    out: list[dict[str, Any]] = []
    for i in range(n):
        anm = decode_picanm(picanm[i])
        out.append({
            "picnum": start + i,
            "w": sizx[i],
            "h": sizy[i],
            "xoffset": anm["xoffset"],
            "yoffset": anm["yoffset"],
        })
    return out
