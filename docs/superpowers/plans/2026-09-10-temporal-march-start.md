# Temporal reprojection start for the march — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 1 is pure and dispatchable; Task 2 needs a GPU and the owner's bench.

**Status:** SHIPPED ON 2026-09-10 (`?tstart=0` to disable). Result: the
first playtest showed other bodies' silhouettes cutting into flesh and
see-through — the per-pixel bound was the NEAREST body's depth while each
pass marches one body; fixed with an own-body gate (reprojected point must
lie inside this body's box along the ray) plus a one-sample inside check.
Owner bench (room 4, passes): before the gate march p50 17.4 -> 7.3 ms;
with the gate 14.9 -> 11.3 ms (walk 11.0 -> 7.0, fire 14.9 -> 11.3, gib
18.0 -> 13.8; the on-run had fewer bodies, so treat as ~25-35%). Copy
0.02-0.04 ms. Owner: "looks good, ship it".

**Aggressive follow-up (same day, session).** Four changes on top: (1)
`bodyEntry` — the ray-box entry already computed for the accumulated-depth
discard — joins the start max as a fifth lower bound; (2) recovery probes:
when the one-sample check finds the start inside, rewind by twice the
reported penetration and re-probe (≤ 3 evals) instead of dropping the
bound; (3) the accepted start must also sit OUTSIDE a wound's near zone
(mapBody.z — the field is not a bound beside a crater); (4) the margin is
adaptive: measured fresh-frame-to-fresh-frame body translation × 1.5,
capped at 0.25, floored at the shipped **0.25** — PARKED there after the
owner playtest found glitches at the 0.15 floor in real play (motion,
grazing silhouettes, the field weave; the static closeup bisect that
cleared 0.15 ran VHS-off, weave-off, camera frozen, and simply did not
cover those cases — owner verdict outranks it). The bisect remains
valid as far as it went: at 0.10 the START beats the outer-hull face and
the accept tolerance lands samples alternately inside/outside the skin,
banding the tissue ramp; the shipped 0.25 never beats the hull face up
close. Room-4 firefight A/B at the ship config (sdf:march p50, the
shipped margin): gib 7.83 -> 7.21 ms (−8%), fire −5%, walk ~0, no
regression leg; the 0.15-floor's gib −17% is forfeited until the
accept/ramp fragility is fixed. Three owner telemetry recordings (on /
off / 0.25-pinned, 2026-09-10 ~10:40Z) all pin p50 at the 30 fps cap and
carry no pass timings, so they cannot rank the configs; late frames
cluster at >= 4 bodies on screen in all three. A latent defect worth its
own task: accept-tolerance + tissue-ramp fragility just inside the hull
face (the perf spec's accept-retraction lever). Pre-existing on main,
unrelated: surface-nets.wgsl.test.ts HULL_FIELD arity pin (17 vs 19).
Instruments: `scripts/tmp/tstart-ab.mjs` (perf A/B driver),
`tstart-artifact-check.mjs` (frozen-scene pixel diff, `TSTART_PIN` bisect).

**Goal:** Cut the march's per-pixel step count at FULL resolution by
starting each ray where last frame's hit at that screen position, reprojected
through the camera's motion, says the surface was — minus a safety margin —
instead of at the camera (or the cone/hull bounds). Behind `?tstart=0`
(bit-identical off). Judged by `__sdfGame.bench({ mode: 'passes' })` on the
owner's stress scene (many bodies in view, wounded), not by frame intervals,
which sit on the 30 fps cap.

**Owner direction (2026-09-10):** reduced-scale flesh is not worth the look
(the `bodies` field interlace grows with it); "temporal reprojection inside
the march sounds interesting". Keep full resolution.

**Architecture:** The march (`march.wgsl.ts` MARCH_BODY, ~L2646–2670) already
starts each ray at `max(startT, shellIn, preStart)` — the cone pre-pass,
the outer hull's near face and the (unshipped) quarter-res depth prepass are
all LOWER BOUNDS proven empty, folded by `max`, 0 being the identity. This
plan adds a fourth: `tempStart`. The SDF layer keeps a full-res copy of the
frame's final layer (`lastTex`, RGBA with NDC depth in .a, ≥ 1 = nothing)
made by one blit at the end of the frame, plus the INVERSE view-projection
of the frame that produced it. For the current pixel, `temporalStartFetch`
reads last frame's depth at the same screen uv, unprojects it with that
inverse VP to a world point W, and measures W along the CURRENT ray:
`t = dot(W - camPos, rayDir)`. The start is `max(0, t - margin - t * slope)`,
where `margin` (m) covers how far flesh can move toward the camera in one
frame and `slope` covers the surface not being flat across the pixel. A miss
(depth ≥ 1), a disabled gate, or a W behind the camera returns 0 — the
identity inside the `max`, so the off path is bit-identical. The march's
sphere-trace safety is unchanged: from the start point it still steps by the
field; the only new failure is starting PAST a surface that moved toward
the camera by more than `margin` in one frame, which shows as a one-frame
notch on that silhouette. A CPU twin pins the maths.
**Tech Stack:** TypeScript, vitest, WGSL via `wgslFn`, three r185 WebGPU.

## Facts pinned for the implementer (verified 2026-09-10 on `claude/level-probe-lighting`)

- Start composition, `march.wgsl.ts` ~L2668–2670:
  ```wgsl
  let preT = depthPreFetch(depthPreTex, screenUV, depthPreCfg);
  let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);
  var t = clamp(max(max(startT, shellIn), preStart), 0.0, tMax);
  ```
  `screenUV`, `rayDir`-equivalents and `cameraPosition` are already inputs
  of MARCH_BODY (see how `prevFetch` gets `screenUV` and `cosRay`, and how
  `rayDir = normalize(sub(positionWorld, cameraPosition))` is built in
  `zombie-gpu.ts` ~L992). Check the exact parameter names in the MARCH_BODY
  signature (~L2200–2230) before adding to it.
- Input binding: `zombie-gpu.ts` builds the march call with a named-object
  argument (~L1060–1192); every new input goes POSITIONALLY LAST in BOTH the
  WGSL signature and that object, in the same commit ("the meltCfg rule").
  The current last input is `bodyFlash` (~L1191).
- Fetch precedent: `PREV_FETCH_WGSL` / `prevFetchNode` (`zombie-gpu.ts`
  L794–803) — a `texture_2d<f32>` read at `screenUV`, gated by an `enabled`
  uniform, returning a sentinel when off. `PrevSource { texture, uniforms: { enabled } }`
  (L808) is the shape the layer hands the view factory; `prev` is bound
  UNCONDITIONALLY (the uniform gates the fetch, not the binding —
  `sdf-layer.ts` ~L1015) and rides the lazy-init clear list (~L1008–1030).
  NOTE: `prev` is the in-frame accumulated-depth gate between body passes
  (blitted per body when `prevUniforms.enabled`, OFF by default). It is NOT
  last frame's depth. This plan adds its own target.
- The blit: `sdf-layer.ts` L746–758 — `blitMat` copies `target.texture`
  with alpha verbatim into whatever target is set; `blitQuad`/`blitScene`.
  Reuse them with `renderer.setRenderTarget(lastTex)` at the END of the
  layer's frame (after the last body pass and composite of the layer, before
  the composite quad is drawn is also fine — the layer target is final by
  then).
- Camera matrices: the layer snapshots `_curVp` every frame (~L976,
  `uCurVp.value.copy(_curVp)`) and keeps `heldVpInv` for hold frames
  (~L1005). The temporal start needs the INVERSE VP of the frame that wrote
  `lastTex`: copy `_curVp` inverted into `uLastInvVp` right after the blit
  (so it always pairs with the texture). `THREE.Matrix4.copy(m).invert()`.
- The composite already does this exact unprojection for hold frames
  (`COMPOSITE_WGSL` ~L317–325): `world = heldInv * vec4(ndc.xy, depth, 1)`,
  `ndc = (st.x*2-1, 1-st.y*2)`, divide by `world.w`. Mirror it; the layer's
  `st` there is already Y-flipped for the canvas — inside the MARCH the
  `screenUV` convention is the layer's own (what `prevFetch` uses), and
  `lastTex` is a target-to-target copy with no flip, so the unprojection
  must use the SAME uv → ndc mapping the camera used to render the layer:
  `ndc = vec2(uv.x * 2 - 1, uv.y * 2 - 1)` if `screenUV` is bottom-up, or
  with `1 - uv.y` if top-down. DETERMINE THIS EMPIRICALLY in Task 2 (a wrong
  flip shows as the start bound coming from the mirrored row: bodies
  vanish where the mirror had nothing). The CPU twin takes ndc, not uv, so
  the twin is convention-free.
- Half-rate hold frames (`isHoldFrame`, ~L1000) do not march: the blit must
  run only on marched frames, so `lastTex` and `uLastInvVp` describe the last
  FRESH frame. On the next fresh frame the camera delta spans two frames —
  correct by construction, since the inverse VP is the one that made the texture.
- Bench: `__sdfGame.bench({ mode: 'passes' })` is the only source of GPU
  pass timings (the timestamp hook runs inside it; frame recordings sit on
  the 30 fps cap and cannot see march cost). Scenario knobs: `room`,
  `walkFrames`, `fireFrames`, `gibFrames`, `kind: 'closeup'`.
- Seam precedent: `__sdfGame.setDepthPrepass()` / `setLevelShadow(on)` (0 is
  bit-for-bit the old path) ~L1287–1351.

## The maths, stated once

Inputs: last depth `d` (NDC, from `lastTex.a`), `lastInvVp` (4x4), the pixel's
ndc `(nx, ny)`, current `camPos`, current unit `rayDir`, `cfg = (enabled, margin_m, slope, maxStart_m)`.

```
if enabled < 0.5 or d >= 1.0: return 0
W = lastInvVp * (nx, ny, d, 1);  W /= W.w
t = dot(W - camPos, rayDir)
if t <= 0: return 0                       // behind the camera / degenerate
start = t - margin - t * slope
return clamp(start, 0, maxStart)          // maxStart caps a bad reprojection
```

Properties the tests pin: (1) disabled or sentinel → 0; (2) a static camera
and a point at distance `t` on the ray returns `t - margin - t*slope`; (3) a
camera that moved forward by `m` returns `t - m - margin - ...` (the start
follows the camera); (4) a point behind the camera returns 0; (5) output is
never negative and never above `maxStart`; (6) the WGSL parses to the
declared inputs in order and never samples (loads only).

## File structure

- Create `src/lab/sdf-zombie/webgpu/temporal-start.ts` — CPU twin
  `temporalStart(...)` + `TEMPORAL_START_WGSL` (`fn temporalStartFetch(...)`)
  + `TEMPORAL_START_DEFAULTS`.
- Create `src/lab/sdf-zombie/webgpu/temporal-start.test.ts`.
- Modify `src/lab/sdf-zombie/webgpu/sdf-layer.ts` — `lastTex` target +
  end-of-frame blit, `uLastInvVp`, `temporalUniforms { cfg }`,
  `LastFrameSource` on the layer object, `setTemporalStart(on, margin?)`.
- Modify `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` — new inputs bound LAST
  (`lastTex`, `lastInvVp`, `temporalCfg`), `temporalStartNode`, `LastFrameSource` type.
- Modify `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — three new MARCH_BODY
  inputs LAST; the fourth `max` term.
- Modify `src/lab/sdf-zombie/webgpu/game-main.ts` — hand the source to
  every view (like `prev`), seams `__sdfGame.setTemporalStart(on, margin)`,
  `?tstart=0`, HUD tag.

---

### Task 1: `temporal-start.ts` — CPU twin, WGSL, tests (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/temporal-start.ts`
- Create: `src/lab/sdf-zombie/webgpu/temporal-start.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/temporal-start.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
// @ts-expect-error — deep three source import for the real wgslFn parser (same
// pattern as probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { TEMPORAL_START_DEFAULTS, TEMPORAL_START_WGSL, temporalStart, type TemporalCfg } from './temporal-start';

/** A camera at `pos` looking down -Z, 60° vertical fov, 4:3, near 0.1 far 100. */
function cam(pos: [number, number, number]): { vp: THREE.Matrix4; invVp: THREE.Matrix4; near: number; far: number } {
  const c = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
  c.position.set(...pos); c.updateMatrixWorld(true); c.updateProjectionMatrix();
  const vp = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  return { vp, invVp: vp.clone().invert(), near: 0.1, far: 100 };
}
/** NDC depth of world point `w` under `vp`, plus its ndc xy. */
function project(vp: THREE.Matrix4, w: [number, number, number]): { nx: number; ny: number; d: number } {
  const v = new THREE.Vector4(w[0], w[1], w[2], 1).applyMatrix4(vp);
  return { nx: v.x / v.w, ny: v.y / v.w, d: v.z / v.w };
}
const on: TemporalCfg = { enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 };

describe('temporalStart — the start bound', () => {
  it('is 0 when disabled or when last frame had nothing at this pixel', () => {
    const c = cam([0, 0, 0]);
    expect(temporalStart(0.5, c.invVp, [0, 0], [0, 0, 0], [0, 0, -1], { ...on, enabled: 0 })).toBe(0);
    expect(temporalStart(1.0, c.invVp, [0, 0], [0, 0, 0], [0, 0, -1], on)).toBe(0);
  });

  it('with a static camera returns the reprojected distance minus the margins', () => {
    const c = cam([0, 0, 0]);
    const w: [number, number, number] = [0, 0, -4];
    const { nx, ny, d } = project(c.vp, w);
    const t = temporalStart(d, c.invVp, [nx, ny], [0, 0, 0], [0, 0, -1], on);
    expect(t).toBeCloseTo(4 - 0.25 - 4 * 0.02, 5);
  });

  it('follows the camera: after moving 1 m toward the surface the start is 1 m nearer', () => {
    const last = cam([0, 0, 0]);
    const w: [number, number, number] = [0, 0, -4];
    const { nx, ny, d } = project(last.vp, w);
    // Same screen pixel (centre), camera now at z = -1 looking the same way.
    const t = temporalStart(d, last.invVp, [nx, ny], [0, 0, -1], [0, 0, -1], on);
    expect(t).toBeCloseTo(3 - 0.25 - 3 * 0.02, 5);
  });

  it('is 0 when the reprojected point is behind the camera', () => {
    const last = cam([0, 0, 0]);
    const { nx, ny, d } = project(last.vp, [0, 0, -4]);
    // Camera moved past the point.
    expect(temporalStart(d, last.invVp, [nx, ny], [0, 0, -6], [0, 0, -1], on)).toBe(0);
  });

  it('never goes negative (a surface nearer than the margin) and never above maxStart', () => {
    const c = cam([0, 0, 0]);
    const near = project(c.vp, [0, 0, -0.2]);
    expect(temporalStart(near.d, c.invVp, [near.nx, near.ny], [0, 0, 0], [0, 0, -1], on)).toBe(0);
    const far = project(c.vp, [0, 0, -80]);
    expect(temporalStart(far.d, c.invVp, [far.nx, far.ny], [0, 0, 0], [0, 0, -1], { ...on, maxStart: 10 })).toBe(10);
  });

  it('an off-centre pixel measures along ITS ray, not the view axis', () => {
    const c = cam([0, 0, 0]);
    const w: [number, number, number] = [1, 0.5, -4];
    const { nx, ny, d } = project(c.vp, w);
    const len = Math.hypot(1, 0.5, 4);
    const dir: [number, number, number] = [1 / len, 0.5 / len, -4 / len];
    const t = temporalStart(d, c.invVp, [nx, ny], [0, 0, 0], dir, { ...on, margin: 0, slope: 0 });
    expect(t).toBeCloseTo(len, 5);
  });

  it('ships the defaults the plan names', () => {
    expect(TEMPORAL_START_DEFAULTS).toEqual({ enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 });
  });
});

describe('TEMPORAL_START_WGSL — parse and shape contract', () => {
  it('starts with fn temporalStartFetch, per the wgslFn parse contract', () => {
    expect(TEMPORAL_START_WGSL.startsWith('fn temporalStartFetch(')).toBe(true);
  });
  it('the real wgslFn parser sees exactly the six declared inputs, in order', () => {
    const parsed = new WGSLNodeFunction(TEMPORAL_START_WGSL);
    expect(parsed.inputs.map((i: { name: string }) => i.name))
      .toEqual(['lastTex', 'ndc', 'lastInvVp', 'camPos', 'rayDir', 'cfg']);
  });
  it('loads, never samples, and returns the identity (0) on the off paths', () => {
    expect(TEMPORAL_START_WGSL).toContain('textureLoad(');
    expect(TEMPORAL_START_WGSL).not.toContain('textureSample');
    expect(TEMPORAL_START_WGSL).toContain('if (cfg.x < 0.5) { return 0.0; }');
    expect(TEMPORAL_START_WGSL).toContain('if (d >= 1.0) { return 0.0; }');
  });
  it('shares the margin formula with the CPU twin', () => {
    expect(TEMPORAL_START_WGSL).toContain('t - cfg.y - t * cfg.z');
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/temporal-start.test.ts`
Expected: FAIL — `Cannot find module './temporal-start'`.

- [x] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/temporal-start.ts
//
// TEMPORAL REPROJECTION START for the march (plan
// docs/superpowers/plans/2026-09-10-temporal-march-start.md). Last frame's
// hit depth at this screen position, unprojected with the inverse
// view-projection of the frame that wrote it, measured along the CURRENT
// ray, minus a margin for flesh that moved toward the camera and a slope
// term for the surface not being flat across the pixel. A fourth LOWER
// BOUND for the march's start, folded by max like the cone, hull and
// depth-prepass bounds; 0 is the identity, so every off path returns 0.
//
// The maths lives twice — temporalStart is the tested CPU twin of
// temporalStartFetch — and temporal-start.test.ts pins both.
import type * as THREE from 'three/webgpu';

export interface TemporalCfg {
  /** 1 = on; anything under 0.5 returns 0 (bit-identical march). */
  enabled: number;
  /** Metres subtracted from the reprojected distance: how far flesh may
   *  move TOWARD the camera in one frame. 0.25 m covers 7.5 m/s at 30 Hz. */
  margin: number;
  /** Fraction of the distance subtracted for surface slope across a pixel. */
  slope: number;
  /** Cap on the start, metres — a bad reprojection can never skip a body. */
  maxStart: number;
}

export const TEMPORAL_START_DEFAULTS: TemporalCfg = { enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 };

/**
 * The CPU twin. `d` is last frame's NDC depth at this pixel (>= 1 = nothing),
 * `ndc` the pixel's clip-space xy in [-1, 1] (convention-free: the caller
 * maps uv to ndc), `lastInvVp` the inverse view-projection of the frame that
 * wrote `d`, `camPos` / `rayDir` the CURRENT camera and unit ray.
 */
export function temporalStart(
  d: number,
  lastInvVp: THREE.Matrix4,
  ndc: [number, number],
  camPos: [number, number, number],
  rayDir: [number, number, number],
  cfg: TemporalCfg,
): number {
  if (cfg.enabled < 0.5 || d >= 1.0) return 0;
  const e = lastInvVp.elements; // column-major
  const x = ndc[0], y = ndc[1], z = d;
  const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  const ww = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  if (Math.abs(ww) < 1e-12) return 0;
  const px = wx / ww - camPos[0], py = wy / ww - camPos[1], pz = wz / ww - camPos[2];
  const t = px * rayDir[0] + py * rayDir[1] + pz * rayDir[2];
  if (t <= 0) return 0;
  const start = t - cfg.margin - t * cfg.slope;
  return Math.min(cfg.maxStart, Math.max(0, start));
}

/**
 * The WGSL twin. `cfg = (enabled, margin, slope, maxStart)`. `ndc` is the
 * pixel's clip xy under the convention the layer was rendered with — the
 * caller (MARCH_BODY) derives it from screenUV; see the plan's flip note.
 * Inputs stay comment-free: the wgslFn parser reads `name: type` pairs.
 */
export const TEMPORAL_START_WGSL = /* wgsl */ `fn temporalStartFetch(
  lastTex: texture_2d<f32>,
  ndc: vec2<f32>,
  lastInvVp: mat4x4<f32>,
  camPos: vec3<f32>,
  rayDir: vec3<f32>,
  cfg: vec4<f32>
) -> f32 {
  if (cfg.x < 0.5) { return 0.0; }
  let dims = vec2<f32>(textureDimensions(lastTex, 0));
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let d = textureLoad(lastTex, c, 0).a;
  if (d >= 1.0) { return 0.0; }
  let w = lastInvVp * vec4<f32>(ndc, d, 1.0);
  if (abs(w.w) < 1e-12) { return 0.0; }
  let p = w.xyz / w.w - camPos;
  let t = dot(p, rayDir);
  if (t <= 0.0) { return 0.0; }
  let start = t - cfg.y - t * cfg.z;
  return clamp(start, 0.0, cfg.w);
}`;
```
Note the WGSL reads the texture at `uv = ndc * 0.5 + 0.5` — so the ndc the
march passes must be the one whose uv addresses `lastTex` correctly (Task 2
Step 6 determines the flip). The CPU twin takes the depth directly and is
convention-free.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/temporal-start.test.ts`
Expected: PASS, 11 tests. If "follows the camera" is off by the near-plane
term, check that `project` and `temporalStart` use the same `vp` (the LAST
camera's) — only `camPos`/`rayDir` are current.

- [x] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.
```bash
git add src/lab/sdf-zombie/webgpu/temporal-start.ts src/lab/sdf-zombie/webgpu/temporal-start.test.ts
git commit -m "feat(march): temporal reprojection start — CPU twin, WGSL, tests (not wired)"
```

---

### Task 2: wire it — layer copy, march slot, seams, bench (GPU, session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (targets ~L736, blit ~L746–758, frame ~L960–1200, returned object ~L1351)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (PrevSource ~L808, march call ~L1060–1192)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY signature ~L2200–2230, start ~L2668–2670)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (view opts where `prev` is handed in; seams ~L1287–1351; HUD ~L4011)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (input-order contract)

- [x] **Step 1: Contract test first** (append to `march.wgsl.test.ts`, following its existing MARCH_BODY input-order test — find `bodyFlash` in that file and extend the expected tail):

```ts
it('MARCH_BODY ends with the temporal-start inputs, in order (plan 2026-09-10)', () => {
  const parsed = new WGSLNodeFunction(MARCH_BODY);
  const names = parsed.inputs.map((i: { name: string }) => i.name);
  expect(names.slice(-4)).toEqual(['bodyFlash', 'lastTex', 'lastInvVp', 'temporalCfg']);
});
it('folds tempStart into the start max, after preStart', () => {
  expect(MARCH_BODY).toContain('var t = clamp(max(max(max(startT, shellIn), preStart), tempStart), 0.0, tMax);');
});
```
Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — expected: the two new tests FAIL.

- [x] **Step 2: `march.wgsl.ts`** — add to the MARCH_BODY signature, LAST:
```wgsl
  bodyFlash: vec4<f32>,
  lastTex: texture_2d<f32>,
  lastInvVp: mat4x4<f32>,
  temporalCfg: vec4<f32>
```
and replace the start line:
```wgsl
  // TEMPORAL REPROJECTION START (plan 2026-09-10): last frame's hit at this
  // pixel, reprojected through the camera's motion, minus a margin — a
  // fourth proven-ahead bound. 0 on every off path (the identity in max).
  // ndc from screenUV: see the flip note in the plan; pinned empirically.
  let tempNdc = vec2<f32>(screenUV.x * 2.0 - 1.0, screenUV.y * 2.0 - 1.0);
  let tempStart = temporalStartFetch(lastTex, tempNdc, lastInvVp, cameraPosition, rayDir, temporalCfg);
  var t = clamp(max(max(max(startT, shellIn), preStart), tempStart), 0.0, tMax);
```
(`cameraPosition` and `rayDir` — use the names MARCH_BODY already has for the
camera position and the unit ray; `prevFetch`'s `cosRay` is derived from the
same ray. If the body's ray is in MODEL space at that point, transform
`camPos`/`rayDir` to world first — the layer depth is world-space.) Include
the helper: wherever MARCH_BODY's helper chain is built in `zombie-gpu.ts`
(~L181–190, `sources = [...HELPERS, ...]`), add `TEMPORAL_START_WGSL` to the
sources list BEFORE the body.

- [x] **Step 3: `zombie-gpu.ts`** — next to `PrevSource`:
```ts
/** Last FRESH frame's final layer (RGBA, NDC depth in .a, >= 1 = nothing)
 *  plus the inverse view-projection that made it. Bound unconditionally;
 *  `cfg.x` gates the fetch. */
export interface LastFrameSource {
  texture: THREE.Texture;
  uniforms: { invVp: ReturnType<typeof uniform>; cfg: ReturnType<typeof uniform> };
}
```
Add a `lastFrame?: LastFrameSource` option to the view factory's options (the
same place `prev` rides in — `GpuViewOpts`), and in the march call object,
LAST:
```ts
    bodyFlash: u.bodyFlash,
    // Temporal reprojection start — POSITIONALLY LAST after bodyFlash.
    lastTex: texture(lastFrame ? lastFrame.texture : fallbackLastFrameTexture()),
    lastInvVp: lastFrame ? lastFrame.uniforms.invVp : fallbackLastInvVp(),
    temporalCfg: lastFrame ? lastFrame.uniforms.cfg : fallbackTemporalCfg(),
```
with three module-level fallbacks like `fallbackProbeTexture()` (a 1x1 RGBA
float texture with alpha 1 = nothing; a `uniform(new THREE.Matrix4())`; a
`uniform(new THREE.Vector4(0, 0, 0, 0))`) — each created ONCE (a shared
fallback texture is fine here because only ONE texture node is built per
material from it, unlike the deferred trap; still, create it in a factory).

- [x] **Step 4: `sdf-layer.ts`**
```ts
  // TEMPORAL START source (plan 2026-09-10): the frame's final layer,
  // copied once at the end of every MARCHED frame, with the inverse VP that
  // made it. Hold frames keep the last fresh copy.
  const lastTex = new THREE.RenderTarget(1, 1, {
    depthBuffer: false, type: THREE.FloatType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const lastUniforms = {
    invVp: uniform(new THREE.Matrix4()),
    cfg: uniform(new THREE.Vector4(0, 0.25, 0.02, 50)), // enabled off until wired
  };
  const _lastInvVp = new THREE.Matrix4();
```
`setSize`: `lastTex.setSize(w, h)` next to `prev.setSize(w, h)` (L912).
Lazy-init clear list (~L1008): add `lastTex` (alpha 1 = nothing; same reason as `prev`).
End of a marched frame (after the last body pass, before returning — find
where `prev` would be blitted, ~L1184, and put this OUTSIDE its enabled
gate, gated on `!hold` instead):
```ts
      if (!hold && lastUniforms.cfg.value.x > 0.5) {
        setPassLabel('blit:last');
        renderer.setRenderTarget(lastTex);
        renderer.render(blitScene, blitCamera);   // the existing blit quad reads target.texture
        _lastInvVp.copy(_curVp).invert();
        (lastUniforms.invVp.value as THREE.Matrix4).copy(_lastInvVp);
      }
```
(`blitCamera` — whatever camera the existing blit uses; check ~L1184.)
Interface + object:
```ts
  /** Temporal reprojection start (plan 2026-09-10). */
  readonly lastFrame: LastFrameSource;
  setTemporalStart(on: boolean, margin?: number, slope?: number): void;
  readonly temporalStart: { on: boolean; margin: number; slope: number; maxStart: number };
```
```ts
    lastFrame: { texture: lastTex.texture, uniforms: lastUniforms },
    setTemporalStart(on, margin, slope) {
      const v = lastUniforms.cfg.value as THREE.Vector4;
      v.x = on ? 1 : 0;
      if (margin !== undefined) v.y = Math.max(0, margin);
      if (slope !== undefined) v.z = Math.max(0, slope);
    },
    get temporalStart() { const v = lastUniforms.cfg.value as THREE.Vector4; return { on: v.x > 0.5, margin: v.y, slope: v.z, maxStart: v.w }; },
```
Import `LastFrameSource` from `./zombie-gpu`.

- [x] **Step 5: `game-main.ts`** — in `viewGpuOpts` (where `probeDyn` rides,
~L1844) add `lastFrame: sdfLayer.lastFrame,`; boot:
```ts
  // Temporal reprojection start (plan 2026-09-10). ?tstart=0 pins the
  // bit-identical march; default ON once the bench and the owner say so —
  // ships OFF until then.
  const tstartParam = new URLSearchParams(location.search).get('tstart');
  sdfLayer.setTemporalStart(tstartParam === '1');
```
Seams next to `setDepthPrepass`:
```ts
    setTemporalStart: (on: boolean, margin?: number, slope?: number) => { sdfLayer.setTemporalStart(on, margin, slope); return sdfLayer.temporalStart; },
    get temporalStart() { return sdfLayer.temporalStart; },
```
HUD (~L4011): `(sdfLayer.temporalStart.on ? ' · TSTART' : '')`.

- [x] **Step 6: Run the contract tests, typecheck, commit**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/temporal-start.test.ts` — PASS.
Run: `npx tsc --noEmit -p .` — clean.
```bash
git add -A src/lab/sdf-zombie/webgpu
git commit -m "feat(march): temporal reprojection start wired — lastTex copy, march slot, __sdfGame.setTemporalStart / ?tstart=1 (ships OFF)"
```

- [x] **Step 7: GPU checks** (`__sdfGame.step` drives frames in a hidden pane)

1. Parity: `?tstart=0` (and the default) must be bit-identical — frozen-scene
   canvas readback region means equal to before, plus the HUD shows no TSTART.
2. Flip check: `setTemporalStart(true, 0.25)`, freeze the scene, a body in
   view. If bodies vanish or show holes where the MIRRORED screen row had
   nothing, the ndc y is flipped: change `tempNdc.y` to `1.0 - screenUV.y * 2.0`
   in Step 2, and pin whichever is right with a comment naming this check.
3. Look: walk and turn around a wounded body at `?tstart=1`; watch the
   silhouettes for one-frame notches when a limb swings toward the camera.
   If notches appear, raise `margin` (0.35, 0.5) and note the value.
4. **Bench (the gate):** `await __sdfGame.bench({ mode: 'passes', room: 4 })`
   with `?tstart=0` vs `?tstart=1` (boot each; the bench freezes/steps
   itself). Record the march pass median and p95 and the whole-frame GPU
   time for both; three repeats each. The win we expect is largest on the
   owner's stress case (many wounded bodies filling the screen). Report the
   table in the commit that flips the default, or the reason it stays OFF.

- [x] **Step 8: Owner decision** — ship ON (flip `tstartParam !== '0'`) or keep the knob. Record margin/slope chosen in `TEMPORAL_START_DEFAULTS` and the layer's cfg default together.

### Risks

- Starting PAST a surface that moved toward the camera by more than
  `margin` in one frame: a one-frame notch on that silhouette. Bounded by
  the margin; the bench must not be run with the margin at 0.
- The ndc/uv flip (Step 7.2). A wrong flip is loud, not subtle.
- Half-rate: hold frames do not blit, so the copy is the last fresh frame's;
  correct because the inverse VP is stored with it.
- The extra blit is one full-res copy per frame; the fetch is one load per
  ray. Both must show in the bench as noise.
