import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export function buildArena(scene: THREE.Scene, world: RAPIER.World): void {
  const floorSize = 40;
  const wallHeight = 4;
  const wallThick = 0.5;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a3a36 });
  const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(floorSize, 0.5, floorSize), floorMat);
  floor.position.y = -0.25;
  scene.add(floor);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(floorSize / 2, 0.25, floorSize / 2)
      .setTranslation(0, -0.25, 0),
  );

  const walls: Array<[number, number, number, number, number, number]> = [
    [floorSize + wallThick, wallHeight, wallThick, 0, wallHeight / 2, -floorSize / 2],
    [floorSize + wallThick, wallHeight, wallThick, 0, wallHeight / 2,  floorSize / 2],
    [wallThick, wallHeight, floorSize + wallThick, -floorSize / 2, wallHeight / 2, 0],
    [wallThick, wallHeight, floorSize + wallThick,  floorSize / 2, wallHeight / 2, 0],
  ];
  for (const [sx, sy, sz, px, py, pz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
    m.position.set(px, py, pz);
    scene.add(m);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(px, py, pz),
    );
  }

  const obstacles: Array<[number, number, number, number, number, number]> = [
    [2, 1, 2, -4, 0.5, -3],
    [3, 2, 1, 5, 1, 2],
    [1, 0.5, 4, -6, 0.25, 4],
  ];
  for (const [sx, sy, sz, px, py, pz] of obstacles) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), obstacleMat);
    m.position.set(px, py, pz);
    scene.add(m);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(px, py, pz),
    );
  }
}
