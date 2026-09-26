# Shared Light List — Plan 1 (bodies, crowd, bones, gibs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every SDF body, crowd member, bone mesh and gib chunk is lit by its own 4 strongest lights from one shared per-frame light list, with the owner's presentation rules as per-light profiles and a hard SDF self-shadow on the dominant light.

**Spec:** `docs/superpowers/specs/2026-09-26-shared-light-list-design.md`. Read it first.

**Architecture:**
- **Pure modules (renderer-free, unit-tested):** `light-list.ts` builds and packs the list, `light-pick.ts` chooses each body's 4 lights, and `light-profiles.ts` holds the presentation table.
- **The writer:** `stepDynamicLight` in `game-dynamic-light-leaves.ts` is the only thing that writes the GPU storage buffer.
- **The readers:** the march, the crowd records, the bone shader and `chunkShade` all read it through one shared WGSL include, `bodyLights`.
- **The old path** (`applyWindowKey` and friends) stays behind `?lightlist=0` until the owner signs off.

**Tech Stack:** TypeScript, three.js r186 WebGPU + TSL, WGSL string modules (`wgslFn`), Vitest, headless-Chrome CDP scripts (`scripts/*.mjs` + `scripts/lab-servers.sh`).

**Order:** Task 1 is a **look spike with an owner gate**. The rest of the plan starts only after the owner approves the self-shadow look from Task 1's screenshots. If the owner rejects it, stop and revise spec §6 with the owner before Task 2.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**: no `three` import, plain data in and plain data out (the `burn-state`, `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module only reads that logic's output and writes uniforms and objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). TSL node graphs are for thin glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module, never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic: seeded RNG, sim-time clocks, no wall-clock in logic. Console and capture seams stay plain data.
- Never `git stash`. `node_modules` is symlinked, so do not reinstall.
- **Targeted tests only** (`npx vitest run <paths>`), plus `npx tsc --noEmit`. Never run the bare full suite.
- **Headless capture only**, with `LAB_TMP=.lab-tmp` exported. The in-app browser pane loses the WebGPU device. Capture scripts require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance, dark fraction, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders reports cold-boot `drawOnce` against the base branch (`node scripts/boot-time.mjs`, fresh profile each run, two runs each).
- **WebGPU:**
  - Never toggle a light's `.visible`.
  - Never sample the render target you are writing.
  - In the march's positional uniform lists (`march/body/params.wgsl.ts`, `march/body/io.wgsl.ts`), never put a `:` inside a comment.
  - **Every new `mapBody(...)` call site inlines the whole body field** in the Metal compile (cold-compile finding, 2026-09-21), so reuse an existing call site rather than adding one.
- Kill anything you start outside a capture script in the same step.
- Frozen boots (`&frozen`) do not pose enemy equipment. Judge the look with the AI running, or ignore the equipment.

---

## Task 1: SPIKE — SDF self-shadow on the dominant key (owner look gate)

**Why first:** the owner wants to judge the look before the plumbing is built. Character self-shadow was **cut on cost grounds on 2026-09-01** (`docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md:45`). The wound soft shadow is **off by default** because it painted black rings at crater lips and cost about 50 ms close up (`lab-main.ts:3544-3551`). This spike avoids both failures:
- it marches the **smooth, wound-free field** (wound count forced to 0);
- it runs through the **existing** `woundShadow` call site, so no new `mapBody` inline;
- it is capped at 12 steps and a 0.6 m reach, and is off beyond 12 m from the camera.

The dominant light is today's key `L`: `applyWindowKey` already points `lightDir` at the window or the presenting tube, and the flashlight block blends `L` toward the beam. So the spike needs none of the list plumbing.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.ts:316-356` (`WOUND_SHADOW` gains `reach` and `steps` parameters).
- Modify: `src/lab/sdf-zombie/webgpu/march/body/blocks/light/occlusion.wgsl.ts:42-52` (one call site, two modes).
- Modify: `src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts:69-70,162` and `src/lab/sdf-zombie/webgpu/march/body/io.wgsl.ts:162` (`woundShadowCfg` goes from `vec2` to `vec4`).
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts:537-545` (default `Vector4`), `:854` (refine twin keeps z at 0).
- Create: `src/lab/sdf-zombie/webgpu/self-shadow.ts` (pure constants plus the per-body strength rule) and `src/lab/sdf-zombie/webgpu/self-shadow.test.ts`.
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts`: `applySelfShadow(u)`, the `setSelfShadow` seam, and `WINDOW_SHADOW_SIZE` goes 1024 → 512 (spec §6).
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:1965` (actors) and `:2114` (crowd type source): call `applySelfShadow`.
- Modify tests: `src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts:87,102,113,144` and `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts:657` (source pins).
- Create: `scripts/sdf-selfshadow-spike.mjs` and `scripts/sdf-selfshadow-spike.sh`.
- Create: `docs/dev-notes/2026-09-27-self-shadow-spike.md` (numbers plus a contact sheet for the owner).

- [ ] **Step 1: Write the failing pure test**

`src/lab/sdf-zombie/webgpu/self-shadow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SELF_SHADOW, selfShadowCfg } from './self-shadow';

describe('self-shadow cfg (spec §6)', () => {
  it('on by default: strength below 1 so shadowed flesh keeps some of the key', () => {
    const c = selfShadowCfg({ enabled: true });
    expect(c.strength).toBeGreaterThan(0);
    expect(c.strength).toBeLessThan(1);
    expect(c.reach).toBeCloseTo(SELF_SHADOW.reach);
  });
  it('the ?selfshadow=0 switch zeroes strength (z = 0 means the march skips it)', () => {
    expect(selfShadowCfg({ enabled: false }).strength).toBe(0);
  });
  it('caps the reach and never exceeds 12 steps', () => {
    const c = selfShadowCfg({ enabled: true, reach: 5 });
    expect(c.reach).toBeLessThanOrEqual(SELF_SHADOW.maxReach);
    expect(SELF_SHADOW.steps).toBeLessThanOrEqual(12);
  });
  it('the camera cut-off is 12 m', () => {
    expect(SELF_SHADOW.maxCamDist).toBe(12);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/self-shadow.test.ts`
Expected: FAIL, "Failed to resolve import './self-shadow'".

- [ ] **Step 3: Write the pure module**

`src/lab/sdf-zombie/webgpu/self-shadow.ts`:

```ts
// src/lab/sdf-zombie/webgpu/self-shadow.ts
//
// SDF SELF-SHADOW on the dominant light (shared light list spec §6). Pure: the tuning and the
// per-body uniform values. The march walks the SMOOTH (wound-free) body field toward the key
// light from each hit, through the existing woundShadow call site (one mapBody inline, not two).
// Strength below 1: the shadowed side keeps (1 - strength) of the key, the other lights, the
// fresnel rim and the body floor. Self-shadow must never make a black silhouette (owner rule).

export const SELF_SHADOW = {
  /** How much of the key the shadow removes (0..1). */
  strength: 0.7,
  /** How far toward the light the walk looks, metres; and its cap. */
  reach: 0.6,
  maxReach: 0.8,
  /** iq's penumbra factor: high = hard edge (the owner's harsh-tube look). */
  k: 24,
  /** Field samples per walk (the WGSL loop bound). */
  steps: 12,
  /** Off past this camera distance (distant bodies are fogged anyway). */
  maxCamDist: 12,
} as const;

export interface SelfShadowCfg { strength: number; reach: number; k: number }

export function selfShadowCfg(o: { enabled: boolean; strength?: number; reach?: number; k?: number }): SelfShadowCfg {
  return {
    strength: o.enabled ? Math.min(1, Math.max(0, o.strength ?? SELF_SHADOW.strength)) : 0,
    reach: Math.min(SELF_SHADOW.maxReach, Math.max(0.05, o.reach ?? SELF_SHADOW.reach)),
    k: Math.max(2, o.k ?? SELF_SHADOW.k),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/self-shadow.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Update the WGSL source pins first (failing)**

In `src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts`, replace each pinned `woundShadow(p, L, abs(woundShadowCfg.y), data, woundCfg, woundCfg2, ...)` string (lines 87 and 144) with the new call below. Change the gate pin at line 113 to `'if (wsOn || ssOn) {'`. Add one test after line 102:

```ts
  it('WOUND_SHADOW takes reach and steps, so one call site serves the wound and self shadow', () => {
    expect(WOUND_SHADOW).toContain('reach: f32,');
    expect(WOUND_SHADOW).toContain('if (i >= steps || res < 0.02 || t > reach) { break; }');
  });
```

The new pinned call string, used in both places:

```
woundShadow(p, L, wsK, data, wsCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg, wsReach, wsSteps)
```

In `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts:657`, change the pin to `'if (wsOn || ssOn) {'`.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`
Expected: FAIL on the changed pins.

- [ ] **Step 6: Give `woundShadow` a reach and a step count**

In `march/fields/wounds.wgsl.ts`, add two trailing parameters and use them. The wound path passes `0.4, 14`, so its arithmetic is unchanged.

```wgsl
  inst: ptr<storage, array<vec4<f32>>, read>,
  instCfg: vec4<f32>,
  reach: f32,
  steps: i32
) -> f32 {
  var res = 1.0;
  var t = 0.02;
  var ph = 1e10;
  for (var i = 0; i < 14; i = i + 1) {
    let h = mapBody(p + L * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x;
    let y = h * h / (2.0 * ph);
    let dd = sqrt(max(h * h - y * y, 0.0));
    res = min(res, k * dd / max(t - y, 1e-4));
    ph = h;
    if (i >= steps || res < 0.02 || t > reach) { break; }
    t = t + clamp(h, 0.01, 0.06);
  }
  return clamp(res, 0.0, 1.0);
}
```

Keep the existing comment block above the loop. The loop bound stays the literal 14, and `steps` only breaks early. A literal bound keeps the Metal unroll decision where it is today.

- [ ] **Step 7: One call site, two modes**

In `march/body/blocks/light/occlusion.wgsl.ts`, replace the `var wShadow = 1.0; if (woundShadowCfg.x > 0.0 && hitNearWound) { ... }` block with the code below. Keep the WOUND SOFT SHADOW comment above it, and append a paragraph pointing to spec §6 and `self-shadow.ts`.

```wgsl
  // SELF-SHADOW (shared light list spec §6, self-shadow.ts): the same walk over the SMOOTH
  // field (wound count 0, so no crater-lip rings), toward the key, hard edged, capped. The
  // wound shadow wins inside wound zones when both are on. woundShadowCfg z strength,
  // w reach; z = 0 (the lab, the refine twin, ?selfshadow=0) skips it.
  var wShadow = 1.0;
  let wsOn = woundShadowCfg.x > 0.0 && hitNearWound;
  let ssOn = woundShadowCfg.z > 0.0 && t < 12.0;
  if (wsOn || ssOn) {
    let wsK = select(24.0, abs(woundShadowCfg.y), wsOn);
    let wsCfg = select(vec4<f32>(0.0, woundCfg.yzw), woundCfg, wsOn);
    let wsReach = select(woundShadowCfg.w, 0.4, wsOn);
    let wsSteps = select(12, 14, wsOn);
    wShadow = mix(1.0, woundShadow(p, L, wsK, data, wsCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg, wsReach, wsSteps), select(woundShadowCfg.z, woundShadowCfg.x, wsOn));
  }
```

`t` here is the march's hit distance: it is the same `t` that `MARCH_BODY_LIGHT` returns in `.w`. Confirm that by reading `march/body/entry.wgsl.ts` before relying on it. If the hit distance has another name in scope, use that name, and also update the pin in Step 5.

`wShadow` already multiplies only the key diffuse and the key specular (`compose.wgsl.ts`: `diff * wShadow * lvl`, `shine * wShadow * lvl`). Ambient, fill, scatter and fresnel stay untouched, which is exactly the "never black" rule.

- [ ] **Step 8: Widen the uniform to vec4**

- `march/body/params.wgsl.ts:162` and `march/body/io.wgsl.ts:162`: change `woundShadowCfg: vec2<f32>,` to `woundShadowCfg: vec4<f32>,`.
- `params.wgsl.ts:69-70` doc comment: add a line `//                   z self-shadow strength (0 = off), w self-shadow reach m`. **No `:` in that comment.**
- `zombie-gpu.ts:545`: `woundShadowCfg: uniform(new THREE.Vector4(0.0, 12.0, 0.0, 0.6)),`. Extend its doc comment with z and w.
- `zombie-gpu.ts:854` (the refine twin): `const woundShadowCfg = uniform(new THREE.Vector4(0, u.woundShadowCfg.value.y, 0, 0));`.

`zombie-gpu.ts:3095` (`.value.copy(template...)`) works unchanged with a Vector4. Run `npx tsc --noEmit` and fix any other `Vector2` typing that `tsc` reports for `woundShadowCfg`.

- [ ] **Step 9: Run the pins and the type check**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts src/lab/sdf-zombie/webgpu/self-shadow.test.ts && npx tsc --noEmit`
Expected: PASS, and `tsc` is clean.

Then run the march tests: `npx vitest run src/lab/sdf-zombie/webgpu/march`.

`march/march-golden.test.ts` will fail, and that is expected. It is a **SHA-1 hash of the WGSL text**, not an image, and its header calls it a move-only gate ("never update"). This task changes the shader text on purpose, so:
- confirm that **only** hashes for the exports this task touched changed (`WOUND_SHADOW`, the body params/io, `MARCH_BODY_LIGHT`, `__HELPERS_joined`, and any export that interpolates them);
- then run `npx vitest run src/lab/sdf-zombie/webgpu/march/march-golden.test.ts -u`;
- say in the commit message that the golden moved on purpose, and why.

The previous deliberate update was the lightning-rim change on 2026-09-26.

- [ ] **Step 10: The game writes it**

In `game-dynamic-light-leaves.ts`, add near `applyWindowKey`:

```ts
import { selfShadowCfg, type SelfShadowCfg } from './self-shadow';

let selfShadow: SelfShadowCfg = selfShadowCfg({ enabled: new URLSearchParams(location.search).get('selfshadow') !== '0' });

/** Spec §6: the SDF self-shadow on the dominant key, for a body's (or a crowd type's) uniforms. */
export function applySelfShadow(u: { woundShadowCfg?: { value: THREE.Vector4 } }): void {
  const c = u.woundShadowCfg?.value;
  if (!c) return;
  c.z = selfShadow.strength;
  c.w = selfShadow.reach;
}
```

In `createDynamicLightSeams`, add a look-tuning seam next to `holdWindowLight`:

```ts
    /** Look tuning (spec §6): self-shadow strength/reach/k; enabled false = off. */
    setSelfShadow: (enabled: boolean, strength?: number, reach?: number, k?: number) => {
      selfShadow = selfShadowCfg({ enabled, strength, reach, k });
      return selfShadow;
    },
```

`k` goes live in the shader only in the full plan. In the spike, the WGSL uses the literal 24, so `k` is recorded but not applied. Say so in the notes.

At line 29, set `const WINDOW_SHADOW_SIZE = 512;` (spec §6: the owner said shadow quality can be sacrificed).

In `game-main.ts`:
- **At the actor site (line 1965), after `applyRoomFill`:** add `applySelfShadow(a.view.uniforms as never);`.
- **At the crowd site (line 2114), after the `applyWindowKey` line:** add `applySelfShadow(t.uniforms as never);`.
- **Imports:** add `applySelfShadow` to the existing import from `./game-dynamic-light-leaves`.

Run: `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/webgpu/game-context-coverage.test.ts`. If that file name differs, find the test that `npm test -- game-context-coverage` resolves to and run it.
Expected: clean. No new `main()` bindings: `selfShadow` is module state in the leaves file.

- [ ] **Step 11: The spike capture script**

`scripts/sdf-selfshadow-spike.sh`: copy `scripts/sdf-game-light-gate.sh` exactly, with these changes:
- ports `5299`/`9299`;
- the last line runs `node scripts/sdf-selfshadow-spike.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"`.

`scripts/sdf-selfshadow-spike.mjs`: copy lines 1-137 of `scripts/sdf-game-light-gate.mjs` verbatim (the CDP plumbing, `boot`, `decodePng`, `meanRgb`, `shoot`, `stats`, `settle`). Change the header comment to describe this spike, and the default ports to 5299/9299. Then append:

```js
const SHOTS = process.env.LIGHT_GATE_SHOT;
if (!SHOTS) fail('set LIGHT_GATE_SHOT to an output directory');
if (!(await boot('level=night-train&frozen&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.setFlashlight(false)');

/** Frame the actor nearest (x,z) from `back` metres in front of it (toward +z), eye height, looking at it. */
async function frameNearest(x, z, back = 2.4) {
  const actors = await evaluate('__sdfGame.actorDump()');
  const a = actors.filter((q) => q.pos).sort((p, q) => Math.hypot(p.pos[0] - x, p.pos[2] - z) - Math.hypot(q.pos[0] - x, q.pos[2] - z))[0];
  if (!a) fail('no actor');
  const cx = a.pos[0], cz = a.pos[2] + back;
  const yaw = Math.atan2(-(a.pos[0] - cx), -(a.pos[2] - cz));
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${yaw}, -0.12)`);
  return a;
}

/** Luminance over the body box, and the share of near-black pixels (the "no black hole" guard). */
function body(img) {
  const s = stats(img, 0.38, 0.2, 0.62, 0.8);
  return { mean: s.mean, std: s.std, dark: s.v.filter((v) => v < 0.04).length / s.v.length };
}

const scenes = [
  { name: 'tube-third', x: 0, z: -17.8, setup: '__sdfGame.holdWindowLight(0, -1)' },
  { name: 'tube-dining', x: 0, z: -37.0, setup: '__sdfGame.holdWindowLight(0, -1)' },
  { name: 'bolt-third', x: 0, z: -17.8, setup: '__sdfGame.holdWindowLight(32, -1)' },
];
const rows = [];
for (const sc of scenes) {
  await evaluate(sc.setup);
  const a = await frameNearest(sc.x, sc.z);
  const res = {};
  for (const on of [false, true]) {
    await evaluate(`__sdfGame.setSelfShadow(${on})`);
    await settle(900);
    res[on ? 'on' : 'off'] = body(await shoot(`ss-${sc.name}-${on ? 'on' : 'off'}`));
  }
  rows.push({ scene: sc.name, actor: a.id, dist: a.dist, ...res });
  console.log(`${sc.name}: off mean ${res.off.mean.toFixed(3)} std ${res.off.std.toFixed(3)} dark ${(res.off.dark * 100).toFixed(1)}% | on mean ${res.on.mean.toFixed(3)} std ${res.on.std.toFixed(3)} dark ${(res.on.dark * 100).toFixed(1)}%`);
}

// COST: the worst carriage (third class), A/B in the same frame state.
await evaluate('__sdfGame.holdWindowLight(0, -1)');
await evaluate('__sdfGame.setPose(0, -12.0, 0, -0.05)');
await evaluate('__sdfGame.setFrameCap(1)');
const cost = {};
for (const on of [false, true, false, true]) {
  await evaluate(`__sdfGame.setSelfShadow(${on})`);
  await settle(600);
  await evaluate('__sdfGame.timeDraws(3)');
  const t = []; for (let k = 0; k < 5; k++) t.push(await evaluate('__sdfGame.timeDraws(9)'));
  (cost[on ? 'on' : 'off'] ??= []).push(...t);
}
console.log('COST', JSON.stringify(cost));
writeFileSync(`${SHOTS}/selfshadow-spike.json`, JSON.stringify({ rows, cost }, null, 2));
console.log('DONE sdf-selfshadow-spike');
process.exit(0);
```

Before running it, read `timeDraws` in `src/lab/sdf-zombie/webgpu/game-seams-boot.ts:92` and confirm what it returns (a number of ms, or an object). If it returns an object, keep the whole object in `cost`, and read the GPU march ms from it in the notes.

- [ ] **Step 12: Run the spike**

```bash
mkdir -p .lab-tmp/selfshadow && LAB_TMP=.lab-tmp LIGHT_GATE_SHOT=$PWD/.lab-tmp/selfshadow bash scripts/sdf-selfshadow-spike.sh
```

Expected output:
- three scene lines, then `COST {...}`, then `DONE sdf-selfshadow-spike`;
- six PNGs in `.lab-tmp/selfshadow/`.

Look at every PNG yourself. Acceptance, all four must hold:
1. **Visible:** with it on, the body box's `std` rises over off in the tube scenes. That is more modelling. If it does not, the shadow is not firing: check `ssOn`, and check that the uniform reached the actor with `__sdfGame.crowdUniformDiff()` or `actorDump`.
2. **Never black:** `dark` (share of pixels under 0.04) rises by **at most 5 percentage points** in every scene.
3. **Mean held:** the body box `mean` drops by at most 25%.
4. **Cost:** the median `on` minus the median `off` at third class is **≤ 1.0 ms**. That leaves 0.5 ms of the spec's 1.5 ms ceiling for the light loop in later tasks.

If criterion 2 or 3 fails, lower `SELF_SHADOW.strength` in steps of 0.1 through the seam. If criterion 4 fails, drop `steps` to 8, then reach to 0.4. Re-run after each change and record every run in the notes.

- [ ] **Step 13: Boot time**

The shader text is what changed, so the base must be the old text, not a URL switch. Commit Step 15 first, then build the base worktree from the commit before it:

```bash
git worktree add .lab-tmp/ss-base HEAD~1
ln -s "$PWD/node_modules" .lab-tmp/ss-base/node_modules
(cd .lab-tmp/ss-base && node scripts/boot-time.mjs 5302 9302) ; (cd .lab-tmp/ss-base && node scripts/boot-time.mjs 5302 9302)
node scripts/boot-time.mjs 5301 9301 ; node scripts/boot-time.mjs 5301 9301
git worktree remove --force .lab-tmp/ss-base
```

Record all four JSON lines in the notes. Expected: `drawOnce` stays within run-to-run noise (about ±10%). A bigger rise means the extra `select` arguments changed the inline, and must be reported. Never use `git stash`.

- [ ] **Step 14: Notes and contact sheet for the owner**

Write `docs/dev-notes/2026-09-27-self-shadow-spike.md` with:
- the table of scene × off/on (mean, std, dark %);
- the cost medians;
- the boot-time lines;
- which tuning values shipped;
- the three on/off image pairs, copied into `docs/dev-notes/2026-09-27-self-shadow-spike/`. These are game renders of tracked assets, not Blood assets.

Then show the owner the pairs and **stop for the look gate**.

- [ ] **Step 15: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/self-shadow.ts src/lab/sdf-zombie/webgpu/self-shadow.test.ts \
  src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.ts src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/march/body/blocks/light/occlusion.wgsl.ts src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts \
  src/lab/sdf-zombie/webgpu/march/body/io.wgsl.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts \
  src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts src/lab/sdf-zombie/webgpu/game-main.ts \
  src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap \
  scripts/sdf-selfshadow-spike.mjs scripts/sdf-selfshadow-spike.sh docs/dev-notes/2026-09-27-self-shadow-spike.md docs/dev-notes/2026-09-27-self-shadow-spike
git commit -m "spike(light): SDF self-shadow on the dominant key through the woundShadow call site (spec §6); window shadow maps 512

march golden moved on purpose: WOUND_SHADOW gains reach/steps, woundShadowCfg vec2->vec4."
```

**OWNER GATE.** Tasks 2+ start only after the owner approves the look. Record the verdict and any tuning in the notes file.

---

## Shared facts for Tasks 2-13

Established by the 2026-09-26 file map. All paths are under `src/lab/sdf-zombie/webgpu/`.

**The GPU buffer layout (`light-list.ts` owns it):**

| layout | vec4s | contents |
|---|---|---|
| **One buffer, 153 vec4** | 0..23 | 8 profiles × 3 vec4 |
| | 24 | header: `x` light count, `yzw` spare |
| | 25..152 | 32 lights × 4 vec4 |
| **Profile, 3 vec4** | a | `(gain, viewBias, floor, backKey)` |
| | b | `(backRim, spec, shadow, specPow)` |
| | c | `(rimTint.rgb, 0)` |
| **Light, 4 vec4 (spec §4)** | 0 | `pos.xyz` (directional: the unit direction toward the light), `w` kind (0 point, 1 spot, 2 directional) |
| | 1 | `rgb` colour × intensity × level gain, with the tint applied; `w` range |
| | 2 | spot `axis.xyz`; `w` packed cone, `floor(cosOuter*1000) + cosInner*0.999` |
| | 3 | `x` profile id, `y` shadow slot (−1), `zw` spare |

- **Why 3 vec4 per profile:** the rim tint needs its own vec4, so this deviates from the spec's "2 vec4". Profile params that only the CPU uses (`edge`, `distFall`) never reach the GPU.
- **Why one buffer:** profiles and lights share it, so the march binds **one** new storage buffer and no new uniform arrays.

**Picks:** each body carries one vec4 of **four packed floats, `index + weight`**:
- `weight` in [0, 0.999] is the CPU's per-body strength for that light: feet coverage × distance falloff × facing falloff. Profile gain is applied in the shader, not here.
- `−1` means an empty slot.
- Slot 0 is the dominant light. WGSL decodes with `i32(floor(v))` and `fract(v)`.

The presentation rules are judged per body on the CPU, as `presentingLamp` does today. The shader only does per-pixel direction, wrap, highlight and rim. That is cheap, and it keeps today's tuned look.

**Where picks live:**
- **Every SDF body, single and crowd:** a new record vec4, `REC_LIGHTS = 16`, with `REC_VEC4S` going from 16 to 17 (`crowd-records.ts:8`). Single actors are one-slot crowds (`zombie-gpu.ts:2245-2252`), and `writeViewRecord` (`zombie-gpu.ts:1626-1648`) is the single writer.
- **Bone tubes:** instanced attribute (`bone-instancer.ts`, `INSTANCE_FLOATS` 18 → 22).
- **Bone meshes:** a new `InstancedBufferAttribute` `iLights` per batch (`skeleton-spike/mesh-renderer.ts`).
- **Baked chunks:** one uniform vec4 per chunk material.

**Gate:** `?lightlist=0` means the old path. The on/off flag lives in `lightListCfg.x`, a new march uniform `vec4`, positionally last before the new storage param. With x = 0 the march takes today's code path.

---

## Task 2: Presentation profiles (pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/light-profiles.ts`, `src/lab/sdf-zombie/webgpu/light-profiles.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { LIGHT_PROFILES, PROFILE_ID, PROFILE_VEC4S, packProfiles } from './light-profiles';

describe('light profiles (spec §5)', () => {
  it('has the six starting kinds, at most 8', () => {
    expect(Object.keys(PROFILE_ID)).toEqual(['tube', 'lamp', 'window', 'flashlight', 'muzzle', 'fire']);
    expect(LIGHT_PROFILES.length).toBeLessThanOrEqual(8);
  });
  it('tube starts from the tuned PRESENT constants', () => {
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!;
    expect(t.gain).toBe(1.3); expect(t.viewBias).toBe(0.3); expect(t.floor).toBe(0.18);
    expect(t.backKey).toBe(0.35); expect(t.backRim).toBe(2.5); expect(t.edge).toBe(1.25); expect(t.distFall).toBe(0.06);
  });
  it('window carries the cold lightning rim tint', () => {
    expect(LIGHT_PROFILES[PROFILE_ID.window]!.rimTint).toEqual([0.55, 0.75, 1.3]);
  });
  it('every shadow strength is below 1 (never a black hole)', () => {
    for (const p of LIGHT_PROFILES) expect(p.shadow).toBeLessThan(1);
  });
  it('packs 8 x 3 vec4 in the documented lane order', () => {
    const f = packProfiles();
    expect(f.length).toBe(8 * PROFILE_VEC4S * 4);
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!, o = PROFILE_ID.tube * 12;
    expect([...f.slice(o, o + 4)]).toEqual([t.gain, t.viewBias, t.floor, t.backKey].map(Math.fround));
    expect([...f.slice(o + 4, o + 8)]).toEqual([t.backRim, t.spec, t.shadow, t.specPow].map(Math.fround));
    expect([...f.slice(o + 8, o + 11)]).toEqual(t.rimTint.map(Math.fround));
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run src/lab/sdf-zombie/webgpu/light-profiles.test.ts`. Expected: FAIL, the import is not resolved.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/light-profiles.ts
//
// PRESENTATION PROFILES (shared light list spec §5). Pure. The owner's rule: presentation over
// realism: a flattering key, a fill, a rim, visible relief, never a flat black silhouette.
// One profile per light KIND, fixed in code; a level may scale a light's gain and tint
// (light-list.ts), never define profiles. GPU lanes: a (gain, viewBias, floor, backKey),
// b (backRim, spec, shadow, specPow), c (rimTint.rgb, 0). edge/distFall are CPU-only (pick).

export interface LightProfile {
  gain: number; viewBias: number; floor: number; backKey: number;
  backRim: number; rimTint: [number, number, number];
  edge: number; distFall: number;
  spec: number; specPow: number;
  /** Self-shadow strength when this light is dominant (spec §6); < 1. */
  shadow: number;
}

export const PROFILE_ID = { tube: 0, lamp: 1, window: 2, flashlight: 3, muzzle: 4, fire: 5 } as const;
export type ProfileName = keyof typeof PROFILE_ID;
export const PROFILE_VEC4S = 3;
export const MAX_PROFILES = 8;

const COLD_RIM: [number, number, number] = [0.55, 0.75, 1.3];
const WARM_RIM: [number, number, number] = [1.2, 0.8, 0.5];

export const LIGHT_PROFILES: readonly LightProfile[] = [
  // tube: game-dynamic-light-leaves.ts PRESENT (tuned with the owner 2026-09-26)
  { gain: 1.3, viewBias: 0.3, floor: 0.18, backKey: 0.35, backRim: 2.5, rimTint: COLD_RIM, edge: 1.25, distFall: 0.06, spec: 1.0, specPow: 24, shadow: 0.7 },
  // lamp (warm bulbs)
  { gain: 1.1, viewBias: 0.3, floor: 0.18, backKey: 0.4, backRim: 1.5, rimTint: WARM_RIM, edge: 1.25, distFall: 0.08, spec: 0.8, specPow: 20, shadow: 0.6 },
  // window / lightning: hard, cold, side rim (compose.wgsl.ts's lightning rim)
  { gain: 1.0, viewBias: 0.15, floor: 0.1, backKey: 0.5, backRim: 3.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0, spec: 1.2, specPow: 32, shadow: 0.8 },
  // flashlight: the beam is the key (flashlight.wgsl.ts), little bias, it is at the eye
  { gain: 1.0, viewBias: 0.0, floor: 0.1, backKey: 1.0, backRim: 0.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0.04, spec: 1.0, specPow: 24, shadow: 0.5 },
  // muzzle: compose.wgsl.ts flashDirect's warm colour lives in the light's rgb
  { gain: 1.0, viewBias: 0.0, floor: 0.0, backKey: 1.0, backRim: 0.5, rimTint: WARM_RIM, edge: 1.0, distFall: 0.2, spec: 0.5, specPow: 16, shadow: 0.0 },
  // fire
  { gain: 1.0, viewBias: 0.1, floor: 0.2, backKey: 0.6, backRim: 1.2, rimTint: WARM_RIM, edge: 1.0, distFall: 0.1, spec: 0.4, specPow: 12, shadow: 0.4 },
];

export function packProfiles(profiles: readonly LightProfile[] = LIGHT_PROFILES): Float32Array {
  const f = new Float32Array(MAX_PROFILES * PROFILE_VEC4S * 4);
  profiles.slice(0, MAX_PROFILES).forEach((p, i) => {
    f.set([p.gain, p.viewBias, p.floor, p.backKey, p.backRim, p.spec, p.shadow, p.specPow, ...p.rimTint, 0], i * 12);
  });
  return f;
}
```

- [ ] **Step 4: Run it.** Expected: PASS, 5 tests.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): presentation profiles per light kind (spec §5)"` with both files.

---

## Task 3: The light list (pure build + pack)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/light-list.ts`, `src/lab/sdf-zombie/webgpu/light-list.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { LIST_CAP, LIST_HEADER, LIST_LIGHTS_AT, LIST_VEC4S, buildLightList, packLightList, type LightSource } from './light-list';
import { PROFILE_ID } from './light-profiles';

const tube = (x: number, i: number): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, 0], color: [0.8, 0.9, 1], intensity: i, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), room: 3 });

describe('light list (spec §4)', () => {
  it('drops dark lights and caps at 32, keeping the strongest', () => {
    const src = Array.from({ length: 40 }, (_, i) => tube(i, i));   // i = 0 is dark
    const l = buildLightList(src);
    expect(l.length).toBe(LIST_CAP);
    expect(l.every(x => x.intensity > 0)).toBe(true);
    expect(Math.min(...l.map(x => x.intensity))).toBe(8);
  });
  it('is deterministic: ties keep source order', () => {
    const a = buildLightList([tube(1, 5), tube(2, 5)]);
    expect(a.map(x => x.pos[0])).toEqual([1, 2]);
  });
  it('folds the level gain and tint into the colour', () => {
    // intensity 2 x gain 1.5 = 3; the tint is normalised by its largest channel (hue only)
    const [l] = buildLightList([{ ...tube(0, 2), levelGain: 1.5, levelTint: [1, 0.5, 0.5] }]);
    expect(l!.color[0]).toBeCloseTo(0.8 * 3, 5);
    expect(l!.color[1]).toBeCloseTo(0.9 * 3 * 0.5, 5);
    expect(l!.color[2]).toBeCloseTo(1 * 3 * 0.5, 5);
    expect(l!.intensity).toBe(3);
  });
  it('packs the header and the documented lanes', () => {
    const f = packLightList(buildLightList([tube(1, 2)]));
    expect(f.length).toBe(LIST_VEC4S * 4);
    expect(f[LIST_HEADER * 4]).toBe(1);
    const o = LIST_LIGHTS_AT * 4;
    expect(f[o + 3]).toBe(1);                       // kind spot
    expect(f[o + 7]).toBe(6);                       // range
    expect(f[o + 12]).toBe(PROFILE_ID.tube);        // profile
    expect(f[o + 13]).toBe(-1);                     // no shadow slot in plan 1
    const cone = f[o + 11]!;
    expect(Math.floor(cone) / 1000).toBeCloseTo(Math.cos(0.6), 2);
    expect((cone - Math.floor(cone)) / 0.999).toBeCloseTo(Math.cos(0.45), 3);
  });
  it('directional lights store a unit direction', () => {
    const f = packLightList(buildLightList([{ kind: 'directional', profile: 'window', pos: [3, 1, 0], color: [1, 1, 1], intensity: 4, range: 0, room: -1 }]));
    const o = LIST_LIGHTS_AT * 4;
    expect(Math.hypot(f[o]!, f[o + 1]!, f[o + 2]!)).toBeCloseTo(1, 5);
    expect(f[o + 3]).toBe(2);
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL, the import is not resolved.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/light-list.ts
//
// THE SHARED LIGHT LIST (spec §4). Pure: every light that can touch a body, built once a frame
// from plain sources (the game's leaves read three's lights and hand them here), capped at 32
// by intensity (ties by source order: deterministic), packed into one GPU buffer together
// with the profile table (light-profiles.ts). Layout in the plan's "Shared facts".

import { MAX_PROFILES, PROFILE_ID, PROFILE_VEC4S, packProfiles, type ProfileName } from './light-profiles';

export type Vec3 = [number, number, number];
export type LightKind = 'point' | 'spot' | 'directional';
export const KIND_CODE: Record<LightKind, number> = { point: 0, spot: 1, directional: 2 };

export interface LightSource {
  kind: LightKind; profile: ProfileName;
  /** Position; for 'directional' the direction TOWARD the light. */
  pos: Vec3; color: Vec3; intensity: number; range: number;
  axis?: Vec3; cosOuter?: number; cosInner?: number;
  /** The room it lights (-1 = any). Picking skips lights for other rooms. */
  room: number;
  /** Level JSON per-light overrides (spec §5, option A). */
  levelGain?: number; levelTint?: Vec3;
}

export interface ListLight {
  kind: LightKind; profile: number; pos: Vec3; color: Vec3; intensity: number; range: number;
  axis: Vec3; cosOuter: number; cosInner: number; room: number;
}

export const LIST_CAP = 32;
export const LIST_HEADER = MAX_PROFILES * PROFILE_VEC4S;   // 24
export const LIST_LIGHTS_AT = LIST_HEADER + 1;             // 25
export const LIGHT_VEC4S = 4;
export const LIST_VEC4S = LIST_LIGHTS_AT + LIST_CAP * LIGHT_VEC4S;   // 153

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function buildLightList(src: readonly LightSource[]): ListLight[] {
  return src
    .map((s, i) => ({ s, i, e: s.intensity * (s.levelGain ?? 1) }))
    .filter(x => x.e > 0)
    .sort((a, b) => b.e - a.e || a.i - b.i)
    .slice(0, LIST_CAP)
    .map(({ s, e }) => {
      const t = s.levelTint ?? [1, 1, 1];
      const tl = Math.max(t[0], t[1], t[2], 1e-6);
      return {
        kind: s.kind, profile: PROFILE_ID[s.profile],
        pos: s.kind === 'directional' ? norm(s.pos) : [...s.pos] as Vec3,
        color: [s.color[0] * e * t[0] / tl, s.color[1] * e * t[1] / tl, s.color[2] * e * t[2] / tl],
        intensity: e, range: s.range,
        axis: norm(s.axis ?? [0, -1, 0]), cosOuter: s.cosOuter ?? -1, cosInner: s.cosInner ?? -1, room: s.room,
      };
    });
}

export function packLightList(list: readonly ListLight[], out = new Float32Array(LIST_VEC4S * 4)): Float32Array {
  out.set(packProfiles(), 0);
  out.fill(0, LIST_HEADER * 4);
  out[LIST_HEADER * 4] = list.length;
  list.forEach((l, i) => {
    const o = (LIST_LIGHTS_AT + i * LIGHT_VEC4S) * 4;
    const cone = Math.floor(Math.max(-1, l.cosOuter) * 1000) + Math.max(0, l.cosInner) * 0.999;
    out.set([l.pos[0], l.pos[1], l.pos[2], KIND_CODE[l.kind],
             l.color[0], l.color[1], l.color[2], l.range,
             l.axis[0], l.axis[1], l.axis[2], cone,
             l.profile, -1, 0, 0], o);
  });
  return out;
}
```

The tint is normalised by its largest channel, so a tint only changes hue and the gain carries brightness.

- [ ] **Step 4: Run it.** Expected: PASS, 5 tests.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): the shared light list, build and pack (spec §4)"`.

---

## Task 4: Picking each body's 4 lights (pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/light-pick.ts`, `src/lab/sdf-zombie/webgpu/light-pick.test.ts`
- Read first: `game-dynamic-light-leaves.ts` `presentingLamp` (about :427) and `PRESENT`. The weight below is that function's math, generalised to every kind. Keep its tested behaviour: coverage judged **at the feet**, a quick fall past the cone edge (`edge`), distance fall (`distFall`), a small floor inside range, and facing falloff (`backKey`).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildLightList, type LightSource } from './light-list';
import { lightWeight, pickLights, unpackPick } from './light-pick';

const tube = (x: number, z: number, i = 7): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, z], color: [0.8, 0.9, 1], intensity: i, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), room: 3 });
const body = (x: number, z: number, facing: [number, number] = [0, 1]) => ({ pos: [x, 0.9, z] as [number, number, number], room: 3, facing });

describe('pickLights (spec §4)', () => {
  it('a body under a tube gets it as the dominant light', () => {
    const list = buildLightList([tube(5, 0), tube(0, 0)]);
    const p = pickLights(list, body(0, 0));
    expect(list[p.idx[0]!]!.pos[0]).toBe(0);
  });
  it('two bodies under different tubes get different dominants (the crowd fix)', () => {
    const list = buildLightList([tube(-2, 0), tube(2, 0)]);
    expect(pickLights(list, body(-2, 0)).idx[0]).not.toBe(pickLights(list, body(2, 0)).idx[0]);
  });
  it('coverage is judged at the feet: a body at the pool edge is still lit, well outside it is not', () => {
    const list = buildLightList([tube(0, 0)]);
    const pool = 2.2 * Math.tan(0.6);
    expect(lightWeight(list[0]!, body(pool * 0.9, 0))).toBeGreaterThan(0.2);
    expect(lightWeight(list[0]!, body(pool * 2.5, 0))).toBeLessThan(0.05);
  });
  it('facing falloff: back to the light is dimmer, not black', () => {
    const list = buildLightList([{ ...tube(0, 0), kind: 'point', pos: [0, 1.5, 2] }]);
    const front = lightWeight(list[0]!, body(0, 0, [0, 1]));
    const back = lightWeight(list[0]!, body(0, 0, [0, -1]));
    expect(back).toBeLessThan(front);
    expect(back).toBeGreaterThan(0);
  });
  it('skips lights for another room; directional lights reach any body in their room', () => {
    const list = buildLightList([{ ...tube(0, 0), room: 9 }, { kind: 'directional', profile: 'window', pos: [1, 0.3, 0], color: [1, 1, 1], intensity: 20, range: 0, room: 3 }]);
    const p = pickLights(list, body(0, 0));
    expect(list[p.idx[0]!]!.kind).toBe('directional');
    expect(p.idx.slice(1)).toEqual([-1, -1, -1]);
  });
  it('packs index + weight, decodes back, -1 for empty; ties by index', () => {
    const list = buildLightList([tube(0, -1), tube(0, 1)]);
    const p = pickLights(list, body(0, 0, [1, 0]));   // side-on to both: an exact tie
    expect(p.idx.slice(0, 2)).toEqual([0, 1]);
    const d = unpackPick(p.packed);
    expect(d.map(x => x.index)).toEqual([0, 1, -1, -1]);
    expect(d[0]!.weight).toBeGreaterThan(0);
    expect(d[0]!.weight).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/light-pick.ts
//
// EACH BODY'S 4 LIGHTS (spec §4). Pure. A light's weight on a body is what it DELIVERS there,
// by the presentation rules tuned with the owner on 2026-09-26 (presentingLamp): spot coverage
// judged at the FEET (the visible pool; a chest-height cone is only ~1 m), a quick fall past
// the edge, distance fall, facing falloff (back to the light: dimmer, never black). The top 4
// by weight win, ties by list index. Packed as index + weight (weight < 1) per lane, -1 empty.

import { LIGHT_PROFILES } from './light-profiles';
import type { ListLight, Vec3 } from './light-list';

export interface PickBody { pos: Vec3; room: number; /** Unit xz facing. */ facing: [number, number] }
export interface Pick { idx: [number, number, number, number]; weight: [number, number, number, number]; packed: [number, number, number, number] }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const FEET_Y = 0.05;

export function lightWeight(l: ListLight, b: PickBody): number {
  if (l.room >= 0 && b.room >= 0 && l.room !== b.room) return 0;
  const prof = LIGHT_PROFILES[l.profile]!;
  let toL: Vec3, cover = 1, dist = 0;
  if (l.kind === 'directional') {
    toL = l.pos;
  } else {
    const d: Vec3 = [l.pos[0] - b.pos[0], l.pos[1] - b.pos[1], l.pos[2] - b.pos[2]];
    dist = Math.hypot(d[0], d[1], d[2]);
    if (l.range > 0 && dist > l.range) return 0;
    toL = [d[0] / (dist || 1), d[1] / (dist || 1), d[2] / (dist || 1)];
    if (l.kind === 'spot') {
      // Coverage at the feet: the ray from the lamp to the body's feet against the cone.
      const f: Vec3 = [b.pos[0] - l.pos[0], FEET_Y - l.pos[1], b.pos[2] - l.pos[2]];
      const fl = Math.hypot(f[0], f[1], f[2]) || 1;
      const c = (f[0] * l.axis[0] + f[1] * l.axis[1] + f[2] * l.axis[2]) / fl;
      // Full inside the inner cone; past the outer cone it lets go over span/edge (edge > 1:
      // quicker), squared for a soft shoulder.
      const span = Math.max(l.cosInner - l.cosOuter, 1e-4);
      const zero = l.cosOuter - span / Math.max(prof.edge, 1e-3);
      cover = clamp01((c - zero) / Math.max(l.cosInner - zero, 1e-4)) ** 2;
    }
  }
  const distFall = 1 / (1 + prof.distFall * dist * dist);
  const fl = Math.hypot(toL[0], toL[2]);
  const facingDot = fl > 1e-4 ? (toL[0] * b.facing[0] + toL[2] * b.facing[1]) / fl : 1;
  const facing = prof.backKey + (1 - prof.backKey) * clamp01(facingDot * 0.5 + 0.5);
  const lum = (l.color[0] * 0.2126 + l.color[1] * 0.7152 + l.color[2] * 0.0722);
  return cover * distFall * facing * lum;
}

export function pickLights(list: readonly ListLight[], b: PickBody): Pick {
  const scored = list.map((l, i) => ({ i, w: lightWeight(l, b) })).filter(x => x.w > 1e-4)
    .sort((a, c) => c.w - a.w || a.i - c.i).slice(0, 4);
  const top = scored[0]?.w ?? 1;
  const idx = [-1, -1, -1, -1] as Pick['idx'];
  const weight = [0, 0, 0, 0] as Pick['weight'];
  const packed = [-1, -1, -1, -1] as Pick['packed'];
  scored.forEach((s, k) => {
    idx[k] = s.i;
    // Relative to the dominant, so the shader's weight is a 0..1 share; the light's own
    // colour x intensity (list rgb) carries absolute brightness.
    weight[k] = Math.min(0.999, lightWeightShare(s.w, top));
    packed[k] = s.i + weight[k];
  });
  return { idx, weight, packed };
}

/** The dominant gets 0.999; the rest their share of it. */
function lightWeightShare(w: number, top: number): number { return w / top * 0.999; }

export function unpackPick(p: readonly number[]): { index: number; weight: number }[] {
  return p.map(v => (v < 0 ? { index: -1, weight: 0 } : { index: Math.floor(v), weight: v - Math.floor(v) }));
}
```

Worked check for the "pool edge" case: the feet angle is about 0.55 rad, so c ≈ 0.852. That gives zero = 0.825 − 0.06 = 0.765 and cover = ((0.852 − 0.765) / 0.135)² ≈ 0.41. Also, if `presentingLamp` has tests (`grep -rln presentingLamp src --include=*.test.ts`), port their cases here as extra checks.

The weight's meaning changed. It is a **share of the dominant light**, times the light's own absolute rgb in the list. So a dominant light at 0.999 lights a body at the light's rgb × profile gain, and the others at their share. **The spec is unaffected.** Document it in the file header.

- [ ] **Step 4: Run it.** Expected: PASS, 6 tests.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): per-body 4-light pick with the presentation rules (spec §4)"`.

---

## Task 5: Level JSON per-light gain and tint

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-level.ts:53-61` (`AccentLight`: add `gain?: number; tint?: Vec3`)
- Modify: `src/lab/sdf-zombie/webgpu/level-json.ts:42` (the keys list for `light`: add `'gain','tint'`) and `:328-348` (parse)
- Modify: `scripts/levels/export_level.py:285-293` (export the `gain` and `tint` custom props when present)
- Test: the existing `level-json` test file. Find it with `ls src/lab/sdf-zombie/webgpu/level-json*.test.ts`.

- [ ] **Step 1: Failing test.** In the level-json test file, add a case with a light carrying `"gain": 1.5, "tint": [1, 0.6, 0.6]`, and assert that the parsed accent has `gain: 1.5, tint: [1, 0.6, 0.6]`. Add a second case: a light without them parses with `gain` and `tint` undefined. Add a third: `"gain": -1` is rejected with the parser's existing error style (read how `power` is validated at :328-348 and mirror it).
- [ ] **Step 2: Run** the level-json test. Expected: FAIL.
- [ ] **Step 3: Implement** the parse, mirroring `power`: `gain` a finite number ≥ 0; `tint` a 3-array of finite numbers ≥ 0. In `export_level.py`, after `mood` and `fixture`:

```python
        if "gain" in ob.keys():
            out["gain"] = float(ob["gain"])
        if "tint" in ob.keys():
            out["tint"] = [round(float(c), 4) for c in ob["tint"]]
```

Match the variable names that function actually uses (`ob`, `out`, or the local names).
- [ ] **Step 4: Run** the level-json test and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(level): per-light gain and tint in level JSON (spec §5 option A)"`.

---

## Task 6: The GPU buffer and its single writer

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts`, `src/lab/sdf-zombie/webgpu/game-light-list-leaves.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts`:
  - `DynamicLightRuntime` (:67) gains `list: LightListGpu`;
  - `createDynamicLight` (:98) creates it;
  - add a `lightList()` seam in `createDynamicLightSeams`.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`: call `writeLightList(ctx, directFlashes)` right after `directFlashes` is complete. That is after `ctx.vfx.burning.pushFlashes(directFlashes)` at about :1925, and before the per-actor loop at :1936.
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts:728-737`: add `fallbackLightListNode()` next to `fallbackProbeDyn`.

- [ ] **Step 1: Failing test (the source collector is pure)**

`collectLightSources(input)` takes plain data and returns `LightSource[]`. Test it with plain objects:

```ts
import { describe, expect, it } from 'vitest';
import { collectLightSources } from './game-light-list-leaves';

describe('collectLightSources', () => {
  it('maps lamps, tubes, window light, flashlight and flashes to typed sources', () => {
    const s = collectLightSources({
      lamps: [{ pos: [0, 2, 0], color: [1, 0.8, 0.6], intensity: 3, range: 8, room: 2, tube: null, gain: undefined, tint: undefined, mood: 'steady' },
              { pos: [1, 2.2, 0], color: [0.8, 0.9, 1], intensity: 7, range: 6, room: 2, tube: { axis: [0, -1, 0], cosOuter: 0.82, cosInner: 0.9 }, gain: 1.5, tint: undefined, mood: 'flicker' }],
      window: { dir: [0.9, 0.3, 0.15], color: [0.72, 0.82, 1], intensity: 20, room: 2 },
      flashlight: { pos: [0, 1.6, 0], axis: [0, 0, -1], color: [1, 1, 1], intensity: 90, range: 16, cosOuter: 0.8, cosInner: 0.93 },
      flashes: [{ pos: [0, 1.4, -1], intensity: 35, fire: false }, { pos: [3, 1, 0], intensity: 5, fire: true }],
    });
    expect(s.map(x => `${x.kind}:${x.profile}`)).toEqual(['point:lamp', 'spot:tube', 'directional:window', 'spot:flashlight', 'point:muzzle', 'point:fire']);
    expect(s[1]!.levelGain).toBe(1.5);
    expect(s[3]!.room).toBe(-1);
  });
  it('a lamp with mood fire gets the fire profile; zero-intensity sources are kept (the list drops them)', () => {
    const s = collectLightSources({ lamps: [{ pos: [0, 1, 0], color: [1, 0.6, 0.3], intensity: 0, range: 5, room: 1, tube: null, mood: 'fire' }], window: null, flashlight: null, flashes: [] });
    expect(s[0]!.profile).toBe('fire');
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement** `game-light-list-leaves.ts` in three parts:

1. **`collectLightSources(input: SourceInput): LightSource[]`, pure.** No `three` import in this function's types: `SourceInput` is plain arrays.
2. **`readSourceInput(ctx, directFlashes): SourceInput`, the three.js reader.**
   - Lamps: `ctx.world.light.lamps` (`Lamp` at `game-dynamic-light-leaves.ts:53`). For each, take:
     - `light.getWorldPosition`, `light.color`, `light.intensity` (already mood-levelled);
     - range from `light.distance` (0 means 12);
     - `room`, `mood`;
     - `tube` from `lamp.tube?.spot`: axis = normalised (target − position); cosOuter = `cos(angle)`; cosInner = `cos(angle * (1 − penumbra))`;
     - `gain`/`tint` from the level accent. Add `gain` and `tint` to the `flickerLights` record type (`game-state-lighting.ts:49`), filled at `game-main.ts:794-826` from the parsed `AccentLight`.
   - Window: `ctx.world.light.storm` (`dir`, `color`, `intensity`), with the room from `ctx.world.light.windowLights` (the room of the player's carriage, or the key whose light is live).
   - Flashlight: `ctx.lighting.flashlight.spot`, only when its intensity > 0.
   - Flashes: `directFlashes`. Read its element type at `game-main.ts:1906-1925` and mark burning entries (`pushFlashes`) as `fire: true`. If entries carry no such flag, add one in `game-burning.ts:457`.
3. **`createLightListGpu()` and `writeLightList(ctx, directFlashes)`.**
   - `createLightListGpu()`:
     ```ts
     const floats = new Float32Array(LIST_VEC4S * 4);
     const attr = new THREE.StorageBufferAttribute(floats, 4);
     attr.setUsage(THREE.DynamicDrawUsage);
     const node = storage(attr, 'vec4', LIST_VEC4S).toReadOnly();
     return { floats, attr, node, list: [] as ListLight[] };
     ```
     This is the `crowd-records.ts:69-73` pattern. Import `storage` from `three/tsl`, as that file does.
   - `writeLightList`: `rt.list.list = buildLightList(collectLightSources(readSourceInput(ctx, directFlashes)))`, then `packLightList(rt.list.list, rt.list.floats)`, then `rt.list.attr.needsUpdate = true`.

The fallback in `zombie-gpu.ts`: `fallbackLightListNode()` holds `LIST_VEC4S` zeros, so the light count is 0 and the march binding is never null (the `zombie-gpu.ts:1448-1449` rule).

The seam `lightList()` returns `rt.list.list` as plain data: `{ kind, profile, pos, intensity, room }` per light.

- [ ] **Step 4: Run** the new test, `npx vitest run src/lab/sdf-zombie/webgpu/game-state-world.test.ts src/lab/sdf-zombie/webgpu/game-state-lighting.test.ts`, and `npx tsc --noEmit`. Expected: PASS. **No binding-count change**, because the list lives inside the existing `light` runtime object. If a count moves, you added a `main()` binding: move it onto `ctx`.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): the list's GPU buffer, filled once a frame from every light source"`.

---

## Task 7: Picks in the instance record (`REC_LIGHTS`)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/crowd-records.ts`:
  - `REC_LIGHTS = 16` and `REC_VEC4S = 17` (:8, :11-33);
  - `RecordSource` (:42-54) gains `lights?: readonly number[]`;
  - `write` (:80-99) writes it, defaulting to `[-1,-1,-1,-1]`.
- Modify: `src/lab/sdf-zombie/webgpu/march/fields/groups.wgsl.ts`:
  - a new global `var<private> gInstLights: vec4<f32>;` next to `gInstBurn` (:267-295);
  - in `loadInstance` (:329-365), `gInstLights = (*inst)[base + ${REC_LIGHTS}];`.
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`:
  - `defaultUniforms` gains `bodyLights: uniform(new THREE.Vector4(-1, -1, -1, -1))`. It is **not** bound to the march (the record carries it); it is a per-view holding slot, like `bodyFlash`;
  - `writeViewRecord` (:1626-1648) copies `u.bodyLights.value.toArray()` into `lights`.
- Test: the crowd-records test (`ls src/lab/sdf-zombie/webgpu/crowd-records*.test.ts`) and `march/fields/groups` pins.

- [ ] **Step 1: Failing test.** In the crowd-records test:
  - `REC_VEC4S === 17`;
  - `write(slot, { ...minimalSource, lights: [0.9, 2.5, -1, -1] })` puts those four floats at `(slot * 17 + 16) * 4`;
  - a source without `lights` writes `[-1,-1,-1,-1]`.

  In the groups test, pin `'gInstLights = (*inst)[base + 16];'`. Match how the file interpolates the REC constants, and how its existing pins do.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Also update the doc comment at `crowd-records.ts:25-28` ("slot 16 is the light picks, spec §4").
- [ ] **Step 4: Run** the crowd-records, groups and `zombie-gpu` tests, plus `npx tsc --noEmit`. The march golden moves (the `groups` text changed). Check that only the expected exports moved, then update it with `-u`, the same procedure as Task 1 Step 9.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): REC_LIGHTS — every body's picks ride its instance record (march golden moved on purpose)"`.

---

## Task 8: The `bodyLights` WGSL include and its CPU reference

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/light-shade.ts` (pure CPU reference), `src/lab/sdf-zombie/webgpu/light-shade.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/march/body-lights.wgsl.ts`, `src/lab/sdf-zombie/webgpu/march/body-lights.wgsl.test.ts`

The two files implement **the same math**. The WGSL is the shipping path; the TS reference exists so the presentation rules are unit-tested, and it is the port reference.

**The math, per picked light k (skipping `index < 0`):**
```
L    = directional ? pos : normalize(pos - p)
Lb   = normalize(mix(L, V, viewBias))
wrap = max((dot(n, Lb) + floor) / (1 + floor), 0)
H    = normalize(Lb + V)
spec = spec * pow(max(dot(n, H), 0), specPow)
side = max(dot(n, L), 0)
back = clamp(-dot(L, V) * 0.5 + 0.5, 0, 1)        // light behind the body, seen from the camera
rim  = backRim * pow(1 - max(dot(n, V), 0), 4) * max(side, back * 0.5) * rimTint
c    = rgb * weight * gain
out.diffuse += c * wrap
out.spec    += c * spec
out.rim     += c * rim
```
- Slot 0 also returns `domL = L` and `domC = c`. They drive the march's existing key path: scatter, wound and self-shadow, and the highlight shoulder.
- The per-light cone and distance are already in the CPU `weight`. The shader does not re-evaluate them, so a body is lit as a whole by a light and does not get cut by a cone edge. That is today's `presentingLamp` behaviour, which the owner approved.

- [ ] **Step 1: Failing CPU tests** in `light-shade.test.ts`, one per rule:
  - **The floor keeps a terminator lit:** at n·L = 0 with floor 0.18, `diffuse > 0`.
  - **View bias:** a light behind the body, with `viewBias 0.3`, still gives some front `wrap`, and 0 bias gives less.
  - **Rim:** with the light behind the body and a grazing normal, `rim > 0`; for a normal facing the camera, `rim ≈ 0`.
  - **Empty slots add nothing:** picks `[-1,-1,-1,-1]` give all zeros.
  - **Weight scales linearly:** half the weight gives half the output.

  Write each with concrete vectors: `n=[0,0,1]`, `V=[0,0,1]`, and so on.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `light-shade.ts`**, exporting `shadeBodyLights(p, n, V, picks, list: Float32Array, skipFirst = false)`. It returns `{ diffuse, spec, rim, domL, domC, domShadow, domFloor }` and reads **the packed buffer** (`light-list.ts` offsets), so it tests the packing too. Add a sixth test to Step 1: with `skipFirst`, `diffuse` and `spec` equal the full sums minus slot 0's contribution, and `rim` is unchanged.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Implement the WGSL.** `body-lights.wgsl.ts` exports `BODY_LIGHTS`, a single `fn`, per the repo's one-fn-per-string rule:

```wgsl
struct BodyLit { diffuse: vec3<f32>, spec: vec3<f32>, rim: vec3<f32>, domL: vec3<f32>, domC: vec3<f32>, domShadow: f32, domFloor: f32 }

// skipFirst: slot 0's diffuse and spec are left out of the sums (the march shades the dominant
// through its own key path); its rim and its dom* fields are still returned.
fn bodyLights(p: vec3<f32>, n: vec3<f32>, V: vec3<f32>, picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, skipFirst: bool) -> BodyLit {
  var o: BodyLit;
  o.domL = vec3<f32>(0.0, 1.0, 0.0);
  o.domShadow = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    let pv = picks[k];
    if (pv < 0.0) { continue; }
    let li = i32(floor(pv));
    let w = fract(pv);
    let base = ${LIST_LIGHTS_AT} + li * ${LIGHT_VEC4S};
    let a = (*lights)[base];
    let col = (*lights)[base + 1];
    let meta = (*lights)[base + 3];
    let pr = i32(meta.x) * ${PROFILE_VEC4S};
    let pa = (*lights)[pr];
    let pb = (*lights)[pr + 1];
    let pc = (*lights)[pr + 2];
    let L = select(normalize(a.xyz - p), a.xyz, a.w > 1.5);
    let Lb = normalize(mix(L, V, pa.y));
    let wrap = max((dot(n, Lb) + pa.z) / (1.0 + pa.z), 0.0);
    let H = normalize(Lb + V);
    let sp = pb.y * pow(max(dot(n, H), 0.0), pb.w);
    let side = max(dot(n, L), 0.0);
    let back = clamp(-dot(L, V) * 0.5 + 0.5, 0.0, 1.0);
    let rim = pb.x * pow(1.0 - max(dot(n, V), 0.0), 4.0) * max(side, back * 0.5);
    let c = col.rgb * (w * pa.x);
    if (!(skipFirst && k == 0)) {
      o.diffuse = o.diffuse + c * wrap;
      o.spec = o.spec + c * sp;
    }
    o.rim = o.rim + c * pc.rgb * rim;
    if (k == 0) { o.domL = L; o.domC = c; o.domShadow = pb.z; o.domFloor = pa.z; }
  }
  return o;
}
```

  `${...}` are the TS constants from `light-list.ts` and `light-profiles.ts`. If `wgslFn` rejects a struct return in this codebase, return the six values through `vec4`s in a small fixed array instead. Check how other `wgslFn`s in `march/` return multiple values, and follow that.
- [ ] **Step 6: WGSL pins** in `body-lights.wgsl.test.ts`:
  - pin the offsets: the string contains `${LIST_LIGHTS_AT} + li * 4` after interpolation, i.e. `25 + li * 4`;
  - pin `pr + 2`;
  - pin the `if (pv < 0.0) { continue; }` guard and the `if (!(skipFirst && k == 0))` gate;
  - add a **parity test**: the TS reference and the WGSL text use the same lane for every param. Assert that the WGSL reads `pa.x` as gain, `pa.y` viewBias, `pa.z` floor, `pb.x` backRim, `pb.y` spec, `pb.z` shadow, `pb.w` specPow, `pc.rgb` rimTint. This matches `packProfiles`' order.
- [ ] **Step 7: Run** both tests. Expected: PASS.
- [ ] **Step 8: Commit.** `git commit -m "feat(light): bodyLights — the 4-light presentation loop (WGSL) and its CPU reference"`.

Task 11 (bones) and Task 12 (chunks) call it with `skipFirst = false`, and Task 9 (the march) with `true`.

---

## Task 9: The march reads the list (behind `?lightlist`)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts`: append, **positionally last**, `lightListCfg: vec4<f32>,` and `lightList: ptr<storage, array<vec4<f32>>, read>`. Follow the no-parens-no-colons comment rule (:187-207).
- Modify: `src/lab/sdf-zombie/webgpu/march/body/io.wgsl.ts`:
  - `MARCH_IN_STRUCT` gains `lightListCfg: vec4<f32>,` in matching order, plus a gap comment `// (lightList stays positional — a storage pointer)`;
  - update the header count (99 → 101 parameters; 13 → 14 positional, storage ptrs 4 → 5).
- Modify: `src/lab/sdf-zombie/webgpu/march/helpers.ts`: include `BODY_LIGHTS`.
- Create: `src/lab/sdf-zombie/webgpu/march/body/blocks/light/light-list.wgsl.ts`: the `LIGHT_LIST_BLOCK`, spliced into `MARCH_BODY_LIGHT` (`march/body/light.wgsl.ts`) right after `${FLASHLIGHT_BLOCK}`.
- Modify: `src/lab/sdf-zombie/webgpu/march/body/light.wgsl.ts`: `let diff` becomes `var diff`; splice in the block.
- Modify: `src/lab/sdf-zombie/webgpu/march/body/blocks/light/compose.wgsl.ts`: add the extra lights to `fleshLit`.
- Modify: `src/lab/sdf-zombie/webgpu/march/body/blocks/light/occlusion.wgsl.ts`: in list mode the self-shadow strength comes from `bl.domShadow` × `woundShadowCfg.z`.
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`:
  - `defaultUniforms` gains `lightListCfg: uniform(new THREE.Vector4(0, 0, 0, 0))`;
  - `callMarch` (:1287-1463) passes `lightListCfg: u.lightListCfg` and `lightList: (sources.lightList ?? fallbackLightListNode()) as never`, **after** `inst`/`instCfg` and the rest, in parameter order;
  - `CrowdMaterialSources` (:1606-1613) gains `lightList?: { node: unknown }`, used where `probeDyn` is used (:1747).
- Modify: every other caller of `MARCH_BODY_PARAMS`:
  - `march/body/entry.wgsl.ts:113` (`REFINE_PARAMS`);
  - `deferred-sdf.ts:163` (`marchSurface`);
  - find the rest with `grep -rn "marchBody(\|marchSurface(\|MARCH_BODY_PARAMS" src/lab/sdf-zombie/webgpu`.

  Each passes the fallback node and `vec4(0)`, **except** the game's march materials.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:3098` and `src/lab/sdf-zombie/webgpu/game-crowd-leaves.ts:46`: pass `lightList: { node: ctx.world.light.list.node }` beside `probeDyn`. The light runtime must exist before the crowd materials are built. If it doesn't, create the GPU list earlier, at boot, and keep `createDynamicLight` filling it.
- Tests: `march/body/io.wgsl.test.ts` (struct vs list), and a new `march/body/blocks/light/light-list.wgsl.test.ts`.

**`LIGHT_LIST_BLOCK`:**

```wgsl
  // ---- SHARED LIGHT LIST (spec §4-§5) ------------------------------------
  // lightListCfg.x > 0: this body is lit by its 4 picked lights (gInstLights, REC_LIGHTS).
  // Slot 0, the dominant, REPLACES the key (L, keyC, keyI), so scatter, the wound and self
  // shadow, and the shoulder follow it; slots 1-3 and every rim are added in compose.
  // At x = 0 nothing here runs and the old key path is untouched.
  var listDiff = vec3<f32>(0.0);
  var listSpec = vec3<f32>(0.0);
  var listRim = vec3<f32>(0.0);
  var listShadow = 1.0;
  var listDomFloor = 0.0;
  if (lightListCfg.x > 0.0) {
    let bl = bodyLights(p, n, -rd, gInstLights, lightList, true);
    let peak = max(bl.domC.x, max(bl.domC.y, bl.domC.z));
    L = bl.domL;
    keyC = bl.domC / max(peak, 1e-4);
    keyI = peak;
    listDiff = bl.diffuse;
    listSpec = bl.spec;
    listRim = bl.rim;
    listShadow = bl.domShadow;
    listDomFloor = bl.domFloor;
  }
```

`n` and `rd` are in scope here: `FLASHLIGHT_BLOCK` uses `p`, and `light.wgsl.ts` uses `n` and `rd` right after it. Albedo is applied in compose, where `albedo` is certainly in scope.

**The dominant's wrap:** in `light.wgsl.ts`, change `let diff = max(dot(n, L), 0.0);` to:

```wgsl
  var diff = max(dot(n, L), 0.0);
  if (lightListCfg.x > 0.0) { diff = max((dot(n, L) + listDomFloor) / (1.0 + listDomFloor), 0.0); }
```

**Compose** (`compose.wgsl.ts`), right after the `var fleshLit = ...;` statement:

```wgsl
  // SHARED LIGHT LIST: the other 3 lights and every light's back rim (spec §5). Through AO, not
  // the wound/level shadow (those belong to the dominant). Zero when the list is off.
  fleshLit = fleshLit + (listDiff * albedo + listSpec) * ao + listRim;
```

The lightning side-rim block (`if (spotCfg2.w > 0.0)`) stays. In list mode the game writes `spotCfg2.w = 0`, and the window profile's rim takes over.

**Occlusion** (`occlusion.wgsl.ts`, in Task 1's block): use `select(woundShadowCfg.z, woundShadowCfg.z * listShadow, lightListCfg.x > 0.0)` as the self-shadow strength. Note that `LIGHT_LIST_BLOCK` runs **before** `OCCLUSION_BLOCK` (flashlight → list → occlusion), so `listShadow` is in scope.

- [ ] **Step 1: Failing pins.**
  - `io.wgsl.test.ts`: the struct and list agree, with the new names.
  - `light-list.wgsl.test.ts`:
    - `LIGHT_LIST_BLOCK` contains `if (lightListCfg.x > 0.0) {` and `bodyLights(p, n, -rd, gInstLights, lightList, true)`;
    - `MARCH_BODY_LIGHT` contains `${FLASHLIGHT_BLOCK}` followed by the list block;
    - the compose line `fleshLit = fleshLit + (listDiff * albedo + listSpec) * ao + listRim;` is present.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** everything above.
- [ ] **Step 4: Run** the march tests (`npx vitest run src/lab/sdf-zombie/webgpu/march`), the `zombie-gpu` tests, and `npx tsc --noEmit`. The golden moves: verify only the expected exports changed, then update it with `-u`.
- [ ] **Step 5: GPU smoke.** Run `LAB_TMP=.lab-tmp bash scripts/sdf-game-light-gate.sh`. With `lightListCfg.x` still 0 everywhere (Task 10 turns it on), the gate must pass unchanged. That proves the bindings compile, and that the off path is intact.
- [ ] **Step 6: Boot time.** Run the Task 1 Step 13 procedure against the commit before this task. Report `drawOnce`. A rise over noise is expected to be small: the loop is ALU only and has no `mapBody`. If it's over +15%, report it before continuing.
- [ ] **Step 7: Commit.** `git commit -m "feat(light): the march reads the shared list behind lightListCfg (off by default; march golden moved on purpose)"`.

---

## Task 10: The game turns it on for bodies and crowds

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts`: `LIGHT_LIST_ON = new URLSearchParams(location.search).get('lightlist') !== '0'`, plus `applyBodyLights(ctx, u, body: PickBody)`, which writes `u.bodyLights` (the packed pick) and `u.lightListCfg.x = 1`.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`, the actor site at :1965 and the crowd site at :2114.
  - When `LIGHT_LIST_ON`:
    - call `applyBodyLights` with `{ pos: a.pose().pos, room: a.room, facing: <the actor's unit xz facing, from its yaw> }`;
    - **skip** `applyWindowKey`, `applyRoomFill` and `applyStormBodyKey` for SDF bodies;
    - set `u.bodyFlash.value.w = 0` (the muzzle is now a list light: no double count);
    - keep `applySelfShadow`.
  - Otherwise: today's code.
  - Read how the actor's yaw is exposed. The record has `REC_NOISE_YAW.w = bodyYaw`, so the view knows it. Use the same source.
  - The per-body pick happens **before** `a.view.syncRecord()` (:1971), so the record carries it this frame.
  - **Crowd members:** every crowd member is an actor with its own record, so its picks are its own. The type-shared `lightListCfg` is set once on the crowd type's source uniforms. `copyUniformValues` copies it; check that the copy includes `lightListCfg`, and add it if the copy is an explicit list.
- Modify: `src/lab/sdf-zombie/webgpu/game-state-*.ts` only if `tsc` or the coverage test demands it. Nothing new should be a `main()` binding.

- [ ] **Step 1: Failing test (pure part).** Add to `game-light-list-leaves.test.ts`: `facingFromYaw(yaw)` returns a unit xz vector matching the repo's yaw convention. Take the convention from `setPose`'s camera math, or from the actor's forward in `game-ai` leaves. Pin two angles.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the pure part and the wiring.
- [ ] **Step 4: Run** the unit tests, `npx tsc --noEmit`, and `LAB_TMP=.lab-tmp bash scripts/sdf-game-light-gate.sh`. The gate passes, and the list is now **on**.
- [ ] **Step 5: Extend the light gate** (`scripts/sdf-game-light-gate.mjs`) with a section 7, "THE SHARED LIST":
  - `__sdfGame.lightList()` is non-empty in third class, and ≤ 32.
  - **Crowd fix:** add a seam `bodyPicks()` returning `{ id, room, picks }` per actor (next to `lightList` in the seams). Two crowd actors in the same carriage, under different tubes (x apart by more than 1.5 m), have different `picks[0]` indices.
  - **Luminance under a tube:** frame the nearest actor under a tube (Task 1's `frameNearest`, copied in). The body-box mean must be ≥ 0.9 × the `?lightlist=0` value at the same pose. This is **not darker than today**. It needs a second boot with `lightlist=0` at the end of the gate.
  - **Never black:** the body box's dark share (< 0.04) is ≤ 15% in the tube, bolt (`holdWindowLight(32,-1)`) and flashlight scenes.
- [ ] **Step 6: Run** the gate. Expected: `PASS sdf-game-light-gate`. Look at the shots.
- [ ] **Step 7: Commit.** `git commit -m "feat(light): bodies and crowds lit by their own 4 lights from the shared list (?lightlist=0 = old path)"`.

---

## Task 11: Bones and bone meshes read the same lights

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/bone-instancer.ts`:
  - `INSTANCE_FLOATS` 18 → 22 (:24), plus a new attribute `iLights` (vec4) beside iA/iB/iC/iR/iScale/iQ (:251-258), read via `attribute('iLights', 'vec4')`;
  - `BONE_SHADE_WGSL` (:169) gains `picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, listOn: f32`.
    - When `listOn > 0.5`, the key term is replaced by `bodyLights(p, n, V, picks, lights, false)`: `diffuse * deepColor + spec + rim`.
    - Otherwise, today's key.
  - `boneInstancerUniforms()` (:220-236) gains `lightListCfg` (vec4).
- Modify: `src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts`:
  - each batch's `THREE.InstancedMesh` gets `geometry.setAttribute('iLights', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4))`. Grow it with the batch's capacity (:210-236), and write it beside `setMatrixAt`, using the owning actor's pick;
  - the eye batch does the same;
  - the shade call (:168-174) passes `picks: attribute('iLights','vec4')`, the list node and `u.lightListCfg.x`.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:1989-2007`. When the list is on, drop the `applyWindowKey(ctx, ..., playerPos)` calls for the bone instancer and the seg renderer, and set their `lightListCfg.x = 1`. The picks come from each bone's owner actor: the bone instancer and the mesh renderer already know the owner per instance (they cull by actor exposure). Pass `ownerPicks: (actorId) => number[]`, read from the actor view's `bodyLights` uniform.
- Tests: `bone-instancer` and `skeleton-spike/mesh-renderer` tests (the existing files `mesh-renderer.test.ts`, `mesh-eyes.test.ts`, `mesh.test.ts`, `contract.test.ts`).

- [ ] **Step 1: Failing tests.**
  - `INSTANCE_FLOATS === 22`, and the `iLights` offset is 18.
  - The mesh renderer writes the owner's pick into `iLights` for an instance. Use the existing tests' fake actor, and give it `bodyLights: [0.9, -1, -1, -1]`.
  - `BONE_SHADE_WGSL` contains `bodyLights(p, n, V, picks, lights, false)` under `if (listOn > 0.5)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The bone shader includes `BODY_LIGHTS` as a `wgslFn` include; pass the proxy the way `CHUNK_SHADE_WGSL` passes its includes.
- [ ] **Step 4: Run** the tests, `tsc`, and the light gate. Add a gate check: fire the gun (`__sdfGame` has a fire seam; find it with `grep -n "fire\|shoot" src/lab/sdf-zombie/webgpu/game-seams*.ts`) at a skeleton-exposed actor. Its `bodyPicks()` must include a muzzle-profile light during the flash. This is the **"skull catches the muzzle flash"** case from spec §1. Take a screenshot pair (flash vs no flash) of a skull, and the skull's crop mean must rise.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): bone tubes and bone meshes shade with their owner's 4 lights"`.

---

## Task 12: Gib chunks

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/baked-chunks.ts`:
  - `chunkShadeWgsl` (:188, light block :263-277) gains `picks`, `lights` and `listOn`, with the same replacement as the bones;
  - `bakedChunkUniforms()` (:54-71) gains `chunkLights` (vec4, default −1s) and `lightListCfg`;
  - bind them at :489-491.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:2044-2069`. For each `ctx.world.litChunkMaterials` entry, when the list is on:
  - pick at the entry's position with `pickLights`, facing `[0, 1]`, since chunks have no facing: the facing falloff is irrelevant for scattered gore;
  - write `chunkLights`, and skip `applyWindowKey`.
  - Read `game-bake-leaves.ts:25` to find what an entry is and where its position lives. If one entry covers many chunks, use their centroid. **Record this as a deviation from spec §4** ("pick at the chunk's own position"), because chunks share a material.
- Live chunk **views** (marched, `game-main.ts:1977-1986`) are SDF bodies with records: give them `applyBodyLights` like actors, with the room from the chunk's position (`inRoom`) and facing `[0,1]`.
- Tests: the `baked-chunks` tests.

- [ ] **Step 1: Failing test.** `CHUNK_SHADE_WGSL` contains the `listOn` branch and the `bodyLights(` call. `bakedChunkUniforms()` has `chunkLights` defaulting to `(-1,-1,-1,-1)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `tsc`, and the light gate. Then blow up a zombie under a tube with the explosion seam (`scripts/sdf-explosion-light-check.mjs` shows how), and screenshot the gibs: they must read lit by the tube, not by a global key.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): gib chunks pick their lights (per chunk material)"`.

---

## Task 13: Budget, owner look check, docs

**Files:**
- Modify: `scripts/sdf-game-light-gate.mjs`: a **cost** section.
- Create: `docs/dev-notes/2026-09-27-shared-light-list.md`
- Modify: `TASKS.md` and `docs/tasks/rendering.md`: part 3 plan 1 status.

- [ ] **Step 1: The cost gate.** Add a section 8 at the end of the light gate:
  - boot `lightlist=1`, then `lightlist=0` (fresh navigations);
  - at third class `(0, -12.0, 0, -0.05)` and at the Boiler Room `(0, -96.0, 0, 0)`, take `__sdfGame.timeDraws(9)` five times after 3 warm-up frames, with the frame cap at 1 and `holdWindowLight(0, -1)`, as in Task 1 Step 11;
  - **fail** if the median `on − off` is **> 1.5 ms** in either carriage (spec §7).
- [ ] **Step 2: Run** the gate. If it fails, cut the self-shadow in the spec's order (half resolution, then reach, then steps) and re-run. Record every run.
- [ ] **Step 3: The owner's look check.** Run the gate with `LIGHT_GATE_SHOT` set, and add A/B pairs (`lightlist=1` vs `0`) at:
  - third class under a tube;
  - the dining car during a held bolt;
  - the Boiler Room;
  - the flashlight on a crowd;
  - a skull during a muzzle flash.

  Put them in `docs/dev-notes/2026-09-27-shared-light-list/` with the numbers.

  Also try the tube shadow maps at 256² (spec §6): set the tube's `shadow.mapSize` in `makeTube` (`game-dynamic-light-leaves.ts`) to 256, and add one pair at third class, 512 vs 256. Keep 256 only if the owner approves that pair.
- [ ] **Step 4: Docs.**
  - Write the dev note: what shipped, the numbers, the deviations (profile 3 vec4, weight as a share of the dominant, chunks per material), and the A/B switch.
  - `TASKS.md` front page: part 3 plan 1 "done pending owner sign-off", with a link to the note.
  - `docs/tasks/rendering.md`: the detail, and plan 2 next.
- [ ] **Step 5: Commit.** `git commit -m "docs(light): shared light list plan 1 — numbers, A/B pairs, deviations; cost gate"`.
- [ ] **Step 6: STOP for the owner.** Show the A/B pairs.
  - On sign-off, a follow-up commit deletes the old path: `applyWindowKey`, `presentingLamp`, `strongestLamp`, `applyRoomFill`, `applyStormBodyKey`, the `spotCfg2.w` rim block in `compose.wgsl.ts`, and the `?lightlist=0` switch. It then updates the golden and the gates.
  - Do not delete before sign-off.

---

## Self-review against the spec

| spec | task |
|---|---|
| §4 list, 32 cap, 4 vec4, sources | 3, 6 |
| §4 picking at the feet, ties, dominant | 4 |
| §4 single + crowd + bones + gibs read picks | 7, 10, 11, 12 |
| §4 replaces the hand-wired feeds, A/B `?lightlist=0` | 10 (A/B), 13 (deletion after sign-off) |
| §5 profiles fixed per kind + level gain/tint | 2, 5 |
| §5 loop, the dominant drives field terms, global fresnel and floor kept | 8, 9 (fresnel and BODY_DARK_FLOOR untouched: they live outside `fleshLit`'s key terms) |
| §5 golden held for the one-light gallery | 9: `lightListCfg.x` is 0 in the lab, so the lab image is unchanged. The **text** hash moves and is documented |
| §6 self-shadow, window maps 512 | 1, 9 (profile shadow) |
| §6 tube maps 256 tried | 13 (Step 3) |
| §7 +1.5 ms ceiling, gate | 1 (≤ 1.0 ms spike budget), 13 |
| §8 tests | throughout |

**Deviations from the spec, all to be recorded in the Task 13 dev note:**
- profiles are 3 vec4, not 2;
- the pick weight is a share of the dominant light;
- chunks pick per material;
- the golden is text, so it moves deliberately rather than being held.
