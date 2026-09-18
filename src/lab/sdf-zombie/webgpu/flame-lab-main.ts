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
import { CLUSTER_ORDER, type LimbId } from '../types';
import {
  createFlameCards, FLAME_CARD_SLOTS, SOLDIER_LEG_KIT_RADIUS,
  type FlameCardAnchors, type FlameCardFrame,
} from './flame-cards';
import { BURN_TUNING, burnPresets, resolveBurnTuning, type BurnTuning } from './burn-profiles';
import {
  TONGUE_TECHNIQUES, isTongueTechnique, resolveTongueTuning,
  type TongueTechnique, type TongueTuning,
} from './tongue-tuning';
import { TONGUE_TAPS, tonguePixelLength, type TongueFrame } from './post-tongues';
import { createFlamePanel } from './flame-panel';
import { createCharacterEffects } from './character-effects';
import { burnLightFlicker, burnLightIntensity, burnLightAnchor } from './burn-light';
import { burnDistortStrength, burnDistortRadiusM, burnWobble } from './burn-distort';
import { createGooLayer } from './goo-layer';
import { createShutterGameLayer } from './shutter-game-layer';
import { createBloodSim } from '../blood-sim';

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

/** The centre of a limb's fattest flesh primitive in the POSED field — the
 *  same rule headShape applies to the head, generalized to every limb. This
 *  is what the flame cards ride instead of standing-height anchors: a
 *  collapsed body's torso centre is where the torso actually IS. Null when
 *  the cluster is missing or fully subtracted (a severed limb, say). */
function limbCentre(b: BuildResult, limb: LimbId): Vec3 | null {
  const cluster = b.clusters.find(c => c.limb === limb);
  if (!cluster || !cluster.alive) return null;
  let best: Vec3 | null = null;
  let bestR = -Infinity;
  const prims = b.prims.slice(cluster.start, cluster.start + cluster.count);
  const flesh = prims.filter(p => p.op !== 'sub' && p.color === undefined);
  for (const p of (flesh.length > 0 ? flesh : prims)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    }
  }
  return best;
}

/** The posed centre of a limb's WHOLE prim cluster — the refitClusters mean of
 *  its endpoints, which applyRig recomputes every frame, so it rides a
 *  collapse exactly as the fattest-prim rule does. Why legs need it: the
 *  fattest-prim rule above is right for the head (hair/hats out-size the
 *  skull) but wrong for a limb whose fattest prim is an end mass — the
 *  soldier's leg cluster fattest prim is the hip ball and the zombie's is the
 *  splayed foot, which anchored the soldier's leg cards at the waist and the
 *  zombie's at the ankle. FLAME_CARD_SLOTS' offsets are authored against this
 *  mean centre, so a bare lower leg is the symptom of feeding them the wrong
 *  one. */
function limbClusterCentre(b: BuildResult, limb: LimbId): Vec3 | null {
  const cluster = b.clusters.find(c => c.limb === limb);
  return cluster && cluster.alive ? cluster.center : null;
}

/** Every posed limb centre the cards anchor to, computed once per body per
 *  frame from the posed field. Missing limbs fall back to the torso's centre
 *  (a card that rides a severed limb's last known spot is worse than one
 *  that keeps burning at the trunk). */
function limbAnchors(b: BuildResult): FlameCardAnchors {
  const torso = limbCentre(b, 'torso') ?? [0, 1, 0];
  const out = { torso } as FlameCardAnchors;
  for (const limb of CLUSTER_ORDER) {
    if (limb === 'torso') continue;
    // Only the legs switch rules for now: they are the one limb the captures
    // showed under-covered, and the change is deliberately scoped so the good
    // upper-body engulfment is untouched.
    const centre = limb === 'legL' || limb === 'legR'
      ? (limbClusterCentre(b, limb) ?? limbCentre(b, limb))
      : limbCentre(b, limb);
    out[limb] = centre ?? torso;
  }
  return out;
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
  /** The posed limb centres the flame cards anchor to, refreshed per frame.
   *  This is the post-anchor-fix model: every slot rides its posed limb centre
   *  (head included), so a collapsed body's flames come down with it. */
  limbs: FlameCardAnchors | null;
  /** Last frame's floor position, for the flame cards' lean velocity. */
  lastPos: Vec3;
  /** Spawn and motion seed, kept so freeze() can rebuild a pristine motion
   *  record — the deterministic pose two `--frozen` capture runs must share. */
  spawn: Vec3;
  seed: number;
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
  // over the polygonal scene. marchBurn (flame-tongues task 2) adds the fourth
  // attachment: the per-pixel burn mask the screen-space tongue pass grows its
  // flame out of. Opt-in and dev-only; off leaves the target byte-identical.
  const sdfLayer = createSdfLayer(handle.renderer, { marchBurn: true });
  // Post chain (X1.25): FXAA + temporal smear + sharp-bilinear upscale. It
  // owns the frame's tail — with every effect off it is an exact
  // pass-through, so the pre-X1.25 draw path is untouched by default-off.
  // Created before sizeSdfLayer because the SDF layer sizes from its
  // contentSize (the capped render size).
  const postAa = createPostAa(handle.renderer);
  postAa.addSink(sdfLayer);
  // THE BURN MASK (flame-tongues task 2): hand the tongue pass the march's
  // fourth attachment — a single rebind at boot, then the texture follows its
  // target through resizes (the sscsFleshTex discipline).
  if (sdfLayer.marchBurnTexture) postAa.setBurnMaskTexture(sdfLayer.marchBurnTexture);
  // HEAT DISTORTION (plan task 12): the blit's bounded blast warp doubles as
  // the burning bodies' heat band. setBlastDistort just opens the uniform
  // gate — nothing recompiles (the blit comment explains why that matters);
  // with no live sources the warp's dist.x is 0 and it is an exact identity,
  // so a cold page is untouched. The camera is what reprojects each body's
  // world anchor every frame — without it the pass stays inert by design
  // (game-main hands its camera over at boot the same way).
  postAa.setBlastDistort(true);
  postAa.setBlastDistortCamera(camera);
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
  // ?flow=<0..1> pins the curl-flow strength at boot (flame-polish task 2), the
  // URL half of the capture sweep — the console half is setTuning({ flameFlow }).
  const flowParam = q.get('flow');
  if (flowParam !== null && Number.isFinite(Number(flowParam))) {
    tuning = resolveBurnTuning({ ...tuning, flameFlow: Number(flowParam) });
  }
  // The TONGUE TECHNIQUE (flame-tongues plan task 1): which tongue pass draws,
  // plus the tongue tuning all three passes will share. Default 'screen';
  // ?tongue=<name> overrides at boot. The cards pass (task 3) consumes the
  // record this frame; screen/volume land on their own branches.
  const tongueParam = q.get('tongue');
  let technique: TongueTechnique =
    tongueParam !== null && isTongueTechnique(tongueParam) ? tongueParam : 'screen';
  let tongue: TongueTuning = resolveTongueTuning();
  // A capture-time clock pin (flame-polish task 2): when set, the visual clock
  // stops at this many seconds so two runs can be compared at the SAME flipbook
  // and curl phase. null is the live wall clock. Burn integration still uses
  // dt, so pinning does not freeze ignition/char.
  let clockPin: number | null = null;
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
    const seed = motionSeed + i * 7919;
    actors.push({
      name,
      view,
      gpu,
      current: view.body,
      motion: makeActorMotion(view.body, { seed, start: spawn }),
      profile: motionProfileFor(name),
      bounds: {
        minX: spawn[0]! - WANDER_R, maxX: spawn[0]! + WANDER_R,
        minZ: spawn[2]! - WANDER_R, maxZ: spawn[2]! + WANDER_R,
      },
      rng: makeRng(seed),
      signals: emptyActorSignals(),
      faceTex,
      limbs: null,
      lastPos: spawn,
      spawn,
      seed,
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
    technique: () => technique,
    setTechnique: (name) => { technique = name; },
    readTongue: () => tongue,
    applyTongue: (patch) => (tongue = resolveTongueTuning({ ...tongue, ...patch })),
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

  // ——— THE SHUTTER (plan task 13). The game's selective blood-blur layer,
  // installed as post-aa's PRE-POST capture stage so a later plan can feed it
  // flame sources and the streaks get judged here, not only in the game. The
  // goo layer is the SAME one the shutter consumes (lab-main builds one for
  // its draw chain); its light rig shares the march's uniform NODES — not
  // copies — so any re-tune moves goo and flesh together. The sim stays
  // EMPTY: with nothing selected the shutter's capture takes its empty-work
  // fast path and returns null every frame, so the stage is an exact
  // pass-through until something feeds it.
  const gooLayer = createGooLayer(handle.renderer, {
    lightDir: actors[0]!.gpu.uniforms.lightDir,
    keyColor: actors[0]!.gpu.uniforms.keyColor,
    lightCfg: actors[0]!.gpu.uniforms.lightCfg,
  });
  {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  }
  // AFTER sizeSdfLayer's own listener (lab-main's ordering note): it reads
  // the already-updated targetSize.
  window.addEventListener('resize', () => {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  });
  const bloodSim = createBloodSim();
  const shutterGame = createShutterGameLayer({
    renderer: handle.renderer, gooLayer,
    onError: (m) => { console.error(m); },
  });
  postAa.setCaptureStage((capture) => {
    let out: THREE.RenderTarget = capture;
    shutterGame.setSceneTexture(out.texture);
    shutterGame.setOccluderDepth(null);
    const b = shutterGame.capture(capture, bloodSim, camera);
    if (b) out = b;
    return out === capture ? null : out;
  });
  // Warm the layer/seed targets + resolve pipeline against the REAL capture
  // target now, instead of stalling the first live blurred frame
  // (game-main's measured ~0.26 s).
  shutterGame.prewarm(postAa.captureTarget);

  // ——— THE EFFECTS SCENE + FLAME CARDS (flame-tongues plan task 3) ————
  // The lab had no translucent-effects tenant until now; character-effects is
  // the repo's routing for exactly that (see its header): rendered AFTER the
  // sdf composite inside the capture (below), against the completed depth
  // buffer, so the additive cards compose over the finished frame and
  // walls/bodies still occlude them.
  const characterEffects = createCharacterEffects(handle.renderer);
  const flameCards = createFlameCards({ maxBodies: FLAME_LAB_BODIES.length });
  characterEffects.scene.add(flameCards.object);
  flameCards.object.visible = false;   // only the 'cards' technique shows it
  // The cards' per-frame feed, filled by the burn step below. Preallocated —
  // the render callback allocates nothing.
  const cardFrames: FlameCardFrame[] = FLAME_LAB_BODIES.map(() => ({
    yaw: 0,
    anchors: {
      head: [0, 1.6, 0], torso: [0, 1.1, 0], armL: [-0.3, 1.1, 0],
      armR: [0.3, 1.1, 0], legL: [-0.1, 0.5, 0], legR: [0.1, 0.5, 0],
    },
    burn: 0,
  }));
  // ATLAS OR FALLBACK, said loudly: the FIRE01 strip is a DEV PLACEHOLDER
  // (public/assets/flame-placeholder/, gitignored — build it with
  // `npm run flame:atlas`). Without it the cards run the procedural shader
  // and this line says so, per the plan's panel requirement.
  {
    const cardsEl = document.createElement('div');
    cardsEl.style.fontSize = '11px';
    cardsEl.style.color = '#f96';
    cardsEl.textContent = 'tongue cards: loading atlas…';
    statusBox.appendChild(cardsEl);
    const fallback = (why: string) => {
      cardsEl.textContent = `tongue cards: PROCEDURAL fallback (${why}) — npm run flame:atlas`;
    };
    fetch('/assets/flame-placeholder/fire01.json')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`http ${r.status}`))))
      .then((t) => {
        try { return JSON.parse(t) as { frames: number; cellW: number; cellH: number; pad?: number }; }
        catch { throw new Error('manifest not found'); }
      })
      .then((info) => {
        new THREE.TextureLoader().load(
          '/assets/flame-placeholder/fire01.png',
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;  // decode into working space
            // Linear mag (flame-polish task 1): the FIRE01 cells are 31x25, so
            // at the close framing point sampling turns each texel into a ~10 px
            // flat rectangle — the "card seam" blockiness. NOTE this only works
            // because flame-cards.ts makes its fallback DataTexture filterable;
            // a Nearest fallback makes WGSLNodeBuilder bake textureLoad into the
            // shader and this filter is silently ignored.
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.flipY = true;                       // v=0 is the flame's base
            flameCards.setAtlas(tex, info.frames, info.cellW, info.cellH, info.pad ?? 0);
            cardsEl.textContent = `tongue cards: atlas (${info.frames} frames of ${info.cellW}x${info.cellH}`
              + `${info.pad ? `, pad ${info.pad}` : ''})`;
            cardsEl.style.color = '#9c9';
          },
          undefined,
          () => fallback('atlas png failed to load'),
        );
      })
      .catch((err: unknown) =>
        fallback(err instanceof Error ? err.message : 'manifest fetch failed'));
  }

  // The frame's draw: the SDF pass composites over the polygonal scene, and
  // the effects scene (the flame cards) renders after the composite inside
  // the same capture, so the post chain grades the fire with the frame.
  handle.setDrawFn(() => postAa.render(
    () => {
      sdfLayer.render(scene, camera);
      characterEffects.render(camera);
    },
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
  // FROZEN MODE (flame-polish task 3, step 1): a capture-only hold that pins
  // everything two runs must share to be pixel-comparable — the motion clock
  // (dt 0, so the pose holds at the deterministic applyFrozenPose result), the
  // burn clock (dt 0, so the surface noise phase does not creep), the visual
  // clock (see the burn step) and the orbit camera (auto-spin OFF, and
  // yaw/pitch/distance reset). The previous pass abandoned a per-slot
  // camera-bias A/B because cross-run camera and pose drift made every diff
  // unreadable; this is the fix.
  let frozen = false;
  // The camera pose freeze() restores. Same defaults the page boots with, so a
  // frozen run's scripted drag/wheel starts from the same yaw every time.
  const FROZEN_CAM = Object.freeze({ yaw: 0.35, pitch: 0.12, dist: 3.2 });
  // Live kit-radius override (flame-polish task 3): lets a capture sweep the
  // standoff in ONE page load at one camera and pose — the judgeable A/B the
  // plan wants — instead of guessing across reloads. null = the per-character
  // default (SOLDIER_LEG_KIT_RADIUS for the soldier, 0 for the zombie).
  let kitStandoffOverride: number | null = null;

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
    // difference between a burnt corpse and a clean one). T cycles the tongue
    // technique — the switch the tongue passes hang off — and re-marks the
    // panel's technique row via the same event the panel's own buttons fire.
    if (ev.key === 'i' || ev.key === 'I') { for (const s of burns) igniteBurn(s); return; }
    if (ev.key === 'o' || ev.key === 'O') { for (const s of burns) extinguishBurn(s); return; }
    if (ev.key === 't' || ev.key === 'T') {
      const at = TONGUE_TECHNIQUES.indexOf(technique);
      technique = TONGUE_TECHNIQUES[(at + 1) % TONGUE_TECHNIQUES.length]!;
      flamePanel.el.dispatchEvent(new Event('flame:technique'));
      return;
    }
  });

  // ——— THE FIRE LIGHTS (plan task 10). One per body, allocated ONCE at
  // intensity 0 and only ever modulated — `visible` is NEVER toggled: three
  // r185 folds the set of VISIBLE lights into LightsNode.customCacheKey, so a
  // toggle re-keys every lit material's shader variant and recompiles
  // pipelines mid-frame (measured 180–230 ms per frame in game-main;
  // intensity is not in that cache key, so 0 costs three idle iterations).
  // Distance 0 + decay 2 is the game's explosion-pool shape: a physical
  // 1/d² falloff with no hard cut.
  const fireLights = FLAME_LAB_BODIES.map(() => {
    const pl = new THREE.PointLight(0xff7a2a, 0, 0, 2);
    pl.visible = true;
    scene.add(pl);
    return pl;
  });

  // SCREEN-SPACE TONGUES feed state (flame-tongues task 2), preallocated —
  // the render callback allocates nothing. The burn loop records which bodies
  // are alight and where they stand; the tail of the callback (after the
  // camera moves) projects the world-up direction and feeds postAa.
  const tongueLit: boolean[] = FLAME_LAB_BODIES.map(() => false);
  const tonguePos: [number, number, number][] = FLAME_LAB_BODIES.map(() => [0, 0, 0]);
  const _tongueA = new THREE.Vector3();
  const _tongueB = new THREE.Vector3();
  /** The last tongue feed, for __flameLab.tongueDebug() — tuning wants the
   *  actual numbers the pass is running on, not a reconstruction of them. */
  let lastTongueFeed: TongueFrame | null = null;

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
    //    Frozen captures pass dt 0: planSubSteps(0) is empty, so stepActorMotion
    //    is a no-op and the pose holds at the pristine binding — the exact
    //    state two runs must share for the diff to mean anything.
    const motionDt = frozen ? 0 : dt;
    for (const a of actors) {
      if (!a.motion.motionJoints) continue;
      const f = stepActorMotion(a.motion, {
        current: a.current,
        dt: motionDt,
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
        f, motionDt, MOTION_SEED);
      const posed = applyRig(a.current, a.motion.bound, a.motion.lastBodyYaw);
      a.gpu.update(posed, a.current);
      const rs = a.motion.lastRootShift;
      a.gpu.setRootShift(rs[0]!, rs[2]!, a.motion.lastBodyYaw);
      const skull = headShape(posed);
      if (skull) a.gpu.setHeadShape(skull.centre, skull.axes);
      a.limbs = limbAnchors(posed);
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
      // Frozen passes burn dt 0: stepBurn is a no-op at dt <= 0, so the
      // surface fire's noise phase (burnSec, reset by forceBurn) cannot creep
      // and two runs grade the same surface behind the cards.
      const burnDt = frozen ? 0 : Math.min(dt, 1 / 30);
      // Wall-clock seconds, as game-main's flicker clock — never dt-integrated,
      // so a stall cannot jump the wobble phase. A capture's clock pin
      // overrides it so two flow values can be shot at the same phase; frozen
      // defaults to 0 so an un-pinned frozen run is still deterministic.
      const clock = clockPin ?? (frozen ? 0 : now * 0.001);
      // GLOW (plan task 11): the pass is fed from the live tuning every
      // frame, so a slider move takes effect at once. Gain 0 keeps it fully
      // inert — the draws are skipped and the frame is bit-identical.
      postAa.setGlow(tuning.glowGain > 0, tuning.glowGain, tuning.glowThreshold);
      for (let i = 0; i < actors.length; i++) {
        const s = stepBurn(burns[i]!, burnDt, tuning);
        const gpu = actors[i]!.gpu;
        gpu.uniforms.burnCfg.value.set(s.burn, s.burnSec, s.char, 0);
        gpu.uniforms.burnNoiseScale.value = tuning.noiseScale;
        gpu.uniforms.burnRiseSpeed.value = tuning.riseSpeed;
        gpu.uniforms.burnCharPatch.value = tuning.charPatch;
        gpu.uniforms.burnFireGain.value = tuning.fireGain;
        gpu.uniforms.burnFireCoverage.value = tuning.fireCoverage;
        gpu.uniforms.burnSkeleton.value = tuning.skeletonShow;
        gpu.uniforms.burnSkeletonDepth.value = tuning.skeletonDepth;
        // The body's floor position: the pelvis base (its spawn x) plus the
        // walk displacement the motion record measured. The light rides it at
        // chest height, inside the flames, and per-body phase keeps the pair
        // flickering out of step.
        const a = actors[i]!;
        const rs = a.motion.lastRootShift;
        const bodyPos: Vec3 = [FLAME_LAB_BODIES[i]!.x + rs[0]!, 0, rs[2]!];
        // The tongue pass's per-body record (screen-space tongues, task 2):
        // lit or not, and where the body stands this frame.
        tongueLit[i] = s.burn > 0.03;
        tonguePos[i]![0] = bodyPos[0]; tonguePos[i]![1] = 1.0; tonguePos[i]![2] = bodyPos[2];
        const anchor = burnLightAnchor(bodyPos);
        fireLights[i]!.position.set(anchor[0], anchor[1], anchor[2]);
        fireLights[i]!.intensity = burnLightIntensity(
          s.burn, s.char, tuning.lightPeak, tuning.lightFlicker,
          burnLightFlicker(clock, tuning.lightFlicker, i * 2.7),
        );
        // HEAT DISTORTION (plan task 12): the band rides the SAME chest
        // anchor as the light, at a fixed radius (no blast expansion), with
        // the strength from burn/char breathing on the two-rate wobble —
        // per-body phase, so the pair does not shimmer in step. The wobble
        // lives here, on the TS side, exactly as blast-refraction.ts owns
        // the blast's decay; the shader only ever sees a strength number.
        const s2 = burnDistortStrength(s.burn, s.char, tuning.distortStrength);
        if (s2 > 0) {
          postAa.pushBurnDistort(
            anchor, burnDistortRadiusM(1.8), s2 * (1 + 0.35 * burnWobble(clock, i * 2.7)),
          );
        }
        // FLAME CARDS feed (flame-tongues plan task 3): the same burn level
        // and floor position the light rides, plus the pose-derived head Y
        // and a velocity for the lean trail. Only the 'cards' technique draws
        // them — the group's visible is the switch (checked after the loop).
        const cf = cardFrames[i]!;
        const inv = dt > 1e-4 ? 1 / dt : 0;
        cf.yaw = a.motion.lastBodyYaw;
        cf.anchors = a.limbs ?? limbAnchors(a.current);
        cf.burn = s.burn;
        // The soldier's greaves cover his SDF shins (flame-polish task 3): feed
        // his measured kit radius so the shin/boot cards are placed outside the
        // mesh shell. The zombie has no kit, so his leg cards keep the old bias.
        // A live override (a --kit-sweep capture) wins for tuning.
        cf.kitRadius = kitStandoffOverride
          ?? (a.view.entry.name === 'soldier' ? SOLDIER_LEG_KIT_RADIUS : 0);
        cf.vel = [
          (bodyPos[0] - a.lastPos[0]) * inv, 0, (bodyPos[2] - a.lastPos[2]) * inv,
        ];
        a.lastPos = bodyPos;
      }

      // The cards draw only on their technique; setTuning every frame so the
      // tongue sliders land live, exactly like the burn uniforms above. The
      // soft-particle fade and the curl flow both ride BurnTuning (panel
      // sliders -> these calls).
      flameCards.object.visible = technique === 'cards';
      flameCards.setTuning(tongue);
      flameCards.setSoftFade(tuning.cardSoftFade);
      flameCards.setFlow(tuning.flameFlow);
      if (technique === 'cards') flameCards.update(cardFrames, camera, clock);
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

    // — SCREEN-SPACE TONGUES (flame-tongues task 2). Fed from the LIVE tongue
    //    tuning and THIS frame's camera, only when the technique is 'screen'
    //    and something is actually burning — off is an exact no-bind. The
    //    world-up direction and the body distance are projected here, where
    //    the camera lives; the pass itself stays camera-free uniforms.
    {
      let lit = -1;
      for (let i = 0; i < tongueLit.length; i++) {
        if (tongueLit[i]) { lit = i; break; }
      }
      const tongueOn = technique === 'screen' && lit >= 0;
      if (tongueOn) {
        camera.updateMatrixWorld();
        const p = tonguePos[lit]!;
        // Two world points 0.25 m apart vertically at the body, projected to
        // capture pixels: their delta is the projected world-up (y negative
        // up in pixel space, where row 0 is the top).
        _tongueA.set(p[0], p[1], p[2]).project(camera);
        _tongueB.set(p[0], p[1] + 0.25, p[2]).project(camera);
        const cw = Math.max(1, postAa.contentSize.width);
        const ch = Math.max(1, postAa.contentSize.height);
        const ax = (_tongueA.x + 1) * 0.5 * cw;
        const ay = (1 - _tongueA.y) * 0.5 * ch;
        const bx = (_tongueB.x + 1) * 0.5 * cw;
        const by = (1 - _tongueB.y) * 0.5 * ch;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        const depthM = camera.position.distanceTo(_tongueB.set(p[0], p[1], p[2]));
        const fovTan = Math.tan((camera.fov * Math.PI) / 360);
        if (len > 1e-3 && depthM > camera.near) {
          const feed: TongueFrame = {
            // The world length in pixels at the body's depth, split across
            // the pass's fixed tap count — the constant-WORLD-size rule.
            stepPx: tonguePixelLength(tongue.length, depthM, ch, fovTan) / TONGUE_TAPS,
            near: camera.near,
            far: camera.far,
            fovTan,
            refDepthM: depthM,
            length: tongue.length,
            ragged: tongue.ragged,
            rise: tongue.rise,
            gain: tongue.gain,
            lean: tongue.lean,
            upX: dx / len,
            upY: dy / len,
            time: now * 0.001,
          };
          lastTongueFeed = feed;
          postAa.setTongues(true, feed);
        } else {
          lastTongueFeed = null;
          postAa.setTongues(false);
        }
      } else {
        lastTongueFeed = null;
        postAa.setTongues(false);
      }
    }
  });

  /**
   * Deterministic pose for `--frozen` captures (flame-polish task 3, step 1).
   * Rebuilds each body's motion record from its seed and steps it a FIXED
   * number of FIXED-dt frames — the crowd's own determinism contract — so the
   * pose is a pure function of `name` and two runs match frame-for-frame.
   * `freeze(true)` then holds the result (motion dt 0 in the loop). Without
   * this, freezing could only ever show the binding pose: walk/run/collapsed
   * would not develop at all.
   */
  function applyFrozenPose(name: string): string {
    const FIXED_DT = 1 / 60;
    // Frame counts match the capture script's real-frame SETTLE_POSE holds
    // (walk/run 30, collapsed 90), so a frozen capture frames the same stride
    // and the same completed fall the live pose set already judged.
    const FRAMES: Record<string, number> = { stand: 30, walk: 30, run: 30, collapsed: 90 };
    const n = FRAMES[name] ?? FRAMES.stand!;
    const band = name === 'walk' || name === 'run' ? name : null;
    for (const a of actors) {
      a.current = a.view.body;
      a.motion = makeActorMotion(a.view.body, { seed: a.seed, start: a.spawn });
      a.rng = makeRng(a.seed);
      a.signals = emptyActorSignals();
      a.limbs = null;
      a.lastPos = a.spawn;
      if (name === 'collapsed') a.signals.forcedCollapse = true;
      const profile = band
        ? { ...a.profile, cruise: speedForBand(a.profile, band) }
        : { ...a.profile };
      for (let k = 0; k < n; k++) {
        stepActorMotion(a.motion, {
          current: a.current,
          dt: FIXED_DT,
          wander: band !== null,
          armStyle: undefined,
          headingFollow: MOTION_TUNING.headingFollow,
          gazeFollow: MOTION_TUNING.gazeFollow,
          bounds: a.bounds,
          rng: a.rng,
          signals: a.signals,
          profile,
        });
      }
    }
    return name;
  }

  // Console API — the capture and tuning entry point until the tuning panel
  // lands (plan task 9). `__flameLab.capture()` pins a body straight to a
  // burn/char pair for deterministic screenshots; `burns()`/`tuning()` echo
  // the live state back.
  (window as unknown as { __flameLab: unknown }).__flameLab = {
    ignite(on = true) { for (const s of burns) (on ? igniteBurn : extinguishBurn)(s); },
    setTuning(p: Partial<BurnTuning> = {}) { tuning = resolveBurnTuning({ ...tuning, ...p }); return tuning; },
    /** Capture clock pin: a number freezes the visual clock at that many
     *  seconds (same flipbook + curl phase across runs), null restores the
     *  live wall clock. Burn integration is unaffected. */
    setClock(t: number | null) { clockPin = t !== null && Number.isFinite(t) ? t : null; return clockPin; },
    /** Live kit-standoff override for a tuning sweep (flame-polish task 3).
     *  Non-negative metres, or null to restore the per-character default.
     *  Returns what was applied so a capture can read it back. */
    setKitStandoff(m: number | null) {
      kitStandoffOverride = m === null ? null : Math.max(0, Number(m));
      return kitStandoffOverride;
    },
    /** FROZEN POSE + CAMERA (flame-polish task 3, step 1). true pins the
     *  motion clock, the burn clock, the visual clock and the orbit camera,
     *  and rebuilds each body's pristine motion record — so two capture runs
     *  are pixel-comparable and a per-slot standoff A/B is judgeable (the
     *  previous pass abandoned exactly that because the orbit yaw and the
     *  idle pose drifted between loads). false restores the live sim and the
     *  auto-spin. Returns the applied state. */
    freeze(on = true) {
      frozen = on === true;
      autoSpin = !frozen;
      if (!frozen) return false;
      camYaw = FROZEN_CAM.yaw;
      camPitch = FROZEN_CAM.pitch;
      camDist = FROZEN_CAM.dist;
      applyFrozenPose('stand');
      return true;
    },
    /** Deterministic pose for a frozen capture (stand|walk|run|collapsed).
     *  No-op unless frozen, so the live sim is untouched. */
    pose(name = 'stand') { return frozen ? applyFrozenPose(name) : name; },
    /** The live leg anchors — the numbers the card slots are placed against,
     *  for a capture that needs to know where a limb's cards actually sit. */
    anchors() { return actors.map((a) => ({ name: a.name, limbs: a.limbs })); },
    preset(name: keyof typeof burnPresets) { tuning = resolveBurnTuning(burnPresets[name]); return tuning; },
    /** The tongue switch (flame-tongues plan task 1). Junk names are ignored
     *  and the CURRENT technique comes back, so a capture script can call it
     *  blind and read what it actually got. Re-marks the panel row. */
    setTechnique(name: string) {
      if (isTongueTechnique(name)) technique = name;
      flamePanel.el.dispatchEvent(new Event('flame:technique'));
      return technique;
    },
    technique() { return technique; },
    /** Flame-cards telemetry (plan task 3): quads written last frame and the
     *  atlas mode — the two facts a capture that looks wrong needs first. */
    cards() {
      return { live: flameCards.liveCards, atlas: flameCards.atlasMode,
        visible: flameCards.object.visible,
        capacity: FLAME_LAB_BODIES.length * FLAME_CARD_SLOTS.length };
    },
    setTongueTuning(p: Partial<TongueTuning> = {}) { tongue = resolveTongueTuning({ ...tongue, ...p }); return tongue; },
    tongue() { return { ...tongue }; },
    /** TUNING PROBE (flame-tongues task 2): the tongue pass's live feed plus a
     *  32x18-cell max-burn summary of the march's burn-mask attachment, so a
     *  tuning session can see the mask and the numbers without a GPU capture.
     *  Readback is async; resolves null when the attachment is absent. */
    async tongueDebug() {
      const tex = sdfLayer.marchBurnTexture;
      if (!tex) return { feed: lastTongueFeed, mask: null };
      const t = sdfLayer.targetSize;
      const read = async (textureIndex: number) => {
        const buf = await handle.renderer.readRenderTargetPixelsAsync(
          sdfLayer.marchTarget, 0, 0, t.width, t.height, textureIndex,
        );
        return new Float32Array(buf);
      };
      const px = await read(sdfLayer.marchTarget.textures.length - 1);
      const px0 = await read(0);
      const CELLS_X = 32, CELLS_Y = 18;
      const cells = new Array<number>(CELLS_X * CELLS_Y).fill(0);
      const cells0 = new Array<number>(CELLS_X * CELLS_Y).fill(0);
      let maxBurn = 0;
      let litTexels = 0;
      let maxLit0 = 0;
      for (let y = 0; y < t.height; y++) {
        const cy = Math.min(CELLS_Y - 1, (y * CELLS_Y / t.height) | 0);
        for (let x = 0; x < t.width; x++) {
          const i = (y * t.width + x) * 4;
          const burn = px[i]!;
          const lit0 = px0[i]! + px0[i + 1]! + px0[i + 2]!;
          if (lit0 > maxLit0) maxLit0 = lit0;
          if (burn > 0.02) litTexels++;
          if (burn > maxBurn) maxBurn = burn;
          const ci = cy * CELLS_X + Math.min(CELLS_X - 1, (x * CELLS_X / t.width) | 0);
          if (burn > cells[ci]!) cells[ci] = burn;
          if (lit0 > cells0[ci]!) cells0[ci] = lit0;
        }
      }
      return {
        feed: lastTongueFeed ? { ...lastTongueFeed } : null,
        target: { ...t },
        mask: { cells: cells.map((c) => +c.toFixed(2)), maxBurn: +maxBurn.toFixed(3), litTexels },
        outputProbe: { maxLit0: +maxLit0.toFixed(3), cells: cells0.map((c) => +c.toFixed(1)) },
        diffProbe: (() => {
          let maxDiff = 0, sum = 0;
          for (let i = 0; i < px.length; i += 4) {
            const d = Math.abs(px[i]! - px0[i]!);
            if (d > maxDiff) maxDiff = d;
            sum += d;
          }
          return { maxDiff: +maxDiff.toFixed(4), meanDiff: +(sum / (px.length / 4)).toFixed(5) };
        })(),
      };
    },
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
