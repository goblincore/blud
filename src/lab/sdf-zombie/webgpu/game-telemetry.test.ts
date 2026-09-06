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
