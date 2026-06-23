export interface DebugHud {
  update(realDtSec: number, pos: { x: number; y: number; z: number }, hp: number, god?: boolean): void;
}

export function createDebugHud(el: HTMLElement): DebugHud {
  let sampleAccum = 0;
  let sampleCount = 0;
  let lastFps = 0;
  const SAMPLE_WINDOW_SEC = 0.5;

  return {
    update(realDtSec, pos, hp, god) {
      sampleAccum += realDtSec;
      sampleCount += 1;
      if (sampleAccum >= SAMPLE_WINDOW_SEC) {
        lastFps = sampleCount / sampleAccum;
        sampleAccum = 0;
        sampleCount = 0;
      }
      el.textContent =
        `fps ${lastFps.toFixed(0).padStart(3)}  ` +
        `hp ${hp.toFixed(0).padStart(3)}  ` +
        `pos ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}` +
        (god ? '  [GOD]' : '');
    },
  };
}
