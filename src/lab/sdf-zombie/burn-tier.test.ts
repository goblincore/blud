import { describe, expect, it } from 'vitest';
import {
  BURN_TIER_DEFAULT, resolveBurnTier, ZOMBIE_PROFILE, SOLDIER_PROFILE, OGRE_PROFILE, GOREHOUND_PROFILE,
} from './motion-profile';

describe('resolveBurnTier', () => {
  it('no profile and an untiered profile take the default', () => {
    expect(resolveBurnTier(undefined)).toEqual(BURN_TIER_DEFAULT);
    expect(resolveBurnTier({})).toEqual(BURN_TIER_DEFAULT);
  });
  it('a partial tier fills the rest from the default', () => {
    expect(resolveBurnTier({ burn: { dies: false } })).toEqual({ ...BURN_TIER_DEFAULT, dies: false });
  });
  it('the zombie burns for 3 to 6 s and dies', () => {
    const t = resolveBurnTier(ZOMBIE_PROFILE);
    expect(t.panicSec).toEqual([3, 6]);
    expect(t.dies).toBe(true);
  });
  it('the soldier burns shorter and faster', () => {
    const t = resolveBurnTier(SOLDIER_PROFILE);
    expect(t.panicSec).toEqual([2.5, 4.5]);
    expect(t.speed).toBe(1.4);
  });
  it('a heavy panics but fire does not kill it', () => {
    const t = resolveBurnTier(OGRE_PROFILE);
    expect(t.dies).toBe(false);
    expect(t.flail).toBe(0.6);
  });
  it('the gorehound has no arm flail and no burn fall (the falls are keyed for a biped)', () => {
    expect(resolveBurnTier(GOREHOUND_PROFILE).flail).toBe(0);
    expect(resolveBurnTier(GOREHOUND_PROFILE).fall).toBe(false);
    expect(resolveBurnTier(ZOMBIE_PROFILE).fall).toBe(true);
  });
});
