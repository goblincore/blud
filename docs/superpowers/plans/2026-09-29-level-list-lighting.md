# Level materials on the shared list (cheap tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shade level surfaces with the shared list's unshadowed lights through one custom, diffuse-only `LightingNode`, behind `?levellist=1`, and decide from a measurement whether it is worth keeping.

**Architecture:** A per-lamp `levelCheap` flag rides `LightSource` → `ListLight`. Each frame `writeLightList` names, per room, up to 8 cheap list indices in two `vec4` uniforms. `LevelListLightingNode` (one per room, in that room's `lightsNode`) loops over those indices, reads the list's storage buffer, and adds Lambert × cone × three-matching falloff into `reflectedLight.directDiffuse`. Cheap lights are dropped from three's level-material lights only when the flag is on. Spec: [2026-09-29-level-list-lighting-design.md](../specs/2026-09-29-level-list-lighting-design.md).

**Tech Stack:** TypeScript, three.js r186 WebGPU/TSL (`wgslFn`, `LightingNode`), vitest, the light gate (`scripts/sdf-game-light-gate.sh`), headless Chrome via `scripts/lab-servers.sh`.

**Rules for the whole plan:**
- Default (no `?levellist=1`) must stay byte-identical: no gate pin may move. After any task that touches shared code, run `npx vitest run src/lab/sdf-zombie/webgpu`.
- Measure on a quiet machine (`uptime` load < 4, the owner's game tabs closed). A cost number taken at load > 4 is not evidence.
- Task 6 is a go/no-go gate. If it says no-go, do Task 8's no-go branch and stop; do not do Task 7.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/level-tier.ts` (new, pure) | Which lamps/lights are cheap-tier; per-room index selection; CPU twins of the node's math |
| `src/lab/sdf-zombie/webgpu/level-tier.test.ts` (new) | Pins the above |
| `src/lab/sdf-zombie/webgpu/level-list-node.ts` (new) | `LEVEL_LIST_WGSL` + `LevelListLightingNode` |
| `src/lab/sdf-zombie/webgpu/level-list-node.test.ts` (new) | Pins the WGSL contract and the node |
| `src/lab/sdf-zombie/webgpu/light-list.ts` | `levelCheap` on `LightSource` / `ListLight` |
| `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts` | Carry the flag lamp → source; per-frame per-room picks |
| `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts` | `Lamp.levelCheap` |
| `src/lab/sdf-zombie/webgpu/probe-lighting-node.ts` | `levelLightsNode` takes extra lighting nodes |
| `src/lab/sdf-zombie/webgpu/game-state-lighting.ts` | `levelListOn`, `levelListNodes` |
| `src/lab/sdf-zombie/webgpu/game-lighting-leaves.ts` | `levelSceneLights` drops cheap three lights when on; `refreshLevelLights` keeps the node |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Boot flag, `userData.levelCheap`, one node per room |
| `src/lab/sdf-zombie/webgpu/game-seams-lighting-probes.ts` | `levelListInfo()` seam |
| `docs/dev-notes/2026-09-29-level-list/` (new) | Notes, A/B sheet, cost numbers |

---

### Task 1: The pure module (`level-tier.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-tier.ts`
- Test: `src/lab/sdf-zombie/webgpu/level-tier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/level-tier.test.ts
import { describe, expect, it } from 'vitest';
import { buildLightList, packLightList, LIST_LIGHTS_AT, LIGHT_VEC4S, type ListLight, type LightSource } from './light-list';
import {
  LEVEL_PICKS, cheapLevelIndices, decodeCone, distanceAttenuation, isLevelCheap, levelCutoff, levelDecay,
  levelIrradiance, spotFactor,
} from './level-tier';

const light = (over: Partial<ListLight> = {}): ListLight => ({
  kind: 'point', profile: 5, pos: [0, 2, 0], color: [1, 0.5, 0.25], intensity: 1, range: 12,
  axis: [0, -1, 0], cosOuter: 1, cosInner: 1, roomMask: 0, bodyNorm: 1, coverZero: 0, ...over,
});

describe('isLevelCheap — which lights the cheap tier takes', () => {
  it('takes fire-mood lights and shadowless tubes, never beacons or shadowed tubes', () => {
    expect(isLevelCheap({ mood: 'fire' })).toBe(true);
    expect(isLevelCheap({ fixture: 'bulb', mood: 'fire' })).toBe(true);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady', shadow: false })).toBe(true);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady' })).toBe(false);
    expect(isLevelCheap({ fixture: 'tube', mood: 'steady', shadow: true })).toBe(false);
    expect(isLevelCheap({ fixture: 'beacon', mood: 'dead' })).toBe(false);
    expect(isLevelCheap({ fixture: 'beacon', mood: 'fire', shadow: false })).toBe(false);
    expect(isLevelCheap({ mood: 'steady' })).toBe(false);
  });
});

describe('cheapLevelIndices — a room\'s cheap lights, as list indices', () => {
  const out = new Array<number>(LEVEL_PICKS).fill(0);
  it('returns the flagged lights that reach the room, in list order, padded with -1', () => {
    const list = [
      light({ levelCheap: true, roomMask: 1 << 5 }),   // 0: room 5, cheap
      light({ roomMask: 1 << 5 }),                     // 1: room 5, not cheap
      light({ levelCheap: true, roomMask: 1 << 3 }),   // 2: room 3
      light({ levelCheap: true, roomMask: 0 }),        // 3: any room
    ];
    expect(cheapLevelIndices(list, 5, out)).toBe(2);
    expect(out).toEqual([0, 3, -1, -1, -1, -1, -1, -1]);
    expect(cheapLevelIndices(list, 3, out)).toBe(2);
    expect(out.slice(0, 3)).toEqual([2, 3, -1]);
    expect(cheapLevelIndices(list, 9, out)).toBe(1);
    expect(out.slice(0, 2)).toEqual([3, -1]);
  });
  it('caps at LEVEL_PICKS and never writes past it', () => {
    const list = Array.from({ length: 12 }, () => light({ levelCheap: true }));
    expect(cheapLevelIndices(list, 1, out)).toBe(LEVEL_PICKS);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('an empty list clears the picks', () => {
    out.fill(3);
    expect(cheapLevelIndices([], 1, out)).toBe(0);
    expect(out.every(v => v === -1)).toBe(true);
  });
});

describe('the falloff twins match three\'s formulas', () => {
  it('distanceAttenuation: 1/max(d^decay, 0.01) x window, or no window at cutoff 0', () => {
    expect(distanceAttenuation(2, 0, 2)).toBeCloseTo(0.25, 9);
    expect(distanceAttenuation(0.05, 0, 2)).toBeCloseTo(100, 9);           // 0.0025 clamps to 0.01
    const w = Math.pow(1 - Math.pow(2 / 8, 4), 2);
    expect(distanceAttenuation(2, 8, 1.2)).toBeCloseTo((1 / Math.pow(2, 1.2)) * w, 9);
    expect(distanceAttenuation(9, 8, 1.2)).toBe(0);                          // past the cutoff
  });
  it('spotFactor: smoothstep(cosOuter, cosInner, cos), guarded against a zero-width penumbra', () => {
    expect(spotFactor(0.5, 0.8, 0.9)).toBe(0);
    expect(spotFactor(0.95, 0.8, 0.9)).toBe(1);
    expect(spotFactor(0.85, 0.8, 0.9)).toBeCloseTo(0.5, 9);
    expect(Number.isFinite(spotFactor(0.9, 0.9, 0.9))).toBe(true);
  });
  it('kind decides decay and cutoff: spots 1.2 with the list range, points 2 with none', () => {
    expect(levelDecay('spot')).toBe(1.2);
    expect(levelDecay('point')).toBe(2);
    expect(levelCutoff({ kind: 'spot', range: 6 })).toBe(6);
    expect(levelCutoff({ kind: 'point', range: 12 })).toBe(0);
  });
});

describe('levelIrradiance — one light\'s contribution to a surface point', () => {
  it('a point light straight above a floor point: n.L 1, colour / d^2', () => {
    const e = levelIrradiance(light({ pos: [0, 2, 0], color: [1, 0.5, 0.25] }), [0, 0, 0], [0, 1, 0]);
    expect(e[0]).toBeCloseTo(0.25, 9); expect(e[1]).toBeCloseTo(0.125, 9); expect(e[2]).toBeCloseTo(0.0625, 9);
  });
  it('a surface facing away gets nothing', () => {
    expect(levelIrradiance(light(), [0, 0, 0], [0, -1, 0])).toEqual([0, 0, 0]);
  });
  it('a spot lights inside its cone and not outside it', () => {
    const spot = light({ kind: 'spot', pos: [0, 3, 0], axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), range: 6.6 });
    const inside = levelIrradiance(spot, [0, 0, 0], [0, 1, 0]);
    const outside = levelIrradiance(spot, [6, 0, 0], [0, 1, 0]);
    expect(inside[0]).toBeGreaterThan(0);
    expect(outside).toEqual([0, 0, 0]);
  });
});

describe('decodeCone — the WGSL and the CPU read the packed cone the same way', () => {
  it('round-trips packLightList\'s cone within the 1e-3 the packing keeps', () => {
    const src: LightSource = { kind: 'spot', profile: 'tube', pos: [0, 3, 0], color: [1, 1, 1], intensity: 1, range: 6.6,
      axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45) };
    const list = buildLightList([src]);
    const floats = packLightList(list);
    const cone = floats[(LIST_LIGHTS_AT + 2) * 4 + 3]!;
    const c = decodeCone(cone);
    expect(c.cosOuter).toBeCloseTo(Math.cos(0.6), 2);
    expect(Math.abs(c.cosOuter - Math.cos(0.6))).toBeLessThan(1.1e-3);
    expect(c.cosInner).toBeCloseTo(Math.cos(0.45), 3);
    expect(LIGHT_VEC4S).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-tier.test.ts`
Expected: FAIL — `Failed to resolve import "./level-tier"`.

- [ ] **Step 3: Add the `levelCheap` field to the list types** (the test builds `ListLight`s with it)

In `src/lab/sdf-zombie/webgpu/light-list.ts`, in `interface LightSource` after `levelGain?: number; levelTint?: Vec3;` add:

```ts
  /** The cheap level tier takes this light: the level's materials shade it through the list node (diffuse
   *  only, level-tier.ts) instead of a three.js light. Set for fire lamps and shadowless tubes. */
  levelCheap?: boolean;
```

In `interface ListLight`, after `roomMask: number;` add:

```ts
  /** LightSource.levelCheap, carried to the list (CPU only, never packed). */
  levelCheap?: boolean;
```

In `buildLightList`'s returned object literal (the one ending `coverZero,`), add `...(s.levelCheap ? { levelCheap: true } : {}),` on its own line just before `coverZero,`.

- [ ] **Step 4: Write `level-tier.ts`**

```ts
// src/lab/sdf-zombie/webgpu/level-tier.ts
//
// THE CHEAP LEVEL TIER (spec 2026-09-29-level-list-lighting-design.md). Pure, no three: which lights the level's
// materials shade through the list node instead of a three.js light, which list indices a room's node loops over,
// and the CPU twins of the node's math (level-list-node.ts LEVEL_LIST_WGSL is the port; change one, change both —
// level-tier.test.ts and level-list-node.test.ts pin the pair).
//
// The falloff is three's, so a light that moves here keeps its look: three's getDistanceAttenuation (the Frostbite
// window), SpotLightNode's smoothstep cone, and Lambert scaling in the node (irradiance x diffuseColor / PI).
import { maskHasRoom, type ListLight, type Vec3 } from './light-list';

/** Cheap lights the node loops over per room. */
export const LEVEL_PICKS = 8;
/** A tube spot's decay (TUBE.decay in game-dynamic-light-leaves.ts). */
export const LEVEL_SPOT_DECAY = 1.2;
/** three's PointLight default, which the level's accent points keep. */
export const LEVEL_POINT_DECAY = 2;

export interface LevelCheapInput { fixture?: 'bulb' | 'tube' | 'beacon'; mood?: string; shadow?: boolean }

/** The one rule for the tier: fire-mood lights and shadowless tubes. Beacons are shadowed sweeps: never. */
export function isLevelCheap(a: LevelCheapInput): boolean {
  if (a.fixture === 'beacon') return false;
  if (a.mood === 'fire') return true;
  return a.fixture === 'tube' && a.shadow === false;
}

export const levelDecay = (kind: ListLight['kind']): number => (kind === 'spot' ? LEVEL_SPOT_DECAY : LEVEL_POINT_DECAY);
/** A spot cuts off at its list range (three's spot distance); a point has none (three's accent points have distance 0). */
export const levelCutoff = (l: Pick<ListLight, 'kind' | 'range'>): number => (l.kind === 'spot' ? l.range : 0);

/** three's getDistanceAttenuation. */
export function distanceAttenuation(dist: number, cutoff: number, decay: number): number {
  const falloff = 1 / Math.max(Math.pow(dist, decay), 0.01);
  if (cutoff > 0) {
    const r = Math.min(1, Math.max(0, 1 - Math.pow(dist / cutoff, 4)));
    return falloff * r * r;
  }
  return falloff;
}

/** three's SpotLightNode smoothstep(coneCos, penumbraCos, angleCos), guarded against a zero-width penumbra. */
export function spotFactor(cosAngle: number, cosOuter: number, cosInner: number): number {
  const w = Math.max(cosInner - cosOuter, 1e-4);
  const t = Math.min(1, Math.max(0, (cosAngle - cosOuter) / w));
  return t * t * (3 - 2 * t);
}

/** The packed cone lane (light-list.ts packLightList: floor(cosOuter x 1000) + cosInner x 0.999). */
export function decodeCone(cone: number): { cosOuter: number; cosInner: number } {
  const f = Math.floor(cone);
  return { cosOuter: f / 1000, cosInner: (cone - f) / 0.999 };
}

/** One light's contribution to a surface point p with normal n: n.L x colour x falloff x cone. The node multiplies
 *  the sum by diffuseColor / PI. The cone uses the packed (quantised) cosOuter, like the GPU. */
export function levelIrradiance(l: ListLight, p: Vec3, n: Vec3): Vec3 {
  const lx = l.pos[0] - p[0], ly = l.pos[1] - p[1], lz = l.pos[2] - p[2];
  const d = Math.max(Math.hypot(lx, ly, lz), 1e-4);
  const Lx = lx / d, Ly = ly / d, Lz = lz / d;
  const nl = Math.max(n[0] * Lx + n[1] * Ly + n[2] * Lz, 0);
  const att = distanceAttenuation(d, levelCutoff(l), levelDecay(l.kind));
  let sp = 1;
  if (l.kind === 'spot') {
    const outer = Math.floor(l.cosOuter * 1000) / 1000;
    sp = spotFactor(-(Lx * l.axis[0] + Ly * l.axis[1] + Lz * l.axis[2]), outer, l.cosInner);
  }
  const k = nl * att * sp;
  return [l.color[0] * k, l.color[1] * k, l.color[2] * k];
}

/** Fill `out` (length >= LEVEL_PICKS) with the list indices of the cheap lights that reach `room`, in list order, padded
 *  with -1; returns how many. Allocation-free. */
export function cheapLevelIndices(list: readonly ListLight[], room: number, out: number[] | Float32Array): number {
  let n = 0;
  for (let i = 0; i < list.length && n < LEVEL_PICKS; i++) {
    const l = list[i]!;
    if (l.levelCheap && maskHasRoom(l.roomMask, room)) out[n++] = i;
  }
  for (let k = n; k < LEVEL_PICKS; k++) out[k] = -1;
  return n;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-tier.test.ts src/lab/sdf-zombie/webgpu/light-list.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-tier.ts src/lab/sdf-zombie/webgpu/level-tier.test.ts src/lab/sdf-zombie/webgpu/light-list.ts
git commit -m "feat(level-list): the cheap tier's pure module (which lights, per-room picks, falloff twins)"
```

---

### Task 2: Carry the flag from the lamp to the list

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts` (LampInput ~line 37, collectLightSources ~line 79, readSourceInput ~line 163)
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts` (Lamp interface ~line 75, lamp creation ~line 137)
- Test: the existing `collectLightSources` tests file — find it with `ls src/lab/sdf-zombie/webgpu | grep light-list-leaves` (expected `game-light-list-leaves.test.ts`)

- [ ] **Step 1: Write the failing test** (append to that test file; reuse its existing imports and its lamp helper if it has one, else build the input literally as below)

```ts
describe('levelCheap rides the lamp to the list (cheap level tier)', () => {
  const lamp = (over: Partial<LampInput>): LampInput => ({
    pos: [0, 2, 0], color: [1, 1, 1], intensity: 1, range: 12, room: 5, tube: null, mood: 'steady', ...over,
  });
  it('a flagged lamp becomes a flagged source and a flagged list light; an unflagged one does not', () => {
    const sources = collectLightSources({
      lamps: [lamp({ mood: 'fire', levelCheap: true }), lamp({})], window: null, flashlight: null, flashes: [],
    });
    expect(sources[0]!.levelCheap).toBe(true);
    expect(sources[1]!.levelCheap).toBeUndefined();
    const list = buildLightList(sources);
    expect(list.filter(l => l.levelCheap)).toHaveLength(1);
  });
});
```

(Ensure `LampInput`, `collectLightSources` and `buildLightList` are imported at the top of the test file; add them if not.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-light-list-leaves.test.ts`
Expected: FAIL (`levelCheap` is not on `LampInput`, or `sources[0].levelCheap` is undefined).

- [ ] **Step 3: Implement**

In `LampInput` (game-light-list-leaves.ts) add after `gain?: number; tint?: RVec3;`:

```ts
  /** The cheap level tier shades this lamp's light for the level (level-tier.ts isLevelCheap). */
  levelCheap?: boolean;
```

In `collectLightSources`, after `if (l.gain !== undefined) s.levelGain = l.gain;` add:

```ts
    if (l.levelCheap) s.levelCheap = true;
```

In `readSourceInput`, right after `rec.gain = l.gain; rec.tint = l.tint;` add:

```ts
    rec.levelCheap = l.levelCheap;
```

In `game-dynamic-light-leaves.ts`: add `levelCheap: boolean;` to `interface Lamp` (after `tint?: Vec3;`, with the comment `/** isLevelCheap: the cheap level tier shades it (level-tier.ts). */`). Import `isLevelCheap` (`import { isLevelCheap } from './level-tier';`). In the `lamps` map literal add, before the `tube:` line:

```ts
    levelCheap: isLevelCheap({ fixture: f.fixture, mood: f.mood ?? 'steady', shadow: f.shadow }),
```

- [ ] **Step 4: Run to verify it passes, plus the typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu/game-light-list-leaves.test.ts`
Expected: no tsc output; PASS. (`Lamp` literals elsewhere, e.g. in tests, may need `levelCheap: false`; add it where tsc complains.)

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(level-list): levelCheap rides the lamp to the shared list"
```

---

### Task 3: The node (`level-list-node.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-list-node.ts`
- Test: `src/lab/sdf-zombie/webgpu/level-list-node.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/probe-lighting-node.ts` (`levelLightsNode`, ~line 168)

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/level-list-node.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
// @ts-expect-error — deep three source import for the real wgslFn parser (same pattern as probe-lighting-node.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { LEVEL_LIST_WGSL, LevelListLightingNode } from './level-list-node';
import { LIGHT_VEC4S, LIST_LIGHTS_AT, LIST_VEC4S } from './light-list';
import { LEVEL_POINT_DECAY, LEVEL_SPOT_DECAY } from './level-tier';
import { levelLightsNode } from './probe-lighting-node';

const listNode = () => storage(new THREE.StorageBufferAttribute(LIST_VEC4S * 4, 4), 'vec4', LIST_VEC4S).toReadOnly();

describe('LEVEL_LIST_WGSL — the node\'s evaluator', () => {
  it('starts with fn levelListIrradiance and parses to its five inputs, in order', () => {
    expect(LEVEL_LIST_WGSL.startsWith('fn levelListIrradiance(')).toBe(true);
    const parsed = new WGSLNodeFunction(LEVEL_LIST_WGSL);
    expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(['p', 'n', 'picksA', 'picksB', 'lights']);
  });
  it('takes its layout constants from light-list.ts and its decays from level-tier.ts', () => {
    expect(LEVEL_LIST_WGSL).toContain(`let base = ${LIST_LIGHTS_AT} + i32(iv) * ${LIGHT_VEC4S};`);
    expect(LEVEL_LIST_WGSL).toContain(`select(${LEVEL_POINT_DECAY.toFixed(1)}, ${LEVEL_SPOT_DECAY.toFixed(1)}, isSpot)`);
  });
  it('mirrors the CPU twin: three\'s window, the packed cone, n.L, no specular', () => {
    expect(LEVEL_LIST_WGSL).toContain('1.0 - pow(d / cutoff, 4.0)');
    expect(LEVEL_LIST_WGSL).toContain('floor(a2.w) / 1000.0');
    expect(LEVEL_LIST_WGSL).toContain('fract(a2.w) / 0.999');
    expect(LEVEL_LIST_WGSL).toContain('-dot(L, a2.xyz)');
    expect(LEVEL_LIST_WGSL).not.toContain('pow(max(dot(n, H)');
  });
});

describe('LevelListLightingNode', () => {
  it('is a LightingNode whose picks start empty and setPicks writes all eight slots', () => {
    const node = new LevelListLightingNode(listNode());
    expect(node.isLightingNode).toBe(true);
    expect(node.picksA.value.toArray()).toEqual([-1, -1, -1, -1]);
    expect(node.picksB.value.toArray()).toEqual([-1, -1, -1, -1]);
    node.setPicks([3, 7, -1, -1, 9, -1, -1, -1]);
    expect(node.picksA.value.toArray()).toEqual([3, 7, -1, -1]);
    expect(node.picksB.value.toArray()).toEqual([9, -1, -1, -1]);
    node.dispose();
  });
  it('rides at the END of a level light list, after the probe node', () => {
    const extra = new LevelListLightingNode(listNode());
    const probeLike = new THREE.LightingNode();
    const list = levelLightsNode([], probeLike as never, [extra]);
    const got = list.getLights();
    expect(got.at(-1)).toBe(extra as unknown as THREE.Light);
    expect(got.at(-2)).toBe(probeLike as unknown as THREE.Light);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-list-node.test.ts`
Expected: FAIL — cannot resolve `./level-list-node`.

- [ ] **Step 3: Implement the node**

```ts
// src/lab/sdf-zombie/webgpu/level-list-node.ts
//
// THE CHEAP LEVEL TIER'S NODE (spec 2026-09-29-level-list-lighting-design.md). One per room, in that room's level
// `lightsNode`, next to three's shadowed lights and the room's ProbeLightingNode. It shades the room's cheap lights
// (level-tier.ts) straight out of the shared list's storage buffer, DIFFUSE ONLY: n.L x colour x three's falloff x cone.
// It adds into `reflectedLight.directDiffuse`, where three's own direct diffuse lands, scaled as three's Lambert
// (diffuseColor / PI), so fog, tone and everything downstream are unchanged.
//
// The picks are two vec4 uniforms holding up to 8 list indices (-1 = empty), written once a frame by writeLightList
// (game-light-list-leaves.ts). LEVEL_LIST_WGSL's CPU twin is level-tier.ts levelIrradiance: change one, change both.
import * as THREE from 'three/webgpu';
import { wgslFn, positionWorld, normalWorld, uniform, diffuseColor } from 'three/tsl';
import { LIGHT_VEC4S, LIST_LIGHTS_AT } from './light-list';
import { LEVEL_POINT_DECAY, LEVEL_SPOT_DECAY } from './level-tier';

/** The layout of one light record (light-list.ts packLightList): a = pos.xyz + kind (0 point, 1 spot, 2 directional),
 *  a1 = colour.rgb (physical: colour x intensity) + range, a2 = axis.xyz + packed cone. */
export const LEVEL_LIST_WGSL = /* wgsl */ `fn levelListIrradiance(p: vec3<f32>, n: vec3<f32>, picksA: vec4<f32>, picksB: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>) -> vec3<f32> {
  var picks = array<f32, 8>(picksA.x, picksA.y, picksA.z, picksA.w, picksB.x, picksB.y, picksB.z, picksB.w);
  var e = vec3<f32>(0.0, 0.0, 0.0);
  for (var k = 0; k < 8; k = k + 1) {
    let iv = picks[k];
    if (iv < 0.0) { continue; }
    let base = ${LIST_LIGHTS_AT} + i32(iv) * ${LIGHT_VEC4S};
    let a0 = (*lights)[base];
    let a1 = (*lights)[base + 1];
    let a2 = (*lights)[base + 2];
    let lv = a0.xyz - p;
    let d = max(length(lv), 0.0001);
    let L = lv / d;
    let isSpot = a0.w > 0.5 && a0.w < 1.5;
    let decay = select(${LEVEL_POINT_DECAY.toFixed(1)}, ${LEVEL_SPOT_DECAY.toFixed(1)}, isSpot);
    let cutoff = select(0.0, a1.w, isSpot);
    var att = 1.0 / max(pow(d, decay), 0.01);
    if (cutoff > 0.0) {
      let r = clamp(1.0 - pow(d / cutoff, 4.0), 0.0, 1.0);
      att = att * r * r;
    }
    var sp = 1.0;
    if (isSpot) {
      let cosOuter = floor(a2.w) / 1000.0;
      let cosInner = fract(a2.w) / 0.999;
      let t = clamp((-dot(L, a2.xyz) - cosOuter) / max(cosInner - cosOuter, 0.0001), 0.0, 1.0);
      sp = t * t * (3.0 - 2.0 * t);
    }
    e = e + a1.rgb * (max(dot(n, L), 0.0) * att * sp);
  }
  return e;
}`;

export class LevelListLightingNode extends THREE.LightingNode {
  static get type(): string { return 'LevelListLightingNode'; }
  readonly isLevelListLightingNode = true;
  readonly picksA = uniform(new THREE.Vector4(-1, -1, -1, -1));
  readonly picksB = uniform(new THREE.Vector4(-1, -1, -1, -1));
  private readonly evalNode = wgslFn(LEVEL_LIST_WGSL);
  private readonly listNode: unknown;

  /** `listNode`: the shared list's read-only storage node (LightListGpu.node), bound at construction. */
  constructor(listNode: unknown) {
    super();
    this.listNode = listNode;
  }

  /** Eight list indices (-1 = empty), as cheapLevelIndices writes them. */
  setPicks(idx: ArrayLike<number>): void {
    this.picksA.value.set(idx[0]!, idx[1]!, idx[2]!, idx[3]!);
    this.picksB.value.set(idx[4]!, idx[5]!, idx[6]!, idx[7]!);
  }

  override setup(builder: THREE.NodeBuilder): undefined {
    const e = this.evalNode(positionWorld, normalWorld, this.picksA, this.picksB, this.listNode as never);
    const ctx = (builder as unknown as { context: { reflectedLight: { directDiffuse: { addAssign(n: unknown): void } } } }).context;
    // three's BRDF_Lambert: irradiance x diffuseColor / PI.
    ctx.reflectedLight.directDiffuse.addAssign(e.mul(diffuseColor.rgb).mul(1 / Math.PI));
    return undefined;
  }
}
```

In `probe-lighting-node.ts` replace `levelLightsNode`:

```ts
export function levelLightsNode(sceneLights: readonly THREE.Light[], probe: ProbeLightingNode, extras: readonly THREE.LightingNode[] = []): THREE.LightsNode {
  return lights([...sceneLights, probe as unknown as THREE.Light, ...(extras as unknown as THREE.Light[])]);
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu/level-list-node.test.ts src/lab/sdf-zombie/webgpu/probe-lighting-node.test.ts`
Expected: no tsc output; PASS. If `diffuseColor` is not exported from `three/tsl` in this build, tsc says so: import it from `three/src/nodes/core/PropertyNode.js` the way the other deep imports in this repo do, or use `THREE.TSL.diffuseColor`.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-list-node.ts src/lab/sdf-zombie/webgpu/level-list-node.test.ts src/lab/sdf-zombie/webgpu/probe-lighting-node.ts
git commit -m "feat(level-list): LevelListLightingNode (diffuse-only, three's falloff) and levelLightsNode extras"
```

---

### Task 4: Wire it in behind `?levellist=1`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-state-lighting.ts` (near `levelProbeNodes`, lines ~48, 93, 120)
- Modify: `src/lab/sdf-zombie/webgpu/game-lighting-leaves.ts` (`levelSceneLights`, `refreshLevelLights`)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (accent loop ~line 819; level materials ~line 3154)
- Modify: `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts` (`writeLightList`)
- Modify: `src/lab/sdf-zombie/webgpu/game-seams-lighting-probes.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-state-lighting.test.ts` if one exists (it pins the state keys — run `ls src/lab/sdf-zombie/webgpu | grep game-state-lighting`); otherwise the wiring is verified in Step 6.

- [ ] **Step 1: State**

In `game-state-lighting.ts` add to the interface next to `levelProbeNodes`:

```ts
  /** The cheap level tier (spec 2026-09-29-level-list-lighting-design.md): `?levellist=1` with the list on. */
  levelListOn: boolean;
  /** One node per room while it is on; writeLightList feeds each its picks. */
  levelListNodes: Map<number, LevelListLightingNode>;
```

in the initial state (next to `levelProbeNodes: new Map...`):

```ts
    levelListOn: new URLSearchParams(location.search).get('levellist') === '1' && new URLSearchParams(location.search).get('lightlist') !== '0',
    levelListNodes: new Map<number, LevelListLightingNode>(),
```

and in the key-name table (next to `levelProbeNodes: 'lighting.levelProbeNodes',`):

```ts
  levelListOn: 'lighting.levelListOn',
  levelListNodes: 'lighting.levelListNodes',
```

with `import type { LevelListLightingNode } from './level-list-node';` at the top. Run `npx vitest run src/lab/sdf-zombie/webgpu/game-state` and update any pinned key list the test keeps.

- [ ] **Step 2: Drop cheap three lights from level materials when on**

In `game-lighting-leaves.ts` `levelSceneLights`, after the `if (l.userData.listOnly) return;` line add:

```ts
    // The cheap level tier (?levellist=1) shades this light through the list node instead.
    if (ctx.lighting.levelListOn && l.userData.levelCheap) return;
```

and in `refreshLevelLights` change the `setLights` call to keep the room's list node:

```ts
    const extra = ctx.lighting.levelListNodes.get(roomId);
    ctx.world.levelLightLists.get(roomId)?.setLights([...levelSceneLights(ctx, roomId), node as unknown as THREE.Light, ...(extra ? [extra as unknown as THREE.Light] : [])]);
```

- [ ] **Step 3: Tag the three lights and build one node per room**

In `game-main.ts`, in the accent loop right after the `if (a.fixture === 'tube') pl.userData.listOnly = true;` line, add:

```ts
      // The cheap level tier (level-tier.ts isLevelCheap): with ?levellist=1 the list node shades this light for the level.
      if (isLevelCheap({ fixture: a.fixture, mood: a.mood, shadow: a.shadow })) pl.userData.levelCheap = true;
```

Add `import { isLevelCheap } from './level-tier';` and `import { LevelListLightingNode } from './level-list-node';`. In the level-material block, inside the `for (const r of ctx.world.level.rooms)` loop, after `ctx.lighting.levelProbeNodes.set(r.id, node);` add:

```ts
      // The cheap level tier: one node per room, fed by writeLightList. The list exists already (createDynamicLight ran).
      if (ctx.lighting.levelListOn && ctx.world.light?.list) ctx.lighting.levelListNodes.set(r.id, new LevelListLightingNode(ctx.world.light.list.node));
```

and change the `levelLightsNode(` call to pass it:

```ts
    for (const [roomId, node] of ctx.lighting.levelProbeNodes) {
      const cheap = ctx.lighting.levelListNodes.get(roomId);
      ctx.world.levelLightLists.set(roomId, levelLightsNode(levelSceneLights(ctx, roomId), node, cheap ? [cheap] : []));
    }
```

- [ ] **Step 4: Feed the picks each frame**

In `game-light-list-leaves.ts` add imports `import { cheapLevelIndices, LEVEL_PICKS } from './level-tier';` and, above `writeLightList`, `const levelPicks = new Array<number>(LEVEL_PICKS).fill(-1);`. At the end of `writeLightList` (after `g.attr.needsUpdate = true;`) add:

```ts
  for (const [room, node] of ctx.lighting.levelListNodes) {
    cheapLevelIndices(g.list, room, levelPicks);
    node.setPicks(levelPicks);
  }
```

- [ ] **Step 5: A seam to read it**

In `game-seams-lighting-probes.ts`, inside the returned object next to `get levelProbes()`:

```ts
    /** The cheap level tier: on/off, and per room the list indices its node shades (-1 = empty). */
    get levelListInfo() {
      return {
        on: ctx.lighting.levelListOn,
        rooms: [...ctx.lighting.levelListNodes].map(([id, n]) => [id, [...n.picksA.value.toArray(), ...n.picksB.value.toArray()]]),
      };
    },
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: no tsc output; all PASS (default off, so nothing else moves).

Then boot it: `export LAB_TMP=.lab-tmp; source scripts/lab-servers.sh` is not needed — use the disco check's boot to prove the pipeline compiles with the node:

Run: `DISCO_QUERY="&levellist=1" DISCO_SKIP_COST=1 DISCO_SHEET=.lab-tmp/levellist-boot.png bash scripts/sdf-disco-check.sh 2>&1 | grep -E "PASS|FAIL|did not boot"`
Expected: `PASS sdf-disco-check`. If it fails with `Invalid PipelineLayout` or a WGSL error, read `.lab-tmp/lab-chrome-9367.log` for the first WGSL error (the trap is the shared storage node: the list node is bound in the march too; if three refuses to share it, give the level node its own `storage(attr, 'vec4', LIST_VEC4S).toReadOnly()` over `ctx.world.light.list.attr`).

Then read the seam: `DISCO_QUERY` cannot print it, so use the beacon-torch capture's pattern: add nothing; instead confirm in Task 5's script that `__sdfGame.levelListInfo` shows indices for room 5.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(level-list): wire the cheap tier behind ?levellist=1 (one node per room, picks each frame)"
```

---

### Task 5: Fidelity A/B — node vs three, same lights

The three side of the comparison needs the Boiler Room's second-row spots as real three lights. That is a temporary experiment flag, removed in Task 8.

**Files:**
- Modify (temporarily): `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts` (`makeTube`, the `if (!shadow) spot.userData.listOnly = true;` line)
- Create: `docs/dev-notes/2026-09-29-level-list/notes.md` (started here, finished in Task 8)

- [ ] **Step 1: Add the experiment flag**

In `makeTube`, change the line to:

```ts
  if (!shadow && new URLSearchParams(location.search).get('row2') !== 'three') spot.userData.listOnly = true;   // TEMP EXPERIMENT (level-list plan Task 5/6): ?row2=three lights the second row as three spots
```

Note the accent omnis stay list-only in both variants (only the spots differ).

- [ ] **Step 2: Capture the three variant twice (the noise floor) and the node variant**

```bash
export LAB_TMP=.lab-tmp; mkdir -p docs/dev-notes/2026-09-29-level-list
for v in three three node; do
  q="&row2=three"; [ $v = node ] && q="&levellist=1"
  n=$(ls .lab-tmp/ab-$v-*.png 2>/dev/null | wc -l)
  DISCO_QUERY="$q" DISCO_SKIP_COST=1 DISCO_SHEET=.lab-tmp/ab-$v-$n.png timeout 300 bash scripts/sdf-disco-check.sh 2>&1 | grep -E "PASS|FAIL"
done
ls .lab-tmp/ab-*.png
```

Expected: three `PASS` lines and `ab-three-0.png`, `ab-three-1.png`, `ab-node-0.png`.

- [ ] **Step 3: Compare**

```bash
python3 - <<'E'
from PIL import Image, ImageChops, ImageDraw
import statistics
def party(p):
    im = Image.open(p).convert('RGB'); w = im.size[0] // 3
    return im.crop((0, 28, w, im.size[1]))
t0, t1, nd = party('.lab-tmp/ab-three-0.png'), party('.lab-tmp/ab-three-1.png'), party('.lab-tmp/ab-node-0.png')
mean = lambda a, b: statistics.mean(ImageChops.difference(a, b).convert('L').get_flattened_data())
floor, ab = mean(t0, t1), mean(t0, nd)
print(f'noise floor (three vs three) {floor:.2f}   node vs three {ab:.2f}')
w = t0.size[0]
s = Image.new('RGB', (w * 3, t0.size[1]))
for i, (im, lab) in enumerate([(t0, 'three spots (second row)'), (nd, 'level list node'), (ImageChops.difference(t0, nd).point(lambda v: min(255, v * 6)), 'diff x6')]):
    s.paste(im, (i * w, 0)); ImageDraw.Draw(s).text((i * w + 8, 8), lab, fill=(255, 255, 0))
s.save('docs/dev-notes/2026-09-29-level-list/ab-node-vs-three.png')
print('PASS' if ab <= floor * 1.5 + 1.0 else 'FAIL: the node differs from three by more than the noise floor allows')
E
```

Expected: `PASS`. Read `docs/dev-notes/2026-09-29-level-list/ab-node-vs-three.png`; the walls under the second row should read alike (three has specular glints the node lacks; that is the accepted difference). If FAIL, the likely causes are, in order: the cone (compare `decodeCone`), the decay/cutoff (spot `distance` in `makeTube` is `drop * 2.2`, the list range must equal it), or the missing `levelGain`.

- [ ] **Step 4: Record and commit**

Write the two numbers and the sheet link into `docs/dev-notes/2026-09-29-level-list/notes.md` under `## Fidelity A/B`.

```bash
git add -A docs src
git commit -m "test(level-list): fidelity A/B, node vs three second-row spots (experiment flag row2=three)"
```

---

### Task 6: Cost spike and the go/no-go

Quiet machine only. `uptime` load must be < 4; close the owner's game tabs (`ps aux | grep -i chrome | awk '{s+=$3} END {print s}'` should be well under 100).

- [ ] **Step 1: Measure three variants, alternating, twice**

A = baseline (the second row is invisible to the level), B = `?levellist=1` (the node shades it), C = `?row2=three` (three shades it).

```bash
export LAB_TMP=.lab-tmp
for round in 1 2; do
  for v in A B C; do
    q=""; [ $v = B ] && q="&levellist=1"; [ $v = C ] && q="&row2=three"
    LIGHT_GATE_COST_QUERY="$q" LIGHT_GATE_ONLY_COST=1 LIGHT_GATE_COST_REPORT_ONLY=1 LIGHT_GATE_COST_JSON=.lab-tmp/lvl-$v-$round.json bash scripts/sdf-game-light-gate.sh > /dev/null 2>&1
    python3 - <<E
import json, os
d = json.load(open('.lab-tmp/lvl-$v-$round.json'))
print('$v $round', {r['name']: (round(r['off'], 1), round(r['gpuOff'], 1)) for r in d['out']}, 'load %.1f' % os.getloadavg()[0])
E
  done
done
```

Expected: six lines. Discard the whole session if any shows load > 4.5; rerun.

- [ ] **Step 2: Apply the decision rule**

```bash
python3 - <<'E'
import json, statistics
def boiler(v, r):
    d = json.load(open(f'.lab-tmp/lvl-{v}-{r}.json'))
    x = next(x for x in d['out'] if x['name'] == 'Boiler Room')
    return x['off'], x['gpuOff']
res = {v: [boiler(v, r) for r in (1, 2)] for v in 'ABC'}
med = lambda v, i: statistics.mean(res[v][r][i] for r in (0, 1))
for i, name in ((0, 'frame ms'), (1, 'GPU ms')):
    a, b, c = med('A', i), med('B', i), med('C', i)
    per_three, per_node = (c - a) / 4, (b - a) / 4
    print(f'{name}: A {a:.2f}  node(B) {b:.2f}  three(C) {c:.2f}   per light: three {per_three:.2f}  node {per_node:.2f}')
a, b, c = med('A', 1), med('B', 1), med('C', 1)
ok = (c - a) > 1.0 and (b - a) <= 0.5 * (c - a)
print('GO: the node is at least 2x cheaper per light than three' if ok else 'NO-GO: stop, report, do Task 8 no-go')
E
```

Expected: a `GO` or `NO-GO` line. The rule needs `(C − A) > 1.0` GPU ms (three's four spots must cost something measurable) and `(B − A) ≤ 0.5 × (C − A)`.

- [ ] **Step 3: Record and commit**

Write the table and the verdict into `docs/dev-notes/2026-09-29-level-list/notes.md` under `## Cost spike`.

```bash
git add -A docs
git commit -m "test(level-list): cost spike numbers and the go/no-go verdict"
```

**If NO-GO: skip Task 7, do Task 8's no-go branch, and report the numbers to the owner.**

---

### Task 7: (GO only) Give the second row its level light back, and judge the look

**Files:** none new; this is a measured decision with the owner.

- [ ] **Step 1: Boiler Room frame cost and the look with the node lighting the second row**

Costs come from Task 6's B versus A. Capture the sheet:

```bash
export LAB_TMP=.lab-tmp
DISCO_QUERY="&levellist=1" DISCO_SKIP_COST=1 DISCO_SHEET=docs/dev-notes/2026-09-29-level-list/party-levellist.png bash scripts/sdf-disco-check.sh 2>&1 | grep -E "PASS|FAIL"
DISCO_SKIP_COST=1 DISCO_SHEET=docs/dev-notes/2026-09-29-level-list/party-default.png bash scripts/sdf-disco-check.sh 2>&1 | grep -E "PASS|FAIL"
```

Expected: two `PASS` lines. Read both sheets; the side walls should read lit with `levellist=1`.

- [ ] **Step 2: Run the gates that must not move, with the flag on and off**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-train-gate.sh 2>&1 | grep -E "^(ok|FAIL|PASS)"
bash scripts/sdf-game-light-gate.sh 2>&1 | grep -E "^(FAIL|PASS)"
```

Expected: `PASS` from both, default (flag off). Then the same with the flag: `LIGHT_GATE_COST_QUERY="&levellist=1"` only affects the cost section, so for the rest boot manually — it is enough to report the light gate's cost section (`LIGHT_GATE_ONLY_COST=1 LIGHT_GATE_COST_QUERY="&levellist=1"`) and the disco check passing.

- [ ] **Step 3: Ask the owner** whether `?levellist=1` becomes the default (it changes the level lighting model for fire lights and the second row: diffuse-only, no glints) and whether to move any further lights onto it. Do not flip the default without the answer.

- [ ] **Step 4: Commit the sheets**

```bash
git add -A docs
git commit -m "docs(level-list): party sheets with and without the cheap tier"
```

---

### Task 8: Clean up and record

- [ ] **Step 1: Remove the experiment flag**

In `makeTube` restore the line to `if (!shadow) spot.userData.listOnly = true;   // a secondary tube: list + probe only, no level-material light (game-main)`.

- [ ] **Step 2: Finish the notes**

Complete `docs/dev-notes/2026-09-29-level-list/notes.md`: what was built, the A/B numbers, the cost table, the verdict, how to run it (`?levellist=1`), and the follow-ups (which lights could move next, whether the shadowed tubes need the atlas). In `docs/dev-notes/2026-09-28-light-layers/optimisation-strategies.md` add the verdict under the MEASURED section. In `TASKS.md` update the optimisation line ("Left: level materials on the shared list") with the outcome, and in `docs/dev-notes/2026-09-29-handoff.md` add one bullet.

**No-go branch:** also state plainly that `?levellist=1` ships off, that the code stays behind the flag unused (or delete it in a separate commit if the owner prefers), and that the ~3 ms of tube spots per carriage is not recoverable without the shadow atlas.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/`
Expected: no tsc output; all PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(level-list): notes, verdict and follow-ups; remove the row2 experiment flag"
```

---

## Self-review

**Spec coverage.** §2 goal → Tasks 3–4 (the node), Task 6 (the measured win). §3.1 diffuse-only → Task 3 WGSL (no specular; test pins no `pow(max(dot(n, H)`). §3.2 cheap tier → Task 1 `isLevelCheap`, Task 2 lamp flag. §3.3 list is source of truth, record unchanged → Task 3 reads the existing layout; no `packLightList` change. §3.4 no 4-pick cap, 8 slots → `LEVEL_PICKS`, Task 4 Step 4. §3.5 falloff matches three's → Task 1 twins + Task 3 WGSL + Task 5 A/B. §3.6 behind `?levellist=1` → Task 4 Step 1. §3.7 spike first / 2× rule → Task 6 Step 2. §5 error handling (empty room, list-off, dropped light) → Task 1 test "empty list clears", Task 4 Step 1 (`lightlist=0` disables), `levelListInfo` seam. §6 testing → Tasks 1, 3 (pure + node), 5 (A/B), 6 (cost).

**Placeholders.** None: every code step carries its code; the two conditional notes (`diffuseColor` import, shared storage node) name the exact fallback.

**Type consistency.** `levelCheap` (LightSource, ListLight, LampInput, Lamp), `isLevelCheap`, `LEVEL_PICKS`, `cheapLevelIndices(list, room, out)`, `LevelListLightingNode.setPicks(idx)`, `picksA`/`picksB`, `levelLightsNode(scene, probe, extras)`, `ctx.lighting.levelListOn` / `levelListNodes`, `levelListInfo` — used identically across tasks.
