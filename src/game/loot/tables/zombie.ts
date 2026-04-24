/**
 * Loot drop tables for zombie enemies (axe-zombie, shambler, etc.).
 *
 * Blood does not have a formal loot-table system — items drop from
 * specific map tiles (crates, barrels, corpses) and from the player's
 * starting inventory. We approximate this with a weighted roll on enemy
 * death to give the roguelike loop a "loot from kills" feel.
 *
 * Drop philosophy (Blood-inspired):
 *   - Health vials are common but not trivial — they keep pressure on.
 *     Blood starts you with 25 HP and heals bring you to 100 (25-vial).
 *   - Ammo drops are rare — Blood ammo is scarce and precious.
 *   - Bones from zombies are flavor drops (collected for later use).
 *   - Health-only condition: drop health vials only when player is below
 *     50 HP so the game doesn't trivialise the HP pool.
 */

import { LootTable } from '../loot-table';
import type { RollContext } from '../loot-table';

// ——— Item definitions ———————————————————————————————————————

/** Shape of a single loot drop item. */
export interface ZombieLootItem {
  /** Unique identifier — used for UI display and collection tracking. */
  type: string;
  /** Quantity dropped. */
  amount: number;
}

// ——— Default zombie loot table ————————————————————————————

/**
 * Base zombie death table. Entries are weighted; higher weight = more common.
 *
 * Blood source reference (approximate):
 *   - Health vials drop from containers at ~1 per room; we emulate this
 *     frequency via weight 50 relative to ammo (weight 15).
 *   - Ammo in Blood is typically 3-6 per pickup; we use 5 as a sweet spot.
 *   - Bones are flavor-only at weight 30 — they accumulate across kills.
 *   - Rare drop (dynamite) weight 5 — Blood gives dynamite in very specific
 *     locations, this mirrors that rarity.
 */
export const ZOMBIE_LOOT_TABLE: LootTable<ZombieLootItem> = new LootTable<ZombieLootItem>([
  // Health — common, only when player is below 50 HP.
  {
    weight: 50,
    reward: { type: 'health_vial', amount: 25 },
    condition: (ctx: RollContext) => ctx.playerHP < 50,
  },

  // Bones — common flavor drops from humanoid gibs.
  {
    weight: 30,
    reward: { type: 'bone', amount: 1 },
  },

  // Ammo — uncommon. Blood ammo pickups are rare.
  {
    weight: 15,
    reward: { type: 'ammo_bullets', amount: 5 },
  },

  // Dynamite — rare. Mirrors Blood's very specific dynamite locations.
  {
    weight: 5,
    reward: { type: 'dynamite_bundle', amount: 1 },
  },
]);

// ——— Gib-only bonus table —————————————————————————————

/**
 * Bonus table rolled when the enemy is gibbed (killed in a single hit
 * above the gib threshold). Gibs get a small chance of extra drops.
 *
 * Blood: gib death is the most violent — extra blood FX, chunks, and
 * occasionally an extra item from the corpse. We model the "extra" as
 * a separate, low-weight table.
 *
 * Actual probabilities (weights sum to 27):
 *   health: 10/27 ≈ 37%
 *   ammo:   15/27 ≈ 56%
 *   dynamite: 2/27 ≈ 7%
 */
export const ZOMBIE_GIB_BONUS_TABLE: LootTable<ZombieLootItem> = new LootTable<ZombieLootItem>([
  // Extra health vial — ~37% (10/27).
  {
    weight: 10,
    reward: { type: 'health_vial', amount: 25 },
    condition: (ctx: RollContext) => ctx.playerHP < 50,
  },

  // Extra ammo — ~56% (15/27).
  {
    weight: 15,
    reward: { type: 'ammo_bullets', amount: 5 },
  },

  // Rare: dynamite — ~7% (2/27).
  {
    weight: 2,
    reward: { type: 'dynamite_bundle', amount: 1 },
  },
]);

// ——— Utility ————————————————————————————————————————————————

/**
 * Roll a zombie death loot table. Returns an array of drops — a single
 * zombie can drop multiple item types if the table design calls for it.
 *
 * @param rng — deterministic PRNG for testing.
 * @param ctx — roll context (player HP, damage dealt, gib flag).
 * @returns Array of loot items; may be empty.
 *
 * @example
 *   const drops = rollZombieLoot(rng, { playerHP: 30, damageDealt: 30, isGib: false });
 *   // → [{ type: 'bone', amount: 1 }, { type: 'health_vial', amount: 25 }]
 */
export function rollZombieLoot(
  rng: () => number,
  ctx: RollContext,
): ZombieLootItem[] {
  const items: ZombieLootItem[] = [];

  const tableRoll = (table: LootTable<ZombieLootItem>) => {
    const result = table.roll(rng, ctx);
    if (result) items.push(result);
  };

  tableRoll(ZOMBIE_LOOT_TABLE);
  if (ctx.isGib) {
    tableRoll(ZOMBIE_GIB_BONUS_TABLE);
  }

  return items;
}
