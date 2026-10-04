# The head split (part B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** an axe chop to a zombie's head splits the head open on a hinge. The halves are real SDF geometry: lit, cut-faced, and choppable again.
- **Chop 1** opens the split, and the zombie lives.
- **Chop 2** widens it.
- **Chop 3** kills. The split stays open on the corpse.
- **An off-centre chop** opens only the smaller side, hinged low by the jaw.

**Spec:** `docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md` §4–§5 and §8 (with the §5 correction about `headSlot: 'keep'`). Read it first. Part A (the axe) is built; read §9.

**Architecture:**
- **Pure module `head-split.ts`:**
  - presets: `middle`, whose offset follows the impact (off-centre opens one side); and `face`;
  - preset choice from the chop's blade plane;
  - the angle spring;
  - the world-space split description `SplitWarp`;
  - **the split field:** the head region evaluated as the union of three rigid, capped pieces (the + half rotated, the − half rotated, and the unmoved part below the hinge).
- **CPU side:**
  - `sdBody` honours `body.split`, so every strike, shot and trace sees the opened halves;
  - stamping un-warps the hit, so wounds live in the un-warped head where the GPU reads them.
- **GPU side:**
  - the split rides 4 new vec4s in the per-instance record;
  - `mapBody` runs the same three-piece union;
  - the post-hit blocks shade at the un-warped point;
  - the skull mesh draws per half with a clip plane.

**Tech stack:** TypeScript, hand-written WGSL in `*.wgsl.ts` string modules, three.js WebGPU + TSL glue, Vitest, headless-Chrome capture scripts.

## Design decision: a union of rigid pieces, not "pick the half by the bisector"

Spec §5 picks the half on the bisector's side and then patches the field's jump at the bisector. That patching needs:
- a step clamp in the march loop;
- disabling the `gCullRef` upper-bound cull;
- the same guard in the secant jump, the overshoot retraction, `REFINE_LOOP`, `coneMarch`, the depth pre-pass, the start-bounds probe and the wound shadow (7+ walkers).

This plan uses a **union of rigid capped pieces** instead. Each piece is a rigid motion of the body field, intersected with half-spaces, so each is a sound distance bound. A `min` of sound bounds is sound and continuous. So:
- there is no jump;
- there is no step clamp;
- the cull stays valid, since it assumes a Lipschitz field, and a union of rigid pieces is one;
- every walker works unchanged.

The cost: inside the split region (a sphere about the hinge, only for split actors), the slot body is evaluated up to 3 times, with an early skip when a piece's cap alone exceeds the best value so far. Outside the region the field gains one `min` with a sphere bound (§B1). The plan measures this cost (Task B4).

**The pieces.** Given the plane (unit normal `n`, offset `d0`), the hinge line (point `h`, unit axis `a`, with `u = n × a` pointing "up" from the hinge into the head), the + side's angle `θp ≥ 0` and the − side's angle `θm ≤ 0`, and `s(q) = n·q − d0`:

| Piece | Field |
| --- | --- |
| `P+` | `max(field(q+), −s(q+), −u·(q+ − h))`, with `q+ = h + R(a, −θp)(p − h)` |
| `P−` | `max(field(q−), s(q−), −u·(q− − h))`, with `q− = h + R(a, −θm)(p − h)` |
| `Pbelow` | `max(field(p), u·(p − h))` |

Inside the region, `split = min(P+, P−, Pbelow)`.

Outside the region (`|p − h| > r`), the result is `min(field(p), |p − h| − r + REGION_SKIN)`. All moved material lies within `r − REGION_MARGIN` of `h` (rotation about `h` preserves the distance to `h`), so this never overshoots the moved halves and never makes a false surface (`REGION_SKIN < REGION_MARGIN`, and both are well above the hit epsilon).

**Rotation direction.** `R(a, φ)` is the right-handed rotation by `φ` about `a`. With `a = normalize(u × n)`, rotating by `+θ` moves the + side away from the plane (`(a × u) = +n`). The + half un-warps by `−θp`. The − half opens the other way (`θm < 0`), and so un-warps by `−θm`.

## Rules for every task

- **Port-ready by construction.** Release is a Rust + wgpu port.
  - Game logic goes in a **pure, renderer-free module with its own tests**: no `three` import, plain data in and out.
  - Rendering that matters goes in **hand-written WGSL**. TSL is for thin glue only.
  - State lives on `ctx` slices or inside a feature module, never as new `main()` bindings (`npx vitest run game-context-coverage`).
  - Keep it deterministic: sim-time, no wall clock in logic.
- **Worktree hygiene:**
  - Work ONLY in your worktree. Never `git stash`. Don't reinstall `node_modules`.
  - **Targeted tests only** (`npx vitest run <names>`), plus `npx tsc --noEmit`. The only allowed tsc error is the pre-existing `node:crypto` one in `pack-golden.test.ts`.
- **Every WGSL change needs:**
  - `npx vitest run march-golden -u`, noted in the commit;
  - `node scripts/compile-census.mjs`: phase ready, `uncapturedCount 0`, no device loss;
  - `node scripts/march-hash.mjs`. With no split in its scenes, the pins should NOT move. If they do, investigate before re-pinning, and state the reason.
  - an **interleaved cold boot pair** (`node scripts/boot-time.mjs`): base and new alternated, with a unique `hash13` `0.1031` nonce per boot, reverted afterwards, because the OS Metal cache otherwise warms "cold" boots. Use a temporary `git worktree` in the scratchpad for the base.
- **If the census fails to compile, STOP and report the error.** Keep new WGSL scalar or vec only. No dynamically indexed private arrays: one hung the Metal compile for 185 s in `foldGroup`.
- **Capture:**
  - **Headless only.** Servers come from `bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; …'`. It needs bash; don't pipe `lab_servers_up`.
  - **Port 5273 is the owner's dev server: never use or stop it.** Stop everything you start.
  - **Prove visual claims with a number,** and look at the images yourself.
- **Commits:**
  - End commit messages with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never commit extracted Blood assets.
  - `git add` only your own files.

## Code map (measured 2026-10-04; verify line numbers, they drift)

Paths are under `src/lab/sdf-zombie/`.

**Per-instance record.**
- `webgpu/crowd-records.ts`: `REC_VEC4S = 17`. The slot names are `REC_COUNTS` … `REC_LIGHTS` (lines 11–40). Spare lane: only `REC_BURN.w`.
- `RecordSource` is at lines 49–65, and `write(slot, src, band)` at 91–115.
- Every view (per-body and crowd) marches a record (`zombie-gpu.ts` ~2400). `fallbackCrowdRecords()` is zero-filled, so a zero split means closed.
- **CPU adapter:** `writeViewRecord(records, slot, u, centre, band?)` (`zombie-gpu.ts` ~1691–1719), called from `syncRecord()` (~2867). Every view setter calls `syncRecord()`.
- **WGSL:** `INSTANCE_STATE` / `fn loadInstance(inst, slot)` (`webgpu/march/fields/groups.wgsl.ts` ~337–376). It sets the `gInst*` privates, declared at ~268–303.
- **Literal 17 pins:**
  - `crowd-records.test.ts:17` and `:92–104`;
  - `march/fields/groups.wgsl.test.ts:38` (`'let base = slot * 17;'`).

**mapBody** (`webgpu/march/map-body.wgsl.ts`):
- The slot loop is at 52–64: `loadInstance(inst, base + s); if (gInstAlive < 0.5) { continue; }` at ~56.
- `p` is a function parameter. A nested `let p = …` shadows it for the rest of the slot body.
- Uses of `p` after line 56:
  - the limb slack (101);
  - the volume branch (118);
  - `foldGroup` (136);
  - the cluster cull (162);
  - the group fold (178);
  - `applyCarves` (186) and `applyWounds` (187);
  - the owner re-fold (247–319);
  - `applyBones` (346);
  - `restPoint` (373).
- The union-min bookkeeping is at 378–387.
- `.w` returns `carved`, the pre-wound field.
- `gCullRef` is set at ~125 and reset at ~184.

**Identifying the head on the GPU:** there is no limb id on prim rows. Clusters are sorted head first (`CLUSTER_ORDER`, `types.ts:91`), so the head is cluster 0 for the zombie (`ROW_CLUSTER_BOUNDS` column 0). The split does not need the head's identity on the GPU: the CPU sends the region sphere.

**Per-ray wound list** (`body/blocks/setup/wound-list.wgsl.ts`): it keeps wounds whose reach sphere the **world** ray enters. A split slot's wounds (stamped un-warped) must bypass the list.

**Bounds:**
- **Proxy box:** `fit(body_, maxBlendK)` (`zombie-gpu.ts` ~2712), the AABB of live cluster spheres. It feeds the mesh box, `REC_CENTRE_SEED` / `REC_HALF_REV`, the ray window and the crowd rect.
- **Screen tiles:** built from `p.groupBounds` (`zombie-gpu.ts` ~2572, `getTileGroups()`) and binned in `crowd-type.ts` ~452/498.
- **Outer hull:** `shell-hull-outer.ts:136`, used at `game-main.ts` ~7451/7494/3843. The march discards where `shellOut <= 0`.
- **Occluder hull:** `occluder-hull.ts:198`.
- **Depth pre-pass miss cull:** uses `ROW_CLUSTER_BOUNDS` (`cone-march.wgsl.ts` ~215–240).

**Post-hit** (`webgpu/march/body/trace.wgsl.ts` `MARCH_TRACE_POST` ~304–372): `loadInstance(inst, gHitSlot)`, then `let p = camPos + rd * t;`, then the blocks below.

| Block | What it reads | Needs the un-warped point |
| --- | --- | --- |
| `shading-normal` | `anchor = restPoint(p, …)`; `ngBody` / `ngDetail` analytic at world `p`; `calcNormal` FD (differentiates `mapBody`, so it is warp-correct) | `anchor` |
| `SKIN_NORMAL` (`light/skin-detail-proto.ts`) | defines `nSmooth` | — |
| `wound-masks` | `woundMask(p, nSmooth, …)`, `charMask(p, …)` | both |
| `face.wgsl.ts` | `hpv = p − gInstHeadCentre` (~50), `facing` from `n` (~83); the bump is added to world `n` (~195) | `hpv` and `facing`; the bump must be rotated back |
| `burn` | `applyBones` taps at `p` (~28–31) | the taps; the bone normal must be rotated back |

- Lighting stays in world space.
- Analytic normals are ON in the game (`normalGradientMode = 1`), and `ngBody` assumes an un-warped `p`, so force the FD path in a split region.
- **Text pins:**
  - `trace.wgsl.test.ts:51` (the anchor line);
  - `fields/wounds.wgsl.test.ts:~270` (`woundMask(p, nSmooth, …)`).
- `FACE_LAYER_WGSL` is reused by `baked-chunks.ts:212–215` with regex renames: keep its names, or update that contract.

**CPU:**
- `validate.ts` `sdBody(p, body: Body)` (~539).
- `ZombieActor.posed()` returns `repose()`'s result. `setHeadDeform(fn)` at `game-actor.ts` ~540/655/663 is the template: a per-actor hook applied after posing.
- `worldHitToWound` is at `damage.ts` ~390–465.
- `strikeActorsFrom` (`webgpu/flail-strike.ts`) builds a head-only `Body` literal, which must carry `split` too.

**Head frame:**
- `headShape(b)` (`webgpu/flame-anchors.ts:31`) gives `{ centre, axes }` of the fattest head flesh prim.
- `headQuatOf(boundRig, yaw)` (`rig-bind.ts:815`) gives the head's world rotation, as a `Quat` of `[x, y, z, w]` (`vec.ts`).
- Head-local convention: x right, y up, z face-forward; `local = conj(q)·(p − centre)`.

**Spring:** `head-deform.ts` `BURST_DEFORM` / `kickBurst` / `stepBurst` (semi-implicit Euler, 1/240 s sub-steps). Same shape, own constants.

**Skull mesh** (`webgpu/skeleton-spike/mesh-renderer.ts`):
- one `InstancedMesh` per segment geometry, plus one for the eyes;
- `MeshBasicNodeMaterial`, with WGSL through `wgslFn`;
- per-instance attributes exist (`iLights`, `iFill`);
- the world matrix is `extra(owner, segment) · segM`;
- `setWounds` compares crater spheres with `positionWorld`.

---

## Task B1: `head-split.ts`: presets, choice, spring, the warp and the split field (pure)

**Files:**
- Create: `src/lab/sdf-zombie/head-split.ts`
- Test: `src/lab/sdf-zombie/head-split.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/head-split.test.ts
import { describe, expect, it } from 'vitest';
import {
  HEAD_SPLIT, REGION_MARGIN, choosePreset, kickSplit, makeSplitState, splitField, splitWarpOf, stepSplit, unwarpPoint,
  type HeadFrame, type SplitWarp,
} from './head-split';
import type { Vec3 } from './types';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
// A head: a sphere of radius 0.11 at (0, 1.7, 0) on a neck capsule down to (0, 1.45, 0). Head frame = identity.
const FRAME: HeadFrame = { centre: [0, 1.7, 0], quat: [0, 0, 0, 1], radius: 0.11 };
const sdCapsule = (p: Vec3, a: Vec3, b: Vec3, r: number) => {
  const pa = sub(p, a), ba = sub(b, a); const t = Math.max(0, Math.min(1, dot(pa, ba) / dot(ba, ba)));
  return len(sub(pa, [ba[0] * t, ba[1] * t, ba[2] * t])) - r;
};
const head = (p: Vec3) => Math.min(len(sub(p, FRAME.centre)) - 0.11, sdCapsule(p, [0, 1.45, 0], [0, 1.62, 0], 0.05));
const open = (preset: 'middle' | 'face', impactLocal: Vec3, angleFrac = 1): SplitWarp => {
  const st = { ...makeSplitState(), ...choosePreset(preset === 'middle' ? [1, 0, 0] : [0, 0, 1], impactLocal, FRAME.radius) };
  const p = HEAD_SPLIT.presets[st.preset!];
  return splitWarpOf({ ...st, angle: angleFrac * (st.sides === 0 ? p.maxBoth : p.maxOne) }, FRAME)!;
};

describe('choosePreset: the blade plane picks the preset; the impact sets the offset and the side that moves', () => {
  it('a sagittal blade plane (normal ~ head x) -> middle; a coronal one (normal ~ head z) -> face', () => {
    expect(choosePreset([0.95, 0.1, 0.3], [0, 0, 0.1], 0.11).preset).toBe('middle');
    expect(choosePreset([0.2, 0.1, 0.97], [0, 0, 0.1], 0.11).preset).toBe('face');
  });
  it('middle: a centred impact opens both halves; off-centre opens only the smaller side, offset clamped to 40% R', () => {
    expect(choosePreset([1, 0, 0], [0.005, 0, 0.1], 0.11).sides).toBe(0);
    const r = choosePreset([1, 0, 0], [0.06, 0, 0.1], 0.11);
    expect(r.sides).toBe(1);
    expect(r.offset).toBeCloseTo(0.4 * 0.11, 9);
    expect(choosePreset([1, 0, 0], [-0.03, 0, 0.1], 0.11).sides).toBe(-1);
  });
  it('face always opens its face side only', () => {
    expect(choosePreset([0, 0, 1], [0, 0, 0.1], 0.11).sides).toBe(1);
  });
});

describe('the spring: kick, overshoot, settle exactly on the target', () => {
  it('kicked to 0.6, it overshoots and settles at 0.6', () => {
    let st = kickSplit({ ...makeSplitState(), preset: 'middle', sides: 0, offset: 0 }, 0.6);
    let peak = 0;
    for (let i = 0; i < 240; i++) { st = stepSplit(st, 1 / 60); peak = Math.max(peak, st.angle); }
    expect(peak).toBeGreaterThan(0.6 * 1.05);
    expect(st.angle).toBe(0.6);
    expect(st.vel).toBe(0);
  });
});

describe('the warp: rigid pieces about the hinge', () => {
  it('a closed split (angle 0) is no warp at all', () => {
    expect(splitWarpOf(makeSplitState(), FRAME)).toBeNull();
  });
  it('unwarpPoint inverts the opening: a point on the opened + half maps back onto the un-warped head', () => {
    const w = open('middle', [0, 0, 0.1]);
    // A point on the un-warped + half's skin, moved by the opening (rotation by +thetaP about the hinge).
    const q: Vec3 = [0.11, 1.72, 0];
    const rot = (v: Vec3, ax: Vec3, t: number): Vec3 => {   // Rodrigues
      const c = Math.cos(t), s = Math.sin(t), k = dot(ax, v);
      const x: Vec3 = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
      return [v[0] * c + x[0] * s + ax[0] * k * (1 - c), v[1] * c + x[1] * s + ax[1] * k * (1 - c), v[2] * c + x[2] * s + ax[2] * k * (1 - c)];
    };
    const moved = (() => { const r = rot(sub(q, w.h), w.a, w.thetaP); return [w.h[0] + r[0], w.h[1] + r[1], w.h[2] + r[2]] as Vec3; })();
    const back = unwarpPoint(w, moved, head);
    expect(len(sub(back.q, q))).toBeLessThan(1e-9);
    expect(back.piece).toBe(1);
  });
  it('the + half moves AWAY from the plane (a x u = +n)', () => {
    const w = open('middle', [0, 0, 0.1]);
    const top: Vec3 = [0.01, 1.8, 0];   // on the + side near the crown
    expect(splitField(w, head, [0.09, 1.8, 0])).toBeGreaterThan(head([0.09, 1.8, 0]) - 1e-3);   // sanity
    const u = [w.n[1] * w.a[2] - w.n[2] * w.a[1], w.n[2] * w.a[0] - w.n[0] * w.a[2], w.n[0] * w.a[1] - w.n[1] * w.a[0]] as Vec3;
    expect(dot(u, sub(top, w.h))).toBeGreaterThan(0);   // u points up from the hinge into the head
  });
  it('the neck below the hinge does not move: splitField == head there', () => {
    const w = open('middle', [0, 0, 0.1]);
    for (const p of [[0, 1.5, 0.04], [0.04, 1.52, 0], [0, 1.47, -0.05]] as Vec3[]) expect(splitField(w, head, p)).toBeCloseTo(head(p), 9);
  });
  it('a gap opens: the old plane between the halves is empty above the hinge', () => {
    const w = open('middle', [0, 0, 0.1]);
    expect(head([0, 1.78, 0.02])).toBeLessThan(0);                      // inside the closed head
    expect(splitField(w, head, [0, 1.78, 0.02])).toBeGreaterThan(0);      // in the gap once open
  });
  it('off-centre: only the smaller (+) side moves; the larger side is exactly where it was', () => {
    const w = open('middle', [0.06, 0, 0.1]);
    expect(w.thetaM).toBe(0);
    for (const p of [[-0.08, 1.72, 0], [-0.05, 1.78, 0.04]] as Vec3[]) expect(splitField(w, head, p)).toBeCloseTo(head(p), 9);
  });
  it('outside the region the field is the body field or the region bound, never larger than the true union', () => {
    const w = open('middle', [0, 0, 0.1]);
    const far: Vec3 = [0.6, 1.7, 0];
    expect(splitField(w, head, far)).toBeLessThanOrEqual(head(far) + 1e-12);
    expect(splitField(w, head, far)).toBeGreaterThan(0.2);
    expect(w.r).toBeGreaterThan(len(sub(FRAME.centre, w.h)) + FRAME.radius + REGION_MARGIN * 0.99);
  });
});

describe('the split field is a sound, continuous distance bound (the march relies on it)', () => {
  for (const [name, w] of [['middle both', open('middle', [0, 0, 0.1])], ['middle one side', open('middle', [0.06, 0, 0.1])], ['face', open('face', [0, 0, 0.1])]] as const) {
    it(`${name}: |grad| <= 1.05 and no jump across the old plane, the hinge plane or the region sphere`, () => {
      const e = 1e-4; let worst = 0, jump = 0;
      for (let x = -0.3; x <= 0.3; x += 0.01) for (let y = 1.35; y <= 2.05; y += 0.01) for (let z = -0.3; z <= 0.3; z += 0.02) {
        const p: Vec3 = [x, y, z], f = splitField(w, head, p);
        const g = Math.hypot(splitField(w, head, [x + e, y, z]) - f, splitField(w, head, [x, y + e, z]) - f, splitField(w, head, [x, y, z + e]) - f) / e;
        worst = Math.max(worst, g);
        jump = Math.max(jump, Math.abs(splitField(w, head, [x + 1e-6, y, z]) - f));
      }
      console.log(`split ${name}: max |grad| ${worst.toFixed(3)}, max 1e-6 jump ${jump.toExponential(2)}`);
      expect(worst).toBeLessThanOrEqual(1.05);
      expect(jump).toBeLessThan(1e-4);
    }, 120000);
  }
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run head-split`
Expected: FAIL (unresolved import).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/head-split.ts
//
// THE HEAD SPLIT (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §5; plan
// docs/superpowers/plans/2026-10-04-head-split-part-b.md). Pure. An axe chop opens the head on a hinge; this module
// holds the presets, the preset choice from the chop's blade plane, the angle spring, the world-space split
// description (SplitWarp) and THE SPLIT FIELD:
//
//   inside the region (a sphere about the hinge that holds every moved point):
//     min( P+ = max(f(q+), -s(q+), -u.(q+ - h)),          the + half, rotated open by thetaP, capped at the plane and
//          P- = max(f(q-),  s(q-), -u.(q- - h)),          the - half (thetaM <= 0), likewise    above the hinge plane
//          Pb = max(f(p),   u.(p - h)) )                  the part below the hinge, unmoved
//     q+- = h + R(a, -theta+-)(p - h),   s(q) = n.q - d0,   u = n x a
//   outside: min(f(p), |p - h| - r + REGION_SKIN)
//
// Each piece is a rigid motion of f intersected with half-spaces, so a sound distance bound; their min is sound and
// CONTINUOUS (no jump at the bisector, so no march step clamp and no cull exceptions). The GPU (map-body.wgsl.ts)
// evaluates the same three pieces; this is its CPU mirror and the reference for its tests.
import type { Vec3 } from './types';
import type { Quat } from './vec';

export type SplitPresetId = 'middle' | 'face';

export interface SplitPreset {
  /** Head-local plane normal (unit; the + side is the side that moves first). */
  n: Vec3;
  /** Head-local hinge point at plane offset 0, for both halves opening (`hingeBoth`) and one side (`hingeOne`). */
  hingeBoth: Vec3; hingeOne: Vec3;
  /** Head-local "up" from the hinge into the head, in the plane. */
  up: Vec3;
  /** Opening angle (rad) at full open, each half: both halves vs one side. */
  maxBoth: number; maxOne: number;
}

export const REGION_MARGIN = 0.03;
export const REGION_SKIN = 0.015;

export const HEAD_SPLIT = {
  presets: {
    // Sagittal: left and right halves. Centred: both halves, hinged low at the back of the skull. Off-centre: the
    // smaller side peels outward, hinged low by the jaw on that side (the owner's reference, 2026-10-04).
    middle: { n: [1, 0, 0], hingeBoth: [0, -0.06, -0.07], hingeOne: [0, -0.09, 0.01], up: [0, 1, 0], maxBoth: 0.55, maxOne: 0.9 },
    // Coronal: the face half folds forward and down, hinged low at the jaw front. Rare (a chop from the side).
    face: { n: [0, 0, 1], hingeBoth: [0, -0.1, 0.02], hingeOne: [0, -0.1, 0.02], up: [0, 1, 0], maxBoth: 0.8, maxOne: 0.8 },
  } satisfies Record<SplitPresetId, SplitPreset>,
  /** Off-centre impacts move the plane by up to this share of the head radius; inside `bothFrac` both halves open. */
  maxOffsetFrac: 0.4, bothFrac: 0.15,
  /** The angle spring (head-deform.ts BURST_DEFORM's shape). */
  hz: 7, zeta: 0.35, restA: 1e-4, restV: 1e-2,
} as const;

export interface SplitState {
  preset: SplitPresetId | null;
  /** +1 the + side moves, -1 the - side, 0 both. */
  sides: -1 | 0 | 1;
  /** Head-local plane offset along n (m). */
  offset: number;
  /** Current opening angle (rad, >= 0) and its rate; `target` is where the spring settles. */
  angle: number; vel: number; target: number;
}

export function makeSplitState(): SplitState {
  return { preset: null, sides: 0, offset: 0, angle: 0, vel: 0, target: 0 };
}

/** The preset for a chop: `bladeNormalLocal` is the blade plane's normal in head-local space (cross(blade dir, view),
 *  any sign), `impactLocal` the hit in head-local metres, `radius` the head's (headShape axes.x). */
export function choosePreset(bladeNormalLocal: Vec3, impactLocal: Vec3, radius: number): Pick<SplitState, 'preset' | 'sides' | 'offset'> {
  const ax = Math.abs(bladeNormalLocal[0]), az = Math.abs(bladeNormalLocal[2]);
  if (az > ax) {
    const off = Math.max(-0.3 * radius, Math.min(0.5 * radius, impactLocal[2]));
    return { preset: 'face', sides: 1, offset: off };
  }
  const max = HEAD_SPLIT.maxOffsetFrac * radius;
  const off = Math.max(-max, Math.min(max, impactLocal[0]));
  const sides = Math.abs(off) < HEAD_SPLIT.bothFrac * radius ? 0 : off > 0 ? 1 : -1;
  return { preset: 'middle', sides, offset: sides === 0 ? 0 : off };
}

/** Spring the angle toward `target` (keeps the preset). */
export function kickSplit(st: SplitState, target: number): SplitState {
  return { ...st, target, vel: st.vel + (target - st.angle) * 6 };
}

export function stepSplit(st: SplitState, dt: number): SplitState {
  if (st.preset === null) return st;
  const w = 2 * Math.PI * HEAD_SPLIT.hz, z = HEAD_SPLIT.zeta;
  let a = st.angle, v = st.vel;
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) { v += (-w * w * (a - st.target) - 2 * z * w * v) * h; a += v * h; }
  if (Math.abs(a - st.target) < HEAD_SPLIT.restA && Math.abs(v) < HEAD_SPLIT.restV) { a = st.target; v = 0; }
  return { ...st, angle: Math.max(0, a), vel: v };
}

/** The head's frame: skull centre, world rotation (rig-bind.ts headQuatOf), radius (headShape axes.x). */
export interface HeadFrame { centre: Vec3; quat: Quat; radius: number }

/** The split in WORLD space for this frame (null when closed). The GPU record carries exactly these fields. */
export interface SplitWarp {
  n: Vec3; d0: number; h: Vec3; a: Vec3;
  /** + side and - side angles (rad): thetaP >= 0, thetaM <= 0. */
  thetaP: number; thetaM: number;
  /** The region sphere: centred on h, radius r. */
  r: number;
}

const rotQ = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const crossV = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotV = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitV = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Rodrigues: v rotated by t about unit axis k. */
export function rotAxis(v: Vec3, k: Vec3, t: number): Vec3 {
  const c = Math.cos(t), s = Math.sin(t), d = dotV(k, v), x = crossV(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

export function splitWarpOf(st: SplitState, f: HeadFrame): SplitWarp | null {
  if (st.preset === null || !(st.angle > 0)) return null;
  const p = HEAD_SPLIT.presets[st.preset];
  const nL = p.n as Vec3, upL = p.up as Vec3;
  const hL0 = (st.sides === 0 ? p.hingeBoth : p.hingeOne) as Vec3;
  const hL: Vec3 = [hL0[0] + nL[0] * st.offset, hL0[1] + nL[1] * st.offset, hL0[2] + nL[2] * st.offset];
  const n = unitV(rotQ(f.quat, nL));
  const up = unitV(rotQ(f.quat, upL));
  const a = unitV(crossV(up, n));
  const hw = rotQ(f.quat, hL);
  const h: Vec3 = [f.centre[0] + hw[0], f.centre[1] + hw[1], f.centre[2] + hw[2]];
  const d0 = dotV(n, f.centre) + st.offset;
  const toC = Math.hypot(f.centre[0] - h[0], f.centre[1] - h[1], f.centre[2] - h[2]);
  return {
    n, d0, h, a,
    thetaP: st.sides >= 0 ? st.angle : 0,
    thetaM: st.sides <= 0 ? -st.angle : 0,
    r: toC + f.radius * 1.25 + REGION_MARGIN,
  };
}

const moveBack = (w: SplitWarp, p: Vec3, theta: number): Vec3 => {
  if (theta === 0) return p;
  const r = rotAxis([p[0] - w.h[0], p[1] - w.h[1], p[2] - w.h[2]], w.a, -theta);
  return [w.h[0] + r[0], w.h[1] + r[1], w.h[2] + r[2]];
};

/** The three pieces at p: their un-warped points and capped fields. */
function pieces(w: SplitWarp, f: (q: Vec3) => number, p: Vec3): { q: Vec3; d: number }[] {
  const u = crossV(w.n, w.a);
  const qp = moveBack(w, p, w.thetaP), qm = moveBack(w, p, w.thetaM);
  const s = (q: Vec3) => dotV(w.n, q) - w.d0;
  const up = (q: Vec3) => dotV(u, [q[0] - w.h[0], q[1] - w.h[1], q[2] - w.h[2]]);
  return [
    { q: p, d: Math.max(f(p), up(p)) },                    // 0: below the hinge, unmoved
    { q: qp, d: Math.max(f(qp), -s(qp), -up(qp)) },        // 1: the + half
    { q: qm, d: Math.max(f(qm), s(qm), -up(qm)) },         // 2: the - half
  ];
}

const inRegion = (w: SplitWarp, p: Vec3) => Math.hypot(p[0] - w.h[0], p[1] - w.h[1], p[2] - w.h[2]) <= w.r;

/** The split field (see the header). `f` is the un-split body field. */
export function splitField(w: SplitWarp | null | undefined, f: (q: Vec3) => number, p: Vec3): number {
  if (!w) return f(p);
  const dh = Math.hypot(p[0] - w.h[0], p[1] - w.h[1], p[2] - w.h[2]);
  if (dh > w.r) return Math.min(f(p), dh - w.r + REGION_SKIN);
  let best = Infinity;
  for (const pc of pieces(w, f, p)) best = Math.min(best, pc.d);
  return best;
}

/** Where a point on the split head lives in the UN-WARPED head (wounds are stamped there; the GPU reads them there):
 *  the winning piece's un-warped point. `piece` 0 = below the hinge, 1 = the + half, 2 = the - half. */
export function unwarpPoint(w: SplitWarp | null | undefined, p: Vec3, f: (q: Vec3) => number): { q: Vec3; piece: 0 | 1 | 2 } {
  if (!w || !inRegion(w, p)) return { q: p, piece: 0 };
  const ps = pieces(w, f, p);
  let k = 0;
  for (let i = 1; i < 3; i++) if (ps[i]!.d < ps[k]!.d) k = i;
  return { q: ps[k]!.q, piece: k as 0 | 1 | 2 };
}

/** A direction (e.g. a view or a normal) into the winning piece's un-warped frame. */
export function unwarpDir(w: SplitWarp | null | undefined, piece: 0 | 1 | 2, v: Vec3): Vec3 {
  if (!w || piece === 0) return v;
  return rotAxis(v, w.a, piece === 1 ? -w.thetaP : -w.thetaM);
}
```

`unwarpPoint`'s test builds its own `HeadFrame` and the head field fixture. Make the test's `open()` helper match the real `choosePreset` / `splitWarpOf` signatures. If a test in Step 1 contradicts its intent, fix the test and say so.

- [ ] **Step 4: Run**

Run: `npx vitest run head-split`
Expected: PASS. Report the Lipschitz maxima the test logs.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/head-split.ts src/lab/sdf-zombie/head-split.test.ts
git commit -m "feat(head-split): presets, choice, spring, world warp and the three-piece split field (pure)"
```

---

## Task B2: The CPU mirror: `sdBody` sees the split; stamping un-warps

**Files:**
- Modify:
  - `src/lab/sdf-zombie/validate.ts` (`Body` gains `split?: SplitWarp | null`; `sdBody` wraps its evaluation in `splitField`);
  - `src/lab/sdf-zombie/webgpu/game-actor.ts` (a `setHeadSplit(fn)` hook next to `setHeadDeform`, applied in `repose()` after the deform; plus `ZombieActor.unwarp(p)`);
  - `src/lab/sdf-zombie/webgpu/flail-strike.ts` (`strikeActorsFrom`'s head-only body carries `split`).
- Modify (stamping callers): `webgpu/game-axe.ts`, `webgpu/game-rod.ts`, and the pellet/slug wound paths in `game-actor.ts` (~1645, ~1653). Each passes the un-warped hit, the un-warped view, and the field with `split: null` into `worldHitToWound` / `stampCut`.
- Test: `src/lab/sdf-zombie/head-split-cpu.test.ts`

- [ ] **Step 1: Write the failing tests.** Use a real posed zombie body: build one as the `cut-wound.test.ts` or `bone-exposure-yaw.test.ts` fixtures do, and read how they get a `BuildResult`. Then:
  - (a) `sdBody` with `body.split = null` equals before, bit for bit, at 1000 random points.
  - (b) With a `middle` split open at full angle, `sdBody` at a point in the gap (on the old plane above the hinge, inside the closed head) is > 0.
  - (c) A point on an opened half's skin un-warps (`unwarpPoint` with the body field `split: null`) to the closed head's skin (|`sdBody(q, closed)`| < 2 mm).
  - (d) A rod cut stamped through the opened half lands, by `woundWorldPos` in the un-warped head, where `unwarpPoint` sent it.
  - (e) `strikeActorsFrom`'s head field equals `sdBody(·, {head clusters, split})`.
- [ ] **Step 2: Run, fail. Implement:**
  - **`sdBody`.** Keep the existing loop as an inner function `raw(q)`, and `return body.split ? splitField(body.split, raw, p) : raw(p);`. Note `raw` must not itself recurse through the split.
  - **`game-actor.ts`.**
    - Add `let headSplit: ((p: BuildResult) => SplitWarp | null) | null = null;`.
    - `repose()` returns `const d = headDeform ? headDeform(p) : p; const s = headSplit?.(d) ?? null; return s ? { ...d, split: s } : d;`.
    - Add `setHeadSplit: (fn) => { headSplit = fn; }` to the actor API and interface.
    - Add `unwarp(p: Vec3): { q: Vec3; piece: 0|1|2 }`, which uses `posed().split` and the field `q => sdBody(q, { ...posed(), split: null })`.
  - **`strikeActorsFrom`.** Make the head body `{ prims: posed.prims, clusters: headClusters, split: posed.split ?? null }`.
  - **Stamping callers.** When `posed.split` is set: `const { q, piece } = unwarpPoint(posed.split, hit, rawField)`, `view' = unwarpDir(posed.split, piece, view)`, then stamp with `q`, `view'` and `rawField` (`split: null`). This applies to:
    - the axe's `hitActor`;
    - the rod's `cutActor` (per segment: un-warp `a`, `b` and the view; take the piece from the midpoint);
    - the pellet/slug paths.
- [ ] **Step 3: Run** `npx vitest run head-split head-split-cpu cut-wound game-axe game-rod flail damage && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Commit** `feat(head-split): the CPU mirror — sdBody sees the split; hits are stamped in the un-warped head`.

---

## Task B3: The axe drives the split; the per-frame leaf; the force seam

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-head-split.ts`. It is the leaf: per-actor `SplitState`, stepped each frame. It installs `a.setHeadSplit(posed => splitWarpOf(state, frameOf(a, posed)))` and pushes the warp to the view (Task B4 adds `view.setHeadSplit`; until then, store it).
- Modify:
  - `src/lab/sdf-zombie/webgpu/axe-head.ts`: `AXE_HEAD.openAngles: [0.55, 0.8]` (fractions of the preset's max).
  - `src/lab/sdf-zombie/webgpu/game-axe.ts`: on a head chop, call the leaf: `open` on chop 1, `widen` on 2…N−1, and `kill` (to 1.0) on N.
  - `src/lab/sdf-zombie/webgpu/game-main.ts`: create the leaf next to the head-damage leaf, and tick it after `a.step`, as `game-head-damage.ts` is ticked (~7586).
  - `src/lab/sdf-zombie/webgpu/game-seams-fire.ts`: `headSplit(id)` returns the state, and `forceSplit(id, preset, sides, offset, angleFrac)` is a tuning and gate seam.
- Test: `src/lab/sdf-zombie/webgpu/game-head-split.test.ts`, with a stub ctx and actors as in game-axe.test.ts.

**The leaf's API:**

```ts
export interface HeadSplitLeaf {
  /** Chop 1: choose the preset from the chop (blade plane normal + impact, world) and spring open to openAngles[0]. */
  open(a: ZombieActor, bladeNormalW: Vec3, impactW: Vec3): void;
  /** Later chops: spring to `frac` of the preset's max (keeps the preset). */
  widen(a: ZombieActor, frac: number): void;
  tick(dt: number): void;
  state(id: number): SplitState | null;
  force(id: number, preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, angleFrac: number): boolean;
}
```

**The head frame** comes from `frameOf(a, posed)`: `centre` and `radius` from `headShape(posed)` (`flame-anchors.ts`), and `quat` from `headQuatOf(a.boundRig(), a.pose().yaw)` (`rig-bind.ts`). Check those names on the actor. The blade plane normal is `normalize(cross(bladeDirWorld, view))`; `axeCutSeg`'s `b − a` gives the blade direction. Convert it to head-local with `conj(quat)`.

**Cut faces.** When the split opens (chop 1), stamp one cut per opened half along the plane, inside the head, with `stampCut` in the un-warped head. Set `headSlot: 'keep'` on them (spec §5, corrected). Check how many `'keep'` wounds head-damage can already hold (`damage.ts` `MAX_HEAD_WOUNDS`, `pushWound`) and note the budget in NOTES.

**Tests:**
- chop 1 opens (`preset` set, `target = 0.55·max`), the spring reaches the target, chop 2 → 0.8, the kill chop → 1.0;
- an off-centre chop gives `sides ≠ 0`;
- a side chop on a turned head picks `face`;
- `force()` works;
- an actor's `posed().split` is non-null once open;
- the cut faces carry `headSlot: 'keep'`.

Run `npx tsc --noEmit && npx vitest run game-head-split game-axe axe-head head-split game-context-coverage`. Commit `feat(head-split): the axe opens, widens and kills through the split; per-frame spring leaf; force seam`.

---

## Task B4: The GPU record and the core warp in `mapBody`

**Files:**
- Modify: `webgpu/crowd-records.ts` and its test; `webgpu/march/fields/groups.wgsl.ts` (`loadInstance`, the privates) and its test; `webgpu/march/map-body.wgsl.ts`; `webgpu/zombie-gpu.ts`.
- Modify: `webgpu/game-head-split.ts`: push the warp to `view.setHeadSplit` every frame (null when closed).
- Test: the WGSL text pins in `map-body.wgsl.test.ts`, `groups.wgsl.test.ts` and `crowd-records.test.ts`.

**1. The record.**
- `REC_VEC4S` 17 → 21, with four slots:
  - `REC_SPLIT_N` = (n.xyz, thetaP);
  - `REC_SPLIT_H` = (h.xyz, d0);
  - `REC_SPLIT_A` = (a.xyz, thetaM);
  - `REC_SPLIT_R` = (r, 0, 0, 0).
- A zero record means closed: `thetaP = thetaM = 0`.
- `RecordSource` gains `split: SplitWarp | null`.
- `write()` fills it with zeros when null.
- Update the literal-17 pins.

**2. The view.**
- `ZombieGpuView.setHeadSplit(w: SplitWarp | null)` stores it on the uniforms or view state, so `writeViewRecord` can copy it, and calls `syncRecord()`.
- Chunks and the FPV leave it null.

**3. `loadInstance`.**
- Always read `REC_SPLIT_N` into `gInstSplitN`.
- Read the other three only when `gInstSplitN.w != 0.0 || ` the thetaM lane is non-zero. You need thetaM to know, so either read `REC_SPLIT_A` too, or encode an "open" flag. **Choose:** always read N and A (two reads); read H and R only when open.
- Declare the privates with the other `gInst*`.

**4. `mapBody`.** For a split slot, the slot body is evaluated per piece, and each piece is unioned like a slot.
- Right after `if (gInstAlive < 0.5) { continue; }`, compute the region and the piece count:

```wgsl
    // THE HEAD SPLIT (head-split.ts splitField; plan docs/superpowers/plans/2026-10-04-head-split-part-b.md): a split
    // slot inside its region sphere is the union of three rigid capped pieces (below the hinge, the + half, the - half);
    // outside the region, its field gains min(., |p - h| - r + skin). Each piece is a rigid motion of the slot's field
    // intersected with half-spaces, so the union is sound and continuous: no march step clamp, no cull exception.
    let splitOpen = gInstSplitN.w != 0.0 || gInstSplitA.w != 0.0;
    let splitDh = select(1e9, length(p - gInstSplitH.xyz), splitOpen);
    let splitIn = splitDh <= gInstSplitR.x;
    let nPieces = select(1, 3, splitIn);
    for (var piece = 0; piece < nPieces; piece = piece + 1) {
      let theta = select(select(gInstSplitA.w, gInstSplitN.w, piece == 1), 0.0, piece == 0 || !splitIn);
      let p = splitMoveBack(pIn, gInstSplitH.xyz, gInstSplitA.xyz, theta);   // shadows p for the rest of the slot body
      // ... the existing slot body, unchanged, using p ...
      // the piece caps, applied to the slot's final d (after bones, before the union bookkeeping):
      //   piece 0 (when splitIn): d = max(d,  dot(u, p - h));
      //   piece 1:                d = max(d, max(-(dot(n, p) - d0), -dot(u, p - h)));
      //   piece 2:                d = max(d, max( (dot(n, p) - d0), -dot(u, p - h)));
      //   outside the region (splitOpen && !splitIn): d = min(d, splitDh - gInstSplitR.x + ${REGION_SKIN});
      // then the existing union-min bookkeeping, which now runs once per piece (a piece is unioned like a slot).
    }
```

  - **Rename the parameter.** Rename `mapBody`'s parameter `p` to `pIn` and keep a `let p = pIn;` at the top for code before the slot loop. Check every pre-loop use.
  - **Text pins.** Add a WGSL `fn splitMoveBack(p, h, a, theta) -> vec3<f32>` (Rodrigues; theta 0 returns p) next to `INSTANCE_STATE`. The text pins check it is the CPU `rotAxis` with `-theta`.
  - **`continue` semantics.** Statements inside the slot body that `continue` the slot loop now continue the piece loop. That is still correct: a piece is skipped like a slot. Check every `continue` and `break` in the slot body and record your reasoning in a comment. Any `break` that ends the SLOT loop must become a flag-and-break of both loops.
  - **Early skip.** For pieces 1 and 2, skip the slot body when the cap alone (`max(-(n·p − d0), −u·(p − h))` at the moved point) already exceeds the best `d` so far. Use the same for piece 0 with `u·(p − h)`.
  - **Hit bookkeeping.** Record which piece won the union in a private `gHitPiece`, next to `hitBest`, so the post-hit (Task B6) knows the half.
  - **Bounds tiles stay valid at the moved point.** `foldGroup`'s `gTileBounds` spheres are in the un-warped frame, and `p` is un-warped per piece.

**5. Verify.**
- Golden `-u`; census; march-hash. The scenes have no split, so pins should not move; if they do, investigate.
- Boot pair.
- Measure the cost of a split head with `forceSplit` on one zombie at 0.6 m and 2 m: `timeDraws` with the split closed vs open, interleaved. Record it in NOTES.

Commit `feat(head-split): GPU record (REC_VEC4S 21) and the three-piece split field in mapBody (golden -u)`.

---

## Task B5: Bounds and culls follow the open head

**Files:**
- Modify: `webgpu/zombie-gpu.ts` (`fit()`, tile groups, wound-list gate); `webgpu/game-main.ts` (outer and occluder hull call sites); `webgpu/march/body/blocks/setup/wound-list.wgsl.ts`.
- Test: a CPU test that the inflated bounds contain the moved head; WGSL text pins.

- [ ] **The proxy box (`fit`), `ROW_CLUSTER_BOUNDS` and the depth pre-pass.** When the view's split is open, replace the head cluster's sphere with one containing the region sphere (centre h, radius r). The proxy box, the crowd rect, the ray window and the depth pre-pass miss cull all read these.
- [ ] **Screen tiles.** Inflate every group whose prim range lies in the head cluster to the region sphere (it still contains the original).
- [ ] **Outer hull.** When an actor is split, add the region sphere to its outer-hull instances, or skip the hull discard for that slot, whichever is simpler and sound. Read `shell-hull-outer.ts` first.
- [ ] **Occluder hull.** Exclude head spheres for a split actor, since an occluder inside a now-open head would show.
- [ ] **Per-ray wound list.** For a split slot, turn the list off (`gWoundListOn` false for that slot), so every wound is considered at the un-warped point.
- [ ] **Tests:**
  - a pure test that, for a split body, the inflated head sphere contains every head prim's moved extent;
  - pins for the wound-list gate.
- [ ] **Verify:** golden `-u`, census and march-hash. Then a gate check (in Task B8's script, or a temporary probe): a split head at 0.6 m has no clipped halves at the box edges or hull discard. Measure the share of the head's region disc that changes when the split opens.
- [ ] **Commit** `feat(head-split): bounds, tiles, hulls and the wound list follow the open head (golden -u)`.

---

## Task B6: Post-hit shading at the un-warped point; analytic normals fall back

**Files:**
- Modify: `webgpu/march/body/trace.wgsl.ts` (`MARCH_TRACE_POST`); `body/blocks/post/shading-normal.wgsl.ts`; `body/blocks/post/wound-masks.wgsl.ts`; `body/face.wgsl.ts`; `body/blocks/post/burn.wgsl.ts`; `baked-chunks.ts` (the face rename contract, if names change).
- Test: text pins; `trace.wgsl.test.ts`; `face.wgsl.test.ts`.

- [ ] **After `let p = camPos + rd * t;` in the post:**

```wgsl
  // THE HEAD SPLIT (head-split.ts unwarpPoint): shading that is anchored to the body (rest anchor, wound masks, the
  // face sheet, bone taps) runs at the winning piece's UN-WARPED point pS with directions rotated back into it (nS);
  // lighting stays in world space.
  let splitTheta = select(0.0, select(gInstSplitA.w, gInstSplitN.w, gHitPiece == 1), gHitPiece != 0);
  let pS = splitMoveBack(p, gInstSplitH.xyz, gInstSplitA.xyz, splitTheta);
```

- Add a `fn splitRotBack(v, a, theta)` for directions.
- Use `pS` for:
  - `restPoint` (the anchor);
  - `woundMask` / `charMask`, with `splitRotBack(nSmooth, …)`;
  - the face block's `hpv` and `facing`, rotating the face bump back to world with `+theta` before adding it to `n`;
  - the burn bone taps, rotating `boneN` back to world.
- Keep lighting on world `p` / `n`.
- [ ] **Analytic normals.** When `splitTheta != 0.0`, or the hit is inside an open split region, use the FD `calcNormal` path (it differentiates `mapBody`, so it is warp-correct). In `shading-normal`, set the "analytic invalid" reason the existing fallback uses.
- [ ] **Text pins.** Update the anchor and `woundMask` pins to the `pS` forms, and add pins for `splitRotBack` and the FD fallback.
- [ ] **Verify:** golden `-u`, census, march-hash and the boot pair. Look at a forced split close up: the face texture rides each half, the wound masks sit on their cuts, and there are no smeared normals at the cut faces beyond the FD lip.
- [ ] **Commit** `feat(head-split): post-hit shading at the un-warped point; analytic normals fall back to FD in the split (golden -u)`.

---

## Task B7: The skull mesh splits

**Files:**
- Modify: `webgpu/skeleton-spike/mesh-renderer.ts` and its test; `webgpu/game-main.ts` (the `segMeshRenderer.update` / `extra` call site, ~1752).

- [ ] **Per split actor,** push the head segment (and its eyes) TWICE, one instance per piece. Each instance's matrix is premultiplied by its piece's rotation about the hinge (`R(a, +theta)` about `h`; piece 0 has no rotation).
- [ ] **Clip.** Add a per-instance clip attribute (vec4 plane in world space) with a fragment `discard` on the side that piece does not own:
  - piece 1 keeps `s ≥ 0` above the hinge;
  - piece 2 keeps `s ≤ 0` above the hinge;
  - piece 0 keeps below the hinge.

  Piece 0 needs a second plane, the hinge plane `u`. Either use two attributes, or skip piece 0 for the skull if no skull vertex lies below the hinge: measure that.
- [ ] **Craters.** `setWounds` compares crater spheres with `positionWorld`. For a rotated instance, compare against the pre-rotation position: apply the piece's inverse rotation in the shader via a per-instance attribute, or pass craters per piece. Craters are un-warped.
- [ ] **Tests:** `mesh-renderer.test.ts` exposes the per-instance matrices. Assert two head instances with the right rotations and clip planes for a split actor, and one for a closed one.
- [ ] **Verify:** census, plus a forced-split photo where the skull's halves follow the flesh halves with no skull poking through the gap.
- [ ] **Commit** `feat(head-split): the skull mesh splits with the flesh (per-piece instances + clip)`.

---

## Task B8: The capture gate and the look

**Files:**
- Create: `scripts/head-split-gate.mjs` (plumbing copied from `scripts/axe-gate.mjs`: `sed -n '1,/^const out = {};/p'`).
- Create: `docs/dev-notes/2026-10-04-head-split/NOTES.md` and `gate/*.png`.

**Scenarios:**

| Scenario | What it checks |
| --- | --- |
| S | A centred head chop (`axeChop(id, "H", "head")`) opens a `middle` split with both sides. The gap between the face halves is measured in pixels on a horizontal line through the eyes: it grows, overshoots and settles (photos at 0, 4, 8, 30 frames, thawed). The zombie is alive. |
| O | An off-centre chop (aim the seam at head centre + 0.06 m along the head's right) opens ONE side, and the other half's pixels are unchanged. |
| W | Chop 2 widens: the gap is larger than after chop 1. |
| K | Chop 3 kills (the thaw-and-read from axe-gate), and the corpse's head stays open 45 frames on. |
| L | A later rod cut on an opened half lands where `unwarpPoint` predicts; the cut is visible on the moved half. |
| F | `forceSplit(id, 'face', …)` folds the face half forward (photo). |
| T | S on a turned zombie. |
| C | Frame cost with the split open vs closed, at 0.6 m and 2 m (ungated, with spread), and zero console errors. |

**Look step** (one change at a time, before and after; the owner wants it EXCESSIVE): tune `HEAD_SPLIT` (angles, hinges, spring) and the cut-face calibre for a violent, wide-open read. Record each change in NOTES. List further ideas.

Commit `test(head-split): capture gate (open, one side, widen, kill, later cuts, face, turned, cost) and look notes`.

---

## Task B9: Docs

- [ ] `docs/tasks/combat-and-gore.md`: the axe line → part B built (date), owner playtest pending.
- [ ] `TASKS.md`: update the in-flight line.
- [ ] The spec: append `## 10. As built (part B)`. Cover the union-of-pieces decision (vs the bisector pick), the record layout (21), the cut faces' `'keep'` budget, the cost, and the limits.
- [ ] Run `npx tsc --noEmit && npx vitest run head-split head-split-cpu game-head-split game-axe axe-head cut-wound crowd-records groups.wgsl map-body.wgsl trace.wgsl wounds.wgsl mesh-renderer march-golden game-context-coverage` → PASS.
- [ ] Commit `docs: the head split part B as built`.
