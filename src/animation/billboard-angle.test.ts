import { describe, it, expect } from 'vitest';
import { pickAngleVariant } from './billboard-angle';

describe('pickAngleVariant (angleStride=5)', () => {
  const stride = 5;

  it('camera in front of sprite → variant 0, no flip', () => {
    // Sprite at origin facing +X (1, 0). Camera in front = along +X side from sprite.
    const r = pickAngleVariant(
      { x: 10, y: 0 },      // camera pos
      { x: 0, y: 0 },       // sprite pos
      { x: 1, y: 0 },       // sprite facing
      stride,
    );
    expect(r.variant).toBe(0);
    expect(r.flipX).toBe(false);
  });

  it('camera behind sprite → variant 4 (back), no flip', () => {
    const r = pickAngleVariant(
      { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(4);
    expect(r.flipX).toBe(false);
  });

  it('camera to left → variant 2 (side), no flip', () => {
    const r = pickAngleVariant(
      { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(2);
    expect(r.flipX).toBe(false);
  });

  it('camera to right → variant 2 (side), flipX=true', () => {
    const r = pickAngleVariant(
      { x: 0, y: -10 }, { x: 0, y: 0 }, { x: 1, y: 0 }, stride,
    );
    expect(r.variant).toBe(2);
    expect(r.flipX).toBe(true);
  });
});

describe('pickAngleVariant (angleStride=1)', () => {
  it('always returns variant 0 regardless of angle', () => {
    const r = pickAngleVariant(
      { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1,
    );
    expect(r.variant).toBe(0);
    expect(r.flipX).toBe(false);
  });
});
