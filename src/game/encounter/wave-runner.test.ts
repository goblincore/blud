import { describe, it, expect, vi } from 'vitest';
import { WaveRunner, WaveSpawnSink } from './wave-runner';
import { WARMUP_ROUND, EnemyKind } from './encounters';
import type { Vec3 } from '../gibs/particles';
import { WAVE_PRESETS } from '../gibs/tuning';

function makeSink(): { sink: WaveSpawnSink; spawns: { kind: EnemyKind; pos: Vec3 }[] } {
  const spawns: { kind: EnemyKind; pos: Vec3 }[] = [];
  let callIdx = 0;
  const positions: Vec3[] = [
    { x: 5, y: 0, z: 0 },
    { x: -5, y: 0, z: 0 },
    { x: 0, y: 0, z: 5 },
    { x: 0, y: 0, z: -5 },
  ];
  return {
    spawns,
    sink: {
      spawn(kind, pos) { spawns.push({ kind, pos }); },
      pickSpawnPos() { return positions[callIdx++ % positions.length]!; },
    },
  };
}

/** Drive a single wave to completion: spawn all enemies, clear to breather, then advance to next wave (or victory if last). */
function clearWave(wr: WaveRunner, startTime: number, enemyCount: number, spawnDelayMs: number, isLastWave: boolean): number {
  // Give enough time for all enemies to spawn: first spawns at t=0, last at spawnDelayMs*(count-1)
  const spawnDuration = (spawnDelayMs * (enemyCount - 1)) / 1000 + 0.5;
  const spawnEnd = startTime + spawnDuration;
  wr.update(spawnDuration, spawnEnd, true, 0); // all enemies spawned, 0 alive → breather

  // Breather period — advance to next wave (or victory)
  const breatherEnd = spawnEnd + WAVE_PRESETS.breatherSec + 0.1;
  wr.update(0, breatherEnd, true, 0); // breather elapsed → next wave (or victory if last)
  return breatherEnd;
}

describe('WaveRunner', () => {
  it('starts idle', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    expect(wr.state()).toBe('idle');
  });

  it('start() from idle enters active at wave 0', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);
    expect(wr.state()).toBe('active');
    expect(wr.currentWave()).toBe(0);
  });

  it('spawns enemies staggered by spawnDelayMs', () => {
    const { sink, spawns } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    // Wave 0 has spawnDelayMs=400, 2 enemies. After 0.5s, both should be spawned.
    wr.update(0.5, 0.5, true, 2); // 2 alive enemies
    expect(spawns.length).toBe(2);
    expect(spawns[0]!.kind).toBe('zombie');
    expect(spawns[1]!.kind).toBe('zombie');
  });

  it('moves to breather when wave cleared (all enemies spawned + 0 alive)', () => {
    const { sink, spawns } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    // Spawn all: advance past spawnDelayMs * enemyCount
    wr.update(1.0, 1.0, true, 0); // aliveCount=0 after all spawned
    // Both enemies should be spawned
    expect(spawns.length).toBe(2);
    expect(wr.state()).toBe('breather');
  });

  it('advances to next wave after breatherSec', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    // Clear wave 0 → enters breather at t=1.0
    wr.update(1.0, 1.0, true, 0);
    expect(wr.state()).toBe('breather');

    // Advance past breatherSec (1.5s)
    wr.update(0, 1.0 + WAVE_PRESETS.breatherSec + 0.1, true, 3);
    expect(wr.state()).toBe('active');
    expect(wr.currentWave()).toBe(1);
  });

  it('reaches victory after last wave cleared', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    let t = 0;
    // Simulate clearing all 5 waves
    for (let wave = 0; wave < WARMUP_ROUND.waves.length; wave++) {
      const w = WARMUP_ROUND.waves[wave]!;
      const isLast = wave === WARMUP_ROUND.waves.length - 1;
      t = clearWave(wr, t, w.enemies.length, w.spawnDelayMs, isLast);
    }

    expect(wr.state()).toBe('victory');
  });

  it('player death triggers defeat immediately', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);
    wr.update(0.1, 0.1, false, 5); // player dead
    expect(wr.state()).toBe('defeat');
  });

  it('start() during active is a no-op', () => {
    const { sink } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);
    wr.start(0.5); // second start while active
    expect(wr.state()).toBe('active');
    expect(wr.currentWave()).toBe(0); // didn't reset
  });

  it('spawn callback called with correct kind for each wave', () => {
    const { sink, spawns } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    // Wave 0: 2 zombies at 400ms delay → need ~400ms for both
    wr.update(0.5, 0.5, true, 2);
    expect(spawns.length).toBe(2);

    // Clear wave 0 → breather → advance to wave 1
    wr.update(0.5, 1.0, true, 0); // clear wave 0 → breather
    const t1 = 1.0 + WAVE_PRESETS.breatherSec + 0.1;
    wr.update(0, t1, true, 0); // advance to wave 1

    // Wave 1: 3 zombies at 400ms delay → need 800ms total
    wr.update(1.0, t1 + 1.0, true, 0);
    // Should have 2 + 3 = 5 zombies total
    const totalZombies = spawns.filter(s => s.kind === 'zombie').length;
    expect(totalZombies).toBe(5); // 2 + 3
  });

  it('tough zombie spawned in wave 3', () => {
    const { sink, spawns } = makeSink();
    const wr = new WaveRunner(WARMUP_ROUND, sink);
    wr.start(0);

    let t = 0;
    // Clear waves 0, 1, 2
    for (let wave = 0; wave < 3; wave++) {
      const w = WARMUP_ROUND.waves[wave]!;
      t = clearWave(wr, t, w.enemies.length, w.spawnDelayMs, false);
    }

    // Now at wave 3 — spawn phase
    wr.update(0.5, t + 0.5, true, 4); // spawn wave 3 enemies

    // Wave 3 should have a zombie-tough
    const toughSpawn = spawns.find(s => s.kind === 'zombie-tough');
    expect(toughSpawn).toBeDefined();
    expect(toughSpawn!.kind).toBe('zombie-tough');
  });
});
