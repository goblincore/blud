import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';

const name = process.argv[2] ?? 'bloatmaw';
const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
const b = buildBody(compileBlob(doc, compileFace(doc)));
console.log('=== clusters ===');
for (const c of b.clusters) {
  console.log(`limb=${c.limb.padEnd(6)} id=${c.id} start=${c.start} count=${c.count} center=(${c.center.map(v=>v.toFixed(2))}) r=${c.radius.toFixed(2)} alive=${c.alive}`);
}
console.log('=== prims ===');
b.prims.forEach((p, i) => {
  const color = p.color ? `[${p.color.map(v=>v.toFixed(2))}]` : 'none';
  const glow = p.glow ?? 0;
  const bone = p.bone ?? '-';
  console.log(`${i} limb=${p.limb.padEnd(6)} op=${p.op??'add'} r=${p.radius.toFixed(3)} scale=(${p.scale.map(v=>v.toFixed(2))}) a=(${p.a.map(v=>v.toFixed(2))}) b=(${p.b.map(v=>v.toFixed(2))}) bone=${bone} color=${color} glow=${glow} core=${!!p.core}`);
});
console.log('=== errors ===');
console.log(b.errors);
