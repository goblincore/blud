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
import { createLabRenderer } from './lab-renderer';
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

/** Low but clearly visible — the owner's slide runs 0..1 from here. */
const DEFAULT_PROBE_WEIGHT = 0.5;
/** Fixed SDF scale (the shipping rung). No adaptive controller here. */
const SDF_SCALE = 0.7;

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
  const handle = await createLabRenderer(mount);
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
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color[0], p.color[1], p.color[2]),
      roughness: 1,
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

  // -----------------------------------------------------------------------
  // The draw chain, exactly as the bench stands it up.
  // -----------------------------------------------------------------------
  const postAa = createPostAa(handle.renderer);
  const sdfLayer = createSdfLayer(handle.renderer);
  postAa.addSink(sdfLayer);
  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
  }
  sdfLayer.setScale(SDF_SCALE);
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
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

  function tick(dt: number) {
    const input: MoveInput = {
      x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      z: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      jump: keys.has('Space'),
    };
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
    const t0 = performance.now();
    tick(Math.min(dt, 1 / 20));
    frameEma = frameEma === 0 ? performance.now() - t0
      : frameEma * 0.95 + (performance.now() - t0) * 0.05;
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
    frameMs: () => frameEma,
    bodiesOnScreen,
    uptime: () => (performance.now() - bootTime) / 1000,
    get frames() { return frameCount; },
    /** Where a view-model hangs (child of the camera). */
    viewModelAnchor,
    rooms: ROOMS.map(r => ({ id: r.id, name: r.name, zombies: r.zombies })),
    tunnels: TUNNELS.map(t => t.name),
  };
}

main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  console.error('[sdf-game] bootstrap failed', err);
});
