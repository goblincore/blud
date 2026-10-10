import { describe, it, expect } from 'vitest';
import { readEarlyzFlag, EARLYZ_FLAG } from './flag';

describe('earlyz flag (spec D1)', () => {
  it('is on only for earlyz=1', () => {
    expect(readEarlyzFlag('?earlyz=1')).toBe(true);
    expect(readEarlyzFlag('?level=night-train&earlyz=1')).toBe(true);
    expect(readEarlyzFlag('?earlyz=0')).toBe(false);
    expect(readEarlyzFlag('?earlyz')).toBe(false);
    expect(readEarlyzFlag('')).toBe(false);
  });
  it('reads false under vitest, so the golden text sees the shipped shaders', () => {
    expect(EARLYZ_FLAG).toBe(false);
  });
});
