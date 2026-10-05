// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-split.ts
//
// THE SKULL MESH UNDER A HEAD SPLIT: the shader side of head-split.ts's skull rule (skullSplitOf, skullPieceAt). The
// renderer (mesh-renderer.ts) draws a split head's skull once per piece, each copy turned about the hinge by its
// piece's bone angle. This module holds what a copy needs to keep only its own piece:
//
//   * the per-instance record (packSplitInstance): the split's plane, hinge and axis, the copy's angle and piece.
//     Four vec4s in ONE interleaved instance buffer: with four buffers the pipeline had 9 vertex buffers, and WebGPU
//     allows 8;
//   * the clip (MESH_SPLIT_CLIP_WGSL): the fragment is taken back by the copy's angle to the UN-TURNED point q, where
//     the closed skull has it, and kept only if the copy's piece owns q. Craters and bone exposure read q too: they
//     are stored on the closed head;
//   * the fracture (MESH_SPLIT_JAG_WGSL): the edge between the two halves is not the old plane but a ragged sheet over
//     it, s(q) + jag >= 0. The offset is a function of q alone, in the split's own frame (along the hinge axis, up
//     from the hinge), so it rides the head, and both halves read the same value at the same point: their edges fit
//     like one bone that broke.
//
// Pure (no three): the TypeScript twins below are the reference the WGSL is edited with (mesh-appearance.ts's idiom).
import type { Vec3 } from '../../types';
import { HEAD_SPLIT, skullFollowOk, type SkullFollow, type SkullSplit, type SplitWarp } from '../../head-split';
import { boneHash3, boneNoise3 } from './mesh-appearance';

/** The fracture's shape (HEAD_SPLIT.skull.jag): amplitudes and lengths in metres, the wobble's four in periods. */
export interface SplitJag {
  zigAmp: number; zigLen: number; chipAmp: number; chipLen: number;
  wobble: number; wobbleAlong: number; wobbleUp: number; upFreq: number;
}

/** How the per-head seed enters meshSplitJag: the phase it adds to the wave along the axis and to the wave up from the
 *  hinge, that second wave's own fixed phase, the noise layer it picks, and the chip layer's offset from it. ONE
 *  table for the TypeScript twin and the WGSL (interpolated below), so the two cannot drift. */
export const JAG_SEED = { along: 0.618, up: 0.414, upPhase: 0.31, noise: 7.31, chip: 3 } as const;
/** A number as a WGSL f32 literal. */
const wf = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const fract = (v: number) => v - Math.floor(v);
/** A triangle wave of period 1 in [-1, 1]. */
const tri = (x: number) => Math.abs(fract(x) - 0.5) * 4 - 1;

/** THE FRACTURE'S OFFSET (metres) at the point `along` the hinge axis and `up` from the hinge (both metres, measured
 *  from the hinge point). Two parts:
 *    the zig-zag: a triangle wave along each of the two directions, so the edge saws whichever way the break runs
 *      over the skull (along the axis over the crown, up the brow and the back), its phase pushed about by a slow
 *      noise so the teeth are uneven;
 *    the chips: a constant per cell of a `chipLen` grid, so the edge steps in small square notches.
 *  `seed` shifts both. Never beyond meshSplitJagMax. MESH_SPLIT_JAG_WGSL is this function. */
export function meshSplitJag(along: number, up: number, seed: number, jag: SplitJag = HEAD_SPLIT.skull.jag): number {
  const zx = along / Math.max(jag.zigLen, 1e-5), zy = up / Math.max(jag.zigLen, 1e-5);
  const wob = boneNoise3([zx * jag.wobble, zy * jag.wobble, seed * JAG_SEED.noise]) - 0.5;
  const zig = 0.5 * (tri(zx + seed * JAG_SEED.along + wob * jag.wobbleAlong)
    + tri(zy * jag.upFreq + seed * JAG_SEED.up + JAG_SEED.upPhase - wob * jag.wobbleUp));
  const cl = Math.max(jag.chipLen, 1e-5);
  const chip = boneHash3([Math.floor(along / cl), Math.floor(up / cl), seed + JAG_SEED.chip]) * 2 - 1;
  return jag.zigAmp * zig + jag.chipAmp * chip;
}

/** The largest |meshSplitJag|: what a bound adds to a sphere before it asks which pieces own it (skullPieces). */
export function meshSplitJagMax(jag: Pick<SplitJag, 'zigAmp' | 'chipAmp'> = HEAD_SPLIT.skull.jag): number {
  return Math.abs(jag.zigAmp) + Math.abs(jag.chipAmp);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The fracture's offset at the closed skull's point `q`, for skullPieceAt: meshSplitJag in the split's frame. */
export function skullJagAt(s: SkullSplit, q: Vec3, jag: SplitJag = HEAD_SPLIT.skull.jag): number {
  const { w, u } = s.frame;
  const r: Vec3 = [q[0] - w.h[0], q[1] - w.h[1], q[2] - w.h[2]];
  return meshSplitJag(dot(w.a, r), dot(u, r), s.seed, jag);
}

/** The WGSL's body, line by line, for the tests to pin against JAG_SEED. */
export const MESH_SPLIT_JAG_LINES = [
  'let z = c / max(jag.y, 1e-5);',
  `let wob = boneNoise(vec3<f32>(z * shape.x, seed * ${wf(JAG_SEED.noise)})) - 0.5;`,
  `let t1 = abs(fract(z.x + seed * ${wf(JAG_SEED.along)} + wob * shape.y) - 0.5) * 4.0 - 1.0;`,
  `let t2 = abs(fract(z.y * shape.w + seed * ${wf(JAG_SEED.up)} + ${wf(JAG_SEED.upPhase)} - wob * shape.z) - 0.5) * 4.0 - 1.0;`,
  'let zig = 0.5 * (t1 + t2);',
  `let chip = boneHash(vec3<f32>(floor(c / max(jag.w, 1e-5)), seed + ${wf(JAG_SEED.chip)})) * 2.0 - 1.0;`,
  'return jag.x * zig + jag.z * chip;',
] as const;

export const MESH_SPLIT_JAG_WGSL = /* wgsl */ `fn meshSplitJag(c: vec2<f32>, seed: f32, jag: vec4<f32>, shape: vec4<f32>) -> f32 {
  // jag = (zigAmp, zigLen, chipAmp, chipLen), metres; shape = (wobble, wobbleAlong, wobbleUp, upFreq);
  // c = (along the hinge axis, up from the hinge).
  ${MESH_SPLIT_JAG_LINES.join('\n  ')}
}`;

/** The per-instance attributes of a split copy: four vec4s, in this order, in one row of SPLIT_INSTANCE_FLOATS. */
export const SPLIT_INSTANCE_ATTRS = ['iSplitN', 'iSplitH', 'iSplitA', 'iSplitK'] as const;
export const SPLIT_INSTANCE_FLOATS = 16;

/** Write instance `i`'s split record into `rows`: N = (plane normal, d0), H = (hinge point, this copy's bone angle),
 *  A = (hinge axis, rho), K = (piece, the + half turns, the - half turns, seed). `piece` 0 is the rest (angle 0), 1 the
 *  + half, 2 the - half. */
export function packSplitInstance(rows: Float32Array, i: number, s: SkullSplit, piece: 0 | 1 | 2): void {
  const w = s.frame.w, o = i * SPLIT_INSTANCE_FLOATS;
  rows[o] = w.n[0]; rows[o + 1] = w.n[1]; rows[o + 2] = w.n[2]; rows[o + 3] = w.d0;
  rows[o + 4] = w.h[0]; rows[o + 5] = w.h[1]; rows[o + 6] = w.h[2];
  rows[o + 7] = piece === 1 ? s.angleP : piece === 2 ? s.angleM : 0;
  rows[o + 8] = w.a[0]; rows[o + 9] = w.a[1]; rows[o + 10] = w.a[2]; rows[o + 11] = s.frame.rho;
  rows[o + 12] = piece; rows[o + 13] = s.angleP !== 0 ? 1 : 0; rows[o + 14] = s.angleM !== 0 ? 1 : 0; rows[o + 15] = s.seed;
}

/** THE CLIP. `pWorld` is the fragment on the turned copy. Returns (q, keep): q the un-turned point (pWorld taken back
 *  by the copy's angle about the hinge), and keep >= 0 where the copy's piece owns q (head-split.ts skullPieceAt),
 *  growing with the distance to the piece's nearest edge. With region = min(up, rho - dh) (>= 0: above the hinge plane
 *  and inside the hold ball) and side = s(q) + jag(q):
 *    the + half keeps  min(region, side)  >= 0
 *    the - half keeps  min(region, -side) >= 0
 *    the rest keeps what no TURNING half takes: the negative of each turning half's value. */
export const MESH_SPLIT_CLIP_WGSL = /* wgsl */ `fn meshSplitClip(pWorld: vec3<f32>, sn: vec4<f32>, sh: vec4<f32>, sa: vec4<f32>, sk: vec4<f32>, jag: vec4<f32>, shape: vec4<f32>) -> vec4<f32> {
  // sn = (n, d0), sh = (h, this copy's angle), sa = (a, rho), sk = (piece, + turns, - turns, seed).
  let rel = pWorld - sh.xyz;
  let c = cos(sh.w);
  let s = sin(sh.w);
  let q = sh.xyz + rel * c - cross(sa.xyz, rel) * s + sa.xyz * (dot(sa.xyz, rel) * (1.0 - c));
  let r = q - sh.xyz;
  let up = dot(cross(sn.xyz, sa.xyz), r);
  let side = dot(sn.xyz, q) - sn.w + meshSplitJag(vec2<f32>(dot(sa.xyz, r), up), sk.w, jag, shape);
  let region = min(up, sa.w - length(r));
  let dP = min(region, side);
  let dM = min(region, -side);
  let d0 = min(select(1e3, -dP, sk.y > 0.5), select(1e3, -dM, sk.z > 0.5));
  let keep = select(select(d0, dP, sk.x > 0.5), dM, sk.x > 1.5);
  return vec4<f32>(q, keep);
}`;

/** THE INSIDE OF THE BONE. A clipped shell shows its back faces: they are the skull's inner wall, one dark colour
 *  (HEAD_SPLIT.skull.inside) whatever is painted outside, with exposure 0, the shade's occluded end. Within the rim's
 *  width of the copy's edge (`keep`, the clip's distance to it) the wall is cut bone instead: full at half the width,
 *  gone at the width. `front` is 1 on a front face, which keeps its own surface; rim = (colour, width in metres). */
export const MESH_SPLIT_INSIDE_WGSL = /* wgsl */ `fn meshSplitInside(surface: vec4<f32>, front: f32, inside: vec3<f32>, keep: f32, rim: vec4<f32>) -> vec4<f32> {
  let edge = clamp((rim.w - keep) / max(rim.w, 1e-6) * 2.0, 0.0, 1.0);
  return select(vec4<f32>(mix(inside, rim.xyz, edge), edge), surface, front > 0.5);
}`;

/** MESH_SPLIT_INSIDE_WGSL's rim share at `keep` metres from the edge (its hand twin). */
export function meshSplitRim(keep: number, width: number = HEAD_SPLIT.skull.rim.width): number {
  return Math.max(0, Math.min(1, (width - keep) / Math.max(width, 1e-6) * 2));
}

/** What the tuning seam may set of the split skull's look (game-seams-skeleton.ts skullSplit; the renderer's
 *  splitLook): the fracture's SplitJag numbers, the bone's follow (null = HEAD_SPLIT's table), the inner wall, the rim. */
export type SplitLookSet = Partial<SplitJag> & {
  follow?: SkullFollow | null;
  inside?: readonly [number, number, number]; rim?: readonly [number, number, number]; rimWidth?: number;
};

const LOOK_NUMBERS = ['zigAmp', 'zigLen', 'chipAmp', 'chipLen', 'wobble', 'wobbleAlong', 'wobbleUp', 'upFreq', 'rimWidth'] as const;
/** `set` is a SplitLookSet: every number given is finite, a colour is three of them, `follow` is null or something
 *  skullSplitOf can take. A NaN here would reach the copies' matrices and the clip. */
export function splitLookOk(set: unknown): set is SplitLookSet {
  if (set === null || typeof set !== 'object') return false;
  const s = set as Record<string, unknown>;
  const colour = (c: unknown) => c === undefined || (Array.isArray(c) && c.length === 3 && c.every(v => Number.isFinite(v)));
  return LOOK_NUMBERS.every(k => s[k] === undefined || (typeof s[k] === 'number' && Number.isFinite(s[k])))
    && colour(s.inside) && colour(s.rim) && (s.follow === undefined || s.follow === null || skullFollowOk(s.follow));
}

/** MESH_SPLIT_CLIP_WGSL's hand twin, for the tests: edit the two together. */
export function meshSplitKeep(
  pWorld: Vec3,
  inst: { w: SplitWarp; rho: number; angle: number; piece: 0 | 1 | 2; turnP: boolean; turnM: boolean; seed: number },
  jag: SplitJag = HEAD_SPLIT.skull.jag,
): { q: Vec3; keep: number } {
  const { w } = inst;
  const rel: Vec3 = [pWorld[0] - w.h[0], pWorld[1] - w.h[1], pWorld[2] - w.h[2]];
  const c = Math.cos(inst.angle), s = Math.sin(inst.angle), x = cross(w.a, rel), d = dot(w.a, rel) * (1 - c);
  const q: Vec3 = [
    w.h[0] + rel[0] * c - x[0] * s + w.a[0] * d, w.h[1] + rel[1] * c - x[1] * s + w.a[1] * d,
    w.h[2] + rel[2] * c - x[2] * s + w.a[2] * d,
  ];
  const r: Vec3 = [q[0] - w.h[0], q[1] - w.h[1], q[2] - w.h[2]];
  const up = dot(cross(w.n, w.a), r);
  const side = dot(w.n, q) - w.d0 + meshSplitJag(dot(w.a, r), up, inst.seed, jag);
  const region = Math.min(up, inst.rho - Math.hypot(r[0], r[1], r[2]));
  const dP = Math.min(region, side), dM = Math.min(region, -side);
  const d0 = Math.min(inst.turnP ? -dP : 1e3, inst.turnM ? -dM : 1e3);
  return { q, keep: inst.piece === 2 ? dM : inst.piece === 1 ? dP : d0 };
}
