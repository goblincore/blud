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
