"""Shared pytest fixtures — hand-crafted minimal byte blobs for parsers.

Struct layouts transcribed from NotBlood source:
  QAV:  source/blood/src/qav.h  — QAV, FRAMEINFO, TILE_FRAME, SOUNDINFO
  SEQ:  source/blood/src/seq.h   — Seq, SEQFRAME
  RFF:  Build engine RFF v3.1    — see scripts/extract_blood_sprites.py
"""
from __future__ import annotations

import struct

import pytest


# ---------------------------------------------------------------------------
# QAV layout constants (from qav.h, #pragma pack(push,1))
# ---------------------------------------------------------------------------
QAV_HEADER_SIZE = 36  # pad1(8) + nFrames(4) + ticksPerFrame(4) + at10(4) + x(4) + y(4) + nSprite(4) + pad3(4)
TILE_FRAME_SIZE = 24  # picnum(4) + x(4) + y(4) + z(4) + stat(4) + shade(1) + palnum(1) + angle(2)
SOUNDINFO_SIZE = 8    # sound(4) + priority(1) + sndFlags(1) + sndRange(1) + reserved(1)
FRAMEINFO_SIZE = 4 + SOUNDINFO_SIZE + 8 * TILE_FRAME_SIZE  # 4 + 8 + 192 = 204


def _pack_tile_frame(picnum: int, x: int, y: int, z: int = 0,
                     stat: int = 0, shade: int = 0, palnum: int = 0,
                     angle: int = 0) -> bytes:
    """Pack a single TILE_FRAME (24 bytes, packed)."""
    # picnum(i) + x(i) + y(i) + z(i) + stat(i) + shade(b) + palnum(b) + angle(H)
    return struct.pack("<iiiiibbH",
                       picnum, x, y, z, stat, shade, palnum, angle)


def _pack_soundinfo(sound: int = 0, priority: int = 0, snd_flags: int = 0,
                    snd_range: int = 0) -> bytes:
    # SOUNDINFO: sound(i32) + priority(u8) + sndFlags(u8) + sndRange(u8) + reserved(u8) = 8 bytes
    return struct.pack("<iBBBB", sound, priority, snd_flags, snd_range, 0)


def _pack_frameinfo(callback_id: int, sound: bytes, tiles: list[bytes]) -> bytes:
    """Pack a FRAMEINFO: callback(4) + sound(8) + 8 tile slots (padding unused ones with picnum=-1)."""
    assert len(tiles) <= 8
    out = struct.pack("<i", callback_id) + sound
    for t in tiles:
        out += t
    # Fill remaining slots with picnum=-1 (unused marker)
    for _ in range(8 - len(tiles)):
        out += _pack_tile_frame(picnum=-1, x=0, y=0)
    assert len(out) == FRAMEINFO_SIZE, f"FRAMEINFO expected {FRAMEINFO_SIZE}, got {len(out)}"
    return out


def _pack_qav_header(*, n_frames: int, ticks_per_frame: int = 8,
                     at10: int = 0, x: int = 0, y: int = 0,
                     n_sprite: int = 0) -> bytes:
    """Pack QAV header (36 bytes)."""
    # 8s=pad1, i=nFrames, i=ticksPerFrame, i=at10, i=x, i=y, i=nSprite
    # then 4 bytes pad3 appended separately
    return struct.pack("<8siiiiii",
                       b"\x00" * 8,       # pad1
                       n_frames,           # nFrames
                       ticks_per_frame,    # ticksPerFrame
                       at10,               # at10
                       x,                  # x
                       y,                  # y
                       n_sprite,           # nSprite
                       ) + b"\x00" * 4     # pad3
    # Total: 8 + 4*6 + 4 = 36


@pytest.fixture
def minimal_rff_bytes() -> bytes:
    """Minimal RFF v3.1 with one fake file entry. FAT encrypted per startKey rule."""
    magic = b"RFF\x1a"
    version = 0x0301
    num_files = 1
    # Payload: 10 bytes of 'X' right after the 16-byte header
    payload = b"X" * 10
    payload_offset = 16  # right after header
    fat_offset = 16 + len(payload)
    # FAT entry: 48 bytes. Layout:
    #  bytes 0-15: unused1
    #  bytes 16-19: offset (u32 LE)
    #  bytes 20-23: size (u32 LE)
    #  bytes 24-31: unused2
    #  byte 32: flags
    #  bytes 33-35: ext (3 ascii chars)
    #  bytes 36-43: name (8 ascii chars, NUL-padded)
    #  bytes 44-47: id (u32 LE)
    entry = bytearray(48)
    struct.pack_into("<II", entry, 16, payload_offset, len(payload))
    entry[32] = 0x00  # flags: no DICT_CRYPT
    entry[33:36] = b"QAV"
    entry[36:44] = b"TESTQAV\x00"
    struct.pack_into("<I", entry, 44, 42)  # resource id = 42
    # Encrypt FAT per RFF rule (startKey = entry[0] = 0x00 here)
    start_key = entry[0]
    enc = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(entry))
    header = struct.pack("<4sIII", magic, version, fat_offset, num_files)
    return header + payload + enc


@pytest.fixture
def minimal_qav_bytes() -> bytes:
    """Minimal QAV with 2 frames, 1 active tile per frame.

    Layout from qav.h (packed):
      Header (36 bytes): pad1(8) + nFrames(i32) + ticksPerFrame(i32) + at10(i32)
                         + x(i32) + y(i32) + nSprite(i32) + pad3(4)
      Per frame (FRAMEINFO, 204 bytes):
        nCallbackId(i32) + SOUNDINFO(8) + TILE_FRAME[8] (each 24 bytes)

    Frame 0: tile picnum=3205, x=10, y=20
    Frame 1: tile picnum=3206, x=12, y=18
    """
    header = _pack_qav_header(n_frames=2, ticks_per_frame=8)
    assert len(header) == QAV_HEADER_SIZE

    # Frame 0: 1 active tile (picnum=3205, x=10, y=20)
    frame0 = _pack_frameinfo(
        callback_id=0,
        sound=_pack_soundinfo(),
        tiles=[_pack_tile_frame(picnum=3205, x=10, y=20)],
    )

    # Frame 1: 1 active tile (picnum=3206, x=12, y=18)
    frame1 = _pack_frameinfo(
        callback_id=1,
        sound=_pack_soundinfo(sound=42, priority=5),
        tiles=[_pack_tile_frame(picnum=3206, x=12, y=18)],
    )

    return header + frame0 + frame1


@pytest.fixture
def minimal_seq_bytes() -> bytes:
    """Minimal SEQ with 2 frames. Layout from seq.h + m2-asset-extraction.md.

    Header (16 bytes): "SEQ\\x1a", version(u16), nFrames(u16),
                       ticksPerFrame(u16), nSoundID(u16), flags(u32)
    Each SEQFRAME: 8 bytes bitfield.
      tile: bits 0-11, tile2: bits 44-47.
      Frame 0: tile=100, frame 1: tile=101.
    """
    header = struct.pack("<4sHHHHI", b"SEQ\x1a", 0x300, 2, 8, 0, 0)
    # Frame 0: tile=100 (bits 0-11), rest zero
    f0 = 100 & 0xFFF
    # Frame 1: tile=101
    f1 = 101 & 0xFFF
    frames = struct.pack("<QQ", f0, f1)
    return header + frames
