# Environment Lighting P1 — Bounce-Light Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner judge, by eye in the lab, whether a chromatic ambient that carries **colour but not brightness** makes an SDF character feel like it is *in* a room — without softening the `practical-hard-key` blowout, and without adding a single `mapBody` evaluation.

**Architecture:** A toggleable Cornell-box enclosure of five or six coloured planes is added to the lab. Its six wall colours and its bounding box are handed to the shader as plain uniforms. A new WGSL function `ambientAt(p, n, ...)` derives an analytic bounce from those six walls — closest-point-on-rect, `n·L`, inverse-square falloff — then **renormalises the result to unit luminance** so it contributes hue only, and blends it against the existing flat fill by a new per-preset `probeWeight`. `ambientGain` is the deliberate escape hatch that lets bounce add real lift if the owner wants to test genuine radiosity. `ambientAt` replaces the scalar `lightCfg.y` at the two sites that consume it.

**The invariant that makes this safe:** at `probeWeight = 0`, `ambientAt` returns exactly `lightCfg.y * keyColor`, which is algebraically identical to today's expression. Defaults ship at `probeWeight = 0`, so **every existing preset, pin test, and owner-blessed visual is unchanged until someone moves the slider.** This is asserted, not assumed.

**Tech Stack:** TypeScript, three.js r185 TSL (`wgslFn`, `uniform`), WebGPU, vitest 2.1.

**Spec:** [docs/superpowers/specs/2026-08-24-environment-lighting-design.md](../specs/2026-08-24-environment-lighting-design.md)

### One deliberate departure from the spec

The spec says *"~4 analytic bounce lights derived automatically from the
enclosure's wall colours"*. This plan uses **six — one per wall of the box** —
and derives each wall's position in-shader from `boxMin`/`boxMax` rather than
uploading light positions.

Why: it costs the same (six unrolled arithmetic terms, still zero field
evaluations), it removes the need for uniform *arrays* in three.js TSL — a
mechanism this codebase has never used and that would be an unnecessary risk
inside a spike — and one-light-per-wall is what makes "tint the left wall red
and the shadow side goes red" true by construction, with nothing placed by
hand. It also turns spec open question 2 (*does the enclosure need a ceiling?*)
into a runtime toggle rather than a rebuild.

It does **not** dodge open question 1 (*is this enough to read as GI, or does it
look like obvious point lights?*). Six area-ish walls is still few, and Task 8
asks the question directly. If the answer is "not enough", that is evidence for
P3 sooner — exactly as the spec says.

---

## Orientation — read this before Task 1

You are working in `src/lab/sdf-zombie/`, a raymarched-SDF character lab. It is
firewalled from `src/sim` and `src/game`; **do not touch either.**

**The one shader path that matters.** `march.wgsl.ts` exports `MARCH_BODY`, a
WGSL source *string* beginning `fn marchBody(`. It is compiled exactly once, at
[`zombie-gpu.ts:114`](../../../src/lab/sdf-zombie/webgpu/zombie-gpu.ts), via
three.js TSL's `wgslFn`. Its arguments are bound **by name** from a single
object literal at `zombie-gpu.ts:453-469`, and the uniform nodes themselves are
declared once in `defaultUniforms()` at `zombie-gpu.ts:158-295`. Adding a
uniform therefore means editing exactly three places: the WGSL parameter list,
`defaultUniforms()`, and that binding object. Because binding is by name,
additions cannot silently shift other arguments.

**Two traps specific to this file:**

1. **Chunk and FPV views copy uniforms from a template.** `zombie-gpu.ts:944`
   and `fpv-view.ts:214` do `u.<name>.value.copy(template.<name>.value)` for
   each shared uniform. A new uniform that is *not* added there makes gibs and
   the first-person hands light differently from the body. Task 5 covers this.
2. **`march.wgsl.test.ts` pins the exact shading string.** Lines 389, 392 and
   938 assert
   `'albedo * (lightCfg.y + diff * wShadow * lightCfg.x) * keyColor * ao'`.
   Task 6 changes that line, so those pins must be updated *in the same commit*
   — and they must be re-pinned to the new string, never deleted. They exist
   because a 2026-08-23 pass quietly reintroduced wound-keyed lighting gates the
   owner had rejected.

**Why there is a CPU mirror (Task 4).** Nothing in this repo compiles WGSL
during tests, so vitest cannot see a shader bug. The project's established
answer — used for the march tracer in perf task-1b — is to write the same maths
twice: once in WGSL, once in TypeScript, and property-test the TypeScript. The
WGSL is then pinned by source-string tests so the two cannot drift silently.
Follow that pattern; do not invent a new one.

**Vocabulary.** *Key* = the single bright lamp. *Fill* = the flat scalar
`lightCfg.y` that keeps the shadow side from being pure black. *Ambient* = what
replaces fill in this plan. *Bounce* = the chromatic contribution derived from
the walls.

**Commands.** Typecheck `npx tsc --noEmit`. Tests `npx vitest run src/lab`.
Single file `npx vitest run src/lab/sdf-zombie/ambient.test.ts`. Lab
`npm run dev` → `/sdf-lab-webgpu.html`. Bench `npm run bench:sdf`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lab/sdf-zombie/material.ts` | modify | `LightPreset` gains `probeWeight`, `ambientGain` |
| `src/lab/sdf-zombie/material.test.ts` | modify | Preset shape + default-off assertions |
| `src/lab/sdf-zombie/ambient.ts` | **create** | CPU mirror of the bounce maths — the only testable copy |
| `src/lab/sdf-zombie/ambient.test.ts` | **create** | Property tests: parity, unit luminance, hue direction |
| `src/lab/sdf-zombie/webgpu/enclosure.ts` | **create** | Cornell-box meshes + wall colour state |
| `src/lab/sdf-zombie/webgpu/enclosure.test.ts` | **create** | Box bounds, wall count, ceiling toggle |
| `src/lab/sdf-zombie/webgpu/ambient.wgsl.ts` | **create** | `AMBIENT_AT` WGSL source string |
| `src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts` | **create** | **Zero-`mapBody` gate** + structure pins |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | modify | Uniform declarations, binding, preset apply, template copy |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | modify | Import `AMBIENT_AT`, new params, two shading sites |
| `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` | modify | Re-pin the changed shading strings |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` | modify | Panel: enclosure toggle, colour pickers, sliders, A/B |
| `docs/dev-notes/2026-08-25-bounce-spike-findings.md` | **create** | The verdict, including a negative one |

`ambient.wgsl.ts` is a separate file rather than another block inside the
already-1677-line `march.wgsl.ts` so that the zero-`mapBody` gate can slice a
single exported string with no ambiguity about what it covers.

---

## Task 1: `LightPreset` gains the two knobs

**Files:**
- Modify: `src/lab/sdf-zombie/material.ts:93-117`
- Test: `src/lab/sdf-zombie/material.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/material.test.ts`, inside the existing top-level
`describe` that already covers `LIGHT_PRESETS`:

```ts
  it('gives every light preset the two bounce knobs, defaulted OFF', () => {
    // probeWeight 0 is the parity guarantee: ambientAt collapses to
    // lightCfg.y * keyColor, so the shipped look cannot move until a
    // slider does. Every owner-blessed visual depends on this.
    for (const n of Object.keys(LIGHT_PRESETS) as LightPresetName[]) {
      expect(LIGHT_PRESETS[n].probeWeight).toBe(0);
      expect(LIGHT_PRESETS[n].ambientGain).toBe(1);
    }
  });
```

Add `type LightPresetName` to the existing import at the top of the file so it
reads:

```ts
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type LightPresetName } from './material';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/material.test.ts`
Expected: FAIL — `expected undefined to be 0`.

- [ ] **Step 3: Write minimal implementation**

In `src/lab/sdf-zombie/material.ts`, replace the `LightPreset` interface
(currently lines 93-98) with:

```ts
export interface LightPreset {
  keyDir: Vec3;
  keyIntensity: number;
  fillIntensity: number;
  keyColor: Vec3;
  /**
   * How far the flat fill is replaced by chromatic bounce, 0..1.
   *
   * 0 = today's behaviour exactly — `ambientAt` returns
   * `fillIntensity * keyColor` and the shading expression collapses to what
   * it was before bounce existed. This is the default for every preset, so
   * the spike ships dark: nothing moves until the lab slider moves it.
   */
  probeWeight: number;
  /**
   * Overall level of the bounce term once `probeWeight` has mixed it in.
   *
   * 1 is the house rule from the spec — bounce carries COLOUR, NOT
   * BRIGHTNESS, so the shadow side keeps the level `fillIntensity` gave it
   * and only changes hue. Raising this above 1 deliberately breaks that rule
   * and is how the owner tests whether the look actually wants genuine
   * radiosity lift instead. Keep it as an explicit knob: the negative result
   * ("chromatic alone doesn't sell it") is a real outcome of this spike.
   */
  ambientGain: number;
}
```

Then add both fields to the two presets (currently lines 102-116):

```ts
export const LIGHT_PRESETS: Record<LightPresetName, LightPreset> = {
  // Single close bright key, almost no fill — practical-effects blowout.
  'practical-hard-key': {
    keyDir: [0.45, 0.72, 0.53],
    keyIntensity: 2.4,
    fillIntensity: 0.06,
    keyColor: [1.0, 0.96, 0.92],
    probeWeight: 0,
    ambientGain: 1,
  },
  // Mirrors the real game's sun + ambient, to check the material survives it.
  'game-ambient': {
    keyDir: [0.35, 0.86, 0.52],
    keyIntensity: 1.1,
    fillIntensity: 0.34,
    keyColor: [1.0, 0.925, 0.804],
    probeWeight: 0,
    ambientGain: 1,
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/material.test.ts`
Expected: PASS, all tests in the file green.

Run: `npx tsc --noEmit`
Expected: exit 0. If any other file constructs a `LightPreset` literal it will
fail here — fix by adding `probeWeight: 0, ambientGain: 1`.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/material.ts src/lab/sdf-zombie/material.test.ts
git commit -m "lighting: LightPreset gains probeWeight + ambientGain, both off by default"
```

---

## Task 2: The CPU mirror of the bounce maths

Write this **before** the WGSL. It is the only version tests can execute, so it
is where the maths gets to be correct; the shader then copies it line for line.

**Files:**
- Create: `src/lab/sdf-zombie/ambient.ts`
- Test: `src/lab/sdf-zombie/ambient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/ambient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ambientAt, type EnclosureWalls, type Box } from './ambient';

/** A 4m cube centred on the origin's floor: the lab's default enclosure. */
const BOX: Box = { min: [-2, 0, -2], max: [2, 4, 2] };

/** Neutral grey everywhere — no wall should be able to tint anything. */
const GREY: EnclosureWalls = {
  negX: [0.5, 0.5, 0.5], posX: [0.5, 0.5, 0.5],
  negY: [0.5, 0.5, 0.5], posY: [0.5, 0.5, 0.5],
  negZ: [0.5, 0.5, 0.5], posZ: [0.5, 0.5, 0.5],
};

/** Left wall red, everything else near-black: the spike's headline test. */
const RED_LEFT: EnclosureWalls = {
  negX: [0.9, 0.05, 0.05], posX: [0.02, 0.02, 0.02],
  negY: [0.02, 0.02, 0.02], posY: [0.02, 0.02, 0.02],
  negZ: [0.02, 0.02, 0.02], posZ: [0.02, 0.02, 0.02],
};

const KEY: [number, number, number] = [1.0, 0.96, 0.92];
const FILL = 0.06;
const CENTRE: [number, number, number] = [0, 1.4, 0];

describe('ambientAt — the parity guarantee', () => {
  it('returns exactly fillIntensity * keyColor when probeWeight is 0', () => {
    // This is the whole safety story for the spike. If this breaks, every
    // owner-blessed visual silently moves the moment the code lands.
    const got = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 0, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(got[0]).toBeCloseTo(FILL * KEY[0], 12);
    expect(got[1]).toBeCloseTo(FILL * KEY[1], 12);
    expect(got[2]).toBeCloseTo(FILL * KEY[2], 12);
  });

  it('holds parity for every normal direction, not just one', () => {
    const dirs: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [0.577, 0.577, 0.577],
    ];
    for (const n of dirs) {
      const got = ambientAt(CENTRE, n, BOX, RED_LEFT, {
        probeWeight: 0, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
      });
      expect(got[0]).toBeCloseTo(FILL * KEY[0], 12);
    }
  });
});

describe('ambientAt — colour, not brightness', () => {
  it('keeps the fill LEVEL when bounce is fully on at gain 1', () => {
    // The house rule from the spec: the shadow side stays as dark as
    // practical-hard-key makes it, and only its hue changes. Luminance in
    // must equal luminance out.
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const flat = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 0, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const bounced = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(lum(bounced)).toBeCloseTo(lum(flat), 6);
  });

  it('tints the shadow side toward the wall it faces', () => {
    // A normal pointing at the red wall must come back redder than one
    // pointing away from it. This is the effect the spike exists to judge.
    const toward = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const away = ambientAt(CENTRE, [1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const redness = (c: number[]) => c[0]! / Math.max(c[1]! + c[2]!, 1e-6);
    expect(redness(toward)).toBeGreaterThan(redness(away) * 1.5);
  });

  it('gets redder as the character walks toward the red wall', () => {
    // Positional, not a constant ambient cube: this is why bounce lights
    // have distance falloff at all.
    const redness = (c: number[]) => c[0]! / Math.max(c[1]! + c[2]!, 1e-6);
    const far = ambientAt([1.5, 1.4, 0], [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const near = ambientAt([-1.5, 1.4, 0], [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(redness(near)).toBeGreaterThan(redness(far));
  });

  it('leaves a neutral-grey room neutral', () => {
    // No wall is special, so no hue may appear from the maths itself.
    const got = ambientAt(CENTRE, [0.3, -0.5, 0.81], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(got[0]).toBeCloseTo(got[1], 3);
    expect(got[1]).toBeCloseTo(got[2], 3);
  });

  it('scales level, and only level, with ambientGain', () => {
    const one = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const two = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 2, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(two[0]).toBeCloseTo(one[0]! * 2, 6);
    expect(two[1]).toBeCloseTo(one[1]! * 2, 6);
  });

  it('never returns a negative or NaN channel anywhere in the box', () => {
    // Degenerate inputs: on a wall, in a corner, and facing straight into it.
    const probes: [number, number, number][] = [
      [-2, 0, -2], [2, 4, 2], [0, 0, 0], [-1.999, 0.001, 0],
    ];
    for (const p of probes) {
      for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0]] as [number, number, number][]) {
        const got = ambientAt(p, n, BOX, RED_LEFT, {
          probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
        });
        for (const c of got) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('drops the ceiling contribution when the ceiling is off', () => {
    // Open-topped arena vs Cornell box — spec open question 2.
    const withCeil = ambientAt(CENTRE, [0, 1, 0], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const without = ambientAt(CENTRE, [0, 1, 0], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, ceiling: false, fill: FILL, keyColor: KEY,
    });
    // Luminance is renormalised either way, so the LEVEL matches; what
    // changes is that an up-facing normal no longer sees a lit surface.
    expect(withCeil.every((c, i) => Math.abs(c - without[i]!) < 1e-9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ambient.test.ts`
Expected: FAIL — `Failed to resolve import "./ambient"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lab/sdf-zombie/ambient.ts`:

```ts
/**
 * Analytic chromatic ambient — the CPU mirror of `AMBIENT_AT` in
 * `webgpu/ambient.wgsl.ts`.
 *
 * WHY THIS FILE EXISTS. Nothing in this repo compiles WGSL during tests, so
 * vitest cannot see a shader bug. The project's answer, established by the
 * march tracer, is to write the maths twice — once in WGSL for the GPU, once
 * here where it can be property-tested — and to pin the WGSL by source-string
 * tests so the two cannot drift silently. If you change one, change both, and
 * update the pins in `ambient.wgsl.test.ts`.
 *
 * THE MODEL. The enclosure is an axis-aligned box with six coloured walls.
 * For each wall we take the closest point on that wall's rectangle to the
 * shading point, treat it as a small light, and accumulate
 * `wallColour * max(dot(n, L), 0) / (1 + (dist/REF)^2)`. That is it: six
 * iterations of pure arithmetic, no field sampling.
 *
 * THE HARD CONSTRAINT. Zero `mapBody` evaluations, ever. Bounce is analytic
 * so that P1 can land without colliding with the raymarcher perf work in
 * flight. The WGSL twin is gated on this by an automated test, not by
 * discipline.
 *
 * THE HOUSE RULE. The accumulated bounce is renormalised to unit luminance
 * before use, so it contributes HUE ONLY and the shadow side keeps exactly
 * the level `fillIntensity` gave it. `practical-hard-key` is 2.4 key against
 * 0.06 fill; lifting that fill is what would spend the look the preset was
 * tuned for. `ambientGain` above 1 breaks the rule on purpose — that is the
 * control for testing whether the direction needs real radiosity lift.
 */

import type { Vec3 } from './types';

/**
 * `Vec3` is `readonly [number, number, number]` — reuse it, do not declare a
 * second one. Accumulators below are plain mutable triples for that reason.
 */
type Mut3 = [number, number, number];

/** An axis-aligned enclosure, in world metres. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Linear-RGB albedo of each of the six walls. `posY` is the ceiling. */
export interface EnclosureWalls {
  negX: Vec3;
  posX: Vec3;
  negY: Vec3;
  posY: Vec3;
  negZ: Vec3;
  posZ: Vec3;
}

export interface AmbientOptions {
  /** 0 = flat fill exactly as before, 1 = fully chromatic. */
  probeWeight: number;
  /** Level multiplier once mixed. 1 honours "colour, not brightness". */
  ambientGain: number;
  /** Whether the +Y wall exists. An open-topped arena sets this false. */
  ceiling: boolean;
  /** The preset's `fillIntensity` — the level bounce must preserve. */
  fill: number;
  /** The preset's `keyColor` — what flat fill is tinted by today. */
  keyColor: Vec3;
}

/**
 * Distance at which a wall's contribution has fallen to half, in metres.
 * Tuned so a 4 m room reads as a room: at 1 m the near wall clearly leads,
 * at 3 m the walls even out into a general ambient.
 */
const REF_DIST = 1.6;

/** Rec.709 luminance — the same weights the shader uses. */
export function luminance(c: Vec3): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** One wall: an axis (0=x,1=y,2=z), a side (-1 or +1), and a colour. */
interface Wall {
  axis: 0 | 1 | 2;
  side: -1 | 1;
  color: Vec3;
}

function wallsOf(w: EnclosureWalls, ceiling: boolean): Wall[] {
  const all: Wall[] = [
    { axis: 0, side: -1, color: w.negX },
    { axis: 0, side: 1, color: w.posX },
    { axis: 1, side: -1, color: w.negY },
    { axis: 1, side: 1, color: w.posY },
    { axis: 2, side: -1, color: w.negZ },
    { axis: 2, side: 1, color: w.posZ },
  ];
  return ceiling ? all : all.filter((x) => !(x.axis === 1 && x.side === 1));
}

/**
 * The closest point to `p` on the rectangle of the given wall: clamp `p` into
 * the box on the two axes the wall spans, and pin the third to the wall plane.
 */
function closestOnWall(p: Vec3, box: Box, wall: Wall): Mut3 {
  const out: Mut3 = [
    Math.min(Math.max(p[0], box.min[0]), box.max[0]),
    Math.min(Math.max(p[1], box.min[1]), box.max[1]),
    Math.min(Math.max(p[2], box.min[2]), box.max[2]),
  ];
  out[wall.axis] = wall.side < 0 ? box.min[wall.axis] : box.max[wall.axis];
  return out;
}

/**
 * The chromatic ambient at a point, for a surface normal.
 *
 * Returns a linear-RGB colour that REPLACES the scalar `fillIntensity` term
 * in the shading expression. At `probeWeight === 0` it returns exactly
 * `fill * keyColor`, which makes the substitution algebraically identical to
 * the pre-bounce code — the parity guarantee the whole spike rests on.
 */
export function ambientAt(
  p: Vec3,
  n: Vec3,
  box: Box,
  walls: EnclosureWalls,
  opts: AmbientOptions,
): Vec3 {
  const flat: Mut3 = [
    opts.fill * opts.keyColor[0],
    opts.fill * opts.keyColor[1],
    opts.fill * opts.keyColor[2],
  ];
  // Exact early out. Not an optimisation — the parity test asserts equality
  // to 12 decimal places, which floating-point mixing would not survive.
  if (opts.probeWeight <= 0) return flat;

  const acc: Mut3 = [0, 0, 0];
  for (const wall of wallsOf(walls, opts.ceiling)) {
    const c = closestOnWall(p, box, wall);
    const dx = c[0] - p[0];
    const dy = c[1] - p[1];
    const dz = c[2] - p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-5) continue;
    const ndl = Math.max((dx * n[0] + dy * n[1] + dz * n[2]) / dist, 0);
    if (ndl <= 0) continue;
    const t = dist / REF_DIST;
    const falloff = 1 / (1 + t * t);
    const w = ndl * falloff;
    acc[0] += wall.color[0] * w;
    acc[1] += wall.color[1] * w;
    acc[2] += wall.color[2] * w;
  }

  // COLOUR, NOT BRIGHTNESS. Renormalise the accumulation to unit luminance,
  // so what survives is purely its hue; the level then comes from `fill`,
  // exactly as it did before bounce existed. A black or unlit-from-every-
  // -angle room has no hue to offer and falls back to the flat term.
  const lum = luminance(acc);
  const tint: Mut3 = lum > 1e-5
    ? [acc[0] / lum, acc[1] / lum, acc[2] / lum]
    : [opts.keyColor[0], opts.keyColor[1], opts.keyColor[2]];

  const w = Math.min(Math.max(opts.probeWeight, 0), 1);
  const g = opts.fill * opts.ambientGain;
  return [
    flat[0] * (1 - w) + tint[0] * g * w,
    flat[1] * (1 - w) + tint[1] * g * w,
    flat[2] * (1 - w) + tint[2] * g * w,
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/ambient.test.ts`
Expected: PASS, 9 tests.

If `leaves a neutral-grey room neutral` fails, the bug is almost certainly that
`tint` fell back to `keyColor` (which is warm, not neutral) because `lum` was
under threshold — check that the grey walls are actually being accumulated.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ambient.ts src/lab/sdf-zombie/ambient.test.ts
git commit -m "lighting: CPU mirror of the analytic six-wall chromatic ambient"
```

---

## Task 3: The WGSL twin, and the zero-`mapBody` gate

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/ambient.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AMBIENT_AT, AMBIENT_REF_DIST } from './ambient.wgsl';

describe('AMBIENT_AT — the hard perf constraint', () => {
  it('evaluates the SDF field ZERO times', () => {
    // THE gate for this spike, from the spec: "ambientAt must add zero
    // mapBody evaluations". Bounce is analytic — dot products and distance
    // falloff. If this ever fails, the lighting work has started charging
    // the march path and collides head-on with the raymarcher perf plan.
    expect(AMBIENT_AT).not.toContain('mapBody');
    expect(AMBIENT_AT).not.toContain('sdBody');
    expect(AMBIENT_AT).not.toContain('applyWounds');
    expect(AMBIENT_AT).not.toContain('textureSample');
    expect(AMBIENT_AT).not.toContain('textureLoad');
  });

  it('contains no loop that could hide a field sample', () => {
    // The six walls are unrolled deliberately: a loop invites someone to
    // put a march inside it later, and six iterations is not worth one.
    expect(AMBIENT_AT).not.toContain('loop {');
    expect(AMBIENT_AT).not.toContain('while ');
  });
});

describe('AMBIENT_AT — shape contract', () => {
  it('starts with fn, per the wgslFn parse contract', () => {
    // three.js TSL parses the parameter list out of the source string, so
    // the declaration must be the first thing in the file.
    expect(AMBIENT_AT.startsWith('fn ambientAt(')).toBe(true);
  });

  it('returns vec3 — ambient is a colour now, not a scalar', () => {
    expect(AMBIENT_AT).toContain('-> vec3<f32>');
  });

  it('early-outs to exactly fill * keyColor at probeWeight 0', () => {
    // The parity guarantee, pinned in the shader as well as the mirror.
    // Any refactor that turns this into a mix() breaks bit-exactness and
    // silently moves every owner-blessed visual.
    expect(AMBIENT_AT).toContain('if (bounceCfg.x <= 0.0) { return flat; }');
  });

  it('renormalises to unit luminance with Rec.709 weights', () => {
    // COLOUR, NOT BRIGHTNESS. Must match luminance() in ../ambient.ts.
    expect(AMBIENT_AT).toContain('vec3<f32>(0.2126, 0.7152, 0.0722)');
  });

  it('agrees with the CPU mirror on the falloff reference distance', () => {
    // The two copies of the maths share exactly one tunable; if it drifts,
    // the lab and the tests describe different rooms.
    expect(AMBIENT_AT).toContain(`${AMBIENT_REF_DIST}`);
  });

  it('honours the ceiling flag', () => {
    expect(AMBIENT_AT).toContain('bounceCfg.z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts`
Expected: FAIL — `Failed to resolve import "./ambient.wgsl"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lab/sdf-zombie/webgpu/ambient.wgsl.ts`:

```ts
/**
 * `ambientAt` — analytic chromatic ambient from a six-walled enclosure.
 *
 * THE TWIN. This is the GPU copy of `../ambient.ts`. Nothing here compiles
 * WGSL in tests, so the maths is property-tested over there and this string
 * is pinned by `ambient.wgsl.test.ts`. Change one, change both.
 *
 * THE SEAM. The spec names this signature as the single seam every future
 * lighting implementation routes through — analytic bounce now (P1), an
 * irradiance-volume lookup later (P3), cone-tracing the field in the
 * "everything SDF" endgame. Keeping the signature stable is what makes those
 * a data-source swap rather than a shader rewrite, which is the entire reason
 * it was specified before anything was built. Do not widen it casually.
 *
 * ZERO FIELD EVALUATIONS, and this is enforced by test, not by discipline.
 * The six walls are unrolled rather than looped precisely so that no one is
 * tempted to put a march inside the loop later.
 */

/**
 * Half-contribution distance in metres. Shared with `../ambient.ts`; the
 * pin test asserts this literal appears in the WGSL so the two cannot drift.
 */
export const AMBIENT_REF_DIST = 1.6;

export const AMBIENT_AT = /* wgsl */ `fn ambientAt(
  p: vec3<f32>,
  n: vec3<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
  bounceCfg: vec4<f32>,
  fill: f32,
  keyColor: vec3<f32>
) -> vec3<f32> {
  // bounceCfg: x probeWeight, y ambientGain, z ceilingEnabled, w spare.
  let flat = fill * keyColor;

  // EXACT early out, not an optimisation. At probeWeight 0 the caller's
  // expression must collapse to precisely what it was before bounce
  // existed — mixing toward the same value would not be bit-identical, and
  // every owner-blessed visual is calibrated against the old numbers.
  if (bounceCfg.x <= 0.0) { return flat; }

  var acc = vec3<f32>(0.0, 0.0, 0.0);
  let clamped = clamp(p, boxMin, boxMax);

  // Six walls, unrolled. Each is the closest point on that wall's rectangle
  // to p: clamp into the box, then pin the wall's own axis to its plane.
  // wallDir handles the rest — pure arithmetic, no field, no texture.
  let cNegX = vec3<f32>(boxMin.x, clamped.y, clamped.z);
  let cPosX = vec3<f32>(boxMax.x, clamped.y, clamped.z);
  let cNegY = vec3<f32>(clamped.x, boxMin.y, clamped.z);
  let cPosY = vec3<f32>(clamped.x, boxMax.y, clamped.z);
  let cNegZ = vec3<f32>(clamped.x, clamped.y, boxMin.z);
  let cPosZ = vec3<f32>(clamped.x, clamped.y, boxMax.z);

  acc = acc + wallContribution(cNegX, p, n, wallNegX);
  acc = acc + wallContribution(cPosX, p, n, wallPosX);
  acc = acc + wallContribution(cNegY, p, n, wallNegY);
  acc = acc + wallContribution(cPosY, p, n, wallPosY) * step(0.5, bounceCfg.z);
  acc = acc + wallContribution(cNegZ, p, n, wallNegZ);
  acc = acc + wallContribution(cPosZ, p, n, wallPosZ);

  // COLOUR, NOT BRIGHTNESS. Renormalise to unit luminance so only the hue
  // of the accumulation survives; the LEVEL comes from fill, exactly as it
  // did before. practical-hard-key is 2.4 key against 0.06 fill, and
  // lifting that fill is what would spend the blowout the preset was tuned
  // for. A room with nothing lit to offer falls back to the flat tint.
  let lum = dot(acc, vec3<f32>(0.2126, 0.7152, 0.0722));
  let tint = select(keyColor, acc / max(lum, 1e-5), lum > 1e-5);

  let w = clamp(bounceCfg.x, 0.0, 1.0);
  // ambientGain > 1 deliberately breaks the house rule — it is the control
  // for testing whether the look actually wants genuine radiosity lift.
  let g = fill * bounceCfg.y;
  return mix(flat, tint * g, w);
}`;

/**
 * The per-wall term, hoisted so `ambientAt` reads as six identical lines.
 * Emitted before `AMBIENT_AT` in the shader chain.
 */
export const WALL_CONTRIBUTION = /* wgsl */ `fn wallContribution(
  c: vec3<f32>,
  p: vec3<f32>,
  n: vec3<f32>,
  color: vec3<f32>
) -> vec3<f32> {
  let d = c - p;
  let dist = length(d);
  if (dist < 1e-5) { return vec3<f32>(0.0, 0.0, 0.0); }
  let ndl = max(dot(d / dist, n), 0.0);
  let t = dist / ${AMBIENT_REF_DIST};
  return color * (ndl / (1.0 + t * t));
}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/ambient.wgsl.ts src/lab/sdf-zombie/webgpu/ambient.wgsl.test.ts
git commit -m "lighting: ambientAt WGSL twin + zero-mapBody gate"
```

---

## Task 4: The Cornell-box enclosure in the lab scene

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/enclosure.ts`
- Test: `src/lab/sdf-zombie/webgpu/enclosure.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/enclosure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createEnclosure, DEFAULT_WALLS, ENCLOSURE_BOX } from './enclosure';

describe('createEnclosure', () => {
  it('builds six walls and parents them to one group', () => {
    const e = createEnclosure();
    expect(e.group.children).toHaveLength(6);
  });

  it('starts hidden — the lab must look unchanged until it is switched on', () => {
    const e = createEnclosure();
    expect(e.group.visible).toBe(false);
  });

  it('exposes a box matching the wall placement', () => {
    // ambientAt derives every wall position from these bounds, so a
    // mismatch here means the shader lights a room the eye cannot see.
    expect(ENCLOSURE_BOX.min[1]).toBe(0);
    expect(ENCLOSURE_BOX.max[0]).toBeGreaterThan(ENCLOSURE_BOX.min[0]);
    expect(ENCLOSURE_BOX.max[1]).toBeGreaterThan(ENCLOSURE_BOX.min[1]);
    expect(ENCLOSURE_BOX.max[2]).toBeGreaterThan(ENCLOSURE_BOX.min[2]);
  });

  it('places each wall on its own plane of the box', () => {
    const e = createEnclosure();
    const xs = e.group.children.map((c) => +c.position.x.toFixed(4));
    expect(xs).toContain(+ENCLOSURE_BOX.min[0].toFixed(4));
    expect(xs).toContain(+ENCLOSURE_BOX.max[0].toFixed(4));
  });

  it('defaults to the classic Cornell colours — red left, green right', () => {
    expect(DEFAULT_WALLS.negX[0]).toBeGreaterThan(DEFAULT_WALLS.negX[1]);
    expect(DEFAULT_WALLS.posX[1]).toBeGreaterThan(DEFAULT_WALLS.posX[0]);
  });

  it('recolours a wall live, on both the mesh and the returned state', () => {
    const e = createEnclosure();
    e.setWall('negZ', [0.1, 0.2, 0.3]);
    expect(e.walls.negZ).toEqual([0.1, 0.2, 0.3]);
  });

  it('hides only the ceiling when the ceiling is toggled off', () => {
    const e = createEnclosure();
    e.setCeiling(false);
    expect(e.group.children.filter((c) => c.visible)).toHaveLength(5);
    e.setCeiling(true);
    expect(e.group.children.filter((c) => c.visible)).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enclosure.test.ts`
Expected: FAIL — `Failed to resolve import "./enclosure"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lab/sdf-zombie/webgpu/enclosure.ts`:

```ts
import * as THREE from 'three/webgpu';
import type { Box, EnclosureWalls, Vec3 } from '../ambient';

/**
 * A toggleable Cornell-box enclosure for the bounce spike.
 *
 * SCOPE. This is the same category of object as the lab's existing reference
 * cube — a thing to look at, not a room format. The spec is explicit that P1
 * must not depend on a level concept, because there isn't one: `src/game/
 * arena.ts` and `src/sim/arenagen` are pre-SDF WIP the owner has moved past.
 * A real room editor is P2 and is blocked on deciding that levels are next.
 *
 * The walls are plain unlit meshes. They are what the character's bounce is
 * derived FROM; they are not themselves lit by it, and giving them real
 * materials would only invite comparing two different lighting models in one
 * frame.
 */

/** The room, in world metres. The floor sits at y=0 with the lab's floor. */
export const ENCLOSURE_BOX: Box = {
  min: [-2, 0, -2],
  max: [2, 3.2, 2],
};

/**
 * Classic Cornell colours: red left, green right, white elsewhere. Chosen
 * because the whole point of the spike is to see whether a wall's hue
 * reaches the character's shadow side, and these are the two hues the eye
 * is least able to explain away.
 */
export const DEFAULT_WALLS: EnclosureWalls = {
  negX: [0.63, 0.06, 0.05],
  posX: [0.15, 0.48, 0.09],
  negY: [0.73, 0.71, 0.68],
  posY: [0.73, 0.72, 0.70],
  negZ: [0.73, 0.71, 0.68],
  posZ: [0.73, 0.71, 0.68],
};

export type WallKey = keyof EnclosureWalls;

const WALL_ORDER: WallKey[] = ['negX', 'posX', 'negY', 'posY', 'negZ', 'posZ'];

export interface Enclosure {
  group: THREE.Group;
  walls: EnclosureWalls;
  setWall(key: WallKey, color: Vec3): void;
  setCeiling(on: boolean): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

export function createEnclosure(): Enclosure {
  const group = new THREE.Group();
  group.name = 'bounce-enclosure';
  group.visible = false;

  const walls: EnclosureWalls = {
    negX: [...DEFAULT_WALLS.negX] as Vec3,
    posX: [...DEFAULT_WALLS.posX] as Vec3,
    negY: [...DEFAULT_WALLS.negY] as Vec3,
    posY: [...DEFAULT_WALLS.posY] as Vec3,
    negZ: [...DEFAULT_WALLS.negZ] as Vec3,
    posZ: [...DEFAULT_WALLS.posZ] as Vec3,
  };

  const w = ENCLOSURE_BOX.max[0] - ENCLOSURE_BOX.min[0];
  const h = ENCLOSURE_BOX.max[1] - ENCLOSURE_BOX.min[1];
  const d = ENCLOSURE_BOX.max[2] - ENCLOSURE_BOX.min[2];
  const cx = (ENCLOSURE_BOX.min[0] + ENCLOSURE_BOX.max[0]) / 2;
  const cy = (ENCLOSURE_BOX.min[1] + ENCLOSURE_BOX.max[1]) / 2;
  const cz = (ENCLOSURE_BOX.min[2] + ENCLOSURE_BOX.max[2]) / 2;

  const meshes = new Map<WallKey, THREE.Mesh>();

  for (const key of WALL_ORDER) {
    let geo: THREE.PlaneGeometry;
    const mesh = new THREE.Mesh();
    switch (key) {
      case 'negX':
        geo = new THREE.PlaneGeometry(d, h);
        mesh.position.set(ENCLOSURE_BOX.min[0], cy, cz);
        mesh.rotation.y = Math.PI / 2;
        break;
      case 'posX':
        geo = new THREE.PlaneGeometry(d, h);
        mesh.position.set(ENCLOSURE_BOX.max[0], cy, cz);
        mesh.rotation.y = -Math.PI / 2;
        break;
      case 'negY':
        geo = new THREE.PlaneGeometry(w, d);
        mesh.position.set(cx, ENCLOSURE_BOX.min[1], cz);
        mesh.rotation.x = -Math.PI / 2;
        break;
      case 'posY':
        geo = new THREE.PlaneGeometry(w, d);
        mesh.position.set(cx, ENCLOSURE_BOX.max[1], cz);
        mesh.rotation.x = Math.PI / 2;
        break;
      case 'negZ':
        geo = new THREE.PlaneGeometry(w, h);
        mesh.position.set(cx, cy, ENCLOSURE_BOX.min[2]);
        break;
      default:
        geo = new THREE.PlaneGeometry(w, h);
        mesh.position.set(cx, cy, ENCLOSURE_BOX.max[2]);
        mesh.rotation.y = Math.PI;
        break;
    }
    const c = walls[key];
    mesh.geometry = geo;
    mesh.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),
      side: THREE.DoubleSide,
    });
    mesh.name = `wall-${key}`;
    meshes.set(key, mesh);
    group.add(mesh);
  }

  return {
    group,
    walls,
    setWall(key, color) {
      walls[key] = [...color] as Vec3;
      const m = meshes.get(key);
      if (m) {
        (m.material as THREE.MeshBasicMaterial).color.setRGB(color[0], color[1], color[2]);
      }
    },
    setCeiling(on) {
      const m = meshes.get('posY');
      if (m) m.visible = on;
    },
    setVisible(on) {
      group.visible = on;
    },
    dispose() {
      for (const m of meshes.values()) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enclosure.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/enclosure.ts src/lab/sdf-zombie/webgpu/enclosure.test.ts
git commit -m "lighting: toggleable Cornell-box enclosure for the bounce spike"
```

---

## Task 5: Plumb the uniforms

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (three sites: ~293, ~467, ~857, ~944)
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.ts:214`

- [ ] **Step 1: Declare the uniforms**

In `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, in `defaultUniforms()`, directly
after the existing `woundShadowCfg` line (currently line 293), add:

```ts
    /**
     * ENVIRONMENT BOUNCE (lighting P1). The enclosure's bounds and its six
     * wall colours, from which `ambientAt` derives an analytic chromatic
     * ambient — no field sampling, by design and by test.
     *
     * bounceCfg: x probeWeight (0 = flat fill exactly as before, the
     * shipped default), y ambientGain, z ceilingEnabled, w spare.
     *
     * Defaults describe the lab's Cornell box but contribute NOTHING until
     * probeWeight moves, so this whole block is inert on arrival.
     */
    bounceCfg: uniform(new THREE.Vector4(0, 1, 1, 0)),
    boxMin: uniform(new THREE.Vector3(-2, 0, -2)),
    boxMax: uniform(new THREE.Vector3(2, 3.2, 2)),
    wallNegX: uniform(new THREE.Color(0.63, 0.06, 0.05)),
    wallPosX: uniform(new THREE.Color(0.15, 0.48, 0.09)),
    wallNegY: uniform(new THREE.Color(0.73, 0.71, 0.68)),
    wallPosY: uniform(new THREE.Color(0.73, 0.72, 0.70)),
    wallNegZ: uniform(new THREE.Color(0.73, 0.71, 0.68)),
    wallPosZ: uniform(new THREE.Color(0.73, 0.71, 0.68)),
```

- [ ] **Step 2: Bind them to the shader**

In the same file, in the binding object literal, directly after
`woundShadowCfg: u.woundShadowCfg,` (currently line 467), add:

```ts
    bounceCfg: u.bounceCfg,
    boxMin: u.boxMin,
    boxMax: u.boxMax,
    wallNegX: u.wallNegX,
    wallPosX: u.wallPosX,
    wallNegY: u.wallNegY,
    wallPosY: u.wallPosY,
    wallNegZ: u.wallNegZ,
    wallPosZ: u.wallPosZ,
```

- [ ] **Step 3: Carry the preset knobs through `applyMaterial`**

Find the line `u.lightCfg.value.set(light.keyIntensity, light.fillIntensity);`
(currently line 857). Directly after it add:

```ts
      // probeWeight/ambientGain ride the preset so a horror beat can dial
      // bounce to zero without touching the enclosure. z (ceiling) and w
      // stay where the panel left them — they describe the room, not the
      // lighting mood.
      u.bounceCfg.value.x = light.probeWeight;
      u.bounceCfg.value.y = light.ambientGain;
```

- [ ] **Step 4: Copy them into chunk views**

Find `u.lightCfg.value.copy(template.lightCfg.value);` (currently line 944).
Directly after it add:

```ts
    // Chunks must light like the body they came off. Miss this and gibs
    // carry the old flat fill while the torso takes the room's colour.
    u.bounceCfg.value.copy(template.bounceCfg.value);
    u.boxMin.value.copy(template.boxMin.value);
    u.boxMax.value.copy(template.boxMax.value);
    u.wallNegX.value.copy(template.wallNegX.value);
    u.wallPosX.value.copy(template.wallPosX.value);
    u.wallNegY.value.copy(template.wallNegY.value);
    u.wallPosY.value.copy(template.wallPosY.value);
    u.wallNegZ.value.copy(template.wallNegZ.value);
    u.wallPosZ.value.copy(template.wallPosZ.value);
```

- [ ] **Step 5: Do the same for the FPV hands**

In `src/lab/sdf-zombie/webgpu/fpv-view.ts`, find
`u.lightCfg.value.copy(template.lightCfg.value);` (currently line 214) and add
the identical nine `copy` lines after it, with the same comment.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

The shader does not read these yet — that is Task 6. This step is separated so
that if TSL rejects a uniform type, the failure is isolated to plumbing.

- [ ] **Step 7: Verify the lab still renders unchanged**

Run: `npm run dev`, open `/sdf-lab-webgpu.html`.
Expected: the zombie renders exactly as before. Nine unused uniforms are bound;
nothing reads them.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/fpv-view.ts
git commit -m "lighting: plumb enclosure + bounce uniforms through to the march"
```

---

## Task 6: Wire `ambientAt` into the shading block

This is the task that changes pinned strings. Read the trap note in
Orientation before starting.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (imports, chain, signature, two shading sites, the uniform doc block)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts:389, 392, 938`

- [ ] **Step 1: Update the pin tests FIRST, so they fail**

In `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`, replace line 389's assertion:

```ts
    expect(MARCH_BODY).toContain(
      'albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao');
```

Replace line 938's assertion with the identical string:

```ts
    expect(MARCH_BODY).toContain('albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao');
```

Leave line 392 (`expect(MARCH_BODY).not.toContain('lightCfg.y * wShadow')`)
exactly as it is — it still holds, and it still says the thing it was written
to say: the fill/ambient term must never carry the wound shadow.

Then add a new test to the same `describe` block that holds line 938:

```ts
  it('routes ambient through ambientAt, and pays for it once', () => {
    // The seam from the lighting spec. One call, before the two sites that
    // consume it — recomputing per-site would double an already-unrolled
    // six-wall accumulation for no gain.
    expect(MARCH_BODY.match(/ambientAt\(/g) ?? []).toHaveLength(1);
    // The key path keeps keyColor; the ambient path must NOT be tinted by
    // the lamp any more. That tint is exactly what ambientAt now decides.
    expect(MARCH_BODY).not.toContain('(lightCfg.y + diff');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: FAIL — three assertions, on the not-yet-written string.

- [ ] **Step 3: Import the new WGSL into the chain**

At the top of `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, add:

```ts
import { AMBIENT_AT, WALL_CONTRIBUTION } from './ambient.wgsl';
```

`HELPERS` is an **array** of WGSL source strings (line 1663), concatenated as-is
by `wgslFn`. Its header comment says the order is load-bearing: WGSL requires
declaration before use, and — in its own words — *an omitted helper passes every
unit test and fails at pipeline creation with a bare WGSL parse error pointing
at the call site.*

Append both entries to the end of that array, `WALL_CONTRIBUTION` **first**
because `AMBIENT_AT` calls it:

```ts
  MAP_BODY, CALC_NORMAL, WOUND_SHADOW, TEXEL, FLICKER,
  WALL_CONTRIBUTION, AMBIENT_AT,
];
```

You get this checked for free: `march.wgsl.test.ts:52` — *"orders HELPERS so
each only calls the ones before it"* — walks the array and will fail if you put
them in the wrong order or reference something not yet declared. Run it and
believe it.

- [ ] **Step 4: Extend the `marchBody` signature**

In `MARCH_BODY`, after the `woundShadowCfg: vec2<f32>,` parameter (currently
line 1048), add:

```wgsl
  bounceCfg: vec4<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
```

- [ ] **Step 5: Document them in the uniform block comment**

In the big uniform doc comment above `MARCH_BODY`, after the `woundShadowCfg`
entry (currently lines 1005-1006), add:

```
//   bounceCfg  x probeWeight (0 = flat fill, bit-identical to pre-bounce),
//              y ambientGain, z ceilingEnabled, w spare
//   boxMin/boxMax  the enclosure bounds ambientAt derives wall planes from
//   wallNegX..wallPosZ  the six wall albedos, linear RGB
```

- [ ] **Step 6: Compute the ambient once, then use it at both sites**

Find the `var fleshLit = ...` line (currently line 1544). Immediately **above**
it, insert:

```wgsl
  // ENVIRONMENT BOUNCE (lighting P1). Replaces the flat scalar fill with a
  // chromatic ambient derived analytically from the enclosure's six walls.
  //
  // At bounceCfg.x == 0 this returns exactly lightCfg.y * keyColor, which
  // makes the two expressions below algebraically identical to what they
  // were before bounce existed — the parity guarantee the spike rests on,
  // and the reason every preset ships with probeWeight 0.
  //
  // ZERO extra mapBody evaluations: ambientAt is dot products and distance
  // falloff, gated by a test that greps its source for field calls. The
  // post-hit eval budget is unchanged.
  let amb = ambientAt(p, n, boxMin, boxMax, wallNegX, wallPosX, wallNegY, wallPosY, wallNegZ, wallPosZ, bounceCfg, lightCfg.y, keyColor);
```

Then replace the `fleshLit` assignment. Note that `keyColor` moves **inside**
the parenthesis onto the key term only — ambient decides its own colour now:

```wgsl
  var fleshLit = albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao
               + keyColor * (shine * wShadow * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet
               + scatter;
```

And replace the flat-lit decal mix (currently line 1553) the same way:

```wgsl
  fleshLit = mix(fleshLit,
                 albedo * (amb + 0.52 * lightCfg.x * keyColor),
                 faceFlat * 0.85);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab`
Expected: PASS, the full suite green (1517 + the new files' tests).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Verify parity by eye — the critical gate**

Run: `npm run dev`, open `/sdf-lab-webgpu.html`.
Expected: **pixel-identical to before this task.** `probeWeight` defaults to 0,
so `amb` is `lightCfg.y * keyColor` and the algebra is unchanged.

If anything moved, stop and fix it before continuing. A drift here means the
early-out is not exact, and every visual judgement made after this point would
be made against a shifted baseline.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "lighting: route ambient through ambientAt — parity-exact at probeWeight 0"
```

---

## Task 7: Lab panel — the A/B the owner actually judges

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts` (scene setup ~line 334; panel ~line 2436)

- [ ] **Step 1: Add the enclosure to the scene**

In `src/lab/sdf-zombie/webgpu/lab-main.ts`, after the `refCube` block (currently
ends line 334), add:

```ts
  // Bounce spike enclosure (lighting P1). Same category of object as the
  // reference cube above — something to look at, not a room format. Hidden
  // until the panel switches it on.
  const enclosure = createEnclosure();
  scene.add(enclosure.group);
```

Add to the imports at the top of the file:

```ts
import { createEnclosure, type WallKey } from './enclosure';
```

- [ ] **Step 2: Add the panel controls**

Find the `addSelect(presetBox, 'light', ...)` call (currently line 2436). After
the block it belongs to, add a new section:

```ts
  // ── Environment bounce (lighting P1) ────────────────────────────────
  // The spike's whole user interface. The question it exists to answer is
  // narrow: does the shadow side taking the wall's colour make the figure
  // feel IN the room without softening the hard-key look? So the A/B has to
  // be one click, on the same frame, with nothing else moving.
  const bounceBox = addSection(panel, 'environment bounce');

  // addButton returns the element and the handler closes over it — the house
  // idiom, see texBtn at lab-main.ts:2516.
  const boxBtn = addButton(bounceBox, 'enclosure: off', () => {
    const on = !enclosure.group.visible;
    enclosure.setVisible(on);
    boxBtn.textContent = `enclosure: ${on ? 'on' : 'off'}`;
  });

  // SliderSpec is { label, min, max, step, get(), set(v) } — a getter, not a
  // starting value, so the slider re-reads the uniform rather than caching it.
  addSlider(bounceBox, {
    label: 'probeWeight', min: 0, max: 1, step: 0.01,
    get: () => u.bounceCfg.value.x,
    set: (v) => { u.bounceCfg.value.x = v; },
  });

  addSlider(bounceBox, {
    label: 'ambientGain', min: 0, max: 4, step: 0.05,
    get: () => u.bounceCfg.value.y,
    set: (v) => { u.bounceCfg.value.y = v; },
  });

  const ceilBtn = addButton(bounceBox, 'ceiling: on', () => {
    const on = u.bounceCfg.value.z < 0.5;
    u.bounceCfg.value.z = on ? 1 : 0;
    enclosure.setCeiling(on);
    ceilBtn.textContent = `ceiling: ${on ? 'on' : 'off'}`;
  });

  // One-click A/B. Parks probeWeight at 1 or 0 and remembers where the
  // slider was, so the comparison is repeatable rather than re-dialled by
  // hand each time — a slider nudged to 0.97 is not the same comparison.
  let parkedWeight = 1;
  const abBtn = addButton(bounceBox, 'A/B: flat', () => {
    if (u.bounceCfg.value.x > 0) {
      parkedWeight = u.bounceCfg.value.x;
      u.bounceCfg.value.x = 0;
      abBtn.textContent = 'A/B: flat';
    } else {
      u.bounceCfg.value.x = parkedWeight;
      abBtn.textContent = 'A/B: bounce';
    }
  });

  // Per-wall colour pickers. Each writes BOTH the mesh and the uniform, so
  // what the eye sees on the wall and what the shader bounces off it cannot
  // disagree — a mismatch there would invalidate the whole judgement.
  const WALL_UNIFORMS: Record<WallKey, typeof u.wallNegX> = {
    negX: u.wallNegX, posX: u.wallPosX, negY: u.wallNegY,
    posY: u.wallPosY, negZ: u.wallNegZ, posZ: u.wallPosZ,
  };
  for (const key of Object.keys(WALL_UNIFORMS) as WallKey[]) {
    const input = document.createElement('input');
    input.type = 'color';
    const c = enclosure.walls[key];
    input.value = '#' + new THREE.Color(c[0], c[1], c[2]).getHexString();
    input.addEventListener('input', () => {
      const col = new THREE.Color(input.value);
      enclosure.setWall(key, [col.r, col.g, col.b]);
      WALL_UNIFORMS[key].value.setRGB(col.r, col.g, col.b);
    });
    const row = document.createElement('label');
    row.textContent = key;
    row.appendChild(input);
    bounceBox.appendChild(row);
  }
```

Signatures used above, verified against `src/lab/sdf-zombie/panel.ts`:
`addSection(parent, title) -> HTMLElement` (line 95),
`addButton(parent, label, onClick) -> HTMLButtonElement` (line 122),
`addSlider(parent, spec) -> HTMLInputElement` where `spec` is
`{ label, min, max, step, get(), set(v) }` (lines 66-76).
Add `addSection` to the existing panel import at `lab-main.ts:164` if it is not
already there. Do not change `panel.ts` to fit this code.

- [ ] **Step 3: Dispose the enclosure with the rest of the scene**

Find the existing teardown block (search for `chunkMaterial.dispose()`, around
line 540) and add `enclosure.dispose();` alongside it.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run src/lab`
Expected: PASS, full suite green.

- [ ] **Step 5: Verify by hand in the lab**

Run: `npm run dev`, open `/sdf-lab-webgpu.html`.

Check each of these, and note anything that fails:
1. Panel opens with `enclosure: off`, character unchanged from main.
2. `enclosure: on` shows a red-left/green-right Cornell box.
3. `probeWeight` at 1 tints the character's shadow side red on the left,
   green on the right.
4. `A/B: flat` returns it exactly to the flat look, repeatably.
5. Picking a blue left wall turns the left shadow side blue.
6. `ceiling: off` hides the ceiling plane and changes the bounce.
7. `ambientGain` above 1 visibly lifts the shadow side.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "lighting: lab panel for the bounce spike — enclosure, knobs, one-click A/B"
```

---

## Task 8: Measure, judge, and write the finding down

The spec names four acceptance criteria. Three are measurable here; the fourth
is the owner's eye and is the deliverable this task hands them.

**Files:**
- Create: `docs/dev-notes/2026-08-25-bounce-spike-findings.md`

- [ ] **Step 1: Confirm the eval count is unchanged**

The static gate already ran in Task 3. Confirm the runtime picture too, using
the prims-per-pixel heatmap that perf task-2 landed:

In the lab console, capture the heatmap with bounce off and on:

```js
__sdfLab.u.debugCfg.value.x = 2;   // prims-per-pixel heatmap
__sdfLab.u.bounceCfg.value.x = 0;  // screenshot this
__sdfLab.u.bounceCfg.value.x = 1;  // and this
__sdfLab.u.debugCfg.value.x = 0;
```

Expected: the two heatmaps are **indistinguishable**. If they differ at all,
something is sampling the field inside the ambient path and the spike has
broken its own constraint — stop and find it.

If `__sdfLab` does not expose `u`, find what the lab does expose (search
`lab-main.ts` for `__sdfLab`) and use that; do not add a new global for this.

- [ ] **Step 2: Measure the frame cost**

Run: `npm run bench:sdf`

Run it twice — once on `main`, once on this branch with `probeWeight` at 1 —
and record both. The baselines to compare against are the quiet-host numbers
from perf task-1, in `docs/dev-notes/2026-08-24-sdf-bench/baselines.json`:
scene A 42.8 median / 111.7 p95, scene B 18.4 / 47.0.

Note the host caveat recorded with those baselines: they are min-p95 of 5 runs
over 60s, and the original numbers were 32-40% pessimistic because the host was
contended. Check `uptime` before trusting a comparison.

- [ ] **Step 3: Check that `clay` still reads as clay**

Spec acceptance criterion 4. In the lab, switch the flesh preset to `clay` with
`probeWeight` at 1.

Expected: matte. If it has acquired a sheen, the ambient is feeding the
specular path — it must not; `amb` appears only in the two diffuse terms.

- [ ] **Step 4: Capture the A/B for the owner**

Take four screenshots at the same camera: flat vs bounce, in a red room and in
a blue room, on `henenlotter-latex` with `practical-hard-key`. Save them to
`docs/dev-notes/2026-08-25-bounce-spike/`.

- [ ] **Step 5: Write the findings note**

Create `docs/dev-notes/2026-08-25-bounce-spike-findings.md` covering:
- The four acceptance criteria and whether each passed, with the numbers.
- Screenshots.
- **Open question 1** — is ~6 walls enough to read as GI, or does it look like
  obvious point lights? Raise the count by subdividing walls if it is unclear.
- **Open question 2** — does the enclosure need a ceiling? Answer from the
  toggle.
- **Open question 3** — should `clay` get its own `probeWeight`? A matte preset
  may want *more* bounce, not less, since it has no specular to carry form.
- The honest verdict, **including a negative one**. The spec is explicit that
  "chromatic ambient does not sell it" is a real outcome: it would mean the
  direction needs genuine radiosity lift, and P3's design changes accordingly.
  Do not soften this into a maybe. If `ambientGain` had to go well above 1 to
  read at all, say so plainly — that IS the negative result.

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-08-25-bounce-spike-findings.md docs/dev-notes/2026-08-25-bounce-spike/
git commit -m "lighting: bounce spike findings + A/B captures"
```

---

## Out of scope — do not do these

From the spec's "Not in scope", plus two traps specific to this codebase:

- No probe bake, no volume texture, no room editor, no room format, no SDF
  walls, no refraction, no screen-space bleed. If the analytic version cannot
  sell the look, adding screen-space effects on top muddies the verdict rather
  than rescuing it.
- **Do not touch `relax` / `woundCfg2.y`.** It is 1.0 deliberately; 1.4 was the
  cause of the wound-halo bug and is owned by perf task-1b.
- **Do not extend bounce to `goo-layer.ts` or `humanoid.wgsl.ts`.** They share
  the light uniform *nodes* (`lab-main.ts:549`) and it is tempting. The spike is
  about character flesh; widening it doubles the surface area under judgement.
- Do not retune the flesh presets. They are tuned against a missing sRGB encode
  and fixing that is X1.3 — one job, not two.

## Rebase note

Perf **task-2** ("cheaper hit shading") rewrites the same shading block this
plan touches, and is `queued` (inert) behind task-1b. Whichever lands second
rebases. This plan is deliberately small enough to be the one that moves: the
spec called that out as the reason a probe *system* was not attempted here.
