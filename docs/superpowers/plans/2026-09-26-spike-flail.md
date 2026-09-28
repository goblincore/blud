# Spike Flail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scrapped censer with a classic ball-and-spike flail: a click plays a preset swing (alternating right→left / left→right), and a zombie in front of the player takes one big crater.

**Spec:** `docs/superpowers/specs/2026-09-26-spike-flail-design.md` — read it first.

**Architecture:** Two pure modules hold the logic: `flail-swing.ts` (the swing state machine and its keyframe tables) and `flail-strike.ts` (the forgiving strike window, the view→world transform and the surface snap). A renderer-facing leaf, `game-flail.ts`, draws the haft, hand, chain and ball, all parented to the aim rig. On a strike it hands one `'blast'` wound per hit to `ZombieActor.blast()`. No physics and no shader changes.

**Tech Stack:** TypeScript, three.js WebGPU, Vitest, Blender 5.2 (headless Python) for the model, headless-Chrome gate scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import;
    plain data in, plain data out). The renderer-facing module only reads that logic's output and
    writes objects.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()`
    bindings (`npm test -- game-context-coverage`; its `artScene`/`spawnOverride` failure predates
    this branch — ignore exactly that one).
  - Keep the simulation deterministic (sim-time clocks, no wall-clock in logic).
- Work ONLY in this worktree (`/Users/donny/Projects/blud/.claude/worktrees/melee-weapon-design-7d1423`,
  branch `claude/melee-weapon-design-7d1423`, PR goblincore/blud#22). Never `git stash`. `node_modules`
  is symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts
  require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors. Start vite +
  Chrome with `scripts/lab-servers.sh` (source it from **bash**, not zsh; read its header). Kill
  anything you start.
- **Prove visual claims with a number** and look at the images yourself.
- WebGPU: never toggle a light's `.visible`. Never sample the render target you are writing.
- Start every new file with its path header comment (`// src/…/file.ts` then `//`).
- Stage only the files you changed (`git add <paths>`, never `-A`). Commit messages end with a
  `Co-Authored-By:` line naming your model.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/censer-*.ts` (+ tests), `game-censer.ts`, `game-seams-censer.ts` | delete | the scrapped censer |
| `scripts/censer-gate.mjs`, `censer-look.mjs`, `censer-windup-sweep.ts`, `model_censer.py`, `public/assets/lab/censer.glb` | delete | the scrapped censer |
| `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts` (+ test) | modify | slot `'censer'` → `'flail'` |
| `src/lab/sdf-zombie/webgpu/game-loop-leaves.ts`, `game-panels-leaves.ts`, `game-seams-weapon-aim.ts` | modify | the rename |
| `src/lab/sdf-zombie/webgpu/game-main.ts`, `game-state-weapon.ts`, `game-weapon-leaves.ts` | modify | unwire the censer (Task 1), wire the flail (Task 5) |
| `src/lab/sdf-zombie/webgpu/gib-motion-blur.ts`, `gib-shutter-layer.ts`, `game-actor.ts` (+ tests) | modify | comments/constants that name the censer |
| `src/lab/sdf-zombie/webgpu/flail-swing.ts` (+ test) | create | swing state machine + keyframes (pure) |
| `src/lab/sdf-zombie/webgpu/flail-strike.ts` (+ test) | create | strike window, view→world, surface snap (pure) |
| `scripts/model_flail.py`, `public/assets/lab/flail.glb` | create | the model |
| `src/lab/sdf-zombie/webgpu/game-flail.ts` | create | the renderer-facing leaf |
| `src/lab/sdf-zombie/webgpu/game-seams-flail.ts` | create | `__sdfGame.flail.*` seams |
| `scripts/flail-gate.mjs` | create | in-game gate + photos |
| `docs/dev-notes/2026-09-26-flail/NOTES.md` | create | gate output, tuning log, photos |

---

### Task 1: Strip the censer and rename the slot to `'flail'`

**Files:** everything in the "delete" rows above; modify `game-weapon-slots.ts` (+ test),
`game-loop-leaves.ts`, `game-panels-leaves.ts`, `game-seams-weapon-aim.ts`, `game-state-weapon.ts`,
`game-weapon-leaves.ts`, `game-main.ts`, `gib-motion-blur.ts`, `gib-shutter-layer.ts`, `game-actor.ts`,
`game-actor.test.ts`, `game-actor-cultist.test.ts` (all under `src/lab/sdf-zombie/webgpu/`).

The kept pieces must survive intact: `ActorBlastEffect.reaction` and the soft-target rule in
`game-actor.ts`, the gib shutter layer's render-object pass id, the `select()` lifted-mesh rule and
the per-piece cap (`gib-shutter-layer.ts`).

- [ ] **Step 1: Delete the censer files**

```bash
git rm src/lab/sdf-zombie/webgpu/censer-swing.ts src/lab/sdf-zombie/webgpu/censer-swing.test.ts \
  src/lab/sdf-zombie/webgpu/censer-head.ts src/lab/sdf-zombie/webgpu/censer-head.test.ts \
  src/lab/sdf-zombie/webgpu/censer-hit.ts src/lab/sdf-zombie/webgpu/censer-hit.test.ts \
  src/lab/sdf-zombie/webgpu/censer-blur.ts src/lab/sdf-zombie/webgpu/censer-blur.test.ts \
  src/lab/sdf-zombie/webgpu/game-censer.ts src/lab/sdf-zombie/webgpu/game-seams-censer.ts \
  scripts/censer-gate.mjs scripts/censer-look.mjs scripts/censer-windup-sweep.ts scripts/model_censer.py \
  public/assets/lab/censer.glb
```

- [ ] **Step 2: Rename the slot in the slot tests first**

In `game-weapon-slots.test.ts` replace `'censer'` with `'flail'` in the key/order expectations
(`slotForKey('Digit1')` → `'flail'`, `WEAPON_SLOTS` → `['flail', 'shotgun', 'dynamite', 'flare']`).
Run `npm test -- game-weapon-slots` — expected FAIL (`expected 'censer' to be 'flail'`).

- [ ] **Step 3: Rename the slot**

In `game-weapon-slots.ts`:

```ts
/** Which weapon the player is holding. `flail` is the melee spike flail
 *  (game-flail.ts, 2026-09-26). `shotgun` is the grapeshot double.
 *  `flare` is the 2026-09-18 in-game burning-test harness: no projectile, no
 *  damage — its only verb is igniting the actor it hits. */
export type WeaponSlot = 'flail' | 'shotgun' | 'dynamite' | 'flare';

/** Slot order, which is ALSO the number-key order (1 → flail, 2 → shotgun,
 *  3 → dynamite, 4 → flare). Melee on 1, as in Blood. */
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['flail', 'shotgun', 'dynamite', 'flare'];
```

and `Digit1: 'flail'` in `SLOT_BY_KEY`. Then everywhere else:

- `game-loop-leaves.ts`: `ownsSlot` → `const item = slot === 'flail' ? 'melee' : slot;` (update its
  doc comment: "The flail is owned as the 'melee' inventory item"); the pickup branch →
  `requestSlot(ctx.weapon.slotState, 'flail')` with the comment "Empty-handed: the flail comes
  straight up."
- `game-panels-leaves.ts`: the HUD branch → `S.live === 'flail' ? '1 FLAIL'` (drop the
  `ctx.weapon.censer?.phase()` call; Task 5 adds the flail's phase).
- `game-seams-weapon-aim.ts`: the comment's union → `'flail' | 'shotgun' | 'dynamite' | 'flare'`.

- [ ] **Step 4: Unwire the censer from the game**

- `game-state-weapon.ts`: remove `import type { CenserWeapon } from './game-censer';`, the `censer`
  field and its `censer: null` initialiser. (Task 5 adds a `flail` field.)
- `game-weapon-leaves.ts` `stepWeaponSlots`: remove the two censer lines
  (`// Slot 1: the censer's holster travel…` and `ctx.weapon.censer?.updateRig();`).
- `game-main.ts` — remove, finding each by grep for `censer`/`Censer`/`CENSER`:
  1. the `createCenser` and `createCenserSeams` imports;
  2. `if (ctx.weapon.censer?.onMouseDown(e.button)) return;` in the canvas mousedown listener (and
     its comment);
  3. the censer `window.addEventListener('mouseup', …)` line and its comment;
  4. the `ctx.weapon.censer = createCenser(ctx, { … });` block and its comment;
  5. `ctx.weapon.censer?.refreshLights();` and its comment (after `refreshLevelLights(ctx)`);
  6. at the top of `tick`: the hit-stop comment block, `const censerBlurDt = dt;` and
     `dt *= ctx.weapon.censer?.hitStopScale(dt) ?? 1;` (Task 5 re-adds a simpler hit-stop);
  7. `ctx.weapon.censer?.tick(dt);` after `stepWeaponSlots` (and its comment);
  8. `ctx.weapon.censer?.sync();` after `camera.updateMatrixWorld()` (and its comment);
  9. in the GIB SHUTTER PARTITION block: delete the `THE CENSER rides the same layer…` comment
     paragraph and `const censerBlur = …`, and restore the select call to
     `ctx.gibs.shutter.select(ctx.gibs.shutter.enabled ? gibBlurSubjects(ctx) : []);`;
  10. `createCenserSeams(ctx),` in the `mergeSeams(` list;
  11. the start slot: `makeWeaponSlotState(!ownsSlot(ctx, 'shotgun') && ownsSlot(ctx, 'flail') ? 'flail' : 'shotgun')`
      and its comment ("…starts with the flail in hand…").
- `gib-motion-blur.ts`: delete `CENSER_FILL_LAYER` and its doc comment (nothing else uses it —
  confirm with grep).
- `gib-shutter-layer.ts`: keep all code; reword the three comments that name the censer to say
  "a melee weapon" / "several meshes sharing one state" (e.g. line ~91 "(the censer's head, haft +
  hand)" → "(a weapon's parts)"; ~372 "(the censer chain's rod samples on one InstancedMesh)" → "(e.g.
  several samples of one InstancedMesh)"; ~65 keep the measurement but say "a melee swing").
- `game-actor.ts`: reword the three comments (`ActorBlastEffect.reaction` doc, the soft-target gate,
  step 3) from "the censer" to "melee" — the behaviour is unchanged.
- `game-actor.test.ts`: rename `describe('blast() reaction option (the censer)'` →
  `describe('blast() reaction option (melee)'`. `game-actor-cultist.test.ts`: rename the test to
  `"a melee 'flinch' does not insta-kill a soft target, but a 'blast' does"`.

- [ ] **Step 5: Verify nothing names the censer outside docs**

Run: `grep -rn "censer\|Censer\|CENSER" src scripts --include='*.ts' --include='*.mjs' --include='*.py'`
Expected: no output.

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npm test -- game-weapon-slots game-actor gib-shutter gib-motion-blur pickups`
Expected: tsc clean; all pass.

- [ ] **Step 7: Commit**

```bash
git add -u src scripts public/assets/lab
git commit -m "refactor(melee): strip the scrapped censer; slot 'censer' → 'flail' (kept: melee slot/pickup, blast reaction, gib-blur fixes)"
```

---

### Task 2: The swing state machine and keyframes (`flail-swing.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/flail-swing.ts`
- Test: `src/lab/sdf-zombie/webgpu/flail-swing.test.ts`

All positions are **view space, metres** (x right, y up, −z forward, origin at the eye, the frame the
aim rig lives in). `grip` is where the fist holds the haft; `rot` is the haft's Euler rotation
(radians, XYZ); `ball` is the ball's centre. Keyframes are joined with Catmull-Rom (passes through
every key), so the ball never stops dead at the strike.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/flail-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  FLAIL_IMPACT, FLAIL_REST, FLAIL_SWING, cancelFlailSwing, flailPose, makeFlailSwing, stepFlailSwing,
  type FlailSide, type FlailSwing,
} from './flail-swing';

const DT = 1 / 240;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Run `sec` of sim with the button held/released; a click is a one-step edge at the start. */
function run(s: FlailSwing, sec: number, held: boolean, click = false, dt = DT) {
  const strikes: FlailSide[] = [];
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) {
    const r = stepFlailSwing(s, { click: click && i === 0, held }, dt);
    s = r.state;
    strikes.push(...r.strikes);
  }
  return { s, strikes };
}

describe('stepFlailSwing', () => {
  it('a click starts a right-to-left swing that strikes once, then returns to idle', () => {
    const r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.05, false, true);
    expect(r.strikes).toEqual(['R']);
    expect(r.s.phase).toBe('idle');
  });

  it('the strike fires at strikeT', () => {
    let s = makeFlailSwing();
    let t = 0, at = -1;
    for (let i = 0; i < 240 && at < 0; i++) {
      const r = stepFlailSwing(s, { click: i === 0, held: false }, DT);
      s = r.state; t += DT;
      if (r.strikes.length) at = t;
    }
    expect(at).toBeGreaterThanOrEqual(FLAIL_SWING.strikeT);
    expect(at).toBeLessThan(FLAIL_SWING.strikeT + 2 * DT);
  });

  it('strikes exactly once per swing whatever the step size', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 30, 0.2]) {
      const r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.3, false, true, dt);
      expect(r.strikes, `dt ${dt}`).toEqual(['R']);
    }
  });

  it('sides alternate click to click', () => {
    let r = run(makeFlailSwing(), FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
    r = run(r.s, FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['L']);
    r = run(r.s, FLAIL_SWING.swingSec + 0.1, false, true);
    expect(r.strikes).toEqual(['R']);
  });

  it('a click in the last bufferSec queues the next swing', () => {
    let r = run(makeFlailSwing(), FLAIL_SWING.swingSec - FLAIL_SWING.bufferSec + 0.05, false, true);
    expect(r.s.phase).toBe('swing');
    r = run(r.s, 0.6, false, true);   // click inside the buffer (t≈0.35), then release
    expect(r.strikes).toEqual(['L']);   // the queued L swing ran and struck
    expect(r.s.swingId).toBe(2);
  });

  it('a click early in a swing is ignored', () => {
    let r = run(makeFlailSwing(), 0.05, false, true);
    r = run(r.s, FLAIL_SWING.swingSec + 0.2, false, true);   // click at t≈0.05: outside the buffer
    expect(r.s.swingId).toBe(1);
    expect(r.s.phase).toBe('idle');
  });

  it('holding the button chains swings', () => {
    const r = run(makeFlailSwing(), 3 * FLAIL_SWING.swingSec + 0.01, true, true);
    expect(r.strikes).toEqual(['R', 'L', 'R']);
  });

  it('cancel returns to idle with no strike after it', () => {
    let r = run(makeFlailSwing(), 0.05, false, true);
    const c = cancelFlailSwing(r.s);
    expect(c.phase).toBe('idle');
    r = run(c, 1, false);
    expect(r.strikes).toEqual([]);
  });

  it('dt <= 0 leaves the state unchanged', () => {
    const s = run(makeFlailSwing(), 0.05, false, true).s;
    expect(stepFlailSwing(s, { click: false, held: false }, 0).state).toBe(s);
    expect(stepFlailSwing(s, { click: false, held: false }, -1).state).toBe(s);
  });
});

describe('flailPose', () => {
  it('rests at FLAIL_REST when idle, and a swing starts and ends there', () => {
    const idle = flailPose(makeFlailSwing());
    expect(idle).toEqual(FLAIL_REST);
    const s0 = stepFlailSwing(makeFlailSwing(), { click: true, held: false }, 1e-9).state;
    expect(dist(flailPose(s0).ball, FLAIL_REST.ball)).toBeLessThan(1e-4);
    const end = run(makeFlailSwing(), FLAIL_SWING.swingSec - 1e-6, false, true).s;
    expect(dist(flailPose(end).ball, FLAIL_REST.ball)).toBeLessThan(0.01);
  });

  it('passes through the authored impact point at strikeT', () => {
    for (const side of ['R', 'L'] as const) {
      const s: FlailSwing = { ...makeFlailSwing(), phase: 'swing', side, t: FLAIL_SWING.strikeT };
      expect(dist(flailPose(s).ball, FLAIL_IMPACT[side])).toBeLessThan(1e-9);
    }
  });

  it('the strike is in front of the eye, and R and L mirror across the centre line', () => {
    expect(FLAIL_IMPACT.R[2]).toBeLessThan(-0.8);
    expect(FLAIL_IMPACT.L[2]).toBeLessThan(-0.8);
    expect(Math.abs(FLAIL_IMPACT.R[0] + FLAIL_IMPACT.L[0])).toBeLessThan(0.2);
  });

  it('has no pops: ball ≤ 15 cm and grip ≤ 6 cm per 240 Hz step, through chained swings', () => {
    // The ball legitimately moves ~20 m/s into the strike (~8 cm per step); a pop is a jump far beyond that.
    let s = makeFlailSwing();
    let prev = flailPose(s);
    let worstBall = 0, worstGrip = 0;
    for (let i = 0; i < Math.round((3 * FLAIL_SWING.swingSec + 0.2) / DT); i++) {
      s = stepFlailSwing(s, { click: i === 0, held: i * DT < 2 * FLAIL_SWING.swingSec }, DT).state;
      const p = flailPose(s);
      worstBall = Math.max(worstBall, dist(p.ball, prev.ball));
      worstGrip = Math.max(worstGrip, dist(p.grip, prev.grip));
      prev = p;
    }
    expect(worstBall).toBeLessThan(0.15);
    expect(worstGrip).toBeLessThan(0.06);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- flail-swing`
Expected: FAIL — `Failed to resolve import "./flail-swing"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/flail-swing.ts
//
// THE SPIKE FLAIL'S SWING (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5–6).
// Pure: a click edge, the button state and dt in; the phase, the pose and the
// strike events out. No Three.js, no physics — two authored swings:
//
//   R: right → left (the forehand)      L: left → right (the backhand)
//
// A click from idle starts the next side. A click in the last bufferSec of a
// swing queues the next one; holding the button chains them. The STRIKE fires
// exactly once per swing, when t crosses strikeT — whatever the step size.
//
// Poses are VIEW SPACE metres (x right, y up, −z forward, eye at the origin):
// `grip` is the fist on the haft, `rot` the haft's XYZ Euler (radians), `ball`
// the ball's centre. Keys are joined by Catmull-Rom so the ball passes through
// the impact key at full speed instead of stopping on it.

import type { Vec3 } from '../types';

export const FLAIL_SWING = {
  swingSec: 0.45,
  /** The strike frame: the ball is at its impact key. */
  strikeT: 0.18,
  /** A click this close to the end of a swing queues the next one. */
  bufferSec: 0.15,
} as const;

export type FlailSide = 'R' | 'L';

export interface FlailPose { grip: Vec3; rot: Vec3; ball: Vec3 }

interface Key extends FlailPose { t: number }

/** Idle: the fist low right, the haft tipped forward, the ball hanging below its tip. */
export const FLAIL_REST: FlailPose = {
  grip: [0.22, -0.3, -0.4],
  rot: [-1.1, 0, 0],
  ball: [0.24, -0.5, -0.55],
};

/** R: wind back up and right, strike across the front, follow through low left. */
const KEYS_R: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.12, grip: [0.32, -0.02, -0.3], rot: [0.3, 0, -0.6], ball: [0.55, 0.25, -0.3] },
  { t: 0.18, grip: [0.05, -0.2, -0.55], rot: [-1.2, 0.6, 0.3], ball: [-0.05, -0.35, -1.15] },
  { t: 0.3, grip: [-0.2, -0.35, -0.45], rot: [-1.4, 1.0, 0.6], ball: [-0.6, -0.6, -0.7] },
  { t: 0.45, ...FLAIL_REST },
];

/** L: wind back across the chest to the left, strike across the front, follow through low right. */
const KEYS_L: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.12, grip: [-0.05, -0.05, -0.3], rot: [0.3, 0, 0.6], ball: [-0.35, 0.2, -0.35] },
  { t: 0.18, grip: [0.12, -0.2, -0.55], rot: [-1.2, -0.6, -0.3], ball: [0.1, -0.35, -1.15] },
  { t: 0.3, grip: [0.35, -0.35, -0.45], rot: [-1.4, -1.0, -0.6], ball: [0.65, -0.55, -0.7] },
  { t: 0.45, ...FLAIL_REST },
];

const KEYS: Readonly<Record<FlailSide, readonly Key[]>> = { R: KEYS_R, L: KEYS_L };

/** The ball at the strike frame, per side (view space). */
export const FLAIL_IMPACT: Readonly<Record<FlailSide, Vec3>> = {
  R: KEYS_R.find(k => k.t === FLAIL_SWING.strikeT)!.ball,
  L: KEYS_L.find(k => k.t === FLAIL_SWING.strikeT)!.ball,
};

export interface FlailSwing {
  phase: 'idle' | 'swing';
  side: FlailSide;
  /** Seconds into the current swing. */
  t: number;
  /** The strike already fired this swing. */
  struck: boolean;
  /** A click landed in the buffer window. */
  queued: boolean;
  /** The side the next swing takes. */
  nextSide: FlailSide;
  /** Increments at every swing start. */
  swingId: number;
}

export interface FlailInput {
  /** A click edge this step (mousedown). */
  click: boolean;
  /** The button is down. */
  held: boolean;
}

export function makeFlailSwing(): FlailSwing {
  return { phase: 'idle', side: 'R', t: 0, struck: false, queued: false, nextSide: 'R', swingId: 0 };
}

const other = (s: FlailSide): FlailSide => (s === 'R' ? 'L' : 'R');

function start(s: FlailSwing, t: number): FlailSwing {
  return {
    phase: 'swing', side: s.nextSide, t, struck: false, queued: false,
    nextSide: other(s.nextSide), swingId: s.swingId + 1,
  };
}

/** Fire the strike if this swing's t has crossed strikeT and it has not yet. */
function strikeIfDue(s: FlailSwing, strikes: FlailSide[]): FlailSwing {
  if (s.phase !== 'swing' || s.struck || s.t < FLAIL_SWING.strikeT) return s;
  strikes.push(s.side);
  return { ...s, struck: true };
}

export function stepFlailSwing(
  s: FlailSwing, input: FlailInput, dt: number,
): { state: FlailSwing; strikes: FlailSide[] } {
  const strikes: FlailSide[] = [];
  if (!(dt > 0)) return { state: s, strikes };
  const S = FLAIL_SWING;
  if (s.phase === 'idle') {
    if (!input.click) return { state: s, strikes };
    return { state: strikeIfDue(start(s, dt), strikes), strikes };
  }
  const queued = s.queued || (input.click && S.swingSec - s.t <= S.bufferSec);
  let next: FlailSwing = strikeIfDue({ ...s, t: s.t + dt, queued }, strikes);
  if (next.t >= S.swingSec) {
    const leftover = next.t - S.swingSec;
    next = next.queued || input.held
      ? strikeIfDue(start(next, leftover), strikes)
      : { ...next, phase: 'idle', t: 0, queued: false, struck: false };
  }
  return { state: next, strikes };
}

/** Weapon switch or death: back to idle; no strike fires after this. */
export function cancelFlailSwing(s: FlailSwing): FlailSwing {
  return { ...s, phase: 'idle', t: 0, struck: false, queued: false };
}

const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);

function sample(keys: readonly Key[], t: number, pick: (k: Key) => Vec3): Vec3 {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1]!.t) i++;
  const k1 = keys[i]!, k2 = keys[i + 1]!;
  const k0 = keys[Math.max(0, i - 1)]!, k3 = keys[Math.min(n - 1, i + 2)]!;
  const u = Math.min(1, Math.max(0, (t - k1.t) / (k2.t - k1.t)));
  const a = pick(k0), b = pick(k1), c = pick(k2), d = pick(k3);
  return [cr(a[0], b[0], c[0], d[0], u), cr(a[1], b[1], c[1], d[1], u), cr(a[2], b[2], c[2], d[2], u)];
}

export function flailPose(s: FlailSwing): FlailPose {
  if (s.phase === 'idle') return FLAIL_REST;
  const keys = KEYS[s.side];
  return {
    grip: sample(keys, s.t, k => k.grip),
    rot: sample(keys, s.t, k => k.rot),
    ball: sample(keys, s.t, k => k.ball),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- flail-swing`
Expected: PASS (15 tests). If the pop test fails, print the worst deltas and the step where they
occur. A Catmull-Rom overshoot at a key is the likely cause; fix it by adjusting the keys, not by
loosening the bounds. Report what you changed.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/flail-swing.ts src/lab/sdf-zombie/webgpu/flail-swing.test.ts
git commit -m "feat(flail): swing state machine — alternating preset swings, buffered clicks, one strike per swing"
```

---

### Task 3: The strike window (`flail-strike.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/flail-strike.ts`
- Test: `src/lab/sdf-zombie/webgpu/flail-strike.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/flail-strike.test.ts
import { describe, expect, it } from 'vitest';
import { FLAIL_STRIKE, inStrikeArc, resolveStrike, snapToSurface, viewToWorld, type StrikeActor } from './flail-strike';
import type { Vec3 } from '../types';

const EYE: Vec3 = [0, 1.62, 0];
const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const ball = (id: number, c: Vec3, r = 0.3): StrikeActor => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
/** A vertical capsule from a to b, radius r. */
const capsule = (id: number, a: Vec3, b: Vec3, r: number): StrikeActor => ({
  id, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  field: (p) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / (ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2)));
    return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t) - r;
  },
});

describe('viewToWorld', () => {
  it('maps view −z to the facing, x to the right, y to up (yaw 0, pitch 0)', () => {
    const f0 = viewToWorld(EYE, 0, 0, [0, 0, -1]);
    expect(f0[0]).toBeCloseTo(0, 9); expect(f0[1]).toBeCloseTo(1.62, 9); expect(f0[2]).toBeCloseTo(-1, 9);
    const r = viewToWorld(EYE, 0, 0, [1, 0, 0]);
    expect(r[0]).toBeCloseTo(1, 9); expect(r[2]).toBeCloseTo(0, 9);
    expect(viewToWorld(EYE, 0, 0, [0, 1, 0])[1]).toBeCloseTo(2.62, 9);
  });
  it('turns with yaw (yaw π/2 faces +x) and pitches with pitch', () => {
    const f = viewToWorld(EYE, Math.PI / 2, 0, [0, 0, -1]);
    expect(f[0]).toBeCloseTo(1, 9); expect(f[2]).toBeCloseTo(0, 9);
    const up = viewToWorld(EYE, 0, Math.PI / 2, [0, 0, -1]);
    expect(up[1]).toBeCloseTo(2.62, 9);
  });
});

describe('inStrikeArc', () => {
  it('takes a zombie in front within reach, and one hugging the player', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -1.5])).toBe(true);
    expect(inStrikeArc(EYE, 0, [0, 1.1, -0.03])).toBe(true);
  });
  it('refuses one too far or too wide', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -2.2])).toBe(false);
    const a = (70 * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(a) * 1.2, 1.1, -Math.cos(a) * 1.2])).toBe(false);
    const b = ((FLAIL_STRIKE.arcDeg - 5) * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(b) * 1.2, 1.1, -Math.cos(b) * 1.2])).toBe(true);
  });
});

describe('snapToSurface', () => {
  it('lands on the skin of a sphere and of a capsule (within 5 mm)', () => {
    const s = ball(1, [0, 1.1, -1.5]);
    const p = snapToSurface(s.field, [0.1, 1.3, -1.0]);
    expect(Math.abs(s.field(p))).toBeLessThan(0.005);
    const c = capsule(2, [0, 0.4, -1.5], [0, 1.4, -1.5], 0.18);
    const q = snapToSurface(c.field, [0.3, 1.0, -1.2]);
    expect(Math.abs(c.field(q))).toBeLessThan(0.005);
  });
});

describe('resolveStrike', () => {
  it('hits every actor in the arc, at a surface point, with a unit direction from the eye', () => {
    const impact: Vec3 = [0, 1.2, -1.2];
    const hits = resolveStrike(EYE, 0, impact, [
      ball(1, [0, 1.1, -1.5]), ball(2, [0.6, 1.1, -1.4]), ball(3, [0, 1.1, -3]),
    ]);
    expect(hits.map(h => h.actorId)).toEqual([1, 2]);
    for (const h of hits) expect(len(h.dir)).toBeCloseTo(1, 9);
    expect(Math.abs(Math.hypot(hits[0]!.point[0], hits[0]!.point[1] - 1.1, hits[0]!.point[2] + 1.5) - 0.3)).toBeLessThan(0.005);
  });
  it('hits nothing when nothing is in the arc (a whoosh)', () => {
    expect(resolveStrike(EYE, 0, [0, 1.2, -1.2], [ball(1, [0, 1.1, 1.5])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- flail-strike`
Expected: FAIL — `Failed to resolve import "./flail-strike"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/flail-strike.ts
//
// THE SPIKE FLAIL'S STRIKE WINDOW (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5).
// Pure. At the strike frame, every actor whose torso centre is within `reach`
// (horizontal, from the eye) and within `arcDeg` of the facing is hit — no
// precise ball sweep, so a zombie standing in front of the player is never
// missed. The crater lands where the ball's AUTHORED impact point (view space,
// flail-swing FLAIL_IMPACT) meets that actor's skin: the point is taken to
// world space from the eye, yaw and pitch, then walked down the body's
// distance-field gradient onto the surface.

import type { Vec3 } from '../types';

export const FLAIL_STRIKE = {
  /** Horizontal eye → torso-centre distance, metres. */
  reach: 1.8,
  /** Half-angle of the arc about the facing, degrees. */
  arcDeg: 50,
  /** Closer than this, an actor is in the arc whatever its bearing (hugging). */
  hugDist: 0.25,
  snapIters: 6,
  gradEps: 0.004,
} as const;

export interface StrikeActor {
  id: number;
  /** Torso centre, world. */
  centre: Vec3;
  /** The posed body's signed distance (sdBody). */
  field: (p: Vec3) => number;
}

export interface StrikeHit {
  actorId: number;
  /** On the skin, world. */
  point: Vec3;
  /** Unit vector from the eye to `point`. */
  dir: Vec3;
}

/** A view-space point (x right, y up, −z forward) to world, from the eye's yaw and pitch
 *  (the game's convention: forward = (sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)). */
export function viewToWorld(eye: Vec3, yaw: number, pitch: number, v: Vec3): Vec3 {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const f: Vec3 = [sy * cp, sp, -cy * cp];
  const r: Vec3 = [cy, 0, sy];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return [
    eye[0] + r[0] * v[0] + u[0] * v[1] - f[0] * v[2],
    eye[1] + r[1] * v[0] + u[1] * v[1] - f[1] * v[2],
    eye[2] + r[2] * v[0] + u[2] * v[1] - f[2] * v[2],
  ];
}

export function inStrikeArc(eye: Vec3, yaw: number, centre: Vec3): boolean {
  const dx = centre[0] - eye[0], dz = centre[2] - eye[2];
  const d = Math.hypot(dx, dz);
  if (d > FLAIL_STRIKE.reach) return false;
  if (d < FLAIL_STRIKE.hugDist) return true;
  const cosA = (dx * Math.sin(yaw) - dz * Math.cos(yaw)) / d;
  return cosA >= Math.cos((FLAIL_STRIKE.arcDeg * Math.PI) / 180);
}

/** Walk `p` down the field's gradient onto its zero surface (p ← p − n·f). */
export function snapToSurface(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = FLAIL_STRIKE.gradEps;
  let q: Vec3 = [p[0], p[1], p[2]];
  for (let i = 0; i < FLAIL_STRIKE.snapIters; i++) {
    const f = field(q);
    const g: Vec3 = [
      field([q[0] + e, q[1], q[2]]) - field([q[0] - e, q[1], q[2]]),
      field([q[0], q[1] + e, q[2]]) - field([q[0], q[1] - e, q[2]]),
      field([q[0], q[1], q[2] + e]) - field([q[0], q[1], q[2] - e]),
    ];
    const l = Math.hypot(g[0], g[1], g[2]);
    if (l < 1e-12) break;
    q = [q[0] - (g[0] / l) * f, q[1] - (g[1] / l) * f, q[2] - (g[2] / l) * f];
    if (Math.abs(f) < 1e-4) break;
  }
  return q;
}

export function resolveStrike(eye: Vec3, yaw: number, impactWorld: Vec3, actors: readonly StrikeActor[]): StrikeHit[] {
  const hits: StrikeHit[] = [];
  for (const a of actors) {
    if (!inStrikeArc(eye, yaw, a.centre)) continue;
    const point = snapToSurface(a.field, impactWorld);
    const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    hits.push({ actorId: a.id, point, dir: [d[0] / l, d[1] / l, d[2] / l] });
  }
  return hits;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- flail-strike`
Expected: PASS (8 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/flail-strike.ts src/lab/sdf-zombie/webgpu/flail-strike.test.ts
git commit -m "feat(flail): forgiving strike window — reach/arc filter, view→world, surface snap"
```

---

### Task 4: The model (`scripts/model_flail.py` → `public/assets/lab/flail.glb`)

**Files:**
- Create: `scripts/model_flail.py`, `public/assets/lab/flail.glb`, `docs/dev-notes/2026-09-26-flail/flail-model.png`

Node contract (Task 5 reads these; a missing node → primitives):

| Node | Contents | Origin / axis |
| --- | --- | --- |
| `Haft` | wooden haft (~0.42 m) with 3 iron bands, a pommel, and an iron cap with an eye bolt at the top | the grip, at the bottom third; up = +Y (glTF) |
| `ChainAnchor` | empty, child of `Haft` | the eye bolt at the haft's top |
| `Ball` | iron ball (radius 0.06) with 12 spikes (~0.035 long) and a top ring | ball centre; ring toward +Y |
| `ChainLink` | one oval iron link, long axis +Y, ~1.8 cm long | link centre |

Materials: `Wood` (dark stained, rough), `Iron` (dark, metal ~0.8, rough ~0.5), `IronWorn` (lighter
edge wear for the spikes' tips). Budget: ≤ 6000 triangles total.

- [ ] **Step 1: Write the script** by following the structure of the censer's model script (in git:
  `git show HEAD~1:scripts/model_censer.py` if Task 1 has landed, else the working copy). Reuse its
  `mat()`, `assign()`, `join()` helpers, its EEVEE three-point preview rig (dark 0.03 world), its
  export and its re-import node-contract verification. The pieces:
  - **Haft:** a lathe-turned profile (bmesh spin, 16 segments) of radius ~0.016 swelling to 0.019
    at the grip; 3 iron band rings (tori, minor radius 0.003) at 0.08, 0.2 and 0.34; an iron pommel
    knob at the bottom (−0.12); an iron cap cylinder at the top (0.40–0.43) with an eye-bolt torus
    rotated vertical at 0.445. The grip origin sits at z = 0 with ~0.12 of haft below it.
  - **Ball:** a UV sphere, radius 0.06, 24×16. 12 spikes are cones (radius 0.011 → 0, depth 0.035),
    placed on the 12 icosahedron vertex directions, skipping the one nearest +Z (that's where the
    ring goes), plus the ring torus (0.012 / 0.003) at +Z 0.07. Spike tips use `IronWorn`.
  - **ChainLink:** a torus (0.009 / 0.0022), rotated so its plane contains Z, scaled 1.6× along Z,
    with transforms applied.
  - Shade smooth with auto-smooth by angle (~40°), so the spikes stay crisp.

  Run with `blender -b --factory-startup -P scripts/model_flail.py`. It must print
  `[flail] PASS` after checking the nodes and the triangle budget.

- [ ] **Step 2: Look at the preview** (`docs/dev-notes/2026-09-26-flail/flail-model.png`). It should read
  as a classic morning-star flail: a banded wooden haft, and a spiked iron ball on a ring.
  Iterate until it does. Report the triangle count.

- [ ] **Step 3: Commit**

```bash
git add scripts/model_flail.py public/assets/lab/flail.glb docs/dev-notes/2026-09-26-flail/flail-model.png
git commit -m "feat(flail): Blender model script + flail.glb (Haft, ChainAnchor, Ball, ChainLink)"
```

---

### Task 5: The game leaf (`game-flail.ts`), seams and wiring

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-flail.ts`, `src/lab/sdf-zombie/webgpu/game-seams-flail.ts`
- Modify: `game-state-weapon.ts`, `game-weapon-leaves.ts`, `game-panels-leaves.ts`, `game-main.ts`

Everything the flail draws is a child of the aim rig: the haft and hand, and the ball and chain
(keyframed in view space). So there's no world-space part and no after-camera sync pass. The strike's
impact point goes to world space through `viewToWorld` from the player's eye, yaw and pitch.

- [ ] **Step 1: Weapon slice field.** In `game-state-weapon.ts`, add
  `import type { FlailWeapon } from './game-flail';` next to the `FlareHarness` import, add the field
  `/** Slot 1 (the spike flail, game-flail.ts); null until the aim rig exists. */ flail: FlailWeapon | null;`
  below `flare`, and set `flail: null,` in `makeWeaponState()`.

- [ ] **Step 2: Write `game-flail.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-flail.ts
//
// WEAPON SLOT 1: THE SPIKE FLAIL (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md).
// The renderer-facing half ONLY: flail-swing.ts owns the swing and its poses,
// flail-strike.ts decides who a strike hits and where. Everything here is a
// child of the aim rig (haft, hand, chain, ball), posed from the swing's
// view-space keyframes; a strike becomes one 'blast' crater per hit through
// ZombieActor.blast(). Not a recorded DemoFrame verb (like the flare).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { ZombieActor } from './game-actor';
import { clothifyWound, worldHitToWound, type Wound } from '../damage';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput, ownsSlot } from './game-loop-leaves';
import { BEND_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import {
  FLAIL_IMPACT, cancelFlailSwing, flailPose, makeFlailSwing, stepFlailSwing, type FlailSide, type FlailSwing,
} from './flail-swing';
import { resolveStrike, viewToWorld, type StrikeActor } from './flail-strike';

const FLAIL_GLB = '/assets/lab/flail.glb';

/** Feel numbers (spec §6). */
export const FLAIL_FEEL = {
  craterR: 0.14,
  severMul: 1.3,
  meterCredit: 0.35,
  /** Reaction direction magnitude handed to blast() (it unit-normalises). */
  shove: 6,
  hitStopSec: 0.05,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  kickRad: 0.02,
} as const;

/** The look: chain sag, rest sway, the hand. */
export const FLAIL_LOOK = {
  chainLen: 0.3,
  linkPitch: 0.013,
  swayAmp: 0.012,
  swayHz: 0.9,
  handScale: 0.8,
  /** The arm's IK shoulder, view metres (the gun arms' SHOULDER_R_VIEW is 0.26, −0.30, 0.06). */
  handShoulder: new THREE.Vector3(0.35, -0.47, 0.08),
  /** Primitive haft tip (the GLB's ChainAnchor replaces it), haft-local. */
  primAnchorY: 0.3,
} as const;

export interface FlailDeps {
  eye(): Vec3;
  /** Blood for a crater (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
}

export interface FlailDebug {
  phase: string;
  side: FlailSide;
  swingId: number;
  strikes: number;
  lastStrike: { side: FlailSide; hits: number[] } | null;
}

export interface FlailWeapon {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once per tick, after the aim rig and holster are placed. */
  tick(dt: number): void;
  updateRig(): void;
  hitStopScale(dt: number): number;
  phase(): string;
  /** Seams. */
  click(): void;
  hold(on: boolean): void;
  setHitStop(on: boolean): void;
  debug(): FlailDebug;
}

const MAX_LINKS = 40;

export function createFlail(ctx: GameContext, deps: FlailDeps): FlailWeapon {
  const rig = new THREE.Group();
  rig.name = 'flail-rig';
  ctx.weapon.aimRig!.add(rig);
  const haft = new THREE.Group();
  haft.name = 'flail-haft';
  rig.add(haft);
  const ball = new THREE.Group();
  ball.name = 'flail-ball';
  rig.add(ball);
  const anchorLocal = new THREE.Vector3(0, FLAIL_LOOK.primAnchorY, 0);

  const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0.85, roughness: 0.5, envMap: env, envMapIntensity: 0.8 });

  // PRIMITIVES FIRST, GLB OVER THEM (the flare's rule).
  const haftPrim = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.42, 12), wood);
  haftPrim.position.y = 0.09;
  haft.add(haftPrim);
  const ballPrim = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), iron);
  ball.add(ballPrim);

  const linkGeo = new THREE.TorusGeometry(0.007, 0.002, 5, 8);
  const chain = new THREE.InstancedMesh(linkGeo, iron, MAX_LINKS);
  chain.name = 'flail-chain';
  chain.frustumCulled = false;
  chain.count = 0;
  rig.add(chain);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(FLAIL_GLB);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const need = (n: string): THREE.Object3D => {
        const o = root.getObjectByName(n);
        if (!o) throw new Error(`flail.glb is missing the ${n} node`);
        return o;
      };
      const haftNode = need('Haft'), anchorNode = need('ChainAnchor'), ballNode = need('Ball'), linkNode = need('ChainLink');
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial && std.metalness > 0.5) { std.envMap = env; std.envMapIntensity = 0.8; std.needsUpdate = true; }
        }
      });
      haftNode.removeFromParent(); haftNode.position.set(0, 0, 0); haftNode.quaternion.identity();
      haft.add(haftNode); haftPrim.visible = false;
      haft.updateMatrixWorld(true);
      anchorLocal.copy(haft.worldToLocal(anchorNode.getWorldPosition(new THREE.Vector3())));
      ballNode.removeFromParent(); ballNode.position.set(0, 0, 0); ballNode.quaternion.identity();
      ball.add(ballNode); ballPrim.visible = false;
      const found: THREE.Mesh[] = [];
      linkNode.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
      if (found[0]) { chain.geometry = found[0].geometry; chain.material = found[0].material; linkGeo.dispose(); }
    } catch (e) {
      console.warn('[sdf-game] flail.glb absent or unreadable — using the primitive flail', e);
    }
  })();

  let hand: THREE.Group | null = null;
  void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
    hand = arms.right;
    hand.name = 'flail-hand';
    hand.scale.setScalar(FLAIL_LOOK.handScale);
    haft.add(hand);
  }).catch((e) => console.warn('[sdf-game] flail hand: goblin-arm.glb failed', e));
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    view.updateMatrixWorld(true);
    view.localToWorld(_sh.copy(FLAIL_LOOK.handShoulder));
    view.localToWorld(_bend.copy(FLAIL_LOOK.handShoulder).add(BEND_R_VIEW));
    haft.worldToLocal(_sh); haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    aimArm(hand, _sh, _bend);
  }

  let swing: FlailSwing = makeFlailSwing();
  let click = false, held = false;
  let hitStop = 0, hitStopOn = true;
  let strikes = 0, clock = 0;
  let lastStrike: FlailDebug['lastStrike'] = null;
  window.addEventListener('blur', () => { held = false; });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== ctx.boot.canvas) held = false;
  });

  function strike(side: FlailSide): void {
    strikes++;
    const p = ctx.player.player;
    const eye = deps.eye();
    const impact = viewToWorld(eye, p.yaw, p.pitch, FLAIL_IMPACT[side]);
    const actors: StrikeActor[] = [];
    for (const a of ctx.world.actors) {
      const posed = a.posed();
      const c = posed.clusters.find(cc => cc.limb === 'torso')?.center;
      if (c) actors.push({ id: a.id, centre: c, field: q => sdBody(q, posed) });
    }
    const hits = resolveStrike(eye, p.yaw, impact, actors);
    lastStrike = { side, hits: hits.map(h => h.actorId) };
    for (const h of hits) {
      const a = ctx.world.actors.find(x => x.id === h.actorId);
      if (!a) continue;
      const posed = a.posed();
      const w = worldHitToWound(posed.prims, h.point, FLAIL_FEEL.craterR, 'blast', a.pose().yaw, q => sdBody(q, posed));
      w.severRadius = FLAIL_FEEL.craterR * FLAIL_FEEL.severMul;
      clothifyWound(posed.prims, w, 'heavy');
      a.blast({
        wounds: [w],
        meterCredit: FLAIL_FEEL.meterCredit,
        impulse: { at: h.point, vel: [h.dir[0] * FLAIL_FEEL.shove, h.dir[1] * FLAIL_FEEL.shove, h.dir[2] * FLAIL_FEEL.shove] },
        reaction: 'blast',
      });
      deps.bleed(a, w, h.point, h.dir);
    }
    if (hits.length > 0) {
      if (hitStopOn) hitStop = FLAIL_FEEL.hitStopSec;
      ctx.weapon.recoilPitch += FLAIL_FEEL.kickRad;
      ctx.weapon.shotAlert = true;
    }
    ctx.telemetry.telemetry.event('flail-strike', { side, hits: hits.length });
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _roll = new THREE.Quaternion();
  const _p = new THREE.Vector3(), _tan = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  function draw(): void {
    const pose = flailPose(swing);
    haft.position.set(pose.grip[0], pose.grip[1], pose.grip[2]);
    haft.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    const sway = swing.phase === 'idle' ? FLAIL_LOOK.swayAmp : 0;
    const w = 2 * Math.PI * FLAIL_LOOK.swayHz * clock;
    ball.position.set(pose.ball[0] + sway * Math.sin(w), pose.ball[1], pose.ball[2] + sway * 0.7 * Math.sin(w * 1.3));
    haft.updateMatrix();
    _a.copy(anchorLocal).applyMatrix4(haft.matrix);          // the eye bolt, rig-local
    _b.copy(ball.position).addScaledVector(Y, 0.07);          // the ball's ring, rig-local
    ball.quaternion.setFromUnitVectors(Y, _tan.copy(_a).sub(_b).normalize());
    const span = _a.distanceTo(_b);
    const sag = Math.max(0, FLAIL_LOOK.chainLen - span) * 0.6;
    _c.copy(_a).add(_b).multiplyScalar(0.5); _c.y -= sag;
    const n = Math.min(MAX_LINKS, Math.max(2, Math.round(Math.max(span, FLAIL_LOOK.chainLen * 0.8) / FLAIL_LOOK.linkPitch)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, u = 1 - t;
      _p.set(u * u * _a.x + 2 * u * t * _c.x + t * t * _b.x, u * u * _a.y + 2 * u * t * _c.y + t * t * _b.y, u * u * _a.z + 2 * u * t * _c.z + t * t * _b.z);
      _tan.set(2 * u * (_c.x - _a.x) + 2 * t * (_b.x - _c.x), 2 * u * (_c.y - _a.y) + 2 * t * (_b.y - _c.y), 2 * u * (_c.z - _a.z) + 2 * t * (_b.z - _c.z));
      if (_tan.lengthSq() < 1e-12) _tan.copy(Y); else _tan.normalize();
      _q.setFromUnitVectors(Y, _tan);
      _roll.setFromAxisAngle(_tan, i % 2 === 0 ? 0 : Math.PI / 2);
      _q.premultiply(_roll);
      chain.setMatrixAt(i, _m.compose(_p, _q, _one));
    }
    chain.count = n;
    chain.instanceMatrix.needsUpdate = true;
    aimHand();
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'flail') return false;
      if (button === 0) { click = true; held = true; }
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick(dt) {
      if (!rig.visible) { swing = cancelFlailSwing(swing); click = false; return; }
      clock += dt;
      const ready = ctx.weapon.slotState.live === 'flail' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
      if (!ready) {
        swing = cancelFlailSwing(swing);
      } else {
        const r = stepFlailSwing(swing, { click, held }, dt);
        swing = r.state;
        for (const side of r.strikes) strike(side);
      }
      click = false;
      draw();
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'flail');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999 && ownsSlot(ctx, 'flail');
    },
    hitStopScale(dt) {
      if (hitStop <= 0) return 1;
      hitStop -= dt;
      return FLAIL_FEEL.hitStopScale;
    },
    phase: () => swing.phase,
    click() { click = true; },
    hold(on) { held = on; },
    setHitStop(on) { hitStopOn = on; if (!on) hitStop = 0; },
    debug: () => ({ phase: swing.phase, side: swing.side, swingId: swing.swingId, strikes, lastStrike }),
  };
}
```

- [ ] **Step 3: Write `game-seams-flail.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-seams-flail.ts
//
// Flail automation seams (scripts/flail-gate.mjs): swing without a mouse, read
// the swing and the damage back.
import type { GameContext } from './game-context';

export function createFlailSeams(ctx: GameContext) {
  return {
    flail: {
      /** One click (a mousedown edge; the button is released unless hold(true)). */
      click: () => { ctx.weapon.flail?.click(); },
      hold: (on: boolean) => { ctx.weapon.flail?.hold(on); },
      /** Off for deterministic frame counts in gates. */
      setHitStop: (on: boolean) => { ctx.weapon.flail?.setHitStop(on); },
      state: () => ctx.weapon.flail?.debug() ?? null,
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor.
       *  Counts only prims of a LIVE cluster: a full-limb sever (sever.ts severLimb) marks the
       *  CLUSTER dead and leaves its prims' own `dead` flags alone. */
      limbAlive: (id: number, limb: string) => {
        const a = ctx.world.actors.find(q => q.id === id);
        if (!a) return -1;
        const b = a.drawnBody();
        let n = 0;
        for (const c of b.clusters) {
          if (c.limb !== limb || !c.alive) continue;
          for (let i = c.start; i < c.start + c.count; i++) {
            const p = b.prims[i]!;
            if (!p.dead && p.op !== 'sub') n++;
          }
        }
        return n;
      },
    },
  };
}
```

- [ ] **Step 4: Wire it**

- `game-weapon-leaves.ts` `stepWeaponSlots`, after `ctx.weapon.flare?.updateRig();`:
  ```ts
  // Slot 1: the flail's holster travel (game-flail.ts).
  ctx.weapon.flail?.updateRig();
  ```
- `game-panels-leaves.ts`: the HUD branch becomes
  `` S.live === 'flail' ? `1 FLAIL ${ctx.weapon.flail?.phase() ?? ''}`.trimEnd() ``.
- `game-main.ts`:
  1. Imports: `import { createFlail } from './game-flail';` and
     `import { createFlailSeams } from './game-seams-flail';`.
  2. After `ctx.weapon.flare = createFlareHarness(…);`:
     ```ts
     // WEAPON SLOT 1 (the spike flail, game-flail.ts): its own rig on aimRig.
     ctx.weapon.flail = createFlail(ctx, {
       eye: () => eyeOf(ctx.player.player),
       bleed: (a, w, point, incoming) => registerBleed(ctx, a, w, 'slug', { point, incoming }),
     });
     ```
  3. In the canvas mousedown listener, before the flare's `onMouseDown`:
     `if (ctx.weapon.flail?.onMouseDown(e.button)) return;`
  4. After the dynamite `mouseup` listener:
     `window.addEventListener('mouseup', (e) => ctx.weapon.flail?.onMouseUp(e.button));`
  5. At the top of `tick`, after `if (ctx.demo.simLocked) return;`:
     ```ts
     // FLAIL HIT-STOP: a landed strike nearly freezes the sim for 50 ms
     // (game-flail.ts). Its timer counts down on the unscaled step. The demo
     // recorder stores the scaled dt (a replay stays deterministic).
     dt *= ctx.weapon.flail?.hitStopScale(dt) ?? 1;
     ```
  6. After `stepWeaponSlots(ctx, dt);`: `ctx.weapon.flail?.tick(dt);`
  7. In `mergeSeams(`: `createFlailSeams(ctx),`.

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit && npm test -- flail game-weapon-slots game-actor game-context-coverage`
Expected: tsc clean; everything passes except the known `artScene`/`spawnOverride` coverage failure.

- [ ] **Step 6: Boot smoke (headless).** Load `/sdf-game.html?level=night-train&vhs=off&loader=0`.
  Assert: the backend is `webgpu`; the warm gate reaches `ready`; the live slot is `'flail'`;
  `__sdfGame.flail.state().phase === 'idle'`. Then `click()`, step one frame at a time for 30
  frames, and check that the phase goes `swing` → `idle` and `state().strikes === 1`. There must be
  zero console errors. Capture `docs/dev-notes/2026-09-26-flail/rest.png` and a mid-swing frame at
  about 0.15 s (`swing-mid.png`) and LOOK at both:
  - the haft and hand are in the lower right;
  - the ball hangs below the haft on a visible chain;
  - mid-swing, the ball is up and to the right, about to come across.

  If the ball renders blown out under the flashlight (as the censer head did at arm's length),
  port the censer's fill-light fix from git history (`git show 8c24de2a -- src/lab/sdf-zombie/webgpu/game-censer.ts`,
  the OWN LIGHT LIST / `flashFill` section). Only do this if you measured the blow-out: > 50%
  clipped pixels on the ball.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-flail.ts src/lab/sdf-zombie/webgpu/game-seams-flail.ts \
  src/lab/sdf-zombie/webgpu/game-state-weapon.ts src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts \
  src/lab/sdf-zombie/webgpu/game-panels-leaves.ts src/lab/sdf-zombie/webgpu/game-main.ts \
  docs/dev-notes/2026-09-26-flail/rest.png docs/dev-notes/2026-09-26-flail/swing-mid.png
git commit -m "feat(flail): game leaf — keyframed haft/chain/ball on the aim rig, strike → one big crater, hit-stop, seams"
```

---

### Task 6: The gate (`scripts/flail-gate.mjs`) and first look pass

**Files:**
- Create: `scripts/flail-gate.mjs`, `docs/dev-notes/2026-09-26-flail/NOTES.md`
- Tuning only if needed: `FLAIL_FEEL` / `FLAIL_LOOK` in `game-flail.ts`, keys in `flail-swing.ts`,
  `FLAIL_STRIKE` in `flail-strike.ts`

- [ ] **Step 1: Write the gate.** Base the CDP harness on `scripts/bride-melee-gate.mjs` lines 1–100
  (connect, console capture, `evaluate` with timeouts, `shot`), and on its boot and warm-gate wait.
  The frozen-sandbox staging comes from the censer gate in git history
  (`git show d0c4590d:scripts/censer-gate.mjs`), which had:
  - the sandbox arena, room 6, with 8 zombies;
  - `__sdfGame.freeze(true)` and `selectSlot`;
  - `placePlayer` to stand the player and face a target;
  - `actorWounds` to read wounds back;
  - `limbAlive` for severs;
  - "screenshots lag hand-stepped frames by one, so take shots after two frozen re-renders";
  - stepping one frame at a time where `step(n)` timed out on first compile.

  Call `__sdfGame.flail.setHitStop(false)` first. Assertions, each on a fresh zombie:
  1. **Front hit:** at 1.5 m, facing the torso, one `click()` then 30 frames adds **exactly one**
     wound, with radius within 0.005 of `0.14` (read back from `actorWounds`), and
     `state().lastStrike.hits` contains the id.
  2. **Too far:** at 2.2 m, a click adds no wound to that zombie.
  3. **Too wide:** at 1.2 m but turned 70° away, a click adds no wound to that zombie.
  4. **Beheading:** facing the neck at 1.4 m (pitch the view so `viewToWorld(eye, yaw, pitch, FLAIL_IMPACT.R)`
     lands at neck height; compute it in the script from the same numbers), up to 3 clicks sever the
     head (`limbAlive(id, 'head') === 0`).
  5. **Console:** zero errors or exceptions.

  Photos go to `docs/dev-notes/2026-09-26-flail/gate/`: `rest.png`, `swing-R-mid.png`,
  `swing-L-mid.png`, `hit-wound.png` and `behead-after.png`.

- [ ] **Step 2: Run it** with `node scripts/flail-gate.mjs <vitePort> <cdpPort>`. If a check fails,
  tune and record each change in NOTES.md (old → new, and why):
  - If the front hit lands no wound, check `inStrikeArc` against the torso centre, and check
    whether the posed body's torso cluster is found.
  - If the beheading fails, raise `FLAIL_FEEL.severMul` in 0.1 steps (≤ 1.6), or move the
    impact key up. Don't loosen the gate.

  Stop after five tuning rounds, and report the numbers if it still fails.

- [ ] **Step 3: Look at every photo**, and write one honest line per photo in NOTES.md:
  - Does the swing read as a flail swing? The ball should be ahead of the hand at the strike.
  - Does the wound read as a big crater? Measure red minus green in a 40×40 crop at the wound
    against the same crop before the hit; it should rise by more than 10.
  - Is anything blown out or clipping the camera?

  Tune the keyframes if the swing looks wrong. Keep `flail-swing`'s tests passing, and record
  every change in NOTES.

- [ ] **Step 4: Commit**

```bash
git add scripts/flail-gate.mjs docs/dev-notes/2026-09-26-flail/ src/lab/sdf-zombie/webgpu/flail-*.ts src/lab/sdf-zombie/webgpu/game-flail.ts
git commit -m "test(flail): in-game gate — one big crater per hit, reach/arc refusals, beheading; look pass"
```

---

### Task 7: Status board, PR and playtest hand-off

**Files:** `TASKS.md`, `docs/game/levels/00-the-wake/tasks.md`, `docs/superpowers/specs/2026-09-26-spike-flail-design.md`,
`docs/dev-notes/2026-09-26-flail/NOTES.md`; the PR description (goblincore/blud#22).

- [ ] **Step 1: Update the docs:**
  - `TASKS.md`: the spike flail row becomes "v1 built, gate passing; owner playtest pending", with links
    to this plan, the gate command and NOTES.
  - The Wake's W-B4: `[~]` "spike flail built; owner playtest pending".
  - The spec's status line: "v1 built (plan 2026-09-26-spike-flail); owner playtest pending".
  - Put a "For the owner" section at the top of NOTES.md:
    - how to try it: key 1, click to swing, hold to chain;
    - what to judge: timing, reach, crater size, the 50 ms hit-stop, and the camera kick;
    - the one known limitation: the strike ignores walls.

- [ ] **Step 2: Rewrite the PR description** (`gh pr edit 22 --body-file …`) so it describes the flail:
  - the censer was built, playtested and scrapped, and is still in the branch history;
  - what was kept (melee slot and pickup, the `blast()` reaction option, the gib-blur hitch fixes);
  - the new swing and strike design;
  - the test plan, with the gate output;
  - end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

  Retitle it with `gh pr edit 22 --title "Spike flail: first player melee weapon (preset swings, one big crater per hit)"`.

- [ ] **Step 3: Commit and push**

```bash
git add TASKS.md docs/game/levels/00-the-wake/tasks.md docs/superpowers/specs/2026-09-26-spike-flail-design.md docs/dev-notes/2026-09-26-flail/NOTES.md
git commit -m "docs: spike flail v1 — status, W-B4, playtest hand-off"
git push
```

---

## v1.1 — owner playtest feedback (spec §10, 2026-09-27)

Tasks 8–11. Run them **sequentially**, one implementer at a time: concurrent commits in one
worktree share one git index. Always commit with an explicit pathspec, and never `git reset`.

### Task 8: The guided chain sim (`flail-chain.ts`, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/flail-chain.ts`, `src/lab/sdf-zombie/webgpu/flail-chain.test.ts`

Nodes `0 … n−1` in view space (metres). Node 0 is pinned to the eye bolt. Nodes `1 … n−2` are
chain; node `n−2` is the ball's ring. Node `n−1` is the ball's centre, one `FLAIL_CHAIN.ringOffset`
link past the ring. The chain links share `FLAIL_CHAIN.len` evenly.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/flail-chain.test.ts
import { describe, expect, it } from 'vitest';
import { FLAIL_CHAIN_SIM, guideWeight, linkRest, makeChain, stepChain, type ChainState } from './flail-chain';
import { FLAIL_CHAIN, FLAIL_SWING, makeFlailSwing, type FlailSwing } from './flail-swing';
import type { Vec3 } from '../types';

const DOWN: Vec3 = [0, -1, 0];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ball = (s: ChainState) => s.p[s.p.length - 1]!;
const reach = FLAIL_CHAIN.len + FLAIL_CHAIN.ringOffset;
const swingAt = (t: number): FlailSwing => ({ ...makeFlailSwing(), phase: 'swing', t });

describe('stepChain', () => {
  it('hangs straight down at rest', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0.2, -0.2, 0]);
    for (let i = 0; i < 240; i++) s = stepChain(s, a, [0, -reach, 0], FLAIL_CHAIN_SIM.restGuide, DOWN, 1 / 120);
    expect(ball(s)[1]).toBeCloseTo(-reach, 1);
    expect(Math.hypot(ball(s)[0], ball(s)[2])).toBeLessThan(0.02);
  });

  it('keeps every link near its rest length while the anchor moves', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const t = i / 120;
      const a: Vec3 = [0.3 * Math.sin(t * 9), 0.2 * Math.cos(t * 7), 0];
      s = stepChain(s, a, [a[0], a[1] - reach, a[2]], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
      for (let k = 0; k < s.p.length - 1; k++) {
        worst = Math.max(worst, Math.abs(dist(s.p[k]!, s.p[k + 1]!) - linkRest(k)) / linkRest(k));
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('puts the ball exactly on its target at guide 1 (within reach)', () => {
    const a: Vec3 = [0, 0, 0];
    let s = makeChain(a, [0, -reach, 0]);
    const target: Vec3 = [0.2, -0.1, -0.25];
    s = stepChain(s, a, target, 1, DOWN, 1 / 60);
    expect(dist(ball(s), target)).toBeLessThan(1e-9);
  });

  it('lags a fast-moving anchor, then keeps moving after it stops (the whip)', () => {
    let s = makeChain([0, 0, 0], [0, -reach, 0]);
    for (let i = 0; i < 12; i++) {
      const a: Vec3 = [(0.4 * (i + 1)) / 12, 0, 0];   // 0.4 m in 0.1 s
      s = stepChain(s, a, [a[0], -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
    }
    expect(ball(s)[0]).toBeLessThan(0.4 - 0.05);          // lagging behind
    const before = ball(s);
    s = stepChain(s, [0.4, 0, 0], [0.4, -reach, 0], FLAIL_CHAIN_SIM.swingFloor, DOWN, 1 / 120);
    expect(dist(ball(s), before) * 120).toBeGreaterThan(0.5);   // still moving after the anchor stopped
  });

  it('is the same whatever the frame split (fixed step)', () => {
    const a: Vec3 = [0, 0, 0];
    let s1 = makeChain(a, [0.3, 0, 0]), s2 = makeChain(a, [0.3, 0, 0]);
    for (let i = 0; i < 60; i++) s1 = stepChain(s1, a, [0, -reach, 0], 0.1, DOWN, 1 / 60);
    for (let i = 0; i < 120; i++) s2 = stepChain(s2, a, [0, -reach, 0], 0.1, DOWN, 1 / 120);
    for (let k = 0; k < 3; k++) expect(ball(s2)[k]).toBeCloseTo(ball(s1)[k]!, 9);
  });

  it('dt <= 0 or NaN leaves the state unchanged', () => {
    const s = makeChain([0, 0, 0], [0, -reach, 0]);
    expect(stepChain(s, [0, 0, 0], [0, -reach, 0], 0.1, DOWN, 0)).toBe(s);
    expect(stepChain(s, [0, 0, 0], [0, -reach, 0], 0.1, DOWN, Number.NaN)).toBe(s);
  });
});

describe('guideWeight', () => {
  it('holds lightly at rest, is exactly 1 at the strike, and loose either side of it', () => {
    expect(guideWeight(makeFlailSwing())).toBe(FLAIL_CHAIN_SIM.restGuide);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT))).toBe(1);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT - 0.1))).toBeLessThan(0.1);
    expect(guideWeight(swingAt(FLAIL_SWING.strikeT + 0.1))).toBeLessThan(0.2);
  });
  it('never jumps by more than 0.2 between 240 Hz samples within a swing', () => {
    let prev = guideWeight(swingAt(0));
    for (let t = 1 / 240; t < FLAIL_SWING.swingSec; t += 1 / 240) {
      const g = guideWeight(swingAt(t));
      expect(Math.abs(g - prev)).toBeLessThan(0.2);
      prev = g;
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- flail-chain`
Expected: FAIL — `Failed to resolve import "./flail-chain"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/flail-chain.ts
//
// THE FLAIL'S CHAIN, SIMULATED FOR LOOKS (spec §10.1). Pure. Position-based
// rope in VIEW space, pinned at the eye bolt; the ball is its heavy last node.
// The swing's authored ball position is a TARGET the ball is pulled toward by
// a guide weight: loose through the wind-up (the ball lags the haft — the
// whip), exactly 1 at strikeT (the drawn ball sits on FLAIL_IMPACT, where the
// strike window puts the crater), loose again through the follow-through, and
// a light hold at rest. Hits never read this module.
//
// Nodes: 0 = the bolt (pinned) … n−2 = the ball's ring … n−1 = the ball centre.

import type { Vec3 } from '../types';
import { FLAIL_CHAIN, FLAIL_SWING, type FlailSwing } from './flail-swing';

export const FLAIL_CHAIN_SIM = {
  nodes: 9,
  stepHz: 240,
  maxSubsteps: 24,
  iterations: 12,
  /** Air drag, 1/s. */
  damping: 2.5,
  gravity: 9.81,
  /** Inverse mass of the ball node (the links are 1): a heavy ball the chain barely drags. */
  ballInvMass: 0.2,
  /** Pull toward the target at guide 1, 1/s (below `pinAt`). */
  guideRate: 80,
  /** At or above this guide the ball is pinned exactly on the target. */
  pinAt: 0.98,
  restGuide: 0.12,
  swingFloor: 0.03,
  /** Seconds before strikeT over which the guide ramps up to 1. */
  guideWindow: 0.07,
  /** Seconds after strikeT over which it lets go. */
  releaseWindow: 0.05,
  /** Seconds before the swing ends over which it returns to the rest hold. */
  settleWindow: 0.12,
} as const;

type M3 = [number, number, number];

export interface ChainState {
  p: Vec3[];
  prev: Vec3[];
  /** The anchor the last substep used. */
  anchor: Vec3;
  /** Unsimulated time carried to the next call, seconds. */
  acc: number;
}

const N = FLAIL_CHAIN_SIM.nodes;

/** Rest length of link k (node k → k+1). */
export function linkRest(k: number): number {
  return k === N - 2 ? FLAIL_CHAIN.ringOffset : FLAIL_CHAIN.len / (N - 2);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function guideWeight(s: FlailSwing): number {
  const C = FLAIL_CHAIN_SIM, S = FLAIL_SWING;
  if (s.phase === 'idle') return C.restGuide;
  const t = s.t;
  if (t <= S.strikeT) return t >= S.strikeT ? 1 : Math.max(C.swingFloor, smooth(S.strikeT - C.guideWindow, S.strikeT, t));
  const letGo = 1 - smooth(S.strikeT, S.strikeT + C.releaseWindow, t);
  const settle = smooth(S.swingSec - C.settleWindow, S.swingSec, t) * C.restGuide;
  return Math.max(C.swingFloor, letGo, settle);
}

export function makeChain(anchor: Vec3, toward: Vec3): ChainState {
  const d: M3 = [toward[0] - anchor[0], toward[1] - anchor[1], toward[2] - anchor[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  const u: M3 = l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, -1, 0];
  const p: Vec3[] = [];
  let r = 0;
  for (let i = 0; i < N; i++) {
    p.push([anchor[0] + u[0] * r, anchor[1] + u[1] * r, anchor[2] + u[2] * r]);
    if (i < N - 1) r += linkRest(i);
  }
  return { p, prev: p.map(q => [q[0], q[1], q[2]] as Vec3), anchor: [anchor[0], anchor[1], anchor[2]], acc: 0 };
}

export function stepChain(
  s: ChainState, anchor: Vec3, target: Vec3, guide: number, down: Vec3, dt: number,
): ChainState {
  if (!(dt > 0)) return s;
  const C = FLAIL_CHAIN_SIM;
  const h = 1 / C.stepHz;
  const span = s.acc + dt;
  let steps = Math.floor(span / h + 1e-9);
  let acc = Math.max(0, span - steps * h);
  let capped = false;
  if (steps > C.maxSubsteps) { steps = C.maxSubsteps; acc = 0; capped = true; }
  if (steps === 0) return { ...s, acc };
  const p: M3[] = s.p.map(q => [q[0], q[1], q[2]]);
  const prev: M3[] = s.prev.map(q => [q[0], q[1], q[2]]);
  const a0 = s.anchor;
  const decay = Math.exp(-C.damping * h);
  const g: M3 = [down[0] * C.gravity * h * h, down[1] * C.gravity * h * h, down[2] * C.gravity * h * h];
  const pin = guide >= C.pinAt;
  const pull = pin ? 1 : 1 - Math.exp(-C.guideRate * clamp01(guide) * h);
  const last = N - 1;
  let lastA: M3 = [a0[0], a0[1], a0[2]];
  for (let step = 0; step < steps; step++) {
    const f = Math.min(1, ((step + 1) * h) / span);
    const a: M3 = [a0[0] + (anchor[0] - a0[0]) * f, a0[1] + (anchor[1] - a0[1]) * f, a0[2] + (anchor[2] - a0[2]) * f];
    lastA = a;
    // Verlet for the free nodes.
    for (let i = 1; i < N; i++) {
      const q = p[i]!, o = prev[i]!;
      for (let k = 0; k < 3; k++) {
        const v = (q[k]! - o[k]!) * decay;
        o[k] = q[k]!;
        q[k] = q[k]! + v + g[k]!;
      }
    }
    p[0] = [a[0], a[1], a[2]];
    // The guide: pull (or pin) the ball toward its authored place.
    const b = p[last]!;
    for (let k = 0; k < 3; k++) b[k] = b[k]! + (target[k]! - b[k]!) * pull;
    // Link constraints.
    for (let it = 0; it < C.iterations; it++) {
      for (let i = 0; i < last; i++) {
        const q0 = p[i]!, q1 = p[i + 1]!;
        const w0 = i === 0 ? 0 : 1;
        const w1 = i + 1 === last ? (pin ? 0 : C.ballInvMass) : 1;
        const wsum = w0 + w1;
        if (wsum === 0) continue;
        const dx = q1[0] - q0[0], dy = q1[1] - q0[1], dz = q1[2] - q0[2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const c = (d - linkRest(i)) / d / wsum;
        q0[0] += dx * c * w0; q0[1] += dy * c * w0; q0[2] += dz * c * w0;
        q1[0] -= dx * c * w1; q1[1] -= dy * c * w1; q1[2] -= dz * c * w1;
      }
    }
    if (pin) { b[0] = target[0]; b[1] = target[1]; b[2] = target[2]; }
  }
  const anchorOut: Vec3 = capped ? [anchor[0], anchor[1], anchor[2]] : lastA;
  return { p, prev, anchor: anchorOut, acc };
}
```

- [ ] **Step 4: Run the tests.** Run `npm test -- flail-chain`; all must pass. If "hangs straight down" or
  "whip" fails, tune `FLAIL_CHAIN_SIM` (`damping`, `iterations`, `ballInvMass`), not the test bounds, and
  report the measured numbers.
- [ ] **Step 5: Commit.** Run `npx tsc --noEmit`, then
  `git commit -m "feat(flail): guided chain sim (visual whip; ball pinned on the impact at the strike)" -- src/lab/sdf-zombie/webgpu/flail-chain.ts src/lab/sdf-zombie/webgpu/flail-chain.test.ts`
  (add both files first).

---

### Task 9: The gradual head-damage rule (`flail-strike.ts`, pure)

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-strike.ts` and `flail-strike.test.ts`.

- [ ] **Step 1: Write the failing test.** Append:

```ts
import { FLAIL_HEAD, flailWound, isHeadRegion } from './flail-strike';

describe('gradual head damage', () => {
  it('a head prim, or a point within regionDist of the head centre, is the head region', () => {
    expect(isHeadRegion('head', [0, 0, 0], null)).toBe(true);
    expect(isHeadRegion('torso', [0, 1.4, 0], [0, 1.6, 0])).toBe(true);
    expect(isHeadRegion('torso', [0, 1.2, 0], [0, 1.6, 0])).toBe(false);
    expect(isHeadRegion('armL', [0, 1.0, 0], null)).toBe(false);
  });
  it('head hits before the last cave the face in without severing; the last one severs', () => {
    for (let before = 0; before < FLAIL_HEAD.hitsToSever - 1; before++) {
      expect(flailWound(true, before, 0.14, 1.3)).toEqual({ radius: FLAIL_HEAD.faceCraterR, severRadius: 0 });
    }
    const last = flailWound(true, FLAIL_HEAD.hitsToSever - 1, 0.14, 1.3);
    expect(last.radius).toBe(0.14);
    expect(last.severRadius).toBeCloseTo(0.182, 9);
  });
  it('body hits are unchanged', () => {
    expect(flailWound(false, 0, 0.14, 1.3).radius).toBe(0.14);
    expect(flailWound(false, 7, 0.14, 1.3).severRadius).toBeCloseTo(0.182, 9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npm test -- flail-strike`. It should FAIL on the missing exports.
- [ ] **Step 3: Implement.** Append to `flail-strike.ts`:

```ts
/** Gradual head damage (spec §10.5): head-region hits before the last cave the face
 *  in (a smaller crater, no sever); the last one takes the head off. */
export const FLAIL_HEAD = { regionDist: 0.25, hitsToSever: 3, faceCraterR: 0.09 } as const;

export function isHeadRegion(limb: string | undefined, point: Vec3, headCentre: Vec3 | null): boolean {
  if (limb === 'head') return true;
  if (!headCentre) return false;
  return Math.hypot(point[0] - headCentre[0], point[1] - headCentre[1], point[2] - headCentre[2]) < FLAIL_HEAD.regionDist;
}

/** The wound for one hit. `headHitsBefore` counts this actor's earlier head-region hits. */
export function flailWound(
  headRegion: boolean, headHitsBefore: number, craterR: number, severMul: number,
): { radius: number; severRadius: number } {
  if (!headRegion || headHitsBefore + 1 >= FLAIL_HEAD.hitsToSever) return { radius: craterR, severRadius: craterR * severMul };
  return { radius: FLAIL_HEAD.faceCraterR, severRadius: 0 };
}
```

  (`severRadius: 0` blocks the sever; the sever test reads `severRadius ?? radius`, so 0 is not
  nullish, and the soft-target code already relies on this.)
- [ ] **Step 4: Run the tests and commit.** Run `npm test -- flail-strike` and `npx tsc --noEmit`, then commit
  `"feat(flail-strike): gradual head damage rule (face caves in, 3rd head hit severs)"` with a pathspec.

---

### Task 10: Wire it: chain sim rendering, head counter, bigger hand

**Files:** modify `src/lab/sdf-zombie/webgpu/game-flail.ts` (and `game-seams-flail.ts` for the debug readback).

- [ ] **Step 1: Chain rendering.** In `game-flail.ts`, replace the quadratic-curve chain and the drawn-ball
  clamp with the sim:
  - keep a `ChainState | null` (made with `makeChain(bolt, pose.ball)` on the first visible frame, and
    whenever the rig was hidden);
  - each tick: `bolt` = the eye bolt in rig space (as now);
    `chain = stepChain(chain, bolt, pose.ball, guideWeight(swing), downInRig, dt)`, where `downInRig` is
    world down converted into rig space (the same conversion as the current world-down sag), normalised;
  - draw links along nodes `0 … n−2` (one instanced link per short segment, several per sim link so the
    chain stays dense: about `FLAIL_LOOK.linkPitch` spacing, oriented along the local tangent and
    alternating the roll as now);
  - place the ball at node `n−1`, with its ring facing node `n−2`;
  - remove the now-unused clamp code and the sag constants.

  Hit logic is unchanged (`FLAIL_IMPACT`).
- [ ] **Step 2: Head counter.** In `strike()`, for each hit:

```ts
const posed = a.posed();
const yaw = a.pose().yaw;
const field = (q: Vec3) => sdBody(q, posed);
const probe = worldHitToWound(posed.prims, h.point, FLAIL_FEEL.craterR, 'blast', yaw, field);
const headC = posed.clusters.find(c => c.limb === 'head' && c.alive)?.center ?? null;
const region = isHeadRegion(posed.prims[probe.primIdx]?.limb, h.point, headC);
const before = headHits.get(a.id) ?? 0;
const spec = flailWound(region, before, FLAIL_FEEL.craterR, FLAIL_FEEL.severMul);
if (region) headHits.set(a.id, before + 1);
const w = spec.radius === FLAIL_FEEL.craterR ? probe : worldHitToWound(posed.prims, h.point, spec.radius, 'blast', yaw, field);
w.severRadius = spec.severRadius;
```

  (`headHits` is a `Map<number, number>` inside `createFlail`.) Keep `clothifyWound`, `blast()`, bleed,
  hit-stop and kick as now. Add `headHits` for the struck actors to `lastStrike` in `debug()` (e.g.
  `lastStrike.headHits: Record<id, n>`).
- [ ] **Step 3: Hand.** Set `FLAIL_LOOK.handScale` 0.8 → 1.0 (tune from photos in Task 11; the shoulder
  divide-back already handles the scale).
- [ ] **Step 4: Type-check, test, smoke, commit.** Run `npx tsc --noEmit` and `npm test -- flail game-weapon-slots game-actor`.
  Boot smoke on Night Train (the .lab-tmp harness): zero console errors. One click must go through swing
  → idle with 1 strike, and the drawn ball at the strike frame must be within 2 cm of the rig-space
  `FLAIL_IMPACT` (add a `ballDrawn` rig-space readback to `state()` if needed). Then commit with a pathspec:
  `"feat(flail): whip chain sim, gradual head damage, bigger hand"`.

---

### Task 11: Gate, look pass, TASKS row, docs and PR

**Files:** `scripts/flail-gate.mjs`, `docs/dev-notes/2026-09-26-flail/NOTES.md`, `TASKS.md`, the spec status,
and the PR body.

- [ ] **Step 1: Gate.** Replace the beheading check with a **gradual** one, on a fresh zombie at neck
  height:
  - after head hit 1 and hit 2: the head is still on (`limbAlive(id,'head') > 0`), and a new wound of
    radius ≈ 0.09 lands on or near the head;
  - after hit 3: the head is off.

  Photos: `gate/head-hit-1.png`, `head-hit-2.png`, `head-hit-3.png`. Keep all other checks and the
  positive controls. Add a **strike-frame ball check**: at the strike frame, the drawn ball is within
  2 cm of the impact.
- [ ] **Step 2: Look pass.** Capture the R and L swings frame by frame at 60 Hz (wind-up, strike and
  follow-through) and LOOK at them:
  - the ball should visibly trail the haft on the wind-up, then snap through, then whip past and wrap on
    the follow-through;
  - at rest it hangs and sways;
  - the hand shows more fist at rest.

  Tune `FLAIL_CHAIN_SIM` (damping, iterations, guide windows) and `handScale`, recording every change in
  NOTES. Save a strip `look/whip-R-strip.png` (6–8 frames side by side) and `look/whip-L-strip.png`.
- [ ] **Step 3: TASKS.md.** Add a row: "**View-model wall clipping** (all weapons): weapons poke through
  walls when the player stands close; e.g. a view-model depth range / separate pass, or pulling the
  weapon back near walls. Lower priority (owner, 2026-09-27)." Update the flail row to "v1.1 built
  (whip chain, gradual head damage); owner playtest pending".
- [ ] **Step 4: Docs, PR, push.**
  - Update the NOTES "For the owner" section: what changed in v1.1, and new feel questions.
  - Set the spec status line: "v1.1 built (§10); owner playtest pending".
  - Update the PR body with a v1.1 section via `gh pr edit 22 --body-file …`, keeping the ending line
    `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Commit with a pathspec and `git push`.

---

## v1.2 — second playtest (spec §11, 2026-09-27)

**Root cause of "the head comes off on the first hit" (confirmed 2026-09-27, headless probe with the
crosshair on the head centre, frozen zombies):** `FLAIL_IMPACT` sits ~18° below the crosshair (R view
(−0.05, −0.36, −1.12)), so aiming at the head lands the crater on the **upper chest** (a `torso/spine`
prim, y 1.12–1.32 against a head centre at 1.58), 0.29–0.48 m from the head centre. That is never a head
hit (`regionDist` 0.25), so it gets the full 0.14 m crater with `severRadius` 0.182. At **0.9 m** the
crater is 0.16 m from the neck root (the head chain's first prim's `a`) and the connectivity carve cuts
the head on **hit 1**; at 1.1 m on hit 2–3; at 1.4 m never. The same chest hits also severed `armL` at
the shoulder. The v1.1 gate missed it because it aimed the *strike ray* at the neck, not the crosshair
at the head. (`actorList().meter` is stale on frozen actors: it is the last stepped frame's.)

Execution: **one implementer at a time**, commit with an explicit pathspec, never `git reset`/`git stash`.
Gate runs on ports other than 5190 (the owner's server), e.g. `LAB_VITE_PORT=5241 LAB_CDP_PORT=9241`.

### Task 12: Gate first — crosshair-aimed head hits and a hits-to-collapse count (red on v1.1)

**Files:** modify `scripts/flail-gate.mjs` (header comment, constants, section 4, a new section 4b).

- [ ] **Step 1: Replace section 4 (gradual head damage) with a CROSSHAIR-aimed version.** A fresh zombie;
  before every click: `head = actorLimbCenter(id, 'head')`, `pose = standOff(head, 0.9)` (0.9 m, the
  distance the probe decapitated at on hit 1), pitch `atan2(head[1] − EYE_H, 0.9)` — the crosshair on
  the head centre, exactly as a player aims. **4 clicks.** Per hit, log: side, the impact point
  (`lastStrike.impact`) and its distance to the head centre, each new wound's prim limb/bone, radius and
  `severRadius` (read `__sdfGame.zombie(id).woundList()` + `posed().prims[w.primIdx]`; positions from
  `actorWounds`), its distance to the head centre and to the **neck root** (the first live non-`sub`
  `head` prim's `a`), `lastStrike.headHits[id]`, and `limbAlive(id, 'head')`. Asserts:
  - after hits 1, 2, 3: the head is ON (`limbAlive > 0`), `headHits` counts 1, 2, 3, and the hit's
    first new wound has radius `FACE_R` (0.06) ± 0.005;
  - after hit 4: the head is OFF (`limbAlive === 0`) and `headHits` is 4.
  Photos `head-hit-1..4.png` (the existing `photoOf`, and the existing thaw-3-frames trick before the
  hit-4 photo). Remove the old strike-ray `aim()` solver and the "strike ray within 5 cm of the neck"
  check (the crosshair case replaces both).
- [ ] **Step 2: New section 4b — hits to collapse.** A fresh zombie; before every click, stand 1.2 m
  from its torso centre with the crosshair on the torso centre (pitch `atan2(t[1] − EYE_H, 1.2)`). After
  each click's swing: thaw one frame (`freeze(false)`, `stepOne()`, `freeze(true)`) so the actor's
  debug readback (`actorList()` `phase`, `meter`) is fresh, then read it. Click until `phase !==
  'standing'` or 8 clicks. Log per hit: meter, phase, new wound radii, `severed` limbs (dead clusters).
  Asserts: the collapse comes on hit **≥ 4** (target 5; `collapse.ts` `meterThreshold` 0.8, credit
  0.18 → hit 5), and hit 1's wound radius is `CRATER_R` ± 0.005.
- [ ] **Step 3: Constants.** `CRATER_R = 0.09`, `FACE_R = 0.06`, add `HEAD_HITS = 4`. Update the header
  comment's asserts list (items 1, 4 and the new 4b).
- [ ] **Step 4: Run it on the v1.1 code and record the RED result.** Expected: section 1 fails (radius
  0.14), section 4 fails on hit 1 (head off, `headHits` 0), section 4b fails (collapse on hit 3). Paste
  the per-hit log lines into the commit message body. Commit:
  `test(flail-gate): crosshair-aimed head hits + hits-to-collapse (red on v1.1)`.

### Task 13: The head rule — neck-joint region, 4 hits, the neck snaps on the last (pure)

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-strike.ts`, `src/lab/sdf-zombie/webgpu/flail-strike.test.ts`.

- [ ] **Step 1: Failing tests** (replace the `gradual head damage` describe):

```ts
describe('gradual head damage', () => {
  const HEAD_C: Vec3 = [0, 1.6, 0], NECK: Vec3 = [0, 1.42, 0];
  it('a head prim, a point near the head centre, or a point near the neck root is the head region', () => {
    expect(isHeadRegion('head', [0, 0, 0], null, null)).toBe(true);
    expect(isHeadRegion('torso', [0, 1.4, 0], HEAD_C, null)).toBe(true);          // < regionDist of the head
    expect(isHeadRegion('torso', [0, 1.28, 0.05], HEAD_C, NECK)).toBe(true);      // 0.15 m from the neck root
    expect(isHeadRegion('torso', [0, 1.2, 0.1], HEAD_C, NECK)).toBe(false);       // 0.24 m from the neck root
    expect(isHeadRegion('armL', [0, 1.0, 0], null, null)).toBe(false);
  });
  it('head hits 1..hitsToSever−1 are face craters with no sever and no neck snap', () => {
    expect(FLAIL_HEAD.hitsToSever).toBe(4);
    for (let before = 0; before < FLAIL_HEAD.hitsToSever - 1; before++) {
      expect(flailWound(true, before, 0.09, 1.3)).toEqual({ radius: FLAIL_HEAD.faceCraterR, severRadius: 0, snapNeck: false });
    }
  });
  it('the last head hit is the full crater, severs, and snaps the neck', () => {
    const last = flailWound(true, FLAIL_HEAD.hitsToSever - 1, 0.09, 1.3);
    expect(last.radius).toBe(0.09);
    expect(last.severRadius).toBeCloseTo(0.117, 9);
    expect(last.snapNeck).toBe(true);
  });
  it('body hits are the full crater with sever, never a neck snap', () => {
    expect(flailWound(false, 0, 0.09, 1.3)).toEqual({ radius: 0.09, severRadius: expect.closeTo(0.117, 9), snapNeck: false });
    expect(flailWound(false, 7, 0.09, 1.3).snapNeck).toBe(false);
  });
  it('headNeck finds the head chain root and neck midpoint on live prims, null once the head is gone', () => {
    const prims = [
      { limb: 'torso', op: 'union', a: [0, 1.1, 0], b: [0, 1.3, 0] },
      { limb: 'head', op: 'union', a: [0, 1.38, 0], b: [0, 1.5, 0] },
      { limb: 'head', op: 'union', a: [0, 1.5, 0], b: [0, 1.7, 0] },
    ] as unknown as Primitive[];
    expect(headNeck(prims)).toEqual({ root: [0, 1.38, 0], mid: [0, 1.44, 0] });
    expect(headNeck(prims.map(p => ({ ...p, dead: p.limb === 'head' })) as Primitive[])).toBeNull();
  });
});
```

  (Use `toBeCloseTo` on `mid` components if float noise appears.) Run
  `npm test -- flail-strike` → FAIL.
- [ ] **Step 2: Implement.**

```ts
/** Gradual head damage (spec §10.5, §11): a head-region hit caves the face in without severing until the
 *  actor's `hitsToSever`-th, which is the full crater and SNAPS THE NECK (game-flail.ts stamps a sever
 *  wound at the neck midpoint, so the head comes off wherever on the head the last blow lands). */
export const FLAIL_HEAD = {
  regionDist: 0.25,
  /** Also the head region: within this of the neck root. Crosshair-on-head hits used to land on the upper
   *  chest ~0.16 m from it and sever the neck on hit 1 (spec §11). */
  neckDist: 0.2,
  hitsToSever: 4,
  faceCraterR: 0.06,
  /** The neck-snap wound's sever calibre, metres (a zombie neck is ~0.07 m in radius). */
  neckSeverR: 0.12,
} as const;

export function isHeadRegion(limb: LimbId | undefined, point: Vec3, headCentre: Vec3 | null, neckRoot: Vec3 | null): boolean {
  if (limb === 'head') return true;
  const near = (c: Vec3 | null, r: number) => !!c && Math.hypot(point[0] - c[0], point[1] - c[1], point[2] - c[2]) < r;
  return near(headCentre, FLAIL_HEAD.regionDist) || near(neckRoot, FLAIL_HEAD.neckDist);
}

export function flailWound(
  headRegion: boolean, headHitsBefore: number, craterR: number, severMul: number,
): { radius: number; severRadius: number; snapNeck: boolean } {
  if (!headRegion) return { radius: craterR, severRadius: craterR * severMul, snapNeck: false };
  if (headHitsBefore + 1 >= FLAIL_HEAD.hitsToSever) return { radius: craterR, severRadius: craterR * severMul, snapNeck: true };
  return { radius: FLAIL_HEAD.faceCraterR, severRadius: 0, snapNeck: false };
}

/** The head chain's root (it sits in the shoulders) and its first segment's midpoint (the neck), from the
 *  first live, non-`sub` `head` prim; null when there is none (the head is off). */
export function headNeck(prims: readonly Primitive[]): { root: Vec3; mid: Vec3 } | null {
  const n = prims.find(p => p.limb === 'head' && p.op !== 'sub' && !p.dead);
  if (!n) return null;
  return { root: [n.a[0], n.a[1], n.a[2]], mid: [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2, (n.a[2] + n.b[2]) / 2] };
}
```

  (Import `Primitive` from `../types`.) Run `npm test -- flail-strike` → PASS; `npx tsc --noEmit` will
  fail in `game-flail.ts` (the new `isHeadRegion` argument) — that is Task 14; do not commit a broken
  type-check: make the minimal call-site change in `game-flail.ts` (`isHeadRegion(…, headC, null)`) so
  tsc passes, and leave the real wiring to Task 14.
- [ ] **Step 3: Commit** `feat(flail-strike): neck-root head region, 4 hits, neck snap on the last`.

### Task 14: Wire it — softer hits, the neck snap, a bigger hand

**Files:** modify `src/lab/sdf-zombie/webgpu/game-flail.ts`.

- [ ] **Step 1: Feel numbers.** `FLAIL_FEEL.craterR` 0.14 → **0.09**, `meterCredit` 0.35 → **0.18**
  (`severMul` stays 1.3). Update the comments that quote 0.14 / 3 hits / "the 3rd".
- [ ] **Step 2: `strike()`.** Per hit:

```ts
const neck = headNeck(posed.prims);
const region = isHeadRegion(posed.prims[probe.primIdx]?.limb, h.point, headC, neck?.root ?? null);
// … flailWound as now …
const batch = [w];
if (spec.snapNeck && neck) {
  // The killing head blow snaps the neck wherever on the head it lands: a sever-only calibre at the neck
  // midpoint (connectivity.ts cuts the head's attachment). The head leaves with it, so its crater is not seen.
  const snap = worldHitToWound(posed.prims, neck.mid, FLAIL_HEAD.neckSeverR, 'blast', yaw, field);
  snap.severRadius = FLAIL_HEAD.neckSeverR;
  batch.push(snap);
}
a.blast({ wounds: batch, … });
```

  (`clothifyWound` stays on `w` only.) The bleed stays on `w`.
- [ ] **Step 3: Hand.** `FLAIL_LOOK.handScale` 1.0 → **1.3** (Task 16 tunes it from photos).
- [ ] **Step 4: Verify.** `npx tsc --noEmit`; `npm test -- flail game-weapon-slots game-actor`. Run the gate
  (Task 12's): sections 1, 4 and 4b must now PASS (4b: collapse on hit 5). If hit 4 does not take the
  head off, measure (log the connectivity disc samples' coverage) before changing `neckSeverR`; record
  the numbers in `docs/dev-notes/2026-09-26-flail/NOTES.md`. Commit
  `feat(flail): softer hits (0.09 crater, 5 to drop), neck snap on the 4th head hit, bigger hand`.

### Task 15: The keys — strike on the crosshair, R as a big overhand swipe

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-swing.ts`, `src/lab/sdf-zombie/webgpu/flail-swing.test.ts`;
maybe `src/lab/sdf-zombie/webgpu/flail-chain.ts` (guide windows) and its test if the whip gates need it.

- [ ] **Step 1: Failing tests** (add to the `flailPose` describe):

```ts
it('strikes on the crosshair: the impact ≤ 0.1 below the view axis per metre forward, ≤ 0.1 to the side', () => {
  for (const side of ['R', 'L'] as const) {
    const [x, y, z] = FLAIL_IMPACT[side];
    expect(y / -z, side).toBeLessThanOrEqual(-0.04);
    expect(y / -z, side).toBeGreaterThanOrEqual(-0.1);
    expect(Math.abs(x / -z), side).toBeLessThanOrEqual(0.1);
  }
});
it('R is a big overhand swipe: wound up high over the right shoulder, then down onto the crosshair', () => {
  const at = (t: number) => flailPose({ phase: 'swing', side: 'R', t, struck: false, queued: false, nextSide: 'R', swingId: 1 });
  const up = at(0.1);
  expect(up.ball[1]).toBeGreaterThanOrEqual(0.3);    // above the eye
  expect(up.ball[0]).toBeGreaterThanOrEqual(0.15);   // on the right
  expect(up.ball[2]).toBeGreaterThanOrEqual(-0.45);  // up by the shoulder, not out in front
  expect(up.grip[1]).toBeGreaterThanOrEqual(0.0);    // the fist raised
  const v = flailBallVel({ ...makeFlailSwing(), phase: 'swing', side: 'R', t: FLAIL_SWING.strikeT });
  expect(v[1]).toBeLessThan(0);                      // coming down…
  expect(Math.abs(v[1])).toBeGreaterThanOrEqual(Math.abs(v[0]));   // …more down than across
});
```

  Run `npm test -- flail-swing` → FAIL.
- [ ] **Step 2: Author the keys.** Keep `swingSec`, `strikeT`, the key times (0, 0.1, 0.15, 0.18, 0.3,
  0.37, 0.45) and `FLAIL_REST`. Targets:
  - **R** (overhand): t 0.1 the fist raised above the right shoulder, the haft tipped back, the ball up and
    behind (above/right of the frame's top-right corner); t 0.15 the haft coming over; t 0.18 the ball
    on the crosshair (view y ≈ −0.05…−0.1 at z ≈ −1.1), the chain taut; t 0.3 follow through low and
    left, down past the bottom of the frame; t 0.37 returning.
  - **L** (cross-screen, unchanged in character): only the strike ball moves up onto the crosshair; move
    the grip up with it so the chain stays taut; re-fit the 0.15 and 0.3/0.37 keys.
  - Every existing `flailPose` test must stay green: taut 0.34–0.36 m at the strike, ≥ 0.28 m from the
    bolt all swing, within `chainReach()` at every key, ≤ 3 cm overshoot, no > 2× speed jump, ≥ 0.8 of
    peak speed at the strike, no pops, R/L strike x mirror (`|R.x + L.x| < 0.2`), strike z < −0.8.

  Do it the way v1.1 did: a small scratch search script (in the session scratchpad, NOT committed) that
  varies the non-strike keys' ball offsets and grips within bounds and keeps the sets where every test
  predicate passes; round to the cm; update the long key comment block above `KEYS_R` with what changed
  and why (overhand, crosshair strike, the search).
- [ ] **Step 3: Chain.** `npm test -- flail-chain` stays green. In game (gate section 5/5b) the drawn ball
  must still sit on `FLAIL_IMPACT` at the strike frame (≤ 2 cm at 60 Hz, ≤ 1 mm at 144 Hz steady and
  jittered).
- [ ] **Step 4: Verify and commit.** `npx tsc --noEmit`; `npm test -- flail`; the full gate passes.
  Commit `feat(flail-swing): strike on the crosshair; R is a big overhand swipe`.

### Task 16: Look pass — the overhand, the hand, the head over 4 hits

**Files:** `docs/dev-notes/2026-09-26-flail/NOTES.md`, `look/`, `gate/`; tuning constants only
(`FLAIL_LOOK.handScale`, `FLAIL_CHAIN_SIM` if the whip needs it).

- [ ] **Step 1:** Capture the R swing frame by frame at 60 Hz (rest → wind-up → strike → follow-through)
  and LOOK: it must read as a big overhand swipe coming down onto the crosshair, not a jab. Save
  `look/overhand-R-strip.png` (6–8 frames side by side) and refresh `look/whip-L-strip.png`.
- [ ] **Step 2:** The hand at 1.3: the rest photo shows a clearly bigger fist, rest framing unchanged
  (ball/grip NDC within ~0.05 of v1.1's). Tune `handScale` 1.2–1.4 from photos; record the numbers.
- [ ] **Step 3:** Look at `gate/head-hit-1..4.png`: the face visibly caves in over hits 1–3, the head is
  off after 4. Look at the 4b chest craters: no gaping centre from one hit.
- [ ] **Step 4:** NOTES: the v1.2 tuning log (root cause + numbers), the "For the owner" section (what
  changed, what to test). Commit with a pathspec.

### Task 17: Status, PR, owner server

- [ ] `TASKS.md` flail row → "v1.2 built (crosshair strike, overhand R, 4-hit head, ~5 hits to drop);
  owner playtest pending"; spec status line likewise; the PR body gains a v1.2 section (`gh pr edit 22
  --body-file …`, keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line);
  commit and `git push`. Start the owner's server (`preview_start` `blud-censer`, port 5190).

---

## v1.3 — the R → L → H combo, tougher zombies, no decapitation, the crosshair ray (spec §12, 2026-09-28)

**Goal:** a third swing (H, a flat right-to-left sweep) as the finisher of a chained R → L → H combo;
about 8 body hits drop a zombie; the flail never takes a head off; the hit lands where the crosshair points.

**Shape of the change:**
- `flail-swing.ts` gets per-side timing (`FLAIL_TIMING`) and an `'H'` key table (Task 18), then the combo
  state machine (Task 19). `FLAIL_SWING.swingSec`/`strikeT` stay as the R/L values, so R/L code and tests keep
  reading them; every place that must also work for H switches to `FLAIL_TIMING[side]`.
- `flail-strike.ts` gets per-side arcs and the no-sever head rule; `game-flail.ts` gets per-side feel and the
  crosshair ray (Task 20).
- The gate learns the combo, the sweep's width, 8 head hits and ≥ 7 to collapse (Task 21).

Rules as before: one implementer at a time, explicit pathspecs, never `git reset`/`git stash`, targeted tests,
headless gate on ports 5241/9241 (5190 is the owner's).

### Task 18: The H sweep — per-side timing and keys (pure)

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-swing.ts`, `src/lab/sdf-zombie/webgpu/flail-swing.test.ts`,
`src/lab/sdf-zombie/webgpu/flail-chain.ts`, `src/lab/sdf-zombie/webgpu/flail-chain.test.ts`,
`src/lab/sdf-zombie/webgpu/game-flail.ts` (one line).

The state machine still alternates R/L in this task; H is reachable only by constructing a swing state with
`side: 'H'` (tests, the chain replay). Task 19 wires the combo.

- [ ] **Step 1: Types and timing.** In `flail-swing.ts`:

```ts
export type FlailSide = 'R' | 'L' | 'H';

/** Per-side swing timing. R and L are FLAIL_SWING's; H, the combo's finisher, is longer. */
export const FLAIL_TIMING: Readonly<Record<FlailSide, { swingSec: number; strikeT: number }>> = {
  R: { swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT },
  L: { swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT },
  H: { swingSec: 0.55, strikeT: 0.2 },
};

/** Each side's key times (the tests iterate these). */
export function flailKeyTimes(side: FlailSide): number[] { return KEYS[side].map(k => k.t); }
```

  Update the header comment (three swings; R overhand, L cross, H sweep). Make every timing use per-side:
  - `strikeIfDue`: `s.t < FLAIL_TIMING[s.side].strikeT`;
  - `stepFlailSwing`: the buffer check and the end-of-swing check use `FLAIL_TIMING[cur.side].swingSec`
    (and `s.side` for the buffer on the pre-step state);
  - `hermiteTangent`: the strike key is `keys[i]!.t === strikeT` where `strikeT` is passed in by `sample`
    from `flailPose` (`FLAIL_TIMING[s.side].strikeT`);
  - `flailBallVel`: clamp to `FLAIL_TIMING[s.side].swingSec`;
  - `FLAIL_IMPACT`: add `H: KEYS_H.find(k => k.t === FLAIL_TIMING.H.strikeT)!.ball`;
  - `flail-chain.ts` `guideWeight`: `const S = FLAIL_TIMING[s.side]` (was `FLAIL_SWING`);
  - `game-flail.ts` line ~465: `t: FLAIL_TIMING[strikeNow].strikeT`.
  - `other()` stays R↔L for now (Task 19 replaces it).
- [ ] **Step 2: Failing tests for H** (in `flail-swing.test.ts`). Generalise the pose-quality tests so they
  run for `['R', 'L', 'H']` with each side's own timing and key times: the strike passes through
  `FLAIL_IMPACT[side]` at its `strikeT`; no pops (drive H by constructing states, `t` from 0 to
  `FLAIL_TIMING.H.swingSec` in 1/240 steps); speed at the strike ≥ 0.8 of the peak over `[strikeT − 0.06,
  strikeT + 0.12]`; no > 2× speed jump away from the rest ends; the overshoot test with
  `flailKeyTimes(side)` filtered to the non-helper keys (for R/L the existing `[0, 0.1, 0.18, 0.3, 0.45]`;
  for H `[0, 0.12, 0.2, 0.33, 0.55]`); within chain reach at every key; ≥ 0.28 m from the bolt over the whole
  swing; taut 0.34–0.36 m at the strike; the crosshair test (`y/−z` ∈ [−0.1, −0.04], `|x/−z|` ≤ 0.1).
  Add the H character test:

```ts
it('H is a flat right-to-left sweep through the crosshair', () => {
  const at = (t: number) => flailPose({ phase: 'swing', side: 'H', t, struck: false, queued: false, nextSide: 'H', swingId: 1 });
  const wind = at(0.12);
  expect(wind.ball[0]).toBeGreaterThanOrEqual(0.55);           // wound up wide right
  expect(Math.abs(wind.ball[1])).toBeLessThanOrEqual(0.2);     // at shoulder height, not overhead
  const follow = at(0.33);
  expect(follow.ball[0]).toBeLessThanOrEqual(-0.5);            // follows through far left
  const v = flailBallVel({ ...makeFlailSwing(), phase: 'swing', side: 'H', t: FLAIL_TIMING.H.strikeT });
  expect(v[0]).toBeLessThan(0);                                // moving right → left
  expect(Math.abs(v[0])).toBeGreaterThanOrEqual(2 * Math.abs(v[1]));   // flat
});
```

  (Task 19 adds `idleT: 0` to this and every other `FlailSwing` literal.) Run `npm test -- flail-swing` → FAIL (no H keys).
- [ ] **Step 3: Author `KEYS_H`.** Key times `0, 0.12, 0.17, 0.2, 0.33, 0.43, 0.55` (rest, wind-up, coming
  round, strike, follow-through, returning, rest). Targets: wind-up wide right at shoulder height (ball x ≈
  0.6–0.8, y ≈ 0, z ≈ −0.3…−0.5; fist raised to about shoulder height); strike on the crosshair (ball ≈ (0,
  −0.08, −1.1)), the chain taut, the haft level-ish and pointing forward-left; follow-through far left and a
  little low; return. Find the numbers the way v1.2 did: a scratch search (session scratchpad, not committed)
  over the non-strike keys within bounds, keeping sets where every test predicate passes; round to the cm.
  Document the table in the key comment block (why H looks like this; the search).
- [ ] **Step 4: The chain at every frame rate.** In `flail-chain.test.ts` extend the replay's side loops to
  `['R', 'L', 'H']` (the replay must run `FLAIL_TIMING[side].swingSec` long) — every existing chain assertion
  (the ball on `FLAIL_IMPACT` < 1e-6 on the strike frame, arriving moving; links exact; no teleport; the 60 Hz
  catapult and lag checks) must hold for H. If the pin misses by microns at some rate (seen in v1.2 at 30 Hz),
  nudge the H keys, not the test.
- [ ] **Step 5: Verify, commit.** `npx tsc --noEmit`; `npm test -- flail`. Commit
  `feat(flail-swing): H, a flat sweep; per-side timing` (pathspec: the five files).

### Task 19: The combo state machine — R → L → H, a pause resets to R (pure)

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-swing.ts`, `src/lab/sdf-zombie/webgpu/flail-swing.test.ts`,
`src/lab/sdf-zombie/webgpu/flail-chain.test.ts` (literals only), `src/lab/sdf-zombie/webgpu/game-flail.ts`
(debug `nextSide`).

- [ ] **Step 1: Failing tests.** Replace `sides alternate click to click`, and update the three tests whose
  expectations were R/L alternation:

```ts
it('a quick combo runs R, L, H, then back to R', () => {
  let r = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 0.1, false, true);
  expect(r.strikes).toEqual(['R']);
  r = run(r.s, FLAIL_TIMING.L.swingSec + 0.1, false, true);
  expect(r.strikes).toEqual(['L']);
  r = run(r.s, FLAIL_TIMING.H.swingSec + 0.1, false, true);
  expect(r.strikes).toEqual(['H']);
  r = run(r.s, FLAIL_TIMING.R.swingSec + 0.1, false, true);
  expect(r.strikes).toEqual(['R']);
});

it('a pause longer than comboWindowSec resets the combo to R', () => {
  let r = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 0.01, false, true);   // R, then idle 0.01 s
  r = run(r.s, FLAIL_SWING.comboWindowSec + 0.05, false);                        // wait past the window
  r = run(r.s, FLAIL_TIMING.R.swingSec + 0.1, false, true);
  expect(r.strikes).toEqual(['R']);
});

it('the combo window edge: a click just inside continues, just outside resets', () => {
  const afterR = run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + 1e-6, false, true).s;   // idle, idleT ≈ 0
  const inside = run(afterR, FLAIL_SWING.comboWindowSec - 2 * DT, false).s;
  expect(comboSide(inside)).toBe('L');
  expect(run(inside, 0.3, false, true).strikes).toEqual(['L']);
  const outside = run(afterR, FLAIL_SWING.comboWindowSec + 2 * DT, false).s;
  expect(comboSide(outside)).toBe('R');
  expect(run(outside, 0.3, false, true).strikes).toEqual(['R']);
});
```

  - `holding the button chains swings`: `run(makeFlailSwing(), FLAIL_TIMING.R.swingSec + FLAIL_TIMING.L.swingSec
    + FLAIL_TIMING.H.strikeT + 0.01, true, true)` → `['R', 'L', 'H']`.
  - `a click in the last bufferSec queues the next swing`: unchanged (R then L).
  - `a chained huge dt strikes each swing exactly once, still alternating` → "…cycling R, L, H": expected
    `allStrikes.map((_, i) => (['R', 'L', 'H'] as const)[i % 3])`, and the dt `0.55 + 0.37` so every step still
    crosses at least one full swing of any side.
  - `a held button with no click does not start a swing from idle`: assert `r.state.phase === 'idle'`,
    `r.state.swingId === 0` and no strikes (the state now ages `idleT`, so `toEqual(idle)` no longer holds).
  - Every `FlailSwing` literal in both test files gains `idleT: 0`.

  Run `npm test -- flail-swing` → FAIL.
- [ ] **Step 2: Implement.**

```ts
// FLAIL_SWING gains:
  /** A click within this long after a swing ends continues the combo; later, it restarts at R. */
  comboWindowSec: 0.35,

export interface FlailSwing {
  // … as now, plus:
  /** Seconds idle since the last swing ended (0 on a fresh flail). */
  idleT: number;
}

export function makeFlailSwing(): FlailSwing {
  return { phase: 'idle', side: 'R', t: 0, struck: false, queued: false, nextSide: 'R', swingId: 0, idleT: 0 };
}

/** The combo: R (overhand) → L (cross) → H (sweep) → R. */
const COMBO_NEXT: Readonly<Record<FlailSide, FlailSide>> = { R: 'L', L: 'H', H: 'R' };

/** The side the next swing takes: the combo's next while chained or inside the window, else R. */
export function comboSide(s: FlailSwing): FlailSide {
  return s.phase === 'swing' || s.idleT <= FLAIL_SWING.comboWindowSec ? s.nextSide : 'R';
}

function start(s: FlailSwing, t: number): FlailSwing {
  const side = comboSide(s);
  return { phase: 'swing', side, t, struck: false, queued: false, nextSide: COMBO_NEXT[side], swingId: s.swingId + 1, idleT: 0 };
}
```

  In `stepFlailSwing`: from idle without a click, return `{ ...s, idleT: s.idleT + dt }` (still no swing);
  from idle with a click, start **before** aging (`comboSide` reads the pre-step `idleT`, which is what the
  debug readback showed the player); a swing that ends without a queue or a held button becomes
  `{ …, phase: 'idle', t: 0, queued: false, struck: false, idleT: leftover }`. A chained end (`queued ||
  held`) calls `start(cur, leftover)` while `cur.phase === 'swing'`, so it takes `nextSide`. `cancelFlailSwing`
  sets `idleT: Infinity` (a weapon switch or death resets the combo). Delete `other()`. Update the header
  comment (the combo rule).
- [ ] **Step 3: The readback.** In `game-flail.ts` `debug()`, report `nextSide: comboSide(swing)` (the side a
  click NOW would start — the gate's positive control reads it before every click).
- [ ] **Step 4: Verify, commit.** `npx tsc --noEmit`; `npm test -- flail game-weapon-slots`. Commit
  `feat(flail-swing): the R → L → H combo; a pause resets to R`.

### Task 20: Per-swing feel and arc, no decapitation, the crosshair ray

**Files:** modify `src/lab/sdf-zombie/webgpu/flail-strike.ts`, `src/lab/sdf-zombie/webgpu/flail-strike.test.ts`,
`src/lab/sdf-zombie/webgpu/game-flail.ts`.

- [ ] **Step 1: Failing tests** (`flail-strike.test.ts`):

```ts
describe('per-swing arc', () => {
  it('R and L reach ±50°, H ±70°', () => {
    expect(FLAIL_ARC_DEG).toEqual({ R: 50, L: 50, H: 70 });
    const eye: Vec3 = [0, 1.6, 0];
    const at = (deg: number): Vec3 => [Math.sin(deg * Math.PI / 180) * 1.2, 1.2, -Math.cos(deg * Math.PI / 180) * 1.2];
    expect(inStrikeArc(eye, 0, at(60), FLAIL_ARC_DEG.R)).toBe(false);
    expect(inStrikeArc(eye, 0, at(60), FLAIL_ARC_DEG.H)).toBe(true);
    expect(inStrikeArc(eye, 0, at(-60), FLAIL_ARC_DEG.H)).toBe(true);
    expect(inStrikeArc(eye, 0, at(80), FLAIL_ARC_DEG.H)).toBe(false);
  });
});

describe('head damage (no decapitation, spec §12.3)', () => {
  it('a head-region hit is always a face crater with no sever, however many came before', () => {
    for (let n = 0; n < 20; n++) expect(flailWound(true, 0.09, 1.3)).toEqual({ radius: FLAIL_HEAD.faceCraterR, severRadius: 0 });
  });
  it('a body hit is the full crater with its sever calibre', () => {
    const w = flailWound(false, 0.09, 1.3);
    expect(w.radius).toBe(0.09);
    expect(w.severRadius).toBeCloseTo(0.117, 9);
  });
});
```

  Delete the v1.2 `hitsToSever`/`snapNeck` tests (keep the `isHeadRegion` and `headNeck` tests). Update the
  existing `inStrikeArc`/`resolveStrike` call sites in the test file to pass an arc (`FLAIL_ARC_DEG.R`). Run
  `npm test -- flail-strike` → FAIL.
- [ ] **Step 2: Implement (`flail-strike.ts`).**
  - `export const FLAIL_ARC_DEG: Readonly<Record<FlailSide, number>> = { R: 50, L: 50, H: 70 };` (import
    `type FlailSide` from `./flail-swing`); remove `arcDeg` from `FLAIL_STRIKE`.
  - `inStrikeArc(eye, yaw, centre, arcDeg: number)` and `resolveStrike(eye, yaw, aimWorld, actors, arcDeg:
    number)`. Rename the `impactWorld` parameter to `aimWorld` and update its doc: the ray from the eye through
    `aimWorld` places the hit (the game passes a point on the crosshair ray); the torso-centre ray is the
    fallback, as now.
  - `FLAIL_HEAD` becomes `{ regionDist: 0.25, neckDist: 0.2, faceCraterR: 0.06 }` with a doc saying the flail
    never severs a head (spec §12.3; the head damage model is the next spec).
  - `flailWound(headRegion: boolean, craterR: number, severMul: number): { radius: number; severRadius: number }`
    — head region → `{ faceCraterR, 0 }`, body → `{ craterR, craterR * severMul }`.
- [ ] **Step 3: `game-flail.ts`.**

```ts
/** Feel numbers (spec §6, §11, §12.2). */
export const FLAIL_FEEL = {
  craterR: 0.09,
  severMul: 1.3,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  kickRad: 0.02,
  /** Per swing: collapse credit (threshold 0.8 → ~8 body hits), shove (blast() unit-normalises it), hit-stop. */
  swing: {
    R: { meterCredit: 0.1, shove: 6, hitStopSec: 0.05 },
    L: { meterCredit: 0.1, shove: 6, hitStopSec: 0.05 },
    H: { meterCredit: 0.14, shove: 9, hitStopSec: 0.07 },
  },
} as const;
```

  In `strike(side)`:
  - the aim: `const aim = viewToWorld(eye, p.yaw, p.pitch, [0, 0, -1]);` (1 m down the crosshair) replaces the
    `FLAIL_IMPACT` point in `resolveStrike(eye, p.yaw, aim, actors, FLAIL_ARC_DEG[side])`; `lastStrike.impact`
    records `aim` (rename the debug field's doc to "a point on the strike ray");
  - `flailWound(region, FLAIL_FEEL.craterR, FLAIL_FEEL.severMul)`; delete the neck-snap block and the
    `batch` array (back to `wounds: [w]`); keep counting `headHits` (the head damage model will read it);
  - `const f = FLAIL_FEEL.swing[side]` for `meterCredit`, `shove`, `hitStopSec`.
  - Drop now-unused imports (`FLAIL_HEAD`, `FLAIL_IMPACT` if unused — the chain still uses `FLAIL_IMPACT`).
- [ ] **Step 4: Verify, commit.** `npx tsc --noEmit`; `npm test -- flail game-weapon-slots game-actor`. Commit
  `feat(flail): per-swing feel and arc, no decapitation, the crosshair ray`.

### Task 21: The gate — combo, sweep width, 8 head hits, ≥ 7 to collapse, crosshair accuracy

**Files:** modify `scripts/flail-gate.mjs`.

- [ ] **Step 1: Constants and timing.** `SWING_FRAMES = 36` (0.6 s: past H's 0.55); `HEAD_HITS = 8`; the
  too-wide check turns **80°** (outside H's ±70° as well as R/L's ±50°); add `COLLAPSE_MIN = 7`,
  `AIM_MAX = 0.05`. Update the header's asserts list and synopsis.
- [ ] **Step 2: Combo section (new, after "too wide").** Wait 30 frames (> `comboWindowSec`), then 3 clicks via
  `swing()` (36 frames each, so each next click is 0.15 s after the previous swing ended, inside the window):
  assert the strike sides are `['R', 'L', 'H']`; then wait 30 frames and assert `state().nextSide === 'R'`.
- [ ] **Step 3: Sweep width (new).** Find two frozen pool zombies (fresh, untouched) and a standing point where
  both torso centres are 1.0–1.6 m away (horizontal) at bearings 55–65° either side of the facing, and no
  other zombie is within 1.8 m inside ±70°:

```js
/** Candidate stands for a pair (a, b: torso centres); the caller keeps the first inside the room
 *  bounds with no other zombie within 1.8 m inside ±70°. */
function sweepStands(a, b) {
  const out = [];
  const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2, half = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2;
  for (const deg of [60, 57, 63, 55, 65]) {
    const th = (deg * Math.PI) / 180, back = half / Math.tan(th), dist = half / Math.sin(th);
    if (dist < 1.0 || dist > 1.6) continue;
    const nx = -(b[2] - a[2]) / (2 * half), nz = (b[0] - a[0]) / (2 * half);   // unit normal to a→b
    for (const s of [1, -1]) {
      const x = mx + s * nx * back, z = mz + s * nz * back;
      out.push({ x, z, yaw: yawOf(mx - x, mz - z), deg });
    }
  }
  return out;
}
```

  Try every fresh pair; take the first candidate that passes the room-bounds and other-zombie checks. If no
  pair fits, `fail('sweep: no zombie pair fits')` — do not skip silently. At that stand: click R and L (both
  must hit neither zombie: bearings ≥ 55° are outside ±50°), then H: both zombies hit (`lastStrike.hits`
  includes both, each +1 wound).
- [ ] **Step 4: Head section → 8 hits, no decapitation.** As now (crosshair on the head centre from 0.9 m,
  re-aimed each click), 8 clicks (the sides run through the combo, H included). Every hit: head ON, the
  first new wound radius `FACE_R` ± 0.005 and < `ON_HEAD` from the head centre, `headHits` counts 1…8. Photos
  `head-hit-1.png`, `head-hit-4.png`, `head-hit-8.png` (drop the others).
- [ ] **Step 5: Collapse section.** The assert becomes collapse on hit ≥ `COLLAPSE_MIN`; the loop cap becomes 12.
- [ ] **Step 6: Crosshair accuracy.** For every hit in the head and collapse sections, the first new wound's
  distance to the strike ray (`lastStrike.eye` → `lastStrike.impact`) must be ≤ `AIM_MAX`; print the worst.
- [ ] **Step 7: 144 Hz.** Three clicks per label (so H is pinned too); keep ≤ 1 mm.
- [ ] **Step 8: Run to green, look, commit.** The full gate passes. Look at `head-hit-8.png` (the face caved
  in, the head on). Commit the gate and its refreshed photos:
  `test(flail-gate): the combo, the sweep's width, 8 head hits, 7+ to collapse, crosshair accuracy`.

### Task 22: Look pass, docs, PR

- [ ] `look/sweep-H-strip.png` (8 frames: rest, wind-up, coming round, strike, follow-through, return) and a
  refreshed `look/overhand-R-strip.png` if R changed; LOOK: H must read as a flat sweep across the screen.
- [ ] NOTES: the v1.3 entry (numbers, what to test); "For the owner".
- [ ] `TASKS.md` v1.3 row → built, owner playtest pending; spec §12 heading → BUILT; the PR body gains a v1.3
  section (`gh pr edit 22 --body-file …`, keep the 🤖 footer line). Commit, push; restart the owner's server
  (`preview_start` `blud-censer`).
