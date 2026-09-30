// Renderer-free collision, projection and stain state. All coordinates are
// receiver-local; the view supplies mesh transforms at the boundary.
import type { Vec3 } from './types';
import { add, sub, scale, dot, cross, normalize, len, basisFromAxis } from './vec';

export interface SurfaceHit { pos: Vec3; normal: Vec3; receiver: number; t: number }
interface Bounds { min: Vec3; max: Vec3 }
interface Branch extends Bounds { ids?: number[]; left?: Branch; right?: Branch }
export interface TriangleIndex { positions: Float32Array; root: Branch; triangles: number }

function vertex(p: Float32Array, i: number): Vec3 { return [p[i]!, p[i + 1]!, p[i + 2]!]; }
function bounds(p: Float32Array, ids: number[]): Bounds {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const x = p[id * 9 + v * 3 + k]!; lo[k] = Math.min(lo[k]!, x); hi[k] = Math.max(hi[k]!, x);
  }
  return { min: lo as unknown as Vec3, max: hi as unknown as Vec3 };
}
export function indexTriangles(positions: Float32Array): TriangleIndex {
  if (positions.length % 9) throw new Error('Triangle soup must contain complete triangles');
  function build(ids: number[]): Branch {
    const b = bounds(positions, ids);
    if (ids.length <= 12) return { ...b, ids };
    const extent = sub(b.max, b.min);
    const axis = extent[0] >= extent[1] && extent[0] >= extent[2] ? 0 : extent[1] >= extent[2] ? 1 : 2;
    const centre = (id: number) => positions[id * 9 + axis]! + positions[id * 9 + 3 + axis]! + positions[id * 9 + 6 + axis]!;
    ids.sort((a, c) => centre(a) - centre(c) || a - c);
    const mid = ids.length >> 1;
    return { ...b, left: build(ids.slice(0, mid)), right: build(ids.slice(mid)) };
  }
  const triangles = positions.length / 9;
  return { positions, triangles, root: build(Array.from({ length: triangles }, (_, i) => i)) };
}
function overlaps(a: Bounds, b: Bounds): boolean {
  return a.min.every((v, k) => v <= b.max[k]! && a.max[k]! >= b.min[k]!);
}
function visit(index: TriangleIndex, query: Bounds, fn: (id: number) => void): void {
  function walk(b: Branch) {
    if (!overlaps(b, query)) return;
    if (b.ids) for (const id of b.ids) fn(id);
    else { walk(b.left!); walk(b.right!); }
  }
  walk(index.root);
}
export function sweepTriangles(index: TriangleIndex, from: Vec3, to: Vec3, receiver = 0): SurfaceHit | null {
  const dir = sub(to, from);
  const query: Bounds = { min: from.map((x, k) => Math.min(x, to[k]!) - 1e-5) as unknown as Vec3,
    max: from.map((x, k) => Math.max(x, to[k]!) + 1e-5) as unknown as Vec3 };
  let best: SurfaceHit | null = null;
  visit(index, query, id => {
    const a = vertex(index.positions, id * 9), b = vertex(index.positions, id * 9 + 3), c = vertex(index.positions, id * 9 + 6);
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(dir, e2), det = dot(e1, p);
    // Front-facing hits only: don't paint the far side of thin surfaces.
    if (det < 1e-9) return;
    const s = sub(from, a), u = dot(s, p) / det;
    if (u < -1e-6 || u > 1 + 1e-6) return;
    const q = cross(s, e1), v = dot(dir, q) / det;
    if (v < -1e-6 || u + v > 1 + 1e-6) return;
    const t = dot(e2, q) / det;
    if (t < -1e-6 || t > 1 || (best !== null && t >= best.t)) return;
    best = { pos: add(from, scale(dir, Math.max(0, t))), normal: normalize(cross(e1, e2)), receiver, t: Math.max(0, t) };
  });
  return best;
}

export type StainLook = 'auto' | 'wet' | 'dry' | 'smear';
export interface Stain {
  id: number; receiver: number; pos: Vec3; normal: Vec3; tangent: Vec3;
  width: number; height: number; seed: number; born: number; look: Exclude<StainLook, 'auto'>;
}
export interface StainState { stains: Stain[]; clock: number; nextId: number; revision: number; merged: number; evicted: number }
export const STAIN_CAP = 192;
export function createStains(): StainState { return { stains: [], clock: 0, nextId: 1, revision: 0, merged: 0, evicted: 0 }; }
export function clearStains(s: StainState): void {
  s.stains.length = 0; s.clock = 0; s.nextId = 1; s.merged = 0; s.evicted = 0; s.revision++;
}
function hash(x: number): number { const n = Math.sin(x * 78.233 + 11.7) * 43758.5453; return n - Math.floor(n); }
export function depositStain(s: StainState, hit: SurfaceHit, velocity: Vec3, size: number, look: StainLook = 'auto'): Stain {
  const tangentVelocity = sub(velocity, scale(hit.normal, dot(velocity, hit.normal)));
  const speed = len(tangentVelocity), seed = hash(s.nextId);
  const style = look === 'auto' ? (speed > 2.5 && speed > Math.abs(dot(velocity, hit.normal)) * 1.3 ? 'smear' : 'wet') : look;
  const frame = basisFromAxis(hit.normal), yaw = seed * Math.PI * 2;
  const tangent = speed > 0.05 ? normalize(tangentVelocity) : add(scale(frame.u, Math.cos(yaw)), scale(frame.v, Math.sin(yaw)));
  const radius = Math.max(0.075, Math.min(0.34, size * 2.8 + len(velocity) * 0.009));
  // Merge only nearby, similarly oriented marks of the SAME receiver/style.
  const old = s.stains.find(d => d.receiver === hit.receiver && d.look === style && dot(d.normal, hit.normal) > 0.98
    && len(sub(d.pos, hit.pos)) < Math.min(d.height, radius) * 0.28);
  if (old) {
    const ratio = Math.min(1.1, 0.9 / old.width);
    old.width *= ratio; old.height = Math.min(0.5, old.height * 1.08); old.born = s.clock;
    // Refresh recency so a repeatedly fed pool is not evicted as an old mark.
    s.stains.splice(s.stains.indexOf(old), 1); s.stains.push(old);
    s.merged++; s.revision++; return old;
  }
  const d: Stain = { id: s.nextId++, receiver: hit.receiver, pos: hit.pos, normal: hit.normal, tangent,
    width: radius * (style === 'smear' ? 2.4 : 1.15), height: radius, seed, born: s.clock, look: style };
  s.stains.push(d);
  if (s.stains.length > STAIN_CAP) { s.stains.shift(); s.evicted++; }
  s.revision++; return d;
}

export interface DecalSoup { positions: number[]; normals: number[]; uvs: number[] }
/** Project onto local, nearby triangles. Narrow depth and normal rejection
 * prevent back-face bleed and wrapping a stain around a right-angle corner. */
export function projectStain(index: TriangleIndex, d: Stain): DecalSoup {
  const out: DecalSoup = { positions: [], normals: [], uvs: [] };
  const u = d.tangent, n = d.normal, v = normalize(cross(n, u)), depth = 0.025;
  const extent = [0, 1, 2].map(k => Math.abs(u[k]!) * d.width + Math.abs(v[k]!) * d.height + Math.abs(n[k]!) * depth);
  visit(index, { min: d.pos.map((x, k) => x - extent[k]!) as unknown as Vec3,
    max: d.pos.map((x, k) => x + extent[k]!) as unknown as Vec3 }, id => {
    const a = vertex(index.positions, id * 9), b = vertex(index.positions, id * 9 + 3), c = vertex(index.positions, id * 9 + 6);
    const norm = normalize(cross(sub(b, a), sub(c, a)));
    if (dot(norm, n) < 0.8) return;
    let polygon = [a, b, c].map(p => { const r = sub(p, d.pos); return [dot(r, u), dot(r, v), dot(r, n)] as Vec3; });
    for (const [axis, limit] of [[0, d.width], [1, d.height], [2, depth]] as const) for (const sign of [-1, 1]) {
      const clipped: Vec3[] = [];
      for (let k = 0; k < polygon.length; k++) {
        const p = polygon[k]!, q = polygon[(k + 1) % polygon.length]!;
        const dp = sign * p[axis] - limit, dq = sign * q[axis] - limit;
        if (dp <= 0) clipped.push(p);
        if ((dp <= 0) !== (dq <= 0)) clipped.push(add(p, scale(sub(q, p), dp / (dp - dq))));
      }
      polygon = clipped;
    }
    for (let k = 1; k + 1 < polygon.length; k++) for (const p of [polygon[0]!, polygon[k]!, polygon[k + 1]!]) {
      const at = add(d.pos, add(scale(u, p[0]), add(scale(v, p[1]), scale(n, p[2]))));
      // Tiny actual normal offset; no accumulating index-based floor ladder.
      out.positions.push(...add(at, scale(norm, 0.0015)));
      out.normals.push(...norm); out.uvs.push(p[0] / d.width, p[1] / d.height);
    }
  });
  return out;
}
