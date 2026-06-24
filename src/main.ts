import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { installSkybox, addRuinsBackdrop, ZombieCluster, GameOverOverlay } from './game/arena';
import { bakeLevelCosmetic } from './game/level/bake-cosmetic';
import { SimRunner } from './sim/runner';
import { EMPTY_INPUT, BTN_JUMP, BTN_SPRINT, type InputCommand } from './sim/types';
import { createDebugHud } from './ui/debug-hud';
import { ChargeHud } from './ui/charge-hud';
import { PauseMenu } from './ui/pause-menu';
import { WeaponRegistry, Dynamite, FlareGun } from './game/weapons';
import { StuckFlare } from './game/weapons/stuck-flare';
import { AxeZombie } from './game/enemy/axe-zombie';
import { ShotgunCultist, type CultistSimAnim } from './game/enemy/shotgun-cultist';
import { ZOMBIE_GIB_PROFILE, BLOOD_SPLAT, EXPLOSION_STANDARD } from './game/gibs/tuning';
import { updateSmokeColumns } from './vfx/smoke-particles';
import { WaveRunner } from './game/encounter/wave-runner';
import { WARMUP_ROUND } from './game/encounter/encounters';
import type { EnemyKind } from './game/encounter/encounters';
import { GroundFlameManager } from './game/gibs/ground-flame';
import { configureProjectileRendering, setProjectileCamera, fuseFrameIndex } from './game/weapons/dynamite';
import { THROW } from './sim/projectile';
import { fpToMeters } from './sim/fp';
import { DudeAi } from './sim/dude';
import { configureProjectileRendering as configureFlareProjectileRendering, setProjectileCamera as setFlareProjectileCamera } from './game/weapons/flare';
import { ParticlePool, bloodSplatPositions } from './game/gibs/particles';
import { mulberry32 } from './game/rng';
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
import { muzzleWorldPosition, type CameraBasis } from './game/weapons/muzzle-pos';
import { BillboardAnimator } from './animation/billboard-animator';
import { createAudioEngine } from './audio/engine';
import { Sfx } from './audio/sfx';
import { SfxEvent } from './audio/events';
import { Ambient } from './audio/ambient';
import type { QavManifest, SeqManifest } from './animation/qav-schema';
import type { ParticlePool as PPool } from './game/gibs/particles';
import type { Player as WeaponPlayer, FrameCtx } from './game/weapons/types';
import type { Vec3 } from './game/gibs/particles';

/** Adapter: M1 player → Weapon Player interface. */
class WeaponPlayerAdapter implements WeaponPlayer {
  /** Optional view-bob provider (the FPV animator); wired after the animator
   *  is constructed. Returns the bob in camera space (x=right, y=up). */
  private bobProvider: (() => { x: number; y: number }) | undefined;

  constructor(
    private readonly getPos: () => THREE.Vector3,
    private readonly cam: THREE.PerspectiveCamera,
  ) {}

  /** Wire the FPV animator's view-bob so the muzzle tracks the gun sprite. */
  setBobProvider(fn: () => { x: number; y: number }): void {
    this.bobProvider = fn;
  }

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
    // Anchor the muzzle to the *camera basis* (not world axes) so it rotates
    // with yaw/pitch and stays under the first-person gun sprite while
    // strafing. The camera's world matrix columns give an orthonormal basis;
    // updateWorldMatrix ensures it reflects the current position/rotation set
    // during this fixed step (before the renderer would refresh it).
    this.cam.updateWorldMatrix(true, false);
    const e = this.cam.matrixWorld.elements;
    const basis: CameraBasis = {
      right: { x: e[0], y: e[1], z: e[2] },     // local +X (screen-right)
      up: { x: e[4], y: e[5], z: e[6] },        // local +Y (screen-up)
      forward: { x: -e[8], y: -e[9], z: -e[10] }, // local -Z (look dir)
    };
    const eye = this.cam.position; // eye = body + EYE_HEIGHT (set in player.update)
    const bob = this.bobProvider?.() ?? { x: 0, y: 0 };
    return muzzleWorldPosition(
      { x: eye.x, y: eye.y, z: eye.z },
      basis,
      HAND_MUZZLE_LATERAL,
      HAND_MUZZLE_VERTICAL,
      HAND_MUZZLE_FORWARD,
      bob,
    );
  }

  takeDamage(_amount: number, _impulse: Vec3): void {
    // Player damage — overcook = gib via GibSystem directly
  }
}

/** Map the sim's DudeAi state → a cosmetic cultist anim hint (Plan 4). The sim
 *  owns the cultist's AI; this is the anim-state mapping fed into the cosmetic
 *  ShotgunCultist via setSimDrive. Idle→idle, Chase/Goto/Search/Dodge/SThrow→
 *  walk, SFire→fire, Recoil→recoil. */
function dudeAiToAnim(ai: DudeAi): CultistSimAnim {
  switch (ai) {
    case DudeAi.SFire: return 'fire';
    case DudeAi.Recoil: return 'recoil';
    case DudeAi.Idle: return 'idle';
    default: return 'walk'; // Chase / Goto / Search / Dodge / SThrow
  }
}

// ——— FPV muzzle tuning ————————————————————————————
// Hand/muzzle offset in *camera* space, relative to the eye (camera origin).
// The lateral/vertical rotate with the camera so the muzzle tracks the
// first-person gun sprite when turning/strafing (see muzzle-pos.ts).
// Old world-space handPos was body.y + 1.3 with eye at body.y + 1.55, so the
// muzzle sat 0.25 m below eye — preserved here as VERTICAL = -0.25.
const HAND_MUZZLE_LATERAL = 0.2; // screen-right of eye
const HAND_MUZZLE_VERTICAL = -0.25; // below eye
const HAND_MUZZLE_FORWARD = 0.5; // toward the gun muzzle (gun renders at ~0.6 m)

// Dynamite throw origin — camera-space offset so the bundle leaves the player's
// RIGHT HAND (lower-right of view) and arcs toward center, not from the eye/center.
// (Migration regression: the sim throw hook had spawned at the raw eye.) Tunable.
const DYN_THROW_LATERAL = 0.35;  // right of eye → right hand
const DYN_THROW_VERTICAL = -0.5; // below eye → toward center-bottom
const DYN_THROW_FORWARD = 0.4;   // slightly in front of the eye

const FIXED_DT = 1 / 60;

async function main() {
  const mount = document.getElementById('app')!;
  const { renderer, scene, camera, canvas, setRenderCallback, setDrawFn } = createRenderer(mount);

  // Skybox — stormy overcast gradient + clouds, matches fog + clear color for a
  // seamless horizon fade. Call before bakeLevelCosmetic so fog color is set
  // when level geometry is queried by distance.
  installSkybox(scene, renderer);
  // Dead-tree ring beyond the walls — open outdoor-ruins backdrop (cosmetic).
  addRuinsBackdrop(scene);

  // ---- Physics
  const physics = await initPhysics();

  // ---- Input
  const input = createInputState();
  attachInput(canvas, input);

  // ---- Deterministic sim player (120 Hz)
  // Replaces the Rapier kinematic player capsule + character controller.
  // The sim core is Three/Rapier-free; main.ts drives the camera from the
  // interpolated PlayerRender at render time.
  const sim = new SimRunner(0xb1d);
  const level = bakeLevelCosmetic(sim.floorplan(), scene, physics.world);

  // ---- Input sampler: converts InputState → per-tic InputCommand.
  // Mouse delta is consumed exactly once per sim tic (inside sampleInput via
  // consumeMouseDelta). The old player.update consumed it — this replaces that.
  const RAD_TO_BANGLE = 2048 / (Math.PI * 2);
  const MOUSE_SENS_BANGLE = 0.0022 * RAD_TO_BANGLE; // 0.0022 rad/count × 2048/(2π)
  const PITCH_LIMIT_BANGLE = Math.round((Math.PI / 2 - 0.05) * RAD_TO_BANGLE);
  let aimYaw = 0;   // accumulated absolute Blood angle
  let aimPitch = 0;
  // Face the player toward the arena at spawn (the floorplan start angle).
  aimYaw = sim.playerStartMeters().angBlood;
  function sampleInput(): InputCommand {
    const { dx, dy } = input.consumeMouseDelta();
    aimYaw = Math.round(((aimYaw - dx * MOUSE_SENS_BANGLE) % 2048 + 2048) % 2048);
    aimPitch = Math.round(aimPitch - dy * MOUSE_SENS_BANGLE);
    if (aimPitch > PITCH_LIMIT_BANGLE) aimPitch = PITCH_LIMIT_BANGLE;
    if (aimPitch < -PITCH_LIMIT_BANGLE) aimPitch = -PITCH_LIMIT_BANGLE;
    let buttons = 0;
    if (input.isDown('Space')) buttons |= BTN_JUMP;
    if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) buttons |= BTN_SPRINT;
    return {
      moveForward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
      moveStrafe: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
      aimYaw, aimPitch, buttons,
    };
  }

  // ---- player adapter: thin shim over the sim player so legacy callers
  // (enemy AI, weapon origin, lastPlayerPos, hud) keep getting a THREE.Vector3
  // at the player's eye position — matching what the old position() returned.
  const player = {
    position(): THREE.Vector3 {
      const r = sim.playerRender();
      return new THREE.Vector3(r.xMeters, r.eyeYMeters, r.zMeters);
    },
  };

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
  const [gibTextures, groundExplosionAtlas, airExplosionAtlas, trailTex, animBundle, dynamiteBundleFrames] = await Promise.all([
    loadGibTextures('/assets/gibs-placeholder/manifest.json'),
    // NotBlood dynamite plays two explosion SEQs by floor contact: ground
    // (dome→mushroom, SEQ 3) when it rests on the floor, air (compact fireball,
    // SEQ 4) mid-air. GibSystem picks between them per detonation.
    loadExplosionAtlas('/assets/vfx/explosion-ground-placeholder/manifest.json'),
    loadExplosionAtlas('/assets/vfx/explosion-air-placeholder/manifest.json'),
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

  // Cultist shotgun-pellet tracer sprite — NotBlood kMissileShell (tile 9295,
  // extracted from notblood.pk3/TILES099.ART). Null-safe: falls back to a flat
  // glow if the placeholder asset is absent.
  const pelletTex = await loadTexture('/assets/weapons/shotgun-shell-placeholder/9295-placeholder.png').catch(() => null);

  // Projectile billboard rendering for thrown dynamite bundles
  configureProjectileRendering(scene, dynamiteBundleFrames);
  setProjectileCamera(camera);

  // ---- Gib subsystems
  const particles = new ParticlePool(scene, 1024, trailTex);
  const decals    = new DecalPool(scene, 2000, trailTex, 0.35);
  // Blood-splat cascade (NotBlood fxBloodBits): a settling blood particle
  // stamps a floor splat at a random offset, ~31% chance of a second pool.
  const splatRng = mulberry32(0x5b100d);
  particles.setBloodSettleHandler((pos, normal) => {
    for (const sp of bloodSplatPositions(splatRng, pos, normal, BLOOD_SPLAT.spreadM, BLOOD_SPLAT.secondChance)) {
      decals.spawn(sp, normal);
    }
  });
  const chunks    = new ChunkSystem(physics.world, scene, particles, gibTextures!, 1024, decals);
  chunks.setSfx(sfx);
  const explosions = new ExplosionVfx(scene);
  const shake     = new Screenshake();

  // ---- Post-FX bus (constructed early so the sim-hp damage pulse can fire)
  const postFxBus = new PostFxBus(DEFAULT_POST_FX.ca.baseline);

  // ---- Player adapters
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
    explosions, groundExplosionAtlas, airExplosionAtlas, shake,
    () => { gameOverOverlay.show(); },
  );
  // NOTE: the player is intentionally NOT registered here (Plan 4). Explosion-
  // vs-player damage is now sim-authoritative (stepSim → applyExplosionToPlayer)
  // and cultist pellets damage the sim player via stepDudes hitscan, so
  // registering the player for the legacy AOE would double-count.

  // ---- Ground flames (persistent flame at burn-death position)
  const groundFlames = new GroundFlameManager();

  gameOverOverlay = new GameOverOverlay(document.body, () => {
    // Full restart: clear gib state, respawn cluster, reset player
    cluster.reset();
    gibs.reset();
    chunks.reset();
    decals.reset();
    shake.reset();
    clearStuckFlares();
    groundFlames.clear(scene);
    // Reset sim player back to its floorplan start. sim.reset clears dudes +
    // projectiles + restores player hp to 100. Same map (deterministic) — no
    // cosmetic rebuild needed.
    sim.reset();
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
    // Wire the animator's view-bob into the weapon adapter so the flare /
    // dynamite muzzle origin tracks the swaying gun sprite while walking.
    weaponPlayer.setBobProvider(() => fpAnimator?.getBobOffset() ?? { x: 0, y: 0 });
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
    // Spawn smaller gib burst for burn-death. Head only 50% of the time —
    // NotBlood gates the burning-zombie head gib on Chance(0x8000)
    // (actor.cpp kDudeBurningZombieAxe case).
    gibs.triggerGib(
      pos,
      { x: 0, y: 1, z: 0 },
      { ...ZOMBIE_GIB_PROFILE, spawnsKickableHead: Math.random() < 0.5 },
      now,
    );
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

  // ——— Spawn a sim-driven shotgun cultist (Plan 4) ————————————————
  // Mirrors the kickable-head pattern: spawn the cosmetic ShotgunCultist via the
  // cluster, then spawn its deterministic sim dude and keep the index alongside
  // it. The cosmetic billboard/anim + facing are driven from sim.dudeRenders()
  // each fixed step (applyCultistSimDrive). Player→dude damage stays legacy
  // (dynamite AOE / flare hit the cosmetic body); kills + non-lethal hits bridge
  // back to the sim via onSimKill / onSimRecoil.
  function spawnSimCultist(pos: { x: number; y: number; z: number }): ShotgunCultist | null {
    const enemy = cluster.spawnOne('cultist-shotgun', pos);
    if (!(enemy instanceof ShotgunCultist)) return null;
    const cultist = enemy;
    // Face the arena center (0,0) at spawn. Blood facing θ moves toward
    // (-sinθ,-cosθ); to aim at (0,0) from (pos.x,pos.z) → sinθ∝pos.x, cosθ∝pos.z
    // → θ = atan2(pos.x, pos.z). The sim wraps internally; normalize to [0,2048).
    const angBlood = Math.round(
      ((Math.atan2(pos.x, pos.z) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2),
    );
    const idx = sim.spawnDude(pos.x, pos.z, angBlood);
    cultist.simDudeIndex = idx;
    cultist.onSimKill = () => sim.killDude(idx);
    cultist.onSimRecoil = () => sim.recoilDude(idx);
    return cultist;
  }

  // ——— Wave runner ————————————————————————————————
  const waveRunner = new WaveRunner(WARMUP_ROUND, {
    pickSpawnPos: () => {
      const pts = sim.spawnPointsMeters();
      if (pts.length === 0) return { x: 0, y: 1, z: 0 };
      const p = pts[Math.floor(Math.random() * pts.length)]!;
      return { x: p.x, y: 1, z: p.z };
    },
    spawn: (kind, pos) => {
      if (kind === 'cultist-shotgun') {
        spawnSimCultist(pos);
      } else {
        cluster.spawnOne(kind, pos);
      }
    },
  });

  // ---- Weapon + HUD
  const weapons = new WeaponRegistry();

  // ——— Configure FlareGun external hooks (spawn stuck flares, raycast) ———
  const flareGun = weapons.getFlareGun();
  flareGun.spawnStuckFlare = (pos, attachedBody) => {
    // NotBlood actor.cpp:3884-3896 — a flare STICKS only to flesh (a dude). A flare
    // that hits a wall, floor, or any non-dude gibs into a spark and vanishes; it
    // does NOT create a persistent floating flare. So resolve the enemy this hit
    // body belongs to first, and only stick if it's one.
    let enemy: AxeZombie | ShotgunCultist | null = null;
    if (attachedBody) {
      for (const z of cluster.getZombies()) {
        if (z.rigidBody.handle === attachedBody.handle) { enemy = z; break; }
      }
    }

    if (!enemy) {
      // Geometry / miss — brief spark and vanish (mirrors NotBlood's GibSprite on
      // a non-flesh impact). No StuckFlare is created, so nothing floats.
      particles.emitBurst(pos, {
        tile: 2424, count: 8, speedMin: 2.0, speedMax: 5.0,
        gravity: 9.8, airdrag: 0.3, lifetimeSec: 0.35, size: 0.12,
      });
      return;
    }

    // Flesh hit — stick the flare to the dude (persists until death; the host
    // extinguishes it on death — see AxeZombie/ShotgunCultist.update) and ignite.
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

    if (enemy instanceof AxeZombie) enemy.attachFlare(flare);
    else if (enemy instanceof ShotgunCultist) enemy.attachFlare(flare);
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

  // ——— Configure Dynamite throw hook (routes throw into the deterministic sim) ———
  const dynamite = weapons.getDynamite();
  dynamite.throwHook = (speedMps, impact) => {
    // Spawn at the player's RIGHT HAND, not the eye: a camera-space offset (the
    // same basis the FPV muzzle uses) so the bundle leaves the lower-right of the
    // view and arcs toward center. Aim direction still comes from aimYaw/aimPitch.
    // (Determinism note: uses the live interpolated camera; fine for the legacy
    // single-player throw — becomes a deterministic sim input when weapons migrate.)
    camera.updateWorldMatrix(true, false);
    const m = camera.matrixWorld.elements;
    const basis: CameraBasis = {
      right: { x: m[0], y: m[1], z: m[2] },
      up: { x: m[4], y: m[5], z: m[6] },
      forward: { x: -m[8], y: -m[9], z: -m[10] },
    };
    const eye = camera.position;
    const hand = muzzleWorldPosition(
      { x: eye.x, y: eye.y, z: eye.z }, basis,
      DYN_THROW_LATERAL, DYN_THROW_VERTICAL, DYN_THROW_FORWARD,
    );
    sim.spawnProjectile(
      hand.x, hand.y, hand.z,
      aimYaw, aimPitch, speedMps,
      impact ? THROW.impactSafetyFuseTics : THROW.fuseMaxTics,
      impact,
    );
  };

  // ——— Route head-pops into the deterministic sim (plan 3.5: shared kickable head) ———
  // ChunkSystem.spawnHeadChunk funnels BOTH the 25% normal popHead and the
  // explosion-launched head; this hook makes every head a sim object instead of a
  // Rapier body. The blood spray (popHead's emitBurst) stays cosmetic.
  chunks.spawnHeadHook = (origin, vel) => {
    sim.spawnHead(origin.x, origin.y, origin.z, vel.x, vel.y, vel.z);
  };

  // ——— Sim projectile billboard registry ————————————————————————
  // Three.js billboard meshes driven by sim.projectileRenders(). Created/removed to
  // match the sim projectile list. Spin is applied after lookAt (screen-space rotation).
  interface ProjMeshEntry {
    mesh: THREE.Mesh;
    spinPhase: number;
    spinRate: number;
    lastFrameIdx: number;
  }
  const projMeshes: ProjMeshEntry[] = [];

  function syncProjectileBillboards(realDt: number): void {
    const renders = sim.projectileRenders();
    // Grow the mesh pool to match renders
    while (projMeshes.length < renders.length) {
      const geom = new THREE.PlaneGeometry(0.42, 0.18);
      const mat = new THREE.MeshBasicMaterial({
        map: dynamiteBundleFrames[0]!,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const spinRate = (2 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1);
      projMeshes.push({ mesh, spinPhase: 0, spinRate, lastFrameIdx: -1 });
    }
    // Shrink the mesh pool (projectiles detonated)
    while (projMeshes.length > renders.length) {
      const entry = projMeshes.pop()!;
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    // Update positions + billboard orientation + fuse-burn frame
    for (let i = 0; i < renders.length; i++) {
      const r = renders[i]!;
      const entry = projMeshes[i]!;
      entry.mesh.position.set(r.xMeters, r.yMeters, r.zMeters);
      entry.mesh.lookAt(camera.position);
      entry.spinPhase = (entry.spinPhase + entry.spinRate * realDt) % (Math.PI * 2);
      entry.mesh.rotateZ(entry.spinPhase);
      // Fuse-burn frame cycling (Blood SEQ 3432→3435)
      if (dynamiteBundleFrames.length > 1) {
        const idx = fuseFrameIndex(r.fuseTics, r.fuseMaxTics, dynamiteBundleFrames.length);
        if (idx !== entry.lastFrameIdx) {
          const mat = entry.mesh.material as THREE.MeshBasicMaterial;
          mat.map = dynamiteBundleFrames[idx]!;
          mat.needsUpdate = true;
          entry.lastFrameIdx = idx;
        }
      }
    }
  }

  // ——— Sim kickable-head billboard registry ————————————————————————
  // Three.js billboards driven by sim.headRenders(). Created/removed to match the
  // sim head list; each faces the camera (lookAt). Tile 3405 = zombie head.
  const ZOMBIE_HEAD_PICNUM = 3405;
  const HEAD_BILLBOARD_SIZE = 0.45;
  // The sim head's y is its BOTTOM (floor = 0); the billboard is centred on its
  // position, so lift it half its height or it renders half-sunk through the floor.
  const HEAD_BILLBOARD_HALF = HEAD_BILLBOARD_SIZE / 2;
  const headMeshes: THREE.Mesh[] = [];

  function syncHeadBillboards(): void {
    const renders = sim.headRenders();
    while (headMeshes.length < renders.length) {
      const geom = new THREE.PlaneGeometry(HEAD_BILLBOARD_SIZE, HEAD_BILLBOARD_SIZE);
      const mat = new THREE.MeshBasicMaterial({
        map: gibTextures!.get(ZOMBIE_HEAD_PICNUM),
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      headMeshes.push(mesh);
    }
    while (headMeshes.length > renders.length) {
      const mesh = headMeshes.pop()!;
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (let i = 0; i < renders.length; i++) {
      const r = renders[i]!;
      const mesh = headMeshes[i]!;
      mesh.position.set(r.xMeters, r.yMeters + HEAD_BILLBOARD_HALF, r.zMeters);
      mesh.lookAt(camera.position);
    }
  }

  // ——— Sim shotgun-pellet tracer registry ————————————————————————
  // Cosmetic billboards driven by sim.pelletRenders(). The pellets are real,
  // deterministic sim entities (they travel + damage the player in-sim, NotBlood
  // nHitscanProjectiles mode); these tiny glowing quads just make them visible so
  // the player can see (and dodge) the shot. Created/removed to match the list.
  const PELLET_TRACER_SIZE = 0.16;
  const pelletMeshes: THREE.Mesh[] = [];

  function syncPelletTracers(): void {
    const renders = sim.pelletRenders();
    while (pelletMeshes.length < renders.length) {
      const geom = new THREE.PlaneGeometry(PELLET_TRACER_SIZE, PELLET_TRACER_SIZE);
      const mat = new THREE.MeshBasicMaterial({
        map: pelletTex ?? null,
        color: pelletTex ? 0xffffff : 0xffcc66, // tint white when textured so the sprite colors show
        transparent: true,
        opacity: pelletTex ? 1 : 0.95,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      pelletMeshes.push(mesh);
    }
    while (pelletMeshes.length > renders.length) {
      const mesh = pelletMeshes.pop()!;
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (let i = 0; i < renders.length; i++) {
      const r = renders[i]!;
      const mesh = pelletMeshes[i]!;
      mesh.position.set(r.xMeters, r.yMeters, r.zMeters);
      mesh.lookAt(camera.position);
    }
  }

  const chargeHud = new ChargeHud(document.body);

  // ---- Pause menu
  const pauseMenu = new PauseMenu(document.body, canvas, DEFAULT_POST_FX, audioEngine.sfxGain);

  // ---- R key: start wave runner round
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      // Only start if idle, victory, or defeat
      if (waveRunner.state() === 'active' || waveRunner.state() === 'breather') return;
      cluster.reset();
      gibs.reset();
      chunks.reset();
      decals.reset();
      clearStuckFlares();
      groundFlames.clear(scene);
      // Clear sim dudes — cluster.reset() despawned the cosmetic cultists, so
      // their sim dudes (alive or dead) must be dropped too for a clean wave.
      sim.clearDudes();
      waveRunner.start(performance.now() / 1000);
    }
  });

  // ---- G key: toggle debug god mode (invulnerable) — playtest AI without dying
  // ---- M key: reroll the generated map (dev aid — rebuilds cosmetic + reseeds facing)
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) {
      sim.setInvulnerable(!sim.isInvulnerable());
      console.log(`[blud] god mode ${sim.isInvulnerable() ? 'ON' : 'OFF'}`);
    }
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
      const seed = Math.floor(Math.random() * 0x7fffffff) >>> 0;
      sim.reroll(seed);
      level.rebuild(sim.floorplan());
      sim.clearDudes();
      aimYaw = sim.playerStartMeters().angBlood;
      console.info('[blud] rerolled map, seed', seed);
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
      spawnSimCultist(pos);
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
    // Note: player movement is now driven by sim.advance() in the render callback
    // at 120 Hz; the legacy 60 Hz fixedStep no longer calls player.update.

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

    // ——— Feed sim drive to cosmetic cultists (Plan 4) ————————————
    // The sim owns the cultist's AI/move/fire; each fixed step we hand every
    // sim-driven ShotgunCultist its interpolated transform + anim hint so its
    // update() can drive the Rapier collision proxy + billboard. Dead sim
    // dudes (health 0) yield no drive — the cosmetic death path takes over.
    const dudeRenders = sim.dudeRenders();
    for (const z of cluster.getZombies()) {
      if (z instanceof ShotgunCultist && z.simDudeIndex >= 0) {
        const r = dudeRenders[z.simDudeIndex];
        if (r && r.health > 0) {
          z.setSimDrive({
            xMeters: r.xMeters, yMeters: r.yMeters, zMeters: r.zMeters,
            yawRad: r.yawRad,
            anim: dudeAiToAnim(r.ai),
          });
        } else {
          z.clearSimDrive();
        }
      }
    }

    // ——— Wave runner tick —————————————————————
    // Player liveness is sim-authoritative now (hp from cultist pellets +
    // explosions; the player is excluded from the legacy AOE).
    const playerAlive = sim.playerHp() > 0;
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
  // Sim-authoritative player hp on the previous render frame (drives the
  // damage hit-flash pulse on a drop).
  let lastPlayerHp = sim.playerHp();

  setRenderCallback((realDt) => {
    // Skip game simulation when paused (still renders frozen frame)
    if (pauseMenu.paused) return;

    // ---- Sim player: advance at 120 Hz and set camera from interpolated state.
    // sampleInput() consumes the mouse delta exactly once per sim tic.
    // Must run before scheduler.tick so enemies read an up-to-date player.position().
    sim.advance(realDt, sampleInput);
    const pr = sim.playerRender();
    camera.position.set(pr.xMeters, pr.eyeYMeters, pr.zMeters);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pr.pitchRad, pr.yawRad, 0);

    // ---- Sim projectile billboards: sync THREE meshes to sim.projectileRenders()
    syncProjectileBillboards(realDt);
  syncHeadBillboards();
  syncPelletTracers();

    // ---- Drain sim events → VFX + SFX
    for (const ev of sim.drainEvents()) {
      if (ev.kind === 'explosion') {
        const ex = fpToMeters(ev.x);
        const ey = fpToMeters(ev.y);
        const ez = fpToMeters(ev.z);
        sfx.play(SfxEvent.DYNAMITE_BOOM, { x: ex, y: ey, z: ez });
        gibs.spawnExplosion({ x: ex, y: ey, z: ez }, EXPLOSION_STANDARD, performance.now() / 1000);
      } else if (ev.kind === 'cultistFire') {
        // Cosmetic-only muzzle flash + SFX. The blast spawns travelling sim
        // pellets (rendered by syncPelletTracers; they damage player.hp in-sim);
        // this is just the muzzle visual/audio cue at the moment of firing.
        const fx = fpToMeters(ev.x);
        const fy = fpToMeters(ev.y);
        const fz = fpToMeters(ev.z);
        sfx.play(SfxEvent.CULTIST_SHOT, { x: fx, y: fy, z: fz });
        particles.emitBurst({ x: fx, y: fy, z: fz }, {
          tile: 2424, count: 6, speedMin: 2.0, speedMax: 5.0,
          gravity: 0, airdrag: 0.6, lifetimeSec: 0.12, size: 0.18,
        });
      }
      // 'dudeDeath' is not emitted in this milestone: player→dude kills are
      // detected in the cosmetic layer (ShotgunCultist.takeDamage → GibSystem),
      // and bridge to the sim via killDude. Left for future sim-authoritative
      // player weapons.
    }

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

    // HUD — health driven from the sim-authoritative player hp (Plan 4).
    const playerHp = sim.playerHp();
    hud.update(realDt, player.position(), playerHp, sim.isInvulnerable());

    // Damage hit-flash: trigger a CA pulse when the sim player took damage this
    // frame (replaces the old PlayerGibAdapter path). Scales lightly with the
    // delta; the sim is now the single source of player damage.
    if (playerHp < lastPlayerHp) {
      const dmg = lastPlayerHp - playerHp;
      const intensity = 0.015 + 0.01 * Math.min(dmg / 60, 1);
      postFxBus.triggerDamagePulse(intensity, 0.4, now);
    }
    lastPlayerHp = playerHp;

    // Game-over: with the player excluded from the legacy AOE it can no longer be
    // gibbed, so death comes from the sim hp hitting 0 (cultist pellets +
    // explosions). Show the overlay (idempotent); R restarts via its handler.
    if (playerHp <= 0) gameOverOverlay.show();

    const w = weapons.current;
    chargeHud.setCharge(w instanceof Dynamite ? w.chargeFractionAt(now) : 0);
  });

  console.log('[blud] M2 boot — dynamite + gibs + zombies + QAV animator');
}

main().catch((err) => console.error('[blud] boot failed', err));
