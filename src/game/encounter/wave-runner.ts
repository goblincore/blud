import type { Vec3 } from '../gibs/particles';
import { WAVE_PRESETS } from '../gibs/tuning';
import type { Encounter, EnemyKind } from './encounters';

export type WaveRunnerState = 'idle' | 'active' | 'breather' | 'victory' | 'defeat';

/**
 * Callback interface for spawning enemies and picking positions.
 * The concrete boot file (main.ts) provides the real implementation.
 */
export interface WaveSpawnSink {
  spawn(kind: EnemyKind, pos: Vec3): void;
  pickSpawnPos(): Vec3;
}

export class WaveRunner {
  private _state: WaveRunnerState = 'idle';
  private _currentWaveIdx = 0;
  private _waveStartedAt = 0;
  private _spawnedThisWave = 0;
  private _breatherEndsAt = 0;

  constructor(
    private encounter: Encounter,
    private sink: WaveSpawnSink,
  ) {}

  state(): WaveRunnerState { return this._state; }
  currentWave(): number { return this._currentWaveIdx; }

  start(now: number): void {
    if (this._state !== 'idle' && this._state !== 'victory' && this._state !== 'defeat') return;
    if (this.encounter.waves.length === 0) {
      console.warn('[wave-runner] empty encounter; staying idle');
      return;
    }
    this._state = 'active';
    this._currentWaveIdx = 0;
    this._waveStartedAt = now;
    this._spawnedThisWave = 0;
  }

  update(dt: number, now: number, playerAlive: boolean, aliveEnemyCount: number): void {
    if (this._state === 'idle' || this._state === 'victory' || this._state === 'defeat') return;
    if (!playerAlive) {
      this._state = 'defeat';
      return;
    }

    if (this._state === 'breather') {
      if (now >= this._breatherEndsAt) {
        this._currentWaveIdx++;
        if (this._currentWaveIdx >= this.encounter.waves.length) {
          this._state = 'victory';
          return;
        }
        this._state = 'active';
        this._waveStartedAt = now;
        this._spawnedThisWave = 0;
      }
      return;
    }

    // active
    const wave = this.encounter.waves[this._currentWaveIdx]!;
    const elapsedMs = (now - this._waveStartedAt) * 1000;
    const shouldHaveSpawnedByNow = Math.min(
      wave.enemies.length,
      Math.floor(elapsedMs / wave.spawnDelayMs) + 1,
    );
    while (this._spawnedThisWave < shouldHaveSpawnedByNow) {
      const kind = wave.enemies[this._spawnedThisWave]!;
      this.sink.spawn(kind, this.sink.pickSpawnPos());
      this._spawnedThisWave++;
    }
    if (this._spawnedThisWave >= wave.enemies.length && aliveEnemyCount === 0) {
      this._state = 'breather';
      this._breatherEndsAt = now + WAVE_PRESETS.breatherSec;
    }
  }
}
