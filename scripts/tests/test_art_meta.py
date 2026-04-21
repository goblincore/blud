"""Tests for scripts/art_meta.py"""
from __future__ import annotations

from scripts.art_meta import decode_picanm


def test_decode_picanm_zero():
    assert decode_picanm(0) == {"xoffset": 0, "yoffset": 0, "animFrames": 0, "animType": 0}


def test_decode_picanm_offsets():
    # xoffset is bits 8-15 (signed byte); yoffset is bits 16-23 (signed byte).
    picanm = (0 << 0) | (0x7F << 8) | (0x80 << 16)  # xoffset=127, yoffset=-128
    result = decode_picanm(picanm)
    assert result["xoffset"] == 127
    assert result["yoffset"] == -128


def test_decode_picanm_animtype():
    # animFrames: bits 0-5 (6 bits); animType: bits 6-7 (2 bits).
    picanm = 0b10_001010  # animFrames=10, animType=2
    result = decode_picanm(picanm)
    assert result["animFrames"] == 10
    assert result["animType"] == 2


def test_decode_picanm_negative_offsets():
    # xoffset=-1 (0xFF as signed byte), yoffset=-1
    picanm = (0xFF << 8) | (0xFF << 16)
    result = decode_picanm(picanm)
    assert result["xoffset"] == -1
    assert result["yoffset"] == -1
