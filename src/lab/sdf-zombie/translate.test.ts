// src/lab/sdf-zombie/translate.test.ts
import { describe, it, expect } from 'vitest';
import cultistSrc from './characters/cultist.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { translateBody } from './translate';
import { bindRig, applyRig } from './rig-bind';
import { sdBody, sdPrimitive } from './validate';
import type { Vec3 } from './types';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('translateBody', () => {
  it('moves shell clip planes WITH the body: the translated field is the rest field, shifted', () => {
    const off: Vec3 = [5.1, 0, -5.0];
    const moved = translateBody(body, off);
    for (let i = 0; i < body.prims.length; i++) {
      if (!body.prims[i]!.shell) continue;
      // Folds OFF on both sides: the CPU field's fold warp is world-anchored,
      // so wrinkles legitimately differ after a move (1 cm on the skirt). With
      // them off the only thing left to differ is the plane — exactly.
      const flat = (q: typeof body.prims[number]) => ({ ...q, shell: { ...q.shell!, warpAmp: 0 } });
      const p = flat(body.prims[i]!), m = flat(moved.prims[i]!);
      for (const d of [[0, 0, 0.2], [0, 0.1, 0.25], [0.1, -0.1, -0.2], [0, 0.3, 0]] as const) {
        const q: Vec3 = [p.a[0] + d[0], p.a[1] + d[1], p.a[2] + d[2]];
        const qm: Vec3 = [q[0] + off[0], q[1] + off[1], q[2] + off[2]];
        expect(sdPrimitive(qm, m), `prim ${i}`).toBeCloseTo(sdPrimitive(q, p), 9);
      }
    }
  });

  it('the cultist placed in a room keeps his face in the hood opening (the in-game closed-hood bug)', () => {
    const off: Vec3 = [5.1, 0, -5.0];
    const placed = translateBody(body, off);
    const posed = applyRig(placed, bindRig(placed), 0);
    // A ray at his EYE from the front hits the face, not the hood. (Not the
    // centreline: the nose pokes through even a closed hood.)
    let p: Vec3 = [off[0] + 0.031, 1.683, off[2] + 1.2];
    for (let i = 0; i < 300; i++) { const d = sdBody(p, posed); if (d < 1e-4) break; p = [p[0], p[1], p[2] - d]; }
    const hood = posed.prims.findIndex(q => q.shell && q.limb === 'head');
    let best = -1, bd = Infinity;
    posed.prims.forEach((q, i) => { const d = sdPrimitive(p, q); if (d < bd) { bd = d; best = i; } });
    expect(best).not.toBe(hood);
    expect(posed.prims[best]!.limb).toBe('head');
  });
});
