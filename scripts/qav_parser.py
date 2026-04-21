"""QAV binary parser. Layout from NotBlood source/blood/src/qav.h.

Struct sizes (all packed, #pragma pack(push, 1)):
  TILE_FRAME:  24 bytes — picnum(i32) + x(i32) + y(i32) + z(i32) + stat(i32) + shade(i8) + palnum(u8) + angle(u16)
  SOUNDINFO:    8 bytes — sound(i32) + priority(u8) + sndFlags(u8) + sndRange(u8) + reserved(1)
  FRAMEINFO:  204 bytes — nCallbackId(i32) + sound(SOUNDINFO) + tiles(TILE_FRAME × 8)
  QAV header:  36 bytes — pad1(8) + nFrames(i32) + ticksPerFrame(i32) + at10(i32) + x(i32) + y(i32) + nSprite(i32) + pad3(4)
"""
from __future__ import annotations

import struct
from typing import Any

# --- Layout constants (transcribed from qav.h) ---
TILE_FRAME_FMT = "<iiiiibbH"   # picnum, x, y, z, stat, shade, palnum, angle
TILE_FRAME_SIZE = struct.calcsize(TILE_FRAME_FMT)  # 24

SOUNDINFO_FMT = "<iBBBB"  # sound, priority, sndFlags, sndRange = 8 bytes (but struct adds padding)
SOUNDINFO_SIZE = 8  # Fixed: C struct is 8 bytes packed

# FRAMEINFO: nCallbackId(4) + SOUNDINFO(8) + TILE_FRAME×8(192) = 204
FRAMEINFO_CALLBACK_SIZE = 4
FRAMEINFO_SIZE = FRAMEINFO_CALLBACK_SIZE + SOUNDINFO_SIZE + 8 * TILE_FRAME_SIZE  # 204

# QAV header: pad1(8) + nFrames(4) + ticksPerFrame(4) + at10(4) + x(4) + y(4) + nSprite(4) + pad3(4) = 36
QAV_HEADER_FMT = "<8siiiiii4s"
QAV_HEADER_SIZE = struct.calcsize(QAV_HEADER_FMT)  # 36

TILES_PER_FRAME = 8  # Fixed array in FRAMEINFO per qav.h


def _unpack_tile_frame(data: bytes, offset: int) -> dict[str, Any]:
    picnum, x, y, z, stat, shade, palnum, angle = \
        struct.unpack_from(TILE_FRAME_FMT, data, offset)
    return {
        "picnum": picnum,
        "x": x,
        "y": y,
        "z": z,
        "stat": stat,
        "shade": shade,
        "palnum": palnum,
        "angle": angle,
    }


def _unpack_soundinfo(data: bytes, offset: int) -> dict[str, Any]:
    sound, priority, snd_flags, snd_range, _reserved = \
        struct.unpack_from("<iBBBB", data, offset)
    return {
        "sound": sound,
        "priority": priority,
        "sndFlags": snd_flags,
        "sndRange": snd_range,
    }


def parse_qav(data: bytes) -> dict[str, Any]:
    """Decode a QAV binary blob into a plain dict.

    Returns:
        {
            "nFrames": int,
            "ticksPerFrame": int,
            "flags": int,  # at10 field — reserved/flags
            "x": int,
            "y": int,
            "frames": [
                {
                    "callbackId": int,
                    "sound": {"sound": int, "priority": int, "sndFlags": int, "sndRange": int},
                    "tiles": [
                        {"picnum": int, "x": int, "y": int, "z": int, "stat": int,
                         "shade": int, "palnum": int, "angle": int},
                        ...  # only active tiles (picnum >= 0) are included
                    ],
                },
                ...
            ],
        }
    """
    if len(data) < QAV_HEADER_SIZE:
        raise ValueError(f"QAV data too short: {len(data)} < {QAV_HEADER_SIZE}")

    pad1, n_frames, ticks_per_frame, at10, x, y, n_sprite, pad3 = \
        struct.unpack_from(QAV_HEADER_FMT, data, 0)

    # Validate magic — QAV files don't have an explicit magic bytes.
    # The first 8 bytes (pad1) are typically zero or contain version info.
    # We validate by checking the data is large enough for the declared frames.
    expected_size = QAV_HEADER_SIZE + n_frames * FRAMEINFO_SIZE
    if len(data) < expected_size:
        raise ValueError(
            f"QAV data too short for {n_frames} frames: "
            f"{len(data)} < {expected_size}"
        )

    frames: list[dict[str, Any]] = []
    for i in range(n_frames):
        frame_offset = QAV_HEADER_SIZE + i * FRAMEINFO_SIZE
        callback_id = struct.unpack_from("<i", data, frame_offset)[0]
        sound = _unpack_soundinfo(data, frame_offset + FRAMEINFO_CALLBACK_SIZE)

        tiles: list[dict[str, Any]] = []
        tiles_base = frame_offset + FRAMEINFO_CALLBACK_SIZE + SOUNDINFO_SIZE
        for j in range(TILES_PER_FRAME):
            tile_off = tiles_base + j * TILE_FRAME_SIZE
            tile = _unpack_tile_frame(data, tile_off)
            # Tiles with picnum < 0 are unused slots — filter them out
            if tile["picnum"] >= 0:
                tiles.append(tile)

        frames.append({
            "callbackId": callback_id,
            "sound": sound,
            "tiles": tiles,
        })

    return {
        "nFrames": n_frames,
        "ticksPerFrame": ticks_per_frame,
        "flags": at10,
        "x": x,
        "y": y,
        "frames": frames,
    }
