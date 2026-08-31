// src/lab/sdf-zombie/webgpu/game-main.ts
//
// sdf-game.html — the grey-box ring the owner walks to judge on-screen enemy
// counts. Four rooms, tunnels with arched mouths, 1/2/3/4 wandering zombies,
// a first-person player, and per-room environment bounce on the SDF bodies.
//
// NOT the lab: no panel, no wounds, no chunks, no dynamite. The combat
// wiring belongs to the grapeshot dispatch that follows; this page owns the
// walkable world and the actors, and exposes them through window.__sdfGame
// (see the bottom of the file — that hook is the seam the weapon builds on).
//
// Renderer stack mirrors bench-main.ts (createLabRenderer + createSdfLayer +
// createPostAa + createOccluderHull), NOT lab-main.ts — the bench is the
// small example of standing this up without the lab's control panel.
//
// BOUNCE. Each zombie's view carries the enclosure of the room it stands in
// (boxMin/boxMax + six wall albedos). practical-hard-key ships probeWeight 0,
// at which ambientAt early-outs to flat fill and the wall albedos do NOTHING
// — so this page parks probeWeight at DEFAULT_PROBE_WEIGHT and exposes it on
// [ and ] (plus __sdfGame.setProbeWeight) for the owner's flat->full slide.
// ambientGain 4 / chromaGain 1 are owner-tuned; left alone.

import * as THREE from 'three/webgpu';
import {
  createLabRenderer, type RenderCap,
} from './lab-renderer';
import {
  initialAdaptiveState, stepAdaptive, scaleForRung, SCALE_LADDER,
} from '../adaptive-scale';
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER, SHELL_LAYER } from './sdf-layer';
import { createOuterHull } from './shell-hull-outer';
import { createPostAa } from './post-aa';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import { createOccluderHull } from './occluder-hull';
import { translateBody } from '../translate';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette } from '../blob-compile';
import { checkStance } from '../blob-checks';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import type { Vec3 } from '../types';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import {
  ROOMS, TUNNELS, FURNITURE, levelColliders, levelSurfaces,
  enclosureKeyAt, enclosureOf, wanderBounds, spawnPoints, PLAYER_START,
} from './game-level';
import { stepPlayer, eyeOf, PLAYER, type PlayerState, type MoveInput } from './game-player';
import { createZombieActor, type ZombieActor } from './game-actor';
import { buildFirefight, validateScenario } from './game-bench-scenario';
import { runBench, type BenchDeps } from './game-bench';
import { sdBody } from '../validate';
import {
  GRAPESHOT, SLUG, expired, mulberry32, spawnPellets, spawnSlug,
  stepProjectiles, traceProjectile, woundFromPellet, woundFromSlug, type Projectile,
} from './game-weapon';
import { resolveExplosion, type ExplosionBody } from '../explosion-aoe';
import { woundWorldPos, woundCarveNormal } from '../damage';
import { makeChunk, stepChunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { createChunkGpuView, createSharedChunkGpuMaterial, type ChunkGpuView } from './zombie-gpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Primitive } from '../types';

/** Low but clearly visible — the owner's slide runs 0..1 from here. Measured
 *  on the room1 A/B (shadow-side px, mean channel shift vs probeWeight 0):
 *  0.5 -> (+12,+5,+2) on 743 px; 0.75 -> (+14,+7,+2) on 1735 px; 1.0 ->
 *  (+18,+10,+5) on 1848 px. Free at any weight: ambientAt is ANALYTIC — zero
 *  mapBody calls, pinned by the ambient tests — so the brief's probe-cost
 *  warning does not apply to the shipped P1 implementation. */
const DEFAULT_PROBE_WEIGHT = 0.75;

/**
 * RESOLUTION RUNGS — the owner picks with ?res=. All 4:3 except the legacy
 * '960' (the old fit-aspect 960x540 cap, kept so before/after numbers are
 * comparable). Default 800x600 per the owner's "capped at 800x600".
 *
 * SDF_SCALE is the SDF pass's fraction OF THE CAPPED BUFFER. Default 1.0:
 * one clean pixel grid — the march renders 1:1 with what gets presented and
 * upscaled once, instead of today's double resample (SDF at 0.7 of a
 * different-sized buffer). Cost table lives in the dispatch report.
 */
const RES_RUNGS = {
  '960': { mode: 'fit', maxW: 960, maxH: 540 },
  '800': { mode: 'fixed', width: 800, height: 600 },
  '640': { mode: 'fixed', width: 640, height: 480 },
} as const satisfies Record<string, RenderCap>;
type ResRung = keyof typeof RES_RUNGS;
const DEFAULT_RES: ResRung = '800';
function resRungFromUrl(): ResRung {
  const v = new URLSearchParams(location.search).get('res');
  return v && v in RES_RUNGS ? (v as ResRung) : DEFAULT_RES;
}

// The zombie's shared flat face sheet (zombie.blob has no `sheet` block) —
// the same registry entry bench-main duplicates from lab-main.
const ZOMBIE_FLAT = {
  url: '/assets/lab/zombie-face.png',
  rect: [0, 0, 64, 64, 64, 64] as [number, number, number, number, number, number],
  mean: 0.406,
};

/** The fattest additive prim in the head cluster — bench-main's headShape,
 *  verbatim: it normalises the face projection. */
function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  for (const p of b.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');
  const resKey = resRungFromUrl();
  const handle = await createLabRenderer(mount, RES_RUNGS[resKey]);
  const { scene, camera } = handle;

  // -----------------------------------------------------------------------
  // The world: grey-box meshes from the same layout that feeds collision.
  // -----------------------------------------------------------------------
  const colliders = levelColliders();
  const surfaces = levelSurfaces();
  const levelGroup = new THREE.Group();
  levelGroup.name = 'ring-level';
  for (const p of surfaces.planes) {
    const axis = p.axis;
    // Walls span (x|z, y); floors/ceilings span (x, z).
    const w = axis === 1 ? p.max[0] - p.min[0] : p.max[axis === 0 ? 2 : 0] - p.min[axis === 0 ? 2 : 0];
    const h = axis === 1 ? p.max[2] - p.min[2] : p.max[1] - p.min[1];
    const geo = new THREE.PlaneGeometry(w, h);
    // Ceilings face AWAY from every light in the stack (sun points down, the
    // hemisphere's ground term is weak), so with pure reflected light they
    // render near-black and the owner reads "void above" — the missing-wall
    // failure pointing up. A small emissive term in their own colour keeps
    // them legible as the room's top surface without flattening the mood.
    const isCeiling = axis === 1 && p.facing < 0;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color[0], p.color[1], p.color[2]),
      roughness: 1,
      ...(isCeiling ? { emissive: new THREE.Color(p.color[0], p.color[1], p.color[2]).multiplyScalar(0.45) } : {}),
    }));
    const mid: Vec3 = [
      (p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2,
    ];
    mesh.position.set(mid[0], mid[1], mid[2]);
    if (axis === 1) mesh.rotation.x = p.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (axis === 0) mesh.rotation.y = p.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (p.facing < 0) mesh.rotation.y = Math.PI;
    levelGroup.add(mesh);
  }
  for (const b of surfaces.boxes) {
    const geo = new THREE.BoxGeometry(
      b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(b.color[0], b.color[1], b.color[2]),
      roughness: 1,
    }));
    mesh.position.set(
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    levelGroup.add(mesh);
  }
  scene.add(levelGroup);

  // CEILING FILL. The sun points down; ceilings (and north-south walls in
  // shadow) have normals pointing away from it, so with only a dim ambient
  // they rendered BLACK — read by the owner as "the same failure pointing
  // up" as the missing walls. A hemisphere light pays normal-dependent fill.
  // This touches ONLY these MeshStandardMaterials — the SDF bodies carry
  // their own lighting uniforms (enclosure bounce), so probe/bounce tuning
  // is untouched.
  const hemi = new THREE.HemisphereLight(0xa39c93, 0x8f8880, 0.8);
  scene.add(hemi);

  // -----------------------------------------------------------------------
  // THE GALLERY RIG (mesh side only). The lab factory ships a warm-sun +
  // dim-purple-ambient default that made the rooms read dark; the owner
  // wants a bright white-wall gallery. We give THIS PAGE its own rig by
  // recolouring/releveling the factory's two lights rather than editing
  // the shared factory (the lab's look must not move).
  // -----------------------------------------------------------------------
  for (const child of [...scene.children]) {
    if (child instanceof THREE.DirectionalLight) {
      child.color.setHex(0xfff8ef); // neutral-warm key, not orange sunset
      child.intensity = 0.9;
    }
    if (child instanceof THREE.AmbientLight) {
      child.color.setHex(0xffffff); // bright WHITE fill, was 0x4a3a40 @ 0.6
      child.intensity = 0.95;
    }
  }
  hemi.color.setHex(0xf5f3f0);   // sky term: near-white
  hemi.groundColor.setHex(0x8f8c86); // floor bounce: mid grey
  hemi.intensity = 0.75;

  // COLOURED ACCENTS as real mesh-side lights, straight from the level data
  // — the same entries litWallAlbedo folded into the bounce albedos, which
  // is what keeps walls and zombies agreeing about the light. Five point
  // lights total (one per room + room3's second): few, on purpose — every
  // real-time light here spends frame time on WALLS, not on what the owner
  // is watching.
  const accentGroup = new THREE.Group();
  accentGroup.name = 'accent-lights';
  for (const r of ROOMS) {
    for (const a of r.accents) {
      const pl = new THREE.PointLight(
        new THREE.Color(a.color[0], a.color[1], a.color[2]), a.power);
      pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(pl);
    }
  }
  scene.add(accentGroup);

  // -----------------------------------------------------------------------
  // The draw chain, exactly as the bench stands it up.
  // -----------------------------------------------------------------------
  const postAa = createPostAa(handle.renderer);
  const sdfLayer = createSdfLayer(handle.renderer);
  postAa.addSink(sdfLayer);
  /** SDF pass scale relative to the capped buffer. 1.0 = 1:1 (default).
   *  Runtime-adjustable for the cost table + adaptive ladder. */
  let sdfScale = 1.0;
  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
  }
  sdfLayer.setScale(sdfScale);
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
  function applySdfScale(v: number) {
    sdfScale = Math.min(1, Math.max(0.2, v));
    sdfLayer.setScale(sdfScale);
    sizeSdfLayer();
  }

  // -----------------------------------------------------------------------
  // ADAPTIVE RESOLUTION — same pure controller the lab uses (X1.13), wired
  // into the render callback. DEFAULT OFF: the chosen rung is what ships;
  // this is the frame-rate safety net the owner can switch on.
  // -----------------------------------------------------------------------
  // ADAPTIVE ON by default (2026-08-31), and the baseline is why.
  //
  // It lands AFTER the baseline on purpose: adaptive moves the pixel count
  // under load, so measuring with it on would have measured the safety net
  // instead of the cost. __sdfGame.bench suspends it for the same reason.
  //
  // The baseline then made the case for it stronger than expected. Resolution
  // scale is the ONLY lever that moved the frame — 0.7 is -39%/-25% and 0.5 is
  // -58%/-54%, while the occluder, the cone and FXAA all measured inside
  // repeat spread. Adaptive works by walking exactly that ladder, so it is the
  // one safety net with a measured mechanism behind it.
  // (docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)
  //
  // It is still a FLOOR, not an answer: it buys frames by making the flesh
  // coarser during exactly the moments that matter most.
  let adaptiveEnabled = true;
  let adaptiveBudgetMs = 1000 / 30;
  let adaptiveState = initialAdaptiveState(performance.now());
  const ADAPTIVE_WINDOW = 30;
  const PROBE_ABORT_FRAMES = 8;
  const adaptiveFrames: number[] = [];
  function tickAdaptive(nowMs: number): void {
    if (!adaptiveEnabled) return;
    const failingProbe = adaptiveState.probing && adaptiveFrames.length >= PROBE_ABORT_FRAMES
      && (median(adaptiveFrames) > adaptiveBudgetMs * 1.1
        || adaptiveFrames.filter((f) => f > adaptiveBudgetMs * 1.8).length >= 2);
    if (adaptiveFrames.length < ADAPTIVE_WINDOW && !failingProbe) return;
    const recent = adaptiveFrames.slice(-ADAPTIVE_WINDOW);
    const sorted = [...recent].sort((a, b) => a - b);
    const next = stepAdaptive(adaptiveState, {
      nowMs,
      medianFrameMs: median(recent),
      p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      budgetMs: adaptiveBudgetMs,
    });
    if (next.rung !== adaptiveState.rung) {
      applySdfScale(scaleForRung(next.rung));
      // Frames rendered at the OLD scale must not feed the next decision.
      adaptiveFrames.length = 0;
    }
    adaptiveState = next;
  }
  function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    const hi = s[m]!;
    return s.length % 2 ? hi : (s[m - 1]! + hi) / 2;
  }
  handle.setDrawFn(() => postAa.render(() => sdfLayer.render(scene, camera)));

  const occluderHull = createOccluderHull();
  occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(occluderHull.object);
  sdfLayer.setOccluderEnabled(true);

  /** The silhouette-noise amplitude the hull must budget for (marchCfg.z).
   *  Read from the live uniform rather than a constant, so retuning the noise
   *  cannot silently under-size the hull — X1.21.2 was exactly that bug on the
   *  cone and occluder bounds. */
  const shellAmpOf = () => actors[0]?.view.uniforms.marchCfg.value.z ?? 0;

  // The conservative OUTER hull (shell-hull-outer.ts). Default OFF: it is a
  // measurement instrument until the march consumes it, and rasterising it
  // for nothing is pure cost.
  const outerHull = createOuterHull();
  outerHull.object.layers.set(SHELL_LAYER);
  scene.add(outerHull.object);
  sdfLayer.setShellSideHook((side, depthFunc) => outerHull.setSide(side, depthFunc));
  sdfLayer.setShellEnabled(false);
  // Headless A/B seams (2026-08-27 hull-holes diagnosis): ship defaults stay
  // ON/ON; the driver flips these between captures. Mirrors the lab's
  // __sdfLab.setOccluder.
  let hullExclusionsEnabled = true;
  let occluderDesired = true;

  // -----------------------------------------------------------------------
  // Zombies. One compiled .blob, ten bodies; seeds/headings vary, the
  // character does not (12 prims each — the cheap one, on purpose).
  // -----------------------------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const flesh = compilePalette(doc) ?? { ...FLESH_PRESETS['henenlotter-latex'] };
  const faceTex = new THREE.TextureLoader().load(ZOMBIE_FLAT.url);
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.flipY = true;
  const [fx, fy, fw, fh, fsw, fsh] = ZOMBIE_FLAT.rect;
  const faceAtlas = new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh);

  let probeWeight = DEFAULT_PROBE_WEIGHT;

  /** Sever dispatch indirection — actors are built before the weapon block;
   *  the grapeshot wiring below assigns this once the chunk spawner exists. */
  let onSeverDispatch: ((a: ZombieActor, piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[] }) => void) | null = null;

  const actors: ZombieActor[] = [];
  const errors: string[] = [];
  let nextId = 1;
  for (const room of ROOMS) {
    const enc = enclosureOf(room.name)!;
    const roomFurniture = FURNITURE
      .filter(f => f.room === room.id)
      .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 }));
    for (const start of spawnPoints(room)) {
      const compiled = compileBlob(doc, face);
      const built = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
      errors.push(...built.errors);
      if (doc.stance) errors.push(...checkStance(built.bones, doc.stance));
      // TRANSLATE THE FIELD, NOT THE MESH (translate.ts) — the shader
      // marches world space.
      const placed = translateBody(built, start);
      const view: ZombieGpuView = createZombieGpuView(placed,
        {
          cone: sdfLayer.cone,
          occluder: sdfLayer.occluder,
          // The outer hull's bounds. Passing them unconditionally is safe:
          // the fetch identities (0 / 1e9) make the march bit-identical while
          // sdfLayer.shellEnabled is false, which is the ship default.
          shell: {
            entry: sdfLayer.shellEntry.texture,
            exit: sdfLayer.shellExit.texture,
            uniforms: sdfLayer.shellEntry.uniforms,
          },
        });
      view.applyMaterial(flesh, LIGHT_PRESETS['practical-hard-key']);
      view.setFaceTexture(faceTex, faceAtlas, ZOMBIE_FLAT.mean);
      view.uniforms.faceCfg.value.x = 1;
      view.uniforms.faceCfg.value.y = 1.0;
      view.uniforms.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
      const skull = headShape(placed);
      if (skull) view.setHeadShape(skull.centre, skull.axes);
      // The room's enclosure: bounds + albedos, with the page's probeWeight.
      view.uniforms.boxMin.value.set(...enc.box.min);
      view.uniforms.boxMax.value.set(...enc.box.max);
      view.uniforms.wallNegX.value.setRGB(...enc.walls.negX);
      view.uniforms.wallPosX.value.setRGB(...enc.walls.posX);
      view.uniforms.wallNegY.value.setRGB(...enc.walls.negY);
      view.uniforms.wallPosY.value.setRGB(...enc.walls.posY);
      view.uniforms.wallNegZ.value.setRGB(...enc.walls.negZ);
      view.uniforms.wallPosZ.value.setRGB(...enc.walls.posZ);
      view.uniforms.bounceCfg.value.set(probeWeight, 4, 1, 1);
      view.object.layers.set(SDF_LAYER);
      view.coneObject.layers.set(CONE_LAYER);
      scene.add(view.object);
      scene.add(view.coneObject);
      const zombieId = nextId++;
      const actor = createZombieActor({
        id: zombieId, room: room.id, body: placed, view, start,
        seed: 1337 + nextId * 101,
        bounds: wanderBounds(room),
        furniture: roomFurniture,
        onSever: (piece) => onSeverDispatch?.(actor, piece),
      });
      actors.push(actor);
    }
  }
  if (errors.length > 0) {
    console.error('[sdf-game] body errors:', errors.join(' | '));
  }

  function pushProbeWeight(v: number) {
    probeWeight = Math.min(1, Math.max(0, v));
    for (const a of actors) a.view.uniforms.bounceCfg.value.x = probeWeight;
  }

  // -----------------------------------------------------------------------
  // Player: pointer lock + WASD + gravity + capsule-vs-AABB.
  // -----------------------------------------------------------------------
  const player: PlayerState = {
    pos: [PLAYER_START.x, 0, PLAYER_START.z],
    vel: [0, 0, 0],
    yaw: PLAYER_START.yaw,
    pitch: PLAYER_START.pitch,
    grounded: true,
  };
  const keys = new Set<string>();
  const canvas = handle.canvas;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    hud.lockHint = document.pointerLockElement !== canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    player.yaw += e.movementX * 0.0022;
    player.pitch = Math.min(PLAYER.pitchLimit,
      Math.max(-PLAYER.pitchLimit, player.pitch - e.movementY * 0.0022));
  });
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'BracketLeft') pushProbeWeight(probeWeight - 0.05);
    if (e.code === 'BracketRight') pushProbeWeight(probeWeight + 0.05);
    if (e.code === 'KeyP') {
      if (probeWeight > 0) { parked = probeWeight; pushProbeWeight(0); }
      else pushProbeWeight(parked);
    }
    if (e.code === 'KeyE') { slugMode = !slugMode; updateHud(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let parked = DEFAULT_PROBE_WEIGHT;

  // GRAPESHOT INPUT. Left = one barrel, right = both. The first click only
  // locks the pointer; shots need lock so a stray desktop click cannot fire.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) fire(1);
    else if (e.button === 2) fire(2);
  });

  // The seam for the grapeshot dispatch: a view-model hangs off this group,
  // which rides the camera every frame.
  const viewModelAnchor = new THREE.Group();
  viewModelAnchor.name = 'view-model-anchor';
  // Ride height of the whole view-model (gun + orb hands move together).
  // Owner playtest 2026-08-26: the gun sat high enough to crowd the frame.
  // Captured current / −5 cm / −10 cm from the same spot and compared: −5 cm
  // frees the centre of the frame while the breech and hammers — the detail
  // that chose this model — stay fully in frame; −10 cm starts to sink the
  // grip out of the bottom edge. −5 cm is the shipped height.
  viewModelAnchor.position.y = -0.05;
  camera.add(viewModelAnchor);
  scene.add(camera);

  // -----------------------------------------------------------------------
  // GRAPESHOT — the first weapon. View-model (k3 GLB + green orb hands),
  // travelling pellets, wound/sever wiring through the actors, and ballistic
  // chunks for whatever comes off. Fire model per the spec §2 as trimmed by
  // the dispatch brief: click = one barrel, right-click = both, cooldown +
  // camera kick in; break-open reload animation and muzzle smoke are not.
  // -----------------------------------------------------------------------
  const GUN_GLB = '/assets/lab/grapeshot-gun-k3.glb';
  /** Grip-point origin, muzzles down -Y. Muzzle sits ~0.515 m down-barrel
   *  from the grip centre (model script: natural muzzle Y≈-0.44 minus the
   *  GRIP_NATURAL shift). */
  const MUZZLE_LOCAL: [number, number, number] = [0, -0.515, 0];
  let gunGroup: THREE.Group | null = null;
  let gunReady = false;
  try {
    const gltf = await new GLTFLoader().loadAsync(GUN_GLB);
    // PBR metal is black without something to reflect — this page has no
    // environment and the flesh's hand-written lighting does not apply to a
    // MeshStandardMaterial. Per-material env, kit-overlay style, so the level
    // meshes keep their gallery look.
    const pmrem = new THREE.PMREMGenerator(handle.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.envMap = env;
          std.envMapIntensity = 0.7;
          std.needsUpdate = true;
        }
      }
    });
    gunGroup = new THREE.Group();
    gunGroup.name = 'grapeshot-k3';
    gunGroup.add(gltf.scene);
    // AXIS NOTE: the model script's "muzzles down -Y" is BLENDER space;
    // Blender's Z-up -> glTF Y-up conversion (x,z,-y) lands them at +Z in
    // GLB space, up stays +Y. rotation.y = PI aims +Z down the camera's -Z
    // (forward) with the hammers still on top. (rotation.x = PI/2 pointed
    // the gun at the sky — first live capture caught it.)
    gunGroup.rotation.y = Math.PI;
    gunGroup.position.set(0.17, -0.2, -0.32);
    viewModelAnchor.add(gunGroup);

    // HANDS ARE GREEN ORBS — deliberate, per the owner: the player is the
    // goblin and its hands were never detailed. One on the grip, one braced
    // under the fore-end. Anchored in VIEW space (not gun space) so the
    // axis convention of the GLB cannot move them.
    const orbGeo = new THREE.SphereGeometry(0.055, 20, 14);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0x5a8f3c, roughness: 0.85 });
    const gripHand = new THREE.Mesh(orbGeo, orbMat);
    gripHand.position.set(0.17, -0.26, -0.30);
    const foreHand = new THREE.Mesh(orbGeo, orbMat);
    foreHand.position.set(0.17, -0.24, -0.62);
    viewModelAnchor.add(gripHand, foreHand);
    gunReady = true;
  } catch (err) {
    console.error('[sdf-game] gun model failed to load — firing still works', err);
  }

  /** Muzzle world position from the current camera pose (independent of the
   *  gun mesh's matrix state — fires identically headless). */
  function muzzleWorld(): Vec3 {
    const eye = eyeOf(player);
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const right: Vec3 = [cy, 0, sy];
    return [
      eye[0] + right[0] * 0.2 - sy * 0.5,
      eye[1] - 0.12,
      eye[2] + right[2] * 0.2 + cy * 0.5,
    ];
  }
  function aimDir(): Vec3 {
    const cp = Math.cos(player.pitch);
    return [Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp];
  }
  /** AIM CONVERGENCE (2026-08-26 defect-2 fix candidate): the muzzle sits
   *  ~20 cm right and ~12 cm low of the EYE, and pellets used to fly PARALLEL
   *  to the camera ray — so at ANY range impacts landed that whole offset off
   *  the crosshair. Standard FPS remedy: every projectile converges on the
   *  point where the camera ray meets AIM_CONVERGE_M. Close shots still group;
   *  the parallel-ray offset is gone by construction. */
  const AIM_CONVERGE_M = 8;
  function convergedDir(origin: Vec3): Vec3 {
    const eye = eyeOf(player);
    const a = aimDir();
    const target: Vec3 = [
      eye[0] + a[0] * AIM_CONVERGE_M,
      eye[1] + a[1] * AIM_CONVERGE_M,
      eye[2] + a[2] * AIM_CONVERGE_M,
    ];
    const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  // Pellets: simulated pure (game-weapon.ts), drawn from a mesh pool that
  // grows on demand inside the tick's sync step.
  const pellets: Projectile[] = [];
  const pelletGeo = new THREE.SphereGeometry(GRAPESHOT.radius, 10, 8);
  const pelletMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
  const pelletViews: THREE.Mesh[] = [];

  let nextSeed = 0x5df1;
  let cooldown = 0;
  let recoilPitch = 0;

  /** SLUG MODE — one big projectile, one big crater. Diagnostic first: eight
   *  barely-visible 5.5 cm craters gave no signal about placement or look.
   *  Reachable three ways: ?slug URL param at boot, KeyE in-page toggle, or
   *  __sdfGame.fireSlug(). The HUD shows which mode is live. */
  let slugMode = new URLSearchParams(location.search).has('slug');

  function fire(barrels: 1 | 2): boolean {
    if (!gunReady || cooldown > 0) return false;
    cooldown = GRAPESHOT.fireCooldownSec;
    recoilPitch += GRAPESHOT.kickRadPerBarrel * barrels;
    if (slugMode) {
      // One lump down one known ray instead of a pellet volley.
      pellets.push(spawnSlug(muzzleWorld(), convergedDir(muzzleWorld())));
      nextSeed = (nextSeed * 1664525 + 1013904223) >>> 0;
      return true;
    }
    const muz = muzzleWorld();
    const dir = convergedDir(muz);
    // spawnPellets spreads around `dir`; convergence just re-centres the cone.
    pellets.push(...spawnPellets(muz, dir, barrels, nextSeed));
    nextSeed = (nextSeed * 1664525 + 1013904223) >>> 0;
    return true;
  }

  // Chunks: detached pieces fly ballistically and render through the shared
  // SDF chunk path — the same pipeline the lab gibs with, capped and
  // recycled so a gore party cannot churn views unboundedly.
  const MAX_CHUNKS = 12;
  const chunkMaterial = createSharedChunkGpuMaterial();
  const chunkViews: ChunkGpuView[] = [];
  const liveChunks: { state: ReturnType<typeof makeChunk>; view: ChunkGpuView }[] = [];
  function primsLongAxis(prims: Primitive[], origin: Vec3): Vec3 {
    let best: Vec3 = [0, 1, 0];
    let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }
  function spawnChunkPiece(
    piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[] },
    template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
  ) {
    const rng = mulberry32(nextSeed++);
    const vel: Vec3 = [
      (rng() - 0.5) * 4.5,
      2.5 + rng() * 2.5,
      (rng() - 0.5) * 4.5,
    ];
    const state = makeChunk(
      piece.limb as never, piece.origin, vel,
      chunkExtent(piece.prims, piece.origin), primsLongAxis(piece.prims, piece.origin),
      rng, 'limb',
    );
    const oldest = liveChunks.length >= MAX_CHUNKS ? liveChunks.shift() : undefined;
    if (oldest) {
      oldest.view.reset(state, piece.prims, piece.tornAt.length ? piece.tornAt : undefined);
      liveChunks.push({ state, view: oldest.view });
    } else {
      const view = createChunkGpuView(
        state, piece.prims, template.uniforms,
        piece.tornAt.length ? piece.tornAt : undefined,
        template.volumeTexture, chunkMaterial,
      );
      view.object.layers.set(SDF_LAYER);
      scene.add(view.object);
      chunkViews.push(view);
      liveChunks.push({ state, view });
    }
  }

  // Wire every actor's severs into the chunk spawner (template = that
  // actor's own look — the chunk shades like the flesh it came from).
  onSeverDispatch = (a, piece) => {
    spawnChunkPiece(piece, { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture });
  };

  // -----------------------------------------------------------------------
  // HUD: frame time, bodies on screen, probeWeight, where you are.
  // -----------------------------------------------------------------------
  const hudEl = document.getElementById('hud');
  const hud = { lockHint: true };
  let frameEma = 0;
  const bootTime = performance.now();
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const bodySphere = new THREE.Sphere(new THREE.Vector3(), 1.1);

  function bodiesOnScreen(): number {
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    let n = 0;
    for (const a of actors) {
      const torso = a.posed().clusters.find(c => c.limb === 'torso');
      if (!torso) continue;
      bodySphere.center.set(torso.center[0], torso.center[1], torso.center[2]);
      if (frustum.intersectsSphere(bodySphere)) n++;
    }
    return n;
  }

  function updateHud() {
    if (!hudEl) return;
    const where = enclosureKeyAt(player.pos[0], player.pos[2]);
    hudEl.textContent =
      `${frameEma.toFixed(1)} ms · bodies ${bodiesOnScreen()}/${actors.length}` +
      ` · ${where} · probe ${probeWeight.toFixed(2)}` +
      (slugMode ? ' · ● SLUG (E to switch back)' : ' · PELLETS (E = slug)') +
      (hud.lockHint ? ' · click to lock' : '') +
      (wanderFrozen ? ' · FROZEN' : '');
  }

  // -----------------------------------------------------------------------
  // Frame loop.
  // -----------------------------------------------------------------------
  let wanderFrozen = false;
  let frameCount = 0;
  /** The __sdfGame.placeMarker debug sphere. */
  let marker: THREE.Mesh | null = null;
  /** Headless driver autopilot: walk toward (x, z) until within 0.25 m. */
  let autopilot: { x: number; z: number } | null = null;
  /** Stuck recovery: a wanderer frozen/standing on the path blocks the line
   *  head-on (the capsule push exactly opposes the intent, no slide). If we
   *  stop making progress, strafe around the obstacle for a beat. */
  let stuckT = 0;
  let strafeT = 0;
  let strafeDir = 1;
  let lastWalkPos: [number, number] | null = null;

  function tick(dt: number) {
    let input: MoveInput = {
      x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      z: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      jump: keys.has('Space'),
    };
    if (autopilot) {
      const dx = autopilot.x - player.pos[0];
      const dz = autopilot.z - player.pos[2];
      if (Math.hypot(dx, dz) < 0.25) {
        autopilot = null;
        input = { x: 0, z: 0, jump: false };
      } else if (strafeT > 0) {
        strafeT -= dt;
        input = { x: strafeDir, z: 0.2, jump: false };
      } else {
        player.yaw = Math.atan2(dx, -dz);
        input = { x: 0, z: 1, jump: false };
      }
      if (lastWalkPos
        && Math.hypot(player.pos[0] - lastWalkPos[0], player.pos[2] - lastWalkPos[1]) < 0.02) {
        stuckT += dt;
        if (stuckT > 0.5) {
          // Strafe AWAY from whatever is ahead: nearest zombie within 1.2 m
          // in front picks the side; walls just get the fallback flip.
          const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
          let bestLat: number | null = null;
          let bestFwd = Infinity;
          for (const a of actors) {
            const ox = a.pose().pos[0] - player.pos[0];
            const oz = a.pose().pos[2] - player.pos[2];
            const fwdDist = ox * sy - oz * cy;
            const lat = ox * cy + oz * sy;
            if (fwdDist > 0 && fwdDist < 1.2 && Math.abs(lat) < 0.9 && fwdDist < bestFwd) {
              bestFwd = fwdDist;
              bestLat = lat;
            }
          }
          strafeDir = bestLat !== null ? (bestLat > 0 ? -1 : 1) : -strafeDir;
          strafeT = 0.8;
          stuckT = 0;
        }
      } else {
        stuckT = 0;
      }
      lastWalkPos = [player.pos[0], player.pos[2]];
    }
    // Zombies are soft obstacles: one fat AABB each, rebuilt per frame.
    const zombieBoxes = actors.map(a => {
      const p = a.pose().pos;
      return { min: [p[0] - 0.35, 0, p[2] - 0.35] as Vec3, max: [p[0] + 0.35, 1.8, p[2] + 0.35] as Vec3 };
    });
    stepPlayer(player, input, dt, [...colliders, ...zombieBoxes]);

    if (!wanderFrozen) {
      for (const a of actors) a.step(dt);
      const now = performance.now() / 1000;
      for (const a of actors) {
        a.view.setTime(now);
        // Face projection tracks the posed skull through the gait jiggle.
        const skull = headShape(a.posed());
        if (skull) a.view.setHeadShape(skull.centre, skull.axes);
      }
      // Wound exclusion, same contract as the lab's woundSpheres: hull
      // endpoint spheres must not sit inside carve zones, or they render as
      // pale discs inside craters. The carve sphere is centred ON the anchor
      // (depth-slab-clipped in the shader), so the full-radius sphere here is
      // a superset — it can only over-exclude (a slightly looser hull), never
      // expose. The game never passed this before 2026-08-27 because its
      // craters were tangent (the pale-wound defect) and never reached the
      // hull; real craters exposed it within one capture.
      if (sdfLayer.shellEnabled) {
        // Same posed bodies the occluder hull is built from, one line below —
        // this is what makes the hull "posed" at no extra cost.
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      }
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            return a.wounds().map(w => ({ centre: woundWorldPos(prims, w, 0), radius: w.radius }));
          })
          : [],
      );
    }

    // ---------------------------------------------------------------
    // GRAPESHOT SIM — pellets fly, land as wounds through actor.hit();
    // detached pieces fly ballistically through the shared chunk path.
    // ---------------------------------------------------------------
    cooldown = Math.max(0, cooldown - dt);
    recoilPitch *= Math.exp(-9 * dt);
    {
      const prevs = pellets.map(p => [...p.pos] as Vec3);
      stepProjectiles(pellets, dt);
      for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i]!;
        const from = prevs[i]!;
        let dead = expired(p) || p.pos[1] <= 0.02;
        if (!dead) {
          // Level geometry: a point-in-AABB test is enough — pellets are
          // small and the substepped trace already bounds their travel.
          for (const b of colliders) {
            if (p.pos[0] > b.min[0] && p.pos[0] < b.max[0]
              && p.pos[1] > b.min[1] && p.pos[1] < b.max[1]
              && p.pos[2] > b.min[2] && p.pos[2] < b.max[2]) { dead = true; break; }
          }
        }
        if (!dead) {
          // Actors: bounding-sphere reject on the frame segment, then a
          // substepped trace against the posed field. Nearest hit wins.
          let bestDist = Infinity;
          let hitActor: ZombieActor | null = null;
          let hitPoint: Vec3 | null = null;
          const segLen = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]);
          for (const a of actors) {
            const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
            if (!c) continue;
            // Segment-to-centre distance (clamped closest approach).
            const t = Math.max(0, Math.min(segLen,
              ((c[0]-from[0])*(p.pos[0]-from[0]) + (c[1]-from[1])*(p.pos[1]-from[1]) + (c[2]-from[2])*(p.pos[2]-from[2]))
              / (segLen * segLen || 1)));
            const qx = from[0] + (p.pos[0]-from[0]) * t / (segLen || 1);
            const qy = from[1] + (p.pos[1]-from[1]) * t / (segLen || 1);
            const qz = from[2] + (p.pos[2]-from[2]) * t / (segLen || 1);
            if (Math.hypot(qx-c[0], qy-c[1], qz-c[2]) > 1.35) continue;
            const posedA = a.posed();
            const hp = traceProjectile(from, p.pos, q => sdBody(q, posedA));
            if (!hp) continue;
            const d = Math.hypot(hp[0]-from[0], hp[1]-from[1], hp[2]-from[2]);
            if (d < bestDist) { bestDist = d; hitActor = a; hitPoint = hp; }
          }
          if (hitActor && hitPoint) {
            const l = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1;
            if (p.kind === 'slug') hitActor.hitSlug(hitPoint, [p.vel[0]/l, p.vel[1]/l, p.vel[2]/l]);
            else hitActor.hit(hitPoint, [p.vel[0]/l, p.vel[1]/l, p.vel[2]/l]);
            dead = true;
          }
        }
        if (dead) pellets.splice(i, 1);
      }
      // Sync the mesh pool to the sim list — growing it on demand (the
      // pool is ONLY grown here; fire() must not touch meshes because it
      // runs from an evaluate() with no frame in between).
      while (pelletViews.length < pellets.length) {
        const mesh = new THREE.Mesh(pelletGeo, pelletMat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        pelletViews.push(mesh);
      }
      for (let k = 0; k < pelletViews.length; k++) {
        const v = pelletViews[k]!;
        if (k < pellets.length) {
          v.visible = true;
          v.position.set(pellets[k]!.pos[0], pellets[k]!.pos[1], pellets[k]!.pos[2]);
          // Slug balls are drawn at their own (larger) calibre.
          const s = pellets[k]!.radius / GRAPESHOT.radius;
          v.scale.setScalar(s);
        } else {
          v.visible = false;
        }
      }
      // Chunks: ballistic step + world-space field repack, lab contract.
      const cdt = Math.min(dt, 1 / 30);
      for (const c of liveChunks) {
        c.state = stepChunk(c.state, cdt);
        c.view.update(c.state);
      }
    }

    const eye = eyeOf(player);
    camera.position.set(eye[0], eye[1], eye[2]);
    const cp = Math.cos(player.pitch + recoilPitch);
    camera.lookAt(
      eye[0] + Math.sin(player.yaw) * cp,
      eye[1] + Math.sin(player.pitch + recoilPitch),
      eye[2] - Math.cos(player.yaw) * cp,
    );
    camera.updateMatrixWorld();
  }

  handle.setRenderCallback((dt) => {
    // Wall-clock frame delta (seconds -> ms), EMA'd — what the owner feels.
    // During __sdfGame.step() the dt is the supplied fixed step, not a
    // measurement; the readout only means something with the loop running.
    if (dt < 0.25) {
      const ms = dt * 1000;
      frameEma = frameEma === 0 ? ms : frameEma * 0.95 + ms * 0.05;
      if (adaptiveEnabled) {
        adaptiveFrames.push(ms);
        tickAdaptive(performance.now());
      }
    }
    tick(Math.min(dt, 1 / 20));
    if (frameCount++ % 10 === 0) updateHud();
  });
  updateHud();

  // -----------------------------------------------------------------------
  // __sdfGame — the deterministic driver surface. The grapeshot dispatch
  // builds on this: zombies are addressable by id, the player pose is
  // settable, frames are steppable, wanderers freezable.
  // -----------------------------------------------------------------------
  /** Where a slug fired RIGHT NOW would hit — the shared predictor.
   *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
   *  with the same code the placement gate uses, rather than trusting a
   *  cluster centre. No state mutated. */
  function predictSlugHitNow(): { origin: Vec3; dir: Vec3; actorId: number; hit: Vec3 | null } {
      const origin = muzzleWorld();
      const dir = convergedDir(origin);
      let bestD = Infinity;
      let hitActorId = -1;
      let hitPoint: Vec3 | null = null;
      // Simulate the slug's ACTUAL flight (gravity, like stepProjectiles) —
      // a straight muzzle ray ignores the drop and reads ~4 cm high at 3 m,
      // which the placement gate duly failed (2026-08-27).
      const pos: [number, number, number] = [origin[0], origin[1], origin[2]];
      const d0: [number, number, number] = [dir[0], dir[1], dir[2]];
      const vel: [number, number, number] = [d0[0] * SLUG.speed, d0[1] * SLUG.speed, d0[2] * SLUG.speed];
      const dt = 1 / 120;
      for (const a of actors) {
        const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
        if (!c) continue;
        if (Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]) > 20) continue;
        const posedA = a.posed();
        // Per-actor arc: reset the integrator, march segment-wise for 2 s.
        pos[0] = origin[0]; pos[1] = origin[1]; pos[2] = origin[2];
        vel[0] = d0[0] * SLUG.speed; vel[1] = d0[1] * SLUG.speed; vel[2] = d0[2] * SLUG.speed;
        for (let i = 0; i < 240; i++) {
          const next: Vec3 = [
            pos[0] + vel[0] * dt,
            pos[1] + vel[1] * dt,
            pos[2] + vel[2] * dt,
          ];
          const vNext: Vec3 = [vel[0], vel[1] + SLUG.gravity * dt, vel[2]];
          const hp = traceProjectile(pos, next, q => sdBody(q, posedA));
          if (hp) {
            const d = Math.hypot(hp[0] - origin[0], hp[1] - origin[1], hp[2] - origin[2]);
            if (d < bestD) { bestD = d; hitActorId = a.id; hitPoint = hp; }
            break;
          }
          pos[0] = next[0]; pos[1] = next[1]; pos[2] = next[2];
          vel[0] = vNext[0]; vel[1] = vNext[1]; vel[2] = vNext[2];
        }
      }
      return { origin, dir, actorId: hitActorId, hit: hitPoint };
  }

  /**
   * Aim at a body the ballistic predictor CONFIRMS is hittable.
   *
   * Two things this must not do, both learned by measurement (2026-08-31):
   *
   *   1. Do not stamp at a cluster CENTRE. A torso centre sits INSIDE the
   *      field: it anchors the crater pathologically, and a slug's severRadius
   *      cuts both hip necks into an instant collapse. The centre is used only
   *      to POINT the camera; the shot itself resolves to a surface.
   *   2. Do not aim at whatever is nearest. Room 4 spawns its zombies around
   *      the room centre, so a bench standing at the centre had a body 0.97 m
   *      away — close enough that the aim pitched 26 degrees DOWN into it, the
   *      predictor returned actorId -1, and all eight pellets expired having
   *      hit nothing. The bench then reported "firing" segments that contained
   *      no wounds at all.
   *
   * So: candidates in distance order, skipping anything inside MIN_STANDOFF,
   * and the first one the predictor confirms wins. Returns false if none do,
   * which leaves the aim untouched — a bench that silently re-aimed until it
   * connected would be measuring something the scenario never described.
   */
  const MIN_STANDOFF = 1.5;
  function aimAtNearestSurface(): boolean {
    const eye = eyeOf(player);
    const candidates = actors
      .map((a) => {
        const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
        return c ? { c: [...c] as Vec3, d: Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) } : null;
      })
      .filter((x): x is { c: Vec3; d: number } => x !== null && x.d >= MIN_STANDOFF)
      .sort((a, b) => a.d - b.d);

    const yaw0 = player.yaw;
    const pitch0 = player.pitch;
    for (const cand of candidates) {
      player.yaw = Math.atan2(cand.c[0] - eye[0], cand.c[2] - eye[2]);
      player.pitch = Math.atan2(cand.c[1] - eye[1], Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
      if (predictSlugHitNow().actorId >= 0) return true;
    }
    player.yaw = yaw0;
    player.pitch = pitch0;
    return false;
  }

  (window as unknown as { __sdfGame: unknown }).__sdfGame = {
    backend: handle.backend,
    /** Set the player pose. y defaults to 0 (feet on the floor). */
    setPose(x: number, z: number, yaw: number, pitch = 0, y = 0) {
      player.pos = [x, y, z];
      player.vel = [0, 0, 0];
      player.yaw = yaw;
      player.pitch = pitch;
      player.grounded = y === 0;
    },
    pose: () => ({ pos: [...player.pos] as Vec3, yaw: player.yaw, pitch: player.pitch }),
    /** Teleport to a room's centre, facing +z. */
    teleport(roomId: number) {
      const r = ROOMS.find(r => r.id === roomId);
      if (!r) return false;
      player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
      player.vel = [0, 0, 0];
      player.yaw = 0;
      player.pitch = 0;
      return true;
    },
    /** Enclosure key under the player's feet ('room1'..'room4', tunnel, 'void'). */
    room: () => enclosureKeyAt(player.pos[0], player.pos[2]),
    /** Hand-step N frames at dt seconds each; stops the rAF loop first. */
    step(n: number, dt = 1 / 60) {
      handle.setLoopRunning(false);
      for (let i = 0; i < n; i++) {
        handle.step(dt);
        if (frameCount++ % 10 === 0) updateHud();
      }
    },
    setLoopRunning: (on: boolean) => handle.setLoopRunning(on),
    /** Freeze/unfreeze the wanderers (pose, rig and shader clock all pin). */
    freeze: (on: boolean) => { wanderFrozen = on; },
    get frozen() { return wanderFrozen; },
    setProbeWeight: pushProbeWeight,
    get probeWeight() { return probeWeight; },
    /** Every zombie: id, room, live ground pose. */
    zombies: () => actors.map(a => ({ id: a.id, room: a.room, ...a.pose() })),
    /** One zombie's internals — the weapon seam: view (uniforms/wounds),
     *  posed() (raycast target), boundRig() (impulse/recoil entry). */
    zombie: (id: number) => {
      const a = actors.find(a => a.id === id);
      return a ? {
        view: a.view, posed: a.posed, boundRig: a.boundRig, pose: a.pose, room: a.room,
        woundCount: () => a.wounds().length,
        woundList: () => [...a.wounds()],
      } : undefined;
    },
    /** Where every wound of a body sits IN WORLD SPACE right now — the
     *  surface anchor (= the GPU carve sphere's centre) plus the depth-slab
     *  cap, all at the yaw-0 contract. The placement gate diffs the surface
     *  against the fired ray's impact point; carveDepth is the punch-through
     *  guard (0.45 × measured local flesh). */
    debugWounds: (id: number) => {
      const a = actors.find(a => a.id === id);
      if (!a) return undefined;
      const prims = a.posed().prims;
      return a.wounds().map(w => ({
        surface: woundWorldPos(prims, w, 0),
        carveNormal: woundCarveNormal(prims, w, 0),
        carveDepth: w.carveDepth,
        radius: w.radius,
        type: w.type,
        primIdx: w.primIdx,
      }));
    },
    /** Walk the player toward (x, z) through the real collision path until
     *  within 0.25 m (or walkCancel). Pairs with step()/setLoopRunning. */
    walkTo: (x: number, z: number) => { autopilot = { x, z }; },
    walkCancel: () => { autopilot = null; },
    get walking() { return autopilot !== null; },
    frameMs: () => frameEma,
    bodiesOnScreen,
    // ---------------------------------------------------------------
    // GRAPESHOT — the weapon surface. fire(1|2) bypasses pointer lock so
    // the headless driver can shoot; aim with setPose(yaw, pitch).
    // ---------------------------------------------------------------
    fire: (barrels: 1 | 2 = 1) => fire(barrels),
    get gunReady() { return gunReady; },
    get cooldown() { return cooldown; },
    // SLUG MODE surface + HUD-truthful flag.
    get slugMode() { return slugMode; },
    setSlugMode(on: boolean) { slugMode = on; updateHud(); },
    fireSlug: () => { const keep = slugMode; slugMode = true; try { return fire(1); } finally { slugMode = keep; } },
    /** PLACEMENT GATE (2026-08-26): where a slug fired RIGHT NOW would hit —
     *  computed by exactly the code fire() uses (muzzleWorld + converged
     *  dir) against each actor's CURRENT posed field. No state mutated.
     *  Diff against debugWounds() after firing to assert the crater landed
     *  where the ray struck. */
    predictSlugHit: () => predictSlugHitNow(),
    /** Hull-holes A/B seams (2026-08-27). setOccluder turns the occluder
     *  pre-pass (and its tMax clamp) on/off; setHullExclusions passes an
     *  empty wound list to the hull builder instead of the live one. Both
     *  default to shipped behaviour. */
    setOccluder: (on: boolean) => {
      occluderDesired = on;
      sdfLayer.setOccluderEnabled(on);
    },
    get occluder() { return sdfLayer.occluderEnabled && occluderDesired; },
    setHullExclusions: (on: boolean) => { hullExclusionsEnabled = on; },
    get hullExclusions() { return hullExclusionsEnabled; },

    // -------------------------------------------------------------------
    // BENCH SEAMS (2026-08-31). Everything the ablation legs toggle, plus
    // the fence the harness times against. Ship defaults are unchanged —
    // these only move when a driver moves them.
    // -------------------------------------------------------------------
    /** The GPU completion fence. Trust the fence, never a timestamp value. */
    resolveGpu: () => handle.resolveGpu(),
    // setAdaptive / setSdfScale already exist further down this object and
    // are better than the versions this block first added (they also clear
    // the adaptive sample window and report the whole ladder). Not
    // duplicated here — the driver calls those.
    setCone: (on: boolean) => sdfLayer.setConeEnabled(on),
    get cone() { return sdfLayer.coneEnabled; },
    setFxaa: (on: boolean) => postAa.setFxaa(on),
    get fxaa() { return postAa.fxaa; },
    setSmear: (v: number) => postAa.setSmear(v),
    /** Aim at the nearest body's surface. Exposed so a driver can stage a
     *  shot the same way the bench scenario does. */
    aimSurface: () => aimAtNearestSurface(),

    /** Rasterise the conservative outer hull (shell-hull-outer.ts). Default
     *  OFF — until the march consumes it this is an instrument, not a lever. */
    setShell(on: boolean) {
      sdfLayer.setShellEnabled(on);
      if (on) outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
    },
    get shell() {
      return {
        enabled: sdfLayer.shellEnabled,
        instances: outerHull.instanceCount,
        // An overflowed hull leaves flesh uncovered, which under a bounded
        // march is a HOLE, not a slightly worse bound. Never ignore this.
        overflowed: outerHull.overflowed,
        shellAmp: shellAmpOf(),
      };
    },

    /**
     * SCREEN COVERAGE of the outer hull, against the proxy boxes it would
     * replace.
     *
     * The decisive number for the shell march, and it can be taken WITHOUT
     * touching the march: occupancy() already reports what fraction of the
     * target the proxy boxes rasterise (75-100%). This reports what fraction
     * the hull covers. The gap between them is the work a bounded march
     * deletes.
     */
    async hullCoverage() {
      const wasOn = sdfLayer.shellEnabled;
      sdfLayer.setShellEnabled(true);
      outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const read = async (t: THREE.RenderTarget) => {
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          // Row padding again — bytesPerRow is aligned to 256. RedFormat, so
          // one float per pixel rather than four.
          const floatsPerRow = Math.ceil((w * 4) / 256) * 256 / 4;
          let covered = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) if (buf[base + col]! > 0) covered++;
          }
          return { w, h, covered, frac: covered / (w * h) };
        };
        const entry = await read(sdfLayer.shellEntryTarget);
        const exit = await read(sdfLayer.shellExitTarget);
        return {
          entry, exit,
          instances: outerHull.instanceCount,
          overflowed: outerHull.overflowed,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        sdfLayer.setShellEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * March step budget across every body (marchCfg.x, ships at 96).
     *
     * This is a MEASUREMENT seam, and the measurement it exists for is the
     * shell-march decision. Cost decomposes as roughly
     *   cost(budget) ~= hitPixels * (steps to converge) + missPixels * budget
     * because a ray that lands on flesh converges in ~8 steps while a ray that
     * misses runs on toward the budget. Sweeping the budget and fitting the
     * line therefore splits the frame into what HITS cost (the intercept) and
     * what MISSES cost (the slope) — and the misses are exactly the work a
     * bounded entry/exit shell would delete.
     *
     * Lowering this degrades the image (rays give up before converging), so
     * it is for benching only; nothing should ship on a reduced budget without
     * its own visual gate.
     */
    setMarchSteps(n: number) {
      for (const a of actors) a.view.uniforms.marchCfg.value.x = n;
    },
    get marchSteps() { return actors[0]?.view.uniforms.marchCfg.value.x ?? 0; },

    /**
     * PROXY-BOX OCCUPANCY — the shell-march decision measurement.
     *
     * How much of the screen area the march actually rasterises is flesh?
     * A bounded entry/exit hull never rasterises the rest, so `1 - occupancy`
     * is the shell march's addressable market. This exists because the step
     * budget sweep showed the spike's "14x fewer evals" counted the CHEAP
     * evals: cost is per-PIXEL, not per-step, so what matters is how many
     * pixels are marched for nothing.
     *
     * Method: march debug mode 4 returns raw counters BEFORE the miss-discard
     * (r = steps, g = hit, b = rasterised, a = t), one frame is rendered, and
     * the float target is read back and summed.
     *
     * Reported occupancy is a LOWER BOUND on the waste: depth-testing means
     * only the front-most body writes each pixel, so overlapping proxy boxes
     * hide extra fragment invocations this cannot see.
     */
    async occupancy() {
      const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const t = sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        // ROW PADDING, and it is not optional: WebGPU aligns bytesPerRow to
        // 256, so the readback is NOT densely packed. Walking it as w*h*4
        // reads progressively misaligned rows and still yields a plausible
        // percentage — the exact shape of wrong number this whole exercise
        // keeps producing. (Same arithmetic as shell-spike-main.ts.)
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let stepsOnHit = 0;
        let stepsOnMiss = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            if (buf[o + 1]! > 0.5) { hits++; stepsOnHit += buf[o]!; }
            else { stepsOnMiss += buf[o]!; }
          }
        }
        const misses = rasterised - hits;
        return {
          targetW: w, targetH: h, screenPx: w * h,
          rasterised, hits, misses,
          /** Fraction of MARCHED pixels that actually hit flesh. */
          occupancy: rasterised ? hits / rasterised : 0,
          /** Fraction of the SDF target the march touched at all. */
          coverage: rasterised / (w * h),
          meanStepsHit: hits ? stepsOnHit / hits : 0,
          meanStepsMiss: misses ? stepsOnMiss / misses : 0,
          /** Share of all marched STEPS spent on rays that hit nothing. */
          missStepShare: (stepsOnHit + stepsOnMiss) > 0
            ? stepsOnMiss / (stepsOnHit + stepsOnMiss) : 0,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        handle.setLoopRunning(true);
      }
    },

    /**
     * Run one bench leg.
     *
     * Parks the result on window.__gameBench as well as returning it: a
     * console call that returns a value can itself hide the page, and a
     * hidden page has no swapchain texture, so its passes do nothing and the
     * fence resolves to ~0.065 ms of nothing. That reads as a 70x speedup.
     * The harness counts hidden frames and invalidates the run, but reading
     * the value back afterwards avoids provoking it in the first place.
     */
    async bench(o: {
      room?: number; mode?: 'throughput' | 'spike';
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      chunkFrames?: number; warmup?: number; label?: string;
    } = {}) {
      const scenario = buildFirefight({
        room: o.room ?? 4,
        walkFrames: o.walkFrames,
        fireFrames: o.fireFrames,
        gibFrames: o.gibFrames,
      });
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);

      handle.setLoopRunning(false);
      const hadAdaptive = adaptiveEnabled;
      adaptiveEnabled = false;
      try {
        const deps: BenchDeps = {
          step: (dt) => handle.step(dt),
          resolveGpu: () => handle.resolveGpu(),
          now: () => performance.now(),
          hidden: () => document.hidden,
          census: () => ({
            bodies: bodiesOnScreen(),
            wounds: actors.reduce((n, a) => n + a.wounds().length, 0),
            chunks: liveChunks.length,
          }),
          perform: (a) => {
            switch (a.kind) {
              case 'teleport': {
                const r = ROOMS.find(x => x.id === a.room);
                if (r) {
                  // Stand back from where the BODIES actually are, facing
                  // them. Two heuristics were tried and both failed against
                  // the census (2026-08-31): the room centre put a zombie
                  // 0.97 m away so every shot pitched down into it and
                  // missed, and an outer corner pointed the camera at a wall
                  // with bodies 1 -> 0 on screen. The room's own actors are
                  // the only thing that reliably says where to look.
                  const mine = actors.filter(x => x.room === a.room);
                  const cx = (r.minX + r.maxX) / 2;
                  const cz = (r.minZ + r.maxZ) / 2;
                  let tx = cx;
                  let tz = cz;
                  if (mine.length) {
                    tx = mine.reduce((n, x) => n + x.pose().pos[0], 0) / mine.length;
                    tz = mine.reduce((n, x) => n + x.pose().pos[2], 0) / mine.length;
                  }
                  // Back off along the direction from the room centre toward
                  // the outer wall, so the whole group stays in front.
                  const away = Math.hypot(tx - cx, tz - cz);
                  let ax = away > 0.2 ? (cx - tx) / away : 0;
                  let az = away > 0.2 ? (cz - tz) / away : 1;
                  // Degenerate group (all at the centre): back off along -z.
                  if (!Number.isFinite(ax) || (ax === 0 && az === 0)) { ax = 0; az = 1; }
                  const STANDOFF = 4.0;
                  const inset = 0.6;
                  const px = Math.min(r.maxX - inset, Math.max(r.minX + inset, tx + ax * STANDOFF));
                  const pz = Math.min(r.maxZ - inset, Math.max(r.minZ + inset, tz + az * STANDOFF));
                  player.pos = [px, 0, pz];
                  player.vel = [0, 0, 0];
                  player.yaw = Math.atan2(tx - px, tz - pz);
                  player.pitch = 0;
                  player.grounded = true;
                }
                break;
              }
              case 'freeze': wanderFrozen = a.on; break;
              case 'look': player.yaw = a.yaw; player.pitch = a.pitch; break;
              case 'aimSurface': aimAtNearestSurface(); break;
              case 'fire': fire(a.barrels); break;
              case 'fireSlug': {
                const keep = slugMode;
                slugMode = true;
                try { fire(1); } finally { slugMode = keep; }
                break;
              }
            }
          },
        };
        const result = await runBench(deps, scenario, {
          mode: o.mode ?? 'throughput',
          chunkFrames: o.chunkFrames,
          warmup: o.warmup,
          label: o.label,
        });
        (window as unknown as { __gameBench: unknown }).__gameBench = result;
        return result;
      } finally {
        adaptiveEnabled = hadAdaptive;
        adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
        handle.setLoopRunning(true);
      }
    },
    /** Rebuild the hull NOW (the frame-loop update is gated on !wanderFrozen,
     *  so frozen captures would otherwise shoot through a stale hull). No
     *  simulation steps, so a stamped body stays exactly where it was put. */
    refreshHull: () => {
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            return a.wounds().map(w => ({ centre: woundWorldPos(prims, w, 0), radius: w.radius }));
          })
          : [],
      );
    },
    hullDebug: () => ({
      occluder: sdfLayer.occluderEnabled,
      exclusions: hullExclusionsEnabled,
      instances: occluderHull.instanceCount,
      woundsPerBody: actors.map(a => a.wounds().length),
    }),
    /** A visible sphere in WORLD space, drawn through the normal geometry
     *  pass — so captures can mark predicted impacts vs actual craters.
     *  One marker at a time; pass null coords to remove. */
    placeMarker(x: number | null, y = 0, z = 0, colorHex = 0xff00ff) {
      if (!marker) {
        const geo = new THREE.SphereGeometry(0.03, 12, 8);
        marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex }));
        marker.frustumCulled = false;
        scene.add(marker);
      }
      (marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      if (x === null) { marker.visible = false; return; }
      marker.visible = true;
      marker.position.set(x, y, z);
    },
    projectiles: () => pellets.map(p => ({
      pos: [...p.pos] as Vec3,
      vel: [...p.vel] as Vec3,
      ageSec: p.ageSec,
    })),
    get chunkCount() { return liveChunks.length; },
    /** SDF-pass scale relative to the capped buffer (1.0 = 1:1). */
    setSdfScale: (v: number) => applySdfScale(v),
    get sdfScale() { return sdfScale; },
    get sdfTarget() { return sdfLayer.targetSize; },
    /** Adaptive resolution ladder — default OFF so the chosen rung ships. */
    setAdaptive(on: boolean, budgetMs?: number) {
      adaptiveEnabled = on;
      if (budgetMs !== undefined) adaptiveBudgetMs = budgetMs;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      adaptiveFrames.length = 0;
    },
    get adaptive() {
      return {
        enabled: adaptiveEnabled,
        budgetMs: adaptiveBudgetMs,
        rung: adaptiveState.rung,
        scale: scaleForRung(adaptiveState.rung),
        ladder: [...SCALE_LADDER],
      };
    },
    /** The active render cap + how it was chosen (?res=). */
    get resolution() {
      const cap = RES_RUNGS[resKey];
      const content = postAa.contentSize;
      return {
        rung: resKey,
        cap: { ...cap },
        content: { ...content },
        letterboxed: cap.mode === 'fixed',
      };
    },
    /** Dev twin of the lab's stampWoundAt (2026-08-27): ONE wound by ray
     *  through the same worldHitToWound path the pellet uses, pushed via
     *  stampBlast — no damage, no shove, no sever. A full grapeshot volley
     *  kills and death-gibs (the weapon works), so a pocked STANDING torso
     *  only exists through this seam. */
    stampWoundAt: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
      kind: 'pellet' | 'slug' = 'pellet', bodyId?: number) => {
      const a = bodyId === undefined ? actors[0] : actors.find(q => q.id === bodyId);
      if (!a) return null;
      const posed = a.posed();
      const hit = traceProjectile(
        [ox, oy, oz],
        [ox + dx * 8, oy + dy * 8, oz + dz * 8],
        q => sdBody(q, posed),
      );
      if (!hit) return null;
      // 'slug' carries the BLAST profile at 0.16 (see SLUG) — the blast-class
      // crater look without resolveExplosion's 16-wound kill-gib.
      const field = (q: Vec3) => sdBody(q, posed);
      const w = kind === 'slug'
        ? woundFromSlug(posed.prims, hit, field)
        : woundFromPellet(posed.prims, hit, 0, field);
      a.stampBlast([w]);
      return hit;
    },
    /** Diagnostic detonation: one blast stamped through resolveExplosion
     *  (the SAME worldHitToWound path dynamite uses) with falloff-scaled
     *  blast calibre — wounds only, no shove/sever/gib, so captures are not
     *  displaced by their own impact. Returns what it did. */
    explode: (x: number, y: number, z: number) => {
      const bodies: ExplosionBody[] = actors.map(a => ({ id: String(a.id), body: a.posed() }));
      const fx = resolveExplosion([x, y, z], bodies);
      let totalWounds = 0;
      for (const pb of fx.perBody) {
        if (pb.wounds.length === 0) continue;
        const a = actors.find(q => String(q.id) === pb.bodyId);
        if (!a) continue;
        a.stampBlast(pb.wounds);
        totalWounds += pb.wounds.length;
      }
      return { radiusM: fx.radiusM, bodiesHit: fx.perBody.length, totalWounds };
    },
    uptime: () => (performance.now() - bootTime) / 1000,
    get frames() { return frameCount; },
    /** Where a view-model hangs (child of the camera). */
    viewModelAnchor,
    rooms: ROOMS.map(r => ({
      id: r.id, name: r.name, zombies: r.zombies,
      bounds: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ },
    })),
    tunnels: TUNNELS.map(t => t.name),
    furniture: FURNITURE,
    /** Accent lights per room — capture/measurement seam (pair-shot framing). */
    accents: ROOMS.flatMap(r => r.accents.map(a => ({ room: r.id, ...a }))),
  };
}

main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  console.error('[sdf-game] bootstrap failed', err);
});
