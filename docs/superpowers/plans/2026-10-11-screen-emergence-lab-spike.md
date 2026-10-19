# The Screen Emergence Lab Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scrubbable lab page where the goblin sits at his CRT and the screen goes fluid: the glass swells, an egg bigger than the screen balloons most of a metre out, the sac tears with wet lips and strands, the egg slumps out and the goblin touches it, the screen heals. The look is judged by the owner before any plumbing exists.

**Architecture:** Logic in pure, tested modules (`emergence-timeline`, `emergence-field`, `goo-strands`); drawing in one hand-written WGSL march on a proxy box (the egg pass's pattern); the real SDF goblin through `createCharacterView` and the pose layer, with new angle-only `reach`/`touch` clips; a headless capture script for compile checks, key frames and cost; and, as its own task, a home-clothes goblin variant whose vest and shorts are SDF `shell` cloth.

**Tech Stack:** TypeScript, Vitest, three.js WebGPU + TSL `wgslFn`, WGSL, the `.blob` language, the lab servers (`scripts/lab-servers.sh`), headless Chrome.

**Spec:** [`docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md`](../specs/2026-10-11-screen-emergence-lab-spike-design.md) (read it first). **Branch:** `claude/screen-emergence-lab` (stacked on `claude/goblin-human-height`, PR #46). **Owner decisions folded in (2026-10-11):** the egg and sac reach about 0.73 m out ("most of a metre" is fine); the home shirt and shorts are **SDF cloth** (`shell` prims), not a WAM mesh kit, because cloth reads more fluid.

**House rules (`CLAUDE.md`):** do not run the full test suite; use `npm run typecheck`, `npm run test:changed`, `npx vitest run <path>`. CI runs everything on push. Plans' rendering is hand-written WGSL (release is a Rust + wgpu port): no three.js in the pure modules. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The owner's own dev server runs on port 5173: leave it alone; the lab servers use `LAB_VITE_PORT=5244 LAB_CDP_PORT=9244`.

## File structure

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/emergence-timeline.ts` + `.test.ts` | **new**, pure: cue curves, shots |
| `src/lab/sdf-zombie/webgpu/emergence-field.ts` + `.test.ts` | **new**, pure: CPU twin of the field, constants, picture table |
| `src/lab/sdf-zombie/webgpu/goo-strands.ts` + `.test.ts` | **new**, pure: strands, beads, drips |
| `src/lab/sdf-zombie/characters/goblin-poses.ts`, `goblin-poses.test.ts` | `REACH`, `TOUCH` |
| `sdf-screen-lab.html`, `src/lab/sdf-zombie/webgpu/screen-lab-main.ts` | **new**: the page |
| `src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts` | **new**: the march and the shading |
| `scripts/screen-emergence-check.sh`, `.mjs` | **new**: headless check, sheet, cost |
| `src/lab/sdf-zombie/characters/goblin-home.blob` + `goblin-home.test.ts`; `character-registry.ts` | **new** variant with `shell` cloth; registry entry |
| `docs/dev-notes/2026-10-11-screen-emergence/NOTES.md` + sheets; `TASKS.md`, `docs/tasks/*.md`; module index | docs |

All new `webgpu/` modules sit beside `egg-look.ts`/`egg.wgsl.ts`, the closest precedents (a pure twin and its WGSL). Run `npx tsx scripts/module-index.ts` after adding modules (`scripts/module-index.test.ts` pins the generated index).

---

### Task 1: `emergence-timeline.ts`, the cue curves

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/emergence-timeline.ts`
- Test: `src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts
import { describe, it, expect } from 'vitest';
import { CURVES, DURATION, SHOTS, evalCurve, paramsAt, shotAt, type ParamName } from './emergence-timeline';

const NAMES = Object.keys(CURVES) as ParamName[];
const grid = (step: number) => Array.from({ length: Math.round(DURATION / step) + 1 }, (_, i) => i * step);

describe('emergence timeline', () => {
  it('every curve starts at t = 0, ends at DURATION, ascends strictly and stays within 0..1', () => {
    for (const n of NAMES) {
      const ks = CURVES[n];
      expect(ks[0]!.t, n).toBe(0);
      expect(ks[ks.length - 1]!.t, n).toBe(DURATION);
      for (let i = 1; i < ks.length; i++) expect(ks[i]!.t, `${n} key ${i}`).toBeGreaterThan(ks[i - 1]!.t);
      for (const k of ks) { expect(k.v, n).toBeGreaterThanOrEqual(0); expect(k.v, n).toBeLessThanOrEqual(1); }
    }
  });

  it('starts at rest: nothing pushed, torn, slumped or healed', () => {
    const p = paramsAt(0);
    expect(p.push).toBe(0); expect(p.tear).toBe(0); expect(p.slump).toBe(0); expect(p.heal).toBe(0); expect(p.lipBow).toBe(0);
  });

  it('holds its last value past DURATION and its first before 0', () => {
    expect(paramsAt(DURATION + 5)).toEqual(paramsAt(DURATION));
    expect(paramsAt(-3)).toEqual(paramsAt(0));
  });

  it('push, slump and heal never go backwards', () => {
    for (const n of ['push', 'slump', 'heal'] as const) {
      let prev = -1;
      for (const t of grid(0.05)) { const v = paramsAt(t)[n]; expect(v, `${n} t=${t}`).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    }
  });

  it('the tear only opens until the egg is out, and closes only after', () => {
    const outEnd = SHOTS.find(s => s.id === 'out')!.end;
    let prev = -1;
    for (const t of grid(0.05).filter(t => t <= outEnd)) { const v = paramsAt(t).tear; expect(v, `t=${t}`).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    expect(paramsAt(outEnd).tear).toBe(1);
    expect(paramsAt(DURATION).tear).toBe(0);
  });

  it('the bezel stays slightly warped after the heal (the lip bows, then relaxes but not to zero)', () => {
    expect(paramsAt(DURATION).lipBow).toBeGreaterThan(0.1);
    expect(paramsAt(DURATION).lipBow).toBeLessThan(paramsAt(SHOTS.find(s => s.id === 'out')!.end).lipBow);
  });

  it('is continuous: no parameter jumps more than 0.02 in 10 ms', () => {
    for (const t of grid(0.01)) {
      const a = paramsAt(t), b = paramsAt(t + 0.01);
      for (const n of NAMES) expect(Math.abs(b[n] - a[n]), `${n} t=${t}`).toBeLessThan(0.02);
    }
  });

  it('the shots tile 0..DURATION in order and shotAt finds them', () => {
    expect(SHOTS[0]!.start).toBe(0);
    expect(SHOTS[SHOTS.length - 1]!.end).toBe(DURATION);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i]!.start).toBe(SHOTS[i - 1]!.end);
    for (const s of SHOTS) { expect(shotAt((s.start + s.end) / 2).id).toBe(s.id); expect(shotAt(s.start).id).toBe(s.id); }
    expect(shotAt(DURATION + 9).id).toBe(SHOTS[SHOTS.length - 1]!.id);
    expect(shotAt(-1).id).toBe(SHOTS[0]!.id);
  });

  it('evalCurve interpolates: linear midpoint, smooth midpoint equal at 0.5, smooth is flat at the ends', () => {
    const lin = [{ t: 0, v: 0 }, { t: 2, v: 1 }];
    const smo = [{ t: 0, v: 0 }, { t: 2, v: 1, ease: 'smooth' as const }];
    expect(evalCurve(lin, 1)).toBeCloseTo(0.5, 12);
    expect(evalCurve(smo, 1)).toBeCloseTo(0.5, 12);
    expect(evalCurve(smo, 0.1)).toBeLessThan(evalCurve(lin, 0.1));
    expect(evalCurve(smo, 1.9)).toBeGreaterThan(evalCurve(lin, 1.9));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts`
Expected: FAIL (`Failed to load url ./emergence-timeline`).

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/emergence-timeline.ts
//
// THE SCREEN EMERGENCE's cue curves (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 5): from a time
// `t` in seconds, the screen pass's eight parameters and which shot we are in. Authored keys with easing, no simulation, no renderer.
// The page's clock is the only source of `t`; everything here is a pure function of it, so a scrub and a playback show the same frame.

export type Ease = 'linear' | 'smooth';

/** Every parameter runs 0..1. `push`: how far the egg has pushed out through the glass. `thin`: how thin and translucent the sheet is.
 *  `lipBow`: the bezel's lip bowing outward (and staying slightly warped after the heal). `tear`: how far the tear has opened. `slump`: the egg
 *  leaving the sac and falling to the desk. `heal`: the sac sucking back into the frame. `ripple`: the travelling ripple on the glass.
 *  `glow`: the egg's light. */
export interface EmergenceParams { ripple: number; push: number; thin: number; lipBow: number; tear: number; slump: number; heal: number; glow: number }
export type ParamName = keyof EmergenceParams;

/** A key: the value at time `t`. `ease` shapes the segment ENDING at this key (default linear). */
export interface Key { t: number; v: number; ease?: Ease }
export type Curves = Readonly<Record<ParamName, readonly Key[]>>;

export type ShotId = 'glass-gives' | 'push' | 'crowning' | 'out' | 'settle';
export interface Shot { id: ShotId; start: number; end: number }

export const DURATION = 14.5;

/** The draft's shots 3 to 7 (spec section 5). Boundaries are where the camera presets cut. */
export const SHOTS: readonly Shot[] = [
  { id: 'glass-gives', start: 0, end: 2.5 },
  { id: 'push', start: 2.5, end: 6.5 },
  { id: 'crowning', start: 6.5, end: 9 },
  { id: 'out', start: 9, end: 11.5 },
  { id: 'settle', start: 11.5, end: DURATION },
];

/** First-round values; the look rounds tune these (they are the cheap knobs). */
export const CURVES: Curves = {
  ripple: [{ t: 0, v: 0 }, { t: 1.2, v: 1, ease: 'smooth' }, { t: 2.5, v: 0.6, ease: 'smooth' }, { t: 6.5, v: 0.25, ease: 'smooth' }, { t: 9, v: 0, ease: 'smooth' }, { t: DURATION, v: 0 }],
  push: [{ t: 0, v: 0 }, { t: 2.5, v: 0.12, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
  thin: [{ t: 0, v: 0 }, { t: 2.5, v: 0 }, { t: 3.5, v: 0.15, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: DURATION, v: 0.2, ease: 'smooth' }],
  lipBow: [{ t: 0, v: 0 }, { t: 2.5, v: 0 }, { t: 6.5, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: DURATION, v: 0.25, ease: 'smooth' }],
  tear: [{ t: 0, v: 0 }, { t: 6.5, v: 0 }, { t: 7, v: 0.15, ease: 'smooth' }, { t: 8, v: 0.6, ease: 'smooth' }, { t: 9, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: 13.5, v: 0, ease: 'smooth' }, { t: DURATION, v: 0 }],
  slump: [{ t: 0, v: 0 }, { t: 9, v: 0 }, { t: 11.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
  heal: [{ t: 0, v: 0 }, { t: 11.5, v: 0 }, { t: DURATION, v: 1, ease: 'smooth' }],
  glow: [{ t: 0, v: 0.2 }, { t: 2.5, v: 0.3, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
};

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** The curve's value at `t`: its first key before the start, its last after the end, eased between. */
export function evalCurve(keys: readonly Key[], t: number): number {
  if (t <= keys[0]!.t) return keys[0]!.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  let i = 1;
  while (keys[i]!.t < t) i++;
  const a = keys[i - 1]!, b = keys[i]!;
  const u = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * (b.ease === 'smooth' ? smoothstep(u) : u);
}

export function paramsAt(t: number, curves: Curves = CURVES): EmergenceParams {
  const out = {} as EmergenceParams;
  for (const n of Object.keys(curves) as ParamName[]) out[n] = evalCurve(curves[n], t);
  return out;
}

/** The shot `t` falls in (the first before 0, the last after the end). */
export function shotAt(t: number): Shot {
  for (const s of SHOTS) if (t < s.end) return s;
  return SHOTS[SHOTS.length - 1]!;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts && npm run typecheck`
Expected: PASS. (`shotAt(s.start)` for the first shot returns it because `0 < 2.5`; for later shots `s.start` equals the previous shot's `end`, and `t < end` is false for the previous, so it lands in `s`. If the "continuous" test trips at a key (a curve that jumps), the curve's keys are wrong: fix the keys, not the test.)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/emergence-timeline.ts src/lab/sdf-zombie/webgpu/emergence-timeline.test.ts
git commit -m "feat(emergence): the cue curves and shots, pure and tested"
```

---

### Task 2: `emergence-field.ts`, the CPU twin of the field

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/emergence-field.ts`
- Test: `src/lab/sdf-zombie/webgpu/emergence-field.test.ts`

The frame is the screen's: origin at the glass centre, +x right, +y up, +z out of the screen toward the room, metres. The sheet is a **heightfield** `z = sacZ(x, y)` over the glass opening (the egg fits inside the opened lip, so a heightfield wraps it), and the shader's field is built from exactly these functions, with the egg, the lip rim and the goo marched around it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/emergence-field.test.ts
import { describe, it, expect } from 'vitest';
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import {
  EGG, GLASS, SKIN, SAC_MAX, PICTURE_TABLE_N, eggCentre, eggFront, lipOpening, pictureTable, pictureUV, sacExtent, sacZ, sheetThickness, tearRadius,
} from './emergence-field';

const REST: EmergenceParams = paramsAt(0);
const at = (o: Partial<EmergenceParams>): EmergenceParams => ({ ...REST, ...o });

describe('emergence field', () => {
  it('the sheet is flat at rest and meets the lip at the opening', () => {
    expect(sacZ(REST, 0, 0)).toBeCloseTo(0, 12);
    expect(sacZ(REST, GLASS.hw, 0)).toBeCloseTo(0, 12);
    const p = at({ push: 1 });
    expect(sacZ(p, GLASS.hw * 1.0001, 0)).toBeCloseTo(lipOpening(p).z, 3);   // outside the (unbowed) lip it is the rim height
    expect(sacZ(p, 0, 0)).toBeGreaterThan(0.5);
  });

  it('the apex reaches most of a metre at full push (owner: "most of a metre is fine")', () => {
    expect(SAC_MAX).toBeGreaterThan(0.7);
    expect(SAC_MAX).toBeLessThan(0.8);
    expect(sacZ(at({ push: 1 }), 0, 0)).toBeGreaterThanOrEqual(SAC_MAX - 0.02);
  });

  it('the sac grows monotonically with push, at every sampled point', () => {
    for (const [x, y] of [[0, 0], [0.08, 0.03], [0.15, -0.05], [0, 0.12]] as const) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const z = sacZ(at({ push: i / 20 }), x, y); expect(z, `x=${x} y=${y} push=${i / 20}`).toBeGreaterThanOrEqual(prev - 1e-9); prev = z; }
    }
  });

  it('the sac wraps the egg: at every point inside the egg\'s silhouette the sheet is in front of the egg by at least the skin', () => {
    for (let i = 0; i <= 20; i++) {
      const p = at({ push: i / 20, lipBow: Math.min(1, (i / 20) * 1.5) });
      const c = eggCentre(p);
      for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
        const x = (ix / 4) * EGG.rx * 0.95, y = c[1] + (iy / 4) * EGG.ry * 0.95;
        const f = eggFront(p, x, y);
        if (f === null) continue;
        expect(sacZ(p, x, y), `push=${i / 20} x=${x.toFixed(3)} y=${y.toFixed(3)}`).toBeGreaterThanOrEqual(f + SKIN - 1e-9);
      }
    }
  });

  it('the egg is bigger than the glass, so the lip has to give', () => {
    expect(2 * EGG.ry).toBeGreaterThan(2 * GLASS.hh);
    expect(lipOpening(at({ lipBow: 1 })).hh).toBeGreaterThanOrEqual(EGG.ry * 0.99);
    expect(lipOpening(REST).hh).toBe(GLASS.hh);
  });

  it('the egg slumps from the sac to the desk and stays there', () => {
    const inSac = eggCentre(at({ push: 1, slump: 0 }));
    const onDesk = eggCentre(at({ push: 1, slump: 1 }));
    expect(onDesk[1]).toBeLessThan(inSac[1]);
    expect(onDesk[2]).toBeLessThan(inSac[2]);
    expect(eggCentre(paramsAt(DURATION))).toEqual(onDesk);
  });

  it('the sheet thins as it stretches and is never gone', () => {
    const t0 = sheetThickness(at({ push: 0 }), 0, 0);
    const t1 = sheetThickness(at({ push: 1, thin: 1 }), 0, 0);
    expect(t1).toBeLessThan(t0);
    expect(t1).toBeGreaterThan(0.0005);
  });

  it('the tear opens from the tip and never reverses, and is zero when closed', () => {
    for (const th of [0, 0.7, 1.9, 3.1, 5]) {
      expect(tearRadius(at({ tear: 0 }), th)).toBe(0);
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const r = tearRadius(at({ tear: i / 20 }), th); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
      expect(prev).toBeGreaterThan(0.1);
    }
  });

  it('the picture mapping is the identity at rest, runs 0..1 monotonically, and stretches when pushed', () => {
    const rest = pictureTable(REST);
    expect(rest).toHaveLength(PICTURE_TABLE_N);
    for (let i = 0; i < PICTURE_TABLE_N; i++) expect(rest[i]!).toBeCloseTo(i / (PICTURE_TABLE_N - 1), 9);
    const pushed = pictureTable(at({ push: 1 }));
    expect(pushed[0]).toBe(0);
    expect(pushed[PICTURE_TABLE_N - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < PICTURE_TABLE_N; i++) expect(pushed[i]!).toBeGreaterThan(pushed[i - 1]!);
    // the apex stretches: the picture's centre covers more sheet, so the first steps cover LESS picture than at rest
    expect(pushed[4]!).toBeLessThan(rest[4]!);
    expect(pictureUV(REST, 0.1, -0.05)).toEqual([0.1 / GLASS.hw, -0.05 / GLASS.hh]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/emergence-field.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/emergence-field.ts
//
// THE SCREEN EMERGENCE's field, CPU twin (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 4).
// Pure: the sac heightfield over the glass, the egg's place, the bezel lip's bow, the sheet's thickness, the tear's reach and the picture's
// inverse-stretch table. `screen-emergence.wgsl.ts` is built from the constants here and re-implements these functions in WGSL; tests pin the
// PROPERTIES (zero at rest, wraps the egg, monotone in the push), the look rounds tune the numbers.
//
// FRAME: the screen's: origin at the glass centre, +x right, +y up, +z out of the screen toward the room, metres.
import type { EmergenceParams } from './emergence-timeline';

export type Vec3 = [number, number, number];

/** The P225f's viewable glass, 0.406 x 0.305 m, as half extents. */
export const GLASS = { hw: 0.203, hh: 0.1525 } as const;
/** The sac's skin: the sheet stands this far in front of the egg's surface. */
export const SKIN = 0.006;
/** The stand-in egg (bigger than the glass, owner): semi-axes, and the centre's depth behind the glass at rest and at full push. */
export const EGG = { rx: 0.175, ry: 0.225, rz: 0.175, z0: -0.2, z1: 0.55 } as const;
/** The desk's top below the glass centre, and where the slumped egg rests. */
export const DESK_Y = -0.32;
export const EGG_REST: Vec3 = [0, DESK_Y + EGG.ry, 0.4];
/** The sac's apex at full push: the egg's front plus the skin (about 0.73 m, "most of a metre"). */
export const SAC_MAX = EGG.z1 + EGG.rz + SKIN;
/** The sheet's half-thickness at rest (m), and the tear's largest radius. */
export const THICK0 = 0.004;
export const TEAR_R_MAX = 0.17;
/** The lip: how far it bows out in z and how much the opening widens (fractions of the glass) at full bow. */
export const LIP = { bowZ: 0.1, openX: 0.3, openY: 0.5 } as const;
export const RIPPLE = { amp: 0.012, freq: 24, speed: 9 } as const;
/** The picture table's size (entries 0..N-1 cover normalised radius 0..1). */
export const PICTURE_TABLE_N = 33;

export const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Polynomial smooth maximum (iq), blend width k. */
export const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

/** The egg's centre: pushing through the glass (x, y = 0), then slumping to the desk. */
export function eggCentre(p: EmergenceParams): Vec3 {
  const z = lerp(EGG.z0, EGG.z1, smooth(p.push));
  const s = smooth(p.slump);
  return [0, lerp(0, EGG_REST[1], s), lerp(z, EGG_REST[2], s)];
}

/** The egg's front surface depth at (x, y), or null outside its silhouette. */
export function eggFront(p: EmergenceParams, x: number, y: number): number | null {
  const c = eggCentre(p);
  const q = (x / EGG.rx) ** 2 + ((y - c[1]) / EGG.ry) ** 2;
  return q >= 1 ? null : c[2] + EGG.rz * Math.sqrt(1 - q);
}

/** The lip: the opening's half sizes widened by the bow, and the rim's height. */
export function lipOpening(p: EmergenceParams): { hw: number; hh: number; z: number } {
  const b = smooth(p.lipBow);
  return { hw: GLASS.hw * (1 + LIP.openX * b), hh: GLASS.hh * (1 + LIP.openY * b), z: LIP.bowZ * b };
}

/** The sac's apex height: grows with the push, sags to half when the egg leaves, sucks back with the heal. */
export const sacExtent = (p: EmergenceParams) => SAC_MAX * smooth(p.push) * (1 - 0.5 * smooth(p.slump)) * (1 - smooth(p.heal));

/** The dome's shape from the apex (q = 0) to the lip (q = 1). */
const profile = (q: number) => (q >= 1 ? 0 : Math.pow(smooth(1 - q), 0.75));

/** THE SHEET: a dome from the rim to the apex, smooth-maxed with the egg's front plus the skin, plus the ripple. `time` only feeds the ripple. */
export function sacZ(p: EmergenceParams, x: number, y: number, time = 0): number {
  const lip = lipOpening(p);
  const q = Math.hypot(x / lip.hw, y / lip.hh);
  const dome = lip.z + Math.max(0, sacExtent(p) - lip.z) * profile(q);
  const f = eggFront(p, x, y);
  const wrapped = f === null || q >= 1 ? dome : smax(dome, f + SKIN, 0.04);
  const ripple = p.ripple * RIPPLE.amp * Math.sin(RIPPLE.freq * Math.min(q, 1) - RIPPLE.speed * time) * (1 - Math.min(q, 1));
  return wrapped + ripple;
}

/** The sheet's half-thickness at (x, y): thinner with the stretch (the dome's height over the opening) and with `thin`; never gone. */
export function sheetThickness(p: EmergenceParams, x: number, y: number): number {
  const lip = lipOpening(p);
  const stretch = Math.min(1, sacZ({ ...p, ripple: 0 }, x, y) / SAC_MAX) * (1 - Math.min(1, Math.hypot(x / lip.hw, y / lip.hh)) * 0.5);
  return THICK0 * (1 - 0.8 * Math.max(stretch, smooth(p.thin) * 0.6)) + 0.0006;
}

/** The tear's radius around the tip (the sheet's apex axis) at angle `theta`: grows with `tear`, ragged by a deterministic harmonic sum. */
export function tearRadius(p: EmergenceParams, theta: number): number {
  const t = smooth(p.tear);
  if (t === 0) return 0;
  const rag = 1 + 0.22 * Math.sin(5 * theta + 1.3) + 0.12 * Math.sin(11 * theta + 0.4) + 0.06 * Math.sin(23 * theta + 2.1);
  return TEAR_R_MAX * t * rag;
}

/** THE PICTURE: the sheet stretches, so the picture is read through a radial table: entry i is the picture radius (0..1) at normalised sheet
 *  radius i / (N - 1), the cumulative arclength of the dome profile normalised to its total. At rest it is the identity. The shader reads this table. */
export function pictureTable(p: EmergenceParams): Float32Array {
  const n = PICTURE_TABLE_N, lip = lipOpening(p);
  const rise = Math.max(0, sacExtent(p) - lip.z), span = 0.5 * (lip.hw + lip.hh);
  const out = new Float32Array(n);
  let acc = 0;
  const speed = (q: number) => { const e = 1e-4, d = (profile(Math.min(1, q + e)) - profile(Math.max(0, q - e))) / (Math.min(1, q + e) - Math.max(0, q - e)); return Math.hypot(1, (rise * d) / span); };
  const STEPS = 8;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < STEPS; k++) acc += speed(((i - 1) + (k + 0.5) / STEPS) / (n - 1)) / (STEPS * (n - 1));
    cum.push(acc);
  }
  for (let i = 0; i < n; i++) out[i] = cum[i]! / acc;
  return out;
}

/** The picture coordinate (each -1..1 across the glass) of the sheet point above (x, y). Identity at rest. */
export function pictureUV(p: EmergenceParams, x: number, y: number): [number, number] {
  const lip = lipOpening(p);
  const mx = x / lip.hw, my = y / lip.hh, q = Math.hypot(mx, my);
  if (q === 0) return [0, 0];
  const tab = pictureTable(p), f = Math.min(q, 1) * (PICTURE_TABLE_N - 1), i = Math.min(PICTURE_TABLE_N - 2, Math.floor(f));
  const g = lerp(tab[i]!, tab[i + 1]!, f - i);
  const s = (q <= 1 ? g : q) / q;
  return [(mx * s) * (lip.hw / GLASS.hw), (my * s) * (lip.hh / GLASS.hh)];
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/emergence-field.test.ts && npm run typecheck`
Expected: PASS. If a property test fails, it points at a constant or a formula that does not hold the property: the usual suspects are the egg's `z0` (the egg's front must stay behind the sheet), the `smax` width in `sacZ`, and the picture table's first-step test (the apex stretching): fix the field, never the property. The `pictureUV` identity at rest uses `lip.hw / GLASS.hw = 1`.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/emergence-field.ts src/lab/sdf-zombie/webgpu/emergence-field.test.ts
git commit -m "feat(emergence): the field's CPU twin: sac, egg, lip, tear, picture table"
```

---

### Task 3: `goo-strands.ts`, strands, beads and drips

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/goo-strands.ts`
- Test: `src/lab/sdf-zombie/webgpu/goo-strands.test.ts`

Anchors move with the tear and the egg, so the sim is re-run from `t = 0` to the requested `t` in fixed steps (so a scrub equals a playback). The shader reads the output as points.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/goo-strands.test.ts
import { describe, it, expect } from 'vitest';
import { DURATION } from './emergence-timeline';
import { N_STRANDS, N_BEADS, N_DRIPS, STRAND_POINTS, gooAt, gooTexels, GOO_TEXELS } from './goo-strands';

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('goo strands', () => {
  it('has nothing before the tear opens', () => {
    const g = gooAt(3);
    expect(g.strands.every(s => !s.live)).toBe(true);
    expect(g.drips.every(d => d.length === 0)).toBe(true);
  });

  it('is deterministic: the same time gives the same points, however it is reached', () => {
    const a = gooAt(9.37), b = gooAt(9.37);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    gooAt(14);                                   // a scrub elsewhere must not leak state
    expect(JSON.stringify(gooAt(9.37))).toBe(JSON.stringify(a));
  });

  it('strands are anchored at both ends and never stretch past their length limit', () => {
    for (const t of [7.5, 8.5, 9.5, 10.5, 11.5, 13]) {
      const g = gooAt(t);
      for (const s of g.strands.filter(s => s.live)) {
        expect(s.points).toHaveLength(STRAND_POINTS);
        for (let i = 1; i < s.points.length; i++) expect(dist(s.points[i]!, s.points[i - 1]!), `t=${t}`).toBeLessThanOrEqual(s.segMax + 1e-6);
        expect(s.points.flat().every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('is stable: the whole run stays finite and inside a 3 m box', () => {
    for (let t = 0; t <= DURATION; t += 0.5) {
      const g = gooAt(t);
      for (const p of [...g.strands.flatMap(s => s.points), ...g.beads.map(b => b.pos), ...g.drips.flatMap(d => d.length ? [d.top, d.tip] : [])])
        for (const v of p) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThan(3); }
    }
  });

  it('strands sag under gravity once the egg is out (the middle is lower than the chord)', () => {
    const g = gooAt(11.5);
    const live = g.strands.filter(s => s.live);
    expect(live.length).toBeGreaterThan(0);
    for (const s of live) {
      const mid = s.points[Math.floor(STRAND_POINTS / 2)]!, a = s.points[0]!, b = s.points[STRAND_POINTS - 1]!;
      expect(mid[1]).toBeLessThan((a[1] + b[1]) / 2 + 1e-6);
    }
  });

  it('drips grow downward from the bezel and stop at a length limit', () => {
    const early = gooAt(8), late = gooAt(12);
    const len = (d: { length: number }) => d.length;
    expect(Math.max(...late.drips.map(len))).toBeGreaterThan(Math.max(...early.drips.map(len)));
    for (const d of late.drips) expect(d.length).toBeLessThanOrEqual(0.25);
  });

  it('packs into the fixed texel count the shader reads', () => {
    const tex = gooTexels(gooAt(9));
    expect(tex).toHaveLength(GOO_TEXELS * 4);
    expect(N_STRANDS * STRAND_POINTS + N_BEADS + 2 * N_DRIPS).toBeLessThanOrEqual(GOO_TEXELS);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goo-strands.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/goo-strands.ts
//
// THE GOO (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 4): strands between the torn lip and the egg, beads
// sliding along them, and drips off the bezel's lower rim. Pure and deterministic: `gooAt(t)` re-runs a small Verlet sim from t = 0 in fixed steps,
// with the anchors read from the timeline and the field at every step, so a scrub and a playback show the same frame (the page never keeps state).
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import { EGG, GLASS, eggCentre, lipOpening, sacZ, tearRadius, type Vec3 } from './emergence-field';

export const N_STRANDS = 6;
export const STRAND_POINTS = 6;
export const N_BEADS = 8;
export const N_DRIPS = 4;
/** One texel per strand point, bead and drip end: the shader reads a row of RGBA32F texels of this width. */
export const GOO_TEXELS = 64;
const DT = 1 / 60;
const GRAVITY = -2.2;           // m/s^2, softened (mucus, not water)
const DRIP_MAX = 0.25;          // m
const ITER = 4;

export interface Strand { live: boolean; points: Vec3[]; segMax: number; radius: number }
export interface Bead { pos: Vec3; radius: number }
export interface Drip { length: number; top: Vec3; tip: Vec3; radius: number }
export interface Goo { strands: Strand[]; beads: Bead[]; drips: Drip[] }

// A tiny deterministic generator so the strands' angles, lags and sags are fixed per index (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261011);
const STRAND_THETA = Array.from({ length: N_STRANDS }, (_, i) => (i / N_STRANDS) * Math.PI * 2 + (R() - 0.5) * 0.5);
const STRAND_START = Array.from({ length: N_STRANDS }, (_, i) => 7.2 + i * 0.35 + R() * 0.2);   // when each strand forms
const STRAND_SLACK = Array.from({ length: N_STRANDS }, () => 1.04 + R() * 0.12);
const DRIP_X = Array.from({ length: N_DRIPS }, (_, i) => ((i + 0.5) / N_DRIPS - 0.5) * 2 * GLASS.hw * 0.8 + (R() - 0.5) * 0.03);
const DRIP_START = Array.from({ length: N_DRIPS }, (_, i) => 8.2 + i * 0.8);
const BEAD_STRAND = Array.from({ length: N_BEADS }, (_, i) => i % N_STRANDS);
const BEAD_U0 = Array.from({ length: N_BEADS }, () => 0.2 + R() * 0.6);

/** Where strand i leaves the tear's lip (on the sheet) and where it lands on the egg, at the state `p` and time `t`. */
function anchors(p: EmergenceParams, i: number, t: number): { a: Vec3; b: Vec3 } {
  const th = STRAND_THETA[i]!, r = Math.max(0.02, tearRadius(p, th));
  const x = r * Math.cos(th), y = r * Math.sin(th);
  const a: Vec3 = [x, y, sacZ(p, x, y, t)];
  const c = eggCentre(p);
  // the egg end: a point on the egg's near surface, on the same side of the egg as the tear point
  const ex = (x / Math.max(r, 1e-3)) * EGG.rx * 0.55, ey = c[1] + (y / Math.max(r, 1e-3)) * EGG.ry * 0.55;
  const q = (ex / EGG.rx) ** 2 + ((ey - c[1]) / EGG.ry) ** 2;
  return { a, b: [ex, ey, c[2] + EGG.rz * Math.sqrt(Math.max(0, 1 - q))] };
}

interface Sim { pts: Vec3[][]; prev: Vec3[][]; born: boolean[] }

function stepSim(sim: Sim, p: EmergenceParams, t: number): void {
  for (let i = 0; i < N_STRANDS; i++) {
    if (t < STRAND_START[i]! || tearRadius(p, STRAND_THETA[i]!) <= 0) { sim.born[i] = false; continue; }
    const { a, b } = anchors(p, i, t);
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const seg = (chord * STRAND_SLACK[i]!) / (STRAND_POINTS - 1);
    if (!sim.born[i]) {                                        // born on the chord
      sim.born[i] = true;
      sim.pts[i] = Array.from({ length: STRAND_POINTS }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / (STRAND_POINTS - 1), a[1] + ((b[1] - a[1]) * k) / (STRAND_POINTS - 1), a[2] + ((b[2] - a[2]) * k) / (STRAND_POINTS - 1)] as Vec3);
      sim.prev[i] = sim.pts[i]!.map(v => [...v] as Vec3);
    }
    const P = sim.pts[i]!, Q = sim.prev[i]!;
    for (let k = 1; k < STRAND_POINTS - 1; k++) {            // verlet with a little damping
      const v = [(P[k]![0] - Q[k]![0]) * 0.985, (P[k]![1] - Q[k]![1]) * 0.985, (P[k]![2] - Q[k]![2]) * 0.985];
      Q[k] = [...P[k]!] as Vec3;
      P[k] = [P[k]![0] + v[0]!, P[k]![1] + v[1]! + GRAVITY * DT * DT, P[k]![2] + v[2]!] as Vec3;
    }
    P[0] = a; Q[0] = [...a] as Vec3; P[STRAND_POINTS - 1] = b; Q[STRAND_POINTS - 1] = [...b] as Vec3;
    for (let it = 0; it < ITER; it++) for (let k = 0; k < STRAND_POINTS - 1; k++) {
      const u = P[k]!, w = P[k + 1]!;
      const dx = w[0] - u[0], dy = w[1] - u[1], dz = w[2] - u[2], d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d <= seg) continue;                                  // a rope: only the stretch is corrected
      const corr = (d - seg) / d, wu = k === 0 ? 0 : 0.5, ww = k + 1 === STRAND_POINTS - 1 ? 0 : 0.5, sum = wu + ww || 1;
      u[0] += (dx * corr * wu) / sum; u[1] += (dy * corr * wu) / sum; u[2] += (dz * corr * wu) / sum;
      w[0] -= (dx * corr * ww) / sum; w[1] -= (dy * corr * ww) / sum; w[2] -= (dz * corr * ww) / sum;
    }
  }
}

/** The goo at time `t` (seconds): re-run from 0 in fixed steps, deterministic. */
export function gooAt(t: number): Goo {
  const tt = Math.min(Math.max(t, 0), DURATION);
  const sim: Sim = { pts: Array.from({ length: N_STRANDS }, () => []), prev: Array.from({ length: N_STRANDS }, () => []), born: Array(N_STRANDS).fill(false) };
  const steps = Math.floor(tt / DT);
  for (let s = 0; s <= steps; s++) { const ts = s === steps ? tt : s * DT; stepSim(sim, paramsAt(ts), ts); }
  const p = paramsAt(tt);
  const strands: Strand[] = Array.from({ length: N_STRANDS }, (_, i) => {
    const live = sim.born[i]! && sim.pts[i]!.length === STRAND_POINTS;
    const P = live ? sim.pts[i]!.map(v => [...v] as Vec3) : [];
    const chord = live ? Math.hypot(P[0]![0] - P[P.length - 1]![0], P[0]![1] - P[P.length - 1]![1], P[0]![2] - P[P.length - 1]![2]) : 0;
    return { live, points: P, segMax: live ? Math.max((chord * STRAND_SLACK[i]!) / (STRAND_POINTS - 1), 0) * 1.5 + 1e-3 : 0, radius: 0.006 - 0.0025 * Math.min(1, p.heal * 2) };
  });
  const beads: Bead[] = BEAD_STRAND.map((si, bi) => {
    const s = strands[si]!;
    if (!s.live) return { pos: [0, -9, 0] as Vec3, radius: 0 };
    const u = Math.min(0.95, Math.max(0.05, BEAD_U0[bi]! + 0.08 * Math.sin(tt * 0.9 + bi)));
    const f = u * (STRAND_POINTS - 1), k = Math.min(STRAND_POINTS - 2, Math.floor(f)), w = f - k, A = s.points[k]!, B = s.points[k + 1]!;
    return { pos: [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w] as Vec3, radius: 0.011 };
  });
  const lip = lipOpening(p);
  const drips: Drip[] = Array.from({ length: N_DRIPS }, (_, i) => {
    const age = tt - DRIP_START[i]!;
    const length = age <= 0 ? 0 : Math.min(DRIP_MAX, 0.04 * age + 0.012 * age * age);
    const top: Vec3 = [DRIP_X[i]!, -lip.hh, lip.z];
    return { length, top, tip: [top[0], top[1] - length, top[2] + 0.01 * length], radius: 0.008 };
  });
  return { strands, beads, drips };
}

/** The goo as a row of RGBA32F texels for the shader: strand points (xyz + radius), then the beads, then each drip's top and tip; unused texels are w = 0. */
export function gooTexels(g: Goo): Float32Array {
  const out = new Float32Array(GOO_TEXELS * 4);
  let n = 0;
  const put = (v: readonly number[], r: number) => { out[n * 4] = v[0]!; out[n * 4 + 1] = v[1]!; out[n * 4 + 2] = v[2]!; out[n * 4 + 3] = r; n++; };
  for (const s of g.strands) for (let k = 0; k < STRAND_POINTS; k++) s.live ? put(s.points[k]!, s.radius) : put([0, -9, 0], 0);
  for (const b of g.beads) put(b.pos, b.radius);
  for (const d of g.drips) { put(d.top, d.length > 0 ? d.radius : 0); put(d.tip, d.length > 0 ? d.radius * 1.6 : 0); }
  return out;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goo-strands.test.ts && npm run typecheck`
Expected: PASS. Runtime of `gooAt` is O(t x 60 x strands): the test calls it about 40 times at up to 14.5 s, a second or two in total; if a test is slow, cache nothing (the page calls it once per rendered frame, so a one-step incremental cache is the later optimisation, not part of this task). If `segMax` fails (a strand segment longer than 1.5 x its rest length), the constraint pass or the iteration count is too weak: raise `ITER`, not the limit.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/goo-strands.ts src/lab/sdf-zombie/webgpu/goo-strands.test.ts
git commit -m "feat(emergence): the goo's strands, beads and drips, deterministic by time"
```

---

### Task 4: the goblin's `REACH` and `TOUCH` poses

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin-poses.ts`
- Modify: `src/lab/sdf-zombie/characters/goblin-poses.test.ts` (the registry name list)

`REACH` is a held pose, seated: the spine tips forward a little less than `type`, the arm out and down past the desk edge with the hand over the egg's resting place (screen-local `z` 0.4 m, `y` about -0.1 m, which is in front of and below the keys). `TOUCH` goes from `RECOIL`'s end to `REACH`. Angles are absolute, in degrees, as in `TYPE_BONES`.

- [ ] **Step 1: Update the test first**

In `goblin-poses.test.ts`, change the registry assertion to include the two new clips:

```ts
    expect(Object.keys(GOBLIN_POSES).sort()).toEqual(['jolt', 'reach', 'recoil', 'sit', 'stand', 'touch', 'type']);
```

and append a test:

```ts
  it('touch runs from the recoil pose to the reach pose, and reach lowers the hand below the shoulder and in front of the knee', () => {
    const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
      a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < 1e-9));
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, 0), poseJoints(rig, GOBLIN_POSES.recoil!, 0))).toBe(true);
    const reachEnd = poseJoints(rig, GOBLIN_POSES.reach!, 0);
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, GOBLIN_POSES.touch!.keys[GOBLIN_POSES.touch!.keys.length - 1]!.t), reachEnd)).toBe(true);
    expect(reachEnd[J('handL')]![1]).toBeLessThan(reachEnd[J('shoulderL')]![1]);
    expect(reachEnd[J('handL')]![2]).toBeGreaterThan(reachEnd[J('kneeL')]![2] - 0.1);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-poses.test.ts`
Expected: FAIL (the registry list and the missing clips).

- [ ] **Step 3: Add the poses**

In `goblin-poses.ts`, after `RECOIL_BONES`:

```ts
/** Reaching for the egg on the desk: the typing seat and hunch, one arm out and down toward the desk, the hand open over the egg. First-round
 *  angles (2026-10-11), tuned in the screen lab against the egg's rest place (screen frame z 0.4 m, y about -0.1 m). */
const REACH_BONES: PoseKey['bones'] = {
  spine1: { pitch: 24 }, chest: { pitch: 30 }, neck: { pitch: 20 }, skull: { pitch: -4 },
  thigh: { pitch: 86 }, shin: { pitch: -4 },
  // 62 / 38 / 20: the arm leaves the shoulder forward and down (the typing pose's 40 / 80 / 70 folds it onto the keys; this unfolds it).
  upperarm: { pitch: 62 }, forearm: { pitch: 38 }, hand: { pitch: 20 },
};
```

after `JOLT`:

```ts
/** The reach pose held: the last frame of the sequence. */
export const REACH: PoseClip = { name: 'reach', keys: [{ t: 0, bones: REACH_BONES }] };

/** From the recoil's end (thrown back, arms up) to the reach: the arm comes down and forward onto the egg. 1.4 s, eased, eyeballed. */
export const TOUCH: PoseClip = {
  name: 'touch',
  keys: [{ t: 0, bones: RECOIL_BONES }, { t: 1.4, bones: REACH_BONES, ease: 'smooth' }],
};
```

and register them in `GOBLIN_POSES`:

```ts
export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = {
  type: TYPE, recoil: RECOIL, sit: SIT, stand: STAND, jolt: JOLT, reach: REACH, touch: TOUCH,
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-poses.test.ts src/lab/sdf-zombie/pose.test.ts src/lab/sdf-zombie/pose-motion.test.ts`
Expected: PASS (limb lengths hold at every sampled time, feet stay on the floor: the angle-space blend guarantees both). If the new reach test's two geometric assertions fail, adjust `REACH_BONES` (the hand must end below the shoulder and not behind the knee), and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-poses.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts
git commit -m "feat(goblin): reach and touch poses for the egg"
```

---

### Task 5: the lab page, the set and the goblin (no screen pass yet)

**Files:**
- Create: `sdf-screen-lab.html`
- Create: `src/lab/sdf-zombie/webgpu/screen-lab-main.ts`
- Read first (patterns to follow, do not copy blindly): `sdf-shell-spike.html` and `webgpu/shell-spike-main.ts` (a standalone page with a WebGPURenderer, controls and a stats panel); `webgpu/character-view.ts` (`createCharacterView`, `CharacterViewOpts`, ~lines 477-640) and how `webgpu/lab-main.ts` builds a hero and holds a pose (search `posesFor`, `makePoseRig`, `poseJoints`, `cfg.pose`; `motion.ts:401` documents `MotionConfig.pose`); `webgpu/humanoid-spike-main.ts` as a second minimal host.

This task answers the spec's riskiest item for the spike: can the real SDF goblin draw on a standalone page next to the pass? **If `createCharacterView` needs the SDF layer (`sdf-layer.ts`), use the layer the way `lab-main.ts` does; if it cannot be hosted without more of the lab, STOP and report what it needs** (the fallback is to mesh the goblin once per pose with `docs/dev-notes/2026-10-01-flat-emergence-lookdev/blob-mesh.ts` for the spike and say so in the notes).

- [ ] **Step 1: The page and its controls**

`sdf-screen-lab.html`: copy `sdf-shell-spike.html`'s structure; title `Blud - screen emergence lab`; a `#status` panel (what is loaded, WebGPU health), a `#stats` panel (frame ms, `t`), and a `#controls` bar with: a time slider (0 to 14.5 s, step 0.01), Play/Pause, a speed select (0.25x, 0.5x, 1x), shot buttons (the five `SHOTS` ids: each sets `t` to the shot's start and the camera to its preset), `Free camera` (orbit with the mouse), and checkboxes `goo shadow`, `pass on`. Script: `/src/lab/sdf-zombie/webgpu/screen-lab-main.ts`. Query params: `?t=9.5` (start time), `?shot=crowning`, `?free=1`, `?nopass=1`.

- [ ] **Step 2: The set**

In `screen-lab-main.ts`, build in the screen's own frame (origin at the glass centre, +z toward the room), with the glass centre 0.75 m above the floor: a CRT housing as a mesh after the P225f blockout (`docs/dev-notes/2026-10-01-flat-emergence-lookdev/crt_p225f.py` has the dimensions: front frame 0.50 x 0.47 m, a light-grey frame with a sloped inner bevel down to the 0.406 x 0.305 m glass, a deep chin, a dark housing tapering 0.47 m back, a pedestal; boxes and a tapered prism are enough), a desk top at y = -0.32 (`DESK_Y`) wide and deep, the beige PC tower, a banker's lamp (a point light, warm), a floor, and a dark room. A placeholder glass: a flat plane at z = 0 showing `assets-source/levels/flat-textures/screen-source.png` (copy it to `public/assets/lab/screen-source.png` for the page to load; it is a tracked 1024-px image), so the page is useful before the pass exists. Constants (`GLASS`, `DESK_Y`) come from `emergence-field.ts`, never retyped.

- [ ] **Step 3: The goblin**

Seat the real goblin: `characterEntry('goblin')` through `createCharacterView` (no kit: he is at home), skin as the game's. Drive him with a pose clip chosen from `t`: `sit` into `type` until 3 s (the clip `sit` plays 0 to 0.8 s then holds `type`), `jolt` from 3.0 s, `recoil` from 6.6 s (the sac's tear begins at 6.5), `touch` from 9.4 s, `reach` held from 10.8 s. Write the choice as a pure function `goblinClipAt(t): { clip: PoseClip; local: number }` in `screen-lab-main.ts`'s own pure helper file `screen-lab-goblin.ts` with a test (`screen-lab-goblin.test.ts`: the clip names in order, `local` continuous at each cut, `local` never negative, and the last clip is `reach`). Place him on the chair facing the screen: his hip at the seat height that makes the `type` pose's hands land on the keyboard (set from the measured joints: seat y = keyboard y minus the hand's height above the hip in the `type` pose; do not guess), and the seat a measured distance from the glass such that the typing hands reach the keys. Note the 1.70 m goblin's thigh and arm lengths (0.379, 0.353, 0.307 m) in the code comment.

- [ ] **Step 4: Camera presets**

One preset per shot (an eye, a look-at and an fov): `glass-gives` close, low, front-right of the screen; `push` the same then a cut wider (two presets inside the shot at 4.5 s); `crowning` the same close; `out` behind and left of the goblin so the egg slumps toward the camera; `settle` low on the desk. Free camera on `?free=1`.

- [ ] **Step 5: Run and look**

Run the page: `preview_start` with the dev server config (add a `launch.json` entry named `screen-lab` if none fits: port 5244, `npx vite --port 5244 --strictPort`, which is gitignored) and open `/sdf-screen-lab.html`. Verify with the Browser tools: no console errors, the goblin sits at the desk, scrubbing `t` changes his pose, the shot buttons cut the camera. Screenshot one frame per shot into `.lab-tmp/screen-lab/` (untracked).

- [ ] **Step 6: Tests, typecheck, module index, commit**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/screen-lab-goblin.test.ts && npm run typecheck && npx tsx scripts/module-index.ts
git add sdf-screen-lab.html public/assets/lab/screen-source.png src/lab/sdf-zombie/webgpu/screen-lab-main.ts src/lab/sdf-zombie/webgpu/screen-lab-goblin.ts src/lab/sdf-zombie/webgpu/screen-lab-goblin.test.ts docs/architecture/module-index.md
git commit -m "feat(emergence): the screen lab page, the set and the posed goblin"
```

---

### Task 6: the screen pass, round one: the sheet, the lip, the egg and the picture (beats 1 and 2)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/screen-lab-main.ts` (the proxy box, the uniforms, the per-frame update)
- Pattern to follow (read them): `webgpu/egg.wgsl.ts` (WGSL strings, one function per string, dependency-ordered includes, constants built from a TS table) and `webgpu/game-egg.ts` lines 54-85 (`wgslFn(..., [includes])`, `uniform(...)`, `MeshBasicNodeMaterial`, `transparent`, `premultipliedAlpha`, `depthWrite = false`, `side = FrontSide`, the proxy `BoxGeometry`); `webgpu/shell-spike-main.ts` for `createDataTexture` and `texture(...)` nodes passed to `wgslFn`.

The pass draws on a proxy box in the screen's frame, covering the glass and the sac's whole reach (about x +-0.5, y -0.5 to +0.5, z -0.1 to 0.95 m, and the sagging goo). It computes everything in the screen's local frame (use TSL's `modelWorldMatrixInverse` to bring the camera and the fragment into the proxy's local space, as the egg pass avoids by being axis-aligned: the screen is not, so this task proves the local-frame route). It writes premultiplied colour and its own depth (conservative box depth would hide the goblin wrongly: use `depthNode` as `humanoid-view.ts` does).

- [ ] **Step 1: The WGSL, first round**

Build these strings in `screen-emergence.wgsl.ts` (constants interpolated from `emergence-field.ts`'s tables with the same `f()`/`v3()` helpers `egg.wgsl.ts` uses; one `fn` per `wgslFn` string):

1. `SCR_SMOOTH`: `smoothstep`-style helpers, `smin`/`smax` (the same polynomial form as `smax` in the field module).
2. `SCR_SAC`: `fn sacZ(x: f32, y: f32, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, time: f32) -> f32`, the WGSL twin of `sacZ` in `emergence-field.ts` (`p0 = (ripple, push, thin, lipBow)`, `p1 = (tear, slump, heal, glow)`, `d = (sacExtent, eggCz, eggCy, lipZ)` computed on the CPU each frame with the field module and passed in, so the WGSL does not re-derive `eggCentre`/`sacExtent`; the lip's half sizes come as a second vec4 `lip = (hw, hh, 0, 0)`).
3. `SCR_MAP`: `fn mapScr(p: vec3<f32>, ...) -> vec2<f32>` returning `(distance, material)` with material 1 = the sheet, 2 = the lip rim, 3 = the egg, 4 = the goo. The sheet's distance is the heightfield shell: `dz = p.z - sacZ(p.x, p.y)`, `d = (abs(dz) - thick) * 0.55` (the 0.55 is the Lipschitz step scale for a heightfield; raise it only if the check shows no overshoot), clipped to the lip's footprint `q < 1` with a smooth edge, and with the tear subtracted: `d = max(d, tearR(theta) - length(p.xy))`. The lip rim: an elliptical torus (a rounded ring at the opening's boundary at height `lipZ`, tube radius 0.012). The egg: the approximate ellipsoid distance `k0 * (k0 - 1.0) / k1` (iq) around `(0, eggCy, eggCz)` with the semi-axes. Goo is added in Task 7; leave the hook.
4. `SCR_NORMAL`: a central-difference normal (6 `mapScr` calls; the tetrahedron form with 4 is fine).
5. `SCR_SHADE`: the entry: `ro`, `rd` in local space; ray-box clip to the proxy; march up to 64 steps from the box entry with the early-out; **if the first hit is the sheet, shade it and, with its opacity `a` (more opaque when `thin` is low), continue the march from just past the skin to find the second hit (the egg or the lip or the desk-side) and composite**: `colour = skin * a + behind * (1 - a)`. Shading: the sheet's colour is the **picture** while it is glass and veined translucent flesh as it thins: `uv = pictureUV(...)` through the picture table passed as a 33-texel `texture` row (`pictureTable(p)` uploaded each frame; sampled with linear filtering), the picture sampled from `screenTex`, scanlines (`0.55 + 0.45 * sin(uv.y * 600.0)`), dimmed by `thin`, mixed toward a warm vein texture (`sin`-noise veins) lit from behind by the egg (`glow`). The egg: a warm, candled look (an emissive core, a few faint vessels, a hard rim). Lighting: the lamp (warm point), the egg's light on the sheet from inside, a dim cool fill; hard terminators (the 90s look: `step`-ish diffuse), a clear coat: `pow(max(dot(reflect(rd, n), L), 0.0), 120.0)` hard white highlights. Output premultiplied colour and alpha; `depthNode` from the first hit's distance.

Write the WGSL as plain strings the same way `egg.wgsl.ts` does and **do not assume it compiles**: Step 3 finds out.

- [ ] **Step 2: Wire it**

In `screen-lab-main.ts`: the proxy `BoxGeometry` positioned and rotated with the CRT; the material per `game-egg.ts`; a per-frame `update(t)`: `p = paramsAt(t)`, derived vec4s from the field module (`sacExtent`, `eggCentre`, `lipOpening`), the picture table (a 33 x 1 `Float32Array` `DataTexture`, `RedFormat`/`FloatType`, `LinearFilter`) and `time = t`. The picture texture is `public/assets/lab/screen-source.png`. The `pass on` checkbox toggles `proxy.visible` (and shows the placeholder plane when off); `?nopass=1` starts off.

- [ ] **Step 3: Compile and look**

Run the page and read the console: WGSL compile errors in `wgslFn` strings appear as WebGPU validation errors in the console (and the draw is silently missing). Fix them minimally, in the WGSL (do not simplify the design). Then scrub `t` through 0 to 6.5: the glass swells, the sac balloons around the egg, the lip bows, the picture stretches and dims to veined skin. Take one screenshot per second of `t` into `.lab-tmp/screen-lab/r1/`. Check by eye: the goblin and the CRT housing occlude the pass correctly (depth), no box edges are visible, no black rectangle.

- [ ] **Step 4: Typecheck, commit**

```bash
npm run typecheck
git add src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts src/lab/sdf-zombie/webgpu/screen-lab-main.ts
git commit -m "feat(emergence): the screen pass, round one: sheet, lip, egg and picture"
```

---

### Task 7: the tear, the wet lips and the goo (beats 3 and 4)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts`, `src/lab/sdf-zombie/webgpu/screen-lab-main.ts`

- [ ] **Step 1: The tear's wet rim**

In the map, the tear's edge gets its own material (5, the lip of the tear): where the sheet's distance is within a band of the tear boundary (`abs(tearR(theta) - length(p.xy)) < 0.012`), set material 5 and shade it wet flesh-pink with a hard highlight, **a rolled lip**: thicken the sheet there (`thick *= 1 + 1.6 * band`) so the edge has body (the look-dev: a paper edge reads wrong; a wet pink ring reads as flesh). Roll it back with `tear`: the rim's z offset `+0.02 * tear` outward.

- [ ] **Step 2: The goo**

Upload `gooTexels(gooAt(t))` each frame as a 64 x 1 RGBA32F `DataTexture` (nearest filtering, `textureLoad` in WGSL). In the map: for each live strand, a smooth union of capsules between consecutive points (`sdCapsule`), radius from the texel's `w`; each bead a sphere; each drip a rounded cone between `top` and `tip` (`sdRoundCone`); unioned into the sheet and egg with `smin` and a **wide blend (0.03 to 0.05)** so they web and neck. Skip texels with `w == 0`. Material 4. **Goo shading: milky, glossy mucus** (the look-dev's finding: clear strands read as dark specks against the glowing egg): an opaque off-white-pink base (`0.82, 0.74, 0.7`), a wide soft subsurface fake (brighten with `dot(n, toEgg)`), plus the hard white clear-coat highlight.

- [ ] **Step 3: Cost guard**

The strands are at most 36 capsule evaluations per `mapScr` call; guard with a cheap bounding sphere test around the goo's extent (`length(p - gooCentre) < gooRadius`, both uploaded) before looping. Measure with the `goo` on and off (Task 9 scripts the numbers; here only check it does not collapse the frame rate: note the frame ms from the stats panel at the `crowning` and `out` shots).

- [ ] **Step 4: Look**

Scrub 6.5 to 11.5 s; screenshots each half second into `.lab-tmp/screen-lab/r1/`. By eye: the tear opens from the tip with a ragged wet lip, strands cross the opening and sag, beads slide, drips grow off the bezel, no strand tunnels through the egg or the CRT housing, no flicker between adjacent frames when scrubbing slowly (the sim is deterministic; flicker means a discontinuity in the anchors).

- [ ] **Step 5: Typecheck, commit**

```bash
npm run typecheck
git add src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts src/lab/sdf-zombie/webgpu/screen-lab-main.ts
git commit -m "feat(emergence): the tear's wet rim and the goo"
```

---

### Task 8: out, heal and the hold, the egg's shadow, the goblin's touch (beat 4 and the end)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts`, `src/lab/sdf-zombie/webgpu/screen-lab-main.ts`

- [ ] **Step 1: Out and settle**

The field module already moves the egg to the desk with `slump`, and the sac sags to half then sucks back with `heal` (`sacExtent`). In the shader make the **healed sheet wrinkled and glistening**: after `heal` past 0.5 add a high-frequency wrinkle to the sheet's `z` scaled by `heal * (1 - heal) * 4.0` (peaks mid-heal, then a faint residual `0.15 * heal`), and a stronger wet highlight; the picture is **distorted** by the residual wrinkle (offset the picture's uv by the wrinkle gradient); the lip keeps its warp (`lipBow` residual 0.25 from the curves). The egg on the desk glows in its slick: a wet, warm patch under it on the desk top (a soft emissive disc drawn in the pass at the desk plane `y = DESK_Y`, so the pass shows the goo pooling; strands still tie the egg to the torn screen until `tear` closes at 13.5 s).

- [ ] **Step 2: The egg's light and the shadow switch**

A `goo shadow` checkbox: one extra march per goo-hit pixel toward the egg's centre (the egg's light), a hard shadow term on the goo and on the desk disc; off gives `1.0`. Default on.

- [ ] **Step 3: The goblin's touch**

The page already switches clips by `goblinClipAt(t)` (Task 5). Check against the egg's resting place: at `t = 12` the `reach` hand is over the egg (the hand joint within 0.12 m of `EGG_REST` converted to the world); if not, tune `REACH_BONES` (`goblin-poses.ts`) and the chair's distance (`screen-lab-main.ts`) and keep `goblin-poses.test.ts` green. Report the final hand-to-egg distance.

- [ ] **Step 4: Full scrub, then play**

Scrub 0 to 14.5 with screenshots every 0.5 s into `.lab-tmp/screen-lab/r1/`, then play at 1x and watch for popping at shot boundaries (the camera presets cut, the parameters must not). Read the console for errors.

- [ ] **Step 5: Typecheck, commit**

```bash
npm run typecheck && npx vitest run src/lab/sdf-zombie/characters/goblin-poses.test.ts
git add -A src/lab/sdf-zombie
git commit -m "feat(emergence): out, heal and hold, the egg's shadow and the goblin's touch"
```

---

### Task 9: the headless check, the sheet and the cost

**Files:**
- Create: `scripts/screen-emergence-check.sh`, `scripts/screen-emergence-check.mjs`
- Read first: `scripts/lab-servers.sh`, `scripts/blob-shot.sh` and `scripts/blob-turntable.mjs` (the Vite + Chrome + CDP plumbing and the WebGPU health probe), `scripts/sdf-game-flat-gate.sh`/`.mjs` (a recent gate with its own ports, shots and a median frame-cost read: the pattern to copy).

- [ ] **Step 1: The script**

`screen-emergence-check.sh` starts the lab servers on its own ports (5244/9244 by default, overridable) and runs the `.mjs`; stops only what it started. The `.mjs` drives the page over CDP:
1. Loads `/sdf-screen-lab.html?nopass=0`, waits for the page's ready flag (`window.__screenLab.ready`), and **fails on any console error or WebGPU validation message** (this is the WGSL compile check that node cannot do).
2. Exposes through the page a seam `window.__screenLab = { ready, setT(t), setShot(id), setPass(bool), setGooShadow(bool), timeDraws(n) }` (add it in `screen-lab-main.ts`); for each of the five shots' key times (`2.0, 5.5, 8.0, 10.0, 13.0`) sets `t`, waits two frames, screenshots to `OUT/shot-<id>.png`.
3. Cost: with the pass off, on, and on with the goo shadow, reads the median of three `timeDraws(21)` at the `push` shot (`t = 5.5`) and the `crowning` shot (`t = 8.0`), after a warm-up (a first read right after a pose change catches pipeline warm-up and load: the lesson from the Flat's gate), prints a table, and exits non-zero if the pass-on frame at either shot exceeds 33 ms (the spec records the number; the gate only catches a collapse).
4. Lays the five frames out in a sheet (`OUT/sheet.jpg`, 2 columns) next to the animatic's `docs/dev-notes/2026-10-01-flat-emergence-lookdev/keyframes.png`, scaled to the same height (use the page's own canvas to composite, or a small Pillow call from the `.sh`: `python3 -I`), labelled.

- [ ] **Step 2: Run it**

Run: `bash scripts/screen-emergence-check.sh` (writes to `.lab-tmp/screen-emergence/`). Expected: exit 0, a cost table, the five shots and the sheet. Read the sheet.

- [ ] **Step 3: Commit**

```bash
git add scripts/screen-emergence-check.sh scripts/screen-emergence-check.mjs src/lab/sdf-zombie/webgpu/screen-lab-main.ts
git commit -m "feat(emergence): the headless check, key-frame sheet and cost read"
```

---

### Task 10: the goblin's home clothes as SDF cloth

**Files:**
- Create: `src/lab/sdf-zombie/characters/goblin-home.blob`
- Create: `src/lab/sdf-zombie/characters/goblin-home.test.ts`
- Modify: `src/lab/sdf-zombie/character-registry.ts` (an entry `goblin-home`), `webgpu/screen-lab-main.ts` (use it)
- Read first: `.claude/skills/authoring-sdf-characters/SKILL.md` and `reference.md` (the shell/cloth rules at "Cloth that moves", lines about `rigid`, `hem`, clip planes following the pose, painting the flesh under a garment the garment's colour); `characters/cultist.blob` (a costume of `shell` cloth; header lines 15-45) and `characters/schoolgirl.blob` lines 150-190 (a shirt and skirt as shells); `docs/dev-notes/2026-09-23-cultist/NOTES.md`; `goblin.blob` lines 195-215 (the painted pants and tank top already on the goblin: the home clothes are **cloth over the same places**).

The owner (2026-10-11): use SDF cloth for the home shirt (and shorts) so they read fluid; a mesh kit is harder. The goblin's armour kit stays off at home. **Note the shell cost**: shells cost 3 to 5 times their share of the prim count (`docs/tasks/characters.md`, the cultist perf notes); keep to **a vest (two shells at most) and shorts (one or two)**, on the goblin only, in this lab page only.

- [ ] **Step 1: The variant file and its guard test (write the test first)**

`goblin-home.blob` is a copy of `goblin.blob` with (a) `model goblin-home` and (b) a block of cloth lines between two marker comments, placed at the end of the `body` block (before the `bones` section):

```
  # --- home clothes begin ---
  ...
  # --- home clothes end ---
```

`goblin-home.test.ts`:

```ts
// src/lab/sdf-zombie/characters/goblin-home.test.ts
//
// The goblin at home: goblin.blob plus a block of `shell` cloth (a vest, shorts). The file is a COPY, so a guard keeps the two in step:
// remove the home-clothes block and rename the model, and it must equal goblin.blob.
import { describe, it, expect } from 'vitest';
import goblinSrc from './goblin.blob?raw';
import homeSrc from './goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';

const BEGIN = '  # --- home clothes begin ---', END = '  # --- home clothes end ---';

describe('goblin-home.blob', () => {
  it('is goblin.blob plus one marked cloth block (and its own model name)', () => {
    const a = homeSrc.indexOf(BEGIN), b = homeSrc.indexOf(END);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const stripped = homeSrc.slice(0, a) + homeSrc.slice(b + END.length + 1);
    expect(stripped.replace('model goblin-home', 'model goblin')).toBe(goblinSrc);
  });

  it('compiles and validates clean, at the same scale as the goblin', () => {
    const doc = parseBlob(homeSrc);
    expect(doc.scale).toBe(parseBlob(goblinSrc).scale);
    expect(buildBody(compileBlob(doc, compileFace(doc))).errors).toEqual([]);
  });

  it('the cloth is shells, few enough to stay cheap (a vest and shorts)', () => {
    const doc = parseBlob(homeSrc);
    const shells = doc.parts.filter(p => p.kind === 'shell');
    expect(shells.length).toBeGreaterThanOrEqual(2);
    expect(shells.length).toBeLessThanOrEqual(5);
    expect(shells.every(p => p.bone === 'spine1' || p.bone === 'chest' || p.bone === 'pelvis' || p.bone === 'thigh')).toBe(true);
  });
});
```

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-home.test.ts` Expected: FAIL (the file does not exist). (`p.bone` is the parsed part's bone name; adjust the property name to the `BlobPart` field if it differs, `blob-ast.ts:54`.)

- [ ] **Step 2: Author the cloth (first round)**

Create `goblin-home.blob` by `cp goblin.blob goblin-home.blob`, rename the model line, and add the block. Authored units (the file's numbers are the authored 1.30 m figures; `scale 1.3077` multiplies them). Starting lines, to be iterated in the turntable:

```
  # --- home clothes begin ---
  # HOME CLOTHES AS SDF CLOTH (owner, 2026-10-11: "use the SDF cloth ... more fluid"). The goblin's painted tank top and pants (above) stay as the
  # flesh paint UNDER the cloth, so skin never shows through a bulge (the authoring skill's rule). A vest: one open-bottomed shell tube round the
  # chest and belly, closed at the shoulders (the neck and the shoulder rounds poke through it like a collar and armholes); shorts: an open-bottomed
  # shell round the hips and thighs. `warp=` gives the folds, `rigid` rides the bone as one piece. First-round numbers: tune in the turntable.
  shell torso on spine1 at=0.0 offset=(0,0,0.006) tip=(0,0.200,0.012) r=0.080 r2=0.074 wide=1.00 deep=1.10 thick=0.0035 clip=(0,-1,0) clipd=-0.745 rim=0.004 blend=0.006 color=d8d2c0 warp=0.003 warpFreq=(28,6,28) rigid
  shell torso on chest at=0.0 offset=(0,0,0.002) tip=(0,0.150,0.004) r=0.074 r2=0.064 wide=1.04 deep=1.12 thick=0.0035 clip=(0,0,0) clipd=0 rim=0.004 blend=0.006 color=e4dfcf warp=0.003 warpFreq=(30,6,30) rigid
  shell torso on pelvis at=0.5 offset=(0,0,0.010) tip=(0,-0.190,0.020) r=0.092 r2=0.100 wide=1.30 deep=1.10 thick=0.004 clip=(0,-1,0) clipd=-0.45 rim=0.005 blend=0.006 color=6b6f73 warp=0.004 warpFreq=(24,5,24) rigid
  # --- home clothes end ---
```

These numbers are placeholders **to be measured, not trusted**: derive the shell radii from the flesh bars' radii (spine1 bar r 0.072 to 0.068, chest bar r 0.068 to 0.056, pelvis r about 0.074) plus the cloth's standoff (5 to 8 mm), the hem's `clipd` from the world y of the belt line (use `npm run blob:inspect -- goblin-home` to print bone points) and the shorts' length from the thigh (0.29 m: mid-thigh is about 0.15 m below the hip). The second line's `clip=(0,0,0)` is not a valid plane: replace it with a plane that opens the neck (a plane facing up through the neck base) or merge the two vest shells into one: **choose by looking**. Run `npm run blob:shot -- goblin-home` (needs the registry entry from Step 3) with `LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 LAB_TMP=.lab-tmp`; front, side and back at rest plus the `type` pose (`BLOB_POSE=type`). Acceptance for this step (by eye; the owner is the final judge): the cloth reads as a sleeveless vest and shorts, the flesh never shows through at the torso or hips, the arms and neck come out free, the hem lies on the thighs without cutting the knees, folds read (the `warp`), and in the seated `type` pose the vest and shorts do not tear or float. Record the final lines in the file with comments saying what each does and why its numbers.

- [ ] **Step 3: The registry entry and the page**

In `character-registry.ts` add, next to `goblin`:

```ts
  'goblin-home': {
    name: 'goblin-home', src: goblinHomeBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('goblin'),
  },
```

with `import goblinHomeBlobSrc from './characters/goblin-home.blob?raw';` (no `kit`: the armour stays off at home). `motionProfileFor('goblin')` is the held-shotgun profile; the page only uses the pose layer, so it is fine, but check `character-registry.test.ts` for a test that every entry has a profile of its own name or a sheet, and satisfy it. The pose library is keyed by character name (`pose-library.ts`: `LIBRARY = { goblin: GOBLIN_POSES }`): register `'goblin-home': GOBLIN_POSES` there too, and add a line to `goblin-poses.test.ts`'s registry test. In `screen-lab-main.ts` use `goblin-home`.

- [ ] **Step 4: Run the guard and the neighbours**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-home.test.ts src/lab/sdf-zombie/blob-emit.test.ts src/lab/sdf-zombie/character-registry.test.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts src/lab/sdf-zombie/pose-library.test.ts && npm run typecheck` (run whichever of those exist). Expected: PASS. `blob-emit.test.ts` globs `characters/*.blob`, so the new file's round trip is checked for free; `pack-golden.test.ts` globs characters too and pins a hash per file: run `npx vitest run -u src/lab/sdf-zombie/pack-golden.test.ts` to pin the new one (darwin/arm64 only; check the snapshot diff is the one new line).

- [ ] **Step 5: Frame cost of the cloth**

Report the lab page's frame ms with `goblin` and with `goblin-home` at the `type` pose (the shells' 3 to 5 times prim cost): if it is more than 3 ms, say so in the notes and trim a shell (the second vest shell first).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-home.blob src/lab/sdf-zombie/characters/goblin-home.test.ts src/lab/sdf-zombie/character-registry.ts src/lab/sdf-zombie/pose-library.ts src/lab/sdf-zombie/webgpu/screen-lab-main.ts src/lab/sdf-zombie/__snapshots__ src/lab/sdf-zombie/characters/goblin-poses.test.ts
git commit -m "feat(goblin): home clothes as SDF cloth, a vest and shorts"
```

---

### Task 11: look round one, the notes and the PR

**Files:**
- Create: `docs/dev-notes/2026-10-11-screen-emergence/NOTES.md` and sheets
- Modify: `TASKS.md`, `docs/tasks/combat-and-gore.md` or `docs/tasks/rendering-gather-r1.md` (whichever page holds the ending/egg thread: `grep -n "egg" docs/tasks/*.md` to find it), the spec's status line, `docs/architecture/module-index.md`

- [ ] **Step 1: The frames for the owner**

Run `bash scripts/screen-emergence-check.sh`; copy the sheet and a 3-column strip of the best frame of each shot into `docs/dev-notes/2026-10-11-screen-emergence/` (JPEG, each under 1 MB, labelled), plus one home-clothes sheet (front, side, seated) from Task 10. Look at them yourself first: list, plainly, what reads wrong against the animatic and the spec's "gooey and shiny" (the sac reads as balloon or as skin? the goo as slime or plastic? the lip? the picture's stretch? the goblin's seat and reach?). The owner is the judge; your list steers the first round.

- [ ] **Step 2: The notes**

`NOTES.md`: what is built (the page, the modules, the poses, the cloth), how to run it (`npm run dev` then `/sdf-screen-lab.html?shot=crowning`, the controls, the seam), how to run the check, the cost table, the owner's open looks, what was hard (the WGSL compile route, the local-frame proxy, the goblin hosting), the knobs for the look rounds (the curve keys in `emergence-timeline.ts`, the profile and `smax` width in `emergence-field.ts`, the goo blend and milkiness, the cloth lines), and the follow-ups from the spec's section 2 out-of-scope list.

- [ ] **Step 3: The wiki, the index, the spec**

Add the spike to `TASKS.md` (in flight, owner look pending, links to the spec, plan and notes), tick the right lines on the area page, update the spec's status line to "built, owner look pending", and regenerate the module index (`npx tsx scripts/module-index.ts`).

- [ ] **Step 4: Final checks**

Run: `npm run typecheck && npm run test:changed`, and by path: the three pure modules' tests, `goblin-poses`, `goblin-home`, `screen-lab-goblin`, `character-registry`, `blob-emit`, `module-index`. Expected: PASS. Read CI after the push with `gh run list --branch claude/screen-emergence-lab`.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add docs TASKS.md
git commit -m "docs(emergence): look round one, notes and wiki"
git push -u origin claude/screen-emergence-lab
```

Open the PR against `main` (the base is `claude/goblin-human-height` until #46 merges: if #46 has merged, rebase onto `main` first; otherwise open it against that branch and say "stacked on #46" in the body), title `Screen emergence lab spike: the egg out of the monitor`, body: what it is, how to run it, the cost, the looks pending and the questions for the owner (egg size and reach, the clothes, what next), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then follow the session's PR rules: `get_status`, bind if needed, read CI; no polling.

**The owner's look round happens after the PR:** the owner's notes go into new tasks (a look round per task), starting with the field and the goo.
