import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createMuzzleFlash } from './character-effects';

describe('character muzzle flash', () => {
  it('is bright for the firing instant, fades out, and resets for another shot', () => {
    const flash = createMuzzleFlash();
    flash.pose([1, 2, 3], Infinity);
    expect(flash.object.visible).toBe(false);
    flash.pose([1, 2, 3], 0);
    expect(flash.object.visible).toBe(true);
    expect(flash.object.position.toArray()).toEqual([1, 2, 3]);
    const core = flash.object.children[0] as THREE.Sprite;
    expect(core.material.color.r).toBeGreaterThan(1);
    expect(core.material.opacity).toBe(1);
    flash.pose([1, 2, 3], 0.08);
    expect(core.material.opacity).toBeGreaterThan(0);
    expect(core.material.opacity).toBeLessThan(1);
    flash.pose([1, 2, 3], 0.2);
    expect(flash.object.visible).toBe(false);
    flash.pose([4, 5, 6], 0);
    expect(flash.object.position.toArray()).toEqual([4, 5, 6]);
    expect(core.material.opacity).toBe(1);
    // Missing/released props must not leave a floating flash.
    flash.pose(null, 0.02);
    expect(flash.object.visible).toBe(false);
    flash.dispose();
  });

  it('tests against completed scene depth without covering it with transparent depth', () => {
    const flash = createMuzzleFlash();
    for (const child of flash.object.children) {
      const material = (child as THREE.Sprite).material;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
    }
    const parent = new THREE.Scene();
    parent.add(flash.object);
    flash.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
