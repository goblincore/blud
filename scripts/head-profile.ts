// Compare a .blob character's HEAD to a reference mesh, by number and by
// picture.
//
//   npx tsx scripts/head-profile.ts mouse
//   npx tsx scripts/head-profile.ts mouse --glb docs/dev-notes/refs/maus-biped/...glb
//
// scripts/silhouette-match.ts scores the whole figure's outline against a flat
// plate. This is the close-up companion: it marches the CENTRELINE of both the
// built body and the reference .glb and prints their front and back profiles
// side by side, plus the muzzle's width by height, plus an ASCII front and
// side view of the head.
//
// FRAMES ARE ALIGNED ON THE TORSO, NOT ASSUMED SHARED. The reference mesh's
// whole figure sits at z -0.067 in its own file — its torso centre, not just
// its head — and the first version of this tool compared absolute z. It read
// the cranium as 65 mm too far forward, the neck was leaned back 40 degrees
// to "fix" it, and the head ended up 65 mm behind the body. Relative to the
// torso front the old head had been right all along. The mesh is now shifted
// by (our torso z-centre - its torso z-centre) before any z is compared, and
// the shift is printed so a surprising value is visible.
//
// WHY THE PICTURES ARE NOT OPTIONAL. Every wrong turn on the mouse's head came
// from optimising a number that was true while the shape was wrong: a front
// profile fitted to 9 mm of the mesh had a hole behind the frontmost surface,
// because "where does the ray first hit" cannot see anything further in. The
// ASCII views cost nothing and would have shown it immediately.
import { readFileSync, existsSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import { parseGlb, gltfTriangles } from '../src/lab/sdf-zombie/silhouette';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'mouse';
const glbArg = args.indexOf('--glb');
const GLB = glbArg >= 0 ? args[glbArg + 1]! :
  'docs/dev-notes/refs/maus-biped/Meshy_AI_maus_biped_Character_output.glb';

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
const src = readFileSync(blobPath, 'utf8');
const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
console.log(`${name}: ${body.errors.length ? 'BUILD ERRORS ' + body.errors.join('; ') : 'builds clean'}`);

/** Frontmost and backmost surface on the centreline at height y. */
function ours(y: number): { front: number; back: number; spans: number } {
  let front = NaN, back = NaN, spans = 0, prev = false;
  for (let z = -0.45; z <= 0.55; z += 0.001) {
    const inside = sdBody([0, y, z], body) < 0;
    if (inside && !prev) { spans++; if (Number.isNaN(back)) back = z; }
    if (inside) front = z;
    prev = inside;
  }
  return { front, back, spans };
}

// Reference, scaled so its standing height matches ours.
let refAt: ((y: number) => { front: number; back: number; halfW: number }) | null = null;
let SHIFT_FOR_PLAN = 0;
if (existsSync(GLB)) {
  const { json, bin } = parseGlb(readFileSync(GLB));
  const tri = gltfTriangles(json as never, bin);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < tri.length; i += 3) { lo = Math.min(lo, tri[i]!); hi = Math.max(hi, tri[i]!); }
  const S = (doc.height ?? 1.1) / (hi - lo);
  // Torso z-centre of each, over y 0.30..0.46 on the centreline — below the
  // arms and above the hips on every humanoid we have.
  const torsoCentre = (sample: (y: number) => [number, number]): number => {
    let acc = 0, n = 0;
    for (let y = 0.30; y <= 0.46; y += 0.04) { const [f, b] = sample(y); if (Number.isFinite(f) && Number.isFinite(b)) { acc += (f + b) / 2; n++; } }
    return n ? acc / n : 0;
  };
  const meshTorso = torsoCentre((y) => {
    const yr = y / S; let f = -Infinity, b = Infinity;
    for (let i = 0; i < tri.length; i += 3) {
      if (Math.abs(tri[i + 1]! - yr) > 0.012 || Math.abs(tri[i]!) * S > 0.02) continue;
      const z = tri[i + 2]! * S; f = Math.max(f, z); b = Math.min(b, z);
    }
    return [f, b];
  });
  const ourTorso = torsoCentre((y) => {
    let f = -Infinity, b = Infinity;
    for (let z = -0.4; z <= 0.4; z += 0.002) if (sdBody([0, y, z], body) < 0) { f = Math.max(f, z); b = Math.min(b, z); }
    return [f, b];
  });
  const SHIFT = ourTorso - meshTorso;
  SHIFT_FOR_PLAN = SHIFT;
  refAt = (y: number) => {
    const yr = y / S;
    let front = -Infinity, back = Infinity, halfW = 0;
    for (let i = 0; i < tri.length; i += 3) {
      if (Math.abs(tri[i + 1]! - yr) > 0.012) continue;
      const z = tri[i + 2]! * S + SHIFT;
      if (z > 0.05) halfW = Math.max(halfW, Math.abs(tri[i]!) * S);
      if (Math.abs(tri[i]!) * S > 0.02) continue;
      front = Math.max(front, z); back = Math.min(back, z);
    }
    return { front, back, halfW };
  };
  console.log(`reference ${GLB.split('/').pop()} scaled x${S.toFixed(4)} to ${(doc.height ?? 1.1).toFixed(2)} m`);
  console.log(`frame: mesh torso centre z ${meshTorso.toFixed(3)}, ours ${ourTorso.toFixed(3)} -> mesh shifted ${SHIFT >= 0 ? '+' : ''}${SHIFT.toFixed(3)} before comparing z`);
} else {
  console.log(`no reference mesh at ${GLB} — printing ours alone`);
}

const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '   —').padStart(7);
console.log('\n            FRONT z              BACK z            MUZZLE half-width');
console.log('  y      mesh   ours  delta    mesh   ours     mesh   ours    spans');
let worstFront = 0, holes = 0;
for (let y = 0.64; y <= 0.94; y += 0.02) {
  const o = ours(y);
  const r = refAt?.(y);
  // Muzzle width: widest x at this height that still has flesh in front of z 0.05.
  let hw = 0;
  for (let x = 0; x <= 0.20; x += 0.002) {
    let any = false;
    for (let z = 0.05; z <= 0.45; z += 0.004) if (sdBody([x, y, z], body) < 0) { any = true; break; }
    if (any) hw = x;
  }
  const d = r && Number.isFinite(r.front) ? o.front - r.front : NaN;
  if (Number.isFinite(d)) worstFront = Math.max(worstFront, Math.abs(d));
  if (o.spans > 1) holes++;
  console.log(
    `  ${y.toFixed(2)}  ${f(r?.front ?? NaN)}${f(o.front)}${f(d)}  ${f(r?.back ?? NaN)}${f(o.back)}   ` +
    `${f(r?.halfW ?? NaN)}${f(hw)}   ${o.spans}${o.spans > 1 ? '  <-- GAP' : ''}`);
}
console.log(`\nworst front error ${worstFront.toFixed(3)} m      rows with a gap on the centreline: ${holes}`);

// ---- the plan view of the muzzle -----------------------------------------
// Half-width by z at the snout's own height. The front profile cannot see
// whether a muzzle is a cone or a tube; this can.
const PLAN_Y = 0.76;
console.log(`\nmuzzle plan at y ${PLAN_Y.toFixed(2)} — half-width by z band`);
console.log('  z band        mesh    ours');
for (let z0 = 0.02; z0 < 0.20; z0 += 0.03) {
  let hw = 0;
  for (let x = 0; x <= 0.20; x += 0.002) {
    let any = false;
    for (let z = z0; z < z0 + 0.03; z += 0.003) if (sdBody([x, PLAN_Y, z], body) < 0) { any = true; break; }
    if (any) hw = x;
  }
  let ref = NaN;
  if (existsSync(GLB)) {
    const { json, bin } = parseGlb(readFileSync(GLB));
    const tri = gltfTriangles(json as never, bin);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < tri.length; i += 3) { lo = Math.min(lo, tri[i]!); hi = Math.max(hi, tri[i]!); }
    const S = (doc.height ?? 1.1) / (hi - lo);
    ref = 0;
    for (let i = 0; i < tri.length; i += 3) {
      if (Math.abs(tri[i + 1]! * S - PLAN_Y) > 0.015) continue;
      // Same frame alignment as refAt. Recomputed here rather than hoisted
      // so this block stays independent of the one above.
      const z = tri[i + 2]! * S + (refAt ? (SHIFT_FOR_PLAN) : 0);
      if (z < z0 || z >= z0 + 0.03) continue;
      ref = Math.max(ref, Math.abs(tri[i]!) * S);
    }
  }
  console.log(`  ${z0.toFixed(2)}..${(z0 + 0.03).toFixed(2)}   ${f(ref)} ${f(hw)}`);
}

// ---- the pictures -------------------------------------------------------
function view(axis: 'front' | 'side', cols: number, rows: number, y0: number, y1: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const y = y1 - (r / (rows - 1)) * (y1 - y0);
    let line = '';
    for (let c = 0; c < cols; c++) {
      const u = -0.32 + (c / (cols - 1)) * 0.64;
      let hit = false;
      for (let d = 0.5; d > -0.45; d -= 0.004) {
        const p: [number, number, number] = axis === 'front' ? [u, y, d] : [d, y, u];
        if (sdBody(p, body) < 0) { hit = true; break; }
      }
      line += hit ? '#' : '.';
    }
    out.push(line);
  }
  return out;
}
const A = view('front', 46, 26, 0.60, 1.02);
const B = view('side', 46, 26, 0.60, 1.02);
console.log('\n  front' + ' '.repeat(43) + 'side (nose to the RIGHT)');
for (let i = 0; i < A.length; i++) console.log('  ' + A[i] + '   ' + B[i]);
