import type { SfxEvent } from './events';

/**
 * Map of SfxEvent → decoded AudioBuffer. Missing entries return null so
 * callers can short-circuit without throwing (intentional — a missing
 * placeholder sound should never crash gameplay).
 */
export class SfxRegistry {
  private buffers = new Map<SfxEvent, AudioBuffer>();

  set(event: SfxEvent, buffer: AudioBuffer): void {
    this.buffers.set(event, buffer);
  }

  get(event: SfxEvent): AudioBuffer | null {
    return this.buffers.get(event) ?? null;
  }
}
