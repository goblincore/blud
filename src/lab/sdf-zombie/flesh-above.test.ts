// src/lab/sdf-zombie/flesh-above.test.ts
//
// fleshAbove (validate.ts, 2026-10-26) decides `sdBody(p) > t` from an upper
// bound and falls back to the full fold only when the bound cannot settle it.
// It must be the SAME decision, sample for sample: buildBody's kept bones and
// every containment and connectivity error depend on it. Held on every shipped
// character's bone samples with each bone grown until its samples straddle the
// surface (both the shortcut and the fallback run), at both thresholds the
// callers use, and on a .detail body, where hundreds of small relief prims
// change which solids bound a sample.
import { describe, it, expect } from 'vitest';
import { sdBody, fleshAbove, fleshIndex, solidsNear, breachSamples, BONE_CONTAINMENT_MARGIN } from './validate';
import { buildBody } from './build-body';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { withDetail } from './body-normal-bake/regions';
import { add, len, scale, sub } from './vec';
import type { Primitive, Vec3 } from './types';

const BLOBS = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const DETAILS = import.meta.glob('./characters/*.detail', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const build = (src: string) => { const doc = parseBlob(src); return buildBody(compileBlob(doc, compileFace(doc))); };
const grow = (b: Primitive, k: number): Primitive =>
  ({ ...b, radius: b.radius * k, radiusB: b.radiusB === undefined ? undefined : b.radiusB * k });

const cases: [string, string, number[]][] = Object.entries(BLOBS).map(([path, src]) => [path.split('/').pop()!, src, [2.2]]);
const chair = BLOBS['./characters/chair.blob'], chairDetail = DETAILS['./characters/chair.detail'];
if (chair && chairDetail) cases.push(['chair.blob + chair.detail', withDetail(chair, chairDetail, 'chair'), [2.2]]);

describe('fleshAbove is exactly sdBody(p) > t', () => {
  let inside = 0, outside = 0;
  for (const [name, src, growths] of cases) {
    it(name, () => {
      const body = build(src);
      const index = fleshIndex(body);
      expect(index).not.toBeNull();
      for (const bone of body.bonePrims)
        for (const k of growths) {
          const pts = breachSamples(grow(bone, k));
          const c = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
          const near = solidsNear(index!, c, Math.max(...pts.map(p => len(sub(p, c)))));
          for (const p of pts) {
            const d = sdBody(p, body);
            for (const t of [-BONE_CONTAINMENT_MARGIN, 0]) {
              const want = d > t;
              // A plain throw, not expect(): tens of thousands of comparisons per character.
              if (fleshAbove(p, body, t, index, near) !== want) throw new Error(`${name}: [${p}] at t=${t}: sdBody ${d}`);
              if (want) outside++; else inside++;
            }
          }
        }
    });
  }
  // Both sides ran across the cast, or the comparison proved nothing.
  it('exercised both sides', () => {
    expect(inside).toBeGreaterThan(1000);
    expect(outside).toBeGreaterThan(1000);
  });
});
