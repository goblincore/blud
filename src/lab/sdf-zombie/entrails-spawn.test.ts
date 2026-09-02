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
  it('spills from a blast cavity wound unconditionally (the 1.0 pin)', () => {
    // The pin means NO roll can refuse: rng is in [0,1), so rng() < 1.0
    // always — 0 included.
    expect(shouldSpill(w({ cavity: true, type: 'blast' }), false, () => 0.99)).toBe('spawn');
    expect(shouldSpill(w({ cavity: true, type: 'blast' }), false, () => 0)).toBe('spawn');
  });
  it('spills from a SLUG wound on the 0.35 roll, NOT the blast pin', () => {
    // REAL TAXONOMY (task-8 finding, 2026-09-02): woundFromSlug stamps
    // type 'blast' (the slug uses the blast crater profile), so `type` cannot
    // distinguish slug from blast and the shipped SPILL_CHANCE.slug = 0.35
    // was DEAD CODE — every torso slug spilled, contradicting spec §3's roll.
    // The calibre is now recorded on the wound at stamp time, beside the
    // cavity flag it mirrors. (This test previously used `type: 'pellet'` as
    // a stand-in for the slug branch — a shape that never exists in real
    // data, which is exactly how the dead code hid.)
    const slug = w({ cavity: true, type: 'blast', spillCalibre: 'slug' });
    expect(shouldSpill(slug, false, () => 0.2)).toBe('spawn');   // under 0.35
    expect(shouldSpill(slug, false, () => 0.5)).toBe('none');    // over 0.35
  });
  it('tears the existing rope instead of growing a second', () => {
    expect(shouldSpill(w({ cavity: true }), true, () => 0)).toBe('tear');
  });
});
