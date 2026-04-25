import { describe, it, expect, vi } from 'vitest';
import { Pellet, pelletPosition, pelletDirInCone } from './shotgun-pellet';
import { SHOTGUN_BLAST } from '../gibs/tuning';
import type { RaycastFn, PelletHit } from './shotgun-pellet';

// ——— Pure-math tests ——————————————————————————————-

describe('pelletPosition', () => {
  it('moves along direction at given speed', () => {
    const pos = pelletPosition(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      0.5,
      55,
    );
    expect(pos.x).toBeCloseTo(27.5, 2);
    expect(pos.y).toBeCloseTo(0, 2);
    expect(pos.z).toBeCloseTo(0, 2);
  });

  it('handles zero elapsed time', () => {
    const pos = pelletPosition(
      { x: 5, y: 2, z: 3 },
      { x: 0.6, y: 0, z: 0.8 },
      0,
      55,
    );
    expect(pos.x).toBeCloseTo(5, 2);
    expect(pos.y).toBeCloseTo(2, 2);
    expect(pos.z).toBeCloseTo(3, 2);
  });

  it('handles diagonal direction', () => {
    const len = Math.sqrt(2);
    const pos = pelletPosition(
      { x: 0, y: 0, z: 0 },
      { x: 1 / len, y: 0, z: 1 / len },
      1.0,
      55,
    );
    const expected = 55 / len;
    expect(pos.x).toBeCloseTo(expected, 2);
    expect(pos.z).toBeCloseTo(expected, 2);
  });
});

describe('pelletDirInCone', () => {
  it('center pellet points straight forward (angleIdx = total/2 when odd)', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const dir = pelletDirInCone(forward, 3, 7, 14);
    // 3rd of 7 is center → no rotation
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.z).toBeCloseTo(1, 5);
  });

  it('leftmost pellet is at -coneDeg', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const dir = pelletDirInCone(forward, 0, 7, 14);
    // -14° rotation around Y = (-sin(-14), 0, cos(-14)) = (sin(14), 0, cos(14))
    const rad = (14 * Math.PI) / 180;
    expect(dir.x).toBeCloseTo(Math.sin(rad), 5);
    expect(dir.z).toBeCloseTo(Math.cos(rad), 5);
  });

  it('rightmost pellet is at +coneDeg', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const dir = pelletDirInCone(forward, 6, 7, 14);
    // +14° rotation around Y = (-sin(14), 0, cos(14)? No, +14: sin is +14)
    const rad = (14 * Math.PI) / 180;
    expect(dir.x).toBeCloseTo(-Math.sin(rad), 5); // sin(+14)
    expect(dir.z).toBeCloseTo(Math.cos(rad), 5);
  });

  it('returns a unit vector', () => {
    const forward = { x: 0.6, y: 0, z: 0.8 };
    for (let i = 0; i < 7; i++) {
      const dir = pelletDirInCone(forward, i, 7, 14);
      const mag = Math.hypot(dir.x, dir.y, dir.z);
      expect(mag).toBeCloseTo(1, 5);
    }
  });
});

// ——— Pellet update tests ——————————————————————————

// Mock rigid body handle for testing player-hit matching
function mockBody(handle: number): { handle: number } {
  return { handle };
}

describe('Pellet', () => {
  it('returns true while pellet is in flight', () => {
    const p = new Pellet(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      SHOTGUN_BLAST.pelletSpeedMps,
      0,
      SHOTGUN_BLAST.pelletDamage,
    );

    const noHit: RaycastFn = () => null;
    // After very short time, pellet is still alive
    const alive = p.update(0.1, noHit, () => {}, null);
    expect(alive).toBe(true);
  });

  it('returns false when pellet has exceeded maxRange', () => {
    const p = new Pellet(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      SHOTGUN_BLAST.pelletSpeedMps,
      0,
      SHOTGUN_BLAST.pelletDamage,
    );

    // 55 m/s * 1s = 55m > maxRange 25m
    const noHit: RaycastFn = () => null;
    const alive = p.update(1.0, noHit, () => {}, null);
    expect(alive).toBe(false);
  });

  it('calls applyDamageToPlayer when raycast hits player body', () => {
    const playerBody = mockBody(42) as any;
    const applyDamage = vi.fn();

    const p = new Pellet(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      SHOTGUN_BLAST.pelletSpeedMps,
      0,
      SHOTGUN_BLAST.pelletDamage,
    );

    const hitFn: RaycastFn = (_from, _dir, _maxDist) => ({
      pos: { x: 0, y: 0, z: 2 },
      body: playerBody,
    });

    const alive = p.update(0.1, hitFn, applyDamage, playerBody);
    expect(alive).toBe(false);
    expect(applyDamage).toHaveBeenCalledOnce();
    const damage = applyDamage.mock.calls[0]![0] as number;
    const impulse = applyDamage.mock.calls[0]![1] as { x: number; y: number; z: number };
    expect(damage).toBe(SHOTGUN_BLAST.pelletDamage);
    expect(impulse.x).toBeCloseTo(0, 2);
    expect(impulse.z).toBeGreaterThan(0); // nudge in flight direction
  });

  it('does NOT call applyDamageToPlayer when raycast hits a wall (body !== playerBody)', () => {
    const wallBody = mockBody(99) as any;
    const playerBody = mockBody(42) as any;
    const applyDamage = vi.fn();

    const p = new Pellet(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      SHOTGUN_BLAST.pelletSpeedMps,
      0,
      SHOTGUN_BLAST.pelletDamage,
    );

    const hitFn: RaycastFn = (_from, _dir, _maxDist) => ({
      pos: { x: 0, y: 0, z: 2 },
      body: wallBody,
    });

    const alive = p.update(0.1, hitFn, applyDamage, playerBody);
    expect(alive).toBe(false);
    expect(applyDamage).not.toHaveBeenCalled();
  });

  it('returns false on hit and does not call damage if already expired', () => {
    const applyDamage = vi.fn();

    const p = new Pellet(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      SHOTGUN_BLAST.pelletSpeedMps,
      0,
      SHOTGUN_BLAST.pelletDamage,
    );

    // Hit the pellet first
    const playerBody = mockBody(42) as any;
    const hitFn: RaycastFn = (_from, _dir, _maxDist) => ({
      pos: { x: 0, y: 0, z: 1 },
      body: playerBody,
    });
    p.update(0.05, hitFn, applyDamage, playerBody);
    expect(applyDamage).toHaveBeenCalledTimes(1);

    // Second update should be no-op (already expired)
    const noHit: RaycastFn = () => null;
    const alive = p.update(0.1, noHit, applyDamage, playerBody);
    expect(alive).toBe(false);
    expect(applyDamage).toHaveBeenCalledTimes(1); // no second call
  });
});
