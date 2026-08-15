# SDF zombie lab — findings

**Date:** 2026-08-15
**Spec:** [../superpowers/specs/2026-08-15-sdf-zombie-lab-design.md](../superpowers/specs/2026-08-15-sdf-zombie-lab-design.md)
**Plan:** [../superpowers/plans/2026-08-15-sdf-zombie-lab.md](../superpowers/plans/2026-08-15-sdf-zombie-lab.md)
**Run it:** `npm run dev` → `/sdf-lab.html`

**Controls:** left-click shoots (Shift = blast, Alt = burn) · right-drag orbits ·
wheel zooms · `1/3/4/5/6` sever head/armL/armR/legL/legR · `G` gibs everything ·
panel on the right for presets, material, damage shape, and body blend

---

## Verdict

**Worth building on.** The properties that motivated the experiment are all real
and all cheap: limbs fuse into the torso with no seam, craters subtract from the
surface and ride the flesh as it moves, stumps close over themselves, and gibs
carry the damage already dealt. None of that required authoring a single
special-case shape.

The decisive comparison is with `goober-test`, which built creatures from the
same primitives and the same smooth-min but rendered them as a relaxed triangle
shell, and whose joints tore. **The blend math was never the problem there — the
shell was.** Raymarching removes that failure class entirely, and it cost us
fill rate we could afford at 960×540.

The honest caveat: it does not yet look *good*. It reads as a convincing fleshy
creature and it is extremely satisfying to shoot, but the material is one step
past placeholder and there is no face. Those are authoring problems, not
representation problems — which is the useful thing to have learned.

## Against the five success criteria

1. **Flesh stretches and webs** — ✅ both halves. Webbing is free from `smin`.
   Stretch needed the verlet rig bound to the primitives, which the plan
   specified and then never wired (see "the gap that nearly slipped through").
   Once connected, the jiggle is the single most satisfying thing in the lab.
2. **Craters stay positioned on moving flesh** — ✅. Wounds are stored in the
   local frame of their nearest primitive and transformed back each frame. This
   was only unit-tested until the body could actually move.
3. **Stumps close over and read as exposed meat** — ✅. `smin` re-closes the
   stump with no cap geometry, and a stamped wound makes it read as torn rather
   than as a smooth nub.
4. **Gibs squash and reflect damage already dealt** — ✅. Chunks are seeded from
   the *current* primitive set, so an arm removed earlier is not in the pile.
   Squash-on-impact is what sells wetness; a rigid bouncing blob reads plastic.
5. **Presets distinguishable, one worth showing** — ✅ distinguishable.
   `henenlotter-latex` is the closest, but see the caveat above.

## Performance

Comfortable at 960×540 with one body plus up to 24 chunks. Only the first cost
lever was needed — **cluster bounding-sphere culling**. Step-count LOD was
never required and the half-resolution march RT stayed in reserve, so the
Dreams-style escape hatch (stop marching, sample to points) was never
approached.

## What surprised me

**Nothing in the toolchain compiles GLSL.** Three separate render bugs survived
*eight consecutive green tasks* — `tsc` clean, 656 tests passing — while the
fragment shader failed to link and the page rendered nothing at all. The worst
was `projectionMatrix` being undeclared: three's fragment prefix provides
`viewMatrix` and `cameraPosition` but not that one. A human has to load the page
after any shader change; task verification commands cannot substitute.

**`smin` scaling caused two bugs from one root.** `smin` begins with `k *= 4.0`,
so an authored `blendK` is a quarter of its real influence radius. Authored
values were 4× too large (the whole body fused into a featureless blob) and the
cull margin was 4× too small (hard creases along cluster boundaries).

**The blob passed every check.** A fully-fused mass is trivially "connected", so
`validateBody` was satisfied by a body with no discernible limbs. This is the
WAM lesson reproduced exactly — *a model can pass every check and be the wrong
animal* — and it was written into this very spec before being walked into.

**`validateBody` did later earn itself**, catching a genuinely disconnected arm
after a bad `blendK` tune persisted through a reload.

**Non-associativity never bit**, because it was designed around. Fixed cluster
fold order plus sever-by-alive-flag meant the torso stayed bit-identical when an
arm came off, which a test asserts directly.

## The gap that nearly slipped through

`rig.ts` shipped with 7 passing tests and was imported by **nothing but its own
test file**. The plan specified the rig and the rest-space wound system
specifically to demonstrate criteria 1 and 2, then contained no task connecting
the rig to the body. Both criteria were structurally undemonstrable and every
test was green. Found by grepping for imports, not by any tooling.

Worth generalising: *a module with passing tests and no non-test importers is
dead weight until proven otherwise.* Cheap to check, and nothing else checks it.

## If it ports to the real game

The architecture already separates pure state from rendering along roughly the
line the sim requires. A port needs the flesh to stay **entirely cosmetic**:
sim keeps its Build-unit hit volumes and integer tic loop, wound positions
arrive from deterministic sim hit events, and the jiggle stays per-client and
unsynchronised. That is a separate spec.

Known work before that would be worth doing:

- **Align gibbing with Blud's existing physics and gib logic** rather than the
  lab's standalone chunk stepper — including flesh trails.
- **Face and character design.** The plan under-delivers against spec §7: it
  implements noise-based normal perturbation but never the rest-space triplanar
  the spec specifies. For a face specifically, geometry beats texture at this
  resolution — carve sockets and a mouth as subtractive primitives.
- **Skeleton.** A second SDF field combined as `max(flesh, -bone)` so bone shows
  only where flesh is cut deeply enough. Would make deep wounds and stumps read
  far better.
- Chunks collide only with an infinite floor; no level geometry, no stacking,
  no decals or pooling, and they cannot be shot again.
