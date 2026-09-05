// src/lab/sdf-zombie/glb-clip.ts
//
// Enough glTF to read ONE skinned clip: GLB chunks, accessors, LINEAR
// animation channels, and the node hierarchy composed to world positions.
// Then the stride sampler: 32 phases over one cycle → sagittal angles.
// Pure; the only I/O is the byte array the caller hands in.
import type { Vec3 } from './types';
import { add, len, qMul, qRotate, sub, type Quat } from './vec';
import type { GaitCurves, LegCurves } from './gait-curves';

interface GltfJson {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations: { name?: string; channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[] }[];
}

export interface Glb { json: GltfJson; bin: DataView }

export function parseGlb(bytes: Uint8Array): Glb {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json: GltfJson | null = null;
  let bin: DataView | null = null;
  while (off < bytes.byteLength) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    const body = bytes.subarray(off + 8, off + 8 + clen);
    if (ctype === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (ctype === 0x004e4942) bin = new DataView(body.buffer, body.byteOffset, body.byteLength);
    off += 8 + clen;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

const COMP: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** Float accessor → flat array (componentType 5126 only; clips use floats). */
function readFloats(g: Glb, accessor: number): Float32Array {
  const a = g.json.accessors[accessor]!;
  if (a.componentType !== 5126) throw new Error(`accessor ${accessor}: expected float32`);
  const bv = g.json.bufferViews[a.bufferView]!;
  const n = COMP[a.type]!;
  const stride = bv.byteStride ?? n * 4;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++) out[i * n + k] = g.bin.getFloat32(base + i * stride + k * 4, true);
  return out;
}

interface Track { times: Float32Array; values: Float32Array; width: number }
interface NodeTracks { translation?: Track; rotation?: Track; scale?: Track }

function tracksOf(g: Glb, clip = 0): Map<number, NodeTracks> {
  const anim = g.json.animations[clip];
  if (!anim) throw new Error('no animation in glb');
  const out = new Map<number, NodeTracks>();
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]!;
    const t: Track = { times: readFloats(g, s.input), values: readFloats(g, s.output), width: ch.target.path === 'rotation' ? 4 : 3 };
    const nt = out.get(ch.target.node) ?? {};
    (nt as Record<string, Track>)[ch.target.path] = t;
    out.set(ch.target.node, nt);
  }
  return out;
}

/** Clip duration: the latest keyframe time over every sampler. */
export function clipDuration(g: Glb, clip = 0): number {
  const anim = g.json.animations[clip]!;
  let d = 0;
  for (const s of anim.samplers) d = Math.max(d, readFloats(g, s.input).at(-1) ?? 0);
  return d;
}

function sampleTrack(t: Track, time: number): number[] {
  const n = t.times.length, w = t.width;
  if (time <= t.times[0]!) return Array.from(t.values.subarray(0, w));
  if (time >= t.times[n - 1]!) return Array.from(t.values.subarray((n - 1) * w, n * w));
  let i = 0;
  while (t.times[i + 1]! < time) i++;
  const u = (time - t.times[i]!) / (t.times[i + 1]! - t.times[i]!);
  const a = t.values.subarray(i * w, (i + 1) * w), b = t.values.subarray((i + 1) * w, (i + 2) * w);
  const out: number[] = [];
  for (let k = 0; k < w; k++) out.push(a[k]! + (b[k]! - a[k]!) * u);
  if (w === 4) { // normalise the lerped quaternion (short arc: Meshy keys are dense)
    const m = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!) || 1;
    for (let k = 0; k < 4; k++) out[k]! /= m;
  }
  return out;
}

/**
 * World positions (metres — the Armature's 0.01 scale is composed in) of the
 * named joints at clip time `time`. Nodes without a track keep their bind TRS.
 */
export function jointWorldPositions(g: Glb, time: number, names: readonly string[], clip = 0): Map<string, Vec3> {
  const tracks = tracksOf(g, clip);
  const want = new Set(names);
  const out = new Map<string, Vec3>();
  const walk = (i: number, pPos: Vec3, pQ: Quat, pS: number) => {
    const nd = g.json.nodes[i]!, tr = tracks.get(i) ?? {};
    const t = (tr.translation ? sampleTrack(tr.translation, time) : nd.translation ?? [0, 0, 0]) as unknown as Vec3;
    const r = (tr.rotation ? sampleTrack(tr.rotation, time) : nd.rotation ?? [0, 0, 0, 1]) as unknown as Quat;
    const sc = tr.scale ? sampleTrack(tr.scale, time) : nd.scale ?? [1, 1, 1];
    const s = pS * sc[0]!; // uniform scale is all these rigs use
    const pos = add(pPos, qRotate(pQ, [t[0] * pS, t[1] * pS, t[2] * pS]));
    const q = qMul(pQ, r);
    if (nd.name && want.has(nd.name)) out.set(nd.name, pos);
    for (const c of nd.children ?? []) walk(c, pos, q, s);
  };
  for (const root of g.json.scenes[0]!.nodes) walk(root, [0, 0, 0], [0, 0, 0, 1], 1);
  return out;
}

export interface CurveOpts { name: string; n?: number; clip?: number }

const JOINTS = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'] as const;

/** Thigh pitch forward from straight down and knee flexion, sagittal plane. */
function legAngles(hip: Vec3, knee: Vec3, ankle: Vec3): { thigh: number; knee: number } {
  const t = sub(knee, hip), s = sub(ankle, knee);
  const thigh = Math.atan2(t[2], -t[1]);
  const shin = Math.atan2(s[2], -s[1]);
  return { thigh, knee: thigh - shin }; // shin trails the thigh when the knee bends
}

/** One clip → GaitCurves. Phase 0 = left heel strike (left thigh pitched furthest forward). */
export function curvesFromClip(g: Glb, opts: CurveOpts): GaitCurves {
  const n = opts.n ?? 32;
  const dur = clipDuration(g, opts.clip ?? 0);
  const frames = Array.from({ length: n }, (_, i) => jointWorldPositions(g, (i / n) * dur, JOINTS, opts.clip ?? 0));
  const f0 = frames[0]!;
  const legLen = len(sub(f0.get('LeftLeg')!, f0.get('LeftUpLeg')!)) + len(sub(f0.get('LeftFoot')!, f0.get('LeftLeg')!));
  // Phase origin: left thigh pitched furthest forward (heel strike; the
  // forward-most FOOT lands a sample earlier than peak thigh pitch).
  let start = 0, best = -Infinity;
  frames.forEach((f, i) => {
    const a = legAngles(f.get('LeftUpLeg')!, f.get('LeftLeg')!, f.get('LeftFoot')!);
    if (a.thigh > best) { best = a.thigh; start = i; }
  });
  const at = (i: number) => frames[(start + i) % n]!;
  const side = (up: string, lo: string, ft: string): LegCurves => {
    const thigh: number[] = [], knee: number[] = [], heights: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = at(i);
      const a = legAngles(f.get(up)!, f.get(lo)!, f.get(ft)!);
      thigh.push(a.thigh); knee.push(a.knee); heights.push(f.get(ft)![1]);
    }
    const floor = Math.min(...heights);
    // 9% of leg length: the ankle joint rolls ~8% off the floor through
    // stance before toe-off, so 3% only catches mid-stance (duty 0.22).
    // Measured duties at 9%: walk 0.625, run 0.313.
    return { thigh, knee, stance: heights.map(h => h < floor + 0.09 * legLen) };
  };
  const L = side('LeftUpLeg', 'LeftLeg', 'LeftFoot');
  const R = side('RightUpLeg', 'RightLeg', 'RightFoot');
  const hips = Array.from({ length: n }, (_, i) => at(i).get('Hips')![1]);
  const mean = hips.reduce((a, b) => a + b, 0) / n;
  const hipsY = hips.map(h => (h - mean) / legLen);
  // Travel: the left foot's fore-aft range relative to the hips while planted.
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) if (L.stance[i]) {
    const f = at(i); const z = f.get('LeftFoot')![2] - f.get('Hips')![2];
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  return { name: opts.name, n, freq: 1 / dur, travel: (zMax - zMin) / legLen, hipsY, L, R };
}
