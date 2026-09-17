import type { ChunkBakeData } from './chunk-bake-geometry';
import type { ChunkBakeBuffers } from './chunk-bake-buffers';

export interface ChunkBakeRequest { id: number; data: ChunkBakeData }
export type ChunkBakeReply = { id: number; result: ChunkBakeBuffers } | { id: number; error: string };

/** One in-flight/result slot. Waiting chunks remain in the caller's bounded live ring. */
export function createChunkBakeJobs(factory: () => Worker) {
  let worker: Worker | null = null;
  let pendingId: number | null = null;
  let completed: { id: number; result: ChunkBakeBuffers } | null = null;
  let error: string | null = null;
  let generation = 0;
  /** Replay/bench waiters (determinism, 2026-09-14): a driver that steps the
   *  sim by hand awaits `settled()` before the frame after a submit, so the
   *  swap lands on that frame REGARDLESS of worker speed. Live play never
   *  waits — the worker reply is applied whenever it arrives. */
  let waiters: Array<() => void> = [];
  const wake = () => { const w = waiters; waiters = []; for (const r of w) r(); };
  const cancel = () => {
    generation++;
    worker?.terminate();
    worker = null;
    pendingId = null;
    completed = null;
    wake();
  };
  const fail = (message: string) => { cancel(); error = message; };
  return {
    get pendingId() { return pendingId; },
    get error() { return error; },
    submit(id: number, data: ChunkBakeData): boolean {
      if (pendingId !== null || error !== null) return false;
      try {
        if (!worker) {
          worker = factory();
          const current = generation;
          worker.onmessage = (event: MessageEvent<ChunkBakeReply>) => {
            if (generation !== current || event.data.id !== pendingId) return;
            if ('error' in event.data) fail(event.data.error);
            else { completed = event.data; wake(); }
          };
          worker.onerror = (event) => {
            event.preventDefault();
            if (generation === current) fail(event.message || 'Chunk bake worker failed');
          };
          worker.onmessageerror = () => {
            if (generation === current) fail('Chunk bake result could not be decoded');
          };
        }
        pendingId = id;
        // Snapshot via structured clone. Never transfer live renderer input arrays.
        worker.postMessage({ id, data } satisfies ChunkBakeRequest);
        return true;
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    /** Resolves once no reply is outstanding: nothing pending, a reply is
     *  waiting in `completed`, or the worker failed. */
    settled(): Promise<void> {
      if (pendingId === null || completed !== null || error !== null) return Promise.resolve();
      return new Promise<void>((resolve) => { waiters.push(resolve); });
    },
    takeCompleted() {
      const result = completed;
      if (result) { completed = null; pendingId = null; }
      return result;
    },
    cancel,
  };
}
