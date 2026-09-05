import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CultistBrain, CultistState } from './cultist-ai';
import { CULTIST_TOMMY } from '../gibs/tuning';
import type { GibbableDude } from './cultist';

/** Build a minimal mock brain that exposes all public members we need. */
function makeBrain(hooks?: {
  onAggroTransition?: () => void;
  onShot?: () => void;
}): { brain: CultistBrain; hooks: typeof hooks } {
  const h = hooks ?? {};
  const brain = new CultistBrain(
    { hp: CULTIST_TOMMY.hp, speed: CULTIST_TOMMY.speed },
    h,
  );
  return { brain, hooks: h };
}

describe('CultistBrain', () => {
  it('starts in Idle state', () => {
    const { brain } = makeBrain();
    expect(brain.state).toBe(CultistState.Idle);
  });

  it('reads tuning constants from CULTIST_TOMMY', () => {
    const { brain } = makeBrain();
    expect(brain.hp).toBe(CULTIST_TOMMY.hp);
    expect(brain.speed).toBe(CULTIST_TOMMY.speed);
  });

  it('transitions Idle → Chase when player enters detection range', () => {
    const { brain } = makeBrain();
    // Player at 14m (inside 15m detection)
    brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 14, y: 0, z: 0 });
    expect(brain.state).toBe(CultistState.Chase);
  });

  it('stays Idle when player is outside detection range', () => {
    const { brain } = makeBrain();
    brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 });
    expect(brain.state).toBe(CultistState.Idle);
  });

  it('transitions Chase → Aim when within preferred range', () => {
    const { brain } = makeBrain();
    brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    expect(brain.state).toBe(CultistState.Aim);
  });

  it('calls onAggroTransition when entering Chase', () => {
    const cb = vi.fn();
    const { brain } = makeBrain({ onAggroTransition: cb });
    brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 14, y: 0, z: 0 });
    expect(cb).toHaveBeenCalled();
  });

  it('calls onShot when firing within a burst', () => {
    const cb = vi.fn();
    const { brain } = makeBrain({ onShot: cb });
    // Advance through Aim windup then Shoot
    for (let t = 0; t < 1; t += 0.016) {
      brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    }
    expect(cb).toHaveBeenCalled();
  });

  it('applies damage → Stagger, then Dead at 0 hp', () => {
    const { brain } = makeBrain();
    expect(brain.state).toBe(CultistState.Idle);
    brain.takeDamage(80); // kills it
    expect(brain.hp).toBe(0);
    expect(brain.state).toBe(CultistState.Dead);
  });

  it('applies partial damage → Stagger (not dead)', () => {
    const { brain } = makeBrain();
    brain.takeDamage(40);
    expect(brain.hp).toBe(40);
    expect(brain.state).toBe(CultistState.Stagger);
  });

  it('desiredVelocity points toward player while chasing', () => {
    const { brain } = makeBrain();
    brain.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    const v = brain.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(CULTIST_TOMMY.speed, 3);
    expect(v.z).toBe(0);
  });

  it('desiredVelocity is zero while not chasing', () => {
    const { brain } = makeBrain();
    const v = brain.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    // In Aim state → zero velocity
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
  });
});
