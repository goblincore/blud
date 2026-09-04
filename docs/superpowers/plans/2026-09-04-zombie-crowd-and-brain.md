# Zombie crowd separation + chase/attack brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the zombies in `sdf-game.html` from clipping through each other, and give them a chase-and-swing behaviour toward the player.

**Architecture:** Three new PURE modules under `src/lab/sdf-zombie/` — `crowd.ts` (circle separation), `brain.ts` (aggro/chase/attack state machine), `attack.ts` (the swing pose) — plus one optional field on `MotionConfig` that leaves the lab's motion bit-identical when unset, and wiring in `webgpu/game-actor.ts` and `webgpu/game-main.ts`. No new dependencies; no renderer changes.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess: true`), vitest, three.js/WebGPU only at the wiring edge. Test command is `npx vitest run <path>`; typecheck is `npx tsc --noEmit`.

**Spec:** [docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md](../specs/2026-09-04-zombie-crowd-and-brain-design.md)

---

## House rules for every task

* `noUncheckedIndexedAccess` is ON. Every `arr[i]` read is `T | undefined` — write `arr[i]!` when you have already bounds-checked, and never write `arr[i]! -= x` (assigning to a non-null assertion is a TS error); write `arr[i] = arr[i]! - x`.
* Pure modules import nothing from `three`, the DOM, `Date.now` or `Math.random`. `crowd.ts`, `brain.ts` and `attack.ts` must hold that line — it is what makes them testable.
* Every file opens with a `// src/...` path comment and a paragraph saying what the module is FOR, matching `wander.ts` / `stagger.ts` beside them.
* Commit after every task with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lab/sdf-zombie/crowd.ts` | create | Ground-plane circle separation. One exported function, no state. |
| `src/lab/sdf-zombie/crowd.test.ts` | create | Its tests. |
| `src/lab/sdf-zombie/brain.ts` | create | Per-zombie aggro/chase/attack state machine. Emits a wander-target override, a halt flag and a swing phase. |
| `src/lab/sdf-zombie/brain.test.ts` | create | Its tests. |
| `src/lab/sdf-zombie/attack.ts` | create | The swing pose: phase 0..1 → body-local joint offsets + a reach-pitch bias. |
| `src/lab/sdf-zombie/attack.test.ts` | create | Its tests. |
| `src/lab/sdf-zombie/motion.ts` | modify | One optional `MotionConfig.attack` field, composed beside `stagger`. |
| `src/lab/sdf-zombie/motion.test.ts` | modify | The bit-identity pin. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | Runs the brain inside `step()`; new `setBrainInput` / `nudge` / `brain` members. |
| `src/lab/sdf-zombie/webgpu/game-actor.test.ts` | modify | Wiring tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Per-frame brain input, separation, `__sdfGame.brains()` / `.crowdMinDist()`. |
| `scripts/sdf-game-crowd-gate.mjs` | create | Headless on-screen verification. |
| `docs/dev-notes/2026-09-04-zombie-crowd/notes.md` | create | Captures + what they show. |
| `TASKS.md` | modify | The status row. |

---

### Task 1: `crowd.ts` — soft circle separation

**Files:**
- Create: `src/lab/sdf-zombie/crowd.ts`
- Test: `src/lab/sdf-zombie/crowd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/crowd.test.ts`:

```ts
// src/lab/sdf-zombie/crowd.test.ts
import { describe, it, expect } from 'vitest';
import { CROWD_TUNING, separate, type CrowdAgent } from './crowd';

const z = (x: number, zz: number, r = 0.35): CrowdAgent => ({ x, z: zz, r, mobile: true });
const fixed = (x: number, zz: number, r = 0.32): CrowdAgent => ({ x, z: zz, r, mobile: false });
const dist = (a: CrowdAgent, b: CrowdAgent) => Math.hypot(a.x - b.x, a.z - b.z);

/** Applies one separate() pass and returns the moved agents. */
function relax(agents: CrowdAgent[]): CrowdAgent[] {
  const push = separate(agents);
  return agents.map((a, i) => ({ ...a, x: a.x + push[i]![0], z: a.z + push[i]![1] }));
}

describe('separate', () => {
  it('leaves agents that are not overlapping exactly alone', () => {
    const push = separate([z(0, 0), z(3, 0)]);
    expect(push).toEqual([[0, 0], [0, 0]]);
  });

  it('shrinks a pair overlap by the factor the tuning predicts', () => {
    // Two 0.35 m circles 0.5 m apart: want 0.7, overlap 0.2.
    // Each iteration removes `stiffness` of the CURRENT overlap, so after
    // n iterations the overlap is (1 - stiffness)^n of the original. This is
    // soft on purpose — see the spec; it does NOT fully separate in one frame.
    const before = [z(0, 0), z(0.5, 0)];
    const after = relax(before);
    const expected = 0.2 * (1 - CROWD_TUNING.stiffness) ** CROWD_TUNING.iterations;
    expect(dist(after[0]!, after[1]!)).toBeCloseTo(0.7 - expected, 6);
  });

  it('converges: repeated frames drive the overlap under a millimetre', () => {
    let agents = [z(0, 0), z(0.5, 0)];
    for (let i = 0; i < 40; i++) agents = relax(agents);
    expect(dist(agents[0]!, agents[1]!)).toBeGreaterThan(0.7 - 0.001);
  });

  it('corrections are equal and opposite for two mobile agents', () => {
    const push = separate([z(0, 0), z(0.5, 0)]);
    expect(push[0]![0]).toBeCloseTo(-push[1]![0], 12);
    expect(push[0]![1]).toBeCloseTo(-push[1]![1], 12);
  });

  it('an immobile agent never moves and its partner takes the whole push', () => {
    const push = separate([z(0.5, 0), fixed(0, 0)]);
    expect(push[1]).toEqual([0, 0]);
    // Whole share, not half: overlap 0.67 - 0.5 = 0.17, relaxed twice at 0.5.
    const solo = 0.17 * (1 - (1 - CROWD_TUNING.stiffness) ** CROWD_TUNING.iterations);
    expect(push[0]![0]).toBeCloseTo(solo, 6);
    expect(push[0]![1]).toBeCloseTo(0, 12);
  });

  it('two immobile agents are never pushed apart', () => {
    expect(separate([fixed(0, 0), fixed(0.1, 0)])).toEqual([[0, 0], [0, 0]]);
  });

  it('separates coincident agents deterministically', () => {
    const a = separate([z(1, 1), z(1, 1)]);
    const b = separate([z(1, 1), z(1, 1)]);
    expect(a).toEqual(b);
    expect(Math.hypot(a[0]![0], a[0]![1])).toBeGreaterThan(0);
  });

  it('caps one frame of correction at maxPush', () => {
    // A deep pile: three bodies stacked nearly on one point.
    const push = separate([z(0, 0), z(0.01, 0), z(0.02, 0)]);
    for (const p of push) {
      expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(CROWD_TUNING.maxPush + 1e-9);
    }
  });

  it('returns zero-length results for degenerate inputs', () => {
    expect(separate([])).toEqual([]);
    expect(separate([z(0, 0)])).toEqual([[0, 0]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/crowd.test.ts`
Expected: FAIL — `Failed to resolve import "./crowd"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/crowd.ts`:

```ts
// src/lab/sdf-zombie/crowd.ts
//
// Ground-plane crowd separation: the reason zombies stop standing inside one
// another. Every body is a circle on the floor (they are upright and the floor
// is flat, so the vertical axis carries no information here), and overlapping
// pairs are relaxed apart a fraction at a time.
//
// SOFT ON PURPOSE. One call removes `stiffness` of each pair's overlap per
// iteration, not all of it — after CROWD_TUNING's two iterations a quarter of
// the overlap survives the frame. A hard non-overlap constraint makes a pack
// pressed into a corner shudder and deadlock; running a soft one every frame
// converges within a few frames and jostles instead. Shallow, brief overlap
// during a shove is the accepted cost (spec, 2026-09-04).
//
// Pure: no RNG, no clock, no THREE. The caller owns the positions; this only
// says how far each agent should move.

/** One body on the floor. `mobile: false` = an anchor (the player): it takes
 *  none of its share of a correction, so its partner takes all of it. */
export interface CrowdAgent {
  x: number;
  z: number;
  r: number;
  mobile: boolean;
}

export const CROWD_TUNING = {
  /** Relaxation passes per call. */
  iterations: 2,
  /** Fraction of a pair's CURRENT overlap removed per pass. */
  stiffness: 0.5,
  /** Largest total correction one agent may take from one call (m) — a
   *  pathological pile unwinds over several frames instead of teleporting. */
  maxPush: 0.25,
} as const;

export type CrowdTuning = typeof CROWD_TUNING;

/**
 * Per-agent ground-plane correction, in the same order as `agents`.
 * O(n²) — over the game's ten bodies that is 45 pairs per pass, so a spatial
 * hash would cost more to maintain than it saves.
 */
export function separate(
  agents: readonly CrowdAgent[],
  tuning: CrowdTuning = CROWD_TUNING,
): [number, number][] {
  const n = agents.length;
  const out: [number, number][] = Array.from({ length: n }, () => [0, 0] as [number, number]);
  if (n < 2) return out;

  // Working positions, so pass k+1 sees pass k's corrections (Gauss-Seidel).
  const px = agents.map(a => a.x);
  const pz = agents.map(a => a.z);

  for (let pass = 0; pass < tuning.iterations; pass++) {
    for (let i = 0; i < n; i++) {
      const ai = agents[i]!;
      for (let j = i + 1; j < n; j++) {
        const aj = agents[j]!;
        if (!ai.mobile && !aj.mobile) continue;
        const want = ai.r + aj.r;
        let dx = px[j]! - px[i]!;
        let dz = pz[j]! - pz[i]!;
        let d = Math.hypot(dx, dz);
        if (d >= want) continue;
        let nx: number;
        let nz: number;
        if (d < 1e-6) {
          // Coincident bodies (a stacked spawn, a pile). The escape direction
          // comes from the index pair, NOT an RNG: separation has to be
          // reproducible frame to frame or the pair jitters in place. d is
          // forced to 0, not 1 — the overlap here is the FULL `want`, and
          // normalising against a fake unit distance would hand `want - d` a
          // negative number and pull the pair further together.
          const ang = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
          nx = Math.sin(ang);
          nz = Math.cos(ang);
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const move = (want - d) * tuning.stiffness;
        // Both mobile: split the correction. One anchored: the mover takes it all.
        const share = ai.mobile && aj.mobile ? 0.5 : 1;
        if (ai.mobile) {
          px[i] = px[i]! - nx * move * share;
          pz[i] = pz[i]! - nz * move * share;
        }
        if (aj.mobile) {
          px[j] = px[j]! + nx * move * share;
          pz[j] = pz[j]! + nz * move * share;
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    let dx = px[i]! - agents[i]!.x;
    let dz = pz[i]! - agents[i]!.z;
    const d = Math.hypot(dx, dz);
    if (d > tuning.maxPush) {
      dx = (dx / d) * tuning.maxPush;
      dz = (dz / d) * tuning.maxPush;
    }
    out[i] = [dx, dz];
  }
  return out;
}

/** Smallest centre-to-centre distance in the set (Infinity below two agents).
 *  The verification gate's oracle — "did they stop overlapping" is a number,
 *  not an opinion. */
export function minPairDistance(agents: readonly CrowdAgent[]): number {
  let best = Infinity;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const d = Math.hypot(agents[i]!.x - agents[j]!.x, agents[i]!.z - agents[j]!.z);
      if (d < best) best = d;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/crowd.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/crowd.ts src/lab/sdf-zombie/crowd.test.ts
git commit -m "crowd: soft ground-plane circle separation

Overlapping bodies are relaxed apart a fraction of their overlap per pass,
with an immobile agent (the player) absorbing none of its share. Coincident
agents get an index-derived escape direction so a stacked spawn cannot divide
by zero and cannot jitter. minPairDistance is the verification oracle.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `brain.ts` — notice, chase, swing

**Files:**
- Create: `src/lab/sdf-zombie/brain.ts`
- Test: `src/lab/sdf-zombie/brain.test.ts`

Read first: `src/lab/sdf-zombie/wander.ts` lines 70-80 — the heading convention (`0 = facing +z`, positive clockwise from above, `headingDir(h) = [sin h, 0, cos h]`) and `wrapPi`. The bearing to a point is therefore `Math.atan2(dx, dz)`, NOT the usual `atan2(dz, dx)`.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/brain.test.ts`:

```ts
// src/lab/sdf-zombie/brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  BRAIN_TUNING, makeBrainState, stepBrain,
  type BrainInput, type BrainState,
} from './brain';

const DT = 1 / 60;

function input(over: Partial<BrainInput> = {}): BrainInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: 4, room: 3 },          // straight ahead, 4 m
    alerted: false,
    ...over,
  };
}

/** Runs the brain for `seconds`, returning the last output. */
function run(state: BrainState, over: Partial<BrainInput>, seconds: number) {
  let s = state;
  let out = stepBrain(s, input(over));
  for (let t = 0; t < seconds; t += DT) {
    out = stepBrain(s, input(over));
    s = out.state;
  }
  return out;
}

describe('stepBrain — noticing', () => {
  it('notices a player in front, in the same room, in range', () => {
    const out = stepBrain(makeBrainState(), input());
    expect(out.state.alert).toBe(true);
    expect(out.state.mode).toBe('chase');
  });

  it('does not notice a player behind it', () => {
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: -4, room: 3 } }));
    expect(out.state.alert).toBe(false);
    expect(out.state.mode).toBe('wander');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: 4, room: 2 } }));
    expect(out.state.alert).toBe(false);
  });

  it('does not notice a player past noticeRange', () => {
    const far = BRAIN_TUNING.noticeRange + 1;
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: far, room: 3 } }));
    expect(out.state.alert).toBe(false);
  });

  it('a shot in the room turns heads regardless of the cone', () => {
    const out = stepBrain(
      makeBrainState(),
      input({ player: { x: 0, z: -4, room: 3 }, alerted: true }),
    );
    expect(out.state.alert).toBe(true);
  });
});

describe('stepBrain — the lock', () => {
  it('keeps chasing while the player is briefly out of the room', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace - 0.5);
    expect(out.state.alert).toBe(true);
  });

  it('gives up once the player has been gone past the grace', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.state.alert).toBe(false);
    expect(out.state.mode).toBe('wander');
    expect(out.target).toBeNull();
  });

  it('a null player (tunnel / void) also counts as gone', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: null }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.state.alert).toBe(false);
  });
});

describe('stepBrain — the standoff target', () => {
  it('aims at a point attackRange from the player, on the zombie side', () => {
    const out = stepBrain(makeBrainState(), input());
    const t = out.target!;
    expect(t).not.toBeNull();
    // Player at (0, 4), zombie at (0, 0): the standoff sits between them.
    expect(Math.hypot(t[0] - 0, t[2] - 4)).toBeCloseTo(BRAIN_TUNING.attackRange, 6);
    expect(t[2]).toBeLessThan(4);
    expect(t[1]).toBe(0);
  });

  it('falls back to its own facing when standing exactly on the player', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = stepBrain(alert, input({
      self: { x: 2, z: 2, yaw: 0, room: 3 },
      player: { x: 2, z: 2, room: 3 },
    }));
    const t = out.target!;
    expect(Number.isFinite(t[0])).toBe(true);
    expect(Math.hypot(t[0] - 2, t[2] - 2)).toBeCloseTo(BRAIN_TUNING.attackRange, 6);
  });
});

describe('stepBrain — the swing', () => {
  const close = { player: { x: 0, z: 0.8, room: 3 } };

  it('halts and swings once inside attackRange', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = stepBrain(alert, input(close));
    expect(out.halt).toBe(true);
    expect(out.state.mode).toBe('attack');
    expect(out.attack).not.toBeNull();
  });

  it('runs the swing over swingSec and then cools down', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close));
    s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(s.mode).not.toBe('attack');
    expect(s.cooldown).toBeGreaterThan(0);
  });

  it('finishes a swing already in flight after the player retreats', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    s = stepBrain(s, input(close)).state;         // committed
    const out = stepBrain(s, input({ player: { x: 0, z: 6, room: 3 } }));
    expect(out.state.mode).toBe('attack');
    expect(out.attack).not.toBeNull();
  });

  it('gates the second swing behind cooldownSec', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close)); s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(s.mode).not.toBe('attack');
    // Half the cooldown later it must still not have started another.
    for (let t = 0; t < BRAIN_TUNING.cooldownSec / 2; t += DT) {
      out = stepBrain(s, input(close)); s = out.state;
    }
    expect(s.mode).not.toBe('attack');
    // Past the cooldown it swings again.
    for (let t = 0; t < BRAIN_TUNING.cooldownSec; t += DT) {
      out = stepBrain(s, input(close)); s = out.state;
      if (s.mode === 'attack') break;
    }
    expect(s.mode).toBe('attack');
  });

  it('holds position through the cooldown instead of walking into the player', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close)); s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(out.halt).toBe(true);   // engaged latch keeps it halted
  });

  it('releases the halt only past releaseRange (hysteresis)', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    s = stepBrain(s, input(close)).state;
    // Just past attackRange but inside releaseRange: still engaged.
    const mid = (BRAIN_TUNING.attackRange + BRAIN_TUNING.releaseRange) / 2;
    let out = stepBrain(s, input({ player: { x: 0, z: mid, room: 3 } }));
    expect(out.state.engaged).toBe(true);
    // Past releaseRange: released, and walking again.
    out = stepBrain(out.state, input({ player: { x: 0, z: BRAIN_TUNING.releaseRange + 0.3, room: 3 } }));
    expect(out.state.engaged).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: FAIL — `Failed to resolve import "./brain"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/brain.ts`:

```ts
// src/lab/sdf-zombie/brain.ts
//
// One zombie's decision layer: wander until it notices the player, then walk
// at him and swing when it gets there. Pure — no clock, no RNG, no THREE —
// so the whole behaviour is unit-testable against hand-worked geometry.
//
// IT DOES NOT DRIVE LOCOMOTION. There is exactly one walker in this codebase
// (wander.ts, through motion.ts) and adding a second would mean two sets of
// turn rates, accelerations and gait blends drifting apart. Instead the brain
// emits a STANDOFF TARGET — a point `attackRange` from the player, on the
// zombie's side — and the actor writes it into wander.target. A chasing
// zombie is the same shamble, aimed.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is therefore atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY. stepWander clamps every body to its own room's
// bounds, so a chaser stops at the doorway and will not follow through a
// tunnel. Lifting that clamp without navigation walks bodies into walls; see
// the spec's "Accepted limitation".
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type BrainMode = 'wander' | 'chase' | 'attack';

export interface BrainState {
  mode: BrainMode;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Melee hysteresis latch: set at attackRange, cleared past releaseRange.
   *  Without it a body hovering at exactly attackRange flickers between
   *  walking and halting every frame. */
  engaged: boolean;
  /** Swing progress 0..1 while mode === 'attack', else 0. */
  swingT: number;
  /** Seconds until another swing may start. */
  cooldown: number;
}

export interface BrainSelf { x: number; z: number; yaw: number; room: number }
export interface BrainPlayer { x: number; z: number; room: number }

export interface BrainInput {
  dt: number;
  self: BrainSelf;
  /** null when the player is somewhere with no room id (a tunnel, the void). */
  player: BrainPlayer | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
}

export interface BrainOutput {
  state: BrainState;
  /** Wander-target override (world ground point); null = leave the wander alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** Swing phase 0..1, or null when not swinging. */
  attack: number | null;
}

export const BRAIN_TUNING = {
  /** Beyond this the player goes unnoticed (m). */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad) — the player must be roughly ahead. */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Halt-and-swing distance (m). */
  attackRange: 1.0,
  /** Walk again past this distance — hysteresis against attackRange (m). */
  releaseRange: 1.6,
  /** One swing, wind-up through recovery (s). */
  swingSec: 0.7,
  /** Gap before the next swing may start (s). */
  cooldownSec: 1.1,
} as const;

export type BrainTuning = typeof BRAIN_TUNING;

export function makeBrainState(): BrainState {
  return { mode: 'wander', lostFor: 0, alert: false, engaged: false, swingT: 0, cooldown: 0 };
}

/** The point `range` metres from the player along the player→zombie
 *  direction. Standing exactly on the player is degenerate: back off along
 *  the zombie's own facing instead of dividing by zero. */
function standoffPoint(self: BrainSelf, player: BrainPlayer, range: number): Vec3 {
  const dx = self.x - player.x;
  const dz = self.z - player.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    return [player.x + Math.sin(self.yaw) * range, 0, player.z + Math.cos(self.yaw) * range];
  }
  return [player.x + (dx / d) * range, 0, player.z + (dz / d) * range];
}

export function stepBrain(
  state: BrainState,
  input: BrainInput,
  tuning: BrainTuning = BRAIN_TUNING,
): BrainOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { mode, lostFor, alert, engaged, swingT, cooldown } = state;
  cooldown = Math.max(0, cooldown - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock ---------------------------------------------------
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) {
    alert = false;
    engaged = false;
  }

  // --- a swing already in flight ALWAYS finishes ---------------------------
  // An attack that can be cancelled mid-frame reads weightless — the same
  // reasoning behind game-actor's BLAST_HOLD_SEC.
  if (mode === 'attack') {
    swingT = tuning.swingSec > 0 ? Math.min(1, swingT + dt / tuning.swingSec) : 1;
    if (swingT >= 1) {
      swingT = 0;
      cooldown = tuning.cooldownSec;
      mode = alert ? 'chase' : 'wander';
    } else {
      return {
        state: { mode, lostFor, alert, engaged, swingT, cooldown },
        target: alert && player ? standoffPoint(self, player, tuning.attackRange) : null,
        halt: true,
        attack: swingT,
      };
    }
  }

  // --- calm ----------------------------------------------------------------
  if (!alert || !player) {
    return {
      state: { mode: 'wander', lostFor, alert, engaged: false, swingT: 0, cooldown },
      target: null,
      halt: false,
      attack: null,
    };
  }

  // --- the melee latch -----------------------------------------------------
  if (dist <= tuning.attackRange) engaged = true;
  else if (dist > tuning.releaseRange) engaged = false;

  const target = standoffPoint(self, player, tuning.attackRange);

  if (engaged && cooldown <= 0) {
    return {
      state: { mode: 'attack', lostFor, alert, engaged, swingT: 0, cooldown },
      target,
      halt: true,
      attack: 0,
    };
  }
  return {
    state: { mode: 'chase', lostFor, alert, engaged, swingT: 0, cooldown },
    target,
    // Engaged but cooling down: stand at range rather than shuffling into him.
    halt: engaged,
    attack: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/brain.ts src/lab/sdf-zombie/brain.test.ts
git commit -m "brain: notice / chase / swing state machine for one zombie

Aggro is same-room plus a facing cone (a gunshot bypasses the cone), and it
locks on with a grace period so stepping into a tunnel does not reset the
pack. Chase does not add a second walker: it emits a standoff target the
existing wander walks to, so the turn damping, acceleration and gait blend
all still apply. A committed swing always finishes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `attack.ts` — the swing pose

**Files:**
- Create: `src/lab/sdf-zombie/attack.ts`
- Test: `src/lab/sdf-zombie/attack.test.ts`

Read first: `src/lab/sdf-zombie/stagger.ts` lines 15-30 and 250-295 — the offsets contract this file copies (body-local metres, added onto gait's offsets, missing keys mean zero, `rootOffset` applies to the pelvis).

Body-local axes: `+z` is forward (the body faces `+z`; see `headingDir`), `+y` is up, `+x` is the body's right.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/attack.test.ts`:

```ts
// src/lab/sdf-zombie/attack.test.ts
import { describe, it, expect } from 'vitest';
import { ATTACK_TUNING, attackDrive, attackPose } from './attack';

describe('attackDrive', () => {
  it('is zero at both ends of the swing', () => {
    expect(attackDrive(0)).toBe(0);
    expect(attackDrive(1)).toBe(0);
  });

  it('winds up backwards before driving forwards', () => {
    expect(attackDrive(ATTACK_TUNING.windupEnd * 0.9)).toBeLessThan(0);
    expect(attackDrive((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2)).toBe(1);
  });

  it('is continuous across the beat boundaries', () => {
    const eps = 1e-4;
    for (const b of [ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, ATTACK_TUNING.holdEnd]) {
      expect(Math.abs(attackDrive(b + eps) - attackDrive(b - eps))).toBeLessThan(1e-2);
    }
  });

  it('never leaves [-1, 1]', () => {
    for (let p = 0; p <= 1; p += 0.005) {
      expect(attackDrive(p)).toBeGreaterThanOrEqual(-1);
      expect(attackDrive(p)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range phases instead of extrapolating', () => {
    expect(attackDrive(-3)).toBe(0);
    expect(attackDrive(7)).toBe(0);
  });
});

describe('attackPose', () => {
  it('is exactly zero at phase 0 and phase 1', () => {
    for (const p of [0, 1]) {
      const pose = attackPose(p);
      expect(pose.rootOffset).toEqual([0, 0, 0]);
      expect(pose.reachPitch).toBe(0);
      for (const v of Object.values(pose.offsets)) expect(v).toEqual([0, 0, 0]);
    }
  });

  it('drives the root forward at the strike peak', () => {
    const peak = attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2);
    expect(peak.rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
    expect(peak.rootOffset[0]).toBe(0);
  });

  it('pulls the root back during the wind-up', () => {
    const wind = attackPose(ATTACK_TUNING.windupEnd);
    expect(wind.rootOffset[2]).toBeCloseTo(-ATTACK_TUNING.windback, 6);
  });

  it('swings the arms back then forward', () => {
    expect(attackPose(ATTACK_TUNING.windupEnd).reachPitch)
      .toBeCloseTo(-ATTACK_TUNING.pitchWindup, 6);
    expect(attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).reachPitch)
      .toBeCloseTo(ATTACK_TUNING.pitchStrike, 6);
  });

  it('drops the hands only on the forward half', () => {
    expect(attackPose(ATTACK_TUNING.windupEnd).offsets.handL![1]).toBe(0);
    expect(attackPose((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).offsets.handL![1])
      .toBeCloseTo(-ATTACK_TUNING.handDrop, 6);
  });

  it('carries the head at a share of the chest, both arms symmetric', () => {
    const p = attackPose(0.55);
    expect(p.offsets.head![2]).toBeCloseTo(p.offsets.chest![2] * ATTACK_TUNING.headShare, 6);
    expect(p.offsets.handL).toEqual(p.offsets.handR);
  });

  it('is finite across a full sweep', () => {
    for (let p = -0.5; p <= 1.5; p += 0.01) {
      const pose = attackPose(p);
      for (const v of [pose.rootOffset, ...Object.values(pose.offsets)]) {
        expect(v!.every(Number.isFinite)).toBe(true);
      }
      expect(Number.isFinite(pose.reachPitch)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: FAIL — `Failed to resolve import "./attack"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/attack.ts`:

```ts
// src/lab/sdf-zombie/attack.ts
//
// The melee swing pose. Phase 0..1 in, body-local joint offsets out — the
// same contract stagger.ts emits (metres, body-local, ADDED onto gait's
// offsets, missing keys mean zero, rootOffset applies to the pelvis), so
// motion.ts composes it exactly where it composes a stagger.
//
// FOUR BEATS ON ONE SCALAR. Wind-up (weight and arms back), strike (the root
// drives forward and the arms come down and across), a short hold at contact,
// then recovery to zero. Every offset is that one signed `drive` scalar times
// a magnitude, which is what keeps the beats in step: there is no way for the
// arms to peak on a different frame from the lunge.
//
// Phase 0 and phase 1 are EXACTLY zero, so the pose enters and leaves the
// gait without a step discontinuity.
//
// Axes are body-local: +z forward (the body faces +z, see wander.headingDir),
// +y up, +x the body's right.
import type { Vec3 } from './types';
import type { GaitJointName } from './gait';

export const ATTACK_TUNING = {
  /** Beat boundaries as fractions of the swing. */
  windupEnd: 0.25,
  strikeEnd: 0.5,
  holdEnd: 0.6,
  /** Root drive forward at the strike peak (m). */
  lunge: 0.22,
  /** Root pull-back at the wind-up peak (m, magnitude). */
  windback: 0.08,
  /** Chest drive forward at the strike peak (m). */
  chestDrive: 0.12,
  /** Chest lean back at the wind-up peak (m, magnitude). */
  chestRear: 0.06,
  /** Neck/head carry this share of the chest offset. */
  headShare: 0.7,
  /** Reach-style arm pitch at the wind-up peak (rad, magnitude — the sign
   *  comes from the drive scalar, so the arms go BACK). */
  pitchWindup: 0.55,
  /** Reach-style arm pitch at the strike peak (rad, forward/down). */
  pitchStrike: 0.95,
  /** Extra hand drop on the forward half (m). */
  handDrop: 0.14,
} as const;

export type AttackTuning = typeof ATTACK_TUNING;

export interface AttackPose {
  /** Body-local per-joint offsets — ADD to gait's offsets; missing = zero. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  /** Body-local pelvis offset — ADD to gait's rootOffset. */
  rootOffset: Vec3;
  /** Added to the reach-style arm pitch (rad) before the shoulder pivot. */
  reachPitch: number;
}

const ZERO: Vec3 = [0, 0, 0];

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The swing's one signed scalar: 0 at rest, down to -1 at the wind-up peak,
 * up to +1 through the strike and hold, back to 0 by the end of the recovery.
 * Phases outside [0, 1] clamp to 0 — a caller feeding a stale phase gets the
 * rest pose, never an extrapolated one.
 */
export function attackDrive(phase: number, tuning: AttackTuning = ATTACK_TUNING): number {
  if (!(phase > 0) || phase >= 1) return 0;
  const T = tuning;
  if (phase < T.windupEnd) return -smooth(phase / T.windupEnd);
  if (phase < T.strikeEnd) {
    return -1 + 2 * smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd));
  }
  if (phase < T.holdEnd) return 1;
  return 1 - smooth((phase - T.holdEnd) / (1 - T.holdEnd));
}

/** The swing pose at `phase`. See the header for the contract. */
export function attackPose(phase: number, tuning: AttackTuning = ATTACK_TUNING): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  if (d === 0) {
    return {
      offsets: { chest: ZERO, neck: ZERO, head: ZERO, handL: ZERO, handR: ZERO },
      rootOffset: ZERO,
      reachPitch: 0,
    };
  }
  const fwd = d >= 0;
  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
  const handY = fwd ? -d * T.handDrop : 0;
  const hand: Vec3 = [0, handY, chestZ];
  return {
    offsets: {
      chest: [0, 0, chestZ],
      neck: [0, 0, headZ],
      head: [0, 0, headZ],
      handL: hand,
      handR: hand,
    },
    rootOffset: [0, 0, rootZ],
    reachPitch: fwd ? d * T.pitchStrike : d * T.pitchWindup,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/attack.ts src/lab/sdf-zombie/attack.test.ts
git commit -m "attack: the melee swing pose

Wind-up, strike, contact hold and recovery driven off one signed scalar, so
the lunge and the arms cannot peak on different frames. Emits stagger.ts's
offsets contract (body-local metres, added onto gait), exactly zero at phase
0 and phase 1 so it enters and leaves the gait without a discontinuity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: the `motion.ts` seam, with the lab pinned bit-identical

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts` (the `MotionConfig` interface; the `stepMotion` target assembly; the reach-style arm pivot)
- Modify: `src/lab/sdf-zombie/motion.test.ts`

**The rule this task exists to keep:** `webgpu/lab-main.ts` never sets `cfg.attack`, and the lab's motion must stay byte-for-byte what it is today. That is why the composition below BRANCHES rather than adding a zero — `x + 0` turns `-0` into `+0`, and a pin that compares poses exactly would then be comparing something that changed.

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/motion.test.ts` (keep the file's existing imports; add `attackPose` / `ATTACK_TUNING` to the import list from `./attack` and make sure `MotionConfig` is imported from `./motion`):

```ts
describe('stepMotion — the attack seam', () => {
  /** Runs a fixed seed for `frames` and returns every rest pose. */
  function poses(cfg: MotionConfig, frames: number) {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    let state = makeMotionState(4242, [0, 0, 0]);
    const rng = makeRng(4242);
    const bounds = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    const out: Vec3[][] = [];
    for (let i = 0; i < frames; i++) {
      const r = stepMotion(state, joints, cfg, CALM_SIGNALS, bound.rig.points, bounds, rng);
      state = r.state;
      out.push(r.frame.restPose.map(p => [...p] as Vec3));
    }
    return out;
  }

  it('is bit-identical to today when cfg.attack is absent', () => {
    // The lab's wiring never sets `attack`. An object that merely CARRIES the
    // key as undefined must be indistinguishable from one that does not.
    const a = poses({ enabled: true, wander: true }, 30);
    const b = poses({ enabled: true, wander: true, attack: undefined }, 30);
    expect(b).toEqual(a);
  });

  it('moves the pose once cfg.attack is set', () => {
    const calm = poses({ enabled: true, wander: true }, 1);
    const swung = poses({ enabled: true, wander: true, attack: 0.55 }, 1);
    expect(swung).not.toEqual(calm);
  });

  it('phase 0 leaves the pose exactly where no attack leaves it', () => {
    // attackPose(0) is exactly zero, so the composed result must match.
    const calm = poses({ enabled: true, wander: true }, 5);
    const zero = poses({ enabled: true, wander: true, attack: 0 }, 5);
    expect(zero).toEqual(calm);
  });

  it('drives the pelvis forward at the strike peak', () => {
    const peak = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;
    const calm = poses({ enabled: true, wander: false }, 1)[0]!;
    const swung = poses({ enabled: true, wander: false, attack: peak }, 1)[0]!;
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    const iPelvis = joints.index.pelvis!;
    const moved = Math.hypot(
      swung[iPelvis]![0] - calm[iPelvis]![0],
      swung[iPelvis]![2] - calm[iPelvis]![2],
    );
    expect(moved).toBeCloseTo(attackPose(peak).rootOffset[2], 6);
  });
});
```

If `motion.test.ts` has no `CALM_SIGNALS` helper, add one near the top of the file:

```ts
const CALM_SIGNALS = {
  dt: 1 / 60,
  shot: null,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
} as const;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts -t "attack seam"`
Expected: FAIL — TypeScript/vitest rejects `attack` on `MotionConfig` ("Object literal may only specify known properties").

- [ ] **Step 3: Add the config field**

In `src/lab/sdf-zombie/motion.ts`, inside `export interface MotionConfig`, after the `gazeFollow?: number;` member, add:

```ts
  /** Melee swing phase 0..1 — the actor's brain drives it (webgpu/brain.ts
   *  via game-actor). UNDEFINED IS NOT "0": undefined skips the composition
   *  branch entirely, so the lab's wiring — which never sets this — produces
   *  bit-identical motion. attack.ts's pose is exactly zero at phase 0 and 1,
   *  so setting either is also a no-op, just a slower one. */
  attack?: number;
```

- [ ] **Step 4: Import the pose and evaluate it once per frame**

In `src/lab/sdf-zombie/motion.ts`, add to the imports:

```ts
import { attackPose, type AttackPose } from './attack';
```

Then, in `stepMotion`, immediately after the block that computes `gait` (the `const gait = stepGait(...)` call, just before the `// --- assemble the standing rest targets ---` banner), add:

```ts
  // The melee swing, if the brain is driving one. Composed exactly where a
  // stagger composes — see attack.ts's header. A collapsed body never swings.
  const attack: AttackPose | null =
    cfg.attack !== undefined && !collapsed ? attackPose(cfg.attack) : null;
```

- [ ] **Step 5: Compose it into the targets**

In the `const targets: Vec3[] = joints.base.map((base, i) => {` callback, replace this line:

```ts
    const local = add(scale(gaitOff, s), stagOff);
```

with:

```ts
    // BRANCHED, not `add(..., ZERO)`: adding zero would turn a -0 component
    // into +0 and break the lab's bit-identity pin for no benefit.
    const base2 = add(scale(gaitOff, s), stagOff);
    const local = attack
      ? add(base2, name === 'pelvis' ? attack.rootOffset : attack.offsets[name] ?? Z)
      : base2;
```

- [ ] **Step 6: Compose the arm pitch**

In the `if (armStyle === 'reach' && gait.pose.reach) {` block, inside `applyArm`, replace:

```ts
      const pitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
```

with:

```ts
      const basePitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
      const pitch = attack ? basePitch + attack.reachPitch : basePitch;
```

- [ ] **Step 7: Run the whole motion suite**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts`
Expected: PASS, including the four new tests and every pre-existing one.

- [ ] **Step 8: Run the full suite — the lab must not have moved**

Run: `npx vitest run`
Expected: PASS. Every gait/rig/lab test that existed before this task must still pass unchanged. If any fail, the composition is not actually inert without `cfg.attack` — fix that rather than editing the failing test.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts
git commit -m "motion: optional attack phase, composed beside the stagger

MotionConfig gains one optional field. It BRANCHES rather than adding a zero
vector, so a config without it takes the identical code path it takes today
and the lab's motion is unchanged -- pinned by a test that compares 30 frames
of rest poses exactly, not by a comment claiming it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: wire the brain into `game-actor.ts`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/game-actor.test.ts` (reuse whatever `makeActor`/stub-view helper the file already defines; if it builds actors inline, follow that pattern verbatim — the point is a real `createZombieActor`, not a stub):

```ts
describe('createZombieActor — the brain and the crowd', () => {
  it('wanders when no player has been supplied', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.step(1 / 60);
    expect(a.brain().mode).toBe('wander');
    expect(a.brain().alert).toBe(false);
  });

  it('notices a player in front and walks toward him', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    // Face +z (the authored facing) and put the player straight ahead.
    a.setBrainInput({ x: 0, z: 3, room: 3 }, false);
    a.step(1 / 60);
    expect(a.brain().alert).toBe(true);
    const before = a.pose().pos;
    // Two seconds: the body has to finish its damped turn (headingFollowRate
    // 1.7 rad/s) before it can accelerate, so one second is not enough margin.
    for (let i = 0; i < 120; i++) {
      a.setBrainInput({ x: 0, z: 3, room: 3 }, false);
      a.step(1 / 60);
    }
    const after = a.pose().pos;
    expect(after[2]).toBeGreaterThan(before[2]);   // closed the distance
  });

  it('a shot in the room alerts it even from behind', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput({ x: 0, z: -3, room: 3 }, true);
    a.step(1 / 60);
    expect(a.brain().alert).toBe(true);
  });

  it('nudge moves the body on the ground plane', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    const before = a.pose().pos;
    a.nudge(0.1, -0.2);
    const after = a.pose().pos;
    expect(after[0]).toBeCloseTo(before[0] + 0.1, 9);
    expect(after[2]).toBeCloseTo(before[2] - 0.2, 9);
  });

  it('nudge stays inside the wander bounds', () => {
    const a = makeTestActor({ start: [0, 0, 0], bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });
    a.nudge(50, 50);
    const p = a.pose().pos;
    expect(p[0]).toBeLessThanOrEqual(1);
    expect(p[2]).toBeLessThanOrEqual(1);
  });

  it('nudge refuses to push the body into furniture', () => {
    const a = makeTestActor({
      start: [0, 0, 0],
      furniture: [{ min: [0.4, 0, -1], max: [2, 2, 1] }],
    });
    const before = a.pose().pos;
    a.nudge(0.5, 0);        // straight into the crate + its margin
    expect(a.pose().pos).toEqual(before);
  });

  it('reports the swing through debug()', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    for (let i = 0; i < 8; i++) {
      a.setBrainInput({ x: 0, z: 0.5, room: 3 }, true);
      a.step(1 / 60);
    }
    expect(a.debug().mode).toBe('attack');
    expect(a.debug().swingT).toBeGreaterThan(0);
  });
});
```

If the test file has no `makeTestActor`, add one that mirrors how the existing tests build an actor, defaulting `room: 1`, `seed: 7`, `bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }`, `furniture: []`, and taking overrides:

```ts
function makeTestActor(over: Partial<Parameters<typeof createZombieActor>[0]> = {}) {
  const body = buildBody(makeZombie());
  return createZombieActor({
    id: 1, room: 1, body, view: makeStubView(), start: [0, 0, 0], seed: 7,
    bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [],
    ...over,
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts -t "brain and the crowd"`
Expected: FAIL — `a.setBrainInput is not a function`.

- [ ] **Step 3: Add the imports and state**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, add to the imports:

```ts
import {
  makeBrainState, stepBrain, type BrainPlayer, type BrainState,
} from '../brain';
```

Inside `createZombieActor`, next to the `let holdSecs = 0;` block, add:

```ts
  // ---- brain state --------------------------------------------------------
  // The decision layer (brain.ts) runs INSIDE the sub-step loop so a chase
  // target is refreshed at the same cadence the locomotion integrates at.
  // Its target overrides wander.target; its halt joins the blast hold in the
  // single cfg.wander gate; its swing phase becomes cfg.attack.
  let brain: BrainState = makeBrainState();
  let brainPlayer: BrainPlayer | null = null;
  let brainAlerted = false;
```

- [ ] **Step 4: Run the brain inside `step()`**

In `function step(dt: number)`, inside the `for (const sdt of planSubSteps(dt))` loop, immediately BEFORE the line `const prevPos: Vec3 = [...state.wander.pos] as Vec3;`, insert:

```ts
      // Decide before locomotion integrates, so the target this sub-step walks
      // toward is this sub-step's target.
      const think = stepBrain(brain, {
        dt: sdt,
        self: {
          x: state.wander.pos[0], z: state.wander.pos[2],
          yaw: bodyYaw, room: opts.room,
        },
        player: brainPlayer,
        alerted: brainAlerted,
      });
      brain = think.state;
      brainAlerted = false;   // one-shot: the first sub-step consumes it
      if (think.target) {
        // idle 0 as well: a chaser must never take a wander pause mid-pursuit.
        state = {
          ...state,
          wander: { ...state.wander, target: think.target, idle: 0 },
        };
      }
```

Then replace the `stepMotion` config argument. Find:

```ts
        { enabled: true, wander: holdSecs <= 0 },
```

and replace it with:

```ts
        {
          enabled: true,
          // The blast hold and the melee halt are the same gate.
          wander: holdSecs <= 0 && !think.halt,
          // Spread, not `attack: think.attack ?? undefined`: motion.ts's
          // bit-identity contract is about the key being ABSENT.
          ...(think.attack !== null ? { attack: think.attack } : {}),
        },
```

- [ ] **Step 5: Add `nudge`, `setBrainInput` and `brain` to the returned object**

Still inside `createZombieActor`, above the `return {` statement, add:

```ts
  /** Ground-plane displacement from crowd separation, clamped exactly like a
   *  wander step: room bounds, then the furniture rejection. Separation must
   *  never be able to push a body into a crate or through a wall. */
  function nudge(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    const w = state.wander;
    const next: Vec3 = [
      Math.min(Math.max(w.pos[0] + dx, opts.bounds.minX), opts.bounds.maxX),
      0,
      Math.min(Math.max(w.pos[2] + dz, opts.bounds.minZ), opts.bounds.maxZ),
    ];
    if (insideFurniture(next)) return;
    state = { ...state, wander: { ...w, pos: next } };
  }
```

In the returned object literal, after `pose: () => ({ ... }),` add:

```ts
    nudge,
    setBrainInput: (p: BrainPlayer | null, alerted: boolean) => {
      brainPlayer = p;
      // Sticky until a step consumes it: the shot may land between frames.
      if (alerted) brainAlerted = true;
    },
    brain: () => brain,
```

- [ ] **Step 6: Extend the `ZombieActor` interface and `debug()`**

In `export interface ZombieActor`, after the `pose()` member, add:

```ts
  /** Ground-plane shove from crowd separation (crowd.ts), bounds- and
   *  furniture-clamped. */
  nudge(dx: number, dz: number): void;
  /** The per-frame brain input from game-main: where the player is (null when
   *  he is in a tunnel or the void) and whether a shot just went off in this
   *  actor's room. Set BEFORE step(). */
  setBrainInput(player: BrainPlayer | null, alerted: boolean): void;
  /** Live brain state — the debug seam and the capture driver's oracle. */
  brain(): BrainState;
```

In the same interface, extend the `debug()` return type with:

```ts
    mode: string;
    alert: boolean;
    swingT: number;
```

and in `step()`'s `lastDebug` assignment add the three fields:

```ts
      mode: brain.mode,
      alert: brain.alert,
      swingT: brain.swingT,
```

and in the fallback object inside the returned `debug: () => lastDebug ?? { ... }`, add:

```ts
      mode: brain.mode, alert: brain.alert, swingT: brain.swingT,
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts`
Expected: PASS, including the seven new tests and every existing one.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor.test.ts
git commit -m "game-actor: run the brain, accept a crowd nudge

The brain steps inside the sub-step loop so a chase target is refreshed at
the cadence locomotion integrates at; its halt joins the existing blast hold
in one cfg.wander gate, so a slug still stops and stumbles a chaser before it
resumes. nudge() re-applies the room clamp and the furniture rejection, so
separation cannot shove a body into a crate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: wire the crowd and the player into `game-main.ts`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

This file is 3,963 lines and has no test — the tests live in the pure modules it wires. Make the edits surgical and typecheck after each.

- [ ] **Step 1: Add the imports**

Add near the existing `import { createZombieActor, type ZombieActor } from './game-actor';`:

```ts
import { separate, minPairDistance, type CrowdAgent } from '../crowd';
```

`ROOMS` and `enclosureKeyAt` are already in the `./game-level` import block at `game-main.ts:57-61` — nothing to add there.

- [ ] **Step 2: Add the room lookup and the shot-alert flag**

Just above the `const player: PlayerState = {` declaration, add:

```ts
  /** Ground radius the crowd separates zombies at — the same 0.35 m the
   *  player's soft-obstacle boxes already use, so the two agree. */
  const ZOMBIE_RADIUS = 0.35;
  const ROOM_ID_BY_NAME = new Map(ROOMS.map(r => [r.name, r.id] as const));
  /** The player's room id, or -1 in a tunnel / the void. Zombies only notice
   *  a player who shares their room. */
  function playerRoomId(): number {
    return ROOM_ID_BY_NAME.get(enclosureKeyAt(player.pos[0], player.pos[2])) ?? -1;
  }
  /** Set when the weapon fires; consumed by the next tick to turn heads in
   *  the player's room. Sticky rather than instantaneous because a shot lands
   *  in an event handler, not in the frame callback. */
  let shotAlert = false;
```

- [ ] **Step 3: Raise the flag when the gun fires**

In `function fire(barrels: 1 | 2): boolean` (`game-main.ts:1653`), after the four
guards that can still reject the shot and immediately before
`cooldown = GRAPESHOT.fireCooldownSec;`, add:

```ts
    // Gunfire in a room turns every head in it, cone or no cone. Placed after
    // the guards on purpose: a dry click or a shot during a reload must not
    // alert anything, or the flag fires on inputs that made no noise.
    shotAlert = true;
```

- [ ] **Step 4: Feed the brains and separate the crowd**

In the frame tick, inside the `if (!wanderFrozen) {` block, immediately BEFORE the line `for (const a of actors) a.step(dt);`, insert:

```ts
      // --- brain input + crowd separation, BEFORE the actors step ----------
      // Order matters: separating first means this frame's step() and its
      // view.update() render the corrected positions, so a resolved overlap
      // is never a frame late on screen.
      const pRoom = playerRoomId();
      const pInfo = pRoom > 0
        ? { x: player.pos[0], z: player.pos[2], room: pRoom }
        : null;
      const alertRoom = shotAlert ? pRoom : -1;
      shotAlert = false;
      for (const a of actors) a.setBrainInput(pInfo, a.room === alertRoom);

      const agents: CrowdAgent[] = actors.map(a => {
        const p = a.pose().pos;
        return { x: p[0], z: p[2], r: ZOMBIE_RADIUS, mobile: true };
      });
      // The player is an ANCHOR: zombies slide off him rather than shove him.
      // His own capsule already resolves against the per-frame zombie boxes
      // above (stepPlayer), which is the other half of the same contact.
      agents.push({ x: player.pos[0], z: player.pos[2], r: PLAYER.radius, mobile: false });
      const push = separate(agents);
      actors.forEach((a, i) => a.nudge(push[i]![0], push[i]![1]));
```

- [ ] **Step 5: Add the debug seams**

In the `(window as unknown as { __sdfGame: unknown }).__sdfGame = {` object literal, add:

```ts
    /** Per-actor brain readout — the crowd/AI capture driver's oracle. */
    brains: () => actors.map(a => {
      const b = a.brain();
      const p = a.pose().pos;
      return {
        id: a.id, room: a.room, mode: b.mode, alert: b.alert,
        engaged: b.engaged, swingT: b.swingT,
        dist: Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]),
      };
    }),
    /** Smallest centre-to-centre distance between any two zombies (m).
     *  Two 0.35 m bodies touch at 0.70; below that they are interpenetrating. */
    crowdMinDist: () => minPairDistance(actors.map(a => {
      const p = a.pose().pos;
      return { x: p[0], z: p[2], r: ZOMBIE_RADIUS, mobile: true };
    })),
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 8: Boot the page and check the console is clean**

```bash
. scripts/lab-servers.sh && trap lab_servers_down EXIT && lab_servers_up && \
  node -e "console.log('servers up on', process.env.LAB_VITE_PORT, process.env.LAB_CDP_PORT)"
```

Then open `http://localhost:$LAB_VITE_PORT/sdf-game.html`. Expected: the page boots, `__sdfGame.backend === 'webgpu'`, `__sdfGame.brains()` returns ten rows, and there are no console errors. (Task 7's gate automates this; do it by hand once here so a wiring mistake is caught before the gate is written.)

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: feed the brains, separate the crowd

Brain input and separation run BEFORE the actor step loop, so this frame's
view.update renders the corrected positions and a resolved overlap is never a
frame late. The player enters the crowd as an immobile anchor -- his own
capsule already resolves against the zombie boxes, which is the other half of
the same contact. New seams: brains() and crowdMinDist().

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: on-screen verification

Unit tests are not evidence that zombies stopped overlapping on screen. This task produces the frames and the number.

**Files:**
- Create: `scripts/sdf-game-crowd-gate.mjs`
- Create: `docs/dev-notes/2026-09-04-zombie-crowd/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Write the gate script**

Create `scripts/sdf-game-crowd-gate.mjs`. Copy the CDP plumbing verbatim from `scripts/sdf-game-shorty-gate.mjs` lines 12-104 (the tab open, `send`/`evaluate`/`withTimeout`, `shot`, `Page.enable`/`Runtime.enable`, the device metrics override, the navigate, and the `__sdfGame` boot poll) — that file OWNS this plumbing and it must not fork. Change only `OUT` to `/tmp/sdf-game-crowd`, then append the checks below.

```js
// --- 1. THE CROWD. Room 4 holds four bodies in an 8x8 m interior: the worst
//     clumping case in the level, and the reason this gate exists.
await evaluate('typeof __sdfGame.woundPanel === "function" ? (__sdfGame.woundPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.gooPanel === "function" ? (__sdfGame.gooPanel(false), 1) : 0');
await evaluate('__sdfGame.setLoopRunning(false)');

// Stand in room 4's doorway looking in. Step once so the pose is staged.
await evaluate('__sdfGame.setPose(-4.8, 2.0, 0, 0)');
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-enter');

// setPose's 5th argument is an eye HEIGHT, so a raised, pitched-down camera
// is the top-down the spec asks for -- one frame that shows the whole pack's
// footprint at once, which an FPV shot from the doorway cannot.
const TOPDOWN = "__sdfGame.setPose(-4.8, 4.8, 0, -1.35, 7)";
const FPV = "__sdfGame.setPose(-4.8, 2.0, 0, 0, 0)";
await evaluate(TOPDOWN);
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-topdown-before');
await evaluate(FPV);

// Two seconds of simulated time: long enough for four bodies to notice and
// converge, short enough that they have not all reached melee range.
const TOUCH = 0.70;   // two 0.35 m bodies touching
let worst = Infinity;
for (let i = 0; i < 8; i++) {
  await evaluate('__sdfGame.step(15, 1 / 60)');
  const d = await evaluate('__sdfGame.crowdMinDist()');
  if (typeof d === 'number' && d < worst) worst = d;
}
await shot('room4-converged');
await evaluate(TOPDOWN);
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-topdown-after');
await evaluate(FPV);
console.log(`crowd: worst pairwise centre distance ${worst.toFixed(3)} m (touching = ${TOUCH})`);

// The gate. Separation is SOFT, so a shove may leave a shallow overlap for a
// frame; a body standing INSIDE another is what this forbids. Half the touch
// distance is one radius: at that point the two centres are closer than one
// body is wide, which is the visual defect the owner reported.
if (!(worst > TOUCH * 0.5)) {
  fail(`zombies interpenetrating: worst centre distance ${worst.toFixed(3)} m ` +
       `(< ${(TOUCH * 0.5).toFixed(3)}). Separation is not running, or the ` +
       'nudge is being overwritten by the wander step.');
}

// --- 2. THE CHASE. Every zombie in the player's room must have noticed him
//     and be closing, not wandering.
const brains = await evaluate('__sdfGame.brains()');
const room4 = brains.filter((b) => b.room === 4);
if (room4.length === 0) fail('no room-4 actors in brains() — is the room lookup wired?');
const asleep = room4.filter((b) => !b.alert);
if (asleep.length === room4.length) {
  fail(`no room-4 zombie noticed the player: ${JSON.stringify(room4)}`);
}
console.log(`chase: ${room4.length - asleep.length}/${room4.length} alert`);

// --- 3. THE SWING. Let the nearest one arrive and prove it actually swings.
let swung = false;
for (let i = 0; i < 40 && !swung; i++) {
  await evaluate('__sdfGame.step(10, 1 / 60)');
  const bs = await evaluate('__sdfGame.brains()');
  swung = bs.some((b) => b.mode === 'attack' && b.swingT > 0);
}
await shot('fpv-swing');
if (!swung) fail('no zombie ever reached melee range and swung');
console.log('swing: a zombie reached melee range and swung');

// --- 4. NEGATIVE CONTROL. A gate that cannot fail proves nothing. With the
//     player in a tunnel (no room), nothing may be alert after the grace.
await evaluate('__sdfGame.setPose(-4.8, 0.0, 0, 0)');   // tunnel 4-1 mouth
await evaluate('__sdfGame.step(360, 1 / 60)');          // 6 s > loseGrace
const calm = await evaluate('__sdfGame.brains()');
if (calm.some((b) => b.alert)) {
  fail(`zombies stayed alert with the player out of the room: ${JSON.stringify(calm.filter((b) => b.alert))}`);
}
console.log('lock: everything went calm once the player left the room');

await evaluate('__sdfGame.setLoopRunning(true)');
const errs2 = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs2.length) fail(`console errors during the run: ${JSON.stringify(errs2.slice(0, 3))}`);
console.log(`[crowd] OK — ${shotCount} shots in ${OUT}`);
process.exit(0);
```

- [ ] **Step 2: Run the gate**

```bash
. scripts/lab-servers.sh && trap lab_servers_down EXIT && lab_servers_up && \
  GAME_OUT=docs/dev-notes/2026-09-04-zombie-crowd \
  node scripts/sdf-game-crowd-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

Expected: `[crowd] OK — 5 shots in docs/dev-notes/2026-09-04-zombie-crowd`, with the worst pairwise distance printed and above 0.35 m.

If it fails, fix the code, not the threshold. The one legitimate reason to move a number here is if room 4's spawn points are themselves closer than 0.70 m apart at t=0 — check `SPAWN_TABLE[4]` in `game-level.ts` before touching anything else.

- [ ] **Step 3: Prove the gate can fail**

Temporarily comment out the `actors.forEach((a, i) => a.nudge(...))` line in `game-main.ts` and re-run the gate.
Expected: FAIL with `zombies interpenetrating`. Restore the line and re-run; expected: PASS. Record both numbers — a gate never shown to fail is not a gate.

- [ ] **Step 4: Write the notes**

Create `docs/dev-notes/2026-09-04-zombie-crowd/notes.md`:

```markdown
# Zombie crowd separation + chase/attack brain — 2026-09-04

Spec: `docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md`
Plan: `docs/superpowers/plans/2026-09-04-zombie-crowd-and-brain.md`

## What landed

Three pure modules — `crowd.ts` (soft circle separation), `brain.ts`
(notice / chase / swing), `attack.ts` (the swing pose) — one optional
`MotionConfig.attack` field that leaves the lab bit-identical, and wiring in
`game-actor.ts` / `game-main.ts`.

## Frames

| file | what it shows |
|------|---------------|
| `room4-enter.png` | Room 4 as the player steps in: four bodies, pre-convergence. |
| `room4-converged.png` | Two simulated seconds later: the pack has closed and fanned, not stacked. |
| `room4-topdown-before.png` / `room4-topdown-after.png` | The same convergence from a raised camera — the footprint view, where stacking would be unmistakable. |
| `fpv-swing.png` | The nearest body at melee range, mid-swing. |

## The gate

`scripts/sdf-game-crowd-gate.mjs` — worst pairwise centre distance across the
convergence, the alert count in the player's room, one observed swing, and a
negative control (everything goes calm once the player leaves the room).

* With separation on: **<fill in the measured worst distance>** m.
* With `nudge` commented out: **<fill in the measured failing distance>** m —
  the gate fails, as it must.

## Known limits, deliberate

* **Zombies do not follow through tunnels.** `stepWander` clamps each body to
  its own room's bounds; a chaser stops at the doorway. Cross-room pursuit is
  a pathfinding task, not a tuning change.
* **The swing does no damage.** The owner's call for this round: approach and
  swing rhythm first, what a hit costs later. No player health, no HUD, no
  death.
* **A body does not re-aim mid-swing.** `halt` gates `stepWander`, so the
  heading stops updating for the 0.7 s a swing lasts; a player who strafes
  hard during a committed swing will not be tracked. This is the same
  trade-off that makes the swing read as weighty.
```

Fill in the two measured numbers from Steps 2 and 3 — the placeholders must not survive the commit.

- [ ] **Step 5: Update TASKS.md**

Add to the "Current focus" section of `TASKS.md`, above the `F-eject.1` row:

```markdown
**ZOMBIE CROWD + BRAIN — LANDED (2026-09-04), awaiting owner look.** The two
reports from the same session: bodies clipped through each other constantly,
and nothing in the level cared where the player was. Three pure modules —
`crowd.ts` (soft ground-plane circle separation, an immobile player anchor),
`brain.ts` (same-room + facing-cone aggro that locks on with a 4 s grace; a
gunshot bypasses the cone; chase emits a STANDOFF TARGET the existing wander
walks to, so there is still exactly one walker in the codebase), `attack.ts`
(wind-up / strike / hold / recovery off one signed scalar). `MotionConfig`
gains one optional `attack` field that BRANCHES rather than adding a zero, so
the lab's motion is bit-identical — pinned by a 30-frame exact-pose test, not
a comment. Gate: `scripts/sdf-game-crowd-gate.mjs`, proven to fail with the
nudge removed. Notes + frames:
[docs/dev-notes/2026-09-04-zombie-crowd/](docs/dev-notes/2026-09-04-zombie-crowd/notes.md).
**Deliberate gaps:** the swing does NO damage (owner's call — rhythm first, no
player health this round), and chasers stop at their room's doorway because
`stepWander` clamps to room bounds; cross-room pursuit needs navigation.
[spec](docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md) ·
[plan](docs/superpowers/plans/2026-09-04-zombie-crowd-and-brain.md)
```

- [ ] **Step 6: Final full verification**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean, full suite green. Report the actual test count.

- [ ] **Step 7: Commit**

```bash
git add scripts/sdf-game-crowd-gate.mjs docs/dev-notes/2026-09-04-zombie-crowd TASKS.md
git commit -m "crowd gate: headless proof the pack converges without stacking

Worst pairwise centre distance across the convergence, the alert count in the
player's room, one observed swing, and a negative control that everything goes
calm once he leaves. Proven to FAIL with the separation nudge removed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
