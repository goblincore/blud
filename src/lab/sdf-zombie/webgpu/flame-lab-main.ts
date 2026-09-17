// src/lab/sdf-zombie/webgpu/flame-lab-main.ts
//
// THE FLAME LAB. Two burning bodies, the real march, the real post chain, and
// nothing else -- no AI, no damage, no gibs, so what you are looking at is the
// fire and not a fight. Assembled from lab-main.ts's blocks (renderer + floor
// 174-222, layer + postAa + tile binding 232-248, character view 255-267, panel
// toggle 276-291, draw chain 328-351, frame loop 2406+); see
// docs/superpowers/plans/2026-09-17-flame-lab-foundation.md.

// From 'three/webgpu', never 'three' — two copies of three break the node
// system's light lookup and render every standard material black.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, CONE_LAYER } from './sdf-layer';
import {
  createCharacterView, compileCharacterSheet, type CharacterView,
} from './character-view';
import { createPostAa } from './post-aa';
import {
  characterEntry, hasCharacter, FACE_TEXTURES, type FaceTexName,
} from '../character-registry';
import { parseBlob } from '../blob-parse';
import { generateFaceSheet } from '../blob-face-sheet';
import { compileFace, compileSheetImage } from '../blob-compile';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial } from '../material';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import { createComputeTileBinding } from './tile-bin-compute';
import { applyDebugPanelVisibility } from '../panel';
import { applyRig, headQuatOf } from '../rig-bind';
import {
  emptyActorSignals, makeActorMotion, stepActorMotion,
  type ActorMotion, type ActorSignals,
} from '../actor';
import { MOTION_TUNING } from '../motion';
import { motionProfileFor, speedForBand, type MotionProfile } from '../motion-profile';
import { makeRng, type Rng, type WanderBounds } from '../wander';
import { createBurnState, igniteBurn, extinguishBurn, stepBurn, forceBurn } from '../burn-state';
import { BURN_TUNING, burnPresets, resolveBurnTuning, type BurnTuning } from './burn-profiles';
import { createFlamePanel } from './flame-panel';

export interface FlameLabBody {
  name: string;
  /** Metres along x, so the two bodies stand side by side. */
  x: number;
}

/** The spec's two characters. Exported so the page's test can pin them. */
export const FLAME_LAB_BODIES: readonly FlameLabBody[] = Object.freeze([
  { name: 'zombie', x: -0.7 },
  { name: 'soldier', x: 0.7 },
]);

// The `?character=` helper, copied from lab-main.ts. The flame lab exists to
// show the zombie AND the soldier, so it is only an override for the FIRST
// slot: the soldier keeps his post unless you name him.
function activeCharacterName(): string {
  const want = new URLSearchParams(location.search).get('character');
  return want && hasCharacter(want) ? want : 'zombie';
}

// Fixed seed: reproducible shambling for A/B looks, per lab-main's MOTION_SEED.
const MOTION_SEED = 1337;
/** Each body wanders a SMALL box around its own spawn, so the pair stays side
 *  by side instead of trading places (the crowd's per-spawn bounds idea). */
const WANDER_R = 0.35;

/**
 * The skull's centre and its three SEMI-AXES: the fattest additive primitive
 * in the head cluster, measured per axis. Copied from lab-main.ts (the
 * painted-prims skip is load-bearing — hair/hats out-size the skull they
 * cover and the face would project onto the hat).
 */
function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  const headPrims = b.prims.slice(head.start, head.start + head.count);
  const flesh = headPrims.filter(p => p.op !== 'sub' && p.color === undefined);
  for (const p of (flesh.length > 0 ? flesh : headPrims)) {
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

/** One lab body's runtime record: view + motion + wander policy. */
interface FlameLabActor {
  name: string;
  view: CharacterView;
  gpu: ReturnType<typeof createCharacterView>['gpu'];
  current: BuildResult;
  motion: ActorMotion;
  profile: MotionProfile;
  bounds: WanderBounds;
  rng: Rng;
  signals: ActorSignals;
  /** Own face sheet while its texture lives — disposed on nothing today (the
   *  page runs until the tab closes, like the lab). */
  faceTex: THREE.Texture | null;
}

// Everything lives inside an async bootstrap rather than using top-level await.
// WebGPURenderer needs `await renderer.init()`, and the project's build target
// predates top-level await. Returns early (before any GPU work) when the test
// DOM has no #app — importing this module from vitest must stay side-effect
// free.
async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) return;

  const handle = await createLabRenderer(mount);
  const { scene, camera } = handle;

  // Ground plane and a reference cube, so the raymarched bodies have polygonal
  // geometry to composite against and depth interleaving is obvious by eye.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const refCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
  );
  refCube.position.set(0.6, 0.2, 0.3);
  scene.add(refCube);

  // The render targets the character views are constructed with. The raymarched
  // bodies render into their own target at their own scale and composite back
  // over the polygonal scene.
  const sdfLayer = createSdfLayer(handle.renderer);
  // Post chain (X1.25): FXAA + temporal smear + sharp-bilinear upscale. It
  // owns the frame's tail — with every effect off it is an exact
  // pass-through, so the pre-X1.25 draw path is untouched by default-off.
  // Created before sizeSdfLayer because the SDF layer sizes from its
  // contentSize (the capped render size).
  const postAa = createPostAa(handle.renderer);
  postAa.addSink(sdfLayer);
  // PERF TASK 5 step 3, compute port: each body opts into the per-tile fold
  // lists. The GPU binding is allocated ONCE at the WORST-CASE grid — one per
  // body, since each view binds its own. Gated by tileCfg.x = 0, so nothing
  // bins into them on this page (no bench here); the allocation is what the
  // lab's default state carries too.
  const tileBindings = FLAME_LAB_BODIES.map(() => createComputeTileBinding(
    handle.renderer,
    Math.ceil(postAa.contentSize.width), Math.ceil(postAa.contentSize.height),
  ));

  // THE BODIES. One createCharacterView per FLAME_LAB_BODIES entry; each body
  // keeps its own face sheet, palette and motion record (two characters, not
  // one hero plus clones).
  // URL params, read once at boot. ?preset= picks a burnPresets entry,
  // ?burn=1 boots already alight, ?seed= seeds the motion RNG so capture runs
  // reproduce (lab-main has no ?seed reader — the plan assumed one — so this
  // page owns it).
  const q = new URLSearchParams(location.search);
  const startLit = q.get('burn') === '1';   // boot already alight
  const preset = q.get('preset');           // a burnPresets name
  const seedParam = q.get('seed');
  const motionSeed = seedParam !== null && /^\\d+$/.test(seedParam)
    ? Number(seedParam) >>> 0 : MOTION_SEED;
  // One live tuning + one burn state per body. The state is pure (burn-state.ts
  // keeps the clamping and the char invariant); the page only steps it and
  // copies the numbers into uniforms.
  let tuning: BurnTuning = preset && Object.hasOwn(burnPresets, preset)
    ? resolveBurnTuning(burnPresets[preset as keyof typeof burnPresets])
    : resolveBurnTuning(BURN_TUNING);
  const burns = FLAME_LAB_BODIES.map(() => createBurnState());
  if (startLit) for (const s of burns) igniteBurn(s);
  const actors: FlameLabActor[] = [];
  for (let i = 0; i < FLAME_LAB_BODIES.length; i++) {
    const slot = FLAME_LAB_BODIES[i]!;
    // Slot 0 honours the `?character=` override (see activeCharacterName);
    // slot 1 is the soldier the page exists to show.
    const name = i === 0 ? activeCharacterName() : slot.name;
    const entry = characterEntry(name);
    // Seed the face from the character's OWN `face` block (compileFace parses
    // the .blob), so a .blob-authored head renders at the size its author
    // declared. No panel override here: the flame lab shows the canonical
    // characters, not the WebGL lab's saved overrides.
    let face: FaceParams;
    try {
      face = { ...DEFAULT_FACE, ...compileFace(parseBlob(entry.src)) };
    } catch {
      face = { ...DEFAULT_FACE };
    }

    const errors: string[] = [];
    const view = await createCharacterView({
      name,
      start: [slot.x, 0, 0],
      renderer: handle.renderer,
      scene,
      gpu: {
        cone: sdfLayer.cone,
        occluder: sdfLayer.occluder,
        tiles: tileBindings[i]!,
      },
      errors,
      face,
    });
    const gpu = view.gpu;

    // The character's own palette if it declared one, else the lab default.
    const flesh: FleshMaterial = view.palette
      ? { ...view.palette }
      : { ...FLESH_PRESETS['henenlotter-latex'] };
    gpu.applyMaterial(flesh, LIGHT_PRESETS['practical-hard-key']);
    // Everything raymarched lives on SDF_LAYER, so the two render passes are a
    // camera layer mask apart rather than an object list to keep in sync.
    gpu.object.layers.set(SDF_LAYER);
    gpu.coneObject.layers.set(CONE_LAYER);
    scene.add(gpu.object);
    scene.add(gpu.coneObject);

    // — Face texture, per body — the compact port of lab-main's
    //   loadGeneratedFace/loadFaceTexture pair (its 680-863 block), scoped to
    //   ONE entry + ONE view instead of the lab's shared-sheet machinery.
    //   Without it the heads render untextured, which fails the plan's
    //   "looks exactly as on /sdf-lab-webgpu.html" check.
    const u = gpu.uniforms;
    // Baked projection defaults; the character's sheet block overrides them.
    u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
    const { sheet: params } = compileCharacterSheet(entry);
    let faceMode: 1 | 2 | 3 = 1;
    let faceEnabled = true;
    if (params) {
      u.faceProj.value.set(
        params.projScaleX, params.projScaleY, params.projCentreX, params.projCentreY,
      );
      u.faceCfg2.value.z = params.eyeGlowCut;
      u.faceCfg2.value.w = params.eyeGlowAmp;
      u.faceGlowRedOnly.value = params.eyeGlowRedOnly;
      u.faceCfg2.value.x = params.projSpherical;
      u.faceCfg.value.w = params.texRelief;
      u.faceCfg.value.z = params.faceForward;
      if (params.enabled === 0) faceEnabled = false;
    }
    u.faceCfg.value.y = params ? params.texStrength : 1.0;
    let faceTex: THREE.Texture | null = null;
    let faceMean = 1;
    const image = params ? compileSheetImage(parseBlob(entry.src)) : null;
    if (image) {
      // BAKED IMAGE: whole-image atlas, decal/multiply mode from the sheet.
      // Mean 1 until the image decodes, then the load callback re-uploads with
      // the measured value (one frame of the old level is not worth blocking
      // on) — the same applyMeanOf contract lab-main's image path uses.
      const tex = new THREE.TextureLoader().load(`/assets/lab/faces/${image}`, () => {
        let mean = 1;
        try {
          const img = tex.image as HTMLImageElement;
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          if (cx !== null && cv.width > 0 && cv.height > 0) {
            cx.drawImage(img, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height).data;
            let sum = 0, n = 0;
            for (let p = 0; p < d.length; p += 4) {
              if (d[p + 3]! < 8) continue;
              sum += (0.2126 * d[p]! + 0.7152 * d[p + 1]! + 0.0722 * d[p + 2]!) / 255;
              n++;
            }
            if (n > 0) mean = Math.max(sum / n, 1e-3);
          }
        } catch { /* tainted or undecodable: keep 1, the old behaviour */ }
        faceMean = mean;
        gpu.setFaceTexture(tex, new THREE.Vector4(1, 1, 0, 0), mean);
      });
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = true;
      faceMode = params!.decal > 0.5 ? 2 : (params!.blendLuma > 0.5 ? 3 : 1);
      faceTex = tex;
      gpu.setFaceTexture(tex, new THREE.Vector4(1, 1, 0, 0), faceMean);
    } else if (params) {
      // GENERATED SHEET from the character's own sheet params. Rows are
      // flipped at upload (generateFaceSheet writes top-left; a DataTexture
      // gets no flipY help) and expanded to RGBA — a RedFormat upload renders
      // the whole head blood red because the shader reads tex.rgb.
      const gen = generateFaceSheet(params, 64);
      const rgba = new Uint8Array(gen.size * gen.size * 4);
      for (let y = 0; y < gen.size; y++) {
        const srcRow = (gen.size - 1 - y) * gen.size;
        for (let x = 0; x < gen.size; x++) {
          const v = gen.pixels[srcRow + x]!;
          const o = (y * gen.size + x) * 4;
          rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(rgba, gen.size, gen.size, THREE.RGBAFormat);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      faceMode = 1;
      faceTex = tex;
      faceMean = gen.mean;
      gpu.setFaceTexture(tex, new THREE.Vector4(1, 1, 0, 0), gen.mean);
    } else {
      // REGISTRY PNG fallback (the shared zombie sheet) — what every
      // character without a sheet block wore before sheets existed.
      const def = FACE_TEXTURES['zombie-flat' satisfies FaceTexName];
      const tex = new THREE.TextureLoader().load(def.url);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = true;
      const [x, y, w, h, sheetW, sheetH] = def.rect;
      faceMode = 1;
      faceTex = tex;
      faceMean = def.mean;
      gpu.setFaceTexture(
        tex,
        new THREE.Vector4(w / sheetW, h / sheetH, x / sheetW, y / sheetH),
        def.mean,
      );
    }
    u.faceCfg.value.x = faceEnabled ? faceMode : 0;  // face on (unless the sheet says no)

    // Spawn-time skull sphere from the placed field; re-derived per frame from
    // the POSED prims below, same as every animated lab body.
    const skull = headShape(view.body);
    if (skull) gpu.setHeadShape(skull.centre, skull.axes);

    const spawn: Vec3 = [slot.x, 0, 0];
    actors.push({
      name,
      view,
      gpu,
      current: view.body,
      motion: makeActorMotion(view.body, { seed: motionSeed + i * 7919, start: spawn }),
      profile: motionProfileFor(name),
      bounds: {
        minX: spawn[0]! - WANDER_R, maxX: spawn[0]! + WANDER_R,
        minZ: spawn[2]! - WANDER_R, maxZ: spawn[2]! + WANDER_R,
      },
      rng: makeRng(motionSeed + i * 7919),
      signals: emptyActorSignals(),
      faceTex,
    });
  }

  const errorsEl = document.getElementById('errors');
  if (errorsEl) errorsEl.textContent = actors.flatMap(a => a.current.errors).join('\n');

  // Panel readouts are built FIRST, before setRenderCallback: the animation
  // loop is already running by the time createLabRenderer resolves, so a frame
  // can fire the moment the callback is installed and would hit these in their
  // temporal dead zone if they were declared alongside the rest of the panel.
  const panelEl = document.getElementById('panel')!;
  const panelToggleEl = document.getElementById('panel-toggle') as HTMLButtonElement;
  let debugPanelHidden = false;
  function setDebugPanelHidden(hidden: boolean) {
    debugPanelHidden = hidden;
    applyDebugPanelVisibility(panelEl, panelToggleEl, hidden);
    flamePanel.setVisible(!hidden);     // H hides every panel, the flame one too
  }
  function toggleDebugPanel() {
    setDebugPanelHidden(!debugPanelHidden);
  }
  panelToggleEl.addEventListener('click', toggleDebugPanel);
  // The FLAME panel (plan task 9): one slider per BurnTuning field, its ranges
  // read from BURN_BOUNDS, presets one click away, COPY emitting the setter
  // call a tuning session ends in. Sliders read the APPLIED tuning back, so a
  // clamp behind a slider shows itself. Mounted before the first
  // setDebugPanelHidden call below -- that call now drives this panel too.
  const flamePanel = createFlamePanel({
    read: () => tuning,
    apply: (patch) => (tuning = resolveBurnTuning({ ...tuning, ...patch })),
    preset: (name) => (tuning = resolveBurnTuning(burnPresets[name])),
  });
  flamePanel.setVisible(true);
  flamePanel.setCollapsed(false);
  setDebugPanelHidden(false);
  const statusBox = document.createElement('div');
  statusBox.style.marginTop = '6px';
  panelEl.appendChild(statusBox);
  // Backend first, and loud. WebGPURenderer falls back to a WebGL2 backend
  // silently, and "it worked" on the fallback is not evidence the WebGPU path
  // works — the single most important thing to know when reading this page.
  const backendEl = document.createElement('div');
  backendEl.textContent = `backend: ${handle.backend}`;
  backendEl.style.color = handle.backend === 'webgpu' ? '#9c9' : '#ff6464';
  backendEl.style.fontSize = '11px';
  statusBox.appendChild(backendEl);
  const countEl = document.createElement('div');
  countEl.style.fontSize = '11px';
  countEl.textContent = `bodies: ${actors.length}`;
  statusBox.appendChild(countEl);
  const fpsEl = document.createElement('div');
  fpsEl.style.fontSize = '11px';
  statusBox.appendChild(fpsEl);

  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    const t = sdfLayer.targetSize;
    // Cone footprint radius per unit distance, from the layer's resolution and
    // the lens. Owned here rather than per view: every body's cone material
    // reads the same uniforms.
    sdfLayer.setConeGeometry(camera.fov, t.height);
  }
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);

  // The frame's draw: the SDF pass composites over the polygonal scene inside
  // the post chain. No goo, no effects scene — the flame lab has nothing else
  // to render (yet; the tongue plans add their own passes).
  handle.setDrawFn(() => postAa.render(
    () => { sdfLayer.render(scene, camera); },
  ));

  // -------------------------------------------------------------------------
  // Orbit camera — lab-main's pointer handlers minus the click-shoot (nothing
  // here shoots; the browser pane's phantom clicks can only stop the spin).
  // -------------------------------------------------------------------------
  let camYaw = 0.35;
  let camPitch = 0.12;
  let camDist = 3.2; // frames the pair; the lab's 2.4 cups one body
  const camTarget = new THREE.Vector3(0, 1.05, 0);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let autoSpin = true;

  const canvas = handle.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    autoSpin = false;
    if (e.button !== 0 && e.button !== 2) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    camYaw -= dx * 0.008;
    camPitch = Math.max(-0.5, Math.min(1.3, camPitch + dy * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener(
    'wheel',
    (e) => { camDist = Math.max(0.8, Math.min(8, camDist + Math.sign(e.deltaY) * 0.2)); },
    { passive: true },
  );

  // -------------------------------------------------------------------------
  // Live state + keys
  // -------------------------------------------------------------------------
  // Bodies stand (idle) until you walk them: ',' walk band, '.' run band.
  let wanderOn = false;
  let speedBand: 'walk' | 'run' = 'walk';
  const cruiseFor = (profile: MotionProfile) => speedForBand(profile, speedBand);
  let forcedCollapse = false;

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyH' && !ev.repeat) {
      ev.preventDefault();
      toggleDebugPanel();
      return;
    }
    // Speed band, copied from lab-main: ',' rather than '1'/'2' for the same
    // reason the lab gives (the lab's '1' is a sever key; here '1' is free,
    // but the muscle memory should match across lab pages).
    if (ev.key === ',') { speedBand = 'walk'; wanderOn = true; return; }
    if (ev.key === '.') { speedBand = 'run'; wanderOn = true; return; }
    if (ev.key === 'k' || ev.key === 'K') {
      forcedCollapse = true;
      for (const a of actors) a.signals.forcedCollapse = true;
      return;
    }
    // Burn: I lights both bodies, O puts them out (the char STAYS — the
    // difference between a burnt corpse and a clean one).
    if (ev.key === 'i' || ev.key === 'I') { for (const s of burns) igniteBurn(s); return; }
    if (ev.key === 'o' || ev.key === 'O') { for (const s of burns) extinguishBurn(s); return; }
  });

  // -------------------------------------------------------------------------
  // Frame loop. setRenderCallback REPLACES rather than appends, so everything
  // per-frame has to live in this one function.
  // -------------------------------------------------------------------------
  const frames: number[] = [];
  let lastStamp = performance.now();

  handle.setRenderCallback((dt) => {
    const now = performance.now();
    frames.push(now - lastStamp);
    lastStamp = now;
    if (frames.length > 120) frames.shift();
    if (frames.length > 20) {
      const s = [...frames].sort((a, b) => a - b);
      const med = s[Math.floor(s.length * 0.5)]!;
      fpsEl.textContent = `cpu ${med.toFixed(1)} ms  (${(1000 / med).toFixed(0)} fps)`;
    }

    // AA EPSILON FOOTPRINT — computed from the live camera and pass height
    // rather than sdfLayer.pixelConeK (lab-main's note: the reachable handle
    // reported a stale size once, and a silently-wrong footprint reads as a
    // shader bug).
    {
      const hPx = Math.max(1, sdfLayer.targetSize.height);
      const k = Math.tan((camera.fov * Math.PI) / 360) / hPx;
      for (const a of actors) a.gpu.uniforms.aaCfg.value.x = k;
    }

    // — Per-body step: every body runs the SAME stepActorMotion pipeline the
    //    lab's hero and crowd run. Real dt (sub-stepped inside), empty
    //    signals (nothing here shoots), per-body seed (no marching band) and
    //    small per-spawn wander boxes so the pair stays side by side.
    for (const a of actors) {
      if (!a.motion.motionJoints) continue;
      const f = stepActorMotion(a.motion, {
        current: a.current,
        dt,
        wander: wanderOn,
        armStyle: undefined,
        headingFollow: MOTION_TUNING.headingFollow,
        gazeFollow: MOTION_TUNING.gazeFollow,
        bounds: a.bounds,
        rng: a.rng,
        signals: a.signals,
        profile: { ...a.profile, cruise: cruiseFor(a.profile) },
      });
      // Polygon halves ride the rig — kit and prop pose from the same rig
      // solve (soldier's helmet and gun; the zombie has neither).
      a.view.pose(a.current, a.motion.bound, a.motion.lastBodyYaw, Infinity,
        f, dt, MOTION_SEED);
      const posed = applyRig(a.current, a.motion.bound, a.motion.lastBodyYaw);
      a.gpu.update(posed, a.current);
      const rs = a.motion.lastRootShift;
      a.gpu.setRootShift(rs[0]!, rs[2]!, a.motion.lastBodyYaw);
      const skull = headShape(posed);
      if (skull) a.gpu.setHeadShape(skull.centre, skull.axes);
      a.gpu.setHeadRotation(
        headQuatOf(a.motion.bound, a.motion.lastBodyYaw) ?? [0, 0, 0, 1]);
    }

    // — Per-body burn step + uniform write. dt is clamped the way the rest of
    //    the lab clamps it, so one stalled frame cannot ignite AND fully char
    //    a body in a single step (stepBurn integrates burn across the step;
    //    a dt over igniteSec would overshoot into the clamp). The four
    //    tuning scalars rewrite every frame, so setTuning takes effect live
    //    with no re-upload path.
    {
      const burnDt = Math.min(dt, 1 / 30);
      for (let i = 0; i < actors.length; i++) {
        const s = stepBurn(burns[i]!, burnDt, tuning);
        const gpu = actors[i]!.gpu;
        gpu.uniforms.burnCfg.value.set(s.burn, s.burnSec, s.char, 0);
        gpu.uniforms.burnNoiseScale.value = tuning.noiseScale;
        gpu.uniforms.burnRiseSpeed.value = tuning.riseSpeed;
        gpu.uniforms.burnCharPatch.value = tuning.charPatch;
        gpu.uniforms.burnFireGain.value = tuning.fireGain;
      }
    }

    // Orbit camera. Either button drags; the slow spin keeps the pair framed
    // when you are not grabbing it.
    if (autoSpin) camYaw += dt * 0.35;
    const cp = Math.cos(camPitch);
    camera.position.set(
      camTarget.x + Math.sin(camYaw) * cp * camDist,
      camTarget.y + Math.sin(camPitch) * camDist,
      camTarget.z + Math.cos(camYaw) * cp * camDist,
    );
    camera.lookAt(camTarget);
  });

  // Console API — the capture and tuning entry point until the tuning panel
  // lands (plan task 9). `__flameLab.capture()` pins a body straight to a
  // burn/char pair for deterministic screenshots; `burns()`/`tuning()` echo
  // the live state back.
  (window as unknown as { __flameLab: unknown }).__flameLab = {
    ignite(on = true) { for (const s of burns) (on ? igniteBurn : extinguishBurn)(s); },
    setTuning(p: Partial<BurnTuning> = {}) { tuning = resolveBurnTuning({ ...tuning, ...p }); return tuning; },
    preset(name: keyof typeof burnPresets) { tuning = resolveBurnTuning(burnPresets[name]); return tuning; },
    /** Full burn immediately, for deterministic captures. */
    capture(burn = 1, char = 0) {
      for (const s of burns) forceBurn(s, burn, char);
    },
    tuning() { return { ...tuning }; },
    burns() { return burns.map(b => ({ ...b })); },
  };
}

void bootstrap().catch((err) => {
  const box = document.getElementById('errors');
  if (box) box.textContent = String(err);
  console.error(err);
});
