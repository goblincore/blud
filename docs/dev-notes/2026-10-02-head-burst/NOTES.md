# Slug head burst — build notes (2026-10-02)

Spec: `docs/superpowers/specs/2026-10-02-slug-head-burst-design.md` · plan: `docs/superpowers/plans/2026-10-02-slug-head-burst.md`
· gate: `scripts/head-burst-gate.mjs` (photos in `gate/`).

## What was verified, and how

- **Pure suites** (`head-burst`, `head-deform`, `head-damage`, `head-crown`, `head-flap`, `damage.test`): pass.
- **`tsc --noEmit`**: one error, `pack-golden.test.ts` cannot find `node:crypto` (a file this work did not touch).
- **Refactor safety (plan Task 7):** the existing `head-damage-gate.mjs` before and after extracting `headOf`/`kit`:
  47 checks both times; the same "both painted glows are gone" check fails in both (it was failing BEFORE any leaf edit:
  R 0.149 → 0.036). The cost check failed once (0.90 ms) and passed once: timer noise. So the refactor is
  behaviour-preserving as far as this gate sees; the gate itself is not clean on this machine.
- **`head-burst-gate.mjs`: 19 checks, 0 failed** (headless WebGPU, real `fireSlug()` shots on the bare ring page):
  lethal dead-centre (offset 0.007, kills, exit crater, swell peak 0.319 settling to its 0.112 rest, +20 chunks, 3 flaps in
  1 draw, collapses, head still on); glancing (offset 0.64, alive, cheekL cracked to 0.8, no exit crater, 2 flaps, standing
  when thawed, a second slug at the same spot kills); burst-off leaves no burst state; no console errors.

## What the gate found (fixed)

1. **A second glancing slug on the same region did not kill.** `burstHit` raised the crack to `max(skull, 0.8)`, so
   repeated slugs never escalated. A repeat on an already-cracked region now adds `skullPerHit` (0.8 + 0.32 ≥ 1). Unit-tested.
2. **Aiming a slug in a gate is not "crosshair on the head".** The muzzle sits ~0.6 m right of the aim axis, so close in
   (0.9 m) the line is ~35° oblique, and the slug drops under gravity. The gate shoots from 2 m and SOLVES the stance
   (sideways slide + pitch, gravity included) until `predictSlugHit` passes the wanted distance from the head centre.

## What is NOT verified

- **Frame cost.** The draw timer in this environment spreads by tens of ms between identical runs (baselines 94 / 94.5,
  then 102 / 64), and a burst leaves ~7-20 debris chunk views in the scene, so a delta cannot isolate the flaps. What is
  measured and gated: all flaps of a head share ONE attached piece (1 draw). Real cost needs a quiet machine.
- **How it looks next to the ballistic dummy.** Owner call (see the playtest round below for the first verdict).
- Other characters (goblin, bride, minotaur, warbull) are excluded: only `profileName() === 'zombie'` takes the burst.

## Tuning knobs

`__sdfGame.head.burstTune({ on, centreFrac (0.35), swell (0.32), shardScale (1), flapCount (-1 = plan default) })`;
constants in `head-burst.ts` `BURST`, `head-deform.ts` `BURST_DEFORM`, `head-flap.ts` `FLAP`, `head-crown.ts` `SHARDS`.

## Owner playtest round 1 (2026-10-03) and what changed

Feedback: the flaps read as wiggling orange tubes, not torn flesh sheets (but "quite creepy"); two head slugs killed the
zombie so the rupture could not be studied; the rupture was hard to see; and there should be a state where the head splits
open but the zombie lives (reference: a mesh zombie with the side of the head peeled open into ragged sheets).

- **Flaps are OFF for the zombie** (`BURST.flaps` 0, default `flapCount` -1 → 0). The code (`head-flap.ts`, the leaf's
  `attachFlaps`/`stepFlaps`) stays. `burstTune({ flapCount: 3 })` brings them back.
- **A centred slug no longer kills** (`burstTune({ lethal: true })` restores it). It SPLITS the head open and the zombie
  lives (outcome `split`): entry + exit crater, heavy debris, a lasting widening across the shot (`splay` 0.1) and a bigger
  lasting exit bulge (`BURST_DEFORM.rest` 0.35 → 0.5, swell 0.32 → 0.4).
- **Much harder to kill:** a repeat slug on an already-cracked region adds only `repeatStep` (0.04) instead of 0.32. In the
  gate a split zombie survived 8 slugs at the same aim and died on the 9th.
- **More visible:** crater radii up (entry 0.09 → 0.12, exit 0.11 → 0.14, glancing 0.07 → 0.09), `craterScale` multiplies both.
  The split capture (`gate/S-settled.png`) shows a large open cavity through the head with the skull interior visible.
- **Gate:** 24 checks, 0 failed (new scenario S; A and B now set `lethal: true`, `flapCount: 3` to keep the kill path and the
  flaps tested).

## Monster idea (owner, 2026-10-03)

**A new monster with dangling, wiggling, jelly-orange tubes** as its signature: the scalp-flap chain that did not suit the
zombie ("quite creepy"). The pieces already exist: `head-flap.ts` (sprung verlet chain, constant prim count) and the leaf's
rim-hinged attach (one draw for all of them, riding the head through wound trackers). A real "torn flesh sheet" look needs
flat geometry (the tubes are capsules); try prims with `orient` and a flattened `scale`, and check the chunk shader's
brightening (head-pop's note: thrown meat is brighter than MEAT because of the dim chunk fill).
