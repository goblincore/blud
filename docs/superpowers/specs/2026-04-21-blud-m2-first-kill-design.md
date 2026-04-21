# Blud — M2 design: first kill (dynamite + gibs)

> Milestone design spec. Scope: mechanics-complete dynamite weapon + full gib
> system (chunks, burst, trails, decals) + basic shambler AI on a cluster of
> axe-zombies, with the minimum juice (explosion VFX, screenshake, per-stage
> SFX) for a single kill to *feel* satisfying. Clay shader, decals persistence,
> and chromatic-aberration polish are deferred to M3.
>
> **Design lineage**: diverges from the original game design
> ([2026-04-20-blud-design.md](2026-04-20-blud-design.md)) which had **M2 =
> revolver + Scrollkin + voxel gib MVP**. This spec swaps in dynamite (was
> M4) because (a) we've already extracted axe-zombie not Scrollkin, and (b) a
> projectile-AOE weapon is a richer stress test for the gib pipeline — it
> exercises charge timing, hold-to-cook tension, arc physics, radius damage,
> and multi-enemy simultaneous gibbing, all of which are the "feel" targets
> the whole game hinges on. Voxel chunks are deferred to M3 behind a swap-
> compatible interface.

## 1. Goals

1. **Full mechanical loop**: throw dynamite → arc → detonate → cluster of
   zombies gibs → chunks fly → trails stream → decals stick.
2. **Blood-faithful cook-in-hand fuse**: fuse ticks from the moment the
   button is pressed (not on release). Holding too long self-gibs the player.
3. **Charge → throw-velocity**, linear, 2 seconds to full power, visible in
   both a HUD ring around the crosshair *and* the first-person dynamite
   sprite (fuse shortening, sparks increasing).
4. **All three gib subsystems live and interacting**:
   - Rapier dynamic-body chunks (billboard sprites now, voxel swap in M3)
   - Kinematic radial burst at gib moment (FX_13 blood chunks)
   - Per-chunk trail droplets emitted at 20 Hz with 1/256 inherited velocity
     (FX_27 droplets), landing as surface decals on wall/ceiling contact.
5. **Basic shambler AI** on a cluster of 3–5 axe-zombies so cook-while-closing
   tension actually reads.
6. **Minimum juice**: explosion fireball sprite, camera screenshake, and one
   SFX per stage (charge-click, throw, explosion). No shader work yet.
7. **Architecture survives the M3 voxel swap** without touching `weapons/` or
   `gibs/particles/` — the voxel change is isolated to `gibs/chunks.ts`.

## 2. Non-goals (deferred)

| Feature                              | Deferred to |
| ------------------------------------ | ----------- |
| Clay shader, dither, chromatic aberration | M3     |
| Voxel gib chunks (meshes, not sprites)    | M3     |
| Decal fade-over-time, wet-surface shader, blood drip | M3 |
| Additional weapons (revolver, double-wide, phone) | M4 |
| Navmesh / obstacle avoidance for enemies | M5     |
| Audio mixing, music                       | M8     |
| Reload/ammo UI polish                     | M3 (simple counter OK in M2) |

## 3. Asset extraction (new `A9` task group)

Reuses `scripts/extract_blood_sprites.py`, same visual-verification workflow as
A5/A6.

| Asset                         | Picnum (starting point, visual verify) | Dest path                                             |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Dynamite bundle, flying       | 3433 + rotation frames                 | `public/assets/weapons/dynamite-placeholder/bundle/`  |
| First-person dynamite hand    | 589 + offsets 4–11 (idle/charge/throw) | `public/assets/weapons/dynamite-placeholder/view/`    |
| Explosion fireball animation  | SEQ 4 → scan for frame range           | `public/assets/vfx/explosion-placeholder/`            |
| Blood trail droplet (FX_27)   | 733                                    | `public/assets/gibs-placeholder/trail/`               |

Picnum 3433 lives in `tiles013.art`; 589 and 733 in `tiles002.art`. SEQ 4 is
the only asset where the picnum range is not directly in the source code and
will need visual identification against the extracted tilesheets.

All existing placeholder assets (axe zombie 1170–1258, body chunks 1267/68/69
/1454/1456, FX_13 blood chunks 2154–2158, bouncing head 3405–3421) are reused.

## 4. Architecture

### 4.1 Data flow

```
input (M1)                       weapons/dynamite.ts
  ├─ mouse-down ─────────────▶ charge start, fuse start, FP view sprite
  ├─ hold      ─────────────▶ tick fuse, update charge UI, animate view
  │                             (if fuse ≥ fuseMax → selfExplode at player pos)
  └─ mouse-up  ─────────────▶ compute throw velocity from chargeTime
                                spawn dynamite Rapier body with remaining fuse
                                        │
                                        ▼
                       physics/world.ts (Rapier) — arc, bounce, gravity
                                        │
                        per-frame projectile tick:
                        ├─ decrement fuse; if ≤ 0: detonate
                        └─ on collision: bounce (Rapier restitution)
                                        │
                                        ▼
               gibs/index.ts: spawnExplosion(pos, kExplosionStandard)
                ├─ vfx/explosion.ts — fireball sprite animation
                ├─ vfx/screenshake.ts — camera impulse
                ├─ audio — explosion SFX
                └─ radius query → for each dude in radius:
                     damage = falloff(distance, radius, damage ± range)
                     impulse = scale(distance, radius, impulse)
                     if damage ≥ GIB_THRESHOLD → triggerGib(pos, impulseVec, type)
                     else → dude.hp -= damage, knockback
                                        │
                            ┌───────────┴──────────────┐
                            ▼                          ▼
                   chunks.ts                    particles.ts
                   (5 Rapier bodies             ├─ emitBurst(FX_13, 10 particles, radial)
                    per gibbed dude,            │   ← gib-moment spray
                    billboard body parts)       │
                            │                   └─ emitTrail(chunk, FX_27, 20 Hz, 1/256 vel)
                            │                       ← per-chunk droplet stream
                            │                       │
                            │       trail particle update (kinematic):
                            │         pos += vel*dt;  vel.y -= g*dt;  vel *= 1-drag*dt
                            │                       │
                            │                       ▼
                            │              AABB test vs static scene → onSurfaceHit
                            │                       │
                            │                       ▼
                            │              decals.ts — spawn stuck quad aligned to normal
                            │
                            ▼
                   chunk lifetime expiry (settle > 1s or age > 10s)
                     → stop trail, despawn Rapier body
```

One entry point per subsystem. Weapons never touch gib internals; gibs never
know about weapons; all crosses via `triggerGib` and `spawnExplosion`.

### 4.2 Module tree

```
src/
├─ game/
│  ├─ weapons/
│  │  ├─ types.ts            ← Weapon interface
│  │  ├─ dynamite.ts         ← sole implementation
│  │  ├─ index.ts            ← currentWeapon registry (single-slot for M2)
│  │  └─ dynamite.test.ts
│  ├─ gibs/
│  │  ├─ index.ts            ← triggerGib(), spawnExplosion() — orchestrator
│  │  ├─ chunks.ts           ← Rapier body-part flight (swap point for M3 voxel)
│  │  ├─ particles.ts        ← kinematic pool, serves both burst and trail
│  │  ├─ decals.ts           ← surface-stuck sprite quads
│  │  ├─ tuning.ts           ← starting constants, all cited to NotBlood source
│  │  └─ particles.test.ts
│  ├─ enemy/
│  │  ├─ axe-zombie.ts       ← sprite billboard + hp + death/gib entry points
│  │  ├─ ai.ts               ← shambler FSM
│  │  └─ ai.test.ts
│  └─ arena.ts               ← extends M1; adds spawnCluster() + R-key respawn
├─ ui/
│  └─ charge-hud.ts          ← CSS ring around crosshair
└─ vfx/
   ├─ explosion.ts           ← fireball sprite animation
   └─ screenshake.ts         ← camera impulse (reusable for M4)
```

## 5. Module designs

### 5.1 `game/weapons/types.ts` — Weapon interface

```ts
export interface Weapon {
  readonly id: string;
  readonly ammoMax: number;
  ammo: number;

  onPress(ctx: FrameCtx): void;
  onRelease(ctx: FrameCtx): void;
  onFrame(ctx: FrameCtx, dt: number): void;

  renderView(ctx: ViewCtx): void;
  renderHud(ctx: HudCtx): void;
}

export interface FrameCtx {
  world: RapierWorld;
  player: Player;
  gibs: GibSystem;
  now: number;
}
```

Minimal surface. No multi-weapon manager in M2 — `weapons/index.ts` just holds
`currentWeapon: Weapon`. M4 will add an inventory + swap; the interface is
already weapon-swap-compatible.

### 5.2 `game/weapons/dynamite.ts`

Internal state machine:

```
idle ──onPress──▶ cooking  (fuseStart = now, chargeStart = now)
                    │
                    ├─ onFrame: if (now - fuseStart) ≥ fuseMaxSec
                    │             → selfExplode at player.pos; back to idle
                    │
                    └─ onRelease:
                         chargeTime = min(now - chargeStart, DYNAMITE_COOK.maxChargeSec)
                         power      = chargeTime / maxChargeSec           (0..1)
                         vel        = lerp(minVel, maxVel, power)         (along player.forward)
                         fuseLeft   = fuseMaxSec - chargeTime             (already ticking!)
                         spawnProjectile(pos: player.handPos, velocity: vel, fuse: fuseLeft)
                         ammo--; state = idle
```

**Projectile entity is separate from weapon state.** Exported
`spawnProjectile(world, pos, vel, fuseRemaining)` registers a per-tick callback
on the Rapier world. Weapon can fire again (if ammo) before a prior projectile
lands. No coupling.

**Projectile tick-callback:**
- decrement `fuseRemaining` each frame; on `fuseRemaining ≤ 0` call
  `gibs.spawnExplosion(pos, EXPLOSION_STANDARD)` and despawn the projectile body.
- on Rapier collision with static world: Rapier handles restitution natively
  via collider material; no action required in the tick callback.
- on Rapier collision with a dude: (default behaviour for M2) just bounce;
  dude takes no damage from the projectile itself, only from the explosion.
  A future `explodeOnImpact: true` flag can be added for NPC-thrown variants.

**Self-explode on over-cook**: `selfExplode(player.pos)` just calls
`gibs.spawnExplosion(player.pos, EXPLOSION_STANDARD)`. The player is a dude in
the radius query, takes full damage, gibs → game-over state. Tight feedback,
reads instantly, nothing special about the codepath.

### 5.3 `game/gibs/particles.ts` — the shared pool

Single class, two emit modes parameterised at call time. Particles are **not**
Rapier bodies — per-frame kinematic update only. Rendered as Three.js
`InstancedMesh` of billboard quads.

```ts
export class ParticlePool {
  constructor(scene: THREE.Scene, capacity = 1024, atlas: TextureAtlas);

  emitBurst(origin: Vec3, params: BurstParams): void;
  emitTrail(source: FollowTarget, params: TrailParams): TrailHandle;

  // Per-frame update (called by game loop):
  update(dt: number): void;
}

interface BurstParams {
  tile: Picnum;
  count: number;
  speedMin: number; speedMax: number;   // m/s
  gravity: number; airdrag: number;     // per-tic units from NotBlood, converted
  lifetimeSec: number; size: number;
}

interface TrailParams {
  tile: Picnum;
  hz: number;                           // emit rate
  velScale: number;                     // parent-velocity inheritance (1/256 per Blood)
  gravity: number; airdrag: number;
  lifetimeSec: number; size: number;
  onSurfaceHit?: (pos: Vec3, normal: Vec3) => void;
}

interface TrailHandle { stop(): void; }
```

Per-frame kinematic update:
```
pos += vel * dt
vel.y -= gravity * dt
vel *= max(0, 1 - airdrag * dt)
age += dt
alpha = 1 - (age / lifetimeSec)
```

**Pool capacity 1024.** At peak (4 zombies × 5 chunks × 20 Hz × 4 s lifetime =
1600 trail particles + ~60 burst particles) we'll hit the cap; FIFO-evict the
oldest. Flagged in risks as a stress point; tune cap during gut-check pass if
perf suffers.

**Surface-hit for decals.** Each tick, compare each particle's pre-/post-move
position against the arena's static AABBs. On crossing, invoke
`onSurfaceHit(collisionPos, surfaceNormal)`. AABB is sufficient for M1/M2
arena (axis-aligned box); upgrade to Rapier raycast when M3+ arenas need
rotated walls.

### 5.4 `game/gibs/chunks.ts` — Rapier body-part flight

For each gibbed dude, spawn **5 chunks** — one per body part (head, torso,
arm, leg, spare). Each is a Rapier dynamic body (small capsule collider) with
a billboard sprite drawn from the extracted body-chunk picnums (1267/68/69/
1454/1456).

Launch velocity = radial-from-origin unit vector × chunkSpeed + explosion
impulse. Small random torque so they tumble.

On spawn:
```
const trail = particles.emitTrail(chunkBody, BLOOD_TRAIL);
chunk.trailHandle = trail;
```

On lifetime expiry (velocity stays below `settleThreshold` for > 1 s, or age
> 10 s): `trail.stop(); despawn(chunk.rigidBody);`. Global cap 1024 chunks,
FIFO-evict oldest.

**This is the M3 voxel-swap point.** M3 replaces the billboard geometry with
voxel chunk meshes generated from `.vox` files; `chunks.ts` API
(`spawnChunks(origin, impulse, dudeType)`) stays identical. No other file
changes.

### 5.5 `game/gibs/decals.ts`

Trivial. On surface-hit from a trail particle:
```
spawnDecal(pos, normal, tile = 733)
  → small textured quad at pos + normal * 0.01 (z-fight offset)
  → rotation aligned to normal
  → added to scene, tracked in pool (cap 100, FIFO)
```

M2 does not fade decals. M3 adds fade-over-time + clay-shader integration.

### 5.6 `game/gibs/index.ts` — orchestrator (only 2 public functions)

```ts
export function spawnExplosion(pos: Vec3, type: ExplosionInfo): void;
export function triggerGib(pos: Vec3, impulse: Vec3, dudeType: DudeType): void;
```

`spawnExplosion`:
- play explosion VFX + screenshake (magnitude scaled by `type.quake`) + SFX
- Rapier radius query (`world.intersectionsWithShape(Ball(type.radius))`)
- for each dude hit:
  - `distance = |dude.pos - pos|`
  - `damage = lerpClamped(distance, 0, type.radius, type.damage + type.dmgRange, 0)`
  - `impulseVec = normalize(dude.pos - pos) * lerp(distance, 0, type.radius, type.impulse, 0)`
  - if `damage ≥ GIB_THRESHOLD` → `triggerGib(dude.pos, impulseVec, dude.type)`
  - else → `dude.hp -= damage; dude.applyKnockback(impulseVec)`
- if player in radius, same treatment (player is a dude for these purposes)

`triggerGib`:
- `chunks.spawnChunks(pos, impulse, dudeType)` → 5 chunks launched
- `particles.emitBurst(pos, GIB_BURST)` → 10 FX_13 sprites radial
- remove the dude sprite + Rapier body

### 5.7 `game/enemy/axe-zombie.ts` + `game/enemy/ai.ts`

Billboard sprite using extracted axe-zombie frames (1170–1258). FSM:

```
spawned ─(0.5s)─▶ idle ─(player within aggroRadius)─▶ chase
                                                       │
                               within meleeRange? ────▶ attack (swing; deal dmg on frame N)
                                                       │                │
                                        on hit (hp > 0) → stagger       └─▶ return to chase
                                                       │
                                        on hp ≤ 0 → dead (corpse, still raycastable for regib)
                                                       │
                                        [on damage ≥ GIB_THRESHOLD: gibbed by gibs/index.ts —
                                         this state unreachable from here]
```

Values sourced from `docs/tuning-sources.md` (R1):
- HP, melee damage, speed (m/s converted from Build-u/tic), attack cooldown

AI is intentionally dumb: no line-of-sight check, no obstacle avoidance, no
inter-zombie spacing. Lerp position toward player every frame at `speed`
capped by delta. Pathfinding is M5.

### 5.8 `game/arena.ts` — extend M1

Adds:
- `spawnCluster(count = 4, center = arena.zombiePadPos, radius = 1.5m)`
- Key-down on `R`: despawn all live zombies + all gibs + all decals, call
  `spawnCluster()` again.

For fast iteration during the gut-check pass.

### 5.9 UI & VFX

- **`ui/charge-hud.ts`**: CSS-styled ring around crosshair (DOM overlay, not
  canvas). Fills 0→1 based on `currentWeapon.chargeFraction`. Colour shifts to
  red in the last 10% of fuse to signal impending self-gib.
- **`vfx/explosion.ts`**: play extracted fireball frames at position, camera-
  facing billboard, scale-up-and-fade over lifetime. One SFX on spawn.
- **`vfx/screenshake.ts`**: additive camera rotation offset, exponentially
  decaying. `shake(magnitude, durationSec)`. Reusable for M4 weapons.

## 6. Tuning constants (`game/gibs/tuning.ts`)

All values sourced from NotBlood, with source citations in comments. Build-unit
→ meter conversion uses `BU_PER_METER = 256` (matches M1's arena scale — to be
verified during implementation).

```ts
// kExplosionStandard — TNT Bundle
// actor.cpp:2300-2310 (explodeInfo[1]); docs/tuning-sources.md:456
export const EXPLOSION_STANDARD = {
  radius: 150,              // Build units → converted to meters for radius query
  damage: 20,
  damageRange: 10,          // actual damage ∈ [damage-range, damage+range]
  impulse: 900,
  lifetimeTics: 60,
  quake: 160,
  flash: 60,
} as const;

// actor.cpp + R1 extraction
export const GIB_THRESHOLD = 160;

// Dynamite throw — weapon.cpp:1215, 2166 via docs/tuning-sources.md:580-586
// Blood's formula: velocity = mulscale16(throwPower, 0x177777) + 0x66666
// After mulscale16 (>> 16), min = 0x66666 >> 16 = 6.4 Build-u/tic,
//                         max = (0x66666 + 0x177777) >> 16 = 13.86 Build-u/tic
// At 120 TPS with BU_PER_METER = 256: min ≈ 3.0 m/s, max ≈ 6.5 m/s
export const DYNAMITE_COOK = {
  maxChargeSec: 2.0,        // 240 tics @ 120 TPS
  minVelocityMps: 3.0,
  maxVelocityMps: 6.5,
  fuseMaxSec: 2.0,          // cook starts on press; same envelope as charge
} as const;

// FX_27 blood trail — callback.cpp:180-192 + gFXData[27] at fx.cpp:89
export const BLOOD_TRAIL = {
  emitHz: 20,               // 6 tics @ 120 TPS
  velScale: 1 / 256,        // Blood's xvel >> 8
  gravity: 27962,           // Build u/tic² — convert to m/s²
  airdrag: 4096,
  lifetimeSec: 4.0,         // 480 tics
  size: 32,
  tile: 733,
} as const;

// FX_13 gib-moment burst — gFXData[13] at fx.cpp:75
export const GIB_BURST = {
  count: 10,
  speedMin: 3.0, speedMax: 8.0,
  gravity: 46603,
  airdrag: 2048,
  lifetimeSec: 4.0,
  size: 40,
  tile: 2154,
} as const;

// Axe zombie — docs/tuning-sources.md R1 extraction
export const AXE_ZOMBIE = {
  hp: 60,
  meleeDamage: 10,
  meleeRange: 1.5,
  attackCooldownSec: 1.0,
  speed: 3.0,
  gibThresholdOverride: undefined,
} as const;
```

**Tuning convention**: every constant carries a `// source: <file:line>`
comment. When feel-tuning drifts a value from Blood's, the original stays as
a `// blood: ...` sibling comment so the delta is tracked.

## 7. Testing strategy

### Unit tests (vitest)

- `dynamite.test.ts`: charge math (0s→min, 2s→max, 1s→midpoint); fuse
  decrements during cook; `selfExplode` fires at fuseMax; ammo decrement.
- `particles.test.ts`: pool wraps FIFO at capacity; trail handle stops
  emission; lifetime decay zeros alpha at end; burst emits N particles in
  cone.
- `ai.test.ts`: idle→chase on aggroRadius enter; chase→attack on meleeRange
  enter; dude→dead on hp≤0; stagger interrupts chase for N frames.
- `gibs/index.test.ts`: falloff math — dude at origin takes full damage;
  dude at radius boundary takes ~0; GIB_THRESHOLD branch fires
  `triggerGib` vs. normal damage branch.

**No e2e / integration tests in M2.** Those land in M6+ when gameplay is
stable.

### Manual playtest (user-driven)

After I verify `npm run build` clean, `npm test` green, `npm run dev` boots
without console errors:

1. Arena loads, 4-zombie cluster visible and shambling toward player.
2. Hold LMB — HUD ring fills, first-person dynamite sprite shows fuse
   shortening.
3. Release — projectile arcs, may bounce, detonates on fuse-end.
4. On detonate: explosion sprite + screenshake; zombies in radius gib; chunks
   fly, trail droplets stream, burst cloud visible, decals stick on walls.
5. `R` resets cluster for iteration.
6. Over-cook test: hold past 2 s → self-gib, game-over state, `R` to reset.

### Gut-check loop

If feel is off, user flags the dimension (arc floaty? trail sparse? explosion
small?). I tune the relevant constant in `tuning.ts`, rebuild, user retests.
Max 3 passes before declaring M2 done.

## 8. Acceptance criteria

M2 ships when **all** of:

- [ ] `npm run build` clean
- [ ] `npm test` green (all new + all M1 tests pass)
- [ ] `npm run dev` loads arena with cluster, zero console errors
- [ ] No frame drops during full cluster-gib (< 200 ms first-explosion cache
      warmup spike acceptable)
- [ ] Manual playtest shows all 4 gib subsystems firing in a single dynamite
      kill (chunks + burst + trail + decals) — short clip saved to
      `docs/dev-notes/YYYY-MM-DD-m2-gib-clip.mov`
- [ ] Over-cook self-gib works end-to-end (explosion → player gibbed → game
      over)
- [ ] User gut-check: "yeah, that feels right for placeholder"
      (*not* "ship-quality" — that's M3's bar)

## 9. Risks & mitigations

| Risk                                                                 | Mitigation                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1024 Rapier dynamic bodies may hit a perf cliff on some hardware     | FIFO-evict degrades gracefully; tune cap down during gut-check |
| SEQ 4 (explosion) picnum range not in source — needs visual verify   | Start extraction early; same workflow as A5 zombie verification |
| Build-units → meters conversion may need re-calibration              | Expose `BU_PER_METER` as a single tunable; revisit in gut-check |
| AABB surface detection fails on rotated walls                        | Arena is axis-aligned through M5; upgrade to Rapier raycast if needed |
| Over-cook self-gib edge case: player dies mid-throw (released exactly at fuseMax) | Implement as "release wins": if release frame is same as over-cook frame, the throw completes, and the projectile detonates in-flight 0 s later (same visual effect) |
| `fuseTime = -1` impact-detonate behavior from Blood NPC paths        | Implemented as `explodeOnImpact: false` flag, off by default for M2 |

## 10. Open questions deferred to implementation

- **Exact pixel-art size of charge HUD ring** (cosmetic; pick during implementation)
- **Explosion SFX selection** (pick any free-use impact SFX for placeholder; M8 does audio pass)
- **Zombie idle animation frame choice** from 1170-1199 range (visual pick)

None of these block the plan or the architecture.

---

**Design status**: ready for implementation plan. Next step:
[superpowers:writing-plans](../../CLAUDE.md) to produce
`docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md`.
