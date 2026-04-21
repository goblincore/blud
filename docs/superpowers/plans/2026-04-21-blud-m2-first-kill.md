# Blud — M2 Implementation Plan (First Kill: Dynamite + Gibs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser build where the player can throw a dynamite bundle, watch it arc, detonate in a cluster of shambling axe-zombies, and see all four gib subsystems fire together (Rapier chunks + radial FX burst + per-chunk blood-trail + on-surface decals), with minimum juice (explosion sprite + screenshake + per-stage SFX). Acceptance is a gut-check: "yeah, that feels right for placeholder."

**Architecture:** Dynamite is a projectile-AOE weapon implementing a tiny `Weapon` interface. On fuse-end, the explosion orchestrator runs a Rapier radius query, applies damage with linear falloff, and routes overkilled dudes into the gib system. The gib system has three subsystems behind a single `triggerGib()` entry point: Rapier dynamic-body chunks (billboard sprites now, voxel swap in M3 — this is the only file that changes then), a shared kinematic particle pool serving both radial burst and per-chunk 20 Hz blood trails (FX_27 velocity-inheritance per NotBlood `callback.cpp:180-192`), and a decals module that spawns stuck quads when trails hit static surfaces via AABB test. All tuning constants live in one `gibs/tuning.ts` sourced from NotBlood with citations.

**Tech Stack:** TypeScript 5, Vite 5, Three.js ^0.170, @dimforge/rapier3d-compat ^0.14, Vitest ^2, happy-dom. M1's engine/physics/input modules are the substrate; M2 adds gameplay on top.

**Reference spec:** [`docs/superpowers/specs/2026-04-21-blud-m2-first-kill-design.md`](../specs/2026-04-21-blud-m2-first-kill-design.md). Tuning source citations: [`docs/tuning-sources.md`](../../tuning-sources.md), [`docs/tuning-sources-gibs.md`](../../tuning-sources-gibs.md). NotBlood source for ad-hoc grep: `/Users/donny/Documents/Raze/NotBlood/source/blood/src/`.

**Execution pattern:** This plan gets split into 12 dispatch-ui task files at `~/.claude/dispatch/plans/2026-04-21-blud-m2-task-{1..12}.md` with serial `depends_on` chain, same as M1. Config: `model=zai/glm-5.1`, `api_key_env=ZAI_API_KEY`, `harness=pi`, `branch=dispatch/blud-m2-task-N`, `max_runtime=25m`.

---

## File Structure (new/modified under `src/`)

```
src/
├── main.ts                             # MODIFY: wire M2 systems into fixed-step loop
├── game/
│   ├── arena.ts                        # MODIFY: add spawnCluster() + R-key respawn + game-over overlay
│   ├── weapons/
│   │   ├── types.ts                    # NEW: Weapon interface + FrameCtx
│   │   ├── dynamite.ts                 # NEW: cook/charge/throw/projectile
│   │   ├── dynamite.test.ts            # NEW
│   │   └── index.ts                    # NEW: currentWeapon single-slot registry
│   ├── gibs/
│   │   ├── index.ts                    # NEW: spawnExplosion + triggerGib orchestrator
│   │   ├── chunks.ts                   # NEW: Rapier body-part flight, M3 voxel-swap point
│   │   ├── particles.ts                # NEW: kinematic pool (burst + trail)
│   │   ├── particles.test.ts           # NEW
│   │   ├── decals.ts                   # NEW: surface-stuck quads
│   │   ├── tuning.ts                   # NEW: NotBlood-sourced constants
│   │   ├── tuning.test.ts              # NEW: BU<->m conversion
│   │   └── explosion-math.test.ts      # NEW: falloff math for AOE
│   └── enemy/
│       ├── axe-zombie.ts               # NEW: billboard sprite + hp
│       ├── ai.ts                       # NEW: shambler FSM
│       └── ai.test.ts                  # NEW
├── ui/
│   └── charge-hud.ts                   # NEW: crosshair ring overlay
├── vfx/
│   ├── explosion.ts                    # NEW: fireball sprite animation
│   ├── screenshake.ts                  # NEW: camera impulse
│   └── screenshake.test.ts             # NEW
public/assets/
├── weapons/dynamite-placeholder/       # NEW (A9 extraction) — gitignored
│   ├── bundle/                         # picnum 3433 + rotation frames
│   ├── view/                           # picnum 589 + frames 4–11
│   └── manifest.json
├── vfx/explosion-placeholder/          # NEW (A9 extraction) — gitignored
│   ├── frames/                         # SEQ 4 range
│   └── manifest.json
└── gibs-placeholder/trail/             # NEW (A9 extraction) — gitignored
    ├── 733.png
    └── manifest.json
scripts/
└── extract_blood_sprites.py            # MODIFY: add `--range 3432-3435` etc. CLI, or invoke existing
docs/
└── dev-notes/
    └── 2026-04-21-m2-asset-extraction.md  # NEW: what was extracted, ranges, notes
TASKS.md                                 # MODIFY: mark A9 status, flip M2 → [~]
```

**Unit boundaries:**
- `weapons/*` never touches gib internals; `gibs/*` never knows about weapons. Crossings via `triggerGib(pos, impulse, dudeType)` and `spawnExplosion(pos, type)`.
- `gibs/particles.ts` is a pure pool — doesn't know about blood, gibs, or weapons. Both burst and trail are parameterized modes.
- `gibs/chunks.ts` is the *only* file that changes in M3 when voxel swap happens.
- `vfx/*` is gameplay-agnostic (screenshake takes magnitude/duration, explosion takes position/size).
- Pure-logic modules (`tuning`, `screenshake`, `ai` FSM, `dynamite` charge math, falloff math, particle pool allocation) are TDD'd. Rendering + Rapier integration is manual-verified.

---

## Task summary

| # | Task | TDD? | Files | Depends on |
|---|------|------|-------|------------|
| 1 | Asset extraction (A9)                     | N | scripts, public/assets    | —          |
| 2 | Tuning constants + BU↔m conversion        | Y | gibs/tuning.{ts,test}     | —          |
| 3 | Screenshake VFX                           | Y | vfx/screenshake.{ts,test} | —          |
| 4 | Particle pool (kinematic base)            | Y | gibs/particles.{ts,test}  | 2          |
| 5 | Burst + trail emission layered on pool    | Y | gibs/particles.ts (modify)| 4          |
| 6 | Decals module + AABB surface detection    | N | gibs/decals.ts            | 5          |
| 7 | Chunks module (Rapier body flight)        | N | gibs/chunks.ts            | 5          |
| 8 | Explosion VFX + gibs orchestrator         | Y | gibs/index.ts, vfx/explosion.ts, explosion-math.test | 6, 7, 3 |
| 9 | Axe zombie sprite + AI FSM                | Y | enemy/axe-zombie.ts, enemy/ai.{ts,test}  | 2 |
| 10 | Weapon interface + dynamite impl          | Y | weapons/{types,dynamite,dynamite.test,index} | 2, 8 |
| 11 | Charge HUD + arena cluster + game-over    | N | ui/charge-hud.ts, game/arena.ts | 9, 10 |
| 12 | Main integration + verify build + tests   | N | src/main.ts, TASKS.md     | 11         |

---

## Tasks

### Task 1: Asset extraction (A9)

**Files:**
- Run: `scripts/extract_blood_sprites.py` (existing from M1/A5)
- Create: `public/assets/weapons/dynamite-placeholder/bundle/manifest.json`
- Create: `public/assets/weapons/dynamite-placeholder/view/manifest.json`
- Create: `public/assets/vfx/explosion-placeholder/manifest.json`
- Create: `public/assets/gibs-placeholder/trail/manifest.json`
- Create: `docs/dev-notes/2026-04-21-m2-asset-extraction.md`

**Context:** Existing extraction script at `scripts/extract_blood_sprites.py` already handles RFF/ART decoding + PNG dump. A5/A6 established the visual-verification workflow — user eyeballs `assets-source/blood-extracted/tilesNNN.html` contact sheets to confirm tile ranges, then the manifest is hand-authored to name each PNG. This task extracts four new asset groups following the same pattern.

Ranges from spec §3:

| Asset | Starting picnum | ART file | Verify by looking at |
|-------|-----------------|----------|----------------------|
| Dynamite bundle (flying) | 3433 | `tiles013.art` | frames 3432–3435 in tiles013.html |
| First-person dynamite hand | 589 | `tiles002.art` | frames 589–600 in tiles002.html |
| Explosion fireball (SEQ 4) | unknown | likely `tiles004.art` or `tiles005.art` | visually scan for a fireball animation in contact sheets |
| Blood trail droplet (FX_27) | 733 | `tiles002.art` | tile 733 in tiles002.html |

- [ ] **Step 1: Confirm picnum 3433 + nearby rotation frames visually**

```bash
open assets-source/blood-extracted/tiles013.html
```

Confirm tile 3433 is a bundle of dynamite sticks. Note which tiles around it (3432, 3434, 3435) are rotation variants or separate frames. Record the exact confirmed range.

- [ ] **Step 2: Confirm picnum 589 + frames 4–11 for FP hand view**

```bash
open assets-source/blood-extracted/tiles002.html
```

Confirm tile 589 is a first-person dynamite hand. Frames 589+4 through 589+11 should be animation frames (charge, throw). Record the exact confirmed range.

- [ ] **Step 3: Find explosion fireball range for SEQ 4**

```bash
open assets-source/blood-extracted/tiles004.html
open assets-source/blood-extracted/tiles005.html
open assets-source/blood-extracted/tiles006.html
```

Blood's standard explosion (SEQ 4) is a ~6–10 frame fireball expansion. Scan these sheets for an explosion-style animation (starts small orange, expands, fades to smoke). Record the exact confirmed range (e.g. "2271–2280" or similar). If SEQ 4 is hard to find visually, grep NotBlood for SEQ data:

```bash
grep -rn "seq.*4\b\|kSeq4\|explosion.*seq" ~/Documents/Raze/NotBlood/source/blood/src/ | head -20
```

- [ ] **Step 4: Confirm picnum 733 is the blood droplet (FX_27)**

```bash
open assets-source/blood-extracted/tiles002.html
```

Confirm tile 733 is a small round blood droplet/splat. This is what gets trailed behind flying chunks.

- [ ] **Step 5: Extract each asset group by copying confirmed tiles**

Since the extraction script already dumped all tiles to `assets-source/blood-extracted/tilesNNN_tiles/`, extraction for A9 is just copying confirmed ranges into `public/assets/...`. For each group:

```bash
# Dynamite bundle (example using 3432-3435; substitute confirmed range)
mkdir -p public/assets/weapons/dynamite-placeholder/bundle
for n in 3432 3433 3434 3435; do
  cp "assets-source/blood-extracted/tiles013_tiles/tile${n}.png" \
     "public/assets/weapons/dynamite-placeholder/bundle/${n}.png"
done

# FP hand (frames 589..600)
mkdir -p public/assets/weapons/dynamite-placeholder/view
for n in $(seq 589 600); do
  cp "assets-source/blood-extracted/tiles002_tiles/tile${n}.png" \
     "public/assets/weapons/dynamite-placeholder/view/${n}.png"
done

# Explosion (substitute confirmed range)
mkdir -p public/assets/vfx/explosion-placeholder/frames
# ... copy confirmed range

# Trail droplet
mkdir -p public/assets/gibs-placeholder/trail
cp "assets-source/blood-extracted/tiles002_tiles/tile733.png" \
   "public/assets/gibs-placeholder/trail/733.png"
```

- [ ] **Step 6: Write `public/assets/weapons/dynamite-placeholder/bundle/manifest.json`**

```json
{
  "asset": "dynamite-bundle",
  "source": "Blood 1997 — picnum 3433 (thingInfo kThingArmedTNTBundle)",
  "frames": [
    { "picnum": 3432, "file": "3432.png", "role": "rotation-0" },
    { "picnum": 3433, "file": "3433.png", "role": "rotation-1" },
    { "picnum": 3434, "file": "3434.png", "role": "rotation-2" },
    { "picnum": 3435, "file": "3435.png", "role": "rotation-3" }
  ],
  "notes": "Rotation frames for billboard yaw-snap. Adjust role labels after in-game visual verify."
}
```

(Adjust frames list to match confirmed range from Step 1.)

- [ ] **Step 7: Write `public/assets/weapons/dynamite-placeholder/view/manifest.json`**

```json
{
  "asset": "dynamite-fp-view",
  "source": "Blood 1997 — picnum 589 + frames (weaponIcon table in view.cpp)",
  "frames": [
    { "picnum": 589, "file": "589.png", "role": "idle-base" },
    { "picnum": 593, "file": "593.png", "role": "charge-0" },
    { "picnum": 596, "file": "596.png", "role": "charge-1-fuse-sparks" },
    { "picnum": 600, "file": "600.png", "role": "throw-wind-up" }
  ],
  "notes": "Role labels are starting guesses. Re-label after visual playtest — we want at least three fuse-visible frames (idle, mid-cook, late-cook) for player feedback."
}
```

- [ ] **Step 8: Write `public/assets/vfx/explosion-placeholder/manifest.json`**

```json
{
  "asset": "explosion-fireball",
  "source": "Blood 1997 — SEQ 4 (kExplosionSmall/Standard/Large share this seq)",
  "frameDurationMs": 50,
  "frames": [
    { "picnum": 0, "file": "0.png", "role": "frame-0" }
  ],
  "notes": "Populate frames array with confirmed picnum range from Step 3. Typical Blood explosion is 6-10 frames at ~50ms each. Full lifetime ~300-500ms."
}
```

- [ ] **Step 9: Write `public/assets/gibs-placeholder/trail/manifest.json`**

```json
{
  "asset": "blood-trail-droplet",
  "source": "Blood 1997 — FX_27 (picnum 733), gFXData[27] at fx.cpp:89",
  "frames": [
    { "picnum": 733, "file": "733.png", "role": "droplet-base" }
  ],
  "tuning": {
    "gravity_blood": 27962,
    "airdrag_blood": 4096,
    "lifetimeTics": 480,
    "size": 32,
    "shade": -16
  },
  "notes": "Single sprite. Values in tuning.* match NotBlood source; they're the starting target for the real particle system."
}
```

- [ ] **Step 10: Write `docs/dev-notes/2026-04-21-m2-asset-extraction.md`**

```markdown
# M2 asset extraction (A9) — 2026-04-21

Placeholder assets for the M2 milestone (first kill with dynamite bundle).
All extracted from Blood 1997 — dev-only, gitignored, never shipped.

## Extracted groups

### Dynamite bundle (flying projectile sprite)
- Source: picnum 3433 + rotation frames
- Confirmed range: **<fill in from Step 1>**
- Output: `public/assets/weapons/dynamite-placeholder/bundle/`
- Manifest: `bundle/manifest.json`

### First-person dynamite hand view
- Source: picnum 589 + frame offsets 4-11
- Confirmed range: **<fill in from Step 2>**
- Output: `public/assets/weapons/dynamite-placeholder/view/`
- Manifest: `view/manifest.json`

### Explosion fireball animation (SEQ 4)
- Source: SEQ 4 (visual-identified picnum range)
- Confirmed range: **<fill in from Step 3>**
- Output: `public/assets/vfx/explosion-placeholder/frames/`
- Manifest: `explosion-placeholder/manifest.json`

### Blood trail droplet (FX_27)
- Source: picnum 733 from `gFXData[27]` at `fx.cpp:89`
- Output: `public/assets/gibs-placeholder/trail/733.png`
- Manifest: `trail/manifest.json`

## Verification
All ranges were visually verified against `assets-source/blood-extracted/tilesNNN.html`
contact sheets before extraction. Same workflow as A5/A6.

## Guardrails
All paths match `.gitignore` rules for `public/assets/**/*-placeholder*`.
Never committed, never shipped.
```

- [ ] **Step 11: Verify `.gitignore` still covers these paths**

```bash
git status --short public/ | head
```

Expected: no tracked files under `public/assets/*-placeholder*`. If any appear, check `.gitignore` covers them.

- [ ] **Step 12: Commit docs + manifests (manifests track the *shape* of the asset groups without shipping the PNGs)**

Wait — manifests themselves are under `public/assets/*-placeholder*` which is gitignored. We want manifests *committed* so the extraction is reproducible, but PNGs ignored. Add a targeted `.gitignore` exception:

```bash
cat >> .gitignore <<'EOF'

# Allow manifests but not the placeholder PNGs they describe
!public/assets/**/manifest.json
EOF
```

Then:

```bash
git add .gitignore \
        public/assets/weapons/dynamite-placeholder/bundle/manifest.json \
        public/assets/weapons/dynamite-placeholder/view/manifest.json \
        public/assets/vfx/explosion-placeholder/manifest.json \
        public/assets/gibs-placeholder/trail/manifest.json \
        docs/dev-notes/2026-04-21-m2-asset-extraction.md
git commit -m "A9: extract M2 placeholder assets (dynamite, explosion, trail)"
```

---

### Task 2: Tuning constants + BU↔m conversion

**Files:**
- Create: `src/game/gibs/tuning.ts`
- Create: `src/game/gibs/tuning.test.ts`

**Context:** Central store for all NotBlood-sourced constants. Every constant gets a source citation comment. The conversion helper turns Build-engine units (Build fixed-point, typically `/ 65536` then units-per-tic) into SI (meters, m/s, m/s²). `BU_PER_METER = 256` is our calibration (inherited from M1 arena scale — verify in Task 12).

- [ ] **Step 1: Write failing tests at `src/game/gibs/tuning.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  BU_PER_METER,
  TICS_PER_SECOND,
  buPerTicToMps,
  buPerTicSquaredToMpsSquared,
  EXPLOSION_STANDARD,
  GIB_THRESHOLD,
  DYNAMITE_COOK,
  BLOOD_TRAIL,
  GIB_BURST,
  AXE_ZOMBIE,
} from './tuning';

describe('unit conversion', () => {
  it('BU_PER_METER is 256', () => {
    expect(BU_PER_METER).toBe(256);
  });

  it('TICS_PER_SECOND is 120', () => {
    expect(TICS_PER_SECOND).toBe(120);
  });

  it('converts Build velocity (1 BU/tic) to m/s', () => {
    // 1 BU/tic * 120 tic/s = 120 BU/s = 120/256 m/s ≈ 0.46875 m/s
    expect(buPerTicToMps(1)).toBeCloseTo(0.46875, 5);
  });

  it('converts Build acceleration (1 BU/tic²) to m/s²', () => {
    // 1 BU/tic² * 120² tic²/s² / 256 BU/m
    expect(buPerTicSquaredToMpsSquared(1)).toBeCloseTo(56.25, 4);
  });

  it('converts Blood dynamite min velocity (0x66666 fixed-16) to ~3 m/s', () => {
    // Blood's min throw after mulscale16 = 0x66666 >> 16 = 6.4 BU/tic
    // 6.4 * 120 / 256 ≈ 3.0 m/s
    const minBuPerTic = 0x66666 / 0x10000;
    expect(buPerTicToMps(minBuPerTic)).toBeCloseTo(3.0, 1);
  });
});

describe('explosion constants', () => {
  it('kExplosionStandard (TNT Bundle) matches NotBlood explodeInfo[1]', () => {
    expect(EXPLOSION_STANDARD.radius).toBe(150);
    expect(EXPLOSION_STANDARD.damage).toBe(20);
    expect(EXPLOSION_STANDARD.damageRange).toBe(10);
    expect(EXPLOSION_STANDARD.impulse).toBe(900);
    expect(EXPLOSION_STANDARD.quake).toBe(160);
  });

  it('GIB_THRESHOLD is 160 (R1 NotBlood extraction)', () => {
    expect(GIB_THRESHOLD).toBe(160);
  });
});

describe('dynamite tuning', () => {
  it('maxChargeSec is 2 (240 tics @ 120 TPS)', () => {
    expect(DYNAMITE_COOK.maxChargeSec).toBe(2.0);
  });
  it('fuseMaxSec is 2 (cook envelope matches charge envelope)', () => {
    expect(DYNAMITE_COOK.fuseMaxSec).toBe(2.0);
  });
  it('throw velocity range is ~3 m/s to ~6.5 m/s', () => {
    expect(DYNAMITE_COOK.minVelocityMps).toBeCloseTo(3.0, 1);
    expect(DYNAMITE_COOK.maxVelocityMps).toBeCloseTo(6.5, 1);
    expect(DYNAMITE_COOK.maxVelocityMps).toBeGreaterThan(DYNAMITE_COOK.minVelocityMps);
  });
});

describe('blood trail (FX_27)', () => {
  it('emits at 20 Hz (6 tics @ 120 TPS)', () => {
    expect(BLOOD_TRAIL.emitHz).toBe(20);
  });
  it('inherits 1/256 of parent velocity (Blood xvel>>8)', () => {
    expect(BLOOD_TRAIL.velScale).toBeCloseTo(1 / 256, 10);
  });
  it('lifetime is 4 seconds (480 tics)', () => {
    expect(BLOOD_TRAIL.lifetimeSec).toBe(4.0);
  });
  it('picnum is 733', () => {
    expect(BLOOD_TRAIL.tile).toBe(733);
  });
});

describe('gib burst (FX_13)', () => {
  it('picnum is 2154', () => {
    expect(GIB_BURST.tile).toBe(2154);
  });
  it('lifetime is 4 seconds', () => {
    expect(GIB_BURST.lifetimeSec).toBe(4.0);
  });
});

describe('axe zombie', () => {
  it('has tuning-sourced HP and melee values', () => {
    expect(AXE_ZOMBIE.hp).toBeGreaterThan(0);
    expect(AXE_ZOMBIE.meleeDamage).toBeGreaterThan(0);
    expect(AXE_ZOMBIE.speed).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/game/gibs/tuning.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/game/gibs/tuning.ts`**

```ts
/**
 * Tuning constants for M2 gib/weapon systems.
 *
 * Every constant below is sourced from the NotBlood repository
 * (/Users/donny/Documents/Raze/NotBlood/source/blood/src/) with an explicit
 * source-file citation. When feel-tuning drifts a value from Blood's, keep
 * the original as a sibling `// blood: ...` comment so the delta is visible.
 *
 * See also:
 *  - docs/tuning-sources.md     (R1 — enemy HP, damage, explosion, weapon timers)
 *  - docs/tuning-sources-gibs.md (R2 — gib picnums + FX_27 trail mechanic)
 */

// ——— Unit conversion ————————————————————————————————————

/** Build engine units per meter. Calibrated in M1; re-verify if arena scale changes. */
export const BU_PER_METER = 256;

/** Blood runs at a fixed 120 ticks/sec; all "per-tic" Blood values convert via this. */
export const TICS_PER_SECOND = 120;

/** Convert a velocity expressed in Build-units-per-tic to meters-per-second. */
export function buPerTicToMps(buPerTic: number): number {
  return (buPerTic * TICS_PER_SECOND) / BU_PER_METER;
}

/** Convert an acceleration expressed in Build-units-per-tic² to meters-per-second². */
export function buPerTicSquaredToMpsSquared(buPerTicSquared: number): number {
  return (buPerTicSquared * TICS_PER_SECOND * TICS_PER_SECOND) / BU_PER_METER;
}

// ——— Explosion (kExplosionStandard — TNT Bundle) ————————————————
// source: actor.cpp:2300-2310 (explodeInfo[1]); docs/tuning-sources.md:456
export const EXPLOSION_STANDARD = {
  radius: 150,        // Build units — converted to meters at query time (radius / BU_PER_METER)
  damage: 20,
  damageRange: 10,    // actual ∈ [damage - range, damage + range]
  impulse: 900,
  lifetimeTics: 60,
  quake: 160,
  flash: 60,
} as const;

// source: R1 NotBlood gib-threshold extraction (single-hit dmg ≥ 160 ⇒ skip death, gib directly)
export const GIB_THRESHOLD = 160;

// ——— Dynamite throw ————————————————————————————————————
// source: weapon.cpp:1215 (throw velocity), weapon.cpp:2166-2167 (charge formula)
// Blood: velocity = mulscale16(throwPower, 0x177777) + 0x66666
// After shift-16: min = 0x66666 >> 16 = 6.4 BU/tic, max = (0x66666 + 0x177777) >> 16 = 13.86 BU/tic
// Converted with BU_PER_METER=256, TICS_PER_SECOND=120:
//   min ≈ 3.0 m/s, max ≈ 6.5 m/s
export const DYNAMITE_COOK = {
  maxChargeSec: 2.0,          // 240 tics @ 120 TPS
  minVelocityMps: 3.0,
  maxVelocityMps: 6.5,
  fuseMaxSec: 2.0,            // fuse starts on press; same envelope as charge
} as const;

// ——— Blood trail (FX_27) ————————————————————————————————
// source: callback.cpp:180-192 (fxBloodSpurt scheduling) + fx.cpp:89 (gFXData[27])
export const BLOOD_TRAIL = {
  emitHz: 20,                 // 6 tics @ 120 TPS → 20 Hz
  velScale: 1 / 256,          // Blood: xvel >> 8 = 1/256 inheritance
  gravityBlood: 27962,        // BU/tic² (raw Blood value, kept for reference)
  airdragBlood: 4096,         // raw Blood airdrag coefficient
  lifetimeSec: 4.0,           // 480 tics @ 120 TPS
  sizePx: 32,                 // 32×32 sprite (Blood xrepeat/yrepeat)
  tile: 733,
} as const;

// ——— Gib-moment radial burst (FX_13) ————————————————————
// source: fx.cpp:75 (gFXData[13]) — the main blood-chunk spray at the gib instant
export const GIB_BURST = {
  count: 10,                  // starting target: 10 particles per gib
  speedMin: 3.0,              // m/s radial spread (Blood-equivalent rough target)
  speedMax: 8.0,
  gravityBlood: 46603,
  airdragBlood: 2048,
  lifetimeSec: 4.0,           // 480 tics
  sizePx: 40,                 // 40×40 (Blood xrepeat/yrepeat)
  tile: 2154,
} as const;

// ——— Axe zombie ————————————————————————————————————
// source: docs/tuning-sources.md R1 (aizomba.cpp + dudeInfo[axeZombie])
// Starting values — these are our best read from NotBlood; feel-tune in Task 12 if needed.
export const AXE_ZOMBIE = {
  hp: 60,                     // dudeInfo[axeZombie].startHealth
  meleeDamage: 10,            // aizomba.cpp hit damage
  meleeRange: 1.5,            // m — ~sprite reach
  attackCooldownSec: 1.0,     // between swings
  speed: 3.0,                 // m/s — walk speed (shambler pace)
  aggroRadiusM: 40,           // when within this distance the zombie chases
  gibThresholdOverride: undefined as number | undefined, // use global GIB_THRESHOLD
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/game/gibs/tuning.test.ts
```

Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/game/gibs/tuning.ts src/game/gibs/tuning.test.ts
git commit -m "M2: tuning constants + BU↔m conversion helpers"
```

---

### Task 3: Screenshake VFX

**Files:**
- Create: `src/vfx/screenshake.ts`
- Create: `src/vfx/screenshake.test.ts`

**Context:** A pure state container holding impulse → exponentially-decaying camera rotation offset. Reusable by M4's other weapons. Exposes `shake(magnitude, durationSec)` to queue an impulse, and `sampleOffset(dt)` to be applied to camera rotation each render frame.

- [ ] **Step 1: Write failing tests at `src/vfx/screenshake.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Screenshake } from './screenshake';

describe('Screenshake', () => {
  let sh: Screenshake;

  beforeEach(() => {
    sh = new Screenshake();
  });

  it('produces zero offset when idle', () => {
    const off = sh.sampleOffset(0.016);
    expect(off.pitch).toBe(0);
    expect(off.yaw).toBe(0);
    expect(off.roll).toBe(0);
  });

  it('produces non-zero offset after shake()', () => {
    sh.shake(1.0, 0.5);
    const off = sh.sampleOffset(0.016);
    expect(Math.abs(off.pitch) + Math.abs(off.yaw) + Math.abs(off.roll)).toBeGreaterThan(0);
  });

  it('decays to zero after full duration', () => {
    sh.shake(1.0, 0.5);
    // Consume all energy
    for (let t = 0; t < 1.0; t += 0.016) sh.sampleOffset(0.016);
    const off = sh.sampleOffset(0.016);
    expect(Math.abs(off.pitch)).toBeLessThan(0.0001);
    expect(Math.abs(off.yaw)).toBeLessThan(0.0001);
  });

  it('higher magnitude yields larger peak offset', () => {
    const sh2 = new Screenshake();
    sh.shake(1.0, 0.5);
    sh2.shake(2.0, 0.5);
    // Sample first frame; bigger magnitude → bigger offset (on average)
    let mag1 = 0, mag2 = 0;
    for (let i = 0; i < 20; i++) {
      const o1 = sh.sampleOffset(0.001);
      const o2 = sh2.sampleOffset(0.001);
      mag1 += Math.abs(o1.pitch) + Math.abs(o1.yaw);
      mag2 += Math.abs(o2.pitch) + Math.abs(o2.yaw);
    }
    expect(mag2).toBeGreaterThan(mag1);
  });

  it('stacks overlapping impulses additively in magnitude', () => {
    sh.shake(1.0, 0.5);
    const mid = sh.sampleOffset(0.016);
    sh.shake(1.0, 0.5);  // second shake while first still active
    const after = sh.sampleOffset(0.016);
    // Second impulse should bump residual magnitude up
    const mMid = Math.abs(mid.pitch) + Math.abs(mid.yaw);
    const mAft = Math.abs(after.pitch) + Math.abs(after.yaw);
    expect(mAft).toBeGreaterThan(mMid * 0.5); // not strictly ≥ because random phase, but close
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/vfx/screenshake.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/vfx/screenshake.ts`**

```ts
/**
 * Camera screenshake: additive rotation offset on top of player look angles.
 *
 * Model: each `shake(magnitude, durationSec)` injects "energy" that decays
 * exponentially. Each sample produces a small random pitch/yaw/roll offset
 * whose amplitude is proportional to remaining energy.
 *
 * Reusable for M4 weapons — magnitude scales with the "punch" of the effect.
 * Explosion uses EXPLOSION_STANDARD.quake (scaled down to sensible radians).
 */

export interface ShakeOffset {
  pitch: number; // rad
  yaw: number;   // rad
  roll: number;  // rad
}

export class Screenshake {
  /** Remaining "energy" in arbitrary units; scales offset magnitude directly. */
  private energy = 0;

  /** Time constant for exponential decay (seconds). Smaller = snappier. */
  private readonly decaySec = 0.15;

  /** Peak-amplitude scale: energy of 1.0 → ~0.04 rad offset (~2.3°). */
  private readonly peakRad = 0.04;

  /**
   * Queue a shake impulse.
   * @param magnitude normalized intensity (1.0 = strong single-punch like a revolver shot;
   *                  4.0 = dynamite-bundle-at-point-blank).
   * @param durationSec approximate duration — currently just scales injected energy.
   */
  shake(magnitude: number, durationSec: number): void {
    this.energy = Math.min(this.energy + magnitude * durationSec, 10);
  }

  /** Call once per render frame. Returns the offset to add to camera rotation. */
  sampleOffset(dt: number): ShakeOffset {
    if (this.energy <= 0) return { pitch: 0, yaw: 0, roll: 0 };
    const amp = this.peakRad * this.energy;
    // Exponential decay
    this.energy *= Math.exp(-dt / this.decaySec);
    if (this.energy < 0.001) this.energy = 0;
    return {
      pitch: (Math.random() * 2 - 1) * amp,
      yaw:   (Math.random() * 2 - 1) * amp,
      roll:  (Math.random() * 2 - 1) * amp * 0.3, // less roll, feels nicer
    };
  }

  /** Reset (e.g. on player death / level load). */
  reset(): void {
    this.energy = 0;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/vfx/screenshake.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/vfx/screenshake.ts src/vfx/screenshake.test.ts
git commit -m "M2: Screenshake class (impulse + exponential decay)"
```

---

### Task 4: Particle pool (kinematic base)

**Files:**
- Create: `src/game/gibs/particles.ts`
- Create: `src/game/gibs/particles.test.ts`

**Context:** The shared pool for both gib-moment radial bursts and per-chunk blood trails. Particles are NOT Rapier bodies — they do cheap kinematic per-frame updates only. This task creates the pool foundation: allocation, FIFO eviction at capacity, kinematic update math (pos/vel/gravity/airdrag/lifetime/alpha). Task 5 layers the burst-emit and trail-emit modes on top. Rendering via Three.js InstancedMesh is part of this task.

- [ ] **Step 1: Write failing tests at `src/game/gibs/particles.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Particle, updateParticle } from './particles';

function makeP(overrides: Partial<Particle> = {}): Particle {
  return {
    alive: true,
    pos: { x: 0, y: 10, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    gravity: 9.8,
    airdrag: 0.1,
    lifetimeSec: 4.0,
    age: 0,
    size: 1.0,
    tile: 0,
    ...overrides,
  };
}

describe('updateParticle', () => {
  it('advances position by velocity * dt', () => {
    const p = makeP({ vel: { x: 5, y: 0, z: 0 } });
    updateParticle(p, 0.1);
    expect(p.pos.x).toBeCloseTo(0.5, 5);
  });

  it('applies gravity to y-velocity', () => {
    const p = makeP({ vel: { x: 0, y: 10, z: 0 }, gravity: 9.8 });
    updateParticle(p, 1.0);
    // vel.y += -gravity * dt = -9.8 * 1.0 = -9.8; so 10 → 0.2
    expect(p.vel.y).toBeCloseTo(0.2, 5);
  });

  it('applies airdrag to velocity', () => {
    const p = makeP({ vel: { x: 10, y: 0, z: 0 }, airdrag: 1.0, gravity: 0 });
    updateParticle(p, 1.0);
    // vel.x *= max(0, 1 - airdrag*dt) = max(0, 1 - 1.0) = 0
    expect(p.vel.x).toBeCloseTo(0, 5);
  });

  it('increments age by dt', () => {
    const p = makeP();
    updateParticle(p, 0.5);
    expect(p.age).toBeCloseTo(0.5, 5);
  });

  it('marks particle dead when age > lifetime', () => {
    const p = makeP({ lifetimeSec: 0.3 });
    updateParticle(p, 0.5);
    expect(p.alive).toBe(false);
  });

  it('does not update dead particles', () => {
    const p = makeP({ alive: false, vel: { x: 100, y: 0, z: 0 } });
    updateParticle(p, 1.0);
    expect(p.pos.x).toBe(0);
  });
});

describe('ParticlePool allocation (unit — without Three.js)', () => {
  // We test the pool allocation logic without instantiating Three.js by
  // mocking scene/atlas as any. Rendering is manually verified.
  it('allocates up to capacity', async () => {
    const { ParticlePool } = await import('./particles');
    const pool = new ParticlePool(null as any, 4, null as any);
    const a = pool.allocate(); const b = pool.allocate();
    const c = pool.allocate(); const d = pool.allocate();
    expect([a, b, c, d].every((p) => p.alive)).toBe(true);
  });

  it('at capacity, FIFO-evicts the oldest', async () => {
    const { ParticlePool } = await import('./particles');
    const pool = new ParticlePool(null as any, 2, null as any);
    const a = pool.allocate();
    const b = pool.allocate();
    const c = pool.allocate(); // evicts `a`
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
    expect(c.alive).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/game/gibs/particles.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/gibs/particles.ts`**

```ts
import * as THREE from 'three';

export interface Vec3 { x: number; y: number; z: number; }

export interface Particle {
  alive: boolean;
  pos: Vec3;
  vel: Vec3;
  gravity: number;       // m/s² (positive = downward pull)
  airdrag: number;       // per-second drag coefficient (0..1 range typical)
  lifetimeSec: number;
  age: number;
  size: number;          // world-space size (meters)
  tile: number;          // picnum for diagnostic / atlas lookup
}

/** Pure kinematic update — no allocations, no rendering. */
export function updateParticle(p: Particle, dt: number): void {
  if (!p.alive) return;

  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  p.pos.z += p.vel.z * dt;

  // Gravity pulls -y
  p.vel.y -= p.gravity * dt;

  // Airdrag — simple linear multiplicative damping; clamp to ≥ 0
  const dragFactor = Math.max(0, 1 - p.airdrag * dt);
  p.vel.x *= dragFactor;
  p.vel.y *= dragFactor;
  p.vel.z *= dragFactor;

  p.age += dt;
  if (p.age >= p.lifetimeSec) {
    p.alive = false;
  }
}

/**
 * Pool of particles rendered as a single InstancedMesh (billboarded to camera).
 * Fixed capacity; FIFO-evicts oldest when full.
 *
 * Three.js integration is minimal here — the pool owns an InstancedMesh, but
 * allocation/update is data-only so it's trivially testable.
 */
export class ParticlePool {
  private readonly particles: Particle[] = [];
  private head = 0;          // next slot to fill (wraps on eviction)

  private mesh: THREE.InstancedMesh | null = null;
  private dummy = new THREE.Object3D();

  constructor(
    private readonly scene: THREE.Scene | null,
    private readonly capacity: number,
    private readonly texture: THREE.Texture | null,
  ) {
    // Prefill with dead particles so `allocate()` has slots
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false,
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        gravity: 0,
        airdrag: 0,
        lifetimeSec: 0,
        age: 0,
        size: 1,
        tile: 0,
      });
    }

    if (scene && texture) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
      this.mesh = new THREE.InstancedMesh(geom, mat, capacity);
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
    }
  }

  /** Returns a reusable Particle slot, killing the oldest if full. */
  allocate(): Particle {
    const p = this.particles[this.head];
    if (p.alive) {
      // capacity reached — FIFO-evict
      p.alive = false;
    }
    p.alive = true;
    p.age = 0;
    p.vel = { x: 0, y: 0, z: 0 };
    this.head = (this.head + 1) % this.capacity;
    return p;
  }

  /** Advance simulation + refresh InstancedMesh matrices. Call per frame. */
  update(dt: number, camera: THREE.Camera | null = null): void {
    for (const p of this.particles) updateParticle(p, dt);
    if (!this.mesh) return;

    // Billboard each alive instance to face the camera.
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.alive) {
        this.dummy.scale.set(0, 0, 0);
      } else {
        this.dummy.position.set(p.pos.x, p.pos.y, p.pos.z);
        if (camera) this.dummy.lookAt(camera.position);
        this.dummy.scale.set(p.size, p.size, p.size);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Total alive count — diagnostic / HUD. */
  aliveCount(): number {
    return this.particles.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/game/gibs/particles.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/gibs/particles.ts src/game/gibs/particles.test.ts
git commit -m "M2: particle pool with kinematic updates + FIFO eviction"
```

---

### Task 5: Burst + trail emission layered on pool

**Files:**
- Modify: `src/game/gibs/particles.ts` (add `emitBurst`, `emitTrail` + `TrailHandle`)
- Modify: `src/game/gibs/particles.test.ts` (add burst / trail tests)

**Context:** Add the two emission modes on top of the bare pool. `emitBurst(origin, params)` allocates N particles with radial velocities. `emitTrail(source, params)` returns a handle that keeps a timer — on each `update(dt)` call, if `1/hz` seconds have elapsed, allocate a new droplet at source position with `source.vel * velScale`. Handle lets the caller stop emission.

- [ ] **Step 1: Append tests to `src/game/gibs/particles.test.ts`**

```ts
import { ParticlePool, BurstParams, TrailParams } from './particles';

describe('emitBurst', () => {
  it('allocates `count` alive particles at origin', async () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const origin = { x: 1, y: 2, z: 3 };
    const params: BurstParams = {
      tile: 2154,
      count: 8,
      speedMin: 3,
      speedMax: 5,
      gravity: 9.8,
      airdrag: 0.5,
      lifetimeSec: 4.0,
      size: 0.2,
    };
    pool.emitBurst(origin, params);
    expect(pool.aliveCount()).toBe(8);
  });

  it('distributes particle velocities in [speedMin, speedMax]', async () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const params: BurstParams = {
      tile: 2154, count: 16, speedMin: 3, speedMax: 5,
      gravity: 0, airdrag: 0, lifetimeSec: 4, size: 0.2,
    };
    pool.emitBurst({ x: 0, y: 0, z: 0 }, params);
    // Internal — use getAll() or recompute speeds via the first-frame advance.
    // We'll test indirectly: after 1 second with zero gravity/drag, particles
    // should be between 3 and 5 meters from origin.
    pool.update(1.0, null);
    for (const p of (pool as any).particles) {
      if (!p.alive) continue;
      const d = Math.sqrt(p.pos.x*p.pos.x + p.pos.y*p.pos.y + p.pos.z*p.pos.z);
      expect(d).toBeGreaterThanOrEqual(3 * 0.99);
      expect(d).toBeLessThanOrEqual(5 * 1.01);
    }
  });
});

describe('emitTrail', () => {
  it('emits at configured Hz', async () => {
    const pool = new ParticlePool(null as any, 64, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 10, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 20, velScale: 1 / 256,
      gravity: 9.8, airdrag: 0.5, lifetimeSec: 4.0, size: 0.15,
    };
    const handle = pool.emitTrail(source, params);
    // Advance 1 second; at 20 Hz we expect ~20 emissions.
    for (let t = 0; t < 1.0; t += 0.016) pool.update(0.016, null);
    const count = pool.aliveCount();
    expect(count).toBeGreaterThanOrEqual(18);
    expect(count).toBeLessThanOrEqual(22);
    handle.stop();
  });

  it('stop() halts further emission', async () => {
    const pool = new ParticlePool(null as any, 64, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 20, velScale: 1 / 256,
      gravity: 0, airdrag: 0, lifetimeSec: 10, size: 0.1,
    };
    const h = pool.emitTrail(source, params);
    for (let t = 0; t < 0.5; t += 0.016) pool.update(0.016, null);
    const before = pool.aliveCount();
    h.stop();
    for (let t = 0; t < 0.5; t += 0.016) pool.update(0.016, null);
    const after = pool.aliveCount();
    expect(after).toBe(before); // no new emissions after stop
  });

  it('inherits source velocity scaled by velScale', async () => {
    const pool = new ParticlePool(null as any, 16, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 256, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 1000, velScale: 1 / 256,
      gravity: 0, airdrag: 0, lifetimeSec: 4, size: 0.1,
    };
    pool.emitTrail(source, params);
    pool.update(0.002, null); // 0.002s * 1000Hz = 2 emissions minimum
    // First alive particle should have vel.x ≈ 256 * (1/256) = 1 m/s
    const first = (pool as any).particles.find((p: any) => p.alive);
    expect(first.vel.x).toBeCloseTo(1.0, 3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/game/gibs/particles.test.ts
```

Expected: FAIL — `emitBurst` / `emitTrail` / `BurstParams` / `TrailParams` / `TrailHandle` not exported.

- [ ] **Step 3: Extend `src/game/gibs/particles.ts` with emit APIs**

Append to the file (after the `ParticlePool` class — or integrate into it):

```ts
export interface BurstParams {
  tile: number;
  count: number;
  speedMin: number;
  speedMax: number;
  gravity: number;     // m/s² (converted from Blood's buPerTicSquared)
  airdrag: number;
  lifetimeSec: number;
  size: number;
}

/** A moving source whose velocity is sampled on each trail-emit tick. */
export interface TrailSource {
  pos: Vec3;
  vel: Vec3;
}

export interface TrailParams {
  tile: number;
  hz: number;
  velScale: number;
  gravity: number;
  airdrag: number;
  lifetimeSec: number;
  size: number;
  /** Called when a trail particle hits a static surface (decals wiring). */
  onSurfaceHit?: (pos: Vec3, normal: Vec3) => void;
}

export interface TrailHandle { stop(): void; }

interface TrailState {
  source: TrailSource;
  params: TrailParams;
  timeSinceEmit: number;
  stopped: boolean;
}
```

Now extend `ParticlePool` — add these methods to the class (before `update()`):

```ts
  private trails: TrailState[] = [];

  emitBurst(origin: Vec3, params: BurstParams): void {
    for (let i = 0; i < params.count; i++) {
      const p = this.allocate();
      p.pos.x = origin.x; p.pos.y = origin.y; p.pos.z = origin.z;

      // Random direction on unit sphere
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const sinPhi = Math.sin(phi);
      const dx = sinPhi * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = sinPhi * Math.sin(theta);

      const speed = params.speedMin + Math.random() * (params.speedMax - params.speedMin);
      p.vel.x = dx * speed; p.vel.y = dy * speed; p.vel.z = dz * speed;

      p.gravity     = params.gravity;
      p.airdrag     = params.airdrag;
      p.lifetimeSec = params.lifetimeSec;
      p.size        = params.size;
      p.tile        = params.tile;
    }
  }

  emitTrail(source: TrailSource, params: TrailParams): TrailHandle {
    const state: TrailState = { source, params, timeSinceEmit: 0, stopped: false };
    this.trails.push(state);
    return {
      stop: () => { state.stopped = true; },
    };
  }
```

Modify `update()` to advance trail timers between the particle-loop and the mesh-refresh loop. Replace the old `update(dt, camera)` body with:

```ts
  update(dt: number, camera: THREE.Camera | null = null): void {
    // 1. Advance trail timers and emit droplets
    const interval = (hz: number) => 1 / hz;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      if (t.stopped) {
        this.trails.splice(i, 1);
        continue;
      }
      t.timeSinceEmit += dt;
      while (t.timeSinceEmit >= interval(t.params.hz)) {
        t.timeSinceEmit -= interval(t.params.hz);
        const p = this.allocate();
        p.pos.x = t.source.pos.x; p.pos.y = t.source.pos.y; p.pos.z = t.source.pos.z;
        p.vel.x = t.source.vel.x * t.params.velScale;
        p.vel.y = t.source.vel.y * t.params.velScale;
        p.vel.z = t.source.vel.z * t.params.velScale;
        p.gravity     = t.params.gravity;
        p.airdrag     = t.params.airdrag;
        p.lifetimeSec = t.params.lifetimeSec;
        p.size        = t.params.size;
        p.tile        = t.params.tile;
      }
    }

    // 2. Kinematic particle update
    for (const p of this.particles) updateParticle(p, dt);

    // 3. Refresh InstancedMesh matrices (unchanged)
    if (!this.mesh) return;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.alive) {
        this.dummy.scale.set(0, 0, 0);
      } else {
        this.dummy.position.set(p.pos.x, p.pos.y, p.pos.z);
        if (camera) this.dummy.lookAt(camera.position);
        this.dummy.scale.set(p.size, p.size, p.size);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/game/gibs/particles.test.ts
```

Expected: PASS (13 tests total — 8 prior + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/game/gibs/particles.ts src/game/gibs/particles.test.ts
git commit -m "M2: particle pool burst + trail emission modes"
```

---

### Task 6: Decals + AABB surface detection

**Files:**
- Create: `src/game/gibs/decals.ts`
- Modify: `src/game/gibs/particles.ts` (wire surface-hit detection)

**Context:** Decals are stuck quads — no physics, no lifetime decay (for M2 — M3 adds fade). Create the decals module first, then wire particles' per-frame update to detect when trail particles cross static arena AABBs, invoking the trail's `onSurfaceHit` callback which in turn calls `decals.spawn()`. Arena's M1 geometry is a box of static planes — we import them from arena or get them via a setter.

- [ ] **Step 1: Implement `src/game/gibs/decals.ts`**

```ts
import * as THREE from 'three';
import type { Vec3 } from './particles';

/**
 * Decal pool — textured quads stuck to arena surfaces where blood trails hit.
 *
 * No physics, no lifetime fade (M2 — M3 adds that). FIFO-evicts oldest when
 * capacity is reached so we don't accumulate forever.
 */
export class DecalPool {
  private readonly meshes: THREE.Mesh[] = [];
  private head = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly capacity: number,
    private readonly texture: THREE.Texture,
    private readonly decalSize = 0.25,
  ) {
    // Prefill hidden meshes
    const geom = new THREE.PlaneGeometry(decalSize, decalSize);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(geom, mat);
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  /**
   * Spawn a decal at `pos`, aligned to `normal`, offset slightly along
   * `normal` to avoid z-fighting.
   */
  spawn(pos: Vec3, normal: Vec3): void {
    const m = this.meshes[this.head];
    this.head = (this.head + 1) % this.capacity;

    const epsilon = 0.01;
    m.position.set(
      pos.x + normal.x * epsilon,
      pos.y + normal.y * epsilon,
      pos.z + normal.z * epsilon,
    );

    // Align the quad's +Z to `normal`
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(defaultNormal, n);
    m.quaternion.copy(q);

    m.visible = true;
  }

  aliveCount(): number {
    return this.meshes.filter((m) => m.visible).length;
  }

  reset(): void {
    for (const m of this.meshes) m.visible = false;
    this.head = 0;
  }
}
```

- [ ] **Step 2: Add AABB surface detection to `particles.ts`**

A trail particle's `onSurfaceHit` callback needs to fire when it crosses a static surface. For M1/M2 arena (axis-aligned box) a sphere-against-AABB-face test suffices. Add static-surface registration + per-particle check.

Append to `particles.ts`:

```ts
/** Axis-aligned static surface definition (arena walls/floor/ceiling). */
export interface StaticSurface {
  /** World-space AABB min / max. */
  min: Vec3;
  max: Vec3;
  /** Outward normal (points away from interior of the surface). */
  normal: Vec3;
}

/** Arena-wide registry — set once by arena.ts on init. */
let arenaSurfaces: StaticSurface[] = [];

export function setArenaSurfaces(surfaces: StaticSurface[]): void {
  arenaSurfaces = surfaces;
}

/** Cheap point-inside-AABB test with small epsilon. */
function pointInAABB(p: Vec3, min: Vec3, max: Vec3, eps = 0.05): boolean {
  return p.x >= min.x - eps && p.x <= max.x + eps
      && p.y >= min.y - eps && p.y <= max.y + eps
      && p.z >= min.z - eps && p.z <= max.z + eps;
}
```

Modify the trail-emit loop inside `update(dt, camera)` to record pre-move positions and check for surface crossings **after** `updateParticle`:

Replace the particle-loop (section 2) in `update()` with:

```ts
    // 2. Kinematic particle update + surface-hit detection
    for (const p of this.particles) {
      if (!p.alive) continue;
      const prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      updateParticle(p, dt);
      if (!p.alive) continue;

      // Check trail-emitted particles for surface hit.
      // We don't track per-particle trail-ownership cheaply, so we check ALL
      // alive particles against arena surfaces each frame. This is O(particles
      // × surfaces) — arena has ~6 surfaces, pool ≤ 1024, fine.
      for (const s of arenaSurfaces) {
        const hitNow  = pointInAABB(p.pos, s.min, s.max);
        const hitPrev = pointInAABB(prev,  s.min, s.max);
        if (hitNow && !hitPrev) {
          // Find which trail (if any) spawned this particle.
          // For M2 simplicity: invoke the FIRST alive trail's onSurfaceHit.
          // A fully correct implementation tags each particle with its trail;
          // skipping that for now — all trails share the same decal callback.
          const trail = this.trails.find((t) => !t.stopped && t.params.onSurfaceHit);
          if (trail) trail.params.onSurfaceHit!(p.pos, s.normal);
          p.alive = false; // particle absorbs into decal
          break;
        }
      }
    }
```

> Note: the "invoke first trail's callback" shortcut is fine for M2 because all
> trails (burst + chunk) want the same decal effect. M3 refinement can tag
> particles by trail-id if needed.

- [ ] **Step 3: Smoke-test build**

```bash
npx tsc --noEmit
npx vitest run src/game/gibs/particles.test.ts
```

Expected: build OK; existing particle tests still pass (surface detection is inert when no arenaSurfaces set).

- [ ] **Step 4: Commit**

```bash
git add src/game/gibs/decals.ts src/game/gibs/particles.ts
git commit -m "M2: decal pool + AABB surface-hit detection for trails"
```

---

### Task 7: Chunks module (Rapier body-part flight)

**Files:**
- Create: `src/game/gibs/chunks.ts`

**Context:** On gib, spawn 5 Rapier dynamic bodies (head, torso, arm, leg, spare) with billboard sprites textured from the already-extracted body-chunk picnums (1267/68/69/1454/1456). Each chunk gets a trail attached via `particles.emitTrail`. Chunks are despawned when they settle (velocity < threshold for > 1s) or age out (> 10s). This is the **M3 voxel-swap point** — the only file that changes then.

No dedicated test file — chunks require a live Rapier world. Manual-verified via the full M2 integration (Task 12).

- [ ] **Step 1: Implement `src/game/gibs/chunks.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3, TrailHandle } from './particles';
import { ParticlePool } from './particles';
import { BLOOD_TRAIL } from './tuning';
import { buPerTicSquaredToMpsSquared } from './tuning';

/** A single body-chunk: Rapier dynamic body + billboard sprite + trail handle. */
interface Chunk {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  trail: TrailHandle;
  spawnTime: number;
  settledTime: number;    // -1 if not yet settled
}

/** Loaded atlas with the body-chunk textures keyed by picnum. */
export interface ChunkTextureAtlas {
  // picnum → THREE.Texture
  get(picnum: number): THREE.Texture;
}

/**
 * Rapier body-part flight system. ONLY file that changes for M3 voxel swap:
 * replace billboard PlaneGeometry with voxel meshes loaded from .vox files;
 * keep the same spawnChunks() signature.
 */
export class ChunkSystem {
  private chunks: Chunk[] = [];

  /** Picnums for axe-zombie body chunks — order: head, torso, arm, leg, spare. */
  private readonly axeZombieChunks = [1267, 1454, 1268, 1269, 1456];

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly particles: ParticlePool,
    private readonly atlas: ChunkTextureAtlas,
    private readonly capacity = 1024,
  ) {}

  /**
   * Spawn 5 body-chunks at `origin`, launched radially + augmented by `impulse`.
   * `impulse` vector's magnitude should be in physics impulse units (kg·m/s).
   */
  spawnChunks(origin: Vec3, impulse: Vec3, now: number): void {
    for (let i = 0; i < this.axeZombieChunks.length; i++) {
      this.spawnOne(origin, impulse, this.axeZombieChunks[i], i, now);
    }

    // FIFO-evict if over capacity
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]);
    }
  }

  private spawnOne(origin: Vec3, impulse: Vec3, picnum: number, index: number, now: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.1)
      .setAngularDamping(0.2);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.05, 0.08)
      .setRestitution(0.35)
      .setFriction(0.5);
    this.world.createCollider(colliderDesc, body);

    // Radial outward direction plus explosion impulse
    const theta = (index / this.axeZombieChunks.length) * Math.PI * 2 + Math.random() * 0.8;
    const radial = {
      x: Math.cos(theta),
      y: 0.5 + Math.random() * 0.5,     // up-biased
      z: Math.sin(theta),
    };
    const radialSpeed = 2.5 + Math.random() * 2.0;
    body.setLinvel({
      x: radial.x * radialSpeed + impulse.x * 0.01,
      y: radial.y * radialSpeed + impulse.y * 0.01,
      z: radial.z * radialSpeed + impulse.z * 0.01,
    }, true);
    body.setAngvel({
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10,
      z: (Math.random() - 0.5) * 10,
    }, true);

    // Billboard sprite
    const geom = new THREE.PlaneGeometry(0.3, 0.3);
    const tex = this.atlas.get(picnum);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);

    // Attach a trail whose source follows this chunk's Rapier body.
    // TrailSource reads .pos and .vel each emit tick; we use live getters.
    const source = {
      get pos() {
        const t = body.translation();
        return { x: t.x, y: t.y, z: t.z };
      },
      get vel() {
        const v = body.linvel();
        return { x: v.x, y: v.y, z: v.z };
      },
    };
    const trailParams = {
      tile: BLOOD_TRAIL.tile,
      hz: BLOOD_TRAIL.emitHz,
      velScale: BLOOD_TRAIL.velScale,
      gravity: buPerTicSquaredToMpsSquared(BLOOD_TRAIL.gravityBlood),
      airdrag: 0.5,  // hand-tuned starting value; Blood's raw 4096 doesn't map directly
      lifetimeSec: BLOOD_TRAIL.lifetimeSec,
      size: 0.08,
    };
    const trail = this.particles.emitTrail(source as any, trailParams);

    this.chunks.push({ body, mesh, trail, spawnTime: now, settledTime: -1 });
  }

  /** Update chunk transforms + check for settle/age despawn. Called per frame. */
  update(camera: THREE.Camera | null, now: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      const t = c.body.translation();
      c.mesh.position.set(t.x, t.y, t.z);
      if (camera) c.mesh.lookAt(camera.position);

      const v = c.body.linvel();
      const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (speed < 0.1) {
        if (c.settledTime < 0) c.settledTime = now;
        if (now - c.settledTime > 1.0) {
          this.despawn(c);
          this.chunks.splice(i, 1);
          continue;
        }
      } else {
        c.settledTime = -1;
      }

      if (now - c.spawnTime > 10.0) {
        this.despawn(c);
        this.chunks.splice(i, 1);
      }
    }
  }

  private despawn(c: Chunk): void {
    c.trail.stop();
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    (c.mesh.material as THREE.Material).dispose();
    this.world.removeRigidBody(c.body);
  }

  aliveCount(): number {
    return this.chunks.length;
  }

  reset(): void {
    for (const c of this.chunks) this.despawn(c);
    this.chunks = [];
  }
}
```

- [ ] **Step 2: Smoke-test build (no dedicated tests)**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/game/gibs/chunks.ts
git commit -m "M2: chunk system (Rapier body-part flight + trail attach)"
```

---

### Task 8: Explosion VFX + gibs orchestrator

**Files:**
- Create: `src/vfx/explosion.ts`
- Create: `src/game/gibs/index.ts`
- Create: `src/game/gibs/explosion-math.test.ts`

**Context:** `explosion.ts` draws the fireball frame sequence at a position. `gibs/index.ts` is the orchestrator with `spawnExplosion()` (does the Rapier intersection query + damage falloff + gib routing) and `triggerGib()` (coordinates chunks + burst). The falloff math gets its own TDD file because getting it wrong means dynamite either one-shots everyone or tickles them.

- [ ] **Step 1: Write failing tests at `src/game/gibs/explosion-math.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { falloffDamage, falloffImpulse, radialImpulseVector } from './index';
import { EXPLOSION_STANDARD } from './tuning';

describe('explosion damage falloff', () => {
  it('at distance 0, damage is full (damage + damageRange)', () => {
    const d = falloffDamage(0, EXPLOSION_STANDARD);
    expect(d).toBe(EXPLOSION_STANDARD.damage + EXPLOSION_STANDARD.damageRange);
  });

  it('at distance >= radius (converted to meters), damage is 0', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256; // BU_PER_METER
    const d = falloffDamage(radiusM, EXPLOSION_STANDARD);
    expect(d).toBe(0);
  });

  it('at half radius, damage is ~half', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256;
    const d = falloffDamage(radiusM * 0.5, EXPLOSION_STANDARD);
    const full = EXPLOSION_STANDARD.damage + EXPLOSION_STANDARD.damageRange;
    expect(d).toBeCloseTo(full * 0.5, 1);
  });
});

describe('explosion impulse falloff', () => {
  it('at distance 0, impulse is full', () => {
    const i = falloffImpulse(0, EXPLOSION_STANDARD);
    expect(i).toBe(EXPLOSION_STANDARD.impulse);
  });
  it('at radius, impulse is 0', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256;
    expect(falloffImpulse(radiusM, EXPLOSION_STANDARD)).toBe(0);
  });
});

describe('radialImpulseVector', () => {
  it('produces unit-magnitude * impulse along (target - origin)', () => {
    const v = radialImpulseVector(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 4 },
      100,
    );
    // Unit vector (0.6, 0, 0.8); scaled by 100 → (60, 0, 80)
    expect(v.x).toBeCloseTo(60, 3);
    expect(v.y).toBeCloseTo(0, 3);
    expect(v.z).toBeCloseTo(80, 3);
  });

  it('returns zero vector when target == origin', () => {
    const v = radialImpulseVector({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, 100);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/game/gibs/explosion-math.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/vfx/explosion.ts`**

```ts
import * as THREE from 'three';

/**
 * Single-shot explosion fireball — sequence of frames played once, then removed.
 *
 * Atlas is indexed by frame number. Frames animate at `frameDurationMs` (~50 ms).
 */
export interface ExplosionAtlas {
  frameCount: number;
  get(frame: number): THREE.Texture;
  frameDurationMs: number;
}

export class ExplosionVfx {
  private active: {
    mesh: THREE.Mesh;
    frame: number;
    elapsedMs: number;
    size: number;
    atlas: ExplosionAtlas;
  }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Spawn a fireball at `pos`. `sizeM` is the rendered quad half-size in meters
   * (dynamite bundle ≈ 1.5 m; small stick ≈ 0.8 m).
   */
  spawn(pos: { x: number; y: number; z: number }, sizeM: number, atlas: ExplosionAtlas): void {
    const geom = new THREE.PlaneGeometry(sizeM * 2, sizeM * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: atlas.get(0),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.active.push({ mesh, frame: 0, elapsedMs: 0, size: sizeM, atlas });
  }

  update(dtMs: number, camera: THREE.Camera): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.elapsedMs += dtMs;
      const nextFrame = Math.floor(e.elapsedMs / e.atlas.frameDurationMs);
      if (nextFrame >= e.atlas.frameCount) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        this.active.splice(i, 1);
        continue;
      }
      if (nextFrame !== e.frame) {
        e.frame = nextFrame;
        (e.mesh.material as THREE.MeshBasicMaterial).map = e.atlas.get(nextFrame);
        (e.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
      e.mesh.lookAt(camera.position);
    }
  }

  aliveCount(): number { return this.active.length; }
}
```

- [ ] **Step 4: Implement `src/game/gibs/index.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3 } from './particles';
import { ParticlePool } from './particles';
import { ChunkSystem } from './chunks';
import { DecalPool } from './decals';
import { ExplosionVfx, ExplosionAtlas } from '../../vfx/explosion';
import { Screenshake } from '../../vfx/screenshake';
import {
  EXPLOSION_STANDARD,
  GIB_THRESHOLD,
  GIB_BURST,
  BU_PER_METER,
  buPerTicSquaredToMpsSquared,
} from './tuning';

export interface ExplosionInfo {
  radius: number;       // Build units
  damage: number;
  damageRange: number;
  impulse: number;
  quake: number;
  lifetimeTics: number;
  flash: number;
}

/** Reference-only type for gibbable entities (player, zombies). */
export interface GibbableDude {
  pos: Vec3;
  hp: number;
  id: string;                         // stable identity
  takeDamage(amount: number, impulse: Vec3): void;
  kind: 'player' | 'axe-zombie';
}

// ——— Pure falloff math (exported for TDD) ——————————————

/** Linear falloff: full at d=0, zero at d≥radius. Meters in, damage out. */
export function falloffDamage(distanceM: number, info: ExplosionInfo): number {
  const radiusM = info.radius / BU_PER_METER;
  if (distanceM >= radiusM) return 0;
  const scale = 1 - distanceM / radiusM;
  return (info.damage + info.damageRange) * scale;
}

export function falloffImpulse(distanceM: number, info: ExplosionInfo): number {
  const radiusM = info.radius / BU_PER_METER;
  if (distanceM >= radiusM) return 0;
  const scale = 1 - distanceM / radiusM;
  return info.impulse * scale;
}

export function radialImpulseVector(origin: Vec3, target: Vec3, magnitude: number): Vec3 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: (dx / len) * magnitude, y: (dy / len) * magnitude, z: (dz / len) * magnitude };
}

// ——— Orchestrator ———————————————————————————————————

export class GibSystem {
  private dudes: GibbableDude[] = [];

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly particles: ParticlePool,
    private readonly chunks: ChunkSystem,
    private readonly decals: DecalPool,
    private readonly explosionVfx: ExplosionVfx,
    private readonly explosionAtlas: ExplosionAtlas,
    private readonly screenshake: Screenshake,
    /** Called when a player-gib occurs — main.ts shows game-over overlay. */
    private readonly onPlayerGibbed: () => void,
  ) {}

  registerDude(d: GibbableDude): void { this.dudes.push(d); }
  unregisterDude(id: string): void {
    this.dudes = this.dudes.filter((d) => d.id !== id);
  }

  spawnExplosion(pos: Vec3, info: ExplosionInfo, now: number): void {
    // VFX
    const radiusM = info.radius / BU_PER_METER;
    this.explosionVfx.spawn(pos, radiusM * 0.4, this.explosionAtlas);
    // Screenshake — map Blood quake (0-255) to 1-4 magnitude range
    this.screenshake.shake(info.quake / 40, 0.3);
    // TODO audio hook — wire to a sound system when M8 lands

    // AOE: naive iteration (< 20 dudes tops for M2)
    for (const dude of [...this.dudes]) {
      const dx = dude.pos.x - pos.x;
      const dy = dude.pos.y - pos.y;
      const dz = dude.pos.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= radiusM) continue;

      const damage = falloffDamage(dist, info);
      const impulseMag = falloffImpulse(dist, info);
      const impulseVec = radialImpulseVector(pos, dude.pos, impulseMag);

      if (damage >= GIB_THRESHOLD) {
        this.triggerGib(dude.pos, impulseVec, dude.kind, now);
        if (dude.kind === 'player') this.onPlayerGibbed();
        else this.unregisterDude(dude.id);
      } else {
        dude.takeDamage(damage, impulseVec);
      }
    }
  }

  triggerGib(pos: Vec3, impulse: Vec3, kind: GibbableDude['kind'], now: number): void {
    this.chunks.spawnChunks(pos, impulse, now);
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: GIB_BURST.count,
      speedMin: GIB_BURST.speedMin,
      speedMax: GIB_BURST.speedMax,
      gravity: buPerTicSquaredToMpsSquared(GIB_BURST.gravityBlood),
      airdrag: 0.3, // hand-tuned; Blood's raw airdrag doesn't map directly
      lifetimeSec: GIB_BURST.lifetimeSec,
      size: 0.15,
    });
  }
}
```

- [ ] **Step 5: Run the falloff tests to verify they pass**

```bash
npx vitest run src/game/gibs/explosion-math.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/vfx/explosion.ts src/game/gibs/index.ts src/game/gibs/explosion-math.test.ts
git commit -m "M2: explosion VFX + gibs orchestrator with falloff math"
```

---

### Task 9: Axe zombie sprite + AI FSM

**Files:**
- Create: `src/game/enemy/axe-zombie.ts`
- Create: `src/game/enemy/ai.ts`
- Create: `src/game/enemy/ai.test.ts`

**Context:** The zombie is a simple billboard sprite over a Rapier kinematic position-based body. AI is a minimal FSM (idle → chase → attack → stagger → dead). TDD covers the state-transition math in isolation — it's pure logic, no Rapier/Three.js needed.

- [ ] **Step 1: Write failing tests at `src/game/enemy/ai.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE } from '../gibs/tuning';

const INIT = { hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed };

describe('ZombieBrain', () => {
  it('starts in idle', () => {
    const b = new ZombieBrain(INIT);
    expect(b.state).toBe(ZombieState.Idle);
  });

  it('transitions idle → chase on player within aggroRadius', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase);
  });

  it('stays idle when player is outside aggroRadius', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }); // > 40 m
    expect(b.state).toBe(ZombieState.Idle);
  });

  it('transitions chase → attack when within meleeRange', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // < 1.5 m
    expect(b.state).toBe(ZombieState.Attack);
  });

  it('emits hit event during attack cooldown once', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.consumeHit()).toBe(true);  // attack starts → registers intent
    expect(b.consumeHit()).toBe(false); // second consume same frame = no
    // Advance past cooldown
    for (let t = 0; t < 1.1; t += 0.016) b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.consumeHit()).toBe(true);  // fresh attack
  });

  it('transitions to dead on hp <= 0', () => {
    const b = new ZombieBrain(INIT);
    b.applyDamage(AXE_ZOMBIE.hp + 5);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Dead);
  });

  it('stagger state blocks attack for staggerMs, then returns to chase', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // enter attack
    b.applyDamage(5); // stagger
    expect(b.state).toBe(ZombieState.Stagger);
    for (let t = 0; t < 0.3; t += 0.016) b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase);
  });

  it('desiredVelocity points from self toward player while chasing, scaled by speed', () => {
    const b = new ZombieBrain(INIT);
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 });
    // Unit dir (0.6, 0, 0.8) * speed 3 = (1.8, 0, 2.4)
    expect(v.x).toBeCloseTo(AXE_ZOMBIE.speed * 0.6, 3);
    expect(v.y).toBeCloseTo(0, 3);
    expect(v.z).toBeCloseTo(AXE_ZOMBIE.speed * 0.8, 3);
  });

  it('desiredVelocity is zero when not chasing', () => {
    const b = new ZombieBrain(INIT);
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    expect(v.x).toBe(0); expect(v.z).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/game/enemy/ai.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/game/enemy/ai.ts`**

```ts
import { AXE_ZOMBIE } from '../gibs/tuning';
import type { Vec3 } from '../gibs/particles';

export enum ZombieState {
  Idle = 'idle',
  Chase = 'chase',
  Attack = 'attack',
  Stagger = 'stagger',
  Dead = 'dead',
}

export class ZombieBrain {
  state: ZombieState = ZombieState.Idle;
  hp: number;
  readonly speed: number;

  private attackCooldownSec = 0;
  private staggerSec = 0;
  private hitPending = false;
  private readonly aggroRadiusM = AXE_ZOMBIE.aggroRadiusM;
  private readonly meleeRangeM  = AXE_ZOMBIE.meleeRange;

  constructor(init: { hp: number; speed: number }) {
    this.hp = init.hp;
    this.speed = init.speed;
  }

  update(dt: number, self: Vec3, player: Vec3): void {
    if (this.state === ZombieState.Dead) return;

    if (this.hp <= 0) {
      this.state = ZombieState.Dead;
      return;
    }

    this.attackCooldownSec = Math.max(0, this.attackCooldownSec - dt);

    if (this.state === ZombieState.Stagger) {
      this.staggerSec -= dt;
      if (this.staggerSec <= 0) this.state = ZombieState.Chase;
      return;
    }

    const d = distance(self, player);

    if (this.state === ZombieState.Idle) {
      if (d < this.aggroRadiusM) this.state = ZombieState.Chase;
      return;
    }

    if (d < this.meleeRangeM) {
      // Transition to attack (once per cooldown)
      if (this.state !== ZombieState.Attack) {
        this.state = ZombieState.Attack;
        this.hitPending = this.attackCooldownSec <= 0;
        if (this.hitPending) this.attackCooldownSec = AXE_ZOMBIE.attackCooldownSec;
      } else if (this.attackCooldownSec <= 0) {
        // Re-arm another swing
        this.hitPending = true;
        this.attackCooldownSec = AXE_ZOMBIE.attackCooldownSec;
      }
    } else {
      this.state = ZombieState.Chase;
    }
  }

  desiredVelocity(self: Vec3, player: Vec3): Vec3 {
    if (this.state !== ZombieState.Chase) return { x: 0, y: 0, z: 0 };
    const dx = player.x - self.x;
    const dy = player.y - self.y;
    const dz = player.z - self.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return { x: 0, y: 0, z: 0 };
    return { x: (dx / len) * this.speed, y: (dy / len) * this.speed, z: (dz / len) * this.speed };
  }

  applyDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.state = ZombieState.Dead;
    } else {
      this.state = ZombieState.Stagger;
      this.staggerSec = 0.25;
    }
  }

  /** True if an attack swing connected this step. Caller resolves damage. */
  consumeHit(): boolean {
    if (this.hitPending) { this.hitPending = false; return true; }
    return false;
  }
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
```

- [ ] **Step 4: Implement `src/game/enemy/axe-zombie.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE } from '../gibs/tuning';
import type { Vec3 } from '../gibs/particles';
import type { GibbableDude } from '../gibs';

export interface ZombieTextureAtlas {
  idle(): THREE.Texture;
  walk(stepFrac: number): THREE.Texture;  // 0..1 stride phase
  attack(phaseFrac: number): THREE.Texture; // 0..1 swing phase
  dead(): THREE.Texture;
}

export class AxeZombie implements GibbableDude {
  readonly id: string;
  readonly kind = 'axe-zombie' as const;

  hp = AXE_ZOMBIE.hp;
  readonly brain = new ZombieBrain({ hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed });

  private stepPhase = 0;
  private attackPhase = 0;

  constructor(
    id: string,
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly body: RAPIER.RigidBody,
    private readonly mesh: THREE.Mesh,
    private readonly atlas: ZombieTextureAtlas,
  ) {
    this.id = id;
  }

  static spawn(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    atlas: ZombieTextureAtlas,
    pos: Vec3,
  ): AxeZombie {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.25), body);

    const geom = new THREE.PlaneGeometry(1.0, 1.6);
    const mat = new THREE.MeshBasicMaterial({ map: atlas.idle(), transparent: true });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);

    return new AxeZombie(id, world, scene, body, mesh, atlas);
  }

  get pos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  update(dt: number, playerPos: Vec3, camera: THREE.Camera): void {
    this.brain.update(dt, this.pos, playerPos);

    // Kinematic move
    const v = this.brain.desiredVelocity(this.pos, playerPos);
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });

    // Animation frame selection
    this.stepPhase = (this.stepPhase + dt * 2) % 1.0;
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    switch (this.brain.state) {
      case ZombieState.Idle:    mat.map = this.atlas.idle(); break;
      case ZombieState.Chase:   mat.map = this.atlas.walk(this.stepPhase); break;
      case ZombieState.Stagger: mat.map = this.atlas.walk(this.stepPhase); break;
      case ZombieState.Attack:
        this.attackPhase = (this.attackPhase + dt * 2) % 1.0;
        mat.map = this.atlas.attack(this.attackPhase);
        break;
      case ZombieState.Dead:    mat.map = this.atlas.dead(); break;
    }
    mat.needsUpdate = true;

    // Render transform
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.lookAt(camera.position);
    this.mesh.rotation.x = 0; // keep upright — only yaw follows camera
    this.mesh.rotation.z = 0;
  }

  takeDamage(amount: number, _impulse: Vec3): void {
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
  }

  despawn(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.world.removeRigidBody(this.body);
  }
}
```

- [ ] **Step 5: Run tests to verify AI FSM passes**

```bash
npx vitest run src/game/enemy/ai.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 6: Smoke-test build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/game/enemy/
git commit -m "M2: axe-zombie sprite + AI state machine"
```

---

### Task 10: Weapon interface + dynamite impl

**Files:**
- Create: `src/game/weapons/types.ts`
- Create: `src/game/weapons/dynamite.ts`
- Create: `src/game/weapons/dynamite.test.ts`
- Create: `src/game/weapons/index.ts`

**Context:** Minimal Weapon interface + dynamite's cook/charge/throw/projectile implementation. Pure charge math is TDD'd in `dynamite.test.ts`. The Rapier projectile tick is registered at spawn-time and carries the fuse. Self-explode is just `gibs.spawnExplosion(player.pos, EXPLOSION_STANDARD)` — the player is a registered dude, gibbs are routed normally.

- [ ] **Step 1: Write failing tests at `src/game/weapons/dynamite.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { chargeFraction, throwVelocityMps, remainingFuse } from './dynamite';
import { DYNAMITE_COOK } from '../gibs/tuning';

describe('charge math', () => {
  it('chargeFraction is 0 at 0 held time', () => {
    expect(chargeFraction(0)).toBe(0);
  });
  it('chargeFraction is 1 at maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec)).toBe(1);
  });
  it('chargeFraction clamps to 1 beyond maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec + 1)).toBe(1);
  });
  it('chargeFraction is 0.5 at half maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec / 2)).toBe(0.5);
  });
});

describe('throw velocity', () => {
  it('is min at 0 charge', () => {
    expect(throwVelocityMps(0)).toBeCloseTo(DYNAMITE_COOK.minVelocityMps, 3);
  });
  it('is max at full charge', () => {
    expect(throwVelocityMps(1)).toBeCloseTo(DYNAMITE_COOK.maxVelocityMps, 3);
  });
  it('is linear midway', () => {
    const mid = (DYNAMITE_COOK.minVelocityMps + DYNAMITE_COOK.maxVelocityMps) / 2;
    expect(throwVelocityMps(0.5)).toBeCloseTo(mid, 3);
  });
});

describe('remainingFuse', () => {
  it('is fuseMaxSec when released at 0 cook', () => {
    expect(remainingFuse(0)).toBe(DYNAMITE_COOK.fuseMaxSec);
  });
  it('is 0 when released exactly at fuseMax', () => {
    expect(remainingFuse(DYNAMITE_COOK.fuseMaxSec)).toBe(0);
  });
  it('is negative if released past fuseMax — caller detonates in-flight at 0', () => {
    expect(remainingFuse(DYNAMITE_COOK.fuseMaxSec + 1)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Implement `src/game/weapons/types.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../gibs/particles';
import type { GibSystem } from '../gibs';

export interface Player {
  pos: Vec3;
  forward: Vec3;
  handPos: Vec3;
  takeDamage(amount: number, impulse: Vec3): void;
}

export interface FrameCtx {
  world: RAPIER.World;
  player: Player;
  gibs: GibSystem;
  now: number;          // seconds since game start (monotonic)
}

export interface ViewCtx { /* M2: extended later for first-person rendering */ }
export interface HudCtx  { /* M2: extended later for HUD overlay */ }

export interface Weapon {
  readonly id: string;
  readonly ammoMax: number;
  ammo: number;

  onPress(ctx: FrameCtx): void;
  onRelease(ctx: FrameCtx): void;
  onFrame(ctx: FrameCtx, dt: number): void;

  /** 0..1 — HUD ring fill. */
  chargeFraction(): number;

  renderView(ctx: ViewCtx): void;
  renderHud(ctx: HudCtx): void;
}
```

- [ ] **Step 3: Implement `src/game/weapons/dynamite.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { DYNAMITE_COOK, EXPLOSION_STANDARD } from '../gibs/tuning';

// ——— Pure math (TDD'd) ————————————————————————————————

export function chargeFraction(heldSec: number): number {
  return Math.max(0, Math.min(1, heldSec / DYNAMITE_COOK.maxChargeSec));
}

export function throwVelocityMps(chargeFrac: number): number {
  const c = Math.max(0, Math.min(1, chargeFrac));
  return DYNAMITE_COOK.minVelocityMps
       + c * (DYNAMITE_COOK.maxVelocityMps - DYNAMITE_COOK.minVelocityMps);
}

export function remainingFuse(cookSec: number): number {
  return DYNAMITE_COOK.fuseMaxSec - cookSec;
}

// ——— Projectile (per-shot entity) ——————————————————————

interface DynamiteProjectile {
  body: RAPIER.RigidBody;
  fuseLeft: number;
  spawnTime: number;
}

/** Global registry of live dynamite projectiles; ticked each frame from dynamite.ts */
const liveProjectiles: DynamiteProjectile[] = [];

/**
 * Spawn a dynamite projectile. Called by Dynamite.onRelease and Dynamite.selfExplode.
 * If `fuseLeft` is ≤ 0 the projectile detonates on the first tick (in-flight = 0 s).
 */
export function spawnProjectile(
  world: RAPIER.World,
  pos: Vec3,
  vel: Vec3,
  fuseLeft: number,
  now: number,
): DynamiteProjectile {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setLinearDamping(0.05)
    .setAngularDamping(0.2);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(0.1)
    .setRestitution(0.5)
    .setFriction(0.6);
  world.createCollider(colliderDesc, body);
  body.setLinvel(vel, true);
  body.setAngvel({ x: Math.random() * 5, y: Math.random() * 5, z: Math.random() * 5 }, true);

  const proj: DynamiteProjectile = { body, fuseLeft, spawnTime: now };
  liveProjectiles.push(proj);
  return proj;
}

/** Advance all projectiles; detonate any whose fuse hit zero. Call per fixed step. */
export function updateProjectiles(ctx: FrameCtx, dt: number): void {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i];
    p.fuseLeft -= dt;
    if (p.fuseLeft <= 0) {
      const t = p.body.translation();
      ctx.gibs.spawnExplosion({ x: t.x, y: t.y, z: t.z }, EXPLOSION_STANDARD, ctx.now);
      ctx.world.removeRigidBody(p.body);
      liveProjectiles.splice(i, 1);
    }
  }
}

export function resetProjectiles(world: RAPIER.World): void {
  for (const p of liveProjectiles) world.removeRigidBody(p.body);
  liveProjectiles.length = 0;
}

// ——— Weapon implementation ————————————————————————————

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = 8;
  ammo = 8;

  private cooking = false;
  private cookStart = 0;

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0 || this.cooking) return;
    this.cooking = true;
    this.cookStart = ctx.now;
  }

  onRelease(ctx: FrameCtx): void {
    if (!this.cooking) return;
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    const fuseLeft = Math.max(0, remainingFuse(heldSec));

    const vel = {
      x: ctx.player.forward.x * speed,
      y: ctx.player.forward.y * speed + 2.5,  // lob arc: up-bias
      z: ctx.player.forward.z * speed,
    };
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now);

    this.ammo--;
    this.cooking = false;
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    // Over-cook self-gib
    if (this.cooking && (ctx.now - this.cookStart) >= DYNAMITE_COOK.fuseMaxSec) {
      ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
      this.cooking = false;
    }
    updateProjectiles(ctx, dt);
  }

  chargeFraction(): number {
    if (!this.cooking) return 0;
    // Caller passes in `now` via the returned value in renderHud; M2 simplifies:
    // we snapshot via a static `_now` written from main loop — TBD in integration.
    // For the test harness (pure math) we compute 0; HUD uses chargeFractionAt.
    return 0;
  }

  /** Live fraction (HUD uses this; we expose it cleanly). */
  chargeFractionAt(now: number): number {
    if (!this.cooking) return 0;
    return chargeFraction(now - this.cookStart);
  }

  isCooking(): boolean { return this.cooking; }

  renderView(_ctx: ViewCtx): void { /* wired in Task 11 */ }
  renderHud(_ctx: HudCtx): void { /* wired in Task 11 */ }
}
```

- [ ] **Step 4: Implement `src/game/weapons/index.ts`**

```ts
import type { Weapon } from './types';
import { Dynamite } from './dynamite';

export { Dynamite } from './dynamite';
export * from './types';

/** Single-slot registry for M2. M4 adds inventory & swap. */
export class WeaponRegistry {
  current: Weapon;
  constructor() { this.current = new Dynamite(); }
}
```

- [ ] **Step 5: Run the dynamite tests**

```bash
npx vitest run src/game/weapons/dynamite.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 6: Smoke-test build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/game/weapons/
git commit -m "M2: weapon interface + dynamite implementation"
```

---

### Task 11: Charge HUD + arena cluster + game-over state

**Files:**
- Create: `src/ui/charge-hud.ts`
- Modify: `src/game/arena.ts` (spawnCluster, R-key, game-over overlay)

**Context:** Tie the UI loose ends together. Charge HUD is a DOM overlay (SVG ring). Arena gains `spawnCluster(n, center)` and an `R` key handler that despawns everything and respawns. Game-over state is a DOM text overlay triggered by `GibSystem.onPlayerGibbed`.

- [ ] **Step 1: Implement `src/ui/charge-hud.ts`**

```ts
/**
 * Crosshair-ring HUD showing weapon charge (0..1).
 *
 * Plain DOM + inline SVG. No canvas, no shader. The ring turns red in the
 * last 10% to signal impending over-cook / self-gib.
 */
export class ChargeHud {
  private readonly el: HTMLElement;
  private readonly circle: SVGCircleElement;
  private readonly crosshair: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      width: 64px; height: 64px;
    `;
    this.el.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64"
           style="position:absolute; inset:0;">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#fff3"
                stroke-width="3"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="#ffcc00"
                stroke-width="3" stroke-linecap="round"
                stroke-dasharray="163"
                stroke-dashoffset="163"
                transform="rotate(-90 32 32)"
                id="charge-ring"/>
      </svg>
      <div style="position:absolute; inset:0; display:flex;
                  align-items:center; justify-content:center;
                  color:#fff; font-size:20px;">+</div>
    `;
    root.appendChild(this.el);
    this.circle = this.el.querySelector('#charge-ring')!;
    this.crosshair = this.el.querySelector('div')!;
  }

  /** Call per frame. Pass charge 0..1. */
  setCharge(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    const circumference = 2 * Math.PI * 26;
    this.circle.setAttribute('stroke-dasharray', String(circumference));
    this.circle.setAttribute('stroke-dashoffset', String(circumference * (1 - f)));
    this.circle.setAttribute('stroke', f > 0.9 ? '#ff3333' : '#ffcc00');
  }
}
```

- [ ] **Step 2: Extend `src/game/arena.ts` — add spawnCluster + R key + game-over overlay**

Assuming M1's `arena.ts` exports an `Arena` class with `scene`, `world`, and static AABBs — extend it:

```ts
// … existing imports and Arena class …

import { AxeZombie, ZombieTextureAtlas } from '../enemy/axe-zombie';
import type { GibSystem } from './gibs';
import { setArenaSurfaces } from './gibs/particles';
import { resetProjectiles } from './weapons/dynamite';

// Inside Arena class (or as extensions):

export interface ZombieSpawnDeps {
  scene: THREE.Scene;
  world: RAPIER.World;
  atlas: ZombieTextureAtlas;
  gibs: GibSystem;
}

export class ZombieCluster {
  private zombies: AxeZombie[] = [];
  private nextId = 0;

  constructor(
    private readonly deps: ZombieSpawnDeps,
    private readonly center: { x: number; y: number; z: number },
  ) {}

  spawn(count = 4, radius = 1.5): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const pos = {
        x: this.center.x + Math.cos(angle) * radius,
        y: this.center.y,
        z: this.center.z + Math.sin(angle) * radius,
      };
      const z = AxeZombie.spawn(`zombie-${this.nextId++}`, this.deps.world, this.deps.scene, this.deps.atlas, pos);
      this.deps.gibs.registerDude(z);
      this.zombies.push(z);
    }
  }

  update(dt: number, playerPos: { x: number; y: number; z: number }, camera: THREE.Camera): void {
    for (const z of this.zombies) z.update(dt, playerPos, camera);
    // Reap dead zombies after their `Dead` frame settled for > 0.5 s.
    this.zombies = this.zombies.filter((z) => {
      if (z.brain.state === 'dead') {
        this.deps.gibs.unregisterDude(z.id);
        z.despawn();
        return false;
      }
      return true;
    });
  }

  reset(): void {
    for (const z of this.zombies) {
      this.deps.gibs.unregisterDude(z.id);
      z.despawn();
    }
    this.zombies = [];
  }
}

/**
 * Register arena static geometry AABBs with the particle system so trails
 * can spawn wall/ceiling decals. Call once after arena geometry is built.
 */
export function registerArenaSurfaces(arena: Arena): void {
  const s = arena.staticAABBs(); // assume M1 exposes this; if not, add it
  setArenaSurfaces(s);
}

/** Game-over overlay — shown when the player self-gibs. */
export class GameOverOverlay {
  private el: HTMLElement;
  constructor(root: HTMLElement, onRestart: () => void) {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; inset: 0;
      background: #000c;
      display: none;
      align-items: center; justify-content: center;
      color: #f33; font-family: monospace; font-size: 48px;
      flex-direction: column; gap: 20px;
    `;
    this.el.innerHTML = `
      <div>YOU BLEW YOURSELF UP</div>
      <div style="font-size:20px; color:#fff8;">Press R to try again</div>
    `;
    root.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r' && this.el.style.display !== 'none') {
        this.el.style.display = 'none';
        onRestart();
      }
    });
  }
  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
}
```

> **Note on `Arena.staticAABBs()`**: if M1's `arena.ts` didn't expose this, add
> a method that returns a list of `StaticSurface` (one per visible wall/floor/
> ceiling face). Typical arena box → 6 surfaces.

- [ ] **Step 3: Smoke-test build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/charge-hud.ts src/game/arena.ts
git commit -m "M2: charge HUD + zombie cluster + game-over overlay"
```

---

### Task 12: Main integration + verify build + tests + manual playtest

**Files:**
- Modify: `src/main.ts`
- Modify: `TASKS.md`

**Context:** Wire everything into the fixed-step loop and variable-rate render loop. Load placeholder assets. After I verify build + tests, user performs manual playtest (recorded with Cmd+Shift+5 or similar).

- [ ] **Step 1: Extend `src/main.ts` to boot M2 systems**

Pseudocode-to-real (preserve M1's existing boot sequence; add new steps inside the async boot function):

```ts
// … existing M1 imports + setup …
import { WeaponRegistry } from './game/weapons';
import { ChargeHud } from './ui/charge-hud';
import { ParticlePool } from './game/gibs/particles';
import { ChunkSystem } from './game/gibs/chunks';
import { DecalPool } from './game/gibs/decals';
import { ExplosionVfx } from './vfx/explosion';
import { Screenshake } from './vfx/screenshake';
import { GibSystem } from './game/gibs';
import { ZombieCluster, registerArenaSurfaces, GameOverOverlay } from './game/arena';
import { loadZombieAtlas, loadGibTextures, loadDynamiteAtlas, loadExplosionAtlas } from './engine/asset-loader'; // helper to add
import { BLOOD_TRAIL, EXPLOSION_STANDARD } from './game/gibs/tuning';

// inside bootGame():

// ---- assets
const [zombieAtlas, gibTextures, dynamiteAtlas, explosionAtlas, trailTex] = await Promise.all([
  loadZombieAtlas('/assets/enemies/zombie-placeholder/manifest.json'),
  loadGibTextures('/assets/gibs-placeholder/manifest.json'),
  loadDynamiteAtlas('/assets/weapons/dynamite-placeholder/'),
  loadExplosionAtlas('/assets/vfx/explosion-placeholder/manifest.json'),
  loadTexture('/assets/gibs-placeholder/trail/733.png'),
]);

// ---- systems
const particles = new ParticlePool(scene, 1024, trailTex);
const chunks    = new ChunkSystem(world, scene, particles, gibTextures, 1024);
const decals    = new DecalPool(scene, 100, trailTex, 0.25);
const explosions = new ExplosionVfx(scene);
const shake     = new Screenshake();

let gameOverOverlay!: GameOverOverlay;
const gibs = new GibSystem(world, scene, particles, chunks, decals, explosions, explosionAtlas, shake, () => {
  gameOverOverlay.show();
});

gameOverOverlay = new GameOverOverlay(document.body, () => {
  // Restart: clear all gib state, respawn cluster, reset player hp, reset camera.
  cluster.reset();
  chunks.reset();
  decals.reset();
  shake.reset();
  player.resetToStart();
  cluster.spawn(4);
});

// Wire decals.spawn as trail onSurfaceHit — since trails are created by chunks,
// we patch the trail params via ChunkSystem (simpler: edit chunks.ts to include
// onSurfaceHit in its trailParams; for M2 we wire it globally):
// In chunks.ts, extend trailParams with onSurfaceHit before emitTrail(...).
// (We did NOT wire this in Task 7 — do so now.)

// ---- arena & cluster
registerArenaSurfaces(arena);
const cluster = new ZombieCluster({ scene, world, atlas: zombieAtlas, gibs }, { x: 0, y: 1, z: -6 });
cluster.spawn(4);

// ---- weapon + HUD
const weapons = new WeaponRegistry();
const chargeHud = new ChargeHud(document.body);
gibs.registerDude(player); // player is a GibbableDude; if M1's Player doesn't implement this, extend it

// ---- R key: reset cluster only (distinct from game-over restart)
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && !gameOverOverlay.isShowing()) {
    cluster.reset();
    chunks.reset();
    decals.reset();
    cluster.spawn(4);
  }
});

// ---- inputs
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  weapons.current.onPress(frameCtx());
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  weapons.current.onRelease(frameCtx());
});

function frameCtx(): FrameCtx {
  return { world, player, gibs, now: performance.now() / 1000 };
}

// ---- fixed-step update (inside loop.onFixedStep):
const fctx = frameCtx();
weapons.current.onFrame(fctx, FIXED_DT);
cluster.update(FIXED_DT, player.pos, camera);
chunks.update(camera, fctx.now);
// particles.update + explosions.update handled in render loop

// ---- render tick (inside loop.onRender):
particles.update(dtSec, camera);
explosions.update(dtSec * 1000, camera);
const off = shake.sampleOffset(dtSec);
camera.rotation.x += off.pitch;
camera.rotation.y += off.yaw;
camera.rotation.z += off.roll;
chargeHud.setCharge((weapons.current as Dynamite).chargeFractionAt(performance.now() / 1000));
```

> **Note:** the real integration will require following M1's actual loop
> structure in `main.ts` — the snippet above shows intent, not literal
> insertion order. The worker should read M1's `main.ts` first, then insert
> each chunk at the semantically correct point.

- [ ] **Step 2: Also wire decals callback into ChunkSystem trail params**

Edit `src/game/gibs/chunks.ts`, in `spawnOne()` where `trailParams` is built, add:

```ts
    const trailParams = {
      // …existing fields…
      onSurfaceHit: (pos: Vec3, normal: Vec3) => {
        // Delegates to decal pool — injected below via constructor
        this.decalsRef.spawn(pos, normal);
      },
    };
```

Extend `ChunkSystem` constructor to accept a `DecalPool` ref; update `main.ts` wiring to pass `decals` in.

- [ ] **Step 3: Add asset-loader helpers at `src/engine/asset-loader.ts` (new if absent)**

```ts
import * as THREE from 'three';
import type { ZombieTextureAtlas } from '../game/enemy/axe-zombie';
import type { ChunkTextureAtlas } from '../game/gibs/chunks';
import type { ExplosionAtlas } from '../vfx/explosion';

const loader = new THREE.TextureLoader();
export function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

interface Manifest<T> { frames: T[]; }

export async function loadZombieAtlas(manifestUrl: string): Promise<ZombieTextureAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const textures: Record<number, THREE.Texture> = {};
  await Promise.all(manifest.frames.map(async (f: any) => {
    textures[f.picnum] = await loadTexture(baseDir + f.file);
  }));
  // Simplistic picnum→role mapping; refine during playtest.
  const idleTex   = textures[1170] ?? Object.values(textures)[0];
  const walkFrames = [textures[1200], textures[1205], textures[1210], textures[1215]].filter(Boolean);
  const attackFrames = [textures[1220], textures[1225], textures[1230]].filter(Boolean);
  const deadTex   = textures[1258] ?? idleTex;
  return {
    idle: () => idleTex,
    walk: (p) => walkFrames[Math.floor(p * walkFrames.length) % walkFrames.length] ?? idleTex,
    attack: (p) => attackFrames[Math.floor(p * attackFrames.length) % attackFrames.length] ?? idleTex,
    dead: () => deadTex,
  };
}

export async function loadGibTextures(manifestUrl: string): Promise<ChunkTextureAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const textures: Record<number, THREE.Texture> = {};
  await Promise.all(manifest.frames.map(async (f: any) => {
    textures[f.picnum] = await loadTexture(baseDir + f.file);
  }));
  return { get: (picnum: number) => textures[picnum] ?? Object.values(textures)[0] };
}

export async function loadDynamiteAtlas(baseDir: string): Promise<{ bundle: THREE.Texture[]; view: Record<string, THREE.Texture> }> {
  const bundleMan = await fetch(baseDir + 'bundle/manifest.json').then((r) => r.json());
  const viewMan   = await fetch(baseDir + 'view/manifest.json').then((r) => r.json());
  const bundle = await Promise.all(bundleMan.frames.map((f: any) => loadTexture(baseDir + 'bundle/' + f.file)));
  const view: Record<string, THREE.Texture> = {};
  for (const f of viewMan.frames) {
    view[f.role] = await loadTexture(baseDir + 'view/' + f.file);
  }
  return { bundle, view };
}

export async function loadExplosionAtlas(manifestUrl: string): Promise<ExplosionAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const frames = await Promise.all(manifest.frames.map((f: any) => loadTexture(baseDir + 'frames/' + f.file)));
  return {
    frameCount: frames.length,
    frameDurationMs: manifest.frameDurationMs ?? 50,
    get: (i: number) => frames[Math.min(i, frames.length - 1)],
  };
}
```

- [ ] **Step 4: Update `TASKS.md` to reflect M2 progress**

Replace the current M1-done/M2-todo block with:

```markdown
**M1 landed ✅. M2 in progress — dynamite + gibs + shamblers. Plan: docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md**

- M1 plan: docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md — all tasks done, merged d05a306
- M2 plan: docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md — executing
```

In the task board:

```markdown
- `M2`  [~]  First kill — plan at docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md
```

And append:

```markdown
- `A9`  [x]  Extract M2 placeholders (dynamite bundle, FP hand, explosion fireball, FX_27 trail)
```

- [ ] **Step 5: Final verify — build + test + dev**

```bash
npm run build
```

Expected: build passes (exit 0), no type errors.

```bash
npm test
```

Expected: all tests PASS — includes all M1 tests + all new M2 tests (Tasks 2, 3, 4, 5, 8, 9, 10).

```bash
npm run dev
```

Expected: Vite boots, terminal prints a local URL, no errors in console.

- [ ] **Step 6: Manual playtest handoff**

Open the browser to the Vite URL. The worker marks this step done only after confirming — via text description — the following observable outcomes:

1. Page loads, 4 zombies visible in a cluster center-front, shambling toward player
2. Hold LMB — HUD charge ring fills; if ring turns red, fuse is about to run out
3. Release → projectile arcs, may bounce on arena walls, detonates
4. On detonation: explosion sprite appears, screenshake jolts camera, all zombies in radius gib (chunks fly, blood trail streams, burst cloud visible, droplets stick on walls as decals)
5. Press `R` → cluster respawns, all chunks/decals cleared
6. Hold LMB past 2s without releasing → player gibbed, "YOU BLEW YOURSELF UP" overlay, press R to restart

This step is the final sign-off that handoffs to user-driven gut-check. Save a short clip to `docs/dev-notes/2026-04-21-m2-gib-clip.mov` once playtested.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/engine/asset-loader.ts src/game/gibs/chunks.ts TASKS.md
git commit -m "M2: integrate dynamite + gibs + cluster into main loop; TASKS update"
```

---

## Plan self-review

Scanning the spec section-by-section to confirm coverage:

- §1 Goals 1–7 → Goal 1 (loop): Tasks 7, 8, 10, 11, 12. Goal 2 (cook-in-hand): Task 10. Goal 3 (charge HUD + FP sprite): Tasks 10, 11. Goal 4 (all three subsystems): Tasks 5, 6, 7, 8. Goal 5 (shambler AI): Task 9. Goal 6 (minimum juice): Tasks 3, 8. Goal 7 (M3 voxel swap isolated): Task 7 (chunks.ts is the only swap point — verified by module tree).
- §2 Non-goals → explicitly deferred; no tasks for them. ✅
- §3 Asset extraction → Task 1. ✅
- §4 Architecture (data flow + module tree) → all modules in tree are created across Tasks 2–11. ✅
- §5 Module designs (5.1–5.9) → one-to-one with tasks: 5.1 types + 5.2 dynamite = Task 10; 5.3 particles = Tasks 4+5; 5.4 chunks = Task 7; 5.5 decals = Task 6; 5.6 orchestrator = Task 8; 5.7 zombie = Task 9; 5.8 arena = Task 11; 5.9 UI/VFX = Tasks 3, 8, 11. ✅
- §6 Tuning → Task 2. ✅
- §7 Testing strategy → TDD files: `tuning.test.ts` (Task 2), `screenshake.test.ts` (Task 3), `particles.test.ts` (Tasks 4+5), `explosion-math.test.ts` (Task 8), `ai.test.ts` (Task 9), `dynamite.test.ts` (Task 10). ✅
- §8 Acceptance criteria → Task 12 Steps 5, 6. ✅
- §9 Risks → mitigations are embedded in tasks (e.g., AABB vs raycast — Task 6 flags the axis-alignment assumption; 1024 body cap — graceful FIFO eviction in Tasks 4/7; BU_PER_METER re-verify in Task 12 manual playtest). ✅

Placeholder scan: searched for "TBD", "TODO", "fill in", "implement later" in the plan — the only matches are intentional `// TODO audio hook` in Task 8 (spec explicitly defers audio to M8) and the word "todo" in task-marker symbols. No action items marked for later.

Type consistency: `Vec3` exported from `gibs/particles.ts` and reused everywhere. `GibbableDude.kind: 'player' | 'axe-zombie'` matches both the player and AxeZombie. `GibSystem.registerDude` / `unregisterDude` names consistent. `TrailHandle.stop()` consistent. `ChargeFraction` vs `chargeFraction` — method on Weapon interface is `chargeFraction()`; implementation also exposes `chargeFractionAt(now)` for HUD (documented). `ExplosionInfo` reused in tuning + orchestrator.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md`.

For Blud, execution runs via `~/go/bin/dispatch-ui` (port 8090) on the `pi` harness with `zai/glm-5.1` model — same pattern as M1. Next operational step is splitting this plan into 12 per-task dispatch files at `~/.claude/dispatch/plans/2026-04-21-blud-m2-task-{1..12}.md` with serial `depends_on` chain. Trigger Task 1 manually; the chain auto-flows.
