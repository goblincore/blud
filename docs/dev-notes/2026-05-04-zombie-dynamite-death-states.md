# Zombie Dynamite Death States (NotBlood → NotBlood)

## The Core Decision Gate

**Line: `actor.cpp:3563`** — the single branching point that determines which zombie death path fires:

```cpp
actKillDude(nSource, pSprite, ((damageType == kDamageExplode && damage < 160) ? kDamageFall : damageType), damage);
```

**Rule:**
- Explosion damage ≥ 160 → `kDamageExplode` → **direct gib** (immediate death + gibs)
- Explosion damage < 160 → `kDamageFall` → **toss into air, die on landing**

## Path 1: Direct Gib (damage ≥ 160)

**actor.cpp:3132** — `kDamageExplode` case:

```cpp
case kDamageExplode:
    nSeq = 1;  // death animation seq
    break;
```

**actor.cpp:3157-3161** — Zombie-specific:

```cpp
case kDudeZombieAxeNormal:
case kDudeZombieAxeBuried:
case kDudeZombieButcher:
    nSeq = 1;
    break;
```

Then at **actor.cpp:3505+** (when `damageType == kDamageExplone`):
```cpp
for (int i = 0; i < 3; i++)
    GibSprite(pSprite, (GIBTYPE)dudeInfo[nType].nGibType[i], NULL, NULL);
for (int i = 0; i < 4; i++)
    fxSpawnBlood(pSprite, damage);
```

**What this means:** Zombie plays death seq 1, then immediately spawns 3 gib types from dudeInfo + 4 blood bursts.

## Path 2: Toss Into Air (damage < 160)

The zombie gets knocked airborne by the explosion impulse. The "toss" is the **radial impulse** from the explosion applied to the entity's yvel (vertical velocity). Death occurs separately when the zombie lands.

**How yvel is set** — the explosion impulse gives upward yvel proportional to distance from explosion center. The zombie becomes a projectile and dies on landing.

**actor.cpp:3169** — `kDamageFall` case:
```cpp
case kDamageFall:
    nSeq = 2;  // different death animation (flailing)
    break;
```

**This is the "comical" death:** zombie flails in air (seq 2), comes down, takes fall damage → dies.

## Path 3: Zombie Axe Normal (special GIBTYPE_27)

**actor.cpp:3203-3216** — When zombie is killed by axe/damage with special handling:

```cpp
case kDudeZombieAxeNormal:
    CGibVelocity gibVel(xvel[pSprite->index]>>1, yvel[pSprite->index]>>1, -0xccccc);
    GibSprite(pSprite, GIBTYPE_27, &gibVel, NULL);  // upward velocity!
    break;
```

**GIBTYPE_27** = the kickable zombie head! Launches upward with yvel `-0xccccc` (≈ -873042 in signed) + inherited horizontal velocity halved.

## Path 4: Zombie Butcher (different launch)

**actor.cpp:3266**:
```cpp
CGibVelocity gibVel(xvel[pSprite->index]>>1, yvel[pSprite->index]>>1, -0xccccc);
```

Same launch pattern but different gib picnums.

## Path 5: Head Launch (GIBTYPE_7)

**actor.cpp:3209**:
```cpp
evPost(pSprite->index, 3, 0, kCallbackFXZombieSpurt);
```

**GIBTYPE_7** = zombie head with upward velocity `-0x111111` (≈ -1782579) — launched higher than GIBTYPE_27.

## Summary: 4 Distinct Death Behaviors

| Path | Condition | Animation | Gibs | Special |
|------|-----------|-----------|------|---------|
| **Direct Gib** | dmg ≥ 160 | death seq 1 | 3 gib types + 4 blood | Immediate |
| **Toss & Fall** | dmg < 160 | death seq 2 (flail) | on landing | GIBTYPE_27 launched |
| **Head Launch** | Axe death | death seq 1 | GIBTYPE_7 | Higher launch (-0x111111) |
| **Butcher Death** | Any | death seq 1 | custom gibs | Different picnums |

## The Toss Into Air Mechanism

**actor.cpp:5639-5643** — The impulse that flings the zombie upward:

```cpp
// For kStatDude (enemy) damage:
if (t > 0 && pVectorData->impulse)
{
    int t2 = divscale8(pVectorData->impulse, t);
    int t3 = mulscale16(a6, t2);
    if (EnemiesNotBlood() && !VanillaMode()) // clamp downward impulse
        t3 = ClipHigh(t3, 32767);
    xvel[nSprite] += mulscale16(a4, t2) * boost;
    yvel[nSprite] += mulscale16(a5, t2) * boost;
    zvel[nSprite] += t3 * boostz;
}
```

**Where `a6` is the upward direction component** (z-axis of the hit vector). When `a6 < 0`, the impulse is downward; when `a6 > 0`, upward. The `a4`, `a5` are x/y components.

The explosion damage at `actor.cpp:2720` calls:
```cpp
actDamageSprite(a1, pSprite, kDamageExplode, a6);
```

This goes through the vector/missile hit path with `gVectorData` impulse, NOT the radius damage path.

### Vector Data for kDamageExplode

**actor.cpp:327** — The kDamageExplode VECTORDATA entry:
- dmg: 50 (base damage)
- dmgRng: 43690 (damage range)
- radius: 1024
- **impulse: 8192** ← this is the push strength
- burnTime: 0
- maxDist: 32768

## GibSprite Mechanics

**gib.cpp:435** — `GibSprite()` spawns gib effects (particles) and gib things (physics objects):

```cpp
void GibSprite(spritetype *pSprite, GIBTYPE nGibType, CGibPosition *pPos, CGibVelocity *pVel)
{
    GIBLIST *pGib = &gibList[nGibType];
    // Spawn gib effects (particles)
    for (int i = 0; i < pGib->at4; i++)
        GibFX(pSprite, pGibFX, pPos, pVel);
    // Spawn gib things (physics gibs)
    for (int i = 0; i < pGib->atc; i++)
        GibThing(pSprite, pGibThing, pPos, pVel);
}
```

**Velocity application** (gib.cpp:474-481):
```cpp
if (!pVel) {
    xvel[pGib->index] = Random2((pGFX->atd<<18)/120);
    yvel[pGib->index] = Random2((pGFX->atd<<18)/120);
    zvel[pGib->index] = -Random((pGFX->at11<<18)/120);
} else {
    xvel[pGib->index] = Random2((pVel->vx<<18)/120);
    yvel[pGib->index] = Random2((pVel->vy<<18)/120);
    zvel[pGib->index] = -Random((pVel->vz<<18)/120);
}
```

When `pVel` is provided (zombie death), velocity is scaled from the `CGibVelocity` struct and applied to gib sprite velocities.

## Key Constants for Porting

- `GIB_THRESHOLD = 160` — the divide between "gib now" vs "toss"
- `GIBTYPE_27` — kickable head, launch yvel `-0xccccc`
- `GIBTYPE_7` — special head, launch yvel `-0x111111`
- Explosion damage: 20 ± range → so **multiple explosions** = gibs (each does 20 dmg)
- Single dynamite = 20 dmg → well below 160 → **toss path** for zombies
- **4-5 dynamite = gibs** (4×20 = 80, 5×20 = 100+ from multiple sources)
- **gVectorData impulse = 8192** for explosion damage type
- `divscale8(8192, mass)` = effective impulse scaled by enemy mass

## Blud Implementation Status

### ✅ COMPLETE: Toss & Fall System

**Files modified:** `src/game/gibs/index.ts`, `src/game/gibs/tuning.ts`, `src/game/enemy/axe-zombie.ts`

**What was built:**

1. **`TossInfo` interface** (`gibs/index.ts`) — carries impulse (Vec3), upwardVelY (m/s), and origin (Vec3) for the toss path
2. **`TOSS_IMPULSE` tuning constants** (`gibs/tuning.ts`) — magnitudeMps=4.8, upwardBias=1.5, linear falloff
3. **`GibbableDude.onToss?(toss: TossInfo)` callback** (`gibs/index.ts`) — called for sub-threshold explosion kills
4. **`GibSystem.tossPath()`** (`gibs/index.ts`) — computes directional impulse from explosion center to enemy with upward bias, distance falloff
5. **`GibSystem.spawnExplosion()` else branch** (`gibs/index.ts`) — routes to `tossPath()` for sub-threshold kills
6. **`AxeZombie.onToss()`** (`axe-zombie.ts`) — sets tossed=true, applies upward velocity, computes arc duration
7. **`AxeZombie.updateTossArc(dt)`** (`axe-zombie.ts`) — applies gravity, updates kinematic body each frame, detects landing
8. **`AxeZombie.onLandedFromToss?()` callback** (`axe-zombie.ts`) — fires when zombie hits ground
9. **`AxeZombie toss arc state fields** — `tossed`, `tossUpVelY`, `TOSS_GRAVITY`, `tossArcRemaining`, `tossStartY`, `landedFromToss`

### 🔄 TODO: Wire `onLandedFromToss` Callback

The `onLandedFromToss(pos)` callback is defined on `AxeZombie` but not yet wired to the cluster. When wired, it should call `ChunkSystem.spawnChunks()` with the zombie head picnum (3405 / GIBTYPE_27) at the zombie's position.

**Location to wire:** In the cluster/enemy-spawner where `onLandedFromToss` is set on `AxeZombie` instances, add:
```ts
zombie.onLandedFromToss = (pos) => {
  chunkSystem.spawnChunks(pos, impulse, zombieHeadPicnum, now);
};
```

### Animation
The `onToss()` method plays `'zombie-death-explode'` animation. Ensure this sequence exists in the sprite sheet / STATE_ANIM_MAP or add it to the animation registry.
