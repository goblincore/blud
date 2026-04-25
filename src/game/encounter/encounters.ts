export type EnemyKind = 'zombie' | 'zombie-tough';

export interface Wave {
  spawnDelayMs: number;
  enemies: EnemyKind[];
}

export interface Encounter {
  id: string;
  waves: Wave[];
}

export const WARMUP_ROUND: Encounter = {
  id: 'warmup',
  waves: [
    { spawnDelayMs: 400, enemies: ['zombie', 'zombie'] },
    { spawnDelayMs: 400, enemies: ['zombie', 'zombie', 'zombie'] },
    { spawnDelayMs: 350, enemies: ['zombie', 'zombie', 'zombie', 'zombie'] },
    { spawnDelayMs: 400, enemies: ['zombie-tough', 'zombie', 'zombie'] },
    { spawnDelayMs: 300, enemies: ['zombie', 'zombie', 'zombie', 'zombie', 'zombie'] },
  ],
};
