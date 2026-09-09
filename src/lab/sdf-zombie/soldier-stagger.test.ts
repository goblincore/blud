import { describe, expect, it } from 'vitest';
import { makeSoldierStaggerState, soldierStaggerDuration, SOLDIER_STAGGER, stepSoldierStagger } from './soldier-stagger';

describe('Soldier strong stagger', () => {
  it('chooses deterministic non-repeating variants with hit-side bias', () => {
    let state = makeSoldierStaggerState(7);
    const seen: number[] = [];
    for (const dir of [[-1,0,-1], [1,0,-1], [-1,0,-1], [1,0,-1]] as const) {
      const step = stepSoldierStagger(state, { dirWorld: [...dir], level: 'medium' }, 1 / 60, 7);
      seen.push(step.variant); state = step.state;
      state = stepSoldierStagger(state, null, soldierStaggerDuration('medium'), 7).state;
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(stepSoldierStagger(makeSoldierStaggerState(7), { dirWorld: [-1,0,-1], level: 'medium' }, 1 / 60, 7).variant)
      .not.toBe(stepSoldierStagger(makeSoldierStaggerState(7), { dirWorld: [1,0,-1], level: 'medium' }, 1 / 60, 7).variant);
  });

  it('travels permanently and cancels immediately on collapse', () => {
    let state = makeSoldierStaggerState(4), travel = 0;
    for (let i = 0; i < Math.ceil(SOLDIER_STAGGER.recoverySec * 60); i++) {
      const step = stepSoldierStagger(state, i === 0 ? { dirWorld: [0,0,-1], level: 'heavy' } : null, 1 / 60, 4);
      travel += step.travelDelta[2]; state = step.state;
    }
    expect(travel).toBeCloseTo(-.38, 6);
    const dead = stepSoldierStagger(state, null, 1 / 60, 4, true);
    expect(dead.active).toBe(false);
    expect(dead.armWeight).toBe(0);
  });

  it('uses level durations and never lets a weaker hit shorten an active reaction', () => {
    expect(soldierStaggerDuration('small')).toBe(.42);
    expect(soldierStaggerDuration('medium')).toBe(.78);
    expect(soldierStaggerDuration('heavy')).toBe(1.2);
    expect(soldierStaggerDuration('heavy', true)).toBe(1.35);
    let state = stepSoldierStagger(makeSoldierStaggerState(3),
      { dirWorld: [0,0,-1], level: 'heavy' }, .25, 3).state;
    const weaker = stepSoldierStagger(state, { dirWorld: [1,0,0], level: 'small' }, 1 / 60, 3);
    expect(weaker.state.level).toBe('heavy');
    expect(weaker.state.dirWorld).toEqual([0,0,-1]);
    expect(weaker.state.age).toBeGreaterThan(.25);
    const full = stepSoldierStagger(weaker.state,
      { dirWorld: [0,0,-1], level: 'heavy', fullStagger: true }, 1 / 60, 3);
    expect(full.state.fullOpen).toBe(true);
    expect(full.state.age).toBeCloseTo(1 / 60, 8);
  });
});
