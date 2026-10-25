import { describe, expect, it } from 'vitest';
import { stepPlayer, type PlayerState } from './game-player';

const fresh = (): PlayerState => ({ pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true });

/** Jump while walking forward; frames until landing, the peak and the distance walked. */
function jump(airScale: number) {
  const s = fresh();
  let frames = 0, peak = 0;
  stepPlayer(s, { x: 0, z: 1, jump: true }, 1 / 60, [], airScale);
  for (frames = 1; frames < 2000 && !s.grounded; frames++) {
    stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, [], airScale);
    peak = Math.max(peak, s.pos[1]);
  }
  return { frames, peak, travelled: Math.hypot(s.pos[0], s.pos[2]) };
}

describe('stepPlayer airScale (bullet time shootdodge hang)', () => {
  it('keeps the jump height but stretches the airtime by 1/airScale', () => {
    const plain = jump(1), hang = jump(0.4);
    expect(hang.peak).toBeCloseTo(plain.peak, 1);
    expect(hang.frames / plain.frames).toBeGreaterThan(2.3);
    expect(hang.frames / plain.frames).toBeLessThan(2.7);
  });

  it('leaves the walk at full speed, so a hung jump carries further', () => {
    const plain = fresh(), hang = fresh();
    for (let i = 0; i < 60; i++) {
      stepPlayer(plain, { x: 0, z: 1, jump: false }, 1 / 60, []);
      stepPlayer(hang, { x: 0, z: 1, jump: false }, 1 / 60, [], 0.4);
    }
    expect(hang.pos).toEqual(plain.pos);
    expect(jump(0.4).travelled).toBeGreaterThan(jump(1).travelled * 2);
  });
});
