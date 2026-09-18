// src/lab/sdf-zombie/webgpu/demo-scenario-determinism.test.ts
//
// Source tripwires for the demo recorder's determinism setup.
//
// WHY THIS EXISTS. `sdf-demo-hash ab` reported "TWO IDENTICAL RUNS DIVERGED at
// frame 0" for as long as anyone had run it: the gather packs capsules only on
// a due tick and writes `lastCapsules` / `capsuleArrays` only then, so the first
// recorded frame is a function of the ABSOLUTE tick counter that boot leaves at
// an arbitrary phase. `bench` reset that phase; `demoScenario` — the member the
// hash tool actually drives — never did. One run packed the live cast (240
// instances), the next read a stale warm-up leftover (35).
//
// These are source tripwires rather than behavioural tests because the failure
// only reproduces against a real GPU across two fresh page loads. The gate that
// proves the behaviour is `scripts/sdf-demo-hash.sh ab`; these keep the seam
// from being edited back out between GPU runs.

import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/lab/sdf-zombie/webgpu/game-seams-bench.ts', 'utf8');

/** The body of one member of the __sdfGame seam object, by name. */
function memberBody(name: string): string {
  const start = SRC.indexOf(`    ${name}:`) >= 0 ? SRC.indexOf(`    ${name}:`) : SRC.indexOf(`    async ${name}(`);
  expect(start, `${name} must exist in game-seams-bench.ts`).toBeGreaterThan(-1);
  // Up to the next member at the same indent, or end of file.
  const rest = SRC.slice(start + 1);
  const nextRel = rest.search(/\n {4}(async )?[a-zA-Z_]+[(:]/);
  return nextRel === -1 ? rest : rest.slice(0, nextRel);
}

describe('demoScenario determinism setup', () => {
  it('resets the gather cadence phase before recording', () => {
    expect(memberBody('demoScenario')).toContain('ctx.probes.gatherTick = 0;');
  });

  it('does NOT reset the accumulated dynamic layer', () => {
    // Measured 2026-09-18: adding `gather?.reset()` here made the two runs agree
    // by zeroing the dynamic probe layer (probeDyn nonZero 6316 -> 0), which is
    // the black-silhouette regression frame-hash.ts exists to catch. Resetting
    // the phase alone gives identical runs with the layer still live.
    const body = memberBody('demoScenario');
    expect(body).not.toContain('ctx.probes.gather?.reset()');
    expect(body).not.toContain('ctx.probes.pendingGather = null');
  });

  it('drives frames by hand rather than racing the rAF loop', () => {
    expect(memberBody('demoScenario')).toContain('setLoopRunning(false)');
  });
});

describe('sdf-demo-hash liveness guards', () => {
  const GATE = readFileSync('scripts/sdf-demo-hash.mjs', 'utf8');

  it('refuses a recording whose march target is empty', () => {
    expect(GATE).toContain('the march target hashed to nothing');
  });

  it('refuses a recording whose dynamic probe layer is empty', () => {
    // Without this, a run can "pass" by comparing two all-zero layers.
    expect(GATE).toContain('the dynamic probe layer hashed to ZERO');
  });
});
