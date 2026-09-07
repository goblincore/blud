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
  droppedEvents: number; invalidFrames: number; droppedSnapshots: number;
  frames: CaptureFrame[]; events: { t: number; name: string; detail?: Detail }[];
  snapshots: { t: number; name: string; detail: Detail }[];
  summary: { frames: number; visibleFrames: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null; spikes40ms: number; lateFrames: number; maxConsecutiveLateFrames: number; lateThresholdMs: number };
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
  private snapshots: GameplayCapture['snapshots'] = [];
  private droppedSnapshots = 0;
  private bytes = 0;
  private readonly limits: { maxFrames: number; maxEvents: number; maxDurationMs: number; maxSnapshots: number; maxBytes: number };

  constructor(private now = () => performance.now(), limits: Partial<GameTelemetry['limits']> = {}) {
    this.limits = { maxFrames: 18000, maxEvents: 4000, maxDurationMs: 180000, maxSnapshots: 16, maxBytes: 12 * 1024 * 1024, ...limits };
  }
  start(metadata: Detail) {
    if (this.active) return;
    this.metadata = structuredClone(metadata);
    this.started = this.now(); this.ended = this.started;
    this.startedAt = new Date().toISOString();
    this.frames = []; this.events = []; this.phases = {};
    this.snapshots = []; this.droppedSnapshots = 0;
    this.bytes = new TextEncoder().encode(JSON.stringify(this.metadata)).byteLength;
    this.droppedEvents = 0; this.invalidFrames = 0; this.reason = 'manual';
    this.generation++; this.active = true;
  }
  begin(): { start: number; generation: number } | undefined {
    return this.active ? { start: this.now(), generation: this.generation } : undefined;
  }
  /** Hand back the phase totals accumulated since the last drain (or frame)
   *  and reset them. The bench's 'passes' mode reads CPU phases per stepped
   *  frame this way, since no frame observer runs while the loop is off. */
  drainPhases(): Record<string, number> {
    const out = this.phases;
    this.phases = {};
    return out;
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
    const entry = { t: this.now() - this.started, name, ...(detail ? { detail: structuredClone(detail) } : {}) };
    if (!this.reserve(entry)) { this.droppedEvents++; return; }
    this.events.push(entry);
    const label = `blud:${name}`;
    try { performance.mark(label, { detail }); performance.clearMarks(label); } catch { /* optional */ }
  }
  /** Detailed geometry is sampled only at start/manual markers, never every frame. */
  snapshot(name: string, detail: Detail) {
    if (!this.active) return;
    if (this.snapshots.length >= this.limits.maxSnapshots) { this.droppedSnapshots++; return; }
    const entry = { t: this.now() - this.started, name, detail: structuredClone(detail) };
    if (!this.reserve(entry)) { this.droppedSnapshots++; return; }
    this.snapshots.push(entry);
  }
  private reserve(value: unknown): boolean {
    // Count UTF-8 payloads plus separators; leave 4 MiB for the enclosing document.
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength + 1;
    if (this.bytes + bytes > this.limits.maxBytes) { this.finish('byte-limit'); return false; }
    this.bytes += bytes;
    return true;
  }
  frame(timing: FrameTiming, state: Detail) {
    if (!this.active) return;
    if (!Object.values(timing).every(Number.isFinite) || timing.intervalMs < 0) {
      this.invalidFrames++; this.phases = {}; return;
    }
    const entry = { t: timing.startMs - this.started, intervalMs: timing.intervalMs,
      tickCpuMs: timing.tickCpuMs, drawCpuMs: timing.drawCpuMs, phases: this.phases, state };
    if (!this.reserve(entry)) return;
    this.frames.push(entry);
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
    const target = Number(this.metadata.targetFrameMs) || 1000 / 30;
    const tolerance = Number(this.metadata.lateToleranceMs) || 2;
    const lateThresholdMs = target + tolerance;
    let lateFrames = 0, streak = 0, maxConsecutiveLateFrames = 0;
    for (const f of this.frames) {
      if (f.state.hidden || f.state.visibilityGap || f.state.firstFrame || f.intervalMs <= lateThresholdMs) { streak = 0; continue; }
      lateFrames++; streak++; maxConsecutiveLateFrames = Math.max(maxConsecutiveLateFrames, streak);
    }
    return { schema: 'blud-gameplay-v1', startedAt: this.startedAt, timeOrigin: performance.timeOrigin,
      metadata: this.metadata, durationMs: this.ended - this.started, stopReason: this.reason,
      droppedEvents: this.droppedEvents, invalidFrames: this.invalidFrames, droppedSnapshots: this.droppedSnapshots,
      frames: this.frames, events: this.events, snapshots: this.snapshots,
      summary: { frames: this.frames.length, visibleFrames: visible.length,
        p50Ms: pct(.5), p95Ms: pct(.95), p99Ms: pct(.99), maxMs: pct(1),
        spikes40ms: sorted.filter(x => x >= 40).length, lateFrames, maxConsecutiveLateFrames, lateThresholdMs } };
  }
}
