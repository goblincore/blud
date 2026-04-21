"""Tests for scripts/qav_parser.py"""
from __future__ import annotations

import struct

import pytest

from scripts.qav_parser import parse_qav


def test_parses_minimal_qav(minimal_qav_bytes):
    result = parse_qav(minimal_qav_bytes)
    assert result["nFrames"] == 2
    assert result["ticksPerFrame"] == 8
    assert len(result["frames"]) == 2

    # Frame 0: 1 active tile, picnum=3205 at (10, 20)
    f0 = result["frames"][0]
    assert f0["callbackId"] == 0
    assert len(f0["tiles"]) == 1
    t0 = f0["tiles"][0]
    assert t0["picnum"] == 3205
    assert t0["x"] == 10
    assert t0["y"] == 20
    assert t0["z"] == 0
    assert t0["stat"] == 0

    # Frame 1: 1 active tile, picnum=3206 at (12, 18)
    f1 = result["frames"][1]
    assert f1["callbackId"] == 1
    assert len(f1["tiles"]) == 1
    t1 = f1["tiles"][0]
    assert t1["picnum"] == 3206
    assert t1["x"] == 12
    assert t1["y"] == 18

    # Sound info on frame 1
    assert f1["sound"]["sound"] == 42
    assert f1["sound"]["priority"] == 5


def test_rejects_bad_qav_magic():
    """QAV has no explicit magic — but data too short for declared frames triggers size check."""
    with pytest.raises(ValueError):
        # Craft data where nFrames (offset 8, i32) is huge but data is tiny
        bad = b"\x00" * 8 + struct.pack("<i", 999) + b"\x00" * 10
        parse_qav(bad)


def test_negative_picnum_filtered(minimal_qav_bytes):
    """Tiles with picnum < 0 are unused slots and must be filtered out."""
    result = parse_qav(minimal_qav_bytes)
    for frame in result["frames"]:
        for tile in frame["tiles"]:
            assert tile["picnum"] >= 0
