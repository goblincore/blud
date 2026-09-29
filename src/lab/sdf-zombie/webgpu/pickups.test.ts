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
    expect(r.inventory.shellsReserve).toBe(PICKUP.shotgunReserve);
    const dup = collectPickups([at('g2', 'shotgun', 0, 0)], new Set(), [0, 0, 0], r.inventory, makeVitals());
    expect(dup.inventory.weapons).toEqual(['melee', 'shotgun']);
    expect(dup.inventory.shellsReserve).toBe(PICKUP.shotgunReserve + PICKUP.shells);
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

describe('the flashlight pickup (dynamic light §2.1)', () => {
  const torch: PickupDef = { id: 'torch', item: 'flashlight', pos: [0, 1.4, 0] };
  it('is taken once and marks the inventory', () => {
    const r = collectPickups([torch], new Set(), [0.3, 0, 0], makeInventory(), makeVitals());
    expect(r.inventory.flashlight).toBe(true);
    expect(r.collected.map(p => p.id)).toEqual(['torch']);
    const again = collectPickups([{ ...torch, id: 'torch-2' }], r.taken, [0, 0, 0], r.inventory, r.vitals);
    expect(again.collected).toEqual([]);
  });
  it('starts false', () => { expect(makeInventory().flashlight).toBe(false); });
});
