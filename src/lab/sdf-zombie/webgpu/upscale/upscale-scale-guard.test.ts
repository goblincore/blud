import { describe, expect, it } from 'vitest';
import { UPSCALE_SCALE } from './upscale-model';
import { resolveScaleWithUpscaler, upscaleMarchScale } from './upscale-scale-guard';

// The stage's output is the full-size buffer; its input is the march target at `scale`.
// The broken state (2026-09-25): stage on AND input == output — the WGSL prelude samples at
// big/2, so it shows only the top-left quarter of the march magnified 2x.
const OUT = { w: 1600, h: 900 };
const inputOf = (scale: number) => ({ w: Math.round(OUT.w * scale), h: Math.round(OUT.h * scale) });

describe('resolveScaleWithUpscaler (setSdfScale guard)', () => {
  it('keeps the stage at exactly the scale it was built around', () => {
    expect(resolveScaleWithUpscaler(UPSCALE_SCALE, true)).toEqual({ scale: UPSCALE_SCALE, upscaler: 'keep' });
    expect(resolveScaleWithUpscaler(UPSCALE_SCALE / 2, true, true)).toEqual({ scale: UPSCALE_SCALE / 2, upscaler: 'keep' });
  });

  it('drops the stage to native when the requested scale is not its scale (the scale-1 quarter-zoom)', () => {
    expect(resolveScaleWithUpscaler(1, true)).toEqual({ scale: 1, upscaler: 'native' });
    expect(resolveScaleWithUpscaler(0.75, true)).toEqual({ scale: 0.75, upscaler: 'native' });
    // Stacked on the checker accumulation the stage needs 0.25: 0.5 is wrong there.
    expect(resolveScaleWithUpscaler(UPSCALE_SCALE, true, true)).toEqual({ scale: UPSCALE_SCALE, upscaler: 'native' });
  });

  it('with the stage off, only clamps (setting 0.5 again never re-enables a stage)', () => {
    expect(resolveScaleWithUpscaler(1, false)).toEqual({ scale: 1, upscaler: 'keep' });
    expect(resolveScaleWithUpscaler(UPSCALE_SCALE, false)).toEqual({ scale: UPSCALE_SCALE, upscaler: 'keep' });
    expect(resolveScaleWithUpscaler(5, false).scale).toBe(1);
    expect(resolveScaleWithUpscaler(0.01, false).scale).toBe(0.2);
  });

  it('never ends with the stage on and its input the size of its output', () => {
    for (const stacked of [false, true]) {
      for (let s = 0.1; s <= 1.3; s += 0.05) {
        const r = resolveScaleWithUpscaler(s, true, stacked);
        const stageOn = r.upscaler === 'keep';
        if (!stageOn) continue;
        expect(r.scale).toBe(upscaleMarchScale(stacked));
        expect(inputOf(r.scale)).not.toEqual(OUT);
      }
    }
  });
});
