# M2 asset extraction (A9) — 2026-04-21

Placeholder assets for the M2 milestone (first kill with dynamite bundle).
All extracted from Blood 1997 — dev-only, gitignored, never shipped.

## Extracted groups

### Dynamite bundle (flying projectile sprite)
- Source: picnum 3433 base + rotation frames (tiles013.art)
- thingInfo[kThingArmedTNTBundle=419] at actor.cpp:2023
- Confirmed range: **3432–3436** (5 tiles)
  - 3432: 35×28 (different aspect — debris or alt view?)
  - 3433: 82×16 (base — wide, short — classic rotation frame)
  - 3434: 84×16 (rotation)
  - 3435: 83×16 (rotation)
  - 3436: 68×30 (different aspect — could be debris)
- Output: `public/assets/weapons/dynamite-placeholder/bundle/`
- Manifest: `bundle/manifest.json`

### First-person dynamite hand view
- Source: weaponIcon table picnum 589 (view.cpp:1342), weapon 6
- Confirmed range: **589–610** (22 tiles)
- Key frames:
  - 589: 11×25 (icon base — very small)
  - 596/597: 46×128 (large — likely the actual FP hand)
  - 599: 63×53 (mid-size)
  - 600–603: 36×60-ish (throw sequence?)
- **Note**: Blood's FP weapon rendering uses QAV resource 6 (weaponQav=6, weapon.cpp:917), NOT these tiles directly. These tiles may be for HUD icon or fallback. Will need to either extract QAV frames or use the large tiles (596/597) as placeholder.
- Output: `public/assets/weapons/dynamite-placeholder/view/`
- Manifest: `view/manifest.json`

### Explosion fireball animation (SEQ 4)
- Source: SEQ resource id=4, name `EXPLC2` from BLOOD.RFF
- Used by: seqSpawn(4, 3, nXSprite, -1) at actor.cpp:6070 default case (TNT bundle explosion)
- **Confirmed range: picnums 984–996** (14 frames from SEQ data, tiles003.art)
- SEQ parameters: 14 frames, ticksPerFrame=8 (67ms/frame), ~933ms total
- Frame dimensions show classic explosion arc: ignite (77×74) → peak (112×109) → dissipate (116×53)
- **Method**: Decoded SEQ binary from BLOOD.RFF using correct resource id field (bytes 44-47 of FAT entry, not bytes 0-3 as initially assumed)
- Output: `public/assets/vfx/explosion-placeholder/`
- Manifest: `explosion-placeholder/manifest.json`

### Blood trail droplet (FX_27)
- Source: gFXData[27] at fx.cpp:89, picnum 733 (tiles002.art)
- Confirmed: **733** (single tile, 15×9px)
- Output: `public/assets/gibs-placeholder/trail/733.png`
- Manifest: `trail/manifest.json`

## SEQ decoding methodology

The explosion SEQ (id=4) was not in any ART file — it's a binary SEQ resource in BLOOD.RFF that references ART tile numbers. Key discovery:

1. RFF FAT entry structure (from resource.h DICTNODE_FILE):
   - bytes 0-15: unused1
   - bytes 16-19: offset
   - bytes 20-23: size
   - bytes 24-31: unused2
   - byte 32: flags
   - bytes 33-35: type (3 chars)
   - bytes 36-43: name (8 chars)
   - **bytes 44-47: id** (int — this is the numeric resource ID used by gSysRes.Lookup(id, "SEQ"))

2. Initial attempt using bytes 0-3 as id was wrong (always 0) — the correct field is at bytes 44-47.

3. SEQ binary format (from seq.h):
   - Header: 4-byte signature "SEQ\x1a", short version, short nFrames, short ticksPerFrame, short nSoundID, int flags
   - Frames: 8-byte SEQFRAME bitfields, tile number = (tile bits 0-11) + (tile2 bits 44-47 << 12)

4. Resource lookup: `gSysRes.Lookup(4, "SEQ")` finds the SEQ with id=4, which is named `EXPLC2`.

## Verification
All ranges were confirmed programmatically by decoding BLOOD.RFF SEQ resources
and cross-referencing with NotBlood source code (actor.cpp, view.cpp, seq.h).
Visual verification against contact sheets should be done during implementation.

## Guardrails
All paths match `.gitignore` rules for `public/assets/**/*-placeholder*`.
Never committed, never shipped.
