// Scanners head pop (owner 2026-09-24): swell, then shatter from the volume.
import { describe, expect, it } from 'vitest';
import cultistSrc from './characters/cultist.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { headPopDebris, inflateHead, shatterHead, swellScale, SWELL_MAX, EYEBALL_R } from './head-pop';
import { makeRng } from './wander';
import type { Vec3 } from './types';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const head = body.prims.filter(p => p.limb === 'head' && !p.dead);
const centre = (() => {
  let x = 0, y = 0, z = 0;
  for (const p of head) { x += (p.a[0] + p.b[0]) / 2; y += (p.a[1] + p.b[1]) / 2; z += (p.a[2] + p.b[2]) / 2; }
  return [x / head.length, y / head.length, z / head.length] as Vec3;
})();

describe('inflateHead (the swell)', () => {
  it('grows every head prim, accelerating, and leaves the rest alone', () => {
    expect(swellScale(0)).toBe(1);
    expect(swellScale(1)).toBeCloseTo(1 + SWELL_MAX, 9);
    expect(swellScale(0.5) - 1).toBeLessThan((swellScale(1) - 1) / 2);
    const out = inflateHead(body, 1, 0);
    out.prims.forEach((p, i) => {
      const q = body.prims[i]!;
      if (q.limb === 'head' && !q.dead) expect(p.radius).toBeGreaterThan(q.radius * 1.2);
      else expect(p).toBe(q);
    });
    expect(inflateHead(body, 0, 0)).toBe(body);
  });
  it("keeps the hood's opening on the hood: a point on the clip plane stays on it", () => {
    const i = body.prims.findIndex(p => p.limb === 'head' && p.shell);
    const p = body.prims[i]!;
    const q = inflateHead(body, 1, 0).prims[i]!;
    const n = p.shell!.clipNormal;
    // The prim's own midpoint, projected onto its clip plane, then scaled.
    const m: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const off = (n[0] * m[0] + n[1] * m[1] + n[2] * m[2]) - p.shell!.clipOffset;
    const onPlane: Vec3 = [m[0] - n[0] * off, m[1] - n[1] * off, m[2] - n[2] * off];
    const k = q.radius / p.radius;
    const shake: Vec3 = [0, Math.sin(1) * 0.004, Math.sin(2) * 0.006]; // inflateHead's tremor at t 0, u 1
    const mv: Vec3 = [centre[0] + (onPlane[0] - centre[0]) * k + shake[0], centre[1] + (onPlane[1] - centre[1]) * k + shake[1], centre[2] + (onPlane[2] - centre[2]) * k + shake[2]];
    expect(n[0] * mv[0] + n[1] * mv[1] + n[2] * mv[2]).toBeCloseTo(q.shell!.clipOffset, 4); // sub-0.1 mm
  });
});

describe('shatterHead + headPopDebris', () => {
  const swollen = inflateHead(body, 1, 0).prims.filter(p => p.limb === 'head' && !p.dead);
  const pieces = headPopDebris({ origin: centre, prims: swollen }, [0, 0, -1], makeRng(3));
  it('is a handful of flying clumps plus two eyeballs (bounded gib views)', () => {
    const eyes = pieces.filter(p => p.prims[0]!.radius === EYEBALL_R);
    expect(eyes.length).toBe(2);
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    expect(pieces.length).toBeLessThanOrEqual(8);
  });
  it('the head itself flies: its teeth, its hood paint and its skin come apart, plus brain', () => {
    const all = pieces.flatMap(p => p.prims);
    const teeth = head.filter(p => p.color && Math.abs(p.color[0] - 0.27) < 0.05 && p.radius < 0.01);
    expect(all.filter(p => teeth.some(t => t.color === p.color)).length).toBeGreaterThanOrEqual(1);
    const hood = head.find(p => p.shell)!;
    expect(all.filter(p => p.color === hood.color).length).toBeGreaterThanOrEqual(3);
    expect(all.some(p => p.color === undefined)).toBe(true); // skin lumps
    expect(all.some(p => (p.glow ?? 0) > 0 && p.radius > EYEBALL_R * 0.4)).toBe(true); // irises
  });
  it('every clump flies OUT and none is a whole head', () => {
    for (const p of shatterHead({ origin: centre, prims: swollen }, [0, 0, -1], makeRng(9))) {
      expect(Math.hypot(...p.vel)).toBeGreaterThan(2);
      for (const q of p.prims) expect(q.radius * Math.max(...q.scale)).toBeLessThan(0.11);
    }
  });
});
