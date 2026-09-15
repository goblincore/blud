# HANDOFF — gib sprites cut from rendered SDF, and the wiring that is next

**For the next agent. Read this first, then `README.md` in this directory.**

---

## ⚠️ START HERE — THE LOOK IS STILL WRONG, AND THAT IS THE WHOLE JOB

Three renderers exist and the owner has now looked at all three. **None reads as
gore yet.** The SHAPE problem is solved; the MATERIAL is not. Everything below this
section is context — this section is the work.

**The owner's verdict chain, verbatim, in order:**

1. Marched pieces: *"it just breaks into like tubes (arms and legs) and orbs
   (torso) which doesnt really read as gibs"* — that was the POOL DEGRADATION, since
   fixed (the shipped config always gets tier `parts`).
2. Sprite sheet: *"they are basically stamped circles of random parts … i dont
   think those wil work … i think we should not proceed with the sprites as is."*
   **REJECTED.** The one thing he liked: *"they have texture and render smooth."*
3. Per-piece mesh bake: *"they dont look like the zombie flesh at all. they have
   vertical streaks like some kind of rock … it literrally looks like rocks."*
4. **Carved whole-body meshes (the current path):** *"in terms of shape i think are
   fine but they literally look like rocks - nothing even abit fleshy about them -
   pale, like gray offwhite with some maybe texture that is linear streaky looking
   looks kinda like concrete meets marble a little"*, then *"they dont look right
   still gray and stone"*, then *"i dont think the texture is right either it
   doesnt look like the zombie skin texture at all."*

## ⚠️ SUPERSEDED BY THE SECOND SESSION (2026-09-11) — READ THIS BLOCK FIRST

Everything from `**Two diagnosed causes**` down to the end of CAUSE 2 is kept for
the record but is **partly wrong**. FOUR causes were found, all fixed, all measured.
The plaid/plane-wave theory was a **red herring**: the white blowout survived turning
that layer fully OFF, and turning it off made it WORSE (10.9% vs 7.7% of pixels
blown). No tiling-albedo/triplanar work was needed, and none was done.

**1. The wound mask was identically zero.** `gib-carve.ts` composes its field with
`torn: []` — correct, a rest pose has no wounds — but `bakeChunkAlbedo` mirrors the
march, and there `albedo = mix(baseColor, tissue, wm)`; march.wgsl.ts calls wm "the
sole authority on WHETHER this pixel is wounded" and notes "at wm = 0 nothing it
computes can reach the albedo". So the ENTIRE tissue ramp — dermis, fat, muscle,
clot, viscera — was computed per vertex and thrown away. Measured over the real
library: **0.00% of 23,846 vertices** carried any mask, while **33% of the surface
sits >2 mm beneath the original skin**. A third of every gib — the cut faces — was
painted as intact outer skin, with alpha 0 so the shader's wetness and gloss never
engaged either. **That is the flat pale hue.** Fix: the CUT is the wound, and the
field already knows where it is (on original skin `preWound` is 0; on a cut face it
is negative by the depth the slab boundary fell to). `cutAwareField` in gib-carve.ts.
At the shipped 1 cm cell the result is sharply bimodal — 60% skin, 32% meat at full
mask, ~2% rim.

**2. `goreKind` was never set on the carved geometry.** The carve renders with
`createBakedChunkMaterial({goreDetail: true})`, whose docstring is explicit that
geometry without that vertex attribute "must NOT use this mode ... an attribute that
is not there is not 0 — it is a bind error". It shipped without one, and three said
so on every frame:

    THREE.AttributeNode: Vertex attribute "goreKind" not found on geometry.

An unbound branch selector takes the ORGAN arm (albedo dragged 62% toward a pale
wash, wetness forced to >= 0.86, gloss 48 -> **220**) or the BONE arm (gloss 90). A
gloss-220 highlight under the 4x beam is a blown white speck wherever a normal faces
the lamp. Fixed by deriving it from the archetype's authored bone/organ prims
(`makeKindAt`), so exposed ribcage now shades as bone. Pinned by a test.

**3. `__sdfGame.goreDetail()` never touched the carve.** It wrote only `gorePartMat`;
`carvedMaterial` is a second instance with its own uniform set. Every live tuning
attempt on `?gibrender=carve` was a silent no-op — the same shape of bug as the
flashlight's, and worth knowing before trusting any earlier "the knob did nothing"
note. Fixed. `__sdfGame.goreLook({spec, fres, wetTint, stain})` was added alongside it.

**4. `chunkShade` was the march's INVERSE in two places.** This was the "white
concrete", and the march had already solved both:

  - **Fresnel must FADE OUT inside a wound.** march.wgsl.ts: `surfCfg.z * (1.0 -
    wmRim)`, because fresnel is environment rim light and inside a cavity the
    environment IS the wound — "At full strength it maxes out on the grazing-heavy
    rim geometry, the 1.6x wound wetness lands on top, and whole patches clip to
    white and sweep across the cavity as the camera moves" (X1.17). `chunkShade` had
    `look.w * (1.0 + wm * 1.5)` — it BOOSTED the term the march kills, 2.5x, and
    fix 1 above put wm = 1 over a third of the surface. Now `(1.0 - wm)`. The wet
    glisten a torn end should have is the tight specular, which keeps its boost.
  - **There was no tone-map shoulder.** The march runs lit flesh through
    `SOFT_SHOULDER` whenever the beam is on; `chunkShade` returned `diffuse +
    specular` RAW, and its specular is additive — never multiplied by albedo — so
    under the 4x beam any normal facing the lamp went straight past 1.0. Ported
    inline (a wgslFn source string holds one fn).

Measured blown-to-white piece pixels: **7.7-17% -> 0.46%**, against **0.0%** on the
marched body in the same frame. Saturation 35% vs the body's 29%.

**CAVEAT, not yet view-tested:** the shoulder also applies to SETTLED CHUNK bakes —
same material, and they do track the flashlight. Deliberate (matching the marched
body is the point, and a settled chunk sits next to one), but it is a visible change
beyond the path that motivated it.

**A FOURTH wgslFn trap, learned the hard way:** no BACKTICKS anywhere in a wgslFn
source string — it is a template literal, so one ends the file. `tsc` catches it
instantly. All prose for `CHUNK_SHADE_WGSL` now lives in the TS docstring above it.

**A latent bug noticed and NOT fixed** (no consumers, so it changes nothing today):
`CarvedPiece.offset` is always ~(0,0,0). `extractRegion` captures
`const bs = geometry.boundingSphere`, then calls `computeBoundingSphere()` again
after recentring — three MUTATES that Sphere in place, so the captured object reads
back the post-recentre centre. The field is documented as the piece's world centre
and is not one.

---

**Two diagnosed causes. One is fixed, one is not.** *(the first session's reading —
cause 2 below is the red herring; see the block above)*

### CAUSE 1 — FIXED: the pieces were not lit by the flashlight

The per-frame beam update touched **only `bakedChunkMat`**. Every other
`createBakedChunkMaterial` instance — the gore-parts bench AND the carved library,
which need their own `goreCfg` — kept the STATIC defaults: `spotCfg.x = 0` (beam
**OFF**) with a fixed directional key `lightCfg.x = 2.4`. In a dark room that is a
body lit by a lamp that is not there, at ~2.5×, clipping flesh albedo toward white.
**That is "pale, grey off-white", and it is why the bench and the carve failed the
same way.**

Fixed by a `litChunkMaterials` registry in `game-main.ts`: every drawn instance
registers and the frame update walks the list. **MEASURED after** (bench): mean part
pixel **(66, 49, 44)**, saturation **36.6%**, 0.1% clipped. The BEFORE state is a
code reading, not a capture — no before-frame was taken.

### CAUSE 2 — NOT FIXED: the texture is a SUM OF PLANE WAVES, not noise

`CHUNK_SHADE_WGSL`'s detail layer builds its fields from `sin(dot(p, w))` sums. A sum
of plane waves is a **plaid**: strong directional banding — exactly the owner's
"linear streaky … concrete meets marble". Measured with a directional metric
(vertical vs horizontal neighbour differences; 1.0 = isotropic): **1.239
layer-OFF, 1.285 layer-ON** — the layer ADDS anisotropy.

**THE FIX TO WRITE — and the repo already has the pattern, so do not invent one:**

`webgpu/goblin-skin.ts` makes a MESH match the MARCHED goblin skin by generating a
**CPU tiling albedo + normal map** from the march's own mottle recipe. Its comment:
*"MOTTLE, the marched shader's recipe: two octaves summed 0.6/0.3, centred, then
smoothstep-REMAPPED over the range the noise actually occupies (its tails are rare)
so the result is patches with light flesh between them rather than a uniform
half-tint. march.wgsl.ts's colour-mottle block explains why the obvious linear remap
fails."* Same lattice and seeds for the normal map so albedo and relief agree.

So: **generate a tiling flesh albedo + normal from the marched recipe and apply it,
rather than synthesising noise in the shader.** The wrinkle to plan for:
surface-nets geometry **has no UVs**, so a tiling map needs **triplanar** sampling
(or generated UVs) — that is the one real piece of new work.

**A FAILED ATTEMPT, recorded so it is not repeated.** I tried real MaterialX perlin
(`mx_fractal_noise_float`), building the noise nodes in TSL and passing them INTO the
`wgslFn` as arguments, with a finite-difference gradient transformed to world space
by `transformDirection(..., modelWorldMatrix)`. **It does not work:** measured bump
ratio **0.988**, blood coverage **0%**, burn **0.7%**, AND the base shading changed
underneath it (layer-OFF roughness 17 → 7, luminance 110 → 49). Computed TSL nodes
passed as `wgslFn` arguments did not arrive as values. Reverted.

### ALSO OUTSTANDING: re-tune the stains against the new exposure

The dark-blood and burn terms are real (`goreCfg2`, live via
`__sdfGame.goreDetail({detail, bump, blood, noise, burn, wet, dark, stainScale})`) and
measured **27.8%** dark-stain coverage BEFORE the beam fix. After it, the same
settings read **0.3% blood / 3.5% blood+burn** — the pieces are darker now, so those
thresholds must be re-tuned rather than carried over.

### Where to look (servers are UP: vite **5391**, CDP **9391**)

| what | URL |
| --- | --- |
| **the current carve path** | `http://localhost:5391/sdf-game.html?gibrender=carve` |
| default (marched `parts`) | `http://localhost:5391/sdf-game.html` |
| sprites (rejected, kept as reference) | `http://localhost:5391/sdf-game.html?gibrender=sprite` |
| the mesh-parts bench — SAME material family | `http://localhost:5391/sdf-game.html?goreparts=1` |
| the cut review, no game | `http://localhost:5391/assets/lab/gore/index.html` |

Servers gone? `LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 . scripts/lab-servers.sh`

**I cannot see images with this model.** Every look claim in this note is the
owner's eye; every texture/colour claim is a measurement. Do not describe how
anything LOOKS without a capture — and ideally the owner.

---

## Where the work is

- **Branch:** `claude/dynamite-weapon-slot`
- **Worktree:** `.claude/worktrees/dynamite-weapon-slot` — **work here, not in the
  primary checkout** (an earlier session collided with a second agent there; the
  primary is on a different branch with unrelated work in progress).
- HEAD: `66a1917c`. **Everything from this session is UNCOMMITTED working-tree
  change** — 20 files: 3 new source modules (`gib-sprite-pieces.ts`,
  `gib-library.ts`, `gib-carve.ts`), 3 matching test files, 2 new rigs
  (`sdf-gib-sprites-rig.mjs`, `gore-detail-ab.mjs`), plus edits to `game-main.ts`,
  `baked-chunks.ts`, `gib-sheet.mjs`, four existing rigs, the committed gore sheet,
  and the notes.
- Verified at this tree: `npx tsc --noEmit` clean, `npx vitest run` **4858 pass /
  1 fail** (the failure is `surface-nets.wgsl.test.ts`, pre-existing, do not chase
  it), the dynamite gate **PASS**, and all three `sdf-gib-sprites-rig` arms PASS.

### The three render modes

`?gibrender=march` (DEFAULT) · `sprite` (rejected) · **`carve`** (the current hope).
`?gib=` is ORTHOGONAL and still selects the piece SET (`pieces|clusters|parts`).

- **`carve`** — real meshes from a per-archetype library: **one field over the
  archetype's flesh AND its 68 authored bone prims** (so the skeleton is in the mesh
  — the per-piece bake could never do this), cut into `?gibcarvecells=` slabs per
  cluster (default 3 → 18 pieces), each a CAPPED region clip
  (`max(bodyField, regionField)`, so surface nets closes the cut instead of leaving
  a hollow shell). Library builds once at boot (~1.8 s) and is reused by every
  zombie — the owner's own design: *"all zombies use the same gib library"*.
  `webgpu/gib-carve.ts`, 5 tests.
- All three modes share ONE piece system (`gib-sprite-pieces.ts`: same `Chunk`
  state, same `stepChunk`, same stagger, same settle-and-park, same caps, same
  blood-trail feed). Only the POSE differs — `applySpritePose` (billboard + roll) vs
  `applyMeshPose` (the piece's own `quat`, squash as scale).

---

## What is built and verified (all measured at this tree)

| what | result |
| --- | --- |
| carve library | 18 pieces, 51,682 verts, 103,284 tris, **68 bone prims, 18/18 pieces reaching the skeleton**, ~1.8 s once |
| carve blast | **18 meshes, tier `carve`, 0 marched, 0 dropped** |
| blood trails | **36 → 500 droplets** while pieces fly (sprite and carve) |
| physics | pieces fall, **park**, none below the floor (shared `stepChunk`) |
| is it drawn | **1.8–3.3%** of the presented frame, hidden-vs-shown |
| caps | 128 live + 54 parked = **182 meshes**, exactly accounted |
| opt-in | default boot: 19 marched pieces, tier `parts`, 0 sprites, atlas never loaded |
| gates | dynamite gate PASS (default **and** `GATE_QS='&gibrender=sprite'`); wall/ceiling rig PASS on sprite pieces (8040 piece-frames, every one inside a room or tunnel) |

### The rigs (all take a query string for the arm)

```
node scripts/sdf-gib-sprites-rig.mjs 5391 9391          # SPRITE_RIG_ARM=carve|sprite|march
node scripts/gore-detail-ab.mjs 5391 9391               # material: banding, colour, stains
node scripts/sdf-game-dynamite-gate.mjs 5391 9391      # GATE_QS='&gibrender=carve'
node scripts/sdf-gib-wall-bounce.mjs 5391 9391         # GIB_WALLS_QS='&gibrender=sprite'
node scripts/sdf-dynamite-soak.mjs 5391 9391 4         # SOAK_QS='&gibrender=sprite'
node scripts/sdf-piece-cost.mjs 5391 9391 '&gibrender=sprite' 8
```

`gore-detail-ab.mjs` is the one to reach for on the material work: it isolates the
layer's terms (bump / blood / burn), masks to the parts' OWN pixels, and reports
**colour (mean RGB + saturation)**, **clipping %**, **directional roughness** (the
streak metric) and **dark-stain coverage**. Extend it rather than starting a new one.

---

## Traps — measured, do not re-derive

- **A rig that calls `step()` has STOPPED the render loop.** `__sdfGame.step()`
  documents "stops the rAF loop first". A cost block that aimed the camera with
  `step(1)` and did not call `.setLoopRunning(true)` afterwards measured a page
  drawing NOTHING: every cadence delta read **0.00 ms** and every GPU row vanished.
  That reads as "the pieces are free" and it is a stopped renderer.
- **`passTimings().collect()` DRAINS.** Three calls in a row returned **1658, 263,
  279** samples — the first swallowed the whole session, so a naive two-arm
  comparison pairs nothing. Flush before EACH arm and alternate rounds.
- **`goreCfg.x > 0` is NOT a no-op** even with bump and blood at zero: the same
  branch RETINTS bones (albedo × (0.9+0.2h), **alpha × 0.55**, gloss 90) and organs
  (mixed toward red/pink, alpha ≥ 0.86, gloss 220). Measured: **58%** of the parts'
  pixels change. There is no true "control" arm in that layer.
- **A WHOLE-FRAME percentage is meaningless for these parts** — the 24 bench parts
  occupy **1.28%** of the frame, so "1.7% of pixels changed" was half the parts.
  Mask the subject (hide it, diff) and measure inside the mask.
- **Roughness is the discriminating statistic, not mean difference.** Mean
  |difference| moved 2.4 → 3.1 in a version where the bump did nothing at all.
- **A sprite geometry cache keyed by SIZE is a leak wearing a cache's clothes.** Every
  piece's radius is its own `chunkExtent`, so a size key misses nearly every time:
  six blasts left **232 geometries for 147 pieces**. One shared UNIT plane plus
  per-mesh `scale` is bounded at 1, forever.
- **three r185 `Texture.copy` SHARES the `Source`**, so per-piece
  `texture.dispose()` would blank every sibling clone. The atlas owns texture
  lifetime.
- **`gunReady` does NOT mean the sheet is loaded** (view-model vs a 756 KB fetch),
  and the carve library is a ~1.8 s CPU build kicked off at boot. Wait for
  `gibRenderMode().ready` (bounded); a single read is a race that looks like a
  broken asset.
- **Backticks inside a WGSL template literal break the file.** Three times this
  session. `CHUNK_SHADE_WGSL` is a TS template string — no backticks in its comments.
- **`chunkStates()` tags marched rows `render: 'march'`**, not `'marched'`. A rig
  filter that guesses wrong silently aims at an empty list and reports "0 on screen".
- **PNG row 0 is the TOP; three's texture origin is the BOTTOM-left** — a sheet
  rect's `y` must be flipped (`1 - (y + h) / H`).
- **Do not key the lab's background** (fogged AND dithered gradient; three keys
  measured and failed). `BLOB_MASK=1` diffs a body-hidden capture and is exact.
- **A background Chrome tab throttles rAF**; wall-clock waits then measure a frozen
  page. **Rigs must set `Network.setCacheDisabled`** or Chrome serves a stale module
  graph and the run measures the OLD file.
- **`presentedShot()` returns the last PRESENTED frame** — draw after any change.
- **`pos += delta` with `prev` untouched is a kick of `delta/dt`**, and a VELOCITY
  handed to a signal needing a UNIT direction — the two bugs behind "bodies teleport
  then rubber-band". Read `blastKnockMps`'s neighbourhood in `game-actor.ts` before
  touching a blast reaction.
- **`impulseAt` takes METRES** and `bindRig` PINS the lowest joint, so a joint-level
  shove tears the body in half. Body-level reactions go through the ROOT (`knockV`).

---

## What exists now, and what to look at

The owner asked for gibs that read as **chunky, meaty, blood-stained gore** rather
than the body's own flesh tubes, and then, for the reference game's approach:
*"generate spritesheets based on the rendered SDF and then cut those up randomly and
use them in the gibs"*. That is built, and REJECTED as a look (see START HERE). Four
things are comparable, all launched from the game URL:

| mode | what it is |
| --- | --- |
| `?gibparts=sheet` | **177 pieces cut from our own rendered zombie** (square cells — see the cutter note). Was 154 tall slivers. |
| `?gibparts=sprite` | the reference extract (`public/assets/gibs-placeholder/`, dev-only Blood art) |
| `?goreparts=1` | the procedural mesh parts, for contrast (see README, they read as "crystals") |

- Cut review with no game launched: `http://localhost:5391/assets/lab/gore/index.html`
  (every piece on a checkerboard, so a mask or alpha failure is obvious).
- `__sdfGame.gibSpriteBench('sheet'|'placeholder')` re-lays the bench where the
  player is standing; `.gibSpriteBenchVisible(on)` hides it without destroying it
  (that is how a capture proves the sprites are DRAWN rather than merely in the
  scene graph).
- The asset: `public/assets/lab/gore/{sheet.png,manifest.json,index.html}` —
  **committed**, and the first gib asset here that can ship, because it is generated
  from our own character rather than extracted from Blood.

MEASURED at HEAD: 154 frames load, 308 billboards spawn, no page errors, and the
bench is drawn (presented-frame differential shown vs hidden **5.38% of pixels**).

## THE BUMP WAS NEVER RENDERING — found from the owner's report (2026-09-11)

The owner, on the procedural mesh parts: *"when i saw the mesh they had no texture
no nothing just albedo"*. He was **right**, and there WAS a render bug — the
material claimed a per-pixel bump and one was not reaching the picture.

**The cause was the noise DOMAIN, not the amplitudes.** `CHUNK_SHADE_WGSL`'s bump
sampled `positionLocal` at 6-43 cycles per unit, and these parts are built AT FINAL
SIZE (0.075-0.115 m) with **no mesh scale**, so local space spans ~0.12 units —
**less than one noise cycle across an entire part**. The fbm was a smooth ramp, so
the "bump" resolved to a uniform normal tilt instead of surface relief. That is also
why the BLOOD decals DID show while the bump did not: one of the blood fields uses
frequency 60, which was the only term fine enough to vary at pixel scale.

**Measured with `scripts/gore-detail-ab.mjs`** — neighbourhood roughness (mean
|difference to the adjacent pixel|) inside the parts' own pixels, which is the
statistic that separates "a shading shift" from "texture":

| noise domain scale | roughness vs layer-off |
| --- | --- |
| **1 (the old, unscaled code)** | **x0.996 — no pixel-scale content at all** |
| 4 | x1.101 |
| 8 | x1.113 |
| **12 (shipped)** | **x1.120** |
| 20 | x1.112 |
| 32 | x1.102 |

**The fix:** `goreCfg.w` was declared and *never read*, so it became this scale
(`let lp = pl * max(goreCfg.w, 1.0)`, default 12). Live-tunable:
`__sdfGame.goreDetail({detail, bump, blood, noise})`.

### Three traps this cost, all worth not re-deriving

- **`goreCfg.x > 0` is NOT a no-op** even with both amplitudes at zero: the same
  branch also RETINTS bones (albedo × (0.9+0.2h), **alpha × 0.55**, gloss 90) and
  organs (mixed toward red/pink, alpha ≥ 0.86, gloss 220). So there is no true
  "control" arm in that layer, and a rig that treats that setting as one reports a
  contaminated run. Measured: it changes **58%** of the parts' pixels.
- **A WHOLE-FRAME percentage is meaningless here.** The 24 bench parts occupy
  **1.28%** of the frame, so "1.7% of pixels changed" was ~half the parts, not a
  weak effect. Mask the subject first — hide the bench and diff — then measure
  inside the mask.
- **Roughness is the discriminating statistic, not mean difference.** Mean
  |difference| moved 2.4 → 3.1 in the first, wrong version of the rig while the
  bump was doing nothing; the neighbouring-pixel ratio is what exposes "smooth tilt
  vs texture" (1.00 vs 1.12).

### THE STREAKS ARE THE SINE SUMS — found, not yet fixed (2026-09-11)

The owner's next verdict: *"they dont look like the zombie flesh at all. they have
vertical streaks like some kind of rock and barely any bloood as far as i can see or
burn marks it literrally looks like rocks"*. He was describing the MATHS, and the
measurement agrees: a directional-roughness metric (vertical vs horizontal
neighbour differences, 1.0 = isotropic) reads **1.239 with the layer off and 1.285
with it on** — the layer ADDS anisotropy, and a sum of three plane waves is a plaid.
The old blood/burn thresholds were calibrated for the wrong distribution too, which
is why "barely any bloood" was literal.

**The stain terms are in and measured** (dark blood + a burn/char field that did not
exist, `goreCfg2`, live via `goreDetail({...})`): dark-stain coverage **27.8%** of the
parts' pixels with blood+burn on, median luminance falling ~11%.

**A FAILED FIX, recorded so it is not repeated.** I replaced the sine fields with real
MaterialX perlin (`mx_fractal_noise_float`), building the noise nodes in TSL and
passing them INTO the `wgslFn` as arguments — including a finite-difference gradient
transformed to world space by `transformDirection(..., modelWorldMatrix)`. **It does
not work.** Measured: bump roughness ratio **0.988** (no relief), blood coverage
**0%**, burn **0.7%**, AND the base shading changed underneath it (layer-OFF roughness
17 → 7, bench luminance 110 → 49). Computed TSL nodes passed as `wgslFn` arguments did
not arrive as values — they evaluated to ~0 while still perturbing the graph. Reverted
to the sine version the owner last saw.

**The fix must restructure, not patch:** compute the noise AND the perturbed normal in
the TSL node graph (where local→world transforms exist) and pass the RESULTING normal
and colour into the shader, instead of asking WGSL to synthesise noise or consume noise
nodes. Treat that as the shape of the change.

## THE GIB LIBRARY (2026-09-11, owner's design — built, NOT yet wired)

**The owner's call:** *"we should bake it at spawn and basically reuse across a
character instance eg all zombies use the same gib library."* Every zombie comes
apart into the same pieces, so a body's gib set is a property of its ARCHETYPE — the
existing settle bake pays 5.3 ms x ~24 pieces per blast for geometry that is
identical every time.

`webgpu/gib-library.ts` (+7 tests, `gib-library.test.ts`) builds one library per
archetype and caches it (`gibLibraryFor`), so the second zombie gets the same object.
**It needs no renderer, no actor and no blast** — `bakeChunkGeometry` is pure
synchronous CPU taking a plain field description, unlike the settle bake which needs
a live `ChunkGpuView.bakeData()`.

**Verified** against the real archetype (compiled `characters/zombie.blob`: 23 flesh
prims / 6 clusters / **68 bone prims** → 24 split pieces): every flesh piece bakes
with real geometry, baked albedo and a wound mask; the geometry is **recentred**; and
asking twice provably bakes once.

### Two findings that matter more than the module

1. **BONE-ONLY PIECES BAKE TO NOTHING — the library has no skeleton yet.** All 11
   `bone.*` pieces come out of `bakeChunkGeometry` with **zero vertices**: the CPU
   field unions bones in only NEAR A WOUND (mirroring the shader's `applyBones`
   nearWound gate), and a bone piece has no flesh and no wound, so its field is empty.
   The existing design avoids this on purpose — `game-main`'s settle bake is gated on
   `data.flesh.length > 0` with "Bone-only pieces retain their original SDF path" —
   because a marched bone piece never needed a mesh. A library does.
   **FIX: a bone bake path composing the field from the bone prims alone.** Pinned as
   `it.fails` so it starts failing the moment bones land; the library warns per piece
   meanwhile, so the gap is loud.
2. **Build the library from the COMPILED archetype, not `makeZombie()`.** The TS
   fallback has no authored bones: a body built from it splits into 10 pieces with
   zero `bone.*` and no `torso.chest`. Same source the game uses:
   `buildBody(compileBlob(parseBlob(zombieBlobSrc)), DEFAULT_BUILD_OPTS, {})`.
3. **Recentre the baked geometry, and it is load-bearing twice.** `bakeChunkGeometry`
   emits WORLD-space vertices, so a library geometry left as-is could only be drawn
   where it was baked — and the detail material's bump samples `positionLocal`, so the
   noise domain would be the whole level, grain-fine, and DIFFERENT for every
   instance. Recentred, every instance of a piece gets identical relief.

**Still to do:** wire it into the blast (a spawn from the library instead of
`spawnChunkPiece`) — that is the "bake at spawn" half, and with a library it costs
nothing at spawn because the bake already happened at boot.

## THE BLOOD AND BURN STAINS (2026-09-11, owner's next note)

After the bump fix landed the owner confirmed it by eye — *"the texture and normal
maps now show"* — and asked for the next thing: *"its okay it still look like rocks -
there no dark blood or burn stains. it would be nice if there was a contrast of sorts
the blood is more specular and wet looking"*.

The old blood colour was the problem: `deepColor*0.5 + (0.17,0.11,0.11)` ≈
(0.40,0.14,0.14), a dusty mid rose that reads as damp stone. Added `goreCfg2 =
(burnAmp, wetGain, bloodDark, stainScale)`:

- **dark blood** — `bloodDark` mixes the stain toward near-black venous red;
- **a BURN/CHAR field that did not exist** — near-black and MATTE (gloss 9), so it is
  the contrast against wet blood rather than more red; it also pulls the wetness mask
  DOWN, because soot is dry;
- **wet contrast** — blood drives gloss directly (to 260) instead of only through the
  alpha mask, so it out-speculars the flesh around it;
- **its own DOMAIN** — stains sample `pl * stainScale` (2.5), far broader than the
  bump's 12, so a stain is a PATCH. One shared domain cannot be both patch and relief.

**MEASURED** (`scripts/gore-detail-ab.mjs`, inside the parts' own pixels): median
luminance **114 → 101** (−11%) with the stains on, and the burn field alone changes
**37.5%** of their pixels. **Honest limit:** "more specular" is NOT proven by
brightness — the highlight is already saturated (max 255) in the clean arm, so p99
actually falls as blood TIGHTENS it. The wetness cue delivered here is CONTRAST
(darker stain + tighter highlight), not added brightness, and the owner's eye is the
judge. Live knobs: `__sdfGame.goreDetail({detail, bump, blood, noise, burn, wet,
dark, stainScale})`.

## VERDICT ON SPRITES: REJECTED (2026-09-11, owner, third pass)

**Do not build more sprite work.** The owner, looking at the square re-cut and then
at the pieces on the floor in game, verbatim:

> "idk if i like the new chunkier spritesheets they are basically stamped circles of
> random parts … just taking a look at them on the floor in game i dont think those
> wil work. the only thing i like about them is they have texture and render smooth.
> … i think we should not proceed with the sprites as is. unless we can cut them in
> shapes that make anatomical sense but i think that would take some work even then"

**Two separate complaints, and they need untangling before anything is built:**

1. **Shape** — "stamped circles". The billboard silhouette reads as a stamped
   disc, not a chunk. My `--sides`/`--polyscale` facets did not fix this (and I had
   already flagged that half as visually unverified, because alpha is
   `body AND polygon` and the body's outline dominates the rim).
2. **Semantics** — "random parts". A uniform grid cut takes whatever anatomy lands
   in the cell, so no piece IS anything. **This is the deeper one**: voxelizing or
   re-materialling a random cut still yields a random cut. His own escape clause is
   the semantic one ("shapes that make anatomical sense"), and he rates it
   expensive — correctly, it is a cutter rewrite around body structure, not a
   parameter.

**What he DOES like is the material**, not the medium: "they have texture and render
smooth". That is the body's own marched appearance — which is the thing the
marched `parts` path already has.

### The cheapest next move needs no code

**Re-look at the DEFAULT blast (no query params = marched `parts`).** His original
"tubes and orbs" rejection PREDATES the view-pool fix, and by this note's own account
that complaint was the DEGRADED TIER (`clusters`, bones packed inside the tubes),
which the shipped 64-view pool no longer reaches — the gate asserts the shipped
config always gets tier `parts`. That path already has all three things he asked for
here and there:

- anatomically sensible pieces (torso split three ways, every limb at its joint),
- **bones as their own pieces with pale-bone shading** — his explicit ask, which the
  sprite path never had at all,
- the body's own smooth skin material — the exact thing he praised.

If it survives a fresh look, the remaining work is HIS OWN idea 2b and it is
bounded: a per-pixel detail layer (perlin-noise normal perturbation + deep-red
blood shapes with noise) on the existing marched chunk material. The note's own
README already names this as the known gap — "Blood and normal detail are
per-VERTEX, not per-pixel … there is no procedural normal perturbation at all" — and
the mesh-parts path (`gore-part-geom.ts`) already has a `goreCfg`/`goreKind` detail
shader to model it on.

If it does not, the alternative is HIS idea 3: voxelize the cuts (3D volume with
noise depth, keeping the sampled texture he likes). Note that voxelizing does NOT
answer complaint 2 on its own.

### What to do with the sprite work, meanwhile

It is OPT-IN and the default is untouched, so it is harmless to leave in place, and
the CUTTER, the turntable pipeline and the manifest are the reusable half if the
voxel route is taken. Options for the owner: leave it opt-in as a reference, or
strip it. `public/assets/lab/gore-chunky/` is a dead review artifact (830 KB) —
delete it either way.

## What was built (blast wiring) — for reference

**`?gibrender=sprite` spawns a blast as billboards.** It is OPT-IN and the default
is unchanged (`march`), deliberately: nobody has looked at a sprite blast in the
room yet, so the shipped look must not move before the owner says so.

### What was built

1. **A render mode BESIDE the piece mode.** `gibRenderMode` (`?gibrender=sprite`)
   is orthogonal to `gibMode` (`?gib=`): the piece set still comes from
   `pieces|clusters|parts`, and the render mode only chooses what each chunk looks
   like. Switchable at runtime — `__sdfGame.setGibRenderMode('sprite'|'march')` —
   because a paired measurement has to alternate inside ONE boot.
2. **A sprite piece IS a `Chunk` plus a quad.** `webgpu/gib-sprite-pieces.ts` owns
   the list, the pose and the lifetime; `stepSpritePieces` calls **the same
   `stepChunk`** with **the same `chunkCollidersAt`**, so gravity, the floor, the
   walls/ceilings, the friction skid and the settle rule cannot disagree between
   the two render modes. No new physics was written.
3. **In-plane roll** from the piece's own `longAxis` + `quat`, projected into the
   camera's screen plane; degenerate (axis at the camera) falls back to `angVel`.
4. **The pool and the tier ladder are GONE in this mode.** A quad has no proxy box
   and no bake, so `gibBudget()`/`gibAllowance()`/`gibDebit()` hand sprite mode its
   own live cap and the ladder's condition never becomes true. A settled sprite is
   PARKED (no stepping, still billboarded) rather than retired through the bake
   worker — the marched path's bake exists to bound marching cost, and a quad has
   none. **This is what retires the owner's "tubes and orbs" report**: that shape
   only ever appeared because the marched pool could not afford a body's full set.
5. **`chunkStates()` reports BOTH modes** (with a `render` tag), and
   `setChunksVisible()` hides both. That keeps every existing rig mode-agnostic —
   which is how the wall/ceiling rig below verified sprites without being changed.

### MEASURED (all at this HEAD)

| what | result |
| --- | --- |
| blast in sprite mode | **19 billboards, 0 marched pieces, tier `sprite`, 0 dropped** |
| physics is real | all 19 fall 2.86 → 0.49 m, all 19 PARK, **0 below the floor** |
| is it drawn | hiding every sprite = **2.93%** of the presented frame (rises to **5.85%** with the square re-cut, i.e. the pieces really did get chunkier) |
| blood trails | **38 → 600 droplets** while 67 pieces were in flight, after the `emitTrails` feed was fixed |
| piece shape | **0 of 154** pieces square-ish before, **177 of 177** after (median aspect 0.36 → 0.97) |
| cap holds | 6 blasts → **128 live + 19 parked = 147 meshes** (= the cap exactly) |
| asset sharing | **1 geometry**, 129 materials (≤ the sheet's 154 frames) |
| walls/ceilings | **8040 piece-frames, 67 pieces, every one inside a room or tunnel** |
| live-loop soak | **8 detonations, 9 gibs, 211 pieces, 0 stuck tears, 0 queued gibs**; peak **128 live = exactly the cap**, 154 meshes, geometry/material held at **1/107** |
| dynamite gate | **PASS** in both arms (default and `GATE_QS='&gibrender=sprite'`) |
| opt-in | default boot: **19 marched pieces, 0 sprites**, atlas never even loaded |
| cost | marched moved `sdf:march` **+2.90 ms** (51 pieces, 29 on screen); sprite arm moved **no row** beyond ±1.4 ms noise |

Rig: `node scripts/sdf-gib-sprites-rig.mjs 5391 9391` (and `SPRITE_RIG_ARM=march`
for the opt-in arm). Full suite: **4846 pass / 1 fail** (the same pre-existing
`surface-nets.wgsl.test.ts`), `npx tsc --noEmit` clean.

The soak, the wall rig, the gate and the cost rig all now take a QUERY STRING for
the arm — `SOAK_QS='&gibrender=sprite'`, `GIB_WALLS_QS='&gibrender=sprite'`,
`GATE_QS='&gibrender=sprite'`, and the cost rig's 3rd argument — and the soak's
marched-only assertions (the bone census, the view pool) are swapped for the
sprite mode's own bound (live cap, meshes accounted for, shared assets) instead of
failing on a census that is empty by construction.

### What is still NOT done

- **View-angle sets for the head** (item 4 of the original plan) is a CUTTER job,
  not a runtime one, and it cannot be done against the shipped sheet: the 154
  pieces DO carry `yawDeg` (17-23 pieces per yaw, all 8 yaws present) but they are
  INDEPENDENT random cuts, not 8 views of the same part — there is nothing to
  select between. Build it by projecting a 3D anchor into all 8 yaws and cutting
  around the projection; do NOT cut the same screen rect across yaws, because the
  anatomy differs per frame and the piece would morph as it spins.
- **Streaks + wound levels** (owner's "more blood and dirt streaks"): 2-3 wound
  levels merged into the sheet, plus streaks at the cut. No shader work.
- **Unlit is still unlit** (accepted for now).

### What to measure, and how

- **Does the blast make sprites at all**: `node scripts/sdf-gib-sprites-rig.mjs 5391 9391`
  (`SPRITE_RIG_ARM=march` for the opt-in arm). It asserts sprites AND zero marched
  pieces, that the pieces fall/settle/park (none below the floor), that hiding them
  changes the PRESENTED frame, and that the caps bind. This is the rig to run first
  — a mode that silently spawned both kinds would pass every marched assertion.
- **Cost**: `node scripts/sdf-piece-cost.mjs 5391 9391 [qs]` alternates pieces
  shown/hidden on the LIVE loop. Two instruments, and read them in this order:
  * **GPU rows** — now the primary one. It samples EVERY label and reports the rows
    that MOVE, because there is no pass label dedicated to the mesh layer a sprite
    renders in. Marched pieces are billed to `sdf:march` (**+2.90 ms** at 51 pieces,
    29 on screen); the sprite arm moved nothing beyond ±1.4 ms of noise.
  * **Cadence is useless for this on a vsync-capped page** — both arms pin at
    16.70 ms, so "no cadence difference" means "absorbed by the budget", not "free".
  Report paired medians in ONE boot — single-run comparisons on this machine are
  worthless (the same claim has read +7.6 ms and −1.4 ms).
- **Is it drawn**: hide it and read the RENDERER (`frameHash` or the presented-frame
  differential), never a per-pixel threshold alone.
- **Blast end-to-end**: `node scripts/sdf-game-dynamite-gate.mjs 5391 9391` must
  keep passing, in BOTH arms (`GATE_QS='&gibrender=sprite'`).
- **The live loop**, not `step()`: `node scripts/sdf-dynamite-soak.mjs 5391 9391`
  throws real bundles on the game's own rAF loop.
- **Walls/ceilings for free**: `GIB_WALLS_QS='&gibrender=sprite' node
  scripts/sdf-gib-wall-bounce.mjs 5391 9391` — it reads `chunkStates()`, which now
  reports both modes, so the wall guarantee is verified in either one.

## TRAPS — measured this session, do not re-derive

- **`OUT_ARG` does not reach the turntable through `scripts/blob-shot.sh`.** Call it
  directly for an A/B: `BLOB_CHARACTER=zombie BLOB_MASK=1 node scripts/blob-turntable.mjs 5391 /tmp/out 8 9391`.
- **`pauseLoop(true)` freezes the RENDER.** Every later `setCam` then captures the
  same stale frame — measured: frames 00 and 01 byte-identical (54925 bytes) and the
  body-hidden difference found 0 px, which reads as "the mask broke" rather than
  "the capture froze".
- **PNG row 0 is the TOP; three's texture origin is the BOTTOM-left.** A sheet rect's
  `y` must be flipped (`1 - (y + h) / H`) or every piece samples the mirrored region
  — plausible enough on symmetric gore to survive review.
- **Do not key the lab's background.** It is a fogged AND dithered gradient
  (26,17,22 at the top, 35,24,22 at the bottom). Three keys were measured and failed
  (see README's table); `BLOB_MASK=1` diffs a body-hidden capture instead and is
  exact.
- **A wgslFn source string may contain ONE function**, and one wgslFn cannot CALL
  another by name (separate modules). Both cost real time in the per-pixel detail
  layer; the fix is to inline with defaulted-off parameters.
- **A background Chrome tab throttles rAF.** Wall-clock waits then measure a FROZEN
  page (the light sat at `age 0`, every capture was stale). Drive frames with
  `step()`, and print a quantity that proves the page advanced.
- **Rigs must set `Network.setCacheDisabled`** — a falsification run once reported
  the NEW value and passed because Chrome served a cached module graph.
- **`presentedShot()` returns the last PRESENTED frame** — draw after any change.
- **`pos += delta` with `prev` untouched is a kick of `delta/dt`**, not a
  displacement (a Verlet point's velocity IS `pos - prev`). That is one of the two
  bugs behind the owner's "bodies teleport then rubber-band" reports; the other was
  handing a VELOCITY to a signal whose metre-valued amplitudes need a UNIT
  direction. Both are fixed, both are pinned by tests — read `blastKnockMps`'s
  neighbourhood in `game-actor.ts` before touching a blast reaction.
- **`impulseAt` takes METRES** and `bindRig` PINS the lowest joint, so a joint-level
  shove tears the body in half. Body-level reactions go through the ROOT
  (`knockV`).

### Traps found wiring the blast (2026-09-11, second pass)

- **`emitTrails` TOOK ONLY `liveChunks`.** Sprite pieces have no marched view, so
  in `?gibrender=sprite` a blast threw gore that trailed NOTHING — the owner,
  playing it: *"there are no blood trails — the blood trails should be in there as
  before."* Every other emitter in the frame (wound droplets, the impact gout) was
  fine, which is why it read as an art problem rather than a missing feed. Both
  lists now feed it. **The two id spaces are OFFSET** (`SPRITE_TRAIL_ID_BASE`):
  `emitTrails` keys its per-emitter clock by id and chunk ids and sprite ids are
  independent sequences that both start at 1, so merged raw the two would steal
  each other's emission phase. Pinned by `sdf-gib-sprites-rig.mjs` (droplets must
  GROW while pieces fly: measured **38 → 600**).
- **THE PIECES WERE ELONGATED BY THE CUTTER, NOT BY THE GORE.** The owner: *"they
  are all somewhat elongated ovoid shaped, they whould be more chunky like
  squareish"*. Correct, and measurable: **all 154 shipped pieces were tall, median
  aspect (w/h) 0.36, and NOT ONE square-ish.** Cause: a fixed `COLS=4, ROWS=4`
  grid over a STANDING BODY's bounding rect (~186x392), so every cell inherited
  the body's 0.47 aspect. Fixed by searching (cols, rows) per frame for the
  squarest cells near `CELLS` cells: **177 pieces, median aspect 0.97, all
  square-ish**. Note the search must be 2D — deriving `rows = round(CELLS/cols)`
  visits one hyperbola and cannot reach the square pair (measured: it left the
  median at 1.39, unchanged).
- **A polygon mask only shows where it is INSIDE the body.** The alpha is
  `body AND polygon`, so the rim is the polygon's facets only where the polygon
  falls inside the flesh, and the BODY's own smooth outline everywhere else — and
  cells are mostly interior (coverage median 0.70). So `--sides N` alone does not
  guarantee a faceted read; `--polyscale` (default 1.0, try 0.7) pulls the cut
  inward to make the facets the silhouette.
- **A rig that calls `step()` has STOPPED the render loop.** `__sdfGame.step()`
  documents "stops the rAF loop first". A cost block that aimed the camera with
  `step(1)` and did not call `.setLoopRunning(true)` afterwards measured a page
  drawing NOTHING: every cadence delta read exactly **0.00 ms** and every GPU row
  vanished. That reads as "the pieces are free" and it is a stopped renderer. If a
  rig measures cadence, it must restart the loop and prove a frame advanced.
- **`passTimings().collect()` DRAINS.** Three calls in a row returned **1658, then
  263, then 279** samples — the first swallowed the whole session. So a naive
  "shown arm then hidden arm" comparison puts the entire history in the first arm
  and pairs nothing. Flush before EACH arm and alternate rounds.
- **There is no pass label for the mesh layer a sprite renders in.** `mesh-front`
  is a CAMERA POSE name in `deferred-main.ts`, not a timer label (guessed first,
  then checked). The marched pieces have their own row (`sdf:march-chunks`) but
  sprites have none — so sample EVERY label and report the ones that move rather
  than hard-coding the row you hope will move.
- **`chunkStates()` tags marched rows `render: 'march'`, not `'marched'`.** A rig
  filter that guesses wrong silently aims at an empty list and reports "0 on
  screen", which looks like the pieces are off-camera rather than like a typo.
- **A sprite geometry cache keyed by SIZE is a leak wearing a cache's clothes.**
  Every piece's radius is its own `chunkExtent`, so a size key misses almost every
  time: MEASURED, six blasts left **232 geometries for 147 live pieces**. The fix
  is one shared UNIT plane plus a per-mesh `scale` — bounded at 1, forever.
- **`gunReady` does NOT mean the sheet is loaded.** It fires when the VIEW-MODEL
  lands; the 756 KB sheet is a separate async fetch. A rig that reads
  `gibRenderMode().ready` once at that moment is in a race — `sdf-gib-sprites-rig`
  passed repeatedly and then read `ready:false, frames:0` on a fresh page, which
  looks exactly like a broken asset. Wait for it (bounded) and print the console's
  `[gib-sprites]` lines if it never arrives, so "slow" and "404" stay separable.
- **three r185 `Texture.copy` SHARES the `Source`**, so per-piece
  `texture.dispose()` would blank every sibling clone. The atlas owns texture
  lifetime; pieces share one material per frame and dispose nothing.

## Seams worth knowing

`__sdfGame.gibSpriteBench(which)` / `.gibSpriteBenchVisible(on)` ·
`.chunkStates()` (every live piece in EITHER render mode: limb, pos, vel, radius,
settled, `render: 'march'|'sprite'`, and `rest` for a parked sprite) ·
`.spritePieceStates()` · `.spriteCensus()` · `.clearSpritePieces()` ·
`.setGibRenderMode('march'|'sprite')` (live, no reload) / `.gibRenderMode()` ·
`.setSpritePiecesVisible(on)` — sprite-only differential ·
`.setChunksVisible(on)` hides BOTH modes, so old rigs stay mode-agnostic ·
`.setPose(x, z, yaw, pitch, y)` / `.screenPosOf(x,y,z)` — aim at a pile and PROVE
it is on screen · `.enclosureBoxAt(x,z)` · `.chunkCensus()` ·
`.goreDetail({detail,bump,blood})` ·
`.setDynamiteTuning({...})` / `.dynamiteTuning()` ·
`__sdfLab.wound(n, seed, type)` / `.woundCount()` — deterministic, aim-free
wounding that REPORTS what it stamped · `.setCam(yaw, pitch, dist, targetY)` ·
`.pauseLoop(on)` · `.meltDirect(t)`.

## Regenerating the sheet

```
# 8 yaw frames + an exact body mask per frame (2 captures per angle)
BLOB_CHARACTER=zombie BLOB_MASK=1 BLOB_DIST=2.2 node scripts/blob-turntable.mjs 5391 /tmp/gib-clean 8 9391
# ...and a wounded set (10 wounds, seeded); clean vs wounded measured 25.38% of the
# body's own pixels changing, so the gore is genuinely in the pixels
BLOB_CHARACTER=zombie BLOB_MASK=1 BLOB_DIST=2.2 BLOB_WOUNDS=10 BLOB_WOUND_SEED=3 \
  node scripts/blob-turntable.mjs 5391 /tmp/gib-wounded 8 9391
# cut + pack both into one committed sheet
node scripts/gib-sheet.mjs /tmp/gib-clean public/assets/lab/gore --also /tmp/gib-wounded
```

## Open decisions for the owner

1. **Does the sprite path replace the SDF pieces, or sit beside them?** STILL OPEN,
   and deliberately left open by the wiring: it shipped as **coexist, opt-in**
   (`?gibrender=sprite`, default `march`), so the shipped look is untouched until
   the owner has LOOKED at a sprite blast in the room. Flipping the default is a
   one-line change in `gibRenderMode`'s initialiser once he says so; the panel has
   no row for it yet (the live seam `.setGibRenderMode()` is the way in).
2. **Unlit sprites are accepted for now** (owner: *"that's fine to be unlit atm"*).
   Tinting by a light sample at the piece position is the upgrade if the dark room
   ever makes them read pasted-on.
3. **Multi-level wound capture + a dirt/streak pass at the cutter** — the owner asked
   for "more blood and dirt streaks"; the cheapest form is 2-3 wound levels merged
   into the sheet (one turntable run each: `BLOB_WOUND_TYPE` selects pellet/burn/blast)
   plus streaks applied at the cut, which needs no shader work.
4. **NEW: the sheet has no coherent VIEW-ANGLE SETS**, so the head still cannot
   turn. Each of the 8 yaws is present (17-23 independent random cuts each) but
   nothing links a piece in yaw 0 to the same part in yaw 45. Doing this properly
   means a new cutter mode (anchor-projected sets) and a regenerated sheet — see
   "What is still NOT done".

## Other open threads from this session (not this note's subject)

- **The ragdoll**: `docs/dev-notes/2026-09-11-efficient-ragdoll-for-sdf-mesh-bodies/README.md`.
  The mechanism exists (the Verlet rig, `collapse.ts`'s limp ramp, the soldier
  corpse bake); the gaps are that zombies never bake, a settled corpse never sleeps,
  and the blast injects no momentum. Step 0 is a `__sdfGame.collapse(id)` seam, which
  the sleep and the bake both need in order to be testable.
- **The blast's light**: `fxspread` (reach) and `fxlight` (brightness) are both panel
  sliders; reach measured +107% on the gather's own radiance, brightness +8.89
  whole-frame mean at 1x and +15.19 at 2x.
