import { describe, it, expect } from 'vitest';
import { LootTable, createLootTable, makeLootTable } from './loot-table';
import type { RollContext } from './loot-table';

// ——— Helper: seeded RNG —————————————————————————————————————

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % (2 ** 32);
    return s / (2 ** 32);
  };
}

// ——— Helpers: fixture LootTable ———————————————————————————

const mockCtx: RollContext = {
  playerPos: { x: 0, y: 0, z: 0 },
  playerHP: 100,
  damageDealt: 30,
  isGib: false,
};

// ——— Weight validation ——————————————————————————————————————

describe('weight validation', () => {
  it('throws if any entry has weight 0', () => {
    expect(() => createLootTable([{ weight: 0, reward: { type: 'nothing' } }])).toThrow();
  });

  it('throws if any entry has negative weight', () => {
    expect(() => createLootTable([{ weight: -5, reward: { type: 'nothing' } }])).toThrow();
  });
});

// ——— Empty table ————————————————————————————————————————————

describe('empty table', () => {
  it('returns null for zero entries', () => {
    const table = createLootTable([]);
    expect(table.roll(seeded(42), mockCtx)).toBeNull();
  });
});

// ——— Weighted selection ———————————————————————————————————

describe('weighted selection', () => {
  it('picks from a single-entry table', () => {
    const table = createLootTable([{ weight: 1, reward: { type: 'health_vial' } }]);
    expect(table.roll(seeded(42), mockCtx)).toEqual({ type: 'health_vial' });
  });

  it('always picks something when conditions are absent', () => {
    const table = createLootTable([
      { weight: 1, reward: { type: 'a' } },
      { weight: 1, reward: { type: 'b' } },
    ]);
    for (let i = 0; i < 100; i++) {
      const result = table.roll(seeded(i), mockCtx);
      expect(result).not.toBeNull();
      expect(['a', 'b']).toContain(result!.type);
    }
  });

  it('respects weight ratios over many rolls', () => {
    const table = createLootTable([
      { weight: 70, reward: { type: 'common' } },
      { weight: 25, reward: { type: 'uncommon' } },
      { weight: 5, reward: { type: 'rare' } },
    ]);
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 10000; i++) {
      const result = table.roll(seeded(i), mockCtx);
      expect(result).not.toBeNull();
      const t = result!.type as 'common' | 'uncommon' | 'rare';
      counts[t]++;
    }
    const commonPct = counts.common / 10000;
    const rarePct = counts.rare / 10000;
    // Allow ±5% tolerance for seeded-RNG variance
    expect(commonPct).toBeGreaterThan(0.6);
    expect(commonPct).toBeLessThan(0.8);
    expect(rarePct).toBeGreaterThan(0.01);
    expect(rarePct).toBeLessThan(0.09);
  });
});

// ——— Conditional guards ———————————————————————————————————

describe('conditional guards', () => {
  it('skips entries whose condition is false', () => {
    const table = createLootTable([
      { weight: 1, reward: { type: 'health_vial' }, condition: () => false },
      { weight: 1, reward: { type: 'rare' } },
    ]);
    // Entries with false conditions are filtered out before selection.
    let foundRare = false;
    for (let s = 0; s < 256; s++) {
      const r = table.roll(seeded(s), mockCtx);
      if (r?.type === 'rare') { foundRare = true; break; }
    }
    expect(foundRare).toBe(true);
  });

  it('returns null when all entries fail', () => {
    const table = createLootTable([
      {
        weight: 10,
        reward: { type: 'health_vial' },
        condition: () => false,
      },
    ]);
    expect(table.roll(seeded(42), mockCtx)).toBeNull();
  });

  it('passes entries whose condition is true', () => {
    const table = createLootTable([
      {
        weight: 10,
        reward: { type: 'health_vial' },
        condition: () => true,
      },
      { weight: 1, reward: { type: 'rare' } },
    ]);
    const result = table.roll(seeded(42), mockCtx);
    expect(result).toEqual({ type: 'health_vial' });
  });

  it('uses context in condition — health-only drop below threshold', () => {
    const table = createLootTable([
      {
        weight: 50,
        reward: { type: 'health_vial', amount: 25 },
        condition: (ctx) => ctx.damageDealt < 40,
      },
    ]);
    // damageDealt = 30 → condition passes
    expect(table.roll(seeded(42), mockCtx)?.type).toBe('health_vial');
    // damageDealt = 50 → condition fails → null
    const highDmgCtx: RollContext = { ...mockCtx, damageDealt: 50 };
    expect(table.roll(seeded(42), highDmgCtx)).toBeNull();
  });
});

// ——— fromEntries / makeLootTable ————————————————————————————

describe('makeLootTable (implicit equal weights)', () => {
  it('assigns weight=1 to every entry', () => {
    const table = makeLootTable([
      { reward: { type: 'a' } },
      { reward: { type: 'b' } },
    ]);
    const results = new Set<string>();
    const rng = seeded(42);
    for (let i = 0; i < 100; i++) {
      const r = table.roll(rng, mockCtx);
      expect(r).not.toBeNull();
      results.add(r!.type);
    }
    expect(results).toEqual(new Set(['a', 'b']));
  });
});

// ——— createLootTable with explicit weights ——————————————————

describe('createLootTable with explicit weights', () => {
  it('respects weight ordering', () => {
    const table = createLootTable([
      { weight: 1, reward: { type: 'low' } },
      { weight: 10, reward: { type: 'high' } },
    ]);
    let highCount = 0;
    for (let i = 0; i < 1000; i++) {
      const r = table.roll(seeded(i), mockCtx);
      if (r?.type === 'high') highCount++;
    }
    // ~90% should be 'high'
    expect(highCount).toBeGreaterThan(800);
  });
});
