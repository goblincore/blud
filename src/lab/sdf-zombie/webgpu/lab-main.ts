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
//      the spike. Since the crowd-alive task every body is a live actor: own
//      motion record, own rig solve, own pose, all through actor.ts's
//      stepActorMotion. Body zero remains the one shots, severing and gibs
//      address; the crowd idles/walks in small seeded wander boxes with a
//      fixed per-frame dt so poses are deterministic for A/B measurement.

// From 'three/webgpu', never 'three'. Two copies of three means the node
// system cannot see the lights and every standard material renders black.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER } from './sdf-layer';
import { loadKit } from './kit-overlay';
import { createPostAa, POST_AA_SMEAR_MAX } from './post-aa';
import {
  createZombieGpuView, createChunkGpuView, createSharedChunkGpuMaterial,
  type ChunkGpuView,
} from './zombie-gpu';
import { createOccluderHull } from './occluder-hull';
import { translateBody } from '../translate';
import { buildBody, DEFAULT_BUILD_OPTS, type BodyOverride, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import goblinBlobSrc from '../characters/goblin.blob?raw';
import clownBlobSrc from '../characters/clown.blob?raw';
import clownAltBlobSrc from '../characters/clown-alt.blob?raw';
import mouseBlobSrc from '../characters/mouse.blob?raw';
import cyclopsBlobSrc from '../characters/cyclops.blob?raw';
import schoolgirlBlobSrc from '../characters/schoolgirl.blob?raw';
import schoolgirlAltBlobSrc from '../characters/schoolgirl-alt.blob?raw';
import bonewalkerBlobSrc from '../characters/bonewalker.blob?raw';
import dragonBlobSrc from '../characters/dragon.blob?raw';
import boxFixtureBlobSrc from '../characters/box-fixture.blob?raw';

/**
 * Every authored .blob character, by the name you pass as `?character=`.
 *
 * The lab hardcoded zombie.blob until the first port (goblin) had nowhere to be
 * looked at — and a character you cannot see is one you cannot judge, which is
 * the whole reason the turntable exists. Unknown or absent falls back to the
 * zombie rather than erroring, so a bad URL never blanks the lab.
 */
const CHARACTERS: Record<string, string> = {
  zombie: zombieBlobSrc,
  goblin: goblinBlobSrc,
  clown: clownBlobSrc,
  'clown-alt': clownAltBlobSrc,
  mouse: mouseBlobSrc,
  cyclops: cyclopsBlobSrc,
  schoolgirl: schoolgirlBlobSrc,
  'schoolgirl-alt': schoolgirlAltBlobSrc,
  bonewalker: bonewalkerBlobSrc,
  dragon: dragonBlobSrc,
  'box-fixture': boxFixtureBlobSrc,
};

/**
 * The POLYGON kit for a character, if it has one — armour, clothing and hard
 * props authored in a sibling `.wam` and compiled to a self-contained glTF.
 * Absent means flesh only, which is every character but the goblin today.
 *
 * See kit-overlay.ts for what this does and does not do yet: the kit is placed
 * once at the body root and does NOT follow the rig, so it is only honest with
 * motion frozen.
 */
const KITS: Record<string, string> = {
  goblin: '/assets/lab/goblin-kit.gltf',
  clown: '/assets/lab/clown-kit.gltf',
  'clown-alt': '/assets/lab/clown-alt-kit.gltf',
  // No mouse: its whole outfit is painted SDF geometry (color= on prims).
};

function activeCharacterName(): string {
  const want = new URLSearchParams(location.search).get('character');
  return want && want in CHARACTERS ? want : 'zombie';
}

function activeCharacterSrc(): string {
  const want = new URLSearchParams(location.search).get('character');
  if (want && !(want in CHARACTERS))
    console.warn(`[blob] unknown character "${want}", using zombie. Known: ${Object.keys(CHARACTERS).join(', ')}`);
  return (want && CHARACTERS[want]) || zombieBlobSrc;
}
import { parseBlob } from '../blob-parse';
import { generateFaceSheet } from '../blob-face-sheet';
import { checkStance } from '../blob-checks';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
import { BlobError } from '../blob-ast';
import {
  DEFAULT_FACE, FACE_PRESETS, pickFace, type FaceParams,
} from '../face';
import {
  FLESH_PRESETS, LIGHT_PRESETS,
  type FleshMaterial, type FleshPresetName, type LightPresetName,
} from '../material';
import {
  MAX_WOUNDS, pushWound, woundWorldPos, worldHitToWound, WOUND_PROFILES,
  type Wound, type WoundType,
} from '../damage';
import { sdBody } from '../validate';
import { severLimb, severDistal, gibAll, gibAllPieces } from '../sever';
import { TileBinner } from './tile-cull';
import { createComputeTileBinding } from './tile-bin-compute';
import { makeGobs } from '../gobs';
import { createBloodSim, burst, emitTrails, stepBlood, addScraps } from '../blood-sim';
import { createBloodView } from './blood-view-gpu';
import { createGooLayer } from './goo-layer';
import { cutChains, cutLimbs } from '../connectivity';
import { bindRig, applyRig, impulseAt, headQuatOf } from '../rig-bind';
import { stepRig } from '../rig';
import { relaxRopeConstraints, type MissingLimbs } from '../collapse';
import { applyMelt, meltInitBody, stepMelt, type MeltState } from '../melt';
import {
  applyFloorContact, makeMotionJoints, makeMotionState, MOTION_TUNING,
  planSubSteps, STANDING_RIG, stepMotion,
  type MotionJoints, type MotionSignals,
} from '../motion';
import {
  CROWD_DT, crowdSeed, crowdRng, emptyActorSignals,
  makeActorMotion, stepActorMotion,
  type ActorMotion, type ActorSignals,
} from '../actor';
import { GAIT_TUNING, type ArmStyle } from '../gait';
import { makeRng, type Rng, type WanderBounds } from '../wander';
import { add } from '../vec';
import { makeChunk, stepChunk, type Chunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { simplifyBody } from '../simplify';
import { CIG_EMBER_HOT, STICK_IN_HAND, buildHandPrims } from '../hands';
import {
  EMPTY_FPV_INPUT, clipBundlePresented, enterFpvMode, exitFpvMode, forceThrow,
  handFieldFrame, handPropPoses, handPoseTargets, handPrimsToWorld,
  handReleaseVelocity, handSheetProjections, makeFpvMode, makeHandFieldUi,
  posedHandPrims, releasePendingThrow, requestHandField, settleHandClip,
  settleStaticHandVolume, splitHandWounds, stepFpvMode,
  type FpvGorePort, type FpvModeState, type HandFieldMode, type HandFieldUi,
} from '../fpv-mode';
import { cookCharge, throwOrigin } from '../fpv';
import {
  HAND_SHEET_TUNING, createBurstLayer, createCigaretteProp, createHandsGpuView,
  createStickProp,
} from './fpv-view';
import { loadBakedHandSheets, proceduralHandSheets } from './hands-sheet';
import { loadHandVolume, type HandVolume } from './hand-volume';
import { gripFrameSample, loadHandClip, type DynamitePropContract, type HandClipVolume } from './hand-volume-clip';
import { loadDynamiteProp, type DynamiteProp } from './dynamite-prop';
import {
  applyGripMotion, bakedDynamitePose, bakedHandPose,
  type BakedHandPose, type BakedPropPose,
} from '../hand-volume-pose';
import {
  gripCameraQuaternion, makeGripMotion, stepGripMotion, type GripMotionState,
} from '../hand-grip-clip';
import {
  initialAdaptiveState, scaleForRung, stepAdaptive,
} from '../adaptive-scale';
import {
  LOD_LEVELS, LOD_LEVERS, pickLodSticky, screenHeightPx,
  type LodLevel, type LodLever,
} from '../lod';
import type { BodyDef, LimbId, Vec3 } from '../types';
import {
  addButton, addSection, addSelect, addSlider, applyDebugPanelVisibility, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS, FACE_SLIDERS,
} from '../panel';
import { createEnclosure, type WallKey } from './enclosure';

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

/** Chunk mesh/render-object slots are recycled oldest-first at this cap.
 *  A per-prim gib is ~15 pieces, so 40 lets two full gibs coexist. */
const MAX_CHUNKS = 40;

// ---------------------------------------------------------------------------
// zombie.blob wiring
//
// The zombie is authored in zombie.blob now; makeZombie() in body.ts stays
// only as the frozen reference the anchor test (zombie-blob.test.ts) pins
// the language against. Every place in this file that used to call
// makeZombie() directly — the initial body, the crowd spawner, and
// rebuildBody()'s panel-driven rebuild — goes through buildZombieBody()
// below instead, so all three render the same document and none of them can
// silently drift back to the TS body.
//
// Logged once per failure kind so a spammy [ crowd-spawn doesn't flood the
// console with the same BlobError fifteen times.
let blobCompileWarned = false;

/**
 * Parses and compiles zombie.blob for the given face, or null if the
 * document is broken. Never throws: a bad .blob must not blank the lab.
 * Sets `lastBlobCompileError` as a side effect so callers can surface the
 * failure on-screen instead of only in the console — a silent fallback
 * would hide exactly the typed BlobError this format exists to catch.
 *
 * `compileFace(doc)` is called explicitly rather than left to compileBlob's
 * default parameter. compileBlob's signature is
 * `(doc, face = compileFace(doc))` — a default that only fires when the
 * CALLER omits the argument. This function always supplies an explicit
 * `face` (DEFAULT_FACE merged with the panel's live overrides, computed by
 * the caller), so relying on that default here would mean compileFace(doc)
 * — and with it every bit of validation against zombie.blob's OWN `face`
 * block, including the unknown-key check this format exists to give — never
 * runs at all. The panel override still wins for the values actually
 * rendered (unchanged from before this format existed); this call exists
 * purely so a typo in zombie.blob's face section is caught instead of
 * silently compiling with the panel's values and no diagnostic.
 */
let lastBlobCompileError: string | null = null;
let lastBlobStance: 'humanoid' | 'digitigrade' | null = null;
/**
 * The character's own flesh material, if it declared a `palette` block, so the
 * lab can dress the body in it instead of the panel's default preset. Recorded
 * here rather than re-parsed at the call site for the same reason
 * `lastBlobStance` is: `compileZombie` already has the parsed document, and a
 * second parse is a second place for the two to disagree about which character
 * is loaded. Null means "no palette declared" — wear the panel's preset, which
 * is what every character did before palettes existed.
 */
let lastBlobPalette: FleshMaterial | null = null;
function compileZombie(face: FaceParams): BodyDef | null {
  try {
    const doc = parseBlob(activeCharacterSrc());
    lastBlobStance = doc.stance;
    compileFace(doc); // validates zombie.blob's face block; return value unused, see above
    lastBlobPalette = compilePalette(doc);
    const compiled = compileBlob(doc, face);
    lastBlobCompileError = null;
    return compiled;
  } catch (e) {
    const msg = e instanceof BlobError ? e.message : e instanceof Error ? e.message : String(e);
    lastBlobCompileError = msg;
    // Clear the palette too: the fallback body is the TS zombie, and dressing
    // it in a half-parsed character's colours would make a compile error look
    // like a rendering bug instead of the missing character it is.
    lastBlobPalette = null;
    if (!blobCompileWarned) {
      blobCompileWarned = true;
      console.error('[blob] zombie.blob failed to compile, falling back to the TS zombie', e);
    }
    return null;
  }
}

/**
 * Builds a zombie body from zombie.blob, falling back to makeZombie(face)
 * (the pinned TS reference) if the document fails to compile. The single
 * seam used by the initial body, the crowd spawner, and rebuildBody() — see
 * the comment above compileZombie().
 */
function buildZombieBody(face: FaceParams, opts: BodyOverride): BuildResult {
  const compiled = compileZombie(face);
  const result = buildBody(compiled ?? makeZombie(face), DEFAULT_BUILD_OPTS, opts);
  // Declared-vs-actual knee fold. Surfaced next to validateBody's own errors
  // because it is the same kind of finding — something the author almost
  // certainly did not mean — and because a backward knee is otherwise
  // invisible to every geometric check: it is perfectly closed, connected and
  // non-interpenetrating.
  if (compiled && lastBlobStance)
    result.errors = [...checkStance(result.bones, lastBlobStance), ...result.errors];
  if (lastBlobCompileError) {
    result.errors = [
      `zombie.blob failed to compile, rendering the fallback TS zombie: ${lastBlobCompileError}`,
      ...result.errors,
    ];
  }
  return result;
}

// Everything lives inside an async bootstrap rather than using top-level await.
// WebGPURenderer needs `await renderer.init()`, and the project's build target
// predates top-level await.
async function main() {
  // BOOT TIMING. The lab has been slow to become interactive for a while and
  // the cause was guessed at more than once, so it is measured here instead.
  // Times are ms since navigation start, NOT since main() entry, because what
  // matters is when the user sees something — and nothing paints at all until
  // main() returns, which was itself the surprise. Read it from the console
  // as `__sdfLab.boot`.
  const bootMark = (): number => performance.now();
  const boot: Record<string, number> = { mainStart: bootMark() };

  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');

  const handle = await createLabRenderer(mount);
  boot.rendererReady = bootMark();
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

  // Bounce spike enclosure (lighting P1). Same category of object as the
  // reference cube above — something to look at, not a room format. Hidden
  // until the panel switches it on.
  const enclosure = createEnclosure();
  scene.add(enclosure.group);

  let override = loadOverride(activeCharacterName());
  // Seed the face from the character's OWN `face` block (compileFace parses the
  // .blob), so a .blob-authored head renders at the size its author declared.
  // Before this, every character built from `{ ...DEFAULT_FACE, ...override }`
  // and the .blob's headRadius/headWidth were silently ignored at render time —
  // the clown's 0.235 x 1.18 ball rendered as the 0.118 x 0.76 DEFAULT_FACE
  // skull, which is why the kit cap (built for 0.235) dwarfed it. The panel
  // override still wins (it is spread last), and DEFAULT_FACE fills any gap.
  let face: FaceParams;
  try {
    face = {
      ...DEFAULT_FACE,
      ...compileFace(parseBlob(activeCharacterSrc())),
      ...(override.faceParams ?? {}),
    };
  } catch {
    face = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
  }
  const body = buildZombieBody(face, override);

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
  const panelToggleEl = document.getElementById('panel-toggle') as HTMLButtonElement;
  let debugPanelHidden = false;
  function setDebugPanelHidden(hidden: boolean) {
    debugPanelHidden = hidden;
    applyDebugPanelVisibility(panelEl, panelToggleEl, hidden);
  }
  function toggleDebugPanel() {
    setDebugPanelHidden(!debugPanelHidden);
  }
  panelToggleEl.addEventListener('click', toggleDebugPanel);
  setDebugPanelHidden(false);
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
  const resEl = document.createElement('div');
  resEl.style.fontSize = '11px';
  statusBox.appendChild(resEl);
  // Result line for the keypress-driven benchmark — see runBench.
  const benchEl = document.createElement('div');
  benchEl.style.fontSize = '11px';
  benchEl.style.color = '#fc9';
  statusBox.appendChild(benchEl);
  const gibProbeEl = document.createElement('div');
  gibProbeEl.style.fontSize = '11px';
  gibProbeEl.style.color = '#9cf';
  statusBox.appendChild(gibProbeEl);
  // Motion status line (filled by the motion panel section further down;
  // declared here so the frame callback can always reach it).
  let motionReadEl: HTMLDivElement | null = null;
  // FPV readout line — same declaration-before-callback pattern.
  let fpvReadEl: HTMLDivElement | null = null;

  // The raymarched bodies render into their own target at their own scale and
  // composite back over the polygonal scene. Cost is close to linear in
  // pixels, so this is the biggest lever available without compute.
  const sdfLayer = createSdfLayer(handle.renderer);
  // Post chain (X1.25): FXAA + temporal smear + sharp-bilinear upscale. It
  // owns the frame's tail — with every effect off it is an exact
  // pass-through, so the pre-X1.25 draw path is untouched by default-off.
  // Created before sizeSdfLayer because the SDF layer sizes from its
  // contentSize (the capped render size), which must NOT follow the canvas
  // when the sharp-upscale toggle grows the canvas backing to the window.
  const postAa = createPostAa(handle.renderer);
  postAa.addSink(sdfLayer);
  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    const t = sdfLayer.targetSize;
    resEl.textContent = `sdf ${t.width}x${t.height} (${sdfLayer.scale.toFixed(2)}x)`;
    // Cone footprint radius per unit distance: a tile spans CONE_TILE pixels
    // of the SDF pass, and the frame spans 2*tan(fov/2) of world per unit
    // distance over its full height.
    // The cone footprint constants both levels use, derived from the layer's
    // resolution and the lens. Owned here rather than per view: every body's
    // cone material reads the same uniforms.
    sdfLayer.setConeGeometry(camera.fov, t.height);
  }
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
  // The frame's draw: goo density first, then the whole sdf flow in the
  // middle, then the goo surface composited on top (with fake depth, so it
  // interleaves with flesh and floor). gooLayer is declared further down —
  // safe in a closure because everything between here and the end of main()
  // is synchronous, so no frame can fire before it initialises.
  handle.setDrawFn(() => postAa.render(
    () => gooLayer.render(camera, () => sdfLayer.render(scene, camera)),
  ));

  // The occluder hull. Its own layer, rendered before the march, so every ray
  // can stop at the distance something solid already covers — the early-Z that
  // frag_depth and discard rule out.
  //
  // ON BY DEFAULT, and the cone stays off, because the full on/off matrix was
  // measured (10 bodies, 960x540, cooled, interleaved, all runs valid):
  //
  //                 cone only   cone+occ   occ only   neither
  //   stacked        18.32       17.93      16.29      21.30
  //   spread         11.24       10.92      10.86        —
  //
  // Occluder-only wins BOTH scenes. The two accelerators cut the same ray
  // interval — cone from the front, occluder from the back — and once the
  // occluder exists, the cone's two extra render passes cost more than its
  // start distances save. The cone toggle stays for measurement, not for use.
  const occluderHull = createOccluderHull();
  occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(occluderHull.object);
  // OCCLUDER PRE-PASS OFF (2026-09-01). Its tMax clamp is gone from the
  // march -- the distance it rasterises is only accurate in the near field
  // and under-reports badly beyond ~3 m, which shredded bodies at range.
  // The full measurement and the revival conditions are in march.wgsl.ts
  // above tMax. __sdfGame.setOccluder still renders the pass for
  // diagnostics; nothing consumes it.
  sdfLayer.setOccluderEnabled(false);

  // The character's own palette if it declared one, else the lab default.
  // `body` above already ran compileZombie, so lastBlobPalette is populated by
  // the time this reads it — the ordering is load-bearing, which is why this
  // sits below the build rather than at the top of the setup block.
  let flesh: FleshMaterial = lastBlobPalette
    ? { ...lastBlobPalette }
    : { ...FLESH_PRESETS['henenlotter-latex'] };
  let light: LightPresetName = 'practical-hard-key';

  // PERF TASK 5 step 3, compute port: the hero body opts into the per-tile
  // fold lists. The GPU binding is allocated ONCE at the WORST-CASE grid
  // (content size at scale 1.0 — NOT today's scaled size); adaptive
  // resolution then moves rungs by changing uniforms alone. Gated by
  // tileCfg.x = 0 so the shipping path marches the cluster walk exactly as
  // before; the panel button / __sdfLab.setTiles flips it.
  const heroTileBinding = createComputeTileBinding(
    handle.renderer,
    Math.ceil(postAa.contentSize.width), Math.ceil(postAa.contentSize.height),
  );
  const view = createZombieGpuView(body, {
    cone: sdfLayer.cone, occluder: sdfLayer.occluder,
    tiles: heroTileBinding,
  });
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
  // Everything raymarched lives on SDF_LAYER, so the two render passes are a
  // camera layer mask apart rather than an object list to keep in sync.
  view.object.layers.set(SDF_LAYER);
  view.coneObject.layers.set(CONE_LAYER);
  scene.add(view.object);
  scene.add(view.coneObject);

  // Tile-fold plumbing (compute port): the CPU TileBinner stays as the
  // REFERENCE implementation — one per SDF-pass size, used by the unit A/B
  // gate (__sdfLab.tileAB) that diffs the compute lists against it. It no
  // longer feeds the render path.
  let heroTilesEnabled = false;
  const tileBinners = new Map<string, TileBinner>();
  function binnerForSdfSize(
    w = sdfLayer.targetSize.width, h = sdfLayer.targetSize.height,
  ): TileBinner {
    const t = { width: w, height: h };
    const key = `${t.width}x${t.height}`;
    let b = tileBinners.get(key);
    if (!b) { b = new TileBinner(t.width, t.height); tileBinners.set(key, b); }
    return b;
  }
  function refreshHeroTiles() {
    if (!heroTilesEnabled || !view.tiles) return;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    // counts.w is maxBlendK — binning inflates group spheres by 4x it,
    // matching the per-step fold cull and the proxy-box pad in fit().
    view.tiles.bin(
      view.getTileGroups(), camera, view.uniforms.counts.value.w,
      { widthPx: sdfLayer.targetSize.width, heightPx: sdfLayer.targetSize.height },
    );
  }
  addSlider(statusBox, {
    label: 'AA eps (0=off)', min: 0, max: 2, step: 0.05,
    get: () => view.uniforms.aaCfg.value.y,
    set: (v) => { for (const x of [view, ...crowd]) x.uniforms.aaCfg.value.y = v; },
  });
  const tilesBtn = addButton(statusBox, 'tile fold: off', () => setHeroTiles(!heroTilesEnabled));
  function setHeroTiles(on: boolean) {
    heroTilesEnabled = on;
    view.tiles?.setEnabled(on);
    tilesBtn.textContent = `tile fold: ${on ? 'on' : 'off'}`;
  }

  // From here the scene CONTAINS the character. Everything after this is
  // preparation for things that have not happened yet (gibs, goo, FPV).
  boot.bodyInScene = bootMark();

  // The character's polygon kit, on the DEFAULT layer with the floor and the
  // reference cube — NOT SDF_LAYER. That is what puts it in the polygonal pass
  // whose depth the march already composites against (sdf-layer.ts's header),
  // so armour occludes and is occluded by flesh with nothing added here.
  //
  // Fire-and-forget: a kit that fails to load must not take the lab down with
  // it, and there is nothing to fall back to — the character is simply
  // undressed, which is exactly how it rendered before kits existed.
  const kitUrl = KITS[activeCharacterName()];
  if (kitUrl) {
    loadKit(kitUrl, handle.renderer, [0, 0, 0])
      .then(kit => scene.add(kit.object))
      .catch(e => console.error(`[kit] ${kitUrl} failed to load; rendering the body undressed`, e));
  }
  const u = view.uniforms;

  // One node graph for every gib. Three r185 still runs its expensive
  // NodeMaterial builder/generator once per fresh material/render object even
  // when the generated program key is identical; the first full gib used to
  // repeat that work for every spawned chunk and freeze the page for seconds.
  // compileAsync performs the one unavoidable build during loading and yields
  // between builder phases, before the lab accepts interaction.
  const chunkMaterial = createSharedChunkGpuMaterial();
  const warmPrims = body.prims.filter(p => p.limb === 'armL' && p.op !== 'sub').slice(0, 2);
  const warmOrigin = body.clusters.find(c => c.limb === 'armL')?.center ?? [0, 1, 0] as Vec3;
  const warmChunk = makeChunk(
    'armL', warmOrigin, [0, 0, 0], chunkExtent(warmPrims, warmOrigin), [0, 1, 0],
    () => 0.5,
  );
  const warmView = createChunkGpuView(
    warmChunk, warmPrims, u, undefined, view.volumeTexture, chunkMaterial,
  );
  warmView.object.layers.set(SDF_LAYER);
  const chunkMaterialWarmupStarted = performance.now();
  boot.warmupStart = chunkMaterialWarmupStarted;
  handle.setLoopRunning(false);
  try {
    await sdfLayer.precompile(warmView.object, scene, camera);
  } finally {
    handle.setLoopRunning(true);
  }
  const chunkMaterialWarmupMs = performance.now() - chunkMaterialWarmupStarted;
  boot.warmupEnd = bootMark();
  // Keep the compiled object itself as slot zero. compileAsync's cache is
  // keyed by object identity, so throwing this view away would retain a dead
  // RenderObject and make the first real chunk start from a fresh one.
  let spareChunkView: ChunkGpuView | null = warmView;
  window.addEventListener('pagehide', () => {
    for (const chunk of chunks) chunk.view.dispose();
    spareChunkView?.dispose();
    spareChunkView = null;
    chunkMaterial.dispose();
    enclosure.dispose();
  }, { once: true });

  // The metaball blood layer (gobs-and-goo task 5). It shares the march's
  // light uniform NODES — not copies — so any panel re-tune of lightDir /
  // keyColor / intensities moves the goo and the flesh together. Created
  // here rather than beside sdfLayer because it needs those nodes, which
  // only exist once the body view does.
  const gooLayer = createGooLayer(handle.renderer, {
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
  });
  postAa.addSink(gooLayer);
  {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  }
  // Density follows the SDF layer's resolution at a fixed fraction; this
  // listener is registered AFTER sizeSdfLayer's own, so it reads the
  // already-updated targetSize. A separate listener rather than a line in
  // sizeSdfLayer because that runs once before gooLayer exists (temporal
  // dead zone — see the panel note on frames firing mid-bootstrap).
  window.addEventListener('resize', () => {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  });

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

  // OFF by default since the X1.10 re-measure: at LOD's own benchmark scene
  // (10 bodies spread, occluder on) the whole quality-lever system is worth
  // 0.2% — within noise. Normal warping made its top lever (silhouette noise
  // in the march) free, and the occluder absorbed the rest. The machinery
  // stays for measurement, but paying its popping/hysteresis complexity by
  // default bought nothing the last time it was measured.
  let lodEnabled = false;
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
    vu.faceCfg.value.x = on('face') && faceEnabled ? faceMode : 0;
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
  /**
   * What faceCfg.x is set to when the face is on: 1 = multiplier sheet,
   * 2 = decal (a baked colour image pasted on as albedo). Owned here rather
   * than poked into the uniform because applyLod rewrites faceCfg.x every
   * frame from this.
   */
  let faceMode: 1 | 2 = 1;

  function loadFaceTexture(name: FaceTexName) {
    faceMode = 1;
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

  /**
   * Builds this character's face sheet from its own `sheet` block instead of
   * loading a shared PNG.
   *
   * Same contract as the PNG path — pixels, an atlas rect, and a MEAN — so the
   * shader cannot tell the difference. The mean is measured off the generated
   * pixels rather than assumed, for the reason the registry's hand-entered
   * means are commented "MEASURED off the file": it is the level the shader
   * divides out, so a wrong one shifts the whole head's brightness.
   *
   * Returns false when the character declared no `sheet` block, in which case
   * the caller falls back to the shared zombie sheet — which is what every
   * character wore before this existed.
   */
  function loadGeneratedFace(): boolean {
    let params;
    try {
      params = compileSheet(parseBlob(activeCharacterSrc()));
    } catch {
      return false; // a broken sheet block is reported by the body compile path
    }
    if (params === null) return false;
    u.faceProj.value.set(params.projScaleX, params.projScaleY, params.projCentreX, params.projCentreY);

    // DECAL: a baked colour image (npm run blob:face-bake), pasted on as
    // albedo. The mean is irrelevant to the decal branch but set to 1 so the
    // multiplier path, if the panel flips to it, does not blow the level out.
    const image = compileSheetImage(parseBlob(activeCharacterSrc()));
    if (params.decal > 0.5 && image !== null) {
      const tex = new THREE.TextureLoader().load(`/assets/lab/faces/${image}`);
      tex.magFilter = THREE.NearestFilter;   // PSX: texels, not a blur
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = true;                      // as the PNG registry path
      faceSheet?.tex.dispose();
      faceSheet = { tex, atlas: new THREE.Vector4(1, 1, 0, 0), mean: 1 };
      faceMode = 2;
      for (const v of [view, ...crowd]) v.setFaceTexture(tex, faceSheet.atlas, 1);
      return true;
    }
    faceMode = 1;

    const gen = generateFaceSheet(params, 64);
    // Expanded to RGBA even though the source is greyscale.
    //
    // A RedFormat upload looks like the efficient choice — one byte per texel
    // instead of four — and is wrong here: the shader reads `tex.rgb`, both as
    // an albedo MULTIPLIER and through `luma()` for the glow mask. With only
    // the red channel populated, `tex.rgb` is (r, 0, 0), so multiplying albedo
    // by it zeroes green and blue and the whole head renders blood red. Four
    // equal channels cost 16 KiB at 64x64 and mean the shader cannot tell a
    // generated sheet from the PNG it replaces.
    //
    // Rows are also flipped here. The PNG path leans on three's `flipY` at
    // upload to turn a top-left image into what the shader samples; a
    // DataTexture does not get that treatment, so an unflipped buffer renders
    // the face upside down — which read as a brow-coloured bar sitting where
    // the mouth belongs. generateFaceSheet keeps writing top-left rows,
    // matching the registry's rect convention and staying easy to assert on;
    // the flip lives here, at the one place that uploads.
    const rgba = new Uint8Array(gen.size * gen.size * 4);
    for (let y = 0; y < gen.size; y++) {
      const src = (gen.size - 1 - y) * gen.size;
      for (let x = 0; x < gen.size; x++) {
        const v = gen.pixels[src + x]!;
        const o = (y * gen.size + x) * 4;
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(rgba, gen.size, gen.size, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // The PNG path relies on three's flipY at upload; a DataTexture is handed
    // over in the orientation we wrote it, and generateFaceSheet writes rows
    // from the TOP-LEFT to match the registry's rect convention. So no flip.
    tex.flipY = false;
    tex.needsUpdate = true;

    faceSheet?.tex.dispose();
    faceSheet = { tex, atlas: new THREE.Vector4(1, 1, 0, 0), mean: gen.mean };
    for (const v of [view, ...crowd]) v.setFaceTexture(tex, faceSheet.atlas, gen.mean);
    return true;
  }

  // Baked projection: uv = hs * scale + centre, hs normalised PER AXIS by the
  // skull's semi-axes so these numbers survive a reproportioned head. A
  // character's sheet block overrides these (projScaleX.. in DEFAULT_SHEET
  // carry the same values) inside loadGeneratedFace, so this goes FIRST.
  u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
  let faceTexName: FaceTexName = 'zombie-flat';
  if (!loadGeneratedFace()) loadFaceTexture(faceTexName);
  // A character's `sheet` block can switch the projection off (`enabled 0`):
  // a headless character's stub skull would otherwise project the face rows
  // as stripes across its body. Goes through faceEnabled so the panel toggle
  // and applyLod agree with it.
  try {
    const sheetParams = compileSheet(parseBlob(activeCharacterSrc()));
    if (sheetParams && sheetParams.enabled === 0) faceEnabled = false;
  } catch { /* a broken sheet block is reported by the body compile path */ }
  u.faceCfg.value.x = faceEnabled ? faceMode : 0;   // face on (unless the sheet says no)
  u.faceCfg.value.y = 1.0;    // strength

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
  // Motion (X1.22): the orchestrator drives the hero's rest-pose targets;
  // the crowd stays static — it is a perf fixture, body zero is the actor.
  const WANDER_BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
  const MOTION_SEED = 1337; // fixed: reproducible shambling for A/B checks
  /** Body zero's per-body motion state — the ActorMotion record that used to
   *  be five module-level singletons (`bound`, `motionJoints`, `motionState`,
   *  `lastRootShift`, `lastBodyYaw`). Crowd actors own their own records of
   *  the same shape; see actor.ts and the crowd spawner below. */
  const heroMotion = makeActorMotion(current, { seed: MOTION_SEED });
  const motionRng = makeRng(MOTION_SEED);
  /** The hero's latest POSED body (world space) — what's on screen, and what
   *  shots raycast against. Authored rest-space raycasting stopped being
   *  valid the moment the body could wander or fall. */
  let lastPosed = current;
  let motionEnabled = true;
  let wanderOn = true;
  let armStyle: ArmStyle = GAIT_TUNING.armStyle;
  let headingFollow: number = MOTION_TUNING.headingFollow;
  /** Gaze-follow gain — 1 looks where the body walks, 0 pins the gaze to the
   *  wander target (the creepy variant the owner wants kept reachable). */
  let gazeFollow: number = MOTION_TUNING.gazeFollow;
  let forcedCollapse = false;

  // ——— MELT (2026-09-03) ————————————————————————————————————————————————
  // The zombie liquefies where it stands: flesh sags into a puddle and the
  // skeleton falls out of it. Spec: docs/superpowers/specs/2026-09-03-zombie-melt-design.md
  //
  // NOTE this deliberately does NOT trigger the death collapse. Melting IS
  // the death — a ragdoll underneath would topple the body, and the whole
  // read is that it goes straight down like a candle.
  let meltState: MeltState | null = null;
  function startMelt() {
    meltState = meltInitBody(current.prims, 0);
  }
  function stopMelt() {
    meltState = null;
  }
  /** Jump straight to a progress value — the capture script's knob. */
  function meltDirect(t: number) {
    if (!meltState) startMelt();
    meltState = { ...meltState!, t: Math.max(0, Math.min(1, t)) };
  }
  // bindRig pins the lowest joint as a static anchor; walking releases it —
  // the rest pull + plants carry the body instead (and collapse wants the
  // pin gone anyway, so it lives in one place).
  function unpinnedRigPoints() {
    return heroMotion.bound.rig.points.map(p => ({ ...p, pinned: false }));
  }
  if (heroMotion.motionJoints) {
    heroMotion.bound = { ...heroMotion.bound, rig: { ...heroMotion.bound.rig, points: unpinnedRigPoints() } };
  }
  // Per-frame signal accumulators: events (shots/severs) land between frames,
  // the motion step consumes and clears them inside the frame callback.
  let pendingShot: MotionSignals['shot'] = null;
  const pendingWounds: Wound[] = [];
  const pendingSevered: LimbId[] = [];
  /** The signal bundle stepActorMotion sees each frame — rebuilt from the
   *  accumulators above at the top of every frame; severed/freshWounds alias
   *  the live arrays so the in-place drain reaches them. */
  const heroSignals: ActorSignals = {
    shot: null,
    wounded: { armL: false, armR: false, legL: false, legR: false },
    severed: pendingSevered,
    missing: { legL: false, legR: false, armL: false, armR: false },
    headAlive: true,
    forcedCollapse: false,
    freshWounds: pendingWounds,
  };

  /**
   * Re-binds the prims after a body edit. While motion is on, the rig POINTS
   * are carried across (bones are unchanged by severing — only alive flags
   * move — so the points map 1:1); without this, every shot that severed a
   * limb would teleport the walking body back to the origin.
   */
  function rebind() {
    const keep = motionEnabled && heroMotion.motionJoints ? heroMotion.bound.rig.points : null;
    heroMotion.bound = bindRig(current);
    if (keep && keep.length === heroMotion.bound.rig.points.length) {
      heroMotion.bound = {
        ...heroMotion.bound,
        rig: { ...heroMotion.bound.rig, points: keep.map(p => ({ ...p, pinned: false })) },
      };
    }
  }

  /** Hard motion reset: fresh bind at the origin, fresh clocks. Body edits
   *  (rebuild/respawn/gib) spawn a new shambler rather than springing an old
   *  pose across the arena. */
  function resetMotion() {
    heroMotion.bound = bindRig(current);
    heroMotion.motionJoints = makeMotionJoints(current, heroMotion.bound.rig.restPose);
    if (heroMotion.motionJoints) {
      heroMotion.bound = { ...heroMotion.bound, rig: { ...heroMotion.bound.rig, points: unpinnedRigPoints() } };
    }
    heroMotion.motionState = makeMotionState(MOTION_SEED, [0, 0, 0]);
    heroMotion.lastRootShift = [0, 0, 0];
    heroMotion.lastBodyYaw = 0;
    pendingShot = null;
    pendingWounds.length = 0;
    pendingSevered.length = 0;
    forcedCollapse = false;
  }

  /** Full-limb severance map from cluster alive flags (mid-limb distal cuts
   *  leave the cluster alive and do NOT count — hop/collapse see full legs). */
  function missingLimbs(): MissingLimbs {
    const gone = (l: LimbId) => !(current.clusters.find(c => c.limb === l)?.alive ?? false);
    return { legL: gone('legL'), legR: gone('legR'), armL: gone('armL'), armR: gone('armR') };
  }

  /** Present-but-hurt limbs for the gait limp skew — a limb carrying at
   *  least one live wound on a still-alive cluster. */
  function woundedLimbs() {
    const alive = (l: LimbId) => current.clusters.find(c => c.limb === l)?.alive ?? false;
    const w = { armL: false, armR: false, legL: false, legR: false };
    for (const wound of wounds) {
      const prim = current.prims[wound.primIdx];
      if (!prim || !alive(prim.limb)) continue;
      if (prim.limb === 'armL' || prim.limb === 'armR'
        || prim.limb === 'legL' || prim.limb === 'legR') w[prim.limb] = true;
    }
    return w;
  }

  let wounds: Wound[] = [];
  /**
   * Freezes everything that animates on its own, so two captures of the same
   * pose are pixel-comparable.
   *
   * WHY THIS EXISTS. Judging a shader change (relax, wounds, shading) by
   * A/B capture is defeated by the cosmetics a wounded, severed body spawns:
   * chunk physics, the blood sim, and the goo density layer keep stepping
   * BETWEEN two shots even inside one page load, and time-driven shader terms
   * (eye-glow flicker) advance with the wall clock. Measured 2026-08-25 with
   * scripts/relax-sweep.mjs: on a severed + wounded body the noise floor of
   * two IDENTICAL runs reached 0.814 max lost-tile with 10 of 36 poses over
   * 0.30 — larger than the effect under test — while the same sweep on a clean
   * body floored at 0.014 with none over 0.30. The cosmetics were the entire
   * difference, and three attempts at the relax question stalled on it because
   * none of this is reachable from the console (the goo pass is a post sink
   * behind a closure).
   *
   * Freezing rather than hiding is deliberate: the body must still composite
   * against the same scene it normally does, so only the TIME EVOLUTION stops.
   * Nothing is removed from the frame.
   */
  let cosmeticsFrozen = false;

  const chunks: { id: number; state: Chunk; view: ChunkGpuView }[] = [];
  // Blood: the deterministic droplet/splat sim, plus its instanced renderer.
  const bloodSim = createBloodSim();
  const bloodView = createBloodView();
  for (const o of bloodView.objects) scene.add(o);
  /** Trail-source ids for emitTrails — every flying chunk is an emitter. */
  let nextChunkId = 1;

  /** Marches the CPU-side field along a ray to find where a shot lands. */
  function raycastBody(origin: Vec3, dir: Vec3, field: BuildResult = current): Vec3 | null {
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const d = sdBody(p, field);
      if (d < 0.002) return p;
      t += Math.max(d, 0.002);
    }
    return null;
  }

  function uploadWounds(prims: BuildResult['prims'], yaw = heroMotion.lastBodyYaw) {
    view.setWounds(
      // The CARVE centres, not the surface anchors: the shader subtracts its
      // spheres from these, and the centres are thickness-capped at stamp
      // time (damage.ts) so a blast on a thin torso never opens the far side.
      wounds.map(w => woundWorldPos(prims, w, yaw)),
      wounds.map(w => w.radius),
      wounds.map(w => TYPE_ID[w.type]),
      wounds.map(w => w.ageSec),
      // Per-wound lip: the profile's splay scaled by the flesh behind the hit
      // (Wound.rimScale), so a blast on a claw does not grow a floating ring.
      wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale * (w.rimScale ?? 1)),
      wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
    );
  }
  // Rest prims pair with the yaw-0 frame (they ARE the yaw-0 body); the
  // next frame's uploadWounds(posed) overwrites this transient anyway.
  function refreshWounds() { uploadWounds(current.prims, 0); }

  /**
   * The hero's wounds as world-space removal spheres, from the SAME posed
   * primitives the wound upload uses — so the hull's exclusion zone tracks
   * the jiggle exactly as the rendered craters do.
   */
  function woundSpheres(prims: BuildResult['prims']) {
    // Same carve centres the shader subtracts — the exclusion zone must
    // cover exactly what is removed, or hull spheres reappear in craters.
    return wounds.map(w => ({ centre: woundWorldPos(prims, w, heroMotion.lastBodyYaw), radius: w.radius }));
  }

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
  /** Seed base for the per-index crowd face draws — see setCrowdCount. */
  const CROWD_FACE_SEED = 20260825;

  /**
   * Shell-displacement silhouette noise (gobs-and-goo task 4): inside a thin
   * shell of the smooth surface, the march steps the fbm-displaced REAL field
   * conservatively instead of warping only the normal. The amplitude matches
   * marchCfg.z's silhouette value (0.016), so the displaced skin and the
   * warped normals — same fbm, same scale — never disagree.
   */
  const SHELL_AMP = 0.016;
  /** One source of truth for the default: defaultUniforms' woundCfg2.z. */
  let shellSilhouette = u.woundCfg2.value.z > 0;

  /**
   * One live crowd body: the per-actor state that used to have no home
   * because every piece of actor state was a body-zero singleton. The motion
   * record is the SAME type body zero owns; the pose step is the SAME
   * stepActorMotion the hero runs, with empty signals, a per-index seed and a
   * fixed dt (see CROWD_DT) so two runs at one body count match pose-for-pose.
   */
  interface CrowdActor {
    index: number;
    /** Rest-space field at the spawn offset — severs never touch it today. */
    current: BuildResult;
    /** Latest posed field. With motion frozen this is `current` itself,
     *  which is exactly what the static crowd has always rendered. */
    lastPosed: BuildResult;
    motion: ActorMotion;
    view: ReturnType<typeof createZombieGpuView>;
    spawn: Vec3;
    /** Wander box centred on the spawn — neighbours stay neighbours. */
    bounds: WanderBounds;
    rng: Rng;
  }
  const crowdActors: CrowdActor[] = [];
  /** Shared inert signal bundle — crowd actors take no shots or severs. */
  const CROWD_SIGNALS = emptyActorSignals();
  /** Wander half-extent around a crowd body's spawn, in world units. Grid
   *  spacing is 0.62 x / 0.85 z; ±0.28 keeps neighbours out of each other. */
  const CROWD_WANDER_R = 0.28;

  function setCrowdCount(n: number) {
    while (crowd.length > n) {
      const v = crowd.pop();
      if (!v) break;
      scene.remove(v.object);
      scene.remove(v.coneObject);
      v.dispose();
      crowdActors.pop();
    }
    while (crowd.length < n) {
      const i = crowd.length + 1; // body zero is the interactive one
      const col = i % 5;
      const row = Math.floor(i / 5);
      // Each crowd body gets its OWN head, built from a SEEDED preset draw,
      // so a crowd is not fifteen copies of one skull. Silhouette is the only
      // thing that can vary — every zombie shares one face sheet — so it is
      // the only place variety can come from. Built once at spawn, not per
      // frame. Seeded by body INDEX (was Math.random()): a random crowd made
      // every page load render differently, which quietly broke every frozen
      // capture A/B across loads — including the pixel-identity gate this
      // dispatch runs. Same index ⇒ same face, on every load, forever.
      const crowdFace = pickFace(makeRng(CROWD_FACE_SEED + i * 7919)());
      const crowdBody = buildZombieBody(crowdFace, override);
      const placed = translateBody(crowdBody,
        [(col - 2) * 0.62 * crowdSpread, 0, -row * 0.85 * crowdSpread]);
      const v = createZombieGpuView(placed,
        { cone: sdfLayer.cone, occluder: sdfLayer.occluder });
      trackBody(v, placed);
      v.applyMaterial(flesh, LIGHT_PRESETS[light]);
      if (faceSheet) {
        v.setFaceTexture(faceSheet.tex, faceSheet.atlas, faceSheet.mean);
        v.uniforms.faceCfg.value.copy(u.faceCfg.value);
        v.uniforms.faceCfg2.value.copy(u.faceCfg2.value);
        v.uniforms.faceProj.value.copy(u.faceProj.value);
        // Spawn-time skull sphere from the placed field; while the crowd is
        // animated this is re-derived per frame from the POSED prims, same as
        // body zero's.
        const skull = headShape(placed);
        if (skull) v.setHeadShape(skull.centre, skull.axes);
      }
      v.object.layers.set(SDF_LAYER);
      v.coneObject.layers.set(CONE_LAYER);
      scene.add(v.object);
      scene.add(v.coneObject);
      crowd.push(v);
      const spawn: Vec3 = [(col - 2) * 0.62 * crowdSpread, 0, -row * 0.85 * crowdSpread];
      crowdActors.push({
        index: i,
        current: placed,
        lastPosed: placed,
        motion: makeActorMotion(placed, { seed: crowdSeed(i, MOTION_SEED), start: spawn }),
        view: v,
        spawn,
        bounds: {
          minX: spawn[0] - CROWD_WANDER_R, maxX: spawn[0] + CROWD_WANDER_R,
          minZ: spawn[2] - CROWD_WANDER_R, maxZ: spawn[2] + CROWD_WANDER_R,
        },
        rng: crowdRng(i, MOTION_SEED),
      });
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
    if (fpvMode.mode === 'fpv') {
      // FPV owns the left button: press = cook. No orbiting in first person.
      if (e.button === 0) fpvPress = true;
      return;
    }
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
    if (fpvMode.mode === 'fpv') {
      // Release = throw. The god-cam click-shoot pipeline stays god-only.
      if (ev.button === 0) fpvRelease = true;
      return;
    }
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

    // Raycast the POSED body (world space): wander/collapse broke the
    // rest-space assumption, and wounds are prim-LOCAL, so a hit mapped
    // through the posed prims rides the authored body cleanly (applyRig
    // keeps prim indices 1:1).
    const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z], lastPosed);
    if (!hit) return;

    const type: WoundType = ev.shiftKey ? 'blast' : ev.altKey ? 'burn' : 'pellet';
    // The wound frame is the body's CURRENT yaw — the same transform the
    // heading rotation puts the prims through, so the crater rides the turn.
    const wound = worldHitToWound(lastPosed.prims, hit, WOUND_PROFILES[type].radius, type, heroMotion.lastBodyYaw,
      p => sdBody(p, lastPosed));
    wounds = pushWound(wounds, wound, MAX_WOUNDS);
    pendingWounds.push(wound);
    // The shot feeds stagger (profile + direction) and, for torso blasts,
    // the wound clutch — both consumed by the next motion step.
    pendingShot = {
      type,
      dirWorld: [d.x, d.y, d.z],
      woundWorld: hit,
      torso: lastPosed.prims[wound.primIdx]?.limb === 'torso',
    };
    // A hit shoves the nearest joint along the shot direction — the rest-pose
    // pull springs it back, so the limb visibly recoils and lags. Scaled up
    // in the motion-polish pass (0.04/0.10 was sub-perceptual at god-cam
    // distance); the sustained decay lives in motion.ts's recoil state.
    const push = type === 'blast' ? 0.16 : type === 'pellet' ? 0.06 : 0.04;
    heroMotion.bound = impulseAt(heroMotion.bound, hit, [d.x * push, d.y * push, d.z * push]);
    refreshWounds();

    // Wound-driven detachment: a carve that disconnects a limb severs it for
    // real — same path as the keyboard sever.
    const fullCuts = cutLimbs(current, wounds, torsoCentre());
    for (const limb of fullCuts) {
      const { body: next, chunk, stumpWound } = severLimb(current, limb);
      if (chunk.prims.length === 0) continue;
      current = next;
      if (stumpWound) {
        wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
        pendingWounds.push(stumpWound);
      }
      pendingSevered.push(limb);
      spawnChunk(limb, chunk.origin, chunk.prims, undefined,
        [attachPoint(chunk.prims, torsoCentre())]);
      view.update(current);
      refreshWounds();
      rebind();
    }

    // Mid-limb cuts: a carve that severs a CHAIN joint (knee, elbow…) drops
    // everything distal to it as its own chunk — before this the distal piece
    // stayed in the field and floated. Full-limb cuts above take precedence.
    for (const cut of cutChains(current, wounds)) {
      if (fullCuts.includes(cut.limb)) continue;
      const { body: next, chunk, stumpWound } = severDistal(current, cut);
      if (chunk.prims.length === 0) continue;
      current = next;
      if (stumpWound) {
        wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
        pendingWounds.push(stumpWound);
      }
      pendingSevered.push(cut.limb);
      spawnChunk(cut.limb, chunk.origin, chunk.prims, undefined, chunk.tornAt);
      view.update(current);
      refreshWounds();
      rebind();
    }
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

  /** The piece's long axis from its prims — the topple aligns this flat. */
  function primsLongAxis(prims: typeof current.prims, origin: Vec3): Vec3 {
    // Longest chord among endpoints, in chunk-local space.
    let best: Vec3 = [0, 1, 0]; let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(...d);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }

  function torsoCentre(b: BuildResult = current): Vec3 {
    return b.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0];
  }

  function spawnChunk(
    limb: LimbId, origin: Vec3, prims: typeof current.prims,
    vel?: Vec3, tornAt?: Vec3[], kind: 'limb' | 'gob' = 'limb',
  ) {
    if (prims.length === 0) return;
    // The sever results are authored rest-space; chunks live in world space.
    // With the hero wandering (or lying somewhere), spawn the piece where the
    // body actually is — chunk.pos is the recentring origin for the piece's
    // prims AND its physics seed, so both must shift together.
    origin = add(origin, heroMotion.lastRootShift);
    if (tornAt) tornAt = tornAt.map(t => add(t, heroMotion.lastRootShift));
    const v: Vec3 = vel ?? [
      (Math.random() - 0.5) * 4.5,
      2.5 + Math.random() * 2.5,
      (Math.random() - 0.5) * 4.5,
    ];
    // Collision radius = the limb's real visual extent; chunk.radius's 0.14 is
    // smaller than any limb and would bury it half-way into the floor.
    const state = makeChunk(limb, origin, v, chunkExtent(prims, origin), primsLongAxis(prims, origin), Math.random, kind);
    const oldest = chunks.length >= MAX_CHUNKS ? chunks.shift() : undefined;
    if (oldest) {
      // Keep the same mesh/material pair. Three keys its RenderObject cache by
      // object identity and does not evict it when geometry alone is disposed;
      // recycling at the existing cap keeps that cache bounded at 40.
      oldest.view.reset(state, prims, tornAt);
      chunks.push({ id: nextChunkId++, state, view: oldest.view });
    } else {
      const chunkView = spareChunkView ?? createChunkGpuView(
        state, prims, u, tornAt, view.volumeTexture, chunkMaterial,
      );
      if (spareChunkView) {
        spareChunkView = null;
        chunkView.reset(state, prims, tornAt);
      }
      chunkView.object.layers.set(SDF_LAYER);
      scene.add(chunkView.object);
      chunks.push({ id: nextChunkId++, state, view: chunkView });
    }
    // Goo at the tear: a droplet burst where the piece ripped away.
    burst(bloodSim, origin, Math.random);

  }

  let lastGibWorstFrameMs: number | null = null;
  /** Samples after the renderer's already-registered rAF callback, so the
   * first gap includes the first rendered gib frame rather than only the
   * synchronous key handler. Kept visible for repeatable owner/automation
   * checks; p95 can hide exactly the one frame this bug stalled. */
  function beginGibFrameProbe() {
    let previous = performance.now();
    let worst = 0;
    let remaining = 5;
    const sample = () => {
      const now = performance.now();
      worst = Math.max(worst, now - previous);
      previous = now;
      remaining--;
      if (remaining > 0) {
        requestAnimationFrame(sample);
      } else {
        lastGibWorstFrameMs = worst;
        gibProbeEl.textContent = `gib worst frame: ${worst.toFixed(1)} ms`;
      }
    };
    requestAnimationFrame(sample);
  }

  /** Blows the whole body apart — every live cluster becomes a chunk. */
  function gibEverything() {
    beginGibFrameProbe();
    const centre = torsoCentre();
    // gibAllPieces does the alive-flag bookkeeping; the PIECES come from
    // makeGobs instead — amorphous hunks + scraps, not anatomy prims
    // (gobs-and-goo spec §1). Severs still detach real anatomy.
    const { body: next } = gibAllPieces(current, centre);
    const { gobs, scraps } = makeGobs(current, centre, Math.random);
    addScraps(bloodSim, scraps, centre, Math.random);
    for (const g of gobs) {
      // Radial launch from the body centre, so the pile spreads instead of
      // every piece going the same way.
      const dx = g.origin[0] - centre[0];
      const dy = g.origin[1] - centre[1];
      const dz = g.origin[2] - centre[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      // Game-hot burst, matched to the game ChunkSystem's hand-tuned spawn
      // (chunks.ts spawnOne): pieces go flying out far, not a soft slump.
      const speed = 5.0 + Math.random() * 4.0;
      const vel: Vec3 = [
        (dx / l) * speed + (Math.random() - 0.5) * 1.2,
        (0.8 + Math.random() * 0.8) * speed * 0.8,
        (dz / l) * speed + (Math.random() - 0.5) * 1.2,
      ];
      spawnChunk(g.limb, g.origin, g.prims, vel, g.tornAt, 'gob');
    }
    current = next;
    wounds = [];
    view.update(current);
    refreshWounds();
    resetMotion(); // a gibbed body is done shambling — fresh state for whatever spawns next
  }

  // -------------------------------------------------------------------------
  // FPV mode (X1.23): Tab toggles the god-cam ↔ first-person walk; the
  // orchestration lives in ../fpv-mode.ts (pure, unit-tested) and this block
  // owns everything browser-shaped — pointer lock, the input latch, the
  // hands/stick/burst views, the charge-bar HUD, and the gore port that
  // routes each detonation into the EXISTING stack above (pushWound,
  // impulseAt, severLimb/severDistal, gibEverything, chunk velocities, the
  // motion shot signal). Nothing below re-implements gore; it calls it.
  // -------------------------------------------------------------------------
  let fpvMode: FpvModeState = makeFpvMode('god');
  /** The lab floor is 20×20 — the walk bounds are the floor, not the game's
   *  full BALLISTIC arena the bundle still flies (and bounces) inside. */
  const FPV_FLOOR_BOUNDS = { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 };
  const HAND_REST = buildHandPrims();
  /** The hands' own wound ring — splash stamps from the resolver. */
  let handWounds: Wound[] = [];
  /** Last frame's world-space hand prims — the splash trace target. */
  let lastHandWorld: ReturnType<typeof handPrimsToWorld> = [];
  // ONE VIEW PER HAND: the march's texture projection is a single set of
  // uniforms, so each hand needs its own view to carry its own detail sheet
  // pinned to its own posed prims (see fpv-view's header).
  const handViews = {
    left: createHandsGpuView(u, 'armL'),
    right: createHandsGpuView(u, 'armR'),
  } as const;
  for (const v of [handViews.left, handViews.right]) {
    v.object.layers.set(SDF_LAYER);
    v.setVisible(false);
    scene.add(v.object);
  }
  /** Hand-detail sheets: the procedural pair immediately so the hands are
   *  never sheet-less, upgraded in place if the Blender bake is present. */
  let handSheets = proceduralHandSheets();
  handViews.left.setSheet(handSheets.pinch);
  handViews.right.setSheet(handSheets.grip);
  /** True once the baked sheets loaded — surfaced in the FPV readout. */
  let handSheetsBaked = false;
  void loadBakedHandSheets().then(baked => {
    if (!baked) return;
    handSheets = baked;
    handSheetsBaked = true;
    handViews.left.setSheet(baked.pinch);
    handViews.right.setSheet(baked.grip);
  });
  // ——— Baked hand volumes (X1.26 static → X1.27 task F2: + clip/GLB) ————
  // Two INDEPENDENT loads. The static (X1.26) volume loads on its own;
  // the clip path loads and validates the v2 manifest/texture FIRST, then
  // its relative hash-matched GLB, and settles the UI only after BOTH
  // objects are ready (settleHandClip is the combined clip+GLB settlement —
  // the plan's coherence contract, so `clipLoad === 'ready'` can never mean
  // "clip ready but prop missing"). On either clip failure ONE clipError is
  // stored and the policy falls back to the X1.26 static baked hand (prims
  // if that failed too); the clip is never paired with the procedural prop.
  // Both handlers are attached, so no load can leave an unhandled rejection.
  const HAND_VOLUME_URL = '/assets/lab/hand-sdf-relaxed-r.json';
  const HAND_CLIP_URL = '/assets/lab/hand-sdf-dynamite-grip-r.json';
  let handFieldUi = makeHandFieldUi();
  let handVolume: HandVolume | null = null;
  /** The static volume's own failure text — surfaced inline; the POLICY
   *  keeps only clipError (its fallback field decision). */
  let staticVolumeError = '';
  loadHandVolume(HAND_VOLUME_URL).then(
    v => {
      handVolume = v;
      applyHandField(settleStaticHandVolume(handFieldUi, true));
    },
    err => {
      staticVolumeError = err instanceof Error ? err.message : String(err);
      applyHandField(settleStaticHandVolume(handFieldUi, false));
    },
  );
  /** The loaded six-frame clip (volume + v2 manifest), once coherent. */
  let handClip: HandClipVolume | null = null;
  /** The clip's hash-matched derived GLB wrapper, once coherent. */
  let dynamiteProp: DynamiteProp | null = null;
  /** Fine-grained clip-asset diagnostics for the panel/automation:
   *  idle → loading → clip-ready (manifest+atlas) → glb-ready (coherent) |
   *  error. The POLICY state is handFieldUi.clipLoad; this is the detail. */
  let clipLoadDetail: 'loading' | 'clip-ready' | 'glb-ready' | 'error' = 'loading';
  void (async () => {
    try {
      const clip = await loadHandClip(HAND_CLIP_URL);
      clipLoadDetail = 'clip-ready';
      // loadDynamiteProp resolves the GLB against its base argument — hand
      // it the ABSOLUTE manifest URL (a relative base cannot construct a
      // URL), exactly as loadHandClip already did internally.
      const absManifest = new URL(HAND_CLIP_URL, location.href).href;
      const prop = await loadDynamiteProp(absManifest, clip.manifest.prop);
      handClip = clip;
      dynamiteProp = prop;
      scene.add(prop.object);
      prop.pose({ mode: 'gone' }); // held only when the clip drive says so
      clipLoadDetail = 'glb-ready';
      applyHandField(settleHandClip(handFieldUi, true));
    } catch (err) {
      clipLoadDetail = 'error';
      applyHandField(settleHandClip(
        handFieldUi, false, err instanceof Error ? err.message : String(err)));
    }
  })();
  // The lab owns the loaded volumes + prop; each view owns its own 1³
  // fallback (disposed in its dispose). One pagehide, one dispose each —
  // every dispose here is idempotent, so a double fire stays safe.
  window.addEventListener('pagehide', () => {
    handVolume?.dispose();
    handVolume = null;
    handClip?.dispose();
    handClip = null;
    dynamiteProp?.dispose();
    dynamiteProp = null;
  });

  // ——— X1.27 task F2/F3: the grip-clip drive state ————————————————————
  /** The pure close/hold/underhand/release controller (hand-grip-clip.ts).
   *  'open' at rest — the first presented bundle (clipBundlePresented)
   *  steps it into closing, so entering clip mode re-presents naturally. */
  let gripMotion: GripMotionState = makeGripMotion(false);
  let gripPlayback: 'pause' | 'play' | 'loop' = 'play';
  /** Controller-clock multiplier (captures want 1; the slider tunes it). */
  let gripSpeed = 1;
  /** Manual grip01 scrub — VISUAL ONLY (frame sample + held pose); set by
   *  setGripProgress, which also pauses playback; cleared by play/loop or
   *  any real throw. Never creates pendingThrow/flight/fuse/explosion. */
  let gripScrub: number | null = null;
  /** Marker releases performed this session (automation asserts ≥1). */
  let releaseCount = 0;
  /** |heldRoot − flight.pos| at the last marker handoff, metres (the plan's
   *  <0.1 mm gate; makeFlight copies the position so this is ~0). */
  let lastHandoffErrorM: number | null = null;
  /** The PREVIOUS frame's rendered GLB root — the release velocity source
   *  ((current − previous) / max(dt, 1/240)). */
  let prevPropRoot: BakedPropPose | null = null;
  /** This frame's clip outputs, produced in the hands block and consumed by
   *  the prop block further down the callback. clipPropPose/gripFrame
   *  PERSIST as the last rendered root/controller frame (a marker firing
   *  while the hands are hidden still hands off from a real position). */
  let clipPropPose: BakedPropPose | null = null;
  /** The latest grip controller frame (sample source + propHeld flag). */
  let gripFrame: ReturnType<typeof stepGripMotion>['frame'] | null = null;
  let clipSample = { frame0: 0, frame1: 0, alpha: 0 };
  let clipReleaseNow = false;
  /** Who owns the GLB this frame: 'hand' | 'flight' | 'gone'. */
  let propOwner: 'hand' | 'flight' | 'gone' = 'gone';
  /** Auto-loop hold before the scripted toss (s): long enough to read the
   *  firm grip, short enough that the loop stays watchable. */
  const GRIP_LOOP_HOLD_SEC = 0.45;
  /** Contact-hull diagnostic (the spec's prop-anchor/contact-hull view): a
   *  wireframe sphere at the authored grip seat plus the bundle-axis
   *  capsule (contactRadiusM wide, contactBelow..contactAbove along the
   *  axis). Unit geometry, rescaled once the clip contract is available. */
  const contactDebug = new THREE.Group();
  const contactSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0x66ffcc, wireframe: true }));
  const contactAxis = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, wireframe: true }));
  contactDebug.add(contactSphere, contactAxis);
  contactDebug.visible = false;
  scene.add(contactDebug);
  let contactDebugOn = false;

  // Scratch for the contact diagnostic (avoid per-frame allocation).
  const cdQ = new THREE.Quaternion();
  const cdGrip = new THREE.Vector3();
  const cdAxis = new THREE.Vector3();
  const cdUp = new THREE.Vector3(0, 1, 0);
  /** Places the contact-hull diagnostic on one ANIMATED hand pose: the
   *  sphere at the authored grip seat (centre + q·gripLocal), the capsule
   * spanning contactBelow..contactAbove along the authored bundle axis —
   * the exact hull the six poses were solved against. */
  function poseContactDebug(hand: BakedHandPose, prop: DynamitePropContract): void {
    cdQ.set(hand.quaternion[0], hand.quaternion[1], hand.quaternion[2], hand.quaternion[3]);
    cdGrip.set(prop.gripLocal[0], prop.gripLocal[1], prop.gripLocal[2]).applyQuaternion(cdQ)
      .add(cdAxis.set(hand.centre[0], hand.centre[1], hand.centre[2]));
    cdAxis.set(prop.axisLocal[0], prop.axisLocal[1], prop.axisLocal[2])
      .applyQuaternion(cdQ).normalize();
    contactDebug.position.copy(cdGrip);
    contactDebug.quaternion.setFromUnitVectors(cdUp, cdAxis);
    contactSphere.scale.setScalar(prop.contactRadiusM);
    contactAxis.scale.set(
      prop.contactRadiusM, prop.contactBelowM + prop.contactAboveM, prop.contactRadiusM);
    contactAxis.position.set(0, (prop.contactAboveM - prop.contactBelowM) / 2, 0);
  }

  /** Poses the clip's GLB purely by OWNERSHIP (F2 step 3):
   *  hand — while propHeld, the root transform derived from this frame's
   *         animated baked pose (clipPropPose);
   *  marker — on releaseNow, the parked pending throw releases at the
   *         CURRENT rendered root with the previous root's velocity
   *         ((cur−prev)/max(dt,1/240)), and the GLB is re-posed from the
   *         NEW flight.pos on this SAME render frame with the rendered
   *         orientation preserved verbatim (releaseQuaternion) — the
   *         handoff must not move the bundle (tracked in lastHandoffErrorM);
   *  flight — afterwards the deterministic sim exclusively owns it
   *         (visible from the god cam too, like the procedural stick);
   *  gone — at rest. */
  function poseClipProp(dt: number): void {
    const prop = dynamiteProp;
    if (!prop) return;
    if (clipReleaseNow && clipPropPose && fpvMode.pendingThrow !== null) {
      const prev = prevPropRoot ?? clipPropPose; // first-frame fallback: no motion yet
      const vel = handReleaseVelocity(prev.position, clipPropPose.position, dt);
      fpvMode = releasePendingThrow(fpvMode, clipPropPose.position, vel);
      const f = fpvMode.flight!;
      lastHandoffErrorM = Math.hypot(
        f.pos[0] - clipPropPose.position[0],
        f.pos[1] - clipPropPose.position[1],
        f.pos[2] - clipPropPose.position[2]);
      releaseCount++;
      prop.pose({
        mode: 'flight', position: f.pos, spin: f.spin, fuseBurning: true,
        releaseQuaternion: clipPropPose.quaternion,
      });
      propOwner = 'flight';
      prevPropRoot = {
        position: [f.pos[0], f.pos[1], f.pos[2]],
        quaternion: [...clipPropPose.quaternion] as [number, number, number, number],
      };
      return;
    }
    if (fpvMode.flight) {
      prop.pose({
        mode: 'flight', position: fpvMode.flight.pos,
        spin: fpvMode.flight.spin, fuseBurning: true,
      });
      propOwner = 'flight';
      prevPropRoot = null;
      return;
    }
    if (clipPropPose && gripFrame?.propHeld && fpvMode.mode === 'fpv') {
      prop.pose({
        mode: 'hand', position: clipPropPose.position,
        quaternion: clipPropPose.quaternion,
        cooking: fpvMode.fpv.cook.phase === 'cooking',
      });
      propOwner = 'hand';
      prevPropRoot = {
        position: [clipPropPose.position[0], clipPropPose.position[1], clipPropPose.position[2]],
        quaternion: [...clipPropPose.quaternion] as [number, number, number, number],
      };
      return;
    }
    prop.pose({ mode: 'gone' });
    propOwner = 'gone';
    prevPropRoot = null;
  }
  const stick = createStickProp();
  scene.add(stick.object);
  const cig = createCigaretteProp();
  scene.add(cig.object);
  const burstLayer = createBurstLayer(scene);
  /** Hands A/B toggle — the spec's perf gate is measured both ways. */
  let handsEnabled = true;

  /** The lazy scene reads the resolver evaluates at detonation time. */
  const fpvWorld = {
    heroPosed: () => lastPosed,
    chunks: () => chunks.map(c => ({ id: c.id, pos: c.state.pos })),
    handPrimsWorld: () => lastHandWorld,
  };

  /** One detonation → the existing gore stack, in the click-shoot order. */
  const gorePort: FpvGorePort = {
    stampWounds(ws) {
      for (const w of ws) wounds = pushWound(wounds, w, MAX_WOUNDS);
      refreshWounds();
    },
    // DIRECT meter credit (fpv-mode's contract): freshWounds would weight by
    // PROFILE radius and collapse the zombie from an edge-of-radius graze.
    creditMeter(credit) {
      if (!heroMotion.motionState) return;
      heroMotion.motionState = {
        ...heroMotion.motionState,
        collapse: {
          ...heroMotion.motionState.collapse,
          meter: Math.min(1, heroMotion.motionState.collapse.meter + credit),
        },
      };
    },
    impulseRig(at, vel) {
      // One frame's displacement from the concussion velocity — the Verlet
      // prev-pos turns it into the launch velocity, and the rest-pose pull
      // (or the collapse ramp) decides how much of it sticks.
      const k = 1 / 30;
      heroMotion.bound = impulseAt(heroMotion.bound, at, [vel[0] * k, vel[1] * k, vel[2] * k]);
    },
    severFullLimbs(limbs) {
      for (const limb of limbs) {
        const { body: next, chunk, stumpWound } = severLimb(current, limb);
        if (chunk.prims.length === 0) continue;
        current = next;
        if (stumpWound) {
          wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
          pendingWounds.push(stumpWound); // stump meter fuel, as click-shoot
        }
        pendingSevered.push(limb);
        spawnChunk(limb, chunk.origin, chunk.prims, undefined,
          [attachPoint(chunk.prims, torsoCentre())]);
        view.update(current);
        refreshWounds();
        rebind();
      }
    },
    applyChainCuts(cuts) {
      for (const cut of cuts) {
        const { body: next, chunk, stumpWound } = severDistal(current, cut);
        if (chunk.prims.length === 0) continue;
        current = next;
        if (stumpWound) {
          wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
          pendingWounds.push(stumpWound);
        }
        pendingSevered.push(cut.limb);
        spawnChunk(cut.limb, chunk.origin, chunk.prims, undefined, chunk.tornAt);
        view.update(current);
        refreshWounds();
        rebind();
      }
    },
    gibBody() { gibEverything(); },
    impulseChunks(list) {
      for (const ci of list) {
        const c = chunks.find(x => x.id === ci.chunkId);
        if (!c) continue;
        c.state = { ...c.state, vel: add(c.state.vel, ci.vel) };
      }
    },
    spawnBurst(v) { burstLayer.spawn(v); },
    stampHandWounds(ws) {
      for (const w of ws) handWounds = pushWound(handWounds, w, MAX_WOUNDS);
    },
    pushShot(shot) { pendingShot = shot; },
  };

  // — Input latch: accumulated between frames, consumed once per frame. —
  let fpvMouseDx = 0;
  let fpvMouseDy = 0;
  const fpvKeys = { forward: false, back: false, left: false, right: false };
  let fpvPress = false;
  let fpvRelease = false;

  /** Charge-bar HUD — a minimal DOM overlay (spec §1: no crosshair needed,
   *  the hands ARE the sight). */
  const chargeWrap = document.createElement('div');
  chargeWrap.style.cssText =
    'position:fixed;left:50%;bottom:11%;transform:translateX(-50%);width:220px;' +
    'height:10px;border:1px solid #f4c98a;background:rgba(0,0,0,0.55);' +
    'display:none;pointer-events:none;z-index:5;';
  const chargeFill = document.createElement('div');
  chargeFill.style.cssText = 'height:100%;width:0%;background:#e8a33d;';
  chargeWrap.appendChild(chargeFill);
  mount.appendChild(chargeWrap);

  function enterFpv() {
    fpvMode = enterFpvMode(fpvMode);
    fpvMouseDx = 0; fpvMouseDy = 0; fpvPress = false; fpvRelease = false;
    handViews.left.setVisible(handsEnabled && handFieldUi.field === 'prims');
    handViews.right.setVisible(handsEnabled);
    fpvBtn.textContent = 'fpv: exit';
    try {
      const p = canvas.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => { /* lock denied — camera still works */ });
      }
    } catch { /* older signature — nothing to await */ }
  }
  function exitFpv() {
    fpvMode = exitFpvMode(fpvMode);
    handViews.left.setVisible(false);
    handViews.right.setVisible(false);
    chargeWrap.style.display = 'none';
    fpvBtn.textContent = 'fpv: enter';
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  // Losing the lock (Esc, tab switch) exits to the god-cam — the FPV camera
  // without the mouse is a trap, and the god tooling must stay reachable.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && fpvMode.mode === 'fpv') exitFpv();
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && fpvMode.mode === 'fpv') {
      fpvMouseDx += e.movementX;
      fpvMouseDy += e.movementY;
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyH' && !ev.repeat) {
      ev.preventDefault();
      toggleDebugPanel();
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (fpvMode.mode === 'fpv') exitFpv(); else enterFpv();
      return;
    }
    if (fpvMode.mode !== 'fpv') return;
    if (ev.code === 'KeyW') fpvKeys.forward = true;
    else if (ev.code === 'KeyS') fpvKeys.back = true;
    else if (ev.code === 'KeyA') fpvKeys.left = true;
    else if (ev.code === 'KeyD') fpvKeys.right = true;
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'KeyW') fpvKeys.forward = false;
    else if (ev.code === 'KeyS') fpvKeys.back = false;
    else if (ev.code === 'KeyA') fpvKeys.left = false;
    else if (ev.code === 'KeyD') fpvKeys.right = false;
  });

  // — Charge-bar + readout helpers (frame-side) —
  function updateChargeHud(mode: string, charge: number) {
    const show = mode === 'fpv' && charge > 0.001;
    chargeWrap.style.display = show ? 'block' : 'none';
    if (show) {
      chargeFill.style.width = `${Math.round(charge * 100)}%`;
      // Near the fuse limit the bar goes hot — the overcook warning.
      chargeFill.style.background = charge > 0.85 ? '#e04c2c' : '#e8a33d';
    }
  }

  // Benchmark. Press B.
  // ---------------------------------------------------------------------------
  //
  // Everything about the shape of this is a reaction to how badly the previous
  // measurement setup lied. Three separate faults, all of which produced
  // confident numbers:
  //
  //   1. `renderer.setAnimationLoop` is requestAnimationFrame, which stops dead
  //      when the page is not composited. Automated runs drive the lab from a
  //      browser pane that hides between tool calls, so a fifteen-second sample
  //      window collected under twenty frames.
  //   2. The animation loop's timestamp resolve is fire-and-forget, and with
  //      the cone pre-pass on, ONE frame is three `renderer.render` calls. Which
  //      pass a reading described depended on when the resolve happened to land,
  //      so the same configuration could read like the full march or like the
  //      composite blit alone.
  //   3. A hidden document has no swapchain texture, so the passes do nothing
  //      and resolve to ~0.065 ms. That reads as a 70x speedup.
  //
  // So: hand-driven frames at a fixed timestep, one awaited resolve each, and a
  // hard count of any frame stepped while hidden. A keypress starts it because
  // a keypress is the one trigger that leaves the pane visible.
  let benchRunning = false;

  async function benchGpu({ chunks = 12, chunkFrames = 20, warmup = 40, dt = 1 / 60 } = {}) {
    handle.setLoopRunning(false);
    // Dynamic resolution would move the pixel count mid-run, and pixel count
    // IS the thing being measured. Suspended for the duration rather than
    // merely discouraged.
    const hadAdaptive = adaptiveEnabled;
    adaptiveEnabled = false;
    try {
      let hiddenSteps = 0;
      const step = () => {
        if (document.hidden) hiddenSteps++;
        handle.step(dt);
      };
      for (let i = 0; i < warmup; i++) step();
      await handle.resolveGpu();

      // Wall-clock per frame with the submission queue kept full, NOT the
      // per-pass timestamp.
      //
      // The timestamp route was tried first and swung 13 / 36 / 21 ms across
      // three back-to-back runs of an identical configuration. The cause is
      // the await: resolving after every frame drains the queue, so the GPU
      // goes idle between frames and clocks down, and how far it drops depends
      // on whatever else is compositing at the time. Measuring while
      // deliberately starving the GPU cannot produce a stable number.
      //
      // Submitting a chunk before awaiting keeps the queue full for all but
      // the last frame of each chunk. The resolve at the chunk boundary is
      // what makes the timing honest rather than a measurement of how fast
      // frames can be QUEUED: it does not return until the GPU has finished
      // the work, so the elapsed time covers execution rather than submission.
      const perFrame: number[] = [];
      for (let c = 0; c < chunks; c++) {
        const t0 = performance.now();
        for (let i = 0; i < chunkFrames; i++) step();
        await handle.resolveGpu();
        perFrame.push((performance.now() - t0) / chunkFrames);
      }

      const s = perFrame.sort((a, b) => a - b);
      const at = (q: number) => +s[Math.min(s.length - 1, Math.floor(s.length * q))]!.toFixed(2);
      return {
        bodies: crowd.length + 1,
        n: s.length * chunkFrames,
        median: at(0.5),
        p05: at(0.0),
        p95: at(0.95),
        sdfScale: sdfLayer.scale,
        cone: sdfLayer.coneEnabled,
        lod: lodEnabled,
        hiddenSteps,
        adaptive: hadAdaptive ? 'suspended' : 'off',
      };
    } finally {
      adaptiveEnabled = hadAdaptive;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      handle.setLoopRunning(true);
    }
  }

  /**
   * Runs the benchmark and leaves the result BOTH on screen and on
   * `window.__benchResult`, so it can be read back later from a console call
   * that would itself have hidden the page.
   */
  async function runBench(label = ''): Promise<void> {
    if (benchRunning) return;
    benchRunning = true;
    benchEl.textContent = 'bench: running…';
    try {
      const r = await benchGpu();
      const stamped = r === null ? null : { ...r, label };
      (window as unknown as { __benchResult: unknown }).__benchResult = stamped;
      if (r === null) {
        benchEl.textContent = 'bench: no timestamps';
      } else if (r.hiddenSteps > 0) {
        // Loud, because this is the failure that looks like success.
        benchEl.textContent = `bench: INVALID — ${r.hiddenSteps} hidden frames`;
      } else {
        benchEl.textContent =
          `bench ${r.median} ms (p05 ${r.p05} / p95 ${r.p95}) · ${r.bodies}b · n=${r.n}`;
      }
    } finally {
      benchRunning = false;
    }
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'b' || ev.key === 'B') { void runBench(); return; }
    if (ev.key === ']') { setCrowdCount(crowd.length + 1); return; }
    if (ev.key === '[') { setCrowdCount(Math.max(0, crowd.length - 1)); return; }
    if (ev.key === 'g' || ev.key === 'G') { gibEverything(); return; }
    if (ev.key === 'k' || ev.key === 'K') { forcedCollapse = true; return; }
    // MELT: 'm' starts it, 'M' (shift) clears it back to a solid body. Melting
    // IS the death — no forcedCollapse here; a ragdoll would topple it.
    if (ev.key === 'm') { startMelt(); return; }
    if (ev.key === 'M') { stopMelt(); return; }
    const limb = SEVER_KEYS[ev.key];
    if (!limb) return;
    const { body: next, chunk, stumpWound } = severLimb(current, limb);
    if (chunk.prims.length === 0) return;
    current = next;
    if (stumpWound) {
      wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
      pendingWounds.push(stumpWound);
    }
    pendingSevered.push(limb);
    spawnChunk(limb, chunk.origin, chunk.prims, undefined,
      [attachPoint(chunk.prims, torsoCentre())]);
    view.update(current);
    refreshWounds();
    rebind();
  });

  // -------------------------------------------------------------------------
  // Frame loop. setRenderCallback REPLACES rather than appends, so everything
  // per-frame has to live in this one function.
  // -------------------------------------------------------------------------
  const frames: number[] = [];
  let lastStamp = performance.now();

  /** Median of a sample window. The stat to quote — one hitch cannot swing it. */
  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.5)]!;
  }

  /** Every crowd body's CURRENT POSED field, as fed to the occluder hull.
   *  Was the rest field back when the crowd never moved; posed keeps the
   *  hull's exclusion zones tracking the animated bodies exactly as it does
   *  for body zero. With motion off this equals the rest field — unchanged
   *  behaviour. */
  function crowdBodies() {
    return crowdActors.map(a => a.lastPosed);
  }

  // Dynamic resolution. ON by default since 2026-08-23: zooming in on the
  // cyclops sat the raymarch exactly at budget — median 16.7, every fifth
  // frame a missed vsync — and the owner felt it as the frame rate tanking.
  // This is the lever built for that (cost is fill-bound; see
  // adaptive-scale.ts). Benchmarks stay reproducible because benchGpu
  // suspends the controller for its run, and the capture scripts
  // (blob-turntable, blob-render-check) switch it off through setAdaptive.
  // OFF BY DEFAULT again (owner, 2026-08-24 — the halo bisect's actual
  // boundary). Adaptive-on-by-default landed 2026-08-23 (5510057), and the
  // rung drops it makes when the camera closes on a wounded body are the
  // 'halo': a 0.45-0.2x flesh buffer bilinearly upscaled puts soft shimmering
  // fringes around every high-contrast crater edge — whitish over fresnel,
  // dark without it, worst close up, sweeping with the camera. Every build
  // the owner judged halo-free ran a FIXED 0.7; every build judged haloed ran
  // adaptive. The fps protection stays one keypress away (panel toggle); the
  // real fix is the raymarcher performance work (see the 2026-08-23 perf
  // spec), not resolution that melts exactly where the player is looking.
  let adaptiveEnabled = false;
  // 30 fps, not 60 (owner, 2026-08-23): at 60 the controller had to push a
  // retina window down to 0.2-0.35 scale when zoomed in, which is too soft;
  // 30 is the accepted target until the renderer itself is faster (see the
  // perf investigation in TASKS.md). setAdaptiveBudget overrides it live.
  let adaptiveBudgetMs = 1000 / 30;
  let adaptiveState = initialAdaptiveState(performance.now());
  /**
   * Shorter than the 120-frame display window on purpose. The controller has
   * to notice a camera move into a crowd within a few frames, where the
   * readout wants a stable number to print.
   */
  const ADAPTIVE_WINDOW = 30;

  /**
   * A probe that is failing shows it within a few frames — every frame over
   * budget — and each such frame is a visible stutter, so a failing probe
   * gets its verdict after PROBE_ABORT_FRAMES rather than the full window
   * (orbiting the zoomed cyclops: bursts of 8 spikes per failed probe, 2026-08-23).
   */
  const PROBE_ABORT_FRAMES = 8;
  function tickAdaptive(nowMs: number): void {
    if (!adaptiveEnabled) return;
    // Two ways a probe shows it is failing: the median over budget, or —
    // the usual one at vsync — the median still reads 16.7 while every few
    // frames a missed vsync reads 33+. Two such frames inside the first
    // PROBE_ABORT_FRAMES is not noise.
    const failingProbe = adaptiveState.probing && frames.length >= PROBE_ABORT_FRAMES
      && (median(frames) > adaptiveBudgetMs * 1.1
        || frames.filter(f => f > adaptiveBudgetMs * 1.8).length >= 2);
    if (frames.length < ADAPTIVE_WINDOW && !failingProbe) return;
    const recent = frames.slice(-ADAPTIVE_WINDOW);
    const sorted = [...recent].sort((a, b) => a - b);
    const next = stepAdaptive(adaptiveState, {
      nowMs,
      medianFrameMs: median(recent),
      // Missed vsyncs read as whole extra frames — the one spike signal wall
      // clock can see. See SPIKE_FACTOR.
      p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      budgetMs: adaptiveBudgetMs,
    });
    if (next.rung !== adaptiveState.rung) {
      sdfLayer.setScale(scaleForRung(next.rung));
      sizeSdfLayer();
      // The window still holds frames rendered at the OLD scale, and feeding
      // those to the controller again would have it react twice to one event —
      // straight into the oscillation this ladder exists to avoid.
      frames.length = 0;
    }
    adaptiveState = next;
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

    tickAdaptive(now);

    // AA EPSILON FOOTPRINT — immediately after tickAdaptive, because that is
    // what moves the SDF pass size and the one-pixel footprint is derived
    // from it. Placed here rather than beside the pose update: that block sits
    // inside the motion branch and does not run every frame, which left
    // aaCfg.x stuck at its placeholder.
    //
    // Computed from the live camera and pass height rather than
    // sdfLayer.pixelConeK: the layer handle reachable here reported a stale
    // size, and a silently-wrong footprint is exactly the kind of thing that
    // would be blamed on the shader later.
    {
      const hPx = Math.max(1, sdfLayer.targetSize.height);
      const k = Math.tan((camera.fov * Math.PI) / 360) / hPx;
      for (const v of [view, ...crowd]) v.uniforms.aaCfg.value.x = k;
    }

    // — FPV step (X1.23): controller + flight + detonation + hands, FIRST so
    //    a detonation's wounds/severs/impulses flow through the motion, rig
    //    and pose code below exactly like any other hit this frame. The
    //    gore port routes the bundle into the existing stack; nothing here
    //    re-implements it. —
    const fpvInput = fpvMode.mode === 'fpv'
      ? {
          dx: fpvMouseDx, dy: fpvMouseDy,
          forward: fpvKeys.forward, back: fpvKeys.back,
          left: fpvKeys.left, right: fpvKeys.right,
          press: fpvPress, release: fpvRelease,
        }
      : EMPTY_FPV_INPUT;
    fpvMouseDx = 0; fpvMouseDy = 0; fpvPress = false; fpvRelease = false;
    const fpvNow = now / 1000;
    // X1.27 task F2: CLIP mode alone defers the throw — the release signal
    // parks a pendingThrow and the grip clip's authored marker owns the
    // spawn (poseClipProp below). Prims AND the static baked hand keep the
    // default immediate behavior, unchanged.
    const fpvStep = stepFpvMode(
      fpvMode, fpvInput, dt, fpvNow, fpvWorld, gorePort, FPV_FLOOR_BOUNDS,
      handFieldUi.field === 'clip' ? 'deferred' : 'immediate');
    fpvMode = fpvStep.state;
    const ff = fpvStep.frame;

    // — X1.27 grip clip drive (F2 steps 2–4) ————————————————
    // (clipReleaseNow resets each frame; clipPropPose/gripFrame persist as
    //  the LAST rendered root/controller frame so a marker that fires while
    //  the hands are hidden still hands off from a real position.)
    clipReleaseNow = false;
    if (handFieldUi.field === 'clip' && handClip && dynamiteProp) {
      // (F2 step 4) the next bundle presents ONLY at recovery: no flight,
      // no parked throw, hand phase back at idle|light|cook.
      const presented = clipBundlePresented(fpvMode, ff.handPhase.phase);
      // Auto-loop: a settled held bundle tosses itself after the hold, so
      // the loop capture shows close → hold → toss → detonate → next close.
      if (gripPlayback === 'loop' && gripMotion.phase === 'held'
        && gripMotion.elapsedSec >= GRIP_LOOP_HOLD_SEC && fpvMode.pendingThrow === null) {
        playGripThrow(0.5);
      }
      // (2) the parked pendingThrow IS the controller's throw-request edge
      //     (consumed only from held; forceThrow above parks it this frame).
      const throwEdge = fpvMode.pendingThrow !== null;
      // (3) step the controller from frame dt. PAUSE freezes the clock at
      //     0 — the scrub is visual-only and never advances gameplay state.
      const gdt = gripPlayback === 'pause' ? 0 : dt * gripSpeed;
      const g = stepGripMotion(
        gripMotion, { bundlePresented: presented, throwRequested: throwEdge }, gdt);
      gripMotion = g.state;
      gripFrame = g.frame;
    }

    // Hands: the pure pose + jiggle landed in fpvMode; march the world-space
    // prims (also the splash target for the next detonation).
    let posedLocalHands: ReturnType<typeof posedHandPrims> | null = null;
    if (ff.mode === 'fpv') {
      posedLocalHands = posedHandPrims(HAND_REST, ff.handPose, fpvMode.jiggle);
      lastHandWorld = handPrimsToWorld(posedLocalHands, ff.eye, ff.yaw, ff.pitch);
      if (handsEnabled) {
        // lastHandWorld is [...left, ...right] — the order the splash wounds
        // bind to; each view gets its own slice with its wounds rebased.
        const nL = posedLocalHands.left.length;
        const w = splitHandWounds(handWounds, nL);
        const proj = handSheetProjections(posedLocalHands, ff.eye, ff.yaw, ff.pitch);
        // BAKED (X1.26) and CLIP (X1.27): only the right hand marches, from
        // the volume. The wound ring still uploads (wounds stamp onto the
        // baked field after either branch), and the volume's rigid placement
        // + clamped distal warp derive from this frame's prim pair —
        // unjiggled (pose+bob; the jiggle points pinned AT their targets)
        // versus jiggled (the live Verlet state) — via hand-volume-pose.
        if (handFieldUi.field === 'baked' || handFieldUi.field === 'clip') {
          handViews.right.update(lastHandWorld.slice(nL), w.right);
          const tgt = handPoseTargets(HAND_REST, ff.handPose);
          const still = {
            left: tgt.left.map(t => ({ pos: t, prev: t })),
            right: tgt.right.map(t => ({ pos: t, prev: t })),
          };
          const unjiggledWorld = handPrimsToWorld(
            posedHandPrims(HAND_REST, ff.handPose, still), ff.eye, ff.yaw, ff.pitch);
          const base = bakedHandPose(
            unjiggledWorld.slice(nL), lastHandWorld.slice(nL), proj.right);
          if (handFieldUi.field === 'baked') {
            // The X1.26 isolated static hand, unchanged.
            handViews.right.setVolumePose({ ...base, warpEnabled: handFieldUi.warp });
          } else if (handClip && gripFrame) {
            // (4) the adjacent-frame sample — manual scrub overrides grip01
            //     VISUALLY (frame sample only; never gameplay state).
            const grip01 = gripScrub !== null
              ? Math.max(0, Math.min(1, gripScrub))
              : gripFrame.grip01;
            clipSample = gripFrameSample(handClip.manifest, grip01);
            handViews.right.setVolumeFrame(
              clipSample.frame0, clipSample.frame1, clipSample.alpha);
            // (5) compose the camera-relative underhand wrist arc through
            //     THIS frame's hand-placement basis — never the scene
            //     camera's quaternion, which lands later and carries kick.
            const animated = applyGripMotion(
              base, gripFrame, gripCameraQuaternion(ff.yaw, ff.pitch));
            handViews.right.setVolumePose({ ...animated, warpEnabled: handFieldUi.warp });
            // (6) the GLB root derives from that EXACT animated pose.
            clipPropPose = bakedDynamitePose(animated, handClip.manifest.prop);
            clipReleaseNow = gripFrame.releaseNow;
            if (contactDebugOn) {
              poseContactDebug(animated, handClip.manifest.prop);
            }
          }
          handViews.right.setVisible(true);
          handViews.left.setVisible(false);
        } else {
          handViews.left.update(lastHandWorld.slice(0, nL), w.left);
          handViews.left.setProjection(proj.left);
          handViews.right.update(lastHandWorld.slice(nL), w.right);
          handViews.right.setProjection(proj.right);
          handViews.left.setVisible(true);
          handViews.right.setVisible(true);
        }
      } else {
        handViews.left.setVisible(false);
        handViews.right.setVisible(false);
      }
    } else {
      handViews.left.setVisible(false);
      handViews.right.setVisible(false);
    }
    updateChargeHud(ff.mode, ff.charge);
    if (fpvReadEl) {
      fpvReadEl.textContent = ff.mode === 'fpv'
        ? `charge ${(ff.charge * 100).toFixed(0)}% · ${ff.flight ? 'bundle away' : 'hands full'} · hand wounds ${handWounds.length} · sheet ${handSheetsBaked ? 'baked' : 'proc'}`
          + (handFieldUi.field === 'clip'
            ? ` · grip ${gripMotion.phase}${gripScrub !== null ? ' (scrub)' : ''} rel ${releaseCount}`
            : ` · vol static ${handFieldUi.staticLoad}/clip ${handFieldUi.clipLoad}`)
        : `god · ${ff.flight ? 'bundle away' : 'idle'} · bursts ${burstLayer.usingAtlas ? 'seq' : 'proc'}`;
    }

    // Gib physics: step every chunk, then re-pack its world-space field.
    // dt clamped like the rig's: a hidden tab pausing rAF must not integrate
    // the whole gap in one ballistic step and teleport every chunk.
    if (!cosmeticsFrozen) {
      for (const c of chunks) {
        c.state = stepChunk(c.state, Math.min(dt, 1 / 30));
        c.view.update(c.state);
      }
    }

    // Blood: every flying chunk trails droplets, the sim settles them into
    // splats, and the instanced view re-poses from sim state. Same dt clamp —
    // a hidden tab must not integrate the whole gap in one ballistic step.
    const bdt = Math.min(dt, 1 / 30);
    if (!cosmeticsFrozen) {
      emitTrails(
        bloodSim,
        chunks.map(c => ({ id: c.id, pos: c.state.pos, vel: c.state.vel })),
        bdt, Math.random);
      stepBlood(bloodSim, bdt, Math.random);
    }
    // sync still runs while frozen: the sim STATE is static, so this just
    // re-poses the instances from unchanged data (and re-billboards if the
    // camera moved). Skipping it would leave the view stale against its own
    // state the moment anything else touched it.
    bloodView.sync(bloodSim, camera);
    // The goo density quads pose from the same sim state, in the callback
    // (before the drawFn) — same contract as bloodView.sync.
    gooLayer.sync(bloodSim, camera);

    // Drive the flesh. With motion on, the orchestrator composes wander +
    // gait + stagger into per-point rest targets, IK locks the stance feet /
    // aims the head / presses the wound, then stepRig integrates toward them
    // exactly as before — the rig stays the single motion authority. A
    // collapse ramps the rest pull off, swaps in full gravity, adds the
    // one-sided rope limits and chunk-stepper floor contact, and the corpse
    // keeps rendering through the same posed-prims path (still shootable,
    // severable, gibbable — it is just horizontal now).
    const rdt = Math.min(dt, 1 / 30);
    if (motionEnabled && heroMotion.motionJoints) {
      // Sub-stepped integration (X1.22.1): consume the frame's real elapsed
      // time in ≤1/30-sized steps instead of the old flat 33 ms clamp, so a
      // stalled or hidden frame cannot stretch the fall into a death spiral.
      // The pipeline itself now lives in actor.ts's stepActorMotion — the
      // SAME function every crowd actor runs — so the per-body pose path
      // cannot drift between body zero and the crowd.
      heroSignals.shot = pendingShot;
      heroSignals.wounded = woundedLimbs();
      heroSignals.missing = missingLimbs();
      heroSignals.headAlive = current.clusters.find(c => c.limb === 'head')?.alive ?? false;
      heroSignals.forcedCollapse = forcedCollapse;
      // severed/freshWounds ARE pendingSevered/pendingWounds (same array
      // references): drained in place after the first sub-step.
      heroSignals.severed = pendingSevered;
      const f = stepActorMotion(heroMotion, {
        current, dt,
        wander: wanderOn, armStyle, headingFollow, gazeFollow,
        bounds: WANDER_BOUNDS, rng: motionRng, signals: heroSignals,
      });
      // shot/forcedCollapse are values — read the drained state back.
      pendingShot = heroSignals.shot;
      forcedCollapse = heroSignals.forcedCollapse;
      if (f) {
        if (motionReadEl) {
          motionReadEl.textContent =
            `meter ${f.meter.toFixed(2)} · ${f.phase}${f.hop ? ' · hop' : ''}` +
            (f.staggerKind ? ` · ${f.staggerKind}` : '') +
            (f.clutchArm ? ` · clutch ${f.clutchArm}` : '');
        }
        // Keep the shambler framed: the orbit target drifts after the body
        // (fast enough to follow a walk, slow enough to leave the orbit feel).
        if (!f.collapsed) {
          const k = Math.min(1, dt * 2.2);
          camTarget.x += (f.rootShift[0] - camTarget.x) * k;
          camTarget.z += (f.rootShift[2] - camTarget.z) * k;
        }
        // Noise anchor (motion-polish): the march's fbm rides the body's root
        // translation so the skin texture does not swim while walking. (Was
        // written per sub-step; only the last write survives to a render.)
        view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      }
    } else {
      // Statue mode — the pre-motion behaviour, verbatim. Pending signals
      // still drain so a re-enable can't fire a stale shot.
      pendingShot = null;
      pendingWounds.length = 0;
      pendingSevered.length = 0;
      forcedCollapse = false;
      heroMotion.bound = {
        ...heroMotion.bound,
        rig: stepRig(heroMotion.bound.rig, rdt, {
          gravity: [0, -2.2, 0],
          damping: 0.06,
          iterations: 4,
          restStiffness: 0.18,
        }),
      };
      view.setRootShift(0, 0); // statue: world-anchored noise, as before
    }
    if (meltState) meltState = stepMelt(meltState, Math.min(dt, 1 / 30));
    const posed = applyRig(current, heroMotion.bound, heroMotion.lastBodyYaw);
    lastPosed = posed;
    // Rest-space noise anchor (motion-polish task 6): `current` is the
    // authored, un-rigged body — the rest pose the noise texture is baked
    // into. Prim indices correspond 1:1 with the posed body (applyRig maps
    // prims without reordering; severing flips flags, never order).
    // Melt transforms BOTH posed and rest. Rest rows anchor the surface
    // noise; dragging them along is what makes the mottle flow WITH the goo
    // instead of the skin appearing to slide over a ghost of the old body.
    if (meltState) {
      view.update(
        { ...posed, prims: applyMelt(posed.prims, meltState) },
        { ...current, prims: applyMelt(current.prims, meltState) },
      );
    } else {
      view.update(posed, current);
    }
    if (sdfLayer.occluderEnabled) occluderHull.update([posed, ...crowdBodies()], woundSpheres(posed.prims));
    // Frozen: pin the shader clock so the eye-glow flicker (and anything else
    // keyed to it) stops advancing between two captures.
    if (!cosmeticsFrozen) view.setTime(performance.now() / 1000);
    // Re-derive the skull's sphere from the POSED primitives so the face
    // projection tracks the head through the jiggle — and hand it the rigid
    // head rotation so the PAINTED face rotates with the skull masses
    // instead of staying camera-front (owner playtest: eyes/brow sliding,
    // nose mass out the ear).
    const skull = headShape(posed);
    if (skull) view.setHeadShape(skull.centre, skull.axes);
    view.setHeadRotation(headQuatOf(heroMotion.bound, heroMotion.lastBodyYaw) ?? [0, 0, 0, 1]);
    uploadWounds(posed.prims);

    // — Crowd step: every body rigs and poses per frame, through the SAME
    //    stepActorMotion pipeline as body zero. Differences are policy, not
    //    machinery: empty signals (no shots/severs reach a crowd body), a
    //    per-index seed (phase offset — no marching band), wander bounds
    //    centred on each spawn, and a FIXED dt so poses are a pure function
    //    of frame count. motionEnabled gates EVERY actor — that is what makes
    //    setMotionEnabled(false) a real freeze for captures.
    if (motionEnabled) {
      for (const a of crowdActors) {
        if (!a.motion.motionJoints) continue;
        stepActorMotion(a.motion, {
          current: a.current,
          dt: CROWD_DT,
          wander: wanderOn,
          armStyle, headingFollow, gazeFollow,
          bounds: a.bounds,
          rng: a.rng,
          signals: CROWD_SIGNALS,
        });
        const cPosed = applyRig(a.current, a.motion.bound, a.motion.lastBodyYaw);
        a.lastPosed = cPosed;
        // Per-body repack + data-texture upload + skull re-derivation — the
        // per-body work the static crowd never paid, which is exactly what
        // this task exists to measure.
        a.view.update(cPosed, a.current);
        const rs = a.motion.lastRootShift;
        a.view.setRootShift(rs[0], rs[2], a.motion.lastBodyYaw);
        const cSkull = headShape(cPosed);
        if (cSkull) a.view.setHeadShape(cSkull.centre, cSkull.axes);
        a.view.setHeadRotation(
          headQuatOf(a.motion.bound, a.motion.lastBodyYaw) ?? [0, 0, 0, 1]);
      }
    }

    if (ff.mode === 'fpv') {
      // First-person camera: eye from the controller, aim from yaw/pitch,
      // plus the detonation kick as a roll/pitch deflection.
      camera.position.set(ff.eye[0], ff.eye[1], ff.eye[2]);
      const p = ff.pitch + ff.kick.pitch;
      const cp = Math.cos(p);
      camera.lookAt(
        ff.eye[0] + Math.sin(ff.yaw) * cp,
        ff.eye[1] + Math.sin(p),
        ff.eye[2] - Math.cos(ff.yaw) * cp,
      );
      camera.rotateZ(ff.kick.roll);
    } else {
      if (autoSpin) camYaw += dt * 0.35;
      const cp = Math.cos(camPitch);
      camera.position.set(
        camTarget.x + Math.sin(camYaw) * cp * camDist,
        camTarget.y + Math.sin(camPitch) * camDist,
        camTarget.z + Math.cos(camYaw) * cp * camDist,
      );
      camera.lookAt(camTarget);
    }
    refreshHeroTiles();

    // Held props. CLIP mode (F2 step 3): the GLB is posed purely by
    // ownership — hand root while held, the NEW flight on the marker frame,
    // flight afterwards (a god-cam spectator watches the arc), gone at
    // rest — and the procedural pair stays suppressed entirely (never the
    // twain, the plan's coherence rule). PRIMS: the existing stick +
    // cigarette path, byte-for-byte. BAKED: the isolated hand, no props.
    const fieldPolicy = handFieldFrame(handFieldUi, ff.mode, handsEnabled);
    const propSeats = ff.mode === 'fpv' && handsEnabled && posedLocalHands
      && fieldPolicy.primitiveProps
      ? handPropPoses(posedLocalHands, ff.eye, ff.yaw, ff.pitch)
      : null;
    if (handFieldUi.field === 'clip' && dynamiteProp) {
      poseClipProp(dt);
      dynamiteProp.flicker(
        fpvNow, propOwner === 'hand' && fpvMode.fpv.cook.phase === 'cooking');
    } else if (ff.flight) {
      stick.pose({ mode: 'flight', pos: ff.flight.pos, spin: ff.flight.spin, fuseBurning: true });
      stick.flicker(fpvNow, false);
    } else if (propSeats && STICK_IN_HAND.includes(ff.handPhase.phase)) {
      stick.pose({
        mode: 'hand',
        pos: propSeats.stick.pos,
        axis: propSeats.stick.axis,
        camQuat: camera.quaternion,
        cooking: ff.handPhase.phase === 'cook',
      });
      stick.flicker(fpvNow, ff.handPhase.phase === 'cook');
    } else {
      stick.pose({ mode: 'gone' });
    }
    // Cigarette: carried in every FPV phase and always lit; the ember flares
    // as it meets the fuse and through the burn.
    if (propSeats) {
      cig.pose({
        mode: 'hand',
        pos: propSeats.cig.pos,
        axis: propSeats.cig.axis,
        camQuat: camera.quaternion,
        hot: CIG_EMBER_HOT.includes(ff.handPhase.phase),
      });
      cig.flicker(fpvNow);
    } else {
      cig.pose({ mode: 'gone' });
    }
    burstLayer.update(dt, camera);

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
    saveOverride(activeCharacterName(), override);
    current = buildZombieBody(face, override);
    showErrors(current);
    view.update(current);
    refreshWounds();
    rebind();
    resetMotion(); // a rebuilt body is a new shambler, not a pose transfer
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
    // reapply() runs applyMaterial, which writes probeWeight/ambientGain from
    // the new preset — and every preset ships probeWeight 0, so switching the
    // light would silently switch bounce OFF while the box is still standing.
    // Re-assert the room gate after it.
    if (enclosure.group.visible) {
      u.bounceCfg.value.x = LIGHT_PRESETS[light].probeWeight || 1;
      u.bounceCfg.value.y = LIGHT_PRESETS[light].ambientGain;
      u.bounceCfg.value.w = LIGHT_PRESETS[light].chromaGain;
      syncBounceWidgets();
    }
  });

  // ── Environment bounce (lighting P1) ────────────────────────────────
  // The spike's whole user interface. The question it exists to answer is
  // narrow: does the shadow side taking the wall's colour make the figure
  // feel IN the room without softening the hard-key look? So the A/B has to
  // be one click, on the same frame, with nothing else moving.
  const bounceBox = addSection(panelEl, 'environment bounce');

  // addButton returns the element and the handler closes over it — the house
  // idiom, see texBtn at lab-main.ts:2516.
  const boxBtn = addButton(bounceBox, 'enclosure: off', () => {
    const on = !enclosure.group.visible;
    enclosure.setVisible(on);
    // The enclosure brings its own floor at y=0, exactly coplanar with the
    // lab's 20x20 ground plane — two surfaces at the same depth, which
    // z-fights into stair-stepped garbage across the whole floor and around
    // the character's contact shadow. Hide the lab floor while the box is up
    // rather than nudging one of them: a room has one floor, and an epsilon
    // offset would still tear at grazing angles.
    floor.visible = !on;
    // BOUNCE IS GATED ON THERE BEING A ROOM. The wall colours and box bounds
    // live in uniforms whether or not the meshes are drawn, so without this
    // gate "enclosure off + bounce on" lights the character from an INVISIBLE
    // Cornell box — and the same phantom room would follow the FPV hands, the
    // gibs, and eventually the game, none of which have walls. Presets keep
    // probeWeight 0 for exactly this reason; the lab is the only place that
    // knows a room exists, so the lab is what turns bounce on.
    u.bounceCfg.value.x = on ? LIGHT_PRESETS[light].probeWeight || 1 : 0;
    u.bounceCfg.value.y = LIGHT_PRESETS[light].ambientGain;
    u.bounceCfg.value.w = LIGHT_PRESETS[light].chromaGain;
    syncBounceWidgets();
    boxBtn.textContent = `enclosure: ${on ? 'on' : 'off'}`;
  });

  // SliderSpec is { label, min, max, step, get(), set(v) } — a getter, not a
  // starting value, so the slider re-reads the uniform rather than caching it.
  // Captured so the enclosure gate can push its value back into the widget.
  // addSlider renders its label once and on input; the gate writes the uniform
  // directly, so without this the panel reads "probeWeight 0.000" while bounce
  // is visibly on — a lie the next person would burn time on.
  const probeSlider = addSlider(bounceBox, {
    label: 'probeWeight', min: 0, max: 1, step: 0.01,
    get: () => u.bounceCfg.value.x,
    set: (v) => { u.bounceCfg.value.x = v; },
  });

  const chromaSlider = addSlider(bounceBox, {
    label: 'chromaGain', min: 0, max: 6, step: 0.05,
    get: () => u.bounceCfg.value.w,
    set: (v) => { u.bounceCfg.value.w = v; },
  });

  const gainSlider = addSlider(bounceBox, {
    label: 'ambientGain', min: 0, max: 4, step: 0.05,
    get: () => u.bounceCfg.value.y,
    set: (v) => { u.bounceCfg.value.y = v; },
  });

  /**
   * Push the live bounce uniforms back into their two sliders.
   *
   * Declared as a hoisted `function` on purpose: the light-preset handler above
   * calls it, and that handler is written before this point in the file.
   *
   * Dispatching 'input' is what re-renders the label — addSlider only formats
   * it on construction and on user input, so setting `.value` alone would move
   * the thumb and leave the number stale.
   */
  function syncBounceWidgets() {
    for (const [el, v] of [
      [probeSlider, u.bounceCfg.value.x], [gainSlider, u.bounceCfg.value.y],
      [chromaSlider, u.bounceCfg.value.w],
    ] as const) {
      el.value = String(v);
      el.dispatchEvent(new Event('input'));
    }
  }

  const ceilBtn = addButton(bounceBox, 'ceiling: on', () => {
    const on = u.bounceCfg.value.z < 0.5;
    u.bounceCfg.value.z = on ? 1 : 0;
    enclosure.setCeiling(on);
    ceilBtn.textContent = `ceiling: ${on ? 'on' : 'off'}`;
  });

  // One-click A/B. Parks probeWeight at 1 or 0 and remembers where the
  // slider was, so the comparison is repeatable rather than re-dialled by
  // hand each time — a slider nudged to 0.97 is not the same comparison.
  let parkedWeight = 1;
  const abBtn = addButton(bounceBox, 'A/B: flat', () => {
    if (u.bounceCfg.value.x > 0) {
      parkedWeight = u.bounceCfg.value.x;
      u.bounceCfg.value.x = 0;
      abBtn.textContent = 'A/B: flat';
    } else {
      u.bounceCfg.value.x = parkedWeight;
      abBtn.textContent = 'A/B: bounce';
    }
  });

  // Per-wall colour pickers. Each writes BOTH the mesh and the uniform, so
  // what the eye sees on the wall and what the shader bounces off it cannot
  // disagree — a mismatch there would invalidate the whole judgement.
  const WALL_UNIFORMS: Record<WallKey, typeof u.wallNegX> = {
    negX: u.wallNegX, posX: u.wallPosX, negY: u.wallNegY,
    posY: u.wallPosY, negZ: u.wallNegZ, posZ: u.wallPosZ,
  };
  for (const key of Object.keys(WALL_UNIFORMS) as WallKey[]) {
    const input = document.createElement('input');
    input.type = 'color';
    const c = enclosure.walls[key];
    input.value = '#' + new THREE.Color(c[0], c[1], c[2]).getHexString();
    input.addEventListener('input', () => {
      const col = new THREE.Color(input.value);
      enclosure.setWall(key, [col.r, col.g, col.b]);
      WALL_UNIFORMS[key].value.setRGB(col.r, col.g, col.b);
    });
    const row = document.createElement('label');
    row.textContent = key;
    row.appendChild(input);
    bounceBox.appendChild(row);
  }

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
  // The shape sliders live in their own box so switching preset can rebuild
  // them in place — otherwise they keep showing the previous head's numbers.
  const faceSliderBox = document.createElement('div');
  faceBox.appendChild(faceSliderBox);
  function rebuildFaceSliders() {
    faceSliderBox.textContent = '';
    for (const s of FACE_SLIDERS)
      addSlider(faceSliderBox, {
        label: s.key, min: s.min, max: s.max, step: 0.001,
        get: () => face[s.key],
        set: (v) => { (face[s.key] as number) = v; rebuildBody(); },
      });
  }
  rebuildFaceSliders();

  // Head SHAPE, as distinct from the face sheet below. The sheet is shared by
  // every zombie; the skull is the only thing that can differ between them.
  // Both selects start on '(character)' -- the .blob's own face block and
  // sheet -- and offer it as a way BACK. Before this the shape select showed
  // 'gaunt' while the character wore its own head, and choosing any preset
  // was persisted into the per-character override: the owner lost the
  // schoolgirl's head (and, with the texture select, her decal) by browsing
  // the dropdowns, with no control that put either back short of 'reset
  // overrides' (2026-08-23).
  const CHARACTER_OPT = '(character)';
  addSelect(faceBox, 'head shape', [CHARACTER_OPT, ...Object.keys(FACE_PRESETS)], CHARACTER_OPT, (v) => {
    if (v === CHARACTER_OPT) {
      try { Object.assign(face, DEFAULT_FACE, compileFace(parseBlob(activeCharacterSrc()))); }
      catch { Object.assign(face, DEFAULT_FACE); }
    } else {
      Object.assign(face, FACE_PRESETS[v]!);
    }
    rebuildBody();
    rebuildFaceSliders();
  });
  addSelect(faceBox, 'texture', [CHARACTER_OPT, ...Object.keys(FACE_TEXTURES)], CHARACTER_OPT, (v) => {
    if (v === CHARACTER_OPT) {
      if (!loadGeneratedFace()) loadFaceTexture('zombie-flat');
      return;
    }
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
    // POSED centre: with wander the authored skull position is behind the
    // camera, not in front of it.
    const c = lastPosed.clusters.find(cl => cl.limb === 'head')?.center;
    autoSpin = false;
    camTarget.set(c?.[0] ?? 0, c?.[1] ?? 1.55, c?.[2] ?? 0);
    camYaw = 0.62;
    camPitch = 0.06;
    camDist = 0.52;
  }
  function focusBody() {
    const c = torsoCentre(lastPosed);
    autoSpin = false;
    // Half the body's OWN height, not a constant. 1.05 was the zombie's
    // torso and on the 1.10 m mouse it aimed the orbit above the head — so a
    // nominally level shot looked ~28 degrees DOWN on the chest, straight
    // through the open collar at the flesh inside the shirt. That strip of
    // yellow was hunted as three different rendering bugs before the camera
    // was suspected.
    camTarget.set(c[0], boxHeight(view.object) * 0.5, c[2]);
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
  addSlider(lodBox, {
    // The single biggest lever measured: cost is close to linear in pixels, so
    // 0.5 here is ~4x on the raymarch. Level geometry stays full resolution.
    label: 'sdf resolution', min: 0.25, max: 1, step: 0.05,
    get: () => sdfLayer.scale,
    set: (v) => { sdfLayer.setScale(v); sizeSdfLayer(); },
  });
  // Dynamic resolution. Drives the slider above from the measured frame time
  // rather than by hand — the answer to "why does zooming IN get slower when
  // there is LESS on screen", which is that cost is per covered pixel.
  const adaptBtn = addButton(lodBox, `adaptive res: ${adaptiveEnabled ? 'on' : 'off'}`, () => {
    adaptiveEnabled = !adaptiveEnabled;
    adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
    adaptBtn.textContent = `adaptive res: ${adaptiveEnabled ? 'on' : 'off'}`;
  });
  addSlider(lodBox, {
    label: 'adaptive budget ms', min: 8, max: 40, step: 0.1,
    get: () => adaptiveBudgetMs,
    set: (v) => { adaptiveBudgetMs = v; },
  });
  const lodBtn = addButton(lodBox, 'lod: off', () => {
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

  const shellBtn = addButton(
    lodBox, `shell silhouette: ${shellSilhouette ? 'on' : 'off'}`,
    () => setShellDisplace(!shellSilhouette));

  // Legacy gamma (lodCfg.y): flesh presets were tuned against the WebGL lab's
  // missing output encode; ON cancels this path's sRGB encode so they read as
  // tuned. OFF shows the honest chain — the X1.3 retune target. Same
  // hero+crowd fan-out as setShellDisplace; chunks copy lodCfg at spawn.
  let legacyGamma = true;
  const gammaBtn = addButton(
    lodBox, 'legacy gamma: on',
    () => setLegacyGamma(!legacyGamma));
  function setLegacyGamma(on: boolean) {
    legacyGamma = on;
    for (const x of [view, ...crowd]) x.uniforms.lodCfg.value.y = on ? 1 : 0;
    gooLayer.setLegacyGamma(on);
    gammaBtn.textContent = `legacy gamma: ${on ? 'on' : 'off'}`;
  }
  /**
   * Wires shell displacement (woundCfg2.z) through the hero AND the crowd:
   * crowd views own their uniform set, and the bench gate is a 10-body
   * measurement, so a hero-only toggle is no measurement — same shape as
   * setSilhouetteNoise. Chunk views copy woundCfg2 from the hero template at
   * spawn, so chunks cut after this inherit the setting for free;
   * pre-existing chunks keep their spawn-time value (ChunkGpuView exposes no
   * uniforms), which is fine — they are airborne for seconds at most.
   */
  function setShellDisplace(on: boolean) {
    shellSilhouette = on;
    for (const x of [view, ...crowd]) x.uniforms.woundCfg2.value.z = on ? SHELL_AMP : 0;
    shellBtn.textContent = `shell silhouette: ${on ? 'on' : 'off'}`;
  }

  // WOUND SOFT SHADOW (march.wgsl.ts WOUND_SHADOW): iq-style sphere-traced
  // soft shadow fired only inside the wound zones — the cast shadow that
  // makes a crater read concave instead of ball-ish (owner decision
  // "cast shadow vs darker floor", 2026-08-24). Default ON at full strength.
  // Same hero+crowd fan-out as setShellDisplace: crowd views own their
  // uniform set, and chunk views copy woundShadowCfg from the hero template
  // at spawn.
  // OFF by default (owner A/B, 2026-08-24 evening): at full strength the
  // shadow march paints hard black rings hugging the craters — near the lip
  // the wound field is not a clean distance bound, so iq's k*h/t penumbra
  // gets corrupted h values and crushes whole neighbourhoods; it also cost
  // ~50 ms at a close view (the nearWound gate covers most of the body once
  // several wounds overlap). The toggle and slider stay for tuning; a rework
  // should march the SMOOTH pre-wound field and feather by the wound mask
  // instead of the binary zone gate.
  let woundShadowOn = false;
  let woundShadowStrength = 1.0;
  const wsBtn = addButton(dmgBox, 'wound shadow: on', () => {
    woundShadowOn = !woundShadowOn;
    applyWoundShadow();
  });
  addSlider(dmgBox, {
    label: 'wound shadow strength', min: 0, max: 1, step: 0.05,
    get: () => woundShadowStrength,
    set: (v) => { woundShadowStrength = v; woundShadowOn = v > 0; applyWoundShadow(); },
  });
  function applyWoundShadow() {
    for (const x of [view, ...crowd]) {
      x.uniforms.woundShadowCfg.value.x = woundShadowOn ? woundShadowStrength : 0;
    }
    wsBtn.textContent = `wound shadow: ${woundShadowOn && woundShadowStrength > 0 ? 'on' : 'off'}`;
  }
  function setWoundShadow(on: boolean) {
    woundShadowOn = on;
    applyWoundShadow();
  }

  // Metaball blood (gobs-and-goo task 5 + the X1.21.1 blur). The three
  // knobs that shape the surface: where the density field becomes goo, how
  // wide the soft band between bare and full-blood is (as a multiple of the
  // threshold), and how far the separable Gaussian blurs the density field
  // before the surface extracts it (0 = bypass — beaded pearls return).
  const gooBox = addSection(panelEl, 'goo');
  addSlider(gooBox, {
    label: 'goo threshold', min: 0.1, max: 0.95, step: 0.01,
    get: () => gooLayer.threshold,
    set: (v) => { gooLayer.setThreshold(v); },
  });
  addSlider(gooBox, {
    label: 'goo edge', min: 1.05, max: 3, step: 0.05,
    get: () => gooLayer.edge,
    set: (v) => { gooLayer.setEdge(v); },
  });
  addSlider(gooBox, {
    label: 'goo blur px', min: 0, max: 5, step: 0.5,
    get: () => gooLayer.blurPx,
    set: (v) => { gooLayer.setBlurPx(v); },
  });

  // Post (X1.25): jaggie cleanup that keeps the chunky low-res look. FXAA
  // softens stair-steps in the captured frame, smear is a temporal
  // exponential blend that hides edge crawl (ghosting on fast gibs is
  // on-aesthetic), sharp upscale swaps the CSS nearest stretch for a
  // UV-snapped bilinear (fat pixels, antialiased borders). Defaults per the
  // owner brief: FXAA on, smear 0.25, sharp upscale off.
  const postBox = addSection(panelEl, 'post');
  const fxaaBtn = addButton(postBox, `fxaa: ${postAa.fxaa ? 'on' : 'off'}`, () => {
    postAa.setFxaa(!postAa.fxaa);
    fxaaBtn.textContent = `fxaa: ${postAa.fxaa ? 'on' : 'off'}`;
  });
  addSlider(postBox, {
    label: 'smear', min: 0, max: POST_AA_SMEAR_MAX, step: 0.01,
    get: () => postAa.smear,
    set: (v) => { postAa.setSmear(v); },
  });
  const sharpBtn = addButton(
    postBox, `sharp upscale: ${postAa.sharpUpscale ? 'on' : 'off'}`, () => {
      postAa.setSharpUpscale(!postAa.sharpUpscale);
      sharpBtn.textContent = `sharp upscale: ${postAa.sharpUpscale ? 'on' : 'off'}`;
    });

  // Motion (X1.22): master + wander toggles, the forced-collapse hook for
  // the K key's panel twin, and the live damage-meter readout.
  const motionBox = addSection(panelEl, 'motion');
  const motionBtn = addButton(motionBox, `motion: ${motionEnabled ? 'on' : 'off'}`, () => {
    setMotionEnabled(!motionEnabled);
  });
  const wanderBtn = addButton(motionBox, `wander: ${wanderOn ? 'on' : 'off'}`, () => {
    setWander(!wanderOn);
  });
  const armStyleBtn = addButton(motionBox, `arms: ${armStyle}`, () => {
    setArmStyle(armStyle === 'reach' ? 'swing' : 'reach');
  });
  addButton(motionBox, 'force collapse', () => { forcedCollapse = true; });
  motionReadEl = document.createElement('div');
  motionReadEl.style.cssText = 'font:11px monospace;color:#9c9;';
  motionBox.appendChild(motionReadEl);

  // FPV (X1.23): enter/exit (Tab is the keyboard twin), the hands A/B
  // toggle the spec's perf gate needs, and a live readout.
  const fpvBox = addSection(panelEl, 'fpv');
  const fpvBtn = addButton(fpvBox, 'fpv: enter', () => {
    if (fpvMode.mode === 'fpv') exitFpv(); else enterFpv();
  });
  const handsBtn = addButton(fpvBox, `hands: ${handsEnabled ? 'on' : 'off'}`, () => {
    setFpvHands(!handsEnabled);
  });
  function setFpvHands(on: boolean) {
    handsEnabled = on;
    if (fpvMode.mode === 'fpv') {
      handViews.left.setVisible(on && handFieldUi.field === 'prims');
      handViews.right.setVisible(on);
    }
    handsBtn.textContent = `hands: ${on ? 'on' : 'off'}`;
  }
  // Hand-detail sheet weights, split like the face box's texStrength/texRelief.
  // handTexStrength defaults to 0 ON PURPOSE: the sheet is a HEIGHT map, and
  // feeding it into the albedo multiply is what stained the flesh (see
  // HAND_SHEET_TUNING). It is exposed only so the effect can be re-seen.
  let handTexStrength: number = HAND_SHEET_TUNING.detailStrength;
  let handRelief: number = HAND_SHEET_TUNING.relief;
  function applyHandSheetTuning() {
    handViews.left.setSheetTuning(handTexStrength, handRelief);
    handViews.right.setSheetTuning(handTexStrength, handRelief);
  }
  applyHandSheetTuning();
  addSlider(fpvBox, {
    label: 'handRelief', min: 0, max: 3, step: 0.05,
    get: () => handRelief,
    set: (v) => { handRelief = v; applyHandSheetTuning(); },
  });
  addSlider(fpvBox, {
    label: 'handTexStrength', min: 0, max: 1, step: 0.01,
    get: () => handTexStrength,
    set: (v) => { handTexStrength = v; applyHandSheetTuning(); },
  });
  // ——— Hand field + grip clip (X1.26 look gate → X1.27 task F3) ————————
  // `hand field` cycles prims → baked → clip (a hop the policy refuses —
  //  load not ready — shows the pending state in the label and retries on
  //  the next press); `hand warp` gates the distal jiggle domain warp
  //  (static first!); `hand clay` toggles the neutral-clay look; `grip` —
  //  play/pause/loop; `grip progress` — the visual-only scrubber; `grip
  //  speed` — the controller-clock multiplier; `contact debug` — the
  //  authored grip-seat/bundle-hull diagnostic. Clip/GLB load errors show
  //  inline below the section.
  const handFieldBtn = addButton(fpvBox, 'hand field: prims', () => {
    const order: HandFieldMode[] = ['prims', 'baked', 'clip'];
    setHandField(order[(order.indexOf(handFieldUi.field) + 1) % order.length]!);
  });
  const handWarpBtn = addButton(fpvBox, 'hand warp: off', () => {
    setHandWarp(!handFieldUi.warp);
  });
  const handClayBtn = addButton(fpvBox, 'hand clay: off', () => {
    setHandClay(!handFieldUi.clay);
  });
  const gripPlaybackBtn = addButton(fpvBox, 'grip: play', () => {
    setGripPlayback(
      gripPlayback === 'play' ? 'pause' : gripPlayback === 'pause' ? 'loop' : 'play');
  });
  addSlider(fpvBox, {
    label: 'grip progress', min: 0, max: 1, step: 0.01,
    get: () => gripScrub ?? gripFrame?.grip01 ?? 0,
    set: (v) => { setGripProgress(v); },
  });
  addSlider(fpvBox, {
    label: 'grip speed', min: 0.25, max: 2, step: 0.05,
    get: () => gripSpeed,
    set: (v) => { setGripSpeed(v); },
  });
  const contactDebugBtn = addButton(fpvBox, 'contact debug: off', () => {
    setContactDebug(!contactDebugOn);
  });
  /** Inline clip/GLB (and static) load errors — exposed, never swallowed. */
  const handLoadErrorEl = document.createElement('div');
  handLoadErrorEl.style.cssText =
    'font:11px monospace;color:#ff6464;white-space:pre-wrap;max-width:230px;';
  fpvBox.appendChild(handLoadErrorEl);
  function refreshHandLoadErrors() {
    handLoadErrorEl.textContent = [
      staticVolumeError ? `static: ${staticVolumeError}` : '',
      handFieldUi.clipError ? `clip: ${handFieldUi.clipError}` : '',
    ].filter(Boolean).join('\n');
  }
  /** Playback setter: play/loop clear the visual scrub override (scrub is
   *  pause-only by construction); pause just freezes the controller clock. */
  function setGripPlayback(mode: 'pause' | 'play' | 'loop') {
    gripPlayback = mode;
    if (mode !== 'pause') gripScrub = null;
    gripPlaybackBtn.textContent = `grip: ${mode}`;
  }
  /** SCRUB IS VISUAL ONLY (F3 step 2): sets the manual grip01 that drives
   *  the frame sample + held prop pose, and pauses the controller clock so
   *  the pose holds. It never parks a pendingThrow, never spawns a flight,
   *  and touches no fuse — only a pointer release or playGripThrow enters
   *  the deferred throw flow. */
  function setGripProgress(grip01: number) {
    gripScrub = Number.isFinite(grip01) ? Math.max(0, Math.min(1, grip01)) : null;
    gripPlayback = 'pause';
    gripPlaybackBtn.textContent = 'grip: pause';
  }
  function setGripSpeed(multiplier: number) {
    gripSpeed = Number.isFinite(multiplier) ? Math.max(0.05, Math.min(4, multiplier)) : 1;
  }
  function setContactDebug(on: boolean) {
    contactDebugOn = on;
    contactDebug.visible = on;
    if (!on) return;
    // Rescale to the loaded contract immediately (a fresh toggle should not
    // wait a frame), and re-pose on the next clip frame from the drive.
    if (handClip) {
      contactSphere.scale.setScalar(handClip.manifest.prop.contactRadiusM);
    }
    contactDebugBtn.textContent = `contact debug: ${on ? 'on' : 'off'}`;
  }
  /** The scripted toss: parks a DEFERRED pending throw from the stored aim
   *  (forceThrow 'deferred'); the clip's authored marker performs the
   *  ownership handoff. The only automation path into the throw flow. */
  function playGripThrow(charge = 1) {
    gripScrub = null;
    gripPlayback = 'play';
    gripPlaybackBtn.textContent = 'grip: play';
    fpvMode = forceThrow(
      fpvMode, Math.max(0, Math.min(1, charge)), performance.now() / 1000, 'deferred');
  }
  /** Swaps the pure UI state and applies its side effects to the views.
   *  Field changes rebind the right view's march field and its sheet (the
   *  prim grip sheet does not fit the open baked hand); label refreshes are
   *  idempotent so load-settle can call this too. */
  function applyHandField(next: HandFieldUi) {
    const prev = handFieldUi;
    handFieldUi = next;
    if (next.field !== prev.field) {
      if (next.field === 'baked') {
        if (!handVolume) throw new Error('baked hand field: volume not loaded');
        handViews.right.setField('volume', handVolume);
        handViews.right.setSheet(null);
      } else if (next.field === 'clip') {
        if (!handClip || !dynamiteProp) {
          throw new Error('clip hand field: clip/GLB not loaded');
        }
        handViews.right.setField('volume', handClip);
        handViews.right.setSheet(null);
        // The procedural pair goes dark for the whole clip session — the
        // clip's GLB replaces it and the plan forbids pairing the two.
        stick.pose({ mode: 'gone' });
        cig.pose({ mode: 'gone' });
        // A fresh entry re-presents naturally: the controller restarts at
        // open and the first frame's clipBundlePresented steps it into
        // closing (open → firm-grip from the top).
        gripMotion = makeGripMotion(false);
        gripScrub = null;
      } else {
        // Leaving clip: the GLB goes gone, and a still-parked pending throw
        // releases EXACTLY as the immediate path would have (at the aim's
        // throw origin, zero hand velocity) — no input swallowed, no
        // invisible hand-owned projectile left parked.
        if (prev.field === 'clip') {
          dynamiteProp?.pose({ mode: 'gone' });
          propOwner = 'gone';
          gripScrub = null;
          if (fpvMode.pendingThrow !== null) {
            fpvMode = releasePendingThrow(fpvMode, throwOrigin(fpvMode.fpv), [0, 0, 0]);
          }
        }
        handViews.right.setField('prims');
        handViews.right.setSheet(handSheets.grip);
      }
      // Visibility is normally the frame block's job, but a switch while
      // NOT in FPV would otherwise leave a stale hidden/shown left view
      // until the next entry — set it from the same policy now.
      const vis = handFieldFrame(next, fpvMode.mode, handsEnabled);
      handViews.left.setVisible(vis.leftHand);
      handViews.right.setVisible(vis.rightHand);
    }
    const suffix = next.field === 'baked' && next.staticLoad !== 'ready' ? ` (${next.staticLoad})`
      : next.field === 'clip' && next.clipLoad !== 'ready' ? ` (${next.clipLoad})` : '';
    handFieldBtn.textContent = `hand field: ${next.field}${suffix}`;
    handWarpBtn.textContent = `hand warp: ${next.warp ? 'on' : 'off'}`;
    handClayBtn.textContent = `hand clay: ${next.clay ? 'on' : 'off'}`;
    refreshHandLoadErrors();
  }
  function setHandField(field: HandFieldMode) {
    applyHandField(requestHandField(handFieldUi, field));
  }
  function setHandWarp(on: boolean) {
    applyHandField({ ...handFieldUi, warp: on });
  }
  function setHandClay(on: boolean) {
    handViews.right.setClay(on); // saves/restores the flesh settings itself
    applyHandField({ ...handFieldUi, clay: on });
  }
  applyHandField(handFieldUi);
  fpvReadEl = document.createElement('div');
  fpvReadEl.style.cssText = 'font:11px monospace;color:#9c9;';
  fpvBox.appendChild(fpvReadEl);

  /** Motion master. Off = the pre-X1.22 statue loop, verbatim. On = a fresh
   *  shambler from the origin. */
  function setMotionEnabled(on: boolean) {
    motionEnabled = on;
    if (on) {
      resetMotion();
    } else if (heroMotion.motionJoints) {
      // Statue at wherever the body ended up, in its authored pose — not
      // frozen mid-stride, and not snapped back to the origin either.
      heroMotion.bound = {
        ...heroMotion.bound,
        rig: {
          ...heroMotion.bound.rig,
          restPose: heroMotion.motionJoints.base.map(
            v => [v[0] + heroMotion.lastRootShift[0], v[1], v[2] + heroMotion.lastRootShift[2]] as Vec3),
        },
      };
      camTarget.x = heroMotion.lastRootShift[0];
      camTarget.z = heroMotion.lastRootShift[2];
    }
    motionBtn.textContent = `motion: ${on ? 'on' : 'off'}`;
  }
  /** Wander toggle — locomotion only; hit reactions stay live either way. */
  function setWander(on: boolean) {
    wanderOn = on;
    wanderBtn.textContent = `wander: ${on ? 'on' : 'off'}`;
  }
  /** Arm style: 'reach' (mummy-arms, the default) or 'swing' (counter-swing). */
  function setArmStyle(s: ArmStyle) {
    armStyle = s;
    armStyleBtn.textContent = `arms: ${s}`;
  }
  /** Heading-follow gain 0..1 — 0 is the strafe-walker (body never turns). */
  function setHeadingFollow(v: number) {
    headingFollow = Math.max(0, Math.min(1, v));
  }
  /** Gaze-follow gain 0..1 — 0 pins the gaze to the wander target. */
  function setGazeFollow(v: number) {
    gazeFollow = Math.max(0, Math.min(1, v));
  }
  addSlider(motionBox, {
    label: 'gaze follow', min: 0, max: 1, step: 0.05,
    get: () => gazeFollow,
    set: setGazeFollow,
  });

  const actionBox = addSection(panelEl, 'actions');
  addButton(actionBox, 'respawn', () => {
    wounds = [];
    override = loadOverride(activeCharacterName());
    rebuildBody();
  });
  addButton(actionBox, 'copy override JSON', () => {
    void navigator.clipboard.writeText(serializeOverride(override));
  });
  addButton(actionBox, 'reset overrides', () => {
    clearOverride(activeCharacterName());
    override = {};
    // Re-seed the face from the .blob BEFORE rebuilding: rebuildBody saves
    // `face` back into the override, so resetting storage alone re-persisted
    // whatever the sliders had done to the skull (owner, 2026-08-23: the
    // schoolgirl's cranium stayed a skin dome above her hair after reset).
    try { Object.assign(face, DEFAULT_FACE, compileFace(parseBlob(activeCharacterSrc()))); }
    catch { Object.assign(face, DEFAULT_FACE); }
    rebuildBody();
    rebuildFaceSliders();
    if (!loadGeneratedFace()) loadFaceTexture('zombie-flat');
  });

  reapply();

  // Dev handle for inspecting lab state from the console, and for driving the
  // camera during automated visual checks. Lab-only; nothing in the game reads it.
  boot.mainEnd = bootMark();
  (window as unknown as { __sdfLab: unknown }).__sdfLab = {
    /** Boot timeline in ms since navigation start. See main()'s comment. */
    boot,
    // ——— MELT ————————————————————————————————————————————————————————————
    //   m / M                  start / clear
    //   __sdfLab.melt()        start from the console
    //   __sdfLab.meltOff()     clear back to the solid body
    //   __sdfLab.meltDirect(t) jump to a progress value — deterministic, so
    //                          the capture script shoots the same frames twice
    //   __sdfLab.meltState()
    melt: () => startMelt(),
    meltOff: () => stopMelt(),
    meltDirect: (t: number) => meltDirect(t),
    meltState: () => (meltState ? { t: meltState.t } : null),
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
    /** One shared NodeMaterial, asynchronously prepared before interaction. */
    chunkMaterial: {
      count: 1,
      warmupMs: chunkMaterialWarmupMs,
      get lastGibWorstFrameMs() { return lastGibWorstFrameMs; },
    },
    get bodyCount() { return crowd.length + 1; },
    /**
     * Stop everything that animates on its own, so two captures of one pose
     * are pixel-comparable. See `cosmeticsFrozen`'s declaration for the
     * measurements that made this necessary.
     *
     * Freezes chunk physics, the blood sim (and with it the goo density
     * layer, which poses from the same state) and the shader clock. It does
     * NOT freeze the rig — call `setMotionEnabled(false)` / `setWander(false)`
     * for that, and do it BEFORE stamping wounds so their placement is
     * deterministic too.
     *
     * The capture recipe that actually works:
     *   setMotionEnabled(false); setWander(false);  // pose
     *   stampWounds(n); / sever keys                // damage
     *   freezeCosmetics();                          // then silence the debris
     */
    freezeCosmetics(on = true) { cosmeticsFrozen = on; return cosmeticsFrozen; },
    get cosmeticsFrozen() { return cosmeticsFrozen; },
    /**
     * Suspend/resume the render loop itself. The last presented frame stays
     * on the canvas, so a capture taken while suspended is EXACTLY the frame
     * that was rendered — nothing (statue-mode rig stepping included) can
     * advance between the freeze and the shot. The statue rig keeps
     * integrating with real dt even with motion off and cosmetics frozen,
     * which is a micro-jitter no amount of settling removes; pausing the loop
     * is the only capture primitive that is bit-stable.
     */
    pauseLoop(on = true) { handle.setLoopRunning(!on); return !on; },
    /**
     * Canonical frozen frame for automated captures: suspend the loop, reset
     * the hero to its authored rest pose at the origin (fresh bind, fresh
     * clocks — the respawn path without the body rebuild), then advance a
     * FIXED number of FIXED-dt frames so every verlet transient settles
     * identically on every page load.
     *
     * WHY NOT settle-and-shoot. The statue-mode rig integrates REAL rAF dt
     * forever, so its micro-equilibrium depends on the boot's timing history:
     * two page loads never agree bit-for-bit (measured 2026-08-25: three
     * consecutive settled captures, three different framebuffer hashes). With
     * the reset + fixed-dt walk-in, the frozen frame is a pure function of
     * (code, seed, frame count), which is what lets a pre/post-refactor diff
     * or a re-boot repeatability gate mean anything.
     *
     * Leaves the loop SUSPENDED — nothing can move between this and the
     * shot; pauseLoop(false) resumes.
     */
    async holdStill(frames = 120) {
      handle.setLoopRunning(false);
      resetMotion();
      camTarget.x = 0;
      camTarget.z = 0;
      view.update(current);
      refreshWounds();
      // Crowd actors: same canonicalization as the hero — fresh seeded motion
      // record, pose back to the spawn field, root shift and head rotation
      // zeroed. The frozen crowd frame is then also a pure function of seed,
      // which is what makes two boots' captures comparable.
      for (const a of crowdActors) {
        a.motion = makeActorMotion(a.current, { seed: crowdSeed(a.index, MOTION_SEED), start: a.spawn });
        a.lastPosed = a.current;
        a.view.update(a.current, a.current);
        a.view.setRootShift(0, 0);
        const s = headShape(a.current);
        if (s) a.view.setHeadShape(s.centre, s.axes);
        a.view.setHeadRotation([0, 0, 0, 1]);
      }
      for (let i = 0; i < frames; i++) handle.step(1 / 60);
      await handle.resolveGpu();
      return frames;
    },
    /** The march uniforms — lets any of them be tuned live from the console. */
    uniforms: u,
    /** The SDF layer — occluder/cone toggles for A/B experiments. */
    sdfLayer,
    /**
     * PERF TASK 5 step 3: the hero body's per-tile fold lists. setTiles(true)
     * makes the hero's draw march its pixel's tile entry list instead of the
     * cluster walk; false restores it exactly. The binner refreshes per frame
     * from the live camera, so this composes with motion, FPV and orbit.
     */
    setTiles(on = true) { setHeroTiles(on); return on; },
    /** Antialiasing epsilon strength: 0 = off (ship default), 1 = end the
     *  march at exactly one pixel footprint. See march.wgsl.ts's hitEps. */
    setAaEps(v: number) {
      for (const x of [view, ...crowd]) x.uniforms.aaCfg.value.y = v;
      return v;
    },
    get tilesEnabled() { return heroTilesEnabled; },
    /**
     * UNIT A/B (compute port): bins the CURRENT camera/groups/grid on the GPU
     * and on the CPU reference binner, reads the GPU buffers back, and diffs
     * per tile — counts AND every entry field, order-sensitive (both emit
     * ascending-group order, so exact equality is the expected outcome).
     * Returns per-tile mismatch tallies plus a bounded sample of diffs.
     */
    async tileAB() {
      if (!view.tiles) return { error: 'tiles not created' };
      // The frame loop re-bins the SAME buffers every frame when tile fold is
      // on, and readback() awaits — so a live refreshHeroTiles() would land
      // between this bin and this readback and we would diff the frame loop's
      // lists, not ours. Suspend it for the duration; measured: with tiles on,
      // 18k phantom "mismatches" that vanish at rest.
      const tilesWere = heroTilesEnabled;
      heroTilesEnabled = false;
      try {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const groups = view.getTileGroups();
      const blendK = view.uniforms.counts.value.w;
      const t = sdfLayer.targetSize;
      const grid = { widthPx: t.width, heightPx: t.height };
      view.tiles.bin(groups, camera, blendK, grid);
      // BOTH SIDES BEFORE THE AWAIT. readback() yields, the adaptive
      // controller can resize sdfLayer during that yield, and the CPU
      // reference would then be built for a DIFFERENT grid than the one we
      // just binned — which threw "tile (24,0) outside 24x24" outright. Bin
      // the reference here, from the snapshot, while nothing can move.
      const cpu = binnerForSdfSize(grid.widthPx, grid.heightPx).bin(groups, camera, blendK);
      const gpu = await heroTileBinding.readback();
      // Per-group range diff against a JS reimplementation of the CPU
      // projection (f64) — localises classification flips to the exact group
      // and the exact branch (cover-all vs reject vs bounds).
      const vmE = camera.matrixWorldInverse.elements;
      const pe = camera.projectionMatrix.elements;
      const W = grid.widthPx, H = grid.heightPx;
      const focalY = pe[5]!;
      const blendReach = blendK * 4.0;
      const v = camera.position.clone();
      const jsRanges: number[][] = [];
      for (const g of groups) {
        v.set(g.center[0], g.center[1], g.center[2]).applyMatrix4(camera.matrixWorldInverse);
        const rBlend = g.radius + blendReach;
        const nearDist = -v.z - rBlend;
        const clipW = pe[3]! * v.x + pe[7]! * v.y + pe[11]! * v.z + pe[15]!;
        let tx0 = 0, tx1 = -1, ty0 = 0, ty1 = -1;
        if (nearDist <= 0 || clipW <= 0) {
          tx1 = cpu.tilesX - 1; ty1 = cpu.tilesY - 1;
        } else {
          const clipX = pe[0]! * v.x + pe[4]! * v.y + pe[8]! * v.z;
          const clipY = pe[1]! * v.x + pe[5]! * v.y + pe[9]! * v.z;
          const ndcX = clipX / clipW, ndcY = clipY / clipW;
          const cx = (ndcX * 0.5 + 0.5) * W;
          const cy = (0.5 - ndcY * 0.5) * H;
          const rpix = (rBlend / nearDist) * focalY * (H / 2);
          if (!(cx + rpix <= 0 || cx - rpix >= W || cy + rpix <= 0 || cy - rpix >= H)) {
            tx0 = Math.max(0, Math.floor((cx - rpix) / 16));
            tx1 = Math.min(cpu.tilesX - 1, Math.floor((cx + rpix - 1e-6) / 16));
            ty0 = Math.max(0, Math.floor((cy - rpix) / 16));
            ty1 = Math.min(cpu.tilesY - 1, Math.floor((cy + rpix - 1e-6) / 16));
          }
        }
        jsRanges.push([tx0, tx1, ty0, ty1, nearDist, clipW]);
      }
      const rangeSamples: unknown[] = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const gr = [gpu.ranges[gi * 4]!, gpu.ranges[gi * 4 + 1]!, gpu.ranges[gi * 4 + 2]!, gpu.ranges[gi * 4 + 3]!];
        const jr = jsRanges[gi]!;
        if (gr[0] !== jr[0] || gr[1] !== jr[1] || gr[2] !== jr[2] || gr[3] !== jr[3]) {
          if (rangeSamples.length < 6) {
            rangeSamples.push({
              gi, gpu: gr, js: jr.slice(0, 4),
              nearDist: jr[4], clipW: jr[5],
              centre: groups[gi]!.center, radius: groups[gi]!.radius,
            });
          }
        }
      }
      let tilesCompared = 0;
      let countMismatches = 0;
      let entryMismatches = 0;
      let extraEntries = 0;
      const samples: unknown[] = [];
      for (let ty = 0; ty < gpu.tilesY; ty++) {
        for (let tx = 0; tx < gpu.tilesX; tx++) {
          tilesCompared++;
          const gn = cpu.countAt(tx, ty);
          const h = (ty * gpu.tilesX + tx) * 2;
          const gBase = gpu.headers[h]!;
          const gN = gpu.headers[h + 1]!;
          if (gN < gn) {
            // GPU list SHORTER than the CPU's — entries were lost. This is
            // the hole class and the only hard failure direction.
            countMismatches++;
            if (samples.length < 8) {
              samples.push({ tile: [tx, ty], cpuCount: gn, gpuCount: gN });
            }
            continue;
          }
          // SUBSEQUENCE match: both lists are ascending-group order, but the
          // GPU's f32 projection carries a sub-tile safety pad, so its list
          // may hold extra boundary groups the CPU's f64 edges excluded.
          // Every CPU entry must appear, in order, inside the GPU list;
          // unmatched GPU entries are counted as (benign) extras.
          let gi = 0;
          let gj = 0;
          while (gi < gn && gj < gN) {
            const o = (gBase + gj) * 12;
            const ce = cpu.entryAt(tx, ty, gi);
            const same =
              ce!.center[0] === gpu.entries[o] && ce!.center[1] === gpu.entries[o + 1] &&
              ce!.center[2] === gpu.entries[o + 2] && ce!.radius === gpu.entries[o + 3] &&
              ce!.start === gpu.entries[o + 4] && ce!.count === gpu.entries[o + 5] &&
              ce!.distort === gpu.entries[o + 6] && ce!.flags === gpu.entries[o + 7] &&
              ce!.bodyIndex === gpu.entries[o + 8];
            if (same) { gi++; gj++; }
            else { gj++; extraEntries++; }
          }
          if (gi < gn) {
            // CPU entries with no GPU counterpart — the hole class.
            countMismatches++;
            entryMismatches += gn - gi;
            if (samples.length < 8) {
              samples.push({ tile: [tx, ty], missingFrom: gi, cpuCount: gn, gpuCount: gN });
            }
          } else {
            extraEntries += gN - gj;
          }
        }
      }
      return {
        tilesCompared, countMismatches, entryMismatches, extraEntries,
        totalEntries: { cpu: cpu.totalEntries, gpu: gpu.totalEntries },
        grid: { tilesX: gpu.tilesX, tilesY: gpu.tilesY },
        groups: groups.length,
        rangeMismatches: rangeSamples.length > 0 ? rangeSamples : undefined,
        clampedTiles: cpu.clampedTiles,
        samples,
      };
      } finally { heroTilesEnabled = tilesWere; }
    },
    /**
     * The metaball blood layer — threshold/edge/blur setters for console
     * tuning, mirroring the panel's goo section (which reaches only the
     * same three).
     */
    gooLayer: {
      setThreshold: (v: number) => gooLayer.setThreshold(v),
      setEdge: (v: number) => gooLayer.setEdge(v),
      setBlurPx: (v: number) => gooLayer.setBlurPx(v),
      get threshold() { return gooLayer.threshold; },
      get edge() { return gooLayer.edge; },
      get blurPx() { return gooLayer.blurPx; },
    },
    /**
     * Stamps n blast wounds on the front of the torso by raycasting
     * straight-on — a deterministic heavy-damage state for automated visual
     * checks, with no pointer events or camera dependence involved.
     */
    stampWounds(n: number) {
      const c = torsoCentre(lastPosed);
      for (let i = 0; i < n; i++) {
        const ox = ((i % 3) - 1) * 0.06;
        const oy = Math.floor(i / 3) * 0.07 - 0.05;
        const hit = raycastBody([c[0] + ox, c[1] + oy, c[2] + 3], [0, 0, -1], lastPosed);
        if (!hit) continue;
        const w = worldHitToWound(
          lastPosed.prims, hit, WOUND_PROFILES.blast.radius, 'blast', heroMotion.lastBodyYaw,
          p => sdBody(p, lastPosed));
        wounds = pushWound(wounds, w, MAX_WOUNDS);
        pendingWounds.push(w); // stamped blasts feed the damage meter too
      }
      refreshWounds();
    },
    /**
     * Stamps ONE blast by raycasting from `origin` along `dir` — the dev
     * twin of the click path for automated visual checks on spots the
     * torso grid cannot reach (forearms, head, legs).
     */
    stampWoundAt(origin: [number, number, number], dir: [number, number, number]) {
      const o = { x: origin[0], y: origin[1], z: origin[2] };
      const d0 = { x: dir[0], y: dir[1], z: dir[2] };
      const l = Math.hypot(d0.x, d0.y, d0.z) || 1;
      const d = { x: d0.x / l, y: d0.y / l, z: d0.z / l };
      const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z], lastPosed);
      if (!hit) return null;
      const w = worldHitToWound(
        lastPosed.prims, hit, WOUND_PROFILES.blast.radius, 'blast', heroMotion.lastBodyYaw,
        p => sdBody(p, lastPosed));
      wounds = pushWound(wounds, w, MAX_WOUNDS);
      refreshWounds();
      return hit;
    },
    setCrowdCount,
    gibEverything,
    /** The respawn button's console twin — a fresh body AND a fresh shambler.
     *  resetMotion alone re-binds the rig of whatever body is current, which
     *  for a gibbed corpse is a body-shaped nothing. */
    respawn() {
      wounds = [];
      override = loadOverride(activeCharacterName());
      rebuildBody();
    },
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
        bodies: crowd.length + 1,
      };
    },
    /** Drops the sample window, so a reading cannot include the old setting. */
    resetStats() { frames.length = 0; },
    /**
     * The measurement to quote. Takes the frame clock away from
     * requestAnimationFrame and drives `frameCount` frames by hand, awaiting
     * the timestamp resolve after each one.
     *
     * Two reasons this exists rather than reading `stats()`:
     *
     * 1. **rAF stops when the page is not composited.** Automated runs live in
     *    a browser pane that hides between tool calls, so a rAF sample window
     *    collects single-digit frames over fifteen seconds — `stats()` returns
     *    null and the on-screen median is whatever the last burst happened to
     *    hit. Every absolute measured that way is noise.
     * 2. **Awaiting each resolve serialises the frames.** In the animation loop
     *    the resolve is fire-and-forget and frames overlap, so a reading may
     *    belong to a frame two behind the current settings. Here each pass is
     *    measured in isolation, which is what makes A/B comparisons stable.
     *
     * The timestep is FIXED rather than measured, so the rig integrates
     * identically on every run and the pose sequence is reproducible.
     *
     * MUST BE RUN ON A VISIBLE PAGE — press B rather than calling this from a
     * console that hides the pane. A hidden document has no swapchain texture
     * to draw into, so every pass resolves to ~0.065 ms of nothing and the
     * median looks like a spectacular win. `hiddenSteps` records how many
     * frames were stepped while hidden precisely so that failure cannot be
     * quoted as a result; a run with any is discarded by the caller.
     */
    benchGpu,
    /** Same run the B key starts; result also lands on `window.__benchResult`. */
    runBench,
    setLodEnabled(on: boolean) { lodEnabled = on; },
    /** The POSED hero body the shader is drawing right now (applyRig's
     *  output) — the diagnostic peek for facing/pose verification. */
    heroPosed: () => lastPosed,
    /** X1.22 rig motion — the whole pipeline's state peek. */
    get motion() {
      const ms = heroMotion.motionState!; // the stock body always has motion wiring
      return {
        enabled: motionEnabled,
        wander: wanderOn,
        phase: ms.collapse.phase,
        meter: ms.collapse.meter,
        hop: ms.collapse.phase === 'standing'
          && (missingLimbs().legL !== missingLimbs().legR),
        stagger: ms.stagger.kind,
        clutch: ms.clutch.arm,
        heading: ms.wander.heading,
        bodyYaw: ms.bodyYaw,
        armStyle,
        headingFollow,
        gazeFollow,
        recoil: ms.recoil.joint,
        pos: ms.wander.pos as unknown as number[],
        speed: ms.wander.speed,
        blend: ms.blend,
        rootShift: heroMotion.lastRootShift as unknown as number[],
      };
    },
    /** Locomotion toggle — gait/stagger/IK stay live regardless. */
    setWander,
    /** Arm style toggle: 'reach' (default mummy-arms) or 'swing'. */
    setArmStyle,
    /** Heading-follow gain — 0 keeps the body facing one way (strafe-walker). */
    setHeadingFollow,
    /** Gaze-follow gain — 0 pins the gaze to the wander target (creepy variant). */
    setGazeFollow,
    /** Motion master toggle — off is the pre-X1.22 statue. */
    setMotionEnabled,
    // — X1.23 FPV + dynamite ——————————————————————
    /** The panel button's console twin: god-cam ↔ first-person. */
    enterFpv,
    exitFpv,
    /** Automation throw: releases a bundle at `charge` (0..1) from the
     *  stored FPV aim without the hold loop. Works in god mode too. In
     *  CLIP mode this routes through playGripThrow — the deferred marker
     *  flow — because an immediate forceThrow would pair the clip hand
     *  with a second, differently sized bundle (forbidden by the spec). */
    throwDynamite(charge = 1) {
      if (handFieldUi.field === 'clip') { playGripThrow(charge); return; }
      fpvMode = forceThrow(
        fpvMode, Math.max(0, Math.min(1, charge)), performance.now() / 1000);
    },
    /** Hard-sets the FPV aim/position (metres, radians) — deterministic
     *  throws for automated checks; the pointer-lock mouse can drift between
     *  scripted steps and this pins the launch state. */
    setFpvAim(opts: { yaw?: number; pitch?: number; pos?: number[] } = {}) {
      fpvMode = {
        ...fpvMode,
        fpv: {
          ...fpvMode.fpv,
          yaw: opts.yaw ?? fpvMode.fpv.yaw,
          pitch: opts.pitch ?? fpvMode.fpv.pitch,
          pos: opts.pos ? [opts.pos[0] ?? 0, 0, opts.pos[2] ?? 0] : fpvMode.fpv.pos,
        },
      };
    },
    /** Hands A/B — the spec's perf gate is benchGpu with hands on vs off. */
    setFpvHands,
    // ——— X1.26 baked hand field ——————————————————
    /** The `hand field` button's console twin (baked needs the static
     *  volume, clip needs the combined clip+GLB settlement — check
     *  `fpv.staticLoad` / `fpv.clipLoad`). */
    setHandField,
    /** Distal jiggle domain-warp gate (the second look gate; static first). */
    setHandWarp,
    /** Neutral-clay look toggle for the baked shape gate. */
    setHandClay,
    // ——— X1.27 grip clip (task F3 step 3: deterministic capture hooks) ———
    /** Playback mode: 'pause' freezes the controller clock (scrub), 'play'
     *  steps it from frame dt, 'loop' additionally auto-tosses each held
     *  bundle after a short hold. */
    setGripPlayback,
    /** Visual-only scrub of grip01 (pauses playback; never gameplay). */
    setGripProgress,
    /** Controller-clock multiplier (1 = authored timing). */
    setGripSpeed,
    /** The scripted underhand toss — parks the deferred pending throw; the
     *  clip's authored release marker performs the ownership handoff. */
    playGripThrow,
    /** The authored grip-seat/bundle-hull wireframe diagnostic. */
    setContactDebug,
    get fpv() {
      return {
        mode: fpvMode.mode,
        pos: fpvMode.fpv.pos as unknown as number[],
        yaw: fpvMode.fpv.yaw,
        pitch: fpvMode.fpv.pitch,
        cookPhase: fpvMode.fpv.cook.phase,
        charge: cookCharge(fpvMode.fpv, performance.now() / 1000),
        flightPos: (fpvMode.flight?.pos ?? null) as number[] | null,
        handWounds: handWounds.length,
        handsEnabled,
        handField: handFieldUi.field,
        handWarp: handFieldUi.warp,
        handClay: handFieldUi.clay,
        // Named load states (F1): static = the X1.26 volume, clip = the
        // combined clip+GLB settlement. `handVolume`/`handVolumeError` are
        // the X1.26 keys kept for continuity.
        handVolume: handFieldUi.staticLoad,
        handVolumeError: staticVolumeError,
        staticLoad: handFieldUi.staticLoad,
        clipLoad: handFieldUi.clipLoad,
        /** Fine-grained clip asset state: loading → clip-ready → glb-ready. */
        glbLoad: clipLoadDetail,
        clipError: handFieldUi.clipError,
        // — grip clip drive (deterministic capture assertions) —
        gripPhase: gripMotion.phase,
        gripElapsedSec: +gripMotion.elapsedSec.toFixed(4),
        /** The EFFECTIVE grip01 this frame (scrub override when set). */
        grip01: gripScrub ?? gripFrame?.grip01 ?? null,
        grip01Controller: gripFrame?.grip01 ?? null,
        gripScrub,
        gripPlayback,
        gripSpeed,
        frame0: clipSample.frame0,
        frame1: clipSample.frame1,
        frameAlpha: +clipSample.alpha.toFixed(4),
        releaseCount,
        propOwner,
        /** The last hand-derived GLB root (world metres) — the handoff
         *  position source. */
        glbRoot: clipPropPose
          ? [clipPropPose.position[0], clipPropPose.position[1], clipPropPose.position[2]]
          : null,
        /** |heldRoot − flight.pos| at the latest marker handoff (m); the
         *  gate is < 1e-4 (0.1 mm). */
        handoffErrorM: lastHandoffErrorM,
        burstsUseAtlas: burstLayer.usingAtlas,
      };
    },
    /** The K key's console twin: forces the collapse next frame. */
    forceCollapse() { forcedCollapse = true; },
    /**
     * The X1.25 post chain (FXAA / temporal smear / sharp-bilinear upscale)
     * — the panel's post section, from the console. All-off is an exact
     * pass-through of the pre-X1.25 draw path (the A/B parity gate).
     */
    post: {
      setFxaa(on: boolean) {
        postAa.setFxaa(on);
        fxaaBtn.textContent = `fxaa: ${postAa.fxaa ? 'on' : 'off'}`;
      },
      setSmear(v: number) { postAa.setSmear(v); },
      setSharpUpscale(on: boolean) {
        postAa.setSharpUpscale(on);
        sharpBtn.textContent = `sharp upscale: ${postAa.sharpUpscale ? 'on' : 'off'}`;
      },
      get fxaa() { return postAa.fxaa; },
      get smear() { return postAa.smear; },
      get sharpUpscale() { return postAa.sharpUpscale; },
    },
    /** Shell-displacement silhouettes on every live body view. */
    setShellDisplace,
    /** Wound-zone soft shadow A/B for automated visual checks. */
    setWoundShadow,
    setWoundShadowStrength: (v: number) => { woundShadowStrength = v; woundShadowOn = v > 0; applyWoundShadow(); },
    setLegacyGamma,
    get shellDisplace() { return shellSilhouette; },
    /** null = let LOD decide; true/false force the lever on every body. */
    setOverride(k: LodLever, v: boolean | null) { lodOverride[k] = v; },
    /**
     * Force the march step count on every body. null — or 0, matching the
     * panel slider's own "march steps (0 = lod)" label — hands it back to LOD.
     *
     * The zero case is not cosmetic. `applyLod` writes `stepsOverride ??
     * level.steps` straight into marchCfg.x, and the march loop's first line
     * is `if (i >= steps) { break; }` — so a literal 0 exits before it ever
     * samples the field, every ray misses, and `discard` blanks the ENTIRE
     * raymarched body while the polygon kit keeps drawing. A floating pair of
     * sunglasses and a shirt with nobody in them reads as a catastrophic
     * modelling bug, and it cost an hour of chasing a hole in a character that
     * did not have one.
     */
    setStepsOverride(v: number | null) { stepsOverride = v !== null && v > 0 ? v : null; },
    /** Sphere-trace step multiplier on every body. Default 0.6. */
    setStepMul(v: number) { for (const x of [view, ...crowd]) x.uniforms.marchCfg.value.y = v; },
    /**
     * Silhouette noise amplitude on every body, crowd included. The panel
     * slider reaches only the hero, which is no use for a crowd measurement.
     */
    setSilhouetteNoise(v: number) { for (const x of [view, ...crowd]) x.uniforms.marchCfg.value.z = v; },
    /** Over-relaxation factor; <= 1 disables the relaxed tracer. */
    setRelax(v: number) { for (const x of [view, ...crowd]) x.uniforms.woundCfg2.value.y = v; },
    /** 1 = full resolution for the raymarched layer, 0.5 = quarter the pixels. */
    setSdfScale(v: number) { sdfLayer.setScale(v); sizeSdfLayer(); },
    /** Dynamic resolution: drives the SDF scale to hold the frame budget. */
    setAdaptive(on: boolean) {
      adaptiveEnabled = on;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      adaptBtn.textContent = `adaptive res: ${on ? 'on' : 'off'}`;
    },
    setAdaptiveBudget(ms: number) { adaptiveBudgetMs = ms; },
    get adaptive() {
      return {
        enabled: adaptiveEnabled,
        budgetMs: adaptiveBudgetMs,
        rung: adaptiveState.rung,
        scale: scaleForRung(adaptiveState.rung),
        probeIntervalMs: adaptiveState.probeIntervalMs,
      };
    },
    get sdfScale() { return sdfLayer.scale; },
    setSdfFlipY(on: boolean) { sdfLayer.setFlipY(on); },
    setConeEnabled(on: boolean) { sdfLayer.setConeEnabled(on); },
    /**
     * Occluder inner-hull pre-pass. Lets every ray stop where something solid
     * already covers it — see occluder-hull.ts for why that is safe.
     */
    setOccluder(on: boolean) {
      sdfLayer.setOccluderEnabled(on);
      // Populate immediately rather than waiting a frame: a benchmark started
      // in the same tick would otherwise measure an EMPTY hull and read as a
      // free win.
      if (on) {
        const posed = applyRig(current, heroMotion.bound, heroMotion.lastBodyYaw);
        occluderHull.update([posed, ...crowdBodies()], woundSpheres(posed.prims));
      }
    },
    get occluder() {
      return { enabled: sdfLayer.occluderEnabled, instances: occluderHull.instanceCount };
    },
    setConeFineTile(px: number) { sdfLayer.setConeFineTile(px); },
    get coneFineTile() { return sdfLayer.coneFineTile; },
    get coneEnabled() { return sdfLayer.coneEnabled; },
    get sdfFlipY() { return sdfLayer.flipY; },
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
    setCam(yaw: number, pitch: number, dist: number, targetY?: number) {
      autoSpin = false;
      camYaw = yaw;
      camPitch = pitch;
      camDist = dist;
      // Optional orbit height, so a turntable can frame the HEAD (face decal
      // fitting) without the whole figure. Omitted = leave the target alone.
      if (targetY !== undefined) camTarget.y = targetY;
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
