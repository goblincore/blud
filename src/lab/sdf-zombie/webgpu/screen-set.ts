// src/lab/sdf-zombie/webgpu/screen-set.ts
//
// THE EMERGENCE SET (moved out of screen-lab-main.ts, plan 2026-10-16-emergence-in-the-flat Task 3): the polygonal pieces the egg comes out
// among, built in THE SCREEN'S frame (origin at the glass centre, +x right, +y up, +z out of the glass toward the room, metres;
// emergence-field.ts), as children of whatever group the caller places as the screen.
//
// Two kinds of piece. ON THE BOARD, which the game needs in the Flat (it has its own kotatsu, floor and walls): the P225f CRT (buildCrt),
// the keyboard (buildKeyboard: it never moves, the egg lands on it and the screen pass coats it in goo, so it must sit where the pass's
// baked KEYBOARD / KEYBOARD_Z rect is), the banker's lamp (buildLamp, at LAMP_AT: the pass is handed LAMP_BULB as its lamp), the screen's
// own glow light (buildScreenGlow), and the zabuton (buildZabuton, in the GOBLIN's frame, not the screen's). THE LAB'S OWN TABLE AND
// ROOM (buildTableAndRoom: the board, the quilt skirt, the legs, the tower on the floor, the tatami and the walls), which the lab page uses
// and the game does not. All of these sit on the board's top at DESK_Y; the room's floor is at the layout's floorY.
import * as THREE from 'three/webgpu';
import { GLASS, CRT_FRAME as CRT, DESK_Y, FRAME_BOTTOM, FRAME_FACE_Z, KEYBOARD, KEYBOARD_Z, KOTATSU } from './emergence-field';
import { FLOOR_SEAT } from '../characters/goblin-poses';
import type { Vec3 } from '../types';

/** The wall behind the kotatsu (screen frame z: behind the CRT's 0.47 m housing, which overhangs the board's back by 5 cm). */
export const WALL_Z = -0.62;
/** The banker's lamp's foot on the board (screen frame), and its bulb under the shade: the set's key light, and the SDF body's key
 *  direction. Look round 1: beside the CRT on the kotatsu's left (the 0.82 m board has no room where the wide desk had it, x -0.52), its
 *  shade shorter (LAMP_SHADE_L, 0.26 on the desk) so it stays over the board and clear of the CRT's side; his left hand lands on the board
 *  in front of it at the end. */
export const LAMP_AT: Vec3 = [-0.35, DESK_Y, 0.02];
export const LAMP_BULB: Vec3 = [LAMP_AT[0], DESK_Y + 0.27, LAMP_AT[2] + 0.06];
export const LAMP_SHADE_L = 0.17;

/** What buildTableAndRoom needs of the layout (screen-lab-goblin.ts FloorLayout satisfies it): the board's edges in the screen frame
 *  (z: + toward him), its half width, and the floor's y in the screen frame. */
export interface TableLayout { tableFrontZ: number; tableBackZ: number; tableHalfW: number; floorY: number }

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
/** A rounded rectangle, counter-clockwise from the right edge's middle, 4 (n + 1) points (the blockout's rrect). */
export function rrect(w: number, h: number, r: number, n = 6, cy = 0): [number, number][] {
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
export function loft(rings: { z: number; pts: [number, number][] }[], capLast = false): THREE.BufferGeometry {
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

export function box(w: number, h: number, d: number, mat: THREE.Material, at: Vec3, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...at);
  parent.add(m);
  return m;
}

export function cyl(r: number, h: number, mat: THREE.Material, at: Vec3, parent: THREE.Object3D, r2 = r, seg = 32): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg), mat);
  m.position.set(...at);
  parent.add(m);
  return m;
}

export const std = (color: number, roughness = 0.6, metalness = 0, emissive = 0x000000, emissiveIntensity = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });

/** The beige plastic the keyboard and the tower share, and its darker trim (the keys' rows, the tower's drive slot). */
export interface BeigeMaterials { beige: THREE.Material; beigeDark: THREE.Material }
export const beigeMaterials = (): BeigeMaterials => ({ beige: std(0xcfc3a4, 0.55), beigeDark: std(0xa99d80, 0.6) });

// ---------------------------------------------------------------------------
// On the board (the game builds these on the Flat's kotatsu)
// ---------------------------------------------------------------------------
/** The CRT housing, the pedestal and the chin's buttons, in the screen frame. The glass itself is separate (placeholder or the pass).
 *  The pedestal's disc stands on the board at DESK_Y. */
export function buildCrt(parent: THREE.Object3D): void {
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

/** The keyboard under his hands, and its key rows: a group named 'keyboard' at the keyboard's centre on the board (0, DESK_Y, KEYBOARD_Z).
 *  It never moves: the egg lands on it and the pass draws the goo coat over it from the same constants. */
export function buildKeyboard(parent: THREE.Object3D, mats: BeigeMaterials = beigeMaterials()): THREE.Group {
  const { beige, beigeDark } = mats;
  const keyboard = new THREE.Group();
  keyboard.name = 'keyboard';
  keyboard.position.set(0, DESK_Y, KEYBOARD_Z);
  parent.add(keyboard);
  box(KEYBOARD.w, KEYBOARD.t, KEYBOARD.d, beige, [0, KEYBOARD.t / 2, 0], keyboard);
  for (let r = 0; r < 5; r++) box(KEYBOARD.w - 0.04, KEYBOARD.keys, 0.022, beigeDark, [0, KEYBOARD.t + KEYBOARD.keys / 2, -KEYBOARD.d / 2 + 0.025 + r * 0.027], keyboard);
  return keyboard;
}

/** The banker's lamp on the board's left, beside the CRT (LAMP_AT): a brass base and stem, a green glass shade, a warm point light under
 *  it at LAMP_BULB (the light the screen pass is handed as its lamp). Returns the light. */
export function buildLamp(parent: THREE.Object3D): THREE.PointLight {
  const brass = std(0x9a7a3a, 0.35, 0.8), shade = std(0x1f5a32, 0.35, 0.1, 0x0a2a14, 0.6);
  const lampAt = LAMP_AT;
  cyl(0.07, 0.02, brass, [lampAt[0], DESK_Y + 0.01, lampAt[2]], parent);
  cyl(0.012, 0.3, brass, [lampAt[0], DESK_Y + 0.17, lampAt[2]], parent);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, LAMP_SHADE_L, 24, 1, true, 0, Math.PI), shade);
  sh.material.side = THREE.DoubleSide;
  sh.rotation.set(0, 0, Math.PI / 2);
  sh.position.set(lampAt[0], DESK_Y + 0.33, lampAt[2] + 0.04);
  parent.add(sh);
  const lampLight = new THREE.PointLight(0xffb066, 1.6, 0, 2);
  lampLight.position.set(...LAMP_BULB);
  parent.add(lampLight);
  return lampLight;
}

/** The screen's own glow (the pass may drive its colour from the picture later), cool and close in front of the glass. Returns the light. */
export function buildScreenGlow(parent: THREE.Object3D): THREE.PointLight {
  const glowLight = new THREE.PointLight(0x9fb7ff, 0.7, 0, 2);
  glowLight.position.set(0, 0, 0.25);
  parent.add(glowLight);
  return glowLight;
}

/** The zabuton (goblin-poses' FLOOR_SEAT, in the GOBLIN's own frame: the floor at y 0, he faces +z), its top at `top` (the lab: the
 *  measured seat): a slab with a rolled rim so it reads soft, and a tuft at its middle. Added to `parent`; the caller slides the returned
 *  group with his scoot (he shoves himself back on it). */
export function buildZabuton(parent: THREE.Object3D, top: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'zabuton';
  const [x0, x1] = FLOOR_SEAT.x, [z0, z1] = FLOOR_SEAT.z, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = top / 2;
  const cloth = std(0x3b2a52, 0.85), tuft = std(0x8a6a2a, 0.6);
  parent.add(g);
  box(x1 - x0 - 2 * r, top, z1 - z0 - 2 * r, cloth, [cx, r, cz], g);
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, x1 - x0 - 2 * r, 6, 12), cloth);
    m.rotation.z = Math.PI / 2;
    m.position.set(cx, r, cz + sz * ((z1 - z0) / 2 - r));
    g.add(m);
  }
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, z1 - z0 - 2 * r, 6, 12), cloth);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx + sx * ((x1 - x0) / 2 - r), r, cz);
    g.add(m);
  }
  cyl(0.012, 0.006, tuft, [cx, top + 0.002, cz], g);
  return g;
}

// ---------------------------------------------------------------------------
// The lab's own table and room (the game uses the level's)
// ---------------------------------------------------------------------------
/** The kotatsu (the board, the quilt's skirt, the heater frame and the legs), the tower on the floor beside it, the tatami floor and the
 *  walls, in the screen frame, from the layout (screen-lab-goblin.ts floorLayout). `mats` is the beige the tower shares with the keyboard.
 *  The keyboard, the lamp and the zabuton are not here (buildKeyboard, buildLamp, buildZabuton). */
export function buildTableAndRoom(parent: THREE.Object3D, L: TableLayout, mats: BeigeMaterials = beigeMaterials()): void {
  const floorY = L.floorY;
  const wood = std(0x5a3b26, 0.6), woodDark = std(0x2e1f15, 0.7), quilt = std(0x6b2a2a, 0.9), quiltDark = std(0x3e1a1c, 0.95);
  const { beige, beigeDark } = mats;
  // The board: the kotatsu's top, from behind the CRT's pedestal to its front edge (TABLE_FRONT_Z, past the egg's slick).
  const d = L.tableFrontZ - L.tableBackZ, cz = (L.tableFrontZ + L.tableBackZ) / 2, w = L.tableHalfW * 2;
  box(w, KOTATSU.t, d, wood, [0, DESK_Y - KOTATSU.t / 2, cz], parent);
  // Under the board: the quilt's short skirt (the Flat's kotatsu futon, tucked up clear of his knees) inset from the edges, a dark heater
  // frame, and four short legs to the floor at the corners.
  const under = DESK_Y - KOTATSU.t, sk = KOTATSU.skirt, ins = KOTATSU.inset;
  for (const sz of [-1, 1]) box(w - 2 * ins, sk, 0.02, quilt, [0, under - sk / 2, cz + sz * (d / 2 - ins)], parent);
  for (const sx of [-1, 1]) box(0.02, sk, d - 2 * ins, quilt, [sx * (w / 2 - ins), under - sk / 2, cz], parent);
  box(w - 0.2, 0.03, d - 0.2, quiltDark, [0, under - 0.015, cz], parent);
  const legH = under - floorY;
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(0.05, legH, 0.05, woodDark, [sx * (w / 2 - 0.06), floorY + legH / 2, cz + sz * (d / 2 - 0.06)], parent);
  // The beige tower, on the floor to the kotatsu's right (the screen's +x), its face toward the room.
  const towerX = L.tableHalfW + 0.16;
  box(0.19, 0.42, 0.44, beige, [towerX, floorY + 0.21, -0.12], parent);
  box(0.15, 0.012, 0.004, beigeDark, [towerX, floorY + 0.33, -0.12 + 0.222], parent);
  // The room: a tatami floor (straw-brown mats, 0.9 x 1.8 m, their seams dark), the wall behind the kotatsu, a wall to the left; dark.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), std(0x5c4f2e, 0.92));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY, 0.8);
  parent.add(floor);
  const seam = std(0x2a2414, 0.95);
  for (let k = -3; k <= 3; k++) box(0.012, 0.002, 6, seam, [k * 0.9 + 0.45, floorY + 0.001, 0.8], parent);
  for (let k = -1; k <= 2; k++) box(6, 0.002, 0.012, seam, [0, floorY + 0.001, k * 1.8 + 0.25], parent);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), std(0x2d2a2c, 0.95));
  wall.position.set(0, floorY + 1.3, WALL_Z);
  parent.add(wall);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), std(0x29262a, 0.95));
  side.rotation.y = Math.PI / 2;
  side.position.set(-1.3, floorY + 1.3, 1.2);
  parent.add(side);
}
