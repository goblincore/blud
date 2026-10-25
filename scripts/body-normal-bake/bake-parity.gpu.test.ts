// scripts/body-normal-bake/bake-parity.gpu.test.ts
//
// BAKE PARITY (spec 2026-10-24-gpu-body-normal-bake-design.md, Tests 3): the GPU bake (scripts/lib/dawn-bake.ts)
// against the CPU reference (cpu-bake.ts), texel by texel at seeded samples, on each character's own committed bake
// layout shrunk for CI (width 64, every band's rows / 8). twinhead carries boxes, carves, chamfers and heavy
// bending; venus the strands. Run with `npm run test:gpu`.
import { describe, expect, it } from 'vitest';
import { committedBakes } from './bake-args';
import { compareBake, describeBake, scaleBakeArgs } from './bake-parity-lib';
import { parityGpu } from './gpu-parity-lib';

const gpu = await parityGpu();
const SAMPLES = 400;

describe.skipIf(!gpu)(`GPU bake vs CPU bake (${gpu?.adapter})`, () => {
  for (const name of ['twinhead', 'venus']) {
    it(name, async () => {
      const args = committedBakes().get(name)!;
      const r = await compareBake(gpu!, name, 64, scaleBakeArgs(args.regions, 8), SAMPLES);
      console.log(`${name}: ${describeBake(r)}`);
      // Coverage may differ only at grazing rays (the two marches take the last step either side of the 1e-4 hit
      // threshold): at most 0.5 % of samples. Covered texels: >= 99.5 % within one 8-bit code, all within four.
      expect(r.coverageMismatch, describeBake(r)).toBeLessThanOrEqual(Math.floor(SAMPLES * 0.005));
      expect(r.within1, describeBake(r)).toBeGreaterThanOrEqual(Math.ceil(r.covered * 0.995));
      expect(r.within4, describeBake(r)).toBe(r.covered);
      expect(r.covered, 'the samples hit skin at all').toBeGreaterThan(SAMPLES / 4);
    }, 600_000);
  }
});
