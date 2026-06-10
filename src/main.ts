import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena, installSkybox, registerArenaSurfaces, ZombieCluster, GameOverOverlay } from './game/arena';
import { createPlayer } from './game/player';
import { createDebugHud } from './ui/debug-hud';
import { ChargeHud } from './ui/charge-hud';
import { PauseMenu } from './ui/pause-menu';
import { WeaponRegistry, Dynamite, FlareGun } from './game/weapons';
import { StuckFlare } from './game/weapons/stuck-flare';
import { AxeZombie } from './game/enemy/axe-zombie';
import { ShotgunCultist } from './game/enemy/shotgun-cultist';
import { Pellet, pelletDirInCone } from './game/enemy/shotgun-pellet';
import { SHOTGUN_BLAST, ZOMBIE_GIB_PROFILE } from './game/gibs/tuning';
import { updateSmokeColumns } from './vfx/smoke-particles';
import { WaveRunner } from './game/encounter/wave-runner';
import { WARMUP_ROUND } from './game/encounter/encounters';
import type { EnemyKind } from './game/encounter/encounters';
import { GroundFlameManager } from './game/gibs/ground-flame';
import { configureProjectileRendering, setProjectileCamera } from './game/weapons/dynamite';
import { configureProjectileRendering as configureFlareProjectileRendering, setProjectileCamera as setFlareProjectileCamera } from './game/weapons/flare';
import { ParticlePool } from './game/gibs/particles';
import { ChunkSystem } from './game/gibs/chunks';
import { DecalPool } from './game/gibs/decals';
import { ExplosionVfx } from './vfx/explosion';
import { Screenshake } from './vfx/screenshake';
import { DEFAULT_POST_FX, isDevPanelEnabled } from './vfx/post-fx/config';
import { createPostFxComposer } from './vfx/post-fx/composer';
import { PostFxBus } from './vfx/post-fx/post-fx-bus';
import { mountDevPanel } from './vfx/post-fx/dev-panel';
import { GibSystem } from './game/gibs';
import { loadGibTextures, loadExplosionAtlas, loadTexture, loadAnimationManifests, loadSfxRegistry, loadAmbientBuffers } from './engine/asset-loader';
import { FpWeaponAnimator } from './animation/fp-weapon-animator';
import { BillboardAnimator } from './animation/billboard-animator';
import { createAudioEngine } from './audio/engine';
import { Sfx } from './audio/sfx';
import { SfxEvent } from './audio/events';
import { Ambient } from './audio/ambient';
import type { QavManifest, SeqManifest } from './animation/qav-schema';
import type { GibbableDude } from './game/gibs';
import type { ParticlePool as PPool } from './game/gibs/particles';
import type { GibProfile } from './game/gibs/tuning';
import type { Player as WeaponPlayer, FrameCtx } from './game/weapons/types';
import type { Vec3 } from './game/gibs/particles';

/** Adapter: M1 player → GibbableDude (so the player can be registered for AOE damage). */
class PlayerGibAdapter implements GibbableDude {
  readonly id = 'player';
  readonly kind = 'player' as const;
  hp = 100;
  readonly gibProfile: GibProfile = {
    fleshPicnums: [1454, 1268, 1269, 1456, 1267],
    bonePicnums: [],
    boneWeight: 0,
    bodyPartCount: { min: 2, max: 4 },
    chunkCount: { min: 8, max: 14 },
    spawnsKickableHead: false, // player gibs shouldn't drop a zombie head
  };

  constructor(
    private readonly getPos: () => THREE.Vector3,
    private readonly getForward: () => THREE.Vector3,
    private readonly bus?: PostFxBus,
  ) {}

  get pos(): Vec3 {
    const p = this.getPos();
    return { x: p.x, y: p.y, z: p.z };
  }

  takeDamage(amount: number, _impulse: Vec3): void {
    this.hp -= amount;
    // CA spike that decays back to baseline over 0.4s. Scales lightly with
    // damage — 0.015 floor so a glancing hit still reads, cap near 0.025.
    const intensity = 0.015 + 0.01 * Math.min(amount / 60, 1);
    this.bus?.triggerDamagePulse(intensity, 0.4, performance.now() / 1000);
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
  const { renderer, scene, camera, canvas, setRenderCallback, setDrawFn } = createRenderer(mount);

  // Skybox — dusky-red gradient, matches fog + clear color for a seamless
  // horizon fade. Call before buildArena so fog color is set when arena
  // geometry is queried by distance.
  installSkybox(scene, renderer);

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

  // Camera must be in the scene graph before AudioListener is added to it
  // (required for positional audio), and before FPV weapon meshes are parented.
  scene.add(camera);

  // Audio engine + SFX registry
  const audioEngine = createAudioEngine(camera);
  const sfxRegistry = await loadSfxRegistry(audioEngine);
  const sfx = new Sfx(audioEngine, sfxRegistry);
  const ambientPromise = loadAmbientBuffers(audioEngine).then(
    (bufs) => new Ambient(audioEngine, bufs.wind, bufs.spike, { minSec: 20, maxSec: 40 }),
  );

  const startAudioOnce = () => {
    if (audioEngine.ctx.state === 'suspended') audioEngine.ctx.resume();
    ambientPromise.then((a) => a.start(performance.now() / 1000));
    canvas.removeEventListener('click', startAudioOnce);
  };
  canvas.addEventListener('click', startAudioOnce);

  // Fallback placeholder for any missing dynamite bundle frame.
  const dynamiteFallback = (): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#aa2222';
    ctx.fillRect(2, 4, 12, 8);
    ctx.fillStyle = '#ff9944';
    ctx.fillRect(7, 1, 2, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  // ---- Assets
  const [gibTextures, explosionAtlas, trailTex, animBundle, dynamiteBundleFrames] = await Promise.all([
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
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }),
    loadAnimationManifests().catch((err) => {
      console.warn('[blud] animation manifests not loaded, FPV weapons disabled:', err);
      return undefined;
    }),
    // Flying dynamite bundle fuse-burn frames — Blood SEQ-driven picnum cycle
    // for kThingArmedTNTBundle (picnum base 3433). Authentic Blood cycles
    // tiles 3432 (fresh fuse) → 3435 (about to detonate) as the fuse burns
    // down. See actor.cpp:2015 thingInfo[kThingArmedTNTBundle-kThingBase] and
    // docs/dev-notes/2026-04-22-notblood-source-reference.md § "Thrown TNT
    // projectile in flight".
    //
    // The player throws a BUNDLE (weapon.cpp:2172 processTNT fires
    // nClientThrowBundle); single sticks (kThingArmedTNTStick picnum 3422) are
    // what cultists throw at you.
    Promise.all([3432, 3433, 3434, 3435].map((n) =>
      loadTexture(`/assets/weapons/dynamite-placeholder/bundle/${n}.png`).catch(dynamiteFallback)
    )),
  ]);

  // Projectile billboard rendering for thrown dynamite bundles
  configureProjectileRendering(scene, dynamiteBundleFrames);
  setProjectileCamera(camera);

  // ---- Gib subsystems
  const particles = new ParticlePool(scene, 1024, trailTex);
  const decals    = new DecalPool(scene, 2000, trailTex, 0.35);
  const chunks    = new ChunkSystem(physics.world, scene, particles, gibTextures!, 1024, decals);
  chunks.setSfx(sfx);
  const explosions = new ExplosionVfx(scene);
  const shake     = new Screenshake();

  // ---- Post-FX bus (constructed early so PlayerGibAdapter can fire damage pulses)
  const postFxBus = new PostFxBus(DEFAULT_POST_FX.ca.baseline);

  // ---- Player adapters
  const playerGib = new PlayerGibAdapter(
    player.position,
    () => {
      const d = new THREE.Vector3();
      camera.getWorldDirection(d);
      return d;
    },
    postFxBus,
  );
  const weaponPlayer = new WeaponPlayerAdapter(player.position, camera);

  // ---- Shared tile texture cache + getter (needed by ground flames, launched corpses, etc.)
  const tileCache = new Map<number, THREE.Texture>();
  const textureLoader = new THREE.TextureLoader();
  const getTileTexture = (picnum: number): THREE.Texture => {
    let t = tileCache.get(picnum);
    if (!t) {
      t = textureLoader.load(`assets/blood-tiles/${picnum}.png`);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      tileCache.set(picnum, t);
    }
    return t;
  };

  // ---- Game-over overlay
  let gameOverOverlay!: GameOverOverlay;
  const gibs = new GibSystem(
    physics.world, scene, particles, chunks, decals,
    explosions, explosionAtlas, shake,
    () => { gameOverOverlay.show(); },
  );
  gibs.registerDude(playerGib);

  // ---- Ground flames (persistent flame at burn-death position)
  const groundFlames = new GroundFlameManager();

  gameOverOverlay = new GameOverOverlay(document.body, () => {
    // Full restart: clear gib state, respawn cluster, reset player
    cluster.reset();
    chunks.reset();
    decals.reset();
    shake.reset();
    clearStuckFlares();
    groundFlames.clear(scene);
    pelletRegistry.length = 0;
    playerGib.hp = 100;
    // Reset player position — re-create player body
    player.update(0, input); // no-op to satisfy interface; player stays where they are
    cluster.spawn(4);
  });

  // ---- Animators (FPV weapon + zombie billboard)
  // Camera was added to the scene earlier (before AudioEngine construction).
  let fpAnimator: FpWeaponAnimator | undefined;
  let createZombieAnimator: () => BillboardAnimator;

  if (animBundle) {

    // FPV weapon animator
    fpAnimator = new FpWeaponAnimator(
      camera as THREE.PerspectiveCamera,
      animBundle.weapons as Record<string, QavManifest>,
      animBundle.tileMeta,
      getTileTexture,
    );
    // Don't pre-play here — Dynamite's lazy init on first onFrame plays the
    // equip animation (BUNUP2 'dynamite-raise'), then transitions to idle.

    // Billboard animator factory — each zombie gets its own instance
    createZombieAnimator = () => new BillboardAnimator(
      animBundle.characters as Record<string, SeqManifest>,
      animBundle.tileMeta,
      getTileTexture,
    );

    // Flare projectile billboard rendering (tile 2424 from kMissileFlareRegular)
    configureFlareProjectileRendering({ scene, getTileTexture });
    setFlareProjectileCamera(camera);
  } else {
    // Fallback: no-op animator factory when manifests are missing
    createZombieAnimator = () => new BillboardAnimator(
      {},
      {},
      () => new THREE.Texture(),
    );
  }

  // ---- Post-FX composer (bus already constructed above)
  const composer = createPostFxComposer(renderer, scene, camera, postFxBus, DEFAULT_POST_FX);
  setDrawFn(() => composer.render(0, performance.now() / 1000));

  let devPanelUnmount: (() => void) | null = null;
  if (isDevPanelEnabled()) devPanelUnmount = mountDevPanel(document.body, DEFAULT_POST_FX);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      if (devPanelUnmount) { devPanelUnmount(); devPanelUnmount = null; }
      else devPanelUnmount = mountDevPanel(document.body, DEFAULT_POST_FX);
    }
  });

  window.addEventListener('resize', () => {
    composer.setSize(renderer.domElement.width, renderer.domElement.height);
  });

  // ---- Zombie cluster
  const cluster = new ZombieCluster(
    { scene, world: physics.world, gibs, createAnimator: createZombieAnimator },
    { x: 0, y: 1, z: -6 },
  );
  cluster.spawn(4);
  cluster.setSfx(sfx);
  cluster.setParticlePool(particles);

  // Wire burn-death callback: spawn gibs + ground flame
  const burnDeathFlameTex = getTileTexture(2424); // reuse flare tile for ground flame
  const onBurnDeath = (pos: Vec3, now: number) => {
    // Spawn smaller gib burst for burn-death
    gibs.triggerGib(pos, { x: 0, y: 1, z: 0 }, ZOMBIE_GIB_PROFILE, now);
    // Spawn persistent ground flame
    groundFlames.spawn(pos, now, burnDeathFlameTex, scene);
  };
  cluster.setBurnDeathCallback(onBurnDeath);

  // ——— Stuck-flare global registry —————————————————
  const stuckFlareRegistry: StuckFlare[] = [];
  const clearStuckFlares = () => {
    for (const f of stuckFlareRegistry) {
      if (f.mesh) {
        scene.remove(f.mesh);
        f.disposeMesh();
      }
    }
    stuckFlareRegistry.length = 0;
  };
  let flareIdCounter = 0;

  // ——— Pellet global registry —————————————————————
  const pelletRegistry: Pellet[] = [];

  // ——— Spawn pellets from cultist fire ——————————
  function spawnPellets(origin: Vec3, dir: Vec3): void {
    const now = performance.now() / 1000;
    for (let i = 0; i < SHOTGUN_BLAST.pelletCount; i++) {
      const pelletDir = pelletDirInCone(dir, i, SHOTGUN_BLAST.pelletCount, SHOTGUN_BLAST.spreadConeDeg);
      const pellet = new Pellet(
        origin,
        pelletDir,
        SHOTGUN_BLAST.pelletSpeedMps,
        now,
        SHOTGUN_BLAST.pelletDamage,
      );
      pelletRegistry.push(pellet);
    }
  }

  function frameCtx(): FrameCtx {
    return {
      world: physics.world,
      player: weaponPlayer,
      gibs,
      now: performance.now() / 1000,
      fpAnimator,
      sfx,
    };
  }

  // ——— Wave runner ————————————————————————————————
  const waveRunner = new WaveRunner(WARMUP_ROUND, {
    pickSpawnPos: () => {
      // Pick one of 4 perimeter points around the arena
      const points = [
        { x: 15, y: 1, z: 0 },
        { x: -15, y: 1, z: 0 },
        { x: 0, y: 1, z: 15 },
        { x: 0, y: 1, z: -15 },
      ];
      return points[Math.floor(Math.random() * points.length)]!;
    },
    spawn: (kind, pos) => {
      const enemy = cluster.spawnOne(kind, pos);
      if (enemy instanceof ShotgunCultist) {
        enemy.brain.hooks = {
          ...enemy.brain.hooks,
          onFire: (origin: Vec3, dir: Vec3) => spawnPellets(origin, dir),
        };
      }
    },
  });

  // ---- Weapon + HUD
  const weapons = new WeaponRegistry();

  // ——— Configure FlareGun external hooks (spawn stuck flares, raycast) ———
  const flareGun = weapons.getFlareGun();
  flareGun.spawnStuckFlare = (pos, attachedBody) => {
    const flare = new StuckFlare(`flare-${flareIdCounter++}`, pos, attachedBody, performance.now() / 1000);
    stuckFlareRegistry.push(flare);

    // Create visible billboard — tile 2424 (kMissileFlareRegular), bright, no shadow occlusion.
    const flareTex = getTileTexture(2424);
    const mat = new THREE.MeshBasicMaterial({
      map: flareTex,
      transparent: true,
      depthWrite: false,
    });
    const geom = new THREE.PlaneGeometry(0.3, 0.3);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.position.set(pos.x, pos.y + 0.6, pos.z);
    scene.add(mesh);
    flare.mesh = mesh;

    if (attachedBody) {
      for (const z of cluster.getZombies()) {
        if (z.rigidBody.handle === attachedBody.handle) {
          if (z instanceof AxeZombie) z.attachFlare(flare);
          else if (z instanceof ShotgunCultist) z.attachFlare(flare);
          break;
        }
      }
    }
  };
  flareGun.raycastFn = (from, dir, maxDist) => {
    const dLen = Math.hypot(dir.x, dir.y, dir.z);
    if (dLen < 0.0001) return null;
    const rayDir = { x: dir.x / dLen, y: dir.y / dLen, z: dir.z / dLen };
    const ray = new RAPIER.Ray(
      { x: from.x, y: from.y, z: from.z },
      rayDir,
    );
    const hit = physics.world.castRayAndGetNormal(ray, maxDist, true);
    if (hit) {
      const toi = hit.timeOfImpact;
      const hitPoint = {
        x: from.x + rayDir.x * toi,
        y: from.y + rayDir.y * toi,
        z: from.z + rayDir.z * toi,
      };
      const body = hit.collider.parent();
      return { pos: hitPoint, body };
    }
    return null;
  };

  const chargeHud = new ChargeHud(document.body);

  // ---- Pause menu
  const pauseMenu = new PauseMenu(document.body, canvas, DEFAULT_POST_FX, audioEngine.sfxGain);

  // ---- R key: start wave runner round
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      // Only start if idle, victory, or defeat
      if (waveRunner.state() === 'active' || waveRunner.state() === 'breather') return;
      cluster.reset();
      chunks.reset();
      decals.reset();
      clearStuckFlares();
      groundFlames.clear(scene);
      pelletRegistry.length = 0;
      waveRunner.start(performance.now() / 1000);
    }
  });

  // TODO M5: remove debug T-key once mixed waves land
  // ---- T key: spawn one shotgun cultist at a perimeter point
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
      const points = [
        { x: 15, y: 1, z: 0 },
        { x: -15, y: 1, z: 0 },
        { x: 0, y: 1, z: 15 },
        { x: 0, y: 1, z: -15 },
      ];
      const pos = points[Math.floor(Math.random() * points.length)]!;
      const cultist = cluster.spawnOne('cultist-shotgun', pos);
      if (cultist instanceof ShotgunCultist) {
        cultist.brain.hooks = {
          ...cultist.brain.hooks,
          onFire: (origin: Vec3, dir: Vec3) => spawnPellets(origin, dir),
        };
      }
      console.log('[blud] spawned cultist at', pos);
    }
  });

  // ---- 1/2/Q: weapon-switch hotkeys
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '1') weapons.setSlot(1, frameCtx());
    else if (e.key === '2') weapons.setSlot(2, frameCtx());
    else if (e.key.toLowerCase() === 'q') weapons.toggle(frameCtx());
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
      fpAnimator,
      sfx,
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
      fpAnimator,
      sfx,
    });
  });

  // ---- Scheduler
  const scheduler = createScheduler({ stepSec: FIXED_DT, maxStepsPerTick: 5 });

  function fixedStep(dt: number) {
    physics.step(dt);
    player.update(dt, input);

    // Weapon tick (fuse countdown, projectile physics)
    // Single onFrame call — weapons.current now ticks whichever weapon is held.
    const fctx = frameCtx();
    weapons.current.onFrame(fctx, dt);

    // Zombie AI + movement
    const ppos = player.position();
    cluster.update(dt, { x: ppos.x, y: ppos.y, z: ppos.z }, camera);

    // ——— Stuck-flare registry tick ————————————
    const now = performance.now() / 1000;
    for (let i = stuckFlareRegistry.length - 1; i >= 0; i--) {
      const f = stuckFlareRegistry[i]!;
      const alive = f.update(now);
      if (!alive) {
        // Remove billboard mesh from scene
        if (f.mesh) {
          scene.remove(f.mesh);
          f.disposeMesh();
        }
        stuckFlareRegistry.splice(i, 1);
      } else if (f.mesh) {
        // Track the enemy position + billboard-face camera
        const rp = f.getRenderPos();
        f.mesh.position.set(rp.x, rp.y, rp.z);
        f.mesh.lookAt(camera.position);
      }
    }

    // ——— Pellet registry tick ——————————————————
    // Get player rigid body for hit detection (player body handle = 0 from player.ts)
    const playerBody = (player as any)._body as RAPIER.RigidBody | null;
    const pelletRaycastFn = (from: Vec3, dir: Vec3, maxDist: number) => {
      const dLen = Math.hypot(dir.x, dir.y, dir.z);
      if (dLen < 0.0001) return null;
      const rayDir = { x: dir.x / dLen, y: dir.y / dLen, z: dir.z / dLen };
      const ray = new RAPIER.Ray(
        { x: from.x, y: from.y, z: from.z },
        rayDir,
      );
      const hit = physics.world.castRayAndGetNormal(ray, maxDist, true);
      if (hit) {
        const toi = hit.timeOfImpact;
        return {
          pos: { x: from.x + rayDir.x * toi, y: from.y + rayDir.y * toi, z: from.z + rayDir.z * toi },
          body: hit.collider.parent(),
        };
      }
      return null;
    };
    for (let i = pelletRegistry.length - 1; i >= 0; i--) {
      const pellet = pelletRegistry[i]!;
      const alive = pellet.update(now, pelletRaycastFn, (dmg, imp) => weaponPlayer.takeDamage(dmg, imp), playerBody);
      if (!alive) pelletRegistry.splice(i, 1);
    }

    // ——— Cultist line-of-sight update —————————
    for (const z of cluster.getZombies()) {
      if (z instanceof ShotgunCultist) {
        // Approximate LOS: true if within fire range (real raycast is F2)
        const dx = z.pos.x - ppos.x;
        const dy = z.pos.y - ppos.y;
        const dz = z.pos.z - ppos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        z.setLineOfSight(dist <= 15); // generous — refines with raycast in F2
      }
    }

    // ——— Wave runner tick —————————————————————
    const playerAlive = playerGib.hp > 0;
    waveRunner.update(dt, now, playerAlive, cluster.aliveCount());
  }

  const hud = createDebugHud(document.getElementById('hud')!);

  // Hide "click to play" prompt on first click
  const prompt = document.getElementById('prompt');
  canvas.addEventListener('click', () => {
    if (prompt) prompt.classList.add('hidden');
  }, { once: true });

  // Last-frame player position for walk-speed estimate (drives FPV bob)
  // + footstep audio accumulator.
  let lastPlayerPos = player.position().clone();
  let playerDistAccum = 0;

  setRenderCallback((realDt) => {
    // Skip game simulation when paused (still renders frozen frame)
    if (pauseMenu.paused) return;

    scheduler.tick(realDt, fixedStep);

    const now = performance.now() / 1000;

    // Particle sim + render
    updateSmokeColumns(particles, realDt); // smoke from stuck flares
    particles.update(realDt, camera);

    // Ground flames (persistent after burn-death)
    groundFlames.update(now, camera);

    // Explosion VFX
    explosions.update(realDt * 1000, camera);

    // Chunk billboard update + despawn
    chunks.update(camera, now);

    // FPV weapon animator tick + walk-speed bob
    const p = player.position();
    const horizSpeed = realDt > 0
      ? Math.hypot(p.x - lastPlayerPos.x, p.z - lastPlayerPos.z) / realDt
      : 0;
    lastPlayerPos.copy(p);

    // Player footstep audio — fire every ~0.8m of horizontal travel
    if (horizSpeed > 0.5) {
      playerDistAccum += horizSpeed * realDt;
      if (playerDistAccum >= 0.8) {
        sfx.play(SfxEvent.PLAYER_FOOTSTEP);
        playerDistAccum = 0;
      }
    } else {
      playerDistAccum = 0;
    }

    fpAnimator?.setWalkSpeed(horizSpeed);
    fpAnimator?.update(now, realDt);

    // Screenshake offset (additive on camera rotation)
    const off = shake.sampleOffset(realDt);
    camera.rotation.x += off.pitch;
    camera.rotation.y += off.yaw;
    camera.rotation.z += off.roll;

    // HUD
    hud.update(realDt, player.position());
    const w = weapons.current;
    chargeHud.setCharge(w instanceof Dynamite ? w.chargeFractionAt(now) : 0);
  });

  console.log('[blud] M2 boot — dynamite + gibs + zombies + QAV animator');
}

main().catch((err) => console.error('[blud] boot failed', err));
