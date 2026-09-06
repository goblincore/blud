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
