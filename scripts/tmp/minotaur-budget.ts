// Task 4 budget probe: minotaur prim + cluster counts against the hard
// ceilings (validate.ts:30-31 — MAX_PRIMS 128, MAX_CLUSTERS 6), plus which
// prims carry the new metal bit / glow lane. Run: npx tsx scripts/tmp/minotaur-budget.ts
import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { packBody } from '../../src/lab/sdf-zombie/pack';
import { MAX_PRIMS, MAX_CLUSTERS } from '../../src/lab/sdf-zombie/validate';

const src = readFileSync('src/lab/sdf-zombie/characters/minotaur.blob', 'utf8');
const built = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS);
const p = packBody(built);

console.log(`prims     : ${p.primCount} / ${MAX_PRIMS}`);
console.log(`clusters  : ${p.clusterCount} / ${MAX_CLUSTERS}`);
console.log(`groups    : ${p.groupCount}`);
for (let c = 0; c < p.clusterCount; c++) {
  const start = p.clusterRange[c * 4]!;
  const count = p.clusterRange[c * 4 + 1]!;
  console.log(`  cluster ${c}: prims ${start}..${start + count - 1} (n=${count})`);
}

// prof bit 4 (16) = metal; primColor.w >= 1 = painted; primClip.w = glow
let metal = 0, painted = 0, glow = 0;
for (let i = 0; i < p.primCount; i++) {
  const prof = p.primShape[i * 4 + 1]!;
  if ((prof | 0) & 16) { metal++; console.log(`  metal prim ${i}: prof=${prof | 0}`); }
  if (p.primColor[i * 4 + 3]! >= 1) painted++;
  const g = p.primClip[i * 4 + 3]!;
  if (g > 0) { glow++; console.log(`  glow prim ${i}: primClip.w=${g}`); }
}
console.log(`painted prims: ${painted}, metal prims: ${metal}, glow prims: ${glow}`);
console.log(`bones: ${p.boneCount}`);
