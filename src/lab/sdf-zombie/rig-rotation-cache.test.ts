import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { applyRig, bindRig } from './rig-bind';
import { segmentQuat } from './rig-frames';
import { add, normalize, qRotate, sub } from './vec';
import zombie from './characters/zombie.blob?raw';

describe('shared segment rotations', () => {
  it('matches independent per-bone transforms after pose/yaw changes and with different rest directions', () => {
    const body = buildBody(compileBlob(parseBlob(zombie)));
    const bound = bindRig(body);
    const first = [...bound.boneFrames.entries()][0]!;
    const shared = [...bound.boneFrames.entries()].filter(([, f]) => f.head === first[1].head && f.tail === first[1].tail);
    expect(shared.length).toBeGreaterThan(1);
    // A custom rest direction on the same rig-point pair must never reuse its
    // neighbour's rotation merely because the point indices match.
    const [idx, frame] = shared[1]!;
    bound.boneFrames.set(idx, { ...frame, restDir: normalize([0.1, 0.9, 0.2]) });
    const before = JSON.stringify(body);
    for (const yaw of [0, 0.7, -1.2, Math.PI]) {
      const points = bound.rig.points.map((p, i) => ({ ...p, pos: add(p.pos, [Math.sin(i + yaw) * 0.04, 0, Math.cos(i + yaw) * 0.04]) }));
      const live = { ...bound, rig: { ...bound.rig, points } };
      const got = applyRig(body, live, yaw);
      for (const [i, f] of live.boneFrames) {
        const h = points[f.head]!.pos;
        const q = segmentQuat(f.restDir, normalize(sub(points[f.tail]!.pos, h)), yaw);
        expect(got.bonePrims[i]!.orient).toEqual(q);
        expect(got.bonePrims[i]!.a).toEqual(add(h, qRotate(q, f.restA)));
        expect(got.bonePrims[i]!.b).toEqual(add(h, qRotate(q, f.restB)));
      }
    }
    expect(JSON.stringify(body)).toBe(before);
  });
});
