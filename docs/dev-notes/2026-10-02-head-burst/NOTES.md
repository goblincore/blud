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
- **How it looks next to the ballistic dummy.** From the captures: the head bulges and distorts toward the exit side, the
  entry crater is a dark open cavity that stays after the swell settles, blood and shards fly. The scalp flaps read as torn
  strips beside the crater but are still bright orange-red and tube-like (the chunk shader brightens meat; darkening the
  colour barely moved them). The photo stance is the zombie's profile, so the exit crater is not in frame. Owner call.
- Other characters (goblin, bride, minotaur, warbull) are excluded: only `profileName() === 'zombie'` takes the burst.

## Tuning knobs

`__sdfGame.head.burstTune({ on, centreFrac (0.35), swell (0.32), shardScale (1), flapCount (-1 = plan default) })`;
constants in `head-burst.ts` `BURST`, `head-deform.ts` `BURST_DEFORM`, `head-flap.ts` `FLAP`, `head-crown.ts` `SHARDS`.
