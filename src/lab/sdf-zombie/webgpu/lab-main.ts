// src/lab/sdf-zombie/webgpu/lab-main.ts
//
// The SDF zombie lab, on WebGPU. Feature-parity twin of ../lab-main.ts.
//
// Everything renderer-independent is SHARED, not copied: build-body, body,
// face, material, damage, sever, rig, rig-bind, gib-chunks, validate, panel.
// Only the rendering tail (createLabRenderer + zombie-gpu) differs, which is
// the whole point of the migration being lab-scoped — the field maths cannot
// drift between the two paths because there is only one copy of it.
//
// Two differences from the WebGL lab, both deliberate:
//
//   1. NO POST-FX. pmndrs `postprocessing` is WebGL-only and its EffectComposer
//      cannot drive a WebGPURenderer. The WebGPU spec dropped it on purpose:
//      post-fx defaults OFF in the WebGL lab anyway, because the flesh presets
//      were tuned against a missing gamma encode and read far too bright
//      through the correct chain. Rebuilding Bayer dither and the BLOOD.PAL
//      snap as a TSL PostProcessing pipeline is its own follow-up, and it
//      should not gate parity.
//   2. An N-BODY SPAWNER ([ and ]) and a frame-time readout, carried over from
//      the spike. Extra bodies are static crowd fill — the rig, wounds,
//      severing and gibs all drive body zero. That is what makes the count
//      honest for a cost measurement: crowd cost, not feature cost.

// From 'three/webgpu', never 'three'. Two copies of three means the node
// system cannot see the lights and every standard material renders black.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createZombieGpuView, createChunkGpuView, type ChunkGpuView } from './zombie-gpu';
import { translateBody } from '../translate';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import {
  FLESH_PRESETS, LIGHT_PRESETS,
  type FleshMaterial, type FleshPresetName, type LightPresetName,
} from '../material';
import {
  MAX_WOUNDS, pushWound, woundWorldPos, worldHitToWound,
  type Wound, type WoundType,
} from '../damage';
import { sdBody } from '../validate';
import { severLimb, gibAll } from '../sever';
import { bindRig, applyRig, impulseAt } from '../rig-bind';
import { stepRig } from '../rig';
import { makeChunk, stepChunk, type Chunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { simplifyBody } from '../simplify';
import {
  LOD_LEVELS, LOD_LEVERS, pickLodSticky, screenHeightPx,
  type LodLevel, type LodLever,
} from '../lod';
import type { LimbId, Vec3 } from '../types';
import {
  addButton, addSection, addSelect, addSlider, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS, FACE_SLIDERS,
} from '../panel';

// ---------------------------------------------------------------------------
// Face texture sheets. Same three sources as the WebGL lab, same crop rects.
//
// - `zombie-flat` is ORIGINAL art and the shipping candidate: a luminance MASK
//   on neutral mid-grey rather than a picture, so mid-grey divided by the mean
//   comes out at 1.0 and only the features act.
// - `smiley` is a DIAGNOSTIC — flat yellow, a red border on the projected
//   rect, a blue mark top-left. No baked lighting, no alpha, no crop ambiguity,
//   so a misregistration shows you exactly HOW it is wrong.
// - `blood-zombie` is extracted Blood art. DEV PLACEHOLDER, never ships.
//
// `rect` is in TOP-LEFT pixel coordinates: [x, y, w, h, sheetW, sheetH].
// `mean` is MEASURED off the file — it sets the level the multiplier divides
// out, so a stale value shifts the whole head's brightness.
// ---------------------------------------------------------------------------
type FaceTexName = 'zombie-flat' | 'smiley' | 'blood-zombie';

const FACE_TEXTURES: Record<
  FaceTexName,
  { url: string; rect: [number, number, number, number, number, number]; mean: number }
> = {
  'zombie-flat': { url: '/assets/lab/zombie-face.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.406 },
  smiley: { url: '/assets/lab/smiley.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.66 },
  'blood-zombie': {
    url: '/assets/blood-tiles/1200.png',
    rect: [32, 0, 18, 16, 77, 116],
    mean: 0.33,
  },
};

const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };
const RADIUS: Record<WoundType, number> = { pellet: 0.055, blast: 0.13, burn: 0.08 };

/** Chunks are disposed oldest-first past this, so a long session can't leak. */
const MAX_CHUNKS = 24;

// Everything lives inside an async bootstrap rather than using top-level await.
// WebGPURenderer needs `await renderer.init()`, and the project's build target
// predates top-level await.
async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');

  const handle = await createLabRenderer(mount);
  const { scene, camera } = handle;

  // Ground plane and a reference cube, so the raymarched blobs have polygonal
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

  let override = loadOverride();
  const face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
  const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);

  const errorsEl = document.getElementById('errors');
  function showErrors(b: BuildResult) {
    if (errorsEl) errorsEl.textContent = b.errors.join('\n');
  }
  showErrors(body);

  // Panel readouts are built FIRST, before setRenderCallback: the animation
  // loop is already running by the time createLabRenderer resolves, so a frame
  // can fire the moment the callback is installed and would hit these in their
  // temporal dead zone if they were declared alongside the rest of the panel.
  const panelEl = document.getElementById('panel')!;
  const statusBox = addSection(panelEl, 'renderer');
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
  countEl.textContent = 'bodies: 1';
  statusBox.appendChild(countEl);
  const fpsEl = document.createElement('div');
  fpsEl.style.fontSize = '11px';
  statusBox.appendChild(fpsEl);
  const gpuEl = document.createElement('div');
  gpuEl.style.fontSize = '11px';
  gpuEl.style.color = '#9cf';
  statusBox.appendChild(gpuEl);

  let flesh: FleshMaterial = { ...FLESH_PRESETS['henenlotter-latex'] };
  let light: LightPresetName = 'practical-hard-key';

  const view = createZombieGpuView(body);
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
  scene.add(view.object);
  const u = view.uniforms;

  /**
   * Crowd fill. Declared here, ahead of everything that touches it, because a
   * face-sheet swap has to reach these too — see loadFaceTexture. Populated by
   * setCrowdCount further down.
   */
  const crowd: ReturnType<typeof createZombieGpuView>[] = [];

  // -------------------------------------------------------------------------
  // LOD
  //
  // Every lever except AO is expressed by driving a uniform that already
  // existed to zero, which the shader branches on. That keeps the LOD system
  // from becoming a second source of truth about what the shader does.
  //
  // `full` is the reference: the quality the lab had before LOD existed. It is
  // what `lod: off` restores, and what each per-lever override is measured
  // against, so a measurement never compares against a moving baseline.
  // -------------------------------------------------------------------------
  const FULL_QUALITY: LodLevel = {
    name: 'full',
    minScreenPx: 0,
    steps: 96,
    simplify: false,
    silhouetteNoise: true,
    surfaceNoise: true,
    scatter: true,
    ao: true,
    face: true,
    wounds: true,
  };

  let lodEnabled = true;
  /**
   * Per-lever overrides, for measuring one thing at a time. `null` means "let
   * LOD decide"; true/false force it on every body regardless of distance.
   */
  const lodOverride: Partial<Record<LodLever, boolean | null>> = {};
  /** Forces the march step count on every body. null = let LOD decide. */
  let stepsOverride: number | null = null;
  /**
   * Forces the coarse-body swap. Separate from `lodOverride` because every
   * entry there is a quality flag where true means "better", and `simplify` is
   * the one lever where true means "cheaper" — folding it in would break the
   * monotonicity the LOD table is checked against.
   */
  let simplifyOverride: boolean | null = null;
  /** Last level chosen per body, so pickLodSticky has something to stick to. */
  const lastLevel = new WeakMap<object, number>();
  /** Last set of uniform values applied, so unchanged frames write nothing. */
  const lastSig = new WeakMap<object, string>();

  /** The world-space centre of a body's proxy, which is what distance means here. */
  const bodyCentre = new THREE.Vector3();
  const drawSize = new THREE.Vector2();

  /** World height of a view's proxy box, which is the body's own height. */
  function boxHeight(o: THREE.Object3D): number {
    const geo = (o as THREE.Mesh).geometry as THREE.BoxGeometry | undefined;
    const h = geo?.parameters?.height ?? 1.8;
    return h * o.scale.y;
  }

  /** The panel's face-texture switch. LOD may turn the face off, never on. */
  let faceEnabled = true;

  /**
   * What each view currently has UPLOADED — detailed or coarse — plus the
   * source bodies to swap between.
   *
   * Swapping is a re-pack and a texture upload, so it must happen on the frame
   * the level CHANGES and not on every frame at that level. Keyed by object
   * rather than held on the view so LOD stays a lab concern.
   */
  const bodySource = new WeakMap<
    object, { detailed: BuildResult; coarse: BuildResult; usingCoarse: boolean }
  >();

  /** Registers a view's bodies, and builds its coarse stand-in once. */
  function trackBody(v: ReturnType<typeof createZombieGpuView>, b: BuildResult) {
    bodySource.set(v.object, {
      detailed: b, coarse: simplifyBody(b), usingCoarse: false,
    });
  }

  function applyLod(v: ReturnType<typeof createZombieGpuView>) {
    const vu = v.uniforms;
    let level: LodLevel;
    if (lodEnabled) {
      v.object.getWorldPosition(bodyCentre);
      const dist = bodyCentre.distanceTo(camera.position);
      // The proxy box's height IS the body's world height, and it shrinks when
      // limbs come off — so a torso-only body correctly counts as smaller.
      // Viewport height in DEVICE pixels, not CSS: the lab renders at 540 and
      // stretches, so CSS height would over-report detail by ~2x.
      const worldH = boxHeight(v.object);
      const px = screenHeightPx(worldH, dist, camera.fov, handle.renderer.getDrawingBufferSize(drawSize).y);
      const idx = pickLodSticky(px, lastLevel.get(v.object) ?? -1);
      lastLevel.set(v.object, idx);
      level = LOD_LEVELS[idx]!;
    } else {
      level = FULL_QUALITY;
    }

    const on = (k: LodLever) => {
      const o = lodOverride[k];
      return o === undefined || o === null ? (level[k] as boolean) : o;
    };

    // Wound suppression has to run every frame regardless: uploadWounds writes
    // the live count earlier in the same frame, so a cached skip would let a
    // suppressed level's wounds reappear.
    if (!on('wounds')) vu.woundCfg.value.x = 0;

    // Everything else is applied ONLY when the decision changes. Writing these
    // uniforms every frame for every body measurably COST time — the close-
    // packed 15-body case came out ~6% slower with LOD on than off, despite
    // LOD choosing full quality for every body, because each write dirties a
    // uniform buffer that then has to be re-uploaded.
    const sig = `${level.name}|${stepsOverride}|${simplifyOverride}|${faceEnabled}|` +
      LOD_LEVERS.map(k => (on(k) ? 1 : 0)).join('') +
      `|${flesh.silhouetteNoiseAmp},${flesh.surfaceNoiseAmp},${flesh.translucency}`;
    if (lastSig.get(v.object) === sig) return;
    lastSig.set(v.object, sig);

    vu.marchCfg.value.x = stepsOverride ?? level.steps;
    // Zero amplitude is what the shader branches on — see the LOD note on
    // MARCH_BODY. These read their "on" value back from the live material so
    // the panel sliders keep working while LOD is running.
    vu.marchCfg.value.z = on('silhouetteNoise') ? flesh.silhouetteNoiseAmp : 0;
    vu.surfCfg2.value.y = on('surfaceNoise') ? flesh.surfaceNoiseAmp : 0;
    vu.surfCfg.value.w = on('scatter') ? flesh.translucency : 0;
    vu.lodCfg.value.x = on('ao') ? 1 : 0;
    vu.faceCfg.value.x = on('face') && faceEnabled ? 1 : 0;
    // Body swap, only on the frame the decision CHANGES: it re-packs and
    // re-uploads the data texture, which is far too much to do every frame at
    // a steady level. The hero is exempt — it is rig-driven and re-uploaded
    // every frame anyway, and it is the body being looked at.
    const src = bodySource.get(v.object);
    const wantCoarse = v !== view
      && (simplifyOverride === null ? level.simplify : simplifyOverride);
    if (src && wantCoarse !== src.usingCoarse) {
      src.usingCoarse = wantCoarse;
      v.update(wantCoarse ? src.coarse : src.detailed);
    }
  }

  // -------------------------------------------------------------------------
  // Face texture
  // -------------------------------------------------------------------------
  /**
   * The one live face sheet, shared by the body and every crowd body. Kept
   * here rather than inside a view because the views do not own it: swapping
   * the sheet has to reach all of them, and only one of them may dispose it.
   */
  let faceSheet: { tex: THREE.Texture; atlas: THREE.Vector4; mean: number } | null = null;

  function loadFaceTexture(name: FaceTexName) {
    const def = FACE_TEXTURES[name];
    const tex = new THREE.TextureLoader().load(def.url);
    tex.magFilter = THREE.NearestFilter;   // chunky texels, not a blurry smear
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // Keep three's default flipY (true) so the top-left pixel rects above
    // convert with no arithmetic. three's WebGPU backend honours flipY at
    // upload just as the WebGL one does, and the WGSL side reads the sheet with
    // textureLoad, which indexes the same stored rows a GLSL sampler would —
    // so orientation matches the WebGL lab with no per-path fudge.
    tex.flipY = true;
    const [x, y, w, h, sheetW, sheetH] = def.rect;
    faceSheet?.tex.dispose();
    faceSheet = {
      tex,
      atlas: new THREE.Vector4(w / sheetW, h / sheetH, x / sheetW, y / sheetH),
      mean: def.mean,
    };
    for (const v of [view, ...crowd]) v.setFaceTexture(tex, faceSheet.atlas, def.mean);
  }

  let faceTexName: FaceTexName = 'zombie-flat';
  loadFaceTexture(faceTexName);
  u.faceCfg.value.x = 1;      // face on
  u.faceCfg.value.y = 1.0;    // strength
  // Baked projection: uv = hs * scale + centre, hs normalised PER AXIS by the
  // skull's semi-axes so these numbers survive a reproportioned head.
  u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);

  /**
   * The skull's centre and its three SEMI-AXES: the fattest additive primitive
   * in the head cluster, measured per axis.
   *
   * Not the head cluster's bounding sphere — that also encloses the neck
   * capsule, so normalising by it spills the texture over the shoulders. And
   * per-axis rather than one radius, because the head is an ellipsoid: with a
   * single radius whichever axis was largest landed on the head mask's cutoff
   * and the whole face vanished.
   */
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

  // -------------------------------------------------------------------------
  // Live state
  // -------------------------------------------------------------------------
  /** The live body — replaced on sever and on any override edit. */
  let current = body;
  let bound = bindRig(current);
  function rebind() { bound = bindRig(current); }

  let wounds: Wound[] = [];
  const chunks: { state: Chunk; view: ChunkGpuView }[] = [];

  /** Marches the CPU-side field along a ray to find where a shot lands. */
  function raycastBody(origin: Vec3, dir: Vec3): Vec3 | null {
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const d = sdBody(p, current);
      if (d < 0.002) return p;
      t += Math.max(d, 0.002);
    }
    return null;
  }

  function uploadWounds(prims: BuildResult['prims']) {
    view.setWounds(
      wounds.map(w => woundWorldPos(prims, w)),
      wounds.map(w => w.radius),
      wounds.map(w => TYPE_ID[w.type]),
      wounds.map(w => w.ageSec),
    );
  }
  function refreshWounds() { uploadWounds(current.prims); }

  // -------------------------------------------------------------------------
  // Crowd fill, for the LOD work that comes next. Extra bodies are STATIC —
  // no rig, no wounds — but they DO carry the face, because the face block is
  // real per-pixel cost and a crowd that skipped it would quietly under-report
  // what a real crowd costs. Body zero is the one the lab interacts with.
  //
  // Translate the FIELD, not the mesh: the shader marches in world space and
  // the packed primitives ARE the field, so object.position would move only the
  // proxy box and clip the body into slices.
  // -------------------------------------------------------------------------
  /**
   * How far apart crowd bodies stand, as a multiplier on the base grid.
   *
   * 1 is the shoulder-to-shoulder pack the renderer bench used: every body
   * large on screen and heavily overlapped, which is the LOD worst case
   * because nothing is small enough to demote. Larger values stretch the grid
   * back into something closer to a real encounter, where most of the crowd is
   * at a distance — which is the case LOD is actually for. Both numbers belong
   * in any perf claim; quoting only one of them would be picking a winner.
   */
  let crowdSpread = 1;

  function setCrowdCount(n: number) {
    while (crowd.length > n) {
      const v = crowd.pop();
      if (!v) break;
      scene.remove(v.object);
      v.dispose();
    }
    while (crowd.length < n) {
      const i = crowd.length + 1; // body zero is the interactive one
      const col = i % 5;
      const row = Math.floor(i / 5);
      const placed = translateBody(current,
        [(col - 2) * 0.62 * crowdSpread, 0, -row * 0.85 * crowdSpread]);
      const v = createZombieGpuView(placed);
      trackBody(v, placed);
      v.applyMaterial(flesh, LIGHT_PRESETS[light]);
      if (faceSheet) {
        v.setFaceTexture(faceSheet.tex, faceSheet.atlas, faceSheet.mean);
        v.uniforms.faceCfg.value.copy(u.faceCfg.value);
        v.uniforms.faceCfg2.value.copy(u.faceCfg2.value);
        v.uniforms.faceProj.value.copy(u.faceProj.value);
        // Static, so the skull's sphere is set once rather than re-derived from
        // a posed body every frame.
        const skull = headShape(placed);
        if (skull) v.setHeadShape(skull.centre, skull.axes);
      }
      scene.add(v.object);
      crowd.push(v);
    }
    countEl.textContent = `bodies: ${crowd.length + 1}`;
  }

  // -------------------------------------------------------------------------
  // Orbit camera. EITHER button drags to orbit; a left press that does not
  // travel far enough to count as a drag fires a shot instead.
  // -------------------------------------------------------------------------
  let camYaw = 0.35;
  let camPitch = 0.12;
  let camDist = 2.4;
  const camTarget = new THREE.Vector3(0, 1.05, 0);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  /** Cursor travel since pointerdown, in px. Under the threshold it was a click. */
  let dragTravel = 0;
  const DRAG_SLOP = 5;
  let autoSpin = true;

  const canvas = handle.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    autoSpin = false;
    if (e.button !== 0 && e.button !== 2) return;
    dragging = true;
    dragTravel = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    dragTravel += Math.hypot(dx, dy);
    if (dragTravel < DRAG_SLOP) return;
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

  // Shooting — left button only. Shift = blast, Alt = burn. Fires on pointerUP
  // because the same button also orbits: a press that travelled further than
  // DRAG_SLOP was a camera drag and must not also put a hole in the zombie.
  canvas.addEventListener('pointerup', (ev: PointerEvent) => {
    if (dragging) {
      dragging = false;
      canvas.releasePointerCapture(ev.pointerId);
    }
    if (ev.button !== 0 || dragTravel >= DRAG_SLOP) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;

    const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z]);
    if (!hit) return;

    const type: WoundType = ev.shiftKey ? 'blast' : ev.altKey ? 'burn' : 'pellet';
    wounds = pushWound(wounds, worldHitToWound(current.prims, hit, RADIUS[type], type), MAX_WOUNDS);
    // A hit shoves the nearest joint along the shot direction — the rest-pose
    // pull springs it back, so the limb visibly recoils and lags.
    const push = type === 'blast' ? 0.10 : 0.04;
    bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
    refreshWounds();
  });

  // -------------------------------------------------------------------------
  // Severing and gibs
  // -------------------------------------------------------------------------
  // 2 is deliberately absent — the torso must never sever.
  const SEVER_KEYS: Record<string, LimbId> = {
    '1': 'head', '3': 'armL', '4': 'armR', '5': 'legL', '6': 'legR',
  };

  /** The endpoint of `prims` nearest `toward` — i.e. where the limb tore away. */
  function attachPoint(prims: typeof current.prims, toward: Vec3): Vec3 {
    let best: Vec3 = prims[0]!.a;
    let bestD = Infinity;
    for (const p of prims)
      for (const e of [p.a, p.b]) {
        const dx = e[0] - toward[0], dy = e[1] - toward[1], dz = e[2] - toward[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = e; }
      }
    return best;
  }

  function torsoCentre(): Vec3 {
    return current.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0];
  }

  function spawnChunk(
    limb: LimbId, origin: Vec3, prims: typeof current.prims,
    vel?: Vec3, tornAt?: Vec3,
  ) {
    if (prims.length === 0) return;
    const v: Vec3 = vel ?? [
      (Math.random() - 0.5) * 3.2,
      1.8 + Math.random() * 2.2,
      (Math.random() - 0.5) * 3.2,
    ];
    // Collision radius = the limb's real visual extent; chunk.radius's 0.14 is
    // smaller than any limb and would bury it half-way into the floor.
    const state = makeChunk(limb, origin, v, chunkExtent(prims, origin));
    const chunkView = createChunkGpuView(state, prims, u, tornAt);
    scene.add(chunkView.object);
    chunks.push({ state, view: chunkView });

    while (chunks.length > MAX_CHUNKS) {
      const oldest = chunks.shift();
      if (!oldest) break;
      scene.remove(oldest.view.object);
      oldest.view.dispose();
    }
  }

  /** Blows the whole body apart — every live cluster becomes a chunk. */
  function gibEverything() {
    const centre = torsoCentre();
    const { body: next, chunks: groups } = gibAll(current);
    for (const g of groups) {
      // Radial launch from the body centre, so the pile spreads instead of
      // every piece going the same way.
      const dx = g.origin[0] - centre[0];
      const dy = g.origin[1] - centre[1];
      const dz = g.origin[2] - centre[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const speed = 2.4 + Math.random() * 2.0;
      const vel: Vec3 = [
        (dx / l) * speed + (Math.random() - 0.5) * 1.2,
        2.2 + Math.random() * 2.4,
        (dz / l) * speed + (Math.random() - 0.5) * 1.2,
      ];
      spawnChunk(g.limb, g.origin, g.prims, vel, attachPoint(g.prims, centre));
    }
    current = next;
    wounds = [];
    view.update(current);
    refreshWounds();
    rebind();
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === ']') { setCrowdCount(crowd.length + 1); return; }
    if (ev.key === '[') { setCrowdCount(Math.max(0, crowd.length - 1)); return; }
    if (ev.key === 'g' || ev.key === 'G') { gibEverything(); return; }
    const limb = SEVER_KEYS[ev.key];
    if (!limb) return;
    const { body: next, chunk, stumpWound } = severLimb(current, limb);
    if (chunk.prims.length === 0) return;
    current = next;
    if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
    spawnChunk(limb, chunk.origin, chunk.prims, undefined, attachPoint(chunk.prims, torsoCentre()));
    view.update(current);
    refreshWounds();
    rebind();
  });

  // -------------------------------------------------------------------------
  // Frame loop. setRenderCallback REPLACES rather than appends, so everything
  // per-frame has to live in this one function.
  // -------------------------------------------------------------------------
  const frames: number[] = [];
  // GPU times are sampled from a resolve that lands every few frames, so this
  // window covers a longer stretch of wall clock than `frames` does.
  const gpuTimes: number[] = [];
  let lastStamp = performance.now();

  /** Median of a sample window. The stat to quote — one hitch cannot swing it. */
  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.5)]!;
  }

  handle.setRenderCallback((dt) => {
    const now = performance.now();
    frames.push(now - lastStamp);
    lastStamp = now;
    if (frames.length > 120) frames.shift();
    if (frames.length > 20) {
      const s = [...frames].sort((a, b) => a - b);
      const med = s[Math.floor(s.length * 0.5)]!;
      const p95 = s[Math.floor(s.length * 0.95)]!;
      fpsEl.textContent =
        `cpu+gpu ${med.toFixed(1)} / ${p95.toFixed(1)} ms  (${(1000 / med).toFixed(0)} fps)`;
    }

    // The number LOD is judged on. Wall clock pins to the vsync interval the
    // moment there is any headroom, so it cannot tell a 2x win from "still
    // 60fps"; GPU pass time keeps counting down past the knee.
    const g = handle.gpuMs();
    if (g !== null && g > 0) {
      gpuTimes.push(g);
      if (gpuTimes.length > 90) gpuTimes.shift();
      gpuEl.textContent = `gpu ${median(gpuTimes).toFixed(2)} ms`;
    } else if (gpuTimes.length === 0) {
      gpuEl.textContent = 'gpu: no timestamp query';
    }

    // Gib physics: step every chunk, then re-pack its world-space field.
    for (const c of chunks) {
      c.state = stepChunk(c.state, dt);
      c.view.update(c.state);
    }

    // Drive the flesh: settle the rig toward its rest pose, push the result
    // back into the primitives, and re-upload. This is what makes the body
    // deform — and what makes rest-space wounds observable, since they ride it.
    bound = {
      ...bound,
      rig: stepRig(bound.rig, Math.min(dt, 1 / 30), {
        gravity: [0, -2.2, 0],
        damping: 0.06,
        iterations: 4,
        restStiffness: 0.18,
      }),
    };
    const posed = applyRig(current, bound);
    view.update(posed);
    view.setTime(performance.now() / 1000);
    // Re-derive the skull's sphere from the POSED primitives so the face
    // projection tracks the head through the jiggle.
    const skull = headShape(posed);
    if (skull) view.setHeadShape(skull.centre, skull.axes);
    uploadWounds(posed.prims);

    if (autoSpin) camYaw += dt * 0.35;
    const cp = Math.cos(camPitch);
    camera.position.set(
      camTarget.x + Math.sin(camYaw) * cp * camDist,
      camTarget.y + Math.sin(camPitch) * camDist,
      camTarget.z + Math.cos(camYaw) * cp * camDist,
    );
    camera.lookAt(camTarget);

    // LOD last: the camera has just moved, and every lever it drives is a
    // uniform the steps above may have written. Running it earlier would pick
    // levels against the previous frame's camera and then get overwritten.
    applyLod(view);
    for (const v of crowd) applyLod(v);
  });

  // -------------------------------------------------------------------------
  // Tuning panel
  // -------------------------------------------------------------------------
  function reapply() {
    view.applyMaterial(flesh, LIGHT_PRESETS[light]);
    for (const v of crowd) v.applyMaterial(flesh, LIGHT_PRESETS[light]);
  }

  function rebuildBody() {
    override = { ...override, faceParams: face };
    saveOverride(override);
    current = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
    showErrors(current);
    view.update(current);
    refreshWounds();
    rebind();
  }

  const presetBox = addSection(panelEl, 'presets');
  addSelect(presetBox, 'flesh', Object.keys(FLESH_PRESETS), 'henenlotter-latex', (v) => {
    flesh = { ...FLESH_PRESETS[v as FleshPresetName] };
    reapply();
    rebuildMaterialSliders();
  });
  addSelect(presetBox, 'light', Object.keys(LIGHT_PRESETS), light, (v) => {
    light = v as LightPresetName;
    reapply();
  });

  const matBox = addSection(panelEl, 'material');
  function rebuildMaterialSliders() {
    matBox.textContent = '';
    for (const s of MATERIAL_SLIDERS)
      addSlider(matBox, {
        label: s.key, min: s.min, max: s.max, step: 0.005,
        get: () => flesh[s.key] as number,
        set: (v) => { (flesh[s.key] as number) = v; reapply(); },
      });
  }
  rebuildMaterialSliders();

  const bodyBox = addSection(panelEl, 'body');
  addSlider(bodyBox, {
    label: 'global blendK', min: 0.004, max: 0.05, step: 0.001,
    get: () => current.prims[0]?.blendK ?? 0.012,
    set: (v) => {
      override = { ...override, primBlendK: Object.fromEntries(current.prims.map((_, i) => [i, v])) };
      rebuildBody();
    },
  });
  addSlider(bodyBox, {
    // Forces the count on every body, LOD included — otherwise applyLod would
    // overwrite the slider on the very next frame.
    label: 'march steps (0 = lod)', min: 0, max: 192, step: 1,
    get: () => stepsOverride ?? 0,
    set: (v) => { stepsOverride = v > 0 ? v : null; },
  });

  // Face. Sliders regenerate the face primitives and rebuild the body, so a
  // param change alters which primitives exist rather than just their values.
  const faceBox = addSection(panelEl, 'face');
  for (const s of FACE_SLIDERS)
    addSlider(faceBox, {
      label: s.key, min: s.min, max: s.max, step: 0.001,
      get: () => face[s.key],
      set: (v) => { (face[s.key] as number) = v; rebuildBody(); },
    });

  addSelect(faceBox, 'texture', Object.keys(FACE_TEXTURES), faceTexName, (v) => {
    faceTexName = v as FaceTexName;
    loadFaceTexture(faceTexName);
  });
  const texBtn = addButton(faceBox, 'face tex: on', () => {
    // Goes through faceEnabled rather than the uniform, because applyLod
    // rewrites faceCfg.x every frame and would undo a direct poke.
    faceEnabled = !faceEnabled;
    texBtn.textContent = `face tex: ${faceEnabled ? 'on' : 'off'}`;
  });

  // Alignment. The projection is planar in head space, so these four numbers
  // are how the texture gets registered onto the skull.
  addSlider(faceBox, {
    label: 'eyeGlow', min: 0, max: 6, step: 0.05,
    get: () => u.faceCfg2.value.w, set: (v) => { u.faceCfg2.value.w = v; },
  });
  addSlider(faceBox, {
    // Which pixels count as eyes. Lower catches more of the sheet, so teeth and
    // highlights start glowing too.
    label: 'eyeGlowCut', min: 0.3, max: 1, step: 0.01,
    get: () => u.faceCfg2.value.z, set: (v) => { u.faceCfg2.value.z = v; },
  });
  addSlider(faceBox, {
    label: 'texRelief', min: 0, max: 5, step: 0.05,
    get: () => u.faceCfg.value.w, set: (v) => { u.faceCfg.value.w = v; },
  });
  addSlider(faceBox, {
    label: 'texStrength', min: 0, max: 1, step: 0.01,
    get: () => u.faceCfg.value.y, set: (v) => { u.faceCfg.value.y = v; },
  });
  addSlider(faceBox, {
    label: 'texScaleX', min: 0.4, max: 2.5, step: 0.01,
    get: () => u.faceProj.value.x, set: (v) => { u.faceProj.value.x = v; },
  });
  addSlider(faceBox, {
    label: 'texScaleY', min: 0.4, max: 2.5, step: 0.01,
    get: () => u.faceProj.value.y, set: (v) => { u.faceProj.value.y = v; },
  });
  addSlider(faceBox, {
    label: 'texCentreY', min: 0.2, max: 0.9, step: 0.01,
    get: () => u.faceProj.value.w, set: (v) => { u.faceProj.value.w = v; },
  });
  // Spherical spreads longitude evenly round the skull, so it needs a wider
  // scale than planar to put the face in the same place — swap the scales with
  // the mode rather than making you retune by hand.
  const projBtn = addButton(faceBox, 'proj: planar', () => {
    const spherical = u.faceCfg2.value.x < 0.5;
    u.faceCfg2.value.x = spherical ? 1 : 0;
    u.faceProj.value.set(spherical ? 1.35 : 0.45, spherical ? 1.05 : 0.58, 0.5, spherical ? 0.5 : 0.56);
    projBtn.textContent = `proj: ${spherical ? 'spherical' : 'planar'}`;
  });
  addButton(faceBox, 'flip facing', () => { u.faceCfg.value.z = -u.faceCfg.value.z; });

  /** Locked three-quarter close-up on the skull, so face work needs no orbiting. */
  function focusHead() {
    const skull = current.bones.get('skull');
    autoSpin = false;
    camTarget.set(0, skull ? (skull.head[1] + skull.tail[1]) / 2 : 1.55, 0);
    camYaw = 0.62;
    camPitch = 0.06;
    camDist = 0.52;
  }
  function focusBody() {
    autoSpin = false;
    camTarget.set(0, 1.05, 0);
    camYaw = 0.35;
    camPitch = 0.12;
    camDist = 2.4;
  }
  addButton(faceBox, 'focus head', focusHead);
  addButton(faceBox, 'focus body', focusBody);

  // Crater shape. Kept out of FleshMaterial because these describe damage
  // GEOMETRY, not the surface — they change the field, not the shading.
  const dmgBox = addSection(panelEl, 'damage');
  for (const [get, set, label, min, max] of [
    [() => u.woundCfg.value.y, (v: number) => { u.woundCfg.value.y = v; }, 'wound blendK', 0.002, 0.06],
    [() => u.woundCfg.value.z, (v: number) => { u.woundCfg.value.z = v; }, 'rim splay', 0, 1.5],
    [() => u.woundCfg.value.w, (v: number) => { u.woundCfg.value.w = v; }, 'rim offset', 0.8, 2.0],
    [() => u.woundCfg2.value.x, (v: number) => { u.woundCfg2.value.x = v; }, 'rim width', 0.15, 1.2],
  ] as [() => number, (v: number) => void, string, number, number][])
    addSlider(dmgBox, { label, min, max, step: 0.005, get, set });

  // LOD. The overrides exist so each lever can be measured ALONE against the
  // same full-quality baseline — a lever measured while another is already off
  // reports the wrong number, and these are close enough in cost to matter.
  const lodBox = addSection(panelEl, 'lod');
  const lodBtn = addButton(lodBox, 'lod: on', () => {
    lodEnabled = !lodEnabled;
    lodBtn.textContent = `lod: ${lodEnabled ? 'on' : 'off'}`;
  });
  for (const k of LOD_LEVERS) {
    const btn = addButton(lodBox, `${k}: auto`, () => {
      // auto -> forced off -> forced on -> auto
      const cur = lodOverride[k];
      lodOverride[k] = cur === undefined || cur === null ? false : cur === false ? true : null;
      const label = lodOverride[k] === null || lodOverride[k] === undefined
        ? 'auto' : lodOverride[k] ? 'ON' : 'OFF';
      btn.textContent = `${k}: ${label}`;
    });
  }

  const simpBtn = addButton(lodBox, 'simplify: auto', () => {
    simplifyOverride = simplifyOverride === null ? true : simplifyOverride ? false : null;
    simpBtn.textContent =
      `simplify: ${simplifyOverride === null ? 'auto' : simplifyOverride ? 'ON' : 'OFF'}`;
  });

  const actionBox = addSection(panelEl, 'actions');
  addButton(actionBox, 'respawn', () => {
    wounds = [];
    override = loadOverride();
    rebuildBody();
  });
  addButton(actionBox, 'copy override JSON', () => {
    void navigator.clipboard.writeText(serializeOverride(override));
  });
  addButton(actionBox, 'reset overrides', () => {
    clearOverride();
    override = {};
    rebuildBody();
  });

  reapply();

  // Dev handle for inspecting lab state from the console, and for driving the
  // camera during automated visual checks. Lab-only; nothing in the game reads it.
  (window as unknown as { __sdfLab: unknown }).__sdfLab = {
    backend: handle.backend,
    /**
     * The renderer, scene and camera — enough to call
     * `renderer.debug.getShaderAsync(scene, camera, mesh)` and read the WGSL
     * three actually generated. That is the only way to see what the node
     * pipeline wrapped around the march, output colour-space encode included.
     */
    renderer: handle.renderer,
    scene,
    camera,
    body: view.object,
    get wounds() { return wounds; },
    get current() { return current; },
    get chunkCount() { return chunks.length; },
    get bodyCount() { return crowd.length + 1; },
    /** The march uniforms — lets any of them be tuned live from the console. */
    uniforms: u,
    setCrowdCount,
    gibEverything,
    focusHead,
    focusBody,
    /**
     * Median/p95 wall-clock frame time and median GPU pass time, in ms.
     *
     * Quote `gpu` for anything perf-related: wall clock pins to vsync as soon
     * as there is headroom, so below ~16 ms it stops measuring the renderer.
     */
    stats() {
      const s = [...frames].sort((a, b) => a - b);
      return s.length < 20 ? null : {
        median: +s[Math.floor(s.length * 0.5)]!.toFixed(2),
        p95: +s[Math.floor(s.length * 0.95)]!.toFixed(2),
        gpu: gpuTimes.length ? +median(gpuTimes).toFixed(2) : null,
        gpuSamples: gpuTimes.length,
        bodies: crowd.length + 1,
      };
    },
    /** Drops both sample windows, so a reading cannot include the old setting. */
    resetStats() { frames.length = 0; gpuTimes.length = 0; },
    setLodEnabled(on: boolean) { lodEnabled = on; },
    /** null = let LOD decide; true/false force the lever on every body. */
    setOverride(k: LodLever, v: boolean | null) { lodOverride[k] = v; },
    setStepsOverride(v: number | null) { stepsOverride = v; },
    /** Sphere-trace step multiplier on every body. Default 0.6. */
    setStepMul(v: number) { for (const x of [view, ...crowd]) x.uniforms.marchCfg.value.y = v; },
    setSimplifyOverride(v: boolean | null) { simplifyOverride = v; },
    /** Re-spawns the crowd at a new spacing. 1 = shoulder to shoulder. */
    setCrowdSpread(v: number) {
      const n = crowd.length;
      setCrowdCount(0);
      crowdSpread = v;
      setCrowdCount(n);
    },
    clearOverrides() { for (const k of Object.keys(lodOverride)) delete lodOverride[k as LodLever]; },
    get lodLevels() {
      return [view, ...crowd].map(v => lastLevel.get(v.object) ?? -1);
    },
    setCam(yaw: number, pitch: number, dist: number) {
      autoSpin = false;
      camYaw = yaw;
      camPitch = pitch;
      camDist = dist;
    },
  };
}

// A rejected bootstrap would otherwise be an unhandled promise and the page
// would just sit blank — the failure mode this project has lost the most time to.
main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  console.error('[sdf-lab-webgpu] bootstrap failed', err);
});
