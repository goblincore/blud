import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { applyRig, bindRig } from './rig-bind';
import { len, sub } from './vec';
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
  it('torso and head bones bind to an AXIAL joint — never a hip or shoulder', () => {
    // A rib hoop's chord midpoint sits at the flank, nearer the hip/shoulder
    // than the spine; hips and shoulders take their own gait offsets, so a
    // rib bound there shears off the cage. Axial joints lie on the centreline.
    const pts = bound.rig.points;
    body.bonePrims.forEach((b, i) => {
      if (b.limb !== 'torso' && b.limb !== 'head') return;
      const j = pts[bound.boneBinding[i]!.a.point]!.pos;
      expect(Math.abs(j[0]), `bone ${i} ${b.limb} bound to joint at x ${j[0]}`).toBeLessThan(1e-6);
    });
  });
  it('the torso skeleton is RIGID with the spine segment: tilting the spine keeps every rib-to-rib distance', () => {
    // Move the chest point 20 degrees forward about the hips point (what a
    // gait lurch does) and re-pose. Every pair of torso bone endpoints on the
    // spine segment must keep its rest distance — one rotation, no shear.
    const spine = body.bones.get('spine')!;
    const pts = bound.rig.points.map(p => ({ ...p, pos: [...p.pos] as [number, number, number] }));
    const hips = pts.findIndex(p => len(sub(p.pos, spine.head)) < 1e-4);
    const chest = pts.findIndex(p => len(sub(p.pos, spine.tail)) < 1e-4);
    expect(hips).toBeGreaterThanOrEqual(0); expect(chest).toBeGreaterThanOrEqual(0);
    const d = sub(spine.tail, spine.head);
    const th = 20 * Math.PI / 180;
    pts[chest]!.pos = [spine.head[0], spine.head[1] + d[1] * Math.cos(th) - d[2] * Math.sin(th), spine.head[2] + d[1] * Math.sin(th) + d[2] * Math.cos(th)];
    const posed = applyRig(body, { ...bound, rig: { ...bound.rig, points: pts } });
    const onSpine = [...bound.boneFrames.entries()].filter(([, f]) => f.head === hips && f.tail === chest).map(([i]) => i);
    expect(onSpine.length).toBeGreaterThan(10);
    for (let x = 0; x < onSpine.length; x++) for (let y = x + 1; y < onSpine.length; y++) {
      const p = body.bonePrims[onSpine[x]!]!, q = body.bonePrims[onSpine[y]!]!;
      const P = posed.bonePrims[onSpine[x]!]!, Q = posed.bonePrims[onSpine[y]!]!;
      expect(len(sub(P.a, Q.b))).toBeCloseTo(len(sub(p.a, q.b)), 6);
      expect(len(sub(P.b, Q.a))).toBeCloseTo(len(sub(p.b, q.a)), 6);
    }
    // And it actually moved: an upper rib's head is no longer at rest.
    const moved = onSpine.filter(i => len(sub(posed.bonePrims[i]!.a, body.bonePrims[i]!.a)) > 0.01);
    expect(moved.length).toBeGreaterThan(0);
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
