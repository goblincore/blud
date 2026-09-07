# Legacy dynamite & gibbing — reference guide

How the retired game's dynamite, explosion and gibbing behaviors map to legacy
source and to the active SDF counterparts. This is a **reference** — it does not
change any code. Use it to reason about, compare, or port behavior between the
old game and the current game.

> **Read first:** [`docs/superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md`](../superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md)
> and the [repository map](../architecture/repository-map.md) for the active/retired split.

---

## 1. Presentation vs. authoritative simulation

A dynamite throw and its explosion are described in **two places** in the legacy
game, and they are not the same thing:

- **Presentation (renderer rules):** the weapon input, charge, throw and attached
  prop are in
  [`src/game/weapons/dynamite.ts`](../../src/game/weapons/dynamite.ts) (plus
  `flare.ts`, `stuck-flare.ts`, and the shared `muzzle-pos.ts`). This is **how
  the throw is presented**, not where the physics is authoritative.
- **Authoritative simulation (rules that govern the projectile and the world):**
  the flight, fuse/impact and physics live in the sim —
  [`src/sim/projectile.ts`](../../src/sim/projectile.ts) and
  [`src/sim/thing.ts`](../../src/sim/thing.ts), coordinated by
  [`src/sim/step.ts`](../../src/sim/step.ts). Explosion/player damage is in
  [`src/sim/explosion.ts`](../../src/sim/explosion.ts).

Do **not** assume all dynamite behavior lives in the weapon renderer. The
authoritative rules are in `src/sim/`.

### Legacy references for each behavior area

| Behavior | Legacy source |
| --- | --- |
| Weapon input / charge / throw presentation | `src/game/weapons/dynamite.ts`, `src/game/weapons/flare.ts`, `src/game/weapons/stuck-flare.ts`, `src/game/weapons/muzzle-pos.ts` |
| Authoritative flight / fuse / impact | `src/sim/projectile.ts`, `src/sim/thing.ts` (coordinated by `src/sim/step.ts`) |
| Explosion / player damage | `src/sim/explosion.ts` |
| Enemy / gib / VFX integration | `src/main.ts`, `src/game/gibs/{index,chunks,particles,decals,ground-flame,tuning}.ts` |
| Death / gib decisions + source tables | `src/game/notblood/{death-outcome,outcome-adapter,notblood-tables.gen}.ts` |
| Tuning constants (both general + enemy tables) | `src/game/gibs/tuning.ts` — imports `notblood-tables.gen.ts` |

---

## 2. Units & provenance

NotBlood/Blood values are **fixed-point Build units**; the legacy sim preserves
that. The active game converts to **metres/seconds** at the tuning layer.

- **Build units per metre:** `BU_PER_METER = 256` (`src/game/gibs/tuning.ts`).
- **Blood tic rate:** `TICS_PER_SECOND = 120` tics/sec. Some timers use 30
  game-frames/sec (`kTicsPerFrame = 4`).
- **Unit conversion helpers:** `buPerTicToMps()`, `buPerTicSquaredToMpsSquared()`
  (`src/game/gibs/tuning.ts`).
- **HP** in the tables is stored `<< 4` (16ths); live integer HP = stored / 16.
- **Distance** in Build world units (`1024` ≈ one Blood grid square).
- **Angle** in Build circle units (`kAng180 = 1024`, `kAng90 = 512`).
- **Explosion `dmgType` field** is a concussion impulse scalar, not a damage
  type enum.

Provenance / value source docs:

- [`docs/tuning-sources.md`](../tuning-sources.md) (R1 — HP, damage, explosion,
  weapon timers; NotBlood units cheat-sheet).
- [`docs/tuning-sources-gibs.md`](../tuning-sources-gibs.md) (R2 — gib picnums +
  FX_27 trail mechanic; GIBTYPE dispatch table).
- [`docs/dev-notes/2026-04-22-notblood-source-reference.md`](../dev-notes/2026-04-22-notblood-source-reference.md)
  (canonical NotBlood source paths, weapon FSM, QAV/SEQ/ART/RFF formats).

**Key sentinel values:**

- `GIB_THRESHOLD = 160` — single-hit damage ≥ 160 ⇒ skip "death" and gib
  directly (`src/game/gibs/tuning.ts`).
- `DYNAMITE_COOK.maxChargeSec = 2.0` (`240` tics), `minVelocityMps = 6.0`,
  `maxVelocityMps = 28.0` (range-calibrated to NotBlood, not raw velocity),
  `fuseMaxSec = 2.0`, `pitchLobDeg = 30`.
- `EXPLOSION_STANDARD` — radius `150` BU, damage `20`, damageRange `10` (actual
  ∈ `[damage−range, damage+range]`), impulse `900`, lifetime `60` tics, quake
  `160`, flash `60`, all derived from `explodeInfo[1]`.

---

## 3. Current SDF counterparts

The active-side dynamite/gib math lives as **pure functions** that mirror the
sim **through data**, not by importing the sim (the lab has no `SimState`). These
are **reusable active-project modules**, not all of which are wired into the
playable FPS (`/sdf-game.html`):

- The **dynamite-throw** modules (`dynamite-flight`, `fpv`, `hands`,
  `dynamite-prop`) are mounted by the **WebGPU lab**
  (`/sdf-lab-webgpu.html` → `src/lab/sdf-zombie/webgpu/lab-main.ts`). That is a
  separate entrypoint from the FPS — `webgpu/game-main.ts` has no dynamite
  integration (see §4).
- `explosion-aoe` and `blood-sim` are used by **both** the WebGPU lab (via
  `fpv-mode`) **and** the active FPS (`webgpu/game-main.ts` imports
  `resolveExplosion` / `blood-sim`).

| Behavior | Active SDF module | Notes |
| --- | --- | --- |
| Thrown-bundle flight / fuse / bounce | `src/lab/sdf-zombie/dynamite-flight.ts` | Pure `(state,dt) → state`; mirrors `src/sim/thing.ts` mover + `src/sim/projectile.ts` fuse **without importing them**. Imports `DYNAMITE_COOK`/`BALLISTIC_BOUNDS` from `game/gibs/tuning.ts`. Fixed 120 Hz sub-steps. |
| Explosion AOE resolver | `src/lab/sdf-zombie/explosion-aoe.ts` | Pure resolver — blast wounds, launch impulses, damage credit, gib decision, air-vs-ground VFX, FPV kick. Mirrors `GibSystem.spawnExplosion` through constants; imports `EXPLOSION_STANDARD`/`EXPLOSION_LAUNCH`/`GIB_THRESHOLD`/... from `game/gibs/tuning.ts`. |
| Blood trail / splat / gib burst | `src/lab/sdf-zombie/blood-sim.ts` | FX_13 burst, FX_27 trails, splat stamps. Imports `BLOOD_TRAIL`/`GIB_BURST`/`BLOOD_SPLAT` from `game/gibs/tuning.ts`. Also carries wound-bleed emitters. |
| First-person throw / cook state machine | `src/lab/sdf-zombie/fpv.ts` | Pure FPV controller with the `DYNAMITE_COOK` cook machine. Phases are `'idle' | 'cooking' | 'cooldown'`; on release it emits a `throw` **signal** (charge fraction + speed), and the wiring composes the direction and hands the flight to `dynamite-flight.ts`. There is **no** `'thrown'` cook phase. Holding past `fuseMaxSec` returns to `idle` with an `overcook` signal. Imports `DYNAMITE_COOK`/`BALLISTIC_BOUNDS` from `game/gibs/tuning.ts`. |
| FPV hands | `src/lab/sdf-zombie/hands.ts` | SDF flesh hands, camera-local prims. Imports `DYNAMITE_COOK` from `game/gibs/tuning.ts`. |
| Dynamite prop | `src/lab/sdf-zombie/webgpu/dynamite-prop.ts` | WebGPU-side bundled prop. Reusable active-project module — mounted by `webgpu/lab-main.ts` (the `/sdf-lab-webgpu.html` lab), **not** by `webgpu/game-main.ts` (the FPS). |

> These are **already-authored** active-project modules (mirrored from legacy
> through data/constants); do not imply dynamite/gibbing starts from zero in the
> active project. They are **not** bit-identical reimplementations — see the
> "Not bit-identical" note below.

### Not bit-identical (intentional differences)

The active modules mirror legacy behavior **through shared tuning/constants**, but
each implementation is its own deterministic design — they are **not**
bit-identical cross-implementation reimplementations. Known intentional
differences (do not "fix" the runtime to collapse them; the active side keeps its
own representation):

- **Fixed-point vs floating-point motion.** The old sim keeps Blood's fixed-point
  Build units and tics (`src/sim/*`); the active side converts to metres/seconds at
  the tuning layer and floats (see §2). Float SDF flight vs fixed-point old sim
  will not reproduce per-tick bit-identical positions.
- **SDF-surface AOE vs sprite-center AOE.** Both resolvers receive a blast
  origin. The active resolver measures distance to the target SDF surface;
  the old `GibSystem.spawnExplosion` measures distance to the target sprite
  center. Shared tuning provenance does not make those distance tests identical.
- **Fuse values differ by role.** `DYNAMITE_COOK.fuseMaxSec = 2.0` is the in-hand
  cook/overcook + alt-fire/drop fuse (`src/game/gibs/tuning.ts`), aligned to
  `maxChargeSec`; the sim's separate `THROW.fuseMaxTics = Math.round(1.5 * TICS_PER_SEC)`
  (`= 1.5 * 120`, `src/sim/projectile.ts`) is an alt-fire/safety fuse. These are two
  different values, not a single "the fuse" constant.
- **Determinism is per-module, not across implementations.** A module is
  deterministic for the same input within its own representation; that is not
  parity with the other side.

---

## 4. How to run comparisons

One Vite dev server serves everything. Start it once, then open the matching URL
(no second server — the retired game and the labs share the same `vite` root):

```
npx vite             # one server; open the URLs below on its printed local origin
```

Comparison URLs — the **dynamite/gib demo is NOT `/sdf-game.html`**:

| URL | What it is | What to use it for |
| --- | --- | --- |
| `/index.html` | Retired game (`src/main.ts`) | Reference behavior (authoritative sim + weapon presentation). |
| `/sdf-lab-webgpu.html` | WebGPU lab (`webgpu/lab-main.ts`) — the SDF dynamite demo. Its **`fpv: enter`** button, or **Tab**, toggles FPV; left-click = cook, release = throw. | Compare SDF dynamite/gib math. |
| `/sdf-game.html` | **Active FPS** (`webgpu/game-main.ts`) — playable, but **has no dynamite integration**. | Play the active game, **not** the dynamite comparison. |

Common comparisons:

- **Dynamite throw feel** — cook/charge timing, throw arc, fuse, self-detonate:
  compare the retired `src/game/weapons/dynamite.ts` + `src/sim/*` against the
  active `dynamite-flight.ts` + `fpv.ts` (drive the active side through
  `/sdf-lab-webgpu.html`'s FPV mode).
- **Gib / blood counts & velocities** — compare the retired
  `src/game/gibs/*` + `src/game/notblood/*` against the active
  `explosion-aoe.ts` + `blood-sim.ts`.

The retired game and the WebGL lab's post-fx path may need dev assets linked
(see §5); the active FPS (`/sdf-game.html`) uses only tracked
`public/assets/lab/` assets. A GPU/rendering validation pass is separate and is
not part of this reference.

---

## 5. Asset prerequisites

- **Active FPS (`/sdf-game.html`):** uses tracked `public/assets/lab/*` assets
  only — no linked placeholders needed to serve it.
- **Retired game (`/index.html`):** needs the gitignored extracted Blood sprite
  placeholders. Run
  [`scripts/link-dev-assets.sh`](../../scripts/link-dev-assets.sh) once per
  worktree. It symlinks the gitignored placeholders **from the primary checkout**
  into this worktree; it does **not** extract them for a fresh clone.
- **WebGL lab `/sdf-lab.html` post-fx:** the forward/WebGL path
  (`lab-main.ts` → `vfx/post-fx/composer.ts`) loads
  `/assets/post-fx/BLOOD.PAL.png` (a gitignored baked palette LUT under
  `public/assets/post-fx/`). The WebGPU lab (`/sdf-lab-webgpu.html`) does **not**
  load it.
- **Never commit or ship** the dev-only placeholders/LUTs:
  `public/assets/**/*-placeholder*`, `assets-source/blood-extracted/`,
  `public/assets/post-fx/`, `public/assets/map-research/`.
