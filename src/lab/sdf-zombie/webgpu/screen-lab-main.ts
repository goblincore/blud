// src/lab/sdf-zombie/webgpu/screen-lab-main.ts
//
// THE SCREEN EMERGENCE LAB (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, plan Tasks 5 and 6): a standalone,
// scrubbable page with the set (the P225f CRT, the Flat's low kotatsu with the keyboard and the lamp on it, the tower on the floor beside
// it, a zabuton, the tatami: look round 1 made it floor level like the apartment), the REAL SDF goblin cross-legged on the cushion, posed
// from the clock by the pose layer and pushed back a little along the floor (screen-lab-goblin.ts goblinRootAt), and THE SCREEN PASS: the march (screen-emergence.wgsl.ts) on a proxy box in the screen's frame, drawn in the
// SDF layer's late scene with its own depth (screen-pass.ts createScreenPass / updateScreenPass, shared with the game; the set's builders are screen-set.ts's, shared too). `pass on` / `?nopass=1` / `__screenLab.setPass` swap it for the placeholder
// glass (the Night Train still, flat); `?passdebug=1` / `setPassDebug` shows the march's steps, hits and materials. The goo (plan Task 7)
// is goo-strands.ts's sim uploaded as a texel row each frame from 7 s on, cached per t; `?nogoo=1` / `setGoo` leaves it out (its cost);
// `setOrbit` points the free camera (the look checks' front and side views).
//
// HOW THE GOBLIN IS HOSTED. The same pieces the flame lab and the WebGPU lab use, nothing more: `createLabRenderer`, `createSdfLayer`
// (the march renders into its own target and composites over the polygonal pass with depth), `createPostAa` (sizes the layer; every
// effect off), and `createCharacterView('goblin-home')` (the goblin in his home clothes; `?character=goblin` for the plain body), fed by the actor pipeline (`makeActorMotion` / `stepActorMotion`) with the pose layer's
// joints (`MotionConfig.pose` pins every rig point, so one step per frame lands the pose exactly and a scrub is deterministic). The kit and
// the shotgun are retired at birth: he is at home.
//
// FRAMES. The goblin lives in his own frame (the floor at y 0, the hips over the origin, facing +z): the motion system's. The set is built
// in THE SCREEN'S frame (origin at the glass centre, +x right, +y up, +z out of the glass toward the room, metres; emergence-field.ts),
// as children of `screen`, a group turned to face him. Where the group sits is MEASURED off the goblin posed in `floor-type` (measureSeat,
// floorLayout): the keyboard's top under his palms, the board a keyboard below it (so the glass centre is `DESK_Y` above that), the
// keyboard under his hands, the cushion's top under his pelvis; the page reports the measured board height against the Flat's (KOTATSU).
// The zabuton lives in HIS frame (not the screen's) and slides with his scoot.
//
// The goblin is the 1.70 m body: thigh 0.379 m, shin 0.353 m, upper arm 0.307 m, forearm 0.307 m.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, CONE_LAYER } from './sdf-layer';
import { createCharacterView, compileCharacterSheet } from './character-view';
import { createPostAa } from './post-aa';
import { headShape } from './flame-anchors';
import { characterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileFace } from '../blob-compile';
import { generateFaceSheet } from '../blob-face-sheet';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import { applyRig, headQuatOf } from '../rig-bind';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { MOTION_TUNING } from '../motion';
import { makeRng } from '../wander';
import { makePoseRig, poseJoints, type PoseRig } from '../pose';
import {
  GLASS, EGG, KEYBOARD, KOTATSU, ellipsoidDist, eggCentre,
} from './emergence-field';
import { PASS_LAMP, createScreenPass, updateScreenPass } from './screen-pass';
import {
  LAMP_BULB, beigeMaterials, buildCrt, buildKeyboard, buildLamp, buildScreenGlow, buildTableAndRoom, buildZabuton,
} from './screen-set';
import { SHOTS, DURATION, shotAt, paramsAt, type ShotId } from './emergence-timeline';
import { FLOOR_SEAT } from '../characters/goblin-poses';
import { GOBLIN_CUES, GOBLIN_FPS, floorLayout, goblinClipAt, goblinRootAt, measureSeat, pinToPose, type FloorLayout } from './screen-lab-goblin';
import {
  GAME_AA, GAME_AA_FADE_M, GAME_AA_NEAR, GAME_LAST_STEP_DEFAULT, GAME_RELAX, GAME_HULL_EXIT_BOUND, GAME_WOUND_EARLY_OUT, GAME_OMEGA, GAME_WOUND_STEP,
} from './game-march-accept';
import type { Vec3 } from '../types';

// ---------------------------------------------------------------------------
// The set (screen-set.ts, shared with the game): the P225f (docs/dev-notes/2026-10-01-flat-emergence-lookdev/crt_p225f.py), the keyboard,
// the lamp, the screen's glow and the zabuton, plus this page's own kotatsu, tower, tatami and walls (buildTableAndRoom).
// ---------------------------------------------------------------------------
// The front frame (CRT_FRAME: w, h, its depth, the chin under the glass; FRAME_BOTTOM, the chin below the glass's lower edge, which the
// pedestal fills up to) is emergence-field's: the drips are kept in front of the chin. So are the frame's front face (FRAME_FACE_Z, the
// bevel's depth, 0.03 in the blockout) and the keyboard (KEYBOARD: thickness, depth, width, the gap to the CRT's face, its key rows): the
// drips land on the keyboard, the egg lands on it, and the pass draws the goo coat over it (the owner's second notes: it never moves).
// The kotatsu (KOTATSU: the board's height, size and skirt) and its front edge (TABLE_FRONT_Z, past the egg's slick) are the field's too.
/** The SDF pass's render scale (see `sdfLayer.setScale` in bootstrap). */
const SDF_SCALE = 0.5;
/** The goblin's cold rim/fill strength (spotCfg2.w, see where the key is aimed in bootstrap); `?rim=` overrides, 0 turns it off. */
const GOBLIN_RIM = 1.5;
/** The goblin's flat fill (lightCfg.y; the practical key preset's is 0.06), doubled-ish so his back is not black; `?fill=` overrides. */
const GOBLIN_FILL = 0.10;

// ---------------------------------------------------------------------------
// Camera presets, in the screen frame: an eye, a look-at and a vertical fov (plan Task 5 step 4).
// ---------------------------------------------------------------------------
interface Preset { eye: Vec3; at: Vec3; fov: number }
/** The push cuts wider inside its shot, at this time. */
const PUSH_WIDE_AT = 4.5;
/** Look round 1 (the floor-level set, the goblin backing away): the owner did not like the goblin filling the push shot, so the push opens
 *  three-quarter on the screen with him leaning away at the frame's edge and cuts to a wide profile, him small on the floor well back from
 *  the sac. Where he is in the screen frame (floorLayout, goblinRootAt): typing, his hips at z 0.87 and the top of his head 0.3 m over the
 *  glass centre; slid back, his hips at z 1.42 and his hands on the floor at 1.9; kneeling and reaching, his hips at 0.94. */
const PRESETS: Record<ShotId | 'push-wide', Preset> = {
  // Close on the screen from low front-right, over the board in front of his right hand (his hands at the frame's bottom right).
  'glass-gives': { eye: [0.42, -0.12, 0.4], at: [-0.06, -0.02, 0], fov: 42 },
  // The push opens three-quarter on the bulging screen from the front-right, in front of him: he has backed off out of the frame...
  push: { eye: [0.72, -0.12, 0.62], at: [-0.04, -0.1, 0.08], fov: 46 },
  // ...and cuts wide: a profile from his right, 2.4 m off, the whole kotatsu, the sac coming into the room and him small on the floor
  // well back from it.
  'push-wide': { eye: [2.4, 0.12, 1.05], at: [0, -0.3, 0.78], fov: 44 },
  // Crowning: close on the tear from the egg's right side (he is behind the lens).
  crowning: { eye: [0.62, -0.05, 0.72], at: [0, 0, 0.32], fov: 45 },
  // Out: high behind and to his left, 3 m back, past him to the egg slumping onto the keyboard (he is in the lower foreground).
  out: { eye: [-1.4, 0.7, 3.0], at: [0.05, -0.3, 0.4], fov: 40 },
  // Settle (the owner's third notes: the sequence ends with him sitting up and looking at the egg): low from his front-right, three-quarter
  // on his face (his head at about (0, 0.17, 0.92), looking down at the egg on the keyboard at (0, -0.12, 0.19)), so his head and the egg in
  // its goo are in frame together, the healing screen beyond the egg.
  settle: { eye: [1.15, 0.04, 0.02], at: [0, -0.07, 0.52], fov: 42 },
};
const presetAt = (t: number): Preset => {
  const s = shotAt(t).id;
  return s === 'push' && t >= PUSH_WIDE_AT ? PRESETS['push-wide'] : PRESETS[s];
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
interface ScreenLabSeam {
  ready: boolean;
  setT(t: number): void;
  setShot(id: ShotId): void;
  setPass(on: boolean): void;
  setGooShadow(on: boolean): void;
  setPassDebug(on: boolean): void;
  /** The goo in the pass on or off (for its cost; `?nogoo=1`). */
  setGoo(on: boolean): void;
  /** The free camera's orbit (yaw, pitch in radians, distance in metres; round the point in front of the glass, or round `at`, a point in
   *  the screen frame), switching to it. */
  setOrbit(yaw: number, pitch: number, dist: number, at?: Vec3): void;
  timeDraws(n: number): Promise<number>;
  readonly t: number;
  /** The set as measured off the goblin, once built. */
  layout: FloorLayout | null;
  /** The hands' centres and the egg's centre at the current `t`, in the screen frame (metres), each hand's centre's distance to the egg's
   *  surface (the ellipsoid distance; negative inside) and its flesh's (that less the hand prim's radius): the hands stay off the egg (he
   *  only looks at it since the owner's third notes). */
  probe(): { hands: Record<string, Vec3>; egg: Vec3; handToSurface: Record<string, number>; handFleshGap: Record<string, number> } | null;
}

async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) return;
  const statusEl = document.getElementById('status')!;
  statusEl.textContent = '';
  const say = (msg: string, bad = false) => {
    const line = document.createElement('div');
    line.textContent = msg;
    if (bad) line.style.color = '#ff6464';
    statusEl.appendChild(line);
    (bad ? console.error : console.info)(`[screen-lab] ${msg}`);
  };

  const q = new URLSearchParams(location.search);
  const num = (k: string) => { const v = q.get(k); return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; };

  const seam: ScreenLabSeam = {
    ready: false, setT: () => {}, setShot: () => {}, setPass: () => {}, setGooShadow: () => {}, setPassDebug: () => {}, setGoo: () => {}, setOrbit: () => {},
    timeDraws: async () => NaN, t: 0, layout: null, probe: () => null,
  };
  (window as unknown as { __screenLab: ScreenLabSeam }).__screenLab = seam;

  // The render size: a FIXED buffer, 640 x 480 by default (a light preview: the owner's machine heats up at 1280 x 800). `?res=1280x800`
  // (or the select in the controls) brings the full size back; the headless check and the cost numbers in the notes use 1280x800.
  const resParam = /^(\d{3,4})x(\d{3,4})$/.exec(q.get('res') ?? '');
  const [renderW, renderH] = resParam ? [Number(resParam[1]), Number(resParam[2])] : [640, 480];
  const resSel = document.getElementById('res') as HTMLSelectElement | null;
  if (resSel) {
    resSel.value = `${renderW}x${renderH}`;
    if (resSel.value !== `${renderW}x${renderH}`) resSel.add(new Option(`${renderW}x${renderH}`, `${renderW}x${renderH}`, true, true));
    resSel.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('res', resSel.value); location.href = u.toString(); });
  }
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: renderW, height: renderH });
  const { scene, camera, renderer } = handle;
  say(`backend: ${handle.backend}`, handle.backend !== 'webgpu');
  // A dark room: drop the lab renderer's sun and ambient; the lamp, the screen's glow and a dim street-blue fill light the set.
  for (const o of [...scene.children]) if ((o as THREE.Light).isLight) scene.remove(o);
  renderer.setClearColor(new THREE.Color(0x050407));
  scene.fog = new THREE.Fog(0x050407, 5, 14);
  scene.add(new THREE.HemisphereLight(0x2a3550, 0x0c0a08, 0.35));

  const sdfLayer = createSdfLayer(renderer);
  // The SDF pass's render scale: 0.5 of a 1280-wide canvas (the layer's default is 0.7), i.e. about 640 SDF pixels across whatever the canvas size (1.0 at 640 x 480). With the game's march the goblin alone at `glass-gives`
  // (1280 x 800, his forearm filling a third of the frame) measured 47 ms at 0.7 and 25 ms at 0.5 (plan Task 6); `?sdfscale=` overrides.
  sdfLayer.setScale(Math.min(1, Math.max(0.2, num('sdfscale') ?? Math.min(1, SDF_SCALE * 1280 / renderW))));
  const postAa = createPostAa(renderer);
  postAa.addSink(sdfLayer);

  // ——— The goblin ————————————————————————————————————————————————————————
  // At home he wears his home clothes: `goblin-home` (goblin.blob plus a vest and shorts of SDF `shell` cloth and bare feet, plan Task 10).
  // `?character=goblin` puts the plain body back (no cloth, the shins ending in the air where the kit's boots would be): the A/B for the
  // cloth's cost.
  const character = q.get('character') === 'goblin' ? 'goblin' : 'goblin-home';
  const entry = characterEntry(character);
  say(`character: ${character}`);
  let face: FaceParams;
  try { face = { ...DEFAULT_FACE, ...compileFace(parseBlob(entry.src)) }; } catch { face = { ...DEFAULT_FACE }; }
  const errors: string[] = [];
  const view = createCharacterView({
    name: character, start: [0, 0, 0], renderer, scene,
    gpu: { cone: sdfLayer.cone, occluder: sdfLayer.occluder },
    errors, face,
  });
  // At home: no armour kit, no shotgun. Retiring at birth makes the in-flight glTF loads dispose themselves on arrival.
  view.retireEquipment();
  const gpu = view.gpu;
  for (const e of [...errors, ...view.body.errors]) say(`goblin: ${e}`, true);
  // Skin as the game's (game-spawn.ts): the .blob's own palette under the practical key, the face sheet's projection, and his own face
  // generated from the sheet block (below; the lab's loadGeneratedFace).
  gpu.applyMaterial(view.palette ?? FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key']);
  // THE GAME'S MARCH, not the lab's (game-spawn.ts spawns every body with these): plain sphere tracing (step multiplier 1.0, no
  // relaxation), the hull-exit bound, the wound early-out and its 1.0 step, the last-step secant accept at 4, and the footprint accept
  // (aaCfg.y, near-distance fade aaCfg.z/w; aaCfg.x, one pixel, is refreshed every frame). Measured on this page (plan Task 6): the goblin
  // alone at `glass-gives` went from 61-62 ms (steady; 82-88 on a cold first run) to 47-48 ms at the layer's 0.7 scale.
  {
    const u = gpu.uniforms;
    u.woundCfg2.value.y = GAME_RELAX;
    u.perfCfg.value.set(GAME_HULL_EXIT_BOUND, GAME_WOUND_EARLY_OUT, GAME_WOUND_STEP, GAME_LAST_STEP_DEFAULT);
    u.marchCfg.value.y = GAME_OMEGA;
    u.aaCfg.value.y = GAME_AA;
    (u.aaCfg.value as unknown as { z: number; w: number }).z = GAME_AA_NEAR;
    (u.aaCfg.value as unknown as { z: number; w: number }).w = GAME_AA_FADE_M;
  }
  {
    const sheetC = compileCharacterSheet(entry);
    const sheet = sheetC.sheet;
    if (sheet) {
      // HIS OWN FACE: generated from the .blob's `sheet` block (eyes, brow, mouth, nose, grain), as the lab's loadGeneratedFace and the
      // flame lab do. `sheetC.face` is the registry's face slot, which for the goblin is the SHARED zombie sheet (ZOMBIE_FLAT): worn here
      // it put the zombie's flat face and red eyes on him. The generator writes greyscale rows from the top-left; expanded to RGBA (the
      // shader reads tex.rgb: a RedFormat upload renders the head red) and flipped here (a DataTexture gets no flipY), whole-image atlas.
      const gen = generateFaceSheet(sheet, 64);
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
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
      tex.needsUpdate = true;
      gpu.setFaceTexture(tex, new THREE.Vector4(1, 1, 0, 0), gen.mean);
    } else {
      const f = sheetC.face;
      const tex = new THREE.TextureLoader().load(f.url);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = true;
      const [x, y, w, h, sw, shh] = f.rect;
      gpu.setFaceTexture(tex, new THREE.Vector4(w / sw, h / shh, x / sw, y / shh), f.mean);
    }
    const u = gpu.uniforms;
    u.faceCfg.value.x = 1; u.faceCfg.value.y = 1.0;
    if (sheet) {
      u.faceProj.value.set(sheet.projScaleX, sheet.projScaleY, sheet.projCentreX, sheet.projCentreY);
      u.faceCfg.value.set(sheet.enabled ? (sheet.decal > 0.5 ? 2 : sheet.blendLuma > 0.5 ? 3 : 1) : 0, sheet.texStrength, sheet.faceForward, sheet.texRelief);
      u.faceCfg2.value.x = sheet.projSpherical;
      u.faceCfg2.value.z = sheet.eyeGlowCut;
      u.faceCfg2.value.w = sheet.eyeGlowAmp;
      u.faceGlowRedOnly.value = sheet.eyeGlowRedOnly;
    } else {
      u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
    }
  }
  gpu.object.layers.set(SDF_LAYER);
  gpu.coneObject.layers.set(CONE_LAYER);
  scene.add(gpu.object);
  scene.add(gpu.coneObject);

  // The pose layer on the goblin's own skeleton, and the actor pipeline that pins the rig to it.
  const current = view.body;
  const motion = makeActorMotion(current, { seed: 1709 });
  if (!motion.motionJoints) throw new Error('the goblin has no motion joints: the pose layer cannot drive him');
  const poseRig: PoseRig = makePoseRig(parseBlob(entry.src), motion.motionJoints.names, motion.motionJoints.base);
  const rng = makeRng(1709);
  const signals = emptyActorSignals();
  const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  // The goblin's own profile minus the prop (no fist closed on a grip that is not there); the pose overwrites every target anyway.
  const profile = { ...entry.profile, prop: undefined };
  // The pose at t, slid along the floor by his scoot (goblinRootAt: he pushes himself back a little from the table a beat after the sac
  // bulges, and sits up there to look at the egg once it has landed: GOBLIN_CUES). The joints carry the offset, so the pinned rig, the flesh
  // and the cone follow; `rootDz` feeds the noise root shift (the skin's texture rides with him) and the zabuton.
  // HIS LIMITED FRAME RATE: his body (the clip's clock and the pushback) steps at GOBLIN_FPS poses a second, early-CG style, while the egg,
  // the goo and the camera run smooth; `?fps=0` is the smooth clock for comparison, `?fps=N` any other rate.
  const goblinFps = Math.max(0, num('fps') ?? GOBLIN_FPS);
  const c = GOBLIN_CUES;
  say(`goblin: ${goblinFps > 0 ? `${goblinFps} fps` : 'smooth'}; bulge ${c.bulgeSeen.toFixed(2)} s, flinch ${c.flinch.toFixed(2)}, braced ${c.braced.toFixed(2)}, egg lands ${c.land.toFixed(2)}, sits up ${c.sitUp.toFixed(2)} to ${c.sitUpDone.toFixed(2)}`);
  let rootDz = 0;
  const poseAt = (t: number) => {
    const { clip, local } = goblinClipAt(t, goblinFps);
    rootDz = goblinRootAt(t, goblinFps);
    const posedJ = poseJoints(poseRig, clip, local);
    const joints = rootDz === 0 ? posedJ : posedJ.map(j => [j[0], j[1], j[2] + rootDz] as Vec3);
    stepActorMotion(motion, {
      current, dt: 1 / 60, wander: false, armStyle: undefined,
      headingFollow: MOTION_TUNING.headingFollow, gazeFollow: MOTION_TUNING.gazeFollow,
      bounds, rng, signals, profile, forceSpeed: 0, pose: joints,
    });
    // The pose is exact (pinTips and the bend stops after the rig step would re-hang the hands and feet and fold the crossed shins).
    motion.bound = pinToPose(motion.bound, joints);
    return clip.name;
  };
  let lastPosed: ReturnType<typeof applyRig> | null = null;
  const upload = () => {
    const posed = applyRig(current, motion.bound, motion.lastBodyYaw);
    lastPosed = posed;
    gpu.update(posed, current);
    gpu.setRootShift(0, rootDz, motion.lastBodyYaw);
    const skull = headShape(posed);
    if (skull) gpu.setHeadShape(skull.centre, skull.axes);
    gpu.setHeadRotation(headQuatOf(motion.bound, motion.lastBodyYaw) ?? [0, 0, 0, 1]);
    return posed;
  };

  // ——— Measure the seat off the typing pose, then build the set from it —————
  for (let i = 0; i < 3; i++) poseAt(1.0); // `floor-type` held (no scoot yet)
  const seat = measureSeat(upload().prims);
  const layout = floorLayout(seat);
  seam.layout = layout;
  say(`seat (measured, floor-type): palms ${seat.palmY.toFixed(3)} m, seat ${seat.seatY.toFixed(3)} m, hands z ${seat.handZ.toFixed(3)}, knees top ${seat.kneeTopY.toFixed(3)}`);
  say(`set: glass centre ${layout.glassY.toFixed(3)} m above the floor, ${layout.glassZ.toFixed(3)} m in front of the hips; kotatsu top ${layout.tableTopY.toFixed(3)} m (the Flat's ${KOTATSU.top}); knee clearance ${layout.kneeClearance.toFixed(3)} m; cushion top ${layout.seatTopY.toFixed(3)} m (authored ${FLOOR_SEAT.top})`,
    Math.abs(layout.tableTopY - KOTATSU.top) > 0.005 || Math.abs(layout.seatTopY - FLOOR_SEAT.top) > 0.005 || layout.kneeClearance < 0.01);
  if (layout.handHalfSpan > KEYBOARD.w / 2) say(`hands (±${layout.handHalfSpan.toFixed(3)}) wider than the keyboard`, true);
  // The zabuton, in his frame, its top at the measured seat; slid with his scoot every frame.
  const zabuton = buildZabuton(scene, layout.seatTopY);

  // The screen frame: turned to face the goblin (he faces +z, the glass faces +z in its own frame), the glass at the measured place.
  const screen = new THREE.Group();
  screen.name = 'screen-frame';
  screen.rotation.y = Math.PI;
  screen.position.set(0, layout.glassY, layout.glassZ);
  scene.add(screen);
  screen.updateMatrixWorld(true);
  // The set: the CRT and, on the board, the keyboard and the lamp (what the game builds on the Flat's kotatsu), and this page's own table
  // and room (the tower shares the keyboard's beige).
  const beige = beigeMaterials();
  buildCrt(screen);
  buildTableAndRoom(screen, layout, beige);
  buildKeyboard(screen, beige);
  buildLamp(screen);
  buildScreenGlow(screen);

  // The placeholder glass: the Night Train still, flat at z = 0, a hair of emission so it reads as a lit tube. The pass replaces it.
  const pictureTex = new THREE.TextureLoader().load('/assets/lab/screen-source.png',
    () => say('picture: /assets/lab/screen-source.png'),
    undefined,
    () => say('picture: /assets/lab/screen-source.png FAILED to load', true));
  pictureTex.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(GLASS.hw * 2, GLASS.hh * 2), new THREE.MeshBasicMaterial({ map: pictureTex }));
  glass.name = 'placeholder-glass';
  screen.add(glass);

  // The screen pass: the proxy in the SDF layer's late scene (after the flesh composite, depth-tested against it), placed as the screen.
  // The pass (screen-pass.ts, shared with the game) takes the set's lamp; its switches are this page's state, handed in every frame.
  const pass = createScreenPass(pictureTex, { lampBulb: LAMP_BULB, lampStrength: PASS_LAMP });
  pass.proxy.position.copy(screen.position);
  pass.proxy.quaternion.copy(screen.quaternion);
  sdfLayer.lateScene.add(pass.proxy);
  let passDebug = q.get('passdebug') === '1';
  let gooOn = q.get('nogoo') !== '1';

  // The goblin's key light: from the lamp's side and above, warm (the practical preset's colour stays; only the direction follows the set).
  {
    const lampW = new THREE.Vector3(...LAMP_BULB).applyMatrix4(screen.matrixWorld);
    const chest = new THREE.Vector3(0, 0.95, 0.15);
    const d = lampW.sub(chest).normalize();
    gpu.uniforms.lightDir.value.set(d.x, d.y, d.z);
    // A dim COLD RIM AND FILL, so he does not go to black from behind (the push and out shots look over his back, and the lamp alone keys
    // him from the front-left). The march's built-in side rim (compose.wgsl.ts, spotCfg2.w): a cold grazing edge on the lamp's side plus a
    // soft cold fill on the side facing the camera, whichever way it looks. No new light, no new pass: one uniform. The game's lamps
    // drive it at about 0.35-1.2 (game-dynamic-light.ts BODY_LAMP_RIM); GOBLIN_RIM is chosen by eye at the push and out shots.
    // And a little more of the preset's flat fill (key-coloured, so warm) under it: at the preset's 0.06 his back read near black.
    gpu.uniforms.spotCfg2.value.w = num('rim') ?? GOBLIN_RIM;
    gpu.uniforms.lightCfg.value.y = num('fill') ?? GOBLIN_FILL;
  }

  // ——— Sizing ————————————————————————————————————————————————————————————
  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
  }
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);

  // ——— State: the clock, the shot, the camera ————————————————————————————
  let t = Math.min(DURATION, Math.max(0, num('t') ?? 0));
  const shotParam = q.get('shot');
  if (shotParam) {
    const s = SHOTS.find(x => x.id === shotParam);
    if (s) t = s.start; else say(`unknown ?shot=${shotParam}`, true);
  }
  let playing = false;
  let speed = 1;
  let free = q.get('free') === '1';
  let passOn = q.get('nopass') !== '1';
  let gooShadow = true;
  let clipName = '';

  // The free camera: an orbit round a point in front of the glass, in world.
  // The free camera starts on the goblin's right (world -x), a little toward the kotatsu: the cushion, the hands on the keys, the glass in profile.
  const orbit = { yaw: -1.25, pitch: 0.38, dist: 2.0, target: new THREE.Vector3(0, layout.glassY - 0.1, layout.glassZ * 0.5) };
  const eyeW = new THREE.Vector3(), atW = new THREE.Vector3();
  let lastFov = camera.fov;
  function applyCamera() {
    if (free) {
      const cp = Math.cos(orbit.pitch);
      camera.position.set(
        orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
        orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
        orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
      );
      camera.lookAt(orbit.target);
      camera.fov = 50;
    } else {
      const p = presetAt(t);
      eyeW.set(...p.eye).applyMatrix4(screen.matrixWorld);
      atW.set(...p.at).applyMatrix4(screen.matrixWorld);
      camera.position.copy(eyeW);
      camera.lookAt(atW);
      camera.fov = p.fov;
    }
    if (camera.fov !== lastFov) {
      lastFov = camera.fov;
      camera.updateProjectionMatrix();
      sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
    }
  }

  // ——— Controls ———————————————————————————————————————————————————————————
  const slider = document.getElementById('t') as HTMLInputElement;
  const tRead = document.getElementById('t-read')!;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const speedSel = document.getElementById('speed') as HTMLSelectElement;
  const freeBtn = document.getElementById('free') as HTMLButtonElement;
  const shotsEl = document.getElementById('shots')!;
  const gooBox = document.getElementById('goo-shadow') as HTMLInputElement;
  const passBox = document.getElementById('pass-on') as HTMLInputElement;
  slider.max = String(DURATION);
  const shotBtns = new Map<ShotId, HTMLButtonElement>();
  for (const s of SHOTS) {
    const b = document.createElement('button');
    b.textContent = s.id;
    b.addEventListener('click', () => seam.setShot(s.id));
    shotsEl.appendChild(b);
    shotBtns.set(s.id, b);
  }
  const syncUi = () => {
    slider.value = String(t);
    tRead.textContent = `t ${t.toFixed(2)}`;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    freeBtn.classList.toggle('on', free);
    const cur = shotAt(t).id;
    for (const [id, b] of shotBtns) b.classList.toggle('on', !free && id === cur);
    gooBox.checked = gooShadow;
    passBox.checked = passOn;
  };
  slider.addEventListener('input', () => { t = Number(slider.value); syncUi(); });
  playBtn.addEventListener('click', () => { if (!playing && t >= DURATION) t = 0; playing = !playing; syncUi(); });
  speedSel.addEventListener('change', () => { speed = Number(speedSel.value); });
  freeBtn.addEventListener('click', () => { free = !free; syncUi(); });
  gooBox.addEventListener('change', () => seam.setGooShadow(gooBox.checked));
  passBox.addEventListener('change', () => seam.setPass(passBox.checked));

  const canvas = renderer.domElement;
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => { if (!free) return; dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', (e) => { dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - lastX) * 0.008;
    orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    if (!free) return;
    orbit.dist = Math.max(0.4, Math.min(6, orbit.dist + Math.sign(e.deltaY) * 0.15));
  }, { passive: true });

  // ——— The seam (for the headless check) ———————————————————————————————
  seam.setT = (v: number) => { t = Math.min(DURATION, Math.max(0, v)); syncUi(); };
  seam.setShot = (id: ShotId) => {
    const s = SHOTS.find(x => x.id === id);
    if (!s) throw new Error(`unknown shot ${id}`);
    t = s.start; free = false; syncUi();
  };
  seam.setPass = (on: boolean) => { passOn = on; syncUi(); };
  seam.setGooShadow = (on: boolean) => { gooShadow = on; syncUi(); };
  seam.setPassDebug = (on: boolean) => { passDebug = on; };
  seam.setGoo = (on: boolean) => { gooOn = on; };
  seam.setOrbit = (yaw: number, pitch: number, dist: number, at?: Vec3) => {
    orbit.yaw = yaw; orbit.pitch = pitch; orbit.dist = dist; free = true;
    if (at) orbit.target.set(...at).applyMatrix4(screen.matrixWorld);
    syncUi();
  };
  seam.timeDraws = async (n: number) => {
    // Hand-stepped frames behind a GPU fence (lab-renderer's step/resolveGpu): wall ms per frame, the compositor out of the loop.
    handle.setLoopRunning(false);
    try {
      for (let i = 0; i < 10; i++) handle.step(0);
      await handle.resolveGpu();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) handle.step(0);
      await handle.resolveGpu();
      return (performance.now() - t0) / Math.max(1, n);
    } finally {
      handle.setLoopRunning(true);
    }
  };
  Object.defineProperty(seam, 't', { get: () => t });
  seam.probe = () => {
    if (!lastPosed) return null;
    const toScreen = new THREE.Matrix4().copy(screen.matrixWorld).invert();
    const hands: Record<string, Vec3> = {};
    const handR: Record<string, number> = {};
    for (const p of lastPosed.prims) {
      if (!p.bone || !/^hand\.[lr]$/.test(p.bone)) continue;
      const v = new THREE.Vector3((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2).applyMatrix4(toScreen);
      hands[p.bone] = [v.x, v.y, v.z];
      handR[p.bone] = Math.max(p.radius, p.radiusB ?? p.radius) * Math.min(...p.scale);
    }
    const egg = eggCentre(paramsAt(t));
    const handToSurface: Record<string, number> = {};
    const handFleshGap: Record<string, number> = {};
    for (const [k, h] of Object.entries(hands)) {
      handToSurface[k] = ellipsoidDist([h[0] - egg[0], h[1] - egg[1], h[2] - egg[2]], [EGG.rx, EGG.ry, EGG.rz]);
      handFleshGap[k] = handToSurface[k]! - handR[k]!;
    }
    return { hands, egg, handToSurface, handFleshGap };
  };

  // ——— The frame ——————————————————————————————————————————————————————————
  const statsEl = document.getElementById('stats')!;
  const frameMs: number[] = [];
  /** CPU ms of the pose step and the body upload (the goblin's whole CPU cost per frame). */
  const tickMs: number[] = [];
  let lastStamp = performance.now();
  let pendingReady = false;
  handle.setRenderCallback((dt) => {
    const now = performance.now();
    frameMs.push(now - lastStamp);
    lastStamp = now;
    if (frameMs.length > 90) frameMs.shift();
    if (playing) {
      t = Math.min(DURATION, t + dt * speed);
      if (t >= DURATION) playing = false;
      syncUi();
    }
    const c0 = performance.now();
    clipName = poseAt(t);
    upload();
    zabuton.position.z = rootDz;
    tickMs.push(performance.now() - c0);
    if (tickMs.length > 90) tickMs.shift();
    gpu.setTime(t);
    applyCamera();
    // The pass on, the placeholder glass off (and back).
    pass.proxy.visible = passOn;
    glass.visible = !passOn;
    if (passOn) updateScreenPass(pass, t, { camera, heightPx: renderer.domElement.height, debug: passDebug, gooShadow, goo: gooOn });
    gpu.uniforms.aaCfg.value.x = sdfLayer.pixelConeK;
    const sorted = [...frameMs].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const tick = [...tickMs].sort((a, b) => a - b)[Math.floor(tickMs.length / 2)] ?? 0;
    statsEl.textContent = `frame ${med.toFixed(1)} ms (median, rAF)  pose+upload ${tick.toFixed(2)} ms cpu\nt ${t.toFixed(2)} / ${DURATION}\nshot ${shotAt(t).id}${free ? ' (free cam)' : ''}\nclip ${clipName}\npass ${passOn ? 'on' : 'off'}  goo shadow ${gooShadow ? 'on' : 'off'}`;
  });
  handle.setDrawFn(() => {
    postAa.render(() => sdfLayer.render(scene, camera));
    if (!seam.ready && !pendingReady) {
      pendingReady = true;
      void handle.resolveGpu().then(() => { seam.ready = true; say('ready'); });
    }
  });
  syncUi();
  say(`goblin: ${current.prims.length} prims; the screen pass ${passOn ? 'on' : 'off (?nopass=1)'}`);
}

bootstrap().catch((err) => {
  const el = document.getElementById('status');
  if (el) {
    const line = document.createElement('div');
    line.style.color = '#ff6464';
    line.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
    el.appendChild(line);
  }
  console.error('[screen-lab] bootstrap failed', err);
});
