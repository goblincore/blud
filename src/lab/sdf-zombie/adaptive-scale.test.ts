import { describe, it, expect } from 'vitest';
import {
  SCALE_LADDER,
  BASE_PROBE_MS,
  MAX_PROBE_MS,
  initialAdaptiveState,
  scaleForRung,
  stepAdaptive,
  type AdaptiveState,
} from './adaptive-scale';

const BUDGET = 16.7;
const TOP = SCALE_LADDER.length - 1;

/** Runs the controller for a stretch of frames at a caller-decided cost. */
function run(
  state: AdaptiveState,
  frames: number,
  costFor: (rung: number) => number,
  opts: { startMs?: number; frameMs?: number } = {},
): { state: AdaptiveState; rungs: number[] } {
  let now = opts.startMs ?? 0;
  const step = opts.frameMs ?? 16.7;
  const rungs: number[] = [];
  for (let i = 0; i < frames; i++) {
    now += step;
    state = stepAdaptive(state, { nowMs: now, medianFrameMs: costFor(state.rung), budgetMs: BUDGET });
    rungs.push(state.rung);
  }
  return { state, rungs };
}

describe('scaleForRung', () => {
  it('clamps out-of-range indices instead of returning undefined', () => {
    expect(scaleForRung(-5)).toBe(SCALE_LADDER[0]);
    expect(scaleForRung(99)).toBe(SCALE_LADDER[TOP]);
  });
});

describe('dropping', () => {
  it('holds the rung while inside budget', () => {
    const s = initialAdaptiveState(0);
    const next = stepAdaptive(s, { nowMs: 100, medianFrameMs: 16.7, budgetMs: BUDGET });
    expect(next.rung).toBe(TOP);
  });

  it('tolerates a small overshoot rather than reacting to noise', () => {
    const s = initialAdaptiveState(0);
    // 10% over is the threshold; just under it must not move.
    const next = stepAdaptive(s, { nowMs: 1000, medianFrameMs: 16.7 * 1.09, budgetMs: BUDGET });
    expect(next.rung).toBe(TOP);
  });

  it('drops on a sustained overshoot', () => {
    const s = initialAdaptiveState(0);
    const next = stepAdaptive(s, { nowMs: 1000, medianFrameMs: 33.4, budgetMs: BUDGET });
    expect(next.rung).toBeLessThan(TOP);
  });

  it('solves for the fitting scale in ONE step rather than walking down', () => {
    // 4x over budget. Cost goes as scale², so it needs about half the scale:
    // 1.0 -> ~0.47, which is rung 1 (0.45) — three rungs in a single step.
    const s = initialAdaptiveState(0);
    const next = stepAdaptive(s, { nowMs: 1000, medianFrameMs: BUDGET * 4, budgetMs: BUDGET });
    expect(scaleForRung(next.rung)).toBeLessThanOrEqual(0.45);
    expect(TOP - next.rung).toBeGreaterThanOrEqual(3);
  });

  it('always makes progress even when the prediction says the current rung fits', () => {
    // Barely over the threshold: the computed scale still rounds to the top
    // rung, but staying put would leave the frame over budget forever.
    const s = initialAdaptiveState(0);
    const next = stepAdaptive(s, { nowMs: 1000, medianFrameMs: BUDGET * 1.11, budgetMs: BUDGET });
    expect(next.rung).toBe(TOP - 1);
  });

  it('will not drop below the floor', () => {
    const s: AdaptiveState = { ...initialAdaptiveState(0), rung: 0 };
    const next = stepAdaptive(s, { nowMs: 5000, medianFrameMs: 200, budgetMs: BUDGET });
    expect(next.rung).toBe(0);
  });

  it('does not cascade down several rungs on one hitch', () => {
    // A single spike, then recovery. The cooldown means at most one drop.
    let s = initialAdaptiveState(0);
    s = stepAdaptive(s, { nowMs: 1000, medianFrameMs: 100, budgetMs: BUDGET });
    const afterFirst = s.rung;
    s = stepAdaptive(s, { nowMs: 1016, medianFrameMs: 100, budgetMs: BUDGET });
    expect(s.rung).toBe(afterFirst);
  });
});

describe('probing upward', () => {
  it('does not probe before the interval has elapsed', () => {
    const s: AdaptiveState = { ...initialAdaptiveState(0), rung: 2 };
    const next = stepAdaptive(s, { nowMs: BASE_PROBE_MS - 1, medianFrameMs: 16.7, budgetMs: BUDGET });
    expect(next.rung).toBe(2);
  });

  it('probes one rung up once the interval elapses', () => {
    const s: AdaptiveState = { ...initialAdaptiveState(0), rung: 2 };
    const next = stepAdaptive(s, { nowMs: BASE_PROBE_MS, medianFrameMs: 16.7, budgetMs: BUDGET });
    expect(next.rung).toBe(3);
    expect(next.probing).toBe(true);
  });

  it('climbs back to full quality when the scene gets cheap', () => {
    const s: AdaptiveState = { ...initialAdaptiveState(0), rung: 0 };
    const { state } = run(s, 4000, () => 16.7);
    expect(state.rung).toBe(TOP);
  });

  it('backs off after a failed probe, so a stuck scene stops stuttering', () => {
    // Only the bottom rung fits. Every probe upward fails.
    const cost = (rung: number) => (rung === 0 ? 16.7 : 40);
    const { state } = run({ ...initialAdaptiveState(0), rung: 0 }, 3000, cost);
    expect(state.rung).toBe(0);
    expect(state.probeIntervalMs).toBeGreaterThan(BASE_PROBE_MS);
  });

  it('caps the backoff', () => {
    const cost = (rung: number) => (rung === 0 ? 16.7 : 40);
    const { state } = run({ ...initialAdaptiveState(0), rung: 0 }, 40_000, cost);
    expect(state.probeIntervalMs).toBeLessThanOrEqual(MAX_PROBE_MS);
  });

  it('records a failed probe even when the drop is blocked by the cooldown', () => {
    // Probe up, then go over budget immediately — inside DROP_COOLDOWN_MS.
    let s: AdaptiveState = { ...initialAdaptiveState(0), rung: 2 };
    s = stepAdaptive(s, { nowMs: BASE_PROBE_MS, medianFrameMs: 16.7, budgetMs: BUDGET });
    expect(s.probing).toBe(true);
    const before = s.probeIntervalMs;
    s = stepAdaptive(s, { nowMs: BASE_PROBE_MS + 10, medianFrameMs: 40, budgetMs: BUDGET });
    expect(s.probeIntervalMs).toBeGreaterThan(before);
    expect(s.probing).toBe(false);
  });

  it('does not back off when the drop was caused by the scene, not by a probe', () => {
    // Sitting stable at a rung, then the camera moves into a crowd.
    let s: AdaptiveState = { ...initialAdaptiveState(0), rung: 3 };
    s = stepAdaptive(s, { nowMs: 10_000, medianFrameMs: 50, budgetMs: BUDGET });
    expect(s.probeIntervalMs).toBe(BASE_PROBE_MS);
  });

  it('forgives the backoff when a probe SURVIVES', () => {
    // The expensive stretch is over. One successful probe must undo the
    // accumulated backoff, or a scene that becomes cheap stays degraded for
    // MAX_PROBE_MS at every rung on the way back up.
    const probed: AdaptiveState = {
      rung: 2, probeIntervalMs: MAX_PROBE_MS, lastChangeMs: 0, probing: true,
    };
    const next = stepAdaptive(probed, { nowMs: 100, medianFrameMs: 16.7, budgetMs: BUDGET });
    expect(next.probing).toBe(false);
    expect(next.probeIntervalMs).toBe(BASE_PROBE_MS);
  });

  it('recovers to full quality promptly after a long expensive stretch', () => {
    // Pinned to the backoff ceiling by a crowd, then the crowd clears.
    const pinned: AdaptiveState = {
      rung: 1, probeIntervalMs: MAX_PROBE_MS, lastChangeMs: 0, probing: false,
    };
    const { state } = run(pinned, 3000, () => 16.7, { startMs: MAX_PROBE_MS });
    expect(state.rung).toBe(TOP);
    // Four rungs at the BASE interval, not four at the ceiling.
    expect(state.lastChangeMs).toBeLessThan(MAX_PROBE_MS + BASE_PROBE_MS * (TOP - 1) + 1000);
  });
});

describe('steady state', () => {
  it('settles at the best affordable rung and stays near it', () => {
    // Cost model: 60 ms at full scale, falling with scale². Budget 16.7 means
    // the affordable scale is about 0.5, i.e. rung 1 (0.45) or 2 (0.55).
    const cost = (rung: number) => 60 * (scaleForRung(rung) / 1.0) ** 2;
    const { state, rungs } = run(initialAdaptiveState(0), 6000, cost);
    expect(scaleForRung(state.rung)).toBeLessThanOrEqual(0.55);

    // And it should spend most of its time there rather than oscillating: the
    // backoff means failed probes get rarer over the run.
    const tail = rungs.slice(-1000);
    const settled = tail.filter((r) => scaleForRung(r) <= 0.55).length;
    expect(settled / tail.length).toBeGreaterThan(0.9);
  });
});
