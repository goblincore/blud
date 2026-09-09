import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import { flashPixels } from './flash-sprite';
import { setPassLabel } from './gpu-pass-timing';

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
      setPassLabel('effects');
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
  // depthTest OFF: the flash always sits above the shooter (owner call,
  // 2026-09-09). With it on, the hand and forearm flesh holding the gun sit
  // nearer than the muzzle point along those rays and clip the billboard —
  // it read as the flash being "behind" the soldier's own arms. The cost is
  // that a shooter firing from behind a wall shows his flash through it,
  // which is the Doom-era read and accepted.
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textures[0], color: new THREE.Color(6, 4.3, 2.2),
    transparent: true, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textures[0], color: new THREE.Color(1.8, 0.55, 0.12),
    transparent: true, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, toneMapped: false,
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

/** Fixed-pool additive armor sparks; no per-impact GPU allocations. */
export function createArmorSparks(capacity=32) {
  const object=new THREE.Group(); object.name='ArmorSparks'; object.visible=false;
  const materials:THREE.SpriteMaterial[]=[];
  const slots=Array.from({length:capacity},()=>{const material=new THREE.SpriteMaterial({color:0xffd070,transparent:true,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false});materials.push(material);return {mesh:new THREE.Sprite(material),vel:new THREE.Vector3(),age:Infinity,life:.14};});
  for(const s of slots){s.mesh.visible=false;object.add(s.mesh);}
  let cursor=0,seed=1;
  return {object,burst(point:Vec3,count=6){for(let i=0;i<Math.min(count,capacity);i++){
    const s=slots[cursor++%capacity]!; seed=(seed*1664525+1013904223)>>>0;
    const a=(seed/4294967296)*Math.PI*2, speed=1.4+((seed>>>8)&255)/255*2;
    s.mesh.position.fromArray(point);s.mesh.material.rotation=a;s.mesh.scale.set(.045,.008,1);s.vel.set(Math.cos(a)*speed,.8+speed*.45,Math.sin(a)*speed);s.age=0;s.life=.10+((seed>>>16)&31)/400;s.mesh.visible=true;
  } object.visible=true;},step(dt:number){for(const s of slots){if(!s.mesh.visible)continue;s.age+=Math.max(0,dt);if(s.age>=s.life){s.mesh.visible=false;continue;}s.vel.y-=8*dt;s.mesh.position.addScaledVector(s.vel,dt);}object.visible=slots.some(s=>s.mesh.visible);},
    reset(){for(const s of slots){s.age=Infinity;s.mesh.visible=false;}object.visible=false;},get active(){return slots.filter(s=>s.mesh.visible).length;},get capacity(){return capacity;},
    dispose(){object.removeFromParent();object.clear();for(const material of materials)material.dispose();}};
}
