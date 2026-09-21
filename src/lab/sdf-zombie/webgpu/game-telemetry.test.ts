import { describe, it, expect } from 'vitest';
import { GameTelemetry } from './game-telemetry';

describe('manual gameplay capture', () => {
  it('ignores idle work, records event-relative time and keeps CPU separate from frame intervals', () => {
    let now = 100;
    const log = new GameTelemetry(() => now);
    log.event('ignored');
    expect(log.begin()).toBeUndefined();
    log.start({ build: 'test' });
    now = 110;
    const token = log.begin();
    log.event('slug-hit', { actor: 2 });
    now = 115;
    log.end('hit', token);
    log.frame({ startMs: 120, endMs: 127, intervalMs: 50, tickCpuMs: 4, drawCpuMs: 3 }, { hidden: false });
    now = 130;
    const data = log.stop();
    expect(data.events).toEqual([{ t: 10, name: 'slug-hit', detail: { actor: 2 } }]);
    expect(data.frames[0]).toMatchObject({ t: 20, intervalMs: 50, tickCpuMs: 4, drawCpuMs: 3, phases: { hit: 5 } });
    expect(data.summary.spikes40ms).toBe(1);
    expect(data.summary.p95Ms).toBe(50);
    log.frame({ startMs: 140, endMs: 150, intervalMs: 20, tickCpuMs: 5, drawCpuMs: 5 }, {});
    expect(data.frames).toHaveLength(1);
  });

  it('bounds frames and events without silently overwriting the first shot', () => {
    let now = 0;
    const log = new GameTelemetry(() => now, { maxFrames: 2, maxEvents: 2, maxDurationMs: 1000 });
    log.start({});
    for (let i = 0; i < 3; i++) log.event('shot', { index: i });
    for (let i = 0; i < 3; i++) {
      now += 20;
      log.frame({ startMs: now, endMs: now + 3, intervalMs: 20, tickCpuMs: 1, drawCpuMs: 2 }, {});
    }
    const data = log.stop();
    expect(log.active).toBe(false);
    expect(data.stopReason).toBe('frame-limit');
    expect(data.frames).toHaveLength(2);
    expect(data.events.map(e => e.detail?.index)).toEqual([0, 1]);
    expect(data.droppedEvents).toBe(1);
  });

  it('excludes visibility gaps from spike summaries and discards old state on a new recording', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({});
    log.frame({ startMs: 10, endMs: 11, intervalMs: 1000, tickCpuMs: 0, drawCpuMs: 1 }, { hidden: true });
    log.frame({ startMs: 20, endMs: 21, intervalMs: 16, tickCpuMs: 0, drawCpuMs: 1 }, { hidden: false });
    expect(log.stop().summary.spikes40ms).toBe(0);
    now = 100;
    log.start({ build: 'next' });
    expect(log.stop().frames).toHaveLength(0);
  });

  it('auto-stops on elapsed duration and rejects non-finite samples', () => {
    let now = 0;
    const log = new GameTelemetry(() => now, { maxDurationMs: 10 });
    log.start({});
    log.frame({ startMs: 1, endMs: 2, intervalMs: NaN, tickCpuMs: 0, drawCpuMs: 1 }, {});
    now = 11;
    log.frame({ startMs: 11, endMs: 12, intervalMs: 11, tickCpuMs: 0, drawCpuMs: 1 }, {});
    const data = log.stop();
    expect(data.stopReason).toBe('duration-limit');
    expect(data.invalidFrames).toBe(1);
    expect(data.frames).toHaveLength(1);
  });
});

it('owns recorded event values even when live wound coordinates change later', () => {
  const log = new GameTelemetry();
  const detail = { local: [1, 2, 3], wound: { radius: 0.1 } };
  log.start({});
  log.event('impact', detail);
  detail.local[0] = 9;
  detail.wound.radius = 2;
  expect(log.stop().events[0]?.detail).toEqual({ local: [1, 2, 3], wound: { radius: 0.1 } });
});

it('bounds detailed snapshots independently and keeps the earliest marked scene', () => {
  const log = new GameTelemetry(() => 0, { maxSnapshots: 1 });
  log.start({});
  log.snapshot('visual-issue', { actors: [{ id: 7 }] });
  log.snapshot('later', { actors: [{ id: 8 }] });
  const capture = log.stop();
  expect(capture.snapshots).toEqual([{ t: 0, name: 'visual-issue', detail: { actors: [{ id: 7 }] } }]);
  expect(capture.droppedSnapshots).toBe(1);
});

it('stops at the byte budget without dropping the first shot or retaining the oversized frame', () => {
  const log = new GameTelemetry(() => 0, { maxBytes: 1024 });
  log.start({});
  log.event('shot', { kind: 'slug' });
  log.frame({ startMs: 1, endMs: 2, intervalMs: 33, tickCpuMs: 1, drawCpuMs: 0 }, { huge: 'x'.repeat(2048) });
  const capture = log.stop();
  expect(capture.stopReason).toBe('byte-limit');
  expect(capture.events[0]?.name).toBe('shot');
  expect(capture.frames).toHaveLength(0);
});

it('reports consecutive late visible frames without counting cap jitter or visibility gaps', () => {
  const log = new GameTelemetry(() => 0);
  log.start({ targetFrameMs: 1000 / 30, lateToleranceMs: 2 });
  for (const [i, intervalMs] of [33.5, 40, 50, 33.4, 45].entries()) {
    log.frame({ startMs: i * 50, endMs: i * 50 + 2, intervalMs, tickCpuMs: 1, drawCpuMs: 1 }, {});
  }
  log.frame({ startMs: 500, endMs: 502, intervalMs: 200, tickCpuMs: 1, drawCpuMs: 1 }, { hidden: true });
  expect(log.stop().summary).toMatchObject({ lateFrames: 3, maxConsecutiveLateFrames: 2 });
});

describe('self time, unattributed CPU and the automatic long-frame event', () => {
  it('charges a nested span only for the time its children did not cover', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({});
    const outer = log.begin();          // 0
    now = 2; const inner = log.begin(); // 2
    now = 7; log.end('inner', inner);   // inner 5
    now = 10; log.end('outer', outer);  // outer 10 inclusive, 5 self
    now = 12;
    log.frame({ startMs: 0, endMs: 12, intervalMs: 33, tickCpuMs: 12, drawCpuMs: 0 }, {});
    const f = log.stop().frames[0]!;
    expect(f.phases).toEqual({ inner: 5, outer: 10 });
    expect(f.selfPhases).toEqual({ inner: 5, outer: 5 });
    expect(f.unattributedCpuMs).toBe(2); // 12 CPU - 10 covered by top-level spans
  });

  it('keeps self time right when spans close out of order', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({});
    const a = log.begin();
    now = 1; const b = log.begin();
    now = 4; log.end('a', a); // closes before its "child": b is re-parented to the root
    now = 6; log.end('b', b);
    log.frame({ startMs: 0, endMs: 6, intervalMs: 33, tickCpuMs: 6, drawCpuMs: 0 }, {});
    const f = log.stop().frames[0]!;
    expect(f.phases).toEqual({ a: 4, b: 5 });
    expect(Object.values(f.selfPhases).every(v => v >= 0)).toBe(true);
  });

  it('emits one long-frame event naming the heaviest self spans, and none for a normal frame', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({ longFrameCpuMs: 20 });
    let t = log.begin(); now = 3; log.end('body-step', t);
    log.frame({ startMs: 0, endMs: 5, intervalMs: 33, tickCpuMs: 5, drawCpuMs: 0 }, {});
    now = 40; t = log.begin(); now = 100; log.end('projectiles-and-hits', t);
    t = log.begin(); now = 102; log.end('body-step', t);
    log.frame({ startMs: 40, endMs: 110, intervalMs: 33, tickCpuMs: 70, drawCpuMs: 0 }, {});
    const data = log.stop();
    const long = data.events.filter(e => e.name === 'long-frame');
    expect(long).toHaveLength(1);
    expect(long[0]!.detail).toMatchObject({
      tickCpuMs: 70, drawCpuMs: 0, unattributedCpuMs: 8,
      top: [['projectiles-and-hits', 60], ['body-step', 2]],
    });
    expect(data.summary.longCpuFrames).toBe(1);
  });
});

describe('laps: scope-proof sequential spans', () => {
  it('a lap runs until the next lap on its channel, and frame() closes the last one', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({});
    log.lap('region', 'tick:input');
    now = 3; log.lap('region', 'tick:ai');
    now = 8; log.lap('region', 'draw:pre');
    now = 10;
    log.frame({ startMs: 0, endMs: 10, intervalMs: 33, tickCpuMs: 8, drawCpuMs: 2 }, {});
    const f = log.stop().frames[0]!;
    expect(f.selfPhases).toEqual({ 'tick:input': 3, 'tick:ai': 5, 'draw:pre': 2 });
    expect(f.unattributedCpuMs).toBe(0);
  });

  it('an explicit span inside a lap is its child; a lap inside a span never outlives it', () => {
    let now = 0;
    const log = new GameTelemetry(() => now);
    log.start({});
    log.lap('region', 'draw:main');
    now = 1; const span = log.begin();
    now = 2; log.lap('pass', 'cpu:sdf:polys');
    now = 5; log.lap('pass', 'cpu:sdf:march');
    now = 9; log.end('sdf-render', span);   // closes cpu:sdf:march at 9 too
    now = 12; log.lap('region', null);
    log.frame({ startMs: 0, endMs: 12, intervalMs: 33, tickCpuMs: 0, drawCpuMs: 12 }, {});
    const f = log.stop().frames[0]!;
    expect(f.phases).toEqual({ 'cpu:sdf:polys': 3, 'cpu:sdf:march': 4, 'sdf-render': 8, 'draw:main': 12 });
    expect(f.selfPhases).toEqual({ 'cpu:sdf:polys': 3, 'cpu:sdf:march': 4, 'sdf-render': 1, 'draw:main': 4 });
    expect(f.unattributedCpuMs).toBe(0);
  });

  it('is inert while not recording', () => {
    const log = new GameTelemetry(() => 0);
    log.lap('region', 'x');
    log.start({});
    log.frame({ startMs: 0, endMs: 1, intervalMs: 33, tickCpuMs: 1, drawCpuMs: 0 }, {});
    expect(log.stop().frames[0]!.selfPhases).toEqual({});
  });
});
