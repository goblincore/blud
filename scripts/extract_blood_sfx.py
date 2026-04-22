#!/usr/bin/env python3
"""Extract Blood (Build engine) SFX into WAV + manifest.

Reads sounds.RFF (or BLOOD.RFF), finds .SFX + .RAW resource pairs, decodes
each to 8-bit unsigned mono PCM at the correct sample rate (determined by the
SFX header's format field), wraps in a RIFF/WAVE header, and writes
public/assets/audio-placeholder/sfx/{id}.wav.

SFX header layout (from NotBlood source/blood/src/sound.h):
  struct SFX {
      int relVol;       // 4 bytes — volume (80 default)
      int pitch;        // 4 bytes — fixed-point pitch (65536 = 1.0)
      int pitchRange;   // 4 bytes — random pitch variation range
      int format;       // 4 bytes — index into soundRates[]
      int loopStart;    // 4 bytes — -1 = no loop, >= 0 = byte offset
      char rawName[9];  // 9 bytes — name of matching RAW resource
  };
  Total: 25 bytes.

Sample rate table (from NotBlood source/blood/src/sound.cpp):
  format 0-3:  11025 Hz
  format 4-7:  22050 Hz
  format 8-12: 44100 Hz

Mirrors scripts/extract_blood_sprites.py policy: dev-only placeholders,
never shipped.
"""
from __future__ import annotations
import argparse
import json
import struct
from pathlib import Path
from typing import Optional

# Sample rate lookup from NotBlood sound.cpp soundRates[13]
SOUND_RATES = [11025, 11025, 11025, 11025, 22050, 22050, 22050, 22050,
               44100, 44100, 44100, 44100, 44100]


def parse_sfx_header(data: bytes) -> dict:
    """Parse a 25-byte Blood SFX header. Returns dict with audio metadata."""
    if len(data) < 25:
        raise ValueError(f"SFX header too short: {len(data)} bytes (need 25)")
    rel_vol, pitch, pitch_range, fmt, loop_start = struct.unpack_from("<iiiii", data, 0)
    raw_name_bytes = data[20:29]
    nul = raw_name_bytes.find(b"\x00")
    raw_name = raw_name_bytes[:nul].decode("ascii", errors="replace") if nul >= 0 else raw_name_bytes.decode("ascii", errors="replace")
    sample_rate = SOUND_RATES[fmt] if fmt < len(SOUND_RATES) else 11025
    # mulscale16(pitch, sample_rate) = (pitch * sample_rate) >> 16
    n_pitch = (pitch * sample_rate) >> 16
    return {
        "rel_vol": rel_vol,
        "pitch": pitch,
        "pitch_range": pitch_range,
        "format": fmt,
        "loop_start": loop_start,
        "raw_name": raw_name,
        "sample_rate": n_pitch,
        "base_rate": sample_rate,
        "bits": 8,
        "channels": 1,
    }


def wrap_wav(sample_rate: int, bits: int, pcm: bytes) -> bytes:
    """Build a RIFF/WAVE container around raw PCM. 8-bit unsigned mono only."""
    byte_rate = sample_rate * 1 * (bits // 8)
    block_align = 1 * (bits // 8)
    data_size = len(pcm)
    riff = b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, block_align, bits)
    data_chunk = b"data" + struct.pack("<I", data_size) + pcm
    return riff + fmt + data_chunk


def read_rff_entries(rff_path: Path) -> list[tuple[str, str, bytes]]:
    """Return [(name, ext, data_bytes), ...] for all entries in the RFF."""
    data = rff_path.read_bytes()
    if data[:4] != b"RFF\x1a":
        raise ValueError(f"not an RFF: magic {data[:4]!r}")
    _, fat_offset, num_files = struct.unpack_from("<III", data, 4)
    fat_raw = data[fat_offset : fat_offset + num_files * 48]
    start_key = fat_raw[0]
    fat = bytes(b ^ ((start_key + (i >> 1)) & 0xFF) for i, b in enumerate(fat_raw))
    out: list[tuple[str, str, bytes]] = []
    for i in range(num_files):
        entry = fat[i * 48 : (i + 1) * 48]
        offset, size = struct.unpack_from("<II", entry, 16)
        flags = entry[32]
        ext = entry[33:36]
        name = entry[36:44].rstrip(b"\x00 ")
        try:
            name_s = name.decode("ascii")
            ext_s = ext.decode("ascii")
        except UnicodeDecodeError:
            continue
        raw = bytearray(data[offset : offset + size])
        if flags & 0x10:
            for j in range(min(256, len(raw))):
                raw[j] ^= (j >> 1) & 0xFF
        out.append((name_s, ext_s, bytes(raw)))
    return out


def extract_sounds(rff_path: Path, out_dir: Path) -> dict[str, dict]:
    """Extract all SFX+RAW pairs from a Blood sounds RFF into WAV files.

    Returns the manifest dict.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = read_rff_entries(rff_path)

    # Build lookup: raw_name (lowercased) -> raw_bytes
    # SFX headers store rawName in lowercase but RFF entries are uppercase.
    raw_lookup: dict[str, bytes] = {}
    sfx_entries: list[tuple[str, bytes]] = []
    for name, ext, data in entries:
        if ext == "RAW":
            raw_lookup[name.lower()] = data
        elif ext == "SFX":
            sfx_entries.append((name, data))

    manifest: dict[str, dict] = {}
    for sfx_id, sfx_data in sfx_entries:
        try:
            header = parse_sfx_header(sfx_data)
        except ValueError as e:
            print(f"  skip {sfx_id}: {e}")
            continue
        raw_name = header["raw_name"].lower()
        if raw_name not in raw_lookup:
            print(f"  skip {sfx_id}: RAW {raw_name!r} not found")
            continue
        pcm = raw_lookup[raw_name]
        sample_rate = header["sample_rate"]
        wav = wrap_wav(sample_rate, header["bits"], pcm)
        out_path = out_dir / f"{sfx_id}.wav"
        out_path.write_bytes(wav)
        manifest[sfx_id] = {
            "file": f"{sfx_id}.wav",
            "raw_name": raw_name,
            "sample_rate": sample_rate,
            "base_rate": header["base_rate"],
            "bits": header["bits"],
            "rel_vol": header["rel_vol"],
            "pitch": header["pitch"],
            "pitch_range": header["pitch_range"],
            "format": header["format"],
            "loop_start": header["loop_start"],
            "size_bytes": len(pcm),
        }
    return manifest


def main() -> None:
    p = argparse.ArgumentParser(description="Extract Blood SFX → WAV (dev placeholder pipeline)")
    p.add_argument("rff_path", type=Path, help="Path to sounds.RFF")
    p.add_argument("--out", type=Path, default=Path("public/assets/audio-placeholder/sfx"))
    args = p.parse_args()

    manifest = extract_sounds(args.rff_path, args.out)
    manifest_path = args.out.parent / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"extracted {len(manifest)} sounds → {args.out}")
    print(f"manifest → {manifest_path}")


if __name__ == "__main__":
    main()
