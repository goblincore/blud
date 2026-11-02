// src/lab/sdf-zombie/webgpu/panel-pool.test.ts
import { describe, expect, it } from 'vitest';
import { runPool, type PoolOptions, type PoolStats, type PoolWorker } from './panel-pool';

type Mode = 'ok' | 'error' | 'messageerror' | 'silent-load-fail';
/** A fake worker answering synchronously: 'ok' echoes the job, others fail the way a real one would. */
class FakeWorker implements PoolWorker {
  onmessage: PoolWorker['onmessage'] = null;
  onerror: PoolWorker['onerror'] = null;
  onmessageerror: PoolWorker['onmessageerror'] = null;
  terminated = false;
  constructor(private readonly mode: (job: number) => Mode) {}
  postMessage(msg: unknown) {
    const job = msg as number, m = this.mode(job);
    if (m === 'ok') this.onmessage?.({ data: job * 10 });
    else if (m === 'error') this.onerror?.({ message: 'boom', preventDefault: () => {} });
    else if (m === 'messageerror') this.onmessageerror?.({});
    else this.onerror?.({});
  }
  terminate() { this.terminated = true; }
}

function run(jobs: number[], spawn: () => PoolWorker | null, size = 2) {
  const results = new Map<number, string>();
  const warns: string[] = [];
  let stats: PoolStats | null = null, doneCalls = 0;
  const o: PoolOptions<number> = {
    size, spawn, message: j => j,
    onResult: (j, d) => { results.set(j, `worker ${d as number}`); },
    inPlace: j => { results.set(j, 'in place'); },
    label: j => `job ${j}`, warn: m => warns.push(m),
    done: s => { stats = s; doneCalls++; }, now: () => 0, defer: fn => fn(),
  };
  runPool(jobs, o);
  return { results, warns, stats: stats as PoolStats | null, doneCalls };
}

describe('runPool', () => {
  it('answers every job off-thread when the workers behave, and terminates them', () => {
    const made: FakeWorker[] = [];
    const r = run([1, 2, 3, 4, 5], () => { const w = new FakeWorker(() => 'ok'); made.push(w); return w; });
    for (const j of [1, 2, 3, 4, 5]) expect(r.results.get(j)).toBe(`worker ${j * 10}`);
    // The fake answers synchronously, so the first lane drains the queue before the second spawns.
    expect(r.stats).toMatchObject({ offThread: 5, inPlace: 0, failures: 0 });
    expect(r.stats!.workers).toBeGreaterThanOrEqual(1);
    expect(made.every(w => w.terminated)).toBe(true);
    expect(r.doneCalls).toBe(1);
  });
  it('a job that errors is built in place, warned with its label, its worker terminated, and the queue drains', () => {
    const made: FakeWorker[] = [];
    const r = run([1, 2, 3, 4], () => { const w = new FakeWorker(j => (j === 2 ? 'error' : 'ok')); made.push(w); return w; });
    expect(r.results.get(2)).toBe('in place');
    for (const j of [1, 3, 4]) expect(r.results.get(j)).toMatch(/^worker/);
    expect(r.warns.some(w => w.includes('job 2') && w.includes('boom'))).toBe(true);
    expect(made.filter(w => w.terminated).length).toBe(made.length);
    expect(r.stats).toMatchObject({ offThread: 3, inPlace: 1, failures: 1 });
  });
  it('messageerror is handled like an error', () => {
    const r = run([1, 2], () => new FakeWorker(j => (j === 1 ? 'messageerror' : 'ok')), 1);
    expect(r.results.get(1)).toBe('in place');
    expect(r.results.get(2)).toMatch(/^worker/);
  });
  it('workers that fail everywhere (script never loads): after two failures everything builds in place', () => {
    let spawned = 0;
    const r = run([1, 2, 3, 4, 5, 6], () => { spawned++; return new FakeWorker(() => 'silent-load-fail'); }, 3);
    expect([...r.results.values()].every(v => v === 'in place')).toBe(true);
    expect(r.results.size).toBe(6);
    expect(spawned).toBeLessThanOrEqual(3);
    expect(r.doneCalls).toBe(1);
  });
  it('a factory that throws (CSP, no module workers) falls back to in-place builds', () => {
    const r = run([1, 2, 3], () => { throw new Error('blocked'); });
    expect(r.results.size).toBe(3);
    expect([...r.results.values()].every(v => v === 'in place')).toBe(true);
    expect(r.warns.some(w => w.includes('blocked'))).toBe(true);
    expect(r.doneCalls).toBe(1);
  });
  it('no jobs: done once, nothing spawned', () => {
    let spawned = 0;
    const r = run([], () => { spawned++; return null; });
    expect(spawned).toBe(0);
    expect(r.doneCalls).toBe(1);
  });
});
