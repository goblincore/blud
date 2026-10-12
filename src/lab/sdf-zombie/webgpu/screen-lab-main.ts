// src/lab/sdf-zombie/webgpu/screen-lab-main.ts
//
// THE SCREEN EMERGENCE LAB (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, plan Tasks 5 and 6): a standalone,
// scrubbable page with the set (the P225f CRT, the desk, the lamp, the tower, the room), the REAL SDF goblin seated at the desk, posed from
// the clock by the pose layer, and THE SCREEN PASS: the march (screen-emergence.wgsl.ts) on a proxy box in the screen's frame, drawn in the
// SDF layer's late scene with its own depth (createScreenPass). `pass on` / `?nopass=1` / `__screenLab.setPass` swap it for the placeholder
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
// as children of `screen`, a group turned to face him. Where the group sits is MEASURED off the goblin posed in `type` (measureSeat): the
// keyboard's top under his palms, the desk's top a keyboard below it (so the glass centre is `DESK_Y` above that), the chair's seat under
// his pelvis, the desk's front edge clear of his knees. Nothing about the seat is typed in.
//
// The goblin is the 1.70 m body: thigh 0.379 m, shin 0.353 m, upper arm 0.307 m, forearm 0.307 m.
import * as THREE from 'three/webgpu';
import {
  cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, floor, modelWorldMatrixInverse, normalize, positionLocal, positionWorld,
  texture, uniform, vec4, wgslFn,
} from 'three/tsl';
import { createLabRenderer } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, CONE_LAYER } from './sdf-layer';
import { createCharacterView, compileCharacterSheet } from './character-view';
import { createPostAa } from './post-aa';
import { headShape } from './flame-anchors';
import { characterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileFace } from '../blob-compile';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import { applyRig, headQuatOf } from '../rig-bind';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { MOTION_TUNING } from '../motion';
import { makeRng } from '../wander';
import { makePoseRig, poseJoints, type PoseRig } from '../pose';
import {
  GLASS, CRT_FRAME as CRT, DESK_Y, EGG, EGG_REST, FRAME_BOTTOM, FRAME_FACE_Z, KEYBOARD, KEYBOARD_Z, PICTURE_TABLE_N, ellipsoidDist, eggCentre, keyboardShove, lipOpening, pictureTable,
  sacExtent, smooth, tearTip,
} from './emergence-field';
import {
  DEPTH_Q, GOO_K, SCREEN_PROXY, SCR_CAPSULE, SCR_ELLIPSOID, SCR_GOO, SCR_LIGHT, SCR_LIP, SCR_MAP, SCR_MARCH, SCR_NORMAL, SCR_OPENING,
  SCR_PICTURE, SCR_POOL, SCR_POOL_SHADE, SCR_ROUNDCONE, SCR_ROUNDRECT, SCR_SAC, SCR_SHADE, SCR_SHADOW, SCR_SHEET, SCR_SMAX, SCR_SMIN, SCR_SURFACE,
  SCR_TEAR, SCR_VEINS, SCR_WRINKLE, SCR_WRINKLE_PAT, SCR_GAUSS, SCR_FIGURE, SCR_FIG_TAU, SCR_SPOTS, SCR_SHELL, SCR_EGG_INNER,
} from './screen-emergence.wgsl';
import { GOO_BOUND0, GOO_TEXELS, gooAt, gooTexels } from './goo-strands';
import { SHOTS, DURATION, shotAt, paramsAt, type ShotId } from './emergence-timeline';
import { goblinClipAt, measureSeat, type SeatMeasure } from './screen-lab-goblin';
import {
  GAME_AA, GAME_AA_FADE_M, GAME_AA_NEAR, GAME_LAST_STEP_DEFAULT, GAME_RELAX, GAME_HULL_EXIT_BOUND, GAME_WOUND_EARLY_OUT, GAME_OMEGA, GAME_WOUND_STEP,
} from './game-march-accept';
import type { Vec3 } from '../types';

// ---------------------------------------------------------------------------
// The P225f (docs/dev-notes/2026-10-01-flat-emergence-lookdev/crt_p225f.py), in the screen frame.
// ---------------------------------------------------------------------------
// The front frame (CRT_FRAME: w, h, its depth, the chin under the glass; FRAME_BOTTOM, the chin below the glass's lower edge, which the
// pedestal fills up to) is emergence-field's: the drips are kept in front of the chin. So are the frame's front face (FRAME_FACE_Z, the
// bevel's depth, 0.03 in the blockout) and the keyboard (KEYBOARD: thickness, depth, width, the gap to the CRT's face, its key rows): the
// drips land on the keyboard and the egg shoves it (plan Task 8).
/** The desk top's thickness and its back edge (screen frame z, behind the CRT's 0.47 m housing). */
const DESK = { t: 0.035, backZ: -0.62, hw: 0.78 } as const;
/** The desk's front edge sits at least this far in front of the keyboard's front edge, and must clear the knees by at least KNEE_CLEAR. */
const DESK_LIP = 0.04;
const KNEE_CLEAR = 0.01;
/** ...and reaches at least the slumped egg's front (EGG_REST z + EGG.rz, plus 5 mm: screen z 0.33 for the 80% egg), so the egg rests on wood. */
const DESK_FRONT_MIN_Z = EGG_REST[2] + EGG.rz + 0.005;
/** The SDF pass's render scale (see `sdfLayer.setScale` in bootstrap). */
const SDF_SCALE = 0.5;
/** The goblin's cold rim/fill strength (spotCfg2.w, see where the key is aimed in bootstrap); `?rim=` overrides, 0 turns it off. */
const GOBLIN_RIM = 1.5;
/** The goblin's flat fill (lightCfg.y; the practical key preset's is 0.06), doubled-ish so his back is not black; `?fill=` overrides. */
const GOBLIN_FILL = 0.10;
/** The banker's lamp's foot on the desk (screen frame), and its bulb under the shade: the set's key light, and the SDF body's key direction. */
const LAMP_AT: Vec3 = [-0.52, DESK_Y, 0.02];
const LAMP_BULB: Vec3 = [LAMP_AT[0], DESK_Y + 0.27, LAMP_AT[2] + 0.06];

// ---------------------------------------------------------------------------
// Camera presets, in the screen frame: an eye, a look-at and a vertical fov (plan Task 5 step 4).
// ---------------------------------------------------------------------------
interface Preset { eye: Vec3; at: Vec3; fov: number }
/** The push cuts wider inside its shot, at this time. */
const PUSH_WIDE_AT = 4.5;
const PRESETS: Record<ShotId | 'push-wide', Preset> = {
  // Close, low, front-right of the screen: outside his right forearm (x 0.19 in the screen frame), which crosses the frame's left edge.
  'glass-gives': { eye: [0.45, -0.14, 0.42], at: [-0.06, 0, 0], fov: 42 },
  // The push starts on the same framing, then cuts wider at 4.5 s: above and behind his right shoulder, over the chair's back.
  push: { eye: [0.45, -0.14, 0.42], at: [-0.06, 0, 0], fov: 42 },
  'push-wide': { eye: [0.85, 0.6, 1.55], at: [0, -0.05, 0.3], fov: 50 },
  // Crowning: close again, backed off to the right to clear the sac's 0.73 m and his raised arms.
  crowning: { eye: [0.75, -0.05, 0.75], at: [0, 0, 0.35], fov: 45 },
  // Out: behind and to the goblin's left (screen -x), high enough to see over the chair, so the egg slumps toward the lens.
  out: { eye: [-0.75, 0.55, 1.6], at: [0.05, -0.2, 0.35], fov: 46 },
  // Settle: low, front-right of the egg (his right, outside his knee), across the egg in its slick to the healing screen and his right hand
  // on the egg's flank. Round two's [0.7, -0.2, 0.0] sat level with the glass and the CRT's frame filled a third of the frame.
  settle: { eye: [0.66, -0.12, 0.6], at: [-0.04, -0.1, 0.12], fov: 50 },
};
const presetAt = (t: number): Preset => {
  const s = shotAt(t).id;
  return s === 'push' && t >= PUSH_WIDE_AT ? PRESETS['push-wide'] : PRESETS[s];
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
/** A rounded rectangle, counter-clockwise from the right edge's middle, 4 (n + 1) points (the blockout's rrect). */
function rrect(w: number, h: number, r: number, n = 6, cy = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (const [qx, qy, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]] as const) {
    const cx = qx * (w / 2 - r), ccy = cy + qy * (h / 2 - r);
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), ccy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Bridges rings of equal length (each at its own z, counter-clockwise seen from +z) into one surface; optionally caps the last ring.
 *  Faces point outward when the rings run toward -z or grow outward at one z (so a surface is lofted from the inside out). */
function loft(rings: { z: number; pts: [number, number][] }[], capLast = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3) => pos.push(...a, ...b, ...c);
  const n = rings[0]!.pts.length;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r]!, B = rings[r + 1]!;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0: Vec3 = [A.pts[i]![0], A.pts[i]![1], A.z], a1: Vec3 = [A.pts[j]![0], A.pts[j]![1], A.z];
      const b0: Vec3 = [B.pts[i]![0], B.pts[i]![1], B.z], b1: Vec3 = [B.pts[j]![0], B.pts[j]![1], B.z];
      tri(a0, b0, b1); tri(a0, b1, a1);
    }
  }
  if (capLast) {
    const L = rings[rings.length - 1]!;
    let cx = 0, cy = 0;
    for (const p of L.pts) { cx += p[0] / n; cy += p[1] / n; }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri([cx, cy, L.z], [L.pts[j]![0], L.pts[j]![1], L.z], [L.pts[i]![0], L.pts[i]![1], L.z]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, mat: THREE.Material, at: Vec3, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...at);
  parent.add(m);
  return m;
}

function cyl(r: number, h: number, mat: THREE.Material, at: Vec3, parent: THREE.Object3D, r2 = r, seg = 32): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg), mat);
  m.position.set(...at);
  parent.add(m);
  return m;
}

const std = (color: number, roughness = 0.6, metalness = 0, emissive = 0x000000, emissiveIntensity = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------
/** The CRT housing, the pedestal and the chin's buttons, in the screen frame. The glass itself is separate (placeholder now, the pass later). */
function buildCrt(parent: THREE.Object3D): void {
  const front = std(0x949793, 0.5), back = std(0x3d4042, 0.55), btn = std(0x85878a, 0.45);
  const frameCy = FRAME_BOTTOM + CRT.fh / 2;
  const N = 6;
  const outer = rrect(CRT.fw, CRT.fh, 0.022, N, frameCy);
  const lip = rrect(GLASS.hw * 2 + 0.05, GLASS.hh * 2 + 0.045, 0.012, N, 0);
  const glassEdge = rrect(GLASS.hw * 2 + 0.004, GLASS.hh * 2 + 0.004, 0.006, N, 0);
  // The face, lofted from the inside out so its faces point into the room: up the sloped bevel from the glass's edge to the lip, then
  // the flat face out to the frame's rim. (loft's winding: rings that grow outward or run toward -z face outward.)
  parent.add(new THREE.Mesh(loft([
    { z: 0.002, pts: glassEdge }, { z: FRAME_FACE_Z, pts: lip }, { z: FRAME_FACE_Z, pts: outer },
  ]), front));
  // The frame's side band, from the face back to where the housing starts.
  const bandBack = FRAME_FACE_Z - CRT.fd;
  parent.add(new THREE.Mesh(loft([
    { z: FRAME_FACE_Z, pts: outer }, { z: bandBack, pts: rrect(CRT.fw - 0.004, CRT.fh - 0.004, 0.02, N, frameCy) },
  ]), front));
  // The dark housing: swelling a little, then tapering 0.47 m back to a rounded cap (the blockout's six rings).
  const rings = ([
    [0.0, CRT.fw - 0.012, CRT.fh - 0.012, 0, 0.02], [0.06, CRT.fw - 0.02, CRT.fh - 0.03, 0.005, 0.03],
    [0.2, 0.44, 0.4, 0.01, 0.06], [0.34, 0.36, 0.32, 0.01, 0.07], [0.44, 0.28, 0.24, 0, 0.06], [0.47, 0.24, 0.2, 0, 0.05],
  ] as const).map(([y, w, h, dz, r]) => ({ z: bandBack - y, pts: rrect(w, h, r, N, frameCy + dz) }));
  parent.add(new THREE.Mesh(loft(rings, true), back));
  // The chin: a groove and the button row, the LED, the power button.
  const chinZ = FRAME_FACE_Z + 0.002;
  box(CRT.fw - 0.06, 0.004, 0.004, back, [0, FRAME_BOTTOM + 0.035, chinZ], parent);
  for (const x of [-0.08, 0.03, 0.065, 0.1, 0.135]) box(0.03, 0.012, 0.006, btn, [x, FRAME_BOTTOM + 0.028, chinZ], parent);
  box(0.035, 0.012, 0.006, btn, [0.205, FRAME_BOTTOM + 0.028, chinZ], parent);
  box(0.005, 0.003, 0.004, std(0x1a8040, 0.3, 0, 0x22ff66, 2.5), [0.175, FRAME_BOTTOM + 0.03, chinZ + 0.001], parent);
  // Side vents.
  for (const s of [-1, 1]) for (let k = 0; k < 9; k++) box(0.004, 0.06, 0.012, back, [s * 0.236, FRAME_BOTTOM + 0.06, bandBack - 0.1 - k * 0.012], parent);
  // The swivel pedestal: a disc on the desk and a neck up to the frame's bottom.
  const pedZ = bandBack - 0.12;
  const disc = cyl(0.17, 0.025, back, [0, DESK_Y + 0.0125, pedZ], parent, 0.17, 64);
  disc.scale.set(1, 1, 0.92);
  const neckH = FRAME_BOTTOM - (DESK_Y + 0.025) + 0.01;
  cyl(0.1, neckH, front, [0, DESK_Y + 0.025 + neckH / 2, pedZ], parent, 0.1, 48);
}

interface SetLayout {
  /** The glass centre, in the goblin's world frame. */
  glassY: number;
  glassZ: number;
  /** In the screen frame: the keyboard's centre z (emergence-field's KEYBOARD_Z), the desk's front edge z, the seat's top y and its z span. */
  keyboardZ: number;
  deskFrontZ: number;
  seatY: number;
  seatZ0: number;
  seatZ1: number;
  /** The goblin's hands' half span (keyboard width check). */
  handHalfSpan: number;
  kneeClearance: number;
}

/** The set from the measured seat (see the header): the glass's place in the goblin's frame and the furniture in the screen's. */
function layoutFrom(m: SeatMeasure): SetLayout {
  const deskTopW = m.palmY - KEYBOARD.t;                       // desk top, world y (floor 0)
  const glassY = deskTopW - DESK_Y;                            // the glass centre is -DESK_Y above the desk top
  const keyboardZ = KEYBOARD_Z;                                  // screen z of the keyboard's centre
  const glassZ = m.handZ + keyboardZ;                          // world z of the glass: the keyboard's centre lies under the hands
  const toScreenZ = (zw: number) => glassZ - zw;
  const kbFrontW = m.handZ - KEYBOARD.d / 2;
  // World z grows toward the screen, so the desk front reaching further toward the goblin is the SMALLER world z.
  const deskFrontW = Math.min(kbFrontW - DESK_LIP, glassZ - DESK_FRONT_MIN_Z);
  const kneeClearance = deskFrontW - m.kneeFrontZ;
  return {
    glassY, glassZ, keyboardZ,
    deskFrontZ: toScreenZ(deskFrontW),
    seatY: m.seatY - glassY,
    seatZ0: toScreenZ(m.seatBackZ - 0.03),
    seatZ1: toScreenZ(Math.min(m.kneeFrontZ - 0.12, m.seatBackZ + 0.46)),
    handHalfSpan: m.handHalfSpan,
    kneeClearance,
  };
}

/** The desk, the keyboard, the tower, the lamp, the chair and the room. Returns the keyboard (a group centred on its footprint, so the page
 *  can shove it aside where the egg lands: emergence-field's keyboardShove). */
function buildDeskAndRoom(parent: THREE.Object3D, L: SetLayout, floorY: number): THREE.Group {
  const wood = std(0x4a3222, 0.7), beige = std(0xcfc3a4, 0.55), beigeDark = std(0xa99d80, 0.6), metal = std(0x2b2b2e, 0.4, 0.6);
  // The desk: the top, from just in front of the keyboard back past the CRT, and four legs to the floor.
  const deskD = L.deskFrontZ - DESK.backZ;
  box(DESK.hw * 2, DESK.t, deskD, wood, [0, DESK_Y - DESK.t / 2, DESK.backZ + deskD / 2], parent);
  const legH = DESK_Y - DESK.t - floorY;
  for (const sx of [-1, 1]) for (const z of [DESK.backZ + 0.05, L.deskFrontZ - 0.05])
    box(0.05, legH, 0.05, wood, [sx * (DESK.hw - 0.05), floorY + legH / 2, z], parent);
  // The keyboard under the hands, and its key rows: a group at the keyboard's centre on the desk top.
  const keyboard = new THREE.Group();
  keyboard.name = 'keyboard';
  keyboard.position.set(0, DESK_Y, L.keyboardZ);
  parent.add(keyboard);
  box(KEYBOARD.w, KEYBOARD.t, KEYBOARD.d, beige, [0, KEYBOARD.t / 2, 0], keyboard);
  for (let r = 0; r < 5; r++) box(KEYBOARD.w - 0.04, KEYBOARD.keys, 0.022, beigeDark, [0, KEYBOARD.t + KEYBOARD.keys / 2, -KEYBOARD.d / 2 + 0.025 + r * 0.027], keyboard);
  // The beige tower, on the desk to the screen's right.
  box(0.19, 0.42, 0.44, beige, [0.52, DESK_Y + 0.21, -0.22], parent);
  box(0.15, 0.012, 0.004, beigeDark, [0.52, DESK_Y + 0.33, -0.22 + 0.222], parent);
  // The banker's lamp, low on the desk's left: a brass base and stem, a green glass shade, a warm point light under it.
  const brass = std(0x9a7a3a, 0.35, 0.8), shade = std(0x1f5a32, 0.35, 0.1, 0x0a2a14, 0.6);
  const lampAt = LAMP_AT;
  cyl(0.08, 0.02, brass, [lampAt[0], DESK_Y + 0.01, lampAt[2]], parent);
  cyl(0.012, 0.3, brass, [lampAt[0], DESK_Y + 0.17, lampAt[2]], parent);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 24, 1, true, 0, Math.PI), shade);
  sh.material.side = THREE.DoubleSide;
  sh.rotation.set(0, 0, Math.PI / 2);
  sh.position.set(lampAt[0], DESK_Y + 0.33, lampAt[2] + 0.04);
  parent.add(sh);
  const lampLight = new THREE.PointLight(0xffb066, 1.6, 0, 2);
  lampLight.position.set(...LAMP_BULB);
  parent.add(lampLight);
  // The screen's own glow (the pass will drive its colour from the picture later), cool and close.
  const glowLight = new THREE.PointLight(0x9fb7ff, 0.7, 0, 2);
  glowLight.position.set(0, 0, 0.25);
  parent.add(glowLight);
  // The chair: a tall office seat under the pelvis (top at the measured seat height), a back, a post and a five-star base.
  const vinyl = std(0x1c1a1c, 0.5);
  const seatD = Math.abs(L.seatZ1 - L.seatZ0), seatZ = (L.seatZ0 + L.seatZ1) / 2, seatT = 0.07;
  box(0.5, seatT, seatD, vinyl, [0, L.seatY - seatT / 2, seatZ], parent);
  const backZ = Math.max(L.seatZ0, L.seatZ1) + 0.05;
  box(0.46, 0.4, 0.06, vinyl, [0, L.seatY + 0.28, backZ], parent);
  box(0.05, 0.2, 0.03, metal, [0, L.seatY + 0.05, backZ - 0.01], parent);
  const postH = L.seatY - seatT - floorY - 0.06;
  cyl(0.025, postH, metal, [0, floorY + 0.06 + postH / 2, seatZ], parent);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const arm = box(0.3, 0.025, 0.04, metal, [Math.cos(a) * 0.15, floorY + 0.05, seatZ + Math.sin(a) * 0.15], parent);
    arm.rotation.y = -a;
  }
  // The room: a floor, the wall behind the desk, a wall to the left; dark.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), std(0x2a2420, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY, 0.8);
  parent.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), std(0x2d2a2c, 0.95));
  wall.position.set(0, floorY + 1.3, DESK.backZ - 0.02);
  parent.add(wall);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), std(0x29262a, 0.95));
  side.rotation.y = Math.PI / 2;
  side.position.set(-1.3, floorY + 1.3, 1.2);
  parent.add(side);
  return keyboard;
}

// ---------------------------------------------------------------------------
// The screen pass (plan Task 6): the march on a proxy box in the screen's frame, drawn in the SDF layer's late scene
// ---------------------------------------------------------------------------
type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];
/** The goo exists from the tear's first strand (7.2 s); before this the page uploads nothing and never runs the sim. */
const GOO_FROM = 7;
/** The lamp's strength in the pass (the set's PointLight is 1.6 at the bulb; the pass's falloff is its own, tuned by eye). */
const PASS_LAMP = 1.4;

interface ScreenPass {
  proxy: THREE.Mesh;
  /** Per frame: the timeline's parameters at `t` and the field's derived values, the picture table, the pixel size. */
  update(t: number, camera: THREE.PerspectiveCamera, heightPx: number): void;
  /** The march's debug view (steps red, hit green, material blue): `?passdebug=1` or the seam's setPassDebug. */
  setDebug(on: boolean): void;
  /** The goo off (nothing uploaded, the bound empty): `?nogoo=1` or the seam's setGoo, so its cost can be read. */
  setGooOn(on: boolean): void;
  /** The egg's light's hard shadow (scrShadow) on the goo, the sheet and the slick: the `goo shadow` checkbox. */
  setShadow(on: boolean): void;
}

/** The proxy box and its material. The box's geometry is built in the screen frame (its local space IS the screen's), so the mesh only has
 *  to copy the screen group's place; the march runs in local space (modelWorldMatrixInverse brings the eye in), so the CRT may turn. Back
 *  faces, so the eye may be inside the box (the close shots are). Premultiplied blending (three multiplies the straight colour by alpha),
 *  and the first hit's REAL depth through depthNode, so the goblin, the desk and the CRT housing occlude it and are occluded by it. */
function createScreenPass(pictureTex: THREE.Texture): ScreenPass {
  const fn = (src: string, deps: ReturnType<typeof wgslFn>[] = []) => wgslFn(src, deps.map(x => x as unknown as Include));
  const smaxF = fn(SCR_SMAX), sminF = fn(SCR_SMIN);
  const wrinkleF = fn(SCR_WRINKLE, [fn(SCR_WRINKLE_PAT)]);
  const sacF = fn(SCR_SAC, [smaxF, wrinkleF]);
  const ellipsoidF = fn(SCR_ELLIPSOID);
  const roundRectF = fn(SCR_ROUNDRECT);
  const openingF = fn(SCR_OPENING, [roundRectF]);
  const lipF = fn(SCR_LIP, [openingF]);
  const tearF = fn(SCR_TEAR);
  const capsuleF = fn(SCR_CAPSULE), roundConeF = fn(SCR_ROUNDCONE);
  const gooF = fn(SCR_GOO, [capsuleF, roundConeF, sminF]);
  const mapF = fn(SCR_MAP, [sacF, openingF, lipF, ellipsoidF, sminF, smaxF, tearF, gooF]);
  const normalF = fn(SCR_NORMAL, [mapF]);
  const marchF = fn(SCR_MARCH, [mapF]);
  const veinsF = fn(SCR_VEINS);
  const pictureF = fn(SCR_PICTURE);
  const lightF = fn(SCR_LIGHT);
  const figTauF = fn(SCR_FIG_TAU, [fn(SCR_FIGURE), fn(SCR_GAUSS)]);
  const shellF = fn(SCR_SHELL, [fn(SCR_SPOTS), figTauF]);
  const eggInnerF = fn(SCR_EGG_INNER);
  const surfaceF = fn(SCR_SURFACE, [lightF, tearF, ellipsoidF, shellF, eggInnerF]);
  const sheetF = fn(SCR_SHEET, [sacF, pictureF, veinsF, lightF, wrinkleF]);
  const shadowF = fn(SCR_SHADOW, [mapF, ellipsoidF]);
  const poolF = fn(SCR_POOL);
  const poolShadeF = fn(SCR_POOL_SHADE, [lightF]);
  const shade = fn(SCR_SHADE, [marchF, normalF, sheetF, surfaceF, openingF, pictureF, shadowF, poolF, poolShadeF, eggInnerF]);

  const table = new Float32Array(PICTURE_TABLE_N);
  const tableTex = new THREE.DataTexture(table, PICTURE_TABLE_N, 1, THREE.RedFormat, THREE.FloatType);
  tableTex.magFilter = THREE.NearestFilter; tableTex.minFilter = THREE.NearestFilter; tableTex.generateMipmaps = false;
  tableTex.needsUpdate = true;

  // The goo: gooTexels(gooAt(t)) as a 64 x 1 RGBA32F row (textureLoad), and its bounding sphere (radius <= 0: none).
  const gooData = new Float32Array(GOO_TEXELS * 4);
  const gooTex = new THREE.DataTexture(gooData, GOO_TEXELS, 1, THREE.RGBAFormat, THREE.FloatType);
  gooTex.magFilter = THREE.NearestFilter; gooTex.minFilter = THREE.NearestFilter; gooTex.generateMipmaps = false;
  gooTex.needsUpdate = true;
  const uGoo = uniform(new THREE.Vector4(0, 0, 0, -1));

  const uP0 = uniform(new THREE.Vector4()), uP1 = uniform(new THREE.Vector4());
  const uD = uniform(new THREE.Vector4()), uLip = uniform(new THREE.Vector4(GLASS.hw, GLASS.hh, 0, 0));
  const uTime = uniform(0);
  const uLamp = uniform(new THREE.Vector4(...LAMP_BULB, PASS_LAMP));
  const uCfg = uniform(new THREE.Vector4(0.001, 0, 0, 0));
  const pic = texture(pictureTex);
  const res = shade({
    eye: modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz, pos: positionLocal,
    p0: uP0, p1: uP1, d: uD, lip: uLip, tm: uTime, lamp: uLamp, cfg: uCfg,
    picTab: texture(tableTex), scrTex: pic, scrSamp: pic, gooTex: texture(gooTex), goo: uGoo,
  }) as unknown as { xyz: never; w: ReturnType<typeof float> };
  // The packed hit: floor(t * DEPTH_Q) + coverage. t is in the local frame, which has the world's scale (the screen group is unscaled).
  const tq = floor(res.w);
  const alpha = res.w.sub(tq);
  const hitW = cameraPosition.add(normalize(positionWorld.sub(cameraPosition)).mul(tq.div(DEPTH_Q)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(hitW, 1.0)));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = vec4(res.xyz, alpha);
  mat.depthNode = alpha.greaterThan(0.0).select(clip.z.div(clip.w), float(1.0));
  mat.transparent = true;
  mat.premultipliedAlpha = true;
  mat.blending = THREE.NormalBlending;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.side = THREE.BackSide;
  mat.fog = false;
  mat.name = 'screen-emergence-pass';

  const [x0, y0, z0] = SCREEN_PROXY.min, [x1, y1, z1] = SCREEN_PROXY.max;
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const proxy = new THREE.Mesh(geo, mat);
  proxy.name = 'screen-emergence-proxy';
  proxy.frustumCulled = false;

  let debugView = false;
  let shadowOn = true;
  /** gooAt replays the sim from t = 0 (about 7 ms warm): only from GOO_FROM on (nothing exists before), and once per distinct t, so a
   *  paused scrub does not recompute. */
  let gooT = NaN;
  let gooOn = true;
  const setGoo = (t: number) => {
    const live = gooOn && t >= GOO_FROM;
    const key = live ? t : -1;
    if (key === gooT) return;
    gooT = key;
    if (live) gooData.set(gooTexels(gooAt(t))); else gooData.fill(0);
    gooTex.needsUpdate = true;
    // The bound: the texels' box grown by their radii, then the blends' reach.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (let i = 0; i < GOO_BOUND0; i++) {
      const w = gooData[i * 4 + 3]!;
      if (w <= 0) continue;
      any = true;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, gooData[i * 4 + k]! - w); hi[k] = Math.max(hi[k]!, gooData[i * 4 + k]! + w); }
    }
    if (!any) { uGoo.value.set(0, 0, 0, -1); return; }
    const half = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
    uGoo.value.set((lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2, half + GOO_K.self * 0.25 + GOO_K.scene);
  };
  return {
    proxy,
    setDebug(on) { debugView = on; },
    setShadow(on) { shadowOn = on; },
    setGooOn(on) { gooOn = on; gooT = NaN; },
    update(t, camera, heightPx) {
      const p = paramsAt(t);
      uP0.value.set(p.ripple, p.push, p.thin, p.lipBow);
      uP1.value.set(p.tear, p.slump, p.heal, p.glow);
      const c = eggCentre(p), lo = lipOpening(p);
      uD.value.set(sacExtent(p), c[2], c[1], lo.z);
      uLip.value.set(lo.hw, lo.hh, smooth(p.lipBow), tearTip(p, t)[2]);
      (uTime as unknown as { value: number }).value = t;
      table.set(pictureTable(p));
      tableTex.needsUpdate = true;
      setGoo(t);
      uCfg.value.x = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, heightPx);
      uCfg.value.y = debugView ? 1 : 0;
      uCfg.value.z = shadowOn ? 1 : 0;
    },
  };
}

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
  layout: SetLayout | null;
  /** The hands' centres and the egg's centre at the current `t`, in the screen frame (metres), each hand's centre's distance to the egg's
   *  surface (the ellipsoid distance; negative inside) and its flesh's (that less the hand prim's radius): the reach check. */
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
  // Skin as the game's (game-spawn.ts): the .blob's own palette under the practical key, the face sheet's projection and texture.
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
    const f = sheetC.face;
    const tex = new THREE.TextureLoader().load(f.url);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = true;
    const [x, y, w, h, sw, shh] = f.rect;
    gpu.setFaceTexture(tex, new THREE.Vector4(w / sw, h / shh, x / sw, y / shh), f.mean);
    const u = gpu.uniforms;
    u.faceCfg.value.x = 1; u.faceCfg.value.y = 1.0;
    const sheet = sheetC.sheet;
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
  const poseAt = (t: number) => {
    const { clip, local } = goblinClipAt(t);
    stepActorMotion(motion, {
      current, dt: 1 / 60, wander: false, armStyle: undefined,
      headingFollow: MOTION_TUNING.headingFollow, gazeFollow: MOTION_TUNING.gazeFollow,
      bounds, rng, signals, profile, forceSpeed: 0, pose: poseJoints(poseRig, clip, local),
    });
    return clip.name;
  };
  let lastPosed: ReturnType<typeof applyRig> | null = null;
  const upload = () => {
    const posed = applyRig(current, motion.bound, motion.lastBodyYaw);
    lastPosed = posed;
    gpu.update(posed, current);
    gpu.setRootShift(0, 0, motion.lastBodyYaw);
    const skull = headShape(posed);
    if (skull) gpu.setHeadShape(skull.centre, skull.axes);
    gpu.setHeadRotation(headQuatOf(motion.bound, motion.lastBodyYaw) ?? [0, 0, 0, 1]);
    return posed;
  };

  // ——— Measure the seat off the typing pose, then build the set from it —————
  for (let i = 0; i < 3; i++) poseAt(2.0); // `type` held
  const seat = measureSeat(upload().prims);
  const layout = layoutFrom(seat);
  seam.layout = layout;
  const floorY = -layout.glassY; // the floor in the screen frame
  say(`seat (measured, type pose): palms ${seat.palmY.toFixed(3)} m, seat ${seat.seatY.toFixed(3)} m, hands z ${seat.handZ.toFixed(3)}, knees z ${seat.kneeFrontZ.toFixed(3)} / top ${seat.kneeTopY.toFixed(3)}`);
  say(`set: glass centre ${layout.glassY.toFixed(3)} m above the floor, ${layout.glassZ.toFixed(3)} m in front of the hips; desk top ${(layout.glassY + DESK_Y).toFixed(3)} m; knee clearance ${layout.kneeClearance.toFixed(3)} m`,
    layout.kneeClearance < KNEE_CLEAR);
  if (layout.handHalfSpan > KEYBOARD.w / 2) say(`hands (±${layout.handHalfSpan.toFixed(3)}) wider than the keyboard`, true);

  // The screen frame: turned to face the goblin (he faces +z, the glass faces +z in its own frame), the glass at the measured place.
  const screen = new THREE.Group();
  screen.name = 'screen-frame';
  screen.rotation.y = Math.PI;
  screen.position.set(0, layout.glassY, layout.glassZ);
  scene.add(screen);
  screen.updateMatrixWorld(true);
  buildCrt(screen);
  const keyboard = buildDeskAndRoom(screen, layout, floorY);

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
  const pass = createScreenPass(pictureTex);
  pass.proxy.position.copy(screen.position);
  pass.proxy.quaternion.copy(screen.quaternion);
  sdfLayer.lateScene.add(pass.proxy);
  pass.setDebug(q.get('passdebug') === '1');
  pass.setGooOn(q.get('nogoo') !== '1');

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
  // The free camera starts on the goblin's right (world -x), a little toward the desk: the seat, the hands on the keys, the glass in profile.
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
  seam.setGooShadow = (on: boolean) => { gooShadow = on; pass.setShadow(on); syncUi(); };
  seam.setPassDebug = (on: boolean) => pass.setDebug(on);
  seam.setGoo = (on: boolean) => pass.setGooOn(on);
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
    tickMs.push(performance.now() - c0);
    if (tickMs.length > 90) tickMs.shift();
    gpu.setTime(t);
    applyCamera();
    // The keyboard, shoved aside where the egg lands (the drips' floor follows it: emergence-field's dripFloor).
    {
      const k = keyboardShove(paramsAt(t));
      keyboard.position.x = k.dx;
      keyboard.rotation.y = k.yaw;
    }
    // The pass on, the placeholder glass off (and back).
    pass.proxy.visible = passOn;
    glass.visible = !passOn;
    if (passOn) pass.update(t, camera, renderer.domElement.height);
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
