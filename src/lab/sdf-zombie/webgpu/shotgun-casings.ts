import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';

/** sinceFire is shared by game and lab; repeated pose calls must not duplicate a shot. */
export function createEjectionCycle() {
  let previous = Infinity;
  let pending = false;
  return {
    reset() { previous = Infinity; pending = false; },
    update(sinceFire: number, armed: boolean): boolean {
      if (!Number.isFinite(sinceFire)) { previous = Infinity; pending = false; return false; }
      if (sinceFire < previous && (Number.isFinite(previous) || sinceFire < .18)) pending = armed;
      previous = sinceFire;
      if (!armed) pending = false;
      if (!pending || sinceFire < .18) return false;
      pending = false;
      return true;
    },
  };
}

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  angles: THREE.Euler;
  spin: THREE.Vector3;
  age: number;
  resting: boolean;
}

/** Cosmetic only: no collision-system registration or raycast targets. Oldest
 * shells recycle at capacity; settled shells cost no simulation or uploads. */
/** `hullColor` recolours the hull: the juggernaut's chaingun throws BRASS
 *  (0xc8963c), not red shotgun shells, and at ~10 rounds/s it wants a bigger
 *  pool (character-view.ts). Defaults are the soldier's shells. */
export function createShotgunCasings(capacity = 128, hullColor = 0xc53424) {
  const object = new THREE.Group();
  object.name = 'spent-shotgun-shells';
  const hullGeometry = new THREE.CylinderGeometry(.011, .011, .04, 8);
  const brassGeometry = new THREE.CylinderGeometry(.012, .012, .009, 8);
  brassGeometry.translate(0, -.0245, 0);
  const hullMaterial = new THREE.MeshStandardMaterial(hullColor === 0xc53424
    ? { color: hullColor, roughness: .72 } : { color: hullColor, metalness: .35, roughness: .48 });
  const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xe5b755, metalness: .35, roughness: .48 });
  const meshes = [
    new THREE.InstancedMesh(hullGeometry, hullMaterial, capacity),
    new THREE.InstancedMesh(brassGeometry, brassMaterial, capacity),
  ];
  for (const mesh of meshes) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    object.add(mesh);
  }
  const shells: Shell[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  let next = 0, serial = 0;
  const write = (i: number) => {
    const shell = shells[i]!;
    matrix.compose(shell.pos, quat.setFromEuler(shell.angles), scale);
    for (const mesh of meshes) {
      mesh.setMatrixAt(i, matrix);
      mesh.count = shells.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  return {
    object,
    eject(origin: Vec3, right: Vec3) {
      // Deterministic small variation keeps repeated shots from stacking.
      const phase = ++serial * 2.399963;
      const speed = 1.35 + .2 * Math.sin(phase);
      shells[next] = {
        pos: new THREE.Vector3(...origin),
        vel: new THREE.Vector3(right[0] * speed, Math.max(.7, right[1] * speed + 1.1), right[2] * speed + .15 * Math.cos(phase)),
        angles: new THREE.Euler(.3, phase, .6),
        spin: new THREE.Vector3(12, 7 + Math.sin(phase), 16),
        age: 0, resting: false,
      };
      write(next);
      next = (next + 1) % capacity;
    },
    step(dt: number) {
      if (!(dt > 0)) return;
      // Bound tab-resume work, substep to keep tiny shells above the floor.
      const duration = Math.min(dt, .1);
      const steps = Math.ceil(duration / (1 / 120));
      const h = duration / steps;
      for (let i = 0; i < shells.length; i++) {
        const shell = shells[i]!;
        if (shell.resting) continue;
        for (let j = 0; j < steps && !shell.resting; j++) {
          shell.age += h;
          shell.vel.y -= 9.81 * h;
          shell.pos.addScaledVector(shell.vel, h);
          shell.angles.x += shell.spin.x * h;
          shell.angles.y += shell.spin.y * h;
          shell.angles.z += shell.spin.z * h;
          if (shell.pos.y <= .012) {
            shell.pos.y = .012;
            shell.vel.y = Math.abs(shell.vel.y) * .3;
            shell.vel.x *= .58; shell.vel.z *= .58;
            shell.spin.multiplyScalar(.55);
            if (shell.vel.y < .32 || shell.age > 2) {
              shell.resting = true;
              shell.vel.set(0, 0, 0);
              // Cylinder local y lies flat; preserve a varied floor heading.
              shell.angles.set(Math.PI / 2, 0, shell.angles.y);
            }
          }
        }
        write(i);
      }
    },
    dispose() {
      object.removeFromParent();
      for (const mesh of meshes) mesh.dispose();
      hullGeometry.dispose(); brassGeometry.dispose();
      hullMaterial.dispose(); brassMaterial.dispose();
      shells.length = 0;
    },
  };
}
