// scripts/kit-clearance.ts
//
// Does a character's polygon CLOTHING stay over its flesh when it MOVES? Kit rides one bone rigidly; the SDF flesh
// under it is folded from several and bends, so cloth that clears the rest skin can still have flesh coming through
// it in the walk (the zombie labourer's trousers at the crotch, 2026-10-26).
//
//   npx tsx scripts/kit-clearance.ts zombie [material,material...]   (default: cloth)
//
// Poses the compiled kit (public/assets/lab/<character>-kit.gltf) exactly as the game does (kitFrames over the real
// motion: makeActorMotion / stepActorMotion, the shamble at three speeds) beside the posed flesh (applyRig), samples the
// flesh SURFACE over the regions the clothes are meant to cover (CLOTHED below), and casts a short ray outward from
// each sample: a sample whose ray meets no cloth triangle within REACH is flesh SHOWING. Prints the share showing per
// region and speed. (Asking "is each cloth vertex outside the flesh" instead flagged cloth buried under other cloth,
// like the top of a thigh tube inside the seat, and missed nothing it should.) Exit 1 when any region shows more than
// SHOW_MAX.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../src/lab/sdf-zombie/actor';
import { motionProfileFor } from '../src/lab/sdf-zombie/motion-profile';
import { applyRig, kitFrames } from '../src/lab/sdf-zombie/rig-bind';
import { makeRng } from '../src/lab/sdf-zombie/wander';
import { qRotate } from '../src/lab/sdf-zombie/vec';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, matArg] = process.argv.slice(2);
if (!name) { console.error('usage: kit-clearance.ts <character> [material,...]'); process.exit(2); }
const mats = new Set((matArg ?? 'cloth').split(','));
const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${name}.blob`), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const bones = built.bones as unknown as Map<string, { head: V }>;

const REACH = 0.06, SHOW_MAX = 0.005;
/** The regions meant to be clothed: [label, cluster, bone the samples are taken round, t0, t1] (bone rays), or the
 *  torso band [y0, y1] (rays from the torso's vertical axis). The zombie labourer's trousers. */
const CLOTHED: { label: string; limb: string; bone?: string; t0: number; t1: number }[] = [
  { label: 'seat (torso y 0.88-1.02)', limb: 'torso', t0: 0.88, t1: 1.02 },
  ...(['l', 'r'] as const).flatMap(sd => [
    { label: `thigh.${sd}`, limb: sd === 'l' ? 'legL' : 'legR', bone: `thigh.${sd}`, t0: 0.05, t1: 0.98 },
    { label: `shin.${sd} (to the hem)`, limb: sd === 'l' ? 'legL' : 'legR', bone: `shin.${sd}`, t0: 0.02, t1: 0.26 },
  ]),
];

// ---- the cloth: triangles of the named materials, each vertex with its bone (blender-kit.ts: weight 1 on one joint)
const g = JSON.parse(readFileSync(resolve(ROOT, `public/assets/lab/${name}-kit.gltf`), 'utf8'));
const bin = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
const read = (ai: number) => {
  const a = g.accessors[ai], v = g.bufferViews[a.bufferView], n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
  const Arr = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
  const off = bin.byteOffset + (v.byteOffset ?? 0);
  return new Arr(bin.buffer.slice(off, off + a.count * n * Arr.BYTES_PER_ELEMENT));
};
const jointNames: string[] = g.skins[0].joints.map((j: number) => g.nodes[j].name);
const vbone: string[] = [], vrest: V[] = [], tris: number[] = [];
for (const prim of g.meshes[0].primitives) {
  if (!mats.has(g.materials[prim.material].name)) continue;
  const P = read(prim.attributes.POSITION), J = read(prim.attributes.JOINTS_0), I = read(prim.indices), base = vrest.length;
  for (let i = 0; i < P.length / 3; i++) { vrest.push([P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!]); vbone.push(jointNames[J[i * 4]!]!); }
  for (const k of I) tris.push(base + k);
}
if (!tris.length) { console.error(`no triangles of ${[...mats].join(', ')} in ${name}-kit.gltf`); process.exit(2); }

/** Moller-Trumbore, both faces: the ray o + t d hits the triangle for some 0 < t < REACH. */
function hits(o: V, d: V, a: V, b: V, c: V): boolean {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!];
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) * inv;
  if (u < 0 || u > 1) return false;
  const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
  const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) * inv;
  return t > 0 && t < REACH;
}

const profile = motionProfileFor(name);
const tally = new Map<string, { n: number; shown: number }>();
for (const speed of [0, profile.cruise, profile.cruise * 1.4]) {
  const m = makeActorMotion(built, { seed: 23 });
  const rng = makeRng(23);
  for (let i = 0; i < 60 + 150; i++) {
    stepActorMotion(m, { current: built, dt: 1 / 60, wander: true, armStyle: undefined, headingFollow: 1, gazeFollow: 1,
      bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, rng, signals: emptyActorSignals(), profile, forceSpeed: speed });
    if (i < 60 || i % 15) continue;
    const posed = applyRig(built, m.bound, m.lastBodyYaw), frames = kitFrames(built, m.bound, m.lastBodyYaw);
    // the posed cloth, and a bounding sphere per triangle to reject most of them per ray
    const W: V[] = vrest.map((p, i) => {
      const f = frames.get(vbone[i]!)!, h = bones.get(vbone[i]!)!.head, w = qRotate(f.quat, [p[0] - h[0], p[1] - h[1], p[2] - h[2]]);
      return [f.pos[0] + w[0], f.pos[1] + w[1], f.pos[2] + w[2]];
    });
    const sph: number[] = [];
    for (let k = 0; k < tris.length; k += 3) {
      const a = W[tris[k]!]!, b = W[tris[k + 1]!]!, c = W[tris[k + 2]!]!;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      sph.push(cx, cy, cz, Math.max(...[a, b, c].map(v => Math.hypot(v[0] - cx, v[1] - cy, v[2] - cz))));
    }
    const covered = (o: V, d: V) => {
      for (let k = 0; k < tris.length; k += 3) {
        const j = (k / 3) * 4, cx = sph[j]! - o[0], cy = sph[j + 1]! - o[1], cz = sph[j + 2]! - o[2], r = sph[j + 3]!;
        const along = cx * d[0] + cy * d[1] + cz * d[2];
        if (along < -r || along > REACH + r) continue;
        if (cx * cx + cy * cy + cz * cz - along * along > r * r) continue;
        if (hits(o, d, W[tris[k]!]!, W[tris[k + 1]!]!, W[tris[k + 2]!]!)) return true;
      }
      return false;
    };
    for (const R of CLOTHED) {
      const field = { ...posed, clusters: posed.clusters.map(c => ({ ...c, alive: c.alive && c.limb === R.limb })) } as typeof built;
      const all = posed;
      const key = `${R.label} @ ${speed.toFixed(2)} m/s`;
      const t = tally.get(key) ?? { n: 0, shown: 0 };
      for (let a = 0; a < 24; a++) for (let s = 0; s <= 8; s++) {
        // a ray toward the region's axis: the torso's vertical one, or the posed bone
        let axisP: V, dir: V;
        const ang = (a / 24) * Math.PI * 2;
        if (!R.bone) {
          const y = R.t0 + (R.t1 - R.t0) * (s / 8);
          const f = frames.get('pelvis')!, h = bones.get('pelvis')!.head;
          const rel = qRotate(f.quat, [0, y - h[1], 0.02 - h[2]]);
          axisP = [f.pos[0] + rel[0], f.pos[1] + rel[1], f.pos[2] + rel[2]];
          dir = qRotate(f.quat, [Math.sin(ang), 0, Math.cos(ang)]);
        } else {
          const bh = bones.get(R.bone)!.head, f = frames.get(R.bone)!;
          const tail = (built.bones as unknown as Map<string, { tail: V }>).get(R.bone)!.tail;
          const k = R.t0 + (R.t1 - R.t0) * (s / 8);
          const rel = qRotate(f.quat, [(tail[0] - bh[0]) * k, (tail[1] - bh[1]) * k, (tail[2] - bh[2]) * k]);
          axisP = [f.pos[0] + rel[0], f.pos[1] + rel[1], f.pos[2] + rel[2]];
          const u = qRotate(f.quat, [tail[0] - bh[0], tail[1] - bh[1], tail[2] - bh[2]]), ul = Math.hypot(...u);
          const un: V = [u[0] / ul, u[1] / ul, u[2] / ul], ref: V = Math.abs(un[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
          const e1n = [ref[0] - un[0] * (ref[0] * un[0] + ref[1] * un[1] + ref[2] * un[2]), ref[1] - un[1] * (ref[0] * un[0] + ref[1] * un[1] + ref[2] * un[2]), ref[2] - un[2] * (ref[0] * un[0] + ref[1] * un[1] + ref[2] * un[2])];
          const el = Math.hypot(e1n[0]!, e1n[1]!, e1n[2]!), e1: V = [e1n[0]! / el, e1n[1]! / el, e1n[2]! / el];
          const e2: V = [un[1] * e1[2] - un[2] * e1[1], un[2] * e1[0] - un[0] * e1[2], un[0] * e1[1] - un[1] * e1[0]];
          dir = [e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang), e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang), e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)];
        }
        // march in from outside to the region's flesh; skip rays that miss it, and samples buried in OTHER flesh
        let r = 0.4, hit = false;
        for (let it = 0; it < 300; it++) {
          const q: V = [axisP[0] + dir[0] * r, axisP[1] + dir[1] * r, axisP[2] + dir[2] * r];
          const d = sdBody(q, field);
          if (Math.abs(d) < 1e-4) { hit = true; break; }
          r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
          if (r < 0) break;
        }
        if (!hit) continue;
        const p: V = [axisP[0] + dir[0] * (r + 0.001), axisP[1] + dir[1] * (r + 0.001), axisP[2] + dir[2] * (r + 0.001)];
        if (sdBody(p, all) < -0.002) continue;   // inside another limb's flesh: not on the visible surface
        t.n++;
        if (!covered(p, dir)) t.shown++;
      }
      tally.set(key, t);
    }
  }
}
let fail = false;
for (const [k, t] of tally) {
  const share = t.shown / Math.max(1, t.n);
  console.log(`${k}: flesh showing ${(100 * share).toFixed(2)}% of ${t.n} samples`);
  if (share > SHOW_MAX) fail = true;
}
process.exit(fail ? 1 : 0);
