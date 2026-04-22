import type { AudioEngine } from './engine';
import type { SfxRegistry } from './sfx-registry';
import { SfxEvent } from './events';

export interface Vec3Like { x: number; y: number; z: number }

/** Max concurrent voices per event. Prevents N gib splats from overwhelming the mix. */
const THROTTLE: Partial<Record<SfxEvent, number>> = {
  [SfxEvent.GIB_SPLAT]: 3,
};

export class Sfx {
  private activeByEvent = new Map<SfxEvent, Set<AudioBufferSourceNode>>();

  constructor(
    private readonly engine: AudioEngine,
    private readonly registry: SfxRegistry,
  ) {}

  play(event: SfxEvent, pos?: Vec3Like): AudioBufferSourceNode | null {
    const buffer = this.registry.get(event);
    if (!buffer) return null;

    const limit = THROTTLE[event];
    if (limit !== undefined) {
      const active = this.activeByEvent.get(event) ?? new Set();
      if (active.size >= limit) return null;
    }

    const src = this.engine.ctx.createBufferSource();
    src.buffer = buffer;

    if (pos) {
      const panner = this.engine.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.maxDistance = 40;
      panner.setPosition(pos.x, pos.y, pos.z);
      src.connect(panner).connect(this.engine.sfxGain);
    } else {
      src.connect(this.engine.sfxGain);
    }

    const active = this.activeByEvent.get(event) ?? new Set();
    active.add(src);
    this.activeByEvent.set(event, active);
    src.onended = () => { active.delete(src); };

    src.start(0);
    return src;
  }
}
