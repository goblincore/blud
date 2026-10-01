# Night Train Sequence System (ending plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Touching the egg starts a short scripted, abstract sequence instead of the instant "LEVEL COMPLETE": input and damage freeze, a pure timeline of shots drives the camera and a full-screen overlay, and when it ends the level completes. This plan builds the system and a **two-shot stub** (a slow pull toward the egg, then black with a title); plan 4 fills in the real montage.

**Spec:** `docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md` (§3 "The sequence system", §4 the montage table, §5, §7 build step 3) — read it first. Plans 1 and 2 are done: `2026-09-30-night-train-control-room.md`, `2026-09-30-night-train-egg-pass.md` (notes in `docs/dev-notes/2026-09-30-egg-ending/`).

**Architecture:**
- `ending-sequence.ts` — **pure**, no `three`: the timeline as data (`Sequence` → `Shot[]`, each with a duration, a cut type, a camera description and an overlay), plus `shotAt(seq, t)`, `cameraAt(spec, u, start, anchors)` and `overlayAt(seq, t)`. Unit-tested.
- `level-events.ts` gains a `sequence` command: the event `sequence.<id>` starts sequence `<id>`.
- The level wires it with data only: trigger event `egg.touch`, a cue `egg.touch → sequence.ending`, and `completeOn: "ending.end"`.
- `game-sequence-leaves.ts` — the runtime on `ctx.world.sequence`: starts a sequence, advances its clock on the sim step, paints a DOM overlay (flash, black, title card), overrides the camera after it is placed, blocks input and damage while it runs, and emits the sequence's end event, which the existing `completeOn` turns into `complete`.

**Tech Stack:** TypeScript, Vitest, Python (the level tables) + headless Blender (the level pipeline), Node headless-Chrome gates.

**Out of scope:** the real montage shots, the exterior train, the egg-in-space and the interior-of-the-egg shots (plan 4); sound and a beat clock; the Flat and the pull-back. In plan 3 the camera never goes inside the egg (`eggShade` has no inside-the-shell case; plan 4's "inside" shot must add one).

---

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port):** the timeline and its maths are pure (`ending-sequence.ts`) with their own tests; the leaf only reads them and writes the camera and an overlay. State lives on `ctx.world.sequence`, never as new `main()` bindings. The sequence clock advances on the sim step (`dt`), never wall time, so frozen captures advance it exactly as stepped.
- Work ONLY in this worktree (`.claude/worktrees/train-monitor-transition-51f385`). Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <files>`) plus `npx tsc --noEmit` (it has one known pre-existing error in `src/lab/sdf-zombie/pack-golden.test.ts`, TS2307 `node:crypto`; ignore only that one). Never the bare full suite.
- **Headless capture only.** `export LAB_TMP=.lab-tmp`. Never kill a server you did not start.
- Level changes go through the pipeline: tables in `scripts/levels/night_train_layout.py` → `build_night_train.py` → `export_level.py`. Commit the regenerated `.blend` and level JSON; if the art GLB differs byte-wise although no art changed, restore it with `git checkout -- public/assets/levels/night-train.art.glb`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Where things are

- The completion flow today (`game-loop-leaves.ts`): trigger events → `emitLevelEvent` → `stepLoop` expands cues, then `commandsFor(event, def.completeOn)` → `runLevelCommand`; the `complete` command sets `rt.done` and shows the "LEVEL COMPLETE" overlay. `loopBlocksInput(ctx)` (dead or done) zeroes movement in `game-main.ts` (`if (loopBlocksInput(ctx)) input = …`). `damagePlayer` returns early when dead/done.
- The camera is placed in `game-main.ts` (search `applyDeathCamera(ctx, camera)`), after `applyTrainCamera`; `camera.updateMatrixWorld()` follows. The FOV co-invariant: whenever `camera.fov` changes, `ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg + delta)` must be called in the same breath.
- Plan 1/2 level facts: the egg trigger today is `("end", COMPLETE_ON, -1.6, 1.6, 4.7, 7.9)` in the `control-room` table of `night_train_layout.py`; the egg centre is (0, 1.6, −136.7); `ctx.world.egg.centre` holds it at runtime; the inner egg's centre is `centre + (0, EGG.innerDy, 0)`.

---

## Task 1: `ending-sequence.ts` — the pure timeline (TDD)

**Files:** Create `src/lab/sdf-zombie/webgpu/ending-sequence.ts` and `src/lab/sdf-zombie/webgpu/ending-sequence.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/ending-sequence.test.ts

import { describe, expect, it } from 'vitest';
import { FLASH_S, SEQUENCES, cameraAt, overlayAt, shotAt, totalDuration, type Sequence, type Vec3 } from './ending-sequence';

const ending = SEQUENCES.ending!;
const START = { eye: [0, 1.5, -132] as Vec3, look: [0, 1.5, -133] as Vec3 };
const ANCHORS = { 'inner-egg': [0, 1.48, -136.7] as Vec3 };

describe('the ending sequence (the plan-3 stub)', () => {
  it('is two shots, a pull then black, with an end event', () => {
    expect(ending.shots.map(s => s.id)).toEqual(['pull', 'black']);
    expect(ending.endEvent).toBe('ending.end');
    expect(totalDuration(ending)).toBeCloseTo(6, 6);
    for (const s of ending.shots) expect(s.duration).toBeGreaterThan(0);
  });
});

describe('shotAt', () => {
  it('picks the shot and the progress through it', () => {
    expect(shotAt(ending, 0)).toMatchObject({ index: 0, local: 0, u: 0, finished: false });
    expect(shotAt(ending, 3.999).index).toBe(0);
    expect(shotAt(ending, 4)).toMatchObject({ index: 1, local: 0, u: 0 });
    expect(shotAt(ending, 5).u).toBeCloseTo(0.5, 6);
    expect(shotAt(ending, 2).u).toBeCloseTo(0.5, 6);
  });
  it('holds the last shot, finished, past the end', () => {
    const s = shotAt(ending, 100);
    expect(s).toMatchObject({ index: 1, u: 1, finished: true });
    expect(shotAt(ending, 6).finished).toBe(true);
    expect(shotAt(ending, 5.99).finished).toBe(false);
  });
});

describe('cameraAt', () => {
  const drift = ending.shots[0]!.camera;
  it('starts at the player\'s view and ends 1.3 m short of the inner egg with the lens narrowed', () => {
    const a = cameraAt(drift, 0, START, ANCHORS)!;
    expect(a.eye).toEqual(START.eye);
    expect(a.fovDelta).toBe(0);
    const b = cameraAt(drift, 1, START, ANCHORS)!;
    const d = Math.hypot(b.eye[0] - 0, b.eye[1] - 1.48, b.eye[2] + 136.7);
    expect(d).toBeCloseTo(1.3, 6);
    for (let i = 0; i < 3; i++) expect(b.look[i]!).toBeCloseTo(ANCHORS['inner-egg'][i]!, 9);
    expect(b.fovDelta).toBeCloseTo(-25, 6);
  });
  it('eases: slow at the ends, faster in the middle', () => {
    const at = (u: number) => cameraAt(drift, u, START, ANCHORS)!.eye[2];
    const total = at(1) - at(0);
    expect((at(0.1) - at(0)) / total).toBeLessThan(0.1);
    expect((at(0.6) - at(0.4)) / total).toBeGreaterThan(0.2);
  });
  it('holds (null) for a hold shot or a missing anchor, and returns a fixed pose as given', () => {
    expect(cameraAt({ kind: 'hold' }, 0.5, START, ANCHORS)).toBeNull();
    expect(cameraAt(drift, 0.5, START, {})).toBeNull();
    const fixed = cameraAt({ kind: 'fixed', eye: [1, 2, 3], look: [4, 5, 6], fovDelta: -10 }, 0.3, START, ANCHORS)!;
    expect(fixed).toEqual({ eye: [1, 2, 3], look: [4, 5, 6], fovDelta: -10 });
  });
});

describe('overlayAt', () => {
  const flashy: Sequence = {
    id: 't', endEvent: 't.end',
    shots: [
      { id: 'a', duration: 1, cut: 'hard', camera: { kind: 'hold' } },
      { id: 'b', duration: 1, cut: 'flash', camera: { kind: 'hold' }, overlay: { rgb: [0, 0, 0], alpha: 0.5 } },
    ],
  };
  it('is clear in the pull and solid black with the title in the last shot', () => {
    expect(overlayAt(ending, 1).alpha).toBe(0);
    const o = overlayAt(ending, 4.5);
    expect(o).toMatchObject({ rgb: [0, 0, 0], alpha: 1, text: 'NIGHT TRAIN' });
    expect(overlayAt(ending, 1).text).toBeNull();
  });
  it('a flash cut starts white and falls to the shot\'s own overlay in FLASH_S', () => {
    const w0 = overlayAt(flashy, 1);
    expect(w0.rgb).toEqual([1, 1, 1]);
    expect(w0.alpha).toBeCloseTo(1, 6);
    const mid = overlayAt(flashy, 1 + FLASH_S / 2);
    expect(mid.alpha).toBeLessThan(w0.alpha);
    expect(mid.alpha).toBeGreaterThan(0.5);
    expect(overlayAt(flashy, 1 + FLASH_S + 0.01)).toMatchObject({ rgb: [0, 0, 0], alpha: 0.5 });
  });
  it('a hard cut never flashes', () => {
    expect(overlayAt(flashy, 0).alpha).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — it must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/ending-sequence.test.ts 2>&1 | tail -6
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/ending-sequence.ts
//
// SHORT SCRIPTED SEQUENCES (spec 2026-09-30-night-train-egg-ending-design.md §3): a timeline of shots,
// each a duration, a cut type, a camera and an overlay. Abstract on purpose: jump cuts, flashes, a
// full-screen colour and a line of text, never a third-person shot of the hero. Pure: no three.js, no DOM.
// The runtime (game-sequence-leaves.ts) advances `t` on the sim step and applies what these return.
// Shots are authored in seconds; there is no beat clock yet.

export type Vec3 = [number, number, number];
export type CutKind = 'hard' | 'flash';

/** How a shot places the camera.
 *  drift: from the player's view at the sequence's start towards a named anchor, stopping `stopShort` m
 *         from it, looking at it, with the lens narrowing by fovDelta[0] -> fovDelta[1] degrees.
 *  fixed: an authored eye and look point.
 *  hold:  keep whatever the last shot left (or the player's own view if there was none). */
export type CameraSpec =
  | { kind: 'drift'; anchor: string; stopShort: number; fovDelta: readonly [number, number] }
  | { kind: 'fixed'; eye: Vec3; look: Vec3; fovDelta?: number }
  | { kind: 'hold' };

export interface OverlaySpec { rgb: Vec3; alpha: number; text?: string }

export interface Shot {
  id: string;
  /** Seconds. */
  duration: number;
  /** 'flash' starts the shot with a white frame that falls away in FLASH_S. */
  cut: CutKind;
  camera: CameraSpec;
  overlay?: OverlaySpec;
}

export interface Sequence {
  id: string;
  /** The level event fired when the last shot ends (the level's `completeOn` maps it to completion). */
  endEvent: string;
  shots: readonly Shot[];
}

/** How long a flash cut's white frame takes to fall to nothing (s). */
export const FLASH_S = 0.12;

export function totalDuration(seq: Sequence): number {
  return seq.shots.reduce((sum, s) => sum + s.duration, 0);
}

export interface ShotAt { index: number; shot: Shot; local: number; u: number; finished: boolean }

/** The shot playing at sequence time t, and the progress through it. Past the end it stays on the
 *  last shot with u = 1 and finished = true. */
export function shotAt(seq: Sequence, t: number): ShotAt {
  const total = totalDuration(seq);
  let start = 0;
  for (let i = 0; i < seq.shots.length; i++) {
    const shot = seq.shots[i]!;
    const end = start + shot.duration;
    if (t < end || i === seq.shots.length - 1) {
      const local = Math.min(Math.max(t - start, 0), shot.duration);
      return { index: i, shot, local, u: shot.duration > 0 ? local / shot.duration : 1, finished: t >= total };
    }
    start = end;
  }
  throw new Error(`sequence ${seq.id} has no shots`);
}

export interface CameraStart { eye: Vec3; look: Vec3 }
export interface CameraPose { eye: Vec3; look: Vec3; fovDelta: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The camera for a shot at progress u (0..1). `start` is the player's view when the sequence began;
 *  `anchors` are named world points. Null means hold the previous pose. */
export function cameraAt(spec: CameraSpec, u: number, start: CameraStart, anchors: Readonly<Record<string, Vec3>>): CameraPose | null {
  if (spec.kind === 'hold') return null;
  if (spec.kind === 'fixed') return { eye: spec.eye, look: spec.look, fovDelta: spec.fovDelta ?? 0 };
  const a = anchors[spec.anchor];
  if (!a) return null;
  const dx = start.eye[0] - a[0], dy = start.eye[1] - a[1], dz = start.eye[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const goal: Vec3 = [a[0] + (dx / len) * spec.stopShort, a[1] + (dy / len) * spec.stopShort, a[2] + (dz / len) * spec.stopShort];
  const e = ease(u);
  return {
    eye: lerp3(start.eye, goal, e),
    look: lerp3(start.look, a, ease(u * 1.5)),
    fovDelta: spec.fovDelta[0] + (spec.fovDelta[1] - spec.fovDelta[0]) * e,
  };
}

export interface OverlayAt { rgb: Vec3; alpha: number; text: string | null }

/** The full-screen colour, its opacity and any text at sequence time t. */
export function overlayAt(seq: Sequence, t: number): OverlayAt {
  const { shot, local } = shotAt(seq, t);
  const base = shot.overlay ?? { rgb: [0, 0, 0] as Vec3, alpha: 0 };
  const flash = shot.cut === 'flash' ? Math.max(0, 1 - local / FLASH_S) : 0;
  if (flash > base.alpha) return { rgb: [1, 1, 1], alpha: flash, text: base.text ?? null };
  return { rgb: base.rgb, alpha: base.alpha, text: base.text ?? null };
}

/** Every sequence the game knows, by id. A level starts one with the event `sequence.<id>`. */
export const SEQUENCES: Readonly<Record<string, Sequence>> = {
  // The plan-3 stub of the Night Train ending (spec §4): a slow pull towards the egg, then black and a title.
  ending: {
    id: 'ending',
    endEvent: 'ending.end',
    shots: [
      { id: 'pull', duration: 4, cut: 'hard', camera: { kind: 'drift', anchor: 'inner-egg', stopShort: 1.3, fovDelta: [0, -25] } },
      { id: 'black', duration: 2, cut: 'hard', camera: { kind: 'hold' }, overlay: { rgb: [0, 0, 0], alpha: 1, text: 'NIGHT TRAIN' } },
    ],
  },
};
```

- [ ] **Step 4: Run it — it must pass**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/ending-sequence.test.ts 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -4
```

Expected: all pass; `tsc` shows only the known `pack-golden.test.ts` error. If the "eases" assertion fails, check the arithmetic against `ease`: at u = 0.1 the eased value is 0.028 (< 0.1 ✓); between 0.4 and 0.6 it is 0.648 − 0.352 = 0.296 (> 0.2 ✓).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/ending-sequence.ts src/lab/sdf-zombie/webgpu/ending-sequence.test.ts
git commit -m "feat(sequence): pure timeline — shots, drift camera, flash/black overlay, the ending stub

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: The `sequence` level command (TDD)

**Files:** Modify `src/lab/sdf-zombie/webgpu/level-events.ts` (the `LevelCommand` union ~line 45 and `commandsFor` ~line 55) and `src/lab/sdf-zombie/webgpu/level-events.test.ts` (the `commandsFor` describe, ~line 45).

- [ ] **Step 1: Add the failing tests**

In `level-events.test.ts`, inside `describe('commandsFor', …)` add:

```ts
  it('sequence.<id> starts that sequence', () => {
    expect(commandsFor('sequence.ending', 'ending.end')).toEqual([{ kind: 'sequence', id: 'ending' }]);
    expect(commandsFor('sequence.long-one-2', 'x')).toEqual([{ kind: 'sequence', id: 'long-one-2' }]);
  });
  it('malformed sequence events and the end event do nothing special', () => {
    expect(commandsFor('sequence.', 'x')).toEqual([]);
    expect(commandsFor('sequence.Ending', 'x')).toEqual([]);
    expect(commandsFor('sequence.a.b', 'x')).toEqual([]);
    expect(commandsFor('egg.touch', 'ending.end')).toEqual([]);
    expect(commandsFor('ending.end', 'ending.end')).toEqual([{ kind: 'complete' }]);
  });
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/level-events.test.ts 2>&1 | tail -8
```

Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

In `level-events.ts`: add `| { kind: 'sequence'; id: string }` to `LevelCommand`, and in `commandsFor`, after the `light` line:

```ts
  const seq = /^sequence\.([a-z][a-z0-9-]*)$/.exec(event);
  if (seq) out.push({ kind: 'sequence', id: seq[1]! });
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/level-events.test.ts 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -4
```

Expected: pass; only the known `tsc` error.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-events.ts src/lab/sdf-zombie/webgpu/level-events.test.ts
git commit -m "feat(events): the sequence.<id> level command

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The level — `egg.touch`, the cue, and `ending.end`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts` (test first)
- Modify: `scripts/levels/night_train_layout.py`
- Regenerate: `assets-source/levels/night-train.blend`, `public/assets/levels/night-train.level.json`

- [ ] **Step 1: Update the level test first**

In `level-json.night-train.test.ts`:
1. In the test "the control room: 8 x 10 m…", change `t.triggers.find(tr => tr.event === 'level.end')!` to `t.triggers.find(tr => tr.event === 'egg.touch')!`, and the comment above it to `// Completion: the egg.touch trigger (a 3.2 m box around the egg) starts the ending sequence.`.
2. In "taking it kills the coat-check lamps…" change the cues assertion to:

```ts
    expect(t.cues).toEqual([
      { on: 'pickup.flashlight', emit: ['light.die.room.6', 'alert.room.6'] },
      { on: 'egg.touch', emit: ['sequence.ending'] },
    ]);
```

3. In the same test replace `[['level.end', true], ['light.blackout.room.4', true], ['light.strobe.room.5', true]]` with `[['egg.touch', true], ['light.blackout.room.4', true], ['light.strobe.room.5', true]]` and `expect(t.completeOn).toBe('level.end');` with `expect(t.completeOn).toBe('ending.end');`.
4. Rename that test's title ending `…; blackout, strobe and end triggers` to `…; blackout, strobe and egg triggers`.

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts 2>&1 | tail -12
```

Expected: FAIL (the committed JSON still has `level.end`).

- [ ] **Step 3: Change the tables**

In `scripts/levels/night_train_layout.py`:
1. Replace the `CUES` line and the comment lines above `COMPLETE_ON` with:

```python
# When `on` fires, the level also fires `emit` (dynamic light spec §3).
CUES = [("pickup.flashlight", ["light.die.room.6", "alert.room.6"]),
        ("egg.touch", ["sequence.ending"])]   # touching the egg starts the ending sequence (ending plan 3)
# The level completes when the ending sequence ends (ending-sequence.ts SEQUENCES.ending.endEvent); the CD is a collectible.
COMPLETE_ON = "ending.end"
```

2. In the control-room entry, change `triggers=[("end", COMPLETE_ON, -1.6, 1.6, 4.7, 7.9)]` to `triggers=[("egg", "egg.touch", -1.6, 1.6, 4.7, 7.9)]`, and in that table's comment change "Completion stays level.end until plan 3 (egg.touch)." to "Touching the egg fires egg.touch, whose cue starts the ending sequence (plan 3)."

- [ ] **Step 4: Rebuild, export, test**

```bash
blender --background --factory-startup --python scripts/levels/build_night_train.py 2>&1 | tail -3
blender --background assets-source/levels/night-train.blend --python scripts/levels/export_level.py -- public/assets/levels/night-train.level.json 2>&1 | tail -4
git status --short public/assets/levels assets-source/levels
npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts 2>&1 | tail -6
git diff public/assets/levels/night-train.level.json | grep '^[-+]' | grep -v '^+++\|^---'
```

Expected: the test passes; the JSON diff is exactly: `completeOn` `level.end` → `ending.end`, the trigger `id` `end` → `egg` and its `event` → `egg.touch`, and a second entry in `cues`. Nothing else. If the GLB shows as modified, `git checkout -- public/assets/levels/night-train.art.glb` (no art changed).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts scripts/levels/night_train_layout.py assets-source/levels/night-train.blend public/assets/levels/night-train.level.json
git commit -m "feat(level): touching the egg fires egg.touch -> sequence.ending; the level completes on ending.end

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Until Task 4 lands the leaf, the game ignores `sequence.ending` and never reaches `ending.end`, so the level can no longer complete in the game; the loop gate is updated in Task 5. Do not run the loop gate between Tasks 3 and 5.)

---

## Task 4: The runtime — leaf, world slice, loop integration, wiring

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-sequence-leaves.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-state-world.ts` (type import, field, default, `WORLD_BINDINGS`)
- Modify: `src/lab/sdf-zombie/webgpu/game-state-world.test.ts` (the binding-count assertion)
- Modify: `src/lab/sdf-zombie/webgpu/game-loop-leaves.ts` (`runLevelCommand`, `loopBlocksInput`, `damagePlayer`, `stepLoop`)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (import, `stepSequence`, `applySequenceCamera`, seams)

- [ ] **Step 1: Write the leaf**

Create `src/lab/sdf-zombie/webgpu/game-sequence-leaves.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-sequence-leaves.ts
//
// SCRIPTED SEQUENCES in the game (spec 2026-09-30-night-train-egg-ending-design.md §3). The timeline is
// pure (ending-sequence.ts); this leaf holds the runtime on ctx.world.sequence: it starts a sequence on
// the `sequence` level command, advances its clock on the sim step, paints a full-screen DOM overlay
// (flash, black, title text), overrides the camera after the game has placed it, hides the gun and the
// HUD, and when the last shot ends queues the sequence's end event (the level's completeOn turns it into
// completion). While a sequence is active input and damage are blocked (loopBlocksInput, damagePlayer).
//
// This file must not import game-loop-leaves.ts (which imports it): the end event is queued straight onto
// ctx.world.loop.pending.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { EGG } from './egg-look';
import { SEQUENCES, cameraAt, overlayAt, shotAt, totalDuration, type CameraPose, type CameraStart, type Sequence, type Vec3 } from './ending-sequence';

export interface SequenceRuntime {
  seq: Sequence;
  /** Sequence time (s), advanced on the sim step. */
  t: number;
  started: boolean;
  /** Running; false once the end event is queued. */
  active: boolean;
  finished: boolean;
  shotIndex: number;
  /** The player's view when the sequence began (captured by the first camera pass). */
  start: CameraStart | null;
  /** The last pose a shot gave (a hold shot keeps it). */
  last: CameraPose | null;
  anchors: Record<string, Vec3>;
  fovBase: number;
  fovApplied: number;
  el: HTMLDivElement;
  text: HTMLDivElement;
}

function anchorsOf(ctx: GameContext): Record<string, Vec3> {
  const egg = ctx.world.egg;
  if (!egg) return {};
  const c = egg.centre;
  return { egg: [c[0], c[1], c[2]], 'inner-egg': [c[0], c[1] + EGG.innerDy, c[2]] };
}

const css = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);

function paint(rt: SequenceRuntime): void {
  const o = overlayAt(rt.seq, rt.t);
  rt.el.style.background = `rgb(${css(o.rgb[0])}, ${css(o.rgb[1])}, ${css(o.rgb[2])})`;
  rt.el.style.opacity = String(o.alpha);
  rt.text.textContent = o.text ?? '';
}

/** Start sequence `id` (the `sequence.<id>` level command). False when unknown or one already ran. */
export function startSequence(ctx: GameContext, id: string): boolean {
  const seq = SEQUENCES[id];
  if (!seq || ctx.world.sequence?.started) return false;
  const el = document.createElement('div');
  el.setAttribute('style', 'position:fixed; inset:0; z-index:44; pointer-events:none; opacity:0; background:#000;'
    + ' display:grid; place-items:center;');
  const text = document.createElement('div');
  text.setAttribute('style', 'font:700 28px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; letter-spacing:.3em;');
  el.appendChild(text);
  document.body.appendChild(el);
  const loop = ctx.world.loop;
  if (loop) { loop.el.status.style.display = 'none'; loop.el.hurt.style.display = 'none'; }
  ctx.world.sequence = {
    seq, t: 0, started: true, active: true, finished: false, shotIndex: -1, start: null, last: null,
    anchors: anchorsOf(ctx), fovBase: 0, fovApplied: 0, el, text,
  };
  ctx.telemetry.telemetry.event('sequence-start', { id });
  return true;
}

/** Per sim step, after stepLoop: the clock, the overlay, and the end. */
export function stepSequence(ctx: GameContext, dt: number): void {
  const rt = ctx.world.sequence;
  if (!rt?.started) return;
  if (ctx.weapon.gunGroup) ctx.weapon.gunGroup.visible = false;   // stepLoop shows it each step; this runs after
  if (!rt.active) return;
  rt.t += dt;
  const at = shotAt(rt.seq, rt.t);
  if (at.index !== rt.shotIndex) {
    rt.shotIndex = at.index;
    ctx.telemetry.telemetry.event('sequence-shot', { id: rt.seq.id, shot: at.shot.id });
  }
  paint(rt);
  if (at.finished) {
    rt.active = false;
    rt.finished = true;
    ctx.world.loop?.pending.push(rt.seq.endEvent);
  }
}

/** After the game placed the camera (and the train's roll and the death camera): the current shot's pose. */
export function applySequenceCamera(ctx: GameContext, camera: THREE.PerspectiveCamera): void {
  const rt = ctx.world.sequence;
  if (!rt?.started) return;
  if (!rt.start) {
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    const p = camera.position;
    rt.start = { eye: [p.x, p.y, p.z], look: [p.x + d.x, p.y + d.y, p.z + d.z] };
    rt.fovBase = camera.fov;
    rt.fovApplied = camera.fov;
  }
  const at = shotAt(rt.seq, rt.t);
  const pose = cameraAt(at.shot.camera, at.u, rt.start, rt.anchors) ?? rt.last;
  if (!pose) return;
  rt.last = pose;
  camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
  camera.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  const want = rt.fovBase + pose.fovDelta;
  if (Math.abs(want - rt.fovApplied) > 1e-4) {
    camera.fov = want;
    camera.updateProjectionMatrix();
    // The lens co-invariant: the render FOV and postAa's lens move together.
    ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg + pose.fovDelta);
    rt.fovApplied = want;
  }
}

/** Seams: `__sdfGame.sequence()`, `startSequence(id)`, `skipSequence()` (jump to the end; the next step finishes it). */
export function createSequenceSeams(ctx: GameContext) {
  const r3 = (v: readonly number[]) => v.map(x => +x.toFixed(3));
  return {
    sequence: () => {
      const rt = ctx.world.sequence;
      if (!rt) return null;
      const at = shotAt(rt.seq, rt.t);
      return {
        id: rt.seq.id, active: rt.active, finished: rt.finished, t: +rt.t.toFixed(3), total: totalDuration(rt.seq),
        shot: at.shot.id, shotIndex: at.index, u: +at.u.toFixed(3), overlay: overlayAt(rt.seq, rt.t),
        camera: rt.last ? { eye: r3(rt.last.eye), look: r3(rt.last.look), fovDelta: +rt.last.fovDelta.toFixed(3) } : null,
      };
    },
    startSequence: (id: string) => startSequence(ctx, id),
    skipSequence: () => {
      const rt = ctx.world.sequence;
      if (!rt?.active) return false;
      rt.t = totalDuration(rt.seq);
      return true;
    },
  };
}
```

- [ ] **Step 2: The world slice**

In `game-state-world.ts`, mirroring `egg`: add `import type { SequenceRuntime } from './game-sequence-leaves';`, the field

```ts
  /** The running scripted sequence (the Night Train ending); null until one starts. */
  sequence: SequenceRuntime | null;
```

the default `sequence: null,`, and `sequence: 'world.sequence',` in `WORLD_BINDINGS`. In `game-state-world.test.ts` bump the binding-count assertion by one (it is 34 after the egg's bump to 33; add a `+sequence (2026-09-30)` comment like the egg's).

- [ ] **Step 3: The loop integration**

In `game-loop-leaves.ts`:
1. Add `import { startSequence } from './game-sequence-leaves';`.
2. In `runLevelCommand` add, after the `complete` block: `if (cmd.kind === 'sequence') startSequence(ctx, cmd.id);`.
3. `loopBlocksInput`: `return !!rt && (rt.vitals.dead || rt.done || !!ctx.world.sequence?.active);`
4. `damagePlayer`: `if (!rt || rt.god || rt.done || ctx.world.sequence?.active) return;`
5. `stepLoop`: change `if (rt.vitals.dead || rt.done) return;` to `if (rt.vitals.dead || rt.done || ctx.world.sequence?.active) return;`. (The sequence's end event is queued by `stepSequence` after it sets `active = false`, so the next `stepLoop` processes it.)

- [ ] **Step 4: Wire `game-main.ts`**

1. Import: `import { applySequenceCamera, createSequenceSeams, stepSequence } from './game-sequence-leaves';` (beside the loop leaf import).
2. In the tick, directly after `stepLoop(ctx, dt);` add `stepSequence(ctx, dt);`.
3. After `applyDeathCamera(ctx, camera);` add `applySequenceCamera(ctx, camera);`.
4. In the seams list, after `createLoopSeams(ctx),` add `createSequenceSeams(ctx),`. First grep that no seam named `sequence`, `startSequence` or `skipSequence` already exists (`grep -rn "skipSequence\|startSequence" src/lab/sdf-zombie/webgpu/*.ts | grep -v game-sequence-leaves`).

- [ ] **Step 5: Type-check and test**

```bash
npx tsc --noEmit 2>&1 | tail -6
npx vitest run src/lab/sdf-zombie/webgpu/ending-sequence.test.ts src/lab/sdf-zombie/webgpu/level-events.test.ts src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts src/lab/sdf-zombie/webgpu/game-state-world.test.ts src/lab/sdf-zombie/webgpu/game-context.test.ts 2>&1 | tail -10
```

Expected: only the known `tsc` error; all tests pass. If `camera` is typed `THREE.Camera` where `applyDeathCamera(ctx, camera)` is called, check the declared type of `camera` in `game-main.ts` (it is a `PerspectiveCamera`, `camera.fov` is used nearby); otherwise cast at the call.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-sequence-leaves.ts src/lab/sdf-zombie/webgpu/game-state-world.ts src/lab/sdf-zombie/webgpu/game-state-world.test.ts src/lab/sdf-zombie/webgpu/game-loop-leaves.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(sequence): the runtime — clock, overlay, camera override, input and damage freeze, end event

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Gate, look, regressions, notes

**Files:** Modify `scripts/sdf-game-loop-gate.mjs` (section 5 and header); create `docs/dev-notes/2026-09-30-egg-ending/plan3-notes.md` (+ screenshots); modify `docs/tasks/levels.md`, `TASKS.md`, `docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md` (status line only).

- [ ] **Step 1: Rewrite loop-gate section 5**

Replace section 5 (from the `// 5. COMPLETE` comment to just before `console.log('PASS sdf-game-loop-gate')`) with:

```js
// 5. THE ENDING — reaching the egg (the egg.touch box: x -1.6..1.6, z -135.1 .. -138.3) starts the
//    `ending` sequence; input and damage freeze; the camera leaves the player's view; the pull is
//    shot 1 (4 s), black + title is shot 2 (2 s); at the end the level completes (ending plan 3, 2026-09-30).
const stepN = (n, dt) => evaluate(`__sdfGame.step(${n}${dt === undefined ? '' : `, ${dt}`})`, 300000);
if (!(await boot('level=night-train&frozen&nospawn&god'))) fail('night-train (god) did not boot');
await evaluate('__sdfGame.setPose(0, -132.0, 0, 0)');
await settle();
if (await evaluate('__sdfGame.sequence()')) fail('a sequence existed before the egg was touched');
await evaluate('__sdfGame.setPose(0, -135.3, 0, 0)');
await stepN(3, 1 / 60);
let S = await evaluate('__sdfGame.sequence()');
if (!S || S.id !== 'ending' || !S.active) fail(`touching the egg did not start the ending: ${JSON.stringify(S)}`);
if (S.shot !== 'pull') fail(`the ending did not open on the pull: ${JSON.stringify(S)}`);
if (await evaluate('__sdfGame.levelComplete()')) fail('the level completed before the sequence ended');
// Frozen: movement and damage do nothing while it runs.
const p0 = (await evaluate('__sdfGame.pose()')).pos.map((v) => +v.toFixed(3));
const hp0 = (await evaluate('__sdfGame.vitals()')).health;
await evaluate('__sdfGame.damagePlayer(30, "pellet")');
if ((await evaluate('__sdfGame.vitals()')).health !== hp0) fail('damage landed during the sequence');
// The pull: 4 s of sim time in 60 Hz steps; the camera moves and the lens narrows.
await stepN(120, 1 / 60);
S = await evaluate('__sdfGame.sequence()');
if (!S.active || S.shot !== 'pull' || !(S.u > 0.4 && S.u < 0.6)) fail(`2 s in, not halfway through the pull: ${JSON.stringify(S)}`);
if (!S.camera || !(S.camera.fovDelta < -3)) fail(`the lens did not narrow: ${JSON.stringify(S.camera)}`);
if (!(S.camera.eye[2] < -132.5 || Math.abs(S.camera.eye[2] - -135.3) > 0.01)) fail(`the camera did not move: ${JSON.stringify(S.camera)}`);
await stepN(150, 1 / 60);
S = await evaluate('__sdfGame.sequence()');
if (S.shot !== 'black' || !(S.overlay.alpha > 0.99) || S.overlay.text !== 'NIGHT TRAIN') fail(`after the pull: not black with the title: ${JSON.stringify(S)}`);
if ((await evaluate('__sdfGame.pose()')).pos.map((v) => +v.toFixed(3)).join() !== p0.join()) fail('the player moved during the sequence');
await stepN(130, 1 / 60);
S = await evaluate('__sdfGame.sequence()');
if (S.active || !S.finished) fail(`the sequence did not finish after 6.3 s: ${JSON.stringify(S)}`);
await stepN(3, 1 / 60);
if (!(await evaluate('__sdfGame.levelComplete()'))) fail('the level did not complete when the sequence ended');
pass('ending: egg touch -> pull (lens narrows, camera moves) -> black + title -> level complete; input and damage frozen');
```

Also change the header line 9 `5. COMPLETE: reaching the egg in the control room ends the level.` to `5. ENDING: reaching the egg starts the ending sequence; it freezes input, then completes the level.` If `__sdfGame.step`'s signature or the sim step differ from `step(n, dt)` as `scripts/sdf-disco-check.mjs` uses it, copy that script's `stepN` exactly. If the "camera moved" check is wrong because `S.camera.eye` is reported before the first camera pass, read the camera after one more step; do not delete the check.

- [ ] **Step 2: Run the gates**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-loop-gate.sh 2>&1 | tail -12
bash scripts/sdf-game-train-gate.sh 2>&1 | tail -14
bash scripts/sdf-egg-check.sh 2>&1 | tail -12
bash scripts/sdf-disco-check.sh 2>&1 | tail -4
npx vitest run src/lab/sdf-zombie/webgpu/ending-sequence.test.ts src/lab/sdf-zombie/webgpu/level-events.test.ts src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts src/lab/sdf-zombie/webgpu/game-state-world.test.ts 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -3
```

Expected: all PASS (loop, train, egg, disco; the known `tsc` error only). The train gate walk stays outside the egg box so it never starts the sequence. If the egg check's pose waypoints now enter the box (they do not: NEAR is z −134.9, outside it) or the sequence starts in the egg check, fix the pose, not the trigger.

- [ ] **Step 3: Look at it**

Capture three frames of the sequence in headless Chrome with a throwaway script (copy the plumbing from `scripts/sdf-egg-check.mjs`; do not commit it): boot `level=night-train&frozen&nospawn&god`, `setPose(0,-135.3,0,0)`, step 3, and screenshot at sequence time ≈ 0.1 s, 2 s and 3.9 s (pull), and 4.5 s (black + title). Save them to `docs/dev-notes/2026-09-30-egg-ending/seq-pull-0.png`, `seq-pull-2.png`, `seq-pull-4.png`, `seq-black.png` and open each with the Read tool. Describe what each shows. Check in particular: the flail viewmodel and the HUD are gone during the pull; the egg grows in frame and the lens narrows without the picture jumping; the title is centred on black; no debug panels cover the title (they may; note it).

- [ ] **Step 4: Notes and task board**

Create `docs/dev-notes/2026-09-30-egg-ending/plan3-notes.md`: what was built (the commits), the gate output lines, the four frames described, and the open items — the stub's two shots only; the camera cannot yet enter the egg (`eggShade` has no inside-the-shell case; plan 4's "inside" shot needs one); enemies are not frozen during the sequence (only input and damage); the train sway is overridden by the sequence camera; the end title is a DOM overlay (a stand-in); no sound.

`docs/tasks/levels.md` item 4n: append `**Plan 3 done** ([plan](../../docs/superpowers/plans/2026-09-30-night-train-sequence-system.md), [notes](../../docs/dev-notes/2026-09-30-egg-ending/plan3-notes.md)): touching the egg fires egg.touch -> sequence.ending; a pure timeline (ending-sequence.ts) drives the camera and an overlay, freezes input and damage, then completes on ending.end. Two-shot stub. Next: plan 4 (the montage).` In `TASKS.md` update the ending bullet's trailing text to `**Plans 1 (room), 2 (egg pass) and 3 (sequence system) built; next: plan 4, the montage.**` In the spec, change the Status line to `draft, scope B chosen by the owner in chat (2026-09-30); built through plan 3 (the sequence system) with a two-shot stub; the montage (plan 4) is next.`

- [ ] **Step 5: Commit**

```bash
git add scripts/sdf-game-loop-gate.mjs docs/dev-notes/2026-09-30-egg-ending docs/tasks/levels.md TASKS.md docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md
git commit -m "test(ending): loop gate walks the sequence; notes, frames and task board for plan 3

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (run by the plan's author, 2026-09-30)

- **Spec coverage.** §3: pure timeline of shots with duration, cut type, camera, scene params → `Shot` (scene params are the overlay and camera; the "scene selection" per shot — interior/macro/exterior — is **plan 4**, where there is more than one scene to select) ✓ partly, stated in Out of scope; `egg.touch` → command `sequence` → input/vitals frozen → advance on sim clock → renderer reads the current shot through one seam (the camera pass + overlay) → end fires `ending.end` → `completeOn` → black + title instead of the overlay ✓ (the existing "LEVEL COMPLETE" overlay still shows over the black in the end state; the title is on the black); seconds-authored, no beat clock ✓; no sound ✓. §5 level changes: trigger `egg.touch`, `completeOn: ending.end` ✓ (the `nav` point already exists from plan 1). §7 step 3 "two-shot stub" ✓.
- **Placeholders.** None: all code is shown. The loop gate's step API is the one place to verify against `sdf-disco-check.mjs` (stated).
- **Names.** `Sequence`, `Shot`, `CameraSpec`, `OverlaySpec`, `CameraStart`, `CameraPose`, `ShotAt`, `OverlayAt`, `FLASH_S`, `SEQUENCES`, `totalDuration`, `shotAt`, `cameraAt`, `overlayAt` (pure); `SequenceRuntime`, `startSequence`, `stepSequence`, `applySequenceCamera`, `createSequenceSeams`, `ctx.world.sequence`, seams `sequence()` / `startSequence(id)` / `skipSequence()` (leaf); event names `egg.touch`, `sequence.ending`, `ending.end`; shot ids `pull`, `black`; anchor `inner-egg` are used identically across tasks, the level test and the gate.
- **Risks.** (1) The first camera pass captures the player's view from `camera` after the game placed it, including the train sway for that frame; acceptable. (2) `camera.lookAt` after the train roll drops the roll for the sequence; intended. (3) Changing `camera.fov` outside the impact-punch path relies on `fovApplied` bookkeeping staying in sync; the sequence never ends with a restored FOV (it ends in black and complete), and a reload resets it. (4) The loop gate's `levelComplete()` waits for sim steps now; the older `settle()` wait is not enough there.
