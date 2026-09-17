# Burning enemies — flame look and flame lab (design)

Date: 2026-09-17 · Status: approved by owner · Scope: look only, no weapon

## Goal

Make a burning zombie and a burning soldier look like Blood's burning dudes, in the
active SDF FPS, and build the lab page that lets the owner tune that look.

The target look is **engulfed**: the whole body becomes fire the moment it catches,
with dark char showing through in patches and ragged tongues rising off the
silhouette. NotBlood gets this by baking fire into the enemy's own sprite frames
(burning run tiles 3321–3350, burn death 2938–2946) and adding three FIRE01
flame-lick sprites (tiles 3532–3539) every 5 tics. We cannot bake body frames, so
the fire has to be rendered onto the SDF body — this spec decides how.

The quality the owner cares about is **flame-likeness**: crisp, flickering,
upward-reaching tongues. Glowing particle blobs are explicitly not the target.

**Priority order: looks first, performance second.** Cost is measured after a look
is chosen, not used to pre-emptively rule a technique out.

## Non-goals (second spec, after the look is chosen)

The flare gun, its placeholder first-person weapon, the flare projectile and
sticking, burn damage, the burning panic/flail behaviour, burn death and the pile
of flame it leaves behind. The lab fakes ignition with a key press.

Also out: burning the player, burning props or world geometry, fire spreading
between enemies.

## Approach summary

Build one shared base (fire and char on the body surface, fire light, post
effects) plus **three interchangeable techniques for the tongues**, all switchable
live on the same body and pose:

1. **Screen-space tongues** — a full-screen pass that grows flames upward out of a
   burning-body mask.
2. **Flame cards** — additive camera-facing quads on the body, playing a flame
   flipbook.
3. **Volumetric band** — the SDF march accumulates emissive fire in a shell just
   outside the body surface.

All three are built. The owner picks by looking at them side by side.

## 1. Host: a new lab page

New page `sdf-flame-lab.html` → `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`,
assembled from the blocks `lab-main.ts` (`sdf-lab-webgpu.html`) already uses:

- `createLabRenderer`, `createSdfLayer(SDF_LAYER / CONE_LAYER / OCCLUDER_LAYER)`
  (`lab-main.ts:30-31`) — the same march shader the game runs.
- `createPostAa` (`lab-main.ts:238`) — the same post chain as the game.
- `createCharacterView` (`lab-main.ts:257`) — real bodies for any registry name.
- Hand-driven `stepMotion` with walk/run speed bands and a treadmill
  (`lab-main.ts:950-962, 2930`), so bodies animate with no AI and no damage
  system to disable.
- The existing fatal-shot collapse (`lab-main.ts:1509`) for a burning body that
  falls over.

Register the page in `vite.config.ts` (as `sdf-blood-compare.html` is at
`vite.config.ts:161`) so it survives a build.

Two things `lab-main.ts` lacks are copied in from the game:

- Shutter blur: `createShutterGameLayer` installed via `postAa.setCaptureStage`
  (copy the closure at `game-main.ts:7762-7786`).
- Flickering point lights (copy `game-main.ts:657` and `:1693-1710`).

Layout: a zombie and a soldier side by side, both ignitable, plus a pinned strip of
the Blood burning-run reference frames for comparison. Those frames (tiles
3321–3350) are already tracked in `public/assets/blood-tiles/`, so the strip needs
no asset work; the page still renders if they are missing.

**Validation host.** Once a look is chosen, the same tuning is checked on the real
game page with the seams it already has: `?frozen` (`game-main.ts:8475`),
`?simidle` (`:8494`), `?room=`, `?seed=`, `__sdfGame.spawnDebugCharacter`
(`:14648`), `spawnCrowd` (`:14665`). Real lighting, probes and rooms; no new game
code beyond the burn plumbing.

## 2. Burn state plumbing

**Per body.** `crowd-records.ts` record slot 15 is entirely unused
(`REC_VEC4S = 16`, slots 0–14 used, `crowd-records.ts:8-30`). Add
`REC_BURN = 15 = (burn, burnSec, char, spare)`:

- `burn` 0→1: how alight the body is. Ramps up over `igniteSec`, decays to 0 when
  extinguished.
- `burnSec`: seconds since ignition, for noise phase and char progression.
- `char` 0→1: accumulated blackening; rises monotonically while burning and never
  falls.

Wire-up: one field in `writeViewRecord` (`zombie-gpu.ts:1522-1541`), one
`gInstBurn` in `loadInstance` (`march.wgsl.ts:1522-1560`), plus a `burnCfg` uniform
block in `createMarchUniforms` (`zombie-gpu.ts:290-629`) for the tuning values that
are global rather than per body.

The state itself (ramp, char accumulation, extinguish) is a pure module
`burn-state.ts`, so it is unit-testable and reusable by the game in spec 2.

**Per pixel.** The march returns `vec4(lit, t)` where **alpha is depth**
(`march.wgsl.ts:4336`) and `marchNormal.w` already carries a per-body key
(`:4025`), so neither is free. Add a fourth MRT attachment `marchBurn`, gated by an
option exactly like the existing `marchNormals` gate (`sdf-layer.ts:1183-1210`),
carrying `(burn, char, bodyKey, spare)`. It is only allocated when the
screen-space technique or the heat distortion is active.

## 3. Shared base: surface fire and char

In the march's shading fold:

- Albedo is mixed toward a **fire ramp** (deep red → orange → yellow → pale) by a
  noise field scrolling upward, sampled in **rest space** using the existing
  `marchAnchor` noise anchor so the fire rides the body instead of swimming when
  the camera or body moves.
- Dark **char patches** show through where the fire noise is low, mixing albedo
  toward `charColor`, reusing the existing burn-wound char path
  (`charMask` `march.wgsl.ts:3657`, mix at `:3877`).
- The fire term is **emissive**, folded in at `march.wgsl.ts:4294` next to the
  existing `faceGlow` / `primGlow` handling, and suppresses both (a burning face
  is fire, not a face).
- As `char` rises the fire dims and the black wins, so late-stage bodies read as
  charred with flame only in the cracks.

Tunable: ramp colors, noise scale, rise speed, char rate, ignite time, emissive
gain.

## 4. Technique 1 — screen-space tongues

A full-screen pass at SDF render resolution, run inside the post-aa capture stage
**before** the shutter capture so flames get blurred with everything else.

Per pixel: step downward along the **projected world-up direction** (so tongues
rise vertically in the world, not in screen space), up to a bounded number of taps,
reading `marchBurn`. On finding burning body, tongue intensity comes from the
distance travelled against a flame length, modulated by upward-scrolling fbm noise
domain-warped for raggedness, with the noise phase keyed to the source body so each
body flickers independently.

- Depth: the tongue takes the **source body's depth**, so scene geometry in front
  still occludes it.
- Scale: flame length in pixels scales with the source depth, so flames keep a
  constant physical size and near bodies are not short-changed.
- Interior pixels (burn found at zero distance) fall through to the §3 surface
  term rather than being drawn twice.
- Tap count, flame length, raggedness, rise speed and the noise source (procedural
  fbm vs a sampled flame texture) are all tunable — the texture option is how a
  baked flame later feeds this same pass.

Cost is fixed per screen, independent of the number of burners.

The CPU mirror of the tongue shaping function is unit-tested, in the style of
`blastRefractionBand` mirroring its shader (`blast-refraction.ts`).

## 5. Technique 2 — flame cards

Per burning body, a set of additive quads (start at 12–20) anchored to torso, head,
upper and lower limbs, drawn in the existing effects scene
(`character-effects.ts`), which already renders after the composite against the
kept depth buffer.

- Cards face the camera but keep their **up axis world-vertical**.
- Per-card scale, phase offset and flipbook start frame are jittered from a seeded
  RNG so cards do not pulse in unison.
- Card height and count scale with `burn`, so a body visibly catches.
- Transparency follows the rules the codebase already learned: alpha in
  `colorNode.w`, additive blending, **no `alphaHash`** (renders as solid squares on
  WebGPU) and **no `alphaTest`** (kills soft glow) — see `explosion-vfx.ts:28-60`.

**Flipbook assets.** A dev script packs Blood's FIRE01 frames (tiles 3532–3539,
`assets-source/blood-extracted/tiles013_tiles/0353x.png` in the primary checkout)
into an atlas at a gitignored placeholder path. Extracted Blood assets are dev
placeholders only — never committed, never shipped, per the repo guardrails. The
same atlas format later holds original frames baked from the procedural technique,
which is the path to a shippable asset. The lab degrades to procedural-only when
the placeholder atlas is absent.

Card placement (which prims, how many, where along each) is a pure function with
unit tests.

## 6. Technique 3 — volumetric band

In the march, for rays near a burning body, take a bounded number of extra samples
in a shell just outside the surface (a distance band of a few centimetres to a few
tens of centimetres), accumulating emissive fire density from the same rest-space
noise field, warped upward so the shell's density reaches above the body.

Built deliberately simply, and built last: it exists to answer "does true 3D fire,
wrapping around the body and occluding correctly, look better than the cheap
methods?" Sample count and band thickness are tunable and it is off by default. If
it wins on looks, the cost question is opened then, with numbers.

## 7. Post-processing and light (in from the start)

- **Glow.** No bloom pass exists anywhere in `post-aa.ts`, so this is new: extract
  pixels above a threshold, blur at reduced resolution, add back. Runs before the
  VHS stage so the glow is not applied after display encoding.
- **Heat distortion.** Reuse the screen-space warp approach of the existing blast
  distortion (`post-aa.ts:1262`, driven by `blast-refraction.ts`): a gentle rising
  wobble in a band around burning bodies, amplitude from `marchBurn`.
- **Shutter blur.** Extend the existing selective shutter so flames count as
  blur-worthy, giving streaks on fast-moving burning bodies.
- **Fire light.** A flickering warm point light per burning body (smooth two-rate
  wobble, as `flickerLights` at `game-main.ts:657`), plus the per-body direct light
  term (`bodyFlash`, `game-main.ts:2015-2053`) so a burning enemy lights itself and
  the wall beside it. The dynamic light budget is capped (at most 8 room lights,
  `game-main.ts:1957-1985`), so burners past the cap share or drop lights,
  brightest and nearest first.

Each effect has its own toggle in the lab so its contribution is visible alone.

## 8. Tuning surface

`burn-profiles.ts`, shared by the lab and (in spec 2) the game, holding a pure
`BurnTuning` record, named presets and a `resolveBurnTuning` clamp — the pattern
`impact-splash-profiles.ts` already established, with a `burn-profiles.test.ts`
guarding drift.

Lab panel in the existing collapsible style (`panel-chrome.ts`, `H` to toggle,
`dynamite-panel.ts:190,282` as the template): a technique switch (surface only /
screen-space / cards / volumetric / combinations), sliders for every value in §3–§7
that read back the applied value, preset buttons, and a **COPY** button that puts a
`__sdfGame.setBurnTuning({...})` line on the clipboard and in the console.

Keys: ignite, extinguish, walk/run/stand, kill (collapse), technique cycle, panel
toggle. URL params for the initial technique, characters and seed.

Determinism: fixed seed and a pinnable clock (as `?frozen` / `setLightClockFrozen`
do in the game), so the same frame can be re-rendered under each technique for
honest side-by-side captures.

Console API `globalThis.__flameLab` with `frame(dt)`, `ignite`, `setTuning`,
`setTechnique`, `capture`, `stats` — following `window.__explosionSpike` and
`__bloodCompare`.

## 9. Decision procedure

1. Build the base plus all three techniques.
2. Capture the same fixed set of poses per technique: front, side, walking
   mid-stride, running, collapsed, distant, plus a dark room and a lit room.
3. Owner judges the captures and the live page against the Blood reference, and
   picks a direction (possibly a combination).
4. **Then** measure: frame cost per technique at 1, 8 and 30 burning bodies, using
   the lab's existing benchmark path, on a quiet machine. Report as a table.
5. If the chosen look is too expensive at 8 burners, tune or add LOD (for example
   cards only beyond a distance, fewer taps at range) rather than re-picking the
   look.

Target: about 8 burning bodies at once with no frame-rate hit; a crowd of dozens
must degrade gracefully, not collapse.

## 10. Testing

Pure-logic unit tests (Vitest, alongside the modules):

- `burn-state.ts`: ignite ramp, char monotonicity, extinguish decay, clamping.
- `burn-profiles.ts`: clamp behaviour and preset/game drift.
- Screen-space tongue shaping: CPU mirror of the shader function — monotonic
  falloff with distance, zero outside flame length, depth-scaled length.
- Card placement: count, anchoring to prims, seeded jitter reproducibility.
- Atlas script: frame count, grid layout, missing-source handling.

Render checks (fixed-frame, property-based, in the style of the existing render
checks): a burning body is brighter and more orange than the same unlit body;
tongue pixels appear above the silhouette and not below it; with burn at 0 the
frame is byte-identical to the pre-change render; the `marchBurn` attachment is
absent when no technique needs it.

Whether the fire looks good is the owner's judgement, not a test's.

## Risks

- **Screen-space noise swimming.** Mitigated by keying noise to the body via the
  rest-space anchor; if it still shimmers, the technique loses on looks and cards
  or volumetric win — that is what the comparison is for.
- **Volumetric cost.** Contained by building it last, off by default, with bounded
  extra samples.
- **Flame asset legitimacy.** Blood frames stay untracked placeholders; the
  shippable path is baking our own frames from the procedural look.
- **Light budget.** Burning crowds cannot each own a light; capped and shared.
- **`marchBurn` MRT cost.** Gated behind the techniques that need it, so the
  default game path is untouched until spec 2 wires burning in.
