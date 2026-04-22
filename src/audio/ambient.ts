import type { AudioEngine } from './engine';

export interface SpikeConfig {
  minSec: number;
  maxSec: number;
}

/** Pure function exported for TDD. Returns next spike delay in [min, max]. */
export function nextSpikeDelaySec(cfg: SpikeConfig, rng: () => number): number {
  if (cfg.minSec === cfg.maxSec) return cfg.minSec;
  return cfg.minSec + rng() * (cfg.maxSec - cfg.minSec);
}

/**
 * Two-layer ambient bed: wind loop + random-interval one-shots.
 */
export class Ambient {
  private windSource: AudioBufferSourceNode | null = null;
  private nextSpikeAt = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly windBuffer: AudioBuffer | null,
    private readonly spikeBuffer: AudioBuffer | null,
    private readonly spikeCfg: SpikeConfig,
    private readonly rng: () => number = Math.random,
  ) {}

  start(nowSec: number): void {
    if (this.windBuffer) {
      const src = this.engine.ctx.createBufferSource();
      src.buffer = this.windBuffer;
      src.loop = true;
      src.connect(this.engine.ambientGain);
      src.start(0);
      this.windSource = src;
    }
    this.nextSpikeAt = nowSec + nextSpikeDelaySec(this.spikeCfg, this.rng);
  }

  update(nowSec: number): void {
    if (!this.spikeBuffer) return;
    if (nowSec < this.nextSpikeAt) return;
    const src = this.engine.ctx.createBufferSource();
    src.buffer = this.spikeBuffer;
    src.playbackRate.value = 1 + (this.rng() - 0.5) * 0.35;
    const panner = this.engine.ctx.createStereoPanner();
    panner.pan.value = (this.rng() - 0.5) * 0.6;
    src.connect(panner).connect(this.engine.ambientGain);
    src.start(0);
    this.nextSpikeAt = nowSec + nextSpikeDelaySec(this.spikeCfg, this.rng);
  }

  stop(): void {
    this.windSource?.stop();
    this.windSource = null;
  }
}
