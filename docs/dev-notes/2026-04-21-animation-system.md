# Animation System — QAV + SEQ Port

> Date: 2026-04-21
> Milestone: Pre-M3 preparatory work; replaces approximate frame segmentation with data-driven Blood animation manifests.

---

## Overview

Blood uses two animation formats:

| Format | Used for | Structure | Source |
|--------|----------|-----------|--------|
| **QAV** | First-person weapon view (multi-layer camera-space sprites) | Up to 8 layers per frame, each with tile picnum + pixel offset + scale | `BLOOD.RFF` → QAV resource entries |
| **SEQ** | Character/world sprites (billboard with angle variants) | Single tile per frame, plus `baseTile + tileOffset × angleStride + variant` addressing | `BLOOD.RFF` → SEQ resource entries |

Both are extracted offline by Python CLIs into JSON manifests. The runtime (`src/animation/`) is pure display — no FSM logic. Game code calls `animator.play("name", now)` on state entry.

---

## Schema Quick Reference

### tiles-meta.json

Per-tile dimensions and origin offset. Shared by both QAV and SEQ manifests. Keyed by picnum (as string).

```jsonc
{
  "3192": { "w": 64, "h": 48, "ox": 0, "oy": 0 },
  "4096": { "w": 5,  "h": 11, "ox": 0, "oy": 0 }
  // ...4417 entries
}
```

| Field | Type | Description |
|-------|------|-------------|
| `w` | number | Tile width in pixels |
| `h` | number | Tile height in pixels |
| `ox` | number | Draw origin X offset (pixels) |
| `oy` | number | Draw origin Y offset (pixels) |

### QAV Manifest (e.g. `weapons/dynamite-idle.json`)

Multi-layer weapon-view animation. Each frame has up to 8 independently positioned layers.

```jsonc
{
  "name": "dynamite-idle",
  "kind": "qav",
  "loop": true,
  "nFrames": 6,
  "frames": [
    {
      "durMs": 42,
      "layers": [
        { "tile": 3192, "ox": 63,  "oy": -17, "scale": 1.0, "flipX": false },
        { "tile": 3194, "ox": 11,  "oy": -66, "scale": 1.0, "flipX": false }
        // ...up to 8 layers
      ]
    }
    // ...more frames
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique animation name (used as lookup key) |
| `kind` | `"qav"` | Discriminator |
| `loop` | boolean | `true` = wrap; `false` = hold last frame |
| `nFrames` | number | Frame count (redundant, kept for validation) |
| `frames[].durMs` | number | Frame duration in milliseconds (must be > 0) |
| `frames[].layers[].tile` | number | Picnum — must exist in `tiles-meta.json` |
| `frames[].layers[].ox` | number | X offset from viewport center-bottom (pixels) |
| `frames[].layers[].oy` | number | Y offset from viewport center-bottom (pixels, +up) |
| `frames[].layers[].scale` | number | Scale multiplier (typically 1.0) |
| `frames[].layers[].flipX` | boolean? | Mirror horizontally (optional, defaults false) |

### SEQ Manifest (e.g. `characters/zombie-stand.json`)

Single-layer billboard animation with angle-variant addressing.

```jsonc
{
  "name": "zombie-stand",
  "kind": "seq",
  "loop": true,
  "baseTile": 1209,
  "angleStride": 5,
  "frames": [
    { "tileOffset": 0, "durMs": 133 },
    { "tileOffset": 1, "durMs": 133 }
    // ...
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique animation name |
| `kind` | `"seq"` | Discriminator |
| `loop` | boolean | `true` = wrap; `false` = hold last frame |
| `baseTile` | number | First tile picnum — must exist in `tiles-meta.json` |
| `angleStride` | number | Number of rotation variants per frame (Blood convention: 5 = front/F-L/L/B-L/B; right-side views use flipX) |
| `frames[].tileOffset` | number | Frame offset; actual picnum = `baseTile + tileOffset × angleStride + variant` |
| `frames[].durMs` | number | Frame duration in milliseconds (must be > 0) |

### index.json

Registry of all animations, split by category.

```jsonc
{
  "weapons": {
    "dynamite-idle": "weapons/dynamite-idle.json",
    "dynamite-throw": "weapons/dynamite-throw.json"
  },
  "characters": {
    "zombie-stand": "characters/zombie-stand.json",
    "zombie-chase": "characters/zombie-chase.json"
  }
}
```

Values are paths relative to `public/assets/animations/`.

---

## How to Port a New Blood Animation

### 1. Find the QAV or SEQ ID

Grep NotBlood source for the resource ID:

- **QAV**: Look in `weapon.cpp` for `kQav*` constants or the `processTNT`/`processShotgun` functions.
  - Example: QAV ID 20 = dynamite idle holding (from `weaponQav` assignment in `processTNT`).
- **SEQ**: Look in `aizombi.cpp` (or `dude.cpp` for general enemy) for `seqStartId` + offsets.
  - Example: Axe zombie `seqStartId=4352`, offset 8 → SEQ 4360 = chase.

### 2. Extract the manifest

```bash
# QAV (weapon view)
python3 -m scripts.extract_qav /path/to/BLOOD.RFF --out public/assets/animations/weapons --ids 20

# SEQ (character)
python3 -m scripts.extract_seq /path/to/BLOOD.RFF --out public/assets/animations/characters --ids 4360
```

### 3. Verify and hand-correct

- Open the output JSON and verify frames look reasonable (tile counts, durations).
- Check `loop`: the extractor infers loop from Blood's SEQ flags, but you may need to override. Idle/chase/walk animations are typically `true`; attack/death are typically `false`.
- Verify `baseTile` exists in `tiles-meta.json` (the extractor uses the raw picnum from the SEQ binary).

### 4. Rebuild the index

```bash
python3 -m scripts.build_animation_index
```

This scans `public/assets/animations/weapons/*.json` and `characters/*.json` and regenerates `index.json`.

### 5. Verify at boot

The runtime validator (`validateManifest` in `qav-schema.ts`) runs at load time. Any missing tile in `tiles-meta.json` or schema violation throws a `ManifestError` with the field path. Check browser console on load.

---

## How to Hand-Author a Custom Animation

Create a JSON file following the schema above.

1. **Create the manifest file** in `public/assets/animations/weapons/` or `characters/`:
   - Use `kind: "qav"` for multi-layer camera-space (FP weapons).
   - Use `kind: "seq"` for single-layer billboard (enemies, NPCs, props).

2. **Add tile metadata** for any custom tiles to `public/assets/animations/tiles-meta.json`:
   ```json
   "9999": { "w": 32, "h": 32, "ox": 0, "oy": 0 }
   ```

3. **Register in `index.json`**:
   ```json
   "weapons": {
     "my-weapon": "weapons/my-weapon.json"
   }
   ```

4. **Or** re-run `python3 -m scripts.build_animation_index` to auto-register all manifests.

5. **Use in code**: `animator.play("my-weapon", now)` — the manifest loader picks it up at boot.

The validator catches typos, missing tiles, and schema violations at load time.

---

## Animator Calibration Constants

These are in `src/animation/fp-weapon-animator.ts`:

| Constant | Default | Location | What it does |
|----------|---------|----------|-------------|
| `BLOOD_VIEW_W` | 320 | module top | Blood's reference viewport width (pixels) |
| `BLOOD_VIEW_H` | 200 | module top | Blood's reference viewport height (pixels) |
| `distance` | 0.6 | constructor opt | Camera-to-weapon render distance (world units) |
| `pixelsPerUnit` | 200 | constructor opt | Blood pixels → world-space scale factor |
| `anchorY` | -0.28 | constructor | Y offset so weapon hand sits at bottom-center of FOV |
| `MAX_LAYERS` | 8 | module top | Pre-allocated layer mesh count |

For billboard characters (`src/animation/billboard-animator.ts`):

| Constant | Default | Location | What it does |
|----------|---------|----------|-------------|
| `scale` | 1.8 | constructor param | Billboard height in world units (width = scale × 0.75) |

For angle-variant picking (`src/animation/billboard-angle.ts`):
- Only `angleStride=5` (Blood standard) uses the 8-sector lookup table with flipX mirroring.
- Other strides fall back to simple modulo bucketing without mirroring.

---

## File Map

```
src/animation/
  qav-schema.ts          — Type definitions + validateManifest()
  manifest-loader.ts     — loadAnimationManifests(): fetch + validate all JSON
  animator.ts            — pickFrameIndex(): shared frame-picking logic
  animator.test.ts       — 10 tests for pickFrameIndex
  fp-weapon-animator.ts  — FpWeaponAnimator: camera-space multi-layer QAV player
  billboard-animator.ts  — BillboardAnimator: world-space SEQ billboard player
  billboard-angle.ts     — pickAngleVariant(): 8-sector → 5-variant lookup
  billboard-angle.test.ts— 5 tests for angle picking
  qav-schema.test.ts     — 29 tests (schema validation)

public/assets/animations/
  tiles-meta.json        — 4417 tiles: picnum → {w,h,ox,oy}
  index.json             — Registry: name → relative path
  weapons/*.json         — QAV manifests (8 dynamite animations)
  characters/*.json      — SEQ manifests (12 axe-zombie animations)

scripts/
  extract_tile_meta.py   — ART → tiles-meta.json
  extract_qav.py         — BLOOD.RFF QAV → JSON manifest
  extract_seq.py         — BLOOD.RFF SEQ → JSON manifest
  build_animation_index.py — Scan + emit index.json
  rff_reader.py          — RFF v3.1 FAT reader (shared)
  qav_parser.py          — QAV binary parser (36-byte header + 204-byte frames)
  seq_parser.py          — SEQ binary parser (16-byte header + 8-byte SEQFRAME)
  art_meta.py            — ART picanm struct decoder
```

---

## Known Limitations

- **Per-frame events deferred**: QAV `events` and SEQ callback fields are parsed in the binary but the runtime ignores them. Future: sound triggers, projectile spawns, etc.
- **Palookup (palette remapping) not implemented**: All sprites render with the global palette. Blood uses palookup tables for team colors, pain flashes, etc.
- **QAV `stat` flags parsed but ignored**: Flags like full-bright, translucent are in the binary data but the renderer treats all layers as opaque.
- **angleStride > 5 untested**: Only the Blood-standard 5-variant stride uses the proper 8-sector lookup with mirroring. Other strides get a fallback modulo bucket without mirroring.
- **No animation blending**: Transitions between animations are instantaneous cuts. No crossfade or partial-blend support.
- **Single SEQ animation at a time per BillboardAnimator**: Can't layer two SEQs (e.g. walk + upper-body attack). Would need a compositor.
