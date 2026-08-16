# SDF lab grapeshot shotgun — design (Spec D)

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner)
**Scope:** SDF zombie lab only, **WebGPU path only** (WebGL frozen). No game-side changes; game modules imported only as pure data.
**Sequencing:** after FPV + dynamite (X1.23) — it rides that spec's FPV mode,
SDF hands, and weapon-slot plumbing. The MODEL can be produced earlier in
parallel (it's an asset script, no code contention).

## Why

Second FPV weapon for gore-stack playtesting: a **homemade grapeshot
shotgun** — improvised pipe-gun aesthetic (owner references: the Abe
assassination zip gun's plank-and-twin-pipes construction, taped multi-barrel
game props). Pellets-vs-flesh is where per-pellet wounds, chain cuts and the
gib threshold show off. Fire model: **Blood sawed-off homage** (owner pick).

## 1. The model — procedural bpy script, dispatched

- A **committed script** `scripts/model_grapeshot_gun.py` builds the gun in
  headless Blender (5.2 CLI is on PATH) and exports
  `public/assets/lab/grapeshot-gun.glb` (+ turntable render PNGs for review,
  since text-only dispatch models can't see their work).
- Construction language: rough wood plank stock (boxy, hand-cut silhouette),
  **two steel pipes** side by side, tape band wraps, a crude trigger loop,
  wire runs to a taped igniter block — the Abe-gun read, claymation-chunky
  proportions so it sits with the lab's style. Materials: flat-ish PBR (wood,
  steel, tape) tuned dark so the latex hands stay the star.
- **Delegation experiment**: the script is authored + iterated by a dispatch
  agent (glm-5.3 now; kimi-k3 when a key lands) using the **dispatcher's
  Blender MCP bridge** (owner has it set up) — live scene inspection
  (object/dimension summaries) gives a text-only model real feedback while it
  models; the committed script + headless `blender --background` export stays
  the reproducible source of truth, and turntable PNGs render each iteration
  for owner/Claude review. Claude-subagent-driving-Blender-MCP directly is
  the recorded fallback if dispatch iteration quality disappoints.
- The gun is a prop mesh like the dynamite stick — **not flesh**.

## 2. Fire model — Blood sawed-off homage

- Two barrels. **Click fires one barrel**: ~8 travelling pellets reusing the
  game's cultist pellet tech as pure data (dodgeable-speed sim pellets,
  35 m/s band, spread cone) — the lab implements a local pellet integrator
  the same way dynamite gets its ballistic integrator (constants imported,
  sim module not).
- **Alt-fire dumps both barrels** (double pellet count, doubled kick).
- Reload beat between shots (break-open pose on the SDF hands: eject, shove
  two shells, snap shut — keyframed prim poses like the dynamite set).
- Per-pellet impact: existing wound pipeline (pellet profile), impulseAt
  recoil on the rig, chain-cut/sever checks — a point-blank double-barrel to
  the shoulder should take the arm off through the systems that already
  exist. Muzzle flash: small billboard + a one-beat light kick; smoke wisp
  particle optional.
- FPV kick: camera punch scaled per barrels fired.

## 3. Hands integration

- Reuses X1.23's SDF hands + pose-keyframe system wholesale: hold, fire
  (recoil jolt through the verlet jiggle), break-open reload, both-barrels
  brace. Weapon slot 1/2 switching between dynamite and grapeshot (matching
  the game's slot-switch convention).

## 4. Testing

- Pure units: pellet spread cone determinism under a seed; per-barrel vs
  both-barrels pellet counts; pellet integrator flight/decay vs game
  constants; reload state machine (fired-one/fired-both/reloading); slot
  switching.
- Model script: runs headless in CI-style (`blender --background --python`),
  exports a .glb under size budget (< 1 MB), renders turntables; script is
  deterministic (fixed seeds for jitter).
- Visual: gun reads homemade; one-barrel vs both-barrels feel distinct;
  point-blank double removes limbs; pellets visibly travel.

## Out of scope

- Game-side player shotgun (the game's own arsenal work picks this up later).
- Ammo economy/pickups, sound.
- Any third weapon.
