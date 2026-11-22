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
import { writeFileSync } from 'node:fs';
import { readKit, stripMerged, jointOf, readGlb, appendPrimitive } from './lib/kit-merge.mjs';

const [kitPath, teethPath, outPath = kitPath] = process.argv.slice(2);
if (!kitPath || !teethPath) {
  console.error('usage: merge-kit-teeth.mjs <kit.gltf> <teeth.glb> [out.gltf]');
  process.exit(2);
}
const die = (m) => { console.error(`merge-kit-teeth: ${m}`); process.exit(1); };

// ---------- the kit ----------
const { kit, bin: kitBin0 } = readKit(kitPath, die);
const kitBin = stripMerged(kit, kitBin0, 'tooth', die,
  `${kitPath} has WAM-built teeth (a \`tooth\` primitive on the armour's vertex buffer): remove the tooth sweeps from the .wam and rebuild`);
const JOINT = { u: jointOf(kit, 'skull', die), l: jointOf(kit, 'jaw', die) };

// ---------- the teeth glb ----------
const g = readGlb(teethPath, die);
const teeth = g.nodes.map((n, i) => i).filter((i) => /^tooth_[ul]\d+$/.test(g.nodes[i].name ?? '') && g.nodes[i].mesh != null && g.nodes[i].world)
  .sort((a, b) => (g.nodes[a].name < g.nodes[b].name ? -1 : 1));
if (teeth.length === 0) die(`no tooth_u*/tooth_l* mesh nodes in ${teethPath}`);

const P = [], N = [], C = [], J = [], I = [];
for (const ni of teeth) {
  const node = g.nodes[ni], M = node.world, row = node.name[6];
  for (const prim of g.meshes[node.mesh].primitives) {
    if ((prim.mode ?? 4) !== 4) die(`${node.name}: only triangle primitives`);
    const pos = g.readAcc(prim.attributes.POSITION), nrm = g.readAcc(prim.attributes.NORMAL);
    if (prim.attributes.COLOR_0 == null) die(`${node.name}: no COLOR_0 (export vertex colours)`);
    const col = g.readAcc(prim.attributes.COLOR_0);
    const idx = prim.indices != null ? g.readAcc(prim.indices).map((r) => r[0]) : pos.map((_, k) => k);
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
      J.push(JOINT[row]);
    }
    for (const i of idx) I.push(base + i);
  }
}

// ---------- append ----------
appendPrimitive(kit, kitBin, { P, N, C, J, I },
  { name: 'tooth', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.38 } });
writeFileSync(outPath, JSON.stringify(kit));
console.log(`merged ${teeth.length} teeth (${P.length / 3} vertices, ${I.length / 3} triangles; skull joint ${JOINT.u}, jaw joint ${JOINT.l}) into ${outPath}`);
