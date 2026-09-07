# Blud — repository map

This is the authoritative source map. It distinguishes **current state** (facts,
verified at base `c120a3e7`, Stage 1) from **proposed target state** (a plan, not
executed). See the [design spec](../superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md)
and the [Stage 2 plan](../superpowers/plans/2026-09-07-fps-legacy-repo-structure.md).

---

## 1. Current-state tree (facts)

Source lives under `src/`. The active game and tooling sits under
`src/lab/sdf-zombie/`; the retired game and the older sim interleave the rest of
`src/`. This is the layout as of Stage 1 — physical separation is deliberately
not done yet.

```
src/
  main.ts                      # RETIRED game entrypoint (index.html)
  engine/
    renderer.ts                # shared: old game (main.ts) + active lab (lab-main.ts, webgl-bench.ts)
    loop.ts, input.ts, asset-loader.ts ...
  game/
    gibs/
      tuning.ts                # SHARED dual-consumer (active + old); imports notblood tables
      index.ts, chunks.ts, particles.ts, decals.ts, ground-flame.ts (old gib stack)
    notblood/
      death-outcome.ts, outcome-adapter.ts, notblood-tables.gen.ts   # RETIRED table pipeline
    level/
      theme-material-set.ts    # SHARED: active webgpu/game-main.ts + bake-cosmetic.ts
      stone-textures.ts        # imported by theme-material-set.ts
    weapons/
      muzzle-pos.ts            # SHARED: active webgpu/game-main.ts + old main.ts
      dynamite.ts, flare.ts, stuck-flare.ts, index.ts ...   # RETIRED weapon presentation
    enemy/ ...                 # RETIRED (axe-zombie, shotgun-cultist, cultist-ai, ...)
    encounter/ ...             # RETIRED (wave-runner, encounters, ...)
    arena.ts, rng.ts ...
  sim/
    projectile.ts, thing.ts, step.ts, explosion.ts, runner.ts ...   # RETIRED authoritative sim
  lab/
    sdf-zombie/                # ACTIVE game + tooling (see next block)
    dev-save.ts                # dev-only save handlers (used by vite.config.ts)
  vfx/
    post-fx/composer.ts, config.ts, post-fx-bus.ts, dev-panel.ts, barrel-pass.ts
                               # SHARED: old main.ts + active lab-main.ts
    explosion.ts, smoke-particles.ts, screenshake.ts ...
  engine/, physics/, ui/, audio/, animation/, dev/ ...
```

### 1.1 The active tree (`src/lab/sdf-zombie/`)

Includes the character authoring tools, WebGPU lab, benchmarks and their
modules. Character assets are `.blob` / `.wam` files under `characters/`, with
GLB clips and GLSL/WGSL sources alongside their TS modules. Lab entrypoints:

| URL | Module |
| --- | --- |
| `/sdf-game.html` | `src/lab/sdf-zombie/webgpu/game-main.ts` (active game) |
| `/sdf-lab.html` | `src/lab/sdf-zombie/lab-main.ts` |
| `/sdf-lab-webgpu.html` | `src/lab/sdf-zombie/webgpu/lab-main.ts` |
| `/sdf-bench.html` | `src/lab/sdf-zombie/webgpu/bench-main.ts` |
| `/sdf-lab-webgl-bench.html` | `src/lab/sdf-zombie/webgl-bench.ts` |
| `/sdf-lab-webgpu-bench.html` | `src/lab/sdf-zombie/webgpu/spike-main.ts` |
| `/humanoid-sdf-spike.html` | `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts` |
| `/sdf-hull-spike.html` | `src/lab/sdf-zombie/webgpu/hull-spike-main.ts` |
| `/sdf-shell-spike.html` | `src/lab/sdf-zombie/webgpu/shell-spike-main.ts` |
| `/normal-gradient-check.html` | `src/lab/sdf-zombie/webgpu/normal-gradient-probe.ts` |
| `/shared-wounds-probe.html` | `src/lab/sdf-zombie/shared-wounds/probe.js` |
| `/bounded-wounds-bench.html` | `docs/dev-notes/2026-09-07-bounded-torso-regions/bench.js` |

### 1.2 Direct external imports from the active tree

The active game does **not** self-contain all of its dependencies. Verified
external (outside `src/lab/sdf-zombie/`) imports:

- `game/level/theme-material-set.ts` → `stone-textures.ts` — used by
  `webgpu/game-main.ts`.
- `game/weapons/muzzle-pos.ts` — used by `webgpu/game-main.ts`; its `Vec3` type
  currently comes from `game/gibs/particles.ts`.
- `game/gibs/tuning.ts` — used (as pure data) by `blood-sim.ts`,
  `dynamite-flight.ts`, `hands.ts`, `fpv.ts`, `explosion-aoe.ts` and their
  tests. `tuning.ts` **itself imports** `game/notblood/notblood-tables.gen.ts`
  for the raw NotBlood tables, so it carries both general tuning and old enemy
  tables.
- `engine/renderer.ts` — used by `lab-main.ts` and `webgl-bench.ts`.
- `vfx/post-fx/{composer,config,post-fx-bus}.ts` — used by `lab-main.ts`.
- `lab/dev-save.ts` — used by `vite.config.ts`; writes
  `src/lab/sdf-zombie/characters/<name>.blob` and
  `public/assets/lab/faces/<file>.png`. Path-sensitive tooling.

The **retired** `src/main.ts` reaches much of the same shared surface:
`engine/renderer.ts`, `vfx/post-fx/*`, `game/weapons/muzzle-pos.ts`,
`game/gibs/tuning.ts`, plus the old `sim/*`, `game/gibs/*`, `game/notblood/*`
and `game/weapons/*` trees.

> Consequence: a whole-tree move of any shared module breaks the other side.
> `tuning.ts` is the clearest case — splitting it (or making a narrow
> shared-data module) is required before the old tree is moved.

### 1.3 Assets & tooling

- `assets-source/blood-extracted/` — cached extracted Blood asset dump
  (**gitignored, dev only, never ship**).
- `public/assets/` — tracked dirs (`animations/`, `blood-tiles/`, `lab/`) clone
  with the repo; the rest are gitignored placeholders linked per worktree.
- `scripts/link-dev-assets.sh` — links the gitignored placeholders from the
  **primary checkout** into the current worktree. Only fills holes; does not
  extract for a fresh clone.
- `scripts/gen_notblood_tables.py` — generates
  `src/game/notblood/notblood-tables.gen.ts`.

---

## 2. Dependency edges (active ↔ legacy ↔ shared)

```
ACTIVE (src/lab/sdf-zombie)  ──imports──►  SHARED  ──imports──►  LEGACY (src/game, src/sim)
  game-main.ts  ──► game/level/theme-material-set ──► stone-textures
  game-main.ts  ──► game/weapons/muzzle-pos ──► game/gibs/particles (Vec3 type)
  blood-sim / dynamite-flight / hands / fpv / explosion-aoe  ──► game/gibs/tuning ──► game/notblood/notblood-tables.gen
  lab-main.ts / webgl-bench.ts  ──► engine/renderer
  lab-main.ts  ──► vfx/post-fx/{composer,config,post-fx-bus}
```

Shared consumers (only these keep their currently duplicated roles):

- `game/gibs/tuning.ts` — data only, dual consumer.
- `game/weapons/muzzle-pos.ts` — dual consumer (game + active).
- `game/level/theme-material-set.ts` + `stone-textures.ts` — active-consumed.
- `engine/renderer.ts` — dual consumer.
- `vfx/post-fx/*` — dual consumer.
- `lab/dev-save.ts` — build tooling.

---

## 3. Target-state tree (PROPOSED — Stage 2, not executed)

The approved future layout separates active, legacy, and a small shared boundary.
It is a **plan**; nothing below has been moved yet.

```
src/
  fps/            # ACTIVE game + tooling + benchmarks + modules
  legacy/         # RETIRED runtime (old game + old sim + old gib stack)
  shared/         # ONLY real dual consumers (tuning data, muzzle-pos, renderer, post-fx, theme-material)
```

Notes:

- `src/lab/sdf-zombie` → `src/fps` (path rename; the character/tooling lives inside).
- Old `src/game`, `src/sim`, old entry `src/main.ts` → `src/legacy`.
- Shared utilities/data hoisted to `src/shared` only where both sides actually
  import them (e.g. `tuning.ts` split into a narrow data module + active-side
  values, `muzzle-pos.ts`, `renderer.ts`, `post-fx/*`, `theme-material-set.ts`).
- Root `/` becomes the active game; retired `/index` callers need an explicit
  legacy entry strategy.
- Assets/scripts whose consumers cross both projects stay put or move once.

See the [Stage 2 plan](../superpowers/plans/2026-09-07-fps-legacy-repo-structure.md)
for the exact ordered moves and dependency-extraction steps.
