// src/lab/sdf-zombie/blood-view.ts
//
// Instanced billboard renderer for blood-sim: gooey specular droplets +
// flat floor splats. WebGL twin; webgpu/blood-view-gpu.ts mirrors it with
// three/webgpu imports. Keep the two in the same shape.
import * as THREE from 'three';
import type { BloodSim } from './blood-sim';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

/** Radial red droplet with an off-centre white glint and darker rim — the
 *  specular "gooey latex" read, baked into a texture so both renderer paths
 *  look identical with zero custom shader. */
function dropletTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(190, 16, 28, 1)');
  grad.addColorStop(0.55, 'rgba(140, 10, 24, 1)');
  grad.addColorStop(0.85, 'rgba(70, 4, 12, 1)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Specular glint, offset up-left like the lab's key light.
  const glint = g.createRadialGradient(24, 22, 0, 24, 22, 9);
  glint.addColorStop(0, 'rgba(255, 235, 235, 0.95)');
  glint.addColorStop(0.5, 'rgba(255, 200, 205, 0.35)');
  glint.addColorStop(1, 'rgba(255, 200, 205, 0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(90, 6, 14, 0.95)');
  grad.addColorStop(0.7, 'rgba(60, 4, 10, 0.8)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BloodView {
  objects: THREE.Object3D[];
  /** Re-pose every instance from sim state; call once per frame. */
  sync(sim: BloodSim, camera: THREE.Camera): void;
  dispose(): void;
}

export function createBloodView(): BloodView {
  const dropGeom = new THREE.PlaneGeometry(1, 1);
  const drops = new THREE.InstancedMesh(
    dropGeom,
    new THREE.MeshBasicMaterial({ map: dropletTexture(), transparent: true, depthWrite: false }),
    MAX_DROPLETS,
  );
  drops.frustumCulled = false;
  const splatGeom = new THREE.PlaneGeometry(1, 1);
  const splats = new THREE.InstancedMesh(
    splatGeom,
    new THREE.MeshBasicMaterial({ map: splatTexture(), transparent: true, depthWrite: false }),
    MAX_SPLATS,
  );
  splats.frustumCulled = false;

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const camInv = new THREE.Quaternion();
  const vCam = new THREE.Vector3();

  function sync(sim: BloodSim, camera: THREE.Camera): void {
    camInv.copy(camera.quaternion).invert();
    for (let i = 0; i < MAX_DROPLETS; i++) {
      const d = sim.droplets[i];
      if (!d) { m.makeScale(0, 0, 0); drops.setMatrixAt(i, m); continue; }
      p.set(d.pos[0], d.pos[1], d.pos[2]);
      // Billboard, then roll in screen space so the stretch follows velocity.
      vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
      const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const stretch = 1 + Math.min(speed * 0.18, 1.4);
      roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
      q.copy(camera.quaternion).multiply(roll);
      s.set(d.size * stretch, d.size, 1);
      m.compose(p, q, s);
      drops.setMatrixAt(i, m);
    }
    drops.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_SPLATS; i++) {
      const sp = sim.splats[i];
      if (!sp) { m.makeScale(0, 0, 0); splats.setMatrixAt(i, m); continue; }
      p.set(sp.pos[0], 0.005 + i * 0.0001, sp.pos[2]); // tiny y-ladder beats z-fight
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      roll.setFromAxisAngle(zAxis, sp.yaw);
      q.multiply(roll);
      s.set(sp.size, sp.size, 1);
      m.compose(p, q, s);
      splats.setMatrixAt(i, m);
    }
    splats.instanceMatrix.needsUpdate = true;
  }

  return {
    objects: [drops, splats],
    sync,
    dispose() {
      for (const o of [drops, splats]) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    },
  };
}
