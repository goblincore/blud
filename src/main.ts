import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena, registerArenaSurfaces, ZombieCluster, GameOverOverlay } from './game/arena';
import { createPlayer } from './game/player';
import { createDebugHud } from './ui/debug-hud';
import { ChargeHud } from './ui/charge-hud';
import { WeaponRegistry, Dynamite } from './game/weapons';
import { ParticlePool } from './game/gibs/particles';
import { ChunkSystem } from './game/gibs/chunks';
import { DecalPool } from './game/gibs/decals';
import { ExplosionVfx } from './vfx/explosion';
import { Screenshake } from './vfx/screenshake';
import { GibSystem } from './game/gibs';
import { loadZombieAtlas, loadGibTextures, loadExplosionAtlas, loadTexture } from './engine/asset-loader';
import type { GibbableDude } from './game/gibs';
import type { Player as WeaponPlayer, FrameCtx } from './game/weapons/types';
import type { Vec3 } from './game/gibs/particles';

/** Adapter: M1 player → GibbableDude (so the player can be registered for AOE damage). */
class PlayerGibAdapter implements GibbableDude {
  readonly id = 'player';
  readonly kind = 'player' as const;
  hp = 100;

  constructor(
    private readonly getPos: () => THREE.Vector3,
    private readonly getForward: () => THREE.Vector3,
  ) {}

  get pos(): Vec3 {
    const p = this.getPos();
    return { x: p.x, y: p.y, z: p.z };
  }

  takeDamage(_amount: number, _impulse: Vec3): void {
    // Player HP tracking — for M2, overcook = instant gib so this is mostly unused
    this.hp -= _amount;
  }
}

/** Adapter: M1 player → Weapon Player interface. */
class WeaponPlayerAdapter implements WeaponPlayer {
  constructor(
    private readonly getPos: () => THREE.Vector3,
    private readonly cam: THREE.PerspectiveCamera,
  ) {}

  get pos(): Vec3 {
    const p = this.getPos();
    return { x: p.x, y: p.y, z: p.z };
  }

  get forward(): Vec3 {
    const d = new THREE.Vector3();
    this.cam.getWorldDirection(d);
    return { x: d.x, y: d.y, z: d.z };
  }

  get handPos(): Vec3 {
    // Approximate hand position: slightly below eye level, offset right
    const p = this.getPos();
    return { x: p.x + 0.2, y: p.y + 1.3, z: p.z };
  }

  takeDamage(_amount: number, _impulse: Vec3): void {
    // Player damage — overcook = gib via GibSystem directly
  }
}

const FIXED_DT = 1 / 60;

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, camera, canvas, setRenderCallback } = createRenderer(mount);

  // ---- Physics
  const physics = await initPhysics();
  buildArena(scene, physics.world);
  registerArenaSurfaces();

  // ---- Input
  const input = createInputState();
  attachInput(canvas, input);

  // ---- Player (M1 character controller)
  const player = createPlayer({
    world: physics.world,
    camera,
    spawn: new THREE.Vector3(0, 2, 0),
  });

  // ---- Assets
  const [zombieAtlas, gibTextures, explosionAtlas, trailTex] = await Promise.all([
    loadZombieAtlas('/assets/enemies/zombie-placeholder/manifest.json'),
    loadGibTextures('/assets/gibs-placeholder/manifest.json'),
    loadExplosionAtlas('/assets/vfx/explosion-placeholder/manifest.json'),
    loadTexture('/assets/gibs-placeholder/trail/733-placeholder.png').catch(() => {
      // Fallback: create a 1x1 red pixel texture if trail sprite is missing
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#cc0000';
      ctx.fillRect(0, 0, 4, 4);
      const tex = new THREE.CanvasTexture(c);
      return tex;
    }),
  ]);

  // ---- Gib subsystems
  const particles = new ParticlePool(scene, 1024, trailTex);
  const decals    = new DecalPool(scene, 200, trailTex, 0.25);
  const chunks    = new ChunkSystem(physics.world, scene, particles, gibTextures, 1024, decals);
  const explosions = new ExplosionVfx(scene);
  const shake     = new Screenshake();

  // ---- Player adapters
  const playerGib = new PlayerGibAdapter(player.position, () => {
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    return d;
  });
  const weaponPlayer = new WeaponPlayerAdapter(player.position, camera);

  // ---- Game-over overlay
  let gameOverOverlay!: GameOverOverlay;
  const gibs = new GibSystem(
    physics.world, scene, particles, chunks, decals,
    explosions, explosionAtlas, shake,
    () => { gameOverOverlay.show(); },
  );
  gibs.registerDude(playerGib);

  gameOverOverlay = new GameOverOverlay(document.body, () => {
    // Full restart: clear gib state, respawn cluster, reset player
    cluster.reset();
    chunks.reset();
    decals.reset();
    shake.reset();
    playerGib.hp = 100;
    // Reset player position — re-create player body
    player.update(0, input); // no-op to satisfy interface; player stays where they are
    cluster.spawn(4);
  });

  // ---- Zombie cluster
  const cluster = new ZombieCluster(
    { scene, world: physics.world, atlas: zombieAtlas, gibs },
    { x: 0, y: 1, z: -6 },
  );
  cluster.spawn(4);

  // ---- Weapon + HUD
  const weapons = new WeaponRegistry();
  const chargeHud = new ChargeHud(document.body);

  // ---- R key: quick respawn cluster
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') {
      cluster.reset();
      chunks.reset();
      decals.reset();
      cluster.spawn(4);
    }
  });

  // ---- Weapon input
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const now = performance.now() / 1000;
    weapons.current.onPress({
      world: physics.world,
      player: weaponPlayer,
      gibs,
      now,
    });
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const now = performance.now() / 1000;
    weapons.current.onRelease({
      world: physics.world,
      player: weaponPlayer,
      gibs,
      now,
    });
  });

  function frameCtx(): FrameCtx {
    return {
      world: physics.world,
      player: weaponPlayer,
      gibs,
      now: performance.now() / 1000,
    };
  }

  // ---- Scheduler
  const scheduler = createScheduler({ stepSec: FIXED_DT, maxStepsPerTick: 5 });

  function fixedStep(dt: number) {
    physics.step(dt);
    player.update(dt, input);

    // Weapon tick (fuse countdown, projectile physics)
    const fctx = frameCtx();
    weapons.current.onFrame(fctx, dt);

    // Zombie AI + movement
    const ppos = player.position();
    cluster.update(dt, { x: ppos.x, y: ppos.y, z: ppos.z }, camera);
  }

  const hud = createDebugHud(document.getElementById('hud')!);

  // Hide "click to play" prompt on first click
  const prompt = document.getElementById('prompt');
  canvas.addEventListener('click', () => {
    if (prompt) prompt.classList.add('hidden');
  }, { once: true });

  setRenderCallback((realDt) => {
    scheduler.tick(realDt, fixedStep);

    const now = performance.now() / 1000;

    // Particle sim + render
    particles.update(realDt, camera);

    // Explosion VFX
    explosions.update(realDt * 1000, camera);

    // Chunk billboard update + despawn
    chunks.update(camera, now);

    // Screenshake offset (additive on camera rotation)
    const off = shake.sampleOffset(realDt);
    camera.rotation.x += off.pitch;
    camera.rotation.y += off.yaw;
    camera.rotation.z += off.roll;

    // HUD
    hud.update(realDt, player.position());
    const dyn = weapons.current as Dynamite;
    chargeHud.setCharge(dyn.chargeFractionAt(now));
  });

  console.log('[blud] M2 boot — dynamite + gibs + zombies');
}

main().catch((err) => console.error('[blud] boot failed', err));
