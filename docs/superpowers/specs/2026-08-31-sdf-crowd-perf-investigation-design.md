# SDF Crowd Performance — Investigation Design

**Date:** 2026-08-31 · **Branch:** `claude/sdf-rendering-improvements-b3b219`
**Status:** design approved, plan pending

## The goal, in the owner's words

> "if we can achieve stable 30 with multiple bodies and other effects happening
> then that would be good"

**Stable** is the requirement, not a peak number. 33 ms that holds through a
firefight beats 20 ms that spikes to 60 the moment you shoot someone. The
success metric is therefore the one `bench-main.ts` already uses for 30 fps:
**p95 ≤ 33 ms**, measured over a run that includes the effects — wounds, gibs,
goo, muzzle flash — not over a quiet walk.

## Where we actually are

`sdf-game.html` is the target now, not the lab. The last recorded numbers
(TASKS.md `SDF GAME LEVEL`, 2026-08-25) are room 1 at 16.7 ms rising to
**room 4 with 4 zombies at 33.6 ms** — already at the 30 fps line, with **no
effects running**. Those numbers predate the compute tile binning merge
(`90e1ca9`) and the hit-stagger work, so they are stale and must not be
carried into any decision.

Three facts constrain everything below.

**1. The cost is fill-bound and linear in body count even when bodies occlude.**
`X1.4` measured 18.6 ms + 0.237 ms/1k px. `frag_depth` + `discard` defeat
early-Z, and WGSL has no `depth_greater` qualifier to win it back — which is
why `X1.15` had to reject by hand.

**2. The occluder gives only a FAR bound.** `march.wgsl.ts:1274` computes
`tMax = min(length(worldPos - camPos), occT + woundCfg2.z)`. It stops rays
early *behind* solid flesh. It does not give a near/entry bound, and it does
not reduce the *pixel set* being traced: every pixel of a body's proxy box
still marches. The shell spike measured that gap directly — ~30k footprint
pixels inside a ~285k proxy box.

**3. There is no per-pass GPU attribution available.** GPU timestamps were
tried and rejected: they do not survive this renderer's multi-pass frames
(`bench-stats.ts:4`, `adaptive-scale.ts:35`). All attribution in this
investigation is therefore by **interleaved ablation** — toggle one pass,
measure the delta, alternate legs to cancel thermal drift. This is how the
rest of the codebase measures and it is not negotiable here.

A corollary of (3): wall clock is vsync-pinned, so nothing below ~16.7 ms is
measurable. That is fine for a 33 ms target, but any leg that lands under the
cap must be re-measured on a heavier scene rather than quoted as "16.7".

## Quality LOD is dead — do not re-propose it

`X1.10` settled this on the honest bench: LOD on 9.79 vs off 9.81, **0.2%,
within noise, at LOD's own benchmark scene**. The ceiling of all quality
reduction is −24%. It is not a lever. The machinery is kept for measurement
only and defaults off.

## The three levers left

### A — Shell march (bounded entry/exit from a rasterised hull)

Rasterise an inflated hull front-face (entry) and back-face (exit), then
sphere-trace only inside `[entry, exit]`, over the body's real footprint
instead of its proxy box. Spiked and measured
(`docs/dev-notes/2026-08-25-shell-march-spike.md`): on one body, **~137k
`mapBody` evals/frame vs ~1.94M (~14×)**, frame ~16 ms vs ~29 ms, with
silhouette, smooth-min blends and gradient normals preserved at all 8 yaws.

This is the only lever measured to change the *shape* of the cost curve.

It is also the most expensive to productionise, and the cost is concentrated
in one place: **the spike's hull is a single rest-pose world-space mesh that
takes ~0.5 s to build.** Animated bodies need rigid per-cluster hulls that
follow the skeleton — re-meshing per frame is not on the table. Wound
re-carving and shading parity with the full march are the other two gaps.

**The spike never took the crowd measurement its own conclusion rested on.**
Its verdict says "the real win is crowd cost" and then explicitly defers
measuring it.

### C1 — Temporal acceleration (reprojected depth as a ray start bound)

Reproject last frame's depth to give each ray a start distance. The march
still runs to a real hit, so nothing smears — **no look cost by construction**.

Not automatically safe: if the true surface moved *nearer* than the
reprojected bound, starting there marches straight past it and punches holes.
Needs a conservative guard — back-off proportional to relative motion, or one
field evaluation at the start point that rejects a negative distance. The
guard costs something, and if it eats the win, this lever dies.

### C2 — Temporal amortisation (half-rate SDF layer)

Render the SDF layer every other frame and reproject between. Bodies smear and
double on fast strafe; wounds land a frame late.

The owner's read (2026-08-31): the ghosting is **not automatically a defect** —
the project is going for a degraded look, and a low-framerate composite over a
60 fps world may be exactly right. This makes C2 potentially the best
win-per-unit-of-work on the table, since it is dramatically cheaper than
per-limb posed hulls.

**Its deliverable is an aesthetic verdict, not a number.** No amount of
measured win justifies it if the smear reads as broken, and no measured cost
condemns it if the smear reads as intentional.

## Design: three phases, cheapest-and-most-decisive first

### Phase 0 — Honest baseline and cliff profile

**Build:** a scripted firefight bench on the game page. `scripts/sdf-game.mjs`
already drives `__sdfGame` over CDP, but its per-room frame ms is explicitly
"NOT a benchmark" — this needs a real harness, reusing the pure `BenchStats`
accumulator from `bench-stats.ts` rather than reinventing percentiles.

The scenario is deterministic: fixed seed, fixed camera path through the room
ring, N bodies, and **scripted shots at known frames** so wounds, gibs and goo
all fire reproducibly. Aim points must raycast a **surface** point — a torso
cluster centre sits inside the field, anchors the crater pathologically, and a
slug's `severRadius` then cuts both hip necks into instant collapse (recorded
in the hit-stagger work; never player-visible, but it will corrupt a bench).

**Report:** p95, p99 and worst frame over the run, plus the same **per
segment** — walking, firing, gibbing — so a moment that breaks the budget is
visible instead of averaged away. Run at N=4 and N=8.

**Attribute:** interleaved ablation legs — bodies only, +goo, +post-AA,
occluder off, adaptive off.

**Deliverable:** a table of where 33 ms actually goes, and which moments spike.
Every later claim is judged against it.

### Phase 1 — Three spikes against that baseline

Ordered so that the two levers that can be *killed* cheaply are resolved
before the expensive build starts.

**C2 first.** Cheapest to build. Deliverable is a **capture reel at speed** —
strafing past bodies, firing, a body gibbing — for the owner's look verdict,
plus the p95 delta. Owner's call decides whether this is the whole answer or
discarded.

**C1 second.** Build the reprojection with the conservative guard. Measure the
win against the guard's cost. Dies here if the guard eats it.

**A third, and crowd number ONLY.** Do **not** build posed hulls. Take the
measurement the spike deferred, using the existing rest-pose hull on N static
bodies: does the win compound with crowd size? If it does not, the per-limb
posed-hull work — the single largest piece of work on the table — is dead
before it starts.

### Phase 2 — Decision gate

Pick what to productionise from the numbers plus the look verdict. Nothing is
committed to before this gate.

**Independently of the gate:** enable adaptive scale on the game page. It is
already wired (`game-main.ts:250`), its budget is already `1000 / 30`, and it
is one flag. It is a floor guarantee, not an answer — it holds the frame rate
by dropping resolution, which is a look cost paid during exactly the moments
that matter most.

## Testing

Every spike is standalone and must leave `lab-main.ts`, `march.wgsl.ts` and
the existing game path untouched until Phase 2 — the shell spike's precedent
(`sdf-shell-spike.html` + its own vite config, nothing existing modified).

Gates per spike: `npx tsc --noEmit` clean, `npx vitest run src/lab` green, and
the bench legs interleaved rather than run back-to-back.

## Explicitly out of scope

- Quality LOD in any form (`X1.10` closed it with numbers).
- Look work — flesh colour chain `X1.3`, wound soft shadow `X1.28`, texture
  seams, skeleton reveal `X1.20`, wound fluid `X1.18`. This is a perf
  investigation; the owner chose perf over look on 2026-08-31.
- Productionising anything before the Phase 2 gate.

## Open questions carried into the plan

- **What is "multiple bodies"?** N=4 and N=8 are the assumed bench points,
  chosen from the existing room-ring load and one doubling. If the intended
  encounter size is larger, Phase 0's table should be extended before Phase 1
  reads anything off it.
- **Which machine is authoritative?** The occluder A/B in the wound-hull work
  found this machine could not resolve within-config noise. If a leg lands
  inside noise here, it needs a quiet machine before any removal call.
