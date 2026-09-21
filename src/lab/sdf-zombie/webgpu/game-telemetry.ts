/** Opt-in, bounded live-play recorder. No GPU waits, reads or console writes. */
export interface FrameTiming {
  startMs: number; endMs: number; intervalMs: number; tickCpuMs: number; drawCpuMs: number;
}
type Detail = Record<string, unknown>;
export interface CaptureFrame {
  t: number; intervalMs: number; tickCpuMs: number; drawCpuMs: number;
  phases: Record<string, number>; state: Detail;
  /** Per-span EXCLUSIVE ms: a span minus the spans that ran inside it. Unlike
   *  `phases` (inclusive, nested) these may be summed and ranked. */
  selfPhases: Record<string, number>;
  /** tick + draw CPU that NO span covered. A large value is an instrumentation
   *  gap, which is what hid the flare hit test (2026-09-20). */
  unattributedCpuMs: number;
}
type SpanToken = { start: number; generation: number; childMs: number; lap?: { channel: string; name: string } };
export interface GameplayCapture {
  schema: 'blud-gameplay-v1'; startedAt: string; timeOrigin: number;
  metadata: Detail; durationMs: number; stopReason: string;
  droppedEvents: number; invalidFrames: number; droppedSnapshots: number;
  frames: CaptureFrame[]; events: { t: number; name: string; detail?: Detail }[];
  snapshots: { t: number; name: string; detail: Detail }[];
  summary: { frames: number; visibleFrames: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null; spikes40ms: number; longCpuFrames: number; lateFrames: number; maxConsecutiveLateFrames: number; lateThresholdMs: number };
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
  private selfPhases: Record<string, number> = {};
  private coveredMs = 0;
  private open: SpanToken[] = [];
  private longCpuFrames = 0;
  private laps = new Map<string, SpanToken>();
  private longFrameCpuMs = 20;
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
    this.frames = []; this.events = []; this.resetSpans(); this.open = []; this.laps.clear();
    this.longCpuFrames = 0;
    this.longFrameCpuMs = Number(metadata.longFrameCpuMs) > 0 ? Number(metadata.longFrameCpuMs) : 20;
    this.snapshots = []; this.droppedSnapshots = 0;
    this.bytes = new TextEncoder().encode(JSON.stringify(this.metadata)).byteLength;
    this.droppedEvents = 0; this.invalidFrames = 0; this.reason = 'manual';
    this.generation++; this.active = true;
  }
  begin(): SpanToken | undefined {
    if (!this.active) return undefined;
    const token: SpanToken = { start: this.now(), generation: this.generation, childMs: 0 };
    this.open.push(token);
    return token;
  }
  /**
   * A LAP is a span that runs until the next lap on the same channel (or
   * `null`). Two statements at the same level can bracket a region of a
   * 900-line function without a token crossing block scope. Channels are
   * independent: 'region' laps partition tick/draw, 'pass' laps follow
   * setPassLabel. A lap opened inside a begin()/end() span is closed with it.
   */
  lap(channel: string, name: string | null) {
    if (!this.active) return;
    const prev = this.laps.get(channel);
    if (prev) { this.laps.delete(channel); this.end(prev.lap!.name, prev); }
    if (name === null) return;
    const token = this.begin();
    if (!token) return;
    token.lap = { channel, name };
    this.laps.set(channel, token);
  }
  private resetSpans() { this.phases = {}; this.selfPhases = {}; this.coveredMs = 0; }
  /** Hand back the phase totals accumulated since the last drain (or frame)
   *  and reset them. The bench's 'passes' mode reads CPU phases per stepped
   *  frame this way, since no frame observer runs while the loop is off. */
  drainPhases(): Record<string, number> {
    const out = this.phases;
    this.resetSpans();
    return out;
  }
  end(name: string, token: ReturnType<GameTelemetry['begin']>) {
    if (!this.active || !token || token.generation !== this.generation) return;
    // Laps opened inside this span end with it (innermost first).
    const floor = this.open.lastIndexOf(token);
    for (let i = this.open.length - 1; floor >= 0 && i > floor; i--) {
      const t = this.open[i]!;
      if (t.lap && this.laps.get(t.lap.channel) === t) { this.laps.delete(t.lap.channel); this.end(t.lap.name, t); }
    }
    const end = this.now(), ms = end - token.start;
    this.phases[name] = (this.phases[name] ?? 0) + ms;
    // SELF TIME. The enclosing span is whatever is still open beneath this one;
    // it is charged this span's whole duration as child time. A span with no
    // parent is top-level, and only top-level time counts as covered CPU.
    const at = this.open.lastIndexOf(token);
    if (at >= 0) this.open.splice(at, 1);
    const parent = at > 0 ? this.open[at - 1] : undefined;
    if (parent) parent.childMs += ms; else this.coveredMs += ms;
    this.selfPhases[name] = (this.selfPhases[name] ?? 0) + Math.max(0, ms - token.childMs);
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
      this.invalidFrames++; this.resetSpans(); return;
    }
    for (const channel of [...this.laps.keys()].reverse()) this.lap(channel, null);
    const cpuMs = timing.tickCpuMs + timing.drawCpuMs;
    const unattributedCpuMs = Math.max(0, cpuMs - this.coveredMs);
    const entry = { t: timing.startMs - this.started, intervalMs: timing.intervalMs,
      tickCpuMs: timing.tickCpuMs, drawCpuMs: timing.drawCpuMs, phases: this.phases, state,
      selfPhases: this.selfPhases, unattributedCpuMs };
    // THE STALL LABELS ITSELF. Any frame whose CPU half blows the budget
    // leaves an event naming its heaviest exclusive spans, so the next
    // causeless-looking hitch in a recording is not causeless.
    if (cpuMs >= this.longFrameCpuMs) {
      this.longCpuFrames++;
      const top = Object.entries(this.selfPhases).sort((a, b) => b[1] - a[1]).slice(0, 3);
      this.event('long-frame', { tickCpuMs: timing.tickCpuMs, drawCpuMs: timing.drawCpuMs, unattributedCpuMs, top });
    }
    if (!this.active || !this.reserve(entry)) return;
    this.frames.push(entry);
    this.resetSpans();
    // No span crosses a frame; one abandoned by an early return must not
    // become every later span's parent.
    this.open = [];
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
        spikes40ms: sorted.filter(x => x >= 40).length, longCpuFrames: this.longCpuFrames, lateFrames, maxConsecutiveLateFrames, lateThresholdMs } };
  }
}
