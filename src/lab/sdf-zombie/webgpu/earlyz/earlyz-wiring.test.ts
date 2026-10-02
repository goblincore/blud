// src/lab/sdf-zombie/webgpu/earlyz/earlyz-wiring.test.ts
//
// SOURCE PINS for the early-Z boot ORDER in game-main.ts (spec 2026-10-01). main() has no unit
// seam, and the order is what makes the flag safe: the deferred guard must run after bootEarlyz
// (or bootEarlyz would overwrite it) and before anything builds a front mesh or the seed quad,
// and the seed waits for the final crowd decision. Task 11's smoke verifies the behaviour in the
// browser; this keeps a refactor from silently reordering it.
import { describe, it, expect } from 'vitest';
import source from '../game-main?raw';

/** Index of the single occurrence of `needle`; throws if it is missing or ambiguous, so a moved
 *  or duplicated anchor fails loudly instead of pinning the wrong line. */
function only(needle: string): number {
  const a = source.indexOf(needle);
  if (a < 0) throw new Error(`anchor not found: ${needle}`);
  if (source.indexOf(needle, a + needle.length) >= 0) throw new Error(`anchor is not unique: ${needle}`);
  return a;
}

describe('early-Z boot order in game-main.ts (source pins)', () => {
  const boot = only('if (EARLYZ_FLAG) await bootEarlyz(ctx);');
  // The string literal, not the comment above it that quotes the same words.
  const guard = only("'stage 1 is legacy-route only (deferred renderer)'");
  const seed = only('setEarlyzSeed(');
  const firstType = only('crowdTypeFor(');

  it('boots early-Z, then applies the deferred guard, then the seed, then the first crowd type', () => {
    expect(boot).toBeLessThan(guard);
    expect(guard).toBeLessThan(seed);
    expect(seed).toBeLessThan(firstType);
  });

  it('turns early-Z off under the deferred renderer in one guarded block', () => {
    const block = source.slice(source.lastIndexOf('\n  if (', guard), guard + 200);
    expect(block).toContain('if (ctx.boot.deferredMode && ctx.crowd.earlyz.on) {');
    expect(block).toContain('ctx.crowd.earlyz.on = false;');
  });

  it('lists each crowd type\'s front mesh with its back mesh in setBodies', () => {
    // sdf-layer hides the `bodies` list for the 'split' chunks-only render and gives each listed
    // body its own pass under the depth gate. A front mesh missing from the list stayed visible
    // in both, and the front batch marched again in sdf:march-chunks (2026-10-02 cost run).
    const call = only('ctx.render.sdfLayer.setBodies(');
    const crowdList = source.slice(call, source.indexOf('.concat(', call));
    expect(crowdList).toContain('crowdMarch');
    expect(crowdList).toContain('t.frontMesh ? [t.mesh, t.frontMesh] : [t.mesh]');
  });

  it('draws the seed only for a crowd-march boot with early-Z on', () => {
    const line = source.slice(source.lastIndexOf('\n', seed) + 1, source.indexOf('\n', seed));
    expect(line).toContain('ctx.crowd.earlyz.on');
    expect(line).toContain('ctx.crowd.on');
    expect(line.indexOf('if (')).toBeGreaterThanOrEqual(0);
    expect(line.indexOf('ctx.crowd.on')).toBeLessThan(line.indexOf('setEarlyzSeed('));
    expect(line.indexOf('ctx.crowd.earlyz.on')).toBeLessThan(line.indexOf('setEarlyzSeed('));
  });
});

describe('front-pipeline degradation wiring in game-main.ts (source pins)', () => {
  const calls: number[] = [];
  for (let i = source.indexOf('degradeFailedEarlyzFronts('); i >= 0; i = source.indexOf('degradeFailedEarlyzFronts(', i + 1)) calls.push(i);

  it('checks twice: right after each front compile, and every frame before the types sync', () => {
    expect(calls).toHaveLength(2);
    // The per-frame draw fn comes first in the file, the background compile job last.
    const [perFrame, afterCompile] = [calls[0]!, calls[1]!];
    // The first sits inside compileCrowdInBackground, after its precompile await and for the front mesh only.
    const compileFn = source.indexOf('const compileCrowdInBackground');
    expect(afterCompile).toBeGreaterThan(compileFn);
    expect(source.indexOf('m === t.frontMesh', compileFn)).toBeLessThan(afterCompile);
    // The second is gated on early-Z and precedes the first t.sync of the frame.
    const sync = source.indexOf('t.sync(camera, grid, vis)');
    expect(perFrame).toBeLessThan(sync);
    expect(source.slice(source.lastIndexOf('\n', perFrame) + 1, perFrame)).toContain('if (ctx.crowd.earlyz.on)');
  });
});
