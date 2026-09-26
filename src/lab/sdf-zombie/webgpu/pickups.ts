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
  /** A first shotgun comes loaded, with this many more in the reserve. */
  shotgunReserve: 4,
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
          if (p.item === 'shotgun') inv = { ...inv, shellsReserve: Math.min(PICKUP.maxReserve, inv.shellsReserve + PICKUP.shotgunReserve) };
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
