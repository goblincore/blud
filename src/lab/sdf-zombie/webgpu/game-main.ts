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
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER } from './sdf-layer';
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
  let adaptiveEnabled = false;
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
        { cone: sdfLayer.cone, occluder: sdfLayer.occluder });
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
      actors.push(createZombieActor({
        id: nextId++, room: room.id, body: placed, view, start,
        seed: 1337 + nextId * 101,
        bounds: wanderBounds(room),
        furniture: roomFurniture,
      }));
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
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let parked = DEFAULT_PROBE_WEIGHT;

  // The seam for the grapeshot dispatch: a view-model hangs off this group,
  // which rides the camera every frame. Empty today.
  const viewModelAnchor = new THREE.Group();
  viewModelAnchor.name = 'view-model-anchor';
  camera.add(viewModelAnchor);
  scene.add(camera);

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
      (hud.lockHint ? ' · click to lock' : '') +
      (wanderFrozen ? ' · FROZEN' : '');
  }

  // -----------------------------------------------------------------------
  // Frame loop.
  // -----------------------------------------------------------------------
  let wanderFrozen = false;
  let frameCount = 0;
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
      occluderHull.update(actors.map(a => a.posed()));
    }

    const eye = eyeOf(player);
    camera.position.set(eye[0], eye[1], eye[2]);
    const cp = Math.cos(player.pitch);
    camera.lookAt(
      eye[0] + Math.sin(player.yaw) * cp,
      eye[1] + Math.sin(player.pitch),
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
      return a ? { view: a.view, posed: a.posed, boundRig: a.boundRig, pose: a.pose, room: a.room } : undefined;
    },
    /** Walk the player toward (x, z) through the real collision path until
     *  within 0.25 m (or walkCancel). Pairs with step()/setLoopRunning. */
    walkTo: (x: number, z: number) => { autopilot = { x, z }; },
    walkCancel: () => { autopilot = null; },
    get walking() { return autopilot !== null; },
    frameMs: () => frameEma,
    bodiesOnScreen,
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
