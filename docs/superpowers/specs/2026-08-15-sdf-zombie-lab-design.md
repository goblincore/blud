# Blud — SDF Zombie Lab (Raymarched Flesh Experiment) — Design

**Date:** 2026-08-15
**Status:** design approved, pre-implementation
**Type:** side-quest experiment — **not** on the M6/M7 critical path
**Relationship to the main game:** none, by construction. This is a standalone sandbox that imports no game or sim code. If the look succeeds, porting it onto a real enemy is a *separate* future spec.

---

## 1. Context and intent

Blud's enemies today are billboard sprites (extracted Blood art as dev placeholders) that gib into Rapier-driven voxel chunks. That pipeline works and is playtest-confirmed. This spec does not touch it.

The question this experiment answers is a *feel* question that cannot be answered by reasoning: **what does a character made of signed-distance-field volumes actually feel like to shoot?** Specifically whether the properties SDFs give away for free — continuous flesh that webs between limbs, craters that subtract from the surface, stumps that close over themselves — produce something worth building on.

The answer is only meaningful if it is judged through the game's real presentation chain, so the sandbox renders at the same 960×540 internal resolution and runs the same barrel + palette-dither post stack ([src/vfx/post-fx/](../../../src/vfx/post-fx)). A raymarcher judged in a clean HD viewport will lie about how it looks in Blud.

### Art direction: practical effects

The north star is **Frank Henenlotter / Troma practical gore** — foam latex and KY jelly, lit by a hard close key so the wet surface blows out into hot speculars. Belial in *Basket Case*, Aylmer in *Brain Damage*. Concretely this means:

- **Candy-saturated gore.** Karo-syrup red, not desaturated realistic meat.
- **Lighting carries the effect.** Hard direct key with sharp specular blowout is what makes rubber read as practical rubber. Lighting is therefore a *variable of the experiment*, not a fixed scene setting.
- **Latex is smooth.** The lumpiness belongs in the silhouette (foam-rubber blobbiness), not in surface detail.

Usefully, foam latex and claymation are neighbours — both are handmade physical materials — so the "fleshy vs. claymation" question is a slider, not a fork. The design carries both as presets over one shared shader.

### Success criterion

Shoot the zombie apart in the sandbox and form an opinion. Concretely, all of the following are visible and legible at 960×540 through the dither pass:

1. Flesh **stretches and lags** when the body lunges, and limbs **web together** where they pass close.
2. A pellet leaves a **positioned crater** that stays put on the flesh as the body moves.
3. Blowing off a limb leaves a **stump that closes over itself** and reads as exposed wet interior.
4. Gibs fly apart as **wet blobs that squash on impact**, and reflect damage already dealt (an arm shot off earlier is not in the pile).
5. The three material presets are distinguishable, and at least one is worth showing someone.

Failure is an acceptable outcome. The deliverable is the opinion, not the code.

---

## 2. Non-goals

Explicitly out of scope. Every one of these is a trap that would turn a side quest into a milestone:

- **No sim integration.** Nothing in `src/sim`, no `SimState`, no fixed-tic loop, no determinism obligations. The lab is free-running and frame-rate dependent.
- **No game integration.** No weapon plumbing, no `ChunkSystem` reuse, no enemy registry, no wave spawner. Shooting is a debug raycast.
- **No animation system port.** A crude procedural sine-driven walk cycle is sufficient to see flesh move.
- **No AI, no audio, no HUD, no multiple enemy types.**
- **No shadow-map participation.** SDF-derived AO plus a ground blob shadow.

---

## 3. Architecture

Standalone Vite entry `sdf-lab.html` → `src/lab/sdf-zombie/`. The only shared code is `createRenderer` and the post-fx composer, consumed **read-only** and unmodified.

```
  ┌──────────────── pure, vitest-covered, no GL / no Three ────────────────────┐
  │                                                                            │
  │   body.ts            override layer (from panel)                           │
  │   (BodyDef: bones + primitives,   │                                        │
  │    relative, named, one side)     │                                        │
  │        │                          │                                        │
  │        └──────────┬───────────────┘                                        │
  │                   ▼                                                        │
  │            build-body.ts                                                   │
  │      (expand mirror · resolve relative placement                           │
  │       · merge overrides · validateBody ✓)                                  │
  │                   │                                                        │
  │                   ▼                                                        │
  │   rig.ts ────▶ field.ts ◀──── damage.ts        sever.ts                    │
  │  (verlet,     (built primitives,  (wound ring   (limbId → primitives,      │
  │   walk,        clusters + bounds,  buffer,       detach to chunk group,    │
  │   stretch)     uniform packing)    rest-space)   stamp stump wound)        │
  │                   │                                    │                   │
  │                   │                                    ▼                   │
  │                   │                             gib-chunks.ts              │
  │                   │                       (gravity, bounce, squash)        │
  └───────────────────┼────────────────────────────────────────────────────────┘
                      │  packed uniform arrays
                      ▼
               zombie.ts  ──▶  proxy boxes (Three)
                      │
                      ▼
               march.glsl.ts
   (sphere trace · cluster cull · gl_FragDepth
    · material presets · lighting presets)
                      │
                      ▼
                 lab-main.ts
   (scene, floor, orbit cam, click-to-shoot, tuning panel ──▶ override layer)
```

**The seam that matters:** everything above the packing line is plain data and pure functions with no Three.js or GL dependency, so the rig, the damage bookkeeping, the severing logic and the chunk physics are all unit-testable. Only `zombie.ts`, `march.glsl.ts` and `lab-main.ts` touch the engine. `src/lab/` falls inside the vitest collection scoped in `955b93b`, so lab tests run with the existing suite.

### Module responsibilities

| Module | Does | Depends on |
|---|---|---|
| `body.ts` | The declarative `BodyDef` — bones and primitives, relative and named, one side only. Plain data, serialisable. | — |
| `build-body.ts` | Expands `mirror`, resolves relative placement to concrete primitives, merges the override layer, runs `validateBody`. | `body` |
| `field.ts` | Owns the built primitive list and packs it into uniform arrays. Defines clusters and their bounding spheres. | `build-body` |
| `rig.ts` | Verlet points + distance constraints driving primitive endpoints. Rest lengths, stiffness, damping. Procedural walk/lunge. | `field` types |
| `damage.ts` | Wound ring buffer. Converts a world-space hit into a rest-space wound record. | `field` types |
| `sever.ts` | Limb-id → primitive mapping; detaches a limb into a chunk group with inherited velocity; stamps the stump wound. | `field`, `damage` |
| `gib-chunks.ts` | Detached blob groups: gravity, floor bounce, angular tumble, non-uniform squash-on-impact with relax. | `field` types |
| `march.glsl.ts` | The fragment shader source, assembled as a string with compile-time constants (max primitive count, max wounds). | — |
| `zombie.ts` | Assembles the pure state into `ShaderMaterial` uniforms and manages proxy-box meshes. | all of the above, Three |
| `lab-main.ts` | Scene setup, floor plane, orbit camera, click-to-shoot raycast, tuning panel wiring. | `zombie`, `createRenderer`, post-fx |

---

## 4. The field

A character is **~15–25 primitives** — ellipsoid torso, sphere head, capsule limbs, plus gut/jaw/shoulder blobs — combined with **smooth-min** rather than union. Smooth blending is the entire point: continuous flesh between limbs is a property of the operator, not something authored.

Primitives are uploaded as **uniform arrays**, not generated into shader source. One generic shader serves every body; the count is a uniform. Fixed ceilings of 32 primitives and 16 wounds are compile-time constants in the shader string.

```ts
interface Primitive {
  a: Vec3;          // sphere centre, or capsule endpoint A
  b: Vec3;          // capsule endpoint B (== a for spheres)
  radius: number;
  scale: Vec3;      // ellipsoid axis scale
  blendK: number;   // smooth-min factor against the body — how much this limb webs in
  limbId: LimbId;   // for severing
  clusterId: number;// for bounding-sphere culling
}
```

### Body authoring — borrowed structure from WAM

[`elliottdehn/wam`](https://github.com/elliottdehn/wam) is a DSL that compiles declarative text into low-poly skinned glTF characters. Its organising principle — the author makes **discrete, named, relative, symmetric decisions** and the compiler derives everything else, with a lint pass and a render-inspect loop — transfers to SDF bodies *better* than it does to meshes, because the compiler's hardest jobs disappear: no vertex generation, no winding order, no normals, and above all **no skinning weights** (an SDF primitive is owned by exactly one bone).

**We adopt the principles, not the compiler.** A text DSL with a parser and CLI is infrastructure that amortises across many creatures; for one experimental zombie it costs more than the zombie. The following cheap subset is adopted now because it is a small amount of code and materially improves iteration:

| Adopted | Shape here |
|---|---|
| Declarative body as **data, not code** | `body.ts` exports a plain `BodyDef` object — bones and primitives — with zero runtime or engine imports. Serialisable. |
| **Relative, named placement** | Bones by `parent` + direction + length (never absolute XYZ). Primitives placed at a normalised position along a bone chain — WAM's `ring 0.80 w=… d=…` becomes an ellipsoid with those axis scales at 0.80 along that chain. |
| **Mirror expanded at build time** | Author one side; a build step generates the bilateral pair. Guarantees symmetry, halves the authoring. |
| **A `checks` / lint pass** | `validateBody(def)` — see below. |
| **Non-destructive override layer** | The tuning panel writes edits back to an override object merged over `BodyDef` and `FleshMaterial` on load, so slider work survives a reload. WAM's `.wamedit.json` pattern. |

Deliberately **not** adopted: text DSL syntax, parser, CLI, offline render-to-PNG loop, glTF export, and the procedural texture baker. The texture baker in particular has no analogue — SDFs shade per-pixel from rest-space triplanar (§7), so WAM's entire texture subsystem is replaced by the ~10 floats of `FleshMaterial`.

**One concept WAM has no equivalent for:** `blendK` per primitive. Smooth-min strength is an authorable, named, per-joint decision, and it is the parameter most responsible for whether the body reads as continuous flesh or as a pile of balloons. It belongs in `BodyDef` alongside the geometry.

#### `validateBody` — the checks pass

This is the highest-value borrowed idea, because every one of these failures is **silent** — it produces a plausible-looking wrong image rather than an error, and is easy to misdiagnose as a shader bug.

| Check | Failure it catches |
|---|---|
| every primitive lies inside its cluster's bounding sphere | geometry dropout — the cull discards real surface |
| silhouette noise amplitude vs. march step multiplier | Lipschitz violation → march artifacts |
| field has no disconnected components at rest | a limb floating unattached because its `blendK` is too small |
| primitive count ≤ shader ceiling; wound count ≤ ring capacity | silent truncation of the uniform array |
| every primitive's `limbId` maps to a severable group | a limb that cannot be shot off |

Runs in the vitest suite against the shipped body, and again in the lab on hot reload so panel edits cannot push the body into an invalid state unnoticed.

### Fluid skin

Two mechanisms, both cheap:

- **Webbing** — `smin` blends limbs into the torso whenever they pass close. Free.
- **Stretch and lag** — primitive endpoints are driven by a **verlet chain with spring constraints**, not rigid bone transforms. A lunging arm elongates and trails behind the body. This integrates ~20 points per frame, which is nothing.

---

## 5. Damage model

The core insight this experiment is testing: **damage is an operator appended to the field**, not a texture painted on a mesh.

| Type | Field effect | Shading effect |
|---|---|---|
| Pellet | `smax(d, -sphere(p, r), k)` with small `k` → tight crater with a wet lip | wet interior, congealed rim |
| Blast | same with larger `r`; severs if it overlaps a joint | as above, wider |
| Burn | no subtraction initially; a char scalar that grows a shallow subtraction over time | lerp toward char black, specular killed |
| Sever | drop the limb's primitives; `smin` re-closes the stump automatically | large stump wound → exposed wet interior |

### Wounds live in rest space

A wound is recorded in the local space of the primitive nearest the hit, and transformed back by that primitive's current transform every frame. **This is the mechanism that makes a crater stay on the shoulder while the shoulder swings and stretches.** The same rest-space transform solves texture swim (§7), so one mechanism serves both — this is deliberate and should not be split.

Wounds are a **ring buffer of 16**. Overflow drops the oldest. No persistence layer, no merging into a baked damage texture; if 16 proves too few to read well, that is a finding worth recording rather than an architecture to pre-build.

### Severing

Each primitive carries a `limbId`. Severing moves that limb's primitives into a new chunk group with velocity inherited from the rig, and stamps a large wound record at the joint. The remaining primitives re-blend through `smin`, so the stump closes over with no explicit cap geometry. The stamped wound is what makes it read as torn meat rather than a smooth clay nub.

---

## 6. Rendering

### Proxy-box marching

The body is drawn as a **proxy box** — a cube mesh sized to the rig bounds, `side: BackSide`, `depthWrite: true` — and the fragment shader sphere-traces from the ray's entry point. Cost scales with the enemy's screen area rather than the screen.

The shader **writes `gl_FragDepth`**, so blobs depth-sort correctly against the floor plane and against each other. This is non-negotiable; without it nothing composites.

**Each gib chunk gets its own small proxy box**, sized to that chunk's bounds. Chunks are small on screen so the fill cost is trivial, overlapping boxes resolve through the normal depth test, and this avoids one wasteful box spanning a spread-out gib cloud.

### Cost control

Three levers, applied in order of value:

1. **Cluster culling.** Primitives are grouped into six clusters (head, torso, 2 arms, 2 legs), each with a bounding sphere. `map()` tests bounds first and skips clusters that cannot beat the current best distance. This is what makes ~20 primitives affordable and is the highest-value optimisation.
2. **Step-count LOD by distance.** Far bodies march fewer steps.
3. **Half-resolution march into an offscreen RT**, upsampled. Held in reserve — the dither pass destroys fine detail anyway, so the quality cost is close to zero. Only implement if 1 and 2 are insufficient.

Budget: one zombie plus up to ~24 chunks at 960×540.

### Normals and displacement

Normals via tetrahedron sampling of the field. Silhouette lumpiness comes from **fBm added to the distance value**, which breaks the Lipschitz bound — march steps are multiplied by **0.6** to compensate. Surface micro-detail perturbs the **normal only** and never the distance, so it costs nothing in march safety.

---

## 7. Surface and lighting

One shared surface shader driven by a parameter block, with three presets. All parameters are live-tweakable in the panel, so any point between presets is reachable — the "which look is right" question is answered by sliding, not by choosing.

```ts
interface FleshMaterial {
  baseColor: Vec3;          // exterior
  deepColor: Vec3;          // wound interior
  charColor: Vec3;
  specIntensity: number;
  specRoughness: number;
  fresnelBoost: number;     // rim wetness
  translucency: number;     // fake backlit scatter
  surfaceNoiseAmp: number;  // normal-only micro detail
  silhouetteNoiseAmp: number; // distance displacement
  wetness: number;          // global multiplier on spec + fresnel
}
```

| | `henenlotter-latex` | `wet-meat` | `clay` |
|---|---|---|---|
| base → deep | saturated pink → candy red | red-brown → crimson | waxy tan → dull red |
| spec intensity / roughness | high / sharp | high / broad | low / very rough |
| fresnel rim | high | medium | none |
| translucency | medium | high | none |
| surface noise | low — latex is smooth | high — veins | medium — fingerprints |
| silhouette noise | high — foam blobbiness | high | low |

**Texturing** is rest-space triplanar: for each surface point, find the nearest primitive, transform into its local space, and sample three axis projections blended by `normal²`. No UVs — which is essential, because the topology mutates as the body is shot apart and there is no stable UV layout to author. Sampling in *rest* space rather than world space is what stops the texture swimming through the flesh; it reuses the transform already built for wounds (§5).

**Wound-driven shading is free.** Distance-to-nearest-wound is already evaluated for the field, and it drives the interior lerp directly — no extra data structure.

### Lighting presets

Lighting is a variable of the experiment, not scene dressing:

- **`practical-hard-key`** — single close bright key, weak fill, deliberately blown speculars. The Troma/Henenlotter look.
- **`game-ambient`** — mirrors the real game's directional sun plus ambient, to check whether the material survives Blud's actual lighting.

Key light position is draggable in the panel.

### Palette discipline

Everything lands in `palette-dither-pass`, so the output is quantised regardless. All shading choices must be **bold and low-frequency** — base tone, saturated gore, wet highlight, char black. Detail finer than that is wasted work.

---

## 8. Gibbing

Death splits the field into blob groups that **stay raymarched** rather than handing off to voxel chunks. Each group carries its own transform, linear and angular velocity, and simple physics: gravity, floor bounce, tumble, and **non-uniform squash on impact that relaxes back**. Squash is what sells wetness — a rigid bouncing blob reads as plastic.

Because chunks are seeded from the *current* primitive set, **gibs reflect damage already dealt**: an arm removed earlier is not in the pile. This is a direct consequence of the representation and is one of the things the experiment is meant to demonstrate.

---

## 9. Interaction and tuning

- **Orbit camera** with mouse; no FPS controller (this is a look test, not a feel test of movement).
- **Click to shoot** — screen ray → SDF hit point → wound record. Modifier keys select pellet / blast / burn.
- **Tuning panel** exposing: material preset + every `FleshMaterial` field, lighting preset + key position, rig stiffness/damping, per-primitive `blendK`, wound radius per type, march step count, silhouette noise amplitude, and a reset button.
- **Panel edits persist** to the override layer (§4) — dump to `localStorage` continuously plus a copy-to-clipboard button emitting a JSON blob that can be pasted into `body.ts` to promote a tweak into the committed definition. Without this, every reload throws away the tuning work, which is the actual output of the experiment.
- `validateBody` re-runs on every override change; failures surface in the panel rather than silently rendering wrong.
- Keys for **re-spawn**, **force gib**, and **sever a named limb** so specific cases can be inspected without shooting for them.

---

## 10. Testing

Pure modules get vitest coverage; the shader is judged by eye — which is the entire point of the exercise and not a gap.

| Module | Covered behaviour |
|---|---|
| `rig.ts` | constraints converge; rest length restored after displacement; stretch is bounded; no NaN under extreme impulse |
| `damage.ts` | world hit → correct rest-space wound; ring buffer evicts oldest at capacity; round-trip through a moved/stretched primitive lands back on the same surface point |
| `sever.ts` | limb primitives leave the body set; chunk group inherits them exactly once; stump wound stamped at the joint; severing twice is a no-op |
| `gib-chunks.ts` | gravity integrates; floor bounce loses energy and settles; squash relaxes to unit scale; chunks come to rest |
| `field.ts` | packing round-trips |
| `build-body.ts` | mirror produces an exact bilateral pair; relative placement resolves to expected world positions; override layer merges without dropping unlisted fields; **`validateBody` fires on each failure case in §4** |

The `validateBody` cases are the ones that matter for correctness. Every failure they catch is *silent* — it renders a plausible but wrong image rather than erroring, and reads like a shader bug when it is actually a body-definition bug. Each check gets a test that constructs a deliberately broken `BodyDef` and asserts the check fires.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Fill cost tanks framerate | Cluster culling first, then step LOD, then half-res RT held in reserve |
| Distance displacement causes march artifacts | Step multiplier 0.6; expose it in the panel so it can be tuned against the noise amplitude |
| Texture swims despite rest-space sampling | Nearest-primitive selection popping at blend boundaries — blend the nearest 2–3 by weight if visible |
| 16 wounds too few to read as "shot to pieces" | Accept and record as a finding; do not pre-build a baked damage texture |
| Look is good but nothing ports to the game | Accepted. The deliverable is the opinion. |

---

## 12. If it works

**A creature DSL becomes worth building.** The WAM-derived structure in §4 is deliberately shaped to receive one: `BodyDef` is plain serialisable data with relative, named, mirrored placement, so a text front-end that emits `BodyDef` slots in behind an unchanged `build-body` → `field` → shader path. That is the point at which a parser amortises — a bestiary of SDF creatures, not one zombie. Not before.



Out of scope here, listed only so the experiment is not accidentally designed to preclude it: porting onto a real enemy would require the flesh to stay **entirely cosmetic** — the sim keeps its Build-unit hit volumes and integer tic loop, wound positions arrive from deterministic sim hit events, and the jiggle/stretch stays per-client and unsynchronised. The architecture in §3 already separates pure state from rendering along roughly that line, which is deliberate. That port is a separate spec.
