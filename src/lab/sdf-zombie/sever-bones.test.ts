import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { severDistal } from './sever';
import { chainOrder } from './connectivity';
import { dot, sub } from './vec';
import src from './characters/zombie.blob?raw';

describe('severDistal splits bones at the cut (bone tubes)', () => {
  const body = buildBody(compileBlob(parseBlob(src)));
  const cluster = body.clusters.find(c => c.limb === 'armL')!;
  const torso = body.clusters.find(c => c.limb === 'torso')!;
  const order = chainOrder(body, cluster, torso.center);
  const cut = { limb: 'armL' as const, fromPrim: order[1]! };
  const r = severDistal(body, cut);
  const joint = r.chunk.tornAt[0]!;
  const ci = body.clusters.indexOf(cluster);
  const distalFirst = body.prims[order[1]!]!;
  const dc = [(distalFirst.a[0] + distalFirst.b[0]) / 2, (distalFirst.a[1] + distalFirst.b[1]) / 2, (distalFirst.a[2] + distalFirst.b[2]) / 2] as const;
  const n = sub(dc, joint);

  it('no live body bone of the cut limb reaches past the cut plane', () => {
    for (const b of r.body.bonePrims ?? []) {
      if (b.cluster !== ci || b.dead) continue;
      expect(dot(sub(b.a, joint), n)).toBeLessThanOrEqual(1e-6);
      expect(dot(sub(b.b, joint), n)).toBeLessThanOrEqual(1e-6);
    }
  });
  it('the chunk carries the distal bone pieces, all live, none reaching back past the plane', () => {
    expect(r.chunk.bones.length).toBeGreaterThan(0);
    for (const b of r.chunk.bones) {
      expect(b.dead).toBe(false);
      expect(dot(sub(b.a, joint), n)).toBeGreaterThanOrEqual(-1e-6);
      expect(dot(sub(b.b, joint), n)).toBeGreaterThanOrEqual(-1e-6);
    }
  });
  it('bone material is conserved: body live count + chunk count >= original live count of the limb', () => {
    const before = (body.bonePrims ?? []).filter(b => b.cluster === ci && !b.dead).length;
    const after = (r.body.bonePrims ?? []).filter(b => b.cluster === ci && !b.dead).length + r.chunk.bones.length;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
