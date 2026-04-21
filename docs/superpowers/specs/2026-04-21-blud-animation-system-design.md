# Blud — Animation System Port (QAV + SEQ)

**Date:** 2026-04-21
**Status:** approved for plan writing
**Supersedes:** ad-hoc hand-picked frame lists in `src/vfx/fp-weapon.ts`, `src/game/enemy/axe-zombie.ts`, and the approximate segmentation in `A5`/`A6.5` (see `TASKS.md`).

## Problem

The current M2 first-person dynamite view renders animation frames onto a **single fixed-size camera-space quad**. Blood's sprite tiles have **variable per-tile pixel dimensions** and **per-frame x/y offsets** baked into the QAV animation format. The lighter-flame tile in the cooking animation is larger than the lighter-hand tile, so it visibly scales up when shown on the same quad — the bug you see in-game today.

The axe-zombie billboards in `A5` suffer from the same class of problem: frames were segmented approximately from a flat tile range (1170–1258), without consulting the SEQ binary that encodes the real frame boundaries, durations, or the 5-rotation angle-variant layout that Blood uses for view-direction sprites.

Rather than patching these one animation at a time, we port the source-port animation system properly. Outcome: any Blood animation becomes a straightforward extraction job, and (equally important) new custom art slots into the same JSON schema so graphics authored for the game work without code changes.

## Goals

1. Fix the dynamite FPV scaling glitch by representing animations with per-frame multi-layer tile composition — each layer sized from its real tile pixel dimensions + positioned with per-frame QAV offsets.
2. Replace the approximate zombie billboard segmentation with a correct SEQ port that includes proper view-angle direction handling (5-rotation variants).
3. Establish a data-driven pipeline such that adding a new Blood animation = one extraction script invocation, and adding a new custom animation = one hand-authored JSON file.
4. Keep the animator as pure display. Game FSMs (`Dynamite.ts`, `ZombieBrain`) continue to own state transitions.

## Non-goals (explicit deferrals)

- Per-frame event callbacks (sound cues, particle spawns, bullet emission). Schema reserves `frames[i].events?: string[]` for future use; runtime ignores it for now.
- Palookup (palette remap for damage flash, alt-color variants). Default palette only.
- QAV `stat` flag semantics (mirror, blend modes). Parse and store, runtime ignores.
- M4 weapon animations (revolver, double-wide, cursed phone). System supports them, but we port them during M4 when needed (~30 min extraction each).
- Physics/interaction-driven animation (hit reactions, IK, blended states). Explicitly out of scope per the design brief.

## Architecture

Three parts, clean separation.

### 1. Offline extraction (Python, `scripts/`)

Reads `BLOOD.RFF`, writes JSON + tile metadata into `public/assets/animations/`.

- `scripts/qav_parser.py` — decodes a QAV binary blob into a dict. Pure logic, no I/O.
- `scripts/seq_parser.py` — decodes a SEQ binary blob into a dict. Pure logic, no I/O.
- `scripts/extract_qav.py BLOOD.RFF --out ... [--only <name>]` — pulls QAV files out of the RFF, runs parser, emits JSON.
- `scripts/extract_seq.py BLOOD.RFF --out ... [--only <name>]` — same for SEQ.
- `scripts/extract_tile_meta.py BLOOD.RFF --out ...` — one-shot dump of per-tile `width`, `height`, anchor `xoffset`, `yoffset` from ART headers into `tiles-meta.json`. Runtime requires this to render tiles at their real pixel dimensions.
- `scripts/build_animation_index.py` — rebuilds `index.json` from whatever manifests exist on disk. Run after any extraction or hand-authored add.

Generated JSON files are **committed to git**. They are small (each animation is a few KB, tile-meta is tens of KB). Committing them makes the game self-contained — contributors don't need `BLOOD.RFF` to build or run.

The `.png` sprite pixel data stays gitignored (pre-existing rule, unchanged).

### 2. Runtime (TypeScript, `src/animation/`)

- `qav-schema.ts` — TS types for manifests + `validateManifest(json)`. Hand-rolled validator, no Zod dependency. Checks required fields, referenced tiles exist in `tiles-meta.json`, frame count ≥ 1, `durMs > 0`, `angleStride ≥ 1`. Throws with a clear error identifying the offending field.
- `animator.ts` — base frame ticker. Inputs: elapsed time, frame list, loop flag. Output: current frame index. Framework-free, fully unit-testable.
- `fp-weapon-animator.ts` — camera-space layer stack. Maintains one `THREE.Mesh` per QAV layer. Per tick: writes the current frame's tile texture + pixel offset to each mesh. Plane geometry sized from each tile's real `w/h` from `tiles-meta.json`. Pixel offsets converted to camera-space using viewport dimensions (so FPV scales with resolution).
- `billboard-animator.ts` — world-space billboard for characters. Per tick: picks frame from elapsed time, picks angle variant `v ∈ [0 .. angleStride-1]` from `atan2(cameraToSprite, spriteFacing)`, applies `baseTile + tileOffset * angleStride + v` as the current texture. Pure angle math is exported for unit testing.

### 3. Integration

- `Dynamite.ts` unchanged structurally. Where it currently holds an `animState` and exposes `getAnimState()`/`getAnimElapsedSec()`, it now calls `fpAnimator.play('dynamite-cook', { loop: true })` on state entry. State transitions still live in the FSM; the FSM decides *which* animation, the animator decides *how* to draw it.
- `AxeZombie` drops its hand-picked frame list; gets a `BillboardAnimator` instance and calls `play('zombie-walk', { loop: true })` / `play('zombie-attack', { loop: false })` on AI state transitions.
- `FpWeaponView` (`src/vfx/fp-weapon.ts`) is **deleted** after `Dynamite` swap. The hand-picked frame helpers in `axe-zombie.ts` are **deleted** after its swap. No parallel systems left behind.

## Data flow at runtime

```
boot   → asset-loader loads tile atlas + tiles-meta.json + animation manifests (from index.json)
state  → FSM.on('enter cooking') → animator.play('dynamite-cook', { loop: true })
tick   → animator.update(elapsedSec) → current frame index
         → fp-weapon-animator writes per-layer tile + offset to meshes
         → billboard-animator additionally picks angle variant from camera-vs-facing
```

## Schema

### `tiles-meta.json`

One file, generated once from ART headers. Maps picnum → per-tile info.

```json
{
  "1170": { "w": 48, "h": 64, "ox": 0,  "oy": -32 },
  "3205": { "w": 40, "h": 50, "ox": 0,  "oy": -25 },
  "3206": { "w": 28, "h": 60, "ox": 4,  "oy": -30 }
}
```

- `w`, `h` — tile pixel dimensions (variable; root cause of current bug).
- `ox`, `oy` — ART anchor offset (sprite is drawn offset from its logical origin).

### QAV manifest (weapon view)

One file per animation at `public/assets/animations/weapons/<name>.json`.

```json
{
  "name": "dynamite-cook",
  "kind": "qav",
  "loop": true,
  "nFrames": 4,
  "frames": [
    {
      "durMs": 50,
      "layers": [
        { "tile": 3192, "ox": 120, "oy": 180, "scale": 1.0, "flipX": false },
        { "tile": 3205, "ox": 80,  "oy": 200, "scale": 1.0, "flipX": false }
      ]
    }
  ]
}
```

- `layers` — up to 8 per frame (QAV supports 8). Each layer is one tile with its own screen-pixel offset. **This is the fix** — the lighter hand and flame become two correctly-sized layers composited at per-frame offsets, not resampled onto one quad.
- `ox`, `oy` — Blood-native screen pixel offsets (reference viewport 320×200) from a weapon-view anchor (center-bottom). Runtime converts to normalized camera-space per the active viewport.
- `scale`, `flipX` — optional; default `1.0` / `false`.

### SEQ manifest (character)

One file per animation at `public/assets/animations/characters/<name>.json`.

```json
{
  "name": "zombie-walk",
  "kind": "seq",
  "loop": true,
  "baseTile": 1170,
  "angleStride": 5,
  "frames": [
    { "tileOffset": 0, "durMs": 120 },
    { "tileOffset": 1, "durMs": 120 },
    { "tileOffset": 2, "durMs": 120 },
    { "tileOffset": 3, "durMs": 120 }
  ]
}
```

- `angleStride: 5` — 5 rotational variants per frame (Blood standard). Runtime picks `v ∈ [0..4]` from view angle, then resolves `baseTile + tileOffset * angleStride + v`.
- `angleStride: 1` — non-rotating sequence (e.g., death animations that view from a fixed angle).
- `tileOffset` — frame picnum offset from `baseTile`, 1:1 with SEQ binary.

### `index.json` (auto-generated)

```json
{
  "weapons": {
    "dynamite-idle":  "weapons/dynamite-idle.json",
    "dynamite-cook":  "weapons/dynamite-cook.json",
    "dynamite-throw": "weapons/dynamite-throw.json"
  },
  "characters": {
    "zombie-idle":   "characters/zombie-idle.json",
    "zombie-walk":   "characters/zombie-walk.json",
    "zombie-attack": "characters/zombie-attack.json",
    "zombie-death":  "characters/zombie-death.json"
  }
}
```

Asset-loader reads `index.json` once at boot and fetches referenced manifests.

## Binary formats (reference)

### QAV layout (from NotBlood `source/blood/src/qav.h`)

```
QAVHEADER   (32 bytes)
  magic          char[4]   "QAV\0"
  nFrames        uint16
  ticksPerFrame  uint16
  flags          uint32
  ...
QAVFRAME × nFrames
  nTiles         uint8
  pad[3]         uint8
  QAVTILE × 8                  (fixed array; unused slots have picnum = -1)
    picnum       int32
    stat         uint32
    ox           int16
    oy           int16
    z            int32         (scale, 65536 = 1.0)
    angle        int16
    ...
```

### SEQ layout (from NotBlood `source/blood/src/seq.h`)

```
SEQHEADER
  magic          char[4]      "SEQ\x1A"
  version        uint16
  nFrames        uint16
  flags          uint32
  ...
SEQFRAME × nFrames
  tile           uint16        (actually tile-offset; baseTile comes from header or ref)
  tileOffset     uint16
  ticks          uint16
  sound          uint16        (parsed and stored; runtime ignores in this task)
  ...
```

Both formats are uncompressed and unencrypted (unlike the palette). Parser is a straightforward `struct.unpack`.

**Format-version risk:** QAV/SEQ layouts can differ slightly between Blood releases (vanilla / Cryptic Passage / NotBlood). Mitigation: parser reads only the fields we consume; unknown flags are stored verbatim so we can triage later. The parser logs observed version + flag bits during extraction for diagnostics.

## Animations to port in this task

From NotBlood source:

- **Dynamite** (`source/blood/src/weapon.cpp` — `processTNT` at line ~2141). Inventory during extraction; expect ~4-6 QAVs covering idle / armed / cook / throw.
- **Axe zombie** (`source/blood/src/aizombi.cpp`). Expect ~8 SEQs: idle, chase, attack-windup, attack-swing, stagger/recoil, death-normal, death-gib, death-burn.

Exact file lists finalized in the implementation plan after browsing `BLOOD.RFF` contents.

## Error handling

- Schema validator runs on every manifest at boot. Failure = thrown `ManifestError` with file name + offending field. Game fails to start; fix the JSON, reload. Loud failure is correct for authoring-time bugs.
- Missing tile reference at runtime (tile ID not in `tiles-meta.json`) → render a magenta placeholder plane + warn once per tile. Game keeps running; artist sees the broken tile immediately.
- Python parsers raise `BadFormatError` with byte offset on malformed binaries. Extraction fails hard rather than emitting partial JSON.

## Testing strategy

### Python (pytest)

- Round-trip fixtures for QAV and SEQ: hand-craft minimal binary blobs with known values → parse → assert decoded dict matches. One test per non-trivial field.
- Malformed-input tests: bad magic, truncated frame, impossible `nFrames` → asserts `BadFormatError`.

### TypeScript (vitest)

- `animator.update()` — table-driven elapsed-time → frame-index: zero, mid-frame, boundary, loop wrap, non-loop hold-last, negative elapsed guard.
- `validateManifest()` — valid cases, plus each invalid class (missing field, unknown tile, `durMs ≤ 0`, `angleStride < 1`) returns a clean error.
- `BillboardAnimator` angle math — pure function, table-driven: `(cameraPos, spritePos, spriteFacing, angleStride)` → variant index. Covers all 5 variants at cardinal + diagonal angles.
- `Dynamite.ts` existing FSM tests continue to pass after the swap (animation is pure display; FSM behavior unchanged).

### Manual playtest (post-integration)

- Dynamite: cook → throw cycle shows lighter-hand and flame at correct sizes, no scaling glitch.
- Zombie: strafe around one while it chases. Frame changes with movement; angle variant changes with relative heading.

## Migration / cutover

1. Build new system alongside old. Existing `FpWeaponView` + hand-picked frame helpers stay functional during development.
2. Swap `Dynamite` to `FpWeaponAnimator`. Delete `src/vfx/fp-weapon.ts`.
3. Swap `AxeZombie` to `BillboardAnimator`. Delete hand-picked frame logic in `axe-zombie.ts`.
4. Update `TASKS.md`: flip `A5` and `A6.5` to `[x]` (the new system supersedes both). Add an `A10` entry for the animation system itself with a link back to this spec.

## Task decomposition (for implementation plan)

Seven tasks, serial by default via `dispatch-ui`. Tasks 5 and 6 are independent after task 4 and can parallelize if useful.

1. **Binary format parsers (Python)** — pure logic, byte fixtures, pytest green. Output: `scripts/qav_parser.py`, `scripts/seq_parser.py`, `scripts/tests/`.
2. **RFF extraction + JSON emit + tile-meta** — wire parsers to `BLOOD.RFF`, CLI scripts, extract dynamite QAVs + zombie SEQs + tile-meta into `public/assets/animations/`. Commit the JSON.
3. **TS schema + validator** — `src/animation/qav-schema.ts`, vitest. No Three.js.
4. **Base animator (frame ticker)** — `src/animation/animator.ts`, vitest.
5. **`FpWeaponAnimator` + Dynamite swap** — delete `src/vfx/fp-weapon.ts`. Manual playtest: dynamite glitch gone.
6. **`BillboardAnimator` + angle pick + AxeZombie swap** — delete hand-picked frame helpers. Manual playtest: zombie facing looks right from multiple angles.
7. **Integration sweep + docs + `TASKS.md` update** — asset-loader wiring, `docs/dev-notes/YYYY-MM-DD-animation-system.md` schema reference, flip `A5`/`A6.5`.

Dependency chain: `1 → 2 → 3 → 4 → {5, 6} → 7`.

## Risks

- **QAV pixel-offset → camera-space math.** QAV offsets are in Blood's 320×200 reference viewport. Easy to get the conversion wrong. Mitigation: once one weapon animation looks right in-game, the formula is locked; every other animation uses the same formula and validator catches schema mismatches.
- **Binary format version skew across Blood releases.** Mitigation: parser reads only consumed fields; unknown flag bits stored verbatim; parser logs observed version for diagnostics.
- **SEQ angle-variant mapping assumption.** Standard Blood uses 5 rotations but some sprites use different strides. Mitigation: `angleStride` is per-manifest, not a global constant. Extractor infers it from the SEQ or defaults to 5 and warns; manifest can be hand-corrected.
