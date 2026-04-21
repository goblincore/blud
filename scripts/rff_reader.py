"""RFF v3.1 archive reader.

Extracted from extract_blood_sprites.py and made standalone.
Reads Build engine RFF archives (used by Blood 1997).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class RffEntry:
    """A single file extracted from an RFF archive."""
    name: str      # 8 chars, stripped
    ext: str       # 3 chars
    id: int        # resource id (bytes 44-47 of FAT entry)
    offset: int
    size: int
    flags: int
    data: bytes    # file content, with DICT_CRYPT decryption applied if flagged


def read_rff(rff_path: Path) -> list[RffEntry]:
    """Parse a BLOOD.RFF v3.1 archive into RffEntry list."""
    data = Path(rff_path).read_bytes()
    if data[:4] != b"RFF\x1a":
        raise ValueError(f"not an RFF: magic {data[:4]!r}")
    version, fat_offset, num_files = struct.unpack_from("<III", data, 4)

    fat_raw = data[fat_offset : fat_offset + num_files * 48]
    # RFF v3.1 FAT encryption: XOR each byte with (startKey + (i >> 1)) & 0xFF.
    # startKey = fat_raw[0] (Reserved[0] is always 0).
    start_key = fat_raw[0]
    fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat_raw))

    entries: list[RffEntry] = []
    for i in range(num_files):
        e = fat[i * 48 : (i + 1) * 48]
        offset, size = struct.unpack_from("<II", e, 16)
        flags = e[32]
        ext = e[33:36].decode("ascii", errors="replace").rstrip("\x00 ")
        name = e[36:44].decode("ascii", errors="replace").rstrip("\x00 ")
        res_id = struct.unpack_from("<I", e, 44)[0]
        file_data = bytearray(data[offset : offset + size])
        # DICT_CRYPT: if flags bit 0x10, XOR first 256 bytes with (j >> 1) & 0xFF
        if flags & 0x10:
            for j in range(min(256, len(file_data))):
                file_data[j] ^= (j >> 1) & 0xFF
        entries.append(RffEntry(
            name=name, ext=ext, id=res_id,
            offset=offset, size=size, flags=flags, data=bytes(file_data),
        ))
    return entries


def iter_by_ext(entries: list[RffEntry], ext: str) -> Iterator[RffEntry]:
    """Filter to entries with given extension (case-insensitive)."""
    e = ext.upper()
    return (x for x in entries if x.ext.upper() == e)
