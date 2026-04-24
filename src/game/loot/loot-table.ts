/**
 * Loot-table infrastructure: weighted random drops with conditional rules.
 *
 * Inspired by Blood's item-drop tables on enemy death and secret-room
 * containers. Each table is an array of entries; a single `roll()` call
 * selects one entry by weighted random and checks any condition guards.
 */

import type { Vec3 } from '../gibs/particles';

// ——— Types ————————————————————————————————————————————————————————

/** A single loot entry: a reward object with a weight and an optional condition. */
export interface LootEntry<T extends object = Record<string, unknown>> {
  /** Weight — higher probability linearly. Must be > 0. */
  weight: number;
  /** The reward produced when this entry wins the roll. */
  reward: T;
  /** Optional guard: called at roll time; if false, the entry is skipped. */
  condition?: (context: RollContext) => boolean;
}

/** Runtime context passed into condition guards. */
export interface RollContext {
  playerPos: Vec3;
  playerHP: number;
  damageDealt: number;
  isGib: boolean;
}

/**
 * A loot table: an ordered list of weighted entries.
 * Entries with failing conditions are filtered out before rolling.
 */
export class LootTable<T extends object = Record<string, unknown>> {
  readonly entries: ReadonlyArray<LootEntry<T>>;

  constructor(entries: LootEntry<T>[]) {
    for (const entry of entries) {
      if (entry.weight <= 0) {
        throw new Error(`Loot entry weight must be > 0, got ${entry.weight}`);
      }
    }
    this.entries = entries;
  }

  /**
   * Rolls the loot table, returning the reward of the winning entry or null.
   *
   * Entries with a failing `condition` are filtered out before the weighted
   * random selection is performed. No re-roll or retry logic is applied.
   */
  roll(rng: () => number, ctx: RollContext): T | null {
    const survivors = this.entries.filter((e) => !e.condition || e.condition(ctx));
    if (survivors.length === 0) return null;

    const totalWeight = survivors.reduce((sum, e) => sum + e.weight, 0);
    if (totalWeight <= 0) return null;

    let r = rng() * totalWeight;
    for (const entry of survivors) {
      r -= entry.weight;
      if (r <= 0) return entry.reward;
    }
    return survivors[survivors.length - 1]!.reward;
  }
}

export function makeLootTable<T extends object>(
  entries: { reward: T; condition?: (ctx: RollContext) => boolean }[],
): LootTable<T> {
  return new LootTable(
    entries.map(e => ({ weight: 1, reward: e.reward, condition: e.condition })),
  );
}

export function createLootTable<T extends object>(
  entries: { weight: number; reward: T; condition?: (ctx: RollContext) => boolean }[],
): LootTable<T> {
  return new LootTable(
    entries.map(e => ({ weight: e.weight, reward: e.reward, condition: e.condition })),
  );
}
