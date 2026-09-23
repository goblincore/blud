# The Wake 2: Game Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1–3 are pure and dispatchable; Tasks 4–6 edit `game-main.ts` and run the browser gate (session).

**Status:** planned 2026-09-11. Part 2 of 3 for level 0, The Wake.
**Brief:** [docs/game/levels/00-the-wake/implementation.md](../../game/levels/00-the-wake/implementation.md).
**Depends on:** [Plan 1](2026-09-11-wake-1-level-format.md) Tasks 1–2 (types in `level-def.ts`) for Tasks 1–3; Plan 1 Tasks 5–6 for Tasks 4–6. **Base branch** for Tasks 4–6: brief §2 (needs the dynamite weapon-slot work).

**Goal:** The SDF FPS becomes a game: the player has health, takes damage, can die and restart, picks things up, triggers level events, and finishes a level.

**Architecture:** Three pure modules hold all the rules (`player-vitals.ts`, `pickups.ts`, `level-events.ts`); `game-main.ts` only feeds them positions and events and draws the result. Damage hooks into the two places enemies already "hit": the zombie actor's `onMeleeContact` callback and the soldier pellet loop. Death reloads the page. A DOM status bar shows health and ammo.

**Tech Stack:** TypeScript, vitest, three r185, no-deps CDP gate.

---

## Changes since Plan 1's revision (2026-09-23) — read before Tasks 4–6

Plan 1 now implements Level Format v1 ([spec](../specs/2026-09-23-level-format-design.md)).
Where this plan's wiring steps say:
- `authored` → use `ctx.world.level.def` (null on the ring);
- `openGates` / `openGate(id)` → `ctx.world.openGates` / the `openGate` Plan 1 Task 6 added;
- `roomAtPoint(authored, …)` → unchanged, from `level-def.ts`;
- new state as `let` bindings in `main()` → put it on a `ctx` slice or a feature
  module instead (`docs/superpowers/plan-template.md`; `npm test -- game-context`).
`PickupItem` now includes `'dynamite'` (the Wake has one in the crypt); Task 2's
`collectPickups` handles it like `melee` (see the `case` below).

## Facts pinned for the implementer (verified 2026-09-11)

- **There is no player health today.** `game-main.ts` says so in the soldier-pellet doc block ("There is no player health in the SDF game, so these hit nothing at all").
- **Zombie melee contact** is already emitted: `createZombieActor` accepts `onMeleeContact?: (event: { actorId: number; variant: SwingVariant }) => void` (`game-actor.ts`, "Diagnostic/gameplay contact pulse"). `game-main.ts` does not pass it.
- **Soldier pellets** are stepped in `tick()` after the player's projectiles: `const soldierFrom = soldierPellets.map(p => [...p.pos] as Vec3); stepProjectiles(soldierPellets, dt);` then a loop that removes pellets on `expired` or `segmentHitsBox` against `colliders`. They are never tested against the player.
- **The player** is `PlayerState { pos (feet), vel, yaw, pitch, grounded }`, capsule `PLAYER.radius = 0.32`, `PLAYER.height = 1.75` (`game-player.ts`).
- **Ammo** (on the dynamite branch): unlimited by default; `?ammo=finite` or `__sdfGame.setInfiniteAmmo(false)` restores the 2-shell magazine. Reload is `startReload()`; the magazine refills where the reload completes (find `shells = MAGAZINE_CAPACITY`).
- **HUD** today is one debug text line in `#hud` (`sdf-game.html`), written by `updateHud()`. Leave it; add a separate status bar.
- **Level types** (`PickupDef`, `TriggerDef`, `GateDef`, `LevelDef`) come from `webgpu/level-def.ts` (Plan 1 Task 1).

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/lab/sdf-zombie/webgpu/player-vitals.ts` (+ test) | Health, damage kinds, melee invulnerability, pellet-vs-capsule test |
| Create `src/lab/sdf-zombie/webgpu/pickups.ts` (+ test) | Inventory, pickup collection rules, reload from reserve |
| Create `src/lab/sdf-zombie/webgpu/level-events.ts` (+ test) | Enter-triggers, gate opening, event → command mapping |
| Modify `sdf-game.html` | Status bar, death and level-complete overlays |
| Modify `src/lab/sdf-zombie/webgpu/game-main.ts` | Wire damage, death, HUD, pickups, triggers, gates, completion |
| Modify `scripts/sdf-game-wake-gate.mjs` | Damage, death, pickup, completion checks |

---

### Task 1: `player-vitals.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/player-vitals.ts`
- Create: `src/lab/sdf-zombie/webgpu/player-vitals.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/player-vitals.test.ts
import { describe, expect, it } from 'vitest';
import {
  VITALS, applyDamage, heal, makeVitals, segmentHitsCapsule, stepVitals,
} from './player-vitals';

describe('vitals', () => {
  it('starts full and alive', () => {
    expect(makeVitals()).toEqual({ health: VITALS.maxHealth, meleeInvulnSec: 0, dead: false, hurtAge: Infinity });
  });

  it('takes damage and marks the hit', () => {
    const v = applyDamage(makeVitals(), 12, 'pellet');
    expect(v.health).toBe(VITALS.maxHealth - 12);
    expect(v.hurtAge).toBe(0);
    expect(v.meleeInvulnSec).toBe(0);
  });

  it('ignores a second melee hit inside the invulnerability window, but not pellets', () => {
    let v = applyDamage(makeVitals(), 10, 'melee');
    expect(v.meleeInvulnSec).toBe(VITALS.meleeInvulnSec);
    expect(applyDamage(v, 10, 'melee').health).toBe(v.health);
    expect(applyDamage(v, 3, 'pellet').health).toBe(v.health - 3);
    v = stepVitals(v, VITALS.meleeInvulnSec + 0.01);
    expect(applyDamage(v, 10, 'melee').health).toBe(v.health - 10);
  });

  it('dies at zero and stays dead', () => {
    const v = applyDamage(makeVitals(), 500, 'pellet');
    expect(v).toMatchObject({ health: 0, dead: true });
    expect(applyDamage(v, 5, 'pellet')).toBe(v);
    expect(heal(v, 50)).toBe(v);
  });

  it('heals up to the maximum', () => {
    const hurt = applyDamage(makeVitals(), 40, 'pellet');
    expect(heal(hurt, 25).health).toBe(VITALS.maxHealth - 15);
    expect(heal(hurt, 1000).health).toBe(VITALS.maxHealth);
  });

  it('ages the hurt timer and never goes negative on invulnerability', () => {
    const v = stepVitals(applyDamage(makeVitals(), 5, 'melee'), 10);
    expect(v.meleeInvulnSec).toBe(0);
    expect(v.hurtAge).toBe(10);
  });
});

describe('segmentHitsCapsule', () => {
  const feet = [0, 0, 0] as const;
  const r = 0.32, h = 1.75;
  it('hits a pellet crossing the chest', () => {
    expect(segmentHitsCapsule([-1, 1.2, 0], [1, 1.2, 0], feet, r, h)).toBe(true);
  });
  it('misses a pellet passing a metre to the side', () => {
    expect(segmentHitsCapsule([-1, 1.2, 1], [1, 1.2, 1], feet, r, h)).toBe(false);
  });
  it('misses a pellet over the head', () => {
    expect(segmentHitsCapsule([-1, 2.3, 0], [1, 2.3, 0], feet, r, h)).toBe(false);
  });
  it('hits a pellet that starts and ends inside', () => {
    expect(segmentHitsCapsule([0.1, 1, 0], [0.1, 1, 0], feet, r, h)).toBe(true);
  });
  it('hits a fast pellet whose frame segment jumps across the body', () => {
    expect(segmentHitsCapsule([0, 1, -0.8], [0, 1, 0.8], feet, r, h)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/player-vitals.test.ts`
Expected: FAIL — `Cannot find module './player-vitals'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/player-vitals.ts
//
// PLAYER HEALTH. Pure numbers so the rules are testable without a renderer.
// Two damage kinds, because they arrive differently: a zombie swing reports one
// contact per swing but can re-report while arms overlap, so melee gets a short
// invulnerability window; soldier pellets arrive as several separate pellets in
// one volley and each one should count.

import type { Vec3 } from '../types';

export const VITALS = {
  maxHealth: 100,
  /** One zombie swing. */
  zombieHit: 12,
  /** One soldier pellet (a volley is up to 8). */
  soldierPellet: 3,
  /** After a melee hit, further melee is ignored for this long. */
  meleeInvulnSec: 0.4,
} as const;

export type DamageKind = 'melee' | 'pellet';

export interface Vitals {
  health: number;
  meleeInvulnSec: number;
  dead: boolean;
  /** Seconds since the last damage; drives the hurt flash. */
  hurtAge: number;
}

export function makeVitals(): Vitals {
  return { health: VITALS.maxHealth, meleeInvulnSec: 0, dead: false, hurtAge: Infinity };
}

export function applyDamage(v: Vitals, amount: number, kind: DamageKind): Vitals {
  if (v.dead || amount <= 0) return v;
  if (kind === 'melee' && v.meleeInvulnSec > 0) return v;
  const health = Math.max(0, v.health - amount);
  return {
    health,
    dead: health <= 0,
    hurtAge: 0,
    meleeInvulnSec: kind === 'melee' ? VITALS.meleeInvulnSec : v.meleeInvulnSec,
  };
}

export function heal(v: Vitals, amount: number): Vitals {
  if (v.dead) return v;
  return { ...v, health: Math.min(VITALS.maxHealth, v.health + Math.max(0, amount)) };
}

export function stepVitals(v: Vitals, dt: number): Vitals {
  const d = Math.max(0, dt);
  return { ...v, meleeInvulnSec: Math.max(0, v.meleeInvulnSec - d), hurtAge: v.hurtAge + d };
}

/** Does a pellet's frame segment pass within `radius` of the player's capsule
 *  axis (a vertical segment from feet+radius to feet+height−radius)? Sampled
 *  along the segment at half-radius steps: exact enough for pellets, and a
 *  fast pellet cannot skip the body because the step is fixed in metres. */
export function segmentHitsCapsule(from: Vec3, to: Vec3, feet: Vec3, radius: number, height: number): boolean {
  const lo = feet[1] + radius;
  const hi = feet[1] + height - radius;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const n = Math.max(1, Math.ceil(len / (radius * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = from[0] + (to[0] - from[0]) * t;
    const py = from[1] + (to[1] - from[1]) * t;
    const pz = from[2] + (to[2] - from[2]) * t;
    const ay = Math.min(hi, Math.max(lo, py));
    if (Math.hypot(px - feet[0], py - ay, pz - feet[2]) <= radius) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/player-vitals.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/player-vitals.ts src/lab/sdf-zombie/webgpu/player-vitals.test.ts
git commit -m "feat(game): player-vitals — health, damage kinds, pellet-vs-capsule"
```

---

### Task 2: `pickups.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/pickups.ts`
- Create: `src/lab/sdf-zombie/webgpu/pickups.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/pickups.test.ts
import { describe, expect, it } from 'vitest';
import type { PickupDef } from './level-def';
import { PICKUP, collectPickups, makeInventory, reloadFromReserve } from './pickups';
import { VITALS, applyDamage, makeVitals } from './player-vitals';

const at = (id: string, item: PickupDef['item'], x: number, z: number): PickupDef => ({ id, item, pos: [x, 0.2, z] });

describe('collectPickups', () => {
  it('collects only what is within reach, once', () => {
    const defs = [at('near', 'shells', 0.5, 0), at('far', 'shells', 3, 0)];
    const first = collectPickups(defs, new Set(), [0, 0, 0], makeInventory(), makeVitals());
    expect(first.collected.map(p => p.id)).toEqual(['near']);
    expect(first.inventory.shellsReserve).toBe(PICKUP.shells);
    const again = collectPickups(defs, first.taken, [0, 0, 0], first.inventory, first.vitals);
    expect(again.collected).toEqual([]);
  });

  it('leaves health on the floor when the player is already full', () => {
    const defs = [at('h', 'health', 0, 0)];
    expect(collectPickups(defs, new Set(), [0, 0, 0], makeInventory(), makeVitals()).collected).toEqual([]);
    const hurt = applyDamage(makeVitals(), 40, 'pellet');
    const r = collectPickups(defs, new Set(), [0, 0, 0], makeInventory(), hurt);
    expect(r.vitals.health).toBe(VITALS.maxHealth - 40 + PICKUP.health);
    expect(r.taken.has('h')).toBe(true);
  });

  it('caps the shell reserve and leaves shells when full', () => {
    const inv = { ...makeInventory(), shellsReserve: PICKUP.maxReserve };
    expect(collectPickups([at('s', 'shells', 0, 0)], new Set(), [0, 0, 0], inv, makeVitals()).collected).toEqual([]);
    const nearly = { ...makeInventory(), shellsReserve: PICKUP.maxReserve - 2 };
    expect(collectPickups([at('s', 'shells', 0, 0)], new Set(), [0, 0, 0], nearly, makeVitals())
      .inventory.shellsReserve).toBe(PICKUP.maxReserve);
  });

  it('adds a weapon, and a duplicate shotgun gives shells instead', () => {
    const r = collectPickups([at('g', 'shotgun', 0, 0)], new Set(), [0, 0, 0], makeInventory(['melee']), makeVitals());
    expect(r.inventory.weapons).toEqual(['melee', 'shotgun']);
    const dup = collectPickups([at('g2', 'shotgun', 0, 0)], new Set(), [0, 0, 0], r.inventory, makeVitals());
    expect(dup.inventory.weapons).toEqual(['melee', 'shotgun']);
    expect(dup.inventory.shellsReserve).toBe(PICKUP.shells);
  });

  it('adds dynamite as a weapon, once', () => {
    const r = collectPickups([at('d', 'dynamite', 0, 0)], new Set(), [0, 0, 0], makeInventory(['melee']), makeVitals());
    expect(r.inventory.weapons).toEqual(['melee', 'dynamite']);
    expect(collectPickups([at('d2', 'dynamite', 0, 0)], new Set(), [0, 0, 0], r.inventory, makeVitals()).collected).toEqual([]);
  });

  it('records CDs by pickup id', () => {
    const r = collectPickups([at('the-wake-cd', 'cd', 0, 0)], new Set(), [0, 0, 0], makeInventory(), makeVitals());
    expect(r.inventory.cds).toEqual(['the-wake-cd']);
  });

  it('does nothing for a dead player', () => {
    const dead = applyDamage(makeVitals(), 999, 'pellet');
    expect(collectPickups([at('s', 'shells', 0, 0)], new Set(), [0, 0, 0], makeInventory(), dead).collected).toEqual([]);
  });
});

describe('reloadFromReserve', () => {
  it('fills the magazine from the reserve', () => {
    expect(reloadFromReserve(0, 2, { ...makeInventory(), shellsReserve: 5 }))
      .toEqual({ shells: 2, inventory: { ...makeInventory(), shellsReserve: 3 } });
  });
  it('loads what is left when the reserve is short', () => {
    expect(reloadFromReserve(0, 2, { ...makeInventory(), shellsReserve: 1 }).shells).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/pickups.test.ts`
Expected: FAIL — `Cannot find module './pickups'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/pickups.ts
//
// PICKUPS AND INVENTORY. Pure. Classic rules: health and shells stay on the
// floor when you can't use them; a second copy of a weapon you own gives its
// ammo; CDs are remembered by pickup id (the flat's collection reads them later).

import type { Vec3 } from '../types';
import type { PickupDef } from './level-def';
import { VITALS, heal, type Vitals } from './player-vitals';

export const PICKUP = {
  /** Horizontal reach, metres, from the player's feet. */
  radius: 0.9,
  shells: 8,
  health: 25,
  maxReserve: 40,
} as const;

export interface Inventory {
  /** Owned weapon names, in pickup order ('melee', 'shotgun', 'dynamite'). */
  weapons: readonly string[];
  shellsReserve: number;
  cds: readonly string[];
}

export function makeInventory(weapons: readonly string[] = []): Inventory {
  return { weapons: [...weapons], shellsReserve: 0, cds: [] };
}

export interface PickupResult {
  taken: ReadonlySet<string>;
  inventory: Inventory;
  vitals: Vitals;
  collected: PickupDef[];
}

export function collectPickups(
  defs: readonly PickupDef[],
  taken: ReadonlySet<string>,
  feet: Vec3,
  inventory: Inventory,
  vitals: Vitals,
): PickupResult {
  let inv = inventory;
  let v = vitals;
  const next = new Set(taken);
  const collected: PickupDef[] = [];
  if (v.dead) return { taken: next, inventory: inv, vitals: v, collected };

  for (const p of defs) {
    if (next.has(p.id)) continue;
    if (Math.hypot(p.pos[0] - feet[0], p.pos[2] - feet[2]) > PICKUP.radius) continue;
    switch (p.item) {
      case 'health':
        if (v.health >= VITALS.maxHealth) continue;
        v = heal(v, PICKUP.health);
        break;
      case 'shells':
        if (inv.shellsReserve >= PICKUP.maxReserve) continue;
        inv = { ...inv, shellsReserve: Math.min(PICKUP.maxReserve, inv.shellsReserve + PICKUP.shells) };
        break;
      case 'cd':
        inv = { ...inv, cds: [...inv.cds, p.id] };
        break;
      case 'shotgun':
      case 'melee':
      case 'dynamite':
        if (!inv.weapons.includes(p.item)) {
          inv = { ...inv, weapons: [...inv.weapons, p.item] };
        } else if (p.item === 'shotgun') {
          if (inv.shellsReserve >= PICKUP.maxReserve) continue;
          inv = { ...inv, shellsReserve: Math.min(PICKUP.maxReserve, inv.shellsReserve + PICKUP.shells) };
        } else {
          continue;
        }
        break;
    }
    next.add(p.id);
    collected.push(p);
  }
  return { taken: next, inventory: inv, vitals: v, collected };
}

/** Top the magazine up from the reserve. */
export function reloadFromReserve(shells: number, capacity: number, inv: Inventory): { shells: number; inventory: Inventory } {
  const take = Math.min(Math.max(0, capacity - shells), inv.shellsReserve);
  return { shells: shells + take, inventory: { ...inv, shellsReserve: inv.shellsReserve - take } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/pickups.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/pickups.ts src/lab/sdf-zombie/webgpu/pickups.test.ts
git commit -m "feat(game): pickups — inventory, collection rules, reload from reserve"
```

---

### Task 3: `level-events.ts` (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-events.ts`
- Create: `src/lab/sdf-zombie/webgpu/level-events.test.ts`

The event vocabulary is documented in `docs/game/levels/blender-conventions.md`
(Plan 1 Task 3): `wave.<n>`, `bell.toll.<n>`, `alert.room.<id>`, `pickup.<item>`,
and the level's `completeOn`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/level-events.test.ts
import { describe, expect, it } from 'vitest';
import type { GateDef, TriggerDef } from './level-def';
import { commandsFor, gatesOpenedBy, makeTriggerState, stepTriggers } from './level-events';

const trig = (id: string, event: string, once = true): TriggerDef =>
  ({ id, event, once, box: { min: [0, 0, 0], max: [2, 2, 2] } });

describe('stepTriggers', () => {
  it('fires on entering, not while standing inside', () => {
    const defs = [trig('t', 'wave.0', false)];
    let s = makeTriggerState();
    let r = stepTriggers(defs, s, [5, 0, 5]);
    expect(r.events).toEqual([]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual(['wave.0']);
    r = stepTriggers(defs, r.state, [1.2, 0, 1]);
    expect(r.events).toEqual([]);
    r = stepTriggers(defs, r.state, [5, 0, 5]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual(['wave.0']); // not once: re-entering fires again
    s = r.state;
    expect(s.spent.size).toBe(0);
  });

  it('fires a once-trigger a single time', () => {
    const defs = [trig('t', 'alert.room.4')];
    let r = stepTriggers(defs, makeTriggerState(), [1, 0, 1]);
    expect(r.events).toEqual(['alert.room.4']);
    r = stepTriggers(defs, r.state, [5, 0, 5]);
    r = stepTriggers(defs, r.state, [1, 0, 1]);
    expect(r.events).toEqual([]);
  });
});

describe('gatesOpenedBy', () => {
  const gates: GateDef[] = [{ id: 'slab', opensOn: 'bell.toll.1', box: { min: [0, 0, 0], max: [1, 1, 1] } }];
  it('opens a gate on its event and keeps earlier ones open', () => {
    expect([...gatesOpenedBy(gates, new Set(), ['wave.0'])]).toEqual([]);
    const open = gatesOpenedBy(gates, new Set(['other']), ['bell.toll.1']);
    expect([...open].sort()).toEqual(['other', 'slab']);
  });
});

describe('commandsFor', () => {
  it('maps the event vocabulary to commands', () => {
    expect(commandsFor('wave.2', 'pickup.cd')).toEqual([{ kind: 'wave', wave: 2 }]);
    expect(commandsFor('bell.toll.1', 'pickup.cd')).toEqual([{ kind: 'wave', wave: 1 }]);
    expect(commandsFor('alert.room.4', 'pickup.cd')).toEqual([{ kind: 'alert-room', room: 4 }]);
    expect(commandsFor('pickup.cd', 'pickup.cd')).toEqual([{ kind: 'complete' }]);
    expect(commandsFor('pickup.shells', 'pickup.cd')).toEqual([]);
    expect(commandsFor('wave.x', 'pickup.cd')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-events.test.ts`
Expected: FAIL — `Cannot find module './level-events'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/level-events.ts
//
// LEVEL EVENTS. Triggers fire string events when the player walks in; gates
// open on events; a small vocabulary of events turns into commands the game
// carries out. Pure: game-main feeds positions and applies commands.

import type { Vec3 } from '../types';
import type { GateDef, TriggerDef } from './level-def';

export interface TriggerState {
  /** Triggers the player was inside last step (edge detection). */
  inside: ReadonlySet<string>;
  /** Once-triggers that have fired. */
  spent: ReadonlySet<string>;
}

export function makeTriggerState(): TriggerState {
  return { inside: new Set(), spent: new Set() };
}

export function stepTriggers(defs: readonly TriggerDef[], state: TriggerState, feet: Vec3): { state: TriggerState; events: string[] } {
  const inside = new Set<string>();
  const spent = new Set(state.spent);
  const events: string[] = [];
  for (const t of defs) {
    const b = t.box;
    const inBox = feet[0] >= b.min[0] && feet[0] <= b.max[0]
      && feet[1] >= b.min[1] - 0.1 && feet[1] <= b.max[1]
      && feet[2] >= b.min[2] && feet[2] <= b.max[2];
    if (!inBox) continue;
    inside.add(t.id);
    if (state.inside.has(t.id) || spent.has(t.id)) continue;
    events.push(t.event);
    if (t.once) spent.add(t.id);
  }
  return { state: { inside, spent }, events };
}

export function gatesOpenedBy(gates: readonly GateDef[], open: ReadonlySet<string>, events: readonly string[]): Set<string> {
  const next = new Set(open);
  for (const g of gates) if (events.includes(g.opensOn)) next.add(g.id);
  return next;
}

export type LevelCommand =
  | { kind: 'wave'; wave: number }
  | { kind: 'alert-room'; room: number }
  | { kind: 'complete' };

/** What an event asks the game to do. `bell.toll.<n>` also calls wave n. */
export function commandsFor(event: string, completeOn: string): LevelCommand[] {
  const out: LevelCommand[] = [];
  if (event === completeOn) out.push({ kind: 'complete' });
  const wave = /^(?:wave|bell\.toll)\.(\d+)$/.exec(event);
  if (wave) out.push({ kind: 'wave', wave: Number(wave[1]) });
  const alert = /^alert\.room\.(\d+)$/.exec(event);
  if (alert) out.push({ kind: 'alert-room', room: Number(alert[1]) });
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-events.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/level-events.ts src/lab/sdf-zombie/webgpu/level-events.test.ts
git commit -m "feat(game): level-events — enter triggers, gates, event commands"
```

---

### Task 4: Damage, death and the status bar (session)

**Files:**
- Modify: `sdf-game.html`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

Health applies on **every** level, including the ring. Add `?god` to turn damage
off for tuning passes and benches.

- [ ] **Step 1: Add the status bar and overlays to `sdf-game.html`**

Inside `<style>`:

```css
#status { position: fixed; left: 16px; bottom: 14px; pointer-events: none;
  font: 700 18px/1.2 ui-monospace, Menlo, monospace; color: #f2e6d0;
  text-shadow: 0 2px 0 #000; letter-spacing: .06em; }
#status .low { color: #ff5a3c; }
#hurt { position: fixed; inset: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(160, 0, 0, .55) 100%); }
.overlay { position: fixed; inset: 0; display: none; place-items: center; background: rgba(0, 0, 0, .6);
  font: 700 42px/1.2 ui-monospace, Menlo, monospace; color: #f2e6d0; text-align: center; }
.overlay small { display: block; font-size: 16px; margin-top: 12px; opacity: .8; }
.overlay.on { display: grid; }
```

Next to `<div id="hud">`:

```html
<div id="status"></div>
<div id="hurt"></div>
<div id="death" class="overlay"><div>YOU DIED<small>click to restart</small></div></div>
<div id="complete" class="overlay"><div>LEVEL COMPLETE<small>click to play again</small></div></div>
```

- [ ] **Step 2: Vitals state and the status bar**

Near the other gameplay state in `main()` (by `let shells = MAGAZINE_CAPACITY`):

```ts
  // --- PLAYER VITALS. ?god turns damage off for tuning passes and benches.
  const godMode = new URLSearchParams(location.search).has('god');
  let vitals = makeVitals();
  /** Set when the level's completeOn event fires (Task 5). */
  let levelDone = false;
  const statusEl = document.getElementById('status');
  const hurtEl = document.getElementById('hurt');
  const deathEl = document.getElementById('death');
  function damagePlayer(amount: number, kind: DamageKind): void {
    if (godMode || levelDone) return;
    const before = vitals;
    vitals = applyDamage(vitals, amount, kind);
    if (vitals === before) return;
    telemetry.event('player-hurt', { amount, kind, health: vitals.health });
    // SOUND: goblin wheeze (pitch by remaining health)
    if (vitals.dead) onPlayerDeath();
    updateStatus();
  }
  function updateStatus(): void {
    if (!statusEl) return;
    const low = vitals.health <= 25 ? ' class="low"' : '';
    statusEl.innerHTML = `<span${low}>HEALTH ${vitals.health}</span>`;
  }
  function onPlayerDeath(): void {
    // SOUND: death giggle, music cuts
    deathEl?.classList.add('on');
    document.exitPointerLock?.();
  }
  deathEl?.addEventListener('click', () => location.reload());
  updateStatus();
```

Import at the top: `import { VITALS, applyDamage, makeVitals, segmentHitsCapsule, stepVitals, type DamageKind } from './player-vitals';`

Plan 2 Task 5 extends `updateStatus()` with ammo and weapon.

- [ ] **Step 3: Zombie swings hurt**

In `spawnEnemy`, add to the `createZombieActor({ … })` options:

```ts
      onMeleeContact: () => damagePlayer(VITALS.zombieHit, 'melee'),
```

`onMeleeContact` fires when a swing connects (the actor already checks contact
and that it isn't collapsed). If a zombie can hit the player from further than
arm's reach, check `game-actor.ts`'s contact condition before adding any
distance check of your own.

- [ ] **Step 4: Soldier pellets hurt**

Replace the soldier-pellet removal loop:

```ts
      for (let i = soldierPellets.length - 1; i >= 0; i--) {
        if (expired(soldierPellets[i]!) || colliders.some(box =>
          segmentHitsBox(soldierFrom[i]!, soldierPellets[i]!.pos, box))) soldierPellets.splice(i, 1);
      }
```

with:

```ts
      for (let i = soldierPellets.length - 1; i >= 0; i--) {
        const p = soldierPellets[i]!;
        if (expired(p) || colliders.some(box => segmentHitsBox(soldierFrom[i]!, p.pos, box))) {
          soldierPellets.splice(i, 1);
        } else if (segmentHitsCapsule(soldierFrom[i]!, p.pos, player.pos, PLAYER.radius, PLAYER.height)) {
          damagePlayer(VITALS.soldierPellet, 'pellet');
          soldierPellets.splice(i, 1);
        }
      }
```

Update the comment block above it that says soldier pellets "hit nothing at all":
they now hit the player (still never actors).

- [ ] **Step 5: Tick the vitals; freeze input when dead**

At the start of `tick(dt)`, after the `simLocked` return:

```ts
    vitals = stepVitals(vitals, dt);
    if (hurtEl) hurtEl.style.opacity = String(Math.max(0, 0.9 - vitals.hurtAge * 2.5));
```

Where `input` is built from `keys`, zero it when dead or done:

```ts
    if (vitals.dead || levelDone) input = { x: 0, z: 0, jump: false };
```

And at the top of the `mousedown` handler and inside `fire(...)`:

```ts
    if (vitals.dead || levelDone) return;   // in mousedown
    if (vitals.dead || levelDone) return false;   // first line of fire()
```

When dead, drop the camera: where the camera is placed from `eyeOf(player)`,
lower it to 0.35 m and roll it:

```ts
    const deathT = vitals.dead ? Math.min(1, vitals.hurtAge / 0.6) : 0;
    // after camera.position is set from the eye:
    camera.position.y -= (PLAYER.eye - 0.35) * deathT;
    camera.rotation.z = 0.5 * deathT;
```

(Find how the camera orientation is set: if it uses `camera.rotation.set(...)`
or a quaternion, apply the roll in that same call instead of overwriting it.)

- [ ] **Step 6: Seams**

In `__sdfGame`:

```ts
    vitals: () => ({ ...vitals }),
    damagePlayer: (amount: number, kind: DamageKind = 'pellet') => { damagePlayer(amount, kind); return { ...vitals }; },
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: clean, all pass.

Run: `LAB_TMP=.lab-tmp scripts/sdf-game-shorty-gate.sh`
Expected: PASS. If a zombie kills the player mid-gate, pin `&god` in that gate's
URL and record why in its header (the same pattern as `?ammo=finite`).

Manual: `/sdf-game.html?level=the-wake`, let a zombie reach you: health drops
in steps of 12, the screen edge flashes red, at 0 the camera drops and "YOU DIED"
appears; clicking reloads.

- [ ] **Step 8: Commit**

```bash
git add sdf-game.html src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(game): player health — zombie swings and soldier pellets hurt, death + restart, ?god"
```

---

### Task 5: Pickups, loadout, finite ammo, triggers, gates, completion (session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

Applies to authored levels (`authored !== null`). The ring keeps today's
behaviour (all weapons, unlimited ammo, no pickups).

- [ ] **Step 1: Inventory, taken pickups, trigger state**

After the vitals block (Task 4 Step 2):

```ts
  // --- INVENTORY + LEVEL STATE (authored levels). The ring owns everything.
  let inventory = authored ? makeInventory(authored.loadout) : makeInventory(['melee', 'shotgun', 'dynamite']);
  let takenPickups: ReadonlySet<string> = new Set();
  let triggerState = makeTriggerState();
  const pendingEvents: string[] = [];
  function emitLevelEvent(event: string): void { pendingEvents.push(event); }
  const completeEl = document.getElementById('complete');
  completeEl?.addEventListener('click', () => location.reload());
```

Imports: `collectPickups, makeInventory, reloadFromReserve` from `./pickups`;
`commandsFor, gatesOpenedBy, makeTriggerState, stepTriggers` from `./level-events`.

- [ ] **Step 2: Finite ammo from the level**

After the dynamite branch's unlimited-ammo flag is initialised (find `setInfiniteAmmo`
and the variable it sets):

```ts
  if (authored?.ammo === 'finite') setInfiniteAmmo(false);
```

If `setInfiniteAmmo` refills the magazine on the way out, that's fine at boot.
Then, where a reload completes and the magazine is refilled (the assignment that
sets `shells` back to `MAGAZINE_CAPACITY`), draw from the reserve on authored
finite-ammo levels:

```ts
      if (authored?.ammo === 'finite') {
        const r = reloadFromReserve(shells, MAGAZINE_CAPACITY, inventory);
        shells = r.shells;
        inventory = r.inventory;
      } else {
        shells = MAGAZINE_CAPACITY;
      }
```

And make `startReload()` a no-op when the reserve is empty on a finite level:

```ts
    if (authored?.ammo === 'finite' && inventory.shellsReserve <= 0) return; // SOUND: dry click
```

- [ ] **Step 3: Only owned weapons can be selected**

In the keydown slot handler (dynamite branch: `slotForKey(e.code)` then
`requestSlot`), refuse slots the inventory doesn't own:

```ts
    const slot = slotForKey(e.code);
    if (slot && inventory.weapons.includes(slot)) weaponSlot = requestSlot(weaponSlot, slot);
```

(Use the real state variable name from the branch.) On an authored level the
starting slot is `authored.loadout[0]`. Until Plan 3 adds the `melee` slot, the
Wake starts with nothing selectable; `fire()` must refuse when the live slot
is not in `inventory.weapons`.

- [ ] **Step 4: Render pickups**

After the level meshes are built:

```ts
  /** Simple spinning stand-ins until real pickup models exist. */
  const pickupMeshes = new Map<string, THREE.Mesh>();
  if (authored) {
    const look: Record<string, { geo: THREE.BufferGeometry; color: number }> = {
      shotgun: { geo: new THREE.BoxGeometry(0.7, 0.08, 0.12), color: 0x8a6a4a },
      shells: { geo: new THREE.BoxGeometry(0.18, 0.12, 0.12), color: 0xc23a2a },
      health: { geo: new THREE.OctahedronGeometry(0.16), color: 0xe8e0d0 },
      cd: { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.012, 32), color: 0xd8e4ff },
      melee: { geo: new THREE.BoxGeometry(0.08, 0.8, 0.08), color: 0x6b5a45 },
    };
    for (const p of authored.pickups) {
      const l = look[p.item]!;
      const mesh = new THREE.Mesh(l.geo, new THREE.MeshStandardMaterial({
        color: l.color, emissive: l.color, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4,
      }));
      mesh.position.set(p.pos[0], Math.max(0.25, p.pos[1]), p.pos[2]);
      if (p.item === 'cd') mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      // Register with the deferred router the same way other level-only meshes are
      // (look for deferredApi.router.register(…, 'mesh', …)).
      pickupMeshes.set(p.id, mesh);
    }
  }
```

- [ ] **Step 5: Run pickups, triggers, events and gates each tick**

In `tick(dt)`, right after `stepPlayer(...)`:

```ts
    if (authored && !vitals.dead && !levelDone) {
      const hadShotgun = inventory.weapons.includes('shotgun');
      const picked = collectPickups(authored.pickups, takenPickups, player.pos, inventory, vitals);
      if (picked.collected.length > 0) {
        takenPickups = picked.taken;
        inventory = picked.inventory;
        vitals = picked.vitals;
        for (const p of picked.collected) {
          pickupMeshes.get(p.id)?.removeFromParent();
          emitLevelEvent(`pickup.${p.item}`);
          if (p.item === 'shotgun' && !hadShotgun) {
            weaponSlot = requestSlot(weaponSlot, 'shotgun'); // switch to a newly found gun
          }
          // SOUND: pickup chime per item
        }
        updateStatus();
      }
      const t = stepTriggers(authored.triggers, triggerState, player.pos);
      triggerState = t.state;
      for (const ev of t.events) emitLevelEvent(ev);

      if (pendingEvents.length > 0) {
        const events = pendingEvents.splice(0);
        const nowOpen = gatesOpenedBy(authored.gates, openGates, events);
        for (const id of nowOpen) if (!openGates.has(id)) openGate(id);
        for (const ev of events) {
          telemetry.event('level-event', { event: ev });
          for (const cmd of commandsFor(ev, authored.completeOn)) runLevelCommand(cmd);
        }
      }
    }
    for (const m of pickupMeshes.values()) m.rotation.y += dt * 1.6;
```

And the command runner (near `emitLevelEvent`):

```ts
  function runLevelCommand(cmd: LevelCommand): void {
    switch (cmd.kind) {
      case 'complete':
        levelDone = true;
        completeEl?.classList.add('on');
        document.exitPointerLock?.();
        // SOUND: the pull-back begins here once the flat exists (flat F-T3)
        break;
      case 'alert-room':
      case 'wave':
        // Plan 3 Task 5 implements these.
        break;
    }
  }
```

- [ ] **Step 6: Ammo and weapon in the status bar**

Extend `updateStatus()`:

```ts
    const ammo = authored?.ammo === 'finite' && inventory.weapons.includes('shotgun')
      ? `   SHELLS ${shells} | ${inventory.shellsReserve}` : '';
    statusEl.innerHTML = `<span${low}>HEALTH ${vitals.health}</span>${ammo}`;
```

Call `updateStatus()` wherever `updateHud()` is called after a shot or reload.

- [ ] **Step 7: Seams**

```ts
    inventory: () => ({ ...inventory, weapons: [...inventory.weapons], cds: [...inventory.cds] }),
    pickupsLeft: () => authored ? authored.pickups.filter(p => !takenPickups.has(p.id)).map(p => p.id) : [],
    emitLevelEvent: (event: string) => { emitLevelEvent(event); },
    levelComplete: () => levelDone,
```

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: clean, all pass.

Manual on `?level=the-wake`: the shotgun can't be selected at the start; walking
onto it picks it up and switches to it; shells show `2 | 0` then grow when shell
pickups are collected; walking into the open-grave trigger logs a `wave.0` level
event (Plan 3 spawns it); `__sdfGame.emitLevelEvent('bell.toll.1')` opens the
crypt slab; standing at the coffin picks up the CD and shows LEVEL COMPLETE.

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(game): pickups, loadout, finite ammo, triggers, gates and level completion for authored levels"
```

---

### Task 6: Extend the Wake gate (session)

**Files:**
- Modify: `scripts/sdf-game-wake-gate.mjs`

- [ ] **Step 1: Add checks before the final `PASS` line**

```js
// 4. LOADOUT + PICKUP — no shotgun at the start; standing on it collects it.
let inv = await evaluate('__sdfGame.inventory()');
if (inv.weapons.includes('shotgun')) fail(`started with the shotgun: ${JSON.stringify(inv.weapons)}`);
await evaluate('__sdfGame.setPose(0, -18.6, 0, 0)');
await evaluate('__sdfGame.step(10, 1/60)');
inv = await evaluate('__sdfGame.inventory()');
if (!inv.weapons.includes('shotgun')) fail('standing on the sawn-off did not collect it');
pass('pickup: the sawn-off is collected from the open grave');

// 5. EVENTS — the bell's first toll opens the crypt slab.
await evaluate('__sdfGame.emitLevelEvent("bell.toll.1")');
await evaluate('__sdfGame.step(2, 1/60)');
const lvl = await evaluate('__sdfGame.level()');
if (!lvl.openGates.includes('crypt-slab')) fail(`bell.toll.1 did not open the slab: ${JSON.stringify(lvl.openGates)}`);
pass('events: bell.toll.1 opens the crypt slab');

// 6. DAMAGE + DEATH — seam damage kills; input stops; the overlay shows.
await evaluate('__sdfGame.damagePlayer(30, "pellet")');
if ((await evaluate('__sdfGame.vitals().health')) !== 70) fail('30 damage did not leave 70 health');
await evaluate('__sdfGame.damagePlayer(500, "pellet")');
if (!(await evaluate('__sdfGame.vitals().dead'))) fail('500 damage did not kill');
if (!(await evaluate('document.getElementById("death").classList.contains("on")'))) fail('death overlay not shown');
pass('damage: health drops, death shows the overlay');

// 7. COMPLETE — reload clean, stand at the coffin, collect the CD.
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=the-wake&frozen&god` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object" && typeof __sdfGame.levelComplete === "function"')) break;
}
await evaluate('__sdfGame.setPose(0, -78.3, 0, 0)');
await evaluate('__sdfGame.step(10, 1/60)');
if (!(await evaluate('__sdfGame.levelComplete()'))) fail('standing at the coffin did not complete the level');
pass('complete: the CD ends the level');
```

- [ ] **Step 2: Run it**

Run: `LAB_TMP=.lab-tmp scripts/sdf-game-wake-gate.sh`
Expected: seven `ok` lines, `PASS sdf-game-wake-gate`.

- [ ] **Step 3: Commit**

```bash
git add scripts/sdf-game-wake-gate.mjs
git commit -m "test(game): Wake gate — pickup, events, damage and death, completion"
```

---

### Risks

- **Existing gates may now die.** Gates that walk the player into zombies can fail from damage. Pin `&god` with a header note rather than weakening health.
- **`onMeleeContact` frequency** is unmeasured as a damage signal. If swings land far more or less often than they look, tune `VITALS.zombieHit` and `meleeInvulnSec` from a playtest, not in the code review.
- **Reload wiring differs on the dynamite branch.** Step 2 of Task 5 names the pattern; find the real sites before editing.
