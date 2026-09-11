# The Wake 3: Content — Melee, the Bell, Grave Waves — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1, 3 and 4 are pure and dispatchable; Tasks 2 and 5 edit `game-main.ts` (session); Task 6 is the owner's playtest.

**Status:** planned 2026-09-11. Part 3 of 3 for level 0, The Wake.
**Brief:** [docs/game/levels/00-the-wake/implementation.md](../../game/levels/00-the-wake/implementation.md) · **Design:** [design.md](../../game/levels/00-the-wake/design.md) §3 (starting weapon), §4.1 (the bell).
**Depends on:** [Plan 1](2026-09-11-wake-1-level-format.md) Task 1 (types) for Task 4; Plans 1 and 2 complete for Tasks 2, 5, 6. **Base branch:** brief §2 (needs `game-weapon-slots.ts`).

**Goal:** The Wake plays as designed: the goblin starts with a gravedigger's tool (three variants to A/B), shooting the funeral bell tolls it and each toll raises a wave of the dead, and the parlour's mourners turn when you walk in.

**Architecture:** Three pure modules hold the rules: `melee.ts` (swing timing, contact points, view-model pose), `bell.ts` (tolls, re-arm, swing, segment-vs-sphere) and `grave-waves.ts` (queued, capped, staggered spawns). `game-main.ts` adds `melee` as weapon slot 1, samples swing contact points against actor fields and stamps wounds through the existing `hit()` / `hitSlug()`, tests pellets against the bell before level geometry, and turns Plan 2's `wave` and `alert-room` commands into spawns and alerts.

**Tech Stack:** TypeScript, vitest, three r185, no-deps CDP gate.

---

## Facts pinned for the implementer (verified 2026-09-11)

- **Actor damage entry points** (`webgpu/game-actor.ts`): `hit(hitWorld, dirWorld, shot?)` stamps a pellet-sized wound; `hitSlug(hitWorld, dirWorld, shot?)` a large crater. Batch a frame's hits with `beginHits()` … `endHits()`. After stamping, the projectile path calls `registerBleed(actor, stamped, kind)` and `segMeshRenderer?.impact(actor, sources, point, dir, kind)`; melee does the same.
- **The actor's field** for contact tests is `sdBody(point, actor.posed())` (≤ 0 inside the body). The projectile path rejects actors whose torso cluster centre (`posed().clusters.find(c => c.limb === 'torso')?.center`) is farther than 1.35 m from the segment; use the same reject.
- **Weapon slots** (dynamite branch, `webgpu/game-weapon-slots.ts`): `type WeaponSlot = 'shotgun' | 'dynamite'`, `WEAPON_SLOTS`, `SLOT_BY_KEY { Digit1: 'shotgun', Digit2: 'dynamite' }`, `requestSlot`, `stepWeaponSlot`, `slotReady`, `slotLowerAmount(state, slot)` (0 = in frame, 1 = holstered, total over any number of slots).
- **Player projectiles** are resolved in `tick()` in a chain: chunks → `if (!dead && p.pos[1] <= 0.02) dead = true;` → level colliders (point-in-AABB) → actors. The frame segment is `from` → `p.pos`.
- **Runtime spawning** already works through the debug seam `__sdfGame.spawnDebugCharacter(name)`, which calls `spawnEnemy(name, room, start, errs)` and pushes to `actors`. Mirror exactly what it does after spawning.
- **Gunshot alert:** setting `shotAlert = true` makes the encounter director treat the frame as a gunshot: every enemy within 12 m of the player turns toward them.
- **Player forward** is `[sin yaw, 0, -cos yaw]`; positive pitch looks up; yaw increases to the right.
- **Plan 2** provides `emitLevelEvent(event)`, `runLevelCommand(cmd)` with `'wave'` and `'alert-room'` left empty, `inventory`, and `authored` (the active `LevelDef`).

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/lab/sdf-zombie/webgpu/melee.ts` (+ test) | Variants, swing phases, contact points, sweep direction, view-model pose |
| Create `src/lab/sdf-zombie/webgpu/bell.ts` (+ test) | Toll count, re-arm, swing spring, segment-vs-sphere |
| Create `src/lab/sdf-zombie/webgpu/grave-waves.ts` (+ test) | Wave queue, live cap, spawn stagger |
| Modify `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts` (+ test) | Add `melee` as slot 1 |
| Modify `src/lab/sdf-zombie/webgpu/game-main.ts` | Melee slot, swing hits, bell, waves, room alerts, seams |
| Modify `scripts/sdf-game-wake-gate.mjs`, `scripts/sdf-game-dynamite-gate.mjs` | New checks; slot key change |

---

### Task 1: `melee.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/melee.ts`
- Create: `src/lab/sdf-zombie/webgpu/melee.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/melee.test.ts
import { describe, expect, it } from 'vitest';
import {
  MELEE, activeProgress, contactPoints, makeSwing, meleePose, recordHit, startSwing, stepSwing, sweepDir,
} from './melee';

const spec = MELEE.shovel;

describe('swing timing', () => {
  it('runs windup -> active -> recover -> ready', () => {
    let s = startSwing(makeSwing());
    expect(s.phase).toBe('windup');
    s = stepSwing(s, spec.windupSec + 0.01, spec);
    expect(s.phase).toBe('active');
    expect(activeProgress(s, spec)).toBeCloseTo(0.01 / spec.activeSec, 5);
    s = stepSwing(s, spec.activeSec, spec);
    expect(s.phase).toBe('recover');
    expect(activeProgress(s, spec)).toBeNull();
    s = stepSwing(s, spec.recoverSec, spec);
    expect(s.phase).toBe('ready');
  });

  it('ignores a new swing request mid-swing', () => {
    const s = stepSwing(startSwing(makeSwing()), 0.05, spec);
    expect(startSwing(s)).toBe(s);
  });

  it('never skips the active window at the game dt clamp (1/20 s)', () => {
    for (const v of Object.values(MELEE)) expect(v.activeSec).toBeGreaterThan(1 / 20);
  });
});

describe('recordHit', () => {
  it('counts each body once and stops at maxBodies', () => {
    let s = stepSwing(startSwing(makeSwing()), spec.windupSec + 0.01, spec);
    s = recordHit(s, 7, spec)!;
    expect(recordHit(s, 7, spec)).toBeNull();
    s = recordHit(s, 8, spec)!;
    expect(s.hitIds).toEqual([7, 8]);
    expect(recordHit(s, 9, spec)).toBeNull(); // shovel maxBodies = 2
  });
});

describe('contactPoints', () => {
  it('sweeps from the right to the left at reach', () => {
    const eye = [0, 1.6, 0] as const;
    const start = contactPoints(eye, 0, 0, spec, 0);
    const mid = contactPoints(eye, 0, 0, spec, 0.5);
    const end = contactPoints(eye, 0, 0, spec, 1);
    expect(start).toHaveLength(spec.samples);
    expect(start.at(-1)![0]).toBeGreaterThan(0.1);   // right
    expect(Math.abs(mid.at(-1)![0])).toBeLessThan(1e-9);
    expect(end.at(-1)![0]).toBeLessThan(-0.1);       // left
    const far = mid.at(-1)!;
    expect(Math.hypot(far[0] - eye[0], far[1] - eye[1], far[2] - eye[2])).toBeCloseTo(spec.reach, 6);
    expect(far[2]).toBeLessThan(0);                  // yaw 0 faces -z
  });

  it('follows pitch', () => {
    const up = contactPoints([0, 1.6, 0], 0, 0.5, spec, 0.5).at(-1)!;
    expect(up[1]).toBeGreaterThan(1.6);
  });

  it('gives a unit sweep direction', () => {
    const d = sweepDir(0.3, -0.2, spec, 0.4);
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
  });
});

describe('meleePose', () => {
  it('rests at zero and is continuous across phase boundaries', () => {
    expect(meleePose(makeSwing(), spec)).toEqual({ pitch: 0, yaw: 0, roll: 0, forward: 0 });
    const same = (a: Record<string, number>, b: Record<string, number>) => {
      for (const k of Object.keys(a)) expect(a[k]).toBeCloseTo(b[k]!, 9);
    };
    same({ ...meleePose({ phase: 'windup', t: spec.windupSec, hitIds: [] }, spec) },
      { ...meleePose({ phase: 'active', t: 0, hitIds: [] }, spec) });
    same({ ...meleePose({ phase: 'active', t: spec.activeSec, hitIds: [] }, spec) },
      { ...meleePose({ phase: 'recover', t: 0, hitIds: [] }, spec) });
    const recoverEnd = meleePose({ phase: 'recover', t: spec.recoverSec, hitIds: [] }, spec);
    for (const v of Object.values(recoverEnd)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/melee.test.ts`
Expected: FAIL — `Cannot find module './melee'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/melee.ts
//
// MELEE: the goblin's starting gravedigger's tool. Three variants so the owner
// can pick one by playing (design §3). Pure: timing, where the blade is, and a
// view-model pose. game-main samples the contact points against actor fields
// and stamps wounds through the existing hit()/hitSlug().
//
// A swing is windup -> active -> recover. Only `active` can hit. Contact is a
// fan of points along the view direction, swept from right to left across the
// arc over the active window. Each body can be hit once per swing, up to
// `maxBodies` bodies.

import type { Vec3 } from '../types';

export type MeleeVariant = 'shovel' | 'pickaxe' | 'axe';

export interface MeleeSpec {
  windupSec: number;
  activeSec: number;
  recoverSec: number;
  /** Metres from the eye to the far contact point. */
  reach: number;
  /** Total horizontal sweep across the active window, radians. */
  arcRad: number;
  /** Contact points along the view direction per frame. */
  samples: number;
  /** Which existing wound to stamp: 'slug' is the big crater. */
  impact: 'pellet' | 'slug';
  maxBodies: number;
}

export const MELEE: Readonly<Record<MeleeVariant, MeleeSpec>> = {
  /** Flat blade, wide sweep, dents: can catch two bodies. */
  shovel: { windupSec: 0.16, activeSec: 0.14, recoverSec: 0.34, reach: 1.25, arcRad: 1.4, samples: 7, impact: 'slug', maxBodies: 2 },
  /** Narrow point, near-vertical: one body, a small deep puncture, slowest. */
  pickaxe: { windupSec: 0.26, activeSec: 0.10, recoverSec: 0.40, reach: 1.3, arcRad: 0.5, samples: 5, impact: 'pellet', maxBodies: 1 },
  /** Fast diagonal chop: one body, big crater. */
  axe: { windupSec: 0.12, activeSec: 0.12, recoverSec: 0.30, reach: 1.15, arcRad: 1.0, samples: 6, impact: 'slug', maxBodies: 1 },
};

export type SwingPhase = 'ready' | 'windup' | 'active' | 'recover';

export interface SwingState {
  phase: SwingPhase;
  /** Seconds into the current phase. */
  t: number;
  /** Actor ids already hit by this swing. */
  hitIds: readonly number[];
}

export function makeSwing(): SwingState {
  return { phase: 'ready', t: 0, hitIds: [] };
}

export function startSwing(s: SwingState): SwingState {
  return s.phase === 'ready' ? { phase: 'windup', t: 0, hitIds: [] } : s;
}

function phaseDuration(phase: SwingPhase, spec: MeleeSpec): number {
  return phase === 'windup' ? spec.windupSec : phase === 'active' ? spec.activeSec : spec.recoverSec;
}

/** Advance the swing, carrying leftover time across phase boundaries. */
export function stepSwing(s: SwingState, dt: number, spec: MeleeSpec): SwingState {
  if (s.phase === 'ready') return s;
  let phase = s.phase;
  let t = s.t + Math.max(0, dt);
  for (;;) {
    const dur = phaseDuration(phase, spec);
    if (t < dur) break;
    t -= dur;
    if (phase === 'windup') phase = 'active';
    else if (phase === 'active') phase = 'recover';
    else return makeSwing();
  }
  return { phase, t, hitIds: s.hitIds };
}

/** 0..1 through the active window, or null outside it. */
export function activeProgress(s: SwingState, spec: MeleeSpec): number | null {
  return s.phase === 'active' ? Math.min(1, s.t / spec.activeSec) : null;
}

/** The swing with `id` recorded, or null if that body was already hit or the
 *  swing has hit its maximum. */
export function recordHit(s: SwingState, id: number, spec: MeleeSpec): SwingState | null {
  if (s.hitIds.includes(id) || s.hitIds.length >= spec.maxBodies) return null;
  return { ...s, hitIds: [...s.hitIds, id] };
}

function sweepYaw(yaw: number, spec: MeleeSpec, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return yaw + spec.arcRad * (0.5 - p);
}

/** Unit direction of the blade at `progress` (also the wound direction). */
export function sweepDir(yaw: number, pitch: number, spec: MeleeSpec, progress: number): Vec3 {
  const y = sweepYaw(yaw, spec, progress);
  const cp = Math.cos(pitch);
  return [Math.sin(y) * cp, Math.sin(pitch), -Math.cos(y) * cp];
}

/** Contact points from 45% to 100% of reach along the blade direction. */
export function contactPoints(eye: Vec3, yaw: number, pitch: number, spec: MeleeSpec, progress: number): Vec3[] {
  const d = sweepDir(yaw, pitch, spec, progress);
  const pts: Vec3[] = [];
  for (let i = 0; i < spec.samples; i++) {
    const k = spec.samples === 1 ? 1 : i / (spec.samples - 1);
    const dist = spec.reach * (0.45 + 0.55 * k);
    pts.push([eye[0] + d[0] * dist, eye[1] + d[1] * dist, eye[2] + d[2] * dist]);
  }
  return pts;
}

export interface MeleePose {
  /** Radians, applied to the view-model group. */
  pitch: number;
  yaw: number;
  roll: number;
  /** Metres toward the view direction. */
  forward: number;
}

const RAISED: MeleePose = { pitch: -0.9, yaw: 0.35, roll: -0.5, forward: -0.05 };
const FOLLOW: MeleePose = { pitch: 0.8, yaw: -0.55, roll: 0.5, forward: 0.2 };
const REST: MeleePose = { pitch: 0, yaw: 0, roll: 0, forward: 0 };

function mix(a: MeleePose, b: MeleePose, k: number): MeleePose {
  return {
    pitch: a.pitch + (b.pitch - a.pitch) * k, yaw: a.yaw + (b.yaw - a.yaw) * k,
    roll: a.roll + (b.roll - a.roll) * k, forward: a.forward + (b.forward - a.forward) * k,
  };
}

/** Raise back-right in windup, sweep through in active, ease home in recover. */
export function meleePose(s: SwingState, spec: MeleeSpec): MeleePose {
  switch (s.phase) {
    case 'ready': return { ...REST };
    case 'windup': return mix(REST, RAISED, Math.min(1, s.t / spec.windupSec));
    case 'active': return mix(RAISED, FOLLOW, Math.min(1, s.t / spec.activeSec));
    case 'recover': {
      const k = Math.min(1, s.t / spec.recoverSec);
      return mix(FOLLOW, REST, 1 - (1 - k) * (1 - k));
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/melee.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/melee.ts src/lab/sdf-zombie/webgpu/melee.test.ts
git commit -m "feat(weapon): melee — shovel/pickaxe/axe swing timing, contact sweep, view-model pose"
```

---

### Task 2: Melee as weapon slot 1 (session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts`, `src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `scripts/sdf-game-dynamite-gate.mjs` (only if it presses number keys)

- [ ] **Step 1: Add the slot**

In `game-weapon-slots.ts`:

```ts
/** Which weapon the player is holding. `shotgun` is the grapeshot double. */
export type WeaponSlot = 'melee' | 'shotgun' | 'dynamite';

/** Slot order, which is ALSO the number-key order (1 → melee, 2 → shotgun, 3 → dynamite). */
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['melee', 'shotgun', 'dynamite'];

export const SLOT_BY_KEY: Readonly<Record<string, WeaponSlot>> = {
  Digit1: 'melee',
  Digit2: 'shotgun',
  Digit3: 'dynamite',
};
```

Update the header comment's "1 = grapeshot, 2 = dynamite" wording. In
`game-weapon-slots.test.ts`, update only the key-mapping expectations
(`Digit1`/`Digit2`, and add `Digit3`); the state-machine tests are slot-agnostic.
Run `grep -n "Digit[0-9]" scripts/sdf-game-dynamite-gate.mjs`: if the gate presses
keys, change `Digit2` → `Digit3` there. If it uses `__sdfGame.selectSlot('dynamite')`,
leave it.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts` — expected: PASS.

- [ ] **Step 2: Swing state and the view-model**

Near the weapon-slot state in `main()`:

```ts
  // --- MELEE (slot 1). ?melee=shovel|pickaxe|axe picks the variant to A/B.
  const meleeParam = new URLSearchParams(location.search).get('melee');
  let meleeVariant: MeleeVariant = meleeParam === 'pickaxe' || meleeParam === 'axe' ? meleeParam : 'shovel';
  let swing = makeSwing();
  let meleeHits = 0;
  const meleeGroup = new THREE.Group();
  meleeGroup.name = 'melee-viewmodel';
  viewModelAnchor.add(meleeGroup);
  function buildMeleeModel(v: MeleeVariant): void {
    meleeGroup.clear();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x6d6a66, metalness: 0.7, roughness: 0.45 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.85, 10), wood);
    handle.position.set(0, 0.2, 0);
    meleeGroup.add(handle);
    const head = v === 'shovel'
      ? new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.02), iron)
      : v === 'pickaxe'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.05), iron)
        : new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.17), iron);
    head.position.set(v === 'axe' ? 0.08 : 0, 0.66, v === 'shovel' ? 0 : 0);
    meleeGroup.add(head);
    // Rest pose: held low-right, head up and forward.
    meleeGroup.position.set(0.28, -0.42, -0.55);
    meleeGroup.rotation.set(-0.35, 0, -0.2);
    // Register the meshes with the deferred router the same way the gun's view-model
    // meshes are registered (find where the gun GLB's meshes are registered).
  }
  buildMeleeModel(meleeVariant);
```

Imports: `import { MELEE, activeProgress, contactPoints, makeSwing, meleePose, recordHit, startSwing, stepSwing, sweepDir, type MeleeVariant } from './melee';`

- [ ] **Step 3: Input**

In the `mousedown` handler, before the shotgun's `fire(…)` calls:

```ts
    if (weaponSlot.live === 'melee') {
      if (e.button === 0 && slotReady(weaponSlot) && inventory.weapons.includes('melee')) swing = startSwing(swing);
      return;
    }
```

(Use the branch's real slot-state variable name for `weaponSlot`.) Make sure
`fire()` and the dynamite cook/throw code refuse when `live === 'melee'`.

On authored levels, start on the loadout's first slot: where the slot state is
created, use `makeWeaponSlotState(authored ? (authored.loadout[0] as WeaponSlot) : 'shotgun')`.

- [ ] **Step 4: Swing hits in `tick()`**

After the weapon-slot step and before the projectile block:

```ts
    {
      const spec = MELEE[meleeVariant];
      swing = stepSwing(swing, dt, spec);
      const lower = slotLowerAmount(weaponSlot, 'melee');
      meleeGroup.visible = lower < 1;
      const pose = meleePose(swing, spec);
      meleeGroup.position.set(0.28, -0.42 - lower * 0.6, -0.55 - pose.forward);
      meleeGroup.rotation.set(-0.35 + pose.pitch, pose.yaw, -0.2 + pose.roll);

      const progress = activeProgress(swing, spec);
      if (progress !== null) {
        const eye = eyeOf(player);
        const pts = contactPoints(eye, player.yaw, player.pitch, spec, progress);
        const dir = sweepDir(player.yaw, player.pitch, spec, progress);
        for (const a of actors) {
          const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
          if (!c || Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) > spec.reach + 1.35) continue;
          const posedA = a.posed();
          const contact = pts.find(q => sdBody(q, posedA) <= 0.02);
          if (!contact) continue;
          const next = recordHit(swing, a.id, spec);
          if (!next) continue;
          swing = next;
          a.beginHits();
          if (segMeshRenderer) {
            const sources = skeletonSources.get(a)?.sources;
            if (sources) segMeshRenderer.impact(a, sources, contact, dir, spec.impact);
          }
          const stamped = spec.impact === 'slug' ? a.hitSlug(contact, dir) : a.hit(contact, dir);
          if (stamped) registerBleed(a, stamped, spec.impact);
          a.endHits();
          meleeHits++;
          telemetry.event('melee-hit', { actor: a.id, variant: meleeVariant, point: contact, stamped: !!stamped });
          // SOUND: wet thud, pitched per variant
        }
      }
    }
```

If `registerBleed` or `segMeshRenderer.impact` take a kind union that doesn't
include both `'pellet'` and `'slug'`, match their real signatures (they are
called with `p.kind` from the projectile path).

- [ ] **Step 5: Seams**

```ts
    swing: () => { swing = startSwing(swing); return swing.phase; },
    setMelee: (v: MeleeVariant) => { meleeVariant = v; buildMeleeModel(v); return v; },
    meleeStats: () => ({ variant: meleeVariant, hits: meleeHits, phase: swing.phase }),
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: clean, all pass.

Run: `LAB_TMP=.lab-tmp node scripts/sdf-game-dynamite-gate.mjs` via its wrapper if it has one — expected PASS (slot keys updated).

Manual on `?level=the-wake&melee=shovel`: key 1 shows the tool, LMB swings,
a gates zombie takes a crater on contact. Repeat with `&melee=pickaxe` and
`&melee=axe`.

- [ ] **Step 7: Extend the Wake gate and commit**

Add to `scripts/sdf-game-wake-gate.mjs` right after check 3 (before the pickup check):

```js
// 3b. MELEE — start on melee; a swing at the first gates zombie lands.
const phase0 = await evaluate('__sdfGame.meleeStats().phase');
if (phase0 !== 'ready') fail(`melee not ready at start: ${phase0}`);
const zPos = await evaluate(`(() => { const a = __sdfGame.actorList()[0]; return a.pos; })()`);
await evaluate(`__sdfGame.setPose(${zPos[0]}, ${zPos[2] + 0.9}, 0, -0.15)`);
await evaluate('__sdfGame.swing()');
await evaluate('__sdfGame.step(40, 1/60)');
if ((await evaluate('__sdfGame.meleeStats().hits')) < 1) fail('a point-blank swing hit nothing');
pass('melee: a swing at point blank lands');
```

(`actorList()` is a dynamite-branch seam; check its return shape and use the
position field it really has.)

```bash
git add src/lab/sdf-zombie/webgpu/game-weapon-slots.ts src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts \
  src/lab/sdf-zombie/webgpu/game-main.ts scripts/sdf-game-wake-gate.mjs scripts/sdf-game-dynamite-gate.mjs
git commit -m "feat(weapon): melee slot 1 — swing hits stamp wounds; ?melee= variant A/B"
```

---

### Task 3: `bell.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/bell.ts`
- Create: `src/lab/sdf-zombie/webgpu/bell.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/bell.test.ts
import { describe, expect, it } from 'vitest';
import { BELL, hitBell, makeBell, segmentHitsSphere, stepBell } from './bell';

describe('hitBell', () => {
  it('tolls on the first hit and re-arms before the next toll', () => {
    const first = hitBell(makeBell());
    expect(first.toll).toBe(1);
    const volley = hitBell(first.state);       // the rest of a double-barrel volley
    expect(volley.toll).toBeNull();
    expect(volley.state.dents).toBe(2);
    let s = volley.state;
    for (let i = 0; i < 80; i++) s = stepBell(s, 1 / 60);
    expect(s.rearm).toBe(0);
    expect(hitBell(s).toll).toBe(2);
  });

  it('stops tolling after the maximum', () => {
    let s = makeBell();
    const tolls: (number | null)[] = [];
    for (let i = 0; i < BELL.maxTolls + 2; i++) {
      const r = hitBell(s);
      tolls.push(r.toll);
      s = { ...r.state, rearm: 0 };
    }
    expect(tolls).toEqual([1, 2, 3, null, null]);
  });
});

describe('stepBell', () => {
  it('swings when hit and settles back to rest', () => {
    let s = hitBell(makeBell()).state;
    let peak = 0;
    for (let i = 0; i < 60; i++) { s = stepBell(s, 1 / 60); peak = Math.max(peak, Math.abs(s.angle)); }
    expect(peak).toBeGreaterThan(0.05);
    for (let i = 0; i < 600; i++) s = stepBell(s, 1 / 60);
    expect(Math.abs(s.angle)).toBeLessThan(1e-3);
  });
});

describe('segmentHitsSphere', () => {
  it('hits through the middle, misses beside, handles a zero-length segment', () => {
    expect(segmentHitsSphere([-2, 0, 0], [2, 0, 0], [0, 0, 0], 0.5)).toBe(true);
    expect(segmentHitsSphere([-2, 1, 0], [2, 1, 0], [0, 0, 0], 0.5)).toBe(false);
    expect(segmentHitsSphere([0.1, 0, 0], [0.1, 0, 0], [0, 0, 0], 0.5)).toBe(true);
    expect(segmentHitsSphere([2, 0, 0], [3, 0, 0], [0, 0, 0], 0.5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bell.test.ts`
Expected: FAIL — `Cannot find module './bell'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/bell.ts
//
// THE FUNERAL BELL (The Wake design §4.1). Shoot it and it tolls; each toll
// calls a wave of the dead. It re-arms after a beat so one double-barrel volley
// is ONE toll, and it stops tolling after three. Every hit swings it and counts
// a dent (the dent visual is a follow-up). Pure.

import type { Vec3 } from '../types';

export const BELL = {
  maxTolls: 3,
  /** Seconds before the next hit can toll again. */
  rearmSec: 1.2,
  /** Angular velocity added per hit, rad/s. */
  kick: 1.2,
  stiffness: 9,
  damping: 1.6,
} as const;

export interface BellState {
  tolls: number;
  rearm: number;
  /** Swing angle, radians, and its velocity. */
  angle: number;
  angVel: number;
  dents: number;
}

export function makeBell(): BellState {
  return { tolls: 0, rearm: 0, angle: 0, angVel: 0, dents: 0 };
}

export function hitBell(s: BellState): { state: BellState; toll: number | null } {
  const kicked: BellState = { ...s, angVel: s.angVel + BELL.kick, dents: s.dents + 1 };
  if (s.rearm > 0 || s.tolls >= BELL.maxTolls) return { state: kicked, toll: null };
  const tolls = s.tolls + 1;
  return { state: { ...kicked, tolls, rearm: BELL.rearmSec }, toll: tolls };
}

/** Damped spring back to hanging straight; semi-implicit Euler. */
export function stepBell(s: BellState, dt: number): BellState {
  const d = Math.max(0, dt);
  const angVel = s.angVel + (-BELL.stiffness * s.angle - BELL.damping * s.angVel) * d;
  return { ...s, angVel, angle: s.angle + angVel * d, rearm: Math.max(0, s.rearm - d) };
}

/** Does the segment from -> to pass within r of c? */
export function segmentHitsSphere(from: Vec3, to: Vec3, c: Vec3, r: number): boolean {
  const ab: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 > 0
    ? Math.min(1, Math.max(0, ((c[0] - from[0]) * ab[0] + (c[1] - from[1]) * ab[1] + (c[2] - from[2]) * ab[2]) / len2))
    : 0;
  const q: Vec3 = [from[0] + ab[0] * t, from[1] + ab[1] * t, from[2] + ab[2] * t];
  return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) <= r;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bell.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/bell.ts src/lab/sdf-zombie/webgpu/bell.test.ts
git commit -m "feat(wake): bell — tolls, re-arm, swing, segment-vs-sphere"
```

---

### Task 4: `grave-waves.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/grave-waves.ts`
- Create: `src/lab/sdf-zombie/webgpu/grave-waves.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/grave-waves.test.ts
import { describe, expect, it } from 'vitest';
import type { GraveDef } from './level-def';
import { WAVES, enqueueWave, makeWaves, releaseSpawns } from './grave-waves';

const g = (id: string, wave: number): GraveDef => ({ id, wave, pos: [0, 0, 0], yaw: 0 });
const graves = [g('b', 1), g('a', 1), g('c', 2), g('z', 0)];

describe('enqueueWave', () => {
  it('queues one wave in id order, once', () => {
    let s = enqueueWave(makeWaves(), graves, 1);
    expect(s.queue.map(x => x.id)).toEqual(['a', 'b']);
    s = enqueueWave(s, graves, 1);
    expect(s.queue.map(x => x.id)).toEqual(['a', 'b']);
  });
});

describe('releaseSpawns', () => {
  it('releases the first spawn at once, then one per gap', () => {
    let s = enqueueWave(makeWaves(), graves, 1);
    let r = releaseSpawns(s, 0, 0);
    expect(r.spawn.map(x => x.id)).toEqual(['a']);
    r = releaseSpawns(r.state, 1, WAVES.spawnGapSec / 2);
    expect(r.spawn).toEqual([]);
    r = releaseSpawns(r.state, 1, WAVES.spawnGapSec / 2);
    expect(r.spawn.map(x => x.id)).toEqual(['b']);
    s = r.state;
    expect(s.released).toEqual(['a', 'b']);
    expect(enqueueWave(s, graves, 1).queue).toEqual([]); // released graves never re-queue
  });

  it('holds spawns while the live count is at the cap', () => {
    const s = enqueueWave(makeWaves(), graves, 2);
    expect(releaseSpawns(s, WAVES.maxLive, 5).spawn).toEqual([]);
    expect(releaseSpawns(s, WAVES.maxLive - 1, 5).spawn.map(x => x.id)).toEqual(['c']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/grave-waves.test.ts`
Expected: FAIL — `Cannot find module './grave-waves'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/grave-waves.ts
//
// GRAVE WAVES. A wave queues its graves; spawns come out one at a time with a
// short gap (a burst of body builds in one frame would hitch), and never push
// the live enemy count past a cap. Pure.

import type { GraveDef } from './level-def';

export const WAVES = {
  /** Live (not collapsed) enemies allowed before spawns wait. */
  maxLive: 12,
  spawnGapSec: 0.5,
} as const;

export interface WaveState {
  queue: readonly GraveDef[];
  /** Seconds until the next spawn may release. */
  gap: number;
  /** Grave ids already spawned. */
  released: readonly string[];
}

export function makeWaves(): WaveState {
  return { queue: [], gap: 0, released: [] };
}

export function enqueueWave(s: WaveState, graves: readonly GraveDef[], wave: number): WaveState {
  const known = new Set([...s.released, ...s.queue.map(q => q.id)]);
  const add = graves.filter(g => g.wave === wave && !known.has(g.id)).sort((a, b) => a.id.localeCompare(b.id));
  return add.length === 0 ? s : { ...s, queue: [...s.queue, ...add] };
}

export function releaseSpawns(s: WaveState, liveCount: number, dt: number): { state: WaveState; spawn: GraveDef[] } {
  let gap = Math.max(0, s.gap - Math.max(0, dt));
  const queue = [...s.queue];
  const spawn: GraveDef[] = [];
  while (gap <= 0 && queue.length > 0 && liveCount + spawn.length < WAVES.maxLive) {
    spawn.push(queue.shift()!);
    gap += WAVES.spawnGapSec;
  }
  if (spawn.length === 0 && queue.length === 0 && s.queue.length === 0 && gap === s.gap) {
    return { state: s, spawn };
  }
  return { state: { queue, gap, released: [...s.released, ...spawn.map(g => g.id)] }, spawn };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/grave-waves.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/grave-waves.ts src/lab/sdf-zombie/webgpu/grave-waves.test.ts
git commit -m "feat(wake): grave-waves — queued, capped, staggered spawns"
```

---

### Task 5: The bell, waves and room alerts in the game (session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `scripts/sdf-game-wake-gate.mjs`

- [ ] **Step 1: Bells**

After the pickup meshes (Plan 2 Task 5 Step 4):

```ts
  // --- BELLS. A mesh in v1 (dents are a follow-up); hit by pellets only.
  interface BellRuntime { def: BellDef; state: BellState; pivot: THREE.Group }
  const bells: BellRuntime[] = [];
  if (authored) {
    const bronze = new THREE.MeshStandardMaterial({ color: 0x6b4a26, metalness: 0.85, roughness: 0.35 });
    for (const def of authored.bells) {
      const r = def.radius;
      // Lathe profile from the crown (y = 0) down to the lip (y = -1.4r).
      const profile = [
        new THREE.Vector2(0.001, 0), new THREE.Vector2(0.35 * r, -0.05 * r), new THREE.Vector2(0.5 * r, -0.35 * r),
        new THREE.Vector2(0.62 * r, -0.9 * r), new THREE.Vector2(0.95 * r, -1.3 * r), new THREE.Vector2(1.0 * r, -1.4 * r),
      ];
      const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), bronze);
      shell.material.side = THREE.DoubleSide;
      const pivot = new THREE.Group();
      pivot.position.set(def.pos[0], def.pos[1] + 0.7 * r, def.pos[2]);
      pivot.add(shell);
      scene.add(pivot);
      // Register shell with the deferred router like other level-only meshes.
      bells.push({ def, state: makeBell(), pivot });
    }
  }
  function hitBellRuntime(b: BellRuntime): number | null {
    const r = hitBell(b.state);
    b.state = r.state;
    if (r.toll !== null) {
      emitLevelEvent(`bell.toll.${r.toll}`);
      telemetry.event('bell-toll', { bell: b.def.id, toll: r.toll });
      // SOUND: the toll, ducking every other sound; later tolls flatter and wetter
    }
    return r.toll;
  }
```

Imports: `BellDef` from `./level-def`; `hitBell, makeBell, segmentHitsSphere, stepBell, type BellState` from `./bell`.

In the player projectile chain, **before** the level-collider block
(`if (!dead) { // Level geometry: …`):

```ts
        if (!dead) {
          for (const b of bells) {
            if (segmentHitsSphere(from, p.pos, b.def.pos, b.def.radius)) { hitBellRuntime(b); dead = true; break; }
          }
        }
```

In `tick(dt)`, alongside the pickup spin:

```ts
    for (const b of bells) { b.state = stepBell(b.state, dt); b.pivot.rotation.x = b.state.angle; }
```

- [ ] **Step 2: Waves**

```ts
  let waves = makeWaves();
```

In `runLevelCommand` (Plan 2), fill the empty cases:

```ts
      case 'wave':
        if (authored) waves = enqueueWave(waves, authored.graves, cmd.wave);
        break;
      case 'alert-room':
        // Approximation: a gunshot alert turns every enemy within 12 m of the
        // player. The Wake's parlour trigger is placed so the mourners are 3–11 m away.
        shotAlert = true;
        break;
```

In `tick(dt)`, after the level-events block:

```ts
    if (authored && waves.queue.length > 0) {
      const live = actors.filter(a => !a.motionFrame()?.collapsed).length;
      const r = releaseSpawns(waves, live, dt);
      waves = r.state;
      for (const grave of r.spawn) {
        const room = roomAtPoint(authored, grave.pos[0], grave.pos[2]);
        if (!room) continue;
        const errs: string[] = [];
        // Mirror __sdfGame.spawnDebugCharacter: spawn, push, and whatever it
        // does afterwards (hull rebuild flags, deferred registration, culling lists).
        const actor = spawnEnemy('zombie', room, grave.pos, errs);
        actors.push(actor);
        if (errs.length) console.error(`[sdf-game] grave ${grave.id}:`, errs.join(' | '));
        telemetry.event('grave-rise', { grave: grave.id, wave: grave.wave, actor: actor.id });
        // SOUND: earth breaking. VISUAL: a dust burst at the grave (reuse the smoke puffs if
        // trivial); the climb-out animation is a follow-up (brief §3).
      }
    }
```

Imports: `enqueueWave, makeWaves, releaseSpawns` from `./grave-waves`.

- [ ] **Step 3: Seams**

```ts
    bells: () => bells.map(b => ({ id: b.def.id, tolls: b.state.tolls, rearm: b.state.rearm, dents: b.state.dents })),
    hitBell: (id: string) => { const b = bells.find(x => x.def.id === id); return b ? hitBellRuntime(b) : null; },
    waves: () => ({ queued: waves.queue.map(g => g.id), released: [...waves.released] }),
```

- [ ] **Step 4: Extend the Wake gate**

Add before the `// 7. COMPLETE` block (the page is still the first, non-god boot;
if check 6 killed the player, reload first with `&god` using the same loop as
check 7):

```js
// 6b. BELL + WAVES — a toll opens the slab and releases wave 1; a second hit
// inside the re-arm does not toll; after the re-arm it tolls again.
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=the-wake&god` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object" && typeof __sdfGame.hitBell === "function"')) break;
}
const before = await evaluate('__sdfGame.actorList().length');
if ((await evaluate('__sdfGame.hitBell("funeral-bell")')) !== 1) fail('first bell hit did not toll 1');
if ((await evaluate('__sdfGame.hitBell("funeral-bell")')) !== null) fail('a hit inside the re-arm tolled');
await evaluate('__sdfGame.step(120, 1/60)');
const lv = await evaluate('__sdfGame.level()');
if (!lv.openGates.includes('crypt-slab')) fail('toll 1 did not open the crypt slab');
const after = await evaluate('__sdfGame.actorList().length');
if (after - before !== 3) fail(`wave 1 should add 3 zombies, added ${after - before}`);
if ((await evaluate('__sdfGame.hitBell("funeral-bell")')) !== 2) fail('bell did not toll 2 after re-arming');
pass('bell: toll 1 opens the crypt and raises 3; re-arm holds; toll 2 follows');
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: clean, all pass.

Run: `LAB_TMP=.lab-tmp scripts/sdf-game-wake-gate.sh`
Expected: every `ok` line and `PASS sdf-game-wake-gate`.

Manual on `?level=the-wake`: shoot the bell from the graveyard, watch it swing,
the crypt slab vanishes, three zombies appear at their graves half a second
apart. Walk into the parlour: the mourners turn.

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts scripts/sdf-game-wake-gate.mjs
git commit -m "feat(wake): the funeral bell tolls waves out of the graves; parlour mourners turn"
```

---

### Task 6: Owner playtest and performance check (session, owner)

**Files:**
- Modify: `docs/game/levels/00-the-wake/design.md` (record decisions)
- Modify: `TASKS.md`

- [ ] **Step 1: Melee A/B.** Play the gates beat three times: `?level=the-wake&melee=shovel`, `&melee=pickaxe`, `&melee=axe`. The owner picks one. Record it in design §3 and change the default in `game-main.ts` (`let meleeVariant … : '<chosen>'`).
- [ ] **Step 2: Full run.** Play start to CD without seams. Note: time taken (target 5–8 min), deaths, where it dragged, whether the bell read as shootable without being told, whether wave sizes felt right.
- [ ] **Step 3: Performance.** In the graveyard after all three tolls (the most bodies on screen), run the in-page bench: `await __sdfGame.bench({ mode: 'passes' })`. (Check `game-bench.ts` for the options an authored level accepts; the `room` option indexes the ring.) Record the p50/p95 frame ms next to the ring's latest bench numbers in TASKS.md.
- [ ] **Step 4: Tuning.** Adjust only data: grave/spawn positions in the `.blend` (re-export), `VITALS`, `PICKUP`, `WAVES`, `BELL`. Re-run the Wake gate.
- [ ] **Step 5: Commit**

```bash
git add docs/game/levels/00-the-wake/design.md TASKS.md src/lab/sdf-zombie/webgpu/game-main.ts \
  assets-source/levels/the-wake.blend public/assets/levels/the-wake.level.json
git commit -m "tune(wake): owner playtest — melee variant chosen, wave and pickup tuning, bench recorded"
```

---

### Risks

- **Runtime spawn hitch.** `spawnEnemy` builds a GPU view; half a second between spawns spreads it, but a hitch per spawn is likely. Pre-building a pool of hidden zombies at boot is the follow-up if it shows.
- **Melee through walls.** Contact points don't test level colliders. At 1.3 m reach it's hard to notice; add a `clearSight(eye, contact, colliders)` check if playtest finds it.
- **Alert approximation.** `alert-room` uses the gunshot flag (12 m from the player), not the room. Fine for the parlour; a real per-room alert needs a director seam.
- **The bell ignores dynamite.** Only pellets toll it. A blast within range tolling it is a natural follow-up.
