import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AxeZombie, ZombieTextureAtlas } from './enemy/axe-zombie';
import { ZombieState } from './enemy/ai';
import type { GibSystem } from './gibs';
import type { StaticSurface } from './gibs/particles';
import { setArenaSurfaces } from './gibs/particles';

// ——— Arena geometry (M1) ——————————————————————————————————

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

// ——— Static surface AABBs —————————————————————————————————

/** Compute the 6 inner faces of the arena box (floor + 4 walls + ceiling). */
export function arenaStaticSurfaces(): StaticSurface[] {
  const s = 20; // half of floorSize (40)
  const h = 4;  // wallHeight

  // Each surface is an AABB + inward-facing normal
  return [
    // Floor (normal up)
    { min: { x: -s, y: -0.5, z: -s }, max: { x: s, y: 0, z: s }, normal: { x: 0, y: 1, z: 0 } },
    // Ceiling (normal down)
    { min: { x: -s, y: h, z: -s }, max: { x: s, y: h + 0.5, z: s }, normal: { x: 0, y: -1, z: 0 } },
    // North wall (normal +Z, into arena)
    { min: { x: -s, y: -0.5, z: s }, max: { x: s, y: h, z: s + 0.5 }, normal: { x: 0, y: 0, z: -1 } },
    // South wall (normal -Z, into arena)
    { min: { x: -s, y: -0.5, z: -s - 0.5 }, max: { x: s, y: h, z: -s }, normal: { x: 0, y: 0, z: 1 } },
    // East wall (normal -X, into arena)
    { min: { x: s, y: -0.5, z: -s - 0.5 }, max: { x: s + 0.5, y: h, z: s + 0.5 }, normal: { x: -1, y: 0, z: 0 } },
    // West wall (normal +X, into arena)
    { min: { x: -s - 0.5, y: -0.5, z: -s - 0.5 }, max: { x: -s, y: h, z: s + 0.5 }, normal: { x: 1, y: 0, z: 0 } },
  ];
}

/**
 * Register arena static geometry AABBs with the particle system so trails
 * can spawn wall/ceiling decals. Call once after arena geometry is built.
 */
export function registerArenaSurfaces(): void {
  setArenaSurfaces(arenaStaticSurfaces());
}

// ——— Zombie cluster ———————————————————————————————————————

export interface ZombieSpawnDeps {
  scene: THREE.Scene;
  world: RAPIER.World;
  atlas: ZombieTextureAtlas;
  gibs: GibSystem;
}

export class ZombieCluster {
  private zombies: AxeZombie[] = [];
  private nextId = 0;

  constructor(
    private readonly deps: ZombieSpawnDeps,
    private readonly center: { x: number; y: number; z: number },
  ) {}

  spawn(count = 4, radius = 1.5): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const pos = {
        x: this.center.x + Math.cos(angle) * radius,
        y: this.center.y,
        z: this.center.z + Math.sin(angle) * radius,
      };
      const z = AxeZombie.spawn(`zombie-${this.nextId++}`, this.deps.world, this.deps.scene, this.deps.atlas, pos);
      this.deps.gibs.registerDude(z);
      this.zombies.push(z);
    }
  }

  update(dt: number, playerPos: { x: number; y: number; z: number }, camera: THREE.Camera): void {
    for (const z of this.zombies) z.update(dt, playerPos, camera);
    // Reap dead zombies after their brain enters dead state.
    this.zombies = this.zombies.filter((z) => {
      if (z.brain.state === ZombieState.Dead) {
        this.deps.gibs.unregisterDude(z.id);
        z.despawn();
        return false;
      }
      return true;
    });
  }

  reset(): void {
    for (const z of this.zombies) {
      this.deps.gibs.unregisterDude(z.id);
      z.despawn();
    }
    this.zombies = [];
    this.nextId = 0;
  }
}

// ——— Game-over overlay —————————————————————————————————————

/** Game-over overlay — shown when the player self-gibs. */
export class GameOverOverlay {
  private el: HTMLElement;
  constructor(root: HTMLElement, onRestart: () => void) {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; inset: 0;
      background: #000c;
      display: none;
      align-items: center; justify-content: center;
      color: #f33; font-family: monospace; font-size: 48px;
      flex-direction: column; gap: 20px;
    `;
    this.el.innerHTML = `
      <div>YOU BLEW YOURSELF UP</div>
      <div style="font-size:20px; color:#fff8;">Press R to try again</div>
    `;
    root.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r' && this.el.style.display !== 'none') {
        this.el.style.display = 'none';
        onRestart();
      }
    });
  }
  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
}
