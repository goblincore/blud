// src/lab/sdf-zombie/webgpu/goblin-puppet.ts
//
// THE GOBLIN PUPPET (emergence in the Flat, plan Task 4; spec docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md): the SDF
// goblin of the egg scene, built and driven from the sequence clock, shared by the screen emergence lab page (screen-lab-main.ts) and the
// game (game-emergence.ts, plan Task 7). Moved out of the lab page; the page's behaviour for the body is unchanged.
//
// WHAT IT DOES, per the lab page as it was:
//  - BUILDS the view (createCharacterView) with the SDF layer's dependencies the caller hands in (`deps.gpu`: the page's `cone` and
//    `occluder`; the game's cone, occluder, shell, prev, lastFrame, depthPre, refine...), and RETIRES the kit and the gun at birth (he is
//    at home; for goblin-cinematic-home that also means no mesh teeth, see its .blob header).
//  - SKINS it as the game does (game-spawn.ts): the .blob's own palette under the practical key, THE GAME'S MARCH accept constants
//    (game-march-accept.ts; the lab page's last-step value, GAME_LAST_STEP_DEFAULT), and HIS OWN FACE generated from the .blob's `sheet`
//    block (the registry's face slot is the shared zombie sheet: worn here it put the zombie's flat face and red eyes on him), with the
//    sheet's projection; a dim cold rim and a little more flat fill (GOBLIN_RIM, GOBLIN_FILL; setLighting aims the key).
//  - POSES him from the clock: the pose clip and the scoot (screen-lab-goblin.ts goblinClipAt / goblinRootAt, stepped at `fps`), the actor
//    pipeline pinning every rig point to the pose, then pinToPose (the actor's pinTips and bend stops would otherwise re-hang the hands and
//    feet and fold the crossed shins), then the body's placement (setPlacement: a position and a yaw on the floor).
//  - DRIVES THE FACE for a character with expressions (expression-library.ts; goblin-cinematic-home): the caller's channels at the stepped
//    clock (`channelsAt`, default the rest channels; plan Task 5 supplies the cues), a blink schedule that is a pure function of the clock
//    (expression.ts scheduledBlinkLid), `actuate` to the jaw gape and the per-prim morphs (on the bound applyRig poses with) and the face
//    sheet, whose texture is regenerated only when its `sheetKey` changes (lab-main's stepExpression / refreshSheet).
//
// FRAMES. The body is built at the origin in the motion system's frame (the floor at y 0, the hips over the origin, facing +z). The pose's
// joints carry the scoot (+z) and then the placement (rotated by `yaw` about +y, as gait.ts rotateYaw, then moved to `position`), so the
// pinned rig, the flesh and the cone follow; the noise root shift gets the same, so his skin's texture rides with him.
import * as THREE from 'three/webgpu';
import { createCharacterView, compileCharacterSheet, type CharacterView, type CharacterViewOpts } from './character-view';
import type { ZombieGpuView } from './zombie-gpu';
import { SDF_LAYER, CONE_LAYER, DEPTH_PREPASS_LAYER, REFINE_LAYER } from './sdf-layer';
import { headShape } from './flame-anchors';
import { characterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileFace } from '../blob-compile';
import { generateFaceSheet, sheetToRgba } from '../blob-face-sheet';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import { applyRig, headQuatOf, type BoundRig } from '../rig-bind';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { MOTION_TUNING } from '../motion';
import { makeRng } from '../wander';
import { rotateYaw } from '../gait';
import { makePoseRig, poseJoints, type PoseRig } from '../pose';
import { expressionsFor } from '../expression-library';
import { REST_CHANNELS, actuate, scheduledBlinkLid, sheetKey, withBlink, type Channels } from '../expression';
import { GOBLIN_FPS, goblinClipAt, goblinRootAt, pinToPose } from './screen-lab-goblin';
import {
  GAME_AA, GAME_AA_FADE_M, GAME_AA_NEAR, GAME_LAST_STEP_DEFAULT, GAME_RELAX, GAME_HULL_EXIT_BOUND, GAME_WOUND_EARLY_OUT, GAME_OMEGA, GAME_WOUND_STEP,
} from './game-march-accept';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';

/** The puppet's character by default: the cinematic head (jaw, morphs, expressions) in goblin-home's clothes, at 1.70 m. */
export const GOBLIN_PUPPET_CHARACTER = 'goblin-cinematic-home';
/** The goblin's cold rim/fill strength (spotCfg2.w: the march's built-in side rim, a cold grazing edge on the key's side plus a soft cold
 *  fill on the camera's side). Chosen by eye at the lab page's push and out shots; the game's lamps drive it at about 0.35-1.2. */
export const GOBLIN_RIM = 1.5;
/** The goblin's flat fill (lightCfg.y; the practical key preset's is 0.06), doubled-ish so his back is not black. */
export const GOBLIN_FILL = 0.10;
/** The face sheet's generated size (texels), as the lab's loadGeneratedFace. */
const SHEET_SIZE = 64;
/** The seed the lab page's actor pipeline was born with (makeActorMotion, makeRng). */
const SEED = 1709;

export interface GoblinPuppetDeps {
  renderer: THREE.WebGPURenderer;
  /** createCharacterView's `gpu` option: the SDF layer's dependencies (createZombieGpuView's opts), or a function of the built body. The
   *  lab page passes `{ cone: sdfLayer.cone, occluder: sdfLayer.occluder }`; the game passes what game-spawn.ts's viewGpuOpts does. */
  gpu: CharacterViewOpts['gpu'];
  /** Where the SDF proxy and its twins go (the scene the SDF layer renders; their layers are set here). Nothing else attaches: no kit. */
  parent: THREE.Object3D;
  /** The character (default GOBLIN_PUPPET_CHARACTER). Any goblin with the goblin's skeleton: `goblin-home` is the old body (no face rig). */
  character?: string;
  /** Build errors land here (as createCharacterView's); default a private list, read back as `errors`. */
  errors?: string[];
}

export interface GoblinStepOpts {
  /** His body's frame rate (poses a second): the clip clock, the scoot and the face step together. Default GOBLIN_FPS; 0 = smooth. */
  fps?: number;
  /** The expression's channels at the stepped clock (plan Task 5's cues). Default: the rest channels. Ignored for a character without
   *  expressions. The scheduled blink is laid over whatever this returns. */
  channelsAt?: (t: number) => Channels;
  /** The SDF layer's pixel cone (sdfLayer.pixelConeK: aaCfg.x, one pixel), refreshed every frame by the caller that sizes the layer. */
  pixelConeK?: number;
}

export interface GoblinPuppet {
  readonly character: string;
  readonly view: CharacterView;
  readonly gpu: ZombieGpuView;
  /** The rest body (the view's), in the motion frame at the origin. */
  readonly body: BuildResult;
  readonly errors: readonly string[];
  /** Whether the face is driven (the character has expression clips). */
  readonly hasExpressions: boolean;
  /** The last posed body (world), or null before the first step. */
  readonly posed: BuildResult | null;
  /** The last step's pose clip name and scoot (metres along his +z, before the placement). */
  readonly clipName: string;
  readonly rootDz: number;
  /** The last step's jaw gape (rad) and the face sheet's key (for checks). */
  readonly jawGape: number;
  readonly sheetKey: string;
  /** Pose, face and upload for sequence time `t` (seconds). A pure function of `t` and the options: the actor's own step is a fixed
   *  1/60 s, its result pinned to the pose, so a scrub lands the same frame; `dt` is accepted for the caller's frame loop and unused. */
  step(t: number, dt: number, opts?: GoblinStepOpts): BuildResult;
  /** Where his motion frame sits in the world: the origin moved to `position`, turned `yaw` about +y (his +z faces (sin yaw, 0, cos yaw)).
   *  Takes effect at the next step. */
  setPlacement(position: Vec3, yaw: number): void;
  /** The key's direction (world, toward the light) and the rim / fill strengths; anything omitted stays. */
  setLighting(l: { dir?: Vec3; rim?: number; fill?: number }): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

export function createGoblinPuppet(deps: GoblinPuppetDeps): GoblinPuppet {
  const character = deps.character ?? GOBLIN_PUPPET_CHARACTER;
  const entry = characterEntry(character);
  const errors = deps.errors ?? [];
  let face: FaceParams;
  try { face = { ...DEFAULT_FACE, ...compileFace(parseBlob(entry.src)) }; } catch { face = { ...DEFAULT_FACE }; }
  const view = createCharacterView({ name: character, start: [0, 0, 0], renderer: deps.renderer, scene: deps.parent, gpu: deps.gpu, errors, face });
  // At home: no armour kit, no shotgun. Retiring at birth makes the in-flight glTF loads dispose themselves on arrival.
  view.retireEquipment();
  const gpu = view.gpu;
  for (const e of view.body.errors) errors.push(e);

  // ——— The skin ————————————————————————————————————————————————————————————
  gpu.applyMaterial(view.palette ?? FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key']);
  {
    // THE GAME'S MARCH (game-spawn.ts spawns every body with these): plain sphere tracing, the hull-exit bound, the wound early-out and
    // its step, the last-step secant accept, and the footprint accept (aaCfg.y, the near fade aaCfg.z/w; aaCfg.x is the step's pixelConeK).
    const u = gpu.uniforms;
    u.woundCfg2.value.y = GAME_RELAX;
    u.perfCfg.value.set(GAME_HULL_EXIT_BOUND, GAME_WOUND_EARLY_OUT, GAME_WOUND_STEP, GAME_LAST_STEP_DEFAULT);
    u.marchCfg.value.y = GAME_OMEGA;
    u.aaCfg.value.y = GAME_AA;
    (u.aaCfg.value as unknown as { z: number; w: number }).z = GAME_AA_NEAR;
    (u.aaCfg.value as unknown as { z: number; w: number }).w = GAME_AA_FADE_M;
  }
  const sheetC = compileCharacterSheet(entry);
  const baseSheet = sheetC.sheet;
  // HIS OWN FACE, generated from the sheet block into an RGBA buffer that refreshSheet refills in place (sheetToRgba flips the rows: a
  // DataTexture gets no flipY; four equal channels: the shader reads tex.rgb).
  let faceTex: THREE.Texture | null = null;
  let generatedRgba: Uint8Array | null = null;
  const atlas = new THREE.Vector4(1, 1, 0, 0);
  if (baseSheet) {
    const gen = generateFaceSheet(baseSheet, SHEET_SIZE);
    generatedRgba = sheetToRgba(gen);
    const tex = new THREE.DataTexture(generatedRgba, gen.size, gen.size, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
    tex.needsUpdate = true;
    faceTex = tex;
    gpu.setFaceTexture(tex, atlas, gen.mean);
  } else {
    const f = sheetC.face;
    const tex = new THREE.TextureLoader().load(f.url);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = true;
    const [x, y, w, h, sw, shh] = f.rect;
    faceTex = tex;
    gpu.setFaceTexture(tex, new THREE.Vector4(w / sw, h / shh, x / sw, y / shh), f.mean);
  }
  {
    const u = gpu.uniforms;
    u.faceCfg.value.x = 1; u.faceCfg.value.y = 1.0;
    if (baseSheet) {
      u.faceProj.value.set(baseSheet.projScaleX, baseSheet.projScaleY, baseSheet.projCentreX, baseSheet.projCentreY);
      u.faceCfg.value.set(baseSheet.enabled ? (baseSheet.decal > 0.5 ? 2 : baseSheet.blendLuma > 0.5 ? 3 : 1) : 0, baseSheet.texStrength, baseSheet.faceForward, baseSheet.texRelief);
      u.faceCfg2.value.x = baseSheet.projSpherical;
      u.faceCfg2.value.z = baseSheet.eyeGlowCut;
      u.faceCfg2.value.w = baseSheet.eyeGlowAmp;
      u.faceGlowRedOnly.value = baseSheet.eyeGlowRedOnly;
    } else {
      u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
    }
    u.spotCfg2.value.w = GOBLIN_RIM;
    u.lightCfg.value.y = GOBLIN_FILL;
  }

  // ——— Into the SDF layer's scenes ——————————————————————————————————————————
  const objects: THREE.Object3D[] = [];
  const attach = (o: THREE.Object3D | undefined, layer: number) => { if (!o) return; o.layers.set(layer); deps.parent.add(o); objects.push(o); };
  attach(gpu.object, SDF_LAYER);
  attach(gpu.coneObject, CONE_LAYER);
  attach(gpu.depthPreObject, DEPTH_PREPASS_LAYER);
  attach(gpu.refineObject, REFINE_LAYER);

  // ——— The pose layer and the actor pipeline that pins the rig to it ————————————
  const current = view.body;
  const motion = makeActorMotion(current, { seed: SEED });
  if (!motion.motionJoints) throw new Error(`${character} has no motion joints: the pose layer cannot drive him`);
  const poseRig: PoseRig = makePoseRig(parseBlob(entry.src), motion.motionJoints.names, motion.motionJoints.base);
  const rng = makeRng(SEED);
  const signals = emptyActorSignals();
  const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  // The goblin's own profile minus the prop (no fist closed on a grip that is not there); the pose overwrites every target anyway.
  const profile = { ...entry.profile, prop: undefined };

  // ——— The face ———————————————————————————————————————————————————————————
  const exprSet = baseSheet ? expressionsFor(character) : null;
  let exprKey = baseSheet ? sheetKey(baseSheet) : '';
  let jawGape = 0;
  function refreshSheet(params: Parameters<typeof generateFaceSheet>[0]) {
    if (!faceTex || !generatedRgba) return;
    const gen = generateFaceSheet(params, SHEET_SIZE);
    sheetToRgba(gen, generatedRgba);
    faceTex.needsUpdate = true;
    gpu.setFaceTexture(faceTex, atlas, gen.mean);
  }

  let position: Vec3 = [0, 0, 0];
  let yaw = 0;
  let posed: BuildResult | null = null;
  let clipName = '';
  let rootDz = 0;

  return {
    character, view, gpu, body: current, errors,
    hasExpressions: exprSet !== null,
    get posed() { return posed; },
    get clipName() { return clipName; },
    get rootDz() { return rootDz; },
    get jawGape() { return jawGape; },
    get sheetKey() { return exprKey; },
    step(t, _dt, opts = {}) {
      const fps = Math.max(0, opts.fps ?? GOBLIN_FPS);
      // The pose at t, slid along the floor by his scoot (goblinRootAt), then placed.
      const { clip, local } = goblinClipAt(t, fps);
      clipName = clip.name;
      rootDz = goblinRootAt(t, fps);
      const place = (j: Vec3): Vec3 => {
        const r = rotateYaw([j[0], j[1], j[2] + rootDz], yaw);
        return [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
      };
      const identity = yaw === 0 && position[0] === 0 && position[1] === 0 && position[2] === 0;
      const posedJ = poseJoints(poseRig, clip, local);
      const joints = identity && rootDz === 0 ? posedJ : posedJ.map(place);
      stepActorMotion(motion, {
        current, dt: 1 / 60, wander: false, armStyle: undefined,
        headingFollow: MOTION_TUNING.headingFollow, gazeFollow: MOTION_TUNING.gazeFollow,
        bounds, rng, signals, profile, forceSpeed: 0, pose: joints,
      });
      // The pose is exact (pinTips and the bend stops after the rig step would re-hang the hands and feet and fold the crossed shins).
      motion.bound = pinToPose(motion.bound, joints);
      const bodyYaw = motion.lastBodyYaw + yaw;

      // The face, on the body's stepped clock (lab-main's stepExpression, with a scheduled blink in place of the clicked one).
      let bound: BoundRig = motion.bound;
      if (exprSet && baseSheet) {
        const tq = fps > 0 ? Math.floor(t * fps + 1e-9) / fps : t;
        const channels = opts.channelsAt ? opts.channelsAt(tq) : REST_CHANNELS;
        const act = actuate(withBlink(channels, scheduledBlinkLid(tq)), baseSheet, exprSet.tuning);
        jawGape = act.jawGape;
        // On a copy of the bound: the actor's next step must not see (and clear) the morphs; applyRig opens the `on jaw` prims by
        // rig.jawGape and moves the morph prims by rig.morphs.
        bound = { ...bound, rig: { ...bound.rig, jawGape: act.jawGape, morphs: act.morphs } };
        const key = sheetKey(act.sheet);
        if (key !== exprKey) { exprKey = key; refreshSheet(act.sheet); }
      }

      // Upload.
      const p = applyRig(current, bound, bodyYaw);
      posed = p;
      gpu.update(p, current);
      const root = identity ? [0, 0, rootDz] as Vec3 : place([0, 0, 0]);
      gpu.setRootShift(root[0], root[2], bodyYaw);
      const skull = headShape(p);
      if (skull) gpu.setHeadShape(skull.centre, skull.axes);
      gpu.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
      gpu.setTime(t);
      if (opts.pixelConeK !== undefined) gpu.uniforms.aaCfg.value.x = opts.pixelConeK;
      return p;
    },
    setPlacement(pos, y) { position = [pos[0], pos[1], pos[2]]; yaw = y; },
    setLighting(l) {
      if (l.dir) gpu.uniforms.lightDir.value.set(l.dir[0], l.dir[1], l.dir[2]);
      if (l.rim !== undefined) gpu.uniforms.spotCfg2.value.w = l.rim;
      if (l.fill !== undefined) gpu.uniforms.lightCfg.value.y = l.fill;
    },
    setVisible(on) {
      gpu.object.visible = on;
      gpu.coneObject.visible = on;
      if (gpu.depthPreObject) gpu.depthPreObject.visible = on;
      if (gpu.refineObject) gpu.refineObject.visible = on;
    },
    dispose() {
      for (const o of objects) o.removeFromParent();
      view.dispose();
      faceTex?.dispose();
    },
  };
}
