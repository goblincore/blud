# Teardown: the "wildfire" browser game's fire (2026-09-18)

Owner played <https://genex.games/wildfire> and wanted its fire understood. This
note records **how it works**, from reading the shipped minified bundles in
`~/Downloads/wildfire/` (`demo-post-Bsbd56cJ.js` 181 KB, `field-pFIyBOjr.js`
944 KB, `main-C0G2_Ims.js` 9.3 MB, two `.wasm`, two 1024² PNGs).

**Boundary:** this is a technique teardown, not a source. Everything below is a
published, widely-used technique (soft particles, curl-noise advection volumes,
low-resolution volumetrics with temporal reprojection). We implement our own;
their code does not enter this repo.

**Lucky break:** they are on the same stack we are — three.js **TSL node
materials** on WebGPU (`viewportLinearDepth`, `viewportDepthTexture`, compute
nodes). So their architecture is directly translatable rather than merely
inspirational.

## The architecture

Four named systems appear in the bundle: `FireCurlVolume`,
`FireCapsuleFieldSample`, `FireVolumetricMarch`, `FireVolumetricResolve`.

### 1. Fire is a FIELD DEFINED BY CAPSULES

`FireCapsuleFieldSample` returns a struct per sample point:

```
shaped, temperature, soot, reach, rise, fine, crown
```

So a fire source is a capsule carrying flame parameters, and the field is the
accumulation of them — `surfaceFire` and `plume` are separate contributions,
gated independently. Sampling is bucketed into bins (`binSlots`, 64-wide
stepping) so a sample only touches nearby capsules.

**Why this matters to us:** our characters are *already* capsule prims. A fire
field whose sources are a burning body's own capsules is a natural fit, and it
gives per-limb control (a burning arm reaching, a crown of flame over the head)
that our card slots approximate by hand.

### 2. Motion comes from a 64³ CURL-NOISE VOLUME

`FireCurlVolume` is built once at boot on the CPU:

- Generate **four** scalar noise fields on a 64³ periodic lattice (their `Ro`,
  seeded, with a multi-octave `Lo` accumulation over a `Po` period/amplitude
  table).
- Take the **curl** of three of them by finite differences with wraparound
  (`(l+1)&s` etc., `s = 63`), giving a divergence-free vector field — which is
  what makes fire swirl instead of drift.
- Normalise by the max component, pack to **RGBA8**: `rgb` = curl vector
  remapped to 0..1, `a` = the fourth noise scalar (a free density/mask channel).
- Upload as a 3D texture, tri-linear, `RepeatWrapping` on all three axes, no
  mipmaps.

Sampling helpers: decode is `rgb * 2 - 1`; the main accessor divides position by
a scale of **6** before sampling; the alpha channel is read separately. There are
also 2D rotation/shear helpers with hardcoded constants (angles ≈ 0.41 and 0.34
rad, scales ≈ 5.7, amplitude pairs like `[1.15, 1.13]`, `[0.87, 2.41]`) — the
classic trick of summing a few rotated, differently-scaled copies of one noise so
no direction reads as axis-aligned.

**This is the single most portable idea here.** One small 3D texture, generated
once, gives flame motion that no amount of per-pixel fbm matches, because curl
noise is divergence-free and therefore *looks like flow*.

### 3. Rendering is a LOW-RES VOLUMETRIC MARCH + TEMPORAL REPROJECTION

- Two fullscreen quads: `FireVolumetricMarch` then `FireVolumetricResolve`.
- **`steps` defaults to 256** (an int uniform; setting it to 0 is how "disabled"
  is implemented, so no pipeline changes when toggling).
- **`resolutionScale` is clamped to [0.25, 1]** — the march runs at a fraction of
  the drawing buffer and the resolve upscales.
- **Ping-pong banks plus `_previousViewProjection`**: the march accumulates
  across frames, reprojecting the previous result through the last frame's
  view-projection. There is an explicit **neighbourhood min/max clamp** on the
  history sample (clamp to the local colour bounds, reject when the distance
  exceeds a threshold) — standard TAA history rejection, which is what keeps a
  256-step march from smearing when the camera moves.
- A `flushFrames` counter forces fresh frames after invalidation.
- LOD by distance: `fineNear / coarseNear / massNear` and their `Far` partners
  select cheaper sampling with range.

### 4. Intersections are hidden by a SOFT-PARTICLE DEPTH FADE

`softParticleFade()` fades a fragment as it approaches the scene depth behind it,
fed by `setFireSceneDepth(fireSceneDepthFromLinear01(viewportLinearDepth))`.

The bundle carries a long, angry error message about this: passing
`linearDepth()`/`depth()` *without an argument* yields the current fragment's own
depth, so the fade computes `saturate((d - d) / fade) = 0` and **the entire fire
renders as `vec4(0,0,0,0)` with no error and no warning**. They shipped a runtime
guard that detects it, logs, and substitutes the correct node.

That is worth reading twice, because it is exactly the class of bug that cost us
an hour on the screen-space pass: an effect that silently renders nothing.

## What to take, and what it changes

| Their idea | Our use | Cost |
| --- | --- | --- |
| Soft-particle depth fade | Fixes the hard card seams at close range, directly. Already Task 1 Step 5 of the polish plan — now confirmed as the standard fix, so raise its priority. | Small: bind scene depth in the card material. |
| 64³ curl-noise volume | Drives flame motion for cards AND for any volumetric. Replaces per-pixel fbm as the motion source. | One 1 MB RGBA8 3D texture, built once at boot. |
| Capsule-defined fire field | Our bodies are capsules already. Gives per-limb reach/rise/crown instead of hand-authored card slots. | Medium: a field sampler over the body's prims. |
| Low-res march + reprojection | **Changes the decision to skip volumetric.** We priced volumetric as full-res marching inside the SDF march; at 0.25–0.5 scale in its own pass with temporal reuse, it is a different cost class. | Medium-large, but bounded and measurable. |

**Honest caveat on the look.** Their fire is a landscape wildfire seen at
distance through heavy smoke and bloom, with a soft, painterly, low-contrast
palette. Blood's burning enemies are crisp, high-contrast, and read at a glance.
Their *techniques* transfer; their *look* is not the target, and a volumetric
plume around a human body will not automatically look like the reference sprites.
The cards already beat everything else we have tried on look.

## Suggested order

1. **Soft-particle fade on the cards** — smallest change, fixes a known defect.
2. **Curl volume driving card motion** — cheap, and the most likely single jump
   in how alive the flame looks.
3. **Reconsider volumetric** as its own low-res pass with reprojection, sampling
   a capsule field from the burning body, only if 1 and 2 leave the close-range
   look short of the reference.

## Files read

`~/Downloads/wildfire/demo-post-Bsbd56cJ.js` (all four systems live here),
`field-pFIyBOjr.js` (GLSL + WGSL, terrain/vegetation field), `main-C0G2_Ims.js`
(engine bundle). The `.wasm` pair and the 1024² PNGs were not needed for this.

## Where else these apply in Blud

Owner asked (2026-09-18) how this transfers to gibbing and blood. Three of the
four ideas are not fire-specific at all.

### Blood spray — the strongest case

Two spray attempts were abandoned as visually insufficient: scaled sprite
droplets read as "big oval blood cells", and thin ribbon/trail geometry was "too
thin, hard edges, not gooey". Both failures are addressed here:

- **Hard edges** are what the soft-particle depth fade exists to kill. Any spray
  card that intersects a body, a wall or the floor currently ends on a straight
  cut; the fade turns that into a gradient. This alone may be the difference
  between "sprite" and "wet".
- **"Not gooey" / "reads as particles"** is the same complaint as flame reading
  as N independent quads, and the answer is the same: drive the droplets and the
  mist with ONE shared curl field so a spray moves as a connected volume of
  fluid. Blood is a better fit for curl than fire is — a divergence-free field is
  literally an incompressible-flow model.
- The existing **goo/metaball layer** already solves cohesion in screen space.
  Curl-driven motion feeding the goo layer's density is a cheaper path to
  volume than a full volumetric pass, and it stacks with what is already built.

### Gibbing

- **Soft fade** on the blood mist and the gut/entrail cards around a gib burst,
  for the same intersection reason.
- **Curl volume** for the airborne mist after a blast: gibs already have
  ballistic motion, and the mist between them is what currently reads thin.
- The **capsule field** idea maps onto severed limbs directly — a gib is a
  capsule, so a "wet field" around it could drive dripping and pooling without
  per-piece authoring.

### Explosions

`explosion-vfx.ts` currently shapes its fire with `mx_fractal_noise_float` per
pixel. Swapping the motion source to the curl volume is a small change with a
likely large payoff, and it would share one texture with the flame cards.

### Dynamite smoke and the VHS pass

The low-res + temporal-reprojection structure is reusable for any volumetric we
add later (smoke, dust, fog) — it is the generic way to afford volumetrics, not
a fire trick. Note we already own a shutter-blur temporal pass, so the
history/reprojection plumbing is not unfamiliar ground.

### Order of attack, if pursued

The flame polish plan takes soft fade + curl volume first. If they land well
there, the same two modules drop straight into blood spray with no new
research — that is the sequencing argument for doing fire first.
