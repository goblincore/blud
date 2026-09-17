# Flame Lab Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `sdf-flame-lab` page plus the per-body burn plumbing, the surface fire/char shading, the fire light, glow, heat distortion and shutter blur — so a burning zombie and soldier can be looked at and tuned, with no flame tongues yet.

**Architecture:** Burn is a per-body value that reaches the SDF march two ways, exactly as the existing rupture-gore ramp does: a per-view uniform (`burnCfg`) for single-body draws and crowd record slot 15 (`REC_BURN`) for merged crowd draws, combined in the shader with `max()`. The march paints fire and char onto the body surface using the rest-space `anchor` already computed there, and publishes its emissive contribution through a private var read by the lighting tail. A new standalone page assembles the existing WebGPU lab's blocks (renderer, `createSdfLayer`, `createPostAa`, `createCharacterView`, hand-driven motion) and adds the game's shutter layer and a flicker light. Post effects are new passes in `post-aa.ts` fed by pure, unit-tested modules.

**Tech stack:** TypeScript, three.js WebGPU (`three/webgpu`) with TSL node materials, WGSL string modules, Vite, Vitest (happy-dom), Chrome DevTools Protocol capture scripts.

**Spec:** [`docs/superpowers/specs/2026-09-17-burning-enemies-flame-lab-design.md`](../specs/2026-09-17-burning-enemies-flame-lab-design.md)

**Follow-up plans (written after this one lands, each adding one tongue technique to this lab):**
screen-space tongues, flame cards + atlas, volumetric band. This plan deliberately
ships the engulfed *surface* look only.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/burn-state.ts` (create) | Pure burn state: ignite/extinguish ramp, char accumulation. No three.js. |
| `src/lab/sdf-zombie/burn-state.test.ts` (create) | Its tests. |
| `src/lab/sdf-zombie/webgpu/burn-profiles.ts` (create) | `BurnTuning` record, presets, `resolveBurnTuning` clamp. Shared by lab, panel and (later) game. |
| `src/lab/sdf-zombie/webgpu/burn-profiles.test.ts` (create) | Its tests. |
| `src/lab/sdf-zombie/webgpu/crowd-records.ts` (modify) | Add `REC_BURN = 15` and write it. |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (modify) | Add the `burnCfg` uniform, bind it positionally, carry burn in `writeViewRecord`. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (modify) | `gInstBurn` / `gBurnEmit` privates, `fireRamp`, the surface fire+char block, the emissive fold. |
| `sdf-flame-lab.html` (create) | The page shell. |
| `src/lab/sdf-zombie/webgpu/flame-lab-main.ts` (create) | The lab host: two bodies, motion, burn driving, draw chain. |
| `src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts` (create) | Source tripwires for the page wiring. |
| `src/lab/sdf-zombie/webgpu/flame-panel.ts` (create) | Tuning panel: key table, sliders, presets, COPY. |
| `src/lab/sdf-zombie/webgpu/flame-panel.test.ts` (create) | Anti-drift: every panel key is handled by the page setter. |
| `src/lab/sdf-zombie/webgpu/burn-light.ts` (create) | Pure fire-light flicker + intensity envelope. |
| `src/lab/sdf-zombie/webgpu/burn-light.test.ts` (create) | Its tests. |
| `src/lab/sdf-zombie/webgpu/post-glow.ts` (create) | The glow pass's WGSL + pure threshold/weight helpers. |
| `src/lab/sdf-zombie/webgpu/post-glow.test.ts` (create) | Its tests. |
| `src/lab/sdf-zombie/webgpu/post-aa.ts` (modify) | Run the glow pass; accept burn distortion sources. |
| `src/lab/sdf-zombie/webgpu/burn-distort.ts` (create) | Pure heat-wobble band + strength, mirrored by the blit shader. |
| `src/lab/sdf-zombie/webgpu/burn-distort.test.ts` (create) | Its tests. |
| `scripts/flame-capture.mjs` (create) | Headless pose captures for side-by-side judging. |
| `vite.config.ts` (modify) | Register the new page in the build input map. |
| `TASKS.md` (modify) | Status row. |

**Conventions to follow (verified in this repo):**
- Tests are co-located `<module>.test.ts`; run with `npm test` (`vitest run`). Vitest config lives inside `vite.config.ts:117-141` (`environment: 'happy-dom'`, includes `src/**/*.test.ts` and `scripts/**/*.test.ts`).
- Type check with `npx tsc --noEmit` (this is what `npm run build` runs first).
- No `Math.random()` in render/FX code — everything seeded.
- WebGPU transparency: alpha in `colorNode.w`, additive for fire, **never** `alphaHash`, **never** `alphaTest` (see the header of `explosion-vfx.ts:28-57`).

---

## Task 1: Pure burn state

**Files:**
- Create: `src/lab/sdf-zombie/burn-state.ts`
- Test: `src/lab/sdf-zombie/burn-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/burn-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBurnState, igniteBurn, extinguishBurn, stepBurn } from './burn-state';

const T = { igniteSec: 0.5, extinguishSec: 0.25, charRate: 0.4 };

describe('burn state', () => {
  it('starts cold', () => {
    const s = createBurnState();
    expect(s).toEqual({ burn: 0, burnSec: 0, char: 0, alight: false });
  });

  it('ramps burn to 1 over igniteSec and no further', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 0.25, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, 0.25, T);
    expect(s.burn).toBeCloseTo(1, 6);
    stepBurn(s, 1, T);
    expect(s.burn).toBe(1);
  });

  it('accumulates burnSec and char only while burning, and char never falls', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);            // burn saturates at 1 partway through
    expect(s.burnSec).toBeCloseTo(1, 6);
    const charAtOne = s.char;
    expect(charAtOne).toBeGreaterThan(0);
    extinguishBurn(s);
    stepBurn(s, 1, T);            // decays to cold
    expect(s.burn).toBe(0);
    expect(s.char).toBeGreaterThanOrEqual(charAtOne);
    const cold = s.char;
    stepBurn(s, 5, T);            // cold bodies stop accumulating
    expect(s.char).toBe(cold);
    expect(s.burnSec).toBe(0);
  });

  it('char saturates at 1', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 60, T);
    expect(s.char).toBe(1);
  });

  it('decays to 0 over extinguishSec and survives junk dt', () => {
    const s = createBurnState();
    igniteBurn(s);
    stepBurn(s, 1, T);
    extinguishBurn(s);
    stepBurn(s, 0.125, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, Number.NaN, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
    stepBurn(s, -3, T);
    expect(s.burn).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/burn-state.test.ts
```

Expected: FAIL — `Failed to resolve import "./burn-state"`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/burn-state.ts`:

```ts
// src/lab/sdf-zombie/burn-state.ts
//
// HOW ALIGHT A BODY IS — the whole burn model, pure and three-free so the lab,
// the tests and (spec 2) the game's actors all step the same numbers.
//
// Three values, because the look needs three different clocks:
//   burn    0..1  how much fire is on the body RIGHT NOW. Ramps up when lit,
//                 decays when put out, and is what the shader scales fire by.
//   burnSec       seconds of continuous burning, for the flame noise phase, so
//                 two bodies lit at different times do not flicker in lockstep.
//   char    0..1  accumulated blackening. MONOTONIC: a body that burned and was
//                 put out stays charred, which is the difference between a
//                 burnt corpse and a clean one.

export interface BurnState {
  burn: number;
  burnSec: number;
  char: number;
  alight: boolean;
}

/** The subset of BurnTuning this module needs; BurnTuning is a superset. */
export interface BurnRates {
  igniteSec: number;
  extinguishSec: number;
  charRate: number;
}

export function createBurnState(): BurnState {
  return { burn: 0, burnSec: 0, char: 0, alight: false };
}

export function igniteBurn(s: BurnState): void { s.alight = true; }

export function extinguishBurn(s: BurnState): void { s.alight = false; }

export function stepBurn(s: BurnState, dt: number, t: BurnRates): BurnState {
  if (!Number.isFinite(dt) || dt <= 0) return s;
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (s.alight) {
    s.burn = clamp01(s.burn + dt / Math.max(1e-3, t.igniteSec));
  } else {
    s.burn = clamp01(s.burn - dt / Math.max(1e-3, t.extinguishSec));
  }
  if (s.burn > 0) {
    s.burnSec += dt;
    s.char = clamp01(s.char + dt * t.charRate * s.burn);
  } else {
    s.burnSec = 0;
  }
  return s;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/burn-state.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/burn-state.ts src/lab/sdf-zombie/burn-state.test.ts
git commit -m "Add pure burn state for burning bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Burn tuning profiles

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/burn-profiles.ts`
- Test: `src/lab/sdf-zombie/webgpu/burn-profiles.test.ts`

Follows `impact-splash-profiles.ts` exactly: a flat record, named presets, and a
`resolve*` clamp that refuses non-finite input.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/burn-profiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BURN_TUNING, burnPresets, resolveBurnTuning } from './burn-profiles';

describe('burn tuning', () => {
  it('resolves to the defaults when given nothing', () => {
    expect(resolveBurnTuning()).toEqual(BURN_TUNING);
  });

  it('bounds runtime inputs without propagating non-finite values', () => {
    const r = resolveBurnTuning({
      igniteSec: Number.NaN, charRate: Number.POSITIVE_INFINITY,
      fireGain: 999, noiseScale: -5, lightPeak: -1,
    });
    expect(r.igniteSec).toBe(BURN_TUNING.igniteSec);
    expect(r.charRate).toBe(BURN_TUNING.charRate);
    expect(r.fireGain).toBe(4);
    expect(r.noiseScale).toBe(0.5);
    expect(r.lightPeak).toBe(0);
  });

  it('keeps every preset inside the clamp (a preset must be reachable)', () => {
    for (const [name, preset] of Object.entries(burnPresets)) {
      expect(resolveBurnTuning(preset), name).toEqual(preset);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-profiles.test.ts
```

Expected: FAIL — cannot resolve `./burn-profiles`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/webgpu/burn-profiles.ts`:

```ts
// src/lab/sdf-zombie/webgpu/burn-profiles.ts
//
// THE TUNING RECORD for burning bodies, shared by the flame lab, its panel and
// (spec 2) the game, so a look tuned in the lab is the same look in the game.
// Pattern copied from impact-splash-profiles.ts: flat numbers, named presets,
// one clamp that non-finite input cannot get through.

export interface BurnTuning {
  /** Seconds from ignition to fully alight. */
  igniteSec: number;
  /** Seconds from extinguish to cold. */
  extinguishSec: number;
  /** Char accumulated per second at full burn (1 = fully black). */
  charRate: number;
  /** Emissive multiplier on the surface fire. */
  fireGain: number;
  /** Rest-space frequency of the fire noise (higher = finer flame cells). */
  noiseScale: number;
  /** Rest-space units per second the fire noise scrolls upward. */
  riseSpeed: number;
  /** How much of the surface stays dark char at full burn, 0..1. */
  charPatch: number;
  /** Peak intensity of the per-body fire light. */
  lightPeak: number;
  /** Fire-light flicker depth, 0..1. */
  lightFlicker: number;
  /** Glow (bloom) gain applied to the extracted bright pass. */
  glowGain: number;
  /** Luminance above which a pixel contributes to glow. */
  glowThreshold: number;
  /** Peak heat-wobble offset, in UV units. */
  distortStrength: number;
}

export const BURN_TUNING: BurnTuning = {
  igniteSec: 0.45, extinguishSec: 0.8, charRate: 0.22,
  fireGain: 1.6, noiseScale: 7, riseSpeed: 1.8, charPatch: 0.35,
  lightPeak: 26, lightFlicker: 0.35,
  glowGain: 0.5, glowThreshold: 0.75,
  distortStrength: 0.006,
};

export const burnPresets: Record<'blood' | 'ember' | 'inferno', BurnTuning> = {
  // Closest to the NotBlood burning-run frames: bright, busy, mostly fire.
  blood: { ...BURN_TUNING },
  // Late-stage: mostly charred with fire only in the cracks.
  ember: { ...BURN_TUNING, charRate: 0.5, fireGain: 1.1, charPatch: 0.6, lightPeak: 14, glowGain: 0.35 },
  // Over the top, for judging the ceiling of the effect.
  inferno: { ...BURN_TUNING, fireGain: 2.6, noiseScale: 5, riseSpeed: 2.6, charPatch: 0.2, lightPeak: 42, glowGain: 0.8, distortStrength: 0.012 },
};

export function resolveBurnTuning(p: Partial<BurnTuning> = {}): BurnTuning {
  const bounded = (v: number | undefined, fallback: number, min: number, max: number) =>
    v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    igniteSec: bounded(p.igniteSec, BURN_TUNING.igniteSec, 0.05, 4),
    extinguishSec: bounded(p.extinguishSec, BURN_TUNING.extinguishSec, 0.05, 4),
    charRate: bounded(p.charRate, BURN_TUNING.charRate, 0, 2),
    fireGain: bounded(p.fireGain, BURN_TUNING.fireGain, 0, 4),
    noiseScale: bounded(p.noiseScale, BURN_TUNING.noiseScale, 0.5, 40),
    riseSpeed: bounded(p.riseSpeed, BURN_TUNING.riseSpeed, 0, 8),
    charPatch: bounded(p.charPatch, BURN_TUNING.charPatch, 0, 1),
    lightPeak: bounded(p.lightPeak, BURN_TUNING.lightPeak, 0, 120),
    lightFlicker: bounded(p.lightFlicker, BURN_TUNING.lightFlicker, 0, 1),
    glowGain: bounded(p.glowGain, BURN_TUNING.glowGain, 0, 2),
    glowThreshold: bounded(p.glowThreshold, BURN_TUNING.glowThreshold, 0, 4),
    distortStrength: bounded(p.distortStrength, BURN_TUNING.distortStrength, 0, 0.035),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-profiles.test.ts
```

Expected: PASS, 3 tests. If the "preset is reachable" test fails, a preset value
is outside its clamp — fix the preset, not the clamp.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/burn-profiles.ts src/lab/sdf-zombie/webgpu/burn-profiles.test.ts
git commit -m "Add burn tuning record, presets and clamp" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Crowd record slot for burn

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/crowd-records.ts` (slot constants ~8-30, `RecordSource` ~39-48, `write()` ~68-97)
- Modify: `src/lab/sdf-zombie/webgpu/crowd-records.test.ts` (the slot list ~11-13, the write case ~20-37)

Slot 15 is the last free vec4 (`// 15 spare` today). It becomes
`(burn, burnSec, char, 0)`.

- [ ] **Step 1: Extend the existing tests**

In `src/lab/sdf-zombie/webgpu/crowd-records.test.ts`:

1. Add `REC_BURN` to the import list from `./crowd-records`.
2. Add `REC_BURN` to the `rows` array in the first test (the distinctness check).
3. In the `write` test's record literal, add `burn: 0.6, burnSec: 2.5, charAmount: 0.25,`.
4. Add this test at the end of the `describe`:

```ts
  it('carries the burn ramp, its clock and the char amount in slot 15', () => {
    // The lab and (spec 2) the game drive burn per BODY, and the crowd shares
    // one material, so a burning body can only wear fire through its record --
    // the same reason REC_GORE exists.
    const r = createCrowdRecords(2);
    r.write(1, {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 0, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 0, 0], variantSeed: 0, bodyHalf: [0, 0, 0], damageRevision: 0, gore: 0,
      burn: 0.6, burnSec: 2.5, charAmount: 0.25,
    });
    const base = 1 * REC_VEC4S * 4;
    expect(r.floats[base + REC_BURN * 4]).toBeCloseTo(0.6, 6);
    expect(r.floats[base + REC_BURN * 4 + 1]).toBeCloseTo(2.5, 6);
    expect(r.floats[base + REC_BURN * 4 + 2]).toBeCloseTo(0.25, 6);
    expect(r.floats[base + REC_BURN * 4 + 3]).toBe(0);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/crowd-records.test.ts
```

Expected: FAIL — `REC_BURN` is not exported.

- [ ] **Step 3: Add the slot**

In `crowd-records.ts`, replace the `// 15 spare` comment line with:

```ts
/** BURNING BODY: x = burn 0..1, y = seconds alight, z = char 0..1, w spare.
 *  Per-body and not per-view for the same reason as REC_GORE above: the crowd
 *  shares one material, so a single burning body needs its own ramp. */
export const REC_BURN = 15;        // burn, burnSec, char, spare
```

In the `RecordSource` interface, add:

```ts
  burn: number;
  burnSec: number;
  charAmount: number;
```

In `write()`, immediately after the `put4(b + REC_GORE * 4, ...)` line, add:

```ts
      put4(b + REC_BURN * 4, [s.burn, s.burnSec, s.charAmount, 0]);
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/crowd-records.test.ts
```

Expected: PASS. TypeScript will now flag the two `writeViewRecord` callers'
missing fields — Task 4 fixes that. Confirm with:

```bash
npx tsc --noEmit
```

Expected: errors only about the missing `burn` / `burnSec` / `charAmount` in
`zombie-gpu.ts`'s `records.write` call.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/crowd-records.ts src/lab/sdf-zombie/webgpu/crowd-records.test.ts
git commit -m "Add burn slot to crowd records" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The burn uniforms and record write

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`defaultUniforms` last entry ~628, the positional binding objects ~1216-1245, `writeViewRecord` ~1522-1541)
- Test: `src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts` (create)

**Critical:** the uniform objects passed to `wgslFn` are bound **positionally**
against the WGSL parameter list (`zombie-gpu.ts:1225-1227`). Append `burnCfg`
**last** in every binding object, and append its parameter **last** in
`MARCH_BODY_PARAMS` (Task 5), so no existing pair shifts.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts`:

```ts
// Source tripwires for the burn uniform's positional binding. A misplaced key
// hands the shader a DIFFERENT uniform and fails silently (zombie-gpu.ts:1225),
// so the contract is pinned by text, in the only place it is visible.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { MARCH_BODY_PARAMS } from './march.wgsl';

const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');

const BURN_SCALARS = ['burnNoiseScale', 'burnRiseSpeed', 'burnCharPatch', 'burnFireGain'];

describe('burn uniform plumbing', () => {
  it('declares the burn uniforms', () => {
    expect(src).toContain('burnCfg: uniform(new THREE.Vector4(0, 0, 0, 0))');
    for (const name of BURN_SCALARS) expect(src).toContain(`${name}: uniform(`);
  });

  it('binds the burn uniforms last, in the same order as the WGSL tail', () => {
    // The WGSL parameter list ends with burnCfg then the four scalars, so every
    // positional binding object must end with them in that order.
    const params = MARCH_BODY_PARAMS.replace(/\s+/g, ' ');
    const order = ['burnCfg: vec4<f32>', ...BURN_SCALARS.map(n => `${n}: f32`)];
    let at = -1;
    for (const p of order) {
      const next = params.indexOf(p);
      expect(next, p).toBeGreaterThan(at);
      at = next;
    }
    expect(params).toMatch(/burnFireGain: f32,?\s*\)/);
    const binds = [...src.matchAll(/burnCfg: u\.burnCfg,/g)];
    expect(binds.length).toBeGreaterThan(0);
    for (const name of BURN_SCALARS) expect(src).toContain(`${name}: u.${name},`);
  });

  it('carries the body burn state into the crowd record', () => {
    expect(src).toContain('burn: u.burnCfg.value.x');
    expect(src).toContain('burnSec: u.burnCfg.value.y');
    expect(src).toContain('charAmount: u.burnCfg.value.z');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts
```

Expected: FAIL on the first assertion (no `burnCfg` uniform yet).

- [ ] **Step 3: Add the uniforms, the bindings and the record write**

1. In `defaultUniforms`, after the `bodyFlash` entry (the current last entry,
   `zombie-gpu.ts:628`), add:

```ts
    /** BURNING BODY (flame lab): x = burn 0..1, y = seconds alight, z = char
     *  0..1, w spare. Per VIEW, so a single body burns through this; crowd
     *  instances burn through REC_BURN. */
    burnCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** Rest-space frequency of the fire noise. */
    burnNoiseScale: uniform(7),
    /** Rest-space units per second the fire noise scrolls upward. */
    burnRiseSpeed: uniform(1.8),
    /** How much of a charred surface stays dark instead of burning, 0..1. */
    burnCharPatch: uniform(0.35),
    /** Emissive multiplier on the surface fire. */
    burnFireGain: uniform(1.6),
```

   These four are per-view tuning, not per-body state, which is why they are
   plain scalars and stay out of the record.

2. Find every positional binding object handed to a march `wgslFn` — locate them
   with:

```bash
grep -n "organAmp: u.organAmp" src/lab/sdf-zombie/webgpu/zombie-gpu.ts
```

   In each of those objects, append as the **last** keys, in this order:

```ts
    burnCfg: u.burnCfg,
    burnNoiseScale: u.burnNoiseScale,
    burnRiseSpeed: u.burnRiseSpeed,
    burnCharPatch: u.burnCharPatch,
    burnFireGain: u.burnFireGain,
```

3. In `writeViewRecord`, inside the `records.write(slot, { ... })` literal, after
   the `gore: u.lodCfg.value.w,` line, add:

```ts
    // The per-instance half of the burn ramp, for the same reason as `gore`:
    // burnCfg is per VIEW and the crowd shares one material.
    burn: u.burnCfg.value.x, burnSec: u.burnCfg.value.y, charAmount: u.burnCfg.value.z,
```

- [ ] **Step 4: Run the tests and the type check**

```bash
npm test -- src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts && npx tsc --noEmit
```

Expected: the binding/record assertions PASS; the WGSL-tail assertion still
FAILS until Task 5 adds the parameter. `tsc` is clean (the Task 3 errors are
gone). Leave the failing assertion — Task 5 turns it green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts
git commit -m "Add burnCfg uniform and carry burn in the crowd record" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Shader-side burn state

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (private decls ~1509-1512, `loadInstance` ~1524-1560, `MARCH_BODY_PARAMS` ~2409-2482)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the main `describe` in `march.wgsl.test.ts`:

```ts
  it('loads the per-instance burn ramp and declares the emissive carrier', () => {
    // Mirrors the gInstGore contract: the record's ramp is combined with the
    // per-view uniform by max(), so single-body draws (burnCfg) and crowd draws
    // (REC_BURN) both work with one shader. The two private vars are asserted
    // against the MODULE SOURCE, because which exported chunk holds a
    // declaration is an implementation detail -- that it exists exactly once is
    // not.
    expect(INSTANCE_STATE).toContain('gInstBurn = (*inst)[base + ');
    const moduleSrc = readFileSync('src/lab/sdf-zombie/webgpu/march.wgsl.ts', 'utf8');
    expect(moduleSrc.split('var<private> gInstBurn: vec4<f32>').length).toBe(2);
    expect(moduleSrc.split('var<private> gBurnEmit: vec3<f32>').length).toBe(2);
    const params = MARCH_BODY_PARAMS.replace(/\s+/g, ' ');
    expect(params).toContain('burnCfg: vec4<f32>,');
    expect(params).toMatch(/burnFireGain: f32,?\s*\)/);
  });
```

`MARCH_BODY_PARAMS` must be in the file's import list from `./march.wgsl`, and
the file needs the same `readFileSync` import the other source-tripwire tests
use:

```ts
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
```

Expected: FAIL — no `gInstBurn`.

- [ ] **Step 3: Add the privates, the load and the parameter**

1. In the private declaration block that ends with `gInstGore` (~1509-1512), add
   before the closing backtick:

```wgsl
// BURNING BODY (flame lab): the record's (burn, burnSec, char, spare). 0 outside
// a crowd draw, where the per-view burnCfg is authoritative -- same split as
// gInstGore above.
var<private> gInstBurn: vec4<f32> = vec4<f32>(0.0);
// The surface fire's emissive contribution, written in the surface prep and
// read by the lighting tail, which is a separate WGSL export.
var<private> gBurnEmit: vec3<f32> = vec3<f32>(0.0);
```

2. In `loadInstance`, after the `gInstGore = ...` line, add:

```wgsl
  gInstBurn = (*inst)[base + ${REC_BURN}];
```

   and add `REC_BURN` to the existing `crowd-records` import at the top of
   `march.wgsl.ts`.

3. At the **end** of the `MARCH_BODY_PARAMS` parameter list, after the current
   last parameter, add these five in exactly this order (matching the binding
   objects from Task 4):

```wgsl
  burnCfg: vec4<f32>,
  burnNoiseScale: f32,
  burnRiseSpeed: f32,
  burnCharPatch: f32,
  burnFireGain: f32,
```

   **No colons in any comment you add inside that parameter list** — the wgslFn
   parser regexes name-colon-type pairs including comments
   (`march.wgsl.ts:2479-2482`).

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts
```

Expected: PASS, including the assertion left red in Task 4.

- [ ] **Step 5: Verify nothing rendered changed**

```bash
npm test && npx tsc --noEmit
```

Expected: the whole suite passes. Burn is loaded but unused, so shading is
untouched.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "Load burn state in the march shader" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Surface fire and char in the march

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (helper next to `charMask` ~1177, surface prep after the char mix ~3877, lighting tail ~4287-4294)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

This is the engulfed look's interior: fire on the skin, char through it.
`anchor` (rest-space hit position, `march.wgsl.ts:3611`) and `fbm` are already in
scope at the insertion point, as the gore block shows.

- [ ] **Step 1: Write the failing test**

Append to `march.wgsl.test.ts`:

```ts
  it('paints fire and char on a burning body from the rest-space anchor', () => {
    // Rest space, not world space: the fire must ride the body, or it swims
    // through the skin as the body walks (the same reason the gore mottle uses
    // `anchor`). The char mix must come AFTER the wound char mix so a burnt
    // body reads burnt, and the fire must be emissive, not albedo.
    expect(readFileSync('src/lab/sdf-zombie/webgpu/march.wgsl.ts', 'utf8'))
      .toContain('fn fireRamp(t: f32) -> vec3<f32> {');
    expect(MARCH_BODY).toContain('let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);');
    expect(MARCH_BODY).toContain('fbm(anchor * burnNoiseScale');
    expect(MARCH_BODY.indexOf('albedo = mix(albedo, charColor, cm);'))
      .toBeLessThan(MARCH_BODY.indexOf('let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);'));
    expect(MARCH_BODY).toContain('gBurnEmit = fireRamp(fire)');
    // The emissive fold: burning fire adds light, and a burning face is fire.
    expect(MARCH_BODY).toContain('+ glow + gBurnEmit');
    expect(MARCH_BODY).toContain('faceGlow = faceGlow * (1.0 - burnAmt);');
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
```

Expected: FAIL — no `fireRamp`.

- [ ] **Step 3: Add the ramp helper**

In the exported WGSL chunk that defines `charMask` (`march.wgsl.ts:1177`),
immediately above `fn charMask`, add:

```wgsl
// FIRE COLOUR RAMP, dull red through to pale yellow-white. Four stops, matching
// the NotBlood burning-run palette closely enough to A/B against the sprites.
fn fireRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  let a = vec3<f32>(0.30, 0.02, 0.00);
  let b = vec3<f32>(1.00, 0.22, 0.02);
  let c = vec3<f32>(1.00, 0.62, 0.10);
  let d = vec3<f32>(1.00, 0.95, 0.72);
  if (x < 0.34) { return mix(a, b, x / 0.34); }
  if (x < 0.70) { return mix(b, c, (x - 0.34) / 0.36); }
  return mix(c, d, (x - 0.70) / 0.30);
}
```

- [ ] **Step 4: Add the surface block**

In the surface prep, immediately **after** the existing
`albedo = mix(albedo, charColor, cm);` line, add:

```wgsl
  // BURNING BODY (flame lab). burnCfg.x is the per-view ramp and gInstBurn.x the
  // per-instance one; max() makes one shader serve single and crowd draws, as
  // goreStrength does above. The noise rides `anchor` (REST space) and scrolls
  // along -y, so fire climbs the body and stays ON the body as it walks -- in
  // world space it would swim through the skin. char blackens the albedo and
  // holds fire off the parts already burnt out.
  let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);
  if (burnAmt > 0.0) {
    let burnPhase = max(burnCfg.y, gInstBurn.y) * burnRiseSpeed;
    let charAmt = clamp(max(burnCfg.z, gInstBurn.z), 0.0, 1.0);
    let fireN = fbm(anchor * burnNoiseScale + vec3<f32>(0.0, -burnPhase, 0.0));
    let fire = clamp(fireN * 1.45 - 0.22, 0.0, 1.0) * burnAmt * (1.0 - charAmt * burnCharPatch);
    albedo = mix(albedo, charColor, charAmt);
    gBurnEmit = fireRamp(fire) * fire * burnFireGain;
    faceGlow = faceGlow * (1.0 - burnAmt);
    primGlow = primGlow * (1.0 - burnAmt);
  }
```

`primGlow` must be a `var`, not a `let`, at this point in the function — if the
compiler rejects the assignment, change its declaration to `var` (it is already
multiplied into `lit` further down, so nothing else changes).

- [ ] **Step 5: Add the emissive fold**

In the lighting tail, replace:

```wgsl
  var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow;
```

with:

```wgsl
  // gBurnEmit is 0 on every non-burning body, so this line is bit-identical to
  // the old one everywhere burn is off (adding 0.0 is exact).
  var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npm test && npx tsc --noEmit
```

Expected: all PASS. With burn at 0 every frame is unchanged, which the
"bit-identical" note above is claiming — confirm it in Task 8's visual check, not
here.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts
git commit -m "Paint surface fire and char on burning bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The lab page shell

**Files:**
- Create: `sdf-flame-lab.html`
- Create: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`
- Create: `src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts`
- Modify: `vite.config.ts` (input map, ~158-173)

The host is assembled by **copying verified line ranges out of `lab-main.ts`**,
not by writing new engine code. Copy, then delete what the flame lab does not
need (gibs, melt, severing, benches, wound rings).

- [ ] **Step 1: Write the page shell**

Create `sdf-flame-lab.html` by copying `sdf-lab-webgpu.html` verbatim, then
changing the `<title>` to `Blud — flame lab` and the module script to:

```html
  <script type="module" src="/src/lab/sdf-zombie/webgpu/flame-lab-main.ts"></script>
```

- [ ] **Step 2: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts`:

```ts
// Source tripwires for the flame lab's wiring, in the style of
// blood-compare-main.test.ts: importing the module runs its bootstrap, which
// bails before createLabRenderer because the test DOM has no #app, so what this
// proves is that the imports resolve, the syntax is valid, and the page is
// wired to the pieces the plan says it is.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { FLAME_LAB_BODIES } from './flame-lab-main';

const PAGE = 'src/lab/sdf-zombie/webgpu/flame-lab-main.ts';
const src = readFileSync(PAGE, 'utf8');
const html = readFileSync('sdf-flame-lab.html', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');

describe('flame lab page', () => {
  it('shows a zombie and a soldier, the two characters the spec names', () => {
    expect(FLAME_LAB_BODIES.map(b => b.name)).toEqual(['zombie', 'soldier']);
    expect(new Set(FLAME_LAB_BODIES.map(b => b.x)).size).toBe(2);
  });

  it('is served by the page shell and registered for the build', () => {
    expect(html).toContain('/src/lab/sdf-zombie/webgpu/flame-lab-main.ts');
    expect(html).toContain('id="app"');
    expect(vite).toContain("sdfFlameLab: resolve(__dirname, 'sdf-flame-lab.html')");
  });

  it('renders through the real march and the real post chain', () => {
    expect(src).toContain('createSdfLayer');
    expect(src).toContain('createPostAa');
    expect(src).toContain('createCharacterView');
    expect(src).toContain('postAa.render(');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
```

Expected: FAIL — cannot resolve `./flame-lab-main`.

- [ ] **Step 4: Write the host**

Create `src/lab/sdf-zombie/webgpu/flame-lab-main.ts` with this shape, filling the
engine blocks by copying the cited `lab-main.ts` ranges verbatim and adapting the
names:

```ts
// src/lab/sdf-zombie/webgpu/flame-lab-main.ts
//
// THE FLAME LAB. Two burning bodies, the real march, the real post chain, and
// nothing else -- no AI, no damage, no gibs, so what you are looking at is the
// fire and not a fight. Assembled from lab-main.ts's blocks (renderer + floor
// 174-222, layer + postAa + tile binding 232-248, character view 255-267, panel
// toggle 276-291, draw chain 328-351, frame loop 2406+); see
// docs/superpowers/plans/2026-09-17-flame-lab-foundation.md.

export interface FlameLabBody {
  name: string;
  /** Metres along x, so the two bodies stand side by side. */
  x: number;
}

/** The spec's two characters. Exported so the page's test can pin them. */
export const FLAME_LAB_BODIES: readonly FlameLabBody[] = Object.freeze([
  { name: 'zombie', x: -0.7 },
  { name: 'soldier', x: 0.7 },
]);

async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) return;              // tests import this module with no DOM
  // ... copy lab-main.ts:174-222 (createLabRenderer, floor, refCube, face seed)
  // ... copy lab-main.ts:232-248 (createSdfLayer, createPostAa, tile binding)
  // ... one createCharacterView per FLAME_LAB_BODIES entry (lab-main.ts:255-267),
  //     each with `start: [b.x, 0, 0]`
  // ... copy lab-main.ts:276-291 (panel element + H toggle)
  // ... copy lab-main.ts:328-351 (sizeSdfLayer, setDrawFn -> postAa.render)
  // ... frame loop modelled on lab-main.ts:2406+: per body, step its motion
  //     (stepActorMotion with `profile: { ...motionProfile, cruise: cruiseFor(speedBand) }`)
  //     and pose its view
}

void bootstrap().catch((err) => {
  const box = document.getElementById('errors');
  if (box) box.textContent = String(err);
  console.error(err);
});
```

Keep the module's top-level side effects to the single `void bootstrap()` call,
so the test can import it safely.

- [ ] **Step 5: Register the page for the build**

In `vite.config.ts`, inside the `rollupOptions.input` map, add:

```ts
        sdfFlameLab: resolve(__dirname, 'sdf-flame-lab.html'),
```

- [ ] **Step 6: Run the tests and look at the page**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

```bash
npx vite
```

Open `http://localhost:5173/sdf-flame-lab.html`. Expected: a zombie and a soldier
standing on the grey floor, walking when you press `,`, with no fire yet and no
console errors. **This is also the check that Task 6 changed nothing visually:**
both bodies must look exactly as they do on `/sdf-lab-webgpu.html`.

- [ ] **Step 7: Commit**

```bash
git add sdf-flame-lab.html src/lab/sdf-zombie/webgpu/flame-lab-main.ts src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts vite.config.ts
git commit -m "Add the flame lab page with zombie and soldier" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Ignite the bodies

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts`
- Modify: `sdf-flame-lab.html` (reference sprite strip)

- [ ] **Step 1: Write the failing test**

Add to `flame-lab-main.test.ts`:

```ts
  it('drives each body burn state into its own burnCfg uniform', () => {
    expect(src).toContain('stepBurn(');
    expect(src).toContain('igniteBurn(');
    expect(src).toContain('extinguishBurn(');
    expect(src).toContain('.uniforms.burnCfg.value.set(');
    expect(src).toContain('resolveBurnTuning');
  });

  it('exposes the lab through a console API and pins its clock for captures', () => {
    expect(src).toContain('__flameLab');
    expect(src).toContain('ignite');
    expect(src).toContain('setTuning');
    expect(src).toContain('capture');
  });

  it('pins the Blood reference sprites beside the bodies', () => {
    // Tiles 3321-3326 are the burning-run frames and ARE tracked in the repo.
    expect(html).toContain('assets/blood-tiles/3321.png');
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
```

Expected: FAIL on `stepBurn`.

- [ ] **Step 3: Wire burn into the page**

In `flame-lab-main.ts`:

1. Import the pure pieces:

```ts
import { createBurnState, igniteBurn, extinguishBurn, stepBurn } from '../burn-state';
import { BURN_TUNING, burnPresets, resolveBurnTuning, type BurnTuning } from './burn-profiles';
```

2. Keep one state per body and one live tuning:

```ts
  let tuning: BurnTuning = resolveBurnTuning(BURN_TUNING);
  const burns = FLAME_LAB_BODIES.map(() => createBurnState());
```

3. In the frame loop, after each body's motion step:

```ts
    for (let i = 0; i < views.length; i++) {
      const s = stepBurn(burns[i]!, dt, tuning);
      const u = views[i]!.gpu.uniforms;
      u.burnCfg.value.set(s.burn, s.burnSec, s.char, 0);
      u.burnNoiseScale.value = tuning.noiseScale;
      u.burnRiseSpeed.value = tuning.riseSpeed;
      u.burnCharPatch.value = tuning.charPatch;
      u.burnFireGain.value = tuning.fireGain;
    }
```

4. Keys, alongside the copied `,` / `.` / `k` handlers:

```ts
    if (ev.key === 'i' || ev.key === 'I') { for (const s of burns) igniteBurn(s); return; }
    if (ev.key === 'o' || ev.key === 'O') { for (const s of burns) extinguishBurn(s); return; }
```

5. A console API:

```ts
  (window as unknown as { __flameLab: unknown }).__flameLab = {
    ignite(on = true) { for (const s of burns) (on ? igniteBurn : extinguishBurn)(s); },
    setTuning(p: Partial<BurnTuning> = {}) { tuning = resolveBurnTuning({ ...tuning, ...p }); return tuning; },
    preset(name: keyof typeof burnPresets) { tuning = resolveBurnTuning(burnPresets[name]); return tuning; },
    /** Full burn immediately, for deterministic captures. */
    capture(burn = 1, char = 0) {
      for (let i = 0; i < burns.length; i++) {
        burns[i]!.alight = burn > 0; burns[i]!.burn = burn; burns[i]!.char = char; burns[i]!.burnSec = 0;
      }
    },
    tuning() { return { ...tuning }; },
    burns() { return burns.map(b => ({ ...b })); },
  };
```

6. URL params, read once at boot next to the existing `?character=` helper the
   page copied from `lab-main.ts`:

```ts
  const q = new URLSearchParams(location.search);
  const startLit = q.get('burn') === '1';                 // boot already alight
  const preset = q.get('preset');                          // a burnPresets name
  if (preset && Object.hasOwn(burnPresets, preset)) tuning = resolveBurnTuning(burnPresets[preset as keyof typeof burnPresets]);
  if (startLit) for (const s of burns) igniteBurn(s);
```

   `?seed=` is read by the motion RNG in the block copied from `lab-main.ts`;
   leave that as it is.

7. In `sdf-flame-lab.html`, add the reference strip inside `<body>`:

```html
  <div id="reference" style="position:fixed;bottom:8px;right:8px;z-index:9;display:flex;gap:4px;background:#15151ac0;padding:6px;border-radius:6px">
    <img src="/assets/blood-tiles/3321.png" style="height:120px;image-rendering:pixelated" alt="Blood burning run reference">
    <img src="/assets/blood-tiles/3323.png" style="height:120px;image-rendering:pixelated" alt="">
    <img src="/assets/blood-tiles/3325.png" style="height:120px;image-rendering:pixelated" alt="">
  </div>
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 5: Look at it**

```bash
npx vite
```

Open `/sdf-flame-lab.html`, press `I`. Expected: both bodies turn to fire over
about half a second, char builds over a few seconds, `O` puts them out and the
char stays. Compare against the reference strip in the corner. Note what looks
wrong — that is the tuning work the panel exists for.

- [ ] **Step 6: Commit**

```bash
git add sdf-flame-lab.html src/lab/sdf-zombie/webgpu/flame-lab-main.ts src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
git commit -m "Ignite the flame lab bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The tuning panel

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/flame-panel.ts`
- Create: `src/lab/sdf-zombie/webgpu/flame-panel.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`

Copy the structure of `dynamite-panel.ts`: a `KEYS` table, sliders built from it
that read the applied value back, preset buttons, and a `copyText` that emits a
setter call. Use `createPanelShell('FLAME', { right: 8 })` from `panel-chrome.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/flame-panel.test.ts`:

```ts
// The panel's anti-drift contract, same as dynamite-panel.test.ts: a slider key
// the page setter ignores looks applied and is not. Both sides are pinned here.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { FLAME_KEYS, copyText } from './flame-panel';
import { BURN_TUNING, resolveBurnTuning } from './burn-profiles';

describe('flame panel', () => {
  it('every slider key is a real BurnTuning field', () => {
    const fields = new Set(Object.keys(BURN_TUNING));
    for (const k of FLAME_KEYS) {
      expect(fields.has(k.key), `slider "${k.key}" is not a BurnTuning field`).toBe(true);
    }
  });

  it('covers every tunable the spec asks to tune', () => {
    const keys = new Set(FLAME_KEYS.map(k => k.key));
    for (const field of Object.keys(BURN_TUNING)) {
      expect(keys.has(field as never), `BurnTuning.${field} has no slider`).toBe(true);
    }
  });

  it('slider ranges cannot ask for a value the clamp rejects', () => {
    for (const k of FLAME_KEYS) {
      const lo = resolveBurnTuning({ [k.key]: k.min } as never);
      const hi = resolveBurnTuning({ [k.key]: k.max } as never);
      expect(lo[k.key], `${k.key} min`).toBeCloseTo(k.min, 6);
      expect(hi[k.key], `${k.key} max`).toBeCloseTo(k.max, 6);
    }
  });

  it('copies a setter call the game will understand', () => {
    const text = copyText(BURN_TUNING);
    expect(text.startsWith('__sdfGame.setBurnTuning({')).toBe(true);
    expect(text).toContain('fireGain: 1.6');
    expect(text.endsWith('})')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-panel.test.ts
```

Expected: FAIL — cannot resolve `./flame-panel`.

- [ ] **Step 3: Write the panel**

Create `src/lab/sdf-zombie/webgpu/flame-panel.ts`:

```ts
// src/lab/sdf-zombie/webgpu/flame-panel.ts
//
// The flame lab's tuning panel. The KEY TABLE is the contract: it names every
// BurnTuning field exactly once, its test pins that both ways, and COPY emits a
// setter call whose keys are the same names -- which is what stops a tuning
// session ending in numbers nothing reads (dynamite-panel.ts:190 has the scars).
import { createPanelShell, type PanelShell } from './panel-chrome';
import { BURN_TUNING, burnPresets, type BurnTuning } from './burn-profiles';

export interface FlameKey {
  key: keyof BurnTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const FLAME_KEYS: readonly FlameKey[] = Object.freeze([
  { key: 'igniteSec', label: 'ignite s', min: 0.05, max: 4, step: 0.05 },
  { key: 'extinguishSec', label: 'out s', min: 0.05, max: 4, step: 0.05 },
  { key: 'charRate', label: 'char /s', min: 0, max: 2, step: 0.02 },
  { key: 'fireGain', label: 'fire gain', min: 0, max: 4, step: 0.05 },
  { key: 'noiseScale', label: 'noise scale', min: 0.5, max: 40, step: 0.5 },
  { key: 'riseSpeed', label: 'rise', min: 0, max: 8, step: 0.1 },
  { key: 'charPatch', label: 'char patch', min: 0, max: 1, step: 0.02 },
  { key: 'lightPeak', label: 'light', min: 0, max: 120, step: 1 },
  { key: 'lightFlicker', label: 'flicker', min: 0, max: 1, step: 0.02 },
  { key: 'glowGain', label: 'glow', min: 0, max: 2, step: 0.02 },
  { key: 'glowThreshold', label: 'glow thr', min: 0, max: 4, step: 0.05 },
  { key: 'distortStrength', label: 'heat warp', min: 0, max: 0.035, step: 0.001 },
]);

export function copyText(t: BurnTuning): string {
  const body = FLAME_KEYS.map(k => `${k.key}: ${Number(t[k.key].toFixed(4))}`).join(', ');
  return `__sdfGame.setBurnTuning({${body}})`;
}

export interface FlamePanelOpts {
  read(): BurnTuning;
  apply(patch: Partial<BurnTuning>): BurnTuning;
  preset(name: keyof typeof burnPresets): BurnTuning;
  onCopy?(text: string): void;
}

export function createFlamePanel(opts: FlamePanelOpts): PanelShell {
  const shell = createPanelShell('FLAME', { right: 8 });
  for (const k of FLAME_KEYS) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = k.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min); input.max = String(k.max); input.step = String(k.step);
    input.value = String(opts.read()[k.key]);
    const out = document.createElement('span');
    const show = () => { out.textContent = String(Number(opts.read()[k.key].toFixed(4))); };
    input.addEventListener('input', () => {
      opts.apply({ [k.key]: Number(input.value) } as Partial<BurnTuning>);
      show();                           // read BACK, never echo the slider
    });
    show();
    row.append(label, input, out);
    shell.body.append(row);
  }
  for (const name of Object.keys(burnPresets) as (keyof typeof burnPresets)[]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => { opts.preset(name); shell.el.dispatchEvent(new Event('flame:preset')); });
    shell.body.append(b);
  }
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'COPY';
  copy.addEventListener('click', () => {
    const text = copyText(opts.read());
    void navigator.clipboard?.writeText(text);
    console.log(text);
    opts.onCopy?.(text);
  });
  shell.body.append(copy);
  const note = document.createElement('div');
  note.textContent = 'sliders apply LIVE · copy → clipboard + console · H hides the panel';
  shell.body.append(note);
  return shell;
}
```

Defaults come from `BURN_TUNING` through `opts.read()`, so the panel has no second
copy of the numbers.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-panel.test.ts
```

Expected: PASS, 4 tests. A failure in the second test means a `BurnTuning` field
has no slider — add the slider.

- [ ] **Step 5: Mount it in the lab**

In `flame-lab-main.ts`, after the panel toggle block:

```ts
  const flamePanel = createFlamePanel({
    read: () => tuning,
    apply: (patch) => (tuning = resolveBurnTuning({ ...tuning, ...patch })),
    preset: (name) => (tuning = resolveBurnTuning(burnPresets[name])),
  });
  flamePanel.setVisible(true);
  flamePanel.setCollapsed(false);
```

and include it in the `H` toggle the page already has
(`flamePanel.setVisible(!hidden)`).

- [ ] **Step 6: Tune it once by hand**

```bash
npx vite
```

Open `/sdf-flame-lab.html`, press `I`, and move every slider once to confirm each
one changes what its label claims. Press COPY and check the console line.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/flame-panel.ts src/lab/sdf-zombie/webgpu/flame-panel.test.ts src/lab/sdf-zombie/webgpu/flame-lab-main.ts
git commit -m "Add the flame tuning panel" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Fire light

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/burn-light.ts`
- Create: `src/lab/sdf-zombie/webgpu/burn-light.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/burn-light.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { burnLightFlicker, burnLightIntensity, burnLightAnchor } from './burn-light';

describe('burn light', () => {
  it('flickers around 1 with bounded depth', () => {
    // Two rates, as the room practicals do, so it never reads as a sine.
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 10; t += 0.01) {
      const f = burnLightFlicker(t, 0.4, 0.5);
      lo = Math.min(lo, f); hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThan(1 - 0.5);
    expect(hi).toBeLessThan(1 + 0.5);
    expect(hi - lo).toBeGreaterThan(0.2);
  });

  it('gives no light when a body is not burning and scales with burn', () => {
    expect(burnLightIntensity(0, 0, 26, 0.3, 1)).toBe(0);
    const half = burnLightIntensity(0.5, 0, 26, 0, 1);
    const full = burnLightIntensity(1, 0, 26, 0, 1);
    expect(half).toBeCloseTo(full * 0.5, 6);
    expect(full).toBeCloseTo(26, 6);
  });

  it('dims as a body chars over', () => {
    expect(burnLightIntensity(1, 1, 26, 0, 1)).toBeLessThan(burnLightIntensity(1, 0, 26, 0, 1));
  });

  it('anchors the light at chest height above the body', () => {
    expect(burnLightAnchor([2, 0, -3])).toEqual([2, 1, -3]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-light.test.ts
```

Expected: FAIL — cannot resolve `./burn-light`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/webgpu/burn-light.ts`:

```ts
// src/lab/sdf-zombie/webgpu/burn-light.ts
//
// The per-body fire light, as pure numbers. The flicker is the room practicals'
// two-rate wobble (game-main.ts:1703) because one sine reads as a pulse, two
// read as fire. Char dims the light: a body that is mostly black is mostly out.
import type { Vec3 } from '../types';

/** Multiplier around 1. `depth` is the peak deviation, so 0.4 is +-0.4. */
export function burnLightFlicker(t: number, depth: number, phase: number): number {
  const w = Math.sin(t * 7.3 + phase) * 0.5 + Math.sin(t * 17.1 + phase * 2.3) * 0.25;
  return 1 + w * depth;
}

export function burnLightIntensity(
  burn: number, char: number, peak: number, depth: number, flicker: number,
): number {
  const b = Math.min(1, Math.max(0, burn));
  if (b <= 0) return 0;
  const dim = 1 - 0.55 * Math.min(1, Math.max(0, char));
  return peak * b * dim * (1 + (flicker - 1) * depth);
}

/** Chest height, so the light sits inside the flames rather than at the feet. */
export function burnLightAnchor(pos: Vec3): Vec3 {
  return [pos[0], pos[1] + 1, pos[2]];
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-light.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire one light per body in the lab**

In `flame-lab-main.ts`, allocate the lights **once, always visible, intensity 0
when idle** — never toggle `.visible`, which recompiles every lit material
(`game-main.ts:634-648`):

```ts
  const fireLights = FLAME_LAB_BODIES.map(() => {
    const pl = new THREE.PointLight(0xff7a2a, 0, 0, 2);
    pl.visible = true;
    scene.add(pl);
    return pl;
  });
```

and in the frame loop, per body:

```ts
    const anchor = burnLightAnchor(bodyPos);
    fireLights[i]!.position.set(anchor[0], anchor[1], anchor[2]);
    fireLights[i]!.intensity = burnLightIntensity(
      s.burn, s.char, tuning.lightPeak, tuning.lightFlicker,
      burnLightFlicker(clock, tuning.lightFlicker, i * 2.7),
    );
```

- [ ] **Step 6: Look at it**

```bash
npx vite
```

Open `/sdf-flame-lab.html`, press `I`. Expected: the floor under each body warms
and flickers, the two bodies flicker out of step, and putting them out returns
the floor to its unlit colour.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/burn-light.ts src/lab/sdf-zombie/webgpu/burn-light.test.ts src/lab/sdf-zombie/webgpu/flame-lab-main.ts
git commit -m "Light the room from burning bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Glow pass

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/post-glow.ts`
- Create: `src/lab/sdf-zombie/webgpu/post-glow.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`

The pass runs on the working-space image **before** FXAA, so glow is never added
after display encoding. Two draws: extract-and-blur-x into a half-size target,
then blur-y-and-add.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/post-glow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { glowWeights, glowKnee, POST_GLOW_EXTRACT_WGSL, POST_GLOW_BLUR_WGSL } from './post-glow';

describe('glow', () => {
  it('uses a normalised, symmetric kernel', () => {
    const w = glowWeights();
    expect(w.length).toBe(5);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(w[0]).toBeCloseTo(w[4]!, 6);
    expect(w[2]).toBeGreaterThan(w[1]!);
  });

  it('passes nothing below the threshold and rises smoothly above it', () => {
    expect(glowKnee(0.2, 0.75)).toBe(0);
    expect(glowKnee(0.75, 0.75)).toBe(0);
    expect(glowKnee(1.5, 0.75)).toBeGreaterThan(0);
    expect(glowKnee(3, 0.75)).toBeGreaterThan(glowKnee(1.5, 0.75));
  });

  it('mirrors the knee in the shader', () => {
    // The CPU knee above and the WGSL one must agree, or the tuning lies.
    expect(POST_GLOW_EXTRACT_WGSL).toContain('fn glowKnee(');
    expect(POST_GLOW_BLUR_WGSL).toContain('textureSample');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/post-glow.test.ts
```

Expected: FAIL — cannot resolve `./post-glow`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/webgpu/post-glow.ts` with:

- `export function glowWeights(): number[]` — a normalised 5-tap Gaussian
  (`[1, 4, 6, 4, 1] / 16` is fine; the test only asks for normalised, symmetric
  and centre-heavy).
- `export function glowKnee(lum: number, threshold: number): number` — returns
  `0` at or below `threshold`, otherwise `lum - threshold`.
- `export const POST_GLOW_EXTRACT_WGSL` — a `wgslFn` source taking
  `srcTex`, `texCoord`, `cfg: vec4<f32>` (threshold, texelX, texelY, gain),
  containing `fn glowKnee(lum: f32, threshold: f32) -> f32` mirroring the CPU
  version, computing luminance as `dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722))`
  and blurring along x with the same weights.
- `export const POST_GLOW_BLUR_WGSL` — blurs along y and returns
  `glow * cfg.w`, sampled with `textureSample`.

**Target filtering:** the glow targets must use `THREE.LinearFilter`, because
three refuses `<tex>_sampler` for nearest/nearest targets and the blur uses
`textureSample` (`post-aa.ts:698-717`).

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/post-glow.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the pass inside post-aa**

In `post-aa.ts`:

1. Allocate `glowA` and `glowB` render targets at half content size with
   `LinearFilter`, and add both to the `refit()` `setSize` list and the
   `targetsNeedInit` clear list.
2. Build two quad scenes from `POST_GLOW_EXTRACT_WGSL` and `POST_GLOW_BLUR_WGSL`
   following the `fxaaScene` shape (`post-aa.ts:858-872`), with
   `depthWrite = false`, `depthTest = false`, `fog = false`, and additive
   blending on the second so it adds into `src`.
3. Add to the interface and implementation:

```ts
  setGlow(on: boolean, gain?: number, threshold?: number): void;
```

4. In `render()`, immediately after the capture stage and **before** SSCS, run
   the two glow draws when `glowOn && glowGain > 0`.
5. Add `glowOn` to the `active` gate at `post-aa.ts:1091`.

- [ ] **Step 6: Feed it from the lab**

In `flame-lab-main.ts`'s frame loop:

```ts
    postAa.setGlow(tuning.glowGain > 0, tuning.glowGain, tuning.glowThreshold);
```

- [ ] **Step 7: Verify**

```bash
npm test && npx tsc --noEmit
```

Expected: the whole suite passes.

```bash
npx vite
```

Open `/sdf-flame-lab.html`, press `I`, and move the glow sliders. Expected: at
gain 0 the frame is identical to before this task; as gain rises the flames
bleed light into the air around them and nothing else in the scene blooms (the
floor and the reference cube are below the threshold).

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/post-glow.ts src/lab/sdf-zombie/webgpu/post-glow.test.ts src/lab/sdf-zombie/webgpu/post-aa.ts src/lab/sdf-zombie/webgpu/flame-lab-main.ts
git commit -m "Add a glow pass for burning bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Heat distortion

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/burn-distort.ts`
- Create: `src/lab/sdf-zombie/webgpu/burn-distort.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`

The blit already warps the frame from up to four world-anchored sources
(`uBlastDistort`, `post-aa.ts:754-758, 1213-1256`). Heat reuses that machinery
with a non-expanding radius and a rising wobble.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/burn-distort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { burnDistortStrength, burnDistortRadiusM, burnWobble } from './burn-distort';

describe('burn distortion', () => {
  it('scales with burn and dies with char', () => {
    expect(burnDistortStrength(0, 0, 0.006)).toBe(0);
    expect(burnDistortStrength(1, 0, 0.006)).toBeCloseTo(0.006, 6);
    expect(burnDistortStrength(1, 1, 0.006)).toBeLessThan(burnDistortStrength(1, 0, 0.006));
  });

  it('covers the body and a little of the air above it', () => {
    expect(burnDistortRadiusM(1.8)).toBeGreaterThan(0.9);
    expect(burnDistortRadiusM(1.8)).toBeLessThan(2.5);
  });

  it('wobbles bounded, rises over time, and is stable per body', () => {
    for (let t = 0; t < 5; t += 0.01) {
      const w = burnWobble(t, 0.3);
      expect(w).toBeGreaterThanOrEqual(-1);
      expect(w).toBeLessThanOrEqual(1);
    }
    expect(burnWobble(1, 0.3)).not.toBeCloseTo(burnWobble(1, 2.9), 3);
    expect(burnWobble(1, 0.3)).toBe(burnWobble(1, 0.3));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-distort.test.ts
```

Expected: FAIL — cannot resolve `./burn-distort`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/webgpu/burn-distort.ts` with the three pure functions
the test names:

- `burnDistortStrength(burn, char, peak)` — `0` at burn `0`, `peak` at burn `1`,
  scaled down by char the way the light is.
- `burnDistortRadiusM(bodyHeightM)` — a little over half the body height, so the
  band covers the body and some air above it.
- `burnWobble(t, phase)` — a bounded two-rate wobble, deterministic in `t` and
  `phase`, different per body.

Document that `post-aa.ts`'s warp mirrors this, in the style of
`blast-refraction.ts:150`.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- src/lab/sdf-zombie/webgpu/burn-distort.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Feed the existing distortion slots**

In `post-aa.ts`, add alongside `pushBlastDistort`:

```ts
  /** A burning body's heat band. Same four slots as the blast warp, but the
   *  radius does not expand and the strength comes from burn, not from age. */
  pushBurnDistort(world: Vec3, radiusM: number, strength: number): void;
```

Implement it by pushing into the same live-source list the blast warp resolves in
`render()`, with a flag that skips the expansion and decay. Keep the total at
four sources; when more are pushed in a frame, keep the strongest.

In `flame-lab-main.ts`'s frame loop, per burning body:

```ts
    const s2 = burnDistortStrength(s.burn, s.char, tuning.distortStrength);
    if (s2 > 0) postAa.pushBurnDistort(burnLightAnchor(bodyPos), burnDistortRadiusM(1.8), s2);
```

and enable the warp with `postAa.setBlastDistort(true)`.

- [ ] **Step 6: Verify**

```bash
npm test && npx tsc --noEmit
```

Expected: pass, clean.

```bash
npx vite
```

Open `/sdf-flame-lab.html`, press `I`, and raise the heat-warp slider. Expected:
the wall and floor seen through the air above each body ripple, the ripple is
strongest at full burn and fades as they char, and at 0 the frame is unwarped.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/burn-distort.ts src/lab/sdf-zombie/webgpu/burn-distort.test.ts src/lab/sdf-zombie/webgpu/post-aa.ts src/lab/sdf-zombie/webgpu/flame-lab-main.ts
git commit -m "Warp the air above burning bodies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Shutter blur in the lab

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts`

The lab needs the game's shutter so a flailing burning body's streaks can be
judged here rather than only in the game.

- [ ] **Step 1: Write the failing test**

Add to `flame-lab-main.test.ts`:

```ts
  it('installs the game shutter through the post capture stage', () => {
    expect(src).toContain('createShutterGameLayer');
    expect(src).toContain('postAa.setCaptureStage(');
    expect(src).toContain('prewarm(postAa.captureTarget)');
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
```

Expected: FAIL — no `createShutterGameLayer`.

- [ ] **Step 3: Install the shutter**

Copy the game's capture-stage closure (`game-main.ts:7762-7789`), reduced to the
blood shutter only (the lab has no gib shutter):

```ts
  const shutterGame = createShutterGameLayer({
    renderer: handle.renderer, gooLayer,
    onError: (m) => { console.error(m); },
  });
  postAa.setCaptureStage((capture) => {
    let out: THREE.RenderTarget = capture;
    shutterGame.setSceneTexture(out.texture);
    shutterGame.setOccluderDepth(null);
    const b = shutterGame.capture(capture, bloodSim, camera);
    if (b) out = b;
    return out === capture ? null : out;
  });
  shutterGame.prewarm(postAa.captureTarget);
```

The lab needs the same `gooLayer` and `BloodSim` the shutter consumes — create
them as `lab-main.ts` does (it already builds a goo layer for its draw chain) and
keep the sim empty; the shutter then blurs nothing until a later plan feeds it
flame sources.

- [ ] **Step 4: Verify**

```bash
npm test -- src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts && npx tsc --noEmit
```

Expected: pass, clean.

```bash
npx vite
```

Open `/sdf-flame-lab.html` and confirm the page still renders with no console
errors and no visible change (an empty sim blurs nothing). Check the browser
console for the shutter's own error callback staying silent.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/flame-lab-main.ts src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
git commit -m "Install the shutter blur in the flame lab" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: Pose capture script

**Files:**
- Create: `scripts/flame-capture.mjs`
- Modify: `package.json` (scripts)

Captures the spec's fixed pose set so techniques can be judged side by side, and
so this plan's surface look is the baseline the next plans are compared against.
Follow `scripts/goo-capture.mjs` and `scripts/melt-capture.mjs`: source
`scripts/lab-servers.sh` through a small shell wrapper or reuse their CDP setup.

- [ ] **Step 1: Write the script**

Create `scripts/flame-capture.mjs` that:

1. Starts the lab servers the way `goo-capture.mjs` does (same `lab-servers.sh`
   helpers, same `LAB_VITE_PORT` / `LAB_CDP_PORT` handling).
2. Opens `http://localhost:${VITE}/sdf-flame-lab.html?seed=1`.
3. Waits for `window.__flameLab`.
4. For each pose in `['stand', 'walk', 'run', 'collapsed', 'distant']` and each
   burn stage in `[{ burn: 1, char: 0 }, { burn: 1, char: 0.6 }]`:
   - drives the pose through the page's own keys or console API,
   - calls `__flameLab.capture(burn, char)`,
   - renders a fixed number of frames,
   - screenshots to
     `docs/dev-notes/2026-09-17-flame-lab/<pose>-<stage>.png`.
5. Exits 0 on success, 2 if it could not run.

- [ ] **Step 2: Add the npm script**

In `package.json`, add:

```json
    "flame:capture": "node scripts/flame-capture.mjs",
```

- [ ] **Step 3: Run it**

```bash
npm run flame:capture
```

Expected: exit 0 and ten PNGs under `docs/dev-notes/2026-09-17-flame-lab/`.

- [ ] **Step 4: Look at the captures**

Open the PNGs next to the Blood reference sprites. Expected: the engulfed
interior look, no tongues (tongues are the next plans). Write one paragraph of
notes into `docs/dev-notes/2026-09-17-flame-lab/NOTES.md` saying what the surface
look does and does not give, since that is the brief for the tongue plans.

- [ ] **Step 5: Commit**

```bash
git add scripts/flame-capture.mjs package.json docs/dev-notes/2026-09-17-flame-lab
git commit -m "Capture flame lab poses for side-by-side judging" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: Status board

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Add the row**

Add near the top of `TASKS.md`:

```markdown
## Burning enemies — flame look + flame lab — 2026-09-17

- [x] Foundation: `sdf-flame-lab.html` + per-body burn + surface fire/char + glow, heat warp, shutter, fire light.
  [Spec](docs/superpowers/specs/2026-09-17-burning-enemies-flame-lab-design.md) ·
  [plan](docs/superpowers/plans/2026-09-17-flame-lab-foundation.md) ·
  [captures](docs/dev-notes/2026-09-17-flame-lab/NOTES.md).
- [ ] Next: the three tongue techniques (screen-space, flame cards, volumetric), then the owner picks a look, then measure.
- [ ] Then: flare gun + burning behaviour (second spec, not yet written).
```

- [ ] **Step 2: Verify the whole suite one more time**

```bash
npm test && npx tsc --noEmit
```

Expected: everything passes.

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "Record flame lab foundation on the status board" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deliberate deviations from the spec

- **The `marchBurn` MRT attachment is not built here.** The spec introduces it for
  the screen-space tongues and for a mask-driven heat warp. This plan's heat warp
  is world-anchored instead (it reuses the blit's existing four distortion
  sources), so nothing in the foundation needs a per-pixel burn mask. The
  attachment lands in the screen-space tongue plan, which is the first thing that
  genuinely needs it.
- **Game-page validation is not a task here.** Per the spec's decision procedure,
  the real game page is where a *chosen* look gets validated, which is after the
  three tongue plans.

## Notes for the implementer

- **The positional uniform binding is the sharpest edge in this plan.** Appending
  `burnCfg` and the four burn scalars at the END of both the WGSL parameter list
  and every binding object is what keeps existing pairs aligned
  (`zombie-gpu.ts:1225-1227`). If bodies suddenly shade wrongly after Task 5 or
  6, a binding object is out of order.
- **Never put a colon inside a comment in `MARCH_BODY_PARAMS`** — the wgslFn
  parser reads comments as name-type pairs (`march.wgsl.ts:2479-2482`).
- **Never toggle a light's `.visible`** — it recompiles every lit material
  mid-frame (`game-main.ts:634-648`). Idle lights sit at intensity 0.
- **No `alphaHash`, no `alphaTest`, alpha in `colorNode.w`** for anything
  translucent (`explosion-vfx.ts:28-57`).
- **The browser pane fires a real click at the last cursor position** when it
  re-composites between tool calls, which in a lab page that shoots on click
  stamps phantom wounds. Park the cursor off the canvas when verifying.
- If any step's code does not match the file you find, trust the file and adapt;
  the line numbers here were read on 2026-09-17 at commit `6bc4268b`.
