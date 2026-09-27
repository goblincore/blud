// scripts/make-warbull-launcher.ts
//
// Build the warbull's GUN-ARM LAUNCHER as a .glb (no Blender; the glTF writer
// is make-juggernaut-chaingun.ts's):
//
//   npx tsx scripts/make-warbull-launcher.ts
//     -> public/assets/lab/warbull-launcher.glb
//
// WHAT IT IS: not a gun he holds but a housing his right fist is locked INTO,
// the machine end of his arm (spec 2026-09-27-warbull-design.md). A boxy
// chrome-and-iron casing swallows the fist and the lower forearm; a
// three-tube rotary cluster rides on top of it and indexes one tube per
// rocket. The kit's gun-arm sleeve (warbull-kit.wam) runs down the forearm
// INTO the back of the casing.
//
// FRAME: the runtime's (carry.ts GUN_GRIP): X right, Y up, Z forward, metres,
// origin on the bore axis. WARBULL_PROFILE.prop.scale (1.6) scales the whole
// prop. The profile's gripReach seats Grip_Hand at the FIST (his hand bone is
// 0.18 m; the fist prim is at its middle), so the casing is built round a fist
// centred on Grip_Hand: his fist is r ~0.11 m = 0.069 prop-local, his forearm
// r ~0.12 m = 0.075, running back along -Z from 0.05 behind the grip.
//
// LOCATORS (empties under GunRoot, like the other guns):
//   Grip_Hand  (0, -0.074, -0.074)  GUN_GRIP.gripHand: inside the casing.
//   Muzzle     (0,  0,      0.410)  GUN_GRIP.muzzle: the live tube's mouth
//              is on the bore axis, which the cluster turns about.
//   Fore_Hand  (0,  0.060, -0.074)  unused (the carry is one-handed); present
//              because every held prop carries the three.
//
// INDEX: the three tubes, their clamps and the spindle are one node,
// `Barrels`, origin on the bore axis; held-prop.ts rotates it about local Z
// by the actor's barrelSpin, which for the launcher is 2pi/3 per rocket.
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/assets/lab/warbull-launcher.glb');

type V3 = [number, number, number];
interface Prim { pos: number[]; nrm: number[]; idx: number[] }
const prim = (): Prim => ({ pos: [], nrm: [], idx: [] });

function face(p: Prim, vs: V3[]) {
  const [a, b, c] = vs as [V3, V3, V3];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  const base = p.pos.length / 3;
  for (const q of vs) { p.pos.push(...q); p.nrm.push(n[0]! / l, n[1]! / l, n[2]! / l); }
  for (let i = 1; i < vs.length - 1; i++) p.idx.push(base, base + i, base + i + 1);
}
function box(p: Prim, c: V3, s: V3) {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const P = (x: number, y: number, z: number): V3 => [c[0] + x, c[1] + y, c[2] + z];
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
    P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
  for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]])
    face(p, q.map(i => v[i]!));
}
function cylZ(p: Prim, x: number, y: number, r: number, z0: number, z1: number, n = 8, caps = true) {
  const ring = (z: number) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r, z] as V3;
  });
  const A = ring(z0), B = ring(z1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(p, [A[i]!, A[j]!, B[j]!, B[i]!]); }
  if (caps) { face(p, [...A].reverse()); face(p, B); }
}
/** An open tube (the rocket tube's bore): outer wall, inner wall, front lip. */
function tubeZ(p: Prim, x: number, y: number, r: number, rin: number, z0: number, z1: number, n = 8) {
  cylZ(p, x, y, r, z0, z1, n, false);
  const ring = (rr: number, z: number) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr, z] as V3;
  });
  const O = ring(r, z1), I = ring(rin, z1), Ib = ring(rin, z0 + 0.02);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    face(p, [O[i]!, O[j]!, I[j]!, I[i]!]);          // front lip
    face(p, [I[i]!, I[j]!, Ib[j]!, Ib[i]!].reverse() as V3[]); // inner wall
  }
  face(p, Ib);                                      // tube floor, dark
}

// ---- materials ------------------------------------------------------------
// held-prop.ts's env map turns ~0.7 metallic into bright silver in the game;
// chrome sits high on purpose, iron is the dark frame. The LED strip and the
// tube floors carry an emissive factor (the live tubes glow down the bore).
const MATS = [
  { name: 'Launcher | chrome', color: [0.55, 0.56, 0.60], metallic: 0.85, roughness: 0.18 },
  { name: 'Launcher | iron', color: [0.06, 0.06, 0.07], metallic: 0.6, roughness: 0.4 },
  { name: 'Launcher | brass', color: [0.42, 0.29, 0.10], metallic: 0.7, roughness: 0.3 },
  { name: 'Launcher | led', color: [1.0, 0.18, 0.06], metallic: 0.0, roughness: 0.3, emissive: [1.0, 0.12, 0.04] },
];
const body = [prim(), prim(), prim(), prim()];
const barrels = [prim(), prim(), prim(), prim()];
const [chrome, iron, brass, led] = body as [Prim, Prim, Prim, Prim];

// CASING: swallows the fist (centre (0,-0.074,-0.074), r 0.069) and the lower
// forearm (axis y -0.074 back from z -0.12, r 0.075), ~0.02 clear all round.
box(chrome, [0, -0.072, -0.155], [0.19, 0.19, 0.37]);      // z -0.34..0.03, y -0.167..0.023
// Iron armour ribs across the casing, the machined read.
for (const z of [-0.30, -0.22, -0.14]) box(iron, [0, -0.072, z], [0.198, 0.198, 0.022]);
// Brass cuff at the back where the kit's sleeve enters.
box(brass, [0, -0.074, -0.335], [0.176, 0.176, 0.02]);
// Front face plate the tubes leave through.
box(iron, [0, -0.02, 0.035], [0.17, 0.13, 0.02]);
// LED strip down the casing's outer (right, -X) face: the status light.
box(led, [-0.097, -0.06, -0.19], [0.006, 0.02, 0.14]);
box(led, [0.097, -0.06, -0.19], [0.006, 0.02, 0.14]);

// BARRELS node: three tubes on a 0.034 circle round the bore axis, two
// clamps and the spindle. Tube 0 sits at 12 o'clock: the bore axis is the
// cluster's centre, and the muzzle is the cluster's mouth.
const [bChrome, bIron, bBrass, bLed] = barrels as [Prim, Prim, Prim, Prim];
for (let i = 0; i < 3; i++) {
  const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
  const x = Math.cos(a) * 0.034, y = Math.sin(a) * 0.034;
  tubeZ(bIron, x, y, 0.026, 0.019, 0.02, 0.41, 8);
  cylZ(bLed, x, y, 0.0185, 0.395, 0.398, 8);  // the glow at the bottom of the bore
}
cylZ(bChrome, 0, 0, 0.012, 0.02, 0.40, 6);          // spindle
cylZ(bBrass, 0, 0, 0.066, 0.06, 0.085, 10);         // rear clamp
cylZ(bChrome, 0, 0, 0.064, 0.30, 0.325, 10);        // mid clamp
cylZ(bBrass, 0, 0, 0.063, 0.385, 0.40, 10);         // front clamp

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
  { name: 'Launcher', primitives: body.map((p, m) => addPrimitive(p, m)).filter(Boolean) },
  { name: 'Barrels', primitives: barrels.map((p, m) => addPrimitive(p, m)).filter(Boolean) },
];
const gltf = {
  asset: { version: '2.0', generator: 'blud scripts/make-warbull-launcher.ts' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [5] }],
  nodes: [
    { name: 'WarbullLauncher', mesh: 0 },
    { name: 'Barrels', mesh: 1 },
    { name: 'Fore_Hand', translation: [0, 0.060, -0.074] },
    { name: 'Grip_Hand', translation: [0, -0.074, -0.074] },
    { name: 'Muzzle', translation: [0, 0, 0.410] },
    { name: 'GunRoot', children: [0, 1, 2, 3, 4] },
  ],
  meshes,
  materials: MATS.map(m => ({
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metallic, roughnessFactor: m.roughness },
    ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
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
