// src/lab/sdf-zombie/webgpu/earlyz/earlyz-wiring.test.ts
//
// SOURCE PINS for the early-Z boot ORDER in game-main.ts (spec 2026-10-01). main() has no unit
// seam, and the order is what makes the flag safe: the deferred guard must run after bootEarlyz
// (or bootEarlyz would overwrite it) and before anything builds a front mesh or the seed quad,
// and the seed waits for the final crowd decision. Task 11's smoke verifies the behaviour in the
// browser; this keeps a refactor from silently reordering it.
import { describe, it, expect } from 'vitest';
import source from '../game-main?raw';
import spawnSource from '../game-spawn?raw';

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
  const accumGuard = only("'stage 1 excludes temporal accumulation boots (far pass)'");
  const crowdOff = only("'crowd path off (stage 1 is crowd-only)'");
  const seed = only('setEarlyzSeed(');
  // The first crowd type is made by spawnEnemy (game-spawn.ts since 2026-10-07), which main()
  // first reaches through the boot's spawnAll.
  const firstType = only('spawnAll(ctx, ctx.boot.errors);');

  it('boots early-Z, then the deferred/accum guard, then the crowd-off check, then the seed, then the first crowd type', () => {
    expect(boot).toBeLessThan(guard);
    expect(boot).toBeLessThan(accumGuard);
    expect(Math.max(guard, accumGuard)).toBeLessThan(crowdOff);
    expect(crowdOff).toBeLessThan(seed);
    expect(seed).toBeLessThan(firstType);
    expect(source).not.toContain('crowdTypeFor(');
    expect(spawnSource).toContain('crowdTypeFor(ctx, name, room.id, stride)');
  });

  it('turns early-Z off under the deferred renderer and for ?accum=1 boots in one guarded block', () => {
    const start = source.lastIndexOf('\n  if (', guard);
    const block = source.slice(start, accumGuard + 200);
    expect(block).toContain('if (ctx.crowd.earlyz.on && (ctx.boot.deferredMode || isAccumBoot())) {');
    expect(block).toContain('ctx.crowd.earlyz.on = false;');
    // one block: both reasons sit between the same `if (` and the warn
    expect(block.indexOf('ctx.boot.deferredMode\n      ? ')).toBeGreaterThan(0);
    expect(block).toContain('console.warn(`[earlyz] off for this boot: ${ctx.crowd.earlyz.reason}`);');
  });

  it('reports early-Z off when the crowd path is off after the fallback logic resolves', () => {
    const start = source.lastIndexOf('\n  if (', crowdOff);
    const block = source.slice(start, crowdOff + 200);
    expect(block).toContain('if (ctx.crowd.earlyz.on && !ctx.crowd.on) {');
    expect(block).toContain('ctx.crowd.earlyz.on = false;');
    // after the refine/cone fallback assigned crowd.on = false
    expect(source.lastIndexOf('ctx.crowd.fallbackReason = ctx.render.refineWanted', crowdOff)).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(source.indexOf('ctx.crowd.on = false;\n    console.warn(\'[crowd] refine/cone'));
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

  it('keeps the shipped map() list (no per-frame flatMap) when early-Z is off', () => {
    const call = only('ctx.render.sdfLayer.setBodies(');
    const crowdList = source.slice(call, source.indexOf('.concat(', call));
    const gate = crowdList.indexOf('ctx.crowd.earlyz.on');
    expect(gate).toBeGreaterThan(-1);
    // `earlyz.on ? flatMap(...) : map(t => t.mesh)`: the flatMap is the on-branch only
    expect(crowdList.indexOf('.flatMap(')).toBeGreaterThan(gate);
    expect(crowdList.indexOf('.map(t => t.mesh)')).toBeGreaterThan(crowdList.indexOf('.flatMap('));
    expect(crowdList.split('.flatMap(').length - 1).toBe(1);
  });

  it('does not compile the front mesh of a quad-dispatch type (it never draws)', () => {
    const fn = source.indexOf('const compileCrowdInBackground');
    const skip = source.indexOf("if (m === t.frontMesh && t.dispatch === 'quad') continue;", fn);
    expect(skip).toBeGreaterThan(fn);
    // before the mesh is made visible for its compile
    expect(skip).toBeLessThan(source.indexOf('m.visible = true;', fn));
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
