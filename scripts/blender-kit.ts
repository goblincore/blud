// scripts/blender-kit.ts
//
// Compile a BLENDER-authored kit into the kit glTF the runtime loads
// (webgpu/kit-overlay.ts loadKit), skinned rigidly to a .blob's skeleton:
//
//   npx tsx scripts/blender-kit.ts <character> <parts.glb> [out.gltf]
//     default out: public/assets/lab/<character>-kit.gltf
//
// WHY NOT WAM. WAM lofts rings round bones, which suits armour that WRAPS a
// limb (the soldier's cuirass, the goblin's greaves). Machinery — pistons,
// hip drums, a clawed foot, an optic housing — is boxes and cylinders placed
// freely, which is what Blender is for. scripts/merge-kit-teeth.mjs proved
// the runtime does not care who wrote the skin; this is the general form of
// that merge, minus WAM.
//
// THE CONTRACT WITH THE .glb:
//   * every MESH node is named `<bone>|<part>`, where <bone> is a .blob bone
//     (`thigh.l`, `skull`, ...). Every vertex of it rides that bone, weight 1.
//     A node with no `|` or an unknown bone is an error, not a skip.
//   * geometry is in the .blob's REST frame: metres, Y up, +Z forward (Blender
//     authors in Z-up and its glTF exporter converts). Node transforms are
//     applied here, so an un-applied object is fine.
//   * each material's NAME picks its look (kit-overlay.ts LOOK: iron, chrome,
//     brass, plate, cable, led, ...); its baseColorFactor is the albedo.
//   * a part MAY carry vertex colours (COLOR_0, e.g. baked ambient occlusion):
//     they multiply the albedo (three turns vertexColors on for a primitive
//     with COLOR_0). Within one material, parts without colours get white.
//
// WHAT IT WRITES: joint nodes named after the bones, each at its bone's HEAD
// (translation-only, parented as the .blob is), inverse binds that are pure
// translations (kit-overlay.ts poseKitBones assumes exactly that), and one
// skinned mesh with a primitive per material. Self-contained: the buffer is a
// base64 data URI, like WAM's output, so only the .gltf ships.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, glbPath, outArg] = process.argv.slice(2);
if (!name || !glbPath) {
  console.error('usage: blender-kit.ts <character> <parts.glb> [out.gltf]');
  process.exit(2);
}
const outPath = outArg ?? resolve(ROOT, `public/assets/lab/${name}-kit.gltf`);
const die = (m: string): never => { console.error(`blender-kit: ${m}`); process.exit(1); };

// ---------- the skeleton, from the .blob ----------
const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${name}.blob`), 'utf8'));
const def = compileBlob(doc, compileFace(doc));
const built = buildBody(def);
type V3 = [number, number, number];
const heads = new Map<string, V3>();
for (const [k, b] of built.bones as Map<string, { head: V3 }>) heads.set(k, b.head);
const parentOf = new Map<string, string | null>();
for (const k of heads.keys()) {
  const side = /\.(l|r)$/.exec(k)?.[0] ?? '';
  const base = side ? k.slice(0, -2) : k;
  const p = def.bones.find(b => b.name === base)?.parent ?? null;
  parentOf.set(k, p === null ? null : heads.has(p + side) ? p + side : p);
}
const order: string[] = [];
const visit = (k: string) => {
  if (order.includes(k)) return;
  const p = parentOf.get(k);
  if (p) visit(p);
  order.push(k);
};
for (const k of heads.keys()) visit(k);
const jointIndex = new Map(order.map((k, i) => [k, i]));

// ---------- the parts, from the .glb ----------
const glb = readFileSync(glbPath);
if (glb.readUInt32LE(0) !== 0x46546c67) die(`${glbPath} is not a .glb`);
const jsonLen = glb.readUInt32LE(12);
const gj = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function read(acc: number): { data: number[]; n: number; comps: number } {
  const a = gj.accessors[acc];
  const bv = gj.bufferViews[a.bufferView];
  const comps = NCOMP[a.type]!;
  const size = ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1 } as Record<number, number>)[a.componentType]!;
  const stride = bv.byteStride ?? comps * size;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const data: number[] = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
    const o = base + i * stride + c * size;
    data.push(a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o)
      : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o));
  }
  return { data, n: a.count, comps };
}
type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++)
    for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr]! * b[c * 4 + k]!;
  return r;
};
function local(n: { matrix?: M4; translation?: V3; rotation?: number[]; scale?: V3 }): M4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx, 2 * (x! * y! + z! * w!) * sx, 2 * (x! * z! - y! * w!) * sx, 0,
    2 * (x! * y! - z! * w!) * sy, (1 - 2 * (x! * x! + z! * z!)) * sy, 2 * (y! * z! + x! * w!) * sy, 0,
    2 * (x! * z! + y! * w!) * sz, 2 * (y! * z! - x! * w!) * sz, (1 - 2 * (x! * x! + y! * y!)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const I: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface Batch { pos: number[]; nrm: number[]; joint: number[]; idx: number[]; color: number[]; vcol: number[]; hasVcol: boolean }
const batches = new Map<string, Batch>();
let parts = 0;
function walk(ni: number, parent: M4) {
  const n = gj.nodes[ni];
  const world = mul(parent, local(n));
  if (n.mesh !== undefined) {
    const nm: string = n.name ?? '';
    const bar = nm.indexOf('|');
    if (bar < 0) die(`mesh node "${nm}" is not named <bone>|<part>`);
    const bone = nm.slice(0, bar);
    const j = jointIndex.get(bone);
    if (j === undefined) die(`mesh node "${nm}": no bone "${bone}" in ${name}.blob (have ${order.join(', ')})`);
    // Normals by the inverse-transpose; parts are rigid + uniformly scaled at
    // most, so the upper 3x3 renormalised is enough.
    for (const p of gj.meshes[n.mesh].primitives) {
      const mi = p.material;
      const m = mi === undefined ? { name: 'iron' } : gj.materials[mi];
      const key: string = m.name;
      const b = batches.get(key) ?? { pos: [], nrm: [], joint: [], idx: [], color: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1], vcol: [], hasVcol: false };
      batches.set(key, b);
      const P = read(p.attributes.POSITION), N = read(p.attributes.NORMAL);
      const C = p.attributes.COLOR_0 !== undefined ? read(p.attributes.COLOR_0) : null;
      if (C) b.hasVcol = true;
      const base = b.pos.length / 3;
      for (let i = 0; i < P.n; i++) {
        const [x, y, z] = [P.data[i * 3]!, P.data[i * 3 + 1]!, P.data[i * 3 + 2]!];
        b.pos.push(world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
          world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
          world[2]! * x + world[6]! * y + world[10]! * z + world[14]!);
        const [u, v, w] = [N.data[i * 3]!, N.data[i * 3 + 1]!, N.data[i * 3 + 2]!];
        const nx = world[0]! * u + world[4]! * v + world[8]! * w, ny = world[1]! * u + world[5]! * v + world[9]! * w,
          nz = world[2]! * u + world[6]! * v + world[10]! * w;
        const l = Math.hypot(nx, ny, nz) || 1;
        b.nrm.push(nx / l, ny / l, nz / l);
        b.joint.push(j);
        if (C) {
          // Normalised integer colours come back as raw ints from read(); scale them to 0..1.
          const ct = gj.accessors[p.attributes.COLOR_0].componentType as number;
          const k = ct === 5126 ? 1 : ct === 5123 ? 1 / 65535 : 1 / 255;
          b.vcol.push(C.data[i * C.comps]! * k, C.data[i * C.comps + 1]! * k, C.data[i * C.comps + 2]! * k);
        } else b.vcol.push(1, 1, 1);
      }
      for (const k of read(p.indices).data) b.idx.push(base + k);
    }
    parts++;
  }
  for (const c of n.children ?? []) walk(c, world);
}
for (const r of gj.scenes[gj.scene ?? 0].nodes) walk(r, I);
if (parts === 0) die(`${glbPath} has no mesh nodes`);

// ---------- write the kit ----------
const chunks: Buffer[] = [];
let offset = 0;
const bufferViews: object[] = [], accessors: object[] = [];
function push(buf: Buffer, target?: number): number {
  const pad = (4 - (buf.length % 4)) % 4;
  chunks.push(buf, Buffer.alloc(pad));
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
  offset += buf.length + pad;
  return bufferViews.length - 1;
}
function acc(view: number, componentType: number, count: number, type: string, extra: object = {}): number {
  accessors.push({ bufferView: view, componentType, count, type, ...extra });
  return accessors.length - 1;
}
const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
const materials: object[] = [];
const primitives: object[] = [];
for (const [mname, b] of [...batches].sort(([a], [c]) => a.localeCompare(c))) {
  const n = b.pos.length / 3;
  const min = [0, 1, 2].map(c => Math.min(...b.pos.filter((_, i) => i % 3 === c)));
  const max = [0, 1, 2].map(c => Math.max(...b.pos.filter((_, i) => i % 3 === c)));
  const POSITION = acc(push(f32(b.pos), 34962), 5126, n, 'VEC3', { min, max });
  const NORMAL = acc(push(f32(b.nrm), 34962), 5126, n, 'VEC3');
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { joints[i * 4] = b.joint[i]!; weights[i * 4] = 1; }
  const JOINTS_0 = acc(push(Buffer.from(joints.buffer), 34962), 5123, n, 'VEC4');
  const WEIGHTS_0 = acc(push(Buffer.from(weights.buffer), 34962), 5126, n, 'VEC4');
  const indices = acc(push(Buffer.from(new Uint32Array(b.idx).buffer), 34963), 5125, b.idx.length, 'SCALAR');
  const COLOR_0 = b.hasVcol ? acc(push(f32(b.vcol), 34962), 5126, n, 'VEC3') : undefined;
  materials.push({ name: mname, pbrMetallicRoughness: { baseColorFactor: b.color, metallicFactor: 0.7, roughnessFactor: 0.3 } });
  primitives.push({ attributes: { POSITION, NORMAL, JOINTS_0, WEIGHTS_0, ...(COLOR_0 !== undefined ? { COLOR_0 } : {}) }, indices, material: materials.length - 1 });
}
const ibm: number[] = [];
for (const k of order) { const h = heads.get(k)!; ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -h[0], -h[1], -h[2], 1); }
const inverseBindMatrices = acc(push(f32(ibm)), 5126, order.length, 'MAT4');
const nodes: object[] = [{ name: 'mesh', mesh: 0, skin: 0 }];
for (const k of order) {
  const h = heads.get(k)!, p = parentOf.get(k), ph = p ? heads.get(p)! : [0, 0, 0];
  nodes.push({ name: k, translation: [h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]],
    children: order.filter(c => parentOf.get(c) === k).map(c => 1 + jointIndex.get(c)!) });
}
for (const n of nodes as { children?: number[] }[]) if (n.children?.length === 0) delete n.children;
const roots = order.filter(k => !parentOf.get(k)).map(k => 1 + jointIndex.get(k)!);
const gltf = {
  asset: { version: '2.0', generator: `blud scripts/blender-kit.ts (${name})` },
  scene: 0, scenes: [{ nodes: [0, ...roots] }],
  nodes,
  meshes: [{ primitives }],
  skins: [{ joints: order.map(k => 1 + jointIndex.get(k)!), inverseBindMatrices, skeleton: roots[0] }],
  materials,
  buffers: [{ byteLength: offset, uri: `data:application/octet-stream;base64,${Buffer.concat(chunks).toString('base64')}` }],
  bufferViews, accessors,
};
writeFileSync(outPath, JSON.stringify(gltf));
const tris = [...batches.values()].reduce((s, b) => s + b.idx.length / 3, 0);
console.log(`blender-kit: ${parts} parts, ${batches.size} materials (${[...batches.keys()].join(', ')}), ${tris} tris -> ${outPath}`);
