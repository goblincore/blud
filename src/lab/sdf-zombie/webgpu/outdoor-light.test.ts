// src/lab/sdf-zombie/webgpu/outdoor-light.test.ts
import { describe, expect, it } from 'vitest';
import { blendFog, moonRoomIds, moonShadowFrame, outdoorRoomAt } from './outdoor-light';
import { SKY_PRESETS } from './outdoor-presets';

const rooms = [
  { id: 1, name: 'yard', minX: 0, maxX: 12, minZ: 0, maxZ: 10, height: 6, sky: 'night' as const },
  { id: 2, name: 'hall', minX: 12.6, maxX: 20.6, minZ: 3, maxZ: 9, height: 3, sky: null },
];

describe('outdoor-light', () => {
  it('moon rooms are exactly the open-sky rooms', () => {
    expect([...moonRoomIds(rooms)]).toEqual([1]);
  });

  it('outdoorRoomAt: the open room under a point, or the nearest open room within reach', () => {
    expect(outdoorRoomAt(rooms, 6, 5, 4)?.id).toBe(1);
    expect(outdoorRoomAt(rooms, 13, 6, 4)?.id).toBe(1);      // in the doorway, 1 m from the yard
    expect(outdoorRoomAt(rooms, 20, 6, 4)).toBeNull();        // deep in the hall
  });

  it('the moon shadow frame contains every corner of the room box, grown by the margin', () => {
    const f = moonShadowFrame(SKY_PRESETS.night.moon.dir, rooms[0]!, 2);
    const right = f.right, up = f.up, fwd = f.forward;
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    for (const x of [-2, 14]) for (const y of [0, 6]) for (const z of [-2, 12]) {
      const d = [x - f.target[0], y - f.target[1], z - f.target[2]];
      expect(Math.abs(dot(d, right))).toBeLessThanOrEqual(f.halfWidth + 1e-6);
      expect(Math.abs(dot(d, up))).toBeLessThanOrEqual(f.halfHeight + 1e-6);
      const depth = f.distance - dot(d, fwd.map(v => -v));
      expect(depth).toBeGreaterThanOrEqual(f.near - 1e-6);
      expect(depth).toBeLessThanOrEqual(f.far + 1e-6);
    }
  });

  it('blendFog interpolates colour and range; t is clamped', () => {
    const a = { color: [0, 0, 0] as [number, number, number], near: 2, far: 10 };
    const b = { color: [1, 1, 1] as [number, number, number], near: 10, far: 70 };
    expect(blendFog(a, b, 0.5)).toEqual({ color: [0.5, 0.5, 0.5], near: 6, far: 40 });
    expect(blendFog(a, b, 2)).toEqual(b);
  });
});
