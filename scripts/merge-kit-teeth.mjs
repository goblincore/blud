#!/usr/bin/env node
// Merge Blender-sculpted teeth into a WAM-compiled kit glTF (goblin expressions Task 17).
//
//   node scripts/merge-kit-teeth.mjs <kit.gltf> <teeth.glb> [out.gltf]
//   (scripts/build-wam-kit.sh goblin-cinematic runs it after WAM: kit = public/assets/lab/goblin-cinematic-kit.gltf,
//    teeth = assets-source/goblin-teeth/goblin-teeth.glb, written by assets-source/goblin-teeth/goblin_teeth.py in Blender)
//
// WHAT IT DOES. WAM writes one skinned mesh: ONE shared vertex buffer (POSITION, NORMAL, JOINTS_0, WEIGHTS_0, TEXCOORD_0) and one
// index list per material, all in one base64 buffer. This script leaves every byte of that buffer where it is and APPENDS the
// teeth: one more primitive on mesh 0 with its OWN accessors (POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0, indices) and a new
// `tooth` material at the end of the material list. So the armour's vertices, normals, skin weights, UVs and atlas are untouched.
//
// THE TEETH. Every mesh node of the glb whose name starts `tooth_` (sorted by name, so the output does not depend on the glb's
// node order): `tooth_u*` rides the `skull` joint, `tooth_l*` the `jaw` joint, weight 1 (JOINTS_0 = [joint,0,0,0], WEIGHTS_0 =
// [1,0,0,0]; the joint index is that bone's index in skins[0].joints). The node's world transform is applied (the generator leaves
// it identity). Positions are taken as they are: the glb is authored in the kit's frame (metres, Y up, +Z forward), which is the
// .blob's rest frame to within the kit's pivot offset (0.04 mm: WAM's skull head vs the .blob's), so a vertex draws where the
// generator put it. COLOR_0 goes through as float RGB (glTF COLOR_0 is linear; three's GLTFLoader turns `vertexColors` on for
// the primitive, and the material's base colour is white, so the vertex colour IS the albedo). No UVs, no texture.
//
// REFUSES (exits 1) if the kit already has a `tooth` material whose primitive shares the armour's vertex buffer: that is a WAM
// build of a .wam that still carries tooth sweeps; take them out of the .wam (it would leave their vertices in the armour buffer).
// A kit already merged by this script (its `tooth` primitive has accessors of its own) is stripped first, so re-running is
// idempotent: same inputs, same bytes.
import { readFileSync, writeFileSync } from 'node:fs';

const [kitPath, teethPath, outPath = kitPath] = process.argv.slice(2);
if (!kitPath || !teethPath) {
  console.error('usage: merge-kit-teeth.mjs <kit.gltf> <teeth.glb> [out.gltf]');
  process.exit(2);
}
const die = (m) => { console.error(`merge-kit-teeth: ${m}`); process.exit(1); };

const FLOAT = 5126, USHORT = 5123, UINT = 5125;
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

// ---------- the kit ----------
const kit = JSON.parse(readFileSync(kitPath, 'utf8'));
if (kit.buffers?.length !== 1 || !kit.buffers[0].uri?.startsWith('data:')) die('expected one embedded (data URI) buffer in the kit');
let kitBin = Buffer.from(kit.buffers[0].uri.split(',', 2)[1], 'base64');
const mesh = kit.meshes[0];
const toothMat = kit.materials.findIndex((m) => m.name === 'tooth');
if (toothMat >= 0) {
  const prims = mesh.primitives.filter((p) => p.material === toothMat);
  const others = mesh.primitives.filter((p) => p.material !== toothMat);
  const shared = new Set(others.flatMap((p) => Object.values(p.attributes)));
  if (prims.some((p) => Object.values(p.attributes).some((a) => shared.has(a))))
    die(`${kitPath} has WAM-built teeth (a \`tooth\` primitive on the armour's vertex buffer): remove the tooth sweeps from the .wam and rebuild`);
  // A previous merge: drop its primitive, material, accessors and bufferViews (they are the trailing ones it appended).
  const accs = new Set(prims.flatMap((p) => [...Object.values(p.attributes), p.indices]));
  const views = new Set([...accs].map((a) => kit.accessors[a].bufferView));
  const firstAcc = Math.min(...accs), firstView = Math.min(...views);
  if (accs.size !== kit.accessors.length - firstAcc || views.size !== kit.bufferViews.length - firstView)
    die('the existing tooth primitive is not the trailing accessors/bufferViews this script appends; refusing to guess');
  mesh.primitives = others;
  kit.accessors.length = firstAcc;
  kitBin = kitBin.subarray(0, kit.bufferViews[firstView].byteOffset);
  kit.bufferViews.length = firstView;
  kit.materials.splice(toothMat, 1);
  for (const p of mesh.primitives) if (p.material > toothMat) p.material--;
}
const skin = kit.skins[0];
const jointOf = (bone) => {
  const k = skin.joints.findIndex((j) => kit.nodes[j].name === bone);
  if (k < 0) die(`the kit's skin has no \`${bone}\` joint`);
  return k;
};
const JOINT = { u: jointOf('skull'), l: jointOf('jaw') };
const jointType = kit.accessors[mesh.primitives[0].attributes.JOINTS_0].componentType;

// ---------- the teeth glb ----------
const glb = readFileSync(teethPath);
if (glb.readUInt32LE(0) !== 0x46546c67) die(`${teethPath} is not a glb`);
const jsonLen = glb.readUInt32LE(12);
const g = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
const readAcc = (i) => {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = NCOMP[a.type], cs = CSIZE[a.componentType];
  const stride = v.byteStride ?? n * cs, base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const get = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5121: (o) => bin.readUInt8(o) }[a.componentType];
  if (!get) die(`unsupported componentType ${a.componentType} in the teeth glb`);
  if (a.normalized && a.componentType !== FLOAT) die('normalized integer accessors are not supported (export float colours)');
  const out = [];
  for (let k = 0; k < a.count; k++) { const r = []; for (let c = 0; c < n; c++) r.push(get(base + k * stride + c * cs)); out.push(r); }
  return out;
};
// World matrices (column-major), parents first.
const mul = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return C; };
const local = (n) => {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
const world = new Map();
const walk = (i, parent) => { const m = mul(parent, local(g.nodes[i])); world.set(i, m); for (const c of g.nodes[i].children ?? []) walk(c, m); };
for (const i of g.scenes[g.scene ?? 0].nodes) walk(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const teeth = [...world.keys()].filter((i) => /^tooth_[ul]\d+$/.test(g.nodes[i].name ?? '') && g.nodes[i].mesh != null)
  .sort((a, b) => (g.nodes[a].name < g.nodes[b].name ? -1 : 1));
if (teeth.length === 0) die(`no tooth_u*/tooth_l* mesh nodes in ${teethPath}`);

const P = [], N = [], C = [], J = [], W = [], I = [];
for (const ni of teeth) {
  const node = g.nodes[ni], M = world.get(ni), row = node.name[6];
  for (const prim of g.meshes[node.mesh].primitives) {
    if ((prim.mode ?? 4) !== 4) die(`${node.name}: only triangle primitives`);
    const pos = readAcc(prim.attributes.POSITION), nrm = readAcc(prim.attributes.NORMAL);
    if (prim.attributes.COLOR_0 == null) die(`${node.name}: no COLOR_0 (export vertex colours)`);
    const col = readAcc(prim.attributes.COLOR_0);
    const idx = prim.indices != null ? readAcc(prim.indices).map((r) => r[0]) : pos.map((_, k) => k);
    const base = P.length / 3;
    for (let k = 0; k < pos.length; k++) {
      const [x, y, z] = pos[k];
      P.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
      // rotation-only part for the normal (the generator's nodes are identity; uniform scale is renormalised)
      const [a, b, c] = nrm[k];
      const nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      N.push(nx / l, ny / l, nz / l);
      C.push(col[k][0], col[k][1], col[k][2]);
      J.push(JOINT[row], 0, 0, 0);
      W.push(1, 0, 0, 0);
    }
    for (const i of idx) I.push(base + i);
  }
}

// ---------- append ----------
const chunks = [];
let offset = kitBin.length;
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
const ARRAY = 34962, ELEMENT = 34963;
const attributes = {
  POSITION: addAccessor(P, FLOAT, 'VEC3', ARRAY, true),
  NORMAL: addAccessor(N, FLOAT, 'VEC3', ARRAY),
  COLOR_0: addAccessor(C, FLOAT, 'VEC3', ARRAY),
  JOINTS_0: addAccessor(J, jointType, 'VEC4', ARRAY),
  WEIGHTS_0: addAccessor(W, FLOAT, 'VEC4', ARRAY),
};
const indices = addAccessor(I, UINT, 'SCALAR', ELEMENT);
kit.materials.push({ name: 'tooth', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.38 } });
mesh.primitives.push({ attributes, indices, material: kit.materials.length - 1 });
pad4();
const out = Buffer.concat([kitBin, ...chunks]);
const prefix = kit.buffers[0].uri.split(',', 1)[0];
kit.buffers[0] = { ...kit.buffers[0], byteLength: out.length, uri: `${prefix},${out.toString('base64')}` };
writeFileSync(outPath, JSON.stringify(kit));
console.log(`merged ${teeth.length} teeth (${P.length / 3} vertices, ${I.length / 3} triangles; skull joint ${JOINT.u}, jaw joint ${JOINT.l}) into ${outPath}`);
