# Organs & springy guts — task 6: gates and evidence

**Date:** 2026-09-02 · **Branch:** `dispatch/2026-09-02-organs-task-6` ·
Tasks 1–5 shipped on commits `2aab94d` (W_ORGAN through the CPU layer),
`2e94585` (organ material), `bff3ce2` (the authored coil), `21dde41` (the
skip-one spring), `5881f1d` (gut mask through goo's alpha). This task ran the
plan's five gates. Nothing here was pixel-diffed — the harness has 52–82k px
of same-build flicker; visual gates were judged by looking, cost was judged by
the counter.

## Gate 1 — off-state parity: PASS

- `organAmp 0` shades organ prims exactly as bone: the shader's mix weight IS
  `organAmp` (`mix(albedo, organColor, organAmp)` — WGSL `mix(x,y,0)` returns
  `x` bit-exactly), pinned by a new source test. Capture
  `06-organs-gut-organamp0-offstate.png` shows the same staged crater reading
  plain bone at amp 0.
- A body with no organ prims packs bit-for-bit: new pack test packs the same
  prim as `bone` and as `organ` and requires every packed array byte-identical
  except `primScale.w` (4 → 5).
- Goo inert with no gut droplets: the density colour's alpha term is
  `fall.mul(gutMask)` (0 contribution without gut droplets), the target clears
  alpha to 0, and `mix(bloodLiteral, organColor, gutFrac)` at `gutFrac 0`
  returns the verbatim pre-organs literal — each link pinned by a source test
  (the two alpha traps were already pinned by task 5's tripwires).
- Discriminative, not vacuous: the new goo test was run against the pre-organ
  build (`2e94585`) and FAILS there, exactly because the gut-mask wiring is
  absent at that commit.

## Gate 2 — containment across the cast: PASS

`npm test`: **2692 pass / 7 fail — all 7 the pre-existing `blob-measure` ELOOP
node_modules-symlink artifact** (verified identical on a stashed clean tree in
task 4; not touched here). Every character .blob (all ten) validates through
`validateBody` → `checkBoneContainment`, which now covers organ prims. The
zombie carries 8 organ prims (4 bent bars + 4 blob bulges, pelvis/spine).
`BONE_CONTAINMENT_MARGIN` untouched at 0.004 (diff vs base `0fc1de8` shows no
change to it).

## Gate 3 — counter delta: meanPerPayingRay +31.2%

`scripts/sdf-game-organs-boneevals.mjs` (new) stages the gore-r3 baseline
wound set — 12 slug wounds, 3 per body at staggered gut-band heights, on the
first aimable bodies — and reads `__sdfGame.boneEvals()`. Three ALTERNATING
legs per build; "before" is `2e94585` (organ material wired, zero organ prims
authored), served from a scratch worktree; fresh page per leg.

| leg      | build  | bonesTotal | meanPerPayingRay | paying px* |
|----------|--------|-----------:|-----------------:|-----------:|
| before-1 | 2e94585|  1,465,952 | 220.3            | 6,655 |
| before-2 | 2e94585|  1,264,608 | 274.6            | 4,605 |
| before-3 | 2e94585|  1,463,968 | 222.0            | 6,595 |
| after-1  | HEAD   |  1,826,800 | 278.8            | 6,553 |
| after-2  | HEAD   |  1,616,680 | 337.9            | 4,784 |
| after-3  | HEAD   |  1,081,240 | 323.7            | 3,340 |

\* derived as `bonesTotal / meanPerPayingRay`; `pixelsWithBone` is not in the
seam's return.

- **meanPerPayingRay: before mean 239.0 → after mean 313.5 = +31.2%**
  (matched pairs: +26.6% at ~6.6k paying px, +23.0% at ~4.7k, one
  placement-mismatched pair at +45.8%).
- bonesTotal means land only +7.9% — that metric is polluted by how many
  paying pixels each leg happened to stage (after-3 drew 3,340 vs before-3's
  6,595 from identical wound counts); matched-pixel-count pairs agree with the
  per-ray number (+24.6% / +27.8%). Per-ray cost is the honest figure.
- The plan guessed ~+45% (8 prims on ~17, all prims per paying ray). The
  measured +31% sits below that because `foldGroup` culls by group sphere:
  the organ prims live on pelvis/spine, so rays paying for chest/limb wounds
  never evaluate all 8.
- **organAmp 0 reads a bit-identical counter** — 3/3 legs
  (`evalsAmp0.bonesTotal === evals.bonesTotal`), which is the proof that the
  delta is the prims and not the shading.
- The gore-r3 reference baseline (1,224,192 total / 291.8 per paying ray for
  the same recipe) sits inside the before legs' band — those absolute numbers
  are placement-dependent, which is exactly why this gate re-staged both
  builds instead of comparing to the reference.

## Gate 4 — combat-range capture: spring YES, "pale coil" qualified

`scripts/sdf-game-organs-capture.mjs` + `scripts/sdf-game-organs-closeup.mjs`
(new), staged via `predictSlugHit()` → `stampWoundAt(..., 'slug', actorId)` at
2.4 m under the beam, `spillChance 1` so the rope is guaranteed.

Staging gotcha that cost one failed run: the spill verdict is TORSO-gated, and
gravity bends an aimed slug — the first "gut" stamp landed at y 0.82 (hip),
opened no cavity, rolled no spill. The scripts now READ THE WOUND BACK and
retry aim candidates until the stamped wound actually carries
`cavity:true && spillCalibre:'slug'`.

**The rope is no longer a T.** Sequence at 3 → 30 → 90 steps
(`02`/`03`/`04`-organs-gut-rope-*): a straight hanging strand recoils into a
bunched coil below the wound and settles at the spring's rest shape (span
0.33 m, matching task 4's measured 61%-of-contour). At 1.3 m the settled rope
reads as a segmented, glossy, lumpy coil (`01-close-crater-closeup.png`) —
structurally nothing like the owner's "rigid dark T".

**The gut mask is wired, and absorption is what hides it.** At shipped
`absorb 1.6` the rope reads RED, not pale pink. The discriminator shot
(`03-close-rope-absorb0-discriminator.png`) sets goo `absorb 0` — the
absorption filter `trans` becomes 1 — and the SAME rope reads unmistakable
pale salmon, coiled. So `gutFrac ≈ 1` on rope pixels end to end; the shipped
red cast is `exp(-thick·(0.30,2.40,2.00))` turning even salmon red-dominant
through goo thickness. This is the spec's honest caveat landing on schedule
("if it comes out muddy, lift the organ's wet/emissive response rather than
chasing the colour") — **owner call, and the levers are**: lower `absorb`,
and/or a gut-fraction-weighted absorption discount in the surface pass. NOT a
wiring bug; do not "fix" the blend state.

**The cavity's organ prims barely surface.** The crater shows a pale sliver at
its rim (`01` vs `04-close-crater-closeup-organamp0.png`: near-identical —
what's visible is mostly the bone plug either way). The organs sit inside,
behind the plug the nearWound gate exposes; the entrails task-8 finding
("viscera tint not discernible; geometry claims the crater") repeats for
organ GEOMETRY at this depth. What carries the feature in practice is the
SPILL: the thing that comes out now visibly matches the coil structure. If the
owner wants coils IN the crater, the lever is shallower organ placement or a
bigger crater knee — form, not colour.

**Chest still reads ribs.** `07`/`08-organs-chest-ribs*` and the close-ups
(`05`/`06-close-chest-closeup*`): the chest crater carries a pale rib arc, no
coiled mass; the rope that spills from a chest hit at `spillChance 1` is by
design (torso wound, roll pinned). Gut-wound assertions held:
`nodes 10, droplets 10, attached, woundCavity true`.

## What did NOT work / cost time

1. **A borrowed headless Chrome died mid-run** (the pre-launched CDP instance
   from an earlier session vanished between legs). Own Chrome on a fresh port
   fixed it; every leg since is on the owned instance.
2. **The capture script hung silently once** — an unbounded CDP `fetch` plus a
   WebSocket-held event loop. Both capture scripts now carry a 6–8 min
   watchdog, fetch timeouts, and an explicit `ws.close(); process.exit(0)`.
   A earlier version lingered after printing OK and burned a leg to the
   watchdog — if you extend these scripts, keep the explicit exit.
3. **Predictor validation cannot aim into an existing crater** — the
   close-up pose search originally required `predictSlugHit()` to confirm the
   pose, but a carved bowl swallows the ray; flaky per wound. Close-ups now
   pose unconditionally (1.1–1.7 m from a wound on the target body).
4. The counter script's first print read a field the seam does not return
   (`pixelsWithBone`) — derived from `bonesTotal/meanPerPayingRay` instead.

## Suite state

`tsc --noEmit` clean. `npm test` 2692 pass / 7 fail (pre-existing ELOOP only).
New tests: 1 pack row-identity, 1 march amp-0 identity, 1 goo inertness chain
(all watched passing here, and the goo one watched failing on the pre-organ
build).
