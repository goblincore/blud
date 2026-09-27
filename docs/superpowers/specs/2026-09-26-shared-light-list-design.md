# Part 3: the shared light list, hybrid lighting, haze — Design (DRAFT)

**Date:** 2026-09-26 · **Status:** brainstorming in progress. Two decisions made (§2); the design sections are not yet written or approved.
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

Hand-wired feeds (`applyWindowKey`, `applyRoomFill`, `presentingLamp`, `applyStormBodyKey`) patch this today; part 3 replaces them. The owner's rule is presentation over realism: zombies must always read as modelled clay/latex forms (a flattering key, a fill, a rim, visible relief). No flat black silhouettes, no flat white, and the fresnel rim stays on.

## 2. Decisions (owner, 2026-09-26)

1. **Zombies: hybrid (C).** Each zombie gets its **4 strongest lights**, chosen per zombie (crowd members too, through their instance records) from the shared list.
   - Every one of the 4 adds cheap per-pixel diffuse, highlight and rim, each with the presentation rules (a floor, facing falloff with a back-light rim, a strength that respects the light's cone and position).
   - The expensive, field-sampling terms (wound self-shadow, scatter) follow only the **dominant** light.
2. **Phased (C):**
   - **Plan 1:** build the shared list and move the zombie, crowd, bone and gib side onto it; prove it on Night Train.
   - **Plan 2:** move the level materials onto it (a custom `LightingNode` in the `ProbeLightingNode` pattern, the 4 strongest per carriage, one shadow atlas). A/B it against three's lights before switching.
   - **Plan 3:** haze and raymarched volumetric light for every light, reading the same list and atlas, composited in `sdf-layer`'s `lateScene`. It replaces the tube-beam stand-in.

## 3. Facts gathered (2026-09-26 exploration)

- **The probe-gather list is not per-pixel.** `probe-dynamic.ts`, 8 lights of 12 floats, is consumed by a compute pass that bakes into probes; the march reads the probes as ambient.
- **The march has one key, composed in `march/body/blocks/light/`.**
  - `flashlight.wgsl.ts` blends the beam into the key.
  - `compose.wgsl.ts` holds `flashDirect` (the muzzle, per instance `REC_FLASH`) and the window/lamp rim on `spotCfg2.w`.
  - Scatter and wound shadow evaluate the field along `L`, so they stay on the dominant light.
  - There is no light loop yet. `deferred-layer.ts:409-478` is a loop template: 16 lights, 4 texel loads each.
  - The march binds 4 storage buffers of the 8 per stage.
- **Crowd records:** 16 vec4 per instance, 6 spare floats (`REC_MELT.zw`, `REC_GORE.yzw`, `REC_BURN.w`). Enough for 4 light indices plus the dominant index, and growing `REC_VEC4S` is cheap.
- **The deferred light list** (`deferred-lighting.ts`, `game-deferred-lights.ts`) is a data-only, deterministic builder worth copying. Its gaps: a 16-light cap, camera-nearest selection, a DataTexture rather than storage, no directional kind, one shadow.
- **Level lists, Night Train worst case:** 16 point, 4 spot and 1 directional light, about 5 shadow maps, plus the ambient, hemisphere and probe node. Idle pool lights are still iterated, because hiding them rebuilds pipelines.
- **Bones** (`BONE_SHADE_WGSL`) **and chunks** (`chunkShade`) take one global key and spot, a flat ambient, no probes and no shadow.

## 4. Next (for the next session)

Continue the brainstorm: present the design sections for plan 1, one at a time. Then write this spec out properly, and after that the plan. Open points to put to the owner:
- the record layout for the 4 lights;
- the shadow atlas: which lights shadow, and at what size;
- how the presentation rules become per-light parameters;
- the cost budget.
