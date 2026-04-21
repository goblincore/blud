import { describe, it, expect } from 'vitest';
import { createInputState } from './input';

describe('createInputState', () => {
  it('reports isDown as false by default', () => {
    const s = createInputState();
    expect(s.isDown('KeyW')).toBe(false);
  });

  it('tracks keydown and keyup', () => {
    const s = createInputState();
    s.onKeyDown('KeyW');
    expect(s.isDown('KeyW')).toBe(true);
    s.onKeyUp('KeyW');
    expect(s.isDown('KeyW')).toBe(false);
  });

  it('accumulates mouse delta and consumes it atomically', () => {
    const s = createInputState();
    s.addMouseDelta(3, -2);
    s.addMouseDelta(1, 1);
    const delta = s.consumeMouseDelta();
    expect(delta).toEqual({ dx: 4, dy: -1 });
    expect(s.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('reports justPressed for a single frame after a keydown', () => {
    const s = createInputState();
    s.onKeyDown('Space');
    expect(s.justPressed('Space')).toBe(true);
    expect(s.justPressed('Space')).toBe(false);
  });

  it('justPressed resets on keyup and re-arms on next keydown', () => {
    const s = createInputState();
    s.onKeyDown('Space');
    s.justPressed('Space');
    s.onKeyUp('Space');
    s.onKeyDown('Space');
    expect(s.justPressed('Space')).toBe(true);
  });
});
