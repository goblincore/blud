import { describe, expect, it } from 'vitest';
import { shouldSpill } from './entrails-spawn';
import type { Wound } from './damage';

const w = (o: Partial<Wound>): Wound => ({
  primIdx: 0, local: [0, 0, 0], radius: 0.1, type: 'blast', ageSec: 0, ...o,
} as Wound);

describe('shouldSpill', () => {
  it('never spills from a non-cavity wound', () => {
    expect(shouldSpill(w({ cavity: false }), false, () => 0)).toBe('none');
  });
  it('always spills from a blast cavity wound', () => {
    expect(shouldSpill(w({ cavity: true, type: 'blast' }), false, () => 0.99)).toBe('spawn');
  });
  it('spills from a slug only on the roll', () => {
    expect(shouldSpill(w({ cavity: true, type: 'pellet' }), false, () => 0.2)).toBe('spawn');
    expect(shouldSpill(w({ cavity: true, type: 'pellet' }), false, () => 0.9)).toBe('none');
  });
  it('tears the existing rope instead of growing a second', () => {
    expect(shouldSpill(w({ cavity: true }), true, () => 0)).toBe('tear');
  });
});
