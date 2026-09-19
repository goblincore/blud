# Burning Feedback Pass Implementation Plan

> **For agentic workers:** implement task-by-task, in order within a task. Tasks 1–3 are independent (round 1, parallel); Task 4 is round 2 (lab); Task 5 is round 3 and builds on Task 4's branch. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Address the owner's six playtest items on burning enemies: fire lights the room, no burn look on non-burning neighbours, burning enemies panic/stumble, a readable skeleton, and a continuous volumetric fire + smoke that trails a moving body, with flame cards kept as accents.

**Spec:** `docs/superpowers/specs/2026-09-18-burning-feedback-pass-design.md` — read it first. Background: `docs/dev-notes/2026-09-18-flame-playtest-feedback.md`, `docs/dev-notes/2026-09-18-wildfire-fire-teardown.md`, `docs/dev-notes/2026-09-17-flame-lab/NOTES.md`.

**Architecture:** Pure logic (light ranking, panic behaviour, capsule extraction, packing, velocity lag) lives in small tested TS modules; GPU work is WGSL string modules wired into existing seams (the probe gather light list, the post-aa tongue-pass seam, the march's burn block). Visual claims are proved with captures + measurements.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never the bare full suite. Known pre-existing failures: 12 files / 15 tests.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts must require `window.__warmGate.phase === 'ready'` (see `scripts/flare-ingame-capture.mjs`) and fail on renderer pipeline errors.
- **Prove visual claims with a number** (mean luminance of a crop, frame-to-frame pixel change, GPU ms), and look at the images yourself.
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's `.visible`. Never sample the render target you are writing. In `march.wgsl.ts`'s positional uniform lists (`MARCH_BODY_PARAMS`) never put a `:` inside a comment.
- Game running: `npx vite --port <free port> --strictPort`, page `/sdf-game.html`. The game's flame cards need the untracked atlas: run `npm run flame:atlas` once in your worktree. Console helpers: `__sdfGame.igniteAll()`, `extinguishAll()`, `burning()`, `flameCards()`.
- Kill anything you start outside a capture script in the same step.
- **`game-main.ts` is decomposed (main, merged 2026-09-18):** every piece of `main()` state lives on `ctx` (`GameContext`, slices in `game-state-*.ts`), and `scripts/game-context-coverage.test.ts` fails if `main()` gains any other state binding. The burn harness lives BESIDE it: `webgpu/game-burning.ts` (registry, cards, uniforms, flashes; held as `ctx.vfx.burning`) and `webgpu/game-flare.ts` (slot 3; `ctx.weapon.flare`). Put new burn logic in those modules (or a new module) and leave only one-line call sites in `game-main.ts`. Line numbers below are approximate — grep for the named markers. Run `npm test -- game-context-coverage` whenever you touch `game-main.ts` or a slice.
- Commit with the trailer `Co-Authored-By: DeepSeek Flash <noreply@deepseek.com>`.

---

## Task 1 (round 1): Fire lights the room + neighbour molten look

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/burn-room-light.ts`, `src/lab/sdf-zombie/webgpu/burn-room-light.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/burn-profiles.ts` (+ its test) — add `lightGatherPeak`, `lightMeshPeak`
- Modify: `src/lab/sdf-zombie/webgpu/game-burning.ts` — the fire light logic (gather list feed, mesh PointLight pool, flash flicker)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` — call sites only: after the "(3b) LIVE EXPLOSIONS" gather loop (~1819), and next to the explosion pool writer (`ctx.vfx.explosionLightPool` loop, ~7404)
- Create: `scripts/burn-light-capture.mjs`
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/A-light-and-neighbours.md`

**Off-limits:** `game-actor.ts`, `motion.ts`, `march.wgsl.ts`, `flame-lab-main.ts`, `post-aa.ts` (other tasks own them). Task 2 also edits `game-burning.ts` (its `step()` only) — keep your changes to new methods plus `pushFlashes`.

### Background

The SDF room is lit by the probe gather's `gatherLights` list (max 8 slots). Explosions reach walls through it (`EXPLOSION_LIGHT.gatherPeak`, block "(3b) LIVE EXPLOSIONS") and reach mesh props through `explosionLightPool` (always-visible `PointLight`s at intensity 0 when idle). Burning bodies today only push `directFlashes` (lights bodies). Fire needs a gather-side and a mesh-side light.

- [ ] **Step 1: Write the failing tests** in `burn-room-light.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fireGatherLights, assignFirePool, type FireLightSource } from './burn-room-light';

const src = (x: number, intensity: number): FireLightSource => ({ pos: [x, 1, 0], intensity });

describe('fireGatherLights', () => {
  it('returns nothing for no burners or zero cap', () => {
    expect(fireGatherLights([], [0, 1, 0], 2)).toEqual([]);
    expect(fireGatherLights([src(1, 5)], [0, 1, 0], 0)).toEqual([]);
  });
  it('keeps one slot per burner while under the cap, nearest first', () => {
    const out = fireGatherLights([src(5, 1), src(1, 1)], [0, 1, 0], 2);
    expect(out.map(l => l.pos[0])).toEqual([1, 5]);
  });
  it('merges surplus burners into the nearest kept slot, conserving intensity', () => {
    const out = fireGatherLights([src(1, 2), src(2, 2), src(9, 4)], [0, 1, 0], 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.intensity).toBeCloseTo(8);
    // intensity-weighted position: (1*2 + 2*2 + 9*4) / 8
    expect(out[0]!.pos[0]).toBeCloseTo(5.25);
  });
  it('skips burners with zero intensity', () => {
    expect(fireGatherLights([src(1, 0)], [0, 1, 0], 2)).toEqual([]);
  });
});

describe('assignFirePool', () => {
  it('fills slots nearest-first and zeroes the rest', () => {
    const out = assignFirePool([src(4, 3), src(1, 2)], [0, 1, 0], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ pos: [1, 1, 0], intensity: 2 });
    expect(out[1]).toEqual({ pos: [4, 1, 0], intensity: 3 });
    expect(out[2]!.intensity).toBe(0);
  });
});
```

- [ ] **Step 2: Run, watch fail.** `npm test -- burn-room-light` → FAIL (module missing).

- [ ] **Step 3: Implement** `burn-room-light.ts`:

```ts
// src/lab/sdf-zombie/webgpu/burn-room-light.ts
//
// FIRE → ROOM LIGHT, as pure numbers. The room is lit by the probe gather's
// dynamic list (8 slots shared with flashes, explosions, tracers), so fire gets
// a small fixed number of slots and surplus burners MERGE into the nearest kept
// slot rather than dropping out (the room must not go dark when a third body
// catches). Mesh props get a fixed always-visible PointLight pool.
import type { Vec3 } from '../types';

export interface FireLightSource { pos: Vec3; intensity: number }

const d2 = (a: Vec3, b: Vec3) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearestFirst(src: readonly FireLightSource[], eye: Vec3): FireLightSource[] {
  return src.filter(s => s.intensity > 0).sort((a, b) => d2(a.pos, eye) - d2(b.pos, eye));
}

export function fireGatherLights(
  src: readonly FireLightSource[], eye: Vec3, cap: number,
): FireLightSource[] {
  if (cap <= 0) return [];
  const sorted = nearestFirst(src, eye);
  const kept = sorted.slice(0, cap).map(s => ({
    sum: s.intensity, wx: s.pos[0] * s.intensity, wy: s.pos[1] * s.intensity, wz: s.pos[2] * s.intensity,
    at: s.pos,
  }));
  for (const s of sorted.slice(cap)) {
    let best = kept[0]!;
    for (const k of kept) if (d2(k.at, s.pos) < d2(best.at, s.pos)) best = k;
    best.sum += s.intensity;
    best.wx += s.pos[0] * s.intensity; best.wy += s.pos[1] * s.intensity; best.wz += s.pos[2] * s.intensity;
  }
  return kept.map(k => ({ pos: [k.wx / k.sum, k.wy / k.sum, k.wz / k.sum] as Vec3, intensity: k.sum }));
}

export function assignFirePool(
  src: readonly FireLightSource[], eye: Vec3, slots: number,
): FireLightSource[] {
  const sorted = nearestFirst(src, eye);
  const out: FireLightSource[] = [];
  for (let i = 0; i < slots; i++) out.push(sorted[i] ?? { pos: [0, 0, 0], intensity: 0 });
  return out;
}
```

(`fireGatherLights` and `assignFirePool` allocate; they run once per frame only while `burning.size > 0`, which is acceptable. Do not call them when nothing burns.)

- [ ] **Step 4: Run, watch pass.** `npm test -- burn-room-light`.

- [ ] **Step 5: Tuning.** In `burn-profiles.ts` add to `BurnTuning`, `BURN_TUNING`, `BURN_BOUNDS` (and every preset, via the existing spread pattern):
  - `lightGatherPeak` — default `120`, bounds `[0, 400]` (explosion gather peak is 220 for a half-second blast; a sustained fire sits lower).
  - `lightMeshPeak` — default `40`, bounds `[0, 400]` (braziers are 9–13, explosion 320).
  Update `burn-profiles.test.ts` if it pins the field list. `npm test -- burn-profiles`.

- [ ] **Step 6: Wire the gather side.** Add to `GameBurning` (in `game-burning.ts`) a method `pushGatherLights(out: GatherLight[], eye: Vec3, room: <the dynRoom type>, cap: number, spread: number): void` (import the gather light type and `nearRoomPoint` from wherever `game-main.ts` gets them; if `nearRoomPoint` is a local function in `game-main.ts`, pass it in as a parameter instead). It returns immediately when nothing burns; otherwise builds `FireLightSource[]` from `registry.forEachActive` (skip `s.burn <= 0.02`; pos = `burnLightAnchor(pose pos)`; intensity = `burnLightIntensity(s.burn, s.char, tuning.lightGatherPeak, tuning.lightFlicker, burnLightFlicker(clock, …, a.id * 2.7))` — the same clock `pushFlashes` uses), filters by the room test, then pushes `fireGatherLights(list, eye, cap)` as `{ pos, color: [1.0, 0.5, 0.18], intensity, fill: spread * 0.5 }`. In `game-main.ts`, right after the "(3b) LIVE EXPLOSIONS" loop and before `tracerSlots`, add ONE call: `ctx.vfx.burning.pushGatherLights(gatherLights, ctx.player.player.pos, dynRoom, Math.min(2, 8 - gatherLights.length), ctx.vfx.spread);`

- [ ] **Step 7: Wire the mesh side.** In `game-burning.ts`, create the pool lazily inside `ensureCards()`'s first-ignite path is NOT allowed (adding a light later re-keys the lights node — a recompile). Instead add `createFireLightPool(parent: THREE.Object3D): void`, called ONCE from `game-main.ts` right after the explosion pool is built (`ctx.world.accentGroup` as parent): 4 × `new THREE.PointLight(0xff8a3a, 0, 0, 2)`, `visible = true`. Add `updateFireLightPool(eye: Vec3): void` — zero every light when nothing burns (only on the transition; keep a boolean), else `assignFirePool(list, eye, 4)` with `tuning.lightMeshPeak`, writing `position`/`intensity`. Call it from `game-main.ts` next to the explosion pool writer loop. Never touch `.visible`. **Check the boot pipeline count before and after** (the warm-up must compile the lit materials with 3 + 4 point lights; confirm no compile on first ignite).

- [ ] **Step 8: Capture script** `scripts/burn-light-capture.mjs` (copy the harness of `scripts/flare-ingame-capture.mjs`, same positional args `<vitePort> <cdpPort> <outDir>`): after warm gate `ready`, ignite one zombie near the player (`__sdfGame.igniteAll()` then `extinguishAll` all but the nearest, or add a `__sdfGame.igniteNearest()` helper if simpler), wait 2 s, screenshot; then set `__sdfGame.setBurnTuning?.({ lightGatherPeak: 0, lightMeshPeak: 0 })` (add this console helper if absent, routing through `resolveBurnTuning`) and screenshot the same frame. Print the mean luminance of a fixed floor/wall crop for both. Freeze light flicker for the pair (`lightClockFrozen` seam) so the two frames are comparable.

- [ ] **Step 9: Run it.** Expected: crop luminance with fire light clearly above without (report both numbers). Also report the gather cost with 4 burners vs 0 (the game's existing gather timing, `__sdfGame` perf stats / `probe` timings — find and cite which).

- [ ] **Step 10: Diagnose the neighbour molten look.** Leading suspect: the burn `directFlashes` push (`pushFlashes` in `game-burning.ts`) — its comment says the burning body "lights itself and its neighbours", so a fast warm flicker lands on nearby bodies. Measure in the capture script: ignite ONE zombie that has a non-burning zombie within ~2 m; project the neighbour's torso to screen; record 30 frames (~1 s) of a 40×40 crop over it; report mean absolute frame-to-frame change. Repeat with (a) burn distortion off (`burn-distort` strength 0 via its existing seam), (b) flicker depth 0 for the directFlashes push, (c) log `REC_BURN`/`burnCfg` values for the neighbour (must be 0). Write the table into the notes.

- [ ] **Step 11: Fix what the numbers point at.**
  - If the flicker: one `directFlashes` entry lights every nearby body, so it cannot flicker for the burner and stay steady for neighbours. Push it with a much smaller flicker depth (`lightFlicker * 0.25`); the burning body still flickers through its own animated surface-fire emissive, and the room lights from Steps 6–7 carry the visible flicker. Re-measure.
  - If the distortion: clamp its footprint to the burner's flame mask (it must not warp pixels whose burn mask is 0 AND lie outside the flame cards' screen bounds).
  - If a real burn value leaks: fix the source and add a test.
  Re-measure; the neighbour's change must drop to within 1.5× of a no-fire baseline crop.

- [ ] **Step 12: Verify + commit.** `npm test -- burn-room-light burn-profiles burn-registry burn-light` and `npx tsc --noEmit`. Write the notes file (numbers, before/after crops, cause of the neighbour look). Commit.

---

## Task 2 (round 1): Burning behaviour — soldiers flee, zombies push on, both stumble

**Files:**
- Create: `src/lab/sdf-zombie/burn-behaviour.ts`, `src/lab/sdf-zombie/burn-behaviour.test.ts`
- Modify: `src/lab/sdf-zombie/motion.ts` — optional `cruiseScale` on `MotionSignals` (default 1, byte-identical when absent)
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts` — `setBurning(on)` on `ZombieActor`, override next to the `doomed` block (~910)
- Modify: `src/lab/sdf-zombie/webgpu/game-burning.ts` — `step()` only: call `a.setBurning(...)` on transitions (Task 1 edits other parts of this file)
- Create: `scripts/burn-behaviour-trace.mjs`
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/C-behaviour.md`

**Off-limits:** `march.wgsl.ts`, `flame-lab-main.ts`, `post-aa.ts`, `burn-room-light*`, and `game-main.ts` except for console seams in the `__sdfGame` literal (keep those additions in one contiguous block).

- [ ] **Step 1: Write the failing tests** in `burn-behaviour.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BURN_BEHAVIOUR, createBurnPanic, stepBurnPanic } from './burn-behaviour';

const run = (kind: 'zombie' | 'soldier', secs: number, seed = 7) => {
  const s = createBurnPanic(seed);
  const outs = [];
  for (let t = 0; t < secs; t += 1 / 30) {
    outs.push(stepBurnPanic(s, { kind, self: [0, 0, 0], player: [5, 0, 0], chaseTarget: [5, 0, 0] }, 1 / 30));
  }
  return outs;
};

describe('stepBurnPanic', () => {
  it('soldier targets a point AWAY from the player and never fires', () => {
    const outs = run('soldier', 4);
    for (const o of outs) {
      expect(o.fire).toBe(false);
      expect(o.target![0]).toBeLessThan(0);           // player is at +x
    }
    expect(outs[0]!.cruiseScale).toBeCloseTo(BURN_BEHAVIOUR.soldierSpeed);
  });
  it('zombie keeps its chase target direction, faster, with jitter', () => {
    const outs = run('zombie', 4);
    expect(outs[0]!.cruiseScale).toBeCloseTo(BURN_BEHAVIOUR.zombieSpeed);
    for (const o of outs) expect(o.target![0]).toBeGreaterThan(0);
    const zs = new Set(outs.map(o => o.target![2].toFixed(3)));
    expect(zs.size).toBeGreaterThan(5);                // heading actually wanders
  });
  it('stumbles at least once per stumbleMaxSec and not more often than stumbleMinSec', () => {
    const outs = run('zombie', 12);
    const idx = outs.flatMap((o, i) => (o.stumble ? [i] : []));
    expect(idx.length).toBeGreaterThanOrEqual(Math.floor(12 / BURN_BEHAVIOUR.stumbleMaxSec));
    for (let i = 1; i < idx.length; i++) {
      expect((idx[i]! - idx[i - 1]!) / 30).toBeGreaterThanOrEqual(BURN_BEHAVIOUR.stumbleMinSec - 1e-6);
    }
  });
  it('is deterministic for a seed', () => {
    expect(run('soldier', 3, 11)).toEqual(run('soldier', 3, 11));
  });
});
```

- [ ] **Step 2: Run, watch fail.** `npm test -- burn-behaviour`.

- [ ] **Step 3: Implement** `burn-behaviour.ts`:

```ts
// src/lab/sdf-zombie/burn-behaviour.ts
//
// WHAT A BURNING BODY DOES, as a pure seeded step. Per type (owner call,
// 2026-09-18): a soldier panics — no shooting, flees the player on an erratic
// heading, faster; a zombie is mindless — keeps chasing, faster, heading
// jittering. Both stumble every stumbleMinSec..stumbleMaxSec. The actor applies
// this as an override of its mind's verdict (the `doomed` pattern), so neither
// brain learns a new state.
import type { Vec3 } from './types';

export const BURN_BEHAVIOUR = Object.freeze({
  soldierSpeed: 1.4,
  zombieSpeed: 1.25,
  /** Soldier flee target: this far from self, re-picked every repickMin..Max s. */
  fleeDistM: 4,
  repickMinSec: 1,
  repickMaxSec: 2,
  /** Max heading swing off the away/chase direction, radians. */
  soldierSwingRad: 1.0,
  zombieJitterRad: 0.45,
  /** Zombie jitter rate (Hz of the smooth wobble). */
  zombieJitterHz: 0.7,
  stumbleMinSec: 1.5,
  stumbleMaxSec: 3,
  /** Stagger impulse gain handed to the motion system's lurch. */
  stumbleGain: 0.6,
});

export interface BurnPanicState { rng: number; nextRepick: number; swing: number; nextStumble: number; t: number; phase: number }

function next(s: BurnPanicState): number {          // mulberry32
  let x = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function createBurnPanic(seed: number): BurnPanicState {
  const s: BurnPanicState = { rng: seed | 0, nextRepick: 0, swing: 0, nextStumble: 0, t: 0, phase: 0 };
  s.phase = next(s) * Math.PI * 2;
  s.nextStumble = lerp(BURN_BEHAVIOUR.stumbleMinSec, BURN_BEHAVIOUR.stumbleMaxSec, next(s));
  return s;
}

export interface BurnPanicInput { kind: 'zombie' | 'soldier'; self: Vec3; player: Vec3 | null; chaseTarget: Vec3 | null }
export interface BurnPanicOut { target: Vec3 | null; cruiseScale: number; fire: false; stumble: boolean }

function rotateXZ(dx: number, dz: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function stepBurnPanic(s: BurnPanicState, i: BurnPanicInput, dt: number): BurnPanicOut {
  const B = BURN_BEHAVIOUR;
  s.t += dt;
  let stumble = false;
  if (s.t >= s.nextStumble) {
    stumble = true;
    s.nextStumble = s.t + lerp(B.stumbleMinSec, B.stumbleMaxSec, next(s));
  }
  if (i.kind === 'soldier') {
    if (s.t >= s.nextRepick) {
      s.swing = (next(s) * 2 - 1) * B.soldierSwingRad;
      s.nextRepick = s.t + lerp(B.repickMinSec, B.repickMaxSec, next(s));
    }
    const p = i.player ?? [i.self[0] + 1, 0, i.self[2]];
    let dx = i.self[0] - p[0], dz = i.self[2] - p[2];
    const len = Math.hypot(dx, dz) || 1;
    [dx, dz] = rotateXZ(dx / len, dz / len, s.swing);
    return {
      target: [i.self[0] + dx * B.fleeDistM, i.self[1], i.self[2] + dz * B.fleeDistM],
      cruiseScale: B.soldierSpeed, fire: false, stumble,
    };
  }
  const c = i.chaseTarget;
  if (!c) return { target: null, cruiseScale: B.zombieSpeed, fire: false, stumble };
  const dx = c[0] - i.self[0], dz = c[2] - i.self[2];
  const wob = Math.sin(s.t * B.zombieJitterHz * Math.PI * 2 + s.phase)
    + 0.5 * Math.sin(s.t * B.zombieJitterHz * 5.3 + s.phase * 1.7);
  const [rx, rz] = rotateXZ(dx, dz, (wob / 1.5) * B.zombieJitterRad);
  return { target: [i.self[0] + rx, c[1], i.self[2] + rz], cruiseScale: B.zombieSpeed, fire: false, stumble };
}
```

(If a test's expectation is wrong against this code, fix the code to meet the behaviour, not the test — e.g. zombie `target[0] > 0` must hold because jitter ≤ 0.45 rad.)

- [ ] **Step 4: Run, watch pass.** `npm test -- burn-behaviour`.

- [ ] **Step 5: `cruiseScale` in motion.** In `motion.ts` add to `MotionSignals`: `/** Burning-panic speed multiplier on the cruise speed; absent = 1. */ cruiseScale?: number;` and multiply `travelCruise` by `(sig.cruiseScale ?? 1)` at its definition (~line 600). Run `npm test -- motion gait stagger` — must stay green (absent ⇒ identical).

- [ ] **Step 6: Actor override.** In `game-actor.ts`:
  - Add `setBurning(on: boolean): void` to the `ZombieActor` interface and implementation; state `let burnPanic: BurnPanicState | null = null` (created with `createBurnPanic(id * 7919 + 1)` on the rising edge, nulled on the falling edge).
  - Right after the `if (doomed) { … }` block: `if (burnPanic && !doomed) { const bp = stepBurnPanic(burnPanic, { kind: mind.meleeCapable ? 'zombie' : 'soldier', self: state.wander.pos, player: brainPlayer ? [brainPlayer.x, 0, brainPlayer.z] : null, chaseTarget: think.target }, sdt); think = { ...think, target: bp.target, halt: bp.target === null, fire: false, weaponUp: false, attack: mind.meleeCapable ? think.attack : null, faceHeading: null }; burnCruiseScale = bp.cruiseScale; if (bp.stumble) queueBurnStumble(); } else burnCruiseScale = 1;` — use whatever the file calls the soldier/zombie distinction if `mind.meleeCapable` is not it (check how the actor knows it is a soldier; a soldier is the ranged type).
  - Pass `cruiseScale: burnCruiseScale` in the signals handed to `stepMotion`.
  - `queueBurnStumble()`: set the pending shot signal the actor already feeds to motion (`pendingShot`, ~871) to `{ type: 'blast', dirWorld: <unit forward of body heading>, woundWorld: <chest position>, torso: true, gain: BURN_BEHAVIOUR.stumbleGain }` — the motion shot signal is a POSE reaction only (wounds come from `freshWounds`, which you must not touch). If the soldier path turns `blast` into a heavy soldier stagger, set `soldierLevel: 'light'` (check `SoldierStaggerLevel`) so it stays a lurch, not a knockdown.
  - Arm flail: look for an existing additive arm-pose seam (carry / aim / `motion.ts` arm terms). If one exists, drive both arms with a raised, fast (~3 Hz) seeded wobble while burning. If none exists, emit a `burn` (shudder) shot signal every 0.35 s instead as the flail stand-in, and say so in the notes.
  - While burning a soldier must not fire: also force `signals.fire = false` after it is computed.

- [ ] **Step 7: Registry → actor.** In `game-burning.ts`'s `step(dt)`: keep a reused `Set<ZombieActor>` of bodies currently burning (`state.burn > 0.02`); after `registry.step`, call `a.setBurning(true)` for newly burning bodies and `a.setBurning(false)` for bodies that dropped out (extinguished, burnt down, or released — also call it in `retire(a)`). Allocation-free per frame: two reused sets swapped.

- [ ] **Step 8: Trace script** `scripts/burn-behaviour-trace.mjs` (harness from `flare-ingame-capture.mjs`): after warm gate ready, find one soldier and one zombie that can see the player (add `__sdfGame.igniteActor(id)` and an `__sdfGame.actorTrace()` returning `{id, kind, pos, speed, firing, staggerKind}` for all actors if absent), record 3 s unburnt, ignite both, record 6 s. Print per actor: mean speed before/after, distance-to-player trend (soldier must grow, zombie must shrink), shots fired while burning (must be 0 for the soldier), and stumble count (≥ 2 in 6 s). Save a contact sheet of 4 frames.

- [ ] **Step 9: Verify + commit.** `npm test -- burn-behaviour motion gait stagger brain soldier-brain game-actor` + `npx tsc --noEmit`. Notes with the trace numbers and frames. Commit.

---

## Task 3 (round 1): A readable skeleton without pale limbs

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — the burn block (~3937–4000, the skeleton reveal / scorched bone shading)
- Modify: `src/lab/sdf-zombie/webgpu/burn-profiles.ts` (+ test) only if a new tuning scalar is needed (e.g. `boneIvory`); prefer reusing `skeletonShow`/`skeletonDepth`
- Modify: `scripts/flame-capture.mjs` only to add a luminance report if it lacks one
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/D-skeleton.md`

**Off-limits:** `game-main.ts`, `game-actor.ts`, `motion.ts`, `post-aa.ts`, `flame-cards.ts`.

- [ ] **Step 1: Baseline captures + numbers FIRST.** `npm run flame:capture -- --technique cards` at the lab's mid-char and full-char states (read `flame-capture.mjs` for its fixtures/flags; use a fixed char via the lab's `__flameLab` state if needed). For each full-char frame compute the burning body's mean luminance over its silhouette (use a mask from a burn-off frame diff or a fixed body crop). Save `baseline-*.png` and the numbers.

- [ ] **Step 2: Read the current bone shading** in the march burn block: find where revealed bone (the `applyBones(1e9, p, …)` probe result, `burnSkeleton`, `burnSkeletonDepth`) sets albedo/gloss. Write down in the notes what it does now (the bone-fix pass made it dark/scorched).

- [ ] **Step 3: Shade bone as bone.** Where bone is revealed:
  - albedo: ivory `vec3(0.72, 0.66, 0.55)` multiplied by a soot streak term `mix(1.0, 0.25, sootNoise)` using the SAME fbm value that drives soot (so streaks match the char pattern), then by a cavity term darkening toward bone edges (use the bone field's distance: bone surface bright, the gap between bone and charred flesh dark);
  - gloss: low but non-zero (`0.25`), metal 0 — enough highlight that the rounded shape reads;
  - reveal only where `charAmt` exceeds `0.55` and the soot mask is high, so bone shows through burnt-through patches, not whole limbs.
  Keep every change inside the burn block's existing `if` so `burnAmt == 0 && charAmt == 0` compiles to the same result (non-burning bodies unchanged).

- [ ] **Step 4: Recapture + gate.** Same captures. **Gate:** full-char body mean luminance ≤ baseline × 1.15; bones visible (report the fraction of body pixels brighter than 2× the charred-flesh median — must be > 0 and < 0.25). Look at the images: ribs/skull/limb bones should read as shapes.

- [ ] **Step 5: Tests + commit.** `npm test -- zombie-gpu-burn march burn-profiles flame-lab-main` + `npx tsc --noEmit`. Notes with before/after sheet and numbers. Commit.

---

## Task 4 (round 2): Volumetric fire + smoke in the flame lab

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/fire-capsules.ts` (+ `.test.ts`) — pure: capsules from a posed build, velocities
- Create: `src/lab/sdf-zombie/webgpu/fire-volume-tuning.ts` (+ `.test.ts`) — tuning + bounds
- Create: `src/lab/sdf-zombie/webgpu/fire-volume-pack.ts` (+ `.test.ts`) — pure: rank bodies, pack the capsule buffer, lag offset mirror
- Create: `src/lab/sdf-zombie/webgpu/fire-volume.wgsl.ts` (+ `.wgsl.test.ts`) — march + resolve WGSL
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts` (+ test) — `setFireVolume(on, frame)` on the tongue-pass seam
- Modify: `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`, `flame-panel.ts` — technique `'volume'` (already in `TONGUE_TECHNIQUES`) = volume + cards; panel section; `run` fixture; `__flameLab` access
- Modify: `src/lab/sdf-zombie/webgpu/flame-cards.ts` — card count per body as a parameter (`maxCardsPerBody`, default = today's count)
- Modify: `scripts/flame-capture.mjs` — `--technique volume`, `--fixture run`, GPU timing
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/B-volume-lab.md`

**Off-limits:** `game-main.ts`, `game-actor.ts`, `march.wgsl.ts` (Task 3), `curl-volume-node.ts`/`soft-fade.ts` API (additive only).

### 4a. Capsules

- [ ] **Step 1: Failing tests** `fire-capsules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fireCapsules, capsuleVelocities, FIRE_CAPSULES_PER_BODY } from './fire-capsules';
import { buildTestBody } from './fire-capsules.fixture';

describe('fireCapsules', () => {
  it('returns at most FIRE_CAPSULES_PER_BODY capsules with positive radius', () => {
    const caps = fireCapsules(buildTestBody());
    expect(caps.length).toBeGreaterThan(4);
    expect(caps.length).toBeLessThanOrEqual(FIRE_CAPSULES_PER_BODY);
    for (const c of caps) expect(c.radius).toBeGreaterThan(0);
  });
  it('includes a crown above the head', () => {
    const caps = fireCapsules(buildTestBody());
    const crown = caps.find(c => c.crown);
    expect(crown).toBeDefined();
    const top = Math.max(...caps.filter(c => !c.crown).map(c => Math.max(c.a[1], c.b[1])));
    expect(crown!.a[1]).toBeGreaterThanOrEqual(top - 0.05);
  });
  it('skips subtractive and painted prims', () => {
    for (const c of fireCapsules(buildTestBody())) expect(c.source).not.toBe('sub');
  });
});

describe('capsuleVelocities', () => {
  it('is (cur - prev) / dt per endpoint midpoint, zero when prev is missing', () => {
    const prev = [{ a: [0, 0, 0], b: [0, 1, 0] }] as const;
    const cur = [{ a: [1, 0, 0], b: [1, 1, 0] }] as const;
    expect(capsuleVelocities(prev as any, cur as any, 0.5)[0]).toEqual([2, 0, 0]);
    expect(capsuleVelocities(null, cur as any, 0.5)[0]).toEqual([0, 0, 0]);
  });
});
```

  Create `fire-capsules.fixture.ts` that builds a real posed zombie `BuildResult` the way `flame-anchors`' tests or `flame-lab-main.test.ts` do (find the existing helper — e.g. a `buildBody(...)` call on the zombie character def — and reuse it; do not hand-write prims).

- [ ] **Step 2: Fail.** `npm test -- fire-capsules`.

- [ ] **Step 3: Implement.** `fireCapsules(b: BuildResult): FireCapsule[]` where `FireCapsule = { a: Vec3; b: Vec3; radius: number; limb: LimbId | 'crown'; crown: boolean; source: 'add' | 'crown' }`:
  - per cluster in `CLUSTER_ORDER`, take its additive, unpainted prims (`op !== 'sub' && color === undefined`, the `headShape` filter), keep the **2 fattest** per limb (torso 3), radius = prim radius (read `Primitive`'s radius field name from `types.ts`);
  - crown: from `headShape(b)` — `a = centre + [0, axes[1]*0.6, 0]`, `b = a + [0, 0.35, 0]`, radius `max(axes)*0.8`;
  - cap at `FIRE_CAPSULES_PER_BODY = 16`.
  `capsuleVelocities(prev, cur, dt)` returns per-capsule midpoint velocity (`[0,0,0]` if `prev` null or lengths differ or `dt <= 0`).

- [ ] **Step 4: Pass.** `npm test -- fire-capsules`. Commit.

### 4b. Tuning + packing + lag

- [ ] **Step 5: Failing tests** `fire-volume-pack.test.ts` and `fire-volume-tuning.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FIRE_VOLUME_MAX_BODIES, FIRE_CAPSULE_STRIDE, packFireVolume, fireLagOffset } from './fire-volume-pack';
import { FIRE_VOLUME_TUNING, FIRE_VOLUME_BOUNDS, resolveFireVolumeTuning } from './fire-volume-tuning';

const cap = (x: number) => ({ a: [x, 0, 0], b: [x, 1, 0], radius: 0.1, limb: 'torso', crown: false, source: 'add' }) as const;
const body = (x: number, burn = 1) => ({ capsules: [cap(x)], velocities: [[1, 0, 0]], burn, centre: [x, 1, 0] }) as any;

describe('packFireVolume', () => {
  it('ranks bodies nearest the camera first and caps at FIRE_VOLUME_MAX_BODIES', () => {
    const bodies = Array.from({ length: 12 }, (_, i) => body(12 - i));
    const p = packFireVolume(bodies, [0, 1, 0]);
    expect(p.bodyCount).toBe(FIRE_VOLUME_MAX_BODIES);
    expect(p.capsuleCount).toBe(FIRE_VOLUME_MAX_BODIES);
    expect(p.data[0]).toBeCloseTo(1);                       // nearest body's capsule a.x first
  });
  it('writes a, radius, b, burn, velocity per capsule at FIRE_CAPSULE_STRIDE', () => {
    const p = packFireVolume([body(2, 0.5)], [0, 1, 0]);
    expect(Array.from(p.data.slice(0, FIRE_CAPSULE_STRIDE))).toEqual([2, 0, 0, 0.1, 2, 1, 0, 0.5, 1, 0, 0, 0]);
  });
  it('drops bodies with burn 0 and returns an AABB around the rest', () => {
    const p = packFireVolume([body(2, 0), body(3, 1)], [0, 1, 0]);
    expect(p.bodyCount).toBe(1);
    expect(p.boundsMin[0]).toBeLessThanOrEqual(3 - 0.1);
    expect(p.boundsMax[1]).toBeGreaterThan(1);              // padded upward for the rise
  });
});

describe('fireLagOffset', () => {
  it('trails opposite the velocity, grows with height, clamps', () => {
    expect(fireLagOffset([2, 0, 0], 0, 0.3, 0.6).map(Math.abs)).toEqual([0, 0, 0]);
    const o = fireLagOffset([2, 0, 0], 0.5, 0.3, 0.6);
    expect(o[0]).toBeCloseTo(-0.3);
    expect(fireLagOffset([100, 0, 0], 1, 0.3, 0.6)[0]).toBeCloseTo(-0.6);
  });
});

describe('fire volume tuning', () => {
  it('clamps to bounds', () => {
    expect(resolveFireVolumeTuning({ steps: 9999 }).steps).toBe(FIRE_VOLUME_BOUNDS.steps[1]);
    expect(resolveFireVolumeTuning().resolutionScale).toBe(FIRE_VOLUME_TUNING.resolutionScale);
  });
});
```

- [ ] **Step 6: Fail**, then **implement**:
  - `fire-volume-tuning.ts` in the `tongue-tuning.ts` pattern: fields and defaults `resolutionScale 0.5 [0.25,1]`, `steps 32 [0,64]` (0 = off without a pipeline change), `tempGain 1.6 [0,4]`, `sootGain 0.6 [0,2]`, `rise 1.1 [0,3]` (m of flame above source), `sootRise 2.2 [0,5]`, `curlStrength 0.35 [0,1.5]`, `curlScale 1.2 [0.2,6]`, `lag 0.3 [0,1]`, `lagMaxM 0.6 [0,1.5]`, `history 0.85 [0,0.97]`, `cardsPerBody 5 [0,16]`, `smokeTailSec 2 [0,6]`.
  - `fire-volume-pack.ts`: `FIRE_VOLUME_MAX_BODIES = 8`, `FIRE_CAPSULE_STRIDE = 12` (`a.xyz, radius, b.xyz, burn, vel.xyz, pad`), `FIRE_VOLUME_MAX_CAPSULES = 8 * 16`; `packFireVolume(bodies, eye, out?)` reuses a preallocated `Float32Array` (pass `out` to avoid per-frame allocation), returns `{ data, capsuleCount, bodyCount, boundsMin, boundsMax }` with bounds padded by radius sideways and `rise + sootRise` upward; `fireLagOffset(vel, height, lag, maxM)` = `-vel * lag * height`, length-clamped to `maxM`. The WGSL must implement the identical formula (Step 9's test checks the string).
  - Pass, commit.

### 4c. The pass

- [ ] **Step 7: WGSL** in `fire-volume.wgsl.ts`, exporting `FIRE_VOLUME_MARCH_WGSL` and `FIRE_VOLUME_RESOLVE_WGSL` as TSL `wgslFn` sources, in the style of `post-tongues.ts` / `post-glow.ts` (read both first for how they bind textures and uniforms).
  - **March** (low-res target, rgba16f): reconstruct the view ray from screen UV + inverse view-projection; intersect with the packed AABB (skip → `vec4(0,0,0,1)` transmittance 1); stop distance = linearised scene depth from the capture's depth texture (sample it — this is the soft-fade trap: sample the SCENE depth texture, never the fragment's own depth); `steps` samples from a per-pixel, per-frame jittered start (interleaved-gradient noise on pixel + frame index).
  - Per sample `p`: for each capsule (loop to `capsuleCount`): `h = max(0, p.y - top(capsule))`; `q = p - fireLagOffset(vel, h, lag, lagMaxM)` (implement `fireLagOffset` in WGSL with the identical formula); warp `q += curlVector(q * curlScale + vec3(0, -time*rise, 0)) * curlStrength` via the shared curl volume node (import the WGSL/node accessor that `curl-volume-node.ts` exports — do not change its API); `d = sdCapsule(q, a, b) - radius`; temperature `+= burn * exp(-max(d,0)/0.08) * falloff(h/rise)`; soot `+= burn * sootShape(d, h)` where soot starts at `h > 0.4*rise` and extends to `sootRise`.
  - Accumulate front-to-back: emission `+= T * ramp(temp) * tempGain * dt`, `T *= exp(-soot * sootGain * dt)`, with `ramp` = Blood palette (dark red `0.35,0.03,0.0` → orange `1.0,0.35,0.05` → yellow `1.0,0.85,0.4`). Output `vec4(emission, T)`.
  - **Resolve** (full-res): bilinear upsample the low-res result, reproject the history (previous view-projection) and blend with `history` after a 3×3 neighbourhood min/max clamp; reset history when the tuning or the camera jumps (host flag). Composite into the capture with premultiplied blending: `out = scene * T + emission` (blend `One, SrcAlpha` with alpha = T — or do it in shader by reading the scene in the resolve if the seam gives you a separate target; never read the target you write).

- [ ] **Step 8: post-aa seam.** Add `setFireVolume(on: boolean, frame?: FireVolumeFrame)` and `setFireVolumeData(buf)` to `post-aa.ts` beside `setTongues`, running at the same point (after capture, before the shutter stage and glow). Off never binds the material (the all-off parity test in `post-aa.test.ts` must stay exact — add a test that `setFireVolume(false)` leaves the chain identical). `FireVolumeFrame` carries the tuning, time, frame index, inverse/prev view-projection, camera near/far, `capsuleCount`, bounds.

- [ ] **Step 9: WGSL string tests** `fire-volume.wgsl.test.ts`: the march source samples a depth texture argument (not `depth()`), contains the lag formula (`lag * h` and a clamp to `lagMaxM`), early-outs when `steps == 0`, and uses `curl` from the shared volume. `npm test -- fire-volume post-aa`.

### 4d. Lab wiring, captures, cost

- [ ] **Step 10: Lab.** In `flame-lab-main.ts`: technique `'volume'` = fire volume ON + cards with `maxCardsPerBody = tuning.cardsPerBody`; each frame per burning lab body compute `fireCapsules(posed build)`, velocities from last frame, `packFireVolume(...)` into a preallocated buffer, feed `postAa.setFireVolume(true, frame)`. Panel section "VOLUME" in `flame-panel.ts` for every `FIRE_VOLUME_TUNING` field (sliders from `FIRE_VOLUME_BOUNDS`). `__flameLab.setVolume(partial)` / `state().volume`. New fixture **`run`**: one burning body walking a loop across the floor at run speed with a turn, via the lab's existing locomotion. Cards: `flame-cards.ts` gains `maxCardsPerBody` (default = current count, so other techniques are unchanged); soften/enlarge only when `'volume'` is the technique.
- [ ] **Step 11: Captures.** `npm run flame:capture -- --technique volume` and `--technique cards` for the stand, walk, close and **run** fixtures, plus a sheet next to the wildfire screenshots (`docs/dev-notes/2026-09-18-wildfire-fire-teardown.md` names where they are). Look at them. Required: flame reads as one continuous mass (no repeated tiles), smoke rises dark above it, and in `run` the flame trails behind and straightens when the body stops.
- [ ] **Step 12: Cost.** GPU time of the fire pass (timestamp queries if the lab has them, else frame-time delta volume-on vs `steps 0`, interleaved runs) for 1, 4, 8 burning bodies at 0.5 and 0.25 scale. **Budget: ≤ 2 ms at 4 bodies, 0.5 scale.** If missed, report what dominates (capsule loop vs steps) and the 0.25 figure — do not hide it.
- [ ] **Step 13: Verify + commit.** `npm test -- fire-capsules fire-volume flame-cards flame-lab-main flame-panel post-aa tongue-tuning post-tongues` + `npx tsc --noEmit`. Notes: captures, cost table, what still looks off. Commit.

---

## Task 4b (round 2b, lab): Make the volume read as flame, make smoke visible, fix the cost

**Why (owner playtest + review, 2026-09-18):** round 2's volume reads as a soft orange glow shell and nobody can see smoke. Two root causes in `fire-volume.wgsl.ts`:
1. `temp` is a pure capsule-distance falloff (`exp(-d/0.06) * fireFalloff(h/rise)`); the curl only displaces the sample point a little (`curlStrength 0.35`). Nothing ERODES the shape, so it cannot form tongues or licks.
2. Soot only multiplies transmittance. Darkening an already-dark room is invisible. Smoke must SCATTER light (ambient grey + fire-lit orange from below) to be seen.
Also: the round-2 cost table is not credible (march, resolve, composite and a plain copy all measured ~2.6 ms — a copy cannot cost what a 32-step march does), and the three full-res passes do not shrink with `resolutionScale`.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/fire-volume.wgsl.ts` (+ `.wgsl.test.ts`), `fire-volume-tuning.ts` (+ test), `post-aa.ts` (+ test, the fire pass wiring only), `flame-lab-main.ts` / `flame-panel.ts` (new sliders), `scripts/flame-capture.mjs`
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/B2-volume-look.md`

**Off-limits:** `game-main.ts`, `game-burning.ts`, `game-actor.ts`, `march.wgsl.ts` / `march/` (a split refactor is planned there), `curl-volume-node.ts` API.

- [ ] **Step 1: Trustworthy cost first.** Fix the timing: verify each labelled pass's timestamp pair brackets only that pass (read how `__flameLab.passTimings()` collects them). Sanity checks that must hold before any number is reported: `steps 0` drops the march to near zero while the copy stays; the copy (a single full-res texture copy) is far below the march. Record a corrected baseline for 1/4/8 bodies at 0.5 scale.
- [ ] **Step 2: Cheaper passes.** Composite directly into the capture target with premultiplied blending (`out = scene * T + emission`: blend `One` for src colour, `SrcAlpha` for dst, output alpha = T) instead of composite-then-copy — if the seam cannot blend into the capture, explain why in the notes. Resolve (temporal reprojection) at the MARCH resolution, and upsample once in the composite. Re-measure with the Step 1 method; report per pass.
- [ ] **Step 3: Erode the flame into tongues.** In the march, per sample:
  - Build a flame-space coordinate `fq = (q - base) * vec3(freqXZ, freqY, freqXZ)` with `freqY < freqXZ` (vertically stretched noise, ~0.5×) scrolling DOWN over time at `rise` (so features rise), advected by the curl field (larger `curlStrength`, ~0.8–1.2 as a starting point, tunable).
  - `erosion = fbm(fq)` — use the existing WGSL noise (`noise3`/`fbm` from the march helpers are not importable here; write a 3–4 octave value-noise fbm in this module or sample the curl texture's alpha channel at 2–3 scales).
  - `shape = saturate(exp(-max(d,0)/coreR) * falloff(h/rise))`; `density = saturate((shape - erosion * erodeAmt(h)) * edgeSharp)` where `erodeAmt` grows with height (solid near the limb, torn into licks above it) and `edgeSharp` controls how crisp the lick edges are.
  - Temperature for the colour ramp = `density` scaled by a height cool-off, so tips go dark red and bases yellow-white.
  - New tuning (with bounds + panel sliders): `noiseScale`, `noiseStretch`, `erode`, `erodeRise`, `edgeSharp`, `coreR`. Start from values that visibly produce separate tongues in the `stand` fixture.
- [ ] **Step 4: Visible smoke.** Soot gets an albedo and is lit: `inscatter = soot * (smokeAmbient * ambientColour + smokeFireLit * fireGlow(h))` where `fireGlow` is the flame's emission strength just below (approximate as a function of height above the flame top and the body's burn), accumulated front-to-back like emission: `emission += T * inscatter * stepM`, `T *= exp(-soot * sootGain * stepM)`. Smoke rises past `rise`, widens with height (radius grows with `h`), and is curl-advected more strongly than flame. New tuning: `smokeAlbedo`, `smokeAmbient`, `smokeFireLit`, `smokeSpread`. Smoke must be visible against the lab's dark background as grey-brown billows, lit orange at their base.
- [ ] **Step 5: Measure the look, not just eyeball it.** In `flame-capture.mjs` add, per capture:
  - **Structure:** inside the flame's screen bounds, the ratio of high-frequency energy (e.g. mean abs Laplacian of luma) volume-vs-round-2-baseline — must rise clearly (tongues and gaps vs a smooth shell).
  - **Gaps:** fraction of pixels inside the flame bounds that are dark (luma below the flame median × 0.3) — licks have gaps; a shell has none.
  - **Smoke:** mean luma of a crop 0.5–1.5 m above the head vs the same crop with `sootGain 0` — must differ clearly (smoke is visible).
  - **Motion:** mean frame-to-frame change inside the flame bounds over 20 frames with the body STANDING still — must be well above round 2's (the fire moves by itself).
  Report all four for `stand` and `close`, round-2 settings vs new.
- [ ] **Step 6: The trail, properly.** Replace the wander-driven run fixture with a scripted straight dash: the body translates at a constant 3 m/s across the frame for 1.5 s, then stops; side camera fixed. Capture mid-dash and 0.5 s after the stop; report the flame's horizontal centroid offset from the body centroid in both (dash: trailing offset > 0.15 m opposite to motion; stop: < 0.05 m).
- [ ] **Step 7: Captures + sheet.** `stand`, `close`, `walk`, dash-mid, dash-stop, plus a sheet: round-2 volume | new volume | cards | wildfire references. Look at them. Commit with the notes (numbers, what still looks off).
- [ ] **Step 8: Tests.** `npm test -- fire-volume fire-capsules flame-cards flame-lab-main flame-panel post-aa post-tongues` + `npx tsc --noEmit`. Commit.

---

## Task 5 (round 3, on Task 4's branch): Volume in the game, smoke tail, card trim

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` — per-frame capsule packing for burning actors, `postAa.setFireVolume`, warm-up, cards per body
- Modify: `src/lab/sdf-zombie/burn-state.ts` (+ test) — smoke tail after extinguish
- Modify: `scripts/flare-ingame-capture.mjs` — volume frames + frame time
- Notes: `docs/dev-notes/2026-09-18-burning-feedback/B-volume-game.md`

- [ ] **Step 1: Smoke tail, failing test** in `burn-state.test.ts`: after `extinguishBurn`, a new field `smoke` starts at the burn level and decays to 0 over `smokeTailSec` (pass it through the rates/tuning `stepBurn` already takes); while burning `smoke === burn`. Implement in `burn-state.ts` keeping `stepBurn` mutate-and-return, NaN-safe. `npm test -- burn-state burn-registry`.
- [ ] **Step 2: Registry iteration.** `forEachActive` must also visit bodies whose `smoke > 0` (so extinguished bodies keep smoking) — add a test in `burn-registry.test.ts`, then implement.
- [ ] **Step 3: Game wiring.** In `game-main.ts`: preallocate the pack buffer and per-actor previous-capsule arrays (keyed by actor, released with the registry); each frame while anything burns or smokes: for each active actor, `fireCapsules(actor posed build)` (find where the harness reads a posed `BuildResult` for `limbAnchors` — reuse that), velocities, then `packFireVolume(bodies, camera pos, buffer)` with `burn` as the temperature source and the body's `smoke` written into the capsule's pad slot (stride stays 12; `pad = body.smoke ?? 0`, so Task 4's pack test still holds). The march uses `max(burn, pad)` as the soot source, so an extinguished body (burn 0, smoke > 0) emits soot but no heat — add a pack test and a WGSL string test for it. `postAa.setFireVolume(true, frame)`; `setFireVolume(false)` when nothing burns or smokes. Flame cards: `maxCardsPerBody = FIRE_VOLUME_TUNING.cardsPerBody`.
- [ ] **Step 4: Warm-up.** The fire pass pipelines must compile during the existing warm-up (see `warm-gate.ts` and how the shutter layer's `prewarm`/`precompile` is called at boot) — draw it once with a dummy capsule at boot. Verify: ignite the first body after warm gate `ready` and confirm no `createRenderPipeline` in that frame (the capture scripts already count pipeline creations — find the counter used in the earlier stall investigations and reuse it; if none, count via a wrapped `device.createRenderPipeline` in the capture script).
- [ ] **Step 5: Captures + frame time.** Extend `flare-ingame-capture.mjs`: frames of a standing burner, a running burner (trail visible), and an extinguished body smoking; frame time with 0 and 4 burners (median of 120 frames each). Look at them.
- [ ] **Step 6: Verify + commit.** `npm test -- burn-state burn-registry fire-capsules fire-volume flame-cards post-aa` + `npx tsc --noEmit`. Notes with frames, frame time, the pipeline-compile check. Commit.
