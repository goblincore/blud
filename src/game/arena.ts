import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AxeZombie } from './enemy/axe-zombie';
import { ShotgunCultist } from './enemy/shotgun-cultist';
import type { EnemyKind } from './encounter/encounters';
import { WAVE_PRESETS } from './gibs/tuning';
import { ZombieState } from './enemy/ai';
import type { GibSystem } from './gibs';
import type { StaticSurface, ParticlePool } from './gibs/particles';
import { setArenaSurfaces } from './gibs/particles';
import { loadTexture } from '../engine/asset-loader';
import type { Sfx } from '../audio/sfx';

// ——— Arena geometry (M1 + crypt-stone reskin) ——————————————————————

/**
 * Arena textures (Blood 'crypt stone' family, per R5 map research findings —
 * see docs/dev-notes/2026-04-21-blood-map-research.md).
 *
 * Resolves async after buildArena returns; materials start with a placeholder
 * tint and swap in the real texture once loaded (no flash, just an upgrade).
 */
async function loadArenaTextures(): Promise<{
  floor: THREE.Texture; wall: THREE.Texture; obstacle: THREE.Texture;
}> {
  const base = '/assets/arena-placeholder/';
  const [floor, wall, obstacle] = await Promise.all([
    loadTexture(base + '449.png'),
    loadTexture(base + '458.png'),
    loadTexture(base + '273.png'),
  ]);
  // All three are 128×128 seamless Blood tiles. Configure for repeat across
  // large surfaces — the floor is 40m so we tile aggressively.
  for (const t of [floor, wall, obstacle]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return { floor, wall, obstacle };
}

export function buildArena(scene: THREE.Scene, world: RAPIER.World): void {
  const floorSize = 40;
  const wallHeight = 4;
  const wallThick = 0.5;
  const TEX_METERS_PER_REPEAT = 2; // one 128×128 tile covers ~2m of geometry

  // Start with solid-color materials so the arena is valid immediately —
  // textures swap in once loaded.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a3a36 });
  const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a });

  loadArenaTextures().then(({ floor: fTex, wall: wTex, obstacle: oTex }) => {
    // Repeat settings per material — each material gets its own cloned texture
    // so the repeat counts can differ (otherwise all walls would share one).
    const floorRepeats = floorSize / TEX_METERS_PER_REPEAT;
    const wallRepeatsX = (floorSize + wallThick) / TEX_METERS_PER_REPEAT;
    const wallRepeatsY = wallHeight / TEX_METERS_PER_REPEAT;

    const ft = fTex.clone(); ft.needsUpdate = true;
    ft.repeat.set(floorRepeats, floorRepeats);
    floorMat.map = ft;
    floorMat.color.set(0xffffff); // white so texture reads true
    floorMat.needsUpdate = true;

    const wt = wTex.clone(); wt.needsUpdate = true;
    wt.repeat.set(wallRepeatsX, wallRepeatsY);
    wallMat.map = wt;
    wallMat.color.set(0xffffff);
    wallMat.needsUpdate = true;

    const ot = oTex.clone(); ot.needsUpdate = true;
    ot.repeat.set(1.5, 1.5);
    obstacleMat.map = ot;
    obstacleMat.color.set(0xffffff);
    obstacleMat.needsUpdate = true;
  }).catch((err) => {
    console.warn('[blud] arena textures failed to load, keeping solid colors:', err);
  });

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

// ——— Skybox —————————————————————————————————————————————————

/**
 * Basic dusky gradient skybox — replaces the flat dark background. Matches
 * Blud's Weird-West × brainrot-horror setting with a stormy purple-red dusk.
 *
 * Returns the horizon color so the caller can match fog + clear-color for
 * a seamless edge where distant geometry fades into the sky.
 */
export function installSkybox(scene: THREE.Scene, renderer: THREE.WebGLRenderer): { horizonColor: number } {
  const c = document.createElement('canvas');
  // Equirectangular layout: width = 2 × height. Small res is fine for a
  // smooth gradient — Three.js will upscale at runtime.
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  // Vertical gradient: zenith (top) → horizon (middle) → nadir (bottom).
  // Colors hand-picked for the Blud mood — deep purple/black at zenith,
  // bruised red at horizon, a touch brighter just above for atmospheric lift.
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.00, '#0a0510');   // zenith: near-black purple
  g.addColorStop(0.35, '#2a1218');   // upper sky: bruised plum
  g.addColorStop(0.50, '#4a1a1c');   // horizon: dusky red
  g.addColorStop(0.62, '#2a1218');   // just below horizon: back to plum (ground haze)
  g.addColorStop(1.00, '#0a0510');   // nadir (rarely seen under arena floor)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  scene.background = tex;

  // Horizon color drives fog + renderer clear so the arena fades into the
  // sky cleanly at distance. 0x4a1a1c matches the gradient's horizon stop.
  const horizonColor = 0x4a1a1c;
  if (scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.set(horizonColor);
  }
  renderer.setClearColor(horizonColor);

  return { horizonColor };
}

// ——— Static surface AABBs —————————————————————————————————

/**
 * Compute the 5 decal-receiving inner faces of the arena (floor + 4 walls).
 *
 * Ceiling is intentionally omitted — there's no ceiling mesh (the arena is
 * open to the skybox), so decals "above" would float in midair.
 */
export function arenaStaticSurfaces(): StaticSurface[] {
  const s = 20; // half of floorSize (40)
  const h = 4;  // wallHeight

  return [
    // Floor (normal up)
    { min: { x: -s, y: -0.5, z: -s }, max: { x: s, y: 0, z: s }, normal: { x: 0, y: 1, z: 0 } },
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
  gibs: GibSystem;
  /** Factory: creates a new BillboardAnimator for each spawned zombie. */
  createAnimator: () => import('../animation/billboard-animator').BillboardAnimator;
}

export class ZombieCluster {
  private zombies: (AxeZombie | ShotgunCultist)[] = [];
  private nextId = 0;
  private _sfx: Sfx | null = null;
  private _particlePool: ParticlePool | null = null;

  constructor(
    private readonly deps: ZombieSpawnDeps,
    private readonly center: { x: number; y: number; z: number },
  ) {}

  /** Wire SFX engine for all enemies (existing + future spawns). */
  setSfx(sfx: Sfx): void {
    this._sfx = sfx;
    for (const z of this.zombies) z.setSfx(sfx);
  }

  /** Wire particle pool for smoke emission from stuck flares (axe-zombies only). */
  setParticlePool(pool: ParticlePool): void {
    this._particlePool = pool;
    for (const z of this.zombies) {
      if (z instanceof AxeZombie) z.setParticlePool(pool);
    }
  }

  spawn(count = 4, radius = 1.5): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const pos = {
        x: this.center.x + Math.cos(angle) * radius,
        y: this.center.y,
        z: this.center.z + Math.sin(angle) * radius,
      };
      this.spawnOne('zombie', pos);
    }
  }

  /** Spawn a single enemy of the given kind at a specific position. */
  spawnOne(kind: EnemyKind, pos: { x: number; y: number; z: number }): AxeZombie | ShotgunCultist {
    if (kind === 'cultist-shotgun') {
      const c = ShotgunCultist.spawn(`cultist-${this.nextId++}`, this.deps.world, this.deps.scene, this.deps.createAnimator(), pos);
      if (this._sfx) c.setSfx(this._sfx);
      this.deps.gibs.registerDude(c);
      this.zombies.push(c);
      return c;
    }

    const z = AxeZombie.spawn(`zombie-${this.nextId++}`, this.deps.world, this.deps.scene, this.deps.createAnimator(), pos);
    if (kind === 'zombie-tough') {
      z.hp *= WAVE_PRESETS.zombieToughHpMultiplier;
      z.brain.hp = z.hp;
    }
    if (this._sfx) z.setSfx(this._sfx);
    if (this._particlePool) z.setParticlePool(this._particlePool);
    this.deps.gibs.registerDude(z);
    this.zombies.push(z);
    return z;
  }

  /** Number of alive enemies. */
  aliveCount(): number {
    return this.zombies.length;
  }

  /** Access the zombie/cultist array for collision matching. */
  getZombies(): readonly (AxeZombie | ShotgunCultist)[] {
    return this.zombies;
  }

  update(dt: number, playerPos: { x: number; y: number; z: number }, camera: THREE.Camera): void {
    for (const z of this.zombies) z.update(dt, playerPos, camera);
    // Reap dead enemies once their death animation has completed
    this.zombies = this.zombies.filter((z) => {
      if (z.shouldReap()) {
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
