# Blud — Deterministic 120-tic Simulation Core (design spec)

**Status:** approved design (2026-06-18), pre-implementation.
**Milestone:** the deferred `120-tic deterministic core`, scoped as a **strangler vertical slice**.
**Why now:** multiplayer co-op is a core feature goal; we want the simulation as
deterministic as possible, and we want NotBlood AI/weapon ports to drop in
verbatim instead of going through lossy unit conversions. Decided to build this
**before** the next AI port so the shotgun cultist is written natively on the
deterministic substrate rather than ported twice.

Related: `Claude Notes/Blud/2026-06-10-port-vs-recreate-thinking.md` (Obsidian)
established "keep Rapier, demoted to VFX; gameplay motion is a Build-style
integer integrator; run the logic core at fixed 120Hz in Build units."

---

## Decisions locked in brainstorming

1. **Sequencing:** deterministic core first; the shotgun cultist AI port folds
   into this milestone as its first real gameplay consumer (not a separate
   later session).
2. **Netcode target:** **deterministic lockstep, peer-to-peer**, with state
   shaped so **rollback (GGPO-style)** can be added later. Server-authoritative
   (e.g. Colyseus) remains the fallback but we build for P2P-deterministic.
   *The transport itself is a separate later spec* — this milestone makes the
   sim deterministic and proves it, it does not ship networking.
3. **Scope:** strangler vertical slice — build the deterministic spine and prove
   it end-to-end on `{player, dynamite, shotgun cultist}`; everything else stays
   on the legacy path behind a clear boundary and migrates later, same pattern.

---

## 1. The determinism contract (central rule)

Two layers, one-way data flow.

- **Sim layer — MUST be bit-identical across peers.** Player movement/state,
  dude AI + movement, weapon/projectile logic, damage/death/gib *decisions*,
  all timers, all RNG draws, and **persistent interactable objects** — the
  kickable head (`kThingZombieHead`) and any future physics object a player can
  collide with, kick, or otherwise change. Runs at a fixed **120 tic/s**.
  (Source-faithful: the kickable head is a real Blood `kThing` with deterministic
  `MoveThing` physics, not an FX.)
- **Cosmetic layer — per-client, free to diverge.** The pure-decoration gib
  *spray* (body-chunk scatter that settles into gore), blood particles, decals,
  screenshake, camera bob, animation-frame interpolation, audio. Each is spawned
  from a deterministic `SimEvent` (so every peer *does* see gore), but the exact
  per-chunk scatter may differ harmlessly because no one interacts with it.
- **Flow is one-way: `sim → events → cosmetic`.** The sim never reads cosmetic
  state back. This is precisely what lets float/Rapier *decoration* physics
  diverge between clients without affecting gameplay.

**The test:** if a player can interact with it, or another player must see the
*same* thing in the *same* place (e.g. the kickable head you punted across the
room — your co-op partner has to see it land where you kicked it), it lives in
the sim as a deterministic `kThing`. If it's only watched/heard and touching it
changes nothing, it's cosmetic. Gib chunks split along this line: the
**interactable head = sim**; the **decorative spray = cosmetic**.

## 2. Units & math

- The sim runs in **Blood-native integer space**: position in Build units (BU),
  velocity in BU/tic, angle in Blood angle units (`2048 = 360°`), time in tics.
  Anchors: `256 BU = 1 m`, `120 tic/s`.
- **No floats in sim state.** Fractional math uses fixed-point mirroring Blood's
  `mulscale`/`dmulscale`. Consequence: NotBlood constants (`dudeInfo`,
  `thingInfo`, velocities, angles) drop in verbatim — no BU↔m / tic↔s
  conversion per feature, which is where past ports introduced errors.
- **Single conversion boundary:** the render layer reads sim state and converts
  BU→m, tic→s, Blood-angle→rad, and **interpolates** between the previous and
  current tic for smooth display.

## 3. Fixed-tic loop

- **Accumulator pattern:** bank real frame `dt`, advance the sim in exact
  `1/120 s` steps, keep the remainder. Render interpolates the leftover fraction
  (`alpha`) between the last two sim snapshots. Sim rate is fully decoupled from
  display refresh.
- **The step is a pure function:** `step(state, inputCmd, ) → { state, events }`.
  No I/O, no wall-clock, no `Math.random`, no Rapier inside.

## 4. Sim state = plain serializable data (rollback-ready)

- One `SimState` value composed of **plain records** (struct-of-arrays or plain
  objects) — **no class instances, no Rapier handles, no closures**. This makes
  it cheap to (a) hash for the determinism harness now, and (b) snapshot/restore
  for rollback later.
- Logic is **free functions over `SimState`** (the shape `resolveDeathOutcome`
  already uses), not methods on stateful entities.
- **The key restructure:** an entity like `ShotgunCultist` (today an OO class
  holding a Rapier kinematic body + animation refs) splits into:
  - a **plain dude record inside `SimState`** (deterministic gameplay data), and
  - a **cosmetic view** (sprite/anim/optional Rapier proxy) rebuilt/updated from
    that record each render.

## 5. Input model

- Per-tic **`InputCommand`**: movement axes, **aim quantized to Blood angle
  units**, and a button bitfield (fire, weapon switch, use, …). This command is
  the *only* thing a future lockstep transport sends.
- Local input is sampled at render rate and **quantized into each tic's
  command** deterministically (mouse-look included — continuous look becomes a
  per-tic angle delta in Blood units).

## 6. RNG

- A **single seeded stream stored inside `SimState`** (the seed/counter advances
  deterministically and is part of the snapshot). All sim randomness draws from
  it; `chance()`/`mulberry32()` already exist in `src/game/rng.ts` and are the
  basis. Optionally port Blood's `Random()`/`qrand` semantics on top for
  fidelity (not required for determinism — identical algorithm across peers is
  what matters).
- **`Math.random` is banned in the sim layer**, freely allowed in cosmetic.

## 7. Deterministic geometry (must-not-use-Rapier)

Some queries feed gameplay and therefore must be deterministic:

- cultist **line-of-sight**, projectile-vs-wall hits, dude wall-clipping.

Rapier raycasts/queries are float and not guaranteed identical cross-platform,
so **the sim cannot use Rapier for these.** The sim gets its own **integer
geometry queries** (segment/AABB tests) against a simple **sim-geometry
representation** — for the current arena, a handful of integer AABBs (floor +
walls). Rapier remains **cosmetic-only**.

This also forward-declares a requirement for the future generative-maps spec:
the level must carry a deterministic sim-geometry, distinct from its render mesh.

## 8. Determinism harness (the proof / CI guard)

- `hash(SimState)` — a stable hash of the serializable state.
- **Recorded-input replay:** run two `SimState` instances from one seed + one
  recorded `InputCommand` stream and **assert identical hash every tic**.
- This is an automated test that keeps determinism from silently rotting as
  systems migrate; any nondeterminism (a stray `Math.random`, float creep,
  iteration-order bug) fails it immediately.

## 9. The vertical slice (what this milestone migrates)

Deterministic, on `SimState`:

- **Player** — movement + look + collision (deterministic wall-clip).
- **`kThing` mover** — a generic deterministic moving-thing integrator (port of
  Blood `MoveThing`: fp velocity integrate, gravity, floor bounce w/ elastic,
  wall-clip via the sim-geometry). Shared substrate for the thrown dynamite AND
  the kickable head (and future physics objects).
- **Dynamite** — throw arc + fuse + detonation as a deterministic `kThing`;
  explosion *decision* in `SimState`, emitted as a `SimEvent`. The decorative
  gib **spray** stays cosmetic (spawned from the event); explosion-vs-**player**
  damage is deterministic (player is in the sim).
- **Kickable head** — the `kThingZombieHead` is a **deterministic sim `kThing`**
  (shared/interactable: co-op peers see the same head and the same kick outcome),
  reusing the `kThing` mover, plus a player kick interaction. Only the decorative
  spray around it is cosmetic.
- **Shotgun cultist — full NotBlood AI** ported natively deterministic:
  `Idle → Chase → Dodge → Goto → Search → Fire → Recoil(→Dodge)` with **real
  deterministic LOS**. This is the cultist port originally requested, built once,
  on the deterministic substrate.
  - Source: `aicult.cpp` ground (non-swim/non-prone/non-tesla/non-tommy)
    states — `cultistIdle`, `cultistChase`, `cultistDodge` (90 tic),
    `cultistGoto` (600 tic), `cultistSearch` (1800 tic), `cultistSThrow`→
    `cultistSFire` (60 tic), `cultistRecoil`→`cultistDodge`. Movers
    `aiMoveForward`/`aiMoveDodge`/`aiMoveTurn`, thinkers `thinkChase`/
    `thinkGoto`/`thinkSearch`/`aiThinkTarget`.

Everything else (other enemies, flare gun, etc.) stays on the **legacy path**
behind a clear boundary/adapter during this milestone, and migrates later
following the same pattern (the port-vs-recreate "incremental strangler"
policy).

## 10. Out of scope (each its own later spec)

- Network **transport** (lockstep send/recv, matchmaking, NAT/relay).
- **Rollback** implementation (the state is *designed* to allow it; not built).
- Migrating the **remaining** enemies/weapons/projectiles.
- **Generative maps** (will need to supply a deterministic sim-geometry — noted).

## Risks / watch-items

- **Float creep** anywhere in the sim breaks lockstep — the harness is the guard;
  integer-BU discipline is the prevention.
- **Iteration order / Map ordering** must be stable (use arrays/explicit order in
  the sim, never rely on object key order or Set iteration for sim logic).
- **Dual-mode period:** during the slice, deterministic and legacy systems
  coexist; the boundary must be explicit so cosmetic/legacy code never feeds the
  sim.
- **Effort:** the entity restructure (OO+Rapier → plain record + cosmetic view)
  is the largest single cost; the slice keeps it to three systems to contain it.

## Open questions to resolve in the implementation plan

- Exact `SimState` representation (struct-of-arrays vs plain object records) and
  the cosmetic-view reconciliation strategy.
- Fixed-point helper surface (which `mulscale` variants we actually need).
- Whether to port Blood's `Random()` table or keep `mulberry32` for the seeded
  stream.
- Snapshot/hash format (what's hashed, how cheaply).
