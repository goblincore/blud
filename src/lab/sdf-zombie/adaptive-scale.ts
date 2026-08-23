// src/lab/sdf-zombie/adaptive-scale.ts
//
// Dynamic resolution for the SDF layer: keep the frame inside a budget by
// trading raymarch resolution, which is the one lever whose cost is exactly
// proportional to what is actually expensive here.
//
// WHY THIS IS THE RIGHT LEVER. The raymarcher is fill-bound — measured at
// 18.6 ms + 0.237 ms per 1k pixels — so cost tracks COVERED PIXELS, not body
// count. That is why zooming IN gets slower while showing FEWER bodies: the
// bodies that remain cover far more screen. Ten bodies read 47 ms of GPU from
// across the room and 137 ms from inside the crowd. Quality LOD cannot answer
// that (its whole ceiling was -24%); resolution can, because halving the scale
// quarters the pixels.
//
// ---------------------------------------------------------------------------
// THE MEASUREMENT PROBLEM, WHICH SHAPES THE WHOLE CONTROLLER
// ---------------------------------------------------------------------------
//
// The controller runs on WALL-CLOCK frame time, and wall clock is vsync-pinned:
// once the frame fits, it reads 16.7 ms no matter how much headroom is left.
// So the signal is ASYMMETRIC, and the controller has to be too.
//
//   - Going DOWN is measurable. A frame over budget is not clamped, so
//     `medianFrameMs` is a real number and the scale needed to fit can be
//     computed outright rather than approached one rung at a time. Cost is
//     linear in pixels and pixels go as scale², so the fitting scale is
//     `scale * sqrt(budget / measured)`. One step, immediately.
//
//   - Going UP is NOT measurable. At 16.7 ms the frame might have 1 ms of
//     headroom or 10; vsync has thrown that away. There is nothing to compute
//     from, so the only way to find out is to try it and watch. Hence probing,
//     and hence backoff — a probe that fails costs a visible stutter, so
//     repeated failures must get rarer.
//
// GPU timestamps would sidestep the clamp and were tried. They do not survive
// contact with this renderer: with the cone pre-pass on, one frame is three
// render calls, and three sums timestamp durations per frame id, so the value
// depends on which pass the fire-and-forget resolve happened to catch. The
// panel currently reports 47 ms of "GPU" while wall clock says a comfortable
// 16.7 at 60 fps, which cannot both be true. Until that is fixed, wall clock
// is the only honest per-frame signal available, clamp and all.

/**
 * Discrete scales rather than a continuous value, because changing scale
 * REALLOCATES the layer's render targets. A continuous controller would
 * reallocate most frames; a ladder reallocates only on a rung change.
 *
 * Ascending, so a higher index is higher quality.
 */
export const SCALE_LADDER = [0.35, 0.45, 0.55, 0.7, 0.85, 1.0] as const;

/** Frames must exceed this multiple of the budget before the scale drops. */
const OVER_FACTOR = 1.1;
/**
 * The p95 must exceed this multiple of the budget before the scale drops ONE
 * rung on spikes alone. The median is blind to a scene sitting exactly at
 * budget: wall clock reads 16.7 there whether the GPU has 8 ms of headroom or
 * none, while every fifth frame misses vsync and reads 33 ms — which the
 * owner feels as the frame rate tanking (the zoomed-in cyclops, 2026-08-23:
 * median 16.7, p95 55). A missed vsync IS measurable, and 1.8x the budget is
 * a whole extra frame at 60 Hz with margin for noise. One rung, not a solve:
 * the median gives nothing to solve from.
 */
const SPIKE_FACTOR = 1.8;

/**
 * Aim below the budget rather than at it, so a drop does not land exactly on
 * the edge and immediately re-trigger.
 */
const TARGET_HEADROOM = 0.9;

/** Floor on how often the scale may drop. Stops a hitch cascading down rungs. */
const DROP_COOLDOWN_MS = 250;

/** How long to sit at a stable rung before probing upward the first time. */
export const BASE_PROBE_MS = 1500;

/**
 * Ceiling on the backoff. A failed probe costs roughly one evaluation window
 * of degraded frame time, so this sets how much of a permanently-too-expensive
 * scene is spent stuttering: about 6% at 8 s. Lower it and a stuck scene
 * stutters more; raise it and a scene that becomes cheap takes longer to
 * notice.
 */
export const MAX_PROBE_MS = 8_000;

export interface AdaptiveState {
  /** Index into SCALE_LADDER. */
  rung: number;
  /** Current wait before the next upward probe; doubles on a failed probe. */
  probeIntervalMs: number;
  /** When the rung last changed. */
  lastChangeMs: number;
  /**
   * Whether the last change was an upward probe. A probe that is followed by
   * an over-budget frame is a FAILED probe, and only failed probes back off —
   * a drop caused by the camera moving into a crowd should not make the
   * controller permanently reluctant to recover.
   */
  probing: boolean;
}

export interface AdaptiveInput {
  nowMs: number;
  /** Median wall-clock frame time over a recent window. */
  medianFrameMs: number;
  /** p95 wall-clock frame time over the same window; optional, see SPIKE_FACTOR. */
  p95FrameMs?: number;
  /** Frame budget in ms — 16.7 for 60 fps. */
  budgetMs: number;
}

export function initialAdaptiveState(nowMs = 0, rung = SCALE_LADDER.length - 1): AdaptiveState {
  return { rung, probeIntervalMs: BASE_PROBE_MS, lastChangeMs: nowMs, probing: false };
}

export function scaleForRung(rung: number): number {
  const i = Math.max(0, Math.min(SCALE_LADDER.length - 1, Math.round(rung)));
  return SCALE_LADDER[i]!;
}

/**
 * One controller tick. Pure — returns the next state, and the caller applies
 * `scaleForRung(next.rung)` only when the rung actually changed.
 */
export function stepAdaptive(state: AdaptiveState, input: AdaptiveInput): AdaptiveState {
  const { nowMs, medianFrameMs, budgetMs } = input;
  const sinceChange = nowMs - state.lastChangeMs;
  const overBudget = medianFrameMs > budgetMs * OVER_FACTOR;
  const spiking = !overBudget && (input.p95FrameMs ?? 0) > budgetMs * SPIKE_FACTOR;

  if (overBudget || spiking) {
    if (state.rung === 0 || sinceChange < DROP_COOLDOWN_MS) {
      // Already at the floor, or still inside the cooldown. Either way the
      // rung does not move — but a failed probe is recorded the moment it is
      // observed, so the backoff is not lost to the cooldown.
      return state.probing
        ? { ...state, probing: false, probeIntervalMs: backoff(state.probeIntervalMs) }
        : state;
    }

    // Solve for the scale that fits instead of stepping down one rung at a
    // time: pixels go as scale², so scale * sqrt(target / measured) is the
    // scale whose predicted cost lands on the target.
    const current = scaleForRung(state.rung);
    const wanted = current * Math.sqrt((budgetMs * TARGET_HEADROOM) / medianFrameMs);
    // Spikes alone: the median says nothing about how far over we are, so
    // take one rung rather than a solve.
    let next = spiking ? state.rung - 1 : highestRungAtOrBelow(wanted);
    // Always make progress, even if the prediction says the current rung is
    // fine — it demonstrably is not, or we would not be over budget.
    if (next >= state.rung) next = state.rung - 1;

    return {
      rung: next,
      probeIntervalMs: state.probing ? backoff(state.probeIntervalMs) : state.probeIntervalMs,
      lastChangeMs: nowMs,
      probing: false,
    };
  }

  // Under budget.
  //
  // CALLER CONTRACT: this is only called once the sample window has refilled
  // since the last rung change, so an under-budget verdict here is a verdict
  // on the CURRENT rung, not a leftover from the previous one. That is what
  // makes the next line sound.
  //
  // A probe that reaches this point survived, so the backoff resets. Without
  // this, backoff only ever grows: a few seconds inside a crowd pins it to the
  // ceiling, and then the scene getting cheap again takes MAX_PROBE_MS to
  // notice. Failures accumulate; successes forgive.
  const settled: AdaptiveState = state.probing
    ? { ...state, probing: false, probeIntervalMs: BASE_PROBE_MS }
    : state;

  // Nothing can be inferred about HOW far under budget we are, so the only
  // move is to try the next rung up once the probe timer has elapsed.
  if (settled.rung < SCALE_LADDER.length - 1 && sinceChange >= settled.probeIntervalMs) {
    return {
      rung: settled.rung + 1,
      probeIntervalMs: settled.probeIntervalMs,
      lastChangeMs: nowMs,
      probing: true,
    };
  }

  return settled;
}

function backoff(ms: number): number {
  return Math.min(ms * 2, MAX_PROBE_MS);
}

/** Highest ladder index whose scale is <= `scale`; 0 if none is. */
function highestRungAtOrBelow(scale: number): number {
  let best = 0;
  for (let i = 0; i < SCALE_LADDER.length; i++) {
    if (SCALE_LADDER[i]! <= scale) best = i;
  }
  return best;
}
