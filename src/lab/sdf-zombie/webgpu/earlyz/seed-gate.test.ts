// src/lab/sdf-zombie/webgpu/earlyz/seed-gate.test.ts
//
// The seed's draw/refuse decision (spec 2026-10-01 D6), table-driven: every refusal, the order
// they win in, the one case that may draw, and the size memo of the per-frame gate.
import { describe, it, expect, vi } from 'vitest';
import { seedBlockReasonFor, createSeedGate, type SeedGateInput } from './seed-gate';
import { seedScaleSupported } from './seed-depth.wgsl';

vi.mock('./seed-depth.wgsl', async (importOriginal) => {
  const real = await importOriginal<typeof import('./seed-depth.wgsl')>();
  return { ...real, seedScaleSupported: vi.fn(real.seedScaleSupported) };
});

/** The shipped boot: upscaler 2x (800x600 level depth, 400x300 march), nothing else on. */
const base = (): SeedGateInput => ({
  requested: true,
  levelDepth: true,
  fieldStyle: 'off',
  levelSize: [800, 600],
  marchSize: [400, 300],
  marchAttachments: 1,
  accumOn: false,
  captureJitter: false,
  perBodyGate: false,
});

const REFUSALS: Array<[string, Partial<SeedGateInput>, string]> = [
  ['flag off (never requested)', { requested: false }, 'not requested'],
  ['post-aa capture off', { levelDepth: false }, 'no sampleable level depth (post-aa capture off)'],
  ['field style frame', { fieldStyle: 'frame' }, "field style 'frame'"],
  ['field style sdf', { fieldStyle: 'sdf' }, "field style 'sdf'"],
  ['march 5 px over 17 (blocks of 5)', { levelSize: [850, 600], marchSize: [250, 300] }, 'march 250x300 over 850x600: seed block wider than 4 px'],
  ['vertical scale wider than 4 px', { levelSize: [800, 1500], marchSize: [400, 300] }, 'march 400x300 over 800x1500: seed block wider than 4 px'],
  ['march MRT (2 attachments)', { marchAttachments: 2 }, 'march MRT boot'],
  ['march MRT (4 attachments)', { marchAttachments: 4 }, 'march MRT boot'],
  ['temporal accumulation', { accumOn: true }, 'temporal accumulation (jittered march)'],
  ['capture jitter', { captureJitter: true }, 'capture jitter'],
  ['per-body depth gates', { perBodyGate: true }, 'per-body depth-gate passes'],
];

describe('seed gate (spec D6)', () => {
  it('may draw in the shipped boot', () => {
    expect(seedBlockReasonFor(base())).toBeNull();
    expect(createSeedGate().reason(base())).toBeNull();
  });

  it.each(REFUSALS)('refuses: %s', (_name, patch, reason) => {
    const input = { ...base(), ...patch };
    expect(seedBlockReasonFor(input)).toBe(reason);
    expect(createSeedGate().reason(input)).toBe(reason);
  });

  it('the scale refusals are real: the premises hold for the real seedScaleSupported', () => {
    // vi.fn wraps the real function, so these are the shipped answers.
    expect(seedScaleSupported([800, 600], [400, 300])).toBe(true);
    expect(seedScaleSupported([850, 600], [250, 300])).toBe(false);
    expect(seedScaleSupported([800, 1500], [400, 300])).toBe(false);
  });

  it('the first applicable refusal wins, in the documented order', () => {
    const everything: SeedGateInput = {
      requested: true, levelDepth: true, fieldStyle: 'frame',
      levelSize: [850, 600], marchSize: [250, 300],
      marchAttachments: 2, accumOn: true, captureJitter: true, perBodyGate: true,
    };
    const steps: Array<[Partial<SeedGateInput>, string]> = [
      [{}, "field style 'frame'"],
      [{ fieldStyle: 'off' }, 'march 250x300 over 850x600: seed block wider than 4 px'],
      [{ levelSize: [800, 600], marchSize: [400, 300] }, 'march MRT boot'],
      [{ marchAttachments: 1 }, 'temporal accumulation (jittered march)'],
      [{ accumOn: false }, 'capture jitter'],
      [{ captureJitter: false }, 'per-body depth-gate passes'],
    ];
    let cur = everything;
    for (const [patch, reason] of steps) {
      cur = { ...cur, ...patch };
      expect(seedBlockReasonFor(cur)).toBe(reason);
    }
    expect(seedBlockReasonFor({ ...cur, perBodyGate: false })).toBeNull();
    // And the two outermost ones beat everything.
    expect(seedBlockReasonFor({ ...everything, levelDepth: false })).toBe('no sampleable level depth (post-aa capture off)');
    expect(seedBlockReasonFor({ ...everything, requested: false, levelDepth: false })).toBe('not requested');
  });

  it('does not read the sizes while an earlier refusal applies', () => {
    const m = vi.mocked(seedScaleSupported);
    m.mockClear();
    const gate = createSeedGate();
    gate.reason({ ...base(), requested: false });
    gate.reason({ ...base(), levelDepth: false });
    gate.reason({ ...base(), fieldStyle: 'frame' });
    expect(m).not.toHaveBeenCalled();
  });
});

describe('seed gate size memo (per-frame caller)', () => {
  const calls = () => vi.mocked(seedScaleSupported).mock.calls.length;

  it('runs the scale test once per size and not again while the sizes hold', () => {
    vi.mocked(seedScaleSupported).mockClear();
    const gate = createSeedGate();
    const input = base();
    for (let i = 0; i < 5; i++) expect(gate.reason(input)).toBeNull();
    expect(calls()).toBe(1);
  });

  it('a changed MARCH size alone is re-tested, so a stale answer cannot survive it', () => {
    const gate = createSeedGate();
    const level: [number, number] = [850, 600];
    expect(gate.reason({ ...base(), levelSize: level, marchSize: [425, 300] })).toBeNull(); // exactly 2x
    expect(gate.reason({ ...base(), levelSize: level, marchSize: [250, 300] })).toBe('march 250x300 over 850x600: seed block wider than 4 px');
    expect(gate.reason({ ...base(), levelSize: level, marchSize: [425, 300] })).toBeNull();
  });

  it('a changed LEVEL size alone is re-tested', () => {
    const gate = createSeedGate();
    const march: [number, number] = [250, 300];
    expect(gate.reason({ ...base(), marchSize: march, levelSize: [750, 600] })).toBeNull(); // exactly 3x
    expect(gate.reason({ ...base(), marchSize: march, levelSize: [850, 600] })).toBe('march 250x300 over 850x600: seed block wider than 4 px');
    expect(gate.reason({ ...base(), marchSize: march, levelSize: [750, 600] })).toBeNull();
  });

  it('every one of the four numbers is part of the memo key', () => {
    const m = vi.mocked(seedScaleSupported);
    const keys: Array<Pick<SeedGateInput, 'levelSize' | 'marchSize'>> = [
      { levelSize: [800, 600], marchSize: [400, 300] },
      { levelSize: [801, 600], marchSize: [400, 300] },
      { levelSize: [801, 601], marchSize: [400, 300] },
      { levelSize: [801, 601], marchSize: [401, 300] },
      { levelSize: [801, 601], marchSize: [401, 301] },
    ];
    m.mockClear();
    const gate = createSeedGate();
    keys.forEach((k, i) => {
      gate.reason({ ...base(), ...k });
      expect(m).toHaveBeenCalledTimes(i + 1); // each single-number change is a miss
    });
  });

  it('the stateless form never reuses an earlier size', () => {
    expect(seedBlockReasonFor({ ...base(), levelSize: [850, 600], marchSize: [250, 300] })).not.toBeNull();
    expect(seedBlockReasonFor(base())).toBeNull();
  });
});

/** Seeded LCG so the walk is reproducible (no Math.random). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('seed gate memo, differential', () => {
  it('one long-lived gate never serves a stale reason (random walk over size AND non-size inputs)', () => {
    const r = rng(12345);
    const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]!;
    const gate = createSeedGate();
    // One reused input object, filled in place exactly like sdf-layer.ts does per frame.
    const input = base();
    let draws = 0, refusals = 0;
    for (let i = 0; i < 10_000; i++) {
      const flips = 1 + Math.floor(r() * 2);
      for (let k = 0; k < flips; k++) {
        switch (Math.floor(r() * 10)) {
          case 0: input.requested = r() < 0.9; break;
          case 1: input.levelDepth = r() < 0.9; break;
          case 2: input.fieldStyle = pick(['off', 'off', 'off', 'sdf', 'bodies', 'frame']); break;
          case 3: input.levelSize[0] = pick([800, 850, 801, 750, 1600, 640]); break;
          case 4: input.levelSize[1] = pick([600, 601, 1500, 450, 1200]); break;
          case 5: input.marchSize[0] = pick([400, 250, 401, 200, 320]); break;
          case 6: input.marchSize[1] = pick([300, 301, 225, 150]); break;
          case 7: input.marchAttachments = pick([1, 1, 1, 2, 4]); break;
          case 8: input.accumOn = r() < 0.2; input.captureJitter = r() < 0.2; break;
          case 9: input.perBodyGate = r() < 0.3; break;
        }
      }
      // The reference sees a fresh copy, so it can share no state with the memoising gate.
      const ref = seedBlockReasonFor({
        ...input, levelSize: [input.levelSize[0], input.levelSize[1]], marchSize: [input.marchSize[0], input.marchSize[1]],
      });
      const got = gate.reason(input);
      if (got !== ref) throw new Error(`stale at step ${i}: got ${got} want ${ref}, input ${JSON.stringify(input)}`);
      if (ref === null) draws++; else refusals++;
    }
    // The walk must actually exercise both outcomes, or it proves nothing.
    expect(draws).toBeGreaterThan(100);
    expect(refusals).toBeGreaterThan(100);
  });
});
