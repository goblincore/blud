# Blud — Animation System Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Blood's QAV (weapon-view) and SEQ (character) animation formats into a data-driven animation system — Python offline extractor emits JSON manifests; runtime animator is pure display; FSMs continue to drive state. Fixes the dynamite lighter-flame scaling glitch and replaces the approximate zombie frame segmentation with a correct SEQ port that includes view-angle direction handling.

**Architecture:** Offline Python CLIs (`scripts/*_parser.py`, `scripts/extract_*.py`) read `BLOOD.RFF` and emit JSON manifests into `public/assets/animations/`. Runtime code in `src/animation/` loads manifests, validates them, and drives two animator flavors — a camera-space multi-layer stack for FPV weapons, and a world-space billboard with 5-angle-variant pick for characters. Game FSMs (`Dynamite.ts`, `ZombieBrain`) stay in charge of state; they call `animator.play(name, opts)` on state entry.

**Tech Stack:** Python 3 (`struct`, `pytest`); TypeScript 5, Vite 5, Three.js ^0.170, Vitest ^2, happy-dom. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-04-21-blud-animation-system-design.md](../specs/2026-04-21-blud-animation-system-design.md)

**Key references for dispatch agents:**
- NotBlood source: `/Users/donny/Documents/Raze/NotBlood/source/blood/src/` — particularly `qav.h`, `qav.cpp`, `seq.h`, `seq.cpp`, `weapon.cpp` (search `processTNT`), `aizombi.cpp` (zombie SEQ IDs).
- BLOOD.RFF (resource archive): `/Users/donny/Documents/Raze/blood/BLOOD.RFF`
- Prior SEQ decoding notes: [docs/dev-notes/2026-04-21-m2-asset-extraction.md](../../dev-notes/2026-04-21-m2-asset-extraction.md) — has RFF FAT layout + initial SEQ struct.
- Existing RFF reader to reuse: [scripts/extract_blood_sprites.py](../../../scripts/extract_blood_sprites.py) — see `read_palette_from_rff` for the RFF FAT decryption (`XOR (startKey + (i>>1)) & 0xFF`) and `read_art_file` for ART tile parsing.

---

## File structure

### New Python files (`scripts/`)
| File | Responsibility |
|---|---|
| `scripts/rff_reader.py` | Generalized RFF parser — extracted from `extract_blood_sprites.py`. Returns `list[RffEntry]` with `{name, ext, id, offset, size, flags, data}`. |
| `scripts/qav_parser.py` | Pure QAV byte-blob → dict. No I/O. |
| `scripts/seq_parser.py` | Pure SEQ byte-blob → dict. No I/O. |
| `scripts/art_meta.py` | ART tile metadata extractor — reads `sizx`, `sizy`, `picanm` (anchor offsets) from ART files. |
| `scripts/extract_qav.py` | CLI: reads `BLOOD.RFF`, filters QAVs, runs `qav_parser`, writes JSON. |
| `scripts/extract_seq.py` | CLI: same for SEQ. |
| `scripts/extract_tile_meta.py` | CLI: reads all `TILES*.ART`, emits `tiles-meta.json`. |
| `scripts/build_animation_index.py` | CLI: rebuilds `index.json` from on-disk manifests. |
| `scripts/tests/test_rff_reader.py` | Round-trip fixture tests. |
| `scripts/tests/test_qav_parser.py` | Round-trip fixture tests. |
| `scripts/tests/test_seq_parser.py` | Round-trip fixture tests. |
| `scripts/tests/test_art_meta.py` | picanm bit-unpacking tests. |
| `scripts/tests/conftest.py` | Shared fixtures (minimal RFF/QAV/SEQ byte blobs). |

### Generated JSON (`public/assets/animations/` — committed)
| Path | Responsibility |
|---|---|
| `public/assets/animations/tiles-meta.json` | Per-picnum `{w, h, ox, oy}`. |
| `public/assets/animations/index.json` | Maps animation names → manifest paths. |
| `public/assets/animations/weapons/dynamite-*.json` | Per-animation QAV manifests. |
| `public/assets/animations/characters/zombie-*.json` | Per-animation SEQ manifests. |

### New TypeScript files (`src/animation/`)
| File | Responsibility |
|---|---|
| `src/animation/qav-schema.ts` | Manifest types + `validateManifest()`. No Three.js. |
| `src/animation/qav-schema.test.ts` | Validator tests. |
| `src/animation/animator.ts` | Base frame ticker: elapsed → frame index, loop/hold. Framework-free. |
| `src/animation/animator.test.ts` | Frame picker tests. |
| `src/animation/billboard-angle.ts` | Pure angle-variant math: `(camPos, sprPos, sprFacing, angleStride) → v`. |
| `src/animation/billboard-angle.test.ts` | Angle math tests. |
| `src/animation/fp-weapon-animator.ts` | Camera-space layer stack. Uses Three.js. |
| `src/animation/billboard-animator.ts` | World-space billboard with angle pick. Uses Three.js. |
| `src/animation/manifest-loader.ts` | Loads `index.json` + manifests + `tiles-meta.json` at boot; validates. |

### Modified TypeScript files
| File | Change |
|---|---|
| `src/game/weapons/dynamite.ts` | Swap from inline `animState`/`getAnimState` machinery to calling `fpAnimator.play('dynamite-<state>')` on state entry. Keep FSM, keep ammo/cook logic. |
| `src/game/enemy/axe-zombie.ts` | Replace hand-picked frame helpers with `BillboardAnimator`. |
| `src/game/enemy/ai.ts` | `ZombieBrain` calls `billboardAnimator.play('zombie-<state>')` on AI state transitions. |
| `src/engine/asset-loader.ts` | Add `loadAnimationManifests()`. Deprecate `loadZombieAtlas` — gone after swap. |
| `src/main.ts` | Boot: `loadAnimationManifests()`; wire `FpWeaponAnimator` and `BillboardAnimator`. |

### Deleted files (after migration)
- `src/vfx/fp-weapon.ts` — replaced by `src/animation/fp-weapon-animator.ts`.
- `ZombieTextureAtlas` interface + `loadZombieAtlas` in `src/engine/asset-loader.ts`.

### Docs / TASKS
- `docs/dev-notes/2026-04-21-animation-system.md` — schema reference + "how to hand-author new animation JSON" guide.
- `TASKS.md` — flip `A5`, `A6.5` to `[x]`; add `A10` pointing to this plan.

---

## Task 1: Binary format parsers (Python, pure logic)

**Files:**
- Create: `scripts/rff_reader.py`
- Create: `scripts/qav_parser.py`
- Create: `scripts/seq_parser.py`
- Create: `scripts/art_meta.py`
- Create: `scripts/tests/conftest.py`
- Create: `scripts/tests/test_rff_reader.py`
- Create: `scripts/tests/test_qav_parser.py`
- Create: `scripts/tests/test_seq_parser.py`
- Create: `scripts/tests/test_art_meta.py`

**Context:** This task creates the byte-level parsers with no I/O. Every parser accepts a `bytes` input and returns a plain Python dict. Dispatch agents must read the struct layouts directly from NotBlood source (paths above) and transcribe them as constants at the top of each parser. All tests use hand-crafted fixtures — no dependency on `BLOOD.RFF`.

**Note on struct layouts:** The exact byte offsets for QAV and SEQ differ slightly across NotBlood forks. Canonical references:
- QAV: `source/blood/src/qav.h` — look for `struct QAV` and `struct FRAMEINFO` / `struct TILE_FRAME`.
- SEQ: `source/blood/src/seq.h` — look for `struct SEQFRAME` and the `Seq` header struct. Already partially documented in [docs/dev-notes/2026-04-21-m2-asset-extraction.md](../../dev-notes/2026-04-21-m2-asset-extraction.md) (8-byte SEQFRAME bitfields, tile = tile-bits-0-11 + tile2-bits-44-47).

- [ ] **Step 1: Write `scripts/tests/conftest.py` — shared fixtures**

```python
"""Shared pytest fixtures — hand-crafted minimal byte blobs for parsers."""
import struct
import pytest


@pytest.fixture
def minimal_rff_bytes() -> bytes:
    """Minimal RFF v3.1 with one fake file entry. FAT encrypted per startKey rule."""
    magic = b"RFF\x1a"
    version = 0x0301
    num_files = 1
    # Payload: 10 bytes of 'X' at offset 0x30
    payload = b"X" * 10
    fat_offset = 16 + len(payload)
    # FAT entry: 48 bytes. Layout (per scripts/extract_blood_sprites.py + dev-note):
    #  bytes 0-15: unused1
    #  bytes 16-19: offset (u32 LE)
    #  bytes 20-23: size (u32 LE)
    #  bytes 24-31: unused2
    #  byte 32: flags
    #  bytes 33-35: ext (3 ascii chars)
    #  bytes 36-43: name (8 ascii chars, NUL-padded)
    #  bytes 44-47: id (u32 LE) — used by resource lookup
    entry = bytearray(48)
    struct.pack_into("<II", entry, 16, 0x10, len(payload))  # offset, size
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
    """Minimal QAV with 2 frames, 1 tile per frame. See Task 1 parser for layout."""
    # Header: magic "QAV\x0\0" padding + nFrames=2, ticksPerFrame=8, flags=0
    # NOTE: dispatch agent must transcribe exact layout from NotBlood qav.h.
    # The values below are a stand-in; adjust sizes/offsets to match the real
    # struct before committing. Tests will assert on the decoded dict fields.
    raise NotImplementedError("fill in from qav.h")


@pytest.fixture
def minimal_seq_bytes() -> bytes:
    """Minimal SEQ with 2 frames. Layout from seq.h + m2-asset-extraction.md."""
    # Header (16 bytes): "SEQ\x1a", version(u16), nFrames(u16),
    #                    ticksPerFrame(u16), nSoundID(u16), flags(u32)
    header = struct.pack("<4sHHHHI", b"SEQ\x1a", 1, 2, 8, 0, 0)
    # Frame (8 bytes each) — SEQFRAME bitfield per m2-asset-extraction.md:
    #   tile (bits 0-11 of first u32), tile2 (bits 44-47), plus stat bits.
    # Minimal: frame0 tile=100, frame1 tile=101.
    # Pack as raw u64 little-endian with tile in low 12 bits.
    f0 = (100 & 0xFFF)
    f1 = (101 & 0xFFF)
    frames = struct.pack("<QQ", f0, f1)
    return header + frames
```

- [ ] **Step 2: Read NotBlood source to finalize `minimal_qav_bytes` fixture**

Read `/Users/donny/Documents/Raze/NotBlood/source/blood/src/qav.h`. Identify:
- `QAV` header struct: total size, offsets of `nFrames` (u16 or int), `ticksPerFrame`, `flags`, `x`, `y`.
- `FRAMEINFO` / per-frame struct: size, offset of `nTiles` or similar.
- `TILE_FRAME` (per-tile sub-struct): size, offsets of `picnum` (i32), `stat` (u32), `ox`/`oy` (i16), `z` (i32).
- Whether the per-frame tile array is fixed-length (typically 8) or variable.

Replace the `raise NotImplementedError` with a concrete fixture matching that layout: 2 frames, 1 active tile per frame, tile picnums 3205 and 3206, offsets (10, 20) and (12, 18), durations match `ticksPerFrame`.

- [ ] **Step 3: Write failing tests at `scripts/tests/test_rff_reader.py`**

```python
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
    import pytest
    with pytest.raises(ValueError, match="not an RFF"):
        read_rff(p)
```

- [ ] **Step 4: Run tests, expect FAIL (`read_rff` not defined)**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_rff_reader.py -v`
Expected: `ModuleNotFoundError: No module named 'scripts.rff_reader'`

- [ ] **Step 5: Implement `scripts/rff_reader.py`**

```python
"""RFF v3.1 archive reader. Extracted from extract_blood_sprites.py."""
from __future__ import annotations
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class RffEntry:
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
        # DICT_CRYPT: if flags bit 0x10, XOR first 256 bytes with (i >> 1) & 0xFF
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
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_rff_reader.py -v`
Expected: both tests PASS.

- [ ] **Step 7: Write `scripts/tests/test_qav_parser.py`**

```python
from scripts.qav_parser import parse_qav


def test_parses_minimal_qav(minimal_qav_bytes):
    result = parse_qav(minimal_qav_bytes)
    assert result["nFrames"] == 2
    assert result["ticksPerFrame"] == 8
    assert len(result["frames"]) == 2
    # Frame 0 has one active tile: picnum 3205 at offset (10, 20)
    f0 = result["frames"][0]
    assert len(f0["tiles"]) == 1
    assert f0["tiles"][0]["picnum"] == 3205
    assert f0["tiles"][0]["ox"] == 10
    assert f0["tiles"][0]["oy"] == 20


def test_rejects_bad_qav_magic():
    import pytest
    with pytest.raises(ValueError, match="QAV"):
        parse_qav(b"XXXX" + b"\x00" * 100)
```

- [ ] **Step 8: Run tests, expect FAIL (module not defined)**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_qav_parser.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 9: Implement `scripts/qav_parser.py`**

Use the exact struct layout transcribed in Step 2. Skeleton to fill in:

```python
"""QAV binary parser. Layout from NotBlood source/blood/src/qav.h."""
from __future__ import annotations
import struct
from typing import Any

# Transcribe these from qav.h — VERIFY by checking header sizes match struct docs:
QAV_HEADER_FMT = "<4sHHI..."   # fill in to match qav.h
QAV_HEADER_SIZE = struct.calcsize(QAV_HEADER_FMT)
TILE_FRAME_FMT = "<..."        # fill in: picnum i32, stat u32, ox/oy i16, z i32, ...
TILE_FRAME_SIZE = struct.calcsize(TILE_FRAME_FMT)
TILES_PER_FRAME = 8            # fixed array in QAVFRAME per qav.h


def parse_qav(data: bytes) -> dict[str, Any]:
    """Decode a QAV binary blob into a plain dict.

    Returns:
        {
            "nFrames": int,
            "ticksPerFrame": int,
            "flags": int,
            "frames": [
                {
                    "tiles": [
                        {"picnum": int, "stat": int, "ox": int, "oy": int, "z": int},
                        ...  # only active tiles (picnum >= 0) are included
                    ],
                },
                ...
            ],
        }
    """
    # 1. Validate magic (first 4 bytes == b"QAV\x00" per qav.h — verify exact magic).
    # 2. Unpack header to get nFrames, ticksPerFrame, flags.
    # 3. For each frame, unpack TILES_PER_FRAME tile records and filter by picnum >= 0.
    raise NotImplementedError("implement after Step 2 layout transcription")
```

Fill in the body to match the transcribed layout. Critical constraints:
- All unpacks must use `<` (little-endian).
- Skip QAV header fields we don't use (pad / `x` / `y` global offsets) by reading past them but not storing.
- Tile records with `picnum < 0` are "unused slots" in Blood's fixed 8-element array — filter them out.
- `stat`, `ox`, `oy`, `z` stored verbatim (ignored downstream unless consumed, but parse them for future use).

- [ ] **Step 10: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_qav_parser.py -v`
Expected: both tests PASS. If layout was mis-transcribed, tests fail with value mismatches — fix the struct format string and re-run.

- [ ] **Step 11: Write `scripts/tests/test_seq_parser.py`**

```python
from scripts.seq_parser import parse_seq


def test_parses_minimal_seq(minimal_seq_bytes):
    result = parse_seq(minimal_seq_bytes)
    assert result["nFrames"] == 2
    assert result["ticksPerFrame"] == 8
    assert len(result["frames"]) == 2
    assert result["frames"][0]["tile"] == 100
    assert result["frames"][1]["tile"] == 101


def test_rejects_bad_seq_magic():
    import pytest
    with pytest.raises(ValueError, match="SEQ"):
        parse_seq(b"XXXX" + b"\x00" * 100)
```

- [ ] **Step 12: Run tests, expect FAIL**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_seq_parser.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 13: Implement `scripts/seq_parser.py`**

```python
"""SEQ binary parser. Layout from NotBlood source/blood/src/seq.h.

Header (16 bytes): magic "SEQ\\x1a", version(u16), nFrames(u16),
                   ticksPerFrame(u16), nSoundID(u16), flags(u32).
Each SEQFRAME: 8 bytes, bitfield packed.
  - tile: bits 0-11 of first u32 (low 12 bits)
  - tile2: bits 44-47 (high 4 bits of tile) — combine: tile |= (tile2 << 12)
  - other fields: stat flags, xoffset, yoffset, sound, callback, palookup
    (per seq.h — transcribe the full bitfield layout from SEQFRAME definition)
"""
from __future__ import annotations
import struct
from typing import Any

SEQ_HEADER_FMT = "<4sHHHHI"
SEQ_HEADER_SIZE = struct.calcsize(SEQ_HEADER_FMT)
SEQFRAME_SIZE = 8


def parse_seq(data: bytes) -> dict[str, Any]:
    magic, version, n_frames, ticks_per_frame, n_sound_id, flags = \
        struct.unpack_from(SEQ_HEADER_FMT, data, 0)
    if magic != b"SEQ\x1a":
        raise ValueError(f"not a SEQ (magic {magic!r})")

    frames = []
    for i in range(n_frames):
        off = SEQ_HEADER_SIZE + i * SEQFRAME_SIZE
        raw = struct.unpack_from("<Q", data, off)[0]
        tile_low = raw & 0xFFF                   # bits 0-11
        tile_high = (raw >> 44) & 0xF            # bits 44-47
        tile = tile_low | (tile_high << 12)
        # Additional bitfield fields — transcribe from seq.h SEQFRAME struct.
        # For the MVP we only need tile; store raw for debugging.
        frames.append({
            "tile": tile,
            "raw": raw,
        })

    return {
        "version": version,
        "nFrames": n_frames,
        "ticksPerFrame": ticks_per_frame,
        "nSoundID": n_sound_id,
        "flags": flags,
        "frames": frames,
    }
```

After reading seq.h, extend each frame dict with additional fields if present: `sound`, `xoffset`, `yoffset`, `stat`, `callback`, `palookup`. For MVP extraction only `tile` is consumed downstream.

- [ ] **Step 14: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_seq_parser.py -v`
Expected: both tests PASS.

- [ ] **Step 15: Write `scripts/tests/test_art_meta.py`**

```python
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
```

- [ ] **Step 16: Run tests, expect FAIL**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_art_meta.py -v`

- [ ] **Step 17: Implement `scripts/art_meta.py`**

```python
"""ART tile metadata extraction — tile dimensions + anchor offsets."""
from __future__ import annotations
import struct
from pathlib import Path
from typing import Any


def decode_picanm(picanm: int) -> dict[str, int]:
    """Decode a 32-bit picanm field from an ART header.

    Bit layout (Build engine convention):
      bits 0-5   animFrames (6 bits, 0-63)
      bits 6-7   animType   (0=noanim, 1=oscillate, 2=forward, 3=backward)
      bits 8-15  xoffset    (signed int8)
      bits 16-23 yoffset    (signed int8)
      bits 24-27 animSpeed  (4 bits)
      bits 28-31 extra flags
    """
    xoff_raw = (picanm >> 8) & 0xFF
    yoff_raw = (picanm >> 16) & 0xFF
    # Sign-extend 8-bit → int
    xoff = xoff_raw - 256 if xoff_raw >= 128 else xoff_raw
    yoff = yoff_raw - 256 if yoff_raw >= 128 else yoff_raw
    return {
        "animFrames": picanm & 0x3F,
        "animType": (picanm >> 6) & 0x3,
        "xoffset": xoff,
        "yoffset": yoff,
    }


def read_art_meta(art_path: Path) -> list[dict[str, Any]]:
    """Read tile metadata (sizx, sizy, picanm) from a TILES*.ART file.

    Returns list of {picnum, w, h, xoffset, yoffset} — one entry per tile
    in the ART file, including blank tiles (w=h=0).
    """
    data = Path(art_path).read_bytes()
    version, _unused, start, end = struct.unpack_from("<IIII", data, 0)
    if version != 1:
        raise ValueError(f"unexpected ART version {version} in {art_path.name}")
    n = end - start + 1
    off = 16
    sizx = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    sizy = struct.unpack_from(f"<{n}H", data, off); off += n * 2
    picanm = struct.unpack_from(f"<{n}I", data, off); off += n * 4
    out = []
    for i in range(n):
        anm = decode_picanm(picanm[i])
        out.append({
            "picnum": start + i,
            "w": sizx[i],
            "h": sizy[i],
            "xoffset": anm["xoffset"],
            "yoffset": anm["yoffset"],
        })
    return out
```

- [ ] **Step 18: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/test_art_meta.py -v`

- [ ] **Step 19: Run all Python tests together, verify full green**

Run: `cd /Users/donny/Projects/blud && python -m pytest scripts/tests/ -v`
Expected: all tests PASS (rff_reader, qav_parser, seq_parser, art_meta).

- [ ] **Step 20: Commit**

```bash
git add scripts/rff_reader.py scripts/qav_parser.py scripts/seq_parser.py scripts/art_meta.py scripts/tests/
git commit -m "feat(animation): add QAV/SEQ/RFF/ART binary parsers with fixtures

Pure-logic Python parsers for Blood's binary asset formats. No I/O;
fully unit-tested with hand-crafted byte fixtures. Struct layouts
transcribed from NotBlood qav.h, seq.h, build engine ART format.

Part of animation system port (see docs/superpowers/plans/2026-04-21-blud-animation-system.md)"
```

---

## Task 2: Extraction CLIs → JSON manifests

**Files:**
- Create: `scripts/extract_qav.py`
- Create: `scripts/extract_seq.py`
- Create: `scripts/extract_tile_meta.py`
- Create: `scripts/build_animation_index.py`
- Create: `public/assets/animations/tiles-meta.json` (generated, committed)
- Create: `public/assets/animations/index.json` (generated, committed)
- Create: `public/assets/animations/weapons/*.json` (generated, committed)
- Create: `public/assets/animations/characters/*.json` (generated, committed)

**Context:** Wire parsers from Task 1 into CLI scripts that read `BLOOD.RFF` at `/Users/donny/Documents/Raze/blood/BLOOD.RFF` and emit JSON manifests in the schema defined in the spec. This task runs the scripts against real data and commits the output JSON. The JSON files become the game's source of animation truth — committed, diffable, self-contained.

**Which animations to extract:** The design spec calls for dynamite QAVs + axe-zombie SEQs.
- Dynamite: NotBlood `weapon.cpp` `processTNT` (~line 2141) references QAV IDs. Grep for `QAV_` constants near that function. Typical IDs: idle, cock/cook, throw — expect 3-5 total. Name manifests `dynamite-idle.json`, `dynamite-cock.json`, `dynamite-throw.json`.
- Axe zombie: NotBlood `aizombi.cpp` references SEQ IDs. Grep for `seqSpawn(` and `seqStartId`. Expect ~8 SEQs: idle, chase (walk), attack-windup, attack-swing, stagger/recoil, death-normal, death-gib, death-burn. Name manifests `zombie-idle.json`, `zombie-walk.json`, `zombie-attack.json`, `zombie-stagger.json`, `zombie-death.json`, `zombie-death-gib.json`, `zombie-death-burn.json`, `zombie-chase.json` (some may collapse — let reality drive the filenames).

- [ ] **Step 1: Inventory QAV IDs for dynamite**

Read `/Users/donny/Documents/Raze/NotBlood/source/blood/src/weapon.cpp`. Grep for `processTNT`, read the function. Note every QAV ID referenced (integer constants passed to `StartQAV` or similar). Also check `view.cpp` for a weapon-view QAV table. Write findings to a throwaway comment or scratch file — this informs the `--only` filter used below.

- [ ] **Step 2: Inventory SEQ IDs for axe zombie**

Read `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aizombi.cpp` (and `dude.cpp` `dudeInfo[]` — look up the axe-zombie entry, note its `seqStartId`). Axe-zombie SEQ IDs are offsets from `seqStartId`. Enumerate the offsets used (idle, chase, attack, etc.).

- [ ] **Step 3: Implement `scripts/extract_tile_meta.py`**

```python
#!/usr/bin/env python3
"""Extract per-tile metadata (w, h, anchor offsets) from all TILES*.ART files.

Usage: python -m scripts.extract_tile_meta <blood-dir> --out <path>
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from scripts.art_meta import read_art_meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("blood_dir", help="Blood data directory containing TILES*.ART")
    ap.add_argument("--out", required=True, help="Output JSON path")
    args = ap.parse_args()

    blood_dir = Path(args.blood_dir)
    all_meta: dict[str, dict] = {}
    art_files = sorted(list(blood_dir.glob("TILES*.ART")) + list(blood_dir.glob("tiles*.art")))
    for art in art_files:
        for tile in read_art_meta(art):
            if tile["w"] == 0 and tile["h"] == 0:
                continue  # skip blanks
            all_meta[str(tile["picnum"])] = {
                "w": tile["w"],
                "h": tile["h"],
                "ox": tile["xoffset"],
                "oy": tile["yoffset"],
            }

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(all_meta, separators=(",", ":"), indent=0))
    print(f"wrote {len(all_meta)} tiles → {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tile-meta extraction**

```bash
cd /Users/donny/Projects/blud
mkdir -p public/assets/animations
python -m scripts.extract_tile_meta /Users/donny/Documents/Raze/blood \
  --out public/assets/animations/tiles-meta.json
```
Expected: script prints "wrote N tiles → ..." where N is in the thousands (Blood has ~4600 populated tiles).

Verify: `python -c "import json; d=json.load(open('public/assets/animations/tiles-meta.json')); print(len(d), 'tiles'); print(d['3205'])"` — should show a width/height/offset dict for tile 3205.

- [ ] **Step 5: Implement `scripts/extract_qav.py`**

```python
#!/usr/bin/env python3
"""Extract QAV animations from BLOOD.RFF into JSON manifests.

Usage: python -m scripts.extract_qav <blood.rff> --out <dir> [--only <id>]
       python -m scripts.extract_qav <blood.rff> --out <dir> --ids 5,6,7
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from scripts.rff_reader import read_rff, iter_by_ext
from scripts.qav_parser import parse_qav


QAV_NAMES_BY_ID: dict[int, str] = {
    # Fill in from Task 2, Step 1 inventory. Example entries:
    # 6: "dynamite-cock",
    # 7: "dynamite-throw",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rff", help="Path to BLOOD.RFF")
    ap.add_argument("--out", required=True, help="Output directory")
    ap.add_argument("--ids", help="Comma-separated list of QAV IDs to extract")
    ap.add_argument("--only", help="Extract single QAV by name (from QAV_NAMES_BY_ID)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = read_rff(Path(args.rff))
    qavs = list(iter_by_ext(entries, "QAV"))

    wanted_ids: set[int] | None = None
    if args.ids:
        wanted_ids = {int(s) for s in args.ids.split(",")}
    if args.only:
        name_to_id = {v: k for k, v in QAV_NAMES_BY_ID.items()}
        if args.only not in name_to_id:
            raise SystemExit(f"unknown QAV name {args.only!r}; known: {sorted(name_to_id)}")
        wanted_ids = {name_to_id[args.only]}

    written = 0
    for e in qavs:
        if wanted_ids is not None and e.id not in wanted_ids:
            continue
        name = QAV_NAMES_BY_ID.get(e.id, e.name.lower() or f"qav-{e.id}")
        parsed = parse_qav(e.data)
        manifest = qav_parsed_to_manifest(name, parsed)
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"  wrote {path.name} ({parsed['nFrames']} frames)")
        written += 1
    print(f"wrote {written} QAV manifests → {out_dir}")


def qav_parsed_to_manifest(name: str, parsed: dict) -> dict:
    """Convert raw parsed QAV dict → schema-matching manifest.

    Schema (per spec):
      {
        "name": str,
        "kind": "qav",
        "loop": bool,
        "nFrames": int,
        "frames": [
          {
            "durMs": int,
            "layers": [{"tile": int, "ox": int, "oy": int, "scale": float}, ...]
          }
        ]
      }
    """
    # Blood ticks are 1/120 s. ticksPerFrame from header → durMs.
    ticks_per_frame = parsed["ticksPerFrame"]
    dur_ms = round(ticks_per_frame * 1000 / 120)
    # QAV loop flag: most weapon animations loop when held in a state, but
    # "throw" animations are one-shot. Conservative default: loop=True; hand-
    # edit per animation after extraction. (Blood's QAV flags field has a
    # bit for this — document which bit in qav.h and decode if time permits.)
    loop = True
    frames = []
    for f in parsed["frames"]:
        layers = []
        for t in f["tiles"]:
            layers.append({
                "tile": t["picnum"],
                "ox": t["ox"],
                "oy": t["oy"],
                "scale": t["z"] / 65536.0 if t["z"] else 1.0,
            })
        frames.append({"durMs": dur_ms, "layers": layers})
    return {
        "name": name, "kind": "qav", "loop": loop,
        "nFrames": parsed["nFrames"], "frames": frames,
    }


if __name__ == "__main__":
    main()
```

Populate `QAV_NAMES_BY_ID` with the findings from Step 1 before running.

- [ ] **Step 6: Run QAV extraction for dynamite**

```bash
cd /Users/donny/Projects/blud
python -m scripts.extract_qav /Users/donny/Documents/Raze/blood/BLOOD.RFF \
  --out public/assets/animations/weapons \
  --ids <comma-list-from-step-1>
```

Verify: `ls public/assets/animations/weapons/` shows the expected manifests. Spot-check one with `jq .` — should have `nFrames`, `frames[].layers[].tile` matching sensible dynamite picnums (3192, 3205-3220, 3225 range per prior M2 extraction).

- [ ] **Step 7: Post-extraction hand-correction pass on QAV manifests**

QAV loop semantics vary per animation. Walk each committed manifest and set `loop`:
- `dynamite-idle`: `true`
- `dynamite-cock` (lighter-sparking cook loop): `true`
- `dynamite-throw`: `false` (one-shot)
- Others: default `true` unless logic suggests otherwise.

Document in commit message why each was set.

- [ ] **Step 8: Implement `scripts/extract_seq.py`**

Pattern mirrors `extract_qav.py`. Key differences:
- Uses `parse_seq` instead of `parse_qav`.
- Schema output has `kind: "seq"`, `baseTile`, `angleStride`, and `frames[].tileOffset` (not `layers`).
- `baseTile` inferred from the minimum `frame.tile` across the SEQ. `tileOffset = frame.tile - baseTile`.
- `angleStride`: Blood's standard is 5. Hard-default to 5 for zombie SEQs; if inspection of SEQ reveals different stride semantics, mark as 1 for single-angle SEQs (e.g., burning death that doesn't rotate). Extraction CLI accepts `--angle-stride N` override.

```python
def seq_parsed_to_manifest(name: str, parsed: dict, angle_stride: int) -> dict:
    tiles = [f["tile"] for f in parsed["frames"]]
    base_tile = min(tiles) if tiles else 0
    ticks = parsed["ticksPerFrame"]
    dur_ms = round(ticks * 1000 / 120)
    # If angle_stride > 1, frames in a 5-rotation SEQ typically show offsets
    # like 0, 5, 10, 15, ... — i.e., increments of angle_stride. In that case
    # tileOffset should be (frame.tile - base_tile) // angle_stride so that
    # runtime reconstructs baseTile + tileOffset*angleStride + v.
    # For angle_stride == 1, tileOffset = frame.tile - base_tile literally.
    loop = True  # hand-correct per animation
    frames = []
    for f in parsed["frames"]:
        raw_offset = f["tile"] - base_tile
        tile_offset = raw_offset // angle_stride if angle_stride > 1 else raw_offset
        frames.append({"tileOffset": tile_offset, "durMs": dur_ms})
    return {
        "name": name, "kind": "seq", "loop": loop,
        "baseTile": base_tile, "angleStride": angle_stride,
        "frames": frames,
    }
```

- [ ] **Step 9: Run SEQ extraction for axe zombie**

Using the SEQ IDs from Step 2:

```bash
cd /Users/donny/Projects/blud
python -m scripts.extract_seq /Users/donny/Documents/Raze/blood/BLOOD.RFF \
  --out public/assets/animations/characters \
  --ids <comma-list-from-step-2>
```

Spot-check: `zombie-walk.json` should have `baseTile` near 1170, 4 frames, `durMs ~133` (16 ticks per frame is common), `angleStride: 5`.

- [ ] **Step 10: Post-extraction hand-correction pass on SEQ manifests**

Per-manifest `loop`:
- `zombie-idle`, `zombie-walk`, `zombie-chase`: `true`
- `zombie-attack`, `zombie-stagger`, `zombie-death*`: `false`

`angleStride` fixups:
- `zombie-death-burn` or any death that doesn't rotate: regenerate with `--angle-stride 1` or edit manually.

- [ ] **Step 11: Implement `scripts/build_animation_index.py`**

```python
#!/usr/bin/env python3
"""Rebuild public/assets/animations/index.json from on-disk manifests."""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="public/assets/animations")
    args = ap.parse_args()
    root = Path(args.root)
    index: dict[str, dict[str, str]] = {"weapons": {}, "characters": {}}
    for category in ("weapons", "characters"):
        cat_dir = root / category
        if not cat_dir.exists():
            continue
        for p in sorted(cat_dir.glob("*.json")):
            manifest = json.loads(p.read_text())
            index[category][manifest["name"]] = f"{category}/{p.name}"
    (root / "index.json").write_text(json.dumps(index, indent=2))
    print(f"wrote {sum(len(v) for v in index.values())} entries → {root / 'index.json'}")


if __name__ == "__main__":
    main()
```

Run:
```bash
cd /Users/donny/Projects/blud
python -m scripts.build_animation_index
```

Verify: `cat public/assets/animations/index.json` shows both categories populated.

- [ ] **Step 12: Spot-verify one manifest against in-game picnums**

Inspect `public/assets/animations/weapons/dynamite-cock.json`. Cross-reference `frames[*].layers[*].tile` against the picnums in [src/main.ts:142](../../src/main.ts:142) (currently `[3205, 3208, 3211, 3214, 3217, 3220]` hand-picked). They should appear in the extracted manifest. If radically different, the QAV ID → name mapping is wrong — revisit Step 1.

- [ ] **Step 13: Commit**

```bash
git add scripts/extract_qav.py scripts/extract_seq.py scripts/extract_tile_meta.py scripts/build_animation_index.py public/assets/animations/
git commit -m "feat(animation): extract dynamite QAVs + zombie SEQs + tile metadata

Emits JSON manifests in the schema from spec 2026-04-21-blud-animation-system-design.md.
tiles-meta.json covers all ~4600 populated Blood tiles with real dimensions + anchor
offsets. Loop flags set per-animation based on weapon/AI state semantics.

Part of animation system port."
```

---

## Task 3: TS schema + validator

**Files:**
- Create: `src/animation/qav-schema.ts`
- Create: `src/animation/qav-schema.test.ts`

**Context:** Pure data validation for loaded manifests. No Three.js, no I/O. Runs at boot before textures are loaded, so bad JSON fails fast with a clear error pointing at the offending file/field.

- [ ] **Step 1: Write `src/animation/qav-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from './qav-schema';

const validQav = {
  name: 'dynamite-cock',
  kind: 'qav',
  loop: true,
  nFrames: 1,
  frames: [{ durMs: 50, layers: [{ tile: 3205, ox: 0, oy: 0, scale: 1.0 }] }],
};

const validSeq = {
  name: 'zombie-walk',
  kind: 'seq',
  loop: true,
  baseTile: 1170,
  angleStride: 5,
  frames: [{ tileOffset: 0, durMs: 120 }],
};

const tileMeta = { '1170': { w: 48, h: 64, ox: 0, oy: -32 }, '3205': { w: 40, h: 50, ox: 0, oy: -25 } };

describe('validateManifest', () => {
  it('accepts valid QAV', () => {
    expect(() => validateManifest(validQav, tileMeta)).not.toThrow();
  });
  it('accepts valid SEQ', () => {
    expect(() => validateManifest(validSeq, tileMeta)).not.toThrow();
  });
  it('rejects missing name', () => {
    const bad = { ...validQav, name: undefined };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/name/);
  });
  it('rejects unknown kind', () => {
    expect(() => validateManifest({ ...validQav, kind: 'xyz' }, tileMeta)).toThrow(/kind/);
  });
  it('rejects QAV with zero frames', () => {
    expect(() => validateManifest({ ...validQav, frames: [] }, tileMeta)).toThrow(/frames/);
  });
  it('rejects QAV frame with non-positive durMs', () => {
    const bad = { ...validQav, frames: [{ durMs: 0, layers: [{ tile: 3205, ox: 0, oy: 0, scale: 1 }] }] };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/durMs/);
  });
  it('rejects QAV layer referencing unknown tile', () => {
    const bad = { ...validQav, frames: [{ durMs: 50, layers: [{ tile: 99999, ox: 0, oy: 0, scale: 1 }] }] };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/tile 99999/);
  });
  it('rejects SEQ with angleStride < 1', () => {
    expect(() => validateManifest({ ...validSeq, angleStride: 0 }, tileMeta)).toThrow(/angleStride/);
  });
  it('rejects SEQ referencing tile not in tileMeta', () => {
    const bad = { ...validSeq, baseTile: 99999 };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/tile 99999/);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/qav-schema.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `src/animation/qav-schema.ts`**

```ts
/** Per-tile metadata loaded from tiles-meta.json. */
export interface TileMeta {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export type TileMetaMap = Record<string, TileMeta>;

export interface QavLayer {
  tile: number;
  ox: number;
  oy: number;
  scale: number;
  flipX?: boolean;
}

export interface QavFrame {
  durMs: number;
  layers: QavLayer[];
  events?: string[]; // reserved; runtime ignores for now
}

export interface QavManifest {
  name: string;
  kind: 'qav';
  loop: boolean;
  nFrames: number;
  frames: QavFrame[];
}

export interface SeqFrame {
  tileOffset: number;
  durMs: number;
  events?: string[];
}

export interface SeqManifest {
  name: string;
  kind: 'seq';
  loop: boolean;
  baseTile: number;
  angleStride: number;
  frames: SeqFrame[];
}

export type AnimationManifest = QavManifest | SeqManifest;

export class ManifestError extends Error {
  constructor(public manifestName: string, public field: string, msg: string) {
    super(`manifest "${manifestName}" (${field}): ${msg}`);
    this.name = 'ManifestError';
  }
}

export function validateManifest(
  raw: unknown,
  tileMeta: TileMetaMap,
): AnimationManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestError('<unknown>', '(root)', 'not an object');
  }
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name : undefined;
  if (!name) throw new ManifestError('<unknown>', 'name', 'missing or not a string');

  const require = (field: string, cond: boolean, msg: string): void => {
    if (!cond) throw new ManifestError(name, field, msg);
  };

  if (r.kind === 'qav') {
    require('loop', typeof r.loop === 'boolean', 'must be boolean');
    require('frames', Array.isArray(r.frames) && (r.frames as unknown[]).length > 0, 'must be non-empty array');
    const frames = r.frames as unknown[];
    frames.forEach((f, i) => {
      if (typeof f !== 'object' || f === null) {
        throw new ManifestError(name, `frames[${i}]`, 'not an object');
      }
      const fr = f as Record<string, unknown>;
      require(`frames[${i}].durMs`, typeof fr.durMs === 'number' && fr.durMs > 0, 'must be positive number');
      require(`frames[${i}].layers`, Array.isArray(fr.layers), 'must be array');
      const layers = fr.layers as unknown[];
      layers.forEach((l, j) => {
        if (typeof l !== 'object' || l === null) {
          throw new ManifestError(name, `frames[${i}].layers[${j}]`, 'not an object');
        }
        const lyr = l as Record<string, unknown>;
        require(`frames[${i}].layers[${j}].tile`, typeof lyr.tile === 'number', 'must be number');
        const tile = lyr.tile as number;
        if (!(String(tile) in tileMeta)) {
          throw new ManifestError(name, `frames[${i}].layers[${j}].tile`, `tile ${tile} not in tiles-meta.json`);
        }
        require(`frames[${i}].layers[${j}].ox`, typeof lyr.ox === 'number', 'must be number');
        require(`frames[${i}].layers[${j}].oy`, typeof lyr.oy === 'number', 'must be number');
        require(`frames[${i}].layers[${j}].scale`, typeof lyr.scale === 'number', 'must be number');
      });
    });
    return raw as QavManifest;
  }

  if (r.kind === 'seq') {
    require('loop', typeof r.loop === 'boolean', 'must be boolean');
    require('baseTile', typeof r.baseTile === 'number', 'must be number');
    if (!(String(r.baseTile) in tileMeta)) {
      throw new ManifestError(name, 'baseTile', `tile ${r.baseTile} not in tiles-meta.json`);
    }
    require('angleStride', typeof r.angleStride === 'number' && (r.angleStride as number) >= 1, 'must be >= 1');
    require('frames', Array.isArray(r.frames) && (r.frames as unknown[]).length > 0, 'must be non-empty array');
    const frames = r.frames as unknown[];
    frames.forEach((f, i) => {
      if (typeof f !== 'object' || f === null) throw new ManifestError(name, `frames[${i}]`, 'not an object');
      const fr = f as Record<string, unknown>;
      require(`frames[${i}].tileOffset`, typeof fr.tileOffset === 'number', 'must be number');
      require(`frames[${i}].durMs`, typeof fr.durMs === 'number' && fr.durMs > 0, 'must be positive');
    });
    return raw as SeqManifest;
  }

  throw new ManifestError(name, 'kind', `unknown kind "${String(r.kind)}"; expected "qav" or "seq"`);
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/qav-schema.test.ts`
Expected: all 9 tests PASS.

- [ ] **Step 5: Validate every generated manifest from Task 2**

Add an ad-hoc test that loads every file in `public/assets/animations/{weapons,characters}/*.json` and runs `validateManifest`. If any real manifest fails validation, that's a bug in the extractor — fix it and re-extract.

```ts
// src/animation/qav-schema.test.ts — add at bottom
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('real manifest validation', () => {
  const meta = JSON.parse(fs.readFileSync('public/assets/animations/tiles-meta.json', 'utf8'));
  const roots = ['public/assets/animations/weapons', 'public/assets/animations/characters'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.json'))) {
      it(`validates ${root}/${f}`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        expect(() => validateManifest(raw, meta)).not.toThrow();
      });
    }
  }
});
```

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/qav-schema.test.ts`
Expected: all generated manifests validate cleanly.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/donny/Projects/blud && npm test`
Expected: existing 80 tests + 9 new schema tests + N real-manifest tests — all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/animation/qav-schema.ts src/animation/qav-schema.test.ts
git commit -m "feat(animation): add manifest schema types + validator

Hand-rolled validator, no runtime deps. Throws ManifestError with file +
field path on bad JSON. Validates all extracted manifests at test time so
extractor bugs fail CI immediately."
```

---

## Task 4: Base animator (frame ticker)

**Files:**
- Create: `src/animation/animator.ts`
- Create: `src/animation/animator.test.ts`

**Context:** Pure frame picker. Takes a frame list + elapsed time → current frame index. Handles loop/hold semantics. No Three.js, no DOM, no state beyond what's passed in. Both `FpWeaponAnimator` and `BillboardAnimator` use this as their core.

- [ ] **Step 1: Write `src/animation/animator.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pickFrameIndex } from './animator';

const frames = [{ durMs: 100 }, { durMs: 100 }, { durMs: 100 }]; // 3 frames × 100ms

describe('pickFrameIndex', () => {
  it('returns 0 at elapsed=0', () => {
    expect(pickFrameIndex(frames, 0, true)).toBe(0);
  });
  it('returns 0 at elapsed=50ms (first frame)', () => {
    expect(pickFrameIndex(frames, 50, true)).toBe(0);
  });
  it('returns 1 at elapsed=100ms (boundary)', () => {
    expect(pickFrameIndex(frames, 100, true)).toBe(1);
  });
  it('returns 2 at elapsed=250ms', () => {
    expect(pickFrameIndex(frames, 250, true)).toBe(2);
  });
  it('loops: returns 0 at elapsed=300ms (one full cycle)', () => {
    expect(pickFrameIndex(frames, 300, true)).toBe(0);
  });
  it('loops: returns 1 at elapsed=400ms', () => {
    expect(pickFrameIndex(frames, 400, true)).toBe(1);
  });
  it('holds last frame when loop=false past total duration', () => {
    expect(pickFrameIndex(frames, 500, false)).toBe(2);
  });
  it('handles negative elapsed by returning 0', () => {
    expect(pickFrameIndex(frames, -50, true)).toBe(0);
  });
  it('handles variable-duration frames', () => {
    const f = [{ durMs: 50 }, { durMs: 200 }, { durMs: 50 }]; // total 300
    expect(pickFrameIndex(f, 0, true)).toBe(0);
    expect(pickFrameIndex(f, 60, true)).toBe(1);
    expect(pickFrameIndex(f, 250, true)).toBe(2);
    expect(pickFrameIndex(f, 299, true)).toBe(2);
    expect(pickFrameIndex(f, 300, true)).toBe(0); // loop
  });
  it('throws on empty frame list', () => {
    expect(() => pickFrameIndex([], 0, true)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/animator.test.ts`
Expected: module/function not defined.

- [ ] **Step 3: Implement `src/animation/animator.ts`**

```ts
/**
 * Pure frame-picking logic shared by FP and billboard animators.
 *
 * Given a list of frames (each with its own duration in ms) and an elapsed
 * time in ms, return the index of the currently-visible frame.
 *
 * - loop=true: wraps around after total duration.
 * - loop=false: holds the last frame once past total duration.
 * - Negative elapsed is treated as 0 (defensive).
 */

export interface TimedFrame {
  durMs: number;
}

export function pickFrameIndex(
  frames: readonly TimedFrame[],
  elapsedMs: number,
  loop: boolean,
): number {
  if (frames.length === 0) throw new Error('pickFrameIndex: empty frame list');
  if (elapsedMs <= 0) return 0;

  const total = frames.reduce((s, f) => s + f.durMs, 0);
  let t = elapsedMs;
  if (loop) {
    t = t % total;
  } else if (t >= total) {
    return frames.length - 1;
  }

  // Walk frames, subtracting durations until we land inside one.
  for (let i = 0; i < frames.length; i++) {
    const d = frames[i]!.durMs;
    if (t < d) return i;
    t -= d;
  }
  return frames.length - 1; // defensive
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/animator.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/animation/animator.ts src/animation/animator.test.ts
git commit -m "feat(animation): add pure frame-picker (pickFrameIndex)

Framework-free core: elapsed-ms + frame-list + loop flag → frame index.
Handles variable-duration frames, loop wrap, hold-last-frame, negative
elapsed. Shared by both FP and billboard animators."
```

---

## Task 5: `FpWeaponAnimator` + manifest loader + Dynamite swap

**Files:**
- Create: `src/animation/manifest-loader.ts`
- Create: `src/animation/fp-weapon-animator.ts`
- Modify: `src/engine/asset-loader.ts` — add `loadAnimationManifests()`.
- Modify: `src/game/weapons/dynamite.ts` — swap from `getAnimState`/`FpWeaponView` coupling to calling `fpAnimator.play(...)`.
- Modify: `src/main.ts` — replace `FpWeaponView` wire-up with `FpWeaponAnimator`.
- Delete: `src/vfx/fp-weapon.ts`

**Context:** Wire the runtime side of QAV playback. Key tricky part: **pixel-offset → camera-space conversion**. Blood QAVs express offsets in a 320×200 reference viewport relative to a center-bottom anchor. Runtime converts these to Three.js camera-space per the active viewport size.

- [ ] **Step 1: Implement `src/animation/manifest-loader.ts`**

```ts
import type { AnimationManifest, TileMetaMap } from './qav-schema';
import { validateManifest } from './qav-schema';

export interface AnimationBundle {
  tileMeta: TileMetaMap;
  weapons: Record<string, AnimationManifest>;
  characters: Record<string, AnimationManifest>;
}

const BASE = 'assets/animations';

export async function loadAnimationManifests(): Promise<AnimationBundle> {
  const [tileMetaRes, indexRes] = await Promise.all([
    fetch(`${BASE}/tiles-meta.json`),
    fetch(`${BASE}/index.json`),
  ]);
  if (!tileMetaRes.ok) throw new Error(`failed to load tiles-meta.json`);
  if (!indexRes.ok) throw new Error(`failed to load index.json`);
  const tileMeta = (await tileMetaRes.json()) as TileMetaMap;
  const index = (await indexRes.json()) as {
    weapons: Record<string, string>;
    characters: Record<string, string>;
  };

  const loadCategory = async (
    cat: Record<string, string>,
  ): Promise<Record<string, AnimationManifest>> => {
    const out: Record<string, AnimationManifest> = {};
    await Promise.all(
      Object.entries(cat).map(async ([name, relPath]) => {
        const res = await fetch(`${BASE}/${relPath}`);
        if (!res.ok) throw new Error(`failed to load ${relPath}`);
        const raw = await res.json();
        out[name] = validateManifest(raw, tileMeta);
      }),
    );
    return out;
  };

  const [weapons, characters] = await Promise.all([
    loadCategory(index.weapons),
    loadCategory(index.characters),
  ]);
  return { tileMeta, weapons, characters };
}
```

- [ ] **Step 2: Implement `src/animation/fp-weapon-animator.ts`**

```ts
import * as THREE from 'three';
import type { QavManifest, TileMetaMap } from './qav-schema';
import { pickFrameIndex } from './animator';

/**
 * Blood's reference viewport is 320×200. QAV offsets ox/oy are pixels
 * measured from the center-bottom anchor of that viewport.
 * Runtime converts to normalized camera-space coordinates.
 */
const BLOOD_VIEW_W = 320;
const BLOOD_VIEW_H = 200;

/** Loader: picnum → Three.Texture. Provided by main.ts at boot. */
export type TileTextureGetter = (picnum: number) => THREE.Texture;

/** Number of layer slots to pre-allocate. QAV supports up to 8 layers/frame. */
const MAX_LAYERS = 8;

export interface FpWeaponAnimatorOpts {
  /** Distance from camera at which weapons render. Matches Blood's FPV depth. */
  distance?: number;
  /** Scale factor: multiplier from Blood pixels → world-space at `distance`. */
  pixelsPerUnit?: number;
}

export class FpWeaponAnimator {
  private meshes: THREE.Mesh[];
  private currentAnim: QavManifest | null = null;
  private playbackStart = 0;
  private lastFrameIdx = -1;
  private readonly distance: number;
  private readonly pixelsPerUnit: number;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private weaponAnims: Record<string, QavManifest>,
    private tileMeta: TileMetaMap,
    private getTexture: TileTextureGetter,
    opts: FpWeaponAnimatorOpts = {},
  ) {
    this.distance = opts.distance ?? 0.6;
    this.pixelsPerUnit = opts.pixelsPerUnit ?? 200;

    this.meshes = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 999 - i;
      mesh.frustumCulled = false;
      mesh.visible = false;
      camera.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Start a new animation. Idempotent if name unchanged. */
  play(name: string, nowSec: number): void {
    const anim = this.weaponAnims[name];
    if (!anim) {
      console.warn(`FpWeaponAnimator: unknown animation "${name}"`);
      return;
    }
    if (this.currentAnim?.name === name) return;
    this.currentAnim = anim;
    this.playbackStart = nowSec;
    this.lastFrameIdx = -1;
  }

  /** Per-frame update. Call from render loop. */
  update(nowSec: number): void {
    const anim = this.currentAnim;
    if (!anim) {
      for (const m of this.meshes) m.visible = false;
      return;
    }
    const elapsedMs = (nowSec - this.playbackStart) * 1000;
    const idx = pickFrameIndex(anim.frames, elapsedMs, anim.loop);
    if (idx === this.lastFrameIdx) return;
    this.lastFrameIdx = idx;

    const frame = anim.frames[idx]!;
    const layers = 'layers' in frame ? frame.layers : [];

    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!;
      const layer = layers[i];
      if (!layer) {
        mesh.visible = false;
        continue;
      }
      const meta = this.tileMeta[String(layer.tile)];
      if (!meta) {
        mesh.visible = false;
        continue;
      }
      // Size the plane to the tile's pixel dimensions (the fix for the bug).
      const wWorld = (meta.w / this.pixelsPerUnit) * layer.scale;
      const hWorld = (meta.h / this.pixelsPerUnit) * layer.scale;
      (mesh.geometry as THREE.PlaneGeometry).dispose();
      mesh.geometry = new THREE.PlaneGeometry(wWorld, hWorld);

      // Position: QAV ox/oy are pixels from center-bottom anchor. Convert to
      // camera-space at `distance`. Y is flipped (screen-down → world-down).
      const anchorX = 0;
      const anchorY = -0.28; // center-bottom of camera FOV at distance=0.6 (tuned)
      const x = anchorX + (layer.ox / BLOOD_VIEW_W) * (this.distance * this.camera.aspect * 2 * Math.tan((this.camera.fov * Math.PI) / 360));
      const y = anchorY - (layer.oy / BLOOD_VIEW_H) * (this.distance * 2 * Math.tan((this.camera.fov * Math.PI) / 360));
      mesh.position.set(x, y, -this.distance);

      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map = this.getTexture(layer.tile);
      mat.needsUpdate = true;
      mesh.scale.x = layer.flipX ? -1 : 1;
      mesh.visible = true;
    }
  }

  setVisible(v: boolean): void {
    for (const m of this.meshes) m.visible = v && m.material !== undefined;
  }
}
```

**Calibration note:** The `anchorY = -0.28` and `pixelsPerUnit = 200` values are starting estimates. After this task is wired into `main.ts` (step 6 below), manually compare in-browser against the current hand-picked `fp-weapon.ts` behavior and nudge until the idle dynamite hand sits where it used to. Document final values with a comment.

- [ ] **Step 3: Add `loadAnimationManifests` export path**

Since `manifest-loader.ts` already implements this, main.ts imports from `src/animation/manifest-loader`. No change to `src/engine/asset-loader.ts` is strictly required for this task, but for consistency with existing asset loaders, add a re-export:

```ts
// src/engine/asset-loader.ts — add near top
export { loadAnimationManifests, type AnimationBundle } from '../animation/manifest-loader';
```

- [ ] **Step 4: Refactor `src/game/weapons/dynamite.ts` to use animator**

Replace the inline animation state machinery. The FSM (cooking/throwing/idle) stays; the animator coupling changes.

```ts
// src/game/weapons/dynamite.ts — minimal diff
// Remove: DynAnimState export, animState / animStateEnteredAt fields,
//         getAnimState(), getAnimElapsedSec(), setAnimState() helper.
// Add: accept an optional `fpAnimator?: FpWeaponAnimator` from FrameCtx OR
//      receive it via constructor. For minimum surface area, add to FrameCtx.

// Update FrameCtx in src/game/weapons/types.ts:
//   export interface FrameCtx { ...; fpAnimator?: FpWeaponAnimator; }

// In Dynamite methods, replace setAnimState('cooking', ctx.now) calls with:
//   ctx.fpAnimator?.play('dynamite-cook', ctx.now);
// And 'throwing' → 'dynamite-throw'; 'idle' → 'dynamite-idle'.

// The state-timer logic that returns from 'throwing' → 'idle' after
// THROW_ANIM_DUR_SEC stays, but now triggers ctx.fpAnimator.play('dynamite-idle').
```

Full updated `Dynamite` class (replace existing animation-related members):

```ts
// ...imports unchanged, remove FpWeaponView import if present

const THROW_ANIM_DUR_SEC = 0.3;

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  private cooking = false;
  private cookStart = 0;
  private throwingUntil = 0;

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0 || this.cooking || ctx.now < this.throwingUntil) return;
    this.cooking = true;
    this.cookStart = ctx.now;
    ctx.fpAnimator?.play('dynamite-cook', ctx.now);
  }

  onRelease(ctx: FrameCtx): void {
    if (!this.cooking) return;
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    const fuseLeft = Math.max(0, remainingFuse(heldSec));
    const vel = {
      x: ctx.player.forward.x * speed,
      y: ctx.player.forward.y * speed + 2.5,
      z: ctx.player.forward.z * speed,
    };
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now);
    this.ammo--;
    this.cooking = false;
    this.throwingUntil = ctx.now + THROW_ANIM_DUR_SEC;
    ctx.fpAnimator?.play('dynamite-throw', ctx.now);
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    if (this.cooking && (ctx.now - this.cookStart) >= DYNAMITE_COOK.fuseMaxSec) {
      ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
      this.cooking = false;
      ctx.fpAnimator?.play('dynamite-idle', ctx.now);
    }
    if (!this.cooking && ctx.now >= this.throwingUntil && this.throwingUntil > 0) {
      ctx.fpAnimator?.play('dynamite-idle', ctx.now);
      this.throwingUntil = 0;
    }
    updateProjectiles(ctx, dt);
  }

  chargeFraction(): number { return 0; /* HUD uses chargeFractionAt */ }
  chargeFractionAt(now: number): number {
    if (!this.cooking) return 0;
    return chargeFraction(now - this.cookStart);
  }
  isCooking(): boolean { return this.cooking; }
  renderView(_ctx: ViewCtx): void {}
  renderHud(_ctx: HudCtx): void {}
}
```

Update `src/game/weapons/types.ts` to add `fpAnimator?: FpWeaponAnimator` to `FrameCtx`:

```ts
import type { FpWeaponAnimator } from '../../animation/fp-weapon-animator';
export interface FrameCtx {
  // ... existing fields unchanged
  fpAnimator?: FpWeaponAnimator;
}
```

- [ ] **Step 5: Update existing Dynamite tests**

The existing tests in `src/game/weapons/dynamite.test.ts` test pure math (`chargeFraction`, `throwVelocityMps`, `remainingFuse`). These keep passing — no changes needed. Verify:

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/weapons/dynamite.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 6: Wire in `src/main.ts`**

Replace the existing `FpWeaponView` setup (near [src/main.ts:135-160](../../src/main.ts:135)):

```ts
// BEFORE: loader + hand-picked frame lists + new FpWeaponView(...)
// AFTER:

import { FpWeaponAnimator } from './animation/fp-weapon-animator';
import { loadAnimationManifests } from './animation/manifest-loader';

// at boot, after other asset loads:
const animBundle = await loadAnimationManifests();
const tileCache = new Map<number, THREE.Texture>();
const getTileTexture = (picnum: number): THREE.Texture => {
  let t = tileCache.get(picnum);
  if (!t) {
    // Load from the existing extracted PNGs at public/assets/blood-tiles/{picnum}.png
    // (or whatever path the existing sprite extractor uses).
    t = new THREE.TextureLoader().load(`assets/blood-tiles/${picnum}.png`);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    tileCache.set(picnum, t);
  }
  return t;
};

const fpAnimator = new FpWeaponAnimator(
  camera,
  animBundle.weapons as Record<string, QavManifest>, // type coerce: index.json only contains QAV entries in weapons
  animBundle.tileMeta,
  getTileTexture,
);
fpAnimator.play('dynamite-idle', performance.now() / 1000);

// Include fpAnimator in FrameCtx each tick:
//   ctx = { ..., fpAnimator };

// In the render loop, after fixed step:
fpAnimator.update(performance.now() / 1000);
```

**Tile PNG availability:** Verify that `public/assets/blood-tiles/<picnum>.png` exists for all tiles referenced in dynamite manifests. If not, extend `scripts/extract_blood_sprites.py` to dump by picnum into that directory, or add a new extraction pass. Document any missing tiles in commit message.

- [ ] **Step 7: Delete `src/vfx/fp-weapon.ts`**

```bash
cd /Users/donny/Projects/blud
git rm src/vfx/fp-weapon.ts
```

- [ ] **Step 8: Type-check + build**

Run:
```bash
cd /Users/donny/Projects/blud
npx tsc --noEmit
npm run build
```
Expected: both clean. Fix any import errors from the deletion of `fp-weapon.ts`.

- [ ] **Step 9: Run full test suite**

Run: `cd /Users/donny/Projects/blud && npm test`
Expected: all tests PASS (including existing Dynamite tests).

- [ ] **Step 10: Manual playtest**

```bash
cd /Users/donny/Projects/blud
npm run dev
```

In the browser:
1. Click into the arena (pointer lock).
2. Hold LMB to cook dynamite. The lighter hand + flame should animate **without the flame scaling up weirdly** — each layer sized from its real tile dimensions.
3. Release → throw animation plays once, then returns to idle.
4. Cook past 3 seconds → self-explode. Idle returns.

If the layer positions look off, tune `anchorY` and `pixelsPerUnit` in `FpWeaponAnimator`. If any layer is missing, check browser console for `FpWeaponAnimator: unknown animation` or `getTexture` 404s.

- [ ] **Step 11: Commit**

```bash
git add src/animation/manifest-loader.ts src/animation/fp-weapon-animator.ts src/engine/asset-loader.ts src/game/weapons/dynamite.ts src/game/weapons/types.ts src/main.ts
git rm src/vfx/fp-weapon.ts
git commit -m "feat(animation): FpWeaponAnimator + swap dynamite view

Dynamite FPV now driven by extracted QAV manifests. Each QAV layer gets
its own correctly-sized quad positioned via per-frame offset — fixes the
lighter-flame scaling glitch. FSM unchanged; only the display coupling
moved from inline getAnimState to animator.play() calls.

Deletes src/vfx/fp-weapon.ts (hand-picked frame lists superseded)."
```

---

## Task 6: `BillboardAnimator` + angle pick + AxeZombie swap

**Files:**
- Create: `src/animation/billboard-angle.ts`
- Create: `src/animation/billboard-angle.test.ts`
- Create: `src/animation/billboard-animator.ts`
- Modify: `src/game/enemy/axe-zombie.ts` — replace hand-picked frame helpers.
- Modify: `src/game/enemy/ai.ts` — `ZombieBrain` calls `billboardAnimator.play(...)`.
- Modify: `src/engine/asset-loader.ts` — delete `loadZombieAtlas` + `ZombieTextureAtlas`.

**Context:** World-space billboard with view-angle variant pick. SEQ manifests declare `baseTile` + `angleStride` + per-frame `tileOffset`. Runtime resolves `texture = baseTile + tileOffset * angleStride + v`, where `v ∈ [0..angleStride-1]` depends on the relative angle from camera to sprite's facing direction.

**Angle-pick math (5-rotation Blood convention):** For a 5-stride sprite, the 5 variants cover:
- v=0: front (facing camera, 0° ± 36°)
- v=1: front-right (about 72°)
- v=2: right side (about 144°)
- v=3: back-right (about 216°) — or rendered by flipping v=1
- v=4: back (180°)

In classic Blood rendering, only 5 distinct tile variants exist — the other 3 cardinal directions reuse these with horizontal flip. Implement: compute signed angle `θ` between sprite-facing and camera-to-sprite vector, normalize to `[0, 2π)`, then pick `v = round(θ / (2π) * 8) % 8`, with `v ∈ {5,6,7}` mapping back via `v = 8 - v` + `flipX=true`.

- [ ] **Step 1: Write `src/animation/billboard-angle.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pickAngleVariant } from './billboard-angle';

/** Helper: create a unit-length Vec2 at angle θ (radians, CCW from +X). */
const vec2 = (theta: number) => ({ x: Math.cos(theta), y: Math.sin(theta) });

describe('pickAngleVariant (angleStride=5)', () => {
  const stride = 5;

  it('camera in front of sprite → variant 0, no flip', () => {
    // Sprite at origin facing +X (1, 0). Camera in front = along +X side from sprite.
    const r = pickAngleVariant(
      { x: 10, y: 0 },      // camera pos
      { x: 0, y: 0 },       // sprite pos
      { x: 1, y: 0 },       // sprite facing
      stride,
    );
    expect(r.variant).toBe(0);
    expect(r.flipX).toBe(false);
  });

  it('camera behind sprite → variant 4 (back), no flip', () => {
    const r = pickAngleVariant(
      { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(4);
    expect(r.flipX).toBe(false);
  });

  it('camera to left → variant 2 (side), no flip', () => {
    const r = pickAngleVariant(
      { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(2);
    expect(r.flipX).toBe(false);
  });

  it('camera to right → variant 2 (side), flipX=true', () => {
    const r = pickAngleVariant(
      { x: 0, y: -10 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(2);
    expect(r.flipX).toBe(true);
  });
});

describe('pickAngleVariant (angleStride=1)', () => {
  it('always returns variant 0 regardless of angle', () => {
    const r = pickAngleVariant(
      { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1,
    );
    expect(r.variant).toBe(0);
    expect(r.flipX).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/billboard-angle.test.ts`

- [ ] **Step 3: Implement `src/animation/billboard-angle.ts`**

```ts
export interface Vec2 { x: number; y: number; }

export interface AngleVariant {
  variant: number;   // 0 .. Math.floor(stride/2)
  flipX: boolean;    // mirror horizontally
}

/**
 * Pick the sprite-rotation variant for a billboard sprite.
 *
 * Blood encodes 5 visual variants (for angleStride=5) covering front,
 * front-side, side, back-side, back. The 8 cardinal directions render by
 * reusing 5 variants + horizontal flip for the right-side directions.
 *
 * Math: compute θ = signed angle between sprite-facing and the
 * sprite-to-camera vector (CCW positive). Normalize to [0, 2π). Bucket
 * into 8 sectors (45° each). Sectors 0/1/2/3/4 map directly to
 * variants 0/1/2/3/4. Sectors 5/6/7 map back to variants 3/2/1 with
 * flipX=true (mirror of their counterparts on the left side).
 *
 * For angleStride=1: always return {variant:0, flipX:false}.
 */
export function pickAngleVariant(
  cameraPos: Vec2,
  spritePos: Vec2,
  spriteFacing: Vec2,
  angleStride: number,
): AngleVariant {
  if (angleStride <= 1) return { variant: 0, flipX: false };
  // Only handle the standard 5-stride Blood case explicitly. Other strides
  // fall back to no flip + modulo (documented limitation).
  if (angleStride !== 5) {
    const n = angleStride;
    const toCam = { x: cameraPos.x - spritePos.x, y: cameraPos.y - spritePos.y };
    const facingTheta = Math.atan2(spriteFacing.y, spriteFacing.x);
    const toCamTheta = Math.atan2(toCam.y, toCam.x);
    const raw = ((toCamTheta - facingTheta) + Math.PI * 2) % (Math.PI * 2);
    const variant = Math.floor((raw / (Math.PI * 2)) * n) % n;
    return { variant, flipX: false };
  }

  const toCam = { x: cameraPos.x - spritePos.x, y: cameraPos.y - spritePos.y };
  const facingTheta = Math.atan2(spriteFacing.y, spriteFacing.x);
  const toCamTheta = Math.atan2(toCam.y, toCam.x);
  const delta = ((toCamTheta - facingTheta) + Math.PI * 2) % (Math.PI * 2);
  // 8 sectors of 45° starting with sector 0 centered on 0° (shift by π/8)
  const sector = Math.floor(((delta + Math.PI / 8) % (Math.PI * 2)) / (Math.PI / 4));
  // sector → (variant, flip)
  const table: Array<[number, boolean]> = [
    [0, false], // 0°    — front
    [1, false], // 45°   — front-left (+y)
    [2, false], // 90°   — left side
    [3, false], // 135°  — back-left
    [4, false], // 180°  — back
    [3, true],  // 225°  — back-right (mirror of back-left)
    [2, true],  // 270°  — right side
    [1, true],  // 315°  — front-right
  ];
  const [variant, flipX] = table[sector % 8]!;
  return { variant, flipX };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd /Users/donny/Projects/blud && npx vitest run src/animation/billboard-angle.test.ts`

- [ ] **Step 5: Implement `src/animation/billboard-animator.ts`**

```ts
import * as THREE from 'three';
import type { SeqManifest, TileMetaMap } from './qav-schema';
import type { TileTextureGetter } from './fp-weapon-animator';
import { pickFrameIndex } from './animator';
import { pickAngleVariant } from './billboard-angle';

export class BillboardAnimator {
  private mesh: THREE.Mesh;
  private currentAnim: SeqManifest | null = null;
  private playbackStart = 0;

  constructor(
    private characterAnims: Record<string, SeqManifest>,
    private tileMeta: TileMetaMap,
    private getTexture: TileTextureGetter,
    scale = 1.8,
  ) {
    const geom = new THREE.PlaneGeometry(scale * 0.75, scale);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.1 });
    this.mesh = new THREE.Mesh(geom, mat);
  }

  /** The mesh to add to the scene (attach to a parent Object3D that follows
   * the dude's Rapier body position). */
  get object(): THREE.Mesh { return this.mesh; }

  play(name: string, nowSec: number): void {
    const anim = this.characterAnims[name];
    if (!anim) {
      console.warn(`BillboardAnimator: unknown animation "${name}"`);
      return;
    }
    if (this.currentAnim?.name === name) return;
    this.currentAnim = anim;
    this.playbackStart = nowSec;
  }

  /** Update. Call per render frame.
   *  @param spritePos world position of the sprite (xz plane)
   *  @param spriteFacing unit vector in xz for the sprite's current facing
   *  @param cameraPos world position of the camera (xz)
   */
  update(
    nowSec: number,
    spritePos: { x: number; y: number; z: number },
    spriteFacing: { x: number; z: number },
    cameraPos: { x: number; y: number; z: number },
  ): void {
    const anim = this.currentAnim;
    if (!anim) { this.mesh.visible = false; return; }

    const elapsedMs = (nowSec - this.playbackStart) * 1000;
    const idx = pickFrameIndex(anim.frames, elapsedMs, anim.loop);
    const frame = anim.frames[idx]!;
    const tileOffset = (frame as { tileOffset: number }).tileOffset;

    const { variant, flipX } = pickAngleVariant(
      { x: cameraPos.x, y: cameraPos.z },
      { x: spritePos.x, y: spritePos.z },
      { x: spriteFacing.x, y: spriteFacing.z },
      anim.angleStride,
    );

    const picnum = anim.baseTile + tileOffset * anim.angleStride + variant;
    const tex = this.getTexture(picnum);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }

    this.mesh.scale.x = Math.abs(this.mesh.scale.x) * (flipX ? -1 : 1);
    // Billboard: face the camera on the Y axis.
    this.mesh.position.set(spritePos.x, spritePos.y, spritePos.z);
    this.mesh.lookAt(cameraPos.x, spritePos.y, cameraPos.z);
    this.mesh.visible = true;
  }
}
```

- [ ] **Step 6: Update `src/game/enemy/axe-zombie.ts` and `src/game/enemy/ai.ts`**

Replace the `ZombieTextureAtlas` usage with a `BillboardAnimator` field. The `AxeZombie` constructor takes a `BillboardAnimator` instance (shared or per-zombie is fine). On AI state transitions, call `billboardAnimator.play('zombie-<state>', now)`.

Mapping from AI states → SEQ names (from Task 2 extraction):
- `idle` → `zombie-idle`
- `chase` → `zombie-walk` (or `zombie-chase` if extracted separately)
- `attack` (windup + swing) → `zombie-attack`
- `stagger` → `zombie-stagger`
- `dead` → `zombie-death` (or a specific variant on-hit type; for M2 the normal death is fine)

Each frame, `AxeZombie.render(now, cameraPos)` calls:
```ts
this.billboardAnimator.update(now, this.rigidBody.translation(), this.facing, cameraPos);
```
where `this.facing` is a unit Vec2 in `xz` derived from the zombie's current velocity or target direction.

Concrete edits:

```ts
// src/game/enemy/axe-zombie.ts — replace texture-atlas based rendering

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BillboardAnimator } from '../../animation/billboard-animator';

export class AxeZombie implements GibbableDude {
  readonly body: RAPIER.RigidBody;
  private anim: BillboardAnimator;
  private facing = { x: 0, z: 1 };
  // ... other fields unchanged

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    position: { x: number; y: number; z: number },
    anim: BillboardAnimator,
  ) {
    // ... existing body + collider setup
    this.anim = anim;
    scene.add(this.anim.object);
    this.anim.play('zombie-idle', 0);
  }

  setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  onStateEnter(state: 'idle' | 'chase' | 'attack' | 'stagger' | 'dead', now: number): void {
    const map = { idle: 'zombie-idle', chase: 'zombie-walk', attack: 'zombie-attack', stagger: 'zombie-stagger', dead: 'zombie-death' };
    this.anim.play(map[state], now);
  }

  render(now: number, cameraPos: { x: number; y: number; z: number }): void {
    const t = this.body.translation();
    this.anim.update(now, t, this.facing, cameraPos);
  }

  // ... existing damage/takeImpulse/etc methods unchanged
}
```

```ts
// src/game/enemy/ai.ts — update ZombieBrain state-change callback

// Where ZombieBrain transitions states, call this.zombie.onStateEnter(newState, now)
// and this.zombie.setFacing(desiredVelocityDirection).
```

- [ ] **Step 7: Remove `loadZombieAtlas` + `ZombieTextureAtlas` from `src/engine/asset-loader.ts`**

Delete the `loadZombieAtlas` function and the `ZombieTextureAtlas` import. The zombie no longer needs a pre-built atlas — it uses `getTileTexture(picnum)` like the FP weapon.

- [ ] **Step 8: Wire `BillboardAnimator` in `src/main.ts`**

For the M2 `ZombieCluster`, each cluster zombie gets its own `BillboardAnimator` instance (or one shared instance per unique animation set — but separate per zombie is simpler for per-zombie angle pick). Pass it to the `AxeZombie` constructor.

```ts
// src/main.ts — in ZombieCluster spawn loop or equivalent
const zombieAnim = new BillboardAnimator(
  animBundle.characters as Record<string, SeqManifest>,
  animBundle.tileMeta,
  getTileTexture,
);
const zombie = new AxeZombie(world, scene, pos, zombieAnim);
```

In the render loop, each zombie's `render(now, camera.position)` is called.

- [ ] **Step 9: Update any existing tests for `AxeZombie` and `ZombieBrain`**

The AI FSM tests (`src/game/enemy/ai.test.ts`) test pure state logic. They keep passing — no animation coupling in those tests. Verify:

Run: `cd /Users/donny/Projects/blud && npx vitest run src/game/enemy/`
Expected: all tests PASS.

- [ ] **Step 10: Type-check + build**

```bash
cd /Users/donny/Projects/blud
npx tsc --noEmit
npm run build
```
Fix any import/type errors.

- [ ] **Step 11: Full test suite**

```bash
cd /Users/donny/Projects/blud && npm test
```
Expected: all tests PASS.

- [ ] **Step 12: Manual playtest**

```bash
npm run dev
```

In the browser:
1. Spawn into arena.
2. Strafe around a zombie. Its sprite should rotate through variants as your viewing angle changes (front → side → back).
3. Approach it — attack animation plays on contact. Explode it with dynamite — death animation plays once and holds.
4. Walk-cycle frames should advance while it's chasing.

If a zombie renders as all-the-same-frame from every angle, either `angleStride` is stuck at 1 (check manifest) or `setFacing` isn't wired up to AI (check `ai.ts`).

- [ ] **Step 13: Commit**

```bash
git add src/animation/billboard-angle.ts src/animation/billboard-angle.test.ts src/animation/billboard-animator.ts src/game/enemy/ src/engine/asset-loader.ts src/main.ts
git commit -m "feat(animation): BillboardAnimator + swap axe-zombie

Zombie rendering now driven by extracted SEQ manifests with proper
angle-variant pick (5-rotation Blood convention: 5 tiles + mirror for
the right-side 3 directions). Replaces approximate hand-picked frame
lists from A5. AI FSM drives animation via onStateEnter() calls.

Removes ZombieTextureAtlas + loadZombieAtlas (superseded)."
```

---

## Task 7: Integration sweep + docs + TASKS.md

**Files:**
- Create: `docs/dev-notes/2026-04-21-animation-system.md`
- Modify: `TASKS.md`

**Context:** Final cleanup. Write a schema reference that someone authoring new animation JSON by hand can read. Flip task-board entries. Verify no orphan code.

- [ ] **Step 1: Write `docs/dev-notes/2026-04-21-animation-system.md`**

Contents:
- Overview: QAV vs SEQ, what each is used for.
- Schema quick reference: compact versions of the three JSON shapes (tile-meta, QAV, SEQ) with all fields explained.
- "How to port a new Blood animation": grep NotBlood source for QAV/SEQ ID, run `python -m scripts.extract_{qav,seq} ... --ids N`, verify, hand-correct `loop`, run `build_animation_index`.
- "How to hand-author a custom animation": create JSON in the same schema at the right path, add entries in `tiles-meta.json` for any custom tiles (map their picnum → w/h/ox/oy), run `build_animation_index`, validator catches typos at boot.
- Known limitations: per-frame events deferred, palookup not implemented, QAV `stat` flags parsed but ignored, angle-stride >5 untested.
- Where to edit animator calibration constants: `BLOOD_VIEW_W/H`, `anchorY`, `pixelsPerUnit` in `fp-weapon-animator.ts`.

- [ ] **Step 2: Update `TASKS.md`**

```md
# Diff (conceptually):
# - `A5`  [x]  → keep [x] but add a note: "M3 supersession: new animation system replaces approximate segmentation."
# - `A6.5` [ ]  → flip to [x]: "Superseded by animation system (2026-04-21), see A10."
# + `A10` [x]  Animation system port (QAV + SEQ) — see docs/superpowers/plans/2026-04-21-blud-animation-system.md
# + Under "Current focus": note M2 playtest unblocked; animation system landed as preparatory work for M3.
```

- [ ] **Step 3: Grep for dead code**

Run:
```bash
cd /Users/donny/Projects/blud
grep -rn "FpWeaponView\|ZombieTextureAtlas\|loadZombieAtlas\|DynAnimState\|getAnimState\|getAnimElapsedSec" src/
```
Expected: no hits (all removed). If any orphan reference remains, delete it.

- [ ] **Step 4: Full verification**

```bash
cd /Users/donny/Projects/blud
npx tsc --noEmit
npm run build
npm test
python -m pytest scripts/tests/ -v
```
Expected: everything green.

- [ ] **Step 5: Manual playtest — final sanity pass**

- Dynamite FPV looks right (no flame scaling glitch).
- Zombie billboard rotates with view angle.
- Walk, attack, death animations all play through cleanly.
- Performance unchanged (no new GC pressure from the animator).

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-04-21-animation-system.md TASKS.md
git commit -m "docs: animation system reference + TASKS.md update

Schema reference for hand-authoring new animation JSON, plus instructions
for porting additional Blood animations. A5 kept as [x] with supersession
note; A6.5 flipped to [x]; A10 added for the animation system itself."
```

---

## Self-review notes (pre-execution)

- **Spec coverage:**
  - Goal 1 (fix scaling glitch) — Task 5 (FpWeaponAnimator sizes each layer from real tile dims).
  - Goal 2 (zombie angle variants) — Task 6 (BillboardAnimator + pickAngleVariant).
  - Goal 3 (data-driven pipeline) — Tasks 1-2 produce JSON + tile-meta; Task 3 validates; Task 7 documents.
  - Goal 4 (FSM owns state) — Tasks 5 and 6 keep FSMs intact; only display coupling changes.
  - Non-goals respected: schema reserves `events?` but runtime ignores (Task 3 schema); palookup/`stat` flags parsed but unused (Task 1); no M4 weapons extracted.
- **Type consistency:** `TileTextureGetter` defined in `fp-weapon-animator.ts`, imported by `billboard-animator.ts` — same signature. `AnimationBundle` / `AnimationManifest` / `QavManifest` / `SeqManifest` / `TileMetaMap` names consistent across tasks.
- **Calibration-dependent task:** Task 5 Step 6 has tuning values (`anchorY`, `pixelsPerUnit`) that are initial estimates. The plan is explicit that manual playtest drives final values. This is appropriate for placeholder assets.
- **Risks surfaced in-plan:** Task 1 Step 2 flags "struct layouts must be transcribed from NotBlood source"; Task 2 Step 7 flags "hand-correct loop flags per animation semantics"; Task 6 angle-math falls back to no-flip for non-5 strides with a documented limitation.
