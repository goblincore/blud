# What a detached piece costs, and why the mesh pre-bake is declined

**Date:** 2026-09-11 · **Branch:** `claude/dynamite-weapon-slot` (worktree)

The design note's §4 has one deliverable left: **pre-bake each archetype's parts
into MESHES** so a released piece is a mesh instance instead of a marched proxy
box. Its argument was always performance ("the bake queue is ONE job in flight,
one swap per frame" — that is the cost `?maxchunks` exists to expose), and §4's
"how does the mesh swap stay invisible" was answered in the SDF direction
already: a piece that IS the field marches with the body's own template, so the
swap is not a shading seam at all.

So the pre-bake needed a measured prize. This is that measurement, and the
answer is no.

## 1. The instrument was lying, and that is the first finding

`sdf:march` cannot price pieces by comparing two states. Measured in ONE boot,
with nothing changed but the sample:

```
idle (pieces present, all settled)  2.61, 3.82, 18.79 ms
```

A 7× spread on a single state. Two consequences:

- The claim committed with the piece-set work — *"the cap is nearly free on the
  blast but NOT on the march (`sdf:march` 5.1 → 6.7 ms at 24, 4.0 → 13.1 at
  48)"* — compared two states by their medians and is **inside that spread for
  the 24-piece case**, and only ~2× it for 48. It should not have been written.
  It is corrected in TASKS.md and the gib dev-note.
- An A/B has to be **paired and interleaved inside one boot**: alternate the two
  arms every sample, take the median of the per-pair DIFFERENCES, and report the
  spread of those differences as the floor any claim must clear.

Two seams exist for that now (both in `game-main.ts`, documented as measurement
seams):

| seam | what it does |
| --- | --- |
| `__sdfGame.setChunksVisible(on)` | hides every piece (marched proxy and baked mesh) WITHOUT spawning or destroying anything — the piece count stays fixed across both arms |
| `chunkCensus().inFrustum` / `.ofPieces` | how many pieces the camera can actually see, so a cost can be read against it instead of against a guess about where the camera points |

## 2. What a piece costs

Paired, interleaved, one boot per row, 20 pairs, warm-up pairs discarded:

| pieces in the world | in frame | paired march cost | spread (p25…p75) |
| --- | --- | --- | --- |
| 24 (`?maxchunks=24`, the shipped default: ONE body's full piece set) | — | **0.50 ms** | −0.57 … 2.08 |
| 64 (`?maxchunks=64`) | 9 of 64 | **4.82 ms** | 1.97 … 5.58 |

And the control that explains the second row: **hiding only the OFF-SCREEN
pieces saves nothing.** With 64 pieces up and 55 of them out of frame, an A/B of
frustum culling measured a median saving of **−0.29 ms** (spread −2.0 … +2.8).

So the cost model is:

> **≈ 0.5 ms per frame per piece that is IN FRAME.** A piece whose proxy box is
> off-screen is nearly free already — its fragments are clipped before they
> march, and all it costs is a draw call.

## 3. The frustum cull: exact, verified, and worth nothing — so it is not shipped

Three's own box test on a piece is the SAME test the shader applies per pixel
(the marched proxy IS the mesh box, with `proxySize` carrying a 1.4× reach plus
`4·maxBlendK` plus 5 cm of margin), so enabling it would be exact. It was
implemented and verified by FRAME HASH — four of five sample frames identical
between cull-on and cull-off, and the fifth differing **on a repeat of the same
setting**, i.e. the harness drifting (a settled-piece bake swap landing between
the two reads), not the cull.

Then measured: **−0.29 ms**, as above. A change that touches a bound the repo
has been burned by ("an outer bound that under-covers CULLS, which presents as a
round see-through hole") for no measured gain is not worth carrying, so it is
reverted, and the reason is a comment at the mesh itself so the next agent does
not have to re-derive it.

## 3b. The frame cadence — the instrument that settles it

Everything above measures a GPU PASS. The player experiences frame PACING, so
that is what `scripts/sdf-piece-cost.mjs` measures now: on the LIVE loop (no
`step()`, no stopped loop), it alternates pieces shown/hidden in 30-frame bursts
with `setChunksVisible` and reports the real inter-frame delta per arm plus the
paired difference between bursts.

**The shipped configuration, arena horde, 22 live pieces and 22 OF THEM IN
FRAME:**

| arm | median frame | p95 |
| --- | --- | --- |
| pieces shown | **16.70 ms** | 16.70 ms |
| pieces hidden | **16.70 ms** | 16.70 ms |

paired difference, eight bursts: `[0.0, 0.0, 0.0, -0.0, 0.0, -0.0, -0.0, 0.0]` —
**zero**, at 60 Hz vsync. At `?maxchunks=64` (56 live) it is zero again.

**AND THE HONEST CAVEAT, which is the whole reading of that zero.** A
vsync-limited page is pinned at the display's cadence, so a cost that fits
inside the budget is invisible here *by construction*. It does fit — the same run
cross-references `sdf:march` at **20.19 ms shown against 17.54 ms hidden**, a
~2.7 ms of GPU time that the frame absorbs. So the correct statement is not
"pieces are free": it is

> **at the shipped cap the pieces cost ~2.7 ms of a 16.7 ms frame budget, and
> that does not move the frame rate. On a machine whose frame is already at or
> over budget it would.**

Which is the number the pre-bake had to beat, and it does not.

## 4. The pre-bake decision

**Declined**, on the measurements above. The prize is ~2.7 ms of GPU time in a
frame that is not currently over budget — measured as ZERO frame-rate impact at
60 Hz with 22 of 22 pieces in frame — for the ~1 s a gib's pieces are airborne
(and the existing SETTLED bake already removes the cost afterwards: a landed
piece is swapped for a mesh). Against it:

1. **The pose seam comes back.** A rest-baked part placed by a rigid transform
   cannot match a posed body — a hunched spine, a bent elbow, a raised arm. The
   SDF pieces are exact at the release frame by construction, which is what
   makes §3(a) work at all ("frame 0 is the body's own silhouette, in place").
2. **The pieces lose the body's damage.** §4's own honest-risk list: a part
   baked at rest cannot show a wound the body accumulated, so every blast would
   release pristine pieces.
3. **A boot-time bake pipeline for every archetype × part** (24 parts × the
   roster), and a two-representation hand-off per piece, to save ~0.5 ms per
   in-frame piece.
4. **A per-release bake cannot substitute.** The bake queue is one worker with
   one job in flight and one swap per frame, so a 24-piece gib would take 24
   serial bakes — longer than the pieces are airborne, which is the only window
   where a mesh would have helped.

If the airborne cost ever does need attacking, the levers are per-piece march
cost (the chunk view's `marchCfg.x = 48` steps, which pieces cannot simply
lower: a bone chunk's ribs are 1 cm thick and are exactly what a step reduction
punches holes in), or the number of pieces IN FRAME — which is what `?maxchunks`
and the tier ladder already govern.

## 5. Where this leaves the design note of 2026-09-10

| § | status |
| --- | --- |
| §1 skeleton as its own bone pieces | **done**, `gib-parts.ts` |
| §2 torso split, limbs split, head whole | **done**, same module |
| §3(a) spawn at the posed transform, zero velocity | **done**, `pendingGibImpulses` |
| §3(b) stagger the release nearest-first | **done**, `?gibstagger` |
| §3(c) the ~0.1 s pre-tear flesh distortion | **not done**, and blocked: a gibbing blast stamps no wounds and retires the actor in the same frame, so the rim-splay pump has nothing to swell. §3(a)/(b) were its prerequisite and are now in place. |
| §3(d) a body-sized debris puff over the swap | **not done**; the mechanism is a smoke-only burst from `explosion-vfx.ts` at the body's centre, which needs a per-burst tuning override |
| §4 pre-bake, cut planes capped | cut planes capped **done** (the cut-sphere caps in `gib-parts.ts`); the mesh pre-bake **declined**, above |
