/**
 * Event bus for post-fx pulses. Passes subscribe by calling `currentCAIntensity(now)`
 * each frame. Pure — no Three.js dep so it's testable.
 */
export class PostFxBus {
  private pulseAmp = 0;
  private pulseStart = 0;
  private pulseDuration = 0;

  constructor(private readonly baselineCA = 0.05) {}

  triggerDamagePulse(amp: number, durationSec: number, nowSec: number): void {
    this.pulseAmp = amp;
    this.pulseStart = nowSec;
    this.pulseDuration = durationSec;
  }

  currentCAIntensity(nowSec: number): number {
    const elapsed = nowSec - this.pulseStart;
    if (elapsed < 0 || elapsed >= this.pulseDuration || this.pulseDuration <= 0) {
      return this.baselineCA;
    }
    const t = elapsed / this.pulseDuration;
    return this.pulseAmp + (this.baselineCA - this.pulseAmp) * t;
  }
}
