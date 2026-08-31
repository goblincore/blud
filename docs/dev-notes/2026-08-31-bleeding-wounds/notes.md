# Bleeding wounds — per-calibre gore on the game page

**Date:** 2026-08-31 · **Branch:** `dispatch/bleeding-wounds` · **Status:** all four plan tasks done, gates green
**Spec:** `docs/superpowers/specs/2026-08-31-bleeding-wounds-design.md` · **Plan:** `docs/superpowers/plans/2026-08-31-bleeding-wounds.md`

## What shipped

Wounds on `sdf-game.html` bleed per calibre: pellet pocks ooze a short
dribble, slug craters spurt-then-drip, severed stumps gush; flying severed
chunks trail droplets; everything settles into floor splat decals. Anchors
are **references, recomputed every frame** from the posed body
(`woundWorldPos`/`woundCarveNormal` at the yaw-0 contract), so blood rides
the walking, staggering and collapsing body. Ships **ON**;
`__sdfGame.setBleed(false)` is the off switch (and the off gate).

- Task 1 `aef6618` — `WOUND_BLEED` table + pure `spawnWoundDroplets` in
  `blood-sim.ts` (spawn decisions only; caller owns anchors and the
  fractional accumulator; 4 seeded rng draws per droplet, fixed order).
- Task 2 — `bleed-registry.ts` ledger (per-body cap 6, oldest evicted;
  lifetime expiry pruned in `live()`; entries hold the **Wound object**,
  not a ring index — `pushWound` evicts from the ring head at MAX_WOUNDS,
  so an index silently re-aims at the wrong wound) + `game-main` wiring.
- Task 3 — `createBloodView({dropletDepthWrite, dropletViewScale})`;
  game passes `true`/`1`. Lab default behaviour unchanged (bit-frozen).
- Task 4 — this note + `scripts/sdf-game-bleed-gate.mjs` (parity / reel /
  bench) and a `bleed-off` leg in `scripts/sdf-game-bench.mjs`.

Tuning lives in one table, `WOUND_BLEED` (`blood-sim.ts`):
pellet 7 Hz const × 2 s, cone 0.5 rad, 0.5–1.2 m/s;
slug 42→1.5 Hz (τ 0.45 s) × 6 s, 1.8–3.6 m/s;
stump 90→5 Hz (τ 1.4 s) × 10 s, 2.5–5.5 m/s (the arc).
Burn wounds never bleed (no entry). Registry cap: `PER_BODY_EMITTER_CAP = 6`.
Bleed rng stream: `mulberry32(0x5eedb1e)`, advanced only while enabled, on a
sim-time accumulator (`bleedClock`) — never wall time, so hand-stepped
captures are deterministic.

## The depth trap — verified in captures, not argued

`closeup/seq/f08` + `f10` are the proof frames: at 1.6 m the slug severs an
arm, the stump gushes, and droplets cross **in front of** the body's flesh
silhouette and stay visible. Mechanism as planned: the droplet material runs
`depthWrite: true, transparent: false, alphaTest: 0.3` in the MAIN polygonal
pass, so the SDF composite (flesh depth carried in the march target's alpha
into the composite's `depthNode`, hardware-tested against polygonal depth)
occludes droplets and flesh **both ways for free**. No post-composite
special case like the muzzle flash needed. Splats stay soft
(`depthWrite: false`) — the floor's own depth arbitrates them; the existing
0.005 m + index ladder beats z-fighting (clean in `slug/seq/f06`, where a
splat sits on the floor at 3 m).

## Per-calibre reel

`seq/{pellet,slug,sever,closeup}/f*.png` (12/12/24/12 frames, fresh page
load per sequence, frozen staged aim via `aimSurface`):

- **pellet** (4 m, one barrel): red pocks with a brief dribble at each crater;
  both arms intact. (At 3 m even ONE barrel clusters enough to sever a
  shoulder — that is the gun, not the bleed; 4 m tells the ooze-only story.)
- **slug** (3 m): one big crater spitting a dense blob that decays to a drip;
  a splat decal lands on the floor mid-sequence.
- **sever** (3 m): slug cuts a piece off (`chunkCount=1`), TWO emitters live
  (slug crater + stump), stump gush arcs droplets across the frame, the
  flying chunk trails droplets (`emitTrails` — the game page's first trails).
- **closeup** (1.6 m): sever + gush at close range; the depth-fix frames.

The droplet look is the lab's gib-blood billboard (spec's placeholder call)
at sim size — `BLOOD_TRAIL.size` is already game-camera tuned; the lab's
0.45 `DROPLET_VIEW_SCALE` is close-camera compensation and is NOT applied.
At 1.6 m droplets read BIG (they fly toward the camera); that is the
placeholder look at point-blank, tunable via `WOUND_BLEED.*.sizeMin/Max`.

## Off-state parity — the gate that needed three attempts

`scripts/sdf-game-bleed-gate.mjs parity` — within ONE page load (the C2
spike's lesson: cross-load captures never pixel-identical; boot runs the
loop before `__sdfGame` exists). Protocol: fire a slug so wounds + emitters
exist, freeze, then OFF-settle-capture → ON 31 steps → OFF-settle-capture.

1. **30 settle steps failed** (1728 px, max Δ36): the history buffer was
   disturbed by ~2 s of droplets + a walking zombie right before the first
   capture.
2. **240 steps still failed** (427 px, max Δ1) — and a **no-toggle control**
   on the same scene diffed **literal 0**. Two separate causes isolated:
   - At the shipped default smear 0.25, the post-AA temporal filter leaves a
     **±1/255 rounding limit cycle** on ~0.09% of px after bright droplet
     ghosts. It survives 240 steps (it is a rounding cycle, not decay).
   - At smear 0 the residue dropped to ~40-120 px on **silhouette edges**,
     and controls (no toggle, same load, same protocol) showed the SAME
     40-120 px @ max Δ6-25: the march's edge-AA sampling jitters with frame
     index. A capture is a sample, not a fixed point. (The C2 spike's scene
     was AA-stable and read 0 — this one is not; measured, not assumed.)
3. **Final gate = the plan's own wording, "zero above the noise floor"**: at
   smear 0, two CONTROL cycles measure the same-state floor on the load,
   then the toggle cycle must not exceed it. Result: controls 42 px/max 1,
   toggle cycle **0 px / max 0 — PASS**. The default-smear cycle is
   reported, not gated (181 px, max Δ1 — the filter's ghost residue).

## Bench — fire-segment delta, chunked+fenced, interleaved

`BENCH_LEGS=baseline,bleed-off BENCH_ROOMS=3,4`, `scripts/sdf-game-bench.mjs`
(fresh page per run, hidden-frame invalidation, census; `bleed-off` joins the
leg matrix and `setBleed(true)` is in the ship-defaults reset, so the
"before" column is the pre-feature page — the parity gate proves OFF is
pixel-equivalent to pre-feature). Median chunk-mean ms, median of 3 repeats:

| leg | room | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline (ON) | 3 | 14.29 | 9.36 | 14.25 | 15.75 | 24.44 |
| bleed-off | 3 | 14.19 | 9.31 | 14.16 | 15.51 | 43.06 |
| baseline (ON) | 4 | 9.47 | 11.66 | 9.33 | 7.73 | 42.60 |
| bleed-off | 4 | 9.60 | 11.86 | 9.08 | 8.23 | 45.88 |

Repeat spread: 2% / 5% / 0% / 9%. Fire-segment deltas: room 3 +0.09 ms,
room 4 +0.25 ms — **both UNDER their legs' spread: UNRESOLVED, not zero.**
Census: fire segments carried real work (wounds 0→13 / 0→14, bodies 8→8 /
9→4). At real-firefight droplet counts the feature's cost is below this
machine's measurement floor. Full data: `bench/bench.{json,md}`.

## Testing

- `blood-sim.test.ts` +9: per-kind pinned counts (pellet = exactly 14 over
  its 2 s), front-loaded slug, stump>slug, zero spawns past lifetime,
  seeded determinism (counts AND positions), cone containment, FIFO cap at
  600, accumulator carry.
- `bleed-registry.test.ts` +9: per-body cap evicting oldest (per body!),
  lifetime expiry, `evictForBody`, reference identity, carry round-trip,
  emit-normal negation + axis-outward fallback + degenerate-up.
- Suite: **1717 green** (baseline 1699 + 18), `tsc --noEmit` clean,
  production build passes. Lab pages untouched (`blood-view-gpu` change is
  options-gated with defaults = current behaviour; no lab-main/panel edits).

## Deviations from the plan (all deliberate, all documented in code)

1. **Registry stores the Wound reference**, not `woundIndex`: ring eviction
   at MAX_WOUNDS makes indices lie; the spec's own "references, not
   positions" rule decides it. `register(bodyId, wound, kind, now)`.
2. **The per-frame bleed block is NOT gated on `wanderFrozen`** (the plan
   said inside that block): pellets and chunks — the established cosmetic
   sims on this page — step frozen, and the plan's own reel protocol freezes
   before firing. Literal placement would have emptied the reel's captures.
   Anchor freshness is preserved anyway: anchors recompute from
   `a.posed()` each step, which frozen is a constant.
3. **`hit`/`hitSlug` return the stamped wound** (was void) so registration
   binds the exact wound — sniffing the ring tail breaks when a hit also
   severs (the stump becomes the tail). `onSever` now also forwards the
   stump wound (`null` when no live anchor existed).

## Open / owner calls

- Droplet size at point-blank reads large (placeholder look, spec'd);
  `WOUND_BLEED.*.sizeMin/Max` is the knob if a later pass wants distance
  sizing.
- Splat look is the lab's flat dark decal; a goo-derived look remains the
  spec'd later pass.
- Goo layer port (pooling under corpses) intentionally not attempted.
