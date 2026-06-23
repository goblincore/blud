// src/sim/dude.test.ts
import { describe, it, expect } from 'vitest';
import { spawnDude, DudeAi, CULTIST, type DudeState } from './dude';
import { fpFromMeters } from './fp';

describe('dude spawn', () => {
  it('spawns a cultist idle, full health, facing its initial angle', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, fpFromMeters(3), 0, fpFromMeters(-2), 512);
    expect(dudes).toHaveLength(1);
    const d = dudes[0]!;
    expect(d.ai).toBe(DudeAi.Idle);
    expect(d.health).toBe(CULTIST.health);
    expect(d.ang).toBe(512);
    expect(d.hasTarget).toBe(false);
  });
});
