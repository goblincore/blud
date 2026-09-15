# Gibs as classic gore PARTS, not the body's own flesh — the owner's direction change

> **Next agent: read [HANDOFF.md](HANDOFF.md) first** — it carries the
> wiring plan, the seams and every trap with its numbers.

**Owner, 2026-09-11:** *"the gibs still are like i said tubes and balls. tbh i almost feel
i would prefer if like upon explosion the whole character became chunky meaty textured and
blood stained mesh parts that were then exploded outwards eg it doesnt really have to
resemble the SDF body part shapes at all. it would include some skeleton bones too but those
could be unrelated to the actual skeleton bones in the body — eg these would look more like
classic bone silhouette shaft with knobby heads which our simplified skeletons in the body
dont have"*.

This supersedes two earlier decisions. Written down because a direction change is the one
thing a later reader cannot recover from the code.

## What it supersedes

1. **"The pieces ARE the body's own prims"** — the whole justification of
   `gib-parts.ts` and its measured 5.39% surface coverage against `gibAll`'s 3.66%. That
   measurement only mattered because the pieces were supposed to reassemble into the body's
   silhouette at the blast frame. The owner has now explicitly released that requirement:
   *"it doesnt really have to resemble the SDF body part shapes at all"*. The measurement
   was not wrong; its PREMISE was withdrawn by the owner.
2. **The mesh pre-bake, declined 2026-09-11** on three grounds, two of which are now void:
   the pose seam (a rest-baked part cannot match a posed body) does not matter if the parts
   never had to match, and the loss of accumulated wounds likewise. What remains is the
   boot-time bake pipeline — and a procedural generator needs no bake at all.

## What the owner is actually asking for

- On a blast, the body becomes **mesh parts** that are thrown outward.
- The parts are **chunky / meaty / blood-stained** — a gore look, not an anatomy look.
- The set includes **bones**, but **stylised ones**: a classic bone silhouette with a shaft
  and knobby heads, deliberately NOT the body's real skeleton groups.
- Explicitly NOT: smooth flesh capsules (the "tubes and balls" he has now reported twice).

This is the look of the reference game: Blood's gib pool is exactly this (its manifest in
`public/assets/gibs-placeholder/` is `body_head/arm/leg/torso/spine`, `blood_chunk_2154-2158`,
and a zombie head-spin sequence). Those are **dev-only placeholders — never commit, never
ship** — so they are a LOOK REFERENCE and a possible dev-only A/B, not an implementation.

## Why this is also cheaper, which is the part worth stating up front

MEASURED earlier in this project: every marched SDF piece in frame costs **~0.5 ms**
(`sdf:march`), and the 24-view pool had to be raised to 64 because the pool — not the piece
set — was what degraded a multi-body blast into "tubes and orbs". A **mesh** part is static
geometry: no march, no proxy box, no per-piece view, no pool. So this change:

- deletes the `?maxchunks` pool ceiling for gibs entirely (the pool exists to bound MARched
  pieces);
- makes a 5-body blast cost roughly the chunks it already costs today;
- removes the tier ladder and `GIB_TIER_FLOOR` (there is nothing to degrade — every body
  gets the parts set);
- keeps everything that was fixed today and yesterday: the chunk stepper's floor/wall
  collision, settle detection, the bake path for long-lived pieces, and the bone-vs-meat
  material split.

The SDF path does not have to be deleted on day one: `?gib=parts` vs a new mode is a
one-line A/B, and keeping it is how the owner can compare.

## The parts set I would build (procedural, committable, no assets)

Deterministic and seeded, in the style the repo already uses for geometry it owns:

1. **Meat chunks** — a handful of distinct silhouettes (not one shape scaled): a faceted
   low-poly shell with deliberate CHUNK, i.e. flat faces and hard-ish edges rather than a
   smooth ellipsoid, with a cut face where it came off the body. Flat/faceted shading is
   most of what separates "meaty chunk" from "tube".
2. **Classic bones** — a shaft plus knobby ends, two lobes per end so the head reads as a
   condyle rather than a ball; variants: long bone (femur-like), short bone, rib arc, a
   knuckle/knob cluster. NOT `bone-tube-geom.ts`, whose whole contract is fidelity to the
   body's SDF prim (`|sdPrimitive| < 1 mm`); this is a separate stylised generator.
3. **Blood staining** — procedural, from the existing gore palette
   (`baseColor/deepColor/fatColor/mottleColor` in the chunk bake's `look`), so the parts
   read as belonging to the same game as the wounds and the goo, plus a wet/dark term. If
   it needs a texture rather than vertex work, that is a separate decision (see below).

## The one open question before building

**Texture or procedural material?** "textured" in the owner's sentence could mean either.
The repo's own gore is procedural (uniform-driven palettes, no gore texture maps are
tracked in `public/assets/lab/`), and the only gore textures that exist are the Blood
placeholders, which cannot ship. So:

- **(A) Procedural material** — mottled meat + blood + wet sheen from the existing palette.
  Committable, consistent with the rest of the game's gore, no asset pipeline.
- **(B) Real texture maps** — needs authored or licensed art that CAN be committed; the
  existing Blood ones are placeholders and are out of the question for shipping.

Unless the owner says otherwise, (A), with a dev-only `?atlas`-style mode left available for
him to compare against the reference sprites.

## Status — 2026-09-11: the parts exist, and a bench to look at them

`src/lab/sdf-zombie/gore-parts.ts` (+11 tests) and
`webgpu/gore-part-geom.ts`:

- **Five meat variants** (`blob`, `slab`, `wedge`, `gobbet`, `strip`), each an
  ico shell displaced by seeded fbm, QUANTIZED onto a coarse grid (the chunk look),
  with a CUT PLANE on the ones that should read as severed. The cut limit is
  quantized onto the same grid the vertices are, so the flat face and the blood
  decal land on the same plane instead of beside each other.
- **Four bones** (`long`, `short`, `rib`, `knuckle`): a capped tapered shaft with
  TWO LOBES PER END, so a head reads as a condyle and not a ball on a stick. The
  rib is a bent two-run shaft; the knuckle is lobes and no shaft.
- **Colour** comes from the game's own meat chain — `bakeChunkAlbedo`, the same
  ramp the marched flesh and the baked chunks use — driven by the part's own
  procedural wound mask and depth fields. That IS the blood-decal layer in
  vertex space: the sliced face is bloodier and reads as deep tissue (fat,
  muscle, clot) while the outer skin stays skin. Bones bypass the ramp and are
  painted ivory from the look's fat tone, darkened where dried blood clings at
  the joints.
- **Facets**: the geometry is de-indexed before `computeVertexNormals`, so the
  normals are FACE normals. A smooth shell is exactly the "tube" read rejected
  twice; faceting is the point, not a detail.

`?goreparts=1` lays a bench of 18 parts in front of the spawn, rendered through
the REAL gib mesh path (the shared `createBakedChunkMaterial`, the same
`bakeColor` attribute, the same router registration), so what is looked at is
what a gib will render. `__sdfGame.goreShowcase()` re-lays it wherever the player
is; `.goreShowcaseVisible(on)` hides it without destroying it.

MEASURED: 18 parts spawn, no page errors, and the bench is genuinely DRAWN —
presented-frame differential shown vs hidden **1.54% of pixels (7376 px)** against
a no-change control of **0.84% (4040 px)**. Capture: `/tmp/gore-parts/showcase.png`.

## Owner's verdict on the first bench, and the second pass

The bench was looked at, and the answer was blunt: *"the material for the gibs atm
are like really boring like rather flat no bumps or normal maps no stains no blood
decals they look like random pale shapes. some are okay but generally they are too
rounded ... though some of the ones that look like organs [are okay] but they need
to be like specular and red/pink like organs"*.

Three things were wrong and all three are now addressed:

1. **TOO ROUNDED.** The first shapes ran 0.14-0.22 quantization with smooth
   displacement, which is a rounded lump by construction. Now 0.16-0.34 with
   TERRACED displacement (the noise is quantized before it becomes a radius), so
   the surface is plateaus and steps. A test asserts the radius spread a smooth
   shell cannot reach.
2. **NO ORGAN FAMILY.** Organs are now their own family (`liver`, `gut`, `heart`)
   and their own paint path — red/pink from the viscera/organ tones, wet nearly
   everywhere (the material reads alpha as roughness: 0.9 dry against 0.31 wet, so
   wet IS the gloss), with lobule mottling and pale membrane streaks. The gut is
   BENT into a loop: a straight gut is a sausage, which is the exact read being
   avoided, and a test now fails if any variant is long AND round in section.
3. **FLAT SHADING, WHICH WAS THE REAL COMPLAINT.** This file previously said "NO
   noise here — the mottle is baked into the albedo; the march's per-pixel fbm has
   no mesh-side equivalent and does not need one". That holds for a surface-netted
   chunk with thousands of vertices. On a generated part with ~42 it does not: a
   per-vertex mottle across 42 vertices IS flat colour per facet. So
   `CHUNK_SHADE_WGSL` gained an opt-in per-pixel layer: a surface-gradient bump
   from an analytic sinusoid sum (exact gradient, no texture, no tangents, no UVs
   — generated geometry has none), blood decals from a three-wave splat field
   mixed toward a dark blood colour with the wetness raised, and organ gloss
   (48 -> 220 exponent) with a red/pink push at kind 2. It is off unless
   `goreCfg.x` is set, so every existing user of the material is unchanged, and
   `__sdfGame.goreDetail({detail, bump, blood})` A/Bs it live.

MEASURED for the detail layer: presented-frame differential detail-on vs
detail-off **1.34% of pixels** against a **0.30%** no-change control, no page
errors. (An earlier run of the same rig reported 54% — the material had failed to
compile and the rig was measuring a broken pipeline. It is not a result.)

Two WGSL traps cost real time here and are worth recording: a `wgslFn` source
string may contain ONE function (a helper `fn` beside the main one made TSL try to
bind the helper's parameters as node inputs), and a wgslFn cannot CALL another
wgslFn's function by name — the two live in separate modules, so the detail had to
be inlined into `chunkShade` with defaulted-off parameters rather than wrapped
around it.

## A THIRD direction, from the owner: generated sprite gibs

*"generate spritesheets based on the rendered SDF and then cut those up randomly
and use them in the gibs. this makes it more like the original blud source and is
easier to reason about ... sure you trade 3d but its not important in this case"*.

This is the reference implementation's own approach: Blood's gibs ARE cut-up
renders of the enemy, and the retired game in this repo already has the shape of
it — `src/game/gibs/chunks.ts` spawns a billboard `PlaneGeometry` with an atlas
texture, `transparent`, `depthWrite: false`, plus a blood trail and decals, fed by
`loadGibTextures('/assets/gibs-placeholder/manifest.json')`.

Why it is a strong idea:
- The pixels ARE the body, so it lands "meaty, bloody, textured" without any
  further shader work — the exact thing three passes of material tuning have not
  achieved.
- It is what the owner has been comparing against all along.
- Cheapest runtime of the three options: a quad with alpha, no march, no proxy
  box, no pool ceiling. It reuses the chunk stepper unchanged (walls, floor,
  settle) — only the RENDER differs.
- Deterministic if the sheet is baked once with a fixed seed.

What it costs, honestly:
- A render step nobody has built yet: the SDF body rendered at N yaws, cut into
  pieces. Boot-time (a few ms, once) or a build script writing committed PNGs.
- Billboards do not receive the room's per-pixel lighting the way a mesh does, so
  in a dark room they read flat unless tinted by a light sample. The reference had
  the same property and did not care.
- Alpha overdraw: dozens of alpha quads is fill-rate, though they are small.
- The sheet's pieces are cross-sections of a body, so the cut has to be along
  limb-ish boundaries with an irregular mask to read as gore rather than as
  "slices of a screenshot".

The mesh work is not wasted by any of this: the shapes, the paint, the spawn path
and the physics are shared, and only the renderer differs — so this belongs as a
MODE beside the mesh parts (`?gibparts=mesh|sprite`), judged side by side.

## The sprite bench — BUILT 2026-09-11 (the owner's call: try it first)

Owner: *"yeah lets do that first of all - placeholder atlas is fine to see how it
feels then we can generate our own sheet"*.

`?gibparts=sprite` (or `?gibsprites=1`) lays a bench of **54 billboards** in front
of the spawn — every frame of the reference atlas at two sizes (0.34 m and 0.2 m),
because a gib has to read at the size it will be thrown at and not only at bench
scale. Rendered through `webgpu/gib-sprites.ts`: a `PlaneGeometry` per piece sized
to the sprite's OWN aspect (a leg gib is a long rectangle and a head is square —
forcing both into one quad throws away the silhouette), `MeshBasicNodeMaterial`
with `map`, `transparent`, `depthWrite: false` and `alphaTest`, billboarded
CPU-side (in `tick`, and at spawn, because `tick` early-returns under the render
lock and a capture would otherwise photograph the bench edge-on).

MEASURED: 27 frames load from the dev-only atlas, 54 billboards spawn, no page
errors, and the bench is drawn — shown-vs-hidden differential **13.23% of pixels**
(63505 px), which is an order of magnitude more coverage than the mesh bench's
1.5% because these are cut-out quads at gib size rather than small solids.

**The reference sprites are TINY.** The manifest's own sizes: blood chunks 20-24 px
across, `body_torso` **10x5**, `body_head` 19x12, `body_leg` 46x11, the zombie head
spin 22-26 px. These are Blood's real resolutions from a 320x200 game, so at gib
scale they are aggressively pixelated (nearest-filtered, deliberately). That is the
authentic read — and it is the strongest argument for GENERATING our own sheet
rather than shipping these: a render of the SDF body can be cut at any resolution,
so our pieces can be 100-200 px instead of 20.

The atlas is **dev-only**: `public/assets/gibs-placeholder/` is gitignored, extracted
Blood assets (never commit, never ship), so `?gibparts=sprite` warns and degrades
quietly on a fresh clone — run `scripts/link-dev-assets.sh`. A generated sheet is
what ships.

Known limits of the sprite path, to judge against rather than discover later:
- Sprites are UNLIT (`MeshBasicNodeMaterial`): they take no per-pixel light from the
  room, so in a dark room they read pasted-on and brighter than their surroundings.
  Blood had the same property and did not care; if it matters, the fix is to tint by
  a light sample at the piece's position.
- Alpha quads with `depthWrite: false` sort by draw order, so two pieces overlapping
  can pop. At gib size in flight this is normally invisible; in a settled pile it may
  not be.
- A billboard is flat to the camera, so a piece has no silhouette from the side.

## Generating our own sheet — the front end already exists, and it works

`scripts/blob-turntable.mjs` (via `npm run blob:shot -- <character>`) is a
deterministic N-angle capture of the LAB SDF BODY, with the traps already solved:
`__sdfLab.setCam(yaw, pitch, dist, targetY)` is the real camera knob (a raw
`camera.position.set` is stomped by the lab's own render loop), motion and wander
are frozen into the authored rest pose, and the verlet settle is waited out — which
the script's header measures as cutting cross-run pixel drift from ~5.7% to
~0.3-0.4%.

RUN, 2026-09-11: `LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 BLOB_DIST=2.2 npm run
blob:shot -- zombie` → **8 frames at 8 yaws, 1380x820, deterministic**
(`/tmp/blob-shot/zombie/frame-00..07.png` + an `index.html` contact sheet).

What that tells the cutting step:
- The body is BRIGHT FLESH (centre pixel 248,128,128) on a DARK, near-flat
  background: 26,17,22 at the top of the frame and 35,24,22 at the bottom. So a
  luminance key with a margin is feasible without a renderer change, and the
  residual gradient is smooth enough to model per row. The risk a key carries:
  a genuinely dark part of the body (shadowed cloth, a black prop) could key out
  with it, so the cut should take the largest connected component and fill holes
  rather than trusting a threshold alone.
- 1380x820 gives ~8-16 usable pieces per yaw at 128-200 px each — against the
  reference's 10x5 to 26x22 px. That resolution headroom is the reason to generate
  rather than ship the extract.
- No alpha channel (RGB). Cleaner would be a transparent clear in the lab, which
  needs a renderer/canvas change; the key avoids that and is enough for pieces
  whose edges are meant to be irregular anyway.

## Cutting the sheet — built, and BLOCKED on an alpha render

`scripts/gib-sheet.mjs` + `scripts/lib/png-write.mjs` (a minimal PNG encoder, since
the repo had only a decoder; round-tripped against that decoder by
png-write.test.mjs, alpha included). The cut and pack halves work:

- pieces are NOT rectangles — each gets a radial-noise mask so its edge is TORN,
  because a rectangle of a render reads as a slice of a screenshot;
- the grid is jittered per cell, so no two pieces share a silhouette;
- pieces are packed shelf-wise into ONE sheet PNG plus a rect manifest (per-piece
  files would be ~100 committed PNGs), with a `yawDeg` tag per piece for the
  view-angle sets;
- it writes an `index.html` contact sheet on a checkerboard, so the owner can judge
  the CUT without launching anything.

**SOLVED, and the fix was smaller than expected.** `blob-turntable.mjs` now takes
`BLOB_MASK=1` and writes a mask per angle by capturing the frame TWICE — once
normally and once with `__sdfLab.body.visible = false` — and diffing. That is
exact, needs no renderer change (the lab's directional light has no shadow map, so
the body casts nothing to catch in the difference), and it retires the key
entirely. MEASURED: body pixels per angle become **20644-38183** against the key's
1749-52923, i.e. stable and plausible (front views bigger than side views) instead
of wild.

RESULT: **77 pieces from 8 yaws**, rects 91-186 x 374-395, coverage min 0.46 /
median 0.77 / max 1.00, sheet 512x1040 (364 KB), committed to
`public/assets/lab/gore/` (sheet.png + manifest.json + index.html, a contact sheet
on a checkerboard). This is the first gib asset in the repo that can SHIP — it is
generated from our own rendered character rather than extracted from Blood.

**The three failed keys are kept below as the record of why the mask exists:**

| key | result |
| --- | --- |
| absolute "dark + unsaturated" | body pixel count collapses 32637 (yaw 0) -> 1749 (yaw 225); a shadowed limb IS a dark unsaturated blob |
| distance from the row's background, tol 34 | the flood fill LEAKS INTO the body at rear angles — yaw 180 "found" a 102x32 sliver |
| same, tol 10 | no leak, but the background is DITHERED, so the mask speckles across a 1352 px box and the grid finds 7 pieces with ~0.5 coverage |

The lab's background is not a flat colour: it is the clear colour 0x1a1116
(26,17,22, matched exactly at the top of a frame) shading to 35,24,22 at the bottom
— a fogged gradient — and it is noisy. The fix is not a fourth heuristic:
`lab-renderer.ts` should render an ALPHA background for captures (`alpha: true` +
setClearColor(colour, 0) + no fog) behind a URL param, leaving the interactive
`alpha: false` (which exists for a canvas-pacing reason, documented in that file)
untouched. Then the mask IS the alpha channel.

## The generated sheet, in the bench

`?gibparts=sheet` shows the GENERATED sheet rather than the reference extract:
**77 frames, 154 billboards** (every piece at two sizes), loaded through
`loadGibSheet` — one PNG with a rect manifest, each frame a texture cloned from the
sheet with `offset`/`repeat` set to its rect, so N pieces cost one upload and the
bench, the runtime and the material do not care which kind of atlas they were
given. MEASURED: drawn, shown-vs-hidden **5.38% of pixels**, no page errors. The
gib bench's own gate still passes (`sdf-game-dynamite-gate.mjs`).

The UV ORIGIN is the trap that eats an afternoon here: PNG row 0 is the TOP of the
image and three's texture origin is the BOTTOM-left, so a rect's y must be flipped
(`1 - (y + h) / H`) or every piece samples the vertically mirrored region — which
looks plausible enough on a symmetric chunk that the mistake survives review.

The three atlas modes are now comparable in the same bench:
`?gibparts=sprite` (reference extract, dev-only) · `?gibparts=sheet` (our own
render, shippable) · `?goreparts=1` (the procedural mesh parts, for contrast).

## What is NOT done yet

1. **The MESH parts are still a bench; the SPRITE path is now WIRED.** As of the
   second 2026-09-11 pass, `?gibrender=sprite` makes a real detonation spawn
   billboards instead of marched pieces (opt-in; the default is unchanged) — see
   [HANDOFF.md](HANDOFF.md) for the design, the measurements and the traps. What
   remains bench-only is the procedural mesh parts (`?goreparts=1`): a detonation
   still never spawns those, and items 2 and 3 below are about that path.
2. **Blood and normal detail on the MESH parts are ALREADY per-pixel — the claim
   that used to be written here was WRONG.** `baked-chunks.ts`'s `CHUNK_SHADE_WGSL`
   carries a `goreCfg.x > 0` layer doing exactly the owner's own description: a
   value-noise fbm over the part's LOCAL position driving (a) surface-gradient
   normal perturbation (Mikkelsen — no UVs or tangents needed, which is why it works
   on generated geometry), (b) blood decals from two noise fields, a broad splatter
   and a vertically stretched one that reads as drips, raising the wetness mask, and
   (c) organ gloss. It is ON for the mesh bench (`goreDetail: true`, bump 1.6,
   blood 0.9) and live-tunable via `__sdfGame.goreDetail({detail, bump, blood})`.
   It was written in response to the owner's own note, quoted in that file: *"the
   material for the gibs atm are like really boring like rather flat no bumps or
   normal maps no stains no blood decals they look like random pale shapes"*.
   **So the MESH route's remaining gap is its SHAPES, not its material** — which is
   what "they just look like crystals rn" was about, judged WITH the detail layer on.
3. **No physics yet for the mesh parts**: they are placed statically. The chunk
   stepper (with today's wall and ceiling collision) is the intended physics and
   needs no changes.

## What this note does NOT decide

The look. Every claim above is structural or a former measurement; whether the parts read as
chunky, meaty and blood-stained is the owner's judgement, and the parts need a way to be
LOOKED at before they are wired into a blast — a showcase the owner can open, the way
`?explosionfx` did for the burst.
