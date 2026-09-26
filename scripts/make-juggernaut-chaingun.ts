// scripts/make-juggernaut-chaingun.ts
//
// Build the juggernaut's static, low-poly rotary CHAINGUN as a .glb, with no
// Blender: the other props (model-soldier-shotgun.py, model-cultist-smg.py)
// are Blender scripts, but this one is plain geometry, so it writes glTF
// itself and runs anywhere the repo does:
//
//   npx tsx scripts/make-juggernaut-chaingun.ts
//     -> public/assets/lab/juggernaut-chaingun.glb
//
// FRAME: the runtime's (carry.ts GUN_GRIP): X right, Y up, Z forward, metres,
// origin on the bore axis at the receiver. MotionProfile.prop.scale (1.45)
// scales the whole prop; the numbers below are prop-local.
//
// LOCATORS, all empties under GunRoot like the other guns:
//   Grip_Hand  (0, -0.074, -0.074)  GUN_GRIP.gripHand, the rear pistol grip.
//   Fore_Hand  (0,  0.110,  0.000)  THE TOP CARRY HANDLE, not GUN_GRIP's
//              fore-end. The shared fore-end (0, -0.045, 0.155) is out of the
//              left hand's reach in any hip-fire hold that points the gun
//              ahead (the carry solve in docs/dev-notes/2026-09-25-juggernaut/
//              NOTES.md); the minigun hold is the support hand OVER the gun.
//              JUGGERNAUT_PROFILE.prop.foreHand carries this value to motion.ts.
//   Muzzle     (0, 0, 0.410)        GUN_GRIP.muzzle, the barrel tips.
//
// SPIN: the six barrels, their clamps and the spindle are one node,
// `Barrels`, whose origin is on the bore axis, so rotating it about local Z
// spins the cluster in place (held-prop.ts drives it from chaingun-spin.ts).
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/assets/lab/juggernaut-chaingun.glb');

type V3 = [number, number, number];
interface Prim { pos: number[]; nrm: number[]; idx: number[] }
const prim = (): Prim => ({ pos: [], nrm: [], idx: [] });

/** One flat-shaded quad/triangle fan (the house low-poly look: facets). */
function face(p: Prim, vs: V3[]) {
  const [a, b, c] = vs as [V3, V3, V3];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  const base = p.pos.length / 3;
  for (const q of vs) { p.pos.push(...q); p.nrm.push(n[0]! / l, n[1]! / l, n[2]! / l); }
  for (let i = 1; i < vs.length - 1; i++) p.idx.push(base, base + i, base + i + 1);
}

/** Axis-aligned box, optionally pitched about X through its centre. */
function box(p: Prim, c: V3, s: V3, pitch = 0) {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = (x: number, y: number, z: number): V3 => [c[0] + x, c[1] + y * cp - z * sp, c[2] + y * sp + z * cp];
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
    P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
  for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]])
    face(p, q.map(i => v[i]!));
}

/** Cylinder along Z from z0 to z1, centred at (x, y), `n` facets, capped. */
function cylZ(p: Prim, x: number, y: number, r: number, z0: number, z1: number, n = 8) {
  const ring = (z: number) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r, z] as V3;
  });
  const A = ring(z0), B = ring(z1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(p, [A[i]!, A[j]!, B[j]!, B[i]!]); }
  face(p, [...A].reverse());
  face(p, B);
}

// ---- materials: dark gunmetal, near-black barrels, brass feed ------------
// Half-metallic, like the cultist SMG's blued steel: held-prop.ts's env map
// turns a 0.70 metallic into bright silver in the game.
const MATS = [
  { name: 'Chaingun | gunmetal', color: [0.085, 0.085, 0.095], metallic: 0.45, roughness: 0.45 },
  { name: 'Chaingun | barrels', color: [0.035, 0.035, 0.040], metallic: 0.5, roughness: 0.35 },
  { name: 'Chaingun | brass', color: [0.42, 0.29, 0.10], metallic: 0.6, roughness: 0.35 },
];
const body = [prim(), prim(), prim()];
const barrels = [prim(), prim(), prim()];
const [metal, , brass] = body as [Prim, Prim, Prim];
const [, dark] = barrels as [Prim, Prim, Prim];

// RECEIVER: the boxy housing the barrels spin out of, z -0.16..0.08.
box(metal, [0, 0.005, -0.04], [0.095, 0.090, 0.24]);
// MOTOR: the drive cylinder behind the receiver.
cylZ(metal, 0, 0.005, 0.042, -0.25, -0.16, 8);
// PISTOL GRIP at Grip_Hand, raked back 15 degrees like any pistol grip. The
// fist closes round (0, -0.074, -0.074).
box(metal, [0, -0.074, -0.074], [0.032, 0.095, 0.042], -0.26);
// Trigger guard: a thin loop ahead of the grip.
box(metal, [0, -0.060, -0.030], [0.012, 0.012, 0.050]);
// TOP CARRY HANDLE at Fore_Hand (0, 0.11, 0): two posts and a bar.
box(metal, [0, 0.080, -0.055], [0.018, 0.070, 0.018]);
box(metal, [0, 0.080, 0.055], [0.018, 0.070, 0.018]);
cylZ(metal, 0, 0.110, 0.014, -0.065, 0.065, 8);
// FEED CHUTE: the ammo belt enters on the left of the receiver (the drum is
// on his back, juggernaut-kit.wam); a short brass stub reads as the belt.
box(brass, [0.060, -0.020, -0.060], [0.030, 0.050, 0.070]);
box(brass, [0.075, -0.060, -0.075], [0.025, 0.050, 0.050], 0.35);

// BARRELS node: six barrels on a 0.028 circle, two clamps, the spindle.
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  cylZ(dark, Math.cos(a) * 0.028, Math.sin(a) * 0.028, 0.0105, 0.07, 0.41, 6);
}
cylZ(barrels[0]!, 0, 0, 0.012, 0.07, 0.40, 6);   // spindle, gunmetal
cylZ(barrels[0]!, 0, 0, 0.046, 0.12, 0.145, 8);  // rear clamp
cylZ(barrels[0]!, 0, 0, 0.044, 0.365, 0.385, 8); // front clamp

// ---- glTF assembly -------------------------------------------------------
const chunks: Buffer[] = [];
let byteLength = 0;
const bufferViews: object[] = [];
const accessors: object[] = [];
function addView(data: Buffer, target: number): number {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target });
  chunks.push(data); byteLength += data.length;
  return bufferViews.length - 1;
}
function addPrimitive(p: Prim, material: number) {
  if (!p.idx.length) return null;
  const pos = Buffer.from(new Float32Array(p.pos).buffer), nrm = Buffer.from(new Float32Array(p.nrm).buffer);
  const idx = Buffer.from(new Uint16Array(p.idx).buffer);
  const mn = [0, 1, 2].map(k => Math.min(...p.pos.filter((_, i) => i % 3 === k)));
  const mx = [0, 1, 2].map(k => Math.max(...p.pos.filter((_, i) => i % 3 === k)));
  accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: p.pos.length / 3, type: 'VEC3', min: mn, max: mx });
  const P = accessors.length - 1;
  accessors.push({ bufferView: addView(nrm, 34962), componentType: 5126, count: p.nrm.length / 3, type: 'VEC3' });
  const N = accessors.length - 1;
  accessors.push({ bufferView: addView(idx, 34963), componentType: 5123, count: p.idx.length, type: 'SCALAR' });
  return { attributes: { POSITION: P, NORMAL: N }, indices: accessors.length - 1, material };
}
const meshes = [
  { name: 'Chaingun', primitives: body.map((p, m) => addPrimitive(p, m)).filter(Boolean) },
  { name: 'Barrels', primitives: barrels.map((p, m) => addPrimitive(p, m)).filter(Boolean) },
];
const gltf = {
  asset: { version: '2.0', generator: 'blud scripts/make-juggernaut-chaingun.ts' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [5] }],
  nodes: [
    { name: 'JuggernautChaingun', mesh: 0 },
    { name: 'Barrels', mesh: 1 },
    { name: 'Fore_Hand', translation: [0, 0.110, 0] },
    { name: 'Grip_Hand', translation: [0, -0.074, -0.074] },
    { name: 'Muzzle', translation: [0, 0, 0.410] },
    { name: 'GunRoot', children: [0, 1, 2, 3, 4] },
  ],
  meshes,
  materials: MATS.map(m => ({
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metallic, roughnessFactor: m.roughness },
  })),
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};
const bin = Buffer.concat(chunks);
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const json = Buffer.from(JSON.stringify(gltf));
const jsonPad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(OUT, Buffer.concat([header, ch(jsonPad.length, 0x4e4f534a), jsonPad, ch(binPad.length, 0x004e4942), binPad]));
console.log(`wrote ${OUT} (${12 + 16 + jsonPad.length + binPad.length} bytes)`);
