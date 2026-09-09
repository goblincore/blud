import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createArmorSparks, createMuzzleFlash } from './character-effects';

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

  it('always sits above the shooter: no depth test, and never writes depth', () => {
    // Owner call 2026-09-09: with depthTest on, the shooter's own hand and
    // forearm flesh clipped the flash. It is drawn after the SDF composite in
    // the effects overlay, so "no depth test" means "on top of everything".
    const flash = createMuzzleFlash();
    for (const child of flash.object.children) {
      const material = (child as THREE.Sprite).material;
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
    }
    const parent = new THREE.Scene();
    parent.add(flash.object);
    flash.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('armor sparks',()=>{
  it('stays bounded, expires, resets and disposes',()=>{
    const s=createArmorSparks(8);const scene=new THREE.Scene();scene.add(s.object);
    expect(s.object.visible).toBe(false);
    s.burst([1,2,3],40);expect(s.active).toBe(8);expect(s.object.children).toHaveLength(8);
    expect(s.object.visible).toBe(true);expect((s.object.children[0] as THREE.Sprite).isSprite).toBe(true);
    const m=(s.object.children[0] as THREE.Sprite).material as THREE.SpriteMaterial;
    expect(m.blending).toBe(THREE.AdditiveBlending);expect(m.depthWrite).toBe(false);
    s.step(1);expect(s.active).toBe(0);expect(s.object.visible).toBe(false);s.burst([0,0,0]);s.reset();expect(s.active).toBe(0);expect(s.object.visible).toBe(false);
    s.dispose();expect(scene.children).toHaveLength(0);
  });
});
