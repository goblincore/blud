import { describe, it, expect } from 'vitest';
import { FIRE_VOLUME_TUNING, FIRE_VOLUME_BOUNDS, resolveFireVolumeTuning } from './fire-volume-tuning';

describe('fire volume tuning', () => {
  it('clamps to bounds', () => {
    expect(resolveFireVolumeTuning({ steps: 9999 }).steps).toBe(FIRE_VOLUME_BOUNDS.steps[1]);
    expect(resolveFireVolumeTuning().resolutionScale).toBe(FIRE_VOLUME_TUNING.resolutionScale);
  });
  it('falls back over non-finite input', () => {
    expect(resolveFireVolumeTuning({ steps: Number.NaN }).steps).toBe(FIRE_VOLUME_TUNING.steps);
    expect(resolveFireVolumeTuning({ tempGain: -5 }).tempGain).toBe(FIRE_VOLUME_BOUNDS.tempGain[0]);
  });
  it('names every default field in bounds', () => {
    for (const key of Object.keys(FIRE_VOLUME_TUNING) as (keyof typeof FIRE_VOLUME_TUNING)[]) {
      expect(FIRE_VOLUME_BOUNDS[key]).toBeDefined();
    }
  });
});
