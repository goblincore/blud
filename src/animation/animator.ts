/**
 * Pure frame-picking logic shared by FP and billboard animators.
 *
 * Given a list of frames (each with its own duration in ms) and an elapsed
 * time in ms, return the index of the currently-visible frame.
 *
 * - loop=true: wraps around after total duration.
 * - loop=false: holds the last frame once past total duration.
 * - Negative elapsed is treated as 0 (defensive).
 */

export interface TimedFrame {
  durMs: number;
}

export function pickFrameIndex(
  frames: readonly TimedFrame[],
  elapsedMs: number,
  loop: boolean,
): number {
  if (frames.length === 0) throw new Error('pickFrameIndex: empty frame list');
  if (elapsedMs <= 0) return 0;

  const total = frames.reduce((s, f) => s + f.durMs, 0);
  let t = elapsedMs;
  if (loop) {
    t = t % total;
  } else if (t >= total) {
    return frames.length - 1;
  }

  // Walk frames, subtracting durations until we land inside one.
  for (let i = 0; i < frames.length; i++) {
    const d = frames[i]!.durMs;
    if (t < d) return i;
    t -= d;
  }
  return frames.length - 1; // defensive
}
