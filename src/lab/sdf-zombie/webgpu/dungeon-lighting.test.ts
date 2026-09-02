// src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts
//
// The dungeon rig is DATA before it is objects, so its numbers can be gated
// without a GPU. Fixture note (degenerate-fixture house rule): the darkness
// assertions compare the dungeon rig against the GALLERY rig it replaces, so
// they cannot pass by accident on an all-zero struct.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { DUNGEON_RIG, GALLERY_RIG, createFlashlight, FLASHLIGHT_OFFSET, type AmbientRig } from './dungeon-lighting';
import { OCCLUDER_LAYER } from './sdf-layer';

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

describe('createFlashlight', () => {
  it('sets a shadow-camera layer mask with a bit ABOVE bit 0 — the whole bug', () => {
    // ShadowNode.js:731 copies the MAIN camera's mask onto the shadow camera
    // whenever (mask & 0xFFFFFFFE) === 0. sdfLayer pins camera.layers to
    // CONE_LAYER/OCCLUDER_LAYER mid-frame, so inheriting it renders a shadow
    // map with no level geometry in it. A high bit here stops the copy.
    const { spot } = createFlashlight();
    expect(spot.shadow.camera.layers.mask & 0xFFFFFFFE).not.toBe(0);
  });

  it('casts from BOTH the level (layer 0) and the character hull', () => {
    const { spot } = createFlashlight();
    expect(spot.shadow.camera.layers.test(new THREE.Layers())).toBe(true); // layer 0
    const hullLayer = new THREE.Layers();
    hullLayer.set(OCCLUDER_LAYER);
    expect(spot.shadow.camera.layers.test(hullLayer)).toBe(true);
  });

  it('is mounted OFFSET from the eye — an eye-mounted light casts no visible shadow', () => {
    // Horizontal offset is what makes the shadow emerge from behind its caster.
    expect(Math.abs(FLASHLIGHT_OFFSET[0])).toBeGreaterThan(0.15);
    expect(FLASHLIGHT_OFFSET[1]).toBeLessThan(0);   // below the eye
  });

  it('casts shadows and is cold', () => {
    const { spot } = createFlashlight();
    expect(spot.castShadow).toBe(true);
    expect(spot.color.b).toBeGreaterThanOrEqual(spot.color.r);
  });

  it('ships a level-only shadow twin (perf round 2 task 7)', () => {
    // The twin's map is what bodies sample to RECEIVE the level's shadows.
    // It must NOT see the hull layers — a body sampling a map containing its
    // own inflated hull self-shadows every flesh point — and it must light
    // nothing (intensity 0; three still renders the map).
    const { levelShadow, spot } = createFlashlight();
    expect(levelShadow.intensity).toBe(0);
    expect(levelShadow.castShadow).toBe(true);
    expect(levelShadow.shadow.camera.layers.test(new THREE.Layers())).toBe(true); // layer 0
    const hullLayer = new THREE.Layers();
    hullLayer.set(OCCLUDER_LAYER);
    expect(levelShadow.shadow.camera.layers.test(hullLayer)).toBe(false);
    // Same cone as the spot, so the sampled shadow matches the beam that
    // lights the mesh-side level.
    expect(levelShadow.angle).toBe(spot.angle);
    expect(levelShadow.distance).toBe(spot.distance);
  });
});
