// The instrument that sees MUSCLE: a front-wall relief map, reference mesh
// against the compiled body, cell by cell across x at each height.
//
//   npm run blob:relief -- minotaur
//   npm run blob:relief -- minotaur --abs          # ref/body absolute z
//   npm run blob:relief -- minotaur --glb path/to/mesh.glb
//   npm run blob:relief -- minotaur --scale 1.56122
//   npm run blob:relief -- minotaur --y 0.92:1.51 --x 0.24     # the trunk
//
// POSE. This compares ABSOLUTE positions, so it is only meaningful where the
// two subjects agree in pose. Every Meshy reference is T-POSED and every
// .blob so far stands in some rest of its own, so in practice that means THE
// TRUNK — and the tool says so rather than letting a -170 mm shin read as a
// sculpting error. Window it with --y and --x.
//
// WHY THIS EXISTS, given blob:depth already exists. All three other tools
// average across x, which is the one axis muscle relief lives on:
//
//   blob:rings    fits a RADIAL AVERAGE per bone — a smooth drum and a
//                 muscled torso of equal girth score identically
//   blob:measure  scores a SILHOUETTE — interior relief has no outline
//   blob:depth    reports a BAND MEDIAN ACROSS x — which averages a pec
//                 split, a sternum dip and a linea alba away by construction
//
// A pec split is a dip at x = 0 flanked by two crowns. It is invisible to a
// median over x and obvious in the profile at that height, so the profile is
// what this prints. On the minotaur it immediately showed that every band
// was the same arch — proudest at the centreline, behind at the flanks —
// i.e. a dome where the mesh is a broad flat-fronted slab. That is a
// CROSS-SECTION error, and it had to be fixed before any muscle was added or
// the result would have been a lumpier wrong drum.
//
// IT READS THE WHOLE MESH. `readRefSkin`'s default drops every vertex whose
// largest single-bone weight is <= 0.5, which is right for per-bone clouds
// and wrong here: the dropped vertices are concentrated at joints and
// blended areas, and on minotaur.glb that left a 0.047 m band at CHEST
// height holding ZERO vertices. So this passes `minDominantWeight: 0` and
// never looks at a vertex's joint at all.
//
// IT COMPARES ABSOLUTE POSITIONS, unlike blob:depth, which re-zeroes each
// subject to its own bounding box. That is the point — "the wall is 40 mm
// too far forward" is an actionable number and a normalised one is not — but
// it means the two subjects must genuinely share a floor and a centreline.
// Both do here: a .blob stands its soles on y = 0 and both are centred on
// x = 0. A reference that does not is out of scope, and `--scale` exists for
// when the derived one is wrong.
//
// EXIT CODES match blob:depth: 0 whenever it RAN however bad the numbers,
// 2 for "did not run".
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';
import { detectRig, refBones, globalScale } from '../src/lab/sdf-zombie/ref-align';
import type { Vec3 } from '../src/lab/sdf-zombie/types';
import { reliefCells, type ReliefCell } from './blob-relief-core';

function fail(msg: string): never { console.error(msg); process.exit(2); }

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['--glb', '--scale', '--y', '--x'];
const value = (flag: string): string | undefined => {
  const a = argv.find((x) => x === flag || x.startsWith(`${flag}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[argv.indexOf(a) + 1];
};
const name = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.some((f) => argv[i - 1] === f))[0];
if (!name) fail('usage: npm run blob:relief -- <character> [--abs] [--y min:max] [--x limit] [--glb <path>] [--scale <n>]');

/** `--y 0.92:1.51` -> [0.92, 1.51]. Absent -> the whole figure. */
function yWindow(): { yMin?: number; yMax?: number } {
  const raw = value('--y');
  if (raw === undefined) return {};
  const [a, b] = raw.split(':');
  const yMin = Number(a), yMax = Number(b);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin)
    fail(`--y wants min:max in body metres, e.g. --y 0.92:1.51 (got "${raw}")`);
  return { yMin, yMax };
}
function xLimit(): number | undefined {
  const raw = value('--x');
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) fail(`--x wants a positive half-width in body metres (got "${raw}")`);
  return n;
}

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
if (!existsSync(blobPath)) fail(`no such character: ${blobPath}`);

function resolveMesh(glbFlag?: string): string {
  if (glbFlag) { if (!existsSync(glbFlag)) fail(`missing: ${glbFlag}`); return glbFlag; }
  const dir = `docs/dev-notes/refs/${name}-mesh`;
  const canonical = `${dir}/${name}.glb`;
  if (existsSync(canonical)) return canonical;
  if (existsSync(dir)) {
    const first = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()[0];
    if (first) { console.error(`warning: ${canonical} is missing; scoring against ${dir}/${first}`); return `${dir}/${first}`; }
  }
  fail(`no reference mesh for ${name}. blob:relief needs a MESH — a reference plate has no surface to probe.`);
}

const body = buildBody(compileBlob(parseBlob(readFileSync(blobPath, 'utf8'))));
const skin = readRefSkin(new Uint8Array(readFileSync(resolveMesh(value('--glb')))), { minDominantWeight: 0 });

let S: number;
const scaleFlag = value('--scale');
if (scaleFlag !== undefined) {
  S = Number(scaleFlag);
  if (!Number.isFinite(S) || S <= 0) fail(`--scale must be a positive number, got "${scaleFlag}"`);
  console.log(`scale ${S.toFixed(5)} (from --scale)`);
} else {
  let rig;
  try { rig = detectRig([...skin.jointWorld.keys()]); }
  catch (e) { fail(`cannot derive a scale: ${(e as Error).message}. Pass --scale.`); }
  const g = globalScale(refBones(skin.jointWorld, rig), body.bones);
  S = g.scale;
  console.log(`scale ${S.toFixed(5)} (median over ${g.n} mapped bones, spread ${g.spreadPct.toFixed(1)}%, worst ${g.worstBone})`);
}

const cells = reliefCells(skin.verts.map((v) => v.position), S, { ...yWindow(), xLimit: xLimit() });
/** March -z from well clear of the body; null when the column misses it. */
function wall(x: number, y: number): number | null {
  let z = 1.5;
  for (let i = 0; i < 240; i++) {
    const d = sdBody([x, y, z] as Vec3, body);
    if (d < 1e-4) return z;
    z -= Math.max(d, 1e-4);
    if (z < -1.5) return null;
  }
  return null;
}

const abs = argv.includes('--abs');
const xs = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
const ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => b - a);
const at = new Map(cells.map((c) => [`${c.x}|${c.y}`, c] as [string, ReliefCell]));

console.log(`\n${name}: FRONT-WALL RELIEF, ${abs ? 'ref/body absolute z (m)' : 'body minus mesh (mm)'}.`);
if (!abs) console.log('Positive = the body sticks out further than the mesh. "." = too few reference verts.');
if (value('--y') === undefined) {
  console.log('NOTE: no --y window, so this covers the WHOLE figure. Absolute positions only\n'
    + '  compare where the two subjects share a pose — with a T-posed reference that is the\n'
    + '  TRUNK. Limb rows below are mostly pose, not sculpt. Try --y 0.92:1.51 --x 0.24.');
}
console.log('');
console.log('   y     |' + xs.map((x) => x.toFixed(2).padStart(abs ? 14 : 7)).join(''));
let n = 0, sum = 0, sig = 0, worst = 0, worstAt = '';
for (const y of ys) {
  const row = xs.map((x) => {
    const c = at.get(`${x}|${y}`);
    if (c === undefined) return '.'.padStart(abs ? 14 : 7);
    const w = wall(x, y);
    if (w === null) return 'miss'.padStart(abs ? 14 : 7);
    if (abs) return `${c.z.toFixed(3)}/${w.toFixed(3)}`.padStart(14);
    const d = (w - c.z) * 1000;
    n++; sum += Math.abs(d); sig += d;
    if (Math.abs(d) > Math.abs(worst)) { worst = d; worstAt = `x ${x.toFixed(2)} y ${y.toFixed(3)}`; }
    return d.toFixed(0).padStart(7);
  });
  console.log(`  ${y.toFixed(3)} |${row.join('')}`);
}
if (!abs && n > 0) {
  console.log(`\nSCORE over ${n} cells: mean |diff| ${(sum / n).toFixed(1)}mm   `
    + `signed ${(sig / n).toFixed(1)}mm   worst ${worst.toFixed(0)}mm at ${worstAt}`);
}
