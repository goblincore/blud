// src/lab/sdf-zombie/webgpu/game-state-weapon.test.ts
//
// The weapon slice is a bag of mutable fields with no logic of its own, so the
// test pins the contract the codemod leans on: the factory hands out private
// objects (no shared arrays or nested aim object), the literal boot defaults are
// exactly what game-main.ts declares, and every old binding name resolves to a
// field that exists on the state.

import { describe, expect, it } from 'vitest';
import { WEAPON_BINDINGS, makeWeaponState } from './game-state-weapon';

describe('makeWeaponState', () => {
  it('gives each call its own object', () => {
    expect(makeWeaponState()).not.toBe(makeWeaponState());
  });

  it('gives each call its own nested arrays and objects', () => {
    const a = makeWeaponState();
    const b = makeWeaponState();
    expect(a.muzzleNodes).not.toBe(b.muzzleNodes);
    expect(a.pellets).not.toBe(b.pellets);
    expect(a.burstSlots).not.toBe(b.burstSlots);
    expect(a.aim).not.toBe(b.aim);
    expect(a.gunMaterials).not.toBe(b.gunMaterials);
  });

  it('starts at the declared defaults', () => {
    const s = makeWeaponState();
    // Literal initializers in game-main.ts: pendingFire = 0, fireBarrels = 1,
    // reloadSpeed = 1, pinnedReloadSeed = null, shotAlert = false,
    // reloadSeed = 0, recoilPitch = 0.
    expect(s.pendingFire).toBe(0);
    expect(s.fireBarrels).toBe(1);
    expect(s.reloadSpeed).toBe(1);
    expect(s.pinnedReloadSeed).toBeNull();
    expect(s.shotAlert).toBe(false);
    expect(s.reloadSeed).toBe(0);
    expect(s.recoilPitch).toBe(0);
  });
});

describe('WEAPON_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makeWeaponState();
    for (const [oldName, path] of Object.entries(WEAPON_BINDINGS)) {
      expect(path.startsWith('weapon.'), `${oldName} must map into the weapon slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('weapon.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(WEAPON_BINDINGS)).toHaveLength(57);
  });
});
