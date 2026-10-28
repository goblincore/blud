// scripts/lib/kit-merge.mjs
//
// The shared half of the post-WAM kit merges (scripts/merge-kit-teeth.mjs, scripts/merge-kit-hands.mjs): read a glb's
// meshes with their world transforms, strip a previous merge of one material out of a WAM kit, and append one skinned
// primitive with its OWN accessors. Every merge leaves WAM's shared vertex buffer byte-for-byte where it is; see the
// header of merge-kit-teeth.mjs for why.
import { readFileSync } from 'node:fs';

export const FLOAT = 5126, USHORT = 5123, UINT = 5125;
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const ARRAY = 34962, ELEMENT = 34963;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4x4 product A * B. */
export const mul = (A, B) => {
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k];
  return C;
};

/** Load a WAM kit glTF: its JSON, its one embedded buffer, and mesh 0. */
export function readKit(kitPath, die) {
  const kit = JSON.parse(readFileSync(kitPath, 'utf8'));
  if (kit.buffers?.length !== 1 || !kit.buffers[0].uri?.startsWith('data:')) die('expected one embedded (data URI) buffer in the kit');
  return { kit, bin: Buffer.from(kit.buffers[0].uri.split(',', 2)[1], 'base64'), mesh: kit.meshes[0] };
}

/**
 * Remove a previous merge's `material` primitive (and its material, accessors and bufferViews, which are the trailing ones
 * a merge appends). Returns the trimmed buffer. Refuses a primitive that shares the armour's vertex buffer (a WAM-built
 * part, not a merge) and anything that is not the trailing block, rather than guess.
 */
export function stripMerged(kit, bin, material, die, wamHint) {
  const mesh = kit.meshes[0];
  const mi = kit.materials.findIndex((m) => m.name === material);
  if (mi < 0) return bin;
  const prims = mesh.primitives.filter((p) => p.material === mi);
  const others = mesh.primitives.filter((p) => p.material !== mi);
  const shared = new Set(others.flatMap((p) => Object.values(p.attributes)));
  if (prims.some((p) => Object.values(p.attributes).some((a) => shared.has(a)))) die(wamHint);
  const accs = new Set(prims.flatMap((p) => [...Object.values(p.attributes), p.indices]));
  const views = new Set([...accs].map((a) => kit.accessors[a].bufferView));
  const firstAcc = Math.min(...accs), firstView = Math.min(...views);
  if (accs.size !== kit.accessors.length - firstAcc || views.size !== kit.bufferViews.length - firstView)
    die(`the existing ${material} primitive is not the trailing accessors/bufferViews a merge appends; refusing to guess`);
  mesh.primitives = others;
  kit.accessors.length = firstAcc;
  const out = bin.subarray(0, kit.bufferViews[firstView].byteOffset);
  kit.bufferViews.length = firstView;
  kit.materials.splice(mi, 1);
  for (const p of mesh.primitives) if (p.material > mi) p.material--;
  return out;
}

/** Index of `bone` in the kit's skin joints. */
export function jointOf(kit, bone, die) {
  const k = kit.skins[0].joints.findIndex((j) => kit.nodes[j].name === bone);
  if (k < 0) die(`the kit's skin has no \`${bone}\` joint`);
  return k;
}

/** Parse a glb: `nodes` (with `world`, the column-major world matrix), `meshes`, `materials`, and readAcc(i) -> rows. */
export function readGlb(path, die) {
  const glb = readFileSync(path);
  if (glb.readUInt32LE(0) !== 0x46546c67) die(`${path} is not a glb`);
  const jsonLen = glb.readUInt32LE(12);
  const g = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
  const readAcc = (i) => {
    const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = NCOMP[a.type], cs = CSIZE[a.componentType];
    const stride = v.byteStride ?? n * cs, base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const get = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5121: (o) => bin.readUInt8(o) }[a.componentType];
    if (!get) die(`unsupported componentType ${a.componentType} in ${path}`);
    if (a.normalized && a.componentType !== FLOAT) die('normalized integer accessors are not supported (export float colours)');
    const out = [];
    for (let k = 0; k < a.count; k++) { const r = []; for (let c = 0; c < n; c++) r.push(get(base + k * stride + c * cs)); out.push(r); }
    return out;
  };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const nodes = g.nodes.map((n) => ({ ...n, world: null }));
  const walk = (i, parent) => { const m = mul(parent, local(g.nodes[i])); nodes[i].world = m; for (const c of g.nodes[i].children ?? []) walk(c, m); };
  for (const i of g.scenes[g.scene ?? 0].nodes) walk(i, IDENTITY);
  return { nodes, meshes: g.meshes, materials: g.materials ?? [], readAcc };
}

/**
 * Append geometry as one new primitive on mesh 0 with its own accessors and a new material at the end of the list. Each
 * vertex: `P` position (kit frame), `N` normal, `C` linear RGB colour (optional: omit for a textured part, whose map is
 * the albedo), `UV` texture coordinates (optional), `J` joint index; weight 1 on that joint. Returns the new buffer and
 * writes it back into the kit's data URI.
 */
export function appendPrimitive(kit, bin, { P, N, C, UV, J, I }, material) {
  const mesh = kit.meshes[0];
  const jointType = kit.accessors[mesh.primitives[0].attributes.JOINTS_0].componentType;
  const chunks = [];
  let offset = bin.length;
  const pad4 = () => { const p = (4 - (offset % 4)) % 4; if (p) { chunks.push(Buffer.alloc(p)); offset += p; } };
  const addAccessor = (data, componentType, type, target, minmax = false) => {
    pad4();
    const cs = CSIZE[componentType], n = NCOMP[type], buf = Buffer.alloc(data.length * cs);
    data.forEach((v, k) => {
      if (componentType === FLOAT) buf.writeFloatLE(v, k * 4);
      else if (componentType === UINT) buf.writeUInt32LE(v, k * 4);
      else if (componentType === USHORT) buf.writeUInt16LE(v, k * 2);
      else buf.writeUInt8(v, k);
    });
    kit.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    chunks.push(buf); offset += buf.length;
    const acc = { bufferView: kit.bufferViews.length - 1, componentType, count: data.length / n, type };
    if (minmax) {
      // min/max of the values AS STORED (float32), as glTF requires
      const f = Float32Array.from(data);
      acc.min = [0, 1, 2].map((c) => Math.min(...f.filter((_, k) => k % 3 === c)));
      acc.max = [0, 1, 2].map((c) => Math.max(...f.filter((_, k) => k % 3 === c)));
    }
    kit.accessors.push(acc);
    return kit.accessors.length - 1;
  };
  const joints = J.flatMap((j) => [j, 0, 0, 0]);
  const weights = J.flatMap(() => [1, 0, 0, 0]);
  const attributes = {
    POSITION: addAccessor(P, FLOAT, 'VEC3', ARRAY, true),
    NORMAL: addAccessor(N, FLOAT, 'VEC3', ARRAY),
    ...(C ? { COLOR_0: addAccessor(C, FLOAT, 'VEC3', ARRAY) } : {}),
    ...(UV ? { TEXCOORD_0: addAccessor(UV, FLOAT, 'VEC2', ARRAY) } : {}),
    JOINTS_0: addAccessor(joints, jointType, 'VEC4', ARRAY),
    WEIGHTS_0: addAccessor(weights, FLOAT, 'VEC4', ARRAY),
  };
  const indices = addAccessor(I, UINT, 'SCALAR', ELEMENT);
  kit.materials.push(material);
  mesh.primitives.push({ attributes, indices, material: kit.materials.length - 1 });
  pad4();
  const out = Buffer.concat([bin, ...chunks]);
  const prefix = kit.buffers[0].uri.split(',', 1)[0];
  kit.buffers[0] = { ...kit.buffers[0], byteLength: out.length, uri: `${prefix},${out.toString('base64')}` };
  return out;
}
