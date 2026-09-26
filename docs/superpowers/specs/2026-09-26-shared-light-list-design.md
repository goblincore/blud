# Part 3: the shared light list, hybrid lighting, haze — Design

**Date:** 2026-09-26 · **Status:** approved by the owner section by section (§4-§7); plan 1 is next.
**Context:** part 3 of the Night Train look ([dynamic light spec](2026-09-26-night-train-dynamic-light-design.md)). The owner folded hybrid lighting into it (TASKS 4c).

## 1. Why

Every lighting consumer gets its own hand-copied light values, and each copy has only some of the lights:
- level materials (a three.js light list per carriage);
- each zombie's uniforms;
- the crowd type's shared uniforms (one key per character and carriage);
- the bone tubes and bone meshes;
- the baked gib chunks.

That caused a run of bugs on 2026-09-26:
- the mesh skull missed the muzzle flash;
- crowd zombies were stuck on one key;
- a stale flashlight shadow dimmed zombies depending on the camera heading;
- the lamps did not light the zombies at all.

Hand-wired feeds (`applyWindowKey`, `applyRoomFill`, `presentingLamp`, `strongestLamp`, `applyStormBodyKey`) patch this today; part 3 replaces them.

**The owner's rule is presentation over realism.** Zombies must always read as modelled clay/latex forms: a flattering key, a fill, a rim, and visible relief. No flat black silhouettes, no flat white, and the fresnel rim stays on. "It's not about pure realism or PBR, it's about making it look a certain way."

## 2. Decisions

1. **Zombies: hybrid (C).** Each zombie gets its **4 strongest lights**, chosen per zombie (crowd members too) from one shared list.
   - Every one of the 4 adds cheap per-pixel diffuse, highlight and rim, each with presentation rules.
   - The expensive, field-sampling terms follow only the **dominant** light.
2. **Phased (C).**
   - **Plan 1 (this spec's detail):** the shared list; zombies, crowd, bones and gibs move onto it; proven on Night Train.
   - **Plan 2:** level materials move onto the list (a custom `LightingNode` in the `ProbeLightingNode` pattern, 4 strongest per carriage) and get one shadow atlas. A/B it against three's lights before switching.
   - **Plan 3:** haze and raymarched volumetric light for every light, reading the same list and atlas, composited in `sdf-layer`'s `lateScene`. It replaces the tube-beam stand-in.
3. **4 lights per body, a 32-light list** (owner, §4).
4. **Profiles are fixed per light kind in code, plus an optional per-light `gain` and `tint` in the level JSON** (owner: option A, §5).
5. **No level-to-body shadows until plan 2.** ~~Plan 1 gives bodies an SDF self-shadow on the dominant light.~~ **Dropped after the spike (owner, 2026-09-27):** too subtle on these bodies to earn its ~1.3 ms (§6).
6. **Shadow quality is sacrificed freely** (owner): 512² at most, lower where it holds up.
7. **Cost ceiling: +1.5 ms on the worst carriage** over the old path (owner, §7).

## 3. Facts gathered (2026-09-26 exploration)

- **The probe-gather list is not per-pixel.** `probe-dynamic.ts` (8 lights of 12 floats) feeds a compute pass that bakes into probes, and the march reads the probes as ambient. It stays as the ambient and bounce source.
- **The march has one key**, composed in `march/body/blocks/light/`:
  - `flashlight.wgsl.ts` blends the beam into the key;
  - `compose.wgsl.ts` holds `flashDirect` (the muzzle, per instance `REC_FLASH`) and the window/lamp rim on `spotCfg2.w`;
  - scatter and wound shadow evaluate the field along `L`.
  - There is no light loop. `deferred-layer.ts:409-478` is a loop template: 16 lights, 4 texel loads each.
  - The march binds 4 of the 8 storage buffers allowed per stage.
- **Crowd records** are 16 vec4 per instance with 6 spare floats, and growing `REC_VEC4S` is cheap.
- **The deferred light list** (`deferred-lighting.ts`, `game-deferred-lights.ts`) is a data-only, deterministic builder worth copying. Its gaps: a 16-light cap, camera-nearest selection, a DataTexture rather than storage, no directional kind, and one shadow.
- **Level lists, Night Train worst case:** 16 point, 4 spot and 1 directional light, about 5 shadow maps, plus the ambient, hemisphere and probe node.
- **Bones and chunks:** `BONE_SHADE_WGSL` and `chunkShade` take one global key and spot, a flat ambient, no probes and no shadow.

## 4. The shared light list (plan 1)

**One list, built once per frame.** A pure module, `light-list.ts`, holds the list. Each light takes 4 vec4 in one GPU storage buffer, with a cap of **32 lights**. Night Train's worst carriage has about 21.

| vec4 | holds |
|---|---|
| 0 | `xyz`: position (directional: the direction toward the light); `w`: kind (0 point, 1 spot, 2 directional) |
| 1 | `rgb`: colour × intensity (the per-light level `gain` and `tint` already applied); `w`: range |
| 2 | `xyz`: spot direction; `w`: the cone's outer and inner cosines, packed |
| 3 | `x`: profile id; `y`: shadow slot (−1 = none; always −1 in plan 1); `zw`: spare |

**What fills it:**
- the tubes and lamps, with their mood level applied;
- the storm window light;
- the flashlight;
- the muzzle flash;
- fires;
- burning bodies. This closes the old gap where fire only lit bodies through the per-body flash uniform.

**Who writes it:** `stepDynamicLight`, and only it. The three.js lights for level materials are driven from the same entries, so the two can't drift apart. Plan 2 replaces them.

**Picking.** A pure function, `pickLights(list, bodyPos, height) → { idx: [4], dominant }`:
- It scores each light by what it delivers to the body: intensity × cone coverage at the feet × distance falloff (the feet rule settled on 2026-09-26).
- Ties break by index, so a replay lights identically.
- Unused slots hold −1.

**Who reads the picks:**
- **Single actors:** one uniform vec4 of indices; the dominant light is always slot 0.
- **Crowd:** the same four indices packed into a new instance-record vec4, `REC_LIGHTS`, which grows `REC_VEC4S` by one. This removes the "one key per crowd type" limit.
- **Bones and bone meshes:** read their owner body's picks.
- **Gib chunks:** pick at the chunk's own position.

**What it replaces:**
- `applyWindowKey`, `presentingLamp`, `strongestLamp`, `applyRoomFill`, `applyStormBodyKey`;
- the spotCfg/spotCfg2 key plumbing on bodies.

Their tuned constants become profile values (§5). The old path stays behind an A/B switch (`?lightlist=0`) until the owner signs off. Then it is deleted.

## 5. Shading: profiles and the light loop (plan 1)

**Profiles.** A table of up to 8 profiles, 2 vec4 each, is written in a TS const (`LIGHT_PROFILES`) and uploaded as one uniform. The starting profiles are tube, warm lamp, lightning/window, flashlight, muzzle and fire. Each profile's params, and where their starting values come from:

| param | from | does |
|---|---|---|
| `gain` | PRESENT.gain 1.3 | strength on bodies (flattering, not physical) |
| `viewBias` | PRESENT.viewBias 0.3 | bends `L` toward the viewer so the front reads |
| `floor` (wrap) | PRESENT.floor 0.18 | wrapped diffuse: no hard terminator into black |
| `backKey` | PRESENT.backKey 0.35 | facing falloff: his back to the light gives a dimmer front |
| `backRim` + rim tint | PRESENT.backRim 2.5; the bolt's cold rim `(0.55,0.75,1.3)` | the hard coloured edge when the light is behind or to the side |
| `edge`, `distFall` | PRESENT.edge 1.25, distFall 0.06 | how fast the cone and the distance let go |
| `spec` | the current latex highlight | highlight strength and tightness |

**Per-light overrides.** A level's light may set `gain` and `tint`. `export_level.py` and `level-json.ts` carry them, and they are folded into vec4 1 when the list is built. There are no per-level profile definitions.

**The loop** is a shared WGSL include, `bodyLights`:
- For each of the 4 picked lights, it runs the cheap per-pixel wrapped diffuse, facing falloff, highlight and back rim with that light's profile, and sums them.
- **Only the dominant light** drives the field-sampling terms: wound self-shadow, backlit scatter and the high-relief normal read. This is the existing code with `L` taken from the dominant light.
- **Two rules stay global, not per light:**
  - the fresnel rim (always on);
  - the "never flat black" body floor (BODY_DARK_FLOOR 0.25, from ambient and probes).

**Bones and gibs** call the same `bodyLights` include, so the skull, the bone meshes and the chunks get exactly the body's lights and rules. Chunks still skip scatter, as today.

**Gallery and lab** feed a one-light list that reproduces their current key. The golden snapshot is expected to hold. If it moves, the before and after go to the owner rather than being re-baked silently.

## 6. Shadows

**Plan 1:**
- **Casting stays on three.js maps.** Zombies (the hull layer) keep casting onto the level through the existing maps.
  - The window-light maps drop from 1024² to **512²**.
  - The tube maps stay at 512², and 256² is tried first; it is kept if it reads.
- **~~Self-shadow on the dominant light.~~ Dropped (owner, 2026-09-27).** The spike (`docs/dev-notes/2026-09-27-self-shadow-spike.md`) marched the smooth field toward the key through the existing wound-shadow call site.
  - Results: it was invisible under the tubes and a modest sculpting in a lightning flash, with no black holes. It cost +1.3 ms of GPU even at 8 steps and 0.4 m.
  - The owner: "so subtle … i dont think its worth it at all".
  - The code stays in, off by default (`?selfshadow=1`).
  - Kept from the spike: `woundShadow`'s `reach`/`steps` parameters and the 512² window maps.
- **No level-to-body shadows.** A zombie inside a seat's shadow stays lit until plan 2. The slot field is written as −1 and reserved.

**Plan 2: one shadow atlas, 1024².** The level and the bodies both read it, so the bodies darken inside level shadows.

| light | tile | rate |
|---|---|---|
| tubes in the player's carriage | 256² | half rate (as today) |
| window light | 512² | re-fit per bolt (as today) |
| flashlight | 512² | every frame |
| muzzle, fire, lamps, other carriages | none | none |

That is about 8 tiles in use out of 16.

## 7. Cost budget

**Baseline:**
- The frame is draw/CPU-bound.
- The train budget is +200 draws and +12 ms over the base level.
- The tube cones cost 4–9 ms per carriage, mostly shadow redraws.

**Plan 1 costs:**

| | change | expected |
|---|---|---|
| CPU | `pickLights` for about 40 bodies × 32 lights, and one buffer write | about 0.1 ms; it replaces the per-actor uniform copies |
| GPU, march | 4-light loop per hit pixel, ALU only | small (low march resolution) |
| GPU, bones and gibs | the same loop on meshes | negligible |
| Draws | none added | 0 |

**Ceiling: the worst carriage (third class, the Boiler Room) must be no more than +1.5 ms over `?lightlist=0`.**
- The light gate (`scripts/sdf-game-light-gate.*`, `LAB_TMP=.lab-tmp`) measures it A/B and fails past the ceiling.

## 8. Testing

- **Pure unit tests:**
  - `light-list.ts`: packing, cap, and the level gain/tint fold;
  - `pickLights`: cone coverage at the feet, the dominant choice, the tie order, and determinism;
  - profile table packing.
- **WGSL:**
  - `bodyLights` is compiled in the existing shader-contract tests;
  - the golden snapshot is held for the one-light gallery list.
- **Crowd records:** the `REC_LIGHTS` layout test, and the crowd state slice's binding count.
- **Game gates** (headless, `LAB_TMP=.lab-tmp`):
  - the light gate measures the body luminance under a tube, in a bolt and with the flashlight;
  - two crowd members under different tubes get different keys;
  - the skull brightens with the muzzle flash;
  - the A/B cost check (§7).
- **Owner look check:** screenshots of the self-shadow and the crowd under the tubes, A/B against `?lightlist=0`.

## 9. Out of scope for plan 1

- Level materials on the list, and the shadow atlas (plan 2).
- Haze and volumetrics (plan 3).
- Scatter on chunks.
