import { describe, expect, it, vi } from 'vitest';
import { createChunkBakeJobs } from './chunk-bake-jobs';
import type { ChunkBakeData } from './chunk-bake-geometry';

function harness() {
  const workers: any[] = [];
  const jobs = createChunkBakeJobs(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null };
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { jobs, workers };
}
const data = {} as ChunkBakeData;

describe('background chunk baking', () => {
  it('holds one job until its result is consumed, without replacing queued work', () => {
    const { jobs, workers } = harness();
    expect(jobs.submit(1, data)).toBe(true);
    expect(jobs.submit(2, data)).toBe(false);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    workers[0].onmessage({ data: { id: 1, result: { bakeMs: 50 } } });
    expect(jobs.submit(2, data)).toBe(false);
    expect(jobs.takeCompleted()).toEqual({ id: 1, result: { bakeMs: 50 } });
    expect(jobs.pendingId).toBe(null);
    expect(jobs.submit(2, data)).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it('ignores a cancelled worker reply even after another job starts', () => {
    const { jobs, workers } = harness();
    jobs.submit(1, data);
    const staleReply = workers[0].onmessage;
    jobs.cancel();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    jobs.submit(2, data);
    staleReply({ data: { id: 1, result: { bakeMs: 50 } } });
    expect(jobs.takeCompleted()).toBe(null);
    expect(jobs.pendingId).toBe(2);
  });

  it('stops retrying on worker failure, leaving the caller free to keep its SDF view', () => {
    const { jobs, workers } = harness();
    jobs.submit(1, data);
    workers[0].onerror({ message: 'worker failed', preventDefault: vi.fn() });
    expect(jobs.error).toBe('worker failed');
    expect(jobs.pendingId).toBe(null);
    expect(jobs.takeCompleted()).toBe(null);
    expect(jobs.submit(2, data)).toBe(false);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });

  it('handles worker creation or message cloning failure without a synchronous bake fallback', () => {
    const jobs = createChunkBakeJobs(() => { throw Error('unsupported'); });
    expect(jobs.submit(1, data)).toBe(false);
    expect(jobs.error).toBe('unsupported');
    expect(jobs.pendingId).toBe(null);
  });
});
