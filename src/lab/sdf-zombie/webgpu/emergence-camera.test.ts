// src/lab/sdf-zombie/webgpu/emergence-camera.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest (the project's tsconfig has no node types)
import { readFileSync } from 'node:fs';
import {
  FLAT_PRESETS, GAME_CENTRE_FOV, PLAYER_EYE, PUSH_WIDE_AT, SEATED_EYE, handoffFor, presetAt, riseAt, sequenceFor, shotsFor, type PresetId,
} from './emergence-camera';
import { FLAT_KOTATSU, fromWorld, placementFor, toWorld } from './emergence-placement';
import { DESK_Y, KOTATSU, TABLE_FRONT_Z, eggCentre } from './emergence-field';
import { DURATION, SHOTS, paramsAt } from './emergence-timeline';
import { totalDuration, shotAt as seqShotAt } from './ending-sequence';
import type { Vec3 } from './emergence-field';

const P = placementFor(FLAT_KOTATSU, [0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2], DESK_Y);

// The level the game loads: its room rect, its furniture (the collider boxes) and its solids (the walls inside the room box).
interface Box { min: Vec3; max: Vec3 }
const LEVEL = JSON.parse(readFileSync('public/assets/levels/flat-early.level.json', 'utf8')) as {
  rooms: { min: [number, number]; max: [number, number]; height: number }[]; furniture: Box[]; solids: Box[];
};
const ROOM = LEVEL.rooms[0]!;
const BOXES: Box[] = [...LEVEL.furniture, ...LEVEL.solids];
const KOTATSU_BOX = LEVEL.furniture.find(b => Math.abs(b.min[2] + 2.77) < 1e-6 && Math.abs(b.max[2] + 1.95) < 1e-6)!;
/** The Flat's vault (flat_layout.py vault_z): side walls spring at 1.95 m, a circle of radius 1.8 to the crown. */
const vaultY = (x: number) => 1.95 - Math.sqrt(1.8 ** 2 - 1.35 ** 2) + Math.sqrt(Math.max(0, 1.8 ** 2 - x * x));

const boxDist = (p: Vec3, b: Box) => Math.hypot(
  Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]), Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]));
/** Does the segment a-b pass through the box (sampled every 2 cm)? */
const segHits = (a: Vec3, b: Vec3, box: Box) => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.02);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    if (boxDist([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], box) === 0) return true;
  }
  return false;
};

/** The subject's angles off the view axis (degrees), across and up, for a camera at `eye` looking at `at`. */
function offAxis(eye: Vec3, at: Vec3, subject: Vec3): { h: number; v: number } {
  const f = norm([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]);
  const r = norm([-f[2], 0, f[0]]);
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d: Vec3 = [subject[0] - eye[0], subject[1] - eye[1], subject[2] - eye[2]];
  const z = dot(d, f);
  return { h: (Math.atan2(dot(d, r), z) * 180) / Math.PI, v: (Math.atan2(dot(d, u), z) * 180) / Math.PI };
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** What each shot is OF, in the screen frame: the glass, the sac/egg at the shot's middle, his hips and head (the lab's measures: typing
 *  hips (0, -0.705, 0.865), slid back to z 1.07; his head about (0, 0.17, 0.92) sitting up). */
const egg = (t: number) => eggCentre(paramsAt(t));
const SUBJECTS: Record<PresetId, Vec3[]> = {
  'glass-gives': [[0, 0, 0]],
  push: [egg(3.5)],
  'push-wide': [egg(5.5), [0, -0.55, 1.07], [0, 0.2, 0.95], [0, -0.15, -0.25]],   // the sac, his hips slid back, his head, the CRT
  crowning: [egg(7.75)],
  out: [egg(10.25), [0, 0.15, 1.0]],                             // the egg slumping, the back of his head in the foreground
  settle: [egg(DURATION), [0, 0.17, 0.92]],                      // the egg in its goo and his face
};

describe('the Flat presets', () => {
  const ids = Object.keys(FLAT_PRESETS) as PresetId[];
  it('every eye is inside the open room (inside the room rect, 0.12 m off the side walls, under the vault, game y 0.5 to 2.2)', () => {
    for (const id of ids) {
      const e = toWorld(P, FLAT_PRESETS[id].eye);
      expect(e[0], id).toBeGreaterThan(ROOM.min[0] + 0.12);
      expect(e[0], id).toBeLessThan(1.35 - 0.12);           // the main room's east wall (the filler's face)
      expect(e[2], id).toBeGreaterThan(ROOM.min[1] + 0.12);
      expect(e[2], id).toBeLessThan(ROOM.max[1] - 0.12);
      expect(e[1], id).toBeGreaterThanOrEqual(0.5);
      expect(e[1], id).toBeLessThanOrEqual(2.2);
      expect(e[1], id).toBeLessThan(vaultY(e[0]) - 0.1);
    }
  });
  it('every eye is at least 5 cm clear of every collider and wall box (the kotatsu, the bookshelf, the arch\'s walls...)', () => {
    for (const id of ids) {
      const e = toWorld(P, FLAT_PRESETS[id].eye);
      for (const b of BOXES) expect(boxDist(e, b), `${id} vs box ${JSON.stringify(b)}`).toBeGreaterThan(0.05);
    }
  });
  it('every look line is clear of the walls and the furniture up to the look point (not aimed at a wall, nothing in the way)', () => {
    for (const id of ids) {
      const e = toWorld(P, FLAT_PRESETS[id].eye), a = toWorld(P, FLAT_PRESETS[id].at);
      for (const b of BOXES) if (b !== KOTATSU_BOX) expect(segHits(e, a, b), `${id} looks through ${JSON.stringify(b)}`).toBe(false);
    }
  });
  it('every look point is the set (within 0.9 m of the glass centre) and each shot\'s subjects are in its frame (4:3, the preset fov)', () => {
    for (const id of ids) {
      const p = FLAT_PRESETS[id];
      expect(Math.hypot(...p.at), id).toBeLessThan(0.9);
      const vHalf = p.fov / 2, hHalf = (Math.atan(Math.tan((p.fov * Math.PI) / 360) * (4 / 3)) * 180) / Math.PI;
      for (const s of SUBJECTS[id]) {
        const o = offAxis(p.eye, p.at, s);
        expect(Math.abs(o.h), `${id}: subject ${s} across`).toBeLessThan(hHalf - 2);
        expect(Math.abs(o.v), `${id}: subject ${s} up`).toBeLessThan(vHalf - 2);
      }
    }
  });
  it('no lens is wider than the game\'s centre fov (the SDF layer\'s cone is sized for the base fov: a wider frame is the fatal case)', () => {
    for (const id of ids) expect(FLAT_PRESETS[id].fov, id).toBeLessThanOrEqual(GAME_CENTRE_FOV);
  });
  it('presetAt follows the shots and cuts the push wide at PUSH_WIDE_AT', () => {
    expect(presetAt(0).id).toBe('glass-gives');
    expect(presetAt(2.6).id).toBe('push');
    expect(presetAt(PUSH_WIDE_AT - 0.01).id).toBe('push');
    expect(presetAt(PUSH_WIDE_AT).id).toBe('push-wide');
    expect(presetAt(7).id).toBe('crowning');
    expect(presetAt(10).id).toBe('out');
    expect(presetAt(DURATION + 1).id).toBe('settle');
  });
});

describe('the emergence sequence', () => {
  const shots = shotsFor(P);
  const seq = sequenceFor(P);
  it('is the timeline\'s shots with the push split in two; the durations sum to DURATION', () => {
    expect(shots.map(s => s.id)).toEqual(['glass-gives', 'push', 'push-wide', 'crowning', 'out', 'settle']);
    expect(totalDuration(seq)).toBeCloseTo(DURATION, 9);
    expect(seq.id).toBe('emergence');
    expect(seq.endEvent).toBe('emergence.end');
  });
  it('cuts exactly at the SHOTS boundaries and at PUSH_WIDE_AT', () => {
    let start = 0;
    const starts: number[] = [];
    for (const s of shots) { starts.push(start); start += s.duration; }
    expect(starts[0]).toBe(0);
    for (const s of SHOTS) expect(starts.some(x => Math.abs(x - s.start) < 1e-9), s.id).toBe(true);
    expect(starts.some(x => Math.abs(x - PUSH_WIDE_AT) < 1e-9)).toBe(true);
    for (const s of SHOTS) expect(seqShotAt(seq, (s.start + s.end) / 2 - (s.id === 'push' ? 0.5 : 0)).shot.id).toBe(s.id);
  });
  it('each shot is a fixed camera: the preset through the placement, the fov as a delta on the game\'s centre fov', () => {
    for (const s of shots) {
      const p = FLAT_PRESETS[s.id as PresetId];
      expect(s.camera.kind).toBe('fixed');
      if (s.camera.kind !== 'fixed') continue;
      const e = fromWorld(P, s.camera.eye), l = fromWorld(P, s.camera.look);
      for (let i = 0; i < 3; i++) { expect(e[i]).toBeCloseTo(p.eye[i]!, 9); expect(l[i]).toBeCloseTo(p.at[i]!, 9); }
      expect(s.camera.fovDelta).toBeCloseTo(p.fov - GAME_CENTRE_FOV, 9);
    }
  });
});

describe('the hand-off', () => {
  const h = handoffFor(P);
  it('starts at his seated eye on the cushion\'s spot, about 0.85 m over the tatami, and looks at the egg resting on the keyboard', () => {
    expect(h.seatedEye[0]).toBeCloseTo(0.12, 6);
    expect(h.seatedEye[2]).toBeCloseTo(-1.455, 6);
    expect(h.seatedEye[1] - FLAT_KOTATSU.floor).toBeGreaterThan(0.75);
    expect(h.seatedEye[1] - FLAT_KOTATSU.floor).toBeLessThan(0.95);
    const rest = toWorld(P, eggCentre(paramsAt(DURATION)));
    for (let i = 0; i < 3; i++) expect(h.look[i]).toBeCloseTo(rest[i]!, 9);
    // the egg is on the board, in front of the CRT, north of him
    expect(h.look[1]).toBeGreaterThan(FLAT_KOTATSU.top);
    expect(h.look[2]).toBeLessThan(h.seatedEye[2]);
    expect(SEATED_EYE[2]).toBeGreaterThan(TABLE_FRONT_Z);
  });
  it('stands the player inside the room, his capsule (r 0.32) clear of the kotatsu\'s collider and every other box', () => {
    expect(h.feet[0]).toBeGreaterThan(ROOM.min[0] + 0.32);
    expect(h.feet[0]).toBeLessThan(1.35 - 0.32);
    expect(h.feet[2]).toBeGreaterThan(ROOM.min[1] + 0.32);
    expect(h.feet[2]).toBeLessThan(-0.02 - 0.32);   // north of the arch's wall: in the main room
    for (const b of BOXES) {
      const d = Math.hypot(Math.max(b.min[0] - h.feet[0], 0, h.feet[0] - b.max[0]), Math.max(b.min[2] - h.feet[2], 0, h.feet[2] - b.max[2]));
      expect(d, JSON.stringify(b)).toBeGreaterThan(0.32);
    }
    expect(h.feet[2] - KOTATSU_BOX.max[2]).toBeGreaterThan(0.4);   // half a metre south of the kotatsu's front edge
  });
  it('the yaw and pitch at the standing eye look at the egg (forward = [sin yaw, 0, -cos yaw])', () => {
    expect(h.standingEye[1] - h.feet[1]).toBeCloseTo(PLAYER_EYE, 9);
    const cp = Math.cos(h.pitch);
    const f: Vec3 = [Math.sin(h.yaw) * cp, Math.sin(h.pitch), -Math.cos(h.yaw) * cp];
    const d = norm([h.look[0] - h.standingEye[0], h.look[1] - h.standingEye[1], h.look[2] - h.standingEye[2]]);
    expect(dot(f, d)).toBeCloseTo(1, 9);
    expect(Math.abs(h.pitch)).toBeLessThan(1.45);   // inside the controller's pitch limit
  });
  it('the rise eases from 0 to 1 and holds', () => {
    expect(riseAt(-1)).toBe(0);
    expect(riseAt(0)).toBe(0);
    expect(riseAt(0.5)).toBeCloseTo(0.5, 9);
    expect(riseAt(1)).toBe(1);
    expect(riseAt(2)).toBe(1);
  });
});
