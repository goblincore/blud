import { it } from 'vitest';
import src from './gnasher.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';

const doc = parseBlob(src);
const b = buildBody(compileBlob(doc, compileFace(doc)));

it('probe', () => {
  console.log('ERRORS', b.errors);
  for (const c of b.clusters) {
    const ps = b.prims.slice(c.start, c.start + c.count);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const p of ps) {
      for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
        mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
      }
    }
    console.log(`CLUSTER ${c.limb} n=${c.count} bounds mn=[${mn.map(v => v.toFixed(3))}] mx=[${mx.map(v => v.toFixed(3))}]`);
  }
  console.log('--- HEAD PRIMS (index, anchor, tip, r, scale, color) ---');
  const h = b.clusters.find(c => c.limb === 'head')!;
  b.prims.slice(h.start, h.start + h.count).forEach((p, i) => {
    console.log(`${i} a=[${p.a.map(v => v.toFixed(3))}] b=[${p.b.map(v => v.toFixed(3))}] r=${p.radius.toFixed(3)} sc=[${p.scale.map(v => v.toFixed(2))}] col=${p.color ? p.color.map(v => v.toFixed(2)) : '-'} glow=${p.glow ?? 0}`);
  });
  console.log('--- BONES ---');
  for (const [n, bo] of b.bones) console.log(n, `head=[${bo.head.map(v => v.toFixed(3))}] tail=[${bo.tail.map(v => v.toFixed(3))}]`);
});
