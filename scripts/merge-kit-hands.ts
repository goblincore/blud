// scripts/merge-kit-hands.ts
//
// Merge the goblin's BONY HANDS into a WAM-compiled kit glTF, so the third-person goblin wears the same hand the player
// sees in first person (owner, 2026-10-24: "bony skinny long fingers", stylised, replacing the orb):
//
//   npx tsx scripts/merge-kit-hands.ts <character> <kit.gltf> [hands.glb] [out.gltf]
//     default hands.glb: assets-source/goblin-hands/goblin-hands.glb (written by scripts/model_goblin_arm.py)
//   (scripts/build-wam-kit.sh goblin runs it after WAM)
//
// ONE HAND, TWO VIEWS. The source is the FPV arm script's own hand (model_goblin_arm.py build_hand) in its RELAXED pose,
// exported as `kithand_L` / `kithand_R` -- the FPV hands themselves took job-specific poses (a fist, a fore-end
// cradle). Change the hand in model_goblin_arm.py, re-run it, re-run this, and both views move together. Each hand rides its `hand.l`
// / `hand.r` joint, weight 1, as two primitives appended by scripts/lib/kit-merge.mjs: `goblinskin` (the Skin faces,
// with the FPV mesh's UVs, which kit-overlay.ts dresses in the FPV arm's own generated skin maps) and `goblinclaw` (the
// Claw faces, vertex colour = horn). WAM's buffer is untouched, and re-running strips the previous merge first (same
// inputs, same bytes).
//
// THE FRAME. The FPV hand is authored with its origin at the palm centre, glTF +Y toward the elbow, dorsal +Z, the thumb
// on +X for the right hand (the left is a true mirror, thumb on -X). In the .blob's rest pose the arms hang: the hand
// bone runs DOWN, so the palm faces the thigh, the back of the hand faces OUT and the thumb points FORWARD. So, per
// side: +Y -> up the hand bone (tail to head), the thumb axis -> +Z (forward, orthogonalised against the bone), and +Z
// (dorsal) is their cross product, which comes out lateral on both sides. The palm centre sits HAND_AT along the
// bone (where the orb's centre was) and the whole hand is scaled by HAND_SCALE: the .blob's `scale` (1.30) makes the
// third-person goblin bigger than the FPV arm's metres.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
// @ts-expect-error -- plain .mjs helper, no types
import { readKit, stripMerged, jointOf, readGlb, appendPrimitive } from './lib/kit-merge.mjs';

type V3 = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, kitPath, glbArg, outArg] = process.argv.slice(2);
if (!name || !kitPath) {
  console.error('usage: merge-kit-hands.ts <character> <kit.gltf> [hands.glb] [out.gltf]');
  process.exit(2);
}
const glbPath = glbArg ?? resolve(ROOT, 'assets-source/goblin-hands/goblin-hands.glb');
const outPath = outArg ?? kitPath;
const die = (m: string): never => { console.error(`merge-kit-hands: ${m}`); process.exit(1); };

/** Where the palm centre sits along the hand bone (the orb's old `at`). */
const HAND_AT = 0.55;
/** FPV metres -> this character's. The third-person orb was 0.120 m across and read as "big grabby hands"; at the
 *  FPV hand's original size (fist ~0.095 m) 1.6 filled the bracer's cuff. The FPV hand has since grown by
 *  model_goblin_arm.py's HAND_SIZE (1.4) for the gun view, so the third-person size stays where it was: 1.6 / 1.4. */
const HAND_SCALE = 1.6 / 1.4;
/** Horn, for the Claw faces: model_goblin_arm.py's Claw base colour. */
const CLAW_RGB: V3 = [0.30, 0.25, 0.15];

const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${name}.blob`), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const { kit, bin: bin0 } = readKit(kitPath, die);
// Claws were appended after the skin, so they are stripped first (each strip takes only the trailing block).
const reserved = (m: string) => `${kitPath} has a WAM-built \`${m}\` primitive; that name is reserved for this merge`;
const bin = stripMerged(kit, stripMerged(kit, bin0, 'goblinclaw', die, reserved('goblinclaw')), 'goblinskin', die, reserved('goblinskin'));
const g = readGlb(glbPath, die);

type Part = { P: number[]; N: number[]; C?: number[]; UV?: number[]; J: number[]; I: number[] };
const skin: Part = { P: [], N: [], UV: [], J: [], I: [] };
const claw: Part = { P: [], N: [], C: [], J: [], I: [] };
for (const [side, node, thumbSign] of [['l', 'kithand_L', -1], ['r', 'kithand_R', +1]] as const) {
  const bone = (built.bones as Map<string, { head: V3; tail: V3 }>).get(`hand.${side}`) ?? die(`${name} has no hand.${side} bone`);
  const up = norm(sub(bone.head, bone.tail));
  const fwd0: V3 = [0, 0, 1];
  const fwd = norm(sub(fwd0, up.map((u) => u * dot(fwd0, up)) as V3));
  // Images of the FPV hand's local axes: X (thumb side, sign per hand), Y (toward the elbow), Z = X x Y.
  const ex = fwd.map((f) => f * thumbSign) as V3, ey = up, ez = cross(ex, ey);
  const centre = bone.head.map((h, k) => h + (bone.tail[k] - h) * HAND_AT) as V3;
  const joint = jointOf(kit, `hand.${side}`, die);
  const ni = g.nodes.findIndex((n: { name?: string }) => n.name === node);
  if (ni < 0 || g.nodes[ni].mesh == null) die(`${glbPath} has no \`${node}\` mesh`);
  const M = g.nodes[ni].world as number[];
  for (const prim of g.meshes[g.nodes[ni].mesh].primitives) {
    if ((prim.mode ?? 4) !== 4) die(`${node}: only triangle primitives`);
    const mat = String(g.materials[prim.material]?.name ?? '').split('.')[0];
    const out = mat === 'Skin' ? skin : mat === 'Claw' ? claw : die(`${node}: unexpected material ${mat}`);
    const pos = g.readAcc(prim.attributes.POSITION) as V3[], nrm = g.readAcc(prim.attributes.NORMAL) as V3[];
    if (out.UV && prim.attributes.TEXCOORD_0 == null) die(`${node}: Skin faces without UVs (the skin maps need them)`);
    const uv = out.UV ? g.readAcc(prim.attributes.TEXCOORD_0) as number[][] : null;
    const idx = prim.indices != null ? (g.readAcc(prim.indices) as number[][]).map((r) => r[0]) : pos.map((_, k) => k);
    const base = out.P.length / 3;
    for (let k = 0; k < pos.length; k++) {
      // Through the node's own world matrix (identity in the arm asset), then into the rest frame.
      const [x0, y0, z0] = pos[k];
      const x = M[0] * x0 + M[4] * y0 + M[8] * z0 + M[12], y = M[1] * x0 + M[5] * y0 + M[9] * z0 + M[13], z = M[2] * x0 + M[6] * y0 + M[10] * z0 + M[14];
      for (let c = 0; c < 3; c++) out.P.push(centre[c] + HAND_SCALE * (ex[c] * x + ey[c] * y + ez[c] * z));
      const [a, b, cc] = nrm[k];
      out.N.push(...norm([ex[0] * a + ey[0] * b + ez[0] * cc, ex[1] * a + ey[1] * b + ez[1] * cc, ex[2] * a + ey[2] * b + ez[2] * cc]));
      // v (along the part, in metres per tile) scales with the hand, so one tile of the skin maps covers the same world
      // size as on the FPV arm. u is the angle AROUND the part (cyl_uv): scaling it would break the wrap seam.
      if (uv) out.UV!.push(uv[k][0], uv[k][1] * HAND_SCALE);
      out.C?.push(...CLAW_RGB);
      out.J.push(joint);
    }
    for (const i of idx) out.I.push(base + i);
  }
}

let b = appendPrimitive(kit, bin, skin,
  { name: 'goblinskin', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.42 } });
b = appendPrimitive(kit, b, claw,
  { name: 'goblinclaw', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.28 } });
writeFileSync(outPath, JSON.stringify(kit));
const tris = (skin.I.length + claw.I.length) / 3;
console.log(`merged both hands (${(skin.P.length + claw.P.length) / 3} vertices, ${tris} triangles) into ${outPath}`);
