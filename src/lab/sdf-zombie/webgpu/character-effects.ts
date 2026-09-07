import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import { flashPixels } from './flash-sprite';

/** Translucent character effects must follow the SDF composite: drawing
 * them in the polygon pass lets the later flesh colour erase the flash.
 * Keep the completed depth buffer so walls, kit and bodies still occlude it. */
export function createCharacterEffects(renderer: THREE.WebGPURenderer) {
  const scene = new THREE.Scene();
  return {
    scene,
    render(camera: THREE.Camera) {
      if (!scene.children.some(o => o.visible)) return;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try { void renderer.render(scene, camera); }
      finally { renderer.autoClear = autoClear; }
    },
  };
}

/** One reusable flash per armed character, posed from the same shot age and
 * muzzle as its held prop in both the lab and game. No environment light. */
export function createMuzzleFlash() {
  const object = new THREE.Group();
  object.name = 'CharacterMuzzleFlash';
  object.visible = false;
  const textures = Array.from({ length: 4 }, (_, i) => {
    const t = new THREE.DataTexture(flashPixels(64, 17 + i * 31), 64, 64);
    t.needsUpdate = true;
    return t;
  });
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textures[0], color: new THREE.Color(6, 4.3, 2.2),
    transparent: true, blending: THREE.AdditiveBlending,
    depthTest: true, depthWrite: false, toneMapped: false,
  }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textures[0], color: new THREE.Color(1.8, 0.55, 0.12),
    transparent: true, blending: THREE.AdditiveBlending,
    depthTest: true, depthWrite: false, toneMapped: false,
  }));
  object.add(core, halo);
  let previousAge = Infinity;
  let shot = 0;
  return {
    object,
    pose(muzzle: Vec3 | null, age: number) {
      object.visible = muzzle !== null && age >= 0 && age < 0.14;
      if (age < previousAge) {
        shot++;
        core.material.map = halo.material.map = textures[shot % textures.length]!;
        core.material.rotation = shot * 2.39996;
        halo.material.rotation = core.material.rotation + 0.7;
      }
      previousAge = age;
      if (!object.visible || !muzzle) return;
      object.position.fromArray(muzzle);
      // Hold the hot core for two 60 Hz frames, then quickly cool and fade.
      const fade = 1 - Math.max(0, age - 0.035) / 0.105;
      core.material.opacity = fade * fade;
      halo.material.opacity = 0.55 * fade;
      core.scale.setScalar(0.30 + age * 0.5);
      halo.scale.setScalar(0.65 + age);
    },
    dispose() {
      object.removeFromParent();
      core.material.dispose();
      halo.material.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
