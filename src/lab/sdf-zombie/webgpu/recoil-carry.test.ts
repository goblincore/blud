// src/lab/sdf-zombie/webgpu/recoil-carry.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { carryWithRecoil } from './recoil-carry';

const REST = { pos: new THREE.Vector3(0.038, -0.115, -0.3), pitchDeg: 2.5, rollDeg: -4.5 };
const ZERO = { dy: 0, dz: 0, pitch: 0, roll: 0 };
const HAND = new THREE.Vector3(0.0, -0.17, -0.45);   // forward of the gun's origin, like the fore-end

describe('carryWithRecoil — the support hands ride the gun through the kick', () => {
  it('is the identity when there is no recoil', () => {
    const out = carryWithRecoil(HAND, REST, ZERO, new THREE.Vector3());
    expect(out.distanceTo(HAND)).toBeLessThan(1e-9);
  });

  it('a pure lift and pull-back moves the hand by exactly that much', () => {
    const out = carryWithRecoil(HAND, REST, { ...ZERO, dy: 0.05, dz: 0.09 }, new THREE.Vector3());
    expect(out.x - HAND.x).toBeCloseTo(0, 9);
    expect(out.y - HAND.y).toBeCloseTo(0.05, 9);
    expect(out.z - HAND.z).toBeCloseTo(0.09, 9);
  });

  it('muzzle-up pitch swings a hand that is FORWARD of the gun origin upward', () => {
    const out = carryWithRecoil(HAND, REST, { ...ZERO, pitch: 15 }, new THREE.Vector3());
    expect(out.y).toBeGreaterThan(HAND.y + 0.03);   // 15 deg x 15 cm lever ~ 4 cm
  });

  it('turns about the gun origin, so a hand AT the origin only translates', () => {
    const atOrigin = REST.pos.clone();
    const out = carryWithRecoil(atOrigin, REST, { ...ZERO, pitch: 15, roll: 6, dy: 0.02 }, new THREE.Vector3());
    expect(out.x - atOrigin.x).toBeCloseTo(0, 9);
    expect(out.y - atOrigin.y).toBeCloseTo(0.02, 9);
  });

  it('keeps the hand-to-origin distance (it is carried rigidly, not stretched)', () => {
    const out = carryWithRecoil(HAND, REST, { dy: 0.04, dz: 0.08, pitch: 17, roll: 5 }, new THREE.Vector3());
    const origin = REST.pos.clone().add(new THREE.Vector3(0, 0.04, 0.08));
    expect(out.distanceTo(origin)).toBeCloseTo(HAND.distanceTo(REST.pos), 9);
  });
});
