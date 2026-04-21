/**
 * Camera screenshake: additive rotation offset on top of player look angles.
 *
 * Model: each `shake(magnitude, durationSec)` injects "energy" that decays
 * exponentially. Each sample produces a small random pitch/yaw/roll offset
 * whose amplitude is proportional to remaining energy.
 *
 * Reusable for M4 weapons — magnitude scales with the "punch" of the effect.
 * Explosion uses EXPLOSION_STANDARD.quake (scaled down to sensible radians).
 */

export interface ShakeOffset {
  pitch: number; // rad
  yaw: number;   // rad
  roll: number;  // rad
}

export class Screenshake {
  /** Remaining "energy" in arbitrary units; scales offset magnitude directly. */
  private energy = 0;

  /** Time constant for exponential decay (seconds). Smaller = snappier. */
  private readonly decaySec = 0.15;

  /** Peak-amplitude scale: energy of 1.0 → ~0.04 rad offset (~2.3°). */
  private readonly peakRad = 0.04;

  /**
   * Queue a shake impulse.
   * @param magnitude normalized intensity (1.0 = strong single-punch like a revolver shot;
   *                  4.0 = dynamite-bundle-at-point-blank).
   * @param durationSec approximate duration — currently just scales injected energy.
   */
  shake(magnitude: number, durationSec: number): void {
    this.energy = Math.min(this.energy + magnitude * durationSec, 10);
  }

  /** Call once per render frame. Returns the offset to add to camera rotation. */
  sampleOffset(dt: number): ShakeOffset {
    if (this.energy <= 0) return { pitch: 0, yaw: 0, roll: 0 };
    const amp = this.peakRad * this.energy;
    // Exponential decay
    this.energy *= Math.exp(-dt / this.decaySec);
    if (this.energy < 0.001) this.energy = 0;
    return {
      pitch: (Math.random() * 2 - 1) * amp,
      yaw:   (Math.random() * 2 - 1) * amp,
      roll:  (Math.random() * 2 - 1) * amp * 0.3, // less roll, feels nicer
    };
  }

  /** Reset (e.g. on player death / level load). */
  reset(): void {
    this.energy = 0;
  }
}
