# Wound hull holes — the invisible-zombie regression (2026-08-27)

Owner report on the wound-red-interior build: "wound craters show in some
instances but certain parts of the zombie become invisible; when the zombie
walks in front of another zombie you see weird transparent holes."

## The experiment the brief demanded, and what it showed

`dcd61ca` (wound exclusions on the occluder hull) was the prime suspect. The
decisive experiment — empty exclusion list vs shipped exclusions vs occluder
fully off, same wounds, settled frames — showed **no meaningful difference**
(41934 vs 41735 px at threshold 24 on the primary staging; visually identical:
the body missing in all three). **The exclusions were innocent.** They also
visibly do their real job: with exclusions off, craters show pale grey hull
discs (`gates-overlap-and-front.png`, top right); with them on, the crater
reads red. The path stays.

## The actual mechanism — the depth slab carves an unbounded half-space

`b33af36`'s depth cap used

```wgsl
smax(d, max(-(r - depth), dot(p - w.xyz, wCap.xyz) - capEff), k)
```

The slab operand's sign is inverted. `dot(p−anchor, inward) − capEff` is
positive everywhere deeper than the cap plane, so the `max()` keeps the carve
term positive across the ENTIRE half-space beyond the cap — out to infinity,
in every direction. Every wound silently deleted all flesh deeper than its
cap plane, including the body's far side and whatever stands behind it.

- One wound looks perfect from the front (the erased region is hidden inside)
  — which is why the owner's single-slug approval and the 3 cm placement gate
  both passed.
- Buckshot/blast class = many wounds from mixed directions → the half-spaces
  union to "this torso is empty space" → the march hits nothing, the body
  vanishes, and you see whatever is behind it. Exactly the owner's symptom.
- The lab never showed it because the lab uploads NO caps (uncapped path ⇒
  `capEff = 1e5` ⇒ the slab term loses the comparison for any real distance,
  reducing to the plain sphere — bit-identical). Only the game uploads caps.

Instrumented proof (`diag-hit-map-pre-fix.png`): occT debug heat with the
occluder OFF — unwounded body = solid hit coverage; 5-slug body = **zero hits**
except a few lip specks. Not shading, not composite, not the occluder.

The distance-dependent "ghosting" seen mid-investigation was the post-AA
temporal smear averaging stale frames into single hand-stepped captures — a
harness artifact, not in the shipping loop. All gate captures settle 12 frames
per change; nothing distance-dependent survives the fix.

## The fix

```wgsl
smax(d, min(-(r - depth), capEff - dot(p - w.xyz, wCap.xyz)), woundCfg.y)
```

`{inside sphere} ∩ {shallower than cap}` is convex; its inside-positive SDF is
`-max(sphereSDF, slabSDF) = min(depth − r, capEff − dot)`. Shallow+inside
carves; beyond the cap flesh remains; outside the sphere nothing changes.
Uncapped (`capEff = 1e5`): `min(depth − r, 1e5 − dot)` loses the min for any
real distance — bit-identical to the pre-slab sphere, keeping the lab stable.

## Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run src/lab` | **1662 passed** (1660 base + 2 new behavioural carve-slab tests) |
| Lab pixel parity (holdStill + fixed stamp + fixed cam, stash-dance pre/post) | pre-stamp 0.002%, post-stamp **0.003%** >4/255 vs a 0.02% same-code floor |
| Slug placement gate (`scripts/sdf-game-slug-gate.mjs`) | **PASSED**, 2.69 cm ≤ 3 cm |
| Heavily-wounded body, 5 angles, occluder ON | body complete everywhere; craters red (`gates-angles-and-red-bowl.png`) |
| Two-body depth overlap, room 2 | no see-through; exclusions-off shows the pale discs it exists to fix |
| Red-bowl look | intact; central-crop redFrac 0.218 on the single-slug close-up |

## Occluder perf A/B — attempted, machine too noisy, unresolved

Two interleaved benchGpu runs (4 and 15 bodies, alternating start side, 6 reps,
contamination filter). This machine could not resolve the delta: within-config
spread (4-body medians 24→40 ms; 15-body 79→158 ms) exceeded every
between-config delta; most reps flagged contaminated (p95 > 3× median, spikes
to 380 ms). At 15 bodies the better samples lean "occluder ON faster"
(58–70 ms on vs 79–111 ms off), consistent in direction with X1.15's clean
16.29 vs 18.32/21.30 measurement. No removal recommendation is possible from
this data; re-gate on a quiet machine before deciding. The 4-body case agrees
with the brief's own measurement: nothing.

## Dev seams added (game-main.ts)

`__sdfGame.setOccluder(on)`, `setHullExclusions(on)`, `refreshHull()`,
`hullDebug()`, and `stampWoundAt(..., bodyId?)` — the game-page twins of the
lab's driver surface; every gate in this note is re-runnable through them.
`refreshHull()` exists because the frame-loop hull update is gated on
`!wanderFrozen`, so frozen captures would otherwise shoot through a stale
hull. Also added march debug mode 3 (occT heat) — guarded, off by default;
it is the instrument that cracked this class of bug and stays for the next one.
