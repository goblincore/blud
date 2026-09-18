# Blood spray: shared curl advection + soft-particle fade (spike, 2026-09-18)

This spike asks whether the two wildfire techniques that worked for the
explosion — a shared divergence-free curl volume, and a soft-particle depth
fade — fix the two reasons earlier blood-spray attempts were abandoned. It
builds the CPU curl sampler, threads an OPTIONAL curl flow through `stepBlood`,
puts the soft fade on blood's translucent elements, and adds a tunable Flow
section to the blood lab so the owner can judge it by hand.

**Nothing in the game changes.** `game-main.ts` is untouched and every new
switch defaults to the shipped look: no flow is passed to the game's
`stepBlood`, and both `curlStrength`/`softFade` are 0-equivalent (curl off,
fade 0) on every shared helper.

## What was built

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/curl-sample.ts` (new) | The pure, **three-free** trilinear CPU sampler over the packed volume. Owns `CURL_VOLUME_SIZE` / `CURL_SCALE` / `CURL_ALPHA_CHANNEL` and the one `sampleCurlVolume`; `curl-volume.ts` now imports and re-exports them, so there is exactly ONE trilinear implementation (no second copy). |
| `src/lab/sdf-zombie/blood-sim.ts` | `stepBlood(sim, dt, rng, flow?)` — an optional `CurlFlow` (`data, strength, scale, drift, time`). A non-zero strength adds `curl(pos/scale + time*drift) * strength` as an acceleration to every **airborne** droplet (drop, mist, scrap); `gut` is chain-owned and skipped. Absent or strength 0 skips the block entirely. |
| `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts` | `setSoftFade(metres)` on the mist. At 0 the shipped opaque cutout material is kept bit-for-bit; above 0 a transparent `MeshBasicNodeMaterial` (alpha in `colorNode.w`) multiplies coverage by `soft-fade.ts`. |
| `src/lab/sdf-zombie/webgpu/impact-splash.ts` (+ `impact-splash-sprites.ts`) | `setSoftFade(metres)` on the splash layer: the sprite **cards**, the membranes and the mist all multiply `opacityNode` by the shared fade. 0 is inert. |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.ts` | A `FLOW` panel section (curl on/off, strength, scale, drift, soft fade), `flow` in `__bloodCompare.state()`, `__bloodCompare.setFlow({...})`, and a new **`wipe axis = flow`** that straddles baseline (left) \| flow (right) on the SAME frame and the SAME filter variant. A second literal `flowSim` is simulated from the same seed/scenario/event time with only the curl differing. |
| `scripts/blood-curl-capture.mjs` (new) | Headless capture + gates; the flame/explosion pipeline-error guard is included. |

### How to use the lab

`/sdf-blood-compare.html` → shape **Current slug** → the **FLOW** section:
curl on, then tune strength / scale / drift / soft fade. For the A/B: check
`wipe A/B`, set `wipe axis = flow`, and drag `wipe pos`. The right side is the
flow look, the left is the shipped baseline, both at the same event time. Set
`strength 0` to isolate the fade, `soft fade 0` to isolate the curl.
`__bloodCompare.setFlow({curlOn:true,strength:3.5,scale:2,drift:0.8,softFade:0.35})`
drives the same thing from a capture.

### How to reproduce the captures

```
npm run blood:capture                 # -> docs/dev-notes/2026-09-18-blood-curl-spike/
LAB_VITE_PORT=5236 LAB_CDP_PORT=9226 node scripts/blood-curl-capture.mjs
```

It boots headless Chrome + vite, hides the page chrome, drives the page
entirely through `__bloodCompare` (the rAF loop is off), and fails on any
`THREE.WebGPURenderer` pipeline/shader error, a page exception, a flat frame, a
non-reproducing baseline, or a curl/fade run that changed nothing.

## Values that looked best

From the strength×scale sweep on the dense `crossing` fixture (`sheet-sweep.png`):

| | scale 1 | scale 2 | scale 4 |
| --- | --- | --- | --- |
| **strength 2** | coherent curtain | coherent curtain | slightly dispersed |
| **strength 4** | dense curtain, strong shear | **best read** — curtain + mid-band | droplets flung outward |
| **strength 6** | thick but turbulent | scattering | chaotic scatter |

**Best: strength ≈ 3.5 m/s², scale ≈ 2 m/cell, drift ≈ 0.8 /s, soft fade ≈ 0.35 m**
(the values the captures use, and the panel's new starting values). `strength >
5` tears a dense spray apart instead of flowing it; `scale > 3` flings droplets
along the cell instead of turning them.

## What the frames actually show

Look at the images; the numbers are the gates, not the verdict.

**Curl — the "reads as separate particles, not fluid" failure mode.**

- `sheet.png` (wound spurt, launch/mid/landing): the flow column differs by
  0.17 % / 1.37 % / 1.29 % of pixels. The mid spray's blobs are re-ordered and
  the landing arc bends differently — but **both columns still read as clusters
  of discrete oval blobs.** The "oval blood cells" shape is unchanged; only
  where the ovals are has moved.
- `sheet-scenarios.png` (dense fixtures): the gib-like `burst` pulse changes
  1.79 % and gets a torn, lobed silhouette instead of a round ball — a mild
  improvement. The two opposed `crossing` streams change **8.94 %** and gain a
  genuine coherent shear: droplets on one side of the volume move together, a
  curtain-like mid-band forms, and the whole spray visibly flows. **This is the
  divergence-free field doing what it should** — the spray moves as a body.
- But even at the best sweep cell, the curtain is made of **separate blobs**.
  Curl is divergence-free: it can rotate and shear the droplet cloud, but it
  cannot compress droplets together, and the metaball goo only fuses neighbours
  whose density peaks overlap. So curl adds *flow*, not *cohesion*.

**Soft fade — the "hard edges" failure mode.**

- `sheet-fade.png` (wound spurt, front camera, fade 0 vs 0.6 m, curl off): the
  fade is real but tiny — 0.116 % / 0.100 % of pixels. `fade-late-off.png` vs
  `fade-late-on.png` show the faint mist specks around the wound dimming and
  softening; the solid red blobs (the goo surface) and the floor decals are
  untouched. **The mechanism is proven wired** (a 0-change run fails the
  capture), but the blood that actually meets the body/floor in this
  composition is *opaque* goo and decals, which this technique does not fade.
- The splash cards at the crown change only **0.006 %** — the cards float clear
  of every surface, so there is no screen-space intersection to grade. That is
  a property of this fixture, not of the technique: the fade only acts where a
  translucent quad actually crosses geometry in depth.

## Honest verdict

- **Curl is worth taking further, but it is not the whole fix.** It is cheap
  (one 1 MB texture already shared with the flame cards and explosions, plus an
  optional arg on `stepBlood`), it is deterministic, and on a dense spray it
  demonstrably produces coherent, divergence-free motion that a per-particle
  random drift cannot. It does **not** by itself solve "big oval blood cells /
  reads as separate particles" — because cohesion is a *density* problem
  (metaball packing), not a *motion* problem. The next step toward gooey blood
  is pairing curl advection with more droplet overlap (tighter emission, bigger
  goo radius, or the teardown's capsule field / low-res march), not a bigger
  `strength` — the sweep shows strength > 5 makes cohesion worse.
- **The soft fade on blood's current translucent elements barely matters.**
  It is correct, guarded, and free when off, but at plausible distances it moves
  ~0.1 % of pixels because the visible blood mass (goo surface, floor decals) is
  opaque and the faded mist layer is faint. It is worth keeping on the shelf for
  a future card/mist-heavy look (and it is already wired into the splash layer
  for whenever those cards carry more of the silhouette), but as a standalone
  change for blood spray today it is not a fix. The hard-edge failure was a
  card/mist artifact, and the lab's game configuration hides the bead/ribbon
  cards, so there is little hard edge left for the fade to remove.

**Suggested follow-up (NOT done here — the game is untouched by design):** land
curl as an opt-in, default-off tuning entry on the game's `stepBlood` call
(one line, `EXPLOSION_VFX_TUNING`'s shape), then iterate on metaball density /
droplet packing to get the connection. Leave the fade at 0 until a look needs
it.

## Caveats

- The capture is a manual rig (`scripts/blood-curl-capture.mjs`), not wired
  into CI or `npm test`. Visual acceptance remains a human judgement on a GPU.
- The curl's CPU volume builds once on first use (~0.7 s) — the lab hitches the
  first time curl is switched on; a game integration would want it boot-built
  with the other shared volume.
- The shutter axis deliberately stays on the shipped baseline sim; the flow
  experiment lives on the surface/shape axis.
- No performance measurement was taken; the curl adds one `sampleCurlVolume`
  per airborne droplet per step (a handful of lerps).
