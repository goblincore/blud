import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { bindRig } from './rig-bind';
import src from './characters/zombie.blob?raw';

describe('bone prim binding (bone tubes)', () => {
  const body = buildBody(compileBlob(parseBlob(src)));
  const bound = bindRig(body);
  it('torso and head bones are rigid: both ends on ONE joint', () => {
    body.bonePrims.forEach((b, i) => {
      if (b.limb !== 'torso' && b.limb !== 'head') return;
      const bb = bound.boneBinding[i]!;
      expect(bb.a.point, `bone ${i} ${b.limb}`).toBe(bb.b.point);
    });
  });
  it('limb bones may still span two joints (upper arm shoulder -> elbow)', () => {
    const spans = body.bonePrims.filter((b, i) => b.limb.startsWith('arm') && bound.boneBinding[i]!.a.point !== bound.boneBinding[i]!.b.point);
    expect(spans.length).toBeGreaterThan(0);
  });
  it('rest pose round-trips: offsets reproduce the authored endpoints', () => {
    const pts = bound.rig.points;
    body.bonePrims.forEach((b, i) => {
      const bb = bound.boneBinding[i]!;
      const pa = pts[bb.a.point]!.pos, pb = pts[bb.b.point]!.pos;
      for (let k = 0; k < 3; k++) {
        expect(pa[k]! + bb.a.offset[k]!).toBeCloseTo(b.a[k]!, 6);
        expect(pb[k]! + bb.b.offset[k]!).toBeCloseTo(b.b[k]!, 6);
      }
    });
  });
});
