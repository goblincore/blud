# Cut wounds M1 (wound capacity, the cut wound, the rod) Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A blade can cut deep, jagged, lipped gashes into any body part (stand-in: a rod swept by the player), and tough
enemies stop "healing" because the wound list is bigger and merges instead of dropping old wounds.

**Spec:** `docs/superpowers/specs/2026-10-03-cut-wounds-design.md` — read it first. This plan is its **milestone 1** plus the
wound-capacity work the owner asked for on 2026-10-03 (soldier and chaingunner faces "reappear" because the 16-wound ring
evicts). **Milestone 2 (the head split) gets its own plan after this lands**: its shader plumbing (the warped point through
the post-hit blocks, the skull mesh) depends on what this plan changes.

**Architecture:** Pure modules hold the logic: `cut-wound.ts` (cut constants, the slot's CPU mirror, sweep → segments,
stamping, exposure spheres) and `damage.ts` (merge-on-overflow, direction helpers, the cut fields on `Wound`). The cut rides
the existing wound pipeline: one new data row (`ROW_WOUND_CUT`), flag bit 32, a cut branch in `applyWounds`, a cut footprint in
`woundMask`, and a finite-difference fallback in `ngWounds`. The rod is a sixth weapon slot built like the flare harness.

**Tech Stack:** TypeScript, three.js WebGPU, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import; plain data in, plain data
    out). The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules).
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()` bindings
    (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no wall-clock in logic).
- Work ONLY in this worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <names>`) plus `npx tsc --noEmit`. Never the bare full suite. (`tsc` reports one
  pre-existing error, `pack-golden.test.ts` cannot find `node:crypto`; anything else is yours.)
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts require
  `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors. Do not edit `src/` while a capture runs: vite
  serves the working tree live.
- **Prove visual and performance claims with a number** (crop luminance, frame-to-frame change, GPU ms, boot time) and look
  at the images yourself. This machine's draw timer spreads by milliseconds between identical runs: report timings with
  their spread, and gate on structure where timing cannot decide.
- **Boot time is a gate:** a change that touches shaders reports cold-boot `drawOnce` against the base branch
  (`scripts/boot-time.mjs`, fresh profile each run).
- **Every WGSL change:** run `node scripts/compile-census.mjs`, update the golden snapshot
  (`npx vitest run march-golden -u`, and SAY so in the commit), and re-pin `scripts/march-hash.mjs` with the reason. The march
  shader once failed to compile from runtime-indexed arrays inside the fold: keep new WGSL scalar/vec only.
- WebGPU: in `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Facts this plan relies on (verified 2026-10-03)

- `MAX_WOUNDS = 16` (`damage.ts:8`). The literal 16 is also the loop bound in `fields/wounds.wgsl.ts` (applyWounds `:73`,
  woundMask `:269`), `fields/tissue.wgsl.ts:51`, `body/blocks/setup/wound-list.wgsl.ts:19`, `normal-gradient.wgsl.ts:289`, and
  the size of `var<private> gWoundList: array<i32, 16>` (`fields/groups.wgsl.ts:243`). `march/layout.test.ts:74` checks
  shader loop bounds against `MAX_WOUNDS`.
- `pushWound(ring, wound, cap)` (`damage.ts`) appends, keeps head slots (`MAX_HEAD_WOUNDS`), and evicts the oldest non-`keep`
  wound past `cap`. Every actor ring calls it (`webgpu/character-view.ts` `createWoundRing`). The soldier's visual list
  (`soldier-wounds.ts`) slices the last `MAX_WOUNDS`.
- Wound rows (`webgpu/march/layout.ts`): `ROW_WOUND` 5 (xyz anchor, w radius), `ROW_WOUND_META` 6 (x type id 0 pellet / 1
  blast / 2 burn, fraction = ragged; y age; z rim splay scale; w rim offset scale), `ROW_WOUND_CAP` 18 (xyz inward unit, w carve
  depth), `ROW_WOUND_FLAGS` 19 (x bits + threat fraction; y owner; zw prim span). `DATA_ROWS = 25`, pinned at
  `march/primitives.wgsl.test.ts:412` and in the golden snapshot.
- Flag bits (`webgpu/zombie-gpu.ts` `WOUND_FLAG`): cavity 1, hole 2, decal 4, tear 8, **wetLip 16**. The cut takes **32**.
- `META.x` for a cut must stay an integer in [0, 1.5) (fraction = ragged; > 1.5 = burn; < -0.5 = preset).
- `map-body.wgsl.ts` `gLimbSlack` (0.2 m) assumes no carve deeper than 0.16 m: a cut's depth is capped at `CUT.maxDepth` 0.15.
- The only packer is `writeWounds` (`zombie-gpu.ts`); `setWounds` forwards to it; `character-view.ts` `refresh` builds its
  arrays. Bone exposure on the default skeleton reads a SPHERE list (`game-main.ts` ~1690 and ~1735 `craters.push(...)`).
  Severing reads `w.severRadius ?? w.radius` (`connectivity.ts:58`): a cut sets `severRadius: 0`.
- The CPU body field `validate.ts sdBody` does not include wounds; shots trace the uncarved surface. Cuts follow that rule.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/damage.ts` | merge on overflow; `MAX_WOUNDS` 32; cut fields on `Wound`; `woundDirToWorld`, `worldDirToWoundLocal` |
| `src/lab/sdf-zombie/damage-merge.test.ts` | new |
| `src/lab/sdf-zombie/cut-wound.ts` | **new, pure**: `CUT`, `CUT_SHADE`, `ROD_CALIBRE`, `cutCarve`, `cutsFromSweep`, `stampCut`, `cutExposureSpheres` |
| `src/lab/sdf-zombie/cut-wound.test.ts` | new |
| `src/lab/sdf-zombie/webgpu/march/layout.ts` | `ROW_WOUND_CUT = 25`, `DATA_ROWS = 26` |
| WGSL: `fields/wounds.wgsl.ts`, `fields/tissue.wgsl.ts`, `fields/groups.wgsl.ts`, `body/blocks/setup/wound-list.wgsl.ts`, `normal-gradient.wgsl.ts` | loop bounds from `MAX_WOUNDS`; cut branch, cut footprint, cut fallback |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, `crowd-atlas.ts`, `character-view.ts` | cut upload |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | exposure spheres for cuts; rod wiring |
| `src/lab/sdf-zombie/webgpu/game-rod.ts` | **new**: the rod harness (slot 6) |
| `game-weapon-slots.ts`, `game-state-weapon.ts`, `game-loop-leaves.ts`, `game-panels-leaves.ts`, `game-seams-fire.ts` | slot 6 |
| `scripts/cut-wound-gate.mjs` | new capture gate |

---

## Task 1: Merge instead of evict (pure)

**Files:** Modify `src/lab/sdf-zombie/damage.ts` (`pushWound`). Test: create `src/lab/sdf-zombie/damage-merge.test.ts`.

When the ring is full, the oldest evictable wound is MERGED into the nearest other crater on the same prim if they are within
reach of each other (the survivor grows to cover both), so damage never visibly heals. Only when no such neighbour exists is the
oldest evicted, as today. Cuts are never merged (a slot is not a sphere).

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/damage-merge.test.ts
import { describe, expect, it } from 'vitest';
import { MERGE, pushWound, type Wound } from './damage';

const w = (id: number, primIdx: number, local: [number, number, number], radius = 0.05, extra: Partial<Wound> = {}): Wound =>
  ({ eventId: id, primIdx, local, radius, type: 'pellet', ageSec: 0, ...extra });

describe('pushWound merges instead of evicting', () => {
  it('a full ring merges the oldest crater into its nearest same-prim neighbour', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 0, [0.04, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring).toHaveLength(3);
    expect(ring.map(x => x.eventId)).not.toContain(1);
    const merged = ring.find(x => x.eventId === 2)!;
    expect(merged.local[0]).toBeCloseTo(0.02, 6);                 // radius-weighted centre of the two
    expect(merged.radius).toBeGreaterThanOrEqual(0.05 + 0.02 - 1e-9); // covers both originals
    expect(merged.radius).toBeLessThanOrEqual(MERGE.maxRadius);
  });
  it('with no same-prim neighbour in reach the oldest is evicted, exactly as before', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 1, [0, 0, 0]), w(3, 2, [0, 0, 0])];
    ring = pushWound(ring, w(4, 3, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
  });
  it('neighbours farther than MERGE.reach (times their radii) are not merged', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 0, [0.5, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
  });
  it('cuts are never merged and never absorb a crater', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0], 0.1, { shape: 'cut' }), w(2, 0, [0.02, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
    expect(ring.find(x => x.eventId === 2)!.radius).toBe(0.05);
  });
  it('a merged crater keeps the deeper carve and the larger sever calibre', () => {
    let ring: Wound[] = [
      w(1, 0, [0, 0, 0], 0.05, { carveDepth: 0.02, severRadius: 0.1, carveN: [0, 0, 1] }),
      w(2, 0, [0.03, 0, 0], 0.05, { carveDepth: 0.03, severRadius: 0.05, carveN: [0, 0, 1] }),
      w(3, 1, [0, 0, 0]),
    ];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    const merged = ring.find(x => x.eventId === 2)!;
    expect(merged.carveDepth).toBe(0.03);
    expect(merged.severRadius).toBe(0.1);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run damage-merge` → FAIL (`MERGE` not exported).

- [ ] **Step 3: Implement.** In `damage.ts`:

(a) Add to the `Wound` interface (after `wetLip?`), the cut fields Task 3 also uses:

```ts
  /** CUT (cut-wound.ts, 2026-10-03): a blade slot instead of a crater. `local` is the slot's MIDPOINT, `radius` its HALF-
   *  LENGTH (so every sphere bound stays a superset), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its
   *  along-segment unit (prim-local, same frame as `local`), `kerf` its half-width at the skin. Absent = a crater. */
  shape?: 'cut';
  cutDir?: Vec3;
  kerf?: number;
```

(b) Add above `pushWound`:

```ts
/** MERGE ON OVERFLOW (2026-10-03, owner: tough enemies' faces "reappear" when old wounds are evicted). */
export const MERGE = {
  /** Two craters on one prim merge when their centres are within this × (r1 + r2). */
  reach: 1.5,
  /** A merged crater never grows past this radius (m): a whole limb must not become one bowl. */
  maxRadius: 0.16,
} as const;

const localDist = (a: Wound, b: Wound): number =>
  Math.hypot(a.local[0] - b.local[0], a.local[1] - b.local[1], a.local[2] - b.local[2]);

/** The oldest wound at index `victim` folded into its nearest same-prim crater neighbour, or null when none is in reach. */
function mergeVictim(next: Wound[], victim: number): Wound[] | null {
  const v = next[victim]!;
  if (v.shape === 'cut' || v.decal) return null;
  let best = -1, bd = Infinity;
  next.forEach((o, i) => {
    if (i === victim || o.primIdx !== v.primIdx || o.shape === 'cut' || o.decal || o.type !== v.type) return;
    const d = localDist(v, o);
    if (d <= MERGE.reach * (v.radius + o.radius) && d < bd) { bd = d; best = i; }
  });
  if (best < 0) return null;
  const o = next[best]!;
  const wv = v.radius, wo = o.radius, k = wv / (wv + wo);
  const local: Vec3 = [o.local[0] + (v.local[0] - o.local[0]) * k, o.local[1] + (v.local[1] - o.local[1]) * k, o.local[2] + (v.local[2] - o.local[2]) * k];
  const radius = Math.min(MERGE.maxRadius, Math.max(wv, wo, (bd + wv + wo) / 2));
  const merged: Wound = { ...o, local, radius };
  if (v.carveDepth !== undefined || o.carveDepth !== undefined) merged.carveDepth = Math.max(v.carveDepth ?? 0, o.carveDepth ?? 0);
  if (v.severRadius !== undefined || o.severRadius !== undefined) merged.severRadius = Math.max(v.severRadius ?? v.radius, o.severRadius ?? o.radius);
  const out = [...next];
  out[best] = merged;
  out.splice(victim, 1);
  return out;
}
```

(c) In `pushWound`, replace the final cap loop

```ts
  while (next.length > cap) {
    const i = next.findIndex(x => x.headSlot !== 'keep');
    next.splice(i < 0 ? 0 : i, 1);
  }
  return next;
```
with
```ts
  let out = next;
  while (out.length > cap) {
    const i = out.findIndex(x => x.headSlot !== 'keep');
    const victim = i < 0 ? 0 : i;
    out = mergeVictim(out, victim) ?? (out.splice(victim, 1), out);
  }
  return out;
```

- [ ] **Step 4: Run** — `npx vitest run damage-merge damage.test soldier-wounds character-view` → PASS. If an existing
  eviction test fails because two of its fixture wounds share a prim and now merge, check the test's intent: if it pins
  eviction ORDER with wounds that would now merge, give those fixtures distinct `primIdx` (merging is the new rule); do not
  weaken an assertion about which wounds survive otherwise. List any such change in the commit message.

- [ ] **Step 5: Commit** — `git commit -m "feat(damage): a full wound ring merges old craters instead of dropping them"`.

---

## Task 2: Raise the wound limit to 32

**Files:** `damage.ts` (`MAX_WOUNDS`), `webgpu/march/fields/wounds.wgsl.ts`, `fields/tissue.wgsl.ts`, `fields/groups.wgsl.ts`,
`body/blocks/setup/wound-list.wgsl.ts`, `normal-gradient.wgsl.ts`, their tests, the golden snapshot, `scripts/march-hash.mjs`.

- [ ] **Step 1: Baseline numbers before touching anything.** Cold boot and frame cost on the base build:

```bash
node scripts/boot-time.mjs 2>&1 | tail -5
node scripts/compile-census.mjs 2>&1 | tail -5
```
Record both outputs in `docs/dev-notes/2026-10-03-cut-wounds/NOTES.md` (create it). If `boot-time.mjs` needs servers, start
them as its header says and stop them after.

- [ ] **Step 2: Interpolate every literal 16 wound bound from `MAX_WOUNDS`.** Each of these WGSL modules already builds its
  string in TS; import `MAX_WOUNDS` from `'../../../damage'` (adjust the relative path per file) and replace:
  - `fields/wounds.wgsl.ts`: `for (var k = 0; k < 16; k = k + 1)` → `for (var k = 0; k < ${MAX_WOUNDS}; k = k + 1)` and
    `for (var i = 0; i < 16; i = i + 1)` (woundMask) → `... < ${MAX_WOUNDS} ...`;
  - `fields/tissue.wgsl.ts:51`, `body/blocks/setup/wound-list.wgsl.ts:19`, `normal-gradient.wgsl.ts:289`: the same;
  - `fields/groups.wgsl.ts:243`: `array<i32, 16>` → `array<i32, ${MAX_WOUNDS}>`.
  Run `grep -rn "< 16\|i32, 16>" src/lab/sdf-zombie/webgpu/march src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts` — expect no
  wound loop left (the `light.wgsl.ts` debug compare and `trace.wgsl.ts` `missNear < 16.0` are not wound bounds; leave them).
  Update `fields/wounds.wgsl.test.ts:73`'s `indexOf('for (var k = 0; k < 16; k = k + 1)')` to use `${MAX_WOUNDS}`.

- [ ] **Step 3: Raise the limit.** `damage.ts`: `export const MAX_WOUNDS = 32;` (keep its comment "Must match MAX_WOUNDS in the
  fragment shader" — now true by construction).

- [ ] **Step 4: Tests and shader checks**

```bash
npx vitest run layout wounds.wgsl wound-list march-step-soundness normal-gradient damage soldier-wounds write-wounds zombie-gpu crowd
npx vitest run march-golden -u
node scripts/compile-census.mjs 2>&1 | tail -5
npx tsc --noEmit
```
Expected: tests PASS (the golden snapshot is rewritten — that is the point; say so in the commit), the census reports the
march pipelines compile, tsc shows only the `node:crypto` line. A test pinning "16" as a literal for wounds is updated to
`MAX_WOUNDS`; a test pinning 16 for something else is left alone.

- [ ] **Step 5: Boot time and cost after.** Re-run Step 1's commands. **Acceptance:** compile census passes; cold-boot
  `drawOnce` within the base's own run-to-run spread + 10%. If boot regresses beyond that, try `MAX_WOUNDS = 24` and re-measure;
  record both in NOTES. Then `node scripts/march-hash.mjs` and re-pin it with the reason "wound loop bound 16 → 32".

- [ ] **Step 6: Commit** — `git commit -m "feat(wounds): 32 wounds per body (loop bounds from MAX_WOUNDS; golden -u, march-hash re-pinned)"`.

---

## Task 3: `cut-wound.ts` — the cut's geometry, sweep and stamp (pure)

**Files:** Create `src/lab/sdf-zombie/cut-wound.ts`, `src/lab/sdf-zombie/cut-wound.test.ts`; modify `damage.ts` (direction
helpers).

- [ ] **Step 1: Direction helpers in `damage.ts`** (after `woundCarveNormal`):

```ts
/** A prim-local direction of `wound` (same frame as `local` / `carveN`) in world space. */
export function woundDirToWorld(prims: Primitive[], wound: Wound, local: Vec3, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  return add(add(scale(u, local[0]), scale(v, local[1])), scale(w, local[2]));
}

/** A world direction in `wound`'s prim-local frame (the inverse of woundDirToWorld). */
export function worldDirToWoundLocal(prims: Primitive[], wound: Wound, dir: Vec3, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  return [dot(dir, u), dot(dir, v), dot(dir, w)];
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lab/sdf-zombie/cut-wound.test.ts
import { describe, expect, it } from 'vitest';
import { CUT, ROD_CALIBRE, cutCarve, cutExposureSpheres, cutsFromSweep, stampCut } from './cut-wound';
import { woundDirToWorld, woundWorldPos } from './damage';
import { prim } from './head-pop';
import { sdBody } from './validate';
import type { Primitive, Vec3 } from './types';

// A torso-like capsule (cluster 1) and an arm (cluster 2), both along +y.
const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
const arm = prim([0.4, 1.0, 0], [0.4, 1.5, 0], 0.05, [1, 1, 1], { limb: 'arm', cluster: 2 });
const prims: Primitive[] = [torso, arm];
const body = { prims, clusters: [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
const field = (p: Vec3) => sdBody(p, body);
const mid: Vec3 = [0, 1.25, 0.15];
const along: Vec3 = [0, 1, 0], inward: Vec3 = [0, 0, -1];

describe('cutCarve (the CPU mirror of the WGSL slot)', () => {
  const at = (a: number, s: number, u: number): Vec3 => [u, mid[1] + a, mid[2] - s];
  it('is inside (positive) along the slot centre down to most of its depth, at the middle', () => {
    expect(cutCarve(at(0, 0.03, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
  });
  it('is outside past the kerf, past the floor and past the ends', () => {
    expect(cutCarve(at(0, 0.01, 0.02), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
    expect(cutCarve(at(0, 0.07, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
    expect(cutCarve(at(0.11, 0.0, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
  it('is a lens: deepest at the middle, shallow near the ends', () => {
    expect(cutCarve(at(0, 0.05, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
    expect(cutCarve(at(0.09, 0.05, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
  it('the walls close into a V: wider at the skin than near the floor', () => {
    expect(cutCarve(at(0, 0.005, 0.007), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
    expect(cutCarve(at(0, 0.05, 0.007), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
});

describe('cutsFromSweep', () => {
  const view: Vec3 = [0, 0, -1];
  const sample = (x: number, y: number, z = 0.15) => ({ point: [x, y, z] as Vec3, view });
  it('one segment from first to last sample on one cluster, normal = sweep × view', () => {
    const segs = cutsFromSweep(prims, [sample(0, 1.15), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.15, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.35, 9);
    expect(Math.abs(segs[0]!.normal[0])).toBeCloseTo(1, 6);   // (0,1,0) × (0,0,-1) = (-1,0,0)
  });
  it('splits by cluster: a sweep across the arm and the torso is two cuts', () => {
    const segs = cutsFromSweep(prims, [sample(0.4, 1.2, 0.05), sample(0.4, 1.3, 0.05), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(2);
  });
  it('drops segments shorter than CUT.minLen and clamps to CUT.maxLen about the midpoint', () => {
    expect(cutsFromSweep(prims, [sample(0, 1.25), sample(0, 1.26)])).toHaveLength(0);
    const long = cutsFromSweep(prims, [sample(0, 0.9), sample(0, 1.6)])[0]!;
    expect(Math.hypot(long.b[0] - long.a[0], long.b[1] - long.a[1], long.b[2] - long.a[2])).toBeCloseTo(CUT.maxLen, 6);
  });
  it('never returns more than CUT.maxPerSlash cuts', () => {
    expect(CUT.maxPerSlash).toBe(3);
  });
});

describe('stampCut', () => {
  const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, normal: [-1, 0, 0] as Vec3 };
  const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
  it('is a cut on the torso: midpoint anchor, half-length radius, no sever, wet lip', () => {
    expect(w.shape).toBe('cut');
    expect(w.primIdx).toBe(0);
    expect(w.radius).toBeCloseTo(0.1, 6);
    expect(w.severRadius).toBe(0);
    expect(w.wetLip).toBe(1);
    const p = woundWorldPos(prims, w, 0);
    expect(p[1]).toBeCloseTo(1.25, 3);
    expect(Math.abs(field(p))).toBeLessThan(0.002);           // on the skin
  });
  it('its along direction is the sweep, its inward points into the body, depth is capped', () => {
    const along = woundDirToWorld(prims, w, w.cutDir!, 0);
    expect(Math.abs(along[1])).toBeCloseTo(1, 3);
    const inw = woundDirToWorld(prims, w, w.carveN!, 0);
    expect(inw[2]).toBeLessThan(-0.9);
    expect(w.carveDepth!).toBeLessThanOrEqual(Math.min(ROD_CALIBRE.depth, CUT.maxDepth) + 1e-9);
    expect(w.kerf).toBe(ROD_CALIBRE.kerf);
  });
});

describe('cutExposureSpheres (for the sphere-only bone exposure)', () => {
  it('a chain of spheres along the slot, a single sphere for a crater', () => {
    const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, normal: [-1, 0, 0] as Vec3 };
    const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
    const s = cutExposureSpheres(prims, w, 0);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...s.map(x => x.pos[1]))).toBeLessThan(1.18);
    expect(Math.max(...s.map(x => x.pos[1]))).toBeGreaterThan(1.32);
    const crater = { primIdx: 0, local: w.local, radius: 0.05, type: 'pellet' as const, ageSec: 0, axis0: w.axis0 };
    expect(cutExposureSpheres(prims, crater, 0)).toEqual([{ pos: woundWorldPos(prims, crater, 0), radius: 0.05 }]);
  });
});
```

- [ ] **Step 3: Run** — `npx vitest run cut-wound` → FAIL (module missing).

- [ ] **Step 4: Implement**

```ts
// src/lab/sdf-zombie/cut-wound.ts
//
// CUT WOUNDS (spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §3-4). Pure. A cut is a wound SHAPE beside the
// crater: a blade SLOT along a segment, deepest at its middle (a lens), its walls closing into a V, jagged and lipped on the
// GPU. It rides one prim exactly like a crater: `local` is its midpoint, `radius` its HALF-LENGTH (every sphere bound the
// wound pipeline keeps stays a superset), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its along-segment
// unit, `kerf` its half-width at the skin. `cutCarve` is the CPU mirror of the WGSL slot (applyWounds' cut branch) for tests
// and docs; keep the two identical apart from the GPU's noise.
import { WOUND_CARVE_DEPTH_FRAC, worldDirToWoundLocal, woundDirToWorld, woundWorldPos, worldHitToWound, type Wound } from './damage';
import { sdPrimitive } from './validate';
import { add, cross, dot, normalize, scale, sub } from './vec';
import type { Primitive, Vec3 } from './types';

export const CUT = {
  minLen: 0.03,
  maxLen: 0.35,
  maxPerSlash: 3,
  /** map-body.wgsl.ts gLimbSlack (0.2 m) assumes no carve deeper than 0.16 m. */
  maxDepth: 0.15,
  /** A cut may reach this share of the flesh measured behind its midpoint. */
  thickFrac: 0.8,
} as const;

/** The WGSL slot's look constants (interpolated into fields/wounds.wgsl.ts like torn-lips.ts's TORN). */
export const CUT_SHADE = {
  /** Jagged walls: noise frequency (1/m) and how much it widens or narrows the kerf. */
  jagFreq: 90,
  jagAmp: 0.35,
  /** Field scale for the slot (its walls are steep; < 1 keeps the march safe, the zero set unchanged). */
  carveK: 0.7,
  /** Lip: centre offset from the slot axis, width and height, all × kerf; height also × META.z (rim splay scale). */
  lipOffset: 1.5,
  lipWidth: 1.2,
  lipHeight: 0.9,
  /** The shading mask's soft edge, × kerf. */
  maskWidth: 2.2,
} as const;

export interface CutCalibre { depth: number; kerf: number; lip: number }
/** The rod stand-in's blade (tunable). */
export const ROD_CALIBRE: CutCalibre = { depth: 0.06, kerf: 0.01, lip: 1 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const unit = (v: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 => (Math.hypot(v[0], v[1], v[2]) > 1e-9 ? normalize(v) : fb);

/** The slot's inside-positive carve term at `p` (no noise): the CPU mirror of applyWounds' cut branch. */
export function cutCarve(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, jag = 0): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), s = dot(rel, inward), u = dot(rel, side);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const prof = 1 - tN * tN;
  const depthT = Math.max(depth * prof, 1e-4);
  const kerfT = kerf * (1 + jag) * (0.35 + 0.65 * Math.sqrt(prof));
  const vWall = kerfT * (1 - clamp(s, 0, depthT) / depthT) - Math.abs(u);
  return Math.min(vWall, depthT - s, halfLen - Math.abs(a)) * CUT_SHADE.carveK;
}

export interface SweepSample { point: Vec3; view: Vec3 }
export interface CutSeg { a: Vec3; b: Vec3; normal: Vec3 }

function nearestCluster(prims: readonly Primitive[], p: Vec3): number {
  let best = -1, bd = Infinity;
  for (const q of prims) {
    if (q.dead || q.op === 'sub' || q.op === 'groove' || q.op === 'bone' || q.op === 'organ') continue;
    const d = sdPrimitive(p, q);
    if (d < bd) { bd = d; best = q.cluster ?? 0; }
  }
  return best;
}

/** A blade's sweep (surface hits in order, with the view direction of each) → at most CUT.maxPerSlash segments, one per
 *  run of consecutive samples on the same cluster, clamped to CUT.maxLen about its midpoint; shorter than minLen: dropped. */
export function cutsFromSweep(prims: readonly Primitive[], samples: readonly SweepSample[]): CutSeg[] {
  const runs: SweepSample[][] = [];
  let last = Number.NaN;
  for (const s of samples) {
    const c = nearestCluster(prims, s.point);
    if (c !== last || runs.length === 0) { runs.push([]); last = c; }
    runs[runs.length - 1]!.push(s);
  }
  const out: CutSeg[] = [];
  for (const run of runs) {
    if (out.length >= CUT.maxPerSlash || run.length < 2) continue;
    let a = run[0]!.point, b = run[run.length - 1]!.point;
    const d = sub(b, a), l = Math.hypot(d[0], d[1], d[2]);
    if (l < CUT.minLen) continue;
    if (l > CUT.maxLen) {
      const m = scale(add(a, b), 0.5), h = scale(d, CUT.maxLen / (2 * l));
      a = sub(m, h); b = add(m, h);
    }
    const view = unit(run.reduce((acc, s) => add(acc, s.view), [0, 0, 0] as Vec3), [0, 0, -1]);
    out.push({ a, b, normal: unit(cross(sub(b, a), view)) });
  }
  return out;
}

function grad(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = 1e-3;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ]);
}

/** Walk `p` onto the zero set along the field's gradient (the chord's midpoint sits inside a convex surface). */
function toSurface(field: (p: Vec3) => number, p: Vec3): Vec3 {
  let q = p;
  for (let i = 0; i < 12; i++) {
    const d = field(q);
    if (Math.abs(d) < 2e-4) break;
    q = sub(q, scale(grad(field, q), d));
  }
  return q;
}

/** One cut wound from a segment on the body (world space at `bodyYaw`). */
export function stampCut(prims: Primitive[], seg: CutSeg, calibre: CutCalibre, bodyYaw: number, field: (p: Vec3) => number): Wound {
  const d = sub(seg.b, seg.a);
  const len = Math.min(CUT.maxLen, Math.hypot(d[0], d[1], d[2]));
  const anchor = toSurface(field, scale(add(seg.a, seg.b), 0.5));
  const w = worldHitToWound(prims, anchor, len / 2, 'pellet', bodyYaw, field);
  if (!w.carveN) {
    w.carveN = worldDirToWoundLocal(prims, w, scale(grad(field, anchor), -1), bodyYaw);
    w.carveDepth = calibre.depth * WOUND_CARVE_DEPTH_FRAC;
  }
  const inward = unit(woundDirToWorld(prims, w, w.carveN, bodyYaw));
  const thick = (w.carveDepth ?? calibre.depth * WOUND_CARVE_DEPTH_FRAC) / WOUND_CARVE_DEPTH_FRAC;
  const alongW = unit(sub(d, scale(inward, dot(d, inward))));
  w.shape = 'cut';
  w.carveDepth = Math.min(calibre.depth, CUT.maxDepth, thick * CUT.thickFrac);
  w.cutDir = worldDirToWoundLocal(prims, w, alongW, bodyYaw);
  w.kerf = calibre.kerf;
  w.rimScale = (w.rimScale ?? 1) * calibre.lip;
  w.severRadius = 0;
  w.wetLip = 1;
  return w;
}

/** The sphere list the bone-exposure consumers read (they know only craters): a crater is itself; a cut is a chain of
 *  spheres along its slot, radius max(depth, 2 kerf), spaced by that radius. */
export function cutExposureSpheres(prims: Primitive[], w: Wound, bodyYaw: number): { pos: Vec3; radius: number }[] {
  const c = woundWorldPos(prims, w, bodyYaw);
  if (w.shape !== 'cut' || !w.cutDir) return [{ pos: c, radius: w.radius }];
  const along = unit(woundDirToWorld(prims, w, w.cutDir, bodyYaw));
  const r = Math.max(w.carveDepth ?? 0.03, 2 * (w.kerf ?? 0.01));
  const n = Math.max(2, Math.ceil((2 * w.radius) / r));
  const out: { pos: Vec3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ pos: add(c, scale(along, -w.radius + (2 * w.radius * i) / n)), radius: r });
  return out;
}
```

- [ ] **Step 5: Run** — `npx vitest run cut-wound damage` → PASS. If the `toSurface` test (`|field(p)| < 0.002`) misses
  narrowly, raise the iteration count; do not loosen the bound past 2 mm.

- [ ] **Step 6: Commit** — `git commit -m "feat(cut-wound): pure cut geometry, sweep → segments, stamping, exposure spheres"`.

---

## Task 4: Upload a cut (one new row, flag 32)

**Files:** `webgpu/march/layout.ts`, `webgpu/zombie-gpu.ts`, `webgpu/crowd-atlas.ts`, `webgpu/character-view.ts`, tests
`march/primitives.wgsl.test.ts`, `write-wounds.test.ts`, the golden snapshot.

- [ ] **Step 1: Write the failing test** — append to `src/lab/sdf-zombie/webgpu/write-wounds.test.ts` (read its imports first
  and reuse its texel helpers; add `ROW_WOUND_CUT` to the layout import):

```ts
describe('cut wounds (flag 32, ROW_WOUND_CUT)', () => {
  it('writes the along unit and kerf into ROW_WOUND_CUT and sets flag bit 32', () => {
    const stride = 128;
    const texels = new Float32Array(DATA_ROWS * stride * 4);
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0], [1], [1], { stride }, [{ n: [0, 0, -1], depth: 0.05 }],
      undefined, undefined, undefined, undefined, undefined, undefined, [true],
      [{ dir: [0, 1, 0], kerf: 0.01 }]);
    const cut = ROW_WOUND_CUT * stride * 4;
    expect([...texels.subarray(cut, cut + 4)]).toEqual([0, 1, 0, Math.fround(0.01)]);
    const flags = ROW_WOUND_FLAGS * stride * 4;
    expect(Math.floor(texels[flags]!) & 32).toBe(32);
    expect(Math.floor(texels[flags]!) & 16).toBe(16);   // and its wet lip
  });
  it('a crater leaves ROW_WOUND_CUT untouched and has no bit 32', () => {
    const stride = 128;
    const texels = new Float32Array(DATA_ROWS * stride * 4);
    writeWounds(texels, [[0, 1, 0]], [0.05], [0], [0], undefined, undefined, { stride });
    expect(Math.floor(texels[ROW_WOUND_FLAGS * stride * 4]!) & 32).toBe(0);
    expect(texels[ROW_WOUND_CUT * stride * 4 + 3]).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run write-wounds` → FAIL.

- [ ] **Step 3: Implement**

(a) `layout.ts`: `export const DATA_ROWS = 26;` and, after `ROW_PREV_QUAT`:

```ts
/** CUT WOUNDS (cut-wound.ts, 2026-10-03): xyz = the cut's along-segment unit (world, rotated out by the uploader),
 *  w = kerf (half-width at the skin, m). Read only for wounds with ROW_WOUND_FLAGS.x bit 5 (value 32). For a cut,
 *  ROW_WOUND is (midpoint, half-length) and ROW_WOUND_CAP is (inward unit, depth). */
export const ROW_WOUND_CUT = 25;
```
Update `march/primitives.wgsl.test.ts:412`'s pinned 25 to 26.

(b) `zombie-gpu.ts`:
- `WOUND_FLAG`: add `cut: 32`; `woundFlagBits` gains `cut?: boolean` (`+ (f.cut ? WOUND_FLAG.cut : 0)`); its comment "integer
  <= 31" becomes "<= 63".
- `WriteWoundsLayout`: add `/** Row index for the cut texels (was ROW_WOUND_CUT). */ cutRow?: number;`
- `writeWounds`: append a parameter after `wetLips`:
```ts
  /** Per-wound CUT data (cut-wound.ts): ROW_WOUND_CUT = (along unit, kerf) and flags bit 5 (value 32).
   *  Omitted or null per wound = a crater. */
  cuts?: readonly ({ dir: Vec3; kerf: number } | null)[],
```
  inside the loop, before the flags write, add
```ts
    const cut = cuts?.[i];
    if (cut) {
      const cutBase = (layout.cutRow ?? ROW_WOUND_CUT) * stride * 4;
      texels[cutBase + i * 4] = cut.dir[0];
      texels[cutBase + i * 4 + 1] = cut.dir[1];
      texels[cutBase + i * 4 + 2] = cut.dir[2];
      texels[cutBase + i * 4 + 3] = cut.kerf;
    }
```
  and pass `cut: !!cut` into the `woundFlagBits({...})` call. Import `ROW_WOUND_CUT` with the other rows.
- The `setWounds` interface (near line 105) gains a last optional parameter
  `/** Per-wound cut data (cut-wound.ts). Omitted = craters. */ cuts?: readonly ({ dir: Vec3; kerf: number } | null)[]`, and the
  implementation (near line 2899) takes `cuts` and passes it as the new last argument of `writeWounds`.
- The per-body wound layout: run `grep -n "capRow:" src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/crowd-atlas.ts`
  and beside every `capRow: ... ROW_WOUND_CAP` add `cutRow: <same base> + ROW_WOUND_CUT` (crowd-atlas: `cutRow: r0 + ROW_WOUND_CUT`;
  its `woundLayout` type at `crowd-atlas.ts:28` gains `cutRow: number`).

(c) `character-view.ts` `refresh`: import `woundDirToWorld` from `'../damage'`; pass, as the new last argument of
`gpu.setWounds(...)`:
```ts
        // CUT WOUNDS (cut-wound.ts): the along unit rides the same transform as the cap normal.
        rows.map(w => (w.shape === 'cut' && w.cutDir
          ? { dir: map(woundDirToWorld(posed.prims, w, w.cutDir, bodyYaw), w, true), kerf: w.kerf ?? 0.01 }
          : null)),
```

- [ ] **Step 4: Run** — `npx vitest run write-wounds layout primitives.wgsl crowd zombie-gpu character-view` then
  `npx vitest run march-golden -u` and `npx tsc --noEmit`. PASS (golden rewritten: `DATA_ROWS` is spliced into shader text).

- [ ] **Step 5: Commit** — `git commit -m "feat(wounds): upload cut wounds (ROW_WOUND_CUT, flag 32; DATA_ROWS 26; golden -u)"`.

---

## Task 5: The cut in WGSL (carve, mask, normals)

**Files:** `webgpu/march/fields/wounds.wgsl.ts`, `webgpu/normal-gradient.wgsl.ts`, their tests, golden, march-hash.

- [ ] **Step 1: Write the failing text tests** — append to `webgpu/march/fields/wounds.wgsl.test.ts`:

```ts
describe('cut wounds in the march', () => {
  it('applyWounds has a cut branch (flag 32) before the preset branch, reading ROW_WOUND_CUT', () => {
    const iCut = APPLY_WOUNDS.indexOf('(i32(wFlags.x) & 32) != 0');
    const iPreset = APPLY_WOUNDS.indexOf('if (wMeta.x < -0.5)');
    expect(iCut).toBeGreaterThan(0);
    expect(iCut).toBeLessThan(iPreset);
    expect(APPLY_WOUNDS).toContain(`${ROW_WOUND_CUT} + band`);
  });
  it('woundMask paints a cut footprint and skips the radial one for it', () => {
    expect(WOUND_MASK).toContain('(fBits & 32) != 0');
    expect(WOUND_MASK).toContain(`${ROW_WOUND_CUT} + gBand`);
  });
});
```
and to `webgpu/normal-gradient.wgsl.test.ts`:
```ts
it('ngWounds falls back to calcNormal taps for a cut (flag 32)', () => {
  expect(NG_WOUNDS).toContain('(i32(flagsRow.x) & 32) != 0');
});
```
(add `ROW_WOUND_CUT`, `WOUND_MASK`, `NG_WOUNDS` to those files' imports as needed.)

- [ ] **Step 2: Run** — `npx vitest run wounds.wgsl normal-gradient.wgsl` → FAIL.

- [ ] **Step 3: Implement**

(a) `fields/wounds.wgsl.ts`: import `ROW_WOUND_CUT` from `'../layout'` and `CUT_SHADE` from `'../../../cut-wound'`. In
APPLY_WOUNDS, immediately after the line `let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);` and BEFORE
`if (wMeta.x < -0.5) {`, insert:

```wgsl
    // CUT (cut-wound.ts, flag 32): a blade SLOT instead of a sphere. ROW_WOUND = (midpoint, half-length), CAP = (inward,
    // depth), ROW_WOUND_CUT = (along unit, kerf). A lens along the segment (deepest mid-way), walls closing into a V, the
    // kerf jagged by scalar noise, lips along both edges. MIRRORED by cut-wound.ts cutCarve (no noise there).
    if ((i32(wFlags.x) & 32) != 0) {
      let wCut = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CUT} + band), 0);
      let rel = p - w.xyz;
      let side = cross(wCut.xyz, wCap.xyz);
      let ca = dot(rel, wCut.xyz);
      let cs = dot(rel, wCap.xyz);
      let cu = dot(rel, side);
      let tN = clamp(ca / max(w.w, 1e-4), -1.0, 1.0);
      let prof = 1.0 - tN * tN;
      let depthT = max(wCap.w * prof, 1e-4);
      let jag = noise3(rel * ${f(CUT_SHADE.jagFreq)} + vec3<f32>(w.w * 311.0, wCut.w * 977.0, 17.0)) * ${f(CUT_SHADE.jagAmp)};
      let kerfT = wCut.w * (1.0 + jag) * (0.35 + 0.65 * sqrt(prof));
      let vWall = kerfT * (1.0 - clamp(cs, 0.0, depthT) / depthT) - abs(cu);
      let carve = min(min(vWall, depthT - cs), w.w - abs(ca)) * ${f(CUT_SHADE.carveK)};
      let dBeforeCut = d;
      d = smax(d, carve, woundCfg.y * clamp(wCut.w / 0.05, 0.1, 1.0));
      if (d > dBeforeCut) { gWoundRaisers = gWoundRaisers | (1u << u32(owner)); gWoundThreat = gWoundThreat | threat; }
      let lipW = wCut.w * ${f(CUT_SHADE.lipWidth)};
      if (abs(ca) < w.w * 1.2 && abs(cu) < (wCut.w * ${f(CUT_SHADE.lipOffset)} + lipW) * 2.0 && cs < depthT * 2.0) { near = 1.0; }
      let lx = (abs(cu) - wCut.w * ${f(CUT_SHADE.lipOffset)}) / max(lipW, 1e-4);
      let cutAmp = wCut.w * ${f(CUT_SHADE.lipHeight)} * wMeta.z * prof;
      if (gWoundCluster == 0.0) { gWoundAmp[u32(owner)] = gWoundAmp[u32(owner)] + cutAmp; }
      let cutRim = 1.0 - smoothstep(-cutAmp * 0.3, cutAmp * 0.7, dIn);
      d = d - exp(-lx * lx) * cutAmp * cutRim * step(abs(ca), w.w);
      continue;
    }
```

In WOUND_MASK, immediately after `let fBits = i32(flags.x);` insert:

```wgsl
    // CUT (flag 32): the slot's footprint — a band either side of the segment, not a disc (see applyWounds' cut branch).
    if ((fBits & 32) != 0) {
      let cCap = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP} + gBand), 0);
      let cCut = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CUT} + gBand), 0);
      let crel = p - w.xyz;
      let cside = cross(cCut.xyz, cCap.xyz);
      let cA = abs(dot(crel, cCut.xyz));
      let cU = abs(dot(crel, cside));
      let cC = (1.0 - smoothstep(cCut.w, cCut.w * ${f(CUT_SHADE.maskWidth)}, cU)) * (1.0 - smoothstep(w.w * 0.85, w.w * 1.15, cA));
      m = max(m, cC);
      if ((fBits & 24) != 0) { gWoundTear = max(gWoundTear, cC); }
      if ((fBits & 24) == 16) { gWoundWetOnly = max(gWoundWetOnly, cC); }
      continue;
    }
```
(WOUND_MASK must import `ROW_WOUND_CAP` too if it does not already; the file imports it at the top.)

(b) `normal-gradient.wgsl.ts` NG_WOUNDS: after the decal line
`if ((i32(flagsRow.x) & 4) != 0) { continue; }` insert:
```wgsl
    // CUT (flag 32): the slot has no analytic gradient here — take calcNormal's taps, like torn.
    if ((i32(flagsRow.x) & 32) != 0) { gNgReason = 1; return d; }
```

- [ ] **Step 4: Run tests and shader checks**

```bash
npx vitest run wounds.wgsl normal-gradient march-step-soundness march-wound-list carves.wgsl torn-lips
npx vitest run march-golden -u
node scripts/compile-census.mjs 2>&1 | tail -5
npx tsc --noEmit
```
Expected PASS; census compiles. `march-step-soundness.test.ts` pins applyWounds lines (`:170-180`): if the pin moved because
the cut branch sits above them, update the pinned text to the same lines at their new place (the crater math is unchanged).

- [ ] **Step 5: Re-pin march-hash** — `node scripts/march-hash.mjs`, update its pin with reason "cut wound branch (flag 32)".
- [ ] **Step 5b: Boot time** — re-run `node scripts/boot-time.mjs` (as in Task 2 Step 1) and record it beside Task 2's numbers in
  NOTES. Acceptance: within the base's run-to-run spread + 10% of Task 2's result. A regression here is the cut branch's
  compile cost: report it with the numbers rather than shipping it silently.

- [ ] **Step 6: Commit** — `git commit -m "feat(march): cut wounds — slot carve, lips, mask, normal fallback (golden -u, march-hash re-pinned)"`.

---

## Task 6: Bones show inside cuts

**Files:** `src/lab/sdf-zombie/webgpu/game-main.ts` (the two crater lists for bone exposure).

- [ ] **Step 1:** Import `cutExposureSpheres` from `'../cut-wound'`. In both places that build `craters` from
  `a.visualWounds()` (`grep -n "craters.push({ pos: woundWorldPos" src/lab/sdf-zombie/webgpu/game-main.ts` — two hits), replace
  ```ts
  for (const w of a.visualWounds()) if (!w.decal) craters.push({ pos: woundWorldPos(prims, w, ctx.vfx.boundedWoundPreview ? a.pose().yaw : 0), radius: w.radius });
  ```
  with
  ```ts
  for (const w of a.visualWounds()) if (!w.decal) craters.push(...cutExposureSpheres(prims, w, ctx.vfx.boundedWoundPreview ? a.pose().yaw : 0));
  ```
  (`cutExposureSpheres` returns exactly `[{ pos: woundWorldPos(...), radius }]` for a crater — Task 3 pins that.)
- [ ] **Step 2:** `npx tsc --noEmit` and `npx vitest run cut-wound game-context-coverage` → clean / PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat(skeleton): bones are exposed along cut wounds"`.

---

## Task 7: The rod (weapon slot 6)

**Files:** create `src/lab/sdf-zombie/webgpu/game-rod.ts`; modify `game-weapon-slots.ts`, `game-state-weapon.ts`,
`game-loop-leaves.ts`, `game-panels-leaves.ts`, `game-main.ts`, `game-seams-fire.ts`, and `game-weapon-slots.test.ts`.

- [ ] **Step 1: The slot.** `game-weapon-slots.ts`: `WeaponSlot` gains `'rod'`; `WEAPON_SLOTS` appends `'rod'`;
  `SLOT_BY_KEY` adds `Digit6: 'rod'`; extend the slot-order comment ("6 → rod, the cut-wound stand-in blade"). Update
  `game-weapon-slots.test.ts` where it pins the slot list or keys. `game-loop-leaves.ts` `ownsSlot`: `slot === 'flare'` →
  `slot === 'flare' || slot === 'rod'` (both dev harnesses: always owned). `game-panels-leaves.ts`: before
  `: S.live === 'flare'` add `: S.live === 'rod' ? '6 ROD (hold + sweep to cut)'`.
- [ ] **Step 2: State.** `game-state-weapon.ts`: `import type { RodHarness } from './game-rod';`, a field
  `/** Slot 6 (the rod, cut-wound stand-in blade, game-rod.ts); null until the aim rig exists. */ rod: RodHarness | null;`,
  and `rod: null,` in its initialiser.
- [ ] **Step 3: The harness.**

```ts
// src/lab/sdf-zombie/webgpu/game-rod.ts
//
// WEAPON SLOT 6: THE ROD (cut wounds M1, spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §5). A stand-in blade:
// hold the left button and sweep the crosshair across a body; the rod swings with the sweep; on release the sweep's hits
// on each body become cut wounds (cut-wound.ts cutsFromSweep → stampCut). The real axe / sword / chainsaw call the same
// `cut`. Built like the flare harness (game-flare.ts): its own rig on aimRig, edges consumed by the tick.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { ROD_CALIBRE, cutsFromSweep, stampCut, type CutCalibre, type CutSeg, type SweepSample } from '../cut-wound';

export const ROD = {
  /** Only hits within this of the eye count (a melee reach). */
  reach: 2.2,
  /** Rest pose in view (m) and the swing's degrees per radian of sweep. */
  rest: new THREE.Vector3(0.12, -0.16, -0.36),
  swingGain: 1.6,
  /** Sweep samples kept (one per frame). */
  maxSamples: 90,
} as const;

export interface RodDeps {
  traceSlugHitFrom(origin: Vec3, dir: Vec3): { actorId: number; hit: Vec3 | null };
  eye(): Vec3;
  aimDir(): Vec3;
  /** registerBleed for a cut's midpoint. */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3): void;
}

export interface RodHarness {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Per frame: sample the sweep while held, cut on release, pose the rod. */
  tick(dt: number): void;
  updateRig(): void;
  /** Cut `actorId` along a→b (world) with blade-plane normal `normal` (console seam / gates). Returns the wounds stamped. */
  cut(actorId: number, a: Vec3, b: Vec3, normal: Vec3, calibre?: Partial<CutCalibre>): number;
  /** The last sweep's samples (debug / gates). */
  debug(): { held: boolean; samples: number; lastCuts: number };
}

export function createRodHarness(ctx: GameContext, deps: RodDeps): RodHarness {
  const rig = new THREE.Group();
  rig.name = 'rod-rig';
  ctx.weapon.aimRig!.add(rig);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.9 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 12), steel);
  rod.rotation.x = Math.PI / 2;            // cylinder axis → view -Z
  rod.position.set(0, 0, -0.25);
  const pivot = new THREE.Group();
  pivot.add(rod);
  pivot.position.copy(ROD.rest);
  rig.add(pivot);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  let held = false, release = false;
  let yaw0 = 0, pitch0 = 0;
  const samples = new Map<number, SweepSample[]>();
  let lastCuts = 0;

  function cutActor(a: ZombieActor, segs: CutSeg[], calibre: CutCalibre): number {
    if (!segs.length) return 0;
    const posed = a.posed();
    const field = (q: Vec3) => sdBody(q, posed);
    const yaw = a.pose().yaw;
    const wounds = segs.map(s => stampCut(posed.prims, s, calibre, yaw, field));
    a.blast({ wounds, meterCredit: 0, impulse: null, reaction: 'flinch' });
    for (let i = 0; i < wounds.length; i++) {
      const s = segs[i]!;
      const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      deps.bleed(a, wounds[i]!, mid, deps.aimDir());
    }
    return wounds.length;
  }

  function finishSweep(): void {
    let n = 0;
    for (const [id, list] of samples) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) continue;
      n += cutActor(a, cutsFromSweep(a.posed().prims, list), ROD_CALIBRE);
    }
    samples.clear();
    lastCuts = n;
    if (n) ctx.telemetry.telemetry.event('rod-cut', { cuts: n });
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'rod') return false;
      if (button === 0 && slotReady(ctx.weapon.slotState)) {
        held = true; samples.clear();
        yaw0 = ctx.player.player.yaw; pitch0 = ctx.player.player.pitch;
      }
      return true;
    },
    onMouseUp(button) { if (button === 0 && held) { held = false; release = true; } },
    tick() {
      if (held) {
        const eye = deps.eye(), dir = deps.aimDir();
        const h = deps.traceSlugHitFrom(eye, dir);
        if (h.actorId >= 0 && h.hit && Math.hypot(h.hit[0] - eye[0], h.hit[1] - eye[1], h.hit[2] - eye[2]) <= ROD.reach) {
          const list = samples.get(h.actorId) ?? [];
          if (list.length < ROD.maxSamples) list.push({ point: h.hit, view: dir });
          samples.set(h.actorId, list);
        }
      }
      if (release) { release = false; finishSweep(); }
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'rod');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
      // The swing follows the sweep while held; it eases back to rest otherwise.
      const dy = held ? ctx.player.player.yaw - yaw0 : 0, dp = held ? ctx.player.player.pitch - pitch0 : 0;
      pivot.rotation.z += (-dy * ROD.swingGain - pivot.rotation.z) * 0.35;
      pivot.rotation.x += (dp * ROD.swingGain - pivot.rotation.x) * 0.35;
    },
    cut(actorId, a, b, normal, calibre) {
      const actor = ctx.world.actors.find(x => x.id === actorId);
      if (!actor) return 0;
      return cutActor(actor, [{ a, b, normal }], { ...ROD_CALIBRE, ...calibre });
    },
    debug: () => ({ held, samples: [...samples.values()].reduce((m, l) => m + l.length, 0), lastCuts }),
  };
}
```

Check `ctx.player.player.yaw/pitch` exist with those names (`grep -n "yaw\b\|pitch\b" src/lab/sdf-zombie/webgpu/game-state-player.ts`
or the player type); if the field names differ, use them. `a.blast` with `impulse: null` is valid (`ActorBlastEffect.impulse` is
`... | null`).

- [ ] **Step 4: Wiring in `game-main.ts`.**
  - Beside the flare harness creation (`ctx.weapon.flare = createFlareHarness(ctx, {`), add:
```ts
  // WEAPON SLOT 6 (the rod, cut wounds' stand-in blade, game-rod.ts): its own rig on aimRig.
  ctx.weapon.rod = createRodHarness(ctx, {
    traceSlugHitFrom: withCtx(ctx, traceSlugHitFrom), eye: () => eyeOf(ctx.player.player), aimDir: withCtx(ctx, aimDir),
    bleed: (a, w, point, incoming) => registerBleed(ctx, a, w, 'pellet', { point, incoming }),
  });
```
  - In the canvas `mousedown` handler, after the flare line: `if (ctx.weapon.rod?.onMouseDown(e.button)) return;`
  - After the flail's `window.addEventListener('mouseup', ...)`: `window.addEventListener('mouseup', (e) => ctx.weapon.rod?.onMouseUp(e.button));`
  - In the tick beside `ctx.weapon.flare?.tickCooldown(dt);`: `ctx.weapon.rod?.tick(dt);`
  - In `game-weapon-leaves.ts` beside `ctx.weapon.flare?.updateRig();`: `ctx.weapon.rod?.updateRig();`
  - Import `createRodHarness` from `'./game-rod'`.
- [ ] **Step 5: Seams.** `game-seams-fire.ts` returned object:
```ts
    /** CUT WOUNDS (game-rod.ts): cut actor `id` along a→b (world) with blade normal n; optional calibre overrides. */
    cut: (id: number, a: Vec3, b: Vec3, n: Vec3, calibre?: { depth?: number; kerf?: number; lip?: number }) => ctx.weapon.rod?.cut(id, a, b, n, calibre) ?? 0,
    rod: () => ctx.weapon.rod?.debug() ?? null,
```
- [ ] **Step 6:** `npx tsc --noEmit && npx vitest run game-weapon-slots game-context-coverage game-loop game-panels cut-wound` → clean / PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(rod): weapon slot 6 — sweep the crosshair to cut (cut-wound stand-in blade)"`.

---

## Task 8: The capture gate

**Files:** create `scripts/cut-wound-gate.mjs`; notes in `docs/dev-notes/2026-10-03-cut-wounds/NOTES.md`.

- [ ] **Step 1: Skeleton from the existing gate's plumbing** (the same copy the head-burst gate made):

```bash
{
cat <<'EOF'
// scripts/cut-wound-gate.mjs — cut wounds M1 (plan docs/superpowers/plans/2026-10-03-cut-wounds-m1.md Task 8).
// Bare ring page, frozen zombies, headless WebGPU.
//   W. WOUND CAPACITY: 30 pellet hits on one body's torso keep >= 28 visible wounds (32 slots; merging, not dropping);
//      40 hits keep exactly 32 and none of the first 10 hit points is left uncovered (merge, not evict).
//   G. WOUNDS 17-32 RENDER ON THE GPU (added after Task 2's review): on a fresh body stamp 16 wounds on the torso's
//      far side, photo the near side, stamp 8 more at distinct near-side spots, photo again: every one of those 8 spots
//      changes (mean luma shift in a crater-radius disc, measured, threshold set from the first read image). And frame
//      cost: timeDraws with that body at 0 vs 32 wounds, reported with the two baselines' spread (not gated).
//   K. SEAM CUT: __sdfGame.cut on a torso: one wound, shape cut; a dark slot across the cut line and lit lips beside it
//      (luma profile across the cut, from a 0.6 m photo), bone-coloured pixels inside the slot only where it reaches bone.
//   H. HEAD CUT: the same on a head: the cut shows, the face beside it is unchanged outside the mask band.
//   R. REAL ROD: select slot 6, hold, sweep the crosshair across a torso over 20 frames, release: >= 1 cut stamped.
//   C. cost: draw time before / after 3 cuts (reported with its spread, not gated); zero console errors.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-03-cut-wounds/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62, PHOTO_D = 0.6;
EOF
sed -n '/^const sleep = /,/^\/\/ ---- Boot a page/p' scripts/head-damage-gate.mjs | sed '$d'
} > scripts/cut-wound-gate.mjs
grep -c "async function capture" scripts/cut-wound-gate.mjs
```
Expected `1`.

- [ ] **Step 2: Append the scenarios.** Reuse `boot`, `stand`, `stepOne`, `stepN`, `fresh`, `hstate`-style helpers from
  `scripts/head-burst-gate.mjs` (copy its `boot`, `stand`, `stepOne`, `stepN`, `yawOf`, `fresh`, `headOf` definitions
  verbatim). Then:

```js
const torsoOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "torso")`);
const woundsOf = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
const out = {};
try {
  await boot("cut");
  // -------- W. capacity
  {
    const z = fresh();
    const t = await torsoOf(z.id);
    await stand(z.id, 1.6, 0);
    for (let i = 0; i < 40; i++) {
      await evaluate(`__sdfGame.stampWoundAt(${z.id}, ${t[0] + ((i % 5) - 2) * 0.06}, ${t[1] + (Math.floor(i / 5) - 4) * 0.05}, ${t[2]}, "pellet")`);
      if (i === 29) out.after30 = (await woundsOf(z.id)).length;
    }
    out.after40 = (await woundsOf(z.id)).length;
    check(out.after30 >= 28, `W: 30 hits keep ${out.after30} wounds visible (>= 28 of 32 slots)`);
    check(out.after40 === 32, `W: 40 hits keep exactly 32 wounds (${out.after40}): merged, never more`);
  }
  // -------- K. a seam cut on a torso
  {
    const z = fresh();
    const t = await torsoOf(z.id);
    await stand(z.id, PHOTO_D, 0);
    await capture("K-before");
    const n = await evaluate(`__sdfGame.cut(${z.id}, [${t[0]}, ${t[1] - 0.1}, ${t[2]}], [${t[0]}, ${t[1] + 0.1}, ${t[2]}], [1, 0, 0])`);
    await stepN(2);
    const ws = await woundsOf(z.id);
    check(n === 1 && ws.some((w) => w.shape === "cut"), `K: one cut wound stamped (${n}; shapes ${JSON.stringify(ws.map((w) => w.shape ?? "crater"))})`);
    const img = await capture("K-after");
    note(`K: inspect K-before.png / K-after.png: a vertical slot through the torso centre`);
    out.k = img ? "captured" : "no image";
  }
  // -------- H. a seam cut on a head
  {
    const z = fresh();
    const h = await headOf(z.id);
    await stand(z.id, PHOTO_D, 0);
    await capture("H-before");
    const n = await evaluate(`__sdfGame.cut(${z.id}, [${h[0] - 0.06}, ${h[1] + 0.06}, ${h[2]}], [${h[0] + 0.06}, ${h[1] - 0.02}, ${h[2]}], [0, 0, 1])`);
    await stepN(2);
    await capture("H-after");
    check(n === 1, `H: a head cut stamped (${n})`);
  }
  // -------- R. the real rod
  {
    const z = fresh();
    await stand(z.id, 1.1, 0);
    const sel = await evaluate(`__sdfGame.selectSlot("rod")`);
    check(sel?.ok, `R: slot 6 selectable (${JSON.stringify(sel)})`);
    await stepN(30);
    await evaluate(`(() => { const c = document.querySelector("#app canvas, canvas"); c.dispatchEvent(new MouseEvent("mousedown", { button: 0 })); return 1; })()`);
    for (let i = 0; i < 20; i++) { await evaluate(`__sdfGame.setAimPoint(${-0.15 + i * 0.015}, 0)`); await stepOne(); }
    await evaluate(`window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }))`);
    await stepN(3);
    const rod = await evaluate("__sdfGame.rod()");
    check((rod?.lastCuts ?? 0) >= 1, `R: a held sweep across a body cuts it (${JSON.stringify(rod)})`);
    await capture("R-after");
  }
} finally { closeSession(S); }
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
```

Notes for the implementer: (1) the mousedown handler requires pointer lock (`document.pointerLockElement === canvas`); if the
synthetic event is ignored, call the harness through a seam instead: add `rodPress: () => ctx.weapon.rod?.onMouseDown(0)`,
`rodRelease: () => ctx.weapon.rod?.onMouseUp(0)` to `game-seams-fire.ts` and use those (record that the pointer-lock path was
not exercised). (2) `actorWounds` must return `shape` for the K check: if it maps wounds to a reduced shape, add `shape` to
that mapping (`grep -n "actorWounds" src/lab/sdf-zombie/webgpu/game-seams*.ts`). (3) `stampWoundAt`'s signature: read it
(`grep -n "stampWoundAt" src/lab/sdf-zombie/webgpu/game-seams*.ts`) and adapt the W loop's call.

- [ ] **Step 3: Run it**

```bash
export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
node scripts/cut-wound-gate.mjs 5241 9241
```
Expected `N checks, 0 failed`. Then LOOK at `K-after.png`, `H-after.png`, `R-after.png`: a long thin slot with a dark
interior and raised lips. Measure it: across the cut line in `K-after.png`, the luma profile must dip (interior) between two
brighter shoulders (lips) — add that as a check once you have read one image and know the pixel coordinates (project the cut's
midpoint with the page's camera, as `head-damage-gate.mjs`'s `toPx` does), not before.

- [ ] **Step 4: The look loop** — one constant at a time in `CUT_SHADE` / `ROD_CALIBRE` (kerf, depth, jag, lips), re-run,
  re-read the photo, record each change and why in NOTES.

- [ ] **Step 5: Commit** — `git commit -m "test(cut-wound): capture gate (capacity, seam cuts, the rod) and look notes"`.

---

## Task 9: Docs

- [ ] `docs/tasks/combat-and-gore.md`: the "Cut wounds" bullet → `- [~]` "M1 built <date>: cut wounds + rod + 32 wounds with
  merging; owner playtest pending; M2 (head split) next", linking this plan, the gate and the notes.
- [ ] `TASKS.md`: one line under in flight.
- [ ] The spec: append `## 11. As built (M1)` with what differed (anything from the notes, e.g. the seam-driven rod check if
  pointer lock blocked the synthetic mouse).
- [ ] `npx tsc --noEmit`; `npx vitest run cut-wound damage-merge damage write-wounds wounds.wgsl normal-gradient layout
  game-weapon-slots game-context-coverage` → PASS. Commit `docs: cut wounds M1 as built`.
