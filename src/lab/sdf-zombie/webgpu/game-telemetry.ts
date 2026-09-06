/** Opt-in, bounded live-play recorder. No GPU waits, reads or console writes. */
export interface FrameTiming {
  startMs: number; endMs: number; intervalMs: number; tickCpuMs: number; drawCpuMs: number;
}
type Detail = Record<string, unknown>;
export interface CaptureFrame {
  t: number; intervalMs: number; tickCpuMs: number; drawCpuMs: number;
  phases: Record<string, number>; state: Detail;
}
export interface GameplayCapture {
  schema: 'blud-gameplay-v1'; startedAt: string; timeOrigin: number;
  metadata: Detail; durationMs: number; stopReason: string;
  droppedEvents: number; invalidFrames: number;
  frames: CaptureFrame[]; events: { t: number; name: string; detail?: Detail }[];
  summary: { frames: number; visibleFrames: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null; spikes40ms: number };
}

export class GameTelemetry {
  active = false;
  private started = 0;
  private ended = 0;
  private reason = 'manual';
  private metadata: Detail = {};
  private startedAt = '';
  private frames: CaptureFrame[] = [];
  private events: GameplayCapture['events'] = [];
  private phases: Record<string, number> = {};
  private droppedEvents = 0;
  private invalidFrames = 0;
  private generation = 0;
  private readonly limits: { maxFrames: number; maxEvents: number; maxDurationMs: number };

  constructor(private now = () => performance.now(), limits: Partial<GameTelemetry['limits']> = {}) {
    this.limits = { maxFrames: 18000, maxEvents: 4000, maxDurationMs: 180000, ...limits };
  }
  start(metadata: Detail) {
    if (this.active) return;
    this.metadata = structuredClone(metadata);
    this.started = this.now(); this.ended = this.started;
    this.startedAt = new Date().toISOString();
    this.frames = []; this.events = []; this.phases = {};
    this.droppedEvents = 0; this.invalidFrames = 0; this.reason = 'manual';
    this.generation++; this.active = true;
  }
  begin(): { start: number; generation: number } | undefined {
    return this.active ? { start: this.now(), generation: this.generation } : undefined;
  }
  end(name: string, token: ReturnType<GameTelemetry['begin']>) {
    if (!this.active || !token || token.generation !== this.generation) return;
    const end = this.now(), ms = end - token.start;
    this.phases[name] = (this.phases[name] ?? 0) + ms;
    // Only expensive spans enter DevTools; clear our buffer entries immediately.
    if (ms >= 2) {
      const label = `blud:${name}`;
      try {
        performance.measure(label, { start: token.start, end });
        performance.clearMeasures(label);
      } catch { /* User Timing unavailable: raw capture remains usable. */ }
    }
  }
  event(name: string, detail?: Detail) {
    if (!this.active) return;
    if (this.events.length >= this.limits.maxEvents) { this.droppedEvents++; return; }
    this.events.push({ t: this.now() - this.started, name, ...(detail ? { detail } : {}) });
    const label = `blud:${name}`;
    try { performance.mark(label, { detail }); performance.clearMarks(label); } catch { /* optional */ }
  }
  frame(timing: FrameTiming, state: Detail) {
    if (!this.active) return;
    if (!Object.values(timing).every(Number.isFinite) || timing.intervalMs < 0) {
      this.invalidFrames++; this.phases = {}; return;
    }
    this.frames.push({ t: timing.startMs - this.started, intervalMs: timing.intervalMs,
      tickCpuMs: timing.tickCpuMs, drawCpuMs: timing.drawCpuMs, phases: this.phases, state });
    this.phases = {};
    if (this.frames.length >= this.limits.maxFrames) this.finish('frame-limit');
    else if (this.now() - this.started >= this.limits.maxDurationMs) this.finish('duration-limit');
  }
  private finish(reason: string) { this.ended = this.now(); this.reason = reason; this.active = false; }
  stop(reason = 'manual'): GameplayCapture {
    if (this.active) this.finish(reason);
    const visible = this.frames.filter(f => !f.state.hidden && !f.state.visibilityGap && !f.state.firstFrame);
    const sorted = visible.map(f => f.intervalMs).sort((a, b) => a - b);
    const pct = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null;
    return { schema: 'blud-gameplay-v1', startedAt: this.startedAt, timeOrigin: performance.timeOrigin,
      metadata: this.metadata, durationMs: this.ended - this.started, stopReason: this.reason,
      droppedEvents: this.droppedEvents, invalidFrames: this.invalidFrames,
      frames: this.frames, events: this.events,
      summary: { frames: this.frames.length, visibleFrames: visible.length,
        p50Ms: pct(.5), p95Ms: pct(.95), p99Ms: pct(.99), maxMs: pct(1),
        spikes40ms: sorted.filter(x => x >= 40).length } };
  }
}
