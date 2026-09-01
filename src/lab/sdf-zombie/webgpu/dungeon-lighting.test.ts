// src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts
//
// The dungeon rig is DATA before it is objects, so its numbers can be gated
// without a GPU. Fixture note (degenerate-fixture house rule): the darkness
// assertions compare the dungeon rig against the GALLERY rig it replaces, so
// they cannot pass by accident on an all-zero struct.
import { describe, expect, it } from 'vitest';
import { DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';

const lum = (c: readonly [number, number, number]) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('dungeon rig', () => {
  it('is dramatically darker than the gallery rig it replaces', () => {
    // The whole point of the pivot: ambient must collapse, not merely dip.
    expect(DUNGEON_RIG.ambientIntensity).toBeLessThan(GALLERY_RIG.ambientIntensity * 0.1);
    expect(DUNGEON_RIG.hemiIntensity).toBeLessThan(GALLERY_RIG.hemiIntensity * 0.1);
    expect(DUNGEON_RIG.sunIntensity).toBe(0);
  });

  it('fog closes in hard — the reference swallows a corridor by ~6 m', () => {
    expect(DUNGEON_RIG.fogFar).toBeLessThan(GALLERY_RIG.fogFar * 0.5);
    expect(DUNGEON_RIG.fogNear).toBeLessThan(DUNGEON_RIG.fogFar);
    expect(lum(DUNGEON_RIG.fogColor)).toBeLessThan(0.02);
  });

  it('the flashlight is COLD and the practicals are WARM — the palette decision', () => {
    const [fr, fg, fb] = DUNGEON_RIG.flashlightColor;
    expect(fb).toBeGreaterThanOrEqual(fr);           // cold: blue >= red
    const [pr, , pb] = DUNGEON_RIG.practicalColor;
    expect(pr).toBeGreaterThan(pb + 0.3);            // warm: red clearly over blue
    expect(fg).toBeGreaterThan(0.9);                 // near-white, not blue-tinted
  });
});
