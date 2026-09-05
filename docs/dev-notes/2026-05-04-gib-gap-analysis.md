# Gib System: Gap Analysis (NotBlood → Blud)

## What We Have vs What Blood Does

### Gap 1: No "Toss & Fall" Path
**Blood:** `actor.cpp:3563` — if `damage < 160`, damage type becomes `kDamageFall`, zombie plays death seq 2 (flailing animation), gets tossed into air by explosion impulse, dies on landing.

**Blud:** Single path — damage >= 160 → gib, damage < 160 → take damage + impulse. No toss, no death animation, no fall damage, no GIBTYPE_27 head launch.

**Impact:** This is THE core zombie dynamite death behavior. Most zombie deaths should be "toss → flail → fall → die", not direct gib.

### Gap 2: Damage Calculation Not Blood-Accurate
**Blood:** `kExplosionStandard` deals 20 damage over `repeat` ticks (80 tics for standard explosion). Damage is applied per-tick in `actRadiusDamage`.

**Blud (`index.ts`):** Collapses to single-shot with `DAMAGE_TICK_STACK = 12×`, so center damage = (20+10) × 12 = 240. This means **everything** in a dynamite blast gibs.

**Fix needed:** Either (a) use per-tick damage accumulation, or (b) use a lower single-shot multiplier that preserves the 160 threshold at center ≈ 4-5 hits.

### Gap 3: Impulse Vector Not Blood-Accurate
**Blood (`actor.cpp:5639`):** `divscale8(impulse, t)` where `t` is mass, then multiplied by directional components (a4=dx, a5=dy, a6=dz). `gVectorData[kDamageExplode].impulse = 8192`.

**Blud:** `impulseMag = info.impulse * linearFall`, applied as radial outward vector + `y+3.0`. Flat radial + arbitrary upward nudge.

**Fix needed:** Impulse should be: `divscale8(8192, mass) * directional_component` for each axis, not a flat radial push.

### Gap 4: No Death Animation / State Machine Integration
**Blood:** `actKillDude` plays death seq 1 (direct gib) or death seq 2 (toss & fall), then spawns gib effects.

**Blud:** Enemy just takes damage → if dead, chunks spawned. No animation, no sequence, no death state.

### Gap 5: Gib Sprite Types
**Blood:** 3 distinct gib types per zombie (GIBTYPE_5 for standard, GIBTYPE_27 for kickable head, GIBTYPE_7 for axe death). Each has specific picnums, velocities, and particle effects.

**Blud:** Generic `spawnChunks()` with `ZOMBIE_GIB_PROFILE` — no distinction between gib types, no GIBTYPE_27 head with launch velocity `-0xccccc`, no GIBTYPE_7.

### Gap 6: No Fall Damage on Landing
**Blood:** When a `kDamageFall` zombie lands, it takes fall damage and dies. The landed corpse then spawns GIBTYPE_27 kickable head.

**Blud:** No landing detection, no fall damage.

## Implementation Status

### ✅ M5-D Step 1: Toss & Fall Path — **COMPLETE**

**Implemented in:** `gibs/index.ts`, `gibs/tuning.ts`, `axe-zombie.ts`
- `TossInfo` interface for toss path data
- `TOSS_IMPULSE` tuning constants (magnitude, upward bias, linear falloff)
- `GibbableDude.onToss()` callback for sub-threshold kills
- `GibSystem.tossPath()` computes directional impulse from explosion to victim
- `AxeZombie.onToss()` — sets up toss arc state and animation
- `AxeZombie.updateTossArc(dt)` — per-frame gravity + kinematic translation
- `AxeZombie.onLandedFromToss()` callback when zombie hits ground

**Remaining:** Wire `onLandedFromToss` in the cluster to spawn GIBTYPE_27 kickable head.

### ✅ M5-D Step 3: Direct Gib Path — **IMPLEMENTED**

The direct gib path was already present from M1/M2. The `GibSystem.spawnExplosion()` else branch now correctly routes sub-threshold kills to `tossPath()` instead of just `takeDamage()`.

## Implementation Plan (Remaining)

### M5-D Step 1 (remaining): Wire `onLandedFromToss`
- [ ] In the cluster/enemy-spawner, set `onLandedFromToss` on `AxeZombie` instances to call `ChunkSystem.spawnChunks()` with picnum 3405 (GIBTYPE_27)

### M5-D Step 2: Gib Type Differentiation
- [ ] Add `GibType` enum: Standard, Head, AxeHead, Butcher
- [ ] Map GIBTYPE_27 velocity launch (`-0xccccc` upward yvel)
- [ ] Map GIBTYPE_7 velocity launch (`-0x111111` upward yvel)
- [ ] Wire up picnum selection per gib type

### M5-D Step 4: Fall Damage on Landing
- [ ] Detect when a zombie with toss-animated state lands
- [ ] Apply fall damage → death → GIBTYPE_27 head spawn

### M5-D Step 5: Zombie-Specific Tuning
- [ ] Map actual picnums from Blood tiles001.art for zombie gibs
- [ ] Calibrate impulse values for zombie mass
- [ ] Tune death animation timing (death seq 1 vs seq 2 duration)
- [ ] Add `dmgThreshold` check in `GibSystem.spawnExplosion()` — if `damage < GIB_THRESHOLD`, apply toss path
- [ ] Calculate toss impulse from explosion direction (not flat radial) using `divscale8(impulse, mass)` pattern
- [ ] Apply upward velocity to zombie (not +3.0 arbitrary, but from directional impulse)
- [ ] Trigger death animation (death seq 2) when zombie dies during toss path
- [ ] On landing, spawn GIBTYPE_27 kickable head

### M5-D Step 2: Gib Type Differentiation
- [ ] Add `GibType` enum: Standard, Head, AxeHead, Butcher
- [ ] Map GIBTYPE_27 velocity launch (`-0xccccc` upward yvel)
- [ ] Map GIBTYPE_7 velocity launch (`-0x111111` upward yvel)
- [ ] Wire up picnum selection per gib type

### M5-D Step 3: Direct Gib Path
- [ ] If `damage >= GIB_THRESHOLD`, play death seq 1
- [ ] Spawn 3 gib types + 4 blood bursts (per Blood spec)
- [ ] Ensure gibs have correct launch velocities from directional impulse

### M5-D Step 4: Fall Damage on Landing
- [ ] Detect when a zombie with toss-animated state lands
- [ ] Apply fall damage → death → GIBTYPE_27 head spawn

### M5-D Step 5: Zombie-Specific Tuning
- [ ] Map actual picnums from Blood tiles001.art for zombie gibs
- [ ] Calibrate impulse values for zombie mass
- [ ] Tune death animation timing (death seq 1 vs seq 2 duration)
