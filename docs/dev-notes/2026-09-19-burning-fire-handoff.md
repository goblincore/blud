# Burning enemies — session handoff (2026-09-19)

Where the burning-enemy work stands after the playtest-feedback pass, what was
learned, and what is open. Pick up from here.

## State (merged to main)

- **Volumetric fire is the game default** (owner pick). `webgpu/game-burning.ts`
  feeds `post-aa`'s fire pass from each burning body's capsules
  (`fire-capsules.ts` → `fire-volume-pack.ts` → `fire-volume.wgsl.ts`).
  Flame cards ride on top as accents. Slot 3 (flare harness, `game-flare.ts`)
  ignites; `__sdfGame.igniteAll()` / `extinguishAll()` for crowds.
- **LOD:** the nearest `maxBodies` (4) burners get the volume; the rest get a
  second, FULL card pool, crossfaded per body over ~0.33 s with 15 % hysteresis.
- **Tuning:** flame lab `sdf-flame-lab.html` → technique **volume**; the panel's
  "copy" line pastes into the game (`__sdfGame.setTechnique / setVolume /
  setTongueTuning / setBurnTuning`). Owner's burn/tongue tuning is the default.
  Volume knobs worth knowing: `tempGain` (brightness), `rise` (flame height,
  0.45), `skin` (flame coating the body, 0.3 — lower = body more visible),
  `density` (opacity), `erode` / `noiseScale` (tongues), `maxBodies`,
  `resolutionScale` (0.4). `headRise` / `headClear` exist but default OFF (1).
- **Other gameplay/visual fixes:** room fire light (PointLight pool + probe
  gather slot), neighbour "molten" flicker fixed, burning zombies chase faster +
  stumble (soldier panic OFF: `BURN_BEHAVIOUR.soldierPanic`), ivory bone at full
  char, soldier's legs burn, flare gun placeholder faces forward.
- **Boot:** cold boot (after any march-shader change or a Chrome update)
  ~195 s → ~48 s: gib + crowd march programs compile in the background after
  `ready` (`warm-background.ts`). Warm boot 1.75 s.
- **Refactor:** `march.wgsl.ts` split tasks 1–2 merged (barrel + `webgpu/march/`),
  bit-identical (golden snapshot + `march-hash`).
- **Roadmap:** develop on web, release as a Rust + wgpu port
  (`docs/game/production-scope.md` §4.6, milestone GR). Plans start from
  `docs/superpowers/plan-template.md` (port-ready rule + boot-time gate).

## What we learned

- **Fire look:** a raymarched flame reads as fire only when every limb is
  swept UPWARD into a tapering sheet and torn by full-contrast, rotated,
  up-scrolling noise; heat follows the same noise; emission and absorption share
  one coefficient (no white blow-out). A thin exp shell around capsules is a glow,
  not fire. `curlStrength` is METRES (a few cm) — 1.3 threw the field off the body.
- **Seeing the body:** opacity alone does not help; the flame coating the body
  surface does. `skin` fixed it.
- **Head shaping read as artificial** in every variant (hard ceiling = flat top;
  shared end height = a horizontal tip line; scaled column = a dip where the
  shoulder sheets stay full). Lowering `rise` for the whole body was preferred.
- **Cost for crowds** comes from the volume march; per-ray capsule culling and
  dropping smoke (its 2.5 m reach on every limb defeated the cull) took 26
  burners from ~43 ms to ~10 ms of march. Apple GPU pass timestamps are queue
  residency, not cost — A/B with `steps 0`.
- **Cold compile:** exactly one ~48 s compile per distinct (march shape × render
  target); the Metal cache is machine-global and keyed on the COMPILED program
  (comments don't invalidate it, constant changes do). Material instances are
  deduped by the driver.
- **Process:** dispatch agents (deepseek-flash/dsh) were good at mechanical and
  measured work (march split, compile census, deferral); the fire look needed
  hands-on iteration with a fast persistent-profile look loop.

## Open

1. **Cheap smoke** (owner: interested to see) — normal-blended smoke cards /
   the explosion smoke layer, not the volume.
2. **Head flame** — owner may revisit; the fix would have to shorten the
   shoulder sheets near the head too, not only the head column.
3. **Compile time next steps** — merge the crowd + body march programs (one
   program, runtime flag); march phase 2 (shrink the 2,100-line `marchBody`,
   named uniform structs) — see `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md`.
4. **march split task 3** (feature blocks out of the big strings + test split) —
   planned, not started (`docs/superpowers/plans/2026-09-18-march-wgsl-split.md`).
5. **Real flare gun** (projectile, damage, burn death) — owner's separate pass.
6. Fire gather light is self-shadowed at the chest anchor (walls get only the
   PointLight pool) — see `docs/dev-notes/2026-09-18-burning-feedback/A-light-and-neighbours.md`.
7. Pre-existing test failures (also on main): `game-actor-torso-slug` (2),
   `march-step-soundness` near-wound (1), `surface-nets-cpu` BAND COVERAGE (1).
