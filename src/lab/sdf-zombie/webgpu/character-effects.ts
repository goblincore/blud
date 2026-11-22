// src/lab/sdf-zombie/webgpu/character-effects.ts
//
// Character effect scene drawn after the SDF composite, plus the muzzle flash object posed from shot age.

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import { flashPixels } from './flash-sprite';
import { setPassLabel } from './gpu-pass-timing';
import { ARC_POINTS, strikeArcs, type ArcDrive } from '../brain-arcs';

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
      setPassLabel('effects:tail');
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

/** BRAIN ARCS (brain-arcs.ts): electricity crawling over a seizing brain. A fixed pool of jagged arcs drawn as two
 *  crossed additive ribbons each (a white-hot core and a wide blue glow), so they read from any side without facing
 *  the camera, drawn over everything (no depth test). Re-struck ~25 times a second with fresh paths: real arcs never hold still. No GPU allocation per strike. */
export function createBrainArcs(maxArcs = 14) {
  const object = new THREE.Group(); object.name = 'BrainArcs'; object.visible = false;
  const segs = ARC_POINTS - 1, vertsPerArc = segs * 2 * 6, cap = maxArcs * vertsPerArc;
  const layer = (width: number, color: [number, number, number]) => {
    const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    // depthTest OFF, like the muzzle flash: the arcs ride a few cm over the brain and the SDF's depth swallowed them
    // (arena look, 2026-11-09). The ones behind the brain then glow through it, an aura; the Doom-era read.
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    object.add(mesh);
    return { pos, col, geo, material, width, color };
  };
  const core = layer(0.018, [5.0, 5.6, 8.0]);
  const glow = layer(0.11, [0.35, 0.6, 2.0]);
  let clock = 0, next = 0, seed = 1;
  const write = (L: ReturnType<typeof layer>, arcs: Vec3[][], bright: number[]) => {
    let v = 0;
    const put = (p: number[], c: number) => {
      L.pos[v * 3] = p[0]!; L.pos[v * 3 + 1] = p[1]!; L.pos[v * 3 + 2] = p[2]!;
      L.col[v * 3] = L.color[0] * c; L.col[v * 3 + 1] = L.color[1] * c; L.col[v * 3 + 2] = L.color[2] * c; v++;
    };
    arcs.forEach((arc, k) => {
      const b = bright[k]!;
      for (let i = 0; i < segs; i++) {
        const a = arc[i]!, c = arc[i + 1]!;
        const t = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], tl = Math.hypot(t[0]!, t[1]!, t[2]!) || 1;
        const u = [t[0]! / tl, t[1]! / tl, t[2]! / tl];
        // Two sides square to the segment: the crossed ribbons.
        const ref = Math.abs(u[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let s1 = [u[1]! * ref[2]! - u[2]! * ref[1]!, u[2]! * ref[0]! - u[0]! * ref[2]!, u[0]! * ref[1]! - u[1]! * ref[0]!];
        const sl = Math.hypot(s1[0]!, s1[1]!, s1[2]!) || 1; s1 = s1.map(x => x / sl);
        const s2 = [u[1]! * s1[2]! - u[2]! * s1[1]!, u[2]! * s1[0]! - u[0]! * s1[2]!, u[0]! * s1[1]! - u[1]! * s1[0]!];
        // Thinner toward the ends.
        const w0 = L.width * (0.35 + 0.65 * Math.sin(Math.PI * i / segs)), w1 = L.width * (0.35 + 0.65 * Math.sin(Math.PI * (i + 1) / segs));
        for (const s of [s1, s2]) {
          const a0 = a.map((x, j) => x - s[j]! * w0), a1 = a.map((x, j) => x + s[j]! * w0);
          const c0 = c.map((x, j) => x - s[j]! * w1), c1 = c.map((x, j) => x + s[j]! * w1);
          put(a0, b); put(a1, b); put(c1, b); put(a0, b); put(c1, b); put(c0, b);
        }
      }
    });
    (L.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (L.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    L.geo.setDrawRange(0, v);
  };
  return {
    object,
    /** Pose from this frame's drive (null or level 0: dark). */
    update(drive: ArcDrive | null, dt: number) {
      clock += Math.max(0, dt);
      if (!drive || !(drive.level > 0.02)) { object.visible = false; return; }
      object.visible = true;
      if (clock < next) return;
      next = clock + 1 / 30 + (seed % 3) / 120;
      const arcs = strikeArcs(seed++, drive, maxArcs * 0.7).slice(0, maxArcs);
      // Each strike flickers: some arcs flare, some are dim afterimages.
      const bright = arcs.map((_, k) => Math.min(1.4, drive.level * 1.3) * (0.35 + 0.65 * (((seed * 31 + k * 17) % 13) / 12)));
      write(core, arcs, bright);
      write(glow, arcs, bright);
    },
    reset() { object.visible = false; clock = 0; next = 0; },
    get visible() { return object.visible; },
    dispose() { object.removeFromParent(); for (const L of [core, glow]) { L.geo.dispose(); L.material.dispose(); } },
  };
}
