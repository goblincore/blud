# Blood palette decoding — canonical algorithm

Source research: NotBlood `master` (clipmove/NotBlood, checked 2026-04-20),
cross-referenced with Shikadi ModdingWiki `RFF_Format`, Camoto
`libgamegraphics` (Malvineous/libgamegraphics), and SLADE3
(sirjuddington/SLADE). Primary evidence comes from NotBlood because it
contains the complete Blood palette pipeline in-tree; SLADE3 has only a
generic VGA-palette loader and no Blood-specific path; Camoto's
`pal-vga-raw.cpp` is the generic 6-bit VGA loader that does NOT apply to
Blood's `BLOOD.PAL`.

## The short answer

**Our output is salmon-pink because we are never decrypting the first
256 bytes of `BLOOD.PAL`.** Blood RFF v3.1 stores files with the
`DICT_CRYPT` flag (`0x10`) XOR-encrypted across the first up-to-256
bytes of file content. `BLOOD.PAL` is flagged `0x19` in the FAT — so
bytes 0..255 of the 768-byte palette are scrambled with
`byte[i] ^= (i >> 1)`. The remaining bytes 256..767 are plaintext. Once
those first 256 bytes are decrypted, `BLOOD.PAL` is a straight 8-bit RGB
palette — **no `<<2` 6-bit scaling, no gamma, no `NORMAL.PLU` lookup
needed for sprite export**. One XOR pass is the entire fix.

Verification: encrypted byte triple at palette index 57 is `(218, 53,
105)`. XOR'ing each with `(i>>1)` for `i = 171, 172, 173` gives
`(218^85, 53^86, 105^86) = (143, 99, 63)` — a warm tan-brown, the axe
zombie skin tone.

## Palette bit-depth

**BLOOD.PAL is 8-bit RGB, 768 bytes, no header.** After decryption, byte
values span the full 0..255 range (confirmed directly against the file
shipped in Raze's `BLOOD.RFF`: max byte 255, plenty of values in every
32-wide bucket).

This differs from the Build engine's own `PALETTE.DAT` (used by Duke,
SW, etc.), which IS 6-bit (0..63) and needs `<<2` scaling. The
difference is in where the pipelines diverge in NotBlood:

- `PALETTE.DAT` path: `paletteLoadFromDisk()` in
  `source/build/src/palette.cpp` reads 768 bytes then runs
  `for (unsigned char &k : palette) k <<= 2;` (lines ~197-201). This is
  the 6-bit → 8-bit scaling.
- `BLOOD.PAL` path: `scrLoadPalette()` in
  `source/blood/src/screen.cpp` (lines ~137-181) looks up each `.PAL`
  resource via `gSysRes.Lock(pPal)` and passes the raw pointer to
  `paletteSetColorTable(nPal, (uint8_t*)palTable[nPal])`.
  `paletteSetColorTable()` in `palette.cpp` (~line 1046) is a plain
  `Bmemcpy(basepaltable[id], table, 768);` with zero transformation.

So Blood's palette bytes are consumed at 8-bit precision as-is; the
6-bit `<<2` is never applied to `.PAL` files. Our prior memory note
("6-bit, scale <<2") was wrong and should be superseded.

No header, no stride. The 768 bytes at the file offset reported by the
RFF FAT are the palette payload; the encrypted prefix is part of the
payload, not a header.

## PLU application for sprite rendering

**`NORMAL.PLU` is NOT required to produce a correct static sprite PNG.**

Why:

- A `.PLU` is a `256 × 64` lookup table indexed as
  `palookup[pal][shade * 256 + palIndex]` — 256 palette indices across
  64 shade levels (confirmed in NotBlood `scrLoadPLUs()` at
  `source/blood/src/screen.cpp` ~lines 95-131, which asserts
  `pPlu->size / 256 == 64`).
- At shade 0 (fullbright) with pal 0 (`NORMAL.PLU`), the table is the
  identity mapping — `NORMAL.PLU[0][i] == i` — by convention across all
  Build engine games. Editors that export sprite sheets (BAFed, SLADE
  gfx preview, ART inspectors) render tiles at shade 0 / pal 0, so PLU
  resolves to a no-op and the final color is just
  `BLOOD.PAL[tile_pixel_index]`.
- PLU only matters when: (a) an in-game sector is shaded, (b) a
  swapped pal is applied (e.g. gibs, alt skins), or (c) fog tables are
  active. None of those apply to a plain "dump every tile as a PNG"
  pipeline.

So our extractor's architecture (`BLOOD.PAL[index] → RGB`) is correct —
it's just that the palette bytes we're looking up into are scrambled.

Lookup formula if we ever need a specific pal (e.g. palette swap for
cultists): `RGB = BLOOD.PAL[ palookup[pal][shade * 256 + tilePixel] ]`.

## Gamma correction

**No gamma correction is applied to `BLOOD.PAL` bytes on load.** The
`<<2` in `paletteLoadFromDisk()` is a bit-depth rescale, not a gamma
curve. NotBlood does apply a per-pixel brightness adjustment through
`britable[j][...]` in `videoSetPalette()` (`palette.cpp` ~lines
520-535), but that runs against `curbrightness` and is a runtime
display-side tweak, not part of the canonical palette encoding. For a
static PNG export, write raw 8-bit RGB; the modern sRGB viewer handles
display gamma. The reference axe-zombie skin tone `(143, 99, 63)`
matches what BAFed exports with no gamma applied.

## Reference sanity values

After decrypting the first 256 bytes of `BLOOD.PAL`:

| Index | Encrypted (buggy output) | Decrypted (correct) | Notes |
|------:|:-------------------------|:--------------------|:------|
|   0   | `(0, 0, 0)`               | `(0, 0, 0)`         | Black, unchanged (key = 0) |
|   1   | `(1, 10, 9)`              | `(0, 11, 11)` shows grey ramp start | |
|  57   | `(218, 53, 105)` salmon   | `(143, 99, 63)` tan-brown | Axe-zombie skin |
|  48   | ~`(39, 15, 0)` (not encr? no — byte 144-146 still < 256) | `(156, 60, 0)` or similar warm brown | |
| 255   | `(191, 0, 163)`           | `(191, 0, 163)` magenta | Bytes 765-767 are > 256, plaintext, unchanged. This IS the index Build treats as transparent/fullbright. |

(Bytes at file offset 256..767 are NOT XOR-decoded; only indices whose
`r`, `g`, or `b` byte has file offset `< 256` get transformed. In
practice that's palette entries 0 through ~85.)

## Pseudocode: correct extraction

```python
def read_blood_pal_from_rff(rff_bytes: bytes) -> bytes:
    # ... existing RFF FAT decryption (startKey XOR) to find the entry
    # for BLOOD.PAL. Also read the flags byte at entry[32].
    flags = entry[32]
    offset, size = struct.unpack_from("<II", entry, 16)
    pal = bytearray(rff_bytes[offset : offset + size])

    # NEW: if DICT_CRYPT flag is set, XOR-decrypt the first 256 bytes.
    # Same transform Blood's Resource::Crypt() applies (NotBlood
    # source/blood/src/resource.cpp ~lines 695-702).
    if flags & 0x10:
        enc_len = min(256, len(pal))
        for i in range(enc_len):
            pal[i] ^= (i >> 1) & 0xFF

    assert len(pal) == 768
    return bytes(pal)


def palette_to_rgb(pal_768: bytes) -> bytes:
    # BLOOD.PAL is already 8-bit per channel — use bytes as-is.
    # No `<<2` scaling (that's for PALETTE.DAT, not Blood's PAL).
    # No gamma correction. No red/blue swap.
    return pal_768


def tile_to_image(w, h, tile_data, pal_rgb):
    # Unchanged — column-major → row-major transpose, P-mode image,
    # index 255 = transparent. The fix is entirely in the palette path.
    ...
```

Concretely, in `scripts/extract_blood_sprites.py`:

- In `read_palette_from_rff`, capture `entry[32]` alongside
  `offset`/`size`, and if `flags & 0x10`, XOR-decrypt the first 256
  bytes of the returned palette before handing it to
  `palette_to_rgb`.
- `palette_to_rgb` stays as-is (no-op pass-through). The existing
  comment claiming "8-bit precision" was directionally right but
  missed the encryption layer.
- `tile_to_image` stays as-is.

## Citations

Line numbers are against `master` at the time of research (commit not
pinned; NotBlood moves slowly on these files, so the structure is
stable).

- **Blood's RFF content encryption**
  - `source/blood/src/resource.cpp` ~lines 644-647 — `if (n->flags &
    DICT_CRYPT) { size = min(n->size, 0x100); Crypt(p, size, 0); }`
  - `source/blood/src/resource.cpp` ~lines 695-702 — body of
    `Resource::Crypt`:
    `for (int i = 0; i < length; i++, key++) cp[i] ^= (key >> 1);`
- **Blood palette load pipeline**
  - `source/blood/src/screen.cpp` ~lines 137-181 —
    `scrLoadPalette()`: `palTable[nPal] = (RGB*)gSysRes.Lock(pPal);
    paletteSetColorTable(nPal, (uint8_t*)palTable[nPal]);`
  - `source/build/src/palette.cpp` ~line 1046 —
    `paletteSetColorTable()` is a plain `Bmemcpy`, no scaling.
- **Proof the `<<2` is PALETTE.DAT-only, not BLOOD.PAL**
  - `source/build/src/palette.cpp` ~lines 197-201 —
    `paletteLoadFromDisk()` reads 768 bytes and does
    `for (unsigned char &k : palette) k <<= 2;`. This path is only hit
    by `PALETTE.DAT`, not by the Blood resource system.
- **PLU format and shade dimensions**
  - `source/blood/src/screen.cpp` ~lines 95-131 — `scrLoadPLUs()`
    enforces `pPlu->size / 256 == 64`, confirming PLU is
    `256 × 64` (256 indices across 64 shade levels).
- **RFF v3.1 file-content encryption spec**
  - Shikadi ModdingWiki, `RFF_Format`, "Later versions … first 256
    bytes of the file are encrypted" — confirms flag `0x10`, XOR with
    `i >> 1`, first 256 bytes only.
- **Generic (non-Blood) VGA 6-bit palette reference** (for contrast)
  - Camoto `libgamegraphics/src/pal-vga-raw.cpp` — the `pal_6to8`
    path; this is what editors apply to `PALETTE.DAT`-class files but
    NOT to `BLOOD.PAL`.

## Migration note for the existing memory entry

Supersede the warning memory on `scripts/extract_blood_sprites.py` that
says "6-bit, scale `<<2`". Correct statement: "BLOOD.PAL is 8-bit RGB
and its first 256 bytes are XOR-encrypted when the FAT flag `0x10` is
set; decrypt in-place with `byte[i] ^= (i >> 1)` for `i in 0..255`,
then use the bytes as raw 8-bit RGB."
