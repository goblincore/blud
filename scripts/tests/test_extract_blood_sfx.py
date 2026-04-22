"""Tests for Blood SFX → WAV conversion."""
from __future__ import annotations

import struct

import pytest

from scripts.extract_blood_sfx import parse_sfx_header, wrap_wav, extract_sounds


def _make_sfx_header(*, rel_vol: int = 80, pitch: int = 65536,
                     pitch_range: int = 0, fmt: int = 1,
                     loop_start: int = -1, raw_name: str = "test") -> bytes:
    """Synthesize a 25-byte Blood SFX header."""
    name_bytes = raw_name.encode("ascii")[:8].ljust(8, b"\x00") + b"\x00"
    return struct.pack("<iiiii", rel_vol, pitch, pitch_range, fmt, loop_start) + name_bytes


def _make_rff_with_sfx_raw(sfx_name: str = "SND1", raw_name: str = "snd1",
                            raw_data: bytes = b"\x80" * 1024,
                            fmt: int = 1, pitch: int = 65536) -> bytes:
    """Synthesize a minimal RFF containing one SFX + one RAW entry."""
    sfx_header = _make_sfx_header(fmt=fmt, pitch=pitch, raw_name=raw_name)

    # Build payload: SFX then RAW
    payload = sfx_header + raw_data
    sfx_offset = 16  # after RFF header (16 bytes)
    raw_offset = sfx_offset + len(sfx_header)

    # Build FAT entries
    def _make_fat_entry(offset: int, size: int, flags: int, ext: str, name: str) -> bytes:
        entry = bytearray(48)
        struct.pack_into("<II", entry, 16, offset, size)
        entry[32] = flags
        entry[33:36] = ext.encode("ascii")[:3].ljust(3, b"\x00")
        entry[36:44] = name.encode("ascii")[:8].ljust(8, b"\x00")
        return bytes(entry)

    fat_offset = 16 + len(payload)
    sfx_entry = _make_fat_entry(sfx_offset, len(sfx_header), 0x01, "SFX", sfx_name)
    raw_entry = _make_fat_entry(raw_offset, len(raw_data), 0x00, "RAW", raw_name)
    fat = sfx_entry + raw_entry

    # Encrypt FAT (startKey = first byte of first entry)
    start_key = fat[0]
    enc_fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat))

    # RFF header: magic(4) + version(4) + fatOffset(4) + numFiles(4)
    header = struct.pack("<4sIII", b"RFF\x1a", 0x0301, fat_offset, 2)
    return header + payload + enc_fat


def test_parse_sfx_header_format_11025():
    sfx = _make_sfx_header(fmt=1, pitch=65536, raw_name="amb1")
    info = parse_sfx_header(sfx)
    assert info["sample_rate"] == 11025  # 65536 * 11025 >> 16 = 11025
    assert info["base_rate"] == 11025
    assert info["bits"] == 8
    assert info["channels"] == 1
    assert info["raw_name"] == "amb1"
    assert info["loop_start"] == -1


def test_parse_sfx_header_format_22050():
    sfx = _make_sfx_header(fmt=5, pitch=65536, raw_name="test")
    info = parse_sfx_header(sfx)
    assert info["sample_rate"] == 22050
    assert info["base_rate"] == 22050


def test_parse_sfx_header_pitch_shifted():
    # pitch=32768 = 0.5x → sample_rate = 32768 * 11025 >> 16 = 5512
    sfx = _make_sfx_header(fmt=1, pitch=32768, raw_name="test")
    info = parse_sfx_header(sfx)
    assert info["sample_rate"] == 5512


def test_parse_sfx_header_rejects_short():
    with pytest.raises(ValueError, match="too short"):
        parse_sfx_header(b"\x00" * 10)


def test_wrap_wav_produces_valid_riff():
    pcm = b"\x40\x80\xC0\x00" * 64
    wav = wrap_wav(11025, 8, pcm)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert wav[12:16] == b"fmt "
    assert wav[36:40] == b"data"
    # Data size should match PCM length
    data_size = struct.unpack_from("<I", wav, 40)[0]
    assert data_size == len(pcm)


def test_extract_sounds_from_synthetic_rff(tmp_path):
    raw_data = b"\x00\x40\x80\xC0\xFF" * 100
    rff_data = _make_rff_with_sfx_raw(
        sfx_name="SND1", raw_name="snd1",
        raw_data=raw_data, fmt=1, pitch=65536,
    )
    rff_path = tmp_path / "sounds.rff"
    rff_path.write_bytes(rff_data)

    out_dir = tmp_path / "output"
    manifest = extract_sounds(rff_path, out_dir)

    assert "SND1" in manifest
    assert manifest["SND1"]["sample_rate"] == 11025
    assert manifest["SND1"]["raw_name"] == "snd1"
    assert manifest["SND1"]["size_bytes"] == len(raw_data)

    # Verify WAV file was written
    wav_path = out_dir / "SND1.wav"
    assert wav_path.exists()
    wav = wav_path.read_bytes()
    assert wav[:4] == b"RIFF"
    # The PCM payload should be in the WAV
    assert wav[-len(raw_data):] == raw_data


def test_extract_sounds_skips_missing_raw(tmp_path):
    rff_data = _make_rff_with_sfx_raw(
        sfx_name="ORPHAN", raw_name="missing",
        raw_data=b"\x80" * 10, fmt=1, pitch=65536,
    )
    # Truncate the RFF to remove the RAW entry — build a version with only SFX
    sfx_header = _make_sfx_header(fmt=1, pitch=65536, raw_name="missing")
    sfx_offset = 16
    fat_offset = sfx_offset + len(sfx_header)

    def _make_fat_entry(offset: int, size: int, flags: int, ext: str, name: str) -> bytes:
        entry = bytearray(48)
        struct.pack_into("<II", entry, 16, offset, size)
        entry[32] = flags
        entry[33:36] = ext.encode("ascii")[:3].ljust(3, b"\x00")
        entry[36:44] = name.encode("ascii")[:8].ljust(8, b"\x00")
        return bytes(entry)

    fat_entry = _make_fat_entry(sfx_offset, len(sfx_header), 0x01, "SFX", "ORPHAN")
    start_key = fat_entry[0]
    enc_fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat_entry))
    header = struct.pack("<4sIII", b"RFF\x1a", 0x0301, fat_offset, 1)
    rff_data = header + sfx_header + enc_fat

    rff_path = tmp_path / "sounds.rff"
    rff_path.write_bytes(rff_data)
    out_dir = tmp_path / "output"
    manifest = extract_sounds(rff_path, out_dir)
    assert len(manifest) == 0  # ORPHAN skipped because RAW missing
