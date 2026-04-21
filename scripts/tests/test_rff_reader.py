"""Tests for scripts/rff_reader.py"""
from __future__ import annotations

import struct

import pytest

from scripts.rff_reader import read_rff, RffEntry


def test_reads_single_entry(minimal_rff_bytes, tmp_path):
    p = tmp_path / "minimal.rff"
    p.write_bytes(minimal_rff_bytes)
    entries = read_rff(p)
    assert len(entries) == 1
    e = entries[0]
    assert e.name == "TESTQAV"
    assert e.ext == "QAV"
    assert e.id == 42
    assert e.data == b"X" * 10


def test_rejects_bad_magic(tmp_path):
    p = tmp_path / "bad.rff"
    p.write_bytes(b"XXXX" + b"\x00" * 16)
    with pytest.raises(ValueError, match="not an RFF"):
        read_rff(p)


def test_dict_crypt_decryption(tmp_path):
    """Verify DICT_CRYPT flag triggers XOR decryption of first 256 bytes."""
    # Build an RFF with one entry that has the DICT_CRYPT flag set
    magic = b"RFF\x1a"
    version = 0x0301
    num_files = 1
    # Payload: 16 bytes of known plaintext
    plaintext = b"\xAB" * 16
    payload_offset = 16  # right after header
    fat_offset = 16 + len(plaintext)

    entry = bytearray(48)
    struct.pack_into("<II", entry, 16, payload_offset, len(plaintext))
    entry[32] = 0x10  # DICT_CRYPT flag
    entry[33:36] = b"QAV"
    entry[36:44] = b"CRYPTTST"
    struct.pack_into("<I", entry, 44, 7)

    start_key = entry[0]
    enc_fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(entry))

    header = struct.pack("<4sIII", magic, version, fat_offset, num_files)
    raw = header + plaintext + enc_fat
    p = tmp_path / "crypt.rff"
    p.write_bytes(raw)

    entries = read_rff(p)
    assert len(entries) == 1
    # After DICT_CRYPT decryption, first 16 bytes should be original plaintext XOR'd
    # with (j >> 1) & 0xFF, then our code XOR's back — so result should equal plaintext
    expected = bytearray(plaintext)
    for j in range(min(256, len(expected))):
        expected[j] ^= (j >> 1) & 0xFF
    # Actually read_rff decrypts: file_data[j] ^= (j >> 1) & 0xFF
    # So if file_data on disk IS the plaintext, after decryption it becomes plaintext ^ (j>>1)&0xFF
    # This means the test needs: on-disk = plaintext, but read_rff applies XOR
    # Since the flag IS set, the data is assumed encrypted on disk.
    # With on-disk=plaintext, after decryption we get plaintext ^ key.
    # Let's just verify the decryption XOR was applied by checking it differs from raw.
    assert entries[0].data != plaintext  # decryption changed it
    assert entries[0].data == bytes(expected)
