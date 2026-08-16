import { describe, it, expect } from 'vitest';
import { bindRig } from './rig-bind';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { jointNamesForBody } from './gait';
import { len, sub } from './vec';

describe('rig structure inspection', () => {
  it('prints points, constraints, connectivity', () => {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const names = jointNamesForBody(body);
    const pts = bound.rig.points;
    console.log('points:');
    names.forEach((n, i) => console.log(`  ${i} ${n} = [${pts[i]!.pos.map(v => v.toFixed(3))}] pinned=${pts[i]!.pinned}`));
    console.log('constraints:');
    for (const c of bound.rig.constraints) {
      console.log(`  ${names[c.a]}(${c.a}) <-> ${names[c.b]}(${c.b}) rest=${c.rest.toFixed(3)}`);
    }
    // which points is hipL connected to?
    const hi = names.indexOf('hipL');
    const cons = bound.rig.constraints.filter(c => c.a === hi || c.b === hi);
    console.log('hipL constraints:', cons.map(c => `${names[c.a]}<->${names[c.b]}`));
    // hipL to hips distance
    const hips = names.indexOf('hips');
    console.log('hipL->hips dist:', len(sub(pts[hi]!.pos, pts[hips]!.pos)).toFixed(3));
    // rest lengths for ropes
    for (const [a, b] of [['hipL', 'footL'], ['hipR', 'footR'], ['shoulderL', 'handL'], ['shoulderL', 'shoulderR'], ['hipL', 'hipR'], ['pelvis', 'head']] as const) {
      const ia = names.indexOf(a); const ib = names.indexOf(b);
      console.log(`${a}->${b} rest dist:`, len(sub(pts[ia]!.pos, pts[ib]!.pos)).toFixed(3));
    }
    expect(names).toHaveLength(17);
  });
});
