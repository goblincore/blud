# Blud — SDF Zombie: Face, Carving, and PSX Surface — Design

**Date:** 2026-08-15
**Status:** design approved, pre-implementation
**Type:** side-quest experiment — continues `X1`, still **not** on the M6/M7 critical path
**Extends:** [2026-08-15-sdf-zombie-lab-design.md](2026-08-15-sdf-zombie-lab-design.md)
**Answers:** the two open follow-ups from [the lab findings](../../dev-notes/2026-08-15-sdf-zombie-lab-findings.md) — face/character design, and the rest-space triplanar that was specced but never built.

---

## 1. Context and intent

The lab succeeded at what it set out to test. Flesh webs at the joints, craters ride the moving surface, stumps close over themselves, gibs carry damage already dealt. The findings' verdict is *worth building on*, with one honest caveat:

> It does not yet look *good*. It reads as a convincing fleshy creature and it is extremely satisfying to shoot, but the material is one step past placeholder and there is no face.

This spec closes that caveat. It is an **authoring and surface** spec, not a representation spec — the representation question is already answered.

### Art direction: PSX-inspired, not PSX-authentic

The north star shifts from the original spec's Henenlotter practical-latex toward **PSX-era survival horror**, with a deliberate and important qualification: *nothing here emulates a limitation.* We borrow the vocabulary — chunky quantized texels, ordered dither, a hard-limited palette, low internal resolution — and wrap it around raymarched smooth-min flesh with true per-pixel normals, subsurface scatter, and everted wound rims. No hardware of that era could have produced this combination. The retro reading is an aesthetic choice layered over tech that postdates it.

This resolves rather than replaces the original art direction. Henenlotter latex is about *saturated, hard-key, wet* — all of which survive palette quantization intact, because the BLOOD.PAL palette is itself saturated and gore-heavy. The two directions are compatible; PSX adds a quantization discipline on top.

### Division of labour: geometry carries form, texture carries surface

The single most important principle in this spec, and the one most likely to be violated under time pressure:

- **Geometry carries form.** The big hooked nose, the sunken eye sockets, the heavy brow, the hollow temples, the slack mouth. These are primitives.
- **Texture carries surface.** Mottling, veins, subdermal blotching, grime settled in creases. These are shader.

At PSX texel sizes texture **cannot** fake form. A nose painted into an albedo map reads as a smudge, and an eye socket painted as a dark ellipse reads as a sticker. Conversely, geometry cannot economically carry surface — every freckle would cost a primitive out of a hard-capped uniform array. Each technique does the job the other is bad at. Any proposal to move work across that line should be treated as a mistake until argued otherwise.

### Success criterion

Load the lab and look at it. Concretely:

1. The zombie has a **face that reads as a face** in silhouette at 960×540 — brow, sockets, and a large nose legible from a three-quarter view without zooming.
2. Surface detail **stays welded to the flesh** as the body jiggles. Nothing crawls.
3. The three detail stacks are **distinguishable on screen**, and one is clearly better.
4. Face proportions are **tunable by dragging**, and a tuned face survives a reload.
5. Shooting the face off still works — carved sockets travel with a severed head and do not leave floating holes.

As with the parent spec, failure is acceptable and the deliverable is the opinion.

---

## 2. Non-goals

- **No skeleton field.** `max(flesh, -bone)` is the next follow-up, not this one. Deliberately deferred so this spec stays judgeable.
- **No game or sim integration.** Unchanged from the parent spec.
- **No *authored* image-texture pipeline.** No painting, no UV layout, no atlas tooling. A **third stack sampling the already-extracted Blood zombie sprite** is in scope (§6) precisely because it needs none of that — the asset exists and is already palette-native. Authoring original texture art remains the reserve option if all three stacks fail.
- **No walk cycle, no facial animation.** The face is static geometry on a jiggling rig. No blinking, no jaw articulation.
- **No new enemy types.** One zombie.

---

## 3. Phase 0 — wire the post stack (do this first)

**The lab has never rendered through the game's post-fx composer.** `createRenderer` exposes `setDrawFn` to swap in an `EffectComposer`, and only [`src/main.ts`](../../../src/main.ts) calls it. `lab-main.ts` never does, so it has been running the default `renderer.render(scene, camera)`.

The parent spec claimed otherwise, in as many words:

> the sandbox renders at the same 960×540 internal resolution and runs the same barrel + palette-dither post stack. A raymarcher judged in a clean HD viewport will lie about how it looks in Blud.

The resolution half came free from `createRenderer`. The post-stack half was never implemented, and nothing caught it — it is the same failure class as `rig.ts` shipping with no non-test importer. **Every aesthetic judgment recorded in the findings doc was made through the wrong presentation chain**, including "it does not yet look good".

Wiring it is roughly ten lines: build the composer via `createPostFxComposer` and hand it to `setDrawFn`. It must land **before** any surface work, because it changes what every subsequent judgment is judged against.

Two consequences follow immediately:

- **Do not reimplement dither or palette snap in the flesh shader.** [`palette-dither-pass.ts`](../../../src/vfx/post-fx/palette-dither-pass.ts) already does Bayer 8×8 plus a 256-entry BLOOD.PAL nearest-match. Duplicating it would double-quantize and fight itself.
- **Add a panel bypass toggle.** The post stack must be switchable off, or debugging a surface bug means guessing whether an artifact came from the shader or the palette snap.

### Screen-space and surface-space quantization are different

Both are needed, and one does not substitute for the other:

| | quantizes | behaves like | provided by |
|---|---|---|---|
| **Screen space** | output pixels | a filter over the whole image; fixed size regardless of distance | existing composer (Phase 0) |
| **Surface space** | rest-space texels on the flesh | a low-res texture on an object; shrinks with distance, slides with the surface | new work (§6) |

Screen-space alone gives a dithered image of a smooth object. Surface-space alone gives a chunky object in a clean render. The PSX read needs both.

---

## 4. Subtractive primitives

Eye sockets, nostrils, a mouth slit and hollow temples are **removals**. The primitive system has no notion of removal — every `PrimDef` is additive, and the only subtraction in the field is the wound system.

### The API

```ts
export interface PrimDef {
  // ...existing fields...
  /** Default 'add'. 'sub' carves this primitive out of the assembled field. */
  op?: 'add' | 'sub';
}
```

Encoded on the GPU as the **sign of `blendK`** in `uPrimB[i].w`, which is otherwise always positive. This costs no extra uniform bandwidth, which matters — see the budget in §11. It must be commented at both ends, because a negative blend constant is not self-evidently a carve flag.

### Where carves fold — and why not per-cluster

Carves apply **after the complete additive fold**, iterated in fixed cluster order. This is exactly the structure `applyWounds` already uses.

The tempting alternative is to carve per-cluster — assemble each cluster as `carve(union(adds), subs)` and then `smin` the clusters together. Reject it. `smin` is not associative (see the parent spec §4 and the standing warning in project memory), so restructuring the fold changes the surface everywhere and would force a **full retune of every authored `blendK` in `body.ts`**. Carving globally afterward leaves the existing additive fold bit-identical and preserves every tuned value.

The theoretical cost is that a carve is not scoped to its cluster — an eye socket could in principle bite the torso. Geometrically it cannot: the sockets are inside the skull and nothing else is within their radius. This is a real constraint on future authoring and belongs in a code comment, not just here.

### Interactions that must each be handled

Every one of these is a place a carve behaves unlike an additive primitive:

| System | Required behaviour |
|---|---|
| **Severing** | A carve is skipped when its cluster's `alive` flag drops, so sockets leave with a severed head instead of floating. |
| **Cluster bounds** | Carves are **excluded** from bounding-sphere computation. Including them inflates the bound and defeats culling. |
| **Gib seeding** | Carves are **not** seeded as chunks — a hole is not flesh. They must, however, be carried into the chunk that contains them, or a severed head loses its face mid-flight. |
| **Wound attachment** | `worldHitToWound` must not bind a wound to a carve. A crater riding the inside of an eye socket is meaningless. |
| **`chunkExtent`** | Ignores carves when measuring collision radius. |
| **Rig binding** | Carves **do** bind to the rig like any primitive, so the socket rides the skull as it jiggles. |
| **`validateBody`** | Connectivity and containment checks must run on the carved field. A carve deep enough to sever the head from the neck is a real authoring error worth catching. |
| **`sdBody` (CPU)** | Must carve identically. This is the CPU/GPU mirror discipline from the parent spec — the CPU field backs click-to-shoot, so drift means shots land where the body isn't, or inside a socket. |

That last row is the one most likely to be skipped and the most annoying to diagnose.

---

## 5. Rest-space coordinates

The current surface noise is evaluated at the **world** hit point — `fbm(p * 22.0)` in `march.glsl.ts`. The detail therefore stands still in the world while the body slides through it. At jiggle amplitudes and high noise frequencies this reads as crawling. It is why the parent spec called for rest-space sampling, and it was never built.

### Approach

Each primitive has rest endpoints (from `buildBody`) and posed endpoints (from `applyRig`). Both are uploaded. For a hit point `p`, each primitive proposes a rest-space position by transforming through its own frames:

```
restP_i = restFrame_i · inverse(poseFrame_i) · p
```

reusing the orthonormal `basisFromAxis` construction that `damage.ts` already uses for wounds. Per-primitive proposals disagree, so they are combined by a **softmax over primitive distance**, deliberately sharper than the geometry `smin` — `goober-test`'s `sminColor` technique, whose whole point is that a sharper colour blend stops dark limb tones washing across the torso. The same reasoning applies to texture: a geometry-width blend would smear detail across every joint.

This blend is shading-only and never feeds the marched distance, so it carries **no associativity or conservativeness obligation**. It cannot punch holes in the surface. That is worth stating explicitly, because every other blend in this codebase does carry those obligations.

### Cheap fallback

If fill rate or the uniform budget bites: approximate each primitive's transform as **translation only**, `restP_i = p - (a_i - a0_i)`. This needs one `vec4` per primitive instead of two and is near-exact for a jiggle rig, which barely rotates. It breaks as soon as limbs genuinely swing — a walk cycle, a severed limb tumbling — so it is a fallback, not the default.

---

## 6. Three detail stacks

All three are built, exposed as a panel dropdown beside the existing flesh presets, and judged on screen. The findings doc is unambiguous that nothing in the toolchain can evaluate a shader and only a human loading the page can decide this.

They are chosen to vary along one axis each, so a comparison is informative rather than merely a preference: `rest-texel` has coordinates and synthesized detail, `geometry-lit` has no coordinates at all, and `sprite-mottle` has coordinates and *real* detail in the destination palette.

### `rest-texel`

Rest coordinates snapped to a lattice, with texel size on a slider. Per-cell value noise selects from a small tonal ramp; a second, coarser layer adds subdermal blotching; a ridged-noise vein layer runs beneath. The result reads as a chunky low-resolution skin texture welded to the flesh — texels that shrink with distance and slide correctly across the surface, which is precisely what a screen-space filter cannot do.

### `geometry-lit`

No texture coordinates at all. Everything derives from the field: cavity (the existing AO tap) darkens creases and armpits, curvature from normal divergence lightens convexities, and a downward-biased term streaks grime and blood with gravity. Output posterized to a small band count.

Cannot swim, by construction — it never references position. The known weakness is uniformity: no freckles, no blotches, no place-specific marks. Whether that matters after palette snap is exactly the open question.

### `sprite-mottle`

Samples the extracted Blood zombie sprite (`public/assets/blood-tiles/1200.png`, the front-facing standing axe zombie, 77×116 with a ~34×32 head) as the texture source, in place of the procedural layers of `rest-texel`. Everything else — rest-space coordinates, lattice snapping, the shared composer — is unchanged.

Its decisive property is that **it is already quantized to BLOOD.PAL**. Every procedural stack we author is a guess about what survives the palette snap; this one cannot fail that test, because it is drawn from the destination palette. It is the only stack that isolates "does the *surface treatment* work" from "does the palette eat it".

Its flecked pink-on-brown mottling is also simply a better version of what `rest-texel`'s blotching layer tries to synthesize — real decayed-flesh chroma variation, hand-authored by people who were good at this.

**Use it for surface, not for features.** The sprite is sampled for chroma variation and **high-passed to discard its baked luminance**. It is lit from the upper-left with a hard shadow under the brow; multiplied raw onto our shaded flesh it double-shades and fights the key light. High-passing keeps the mottle and throws away someone else's lighting.

**Explicitly not a face decal.** Frontally projecting the sprite onto the head puts its painted brow and eyes at whatever position they happen to land relative to our carved sockets and nose — a painted eye halfway up a brow ridge. That violates §1's division of labour: geometry carries form. The only coherent version of the decal idea is to author the carve *to match* the sprite, inverting which one leads; that is a legitimate but different experiment, and is not this one.

**Dev placeholder only.** Governed by the standing project guardrail — extracted Blood assets never ship. If this stack wins, shipping requires re-authoring equivalent mottling as original art, which is a small job once the technique is proven. Note also that `public/assets/blood-tiles/` is currently **git-tracked** (1614 files), which the guardrail says it should not be; unrelated to this spec but worth fixing separately.

---

All three stacks feed the Phase 0 composer. None implements dither or palette snap itself.

---

## 7. The face

A pure module, `face.ts`: `FaceParams → PrimDef[]`. No Three, no GL, unit-testable — matching every other authoring module in the lab.

**Additive:** nose bridge, nose ball, brow ridge (mirrored), cheekbones (mirrored).
**Subtractive:** eye sockets (mirrored), nostrils (mirrored), mouth slit, temple hollows (mirrored).

The nose gets four parameters of its own — `length`, `width`, `droop`, `hook` — because at this resolution the nose is the single largest contributor to a readable silhouette, and a big hooked drooping nose is the character. The rest: `browHeavy`, `socketDepth`, `socketSpacing`, `socketRise`, `cheekJut`, `templeSink`, `mouthWidth`, `mouthHeight`, `mouthOpen`, `jawJut`.

Carved sockets suit palette quantization unusually well. A soft grey dish becomes mush after a 256-colour snap; a deep carved void becomes a hard black shape with a dithered edge, which is both cheaper and more legible.

Emitted primitives join the `head` cluster, preserving the fixed fold order.

---

## 8. Panel and camera

- **Face sliders** write into the existing persistent, non-destructive override layer (`BodyOverride`, `panel.ts`), extended with a `faceParams` block. Slider work survives a reload; the existing "copy override JSON" button carries a tuned face back into `body.ts` as the authored default.
- **Head-focus camera.** A panel button snaps to a locked three-quarter close-up on the skull bone; another returns to full body. Also exposed on `__sdfLab` so visual checks can be driven without hand-orbiting.
- **Detail-stack dropdown**, texel-size slider, band-count slider.
- **Post-fx bypass toggle** (§3).
- **Frame-time / GPU-time readout** and an **N-bodies spawner** (§10).

### Camera controls, already fixed

The lab bound orbit to right-drag only, which is near-undriveable on a trackpad, and had no on-screen control legend. Left-drag now orbits; a left press that travels under 5px still shoots. Legend added to `sdf-lab.html`. Recorded here because the parent spec's §9 describes the old binding.

---

## 9. Testing

Unchanged in philosophy from the parent spec: pure modules are unit-tested, and **the shader is not testable by any tool in this repo**.

- `face.ts` — mirrored params produce symmetric pairs; subtractive prims carry `op: 'sub'`; parameters move geometry monotonically in the expected direction; emitted count stays inside budget.
- Carving — a severed head takes its sockets; carves are absent from cluster bounds, gib seeds and wound attachment; `validateBody` rejects a carve that disconnects the head.
- CPU/GPU mirror — `sdBody` carves; a text-level assertion that the shader source contains the carve loop, since nothing compiles GLSL.
- Rest space — round-trip identity at rest pose; a displaced rig maps a moved surface point back to the same rest coordinate within tolerance.
- Panel — `faceParams` survives a localStorage round trip.

### The human gate

Non-negotiable, and the parent spec's most expensive lesson — three render bugs survived eight consecutive green tasks while the fragment shader failed to link and the page rendered nothing. After **every** shader change, a human loads the page and confirms: the body renders at all, no console shader-link errors, the face reads in silhouette, and detail does not crawl when the body jiggles.

---

## 10. Performance and scaling to multiple zombies

The lab is single-body by construction and every performance claim on record is a single-body claim. Blud puts *crowds* on screen, so the question "what happens with ten zombies" decides whether any of this is portable to the game. This section states the cost model and the levers; it does **not** claim to answer the question, because the honest answer requires measurement the lab cannot currently take.

### Measured baseline (Apple M3, WebGL2 / ANGLE Metal)

| | value |
|---|---|
| frame time, median / p95 | 16.7 ms / 17.6 ms — **vsync-locked at 59.9 fps** |
| `MAX_FRAGMENT_UNIFORM_VECTORS` | **1024** (GLES 3.0 guarantees only 224) |
| `EXT_conservative_depth` | **available and enables** |
| march steps | 96 body, 48 per chunk |

The critical thing about that first row: it is **not a headroom measurement**. Pinned exactly at vsync with p95 ≈ median means the GPU finishes early and waits. The single body could be using 5% or 80% of the frame and these numbers look identical. **Nobody currently knows how expensive this zombie is.**

The 1024 uniform-vector limit substantially de-risks §11's headline concern on this machine — ~300 `vec4` has 3.4× headroom. It stays a portability note, not a blocker.

### Cost model

Marching cost is **fill-rate dominated**: (pixels covered by the proxy box) × (march steps) × (cost of one `mapBody`, which is ~6 cluster tests + up to 34 primitives + 16 wounds + fbm). Draw calls and uniform uploads are negligible by comparison — 20 bodies at ~300 `vec4` each is under 100 KB/frame.

**The scaling hazard is overlap, not count.** The fragment shader writes `gl_FragDepth` and calls `discard`, which between them defeat early-Z rejection. The GPU therefore *cannot* skip a zombie hidden behind a wall or behind another zombie — it marches every fragment of every proxy box regardless of what occludes it. Ten zombies stacked in depth cost ten full marches on every shared pixel. This, rather than the primitive count or the uniform budget, is what breaks first.

### Levers, in descending order of effect

1. **Conservative depth + front-face proxy.** `EXT_conservative_depth` is available on this machine. Declaring `layout(depth_greater) out float gl_FragDepth;` promises the hardware that depth only ever moves *away* from the camera, which restores early-Z rejection — occluded bodies then cost approximately nothing. It requires flipping the proxy from `BackSide` to `FrontSide`, since the marched hit is always behind the front face but *in front of* the back face. The existing `BackSide` choice exists so the fragment survives when the camera is inside the proxy box, which needs a fallback path. This is the single highest-leverage change and it is currently untested.
2. **Half-resolution march target.** Already held in reserve by the parent spec and never needed at N=1. Roughly 4× fill reduction, and under PSX-style quantization the quality cost is small — plausibly negative, since it reinforces the aesthetic.
3. **Step-count LOD by screen-space size.** A zombie 20 px tall does not need 96 steps. Cheap to implement, scales precisely with the thing that costs money.
4. **Primitive LOD.** Collapse clusters to single capsules at distance. Interacts with the fixed fold order and so is the fiddliest of these.
5. **Sprite fallback beyond a distance threshold.** Blud *already ships billboard sprite zombies of this exact character*. SDF for the near bodies the player is actively shooting, sprites for the crowd. This is the most likely shape of a real port, and it reframes the SDF as a **hero representation rather than a crowd representation**.
6. **Hard cap on simultaneous SDF bodies** (e.g. the 3–4 nearest), with the rest on sprites. The blunt version of 5.

### Existing evidence

The findings record "comfortable at 960×540 with one body plus up to 24 chunks" — already 25 marched proxy boxes, so the multi-object path demonstrably works. It is *not* equivalent to 25 zombies: chunks carry 3–4 primitives, march at 48 steps, and cover few pixels each. It establishes that draw-call overhead is not the problem, and nothing more.

### CPU-side note

`applyRig` rebuilds every primitive and cluster as fresh objects each frame via `.map` plus spread, per body. Irrelevant at N=1 and a real source of GC pressure at N=20. Any multi-body work should revisit it.

### What this spec commits to

Instrumentation only, folded into Phase 0: a **frame-time and GPU-time readout** (via `EXT_disjoint_timer_query_webgl2` where available) and an **N-bodies spawner** in the panel. Together these convert every claim above from argument into measurement, at a cost of well under a day.

Choosing among levers 1–6 is deliberately **out of scope** and belongs to a port spec. Building the instrument is in scope, because without it the lab cannot answer the question at all — and because a lab that cannot measure its own cost will keep producing confident single-body claims like the vsync-locked 59.9 fps above.

---

## 11. Risks

**Uniform budget — measured, and no longer the top risk.** `MAX_PRIMS` goes 32 → 48 to fit the face (current body is 21; the face adds ~13). With rest endpoints uploaded alongside posed, the fragment uniform count reaches roughly 300 `vec4`. GLES 3.0 guarantees only **224** — but the development machine reports **1024** (§10), so there is 3.4× headroom and this is a portability note rather than a blocker. It would still bite a low-end GLES 3.0 target. Mitigations in ascending order of effort: the translation-only fallback (§5) halves the rest data; failing that, move primitive data into a **float data texture** read with `texelFetch`, which removes the ceiling entirely and is the correct long-term shape anyway.

**Fill rate under overlap is the real scaling risk** (§10). Single-body cost is currently *unmeasured* — the lab sits vsync-locked, which hides how much of the frame it actually uses. Phase 0's instrumentation exists specifically to stop this spec from producing more confident single-body claims.

**Carve-after-fold is unscoped.** Documented in §4 and geometrically safe today. A future body whose carves sit near a cluster boundary will violate it silently.

**All three detail stacks may be wrong.** The reserve is original authored texture art, deliberately left closed (§2). `sprite-mottle` meaningfully de-risks this: if it works and the procedural stacks do not, the answer is to re-author equivalent mottling as original art — a known, bounded job — rather than to keep guessing at procedural parameters.

**Palette snap may eat the material work.** A 256-colour nearest-match can flatten carefully-tuned subsurface scatter into a single flat tone. This is a genuine possible outcome and an argument for landing Phase 0 first — if the palette destroys subtlety, the correct response is to author *bolder and lower-frequency*, which is what the parent spec's "palette discipline" section already said and which nobody has yet been able to verify.

---

## 12. Phasing

**Phase 0 — presentation and instrumentation.** Wire the composer, add the bypass toggle, add the frame-time/GPU-time readout and the N-bodies spawner (§10). Re-judge the existing zombie through the real chain, and take the first real cost measurement the lab has ever had. Small, and it changes the baseline for everything after it — both what the zombie is judged to look like and what it is known to cost.

**Phase 1 — carving and the face.** `op: 'sub'` end to end, `MAX_PRIMS` to 48, `face.ts`, face sliders, head-focus camera. Delivers a character, and is judgeable standalone.

**Phase 2 — surface.** Rest-space coordinates, all three detail stacks, texel and band sliders. Delivers the look.

Phase 1 is deliberately judgeable without Phase 2, because only a human can evaluate any of this and a shorter loop to a lookable result is worth more than an efficient build order.

---

## 13. If it works

The follow-ups this spec deliberately leaves open, in the order they would most improve the result:

- **Skeleton as a second SDF field** (`max(flesh, -bone)`), so deep wounds and stumps expose bone. The single largest remaining gore win, and now cheap: carving infrastructure from §4 is most of the machinery.
- **Align gibbing with Blud's real physics and gib logic**, including flesh trails.
- **Facial animation** — a jaw that hangs open on death, given articulation is already implicit in the rig.
