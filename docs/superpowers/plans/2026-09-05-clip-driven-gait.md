# Clip-Driven Gait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The soldier's march and run take their stride SHAPE (thigh pitch, knee flexion, hip bob, stance timing) from two reference clips sampled once into constant tables, so the legs read as a real walk and run instead of stiff sinusoids — with the verlet rig, plant IK, carries, kit and gun untouched.

**Architecture:** `glb-clip.ts` (pure) parses a GLB, samples its one-cycle animation at 32 phases and turns joint world positions into per-phase sagittal angles normalised by leg length (`GaitCurves`, `gait-curves.ts`). `scripts/gait-from-clip.ts` writes those as TypeScript constants. `stepGait` gains a curve mode: when the profile carries curves and the caller passes the body's rest leg vectors, knee and foot offsets are rebuilt from the curve angles with the body's own segment lengths. The zombie has no curves and stays bit-identical (`gait-pins.test.ts`).

**Tech Stack:** TypeScript, vitest, tsx for the script. Pure modules only; no THREE.

**Spec:** [docs/superpowers/specs/2026-09-05-clip-driven-gait-design.md](../specs/2026-09-05-clip-driven-gait-design.md)

**Conventions:**
- Body-local axes: +x right, +y up, +z forward. The reference clips face +z too (LeftUpLeg sits at +x).
- Quaternions `[x, y, z, w]`, `qMul(a, b)` applies b first (`vec.ts`).
- Run tests with `npx vitest run <file>`; typecheck `npx tsc --noEmit`; the zombie pins (`src/lab/sdf-zombie/gait-pins.test.ts`) must stay green after every task.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Reference clips: `docs/dev-notes/refs/soldier-mesh/soldier.glb` (clip `Walking`, 32 keyframes, 1.07 s) and `docs/dev-notes/refs/soldier-mesh/zombie-biped-running.glb` (clip `Armature|running|baselayer`, 20 keyframes, 0.67 s). Both: scene root `Armature` (scale 0.01) → `char1` → `Hips` → `LeftUpLeg/LeftLeg/LeftFoot/LeftToeBase` and `Right…`; every animated node has LINEAR translation/rotation/scale channels; units centimetres.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/gait-curves.ts` (new) | `GaitCurves`/`LegCurves` types, `sampleCurve`, `sampleStance`, `blendCurves`. |
| `src/lab/sdf-zombie/glb-clip.ts` (new) | GLB parse, accessor reads, animation sampling, joint world positions, `curvesFromClip`. |
| `scripts/gait-from-clip.ts` (new) | CLI: glb + name → `src/lab/sdf-zombie/gait-curves/<name>.ts`, prints speed numbers. |
| `src/lab/sdf-zombie/gait-curves/soldier-walk.ts`, `soldier-run.ts` (generated) | The constant tables. |
| `src/lab/sdf-zombie/gait.ts` (modify) | `curves` on the profile, `GaitLimbs`, curve-mode legs and bob, curve-aware blend. |
| `src/lab/sdf-zombie/motion.ts` (modify) | Passes rest leg vectors to `stepGait`. |
| `src/lab/sdf-zombie/motion-profile.ts` (modify) | MARCH/RUN carry curves; cruise/runBand from the clips. |

---

### Task 1: gait-curves.ts, glb-clip.ts, the sampler script, the two tables

**Files:**
- Create: `src/lab/sdf-zombie/gait-curves.ts`, `src/lab/sdf-zombie/glb-clip.ts`, `src/lab/sdf-zombie/glb-clip.test.ts`, `scripts/gait-from-clip.ts`, `src/lab/sdf-zombie/gait-curves/soldier-walk.ts`, `src/lab/sdf-zombie/gait-curves/soldier-run.ts`
- Modify: `package.json` (add `"gait:curves": "tsx scripts/gait-from-clip.ts"` beside the other `blob:*` scripts)

- [ ] **Step 1: Failing test**

```ts
// src/lab/sdf-zombie/glb-clip.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGlb, curvesFromClip, jointWorldPositions } from './glb-clip';
import { sampleCurve, blendCurves } from './gait-curves';

const WALK = 'docs/dev-notes/refs/soldier-mesh/soldier.glb';
const RUN = 'docs/dev-notes/refs/soldier-mesh/zombie-biped-running.glb';
const load = (p: string) => parseGlb(new Uint8Array(readFileSync(p)));

describe('glb-clip sampler', () => {
  const walk = curvesFromClip(load(WALK), { name: 'soldier-walk' });
  const run = curvesFromClip(load(RUN), { name: 'soldier-run' });

  it('walk: 32 samples, ~0.93 Hz, a real knee, a walking duty, forward travel', () => {
    expect(walk.n).toBe(32);
    expect(walk.hipsY.length).toBe(32);
    expect(walk.freq).toBeCloseTo(1 / 1.07, 1);
    const peakKnee = Math.max(...walk.L.knee);
    expect(peakKnee).toBeGreaterThan(0.6);
    expect(peakKnee).toBeLessThan(1.4);
    const duty = walk.L.stance.filter(Boolean).length / 32;
    expect(duty).toBeGreaterThan(0.55);
    expect(duty).toBeLessThan(0.70);
    expect(walk.travel).toBeGreaterThan(0);
  });

  it('run: higher knees and a shorter stance than the walk', () => {
    expect(Math.max(...run.L.knee)).toBeGreaterThan(Math.max(...walk.L.knee));
    const duty = run.L.stance.filter(Boolean).length / 32;
    expect(duty).toBeLessThan(0.55);
  });

  it('phase 0 is left heel strike: the left foot is furthest forward there', () => {
    expect(walk.L.thigh[0]).toBe(Math.max(...walk.L.thigh));
  });

  it('the two legs are half a cycle apart', () => {
    const shift = 16;
    let err = 0;
    for (let i = 0; i < 32; i++) err += Math.abs(walk.L.thigh[i]! - walk.R.thigh[(i + shift) % 32]!);
    expect(err / 32).toBeLessThan(0.15);
  });

  it('jointWorldPositions composes the hierarchy (hips ~0.94 m up in metres)', () => {
    const p = jointWorldPositions(load(WALK), 0, ['Hips', 'LeftFoot']);
    expect(p.get('Hips')![1]).toBeGreaterThan(0.8);
    expect(p.get('Hips')![1]).toBeLessThan(1.1);
    expect(p.get('LeftFoot')![1]).toBeLessThan(0.2);
  });

  it('sampleCurve wraps and interpolates; blendCurves lerps', () => {
    const c = [0, 1, 2, 3];
    expect(sampleCurve(c, 0.125)).toBeCloseTo(0.5, 9);
    expect(sampleCurve(c, 0.875)).toBeCloseTo(1.5, 9); // between 3 and 0
    const b = blendCurves(walk, run, 0.5);
    expect(b.L.knee[5]).toBeCloseTo((walk.L.knee[5]! + run.L.knee[5]!) / 2, 9);
    expect(b.freq).toBeCloseTo((walk.freq + run.freq) / 2, 9);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/glb-clip.test.ts` → FAIL (modules missing).

- [ ] **Step 3: `gait-curves.ts`**

```ts
// src/lab/sdf-zombie/gait-curves.ts
//
// A stride SHAPE sampled from a reference clip: per-phase sagittal angles
// and a hip bob, normalised by leg length so proportions cancel. Produced
// once by scripts/gait-from-clip.ts (glb-clip.ts does the work) into
// gait-curves/<name>.ts; consumed by gait.ts's curve mode. Pure data.
export interface LegCurves {
  /** Thigh pitch forward from straight down (rad), per phase sample. */
  thigh: number[];
  /** Knee flexion (rad), 0 = straight, positive = bent. */
  knee: number[];
  /** Foot on the ground at this sample. */
  stance: boolean[];
}

export interface GaitCurves {
  name: string;
  /** Samples per cycle. Phase 0 = LEFT heel strike. */
  n: number;
  /** Stride cycles per second — 1 / clip duration. */
  freq: number;
  /** Stance foot's fore-aft travel relative to the hips per cycle, / leg length. */
  travel: number;
  /** Hips height minus the cycle mean, / leg length. */
  hipsY: number[];
  L: LegCurves;
  R: LegCurves;
}

/** Linear interpolation over a wrapping cycle; phase in [0, 1). */
export function sampleCurve(c: readonly number[], phase: number): number {
  const n = c.length;
  let p = phase - Math.floor(phase);
  const x = p * n;
  const i = Math.floor(x);
  const t = x - i;
  return c[i % n]! * (1 - t) + c[(i + 1) % n]! * t;
}

/** Nearest-sample lookup for the boolean stance track. */
export function sampleStance(s: readonly boolean[], phase: number): boolean {
  const n = s.length;
  const p = phase - Math.floor(phase);
  return s[Math.round(p * n) % n]!;
}

function lerpArr(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((v, i) => v + (b[i]! - v) * t);
}

/** Sample-wise lerp of two tables with the same n. Stance snaps at 0.5. */
export function blendCurves(a: GaitCurves, b: GaitCurves, t: number): GaitCurves {
  if (a.n !== b.n) throw new Error(`blendCurves: ${a.name} n=${a.n} vs ${b.name} n=${b.n}`);
  const near = t < 0.5 ? a : b;
  const leg = (x: LegCurves, y: LegCurves, z: LegCurves): LegCurves => ({
    thigh: lerpArr(x.thigh, y.thigh, t), knee: lerpArr(x.knee, y.knee, t), stance: z.stance.slice(),
  });
  return {
    name: `${a.name}~${b.name}`, n: a.n,
    freq: a.freq + (b.freq - a.freq) * t,
    travel: a.travel + (b.travel - a.travel) * t,
    hipsY: lerpArr(a.hipsY, b.hipsY, t),
    L: leg(a.L, b.L, near.L), R: leg(a.R, b.R, near.R),
  };
}
```

- [ ] **Step 4: `glb-clip.ts`**

```ts
// src/lab/sdf-zombie/glb-clip.ts
//
// Enough glTF to read ONE skinned clip: GLB chunks, accessors, LINEAR
// animation channels, and the node hierarchy composed to world positions.
// Then the stride sampler: 32 phases over one cycle → sagittal angles.
// Pure; the only I/O is the byte array the caller hands in.
import type { Vec3 } from './types';
import { add, len, normalize, qMul, qRotate, sub, type Quat } from './vec';
import type { GaitCurves, LegCurves } from './gait-curves';

interface GltfJson {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations: { name?: string; channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[] }[];
}

export interface Glb { json: GltfJson; bin: DataView }

export function parseGlb(bytes: Uint8Array): Glb {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json: GltfJson | null = null;
  let bin: DataView | null = null;
  while (off < bytes.byteLength) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    const body = bytes.subarray(off + 8, off + 8 + clen);
    if (ctype === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (ctype === 0x004e4942) bin = new DataView(body.buffer, body.byteOffset, body.byteLength);
    off += 8 + clen;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

const COMP: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** Float accessor → flat array (componentType 5126 only; clips use floats). */
function readFloats(g: Glb, accessor: number): Float32Array {
  const a = g.json.accessors[accessor]!;
  if (a.componentType !== 5126) throw new Error(`accessor ${accessor}: expected float32`);
  const bv = g.json.bufferViews[a.bufferView]!;
  const n = COMP[a.type]!;
  const stride = bv.byteStride ?? n * 4;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++) out[i * n + k] = g.bin.getFloat32(base + i * stride + k * 4, true);
  return out;
}

interface Track { times: Float32Array; values: Float32Array; width: number }
interface NodeTracks { translation?: Track; rotation?: Track; scale?: Track }

function tracksOf(g: Glb, clip = 0): Map<number, NodeTracks> {
  const anim = g.json.animations[clip];
  if (!anim) throw new Error('no animation in glb');
  const out = new Map<number, NodeTracks>();
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]!;
    const t: Track = { times: readFloats(g, s.input), values: readFloats(g, s.output), width: ch.target.path === 'rotation' ? 4 : 3 };
    const nt = out.get(ch.target.node) ?? {};
    (nt as Record<string, Track>)[ch.target.path] = t;
    out.set(ch.target.node, nt);
  }
  return out;
}

/** Clip duration: the latest keyframe time over every sampler. */
export function clipDuration(g: Glb, clip = 0): number {
  const anim = g.json.animations[clip]!;
  let d = 0;
  for (const s of anim.samplers) d = Math.max(d, readFloats(g, s.input).at(-1) ?? 0);
  return d;
}

function sampleTrack(t: Track, time: number): number[] {
  const n = t.times.length, w = t.width;
  if (time <= t.times[0]!) return Array.from(t.values.subarray(0, w));
  if (time >= t.times[n - 1]!) return Array.from(t.values.subarray((n - 1) * w, n * w));
  let i = 0;
  while (t.times[i + 1]! < time) i++;
  const u = (time - t.times[i]!) / (t.times[i + 1]! - t.times[i]!);
  const a = t.values.subarray(i * w, (i + 1) * w), b = t.values.subarray((i + 1) * w, (i + 2) * w);
  const out: number[] = [];
  for (let k = 0; k < w; k++) out.push(a[k]! + (b[k]! - a[k]!) * u);
  if (w === 4) { // normalise the lerped quaternion (short arc: Meshy keys are dense)
    const m = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!) || 1;
    for (let k = 0; k < 4; k++) out[k]! /= m;
  }
  return out;
}

/**
 * World positions (metres — the Armature's 0.01 scale is composed in) of the
 * named joints at clip time `time`. Nodes without a track keep their bind TRS.
 */
export function jointWorldPositions(g: Glb, time: number, names: readonly string[], clip = 0): Map<string, Vec3> {
  const tracks = tracksOf(g, clip);
  const want = new Set(names);
  const out = new Map<string, Vec3>();
  const walk = (i: number, pPos: Vec3, pQ: Quat, pS: number) => {
    const nd = g.json.nodes[i]!, tr = tracks.get(i) ?? {};
    const t = (tr.translation ? sampleTrack(tr.translation, time) : nd.translation ?? [0, 0, 0]) as Vec3;
    const r = (tr.rotation ? sampleTrack(tr.rotation, time) : nd.rotation ?? [0, 0, 0, 1]) as Quat;
    const sc = tr.scale ? sampleTrack(tr.scale, time) : nd.scale ?? [1, 1, 1];
    const s = pS * sc[0]!; // uniform scale is all these rigs use
    const pos = add(pPos, qRotate(pQ, [t[0] * pS, t[1] * pS, t[2] * pS]));
    const q = qMul(pQ, r);
    if (nd.name && want.has(nd.name)) out.set(nd.name, pos);
    for (const c of nd.children ?? []) walk(c, pos, q, s);
  };
  for (const root of g.json.scenes[0]!.nodes) walk(root, [0, 0, 0], [0, 0, 0, 1], 1);
  return out;
}

export interface CurveOpts { name: string; n?: number; clip?: number }

const JOINTS = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'] as const;

/** Thigh pitch forward from straight down and knee flexion, sagittal plane. */
function legAngles(hip: Vec3, knee: Vec3, ankle: Vec3): { thigh: number; knee: number } {
  const t = sub(knee, hip), s = sub(ankle, knee);
  const thigh = Math.atan2(t[2], -t[1]);
  const shin = Math.atan2(s[2], -s[1]);
  return { thigh, knee: thigh - shin }; // shin trails the thigh when the knee bends
}

/** One clip → GaitCurves. Phase 0 = left heel strike (left foot furthest forward of the hips). */
export function curvesFromClip(g: Glb, opts: CurveOpts): GaitCurves {
  const n = opts.n ?? 32;
  const dur = clipDuration(g, opts.clip ?? 0);
  const frames = Array.from({ length: n }, (_, i) => jointWorldPositions(g, (i / n) * dur, JOINTS, opts.clip ?? 0));
  const f0 = frames[0]!;
  const legLen = len(sub(f0.get('LeftLeg')!, f0.get('LeftUpLeg')!)) + len(sub(f0.get('LeftFoot')!, f0.get('LeftLeg')!));
  // Phase origin: left foot furthest forward of the hips.
  let start = 0, best = -Infinity;
  frames.forEach((f, i) => { const d = f.get('LeftFoot')![2] - f.get('Hips')![2]; if (d > best) { best = d; start = i; } });
  const at = (i: number) => frames[(start + i) % n]!;
  const side = (up: string, lo: string, ft: string): LegCurves => {
    const thigh: number[] = [], knee: number[] = [], heights: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = at(i);
      const a = legAngles(f.get(up)!, f.get(lo)!, f.get(ft)!);
      thigh.push(a.thigh); knee.push(a.knee); heights.push(f.get(ft)![1]);
    }
    const floor = Math.min(...heights);
    return { thigh, knee, stance: heights.map(h => h < floor + 0.03 * legLen) };
  };
  const L = side('LeftUpLeg', 'LeftLeg', 'LeftFoot');
  const R = side('RightUpLeg', 'RightLeg', 'RightFoot');
  const hips = Array.from({ length: n }, (_, i) => at(i).get('Hips')![1]);
  const mean = hips.reduce((a, b) => a + b, 0) / n;
  const hipsY = hips.map(h => (h - mean) / legLen);
  // Travel: the left foot's fore-aft range relative to the hips while planted.
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) if (L.stance[i]) {
    const f = at(i); const z = f.get('LeftFoot')![2] - f.get('Hips')![2];
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  return { name: opts.name, n, freq: 1 / dur, travel: (zMax - zMin) / legLen, hipsY, L, R };
}
```

- [ ] **Step 5: Run the test** → PASS. If `phase 0 is left heel strike` fails because thigh pitch peaks a sample away from the forward-most foot, that is fine to fix by defining the origin on `max(thigh)` instead — change `curvesFromClip`'s origin rule AND the spec's sentence, and say so in the commit. If the run duty comes out ≥ 0.55, print the heights and check the 3 % threshold against the run clip's floor; adjust the threshold in `side()` only with the number in a comment.

- [ ] **Step 6: The script**

```ts
// scripts/gait-from-clip.ts
//
// npm run gait:curves -- <clip.glb> <name> [legLengthMetres]
// Writes src/lab/sdf-zombie/gait-curves/<name>.ts and prints the speed the
// stride implies for a body of the given leg length (default 0.84, the
// soldier: thigh 0.42 + shin 0.42), so motion-profile.ts's cruise/runBand
// can be set from measured numbers rather than guessed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseGlb, curvesFromClip } from '../src/lab/sdf-zombie/glb-clip';

const [glb, name, legArg] = process.argv.slice(2);
if (!glb || !name) { console.error('usage: gait-from-clip <clip.glb> <name> [legLengthMetres]'); process.exit(2); }
const legLen = Number(legArg ?? 0.84);
const c = curvesFromClip(parseGlb(new Uint8Array(readFileSync(glb))), { name });
const fmt = (a: number[]) => '[' + a.map(v => v.toFixed(4)).join(', ') + ']';
const fmtB = (a: boolean[]) => '[' + a.map(v => (v ? 'true' : 'false')).join(', ') + ']';
const ident = name.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase()).replace(/^(\w)/, m => m.toUpperCase());
const src = `// GENERATED by scripts/gait-from-clip.ts from ${glb} — do not edit.
// ${c.n} samples over one cycle, phase 0 = left heel strike, angles in
// radians, lengths / leg length. Regenerate: npm run gait:curves -- ${glb} ${name}
import type { GaitCurves } from '../gait-curves';

export const ${ident.toUpperCase().replace(/[^A-Z0-9]/g, '_')}: GaitCurves = {
  name: '${name}',
  n: ${c.n},
  freq: ${c.freq.toFixed(5)},
  travel: ${c.travel.toFixed(5)},
  hipsY: ${fmt(c.hipsY)},
  L: { thigh: ${fmt(c.L.thigh)}, knee: ${fmt(c.L.knee)}, stance: ${fmtB(c.L.stance)} },
  R: { thigh: ${fmt(c.R.thigh)}, knee: ${fmt(c.R.knee)}, stance: ${fmtB(c.R.stance)} },
};
`;
mkdirSync('src/lab/sdf-zombie/gait-curves', { recursive: true });
const out = `src/lab/sdf-zombie/gait-curves/${name}.ts`;
writeFileSync(out, src);
const duty = c.L.stance.filter(Boolean).length / c.n;
const speed = (c.travel * legLen * c.freq) / duty;
console.log(`wrote ${out}: freq ${c.freq.toFixed(3)} Hz, duty ${duty.toFixed(2)}, travel ${(c.travel * legLen).toFixed(3)} m, ` +
  `peak knee ${Math.max(...c.L.knee).toFixed(2)} rad → implied speed ${speed.toFixed(2)} m/s for a ${legLen} m leg`);
```

Add to `package.json` scripts: `"gait:curves": "tsx scripts/gait-from-clip.ts",`.

- [ ] **Step 7: Generate both tables and record the printed speeds**

```bash
npm run gait:curves -- docs/dev-notes/refs/soldier-mesh/soldier.glb soldier-walk
npm run gait:curves -- docs/dev-notes/refs/soldier-mesh/zombie-biped-running.glb soldier-run
npx tsc --noEmit
```

Exports are `SOLDIER_WALK` and `SOLDIER_RUN`. Write the two printed "implied speed" lines into the commit message; Task 3 uses them.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/gait-curves.ts src/lab/sdf-zombie/glb-clip.ts src/lab/sdf-zombie/glb-clip.test.ts scripts/gait-from-clip.ts src/lab/sdf-zombie/gait-curves package.json
git commit -m "gait curves: sample a reference clip into per-phase stride angles; soldier walk and run tables

<paste the two implied-speed lines>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: gait.ts curve mode

**Files:**
- Modify: `src/lab/sdf-zombie/gait.ts` (`GaitProfile`, `blendProfiles`, `stepGait` signature, the `leg` closure, the root bob)
- Test: `src/lab/sdf-zombie/gait.test.ts` (append)

- [ ] **Step 1: Failing tests** (append; import `SOLDIER_WALK` from `./gait-curves/soldier-walk`, `SOLDIER_RUN` from `./gait-curves/soldier-run`, and `type GaitLimbs` from `./gait`)

```ts
describe('curve-mode gait', () => {
  // The soldier's rest legs: dead straight, 0.42 + 0.42, tilt 2°.
  const LIMBS: GaitLimbs = {
    L: { thigh: [0.0147, -0.4197, 0], shin: [0.0147, -0.4197, 0] },
    R: { thigh: [-0.0147, -0.4197, 0], shin: [-0.0147, -0.4197, 0] },
  };
  const walk: GaitProfile = { ...MARCH, curves: SOLDIER_WALK, strideFreq: SOLDIER_WALK.freq };
  const runP: GaitProfile = { ...RUN, curves: SOLDIER_RUN, strideFreq: SOLDIER_RUN.freq };
  const cycle = (p: GaitProfile, limbs?: GaitLimbs) => {
    let st = makeGaitState(9); const out: GaitPose[] = [];
    const n = Math.round(1 / p.strideFreq / DT) + 1;
    for (let i = 0; i < n; i++) { const s = stepGait(st, NONE, DT, 'carry', p, limbs); st = s.state; out.push(s.pose); }
    return out;
  };
  const kneeOffLine = (pose: GaitPose, limbs: GaitLimbs) => {
    // Distance of the posed knee from the posed hip→ankle line, left leg.
    const hip: Vec3 = [0, 0, 0];
    const knee = add(limbs.L.thigh, pose.offsets.kneeL);
    const ankle = add(add(limbs.L.thigh, limbs.L.shin), pose.offsets.footL);
    const d = normalize(sub(ankle, hip));
    const v = sub(knee, hip);
    const along = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    return len(sub(v, [d[0] * along, d[1] * along, d[2] * along]));
  };
  it('the knee leaves the hip→ankle line by more than 8 cm at peak swing', () => {
    expect(Math.max(...cycle(walk, LIMBS).map(p => kneeOffLine(p, LIMBS)))).toBeGreaterThan(0.08);
  });
  it('segment lengths are preserved by construction', () => {
    for (const p of cycle(runP, LIMBS)) {
      const knee = add(LIMBS.L.thigh, p.offsets.kneeL);
      const ankle = add(add(LIMBS.L.thigh, LIMBS.L.shin), p.offsets.footL);
      expect(len(knee)).toBeCloseTo(len(LIMBS.L.thigh), 6);
      expect(len(sub(ankle, knee))).toBeCloseTo(len(LIMBS.L.shin), 6);
    }
  });
  it('walk never has both feet in the air; run has a flight phase', () => {
    expect(cycle(walk, LIMBS).some(p => !p.stance.legL && !p.stance.legR)).toBe(false);
    expect(cycle(runP, LIMBS).some(p => !p.stance.legL && !p.stance.legR)).toBe(true);
  });
  it('without limbs the profile falls back to the sinusoid path', () => {
    const a = cycle(walk)[10]!, b = cycle({ ...walk, curves: undefined })[10]!;
    expect(a.offsets.kneeL).toEqual(b.offsets.kneeL);
  });
  it('blendProfiles blends the curves sample-wise', () => {
    const half = blendProfiles(walk, runP, 0.5);
    expect(half.curves!.L.knee[3]).toBeCloseTo((SOLDIER_WALK.L.knee[3]! + SOLDIER_RUN.L.knee[3]!) / 2, 9);
    expect(blendProfiles(walk, runP, 0).curves).toBe(SOLDIER_WALK);
  });
});
```

Add `add`, `normalize` to the `./vec` import in the test file if absent.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement in `gait.ts`**

Imports: `import { blendCurves, sampleCurve, sampleStance, type GaitCurves } from './gait-curves';`

Types:

```ts
/** The body's REST leg segment vectors, body-local — what curve mode needs
 *  to turn clip angles back into positions with THIS body's lengths. */
export interface GaitLimbs {
  L: { thigh: Vec3; shin: Vec3 };
  R: { thigh: Vec3; shin: Vec3 };
}
```

`GaitProfile` gains `curves?: GaitCurves` — add to the mapped type: `& { armStyle: ArmStyle; curves?: GaitCurves }`. `GAIT_TUNING` gets no curves (leave the object alone).

`blendProfiles`: after the numeric lerp, add

```ts
  if (a.curves && b.curves) out.curves = blendCurves(a.curves, b.curves, t);
  else out.curves = (t < 0.5 ? a : b).curves;
```

(the `t === 0`/`t === 1` early returns already hand back `a`/`b` whole.)

`stepGait` signature: `profile: GaitProfile = SHAMBLE, limbs?: GaitLimbs`. Then:

```ts
  const curves = !hop && limbs ? T.curves : undefined;
```

Root bob — replace the `bob` line with:

```ts
  const legLen = limbs ? len(limbs.L.thigh) + len(limbs.L.shin) : 0;
  const bob = curves
    ? sampleCurve(curves.hipsY, ((phiL % TAU) + TAU) % TAU / TAU) * legLen * (1 - damage * T.damageBobScale)
    : -bobAmp * (hop ? T.hopBobScale : 1) * bobCurve;
```

(`len` from `./vec` — import it.) `bobAmp` stays computed for the sinusoid path so nothing else moves.

The `leg` closure — insert at its top, after the `missing` early return:

```ts
    if (curves) {
      const c = side === 'L' ? curves.L : curves.R;
      const rest = side === 'L' ? limbs!.L : limbs!.R;
      const p = ((phiL % TAU) + TAU) % TAU / TAU; // the LEFT clock; the R curves are already half a cycle off
      const scaleA = (side === 'L' ? aL : aR) * (wounded ? T.woundedSwingScale : 1);
      const thigh = sampleCurve(c.thigh, p) * scaleA;
      const flex = Math.max(0, sampleCurve(c.knee, p) * scaleA);
      const Lt = len(rest.thigh), Ls = len(rest.shin);
      const knee: Vec3 = [rest.thigh[0], -Lt * Math.cos(thigh), Lt * Math.sin(thigh)];
      const shinPitch = thigh - flex;
      const ankle: Vec3 = [knee[0] + rest.shin[0], knee[1] - Ls * Math.cos(shinPitch), knee[2] + Ls * Math.sin(shinPitch)];
      const restAnkle = add(rest.thigh, rest.shin);
      return {
        foot: sub(ankle, restAnkle),
        knee: sub(knee, rest.thigh),
        stance: sampleStance(c.stance, p),
      };
    }
```

Note `wounded` is already computed above in the closure; keep the x component from the rest vectors so the tilt-2° legs stay where they are laterally. `add`/`sub` come from `./vec` (import).

`hop` must be known before `leg` — it is (`const hop = missingL !== missingR;` is above).

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/gait.test.ts src/lab/sdf-zombie/gait-pins.test.ts src/lab/sdf-zombie/motion.test.ts && npx tsc --noEmit` → PASS. The pins pass because `SHAMBLE.curves` is undefined and `limbs` is never passed for it, so `curves` is undefined and every original expression is reached unchanged (the new `bob` ternary takes the original branch with the original operands).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/gait.test.ts
git commit -m "gait: curve mode — legs and hip bob from a sampled clip, rebuilt with the body's own segment lengths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: motion passes the limbs; MARCH/RUN carry the curves; cruise from the clips

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts` (the `stepGait` call), `src/lab/sdf-zombie/gait.ts` (MARCH/RUN definitions), `src/lab/sdf-zombie/motion-profile.ts` (SOLDIER_PROFILE numbers)
- Test: `src/lab/sdf-zombie/motion.test.ts` (append)

- [ ] **Step 1: Failing test**

```ts
describe('soldier walks on the clip curves', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 1.0 };
  it('a march step lifts the knee well forward of the hip→ankle line', () => {
    const j = soldierJoints();
    let state = makeMotionState(3, [0, 0, 0]); let points = stubPoints(j);
    let best = 0;
    for (let i = 0; i < 120; i++) {
      const s = stepMotion(state, j, CFG, NO_SIGNALS(), points, BOUNDS, makeRng(1));
      state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      const P = s.frame.restPose;
      const hip = P[j.index.hipL]!, knee = P[j.index.kneeL]!, foot = P[j.index.footL]!;
      const d = normalize(sub(foot, hip)); const v = sub(knee, hip);
      const along = dot(d, v);
      best = Math.max(best, len(sub(v, [d[0] * along, d[1] * along, d[2] * along])));
    }
    expect(best).toBeGreaterThan(0.06);
    expect(state.runWeight).toBe(0);
  });
  it('MARCH and RUN carry the curves and their frequencies', () => {
    expect(MARCH.curves?.name).toBe('soldier-walk');
    expect(RUN.curves?.name).toBe('soldier-run');
    expect(MARCH.strideFreq).toBeCloseTo(MARCH.curves!.freq, 9);
    expect(RUN.strideFreq).toBeCloseTo(RUN.curves!.freq, 9);
  });
});
```

(`normalize` from `./vec`; `MARCH`, `RUN` from `./gait`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`gait.ts` — at the top: `import { SOLDIER_WALK } from './gait-curves/soldier-walk'; import { SOLDIER_RUN } from './gait-curves/soldier-run';`. In `MARCH`: `strideFreq: SOLDIER_WALK.freq, curves: SOLDIER_WALK,` (replace the 1.6). In `RUN`: `strideFreq: SOLDIER_RUN.freq, curves: SOLDIER_RUN,` (replace the 2.4). Leave the other knobs; in curve mode `strideLen`, `footLift`, `kneeBend`, `kneeLift`, `kneeTrack`, `footPush`, `stanceDuty` and `bobAmp` are unused for the legs and root — add one comment above MARCH saying so.

`motion.ts` — build the limbs once per call (cheap, six subtractions) right before the `stepGait` call and pass them:

```ts
  const limbs: GaitLimbs | undefined = idx.hipL !== undefined && idx.kneeL !== undefined && idx.footL !== undefined
    && idx.hipR !== undefined && idx.kneeR !== undefined && idx.footR !== undefined
    ? {
      L: { thigh: sub(joints.base[idx.kneeL]!, joints.base[idx.hipL]!), shin: sub(joints.base[idx.footL]!, joints.base[idx.kneeL]!) },
      R: { thigh: sub(joints.base[idx.kneeR]!, joints.base[idx.hipR]!), shin: sub(joints.base[idx.footR]!, joints.base[idx.kneeR]!) },
    }
    : undefined;
  const gait = stepGait(
    { time: state.gait.time + stagger.phaseKnock, seed: state.gait.seed },
    skew, dt, armStyle, gaitProfile, limbs,
  );
```

(`GaitLimbs` from `./gait`.) The zombie gets limbs too, but `SHAMBLE.curves` is undefined so nothing changes — the pins prove it.

`motion-profile.ts` — set `SOLDIER_PROFILE.cruise` to the run clip's implied speed from Task 1's commit message (rounded to 0.1), and `runBand` to `{ from: <walk implied speed> + 0.2, to: <run implied speed> - 0.2 }`. Put both printed lines in a comment above so the numbers have a source. The lab's `cruiseFor('walk')` is `min(cruise, runBand.from * 0.75)` — check that lands near the walk's implied speed; if not, note it in the commit and leave the lab alone (Task 4 judges it).

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/gait.test.ts src/lab/sdf-zombie/gait-pins.test.ts src/lab/sdf-zombie/motion-profile.test.ts && npx tsc --noEmit` → PASS. `motion-profile.test.ts` asserts `cruise > WANDER_TUNING.speed` (1.15) and a band with `from < to`; keep those true.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/motion-profile.ts
git commit -m "soldier: march and run walk on the clip curves; cruise and run band from the clips' implied speeds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Strips, notes, TASKS

**Files:**
- Modify: `docs/dev-notes/2026-09-05-soldier-animation/notes.md`, `TASKS.md`
- Create: `docs/dev-notes/2026-09-05-soldier-animation/{walk,run}/` (re-shot)

- [ ] **Step 1: Full suite** `npx vitest run && npx tsc --noEmit` → all green.

- [ ] **Step 2: Strips**

```bash
export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251
rm -rf docs/dev-notes/2026-09-05-soldier-animation/{walk,run}
BLOB_POSE=walk npm run blob:shot -- soldier docs/dev-notes/2026-09-05-soldier-animation/walk 8
BLOB_POSE=run  npm run blob:shot -- soldier docs/dev-notes/2026-09-05-soldier-animation/run 8
```

Both must exit 0. If you can view PNGs, look for: a bent knee on the swing leg, feet not through the floor, kit still on the body. If you cannot, say so in the notes.

- [ ] **Step 3: Notes** — append a `## Round 3 — clip-driven curves` section to `notes.md`: which clips, the two implied speeds, the cruise/runBand chosen, what the strips show (or that you could not view them).

- [ ] **Step 4: TASKS.md** — in the SOLDIER ANIMATION entry under `## Current focus`, add one sentence: "Round 3: the march and run legs now follow per-phase curves sampled from the soldier's `Walking` clip and the Meshy zombie-biped `running` clip (`gait-curves/`, `scripts/gait-from-clip.ts`); the zombie stays on the sinusoid shamble, pinned." and link the spec `docs/superpowers/specs/2026-09-05-clip-driven-gait-design.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/dev-notes/2026-09-05-soldier-animation TASKS.md
git commit -m "soldier anim: clip-driven walk/run strips, notes, TASKS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Self-review

Spec coverage: sampler + tables (T1), curve mode + blend + skews (T2), limbs/profiles/cruise (T3), gates: pins (every task), sampler gates (T1 test), curve gates (T2/T3 tests), strips (T4). Foot pitch was dropped from the spec's curve list as unused (the toe follows the ankle rigidly) — the spec is edited to match in the same commit as this plan. Types: `GaitCurves`/`LegCurves` (T1) used by T2/T3; `GaitLimbs` (T2) used by T3; `SOLDIER_WALK`/`SOLDIER_RUN` export names fixed by the script's ident rule (`soldier-walk` → `SOLDIER_WALK`).
