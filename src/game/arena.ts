import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AxeZombie } from './enemy/axe-zombie';
import { ShotgunCultist } from './enemy/shotgun-cultist';
import type { EnemyKind } from './encounter/encounters';
import { WAVE_PRESETS, CORPSE } from './gibs/tuning';
import { ZombieState } from './enemy/ai';
import type { GibSystem } from './gibs';
import type { StaticSurface, ParticlePool, Vec3 } from './gibs/particles';
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

  // Overcast storm: dark slate-blue sky with a bruised tint, a paler band at the
  // horizon where weak light breaks through, plus procedural cloud streaks. The
  // open outdoor-ruins mood (vs the old enclosed dusky-red box).
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.00, '#0b0d14');   // zenith: near-black slate
  g.addColorStop(0.34, '#181a26');   // upper sky: dark storm
  g.addColorStop(0.50, '#3a3744');   // horizon: pale stormy break (bruise-grey)
  g.addColorStop(0.60, '#1c1822');   // ground haze
  g.addColorStop(1.00, '#08060c');   // nadir (rarely seen under the floor)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  // Procedural overcast clouds — soft grey blobs banded across the upper sky.
  // Pure cosmetic; placement randomness is fine (not sim state).
  for (let i = 0; i < 48; i++) {
    const x = Math.random() * c.width;
    const y = 50 + Math.random() * 210;
    const r = 40 + Math.random() * 130;
    const a = 0.04 + Math.random() * 0.10;
    const shade = 150 + Math.floor(Math.random() * 60);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${shade},${shade},${shade + 12},${a})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  scene.background = tex;

  // Horizon color drives fog + renderer clear so the arena fades into the
  // sky cleanly at distance. Matches the stormy-grey horizon stop above.
  const horizonColor = 0x2a2833;
  if (scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.set(horizonColor);
  }
  renderer.setClearColor(horizonColor);

  return { horizonColor };
}

/** Procedural bare-tree silhouette (canvas) for the ruins backdrop. */
function makeDeadTreeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#08080c';
  ctx.lineCap = 'round';
  const baseX = 64;
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(baseX, 256); ctx.lineTo(baseX, 120); ctx.stroke();
  // recursive bare branches (forking, thinning)
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    if (depth === 0 || len < 6) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    branch(x2, y2, ang - 0.4 - Math.random() * 0.3, len * 0.72, w * 0.7, depth - 1);
    branch(x2, y2, ang + 0.4 + Math.random() * 0.3, len * 0.72, w * 0.7, depth - 1);
  };
  branch(baseX, 130, -Math.PI / 2, 52, 7, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sparse ring of bare dead trees beyond the arena walls, silhouetted against
 *  the stormy sky — sells the open outdoor-ruins read. Pure cosmetic, no
 *  colliders, added once. Trees are tall enough to rise above the perimeter. */
export function addRuinsBackdrop(scene: THREE.Scene): void {
  const mat = new THREE.SpriteMaterial({
    map: makeDeadTreeTexture(), transparent: true, depthWrite: false, fog: true,
  });
  const group = new THREE.Group();
  const COUNT = 28;
  for (let i = 0; i < COUNT; i++) {
    const ang = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
    const rad = 34 + Math.random() * 18;       // beyond the ~28 m perimeter
    const h = 9 + Math.random() * 7;            // 9..16 m — clears the 4 m walls
    const s = new THREE.Sprite(mat);
    s.position.set(Math.cos(ang) * rad, h / 2 - 0.5, Math.sin(ang) * rad);
    s.scale.set(h * 0.5, h, 1);
    group.add(s);
  }
  scene.add(group);
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
      if (z instanceof ShotgunCultist) z.setParticlePool(pool);
    }
  }

  /** Wire burn-death callback (gibs + ground flame) for all enemies. */
  setBurnDeathCallback(cb: (pos: Vec3, now: number) => void): void {
    for (const z of this.zombies) z.onBurnDeath = cb;
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
      if (this._particlePool) c.setParticlePool(this._particlePool);
      this.deps.gibs.registerDude(c);
      c.onImpactGib = (pos) => this.impactGib(c, pos);
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
    z.onHeadPop = (pos) => this.deps.gibs.popHead(pos, performance.now() / 1000);
    z.onImpactGib = (pos) => this.impactGib(z, pos);
    this.zombies.push(z);
    return z;
  }

  /** Hard-landing burst: a launched body (alive or dead) hit the ground above
   *  impactGibSpeedMps — full gib at the landing spot (NotBlood fall damage).
   *  onGibbed marks it for reaping; the reap loop unregisters next update. */
  private impactGib(e: AxeZombie | ShotgunCultist, pos: { x: number; y: number; z: number }): void {
    this.deps.gibs.triggerGib(pos, { x: 0, y: 3, z: 0 }, e.gibProfile, performance.now() / 1000);
    e.onGibbed();
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

    // Corpse cap — corpses persist as re-gibbable props (NotBlood feel), but
    // force-reap the oldest beyond the cap so the arena doesn't fill up.
    // Exclude airborne bodies — yanking a mid-flight corpse out of the array
    // would leave it frozen at its last physics position.
    const corpses = this.zombies.filter((z) => z.isCorpse && !z.isAirborne);
    if (corpses.length > CORPSE.maxCorpses) {
      corpses.sort((a, b) => a.getDeathTime() - b.getDeathTime());
      const excess = corpses.slice(0, corpses.length - CORPSE.maxCorpses);
      for (const z of excess) {
        this.deps.gibs.unregisterDude(z.id);
        z.despawn();
        const idx = this.zombies.indexOf(z);
        if (idx !== -1) this.zombies.splice(idx, 1);
      }
    }
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
