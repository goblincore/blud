# Environment lighting — fake GI, chromatic bounce, and a translucent one-off (spec, not yet planned)

Owner's ask (2026-08-24): *"It would be cool to have some form of real time
lighting — the primitive SDF look of the characters reminds me of early CGI and
it would be cool to have some kind of global illumination even if some of it is
cheating. Also with SDFs we can easily do some cool transparency effects like
make a cool shiny water transparent character?"*

Brainstormed as **one visual direction** and then decomposed, at the owner's
choice. This spec covers the direction plus **P1 only**; P2–P5 get their own
specs.

## Where the project actually is

Worth stating, because it constrains everything below: the **character** side is
deep and the **world** side is empty.

- Characters: a hand-written SDF shading model in
  [`march.wgsl.ts`](../../../src/lab/sdf-zombie/webgpu/march.wgsl.ts) — key +
  fill Blinn-Phong, fresnel rim, fake backlit scatter, 1-tap AO probe, wound and
  gore terms.
- Materials: three presets in
  [`material.ts`](../../../src/lab/sdf-zombie/material.ts) —
  `henenlotter-latex`, `wet-meat`, `clay`.
- World: a `PlaneGeometry` floor and a reference cube in the lab
  ([`lab-main.ts:320`](../../../src/lab/sdf-zombie/webgpu/lab-main.ts)).
  `src/game/arena.ts` and `src/sim/arenagen` are pre-SDF WIP the owner has moved
  past.

**There is no room or level concept.** P1 must therefore not depend on one.

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| World look | 1995 prerendered radiosity, with ~1990 raytracer specular on surfaces | Owner: "ReBoot had lots of shiny specular material" |
| Character look | **Unchanged** | `henenlotter-latex` is already `specIntensity 0.95`, `specRoughness 0.12`, `translucency 0.45`. Characters are latex, not matte clay — `clay` is one preset of three |
| Translucent character | A **one-off**, not the house style | Owner: "just a one off character or thing not something that is everywhere" |
| Architecture | Polygon shell + SDF props/characters, one shared ambient abstraction | Keeps dynamic light affordable without marching whole rooms |
| Bounce semantics | Carries **colour, not brightness** | Preserves the `practical-hard-key` look (see below) |
| Preset override | Per-`LightPreset`, via two knobs | Horror beats dial bounce toward zero |
| Dynamic light | Direct flash **and** bounce injection | A blast must rim-light the enemy in front of it *and* light the room |
| Rooms | **Hand-authored**, likely needing an editor | Owner: procedural was pre-SDF WIP; "prebuilt rooms or at least doing some manual work" |

### Why bounce carries colour and not brightness

`LIGHT_PRESETS['practical-hard-key']` is `keyIntensity 2.4` against
`fillIntensity 0.06` — one hard lamp, near-black shadow, latex blowing out where
it catches. Radiosity's instinct is to lift and colour exactly those shadows,
and doing so naively would spend the look that preset was tuned for.

The house rule is therefore: **the shadow side stays as dark as it is today, but
takes the colour of nearby surfaces.** A red wall tints the shadow red at the
same overall level. Contrast and blowout survive; the figure gains a sense of
place.

This is not a point on a dial between "no bounce" and "full radiosity" — it is a
different intent. Full radiosity says bounce exists to make a scene *readable*;
this says it exists to tell you *where you are*. In implementation both fall out
of the same two knobs, so an override can go either way.

## Architecture: one seam

Everything routes through a single shader function:

```wgsl
ambientAt(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32>
```

| Implementation | Used by | Status |
|---|---|---|
| Analytic bounce lights | P1 spike | This spec |
| Irradiance volume texture lookup | P3 | Later |
| Cone-trace the SDF field | The "everything SDF" endgame | Aspirational |

The owner's preferred long-term answer is marching the field itself — the
distance function is already an occlusion oracle — but that is unaffordable
today. Routing every implementation through one signature makes that a
**data-source swap rather than a shader rewrite**, which is the whole reason the
seam is specified before anything is built.

## P1 — the bounce-light spike

**Goal: judge the "colour, not brightness" decision by eye, with no new
infrastructure.** It is a lab feature, not a level feature.

### Scope

| Piece | Mechanism |
|---|---|
| Test enclosure | Five coloured planes in a Cornell-box arrangement in the lab, toggleable, with per-wall colour pickers. Same category of object as the existing reference cube — not a room format |
| Bounce lights | ~4 analytic lights derived automatically from the enclosure's wall colours, so tinting the left wall red tints the character's shadow side red with nothing placed by hand |
| `ambientAt` | Accumulates the bounce lights into a directional coloured ambient, replacing the flat `fillIntensity` term |
| Preset knobs | `LightPreset` gains `probeWeight` (bounce vs flat fill) and `ambientGain` (overall level) |
| A/B toggle | Flat fill vs chromatic ambient, switchable live, so the two can be compared on the same frame |

### The hard perf constraint

**`ambientAt` must add zero `mapBody` evaluations.** Bounce lights are analytic —
dot products and distance falloff, no field sampling. The existing ~6 post-hit
field evals stay at 6.

This follows a precedent already established in the project: the Selfie Girl
study's `mapD` pattern keeps pores and fuzz detail in the *normal pass* while the
march runs the clean field. Shading richness does not have to be paid for on the
march path, and lighting is the same kind of thing.

Context as of this spec: the **shell-march spike landed** (branch
`dispatch/shell-march-spike`, ~14× fewer `mapBody` evals per frame, frame ~16 ms
vs ~29 ms single-body) so eval budget is likely to improve. That is a spike, not
production — per-part hulls, adaptive inflation, posed hulls and wound handling
all remain. **The zero-extra-eval constraint stands regardless**, because it is
what lets P1 land without colliding with perf work in flight.

### Sequencing

Owner's call: **spike before the perf plan.** Perf `task-1` (the bench page) is
already running with commits on `dispatch/perf-task-1` — `sdf-bench` page, scenes
A/B, scripted orbit, headless driver. Let it finish first so the spike has a
before/after to measure against; it builds measurement, not optimisation, so it
should not conflict.

Note that perf task **"cheaper hit shading"** rewrites the same shading block
`ambientAt` lands in. P1 is small enough to rebase; a probe system would not be.

### Not in scope

No probe bake, no volume texture, no room editor, no room format, no SDF walls,
no refraction, no screen-space bleed. If the analytic version cannot sell the
look, adding screen-space effects on top muddies the verdict rather than rescuing
it.

### How we know it worked

1. **Owner's eye, in the lab.** A latex zombie in a red-walled box, toggling
   between flat fill and chromatic ambient. The question is narrow: does the
   shadow side taking the wall's colour make the figure feel *in* the room
   without softening the hard-key look?
2. **Eval count unchanged.** `mapBody` calls per pixel must be identical with
   bounce on and off — assert it, do not eyeball it.
3. **Frame cost.** Measured against the `sdf-bench` scenes from perf task-1,
   with bounce on and off.
4. **`clay` still reads as clay.** The matte preset must not acquire a sheen from
   the ambient change.

A **negative result is a real outcome**: if chromatic ambient does not sell it,
the finding is that this direction needs genuine radiosity lift, and P3's design
changes accordingly.

## Decomposition

| # | Sub-project | Depends on | Notes |
|---|---|---|---|
| **P1** | Bounce-light spike (lab only) | — | **This spec** |
| P2 | Room / map editor | Owner decision that levels are next | Shares blob-editor infrastructure: `hitBest` picking, live re-upload, comment-preserving text round-trip |
| P3 | Baked irradiance volumes | P2 | Hand-authored rooms bake cleanly; destructibility is post-v1 so a bake stays valid |
| P4 | Dynamic flash + bounce injection | P3 | Direct light for the moment, volume injection for the afterglow |
| P5 | Translucent / refractive material | P1 | Extends the existing `translucency` + `deepColor` scatter axis |

**P5 is the most attractive follow-up, not P2.** A translucent character needs no
world at all — it is a material on a body in the lab, where the tooling already
is. P2 through P4 are blocked on deciding that levels are the next milestone,
which `CLAUDE.md`'s Phase 1 gate ("30min in the arena must feel fun before
writing any level code") deliberately defers.

## Open questions

1. **Is ~4 bounce lights enough** to read as GI, or will it look like obvious
   point lights? Cheap to find out by raising the count in the spike; if it needs
   many more, that is evidence for P3 sooner.
2. **Does the enclosure need a ceiling?** A Cornell box has one; a first-person
   arena often does not, and an open top changes the bounce character a lot.
3. **Should `clay` get its own `probeWeight`?** A matte preset may want more
   bounce than latex does, not less, since it has no specular to carry form.
