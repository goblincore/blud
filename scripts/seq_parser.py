"""SEQ binary parser. Layout from NotBlood source/blood/src/seq.h.

Header (16 bytes):
  char  signature[4]    — "SEQ\\x1a"
  short version          — e.g. 0x300
  short nFrames
  short ticksPerFrame
  short nSoundID
  int   flags

Each SEQFRAME: 8 bytes (64-bit bitfield, little-endian).
  Bitfield layout (from seq.h SEQFRAME struct, C bitfield packing on LE):
    bits  0-11  tile           (12 bits) — low part of tile number
    bit   12    transparent    (1 bit)
    bit   13    transparent2   (1 bit)
    bit   14    blockable      (1 bit)
    bit   15    hittable       (1 bit)
    bits 16-23  xrepeat        (8 bits)
    bits 24-31  yrepeat        (8 bits)
    bits 32-39  shade          (8 bits, signed)
    bits 40-44  pal            (5 bits)
    bit   45    trigger        (1 bit)
    bit   46    smoke          (1 bit)
    bit   47    autoaim        (1 bit)
    bits 44-47  tile2          (4 bits) — NOTE: overlaps with trigger/smoke/autoaim!

  IMPORTANT: The tile2 field (bits 44-47) overlaps with trigger(45), smoke(46),
  autoaim(47) in the C bitfield declaration. In practice, Blood uses the full
  tile2 = bits 44-47 for tile number extension. The seqGetTile() function
  confirms: return pFrame->tile + (pFrame->tile2 << 12).
  
  Additional fields (after tile2 in the struct):
    bit   48    pushable       (1 bit)
    bit   49    playSound      (1 bit)
    bit   50    invisible      (1 bit)
    bit   51    xflip          (1 bit)
    bit   52    yflip          (1 bit)
    bits 53-56  soundRange     (4 bits, NOONE_EXTENSIONS) OR reserved(7 bits)
    bit   57    surfaceSound   (1 bit, NOONE_EXTENSIONS) OR part of reserved
    bits 58-59  pal2           (2 bits, NOONE_EXTENSIONS) OR part of reserved
"""
from __future__ import annotations

import struct
from typing import Any

SEQ_HEADER_FMT = "<4sHHHHI"
SEQ_HEADER_SIZE = struct.calcsize(SEQ_HEADER_FMT)  # 16
SEQFRAME_SIZE = 8


def _sign_extend_8bit(val: int) -> int:
    """Sign-extend an 8-bit unsigned value to a Python signed int."""
    if val >= 0x80:
        return val - 0x100
    return val


def _unpack_seqframe(raw: int) -> dict[str, Any]:
    """Decode a 64-bit SEQFRAME value into a dict."""
    tile_low = raw & 0xFFF               # bits 0-11
    transparent = (raw >> 12) & 1         # bit 12
    transparent2 = (raw >> 13) & 1        # bit 13
    blockable = (raw >> 14) & 1           # bit 14
    hittable = (raw >> 15) & 1            # bit 15
    xrepeat = (raw >> 16) & 0xFF         # bits 16-23
    yrepeat = (raw >> 24) & 0xFF         # bits 24-31
    shade = _sign_extend_8bit((raw >> 32) & 0xFF)  # bits 32-39 (signed)
    pal = (raw >> 40) & 0x1F             # bits 40-44
    # tile2 occupies bits 44-47, but trigger/smoke/autoaim are also declared
    # at bits 45-47. In the C bitfield, these overlap. seqGetTile() uses
    # tile2 = bits 44-47. We extract tile2 for the full tile computation
    # and also extract the flag bits individually.
    tile2 = (raw >> 44) & 0xF            # bits 44-47
    tile = tile_low | (tile2 << 12)

    trigger = (raw >> 45) & 1            # bit 45
    smoke = (raw >> 46) & 1              # bit 46
    autoaim = (raw >> 47) & 1            # bit 47
    pushable = (raw >> 48) & 1           # bit 48
    play_sound = (raw >> 49) & 1         # bit 49
    invisible = (raw >> 50) & 1          # bit 50
    xflip = (raw >> 51) & 1             # bit 51
    yflip = (raw >> 52) & 1             # bit 52
    # NOONE_EXTENSIONS fields (bits 53-59)
    sound_range = (raw >> 53) & 0xF      # bits 53-56
    surface_sound = (raw >> 57) & 1      # bit 57
    pal2 = (raw >> 58) & 0x3            # bits 58-59

    return {
        "tile": tile,
        "transparent": transparent,
        "transparent2": transparent2,
        "blockable": blockable,
        "hittable": hittable,
        "xrepeat": xrepeat,
        "yrepeat": yrepeat,
        "shade": shade,
        "pal": pal,
        "tile2": tile2,
        "trigger": trigger,
        "smoke": smoke,
        "autoaim": autoaim,
        "pushable": pushable,
        "playSound": play_sound,
        "invisible": invisible,
        "xflip": xflip,
        "yflip": yflip,
        "soundRange": sound_range,
        "surfaceSound": surface_sound,
        "pal2": pal2,
        "raw": raw,
    }


def parse_seq(data: bytes) -> dict[str, Any]:
    """Decode a SEQ binary blob into a plain dict.

    Returns:
        {
            "version": int,
            "nFrames": int,
            "ticksPerFrame": int,
            "nSoundID": int,
            "flags": int,
            "frames": [
                {
                    "tile": int,           # combined tile + tile2
                    "transparent": int,    # 0 or 1
                    "xrepeat": int,        # 0-255
                    "yrepeat": int,        # 0-255
                    "shade": int,          # signed -128..127
                    "pal": int,            # 0-31
                    ... (see _unpack_seqframe for full list)
                    "raw": int,            # original 64-bit value
                },
                ...
            ],
        }
    """
    if len(data) < SEQ_HEADER_SIZE:
        raise ValueError(f"SEQ data too short: {len(data)} < {SEQ_HEADER_SIZE}")

    magic, version, n_frames, ticks_per_frame, n_sound_id, flags = \
        struct.unpack_from(SEQ_HEADER_FMT, data, 0)
    if magic != b"SEQ\x1a":
        raise ValueError(f"not a SEQ (magic {magic!r})")

    expected_size = SEQ_HEADER_SIZE + n_frames * SEQFRAME_SIZE
    if len(data) < expected_size:
        raise ValueError(
            f"SEQ data too short for {n_frames} frames: "
            f"{len(data)} < {expected_size}"
        )

    frames: list[dict[str, Any]] = []
    for i in range(n_frames):
        off = SEQ_HEADER_SIZE + i * SEQFRAME_SIZE
        raw = struct.unpack_from("<Q", data, off)[0]
        frames.append(_unpack_seqframe(raw))

    return {
        "version": version,
        "nFrames": n_frames,
        "ticksPerFrame": ticks_per_frame,
        "nSoundID": n_sound_id,
        "flags": flags,
        "frames": frames,
    }
