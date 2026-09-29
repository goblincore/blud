# Melee Head Damage Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A flail hit to a zombie's head squashes it like jelly and leaves a lasting dent. Head hits climb a
four-stage ladder:
1. An eye pops out and dangles on a stalk.
2. The face caves in and the eye snaps off.
3. The scalp tears to show the skull.
4. The brain flies out and the zombie dies.

**Architecture:**
- The logic lives in pure modules under `src/lab/sdf-zombie/`: `head-damage.ts` (the ladder), `head-deform.ts`
  (the wobble and dents), `head-eye.ts` (the eye and its stalk rope) and `head-crown.ts` (the crown, the
  brain and the skull chips). A small wound-ring rule in `damage.ts` keeps head craters from evicting body
  wounds.
- The game leaf `webgpu/game-head-damage.ts` owns each zombie's state and does the rest:
  - it deforms the head through a new actor hook, `setHeadDeform`;
  - it draws the dangling eye as a hand-posed chunk view (a new `ChunkGpuView.morph` and a boot hook
    `attachPiece`);
  - it dispatches gore through the existing `onGoreDispatch`;
  - it kills through a new `ActorBlastEffect.forceCollapse`.
- `game-flail.ts strike()` hands head-region hits to the leaf.

**Tech Stack:** TypeScript, Three.js WebGPU, vitest, headless Chrome gates driven over CDP.

**Spec:** `docs/superpowers/specs/2026-09-28-melee-head-damage-design.md`. Branch
`claude/melee-weapon-design-7d1423`, PR goblincore/blud#22.

---

## Rules for every task

- **Port-ready by construction** (the release is a Rust + wgpu port):
  - Game logic lives in **pure, renderer-free modules with their own tests** (no `three` import; plain data
    in and out). The renderer-facing leaf only reads that output and writes objects.
  - State lives on `ctx` (a `GameContext` slice) or inside a feature module, never as new `main()`
    bindings.
- Work ONLY in this worktree (`/Users/donny/Projects/blud/.claude/worktrees/melee-weapon-design-7d1423`).
  Never `git stash` or `git reset`. Stage only your files (`git add <paths>`, never `-A`), and commit with
  an explicit pathspec. Commit messages end with a `Co-Authored-By:` line naming your model.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never the bare full suite.
- **Headless capture only.** Start vite and Chrome with `scripts/lab-servers.sh`, sourced from **bash**:
  `bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down
  EXIT; lab_servers_up >/dev/null 2>&1; node <script> 5241 9241'`. **Port 5190 is the owner's dev
  server: never touch it.**
- Start every new file with its path header comment (`// src/…/file.ts`, then `//`).
- **Free aim is on by default.** The reticle drifts, so aim rays use `aimDir` (already wired into the flail).
- **Prove visual claims with a number** and look at every image you make.

## Decisions this plan makes (spec §12 and the details it left open)

1. **Dents flatten a side of the head, not a point.** The zombie's head is a few large ellipsoid prims, so
   moving the endpoints of the prims near the hit would slide the whole head, not dent it.
   - A dent flattens the **hit side** along the head axis nearest the blow: that surface moves in by the
     dent depth, and the opposite side stays put.
   - Depth accumulates per side (x±, y±, z±), capped at 0.04 m.
   - The wobble's squash works on the same axes.
   - The spec's §5 is amended to match.
2. **The stalk is its own small rope** (`head-eye.ts`). The flail's `flail-chain.ts` is hard-wired to the
   flail (its node count and link lengths are constants), so it is not reused.
3. **The dangling eye is one chunk view posed by hand.** The view is created outside `liveChunks` (so no
   physics and no bake) through a boot hook, `ctx.boot.attachPiece`, and bent each frame with a new
   `ChunkGpuView.morph(ends)`. `apply()` already rewrites every prim's endpoints from its local copy each
   frame, so this costs no re-pack. One extra draw per dangling eye.
4. **Head crater slots** go in `damage.ts pushWound`:
   - wounds tagged `headSlot: 'keep' | 'face'` count toward `MAX_HEAD_WOUNDS` (5);
   - a 6th head crater evicts the oldest `'face'` one first;
   - the total-cap eviction skips `'keep'` wounds.

   The socket, the scalp craters and the brain cavity are `'keep'`; the dent's crater and later face
   craters are `'face'`. Rings without head tags behave exactly as before.
5. **The stalk colour is a new key, `GORE_COLORS.stalk`.** `GORE_COLORS.nerve` already exists as a dark red.
6. **The eye positions are the painted eyes' centroids,** measured from `zombie-face.png` (luma ≥ 0.9)
   through the face sheet's planar projection (`faceProj 0.45, 0.58, 0.5, 0.56`, forward +1):
   - image-left eye: `hs = (−0.498, +0.096)`;
   - image-right eye: `hs = (+0.451, +0.179)`.

   `hs` is the head-rest position divided by `headAxes`. The eye's surface point is found by tracing from
   in front of the face toward the head centre.

---

### Task 1: The head-crater slots (`damage.ts`, pure)

**Files:** modify `src/lab/sdf-zombie/damage.ts`, test `src/lab/sdf-zombie/damage.test.ts` (add a describe;
if the file does not exist, create `src/lab/sdf-zombie/damage-head-slots.test.ts`).

- [ ] **Step 1: Failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { MAX_HEAD_WOUNDS, MAX_WOUNDS, pushWound, type Wound } from './damage';

const w = (id: number, headSlot?: 'keep' | 'face'): Wound =>
  ({ primIdx: 0, local: [0, 0, 0], radius: 0.05, type: 'blast', ageSec: 0, eventId: id, ...(headSlot ? { headSlot } : {}) });

describe('head crater slots', () => {
  it('rings without head tags evict oldest-first exactly as before', () => {
    let ring: Wound[] = [];
    for (let i = 1; i <= MAX_WOUNDS + 3; i++) ring = pushWound(ring, w(i), MAX_WOUNDS);
    expect(ring.map(x => x.eventId)).toEqual(Array.from({ length: MAX_WOUNDS }, (_, k) => k + 4));
  });
  it('a 6th head crater evicts the oldest face crater, never a body wound', () => {
    let ring: Wound[] = [w(1), w(2)];                         // body
    ring = pushWound(ring, w(3, 'keep'), MAX_WOUNDS);        // socket
    ring = pushWound(ring, w(4, 'face'), MAX_WOUNDS);        // cave
    ring = pushWound(ring, w(5, 'keep'), MAX_WOUNDS);        // scalp
    ring = pushWound(ring, w(6, 'keep'), MAX_WOUNDS);        // scalp
    ring = pushWound(ring, w(7, 'keep'), MAX_WOUNDS);        // brain → 5 head
    expect(ring.filter(x => x.headSlot).length).toBe(MAX_HEAD_WOUNDS);
    ring = pushWound(ring, w(8, 'face'), MAX_WOUNDS);        // a later face crater
    expect(ring.map(x => x.eventId)).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });
  it('with only keep craters left, the oldest head crater goes', () => {
    let ring: Wound[] = [];
    for (let i = 1; i <= MAX_HEAD_WOUNDS + 1; i++) ring = pushWound(ring, w(i, 'keep'), MAX_WOUNDS);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4, 5, 6]);
  });
  it('the total cap never evicts a keep crater while a non-keep wound remains', () => {
    let ring: Wound[] = [w(100, 'keep')];
    for (let i = 1; i <= MAX_WOUNDS; i++) ring = pushWound(ring, w(i), MAX_WOUNDS);
    expect(ring.length).toBe(MAX_WOUNDS);
    expect(ring.some(x => x.eventId === 100)).toBe(true);
  });
});
```

  Run `npm test -- damage-head-slots` (or `damage`), expect FAIL (`MAX_HEAD_WOUNDS` not exported).
- [ ] **Step 2: Implement.** In `damage.ts`:
  - add to `Wound`: `/** Head damage model (head-damage.ts): the head keeps at most MAX_HEAD_WOUNDS craters of its own; 'keep' craters (the eye socket, the scalp, the brain) outlive 'face' ones and survive the total cap. */ headSlot?: 'keep' | 'face';`
  - replace `pushWound`:

```ts
/** Head craters (Wound.headSlot) a body keeps at most — melee head damage, head-damage.ts. */
export const MAX_HEAD_WOUNDS = 5;

/** Ring buffer append. Head craters keep their own MAX_HEAD_WOUNDS slots (oldest 'face' crater evicted
 *  first), and the total cap evicts the oldest wound that is not a 'keep' head crater. A ring with no
 *  head tags evicts oldest-first, exactly as before. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  const next = [...ring, wound];
  if (wound.headSlot) {
    const head = next.filter(x => x.headSlot);
    if (head.length > MAX_HEAD_WOUNDS) {
      const victim = head.find(x => x.headSlot === 'face') ?? head[0]!;
      next.splice(next.indexOf(victim), 1);
    }
  }
  while (next.length > cap) {
    const i = next.findIndex(x => x.headSlot !== 'keep');
    next.splice(i < 0 ? 0 : i, 1);
  }
  return next;
}
```

- [ ] **Step 3:** Run `npm test -- damage character-view game-actor`, then `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 4: Commit:** `feat(damage): head craters keep their own slots (MAX_HEAD_WOUNDS)`.

### Task 2: The ladder (`head-damage.ts`, pure)

**Files:** create `src/lab/sdf-zombie/head-damage.ts`, `src/lab/sdf-zombie/head-damage.test.ts`.

- [ ] **Step 1: Failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { headDeath, headHit, makeHeadDamage, type HeadEvent } from './head-damage';

const kinds = (ev: HeadEvent[]) => ev.map(e => e.kind);
const HIT_L = { eyeSide: 'L' as const };
const HIT_R = { eyeSide: 'R' as const };

describe('head damage ladder', () => {
  it('runs eye → cave (+snap) → scalp → brain (+kill)', () => {
    let s = makeHeadDamage();
    let r = headHit(s, HIT_R); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'eye-pop']);
    expect(r.events.find(e => e.kind === 'eye-pop')).toMatchObject({ side: 'R' });
    expect(s.eye).toEqual({ side: 'R', state: 'dangling' });
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'dent', 'face-crater', 'eye-snap']);
    expect(s.eye).toEqual({ side: 'R', state: 'gone' });
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'scalp']);
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'brain', 'kill']);
    expect(s.dead).toBe(true);
  });
  it('hits past the 4th only wobble, dent and crater the face', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 4; i++) s = headHit(s, HIT_L).state;
    const r = headHit(s, HIT_R);
    expect(kinds(r.events)).toEqual(['wobble', 'dent', 'face-crater']);
    expect(r.state.hits).toBe(5);
  });
  it('the eye that pops is the one on the hit side', () => {
    const r = headHit(makeHeadDamage(), HIT_L);
    expect(r.events.find(e => e.kind === 'eye-pop')).toMatchObject({ side: 'L' });
  });
  it('a dangling eye snaps when the zombie dies another way', () => {
    let s = headHit(makeHeadDamage(), HIT_L).state;
    const r = headDeath(s);
    expect(kinds(r.events)).toEqual(['eye-snap']);
    expect(r.state.eye?.state).toBe('gone');
    expect(kinds(headDeath(r.state).events)).toEqual([]);
  });
});
```

  Run `npm test -- head-damage`, expect FAIL.
- [ ] **Step 2: Implement.**

```ts
// src/lab/sdf-zombie/head-damage.ts
//
// THE MELEE HEAD DAMAGE LADDER (spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §4).
// Pure: a head hit in, events out. The leaf (webgpu/game-head-damage.ts) turns events into wounds,
// deformation, the dangling eye, gore and the kill. Every head hit wobbles; then by count:
//   1 EYE    the eye on the hit side pops and dangles on its stalk
//   2 CAVE   a lasting dent and a face crater; the dangling eye snaps off
//   3 SCALP  the crown tears open to the skull
//   4 BRAIN  the crown bursts, the brain flies out, the zombie dies
//   5+       dent and face crater only
export type EyeSide = 'L' | 'R';

export interface HeadDamageState {
  hits: number;
  eye: { side: EyeSide; state: 'dangling' | 'gone' } | null;
  dead: boolean;
}

export type HeadEvent =
  | { kind: 'wobble' }
  | { kind: 'eye-pop'; side: EyeSide }
  | { kind: 'eye-snap' }
  | { kind: 'dent' }
  | { kind: 'face-crater' }
  | { kind: 'scalp' }
  | { kind: 'brain' }
  | { kind: 'kill' };

export function makeHeadDamage(): HeadDamageState {
  return { hits: 0, eye: null, dead: false };
}

/** One head-region hit. `eyeSide`: the eye nearer the hit point (the leaf measures it). */
export function headHit(s: HeadDamageState, hit: { eyeSide: EyeSide }): { state: HeadDamageState; events: HeadEvent[] } {
  const hits = s.hits + 1;
  const events: HeadEvent[] = [{ kind: 'wobble' }];
  let eye = s.eye, dead = s.dead;
  if (hits === 1) {
    events.push({ kind: 'eye-pop', side: hit.eyeSide });
    eye = { side: hit.eyeSide, state: 'dangling' };
  } else if (hits === 2) {
    events.push({ kind: 'dent' }, { kind: 'face-crater' });
    if (eye?.state === 'dangling') { events.push({ kind: 'eye-snap' }); eye = { ...eye, state: 'gone' }; }
  } else if (hits === 3) {
    events.push({ kind: 'scalp' });
  } else if (hits === 4) {
    events.push({ kind: 'brain' }, { kind: 'kill' });
    dead = true;
  } else {
    events.push({ kind: 'dent' }, { kind: 'face-crater' });
  }
  return { state: { hits, eye, dead }, events };
}

/** The zombie died some other way (collapse, dynamite): a dangling eye snaps off. */
export function headDeath(s: HeadDamageState): { state: HeadDamageState; events: HeadEvent[] } {
  if (s.eye?.state !== 'dangling') return { state: s, events: [] };
  return { state: { ...s, eye: { ...s.eye, state: 'gone' } }, events: [{ kind: 'eye-snap' }] };
}
```

- [ ] **Step 3:** `npm test -- head-damage`, then `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 4: Commit:** `feat(head-damage): the ladder — eye, cave, scalp, brain`.

### Task 3: Wobble and dents (`head-deform.ts`, pure)

**Files:** create `src/lab/sdf-zombie/head-deform.ts`, `src/lab/sdf-zombie/head-deform.test.ts`.

The head frame is `{ centre: Vec3; quat: Quat /* xyzw, head rest → world */; axes: Vec3 /* half-extents along the head's x, y, z */ }`.
- `x` is the head's right and `y` its up.
- `z` is the face's forward (the face sheet projects along +z, `faceCfg.z` = +1).

- [ ] **Step 1: Failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { HEAD_DEFORM, addDent, deformHead, kickWobble, makeHeadDeform, stepWobble, wobbleValue, type HeadFrame } from './head-deform';
import type { Primitive } from './types';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
const headPrim = (): Primitive => ({ limb: 'head', op: 'union', a: [0, 1.6, 0], b: [0, 1.6, 0], radius: 0.1,
  scale: [0.9, 1.1, 1.0], blendK: 0.01 } as unknown as Primitive);
const torsoPrim = (): Primitive => ({ limb: 'torso', op: 'union', a: [0, 1.2, 0], b: [0, 1.4, 0], radius: 0.15,
  scale: [1, 1, 1], blendK: 0.02 } as unknown as Primitive);
/** Extent of an ellipsoid prim (a === b) along world x. */
const xExtent = (p: Primitive) => [p.a[0] - p.radius * p.scale[0], p.a[0] + p.radius * p.scale[0]];

describe('head wobble', () => {
  it('kicks to squash0, rings at ~8 Hz and settles below 1% within 0.8 s', () => {
    let s = kickWobble(makeHeadDeform(), [1, 0, 0]);
    expect(wobbleValue(s)).toBeCloseTo(HEAD_DEFORM.squash0, 9);
    let crossings = 0, prev = wobbleValue(s);
    for (let t = 0; t < 0.8; t += 1 / 240) {
      s = stepWobble(s, 1 / 240);
      const v = wobbleValue(s);
      if (Math.sign(v) !== Math.sign(prev) && prev !== 0) crossings++;
      prev = v;
    }
    expect(crossings).toBeGreaterThanOrEqual(4);                   // it rings (underdamped)
    expect(Math.abs(wobbleValue(s))).toBeLessThan(0.0025);   // settled: < 1% of the head's size
  });
  it('clamps to ±maxSquash', () => {
    let s = kickWobble(kickWobble(makeHeadDeform(), [1, 0, 0]), [1, 0, 0]);
    expect(Math.abs(wobbleValue(s))).toBeLessThanOrEqual(HEAD_DEFORM.maxSquash);
  });
});

describe('deformHead', () => {
  it('leaves non-head prims identical (the same objects)', () => {
    const body = { prims: [torsoPrim(), headPrim()] };
    const out = deformHead(body, kickWobble(makeHeadDeform(), [1, 0, 0]), frame);
    expect(out.prims[0]).toBe(body.prims[0]);
  });
  it('a squash along x shortens the head along x and widens it across', () => {
    const body = { prims: [headPrim()] };
    const out = deformHead(body, kickWobble(makeHeadDeform(), [1, 0, 0]), frame).prims[0]!;
    expect(out.scale[0]).toBeLessThan(body.prims[0]!.scale[0]);
    expect(out.scale[1]).toBeGreaterThan(body.prims[0]!.scale[1]);
    expect(out.scale[2]).toBeGreaterThan(body.prims[0]!.scale[2]);
  });
  it('a dent from a blow travelling +x flattens the −x side and leaves the +x side put', () => {
    const body = { prims: [headPrim()] };
    const s = addDent(makeHeadDeform(), [1, 0, 0], 0.018, frame.axes);
    const [lo0, hi0] = xExtent(body.prims[0]!);
    const [lo1, hi1] = xExtent(deformHead(body, s, frame).prims[0]!);
    expect(lo1 - lo0).toBeCloseTo(0.018, 4);
    expect(hi1).toBeCloseTo(hi0, 4);
  });
  it('dents on the same side accumulate and cap at maxDent', () => {
    let s = makeHeadDeform();
    for (let i = 0; i < 5; i++) s = addDent(s, [1, 0, 0], 0.018, frame.axes);
    expect(s.flat[1]).toBeCloseTo(HEAD_DEFORM.maxDent, 9);   // index 1 = the −x side
  });
  it('a head turned 90° about y dents along the head axis, not the world axis', () => {
    const turned: HeadFrame = { ...frame, quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };  // head +x → world −z
    const body = { prims: [headPrim()] };
    const s = addDent(makeHeadDeform(), [1, 0, 0], 0.018, turned.axes);   // blow along the HEAD's +x
    const out = deformHead(body, s, turned).prims[0]!;
    expect(out.a[2]).toBeCloseTo(body.prims[0]!.a[2] - 0.009, 4);   // centre shifts half the depth along head +x = world −z
  });
});
```

  Run `npm test -- head-deform`, expect FAIL.
- [ ] **Step 2: Implement.**

```ts
// src/lab/sdf-zombie/head-deform.ts
//
// HEAD WOBBLE AND DENTS (spec §5; the plan's decision 1). Pure. The zombie's head is a few large ellipsoid
// prims, so deformation works along the HEAD's own axes (x right, y up, z face-forward):
//   * WOBBLE — a damped spring s(t) along the head axis nearest the blow: that axis scales by (1 − s),
//     the other two by (1 + s/2). Kicked to squash0 on a hit, rings at hz, settles in ~0.5 s.
//   * DENTS — a lasting flattening of the HIT side along the head axis nearest the blow: that side's
//     surface moves in by the dent depth and the opposite side stays put (the prims shift half the depth
//     inward and shrink half the depth along the axis). Per side (x+, x−, y+, y−, z+, z−), capped.
// Applied to the posed head prims each frame by the leaf (after applyRig, like head-pop.ts inflateHead).
// Approximation: a prim's per-axis `scale` is taken to lie along the head axes (true for the zombie's
// skull-bound head prims).
import type { Primitive, Vec3 } from './types';

export type Quat = [number, number, number, number];
export interface HeadFrame { centre: Vec3; quat: Quat; axes: Vec3 }

export const HEAD_DEFORM = {
  squash0: 0.25,
  maxSquash: 0.3,
  hz: 8,
  zeta: 0.25,
  maxDent: 0.04,
} as const;

export interface HeadDeformState {
  /** Wobble displacement and velocity (s, ds/dt). */
  s: number;
  v: number;
  /** The wobble's head axis (0 x, 1 y, 2 z). */
  axis: 0 | 1 | 2;
  /** Dent depth per side, metres: [x+, x−, y+, y−, z+, z−]. */
  flat: [number, number, number, number, number, number];
}

export function makeHeadDeform(): HeadDeformState {
  return { s: 0, v: 0, axis: 0, flat: [0, 0, 0, 0, 0, 0] };
}

const argmaxAbs = (d: Vec3): 0 | 1 | 2 => {
  const a = Math.abs(d[0]), b = Math.abs(d[1]), c = Math.abs(d[2]);
  return a >= b && a >= c ? 0 : b >= c ? 1 : 2;
};

/** A hit's wobble. `dirLocal`: the blow's direction in head coordinates. */
export function kickWobble(st: HeadDeformState, dirLocal: Vec3): HeadDeformState {
  const s = Math.min(HEAD_DEFORM.maxSquash, Math.max(-HEAD_DEFORM.maxSquash, st.s + HEAD_DEFORM.squash0));
  return { ...st, s, v: 0, axis: argmaxAbs(dirLocal) };
}

/** Advance the spring (semi-implicit Euler; call with dt ≤ 1/60, sub-stepped inside). */
export function stepWobble(st: HeadDeformState, dt: number): HeadDeformState {
  const w = 2 * Math.PI * HEAD_DEFORM.hz, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
  let { s, v } = st;
  for (let i = 0; i < n; i++) { v += (-w * w * s - 2 * HEAD_DEFORM.zeta * w * v) * h; s += v * h; }
  return { ...st, s: Math.min(HEAD_DEFORM.maxSquash, Math.max(-HEAD_DEFORM.maxSquash, s)), v };
}

export const wobbleValue = (st: HeadDeformState): number => st.s;

/** A lasting dent: the blow travelling along `dirLocal` flattens the side it came from. */
export function addDent(st: HeadDeformState, dirLocal: Vec3, depth: number, _axes: Vec3): HeadDeformState {
  const k = argmaxAbs(dirLocal);
  const side = dirLocal[k] > 0 ? 2 * k + 1 : 2 * k;   // a +x blow hits the −x side (index 1)
  const flat = [...st.flat] as HeadDeformState['flat'];
  flat[side] = Math.min(HEAD_DEFORM.maxDent, flat[side]! + depth);
  return { ...st, flat };
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

const isHeadFlesh = (p: Primitive) => p.limb === 'head' && !p.dead && p.op !== 'sub' && p.op !== 'groove'
  && p.op !== 'bone' && p.op !== 'organ';

/** The posed body with its head wobbled and dented. Non-head prims are returned as the same objects. */
export function deformHead<B extends { prims: Primitive[] }>(body: B, st: HeadDeformState, f: HeadFrame): B {
  const e: [Vec3, Vec3, Vec3] = [rotate(f.quat, [1, 0, 0]), rotate(f.quat, [0, 1, 0]), rotate(f.quat, [0, 0, 1])];
  const mul: Vec3 = [1, 1, 1], shift: Vec3 = [0, 0, 0];
  for (const k of [0, 1, 2] as const) {
    const plus = st.flat[2 * k]!, minus = st.flat[2 * k + 1]!;
    mul[k] = 1 - (plus + minus) / (2 * f.axes[k]);
    shift[k] = (minus - plus) / 2;           // the −side dented → the prims move toward +
  }
  const s = st.s;
  for (const k of [0, 1, 2] as const) mul[k] *= k === st.axis ? 1 - s : 1 + s / 2;
  if (s === 0 && st.flat.every(x => x === 0)) return body;
  const map = (p: Vec3): Vec3 => {
    const v: Vec3 = [p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]];
    const out: Vec3 = [...f.centre] as Vec3;
    for (const k of [0, 1, 2] as const) {
      const c = (v[0] * e[k][0] + v[1] * e[k][1] + v[2] * e[k][2]) * mul[k] + shift[k];
      out[0] += e[k][0] * c; out[1] += e[k][1] * c; out[2] += e[k][2] * c;
    }
    return out;
  };
  return {
    ...body,
    prims: body.prims.map(p => (isHeadFlesh(p)
      ? { ...p, a: map(p.a), b: map(p.b), scale: [p.scale[0] * mul[0], p.scale[1] * mul[1], p.scale[2] * mul[2]] as Vec3 }
      : p)),
  };
}
```

  - Check `Primitive.op`'s union in `types.ts`, and drop any op names it does not have.
  - The last test's arithmetic: the head's +x maps to world −z; the −x side is dented by 0.018, so the prims
    shift +0.009 along the head's x, which is world −z.
- [ ] **Step 3:** `npm test -- head-deform`, `npx tsc --noEmit`, expect PASS.
- [ ] **Step 4: Commit:** `feat(head-deform): jelly wobble and lasting dents along the head axes`.

### Task 4: Eye, stalk, crown, brain (`head-eye.ts`, `head-crown.ts`, pure) and the shared eyeball recipe

**Files:**
- create `src/lab/sdf-zombie/head-eye.ts`, `head-eye.test.ts`, `head-crown.ts`, `head-crown.test.ts`;
- modify `src/lab/sdf-zombie/head-pop.ts` (export the eyeball recipe, add `GORE_COLORS.stalk`) and keep
  `head-pop.test.ts` green.

- [ ] **Step 1: Share the eyeball.** In `head-pop.ts`, move the eyeball prims that `headPopDebris` builds
  inline (white, iris, pupil and nerve) into an export. The function takes the eye's centre, its look
  direction and the iris colour, and returns the prims, **exactly** as `headPopDebris` builds them today:

```ts
/** One cartoon eyeball (2.5x life): white, glowing iris, pupil, and a short nerve stub behind it. */
export function eyeballPrims(centre: Vec3, look: Vec3, iris: Vec3, withNerve = true): Primitive[]
```

  Call it from `headPopDebris` so its output is unchanged. `head-pop.test.ts` must pass untouched. Add
  `stalk: [0.85, 0.45, 0.52]` to `GORE_COLORS`: the pink, glossy optic-nerve stalk. `nerve` stays the dark
  red it is.
- [ ] **Step 2: Failing tests: `head-eye.test.ts`.**

```ts
import { describe, expect, it } from 'vitest';
import { EYE_STALK, HEAD_EYES, eyeRayStart, makeStalk, nearerEye, stalkPrims, stepStalk } from './head-eye';
import type { HeadFrame } from './head-deform';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('eyes', () => {
  it('the face-sheet eye centroids sit left and right of the face, above the head centre', () => {
    const L = eyeRayStart(frame, 'L'), R = eyeRayStart(frame, 'R');
    expect(L[0]).toBeLessThan(frame.centre[0]); expect(R[0]).toBeGreaterThan(frame.centre[0]);
    expect(L[1]).toBeGreaterThan(frame.centre[1]); expect(R[1]).toBeGreaterThan(frame.centre[1]);
    expect(L[2]).toBeGreaterThan(frame.centre[2] + frame.axes[2]);   // starts in front of the face
    expect(HEAD_EYES.zombie.L[0]).toBeCloseTo(-0.498, 3);
  });
  it('picks the eye nearer the hit', () => {
    expect(nearerEye(frame, [-0.05, 1.62, 0.1])).toBe('L');
    expect(nearerEye(frame, [0.06, 1.6, 0.1])).toBe('R');
  });
});

describe('the stalk rope', () => {
  const socket: [number, number, number] = [0, 1.62, 0.1];
  it('pins node 0 on the socket and holds every link at its length', () => {
    let s = makeStalk(socket, [0, 0, 1], 2.5);
    for (let i = 0; i < 120; i++) {
      s = stepStalk(s, [socket[0] + 0.1 * Math.sin(i / 10), socket[1], socket[2]], 1 / 60);
      expect(d(s.p[0]!, [socket[0] + 0.1 * Math.sin(i / 10), socket[1], socket[2]])).toBeLessThan(1e-9);
      for (let k = 0; k < EYE_STALK.nodes - 1; k++) expect(d(s.p[k]!, s.p[k + 1]!)).toBeCloseTo(EYE_STALK.len / (EYE_STALK.nodes - 1), 6);
    }
  });
  it('springs out along the kick, then hangs below the socket', () => {
    let s = makeStalk(socket, [0, 0, 1], 2.5);
    s = stepStalk(s, socket, 1 / 30);
    expect(s.p[EYE_STALK.nodes - 1]![2]).toBeGreaterThan(socket[2] + 0.05);
    for (let i = 0; i < 240; i++) s = stepStalk(s, socket, 1 / 60);
    expect(s.p[EYE_STALK.nodes - 1]![1]).toBeLessThan(socket[1] - 0.12);
  });
  it('builds tapered capsules along the rope and an eyeball at its end', () => {
    const s = makeStalk(socket, [0, 0, 1], 0);
    const prims = stalkPrims(s, [1.9, 0.012, 0.005]);
    const caps = prims.filter(p => p.color && p.color[0] === 0.85);
    expect(caps.length).toBe(EYE_STALK.nodes - 1);
    expect(prims.some(p => p.glow)).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `head-eye.ts`.**

```ts
// src/lab/sdf-zombie/head-eye.ts
//
// THE POPPED EYE (spec §6). Pure. The zombie's eyes are texels of its face sheet, not prims, so the eye
// positions are the painted eyes' centroids (zombie-face.png, luma ≥ 0.9) mapped back through the
// sheet's planar projection (faceProj 0.45, 0.58, 0.5, 0.56; forward +1) to head coordinates:
// hs = head-rest position / headAxes. The leaf traces from eyeRayStart toward the head centre to find
// the surface point. The dangling eye hangs on its own small verlet rope (not flail-chain.ts, which is
// hard-wired to the flail): node 0 pinned to the socket, the last node the eyeball.
import { EYEBALL_R, GORE_COLORS, eyeballPrims } from './head-pop';
import type { HeadFrame } from './head-deform';
import type { EyeSide } from './head-damage';
import type { Primitive, Vec3 } from './types';

export const HEAD_EYES = { zombie: { L: [-0.498, 0.096] as const, R: [0.451, 0.179] as const } } as const;

export const EYE_STALK = {
  nodes: 6, len: 0.14, stepHz: 120, damping: 3, gravity: 9.81, iterations: 8,
  /** The stalk's radius at the socket and at the eye, metres. */
  r0: 0.009, r1: 0.006,
} as const;

import { rotate } from './head-deform';   // head-deform.ts's quaternion rotate: export it there in this task
```

  - `rotate` is head-deform.ts's quaternion rotate: export it there and import it here (do not duplicate it).
  - `eyeRayStart(frame, side)`: `centre + rotate(quat, [hs.x·axes.x, hs.y·axes.y, 1.5·axes.z])`, where `hs` is
    `HEAD_EYES.zombie[side]`.
  - `nearerEye(frame, point)`: the side whose `eyeRayStart` with z set to `axes.z` is nearer `point`.
  - `StalkState { p: Vec3[]; prev: Vec3[]; acc: number }`.
  - `makeStalk(socket, dir, speed)`: nodes laid along `dir` at the link length. `prev = p − dir·speed/stepHz`
    for the free nodes, which is the kick.
  - `stepStalk(s, socket, dt)`: fixed 1/stepHz substeps with the accumulator.
    - Each substep: Verlet with gravity and damping `exp(−damping·h)`, node 0 set to the socket, then
      `iterations` Gauss–Seidel distance sweeps and a final follow-the-leader pass. That pass makes every link
      exact, the flail-chain pattern.
    - At the end of the call, node 0 is set to the socket exactly.
  - `stalkPrims(s, irisColor)`:
    - `nodes−1` capsules from `p[k]` to `p[k+1]`, radius lerped `r0 → r1`, colour `GORE_COLORS.stalk`,
      `gloss: 0.7`, limb `'head'`, op `'union'`, small `blendK` (0.004);
    - then `eyeballPrims(last node, direction from node n−2 to n−1, irisColor, false)`. The rope is its nerve.
    - Fill `Primitive`'s required fields by copying `head-pop.ts`'s `prim()` helper's defaults. Export
      `prim()` from `head-pop.ts` if it helps.
- [ ] **Step 4: Failing tests: `head-crown.test.ts`.**

```ts
import { describe, expect, it } from 'vitest';
import { CROWN, brainPiece, crownRayStart, scalpCraterPoints, skullChips } from './head-crown';
import type { HeadFrame } from './head-deform';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };

describe('crown', () => {
  it('the crown ray starts above the head on its up axis', () => {
    const s = crownRayStart(frame);
    expect(s[0]).toBeCloseTo(0, 9); expect(s[1]).toBeGreaterThan(1.6 + 0.11);
  });
  it('the scalp tear is two points 0.035 m apart across the head', () => {
    const [a, b] = scalpCraterPoints([0, 1.71, 0], frame);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(CROWN.scalpSpacing, 6);
    expect(Math.abs(a[0] - b[0])).toBeCloseTo(CROWN.scalpSpacing, 6);
  });
  it('the brain is one gob piece of ≤ 10 prims inside a 0.12 m sphere, launched up and along the blow', () => {
    const p = brainPiece([0, 1.71, 0], [1, 0, 0], () => 0.5);
    expect(p.kind).toBe('gob');
    expect(p.prims.length).toBeLessThanOrEqual(10);
    for (const q of p.prims) for (const e of [q.a, q.b]) expect(Math.hypot(e[0] - p.origin[0], e[1] - p.origin[1], e[2] - p.origin[2])).toBeLessThan(0.12);
    expect(p.vel[1]).toBeGreaterThan(0); expect(p.vel[0]).toBeGreaterThan(0);
  });
  it('three skull chips', () => {
    expect(skullChips([0, 1.71, 0], [1, 0, 0], () => 0.5).length).toBe(3);
  });
});
```

- [ ] **Step 5: Implement `head-crown.ts`.**
  - `CROWN = { scalpR: 0.05, scalpSpacing: 0.035, brainR: 0.08, launch: 3.5 }`.
  - `crownRayStart(frame)`: `centre + rotate(quat, [0, 1.6·axes.y, 0])`.
  - `scalpCraterPoints(crown, frame)`: `crown ± rotate(quat, [scalpSpacing/2, 0, 0])`.
  - `brainPiece(crown, blowDir, rand): GorePiece`:
    - 8 prims around `origin = crown`: two hemisphere ellipsoids (radius 0.045, scale [0.9, 0.75, 1.15],
      at ±0.022 m on the head x), four bent capsule gyri (radius 0.014, `bend` for curl, colour
      `GORE_COLORS.brain` × 0.85), a stem capsule and a cerebellum sphere;
    - limb `'head'`, `kind: 'gob'`, `tornAt: []`, `bones: []`;
    - `vel` = (blow direction flattened, ×0.6 + up ×1) normalised × `launch`, plus a 0.2 jitter from `rand`;
    - `angVel` a spin of about 8 rad/s from `rand`.
  - `skullChips(crown, blowDir, rand): GorePiece[]`: 3 pieces, each one flat ellipsoid (radius 0.018, scale
    [1, 0.35, 0.8], colour `[0.86, 0.82, 0.7]`), launched up and outward at 2–3 m/s.
- [ ] **Step 6:** `npm test -- head-eye head-crown head-pop`, `npx tsc --noEmit`, expect PASS.
- [ ] **Step 7: Commit:** `feat(head-damage): eye positions, the stalk rope, crown, brain and skull chips`.

### Task 5: Engine hooks — the actor's deform and kill, the chunk morph, the attach hook

**Files:**
- modify `src/lab/sdf-zombie/webgpu/game-actor.ts`, `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`,
  `src/lab/sdf-zombie/webgpu/game-main.ts`;
- modify the boot slice's type in `src/lab/sdf-zombie/webgpu/game-context.ts` (or wherever
  `ctx.boot.onGoreDispatch` is typed; grep for it).

- [ ] **Step 1: `setHeadDeform`.**
  - Add to the `ZombieActor` interface: `/** Melee head damage (game-head-damage.ts): a pure map applied to the posed body after every applyRig (the per-frame step and each hit's re-pose). null removes it. */ setHeadDeform(fn: ((posed: Body) => Body) | null): void;`. Use the type `applyRig` returns.
  - In the factory: `let headDeform: ((p: Body) => Body) | null = null;` and
    `const repose = () => { const p = applyRig(current, bound, bodyYaw); return headDeform ? headDeform(p) : p; };`.
  - Replace **every** `posed = applyRig(current, bound, bodyYaw)` with `posed = repose()`. The sites are the
    per-frame step (~line 1477, including the one inside the `inflateHead` branch), `stampBlast` (~1568), the
    end of `blast()` (~1670) and `flushHitTail` (~1779). Grep for `applyRig(current` to catch them all.
  - Add `setHeadDeform: (fn) => { headDeform = fn; }` to the returned object.
- [ ] **Step 2: `forceCollapse`.**
  - Add to `ActorBlastEffect`: `/** Melee head damage: the brain is out; collapse and die now (collapse.ts sig.forced, motion's fallFatal). */ forceCollapse?: boolean;`.
  - In `blast()`: `if (effect.forceCollapse) forceCollapseNext = true;`, with a `let forceCollapseNext = false`
    in the factory.
  - Where the step builds its `MotionSignals` (grep `forcedCollapse`, ~line 1074, and the soldier and soft
    sites at ~1219/~1238), OR `forceCollapseNext` into `forcedCollapse`, then clear it after that step.
- [ ] **Step 3: `ChunkGpuView.morph`.** In `zombie-gpu.ts`:
  - interface: `/** Hand-posed pieces (the head damage model's dangling eye): replace the local prims' endpoints (chunk-local, the same count and order as reset()'s prims) before the next update(). Radii, colours and the bound are unchanged. */ morph(ends: ReadonlyArray<{ a: Vec3; b: Vec3 }>): void;`
  - implementation, next to `apply`:
    `morph(ends) { ends.forEach((e, i) => { const p = local[i]; if (p) local[i] = { ...p, a: e.a, b: e.b }; }); }`.
  - Check that `extent` (the bound radius) is computed at `reset` from the local prims. The attach hook
    below builds the piece with the stalk laid out straight at full length, so the bound covers every pose.
    If `extent` also depends on radii, that is fine.
- [ ] **Step 4: `ctx.boot.attachPiece`.**
  - In `game-main.ts`, factor the view-creation half of `spawnChunkPiece` (~line 5139) into a helper:
    `createChunkGpuView` plus `setPackBones`, `applyChunkKindLook`, `layers.set(SDF_LAYER)`, `scene.add` and
    `deferredApi?.router.register`. `spawnChunkPiece` keeps using it unchanged, and so does the recycle path.
  - Then add:

```ts
/** A kinematic SDF piece riding an actor (head-damage's dangling eye): no physics, never baked or evicted,
 *  one draw. `prims` are world-space at `pos`; each frame the caller moves it and bends it. */
ctx.boot.attachPiece = (a, prims, pos) => {
  const state = makeChunk(/* as spawnChunkPiece does, at pos, zero velocity */);
  const view = makeChunkView(state, prims, [], [], { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture }, 'gob');
  return {
    update(at: Vec3, localEnds: ReadonlyArray<{ a: Vec3; b: Vec3 }>) {
      view.morph(localEnds);
      view.update({ ...state, pos: at, quat: [0, 0, 0, 1], squash: 0 });
    },
    dispose() { /* return the view to spareViews exactly as spawnChunkPiece's eviction does, and remove it from the scene */ },
  };
};
```

  - The type goes in the boot slice:
    `attachPiece?: (a: ZombieActor, prims: Primitive[], pos: Vec3) => { update(at: Vec3, localEnds: ReadonlyArray<{ a: Vec3; b: Vec3 }>): void; dispose(): void }`.
  - Local ends are world minus `at`.
  - Read `spawnChunkPiece` and the chunk step loop (~7521) fully before writing this. The attached view must
    not be in `liveChunks` or `ctx.bake.chunks`, but it must still count against the shared material's
    slots. If the material is full, `attachPiece` returns a handle whose `update` does nothing and logs a
    warning once.
- [ ] **Step 5: Verify.** `npx tsc --noEmit`; `npm test -- game-actor zombie-gpu game-context-coverage` (its
  known `artScene`/`spawnOverride` failure predates this branch, so ignore exactly that one). Boot smoke:
  `node scripts/flail-gate.mjs 5241 9241` must still pass (no behaviour change yet).
- [ ] **Step 6: Commit:** `feat(engine): head-deform hook, forceCollapse, ChunkGpuView.morph, attachPiece`.

### Task 6: The leaf — `game-head-damage.ts`, wired into the flail

**Files:**
- create `src/lab/sdf-zombie/webgpu/game-head-damage.ts` and `src/lab/sdf-zombie/webgpu/game-seams-head.ts`;
- modify `game-flail.ts`, `game-main.ts` and `game-state-weapon.ts` (a `headDamage` field next to `flail`).

- [ ] **Step 1: The leaf.** `createHeadDamage(ctx, deps)`:
  - `deps`:
    - `headShape(a) → { centre, axes } | null`: game-main's local `headShape(a.drawnBody())`, the same frame
      the face sheet projects through;
    - `gore(a, pieces)`: `ctx.boot.onGoreDispatch`;
    - `burst(a, at, dir)`: the head-pop blood, `burstVolume` + `spawnImpactGout`, copied from `onHeadPop`;
    - `bleed(a, w, point, dir)`;
    - `attach`: `ctx.boot.attachPiece`.
  - Returns `{ hit(a, point, dir, feel: { meterCredit, shove }), tick(dt), forget(id), debug(id) }`.
  - Per actor it keeps `{ ladder: HeadDamageState, deform: HeadDeformState, eye?: { side, socket: Wound, stalk: StalkState, piece } }`.
  - **The frame:** `frame(a) = { centre, axes } from deps.headShape(a)`, plus
    `quat = headQuatOf(a.boundRig(), a.pose().yaw)` (`rig-bind.ts`).
  - **`hit`:**
    1. Take the local blow direction `dirLocal = rotate(conj(quat), dir)` and the eye side
       `nearerEye(frame, point)`.
    2. `const r = headHit(ladder, { eyeSide })`.
    3. On the first hit, call `a.setHeadDeform(p => deformHead(p, st.deform, frameNow))`. `frameNow` is
       refreshed every tick, and the closure reads the current state.
    4. For each event:
       - `wobble`: `deform = kickWobble(deform, dirLocal)`.
       - `eye-pop`:
         - trace from `eyeRayStart(frame, side)` toward `frame.centre` onto the posed body
           (`traceRaySurface` from `flail-strike.ts`, field `q => sdBody(q, a.posed())`) to get the socket
           point;
         - build the socket wound, `worldHitToWound(posed.prims, socket, 0.028, 'blast', yaw, field)` with
           `headSlot = 'keep'` and `severRadius = 0`;
         - make the stalk with `makeStalk(socket, reflect(dir, normal) normalised, 2.5)`;
         - build the prims with `stalkPrims(stalk, [1.9, 0.012, 0.005])`;
         - `eye.piece = deps.attach(a, prims, socket)`.
       - `dent`: `deform = addDent(deform, dirLocal, 0.018, frame.axes)`.
       - `face-crater`: a `worldHitToWound` at `point`, radius `FLAIL_HEAD.faceCraterR`, `headSlot = 'face'`,
         `severRadius = 0`.
       - `eye-snap`: from the stalk's second half and the eyeball prims (world space now), build a
         `GorePiece` with velocity (last node − prev) × stepHz + (0, 1.5, 0) + dir × 1.5. Dispatch it,
         `eye.piece.dispose()`, and drop the stalk.
       - `scalp`:
         - trace from `crownRayStart(frame)` toward the centre to get the crown;
         - two wounds of `CROWN.scalpR` at `scalpCraterPoints(crown, frame)`, each also traced to the
           surface, `headSlot = 'keep'`, `severRadius = 0`, `type 'blast'`.
       - `brain`:
         - a wound of `CROWN.brainR` at the crown (`'keep'`, `severRadius` 0);
         - `deps.gore(a, [brainPiece(crown, dir, rand), ...skullChips(crown, dir, rand)])`;
         - `deps.burst(a, crown, up)`.
       - `kill`: `forceCollapse: true` on this hit's `blast`.
    5. One `a.blast({ wounds, meterCredit: feel.meterCredit, impulse: { at: point, vel: dir × feel.shove }, reaction: 'blast', forceCollapse })`,
       then `deps.bleed(a, first wound, point, dir)`.
  - **`tick(dt)`:** for each tracked actor:
    - if the actor is gone, forget it;
    - refresh `frameNow`;
    - `deform = stepWobble(deform, dt)`;
    - if an eye dangles:
      - socket world = `woundWorldPos(a.posed().prims, eye.socket, a.pose().yaw)`, so the socket rides the
        deformed head;
      - `eye.stalk = stepStalk(eye.stalk, socket, dt)`;
      - `eye.piece.update(socket, localEnds(stalkPrims(eye.stalk, iris), socket))`;
    - if the actor's collapse phase is no longer `'standing'`, apply `headDeath` (a dangling eye snaps).
  - **`debug(id)`:** `{ hits, stage, eye, squash: deform.s, flat: deform.flat, eyeball: world pos | null, socket: world pos | null }`.
- [ ] **Step 2: The flail.** In `game-flail.ts strike()`, when `region` is true and `deps.headHit` exists:
  - call `deps.headHit(a, h.point, h.dir, { meterCredit: f.meterCredit, shove: f.shove })` instead of
    stamping the face crater and calling `blast`;
  - keep counting `headHits` and bleeding through the leaf;
  - add `headHit?` to `FlailDeps`.

  Body hits are unchanged.
- [ ] **Step 3: Wiring.**
  - In `game-main.ts`, create the leaf after the flail, store it on `ctx.weapon.headDamage`, and pass
    `headHit: (a, p, d, f) => ctx.weapon.headDamage?.hit(a, p, d, f)` in the flail deps.
  - Call `ctx.weapon.headDamage?.tick(dt)` right after `flail.tick`. Actors step before this, so the eye
    follows this frame's pose.
- [ ] **Step 4: Seams.** `game-seams-head.ts`:
  - `__sdfGame.head.state(id)` returns the leaf's `debug`;
  - `__sdfGame.head.hit(id, x, y, z, dx, dy, dz)` drives a head hit directly, for gates, with the R swing's
    feel;
  - spread it into `__sdfGame` like the flail seams.
- [ ] **Step 5: Verify.**
  - `npx tsc --noEmit`; `npm test -- head flail game-actor`.
  - Smoke headless: boot, freeze, and call `__sdfGame.head.hit` four times on a zombie's head, 40 frames apart.
    `state(id)` must go through the stages, and the zombie must leave `standing` after the 4th hit (thaw a
    frame to read it).
  - Zero console errors.
- [ ] **Step 6: Commit:** `feat(head-damage): the leaf — wobble, dents, the dangling eye, scalp, brain, kill`.

### Task 7: The gate — `scripts/head-damage-gate.mjs`

**Files:**
- create `scripts/head-damage-gate.mjs`: copy the boot, CDP helpers, `capture()`, `place()`, `swing()` and the
  pool helpers from `scripts/flail-gate.mjs`;
- photos go to `docs/dev-notes/2026-09-28-head-damage/gate/`.

Use one fresh frozen zombie. Stand 0.9 m from the head with the reticle on it:
`setFreeAim(true)`, `setAimPoint(0, 0)`, pitch `atan2(head[1] − EYE_H, 0.9)`. Re-aim before every click.
Hit-stop off.

- [ ] **Step 1: A pre-state.** One body hit first (aim at the torso). Record `actorWounds(id).length` as
  `bodyWounds`.
- [ ] **Step 2: Hit 1, the eye.** One click. Then:
  - `head.state(id).eye` is dangling;
  - read `squash` each frame for 10 frames; the peak |squash| must be ≥ 0.15;
  - after 30 frames the eyeball is ≥ 0.08 m below the socket;
  - after 0.8 s (48 frames) |squash| is < 0.0025;
  - a socket crater exists: a new wound of radius 0.028;
  - photo `head-1-eye.png`, and a strip of the dangling eye swinging over 8 frames (`eye-swing-strip.png`).
- [ ] **Step 3: Hit 2, cave and snap.** Sample `sdBody` on the head's hit side before the click (seam: add
  `__sdfGame.head.surfaceAt(id, x, y, z)` returning `sdBody` of the posed body there, if missing). Then:
  - `eye.state` is `'gone'`;
  - the live chunk count went up;
  - the head surface on the dented side moved in by ≥ 0.01 m (the same world point's `sdBody` rose by
    ≥ 0.01);
  - photo `head-2-cave.png`.
- [ ] **Step 4: Hit 3, the scalp.** Two new craters within 0.03 m of the crown. Take the crown crop from above:
  place the camera so the crown shows, since the player's view can't see the top of the head (a photo
  stand, not the swing stand). The share of bone-coloured pixels in the crop rises. Run it on the shipped
  skeleton path, then again with `?skeleton=procedural` (a second boot) or the skeleton toggle seam if one
  exists (grep `skeleton` in `game-seams-*.ts`). Photo `head-3-scalp.png`.
- [ ] **Step 5: Hit 4, the brain.** A brain gore piece is dispatched (live chunks up by ≥ 4). Thaw 3 frames:
  the zombie's phase is no longer `'standing'`, and `limbAlive(id, 'head') > 0` (the head is still on).
  Photo `head-4-brain.png` a few frames after the hit.
- [ ] **Step 6: Body wounds survive.** Every wound present at Step 1 is still in `actorWounds(id)` (compare by
  position within 1 mm).
- [ ] **Step 7: Cost.** Mean frame time over 120 frames with a dangling eye, against the same scene with no
  eye (use a second fresh zombie), must be within 0.5 ms (`__sdfGame.frameStats` or the timing seam the
  bench scripts use; grep `frameMs`).
- [ ] **Step 8:** Zero console errors. Run it to green, LOOK at every photo, and commit the gate and photos:
  `test(head-damage): the gate — eye, cave and snap, scalp, brain, kill`.

### Task 8: Look pass, docs, PR

- [ ] Look at the gate photos and the eye strip with the owner's eye:
  - the eyeball reads as a shiny eyeball with a glowing red pupil on a pink stalk;
  - the wobble is visible;
  - the dent reads as a lopsided head;
  - the brain reads as a brain.

  Tune only constants (`HEAD_DEFORM`, `EYE_STALK`, `CROWN`, the eyeball scale) and record every change.
- [ ] Write `docs/dev-notes/2026-09-28-head-damage/NOTES.md`: what was built, the numbers, a "For the owner"
  section (what to try, the feel questions), and the eye-centroid measurement (decision 6).
- [ ] Update `TASKS.md` (the head damage row → built, owner playtest pending) and the spec's status line. Add a
  head damage section to the PR body (`gh pr edit 22 --body-file …`, keeping the 🤖 footer line). Commit,
  push, and restart the owner's server (`preview_start` `blud-censer`).

---

## After the first build: spec §14 (owner, 2026-09-28)

State at `02fae287`:
- The frozen-actor squash fix, `reposeHead`, is in.
- The eye's proxy box fits the eye, so it costs about 1.3 ms.
- The head gate reports 18 checks, 2 failed:
  - the hit-2 dent reads 0.0063 at the ring sampled 0.085 m off the blow;
  - the cost is 0.60 ms against a 0.5 ms limit.
- Task 8 (the look pass and docs) moves to the end, as Task 12.

### Task 9: Restore bone colour on the procedural path

**Files:** `src/lab/sdf-zombie/webgpu/march/body/blocks/post/organ.wgsl.ts`, and whatever commit `00194a001`
removed. Read `git show 00194a001` first.

- [x] **Restore the bone shading.** It was deleted as dead code while bone rows stayed packed in the field.
  Restore it so a surface hit on a bone row (`isBone`, `hitMat` 3.5–4.5) takes the bone colour, as the melt
  and burn blocks already do.
  - Keep the restored code as close to the deleted code as the current shader allows.
  - Update the comment that records the deletion.
- [x] **Verify.**
  - `npx tsc --noEmit`, and `npm test -- march organ zombie-gpu wgsl` (whatever covers the shader strings).
  - Run the head gate with `?skeleton=procedural`: the crown bone share after hit 3 must rise clearly (it is
    flat today at 0.0036 → 0.0036).
  - A shotgun-severed limb on the procedural path shows an ivory bone end. Take a photo with any existing gib
    capture script, and look at it.
  - The flail gate passes. The default mesh path looks unchanged: compare the head gate's mesh-path photos
    before and after.
- [x] **Commit:** `fix(bone): restore bone colour on the procedural skeleton path`.

### Task 10: The skull squashes and dents with the flesh

**Files:** `src/lab/sdf-zombie/head-deform.ts` (+ test), the leaf `webgpu/game-head-damage.ts`, the mesh
skeleton path (`webgpu/skeleton-spike/*`, `game-main.ts` where segment meshes are posed), and
`scripts/head-damage-gate.mjs`.

- [ ] **Pure (test first).** `deformHead` also maps the head's bone prims, with the same affine transform as
  the flesh: `body.bonePrims` with limb `'head'`, op `'bone'` or `'organ'`. `BuiltBody` keeps bone prims out
  of `prims`, which is why they were missed.
  - Export the transform as `headAffine(st, frame) → { centre, e: [Vec3, Vec3, Vec3], mul: Vec3, shift: Vec3 } | null`
    (null when there is no deformation), so the mesh path can apply it.
  - Tests:
    - with `flat` and a squash, a bone prim inside the head moves by exactly the flesh's transform at the same
      point;
    - with no deformation, `bonePrims` comes back as the same array.
- [ ] **Mesh path.** Find how the shipped `skeleton=mesh` path poses the skull segment mesh each frame (the bone
  transforms per actor; `buildSkeletonSources`, `segMeshRenderer`). Apply `headAffine` to the skull segment's
  world matrix per actor: a per-segment extra matrix `M = T(centre + Σ e·shift) · E · diag(mul) · Eᵀ · T(−centre)`.
  - The leaf exposes the current affine per actor (`headDamage.affine(actor)`), and the skeleton posing reads it.
  - Keep the change to that one hook.
- [ ] **Gate.**
  - The hit-2 dent check measures where the model promises the full depth: the dented side's pole, the head
    frame centre ± that axis × the half-extent. Sample `surfaceAt` just outside the pole along the axis before
    and after, and require a rise ≥ 0.01 m. Document in the gate why the pole is used, not the 0.085 m ring
    (decision 1: a side flattening, not a point dent).
  - Add a check that no bone shows through outside craters after hit 2 on the mesh path: the bone-pixel share
    in a face crop, excluding a circle around each crater, must not rise past the pre-hit value + 0.005.
    Print the before-fix and after-fix numbers.
  - Also sample the peak-squash frame: the face-crop bone share outside craters stays within the same bound.
- [ ] **Verify.** Tests, tsc, both gates. Look at `head-2-cave.png` and a peak-squash frame: no skull through
  intact flesh.
- [ ] **Commit:** `feat(head-deform): the skull squashes and dents with the flesh (both skeleton paths)`.

### Task 11: The brain — a modelled mesh with a wet material

**Files:** create `scripts/model_brain.py` (headless Blender, following `scripts/model_flail.py`'s pattern and
header), `public/assets/lab/brain.glb`, and `src/lab/sdf-zombie/webgpu/game-brain-gib.ts` (the leaf). Modify
`game-head-damage.ts`, `game-main.ts` (the mesh-gib step next to the chunk loop), and `head-crown.ts` (drop the
SDF whole brain from the brain stage, keep the lumps and chips).

- [x] **Model.** Build a brain about 0.14 m long in Blender, at most 8k triangles:
  - two hemispheres with a clear longitudinal fissure;
  - gyri and sulci made by real geometry: displacement from a cellular or voronoi-ridge texture, or sculpted
    folds, not a flat blob;
  - a cerebellum with finer horizontal folds;
  - a short brain stem.

  Keep vertex colour or a baked AO so the sulci are darker. Export `brain.glb` with one mesh node `Brain`.
  Render a turntable preview with the Blender MCP or headless Blender, and look at it.
- [x] **Material.**
  - A wet pink-grey (base ≈ `#c98b8b` to `#b98a8f`), with the sulci darker and redder.
  - Low roughness (0.3) plus a clearcoat or sheen.
  - The existing `GORE_COLORS.brain` tint family.
  - It is a Three.js WebGPU node material (MeshPhysicalNodeMaterial or MeshStandardNodeMaterial), lit by the
    scene lights like the flail.
- [x] **Physics.** A mesh gib rides a `gib-chunks.ts` `Chunk` state:
  - built with `makeChunk` at the crown, with its velocity and spin;
  - stepped with `stepChunk(c, dt, chunkCollidersAt(ctx, c.pos))` in the same loop as the chunk step;
  - the mesh's position and quaternion are copied from the chunk each frame.
  - It settles on the floor and stays like other gibs, with a cap (reuse `maxChunks` or a small own cap, 8).
  - `ctx.boot.spawnMeshGib(mesh, pos, vel, angVel, radius)` is set in `game-main.ts`.
- [x] **The brain stage.**
  - The brain launches up and along the blow at about 2.5 m/s, so it hangs visibly, with a spin.
  - The stage's blood burst is about half its current radius.
  - The leaf no longer dispatches the SDF `brainPiece`. Keep `brainPiece` exported for now; the tests still
    cover it.
- [x] **Gate.**
  - The head gate's hit 4 asserts that a brain mesh gib exists (a seam: `__sdfGame.head.brains()` → positions)
    and, after 1 s, that it rests near floor height.
  - Photo `head-4-brain.png` three frames after the hit, and `brain-rest.png` with a close-up of the brain on
    the floor. Look at both: it must read as a brain.
- [x] **Verify.** tsc; `npm test -- head gib-chunks`; both gates; zero console errors.
- [x] **Commit:** `feat(head-damage): a modelled brain mesh gib with a wet material`.

  **As built (Task 11):**
  - Model: reaction-diffusion (Gray-Scott labyrinth) gyri on a 1 mm remeshed high mesh, baked (normal + albedo,
    WebP, 1024²) onto a 7,268-tri low mesh; 0.105 x 0.122 x 0.138 m. Previews `docs/dev-notes/2026-09-28-head-damage/brain-model*.png`.
  - Material: `MeshPhysicalNodeMaterial` on the level's per-room light list. The model albedo rendered pure white
    under the torch, so the colour multiplies it by ~0.09 (`BRAIN_LOOK`).
  - Physics: `game-mesh-gibs.ts` (cap 8, cleared in `rebuildCast`). A per-chunk `restitution` (0.2) keeps the brain
    from bouncing 0.6 m.
  - The brain lumps did not exist yet: `brainLumps` (3) was added beside the chips.
  - Less blood at the brain stage: half the burst (`burstVolume` scale: 40% of the drops at half speed), a pellet
    gout and a pellet crater bleed. Even so, at +3 frames the brain is still inside its own spray, so the gate adds
    `head-4-brain-apex.png` (+15 frames).

### Task 12: Look pass, docs, PR (was Task 8)

- [ ] **The eyeball's iris faces out, not down.** The eyeball's look direction is the head's forward, blended
  toward the stalk's direction as it swings (e.g. 70/30), so the glowing pupil stays visible from the front.
  Change `stalkPrims` to take a `look` argument, with a test.
- [ ] **Blood per head stage.** The head hits bleed less (a `'pellet'`-sized gout, not `'slug'`) so stages 2–3
  are visible. Measure the red-pixel share in a head crop per stage before and after.
- [ ] **Readability.** Check that the dent reads and the scalp tear reads. Tune the constants (`HEAD_DEFORM`,
  `EYE_STALK`, `CROWN`) and record each change.
- [ ] **Cost.** If the eye's leftover cost (about 0.6–1.2 ms when overlapping the face) can be cut cheaply,
  e.g. by drawing attached pieces in the split chunk pass only, do it. Otherwise record it in NOTES as open.
- [ ] **Docs.**
  - Write `docs/dev-notes/2026-09-28-head-damage/NOTES.md`: what was built, the numbers, "For the owner", and
    the eye-centroid measurement.
  - Set `TASKS.md` and the spec status to built, owner playtest pending.
  - Add a head damage section to the PR body (keep the 🤖 footer line).
  - Push, and restart the owner's server (`preview_start` `blud-censer`).

---

## v2: the flesh wears away, events follow (spec §15, owner 2026-09-29)

State: `67d6ec21`. The bone bake fix is merged; Tasks 1–11 are in.
- **Superseded:** `head-damage.ts`'s fixed ladder.
- **Moved:** Task 12's look items (iris facing out, blood per stage, cost) go into Tasks 17 and 19.

### Task 13: Region craters replace their predecessor (`damage.ts`, pure)

- [ ] **Tests first** (in `damage.test.ts`):
  - a wound with `headRegion: 'brow'` pushed onto a ring that already holds a `'brow'` wound replaces it, in
    the old one's position;
  - wounds without `headRegion` behave exactly as before;
  - `MAX_HEAD_WOUNDS` is 7.
- [ ] **Implement:** add `headRegion?: string` to `Wound`. In `pushWound`, before the head-slot rule: if
  `wound.headRegion` is set and an earlier wound has the same `headRegion`, put the new wound in that one's
  index and drop the old one. Set `MAX_HEAD_WOUNDS` to 7.
- [ ] **Verify and commit:** `npm test -- damage character-view game-actor head`, tsc. Commit
  `feat(damage): a head region's crater replaces its predecessor; 7 head slots`.

### Task 14: The region damage model (`head-damage.ts` v2, pure)

**Files:** rewrite `src/lab/sdf-zombie/head-damage.ts` and its tests.

- [ ] **Tests first.**

```ts
import { describe, expect, it } from 'vitest';
import { HEAD_REGIONS, REGION_TUNING, headDeath, headHit, makeHeadDamage, type HeadEvent } from './head-damage';

const k = (ev: HeadEvent[]) => ev.map(e => e.kind);
const at = (r: keyof typeof HEAD_REGIONS) => HEAD_REGIONS[r];   // a hit exactly on a region centre (hs)
const noJitter = () => 0.5;                                    // rand → jitter factor 1

describe('head damage v2', () => {
  it('a hit strips the nearest region most and spills to neighbours; upper-face hits also strip the crown', () => {
    const r = headHit(makeHeadDamage(), { hs: at('brow'), strip: 0.25 }, noJitter);
    expect(r.state.flesh.brow).toBeCloseTo(0.75, 6);
    expect(r.state.flesh.crown).toBeLessThan(1);
    expect(r.state.flesh.cheekL).toBeGreaterThan(r.state.flesh.orbitL);   // falloff
    expect(k(r.events)).toContain('strip');
  });
  it('stripping an orbit below the threshold exposes it (once), then the next hit there pops the eye', () => {
    let s = makeHeadDamage(); let all: HeadEvent[] = [];
    for (let i = 0; i < 3; i++) { const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter); s = r.state; all = all.concat(r.events); }
    expect(all.filter(e => e.kind === 'orbit-exposed')).toEqual([{ kind: 'orbit-exposed', side: 'L' }]);
    expect(s.eyes.L).toBe('in-orbit');
    expect(k(all)).not.toContain('eye-pop');
    const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'eye-pop', side: 'L' });
    expect(r.state.eyes.L).toBe('dangling');
  });
  it('a dangling eye snaps on the next head hit, or on death', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 4; i++) s = headHit(s, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    expect(s.eyes.R).toBe('dangling');
    const r = headHit(s, { hs: at('cheekL'), strip: 0.25 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'eye-snap', side: 'R' });
    expect(r.state.eyes.R).toBe('gone');
    let d = makeHeadDamage();
    for (let i = 0; i < 4; i++) d = headHit(d, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    expect(headDeath(d).events).toEqual([{ kind: 'eye-snap', side: 'R' }]);
  });
  it('skull exposed on the brow, then about two skull hits bring the brain out and kill', () => {
    let s = makeHeadDamage(); let all: HeadEvent[] = [];
    for (let i = 0; i < 8 && !s.dead; i++) { const r = headHit(s, { hs: at('brow'), strip: 0.25 }, noJitter); s = r.state; all = all.concat(r.events); }
    const exposedAt = all.findIndex(e => e.kind === 'skull-exposed');
    const brainAt = all.findIndex(e => e.kind === 'brain');
    expect(exposedAt).toBeGreaterThanOrEqual(0);
    expect(brainAt).toBeGreaterThan(exposedAt);
    expect(k(all)).toContain('kill');
    expect(s.dead).toBe(true);
    expect(s.hits).toBeGreaterThanOrEqual(5); expect(s.hits).toBeLessThanOrEqual(7);
  });
  it('jitter changes when things happen (not an exact hit number)', () => {
    const run = (rand: () => number) => { let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: 0.25 }, rand).state; n++; } return n; };
    expect(run(() => 0)).not.toBe(run(() => 0.999));
  });
  it('crater radius grows as a region loses flesh', () => {
    expect(REGION_TUNING.craterR('brow', 1)).toBeLessThan(REGION_TUNING.craterR('brow', 0.3));
  });
});
```

- [ ] **Implement.**

```ts
// src/lab/sdf-zombie/head-damage.ts
//
// MELEE HEAD DAMAGE v2 (spec §15). Pure. The flesh wears away region by region and events follow from
// state, not from a hit count: an orbit stripped to bone shows a 3D eye in it, the next hit there pops it
// (a dark empty orbit), the next head hit snaps the dangling eye; the brow or crown stripped to bone shows
// skull, and about two more hits there crack it — the brain comes out and the zombie dies. Per-zombie
// jitter (rand) moves every threshold crossing.
export type EyeSide = 'L' | 'R';
export type HeadRegion = 'orbitL' | 'orbitR' | 'brow' | 'crown' | 'cheekL' | 'cheekR';
type HS = readonly [number, number, number];   // head-local ÷ half-extents (x right, y up, z face-forward)

export const HEAD_REGIONS: Readonly<Record<HeadRegion, HS>> = {
  orbitL: [-0.498, 0.096, 0.9], orbitR: [0.451, 0.179, 0.9],   // the face-sheet eye centroids (plan decision 6)
  brow: [0, 0.5, 0.85], crown: [0, 1, 0], cheekL: [-0.55, -0.3, 0.75], cheekR: [0.55, -0.3, 0.75],
};

const R_MAX: Readonly<Record<HeadRegion, number>> = { orbitL: 0.035, orbitR: 0.035, brow: 0.05, crown: 0.055, cheekL: 0.045, cheekR: 0.045 };

export const REGION_TUNING = {
  spillSigma: 0.5,
  crownSpill: 0.5,
  orbitExposed: 0.35,
  skullExposed: 0.3,
  skullPerHit: 0.5,
  jitter: 0.2,
  /** The region's crater radius at a given flesh (1 = untouched). */
  craterR: (r: HeadRegion, flesh: number) => 0.025 + (R_MAX[r] - 0.025) * Math.min(1, (1 - flesh) / 0.7),
} as const;

export type EyeState = 'painted' | 'in-orbit' | 'dangling' | 'gone';
export interface HeadDamageState {
  hits: number;
  flesh: Record<HeadRegion, number>;
  skull: { brow: number; crown: number };
  eyes: Record<EyeSide, EyeState>;
  dead: boolean;
}

export type HeadEvent =
  | { kind: 'wobble' }
  | { kind: 'strip'; region: HeadRegion; flesh: number }        // one per region whose flesh changed
  | { kind: 'orbit-exposed'; side: EyeSide }
  | { kind: 'eye-pop'; side: EyeSide }
  | { kind: 'eye-snap'; side: EyeSide }
  | { kind: 'skull-exposed'; region: 'brow' | 'crown' }
  | { kind: 'brain'; region: 'brow' | 'crown' }
  | { kind: 'kill' };
```

  Implement `makeHeadDamage()`, `nearestRegion(hs)`, `headHit(s, { hs, strip }, rand)` and `headDeath(s)`
  so the tests pass, with these rules, in this order within one hit:
  1. `wobble`.
  2. Snap any **dangling** eye (from before this hit).
  3. Pop: if the nearest region is an orbit whose eye is `'in-orbit'`, pop it (`'dangling'`), and skip
     stripping that orbit this hit.
  4. Strip every region by `strip · jitter · exp(−d²/σ²)`, where `d` is the `hs` distance and
     `jitter = 1 + REGION_TUNING.jitter · (2·rand() − 1)`, drawn once per hit. The upper face (the nearest
     region is the brow or an orbit) adds `crownSpill ×` that to the crown. Clamp at 0. Emit `strip` events
     for the regions whose change is at least 0.02.
  5. Thresholds, crossed once:
     - an orbit whose eye is `'painted'` with flesh below `orbitExposed` gives `orbit-exposed` and sets
       `'in-orbit'`;
     - the brow or crown with flesh below `skullExposed` gives `skull-exposed`.
  6. Skull: if the nearest region (the crown counts for brow hits too) is an exposed-skull region, add
     `skullPerHit · jitter`. At 1 or more, emit `brain` for it and `kill`, and set `dead`.

  `headDeath` snaps a dangling eye. A dead head ignores further hits except wobble and strip. Check the
  brow test's arithmetic under these rules, and tune `skullPerHit` or `skullExposed` only if 5–7 hits cannot
  be met. Report any change.
- [ ] **Verify and commit:** `npm test -- head-damage`, tsc. Commit
  `feat(head-damage): v2 — flesh wears away per region, events follow`.

### Task 15: An exaggerated wobble (`head-deform.ts`)

- [ ] **Tests first.**
  - kicks to 0.40 and clamps at 0.45;
  - at 4 Hz, over 1.2 s the spring rings with 4–7 zero crossings, and its peak |s| after the first rebound is
    ≥ 0.15;
  - settled below 0.0025 by 1.4 s;
  - the new shear moves a point on the struck side along the blow by `shear · s · r` (`shear` about 0.15).
- [ ] **Implement:** set `HEAD_DEFORM` to `squash0 0.40`, `maxSquash 0.45`, `hz 4`, `zeta 0.18`, and add
  `shear 0.15`. The shear lives in `HeadDeformState` as the blow's head-local direction. In the affine, a point
  `v` gains `blowDir · shear · s · dot(v, −blowDir)/r`. Put it inside `headAffine` so the skull mesh follows
  it too. Update the existing tests' numbers.
- [ ] **Verify and commit:** `npm test -- head-deform`, tsc; commit `feat(head-deform): an exaggerated jelly
  wobble with a knock shear`.

### Task 16: A per-eye glow mask in the face shader

**Files:** `src/lab/sdf-zombie/webgpu/march/body/face.wgsl.ts`, the view uniforms in `zombie-gpu.ts`, and
their tests.

- [ ] **Uniform.** Add `faceEyeMask: vec4` holding `(onL, onR, radiusUV, 0)`, default `(1, 1, 0.07, 0)`, plus
  the two eye UV centres as a constant or a second vec4, `faceEyeUV = (0.276, 0.616, 0.703, 0.664)`.
  - `faceGlow` is multiplied by `1 − (1 − onL)·disc(uv, L) − (1 − onR)·disc(uv, R)`, where `disc` is a
    smoothstep over the radius.
  - Add `view.setEyeGlow(side, on)`.
- [ ] **Test** (the shader-string/uniform tests the repo has for face): the mask is present and the default is
  on. Measure in the head gate later.
- [ ] **Commit:** `feat(face): a per-eye glow switch (a popped eye stops glowing)`.

### Task 17: The leaf, v2

**Files:** `webgpu/game-head-damage.ts` (rework), `head-eye.ts` (small additions), `game-seams-head.ts`.

- [ ] **Hit mapping.**
  - `hs = conj(quat)·(point − centre) ÷ axes`.
  - `strip = 0.25` for R and L, `0.35` for H: pass the swing's side in `feel`.
  - `rand` is a per-actor seeded stream (seed = actor id).
- [ ] **Events → world:**
  - **`strip`:** stamp or replace that region's crater: `worldHitToWound` at the region's surface point,
    radius `craterR(region, flesh)`, `headRegion` = the region name, `headSlot = 'keep'`, `severRadius` 0.
    - The surface point is traced from the region's `hs` direction toward the head centre, like `eyeRayStart`.
    - The crater at the hit point itself is the hit region's crater. Keep one crater per region, not per hit.
  - **`orbit-exposed`:**
    - call `view.setEyeGlow(side, false)`;
    - attach the in-orbit eyeball piece: `eyeballPrims` at the orbit's surface point pulled 0.01 m inward,
      looking along the head forward, with no nerve, using `attachPiece(..., { clean: true })`.
  - **`eye-pop`:**
    - dispose the in-orbit piece;
    - attach the dangling piece, whose prims are `stalkPrims(stalk, iris, look)` followed by **the socket
      plug**: a matte near-black sphere (colour `[0.03, 0.01, 0.01]`, radius 0.024) fixed at the socket, whose
      local end stays at 0;
    - `stalkPrims` gains a `look` argument: the eyeball faces `normalize(0.7·headForward + 0.3·stalkDir)`, so
      the iris faces out.
  - **`eye-snap`:** as now, with the plug staying. Re-attach a plug-only piece, or keep one plug piece per
    popped orbit from the pop on. Pick the one with fewer draws: each pooled view is one draw.
  - **`skull-exposed`:** nothing extra. The region crater at low flesh reaches bone. Check the carve depth
    reaches the cranium at flesh ≤ 0.3, and raise the carve for head-region craters if needed.
  - **`brain`:** as now: the brain mesh plus lumps plus chips from that region's surface point; the reduced
    blood; a `CROWN.brainR` cavity with `headRegion 'brain'`.
  - **`kill`:** `forceCollapse`.
- [ ] **Blood.** Head strips bleed a pellet-sized gout, not a slug-sized one.
- [ ] **Debug and seams:** `debug` reports `{ hits, flesh, skull, eyes, dead, squash, eyeball, socket }`.
- [ ] **Verify:** tsc and `npm test -- head flail game-actor damage`. Smoke headless:
  - 4 hits on one orbit: exposed, then popped (dark hole, no glow), then the next hit snaps it;
  - 5–7 brow hits: skull, then brain, then dead.

  Look at the screenshots.
- [ ] **Commit:** `feat(head-damage): the v2 leaf — region craters, the eye in its orbit, a dark socket`.

### Task 18: The gate, v2

- [ ] Rework `scripts/head-damage-gate.mjs` to states, not hit numbers. Hit the left orbit with the crosshair
  (its `hs` point projected) until `eyes.L` is `'in-orbit'`. Assert:
  - that took 2–5 hits;
  - the painted glow at that eye is gone: the red-glow pixel share in an eye crop drops by 80% or more, and
    the other eye still glows;
  - a 3D eyeball is present.
- [ ] One more orbit hit pops the eye:
  - it dangles, with the iris facing the camera (a red-pixel share on the eyeball crop);
  - the orbit crop is dark (mean luma in a small circle under a threshold measured on a painted-eye baseline).
- [ ] The next head hit snaps the eye. Then hit the brow until dead. Assert:
  - the skull was exposed before the brain;
  - the kill came at 5–9 total head hits;
  - there is one brain mesh gib;
  - the head is still on;
  - body wounds survive;
  - at most 7 head wound slots are used.
- [ ] **Wobble:** peak |squash| ≥ 0.35 on the strike frame, a rebound of 0.12 or more within 10 frames, and
  settled (below 0.0025) by 1.4 s. There must be no bone showing through intact flesh at the peak-squash
  frame (the existing check).
- [ ] Keep the cost and console checks. Photos:
  - `v2-orbit-exposed.png`
  - `v2-eye-pop.png` (the dark hole plus the dangling eye)
  - `v2-skull.png`
  - `v2-brain.png`
  - `v2-wobble-strip.png` (8 frames of one hit)

  Look at each one.
- [ ] **Commit:** `test(head-damage): the v2 gate — flesh wears away, the eye, the skull, the brain`.

### Task 19: Look pass, docs, PR (was Task 12)

- [ ] **Tune from the photos** (`REGION_TUNING`, `HEAD_DEFORM`, the plug, the eyeball), and record each change.
- [ ] **Procedural-path craters:** bone inside them renders dark brown (Task 10 note). Check it and fix it if
  it is simple.
- [ ] **The eye's residual cost:** if drawing attached pieces in the split chunk pass is cheap, do it.
  Otherwise record it as open.
- [ ] **NOTES.md** (`docs/dev-notes/2026-09-28-head-damage/`): what was built, the numbers, "For the owner",
  and the eye-centroid measurement.
- [ ] **Status and PR:** set `TASKS.md` and the spec status to built, owner playtest pending. Add a head damage
  section to the PR body (keep the 🤖 footer line). Push, and restart the owner's server (`preview_start`
  `blud-censer`).
