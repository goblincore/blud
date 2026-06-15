import { describe, it, expect } from 'vitest';
import { explodeInfo, dudeInfo, gibList, KDude } from './notblood-tables.gen';

describe('notblood-tables.gen drift guard', () => {
  it('explodeInfo[1] (kExplosionStandard) matches source', () => {
    expect(explodeInfo[1]).toMatchObject({ radius: 150, dmgType: 900, dmg: 20, ticks: 60 });
  });
  it('zombie nGibType points at gibHuman (gibList[15], 7 chunks)', () => {
    const z = dudeInfo[KDude.kDudeZombieAxeNormal - KDude.kDudeBase]!;
    expect(z.nGibType[0]).toBe(15);
    expect(gibList[15].things?.length).toBe(7);
  });
  it('gibList[27] is the axe-zombie head (tile 3405)', () => {
    expect(gibList[27].things?.[0].tile).toBe(3405);
  });
});
