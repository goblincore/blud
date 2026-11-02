// src/lab/sdf-zombie/webgpu/shotgun-casings.ts
//
// Spent shotgun shell casings: the ejection cycle trigger and the instanced hull and brass meshes that fly out and settle.

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import { landingFloor, type DebrisGround, type DebrisSeat } from '../debris-ground';
import { ensureSegmentMatrices, setSegmentMatrix, useSegmentInstance } from './skeleton-spike/segment-instance';

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
  /** The floor the shell last flew over (0 at eject; SECTOR levels seed the shooter's floor). Read only with a
   *  ground (plan 3b). */
  floorY: number;
}

/** Cosmetic only: no collision-system registration or raycast targets. Oldest
 * shells recycle at capacity; settled shells cost no simulation or uploads. */
/** `hullColor` recolours the hull: the juggernaut's chaingun throws BRASS
 *  (0xc8963c), not red shotgun shells, and at ~10 rounds/s it wants a bigger
 *  pool (character-view.ts). Defaults are the soldier's shells. */
/** BATCHED (`batched`, the game's default; `?batch=0` off — level-batch.ts, 2026-10-28): every soldier owns a pool,
 *  and an empty pool's InstancedMesh with count 0 still cost a render object each frame (E1M1: 16 soldiers × 2 = 32
 *  of ~200 objects drawn, before anyone fired). A batched pool is a plain Mesh on an InstancedBufferGeometry with
 *  named matrix attributes (skeleton-spike/segment-instance.ts) on materials SHARED by every pool of one hull colour,
 *  so all pools share one build and pipeline (an InstancedMesh builds per uuid), and it leaves the render while it
 *  is empty, once it has been drawn once (the shared build happens at boot, not on a soldier's first shot). */
/** The empty-pool gate (the in-boot A/B, game-level-batch.ts setLevelBatchLive): off draws empty pools again. */
let casingGate = true;
const gates = new Set<() => void>();
export function setCasingGate(on: boolean): void { casingGate = on; for (const g of gates) g(); }
const sharedCasingMaterials = new Map<number, THREE.MeshStandardNodeMaterial>();
function casingMaterial(color: number, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardNodeMaterial {
  let m = sharedCasingMaterials.get(color);
  if (!m) {
    m = new THREE.MeshStandardNodeMaterial(params);
    m.name = `casing-${color.toString(16)}`;
    useSegmentInstance(m);
    sharedCasingMaterials.set(color, m);
  }
  return m;
}

export function createShotgunCasings(capacity = 128, hullColor = 0xc53424, batched = false) {
  const object = new THREE.Group();
  object.name = 'spent-shotgun-shells';
  const hullGeometry = new THREE.CylinderGeometry(.011, .011, .04, 8);
  const brassGeometry = new THREE.CylinderGeometry(.012, .012, .009, 8);
  brassGeometry.translate(0, -.0245, 0);
  const hullParams: THREE.MeshStandardMaterialParameters = hullColor === 0xc53424
    ? { color: hullColor, roughness: .72 } : { color: hullColor, metalness: .35, roughness: .48 };
  const brassParams: THREE.MeshStandardMaterialParameters = { color: 0xe5b755, metalness: .35, roughness: .48 };
  const hullMaterial = batched ? casingMaterial(hullColor, hullParams) : new THREE.MeshStandardMaterial(hullParams);
  const brassMaterial = batched ? casingMaterial(0xe5b755, brassParams) : new THREE.MeshStandardMaterial(brassParams);
  const meshes: THREE.Mesh[] = [];
  /** Batched: each mesh's matrix rows, and whether it has been drawn once. */
  const rows: THREE.InstancedInterleavedBuffer[] = [];
  let drawn = false;
  if (batched) {
    for (const [base, mat] of [[hullGeometry, hullMaterial], [brassGeometry, brassMaterial]] as const) {
      const g = new THREE.InstancedBufferGeometry().copy(base as unknown as THREE.InstancedBufferGeometry);
      g.instanceCount = 0;
      rows.push(ensureSegmentMatrices(g, capacity));
      const mesh = new THREE.Mesh(g, mat);
      // Drawn (built) once: leave the render from the next frame while empty, even if this pool's step never runs again.
      mesh.onBeforeRender = () => { if (!drawn) { drawn = true; gate(); } };
      meshes.push(mesh);
    }
  } else {
    meshes.push(new THREE.InstancedMesh(hullGeometry, hullMaterial, capacity), new THREE.InstancedMesh(brassGeometry, brassMaterial, capacity));
  }
  for (const mesh of meshes) {
    if (!batched) {
      (mesh as THREE.InstancedMesh).count = 0;
      (mesh as THREE.InstancedMesh).instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    object.add(mesh);
  }
  const shells: Shell[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  let next = 0, serial = 0;
  /** Batched: an empty pool leaves the render once it has been drawn (built) once. */
  const gate = () => { if (batched) for (const mesh of meshes) mesh.visible = !casingGate || shells.length > 0 || !drawn; };
  if (batched) gates.add(gate);
  const write = (i: number) => {
    const shell = shells[i]!;
    matrix.compose(shell.pos, quat.setFromEuler(shell.angles), scale);
    if (batched) {
      for (let k = 0; k < meshes.length; k++) {
        setSegmentMatrix(rows[k]!, i, matrix);
        (meshes[k]!.geometry as THREE.InstancedBufferGeometry).instanceCount = shells.length;
        rows[k]!.needsUpdate = true;
      }
      gate();
      return;
    }
    for (const mesh of meshes as THREE.InstancedMesh[]) {
      mesh.setMatrixAt(i, matrix);
      mesh.count = shells.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  return {
    object,
    /** SECTOR levels (plan 3b) pass `seat`: the shell starts inside the level (radius 0, the 1 cm skin covers it)
     *  on the shooter's floor. */
    eject(origin: Vec3, right: Vec3, seat?: DebrisSeat) {
      // Deterministic small variation keeps repeated shots from stacking.
      const phase = ++serial * 2.399963;
      const speed = 1.35 + .2 * Math.sin(phase);
      const at = seat ? seat(origin, 0) : null;
      shells[next] = {
        pos: new THREE.Vector3(...(at ? at.pos : origin)),
        vel: new THREE.Vector3(right[0] * speed, Math.max(.7, right[1] * speed + 1.1), right[2] * speed + .15 * Math.cos(phase)),
        angles: new THREE.Euler(.3, phase, .6),
        spin: new THREE.Vector3(12, 7 + Math.sin(phase), 16),
        age: 0, resting: false, floorY: at?.floorY ?? 0,
      };
      write(next);
      next = (next + 1) % capacity;
    },
    /** SECTOR levels (plan 3b) pass `ground`: shells stop at its walls, stay under its ceiling and rest on the floor
     *  under them. Room levels pass nothing: the y = 0 plane, byte for byte. */
    step(dt: number, ground?: DebrisGround) {
      gate();
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
          const sx = shell.pos.x, sy = shell.pos.y, sz = shell.pos.z;
          shell.pos.addScaledVector(shell.vel, h);
          shell.angles.x += shell.spin.x * h;
          shell.angles.y += shell.spin.y * h;
          shell.angles.z += shell.spin.z * h;
          let floor = 0;
          if (ground) {
            const b = ground.bounce([sx, sy, sz], [shell.pos.x, shell.pos.y, shell.pos.z],
              [shell.vel.x, shell.vel.y, shell.vel.z], .3, .58);
            if (b) { shell.pos.set(b.pos[0], b.pos[1], b.pos[2]); shell.vel.set(b.vel[0], b.vel[1], b.vel[2]); }
            const ceil = ground.ceilAt?.(shell.pos.x, shell.pos.z) ?? Infinity;
            if (Number.isFinite(ceil) && shell.pos.y > ceil - .012) {
              shell.pos.y = ceil - .012;
              if (shell.vel.y > 0) shell.vel.y *= -.3;
            }
            floor = shell.floorY = landingFloor(ground, shell.pos.x, shell.pos.z, shell.floorY);
          }
          if (shell.pos.y <= floor + .012) {
            shell.pos.y = floor + .012;
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
    /** Every live shell's position and whether it has settled (the debris seam). */
    debris(): { pos: Vec3; resting: boolean }[] {
      return shells.map(s => ({ pos: [s.pos.x, s.pos.y, s.pos.z] as Vec3, resting: s.resting }));
    },
    dispose() {
      object.removeFromParent();
      gates.delete(gate);
      if (batched) for (const mesh of meshes) mesh.geometry.dispose();   // the materials are shared: kept
      else {
        for (const mesh of meshes as THREE.InstancedMesh[]) mesh.dispose();
        hullMaterial.dispose(); brassMaterial.dispose();
      }
      hullGeometry.dispose(); brassGeometry.dispose();
      shells.length = 0;
    },
  };
}
