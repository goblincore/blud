import { describe, expect, it } from 'vitest';
import { HELPERS } from './helpers';
import { LIMB_ACCUMULATORS } from './limbs-flag';

describe('per-limb accumulators are compile-time gated (?limbs)', () => {
  it('is off without ?limbs, and the shipped shader text carries none of it', () => {
    expect(LIMB_ACCUMULATORS).toBe(false);
    const text = HELPERS.join('\n');
    expect(text).not.toContain('gLimb');
    expect(text).not.toContain('limbSwitch');
    expect(text).toContain('let limbMode = false;');
  });
});
