"""Tests for scripts/seq_parser.py"""
from __future__ import annotations

import struct

import pytest

from scripts.seq_parser import parse_seq


def test_parses_minimal_seq(minimal_seq_bytes):
    result = parse_seq(minimal_seq_bytes)
    assert result["nFrames"] == 2
    assert result["ticksPerFrame"] == 8
    assert len(result["frames"]) == 2
    assert result["frames"][0]["tile"] == 100
    assert result["frames"][1]["tile"] == 101


def test_rejects_bad_seq_magic():
    with pytest.raises(ValueError, match="SEQ"):
        parse_seq(b"XXXX" + b"\x00" * 100)


def test_tile2_extends_tile():
    """tile2 (bits 44-47) extends the tile number to 16 bits max (tile | tile2 << 12)."""
    # Build a SEQ with one frame where tile=0xABC (low 12 bits) and tile2=0x7 (high 4)
    # Full tile = 0xABC | (0x7 << 12) = 0x7ABC = 31420
    header = struct.pack("<4sHHHHI", b"SEQ\x1a", 0x300, 1, 8, 0, 0)
    tile_low = 0xABC
    tile_high = 0x7
    raw = tile_low | (tile_high << 44)
    frames = struct.pack("<Q", raw)
    result = parse_seq(header + frames)
    assert result["frames"][0]["tile"] == tile_low | (tile_high << 12)  # 31420


def test_seqframe_fields():
    """Verify additional SEQFRAME bitfield fields are parsed.

    NOTE: In the C bitfield, tile2 (bits 44-47) overlaps with trigger(45),
    smoke(46), autoaim(47). We test non-overlapping fields here. The tile2
    extension is tested separately in test_tile2_extends_tile().
    """
    header = struct.pack("<4sHHHHI", b"SEQ\x1a", 0x300, 1, 8, 0, 0)
    # Craft a frame with known bitfield values — avoid bits 44-47 overlap
    tile = 100
    transparent = 1
    transparent2 = 0
    blockable = 0
    hittable = 1
    xrepeat = 64
    yrepeat = 48
    shade = -10  # signed 8-bit
    pal = 5
    # Don't set trigger/smoke/autoaim to avoid tile2 overlap
    pushable = 1
    play_sound = 0
    invisible = 0
    xflip = 0
    yflip = 1

    raw = (
        (tile & 0xFFF) |
        ((transparent & 1) << 12) |
        ((transparent2 & 1) << 13) |
        ((blockable & 1) << 14) |
        ((hittable & 1) << 15) |
        ((xrepeat & 0xFF) << 16) |
        ((yrepeat & 0xFF) << 24) |
        (((shade & 0xFF) & 0xFF) << 32) |
        ((pal & 0x1F) << 40)
        # bits 44-47 left as 0 (tile2=0, trigger=0, smoke=0, autoaim=0)
        | ((pushable & 1) << 48)
        | ((play_sound & 1) << 49)
        | ((invisible & 1) << 50)
        | ((xflip & 1) << 51)
        | ((yflip & 1) << 52)
    )
    frames = struct.pack("<Q", raw)
    result = parse_seq(header + frames)
    f = result["frames"][0]
    assert f["tile"] == 100
    assert f["transparent"] == 1
    assert f["hittable"] == 1
    assert f["xrepeat"] == 64
    assert f["yrepeat"] == 48
    assert f["shade"] == -10
    assert f["pal"] == 5
    assert f["pushable"] == 1
    assert f["yflip"] == 1


def test_version_stored():
    """Parser stores version field from header."""
    header = struct.pack("<4sHHHHI", b"SEQ\x1a", 0x301, 1, 10, 0, 0)
    frame = struct.pack("<Q", 1)
    result = parse_seq(header + frame)
    assert result["version"] == 0x301
