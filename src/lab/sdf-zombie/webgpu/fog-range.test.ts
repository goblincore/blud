import { describe, expect, it } from 'vitest';
import { DUNGEON_RIG } from './dungeon-lighting';
import { fogRange, SECTOR_FOG } from './fog-range';

describe('fogRange', () => {
  it('keeps the rig range on room levels', () => {
    expect(fogRange(DUNGEON_RIG, false, '')).toEqual({ near: DUNGEON_RIG.fogNear, far: DUNGEON_RIG.fogFar });
  });
  it('pushes the veil back on sector levels', () => {
    expect(fogRange(DUNGEON_RIG, true, '')).toEqual({ near: SECTOR_FOG.near, far: SECTOR_FOG.far });
  });
  it('takes ?fognear / ?fogfar overrides and ignores bad ones', () => {
    expect(fogRange(DUNGEON_RIG, true, '?fognear=4&fogfar=20')).toEqual({ near: 4, far: 20 });
    expect(fogRange(DUNGEON_RIG, true, '?fognear=x&fogfar=')).toEqual({ near: SECTOR_FOG.near, far: SECTOR_FOG.far });
    expect(fogRange(DUNGEON_RIG, false, '?fogfar=1').far).toBe(DUNGEON_RIG.fogFar);
  });
  it('?fog=0 moves it out of reach', () => {
    expect(fogRange(DUNGEON_RIG, true, '?fog=0').near).toBeGreaterThan(1000);
  });
});
