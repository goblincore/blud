// src/lab/sdf-zombie/zombie-variants.test.ts
import { describe, it, expect } from 'vitest';
import { ZOMBIE_VARIANTS, spawnRoll, zombieVariantFor } from './zombie-variants';
import { CHARACTERS } from './character-registry';

const LEVELS = import.meta.glob('../../../public/assets/levels/*.level.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const zombieIds = (level: string): string[] =>
  (JSON.parse(LEVELS[`../../../public/assets/levels/${level}.level.json`]!) as
    { spawns: { id: string; kind: string }[] }).spawns.filter(s => s.kind === 'zombie').map(s => s.id);

describe('zombie variants', () => {
  it('every variant is a registered character', () => {
    for (const v of ZOMBIE_VARIANTS) expect(CHARACTERS[v.name], v.name).toBeDefined();
  });

  it('rolls are stable and in [0, 1)', () => {
    for (const id of ['coats-1', 'coats-2', 'ring-0-3', '']) {
      const r = spawnRoll(id);
      expect(r).toBe(spawnRoll(id));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('takes about its share of many slots, the rest stay plain zombies', () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `slot-${i}`);
    const fat = ids.filter(id => zombieVariantFor(id) === 'zombie-fat').length / ids.length;
    expect(fat).toBeGreaterThan(0.22);
    expect(fat).toBeLessThan(0.28);
    expect(ids.every(id => ['zombie', 'zombie-fat'].includes(zombieVariantFor(id)))).toBe(true);
  });

  it('a zero share never fires and a full share always does', () => {
    expect(zombieVariantFor('coats-1', [{ name: 'zombie-fat', share: 0 }])).toBe('zombie');
    expect(zombieVariantFor('coats-1', [{ name: 'zombie-fat', share: 1 }])).toBe('zombie-fat');
  });

  // The mix the levels actually get. A change to the hash or the share moves these seats: update them on purpose.
  it('mixes fat zombies into Night Train and The Wake, a minority of each', () => {
    const nt = zombieIds('night-train').filter(id => zombieVariantFor(id) === 'zombie-fat');
    expect(nt).toEqual(['c1-sleeper', 'dancer-1', 'third-slumped-2', 'third-slumped-3', 'waiter-1']);
    const wake = zombieIds('the-wake').filter(id => zombieVariantFor(id) === 'zombie-fat');
    expect(wake.length).toBeGreaterThan(0);
    expect(wake.length).toBeLessThan(zombieIds('the-wake').length / 2);
  });
});
