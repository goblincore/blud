# Close-up frame rate and the cost of gore — investigation design

**Date:** 2026-09-04 · **Branch:** `claude/dispatch-perf-optimization-4afe03`
**Status:** design written, dispatch tasks queued (inert)
**Supersedes for the crowd case:** `2026-08-25-tile-all-bodies` (deleted)

## The goal, in the owner's words

> "frame dips when a body **fills the screen**" — and separately, "when there's
> a lot of blood spray happening on screen."

Same success metric as the crowd investigation: **p95 ≤ 33 ms** over a run that
includes the effects, not over a quiet walk. What changed is the *scene* the
metric is measured on. The crowd is no longer the failing case; a single
character in your face is, and so is a firefight's worth of blood.

## What is already closed. Do not re-open any of these.

The perf record here is unusually good and unusually expensive — several of
these cost a session each. Every one is a measurement, not an opinion.

| Idea | Verdict | Evidence |
|---|---|---|
| Adaptive resolution | **Rejected by the owner** | "the drop in resolution is noticeable and not appreciated when you are close" (2026-09-04). Ladder ships OFF and stays off. Do not propose it for the close-up case again. |
| Tile binning | **Nil** | p50 45 vs 44 ms. The per-step group-sphere cull already handles the prim fold; primitives are not the cost. |
| Per-body CPU upload | **Not worth it** | 0.06 ms/frame for ten bodies, 3–5× under the gate (r2 task 8). |
| Depth gate / per-body passes | **Exact, biting, and still OFF** | The gate is right; the *pass structure* costs +4.6–4.8 ms at 3–4 bodies (r2 task 5b, task 9). `GAME_DEPTH_GATE = 0`. |
| Hull exit bound | **SHIPPED 1** (2026-09-04, `6a514a0`) | The "decay" was scene fog, root-caused below. Re-census bit-identical on hits / rasterised / meanStepsHit; the earlier −0.28 ms "win" was body deletion and must not be cited. |
| Occluder pre-pass | **~nothing** | Inside spread on every A/B. Rebuild now gated off (r2 task 4). |
| Shell march (vertex descent) | **Parked** | The ray start is worth ~14 steps → 2–3, but the vertex descent cost more than it saved. |
| Hull refine renderer | **Parked** | Look passes parity; extraction ~3–4 ms/frame; draw-only ~22 ms vs march 22–27. No win at one *live* body. |
| omega 0.6 | **Costs more** | +0.70 / +1.48 ms. Ships at 1.0. |

**The pattern worth naming:** everything that lost, lost because it moved cost
to *vertices* or to *passes* — neither of which scales down when a body fills
the screen. The levers below are chosen because they scale with pixels.

## ~~The blocker that two dead features share~~ — RESOLVED 2026-09-04

**SUPERSEDED — both halves of this section were answered, and neither survived.
Nothing below is outstanding work.** The decay was **scene fog**, not a TSL
round-trip bug and not "unexplained" (`TASKS.md:1029-1041`). Consequently:

- `GAME_HULL_EXIT_BOUND` **ships 1** (`6a514a0`; `game-main.ts:1426`), and its
  re-census is bit-identical on hits / rasterised / meanStepsHit. The old
  "−0.28 ms" figure measured body deletion and must not be cited again.
- The **quarter-res depth prepass was built, is census-clean, and ships OFF on
  economics** — a net loss of +0.5 / +0.95 / +1.94 ms against a 15.9% walk
  share. It is **not** "the strongest remaining close-up lever", and validating
  its round-trip is no longer "the highest-leverage single item on the board".

Retained only as the record of a wrong hypothesis; skip to the next section.

## The instrument problem, stated once

Three separate instruments here have been proven liars, and each produced a
plausible-looking table before anyone noticed:

- **Occupancy mode-4 counters record only the depth winner.** They *cannot see*
  a depth gate. "hits identical on/off" is not evidence of an unchanged hit set
  where proxy boxes overlap — near-box misses clobber far hits before readback.
- **Damage persisted across bench runs** (the page was never reloaded), so room
  3 opened carrying room 2's wounds and every run tracked cumulative damage.
  Reloading per run took repeat spread from **583% to 1–13%**.
- **Thermal drift** made 15 bodies look *faster* with motion on by 21 ms.
  Three sequential runs went 44.5 / 49.3 / 56.9 ms with no code change.
  Non-interleaved legs prove nothing.

Every task below inherits: reload per run, interleave legs, min of 5, quote
`uptime` on every row, and **pick an instrument that can see the thing you
changed**.

## Where the frame actually goes, and what is unmeasured

At the 0.7 SDF scale a fill-screen body is ~250k pixels, each paying:

- **~14 walk steps** to the hit (`meanStepsHit` 13.8, at omega 1.0 — already
  harvested; r2 cut mean march steps ~40%).
- **6 more field evaluations after the hit** — `calcNormal` (4 taps), the
  scatter-thickness probe, the AO probe.
- **up to 14 more** for the wound shadow near craters.
- **an unknown amount of shading** — spec, rim, fresnel, blood stain, mottle,
  bone tubes, a 4-tap PCF level shadow — which **no instrument here has ever
  separated from the walk.**

That last line is the gap. Every counter in this codebase counts *steps*. If
shading is 30% of the close-up frame then the entire lever set below is aimed
at the wrong half, and one hour of measurement would have said so. **That is
why the first task is diagnostics, and why it is allowed to end the program.**

Separately: the wound-shadow's 14 evals fire *near craters*, and the failing
scene is a body in your face — which is to say a body you have been shooting.
The close-up case and the wounded case are the same case, and they have never
been benched together.

## The levers, in order

### 1. Post-hit probes: 6 evals → 1–2

Two halves with very different risk, and they must not be conflated:

**The safe half.** The march already evaluates `d` at `t_n` and `t_{n-1}`. A
3-tap forward-difference gradient instead of the 4-tap central stencil is one
eval of six, with no new artifact class, for a vector that is about to be
normalised anyway.

**The risky half.** Screen-space derivative normals (`dpdx`/`dpdy` of the hit
position) are *zero* evals, and fill-screen bodies are where they look best
because silhouettes are a small fraction of the pixels. But: derivatives
straddle two surfaces at silhouettes and depth discontinuities, giving garbage
along a one-pixel seam, and they are faceted per 2×2 quad — which on smooth
latex under a specular highlight can read as visible blockiness. Mitigation is
a `|dpdx|` magnitude threshold falling back to the stencil. **Gate it on a
specular close-up, not a silhouette test** — a silhouette gate would pass a
shader that is visibly wrong exactly where the owner is looking.

**AO and thickness** are low-frequency and belong at reduced rate — see lever 2,
which should produce them rather than a separate mechanism.

Expected: 20–30% of fragment cost, no vertex work, no new renderer.

### 2. A cheap ray start without vertices

The shell proved the walk drops from ~14 steps to 2–3 when the ray starts near
the skin. It lost only because the vertex descent that produced the start cost
more than the start saved. A **quarter-resolution depth prepass of the march
itself**, then starting each full-res ray conservatively in front of that depth
(backed off by one coarse-pixel footprint), buys most of that for ~1/16 of the
march. The layer's cone pre-pass is the seed of the idea.

**Fuse it with lever 1:** the same quarter-res pass should produce AO and
thickness alongside depth, bilaterally upsampled using the depth it already
has. One pass paying for both beats two mechanisms.

**Hard prerequisite:** the texture round-trip validation above. If a written
ray parameter decays with range, this lever is dead on arrival and the task
must stop and say so rather than tuning around a corrupted read.

### 3. The goo layer is the blood cost, not the particles

Measured by reading the code, not the frame — these are structural claims a
bench must confirm, but they are specific.

`blood-view-gpu.ts` is 600 instanced droplet billboards + 256 splats. That is
not the cost. `goo-layer.ts` is, and it has three distinct problems:

1. **The surface composite runs at full canvas resolution**
   (`goo-layer.ts:854`) over inputs that are entirely at `densityScale 0.5` ×
   the SDF scale — 4 gradient taps, Beer-Lambert, spec and rim per *canvas*
   pixel, on information that is quarter-res **and already blurred** by sigma
   2.5 density-texels. Compositing at density resolution and upsampling is the
   largest single win available here and the blur makes the visual risk small.
2. **Density-pass overdraw.** Up to 1000 additive instanced quads at
   `quadScale 3.2` — quad area ~10× the particle's size, multiplied again by
   velocity stretch. Additive blending means no depth reject: every fragment of
   every quad is shaded, and heavy spray is precisely the overlapping case.
   Particle *count* is not the driver; covered area is.
3. **Splats never age out** (256 ring, persistent by design so pools outlive
   their droplets). Their density contribution is permanent and accumulates
   across a firefight.

The surface shader does `discard` below threshold (`goo-layer.ts:222`), so
empty pixels are cheap — do not over-claim a win from an idle-frame early-out.
The cost is when there *is* blood, which is the reported case.

### 4. Bake what has stopped moving

A gib chunk that has come to rest is a rigid static field that will never
change again, and it is currently a **full SDF march with its own proxy box**
(`chunkViews`, `MAX_CHUNKS = 12` in `game-main.ts:1712`). During a firefight
that is up to twelve extra marched boxes stacked on nine bodies — exactly the
"with effects running" case the p95 target is about.

The hull renderer was parked because extraction costs ~3–4 ms/frame. **A
settled chunk does not re-extract.** Bake once when it settles, then it is a
static mesh rigidly transformed forever: the 3–4 ms objection is not reduced,
it is deleted, and the mesh becomes a normal early-Z occluder for everything
behind it instead of another `frag_depth` + `discard` surface that defeats
early-Z.

The machinery already exists — `surface-nets-compute.ts`, `surface-nets-cpu.ts`,
`hull-refine-view.ts`, and the spike already extracts chunk hulls
(`2026-09-02-hull-refine-spike` fix 4). The settle signal exists too:
`gib-chunks.ts` has `grounded` and `TOPPLE_SPEED`.

**Scope note that changes the shape of this task.** There is no corpse in
`sdf-game.html` yet — bodies sever and gib, but nothing dies and settles; the
death state is arriving on the zombie-crowd branch. So **settled chunks are the
beachhead**: they need no new game state, they are the accumulating cost today,
and the machinery generalises to corpses unchanged when the death state lands.
Do not block this on a corpse that does not exist.

**The design question to settle before building:** corpses and chunks get shot.
In Blood you gib a body on the floor. Either bake reversibly (swap back to SDF
for the gib frame) or make a hit on a baked piece spawn chunks and delete the
mesh. Prefer the second — simpler, and closer to what the feel wants.

## Ordering, and why

```
task-1  diagnostics ─────┬──> task-2  post-hit probes ──> task-3  depth prepass
   (may end the program) │
                         └──> task-5  bake settled chunks

task-4  goo cost ── independent, runs in parallel with everything
```

`task-1` first because it can invalidate `task-2` and `task-3` (if shading, not
marching, is the close-up cost) and because it holds the round-trip validation
that `task-3` is conditional on. `task-4` shares no files with anything and is
the cheapest real win on the list. `task-5` is chained on `task-1` only for the
`game-main.ts` overlap.

The merged march for the crowd (`2026-09-04-merged-march.md`) sits behind all
of this, parked, and is conditional on its own Phase 0.

## What must not be touched

`relax` / `woundCfg2.y` (stays 1.0); the lighting work (`ambient*`,
`enclosure*` — `ambientAt` must keep making zero `mapBody` calls and stay
parity-exact at `probeWeight 0`); `src/sim`; `src/game`. `tile-cull.ts` stays as
the reference implementation. `MAX_PRIMS` is an allocation width, not a ceiling —
the real ceiling is the per-cluster 64 in both WGSL folds, and a cluster over it
does not error, it silently loses geometry.
