# Blood viscosity — impact gouts + overlay goo

**Date:** 2026-08-31 · **Status:** approved (brainstormed with owner)
**Scope:** `sdf-game.html` + shared `src/lab/sdf-zombie/` sim + `goo-layer.ts`.
WebGPU only.
**Owner intent:** the shipped bleed FX "is quite weak"; the target is viscous,
voluminous blood matching three reference frames (a thick glossy floor pool
with white speculars and satellite specks; a large airborne connected mass of
ropes and globules; heavy screen-space red splatter). Supersedes the parked
`X1.bleed-look` round-2 work.

## Where this came from

Round 2 ported `goo-layer.ts` to the game page and it did not reach the
reference look. Two blockers were proven, neither of them tuning (five
threshold sweeps burned proving it):

1. **Depth.** The goo surface writes a depth reconstructed from the density
   field's average view depth. Captures showed goo appearing only against
   distant background — never against a body — i.e. near-body blood, the blood
   that matters, was being depth-rejected.
2. **Emission.** ~80–300 droplets spread through a 3D volume never overlap
   densely enough to fuse. The lab's goo reads well because a *gib burst* puts
   hundreds of droplets in a tight volume at one instant; a sustained thin
   bleed stream is the opposite distribution.

A 2D prototype of the exact density → blur → threshold → shade chain
(`.superpowers/brainstorm/*/content/goo-lab-v2.html`) reproduced both failures
and was used to find the target look. Its density view is the clearest
statement of blocker 2: under the shipping trickle the field is isolated dots,
and no threshold can fuse isolated dots.

## Decisions (owner calls, recorded)

- **Two profiles, one pipeline.** Wound stream stays modest; gibs and impacts
  get the full excess. Nothing forks the renderer — the profiles differ only in
  how droplets are distributed in space and time.
- **Projectile impact fires a gout.** The owner's call, and the key insight:
  the reference "airborne mass" look is an *impact* event, not a bleed rate.
  The wound afterwards is a trickle.
- **Option A for depth: screen-space overlay.** The goo surface stops writing
  and testing depth and composites over the frame. This *deletes* blocker 1
  rather than solving it. Accepted as try-and-see; the existing depth path
  stays behind a mode flag as the escape hatch.
- **Bloom is out.** The owner selected the prototype preset with bloom at
  zero. Beer-Lambert thickness does the work bloom was reaching for, at ~6
  lines of shader instead of a new post pass.
- **Camera-lens blood is out of scope.** Screen-space spatter on the *lens* is
  a real part of why the Gears reference reads so drenched, but it is a
  different effect and gets its own round.

## Prerequisite: merge the spike

The game-page goo port is **not on main and not on this branch** — it is the 8
commits on `claude/bleed-look-spike` (`goo-layer.ts` is present here, but
that is the lab's copy from X1.21; `setGoo` does not exist in `game-main.ts`).
Step one is merging that branch in whole. It brings round-1 mist and ribbons
along with the port:

- **Mist must stay.** It is the sparse-case floor. The goo only draws where
  droplets overlap, so an ordinary pellet hit crosses no threshold and draws
  nothing; hiding mist too is what produced the "no blood at all" regression.
- **Ribbons ride along inert.** The owner rejected them ("too thin and
  uninteresting" — lines cannot be volumes), and goo-ON already suppresses
  them. Merging whole beats cherry-picking around them.

## a. Impact gout — new

A pure `spawnImpactGout(sim, anchor, dirN, kind, rng)` in `blood-sim.ts`,
beside `spawnWoundDroplets` and built the same way: seeded rng, fixed draw
order per droplet, counts pinned by test.

New table `IMPACT_GOUT: Record<BleedKind, ImpactGoutProfile>`:

| field | meaning |
| --- | --- |
| `count` | droplets emitted in ONE tick — the whole point |
| `coneRad` | cone half-angle around the emit axis |
| `speedMin/Max` | launch band, m/s |
| `lifeMin/Max` | droplet life, s |
| `sizeMin/Max` | droplet size band, m (game-camera scale) |

**Head-fast/tail-slow ordering is load-bearing.** Droplet *i* of *count* draws
its speed scaled toward `speedMin` as *i* rises, so the pulse stretches into an
arcing rope instead of expanding as a ball. In the prototype this was the
single difference between "one pink blob" and "a connected arcing mass".

Per kind: `pellet` small (eight per shotgun blast — eight small gouts *is* the
shotgun read), `slug` the reference-scale gout, `stump` the largest.

Two call sites, both of which already hold the point and direction:

- `game-main.ts:947`, beside `registerBleed(hitActor, stamped, p.kind)` —
  pellet and slug impacts.
- the sever path at `game-main.ts:744` — stumps.

## b. Wound trickle — unchanged

`BleedRegistry`, `spawnWoundDroplets`, and splat decals are untouched and stay
merged on main. They pick up gloss for free: trail droplets are already above
`GOO_TUNING.mistMaxSize`, so they feed the density field and render as shiny
blobs rather than flat sprites. That *is* the owner's "trickle with some
jet/sheet gloss characteristics" — no second emitter.

## c. Goo overlay mode

`goo-layer.ts` gains `mode: 'overlay' | 'depth'`.

| | `depth` (today) | `overlay` (default *when goo is on*) |
| --- | --- | --- |
| `depthTest` / `depthWrite` | on | off |
| `depthNode` | reconstructed from G/B | not written |
| alpha | forced 1 (opaque) | `softEdge` — strands feather out |

Overlay composites over the frame. Known and accepted cost: a burst fired at
something behind a pillar still paints over the pillar. For an impact gout
this is close to theoretical — the event is centred on the thing just shot, is
in front of the camera by construction, and lives well under a second.

## d. Thickness shading — the volume read

In `GOO_SURFACE_WGSL`, replace the flat `base` with Beer-Lambert absorption
over `dens - threshold`: red absorbed lightly, green and blue hard. A thick
core goes near-black crimson, a thin film stays bright orange-red, and the
existing tight specular sits on top unchanged.

This is what makes the references read as *volume* rather than a flat red
shape, and it is the highest value-per-line change in the whole spec. It also
answers the owner's opening question — thickness, not bloom, is where the
"shiny" comes from.

## Tuning seams

`setGooTuning` grows `mode`, `absorb`, `spec`, `gloss`, `rim`. `IMPACT_GOUT`
gets a debug seam so count and cone sweep from the console without a rebuild.

**Every new setter's clamp is checked against the range the shader actually
produces before it ships.** This is the specific trap that cost three rounds:
`setThreshold` clamped at 0.95 while the file's own note says a lone blob peaks
near 1.0, so no reachable threshold could reject a single droplet, and lowering
it — the intuitive move — made things strictly worse.

## Verification

**Tests.** `spawnImpactGout` is pure, so TDD as `spawnWoundDroplets` was:
pinned counts per kind, every droplet inside the cone half-angle, speed
ordering monotonic head-to-tail, exact rng draw count. Baseline to hold: tsc
clean, 1719 tests.

**Off-state parity gate** via `scripts/sdf-game-bleed-gate.mjs`: goo OFF must
be pixel-identical to no-goo. Run at `setSmear(0)` against **no-toggle control
cycles**, which are mandatory evidence either way — this scene has two measured
noise floors, silhouette-edge AA that jitters with frame index, and a ±1/255
rounding limit cycle in the temporal filter that survives settling because it
is a cycle, not decay. Do not assume literal 0 is reachable.

**Cost.** Round 2 left three extra passes unbenched on a ~10 ms frame. Overlay
mode does not change the bill (density + two blurs + surface); it gets benched
on the fire-segment bench before the owner is asked to judge anything.

**Look verdict is a playtest, not a capture.** Round 1's staged captures kept
missing — wanderers walk into the muzzle, aim picks offscreen bodies — and past
a point the owner's live tab beat them. A per-calibre impact reel is produced
for the record and the gates; the verdict is the owner playing it.

## Order of work

1. Merge `claude/bleed-look-spike`.
2. Thickness shading + overlay mode. **Owner look-check here**, on the existing
   trickle, before any emitter work — if the shading is wrong we learn it
   cheap.
3. Impact gout emitter + the two call sites.
4. Gates + bench.
5. Owner playtest.

## Ship state

Behind `__sdfGame.setGoo`, **default off**, until owner-passed.
