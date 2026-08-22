// SCRATCH probe — delete before commit.
import { describe, it } from 'vitest';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

describe('scratch probe', () => {
  it('prints world geometry', () => {
    const b = built();
    for (const [name, bone] of b.bones) {
      console.log(`bone ${name.padEnd(12)} head (${bone.head.map(v => v.toFixed(3)).join(', ')}) tail (${bone.tail.map(v => v.toFixed(3)).join(', ')})`);
    }
    b.prims.forEach((p, i) => {
      console.log(
        `prim ${String(i).padStart(3)} ${String(p.limb).padEnd(6)} a=(${p.a.map(v => v.toFixed(3)).join(', ')}) b=(${p.b.map(v => v.toFixed(3)).join(', ')}) r=${p.radius.toFixed(3)} r2=${(p.radiusB ?? p.radius).toFixed(3)} sc=${p.scale.map(v => v.toFixed(2)).join(',')} op=${p.op ?? 'add'}`);
    });
  });
});

describe('scratch numbers', () => {
  it('prints daylight/clearOf', () => {
    const b = built();
    const limb = (l: string) => b.clusters.find(c => c.limb === l)!;
    for (const arm of ['armL', 'armR'] as const) {
      const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
      console.log(`${arm} daylight(elbow-below, join r=0.095)`, daylightOf(b, limb(arm), limb('torso'), shoulder, 0.095).toFixed(4));
      console.log(`${arm} daylight(whole, join r=0.05)`, daylightOf(b, limb(arm), limb('torso'), shoulder, 0.05).toFixed(4));
      console.log(`${arm} fused`, fusedOf(b, limb(arm), limb('torso')).toFixed(4));
    }
    console.log('clear armL/legL', clearOf(b, limb('armL'), limb('legL')).toFixed(4));
    console.log('clear armR/legR', clearOf(b, limb('armR'), limb('legR')).toFixed(4));
    console.log('stance', checkStance(b.bones, doc.stance));
  });
});
