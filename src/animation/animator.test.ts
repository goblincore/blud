import { describe, it, expect } from 'vitest';
import { pickFrameIndex } from './animator';

const frames = [{ durMs: 100 }, { durMs: 100 }, { durMs: 100 }]; // 3 frames × 100ms

describe('pickFrameIndex', () => {
  it('returns 0 at elapsed=0', () => {
    expect(pickFrameIndex(frames, 0, true)).toBe(0);
  });
  it('returns 0 at elapsed=50ms (first frame)', () => {
    expect(pickFrameIndex(frames, 50, true)).toBe(0);
  });
  it('returns 1 at elapsed=100ms (boundary)', () => {
    expect(pickFrameIndex(frames, 100, true)).toBe(1);
  });
  it('returns 2 at elapsed=250ms', () => {
    expect(pickFrameIndex(frames, 250, true)).toBe(2);
  });
  it('loops: returns 0 at elapsed=300ms (one full cycle)', () => {
    expect(pickFrameIndex(frames, 300, true)).toBe(0);
  });
  it('loops: returns 1 at elapsed=400ms', () => {
    expect(pickFrameIndex(frames, 400, true)).toBe(1);
  });
  it('holds last frame when loop=false past total duration', () => {
    expect(pickFrameIndex(frames, 500, false)).toBe(2);
  });
  it('handles negative elapsed by returning 0', () => {
    expect(pickFrameIndex(frames, -50, true)).toBe(0);
  });
  it('handles variable-duration frames', () => {
    const f = [{ durMs: 50 }, { durMs: 200 }, { durMs: 50 }]; // total 300
    expect(pickFrameIndex(f, 0, true)).toBe(0);
    expect(pickFrameIndex(f, 60, true)).toBe(1);
    expect(pickFrameIndex(f, 250, true)).toBe(2);
    expect(pickFrameIndex(f, 299, true)).toBe(2);
    expect(pickFrameIndex(f, 300, true)).toBe(0); // loop
  });
  it('throws on empty frame list', () => {
    expect(() => pickFrameIndex([], 0, true)).toThrow();
  });
});
