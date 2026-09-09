// src/lab/sdf-zombie/probe-grid.worker.ts
//
// Bakes one room's static probe grid off the main thread. Same shape as
// chunk-bake.worker.ts: {id, req} in, {id, dims, min, max, sh} out with the
// SH buffer transferred, or {id, error}. probe-grid.ts imports nothing from
// three, which is what makes it safe to run here.
import { buildProbeGridRequest, type ProbeGridRequest } from './probe-grid';

export interface ProbeWorkerRequest { id: number; req: ProbeGridRequest }
export type ProbeWorkerReply =
  | { id: number; dims: [number, number, number]; min: readonly [number, number, number]; max: readonly [number, number, number]; sh: Float32Array }
  | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ProbeWorkerRequest>) => void) | null;
  postMessage(message: ProbeWorkerReply, transfer: ArrayBuffer[]): void;
};
scope.onmessage = ({ data: { id, req } }) => {
  try {
    const r = buildProbeGridRequest(req);
    scope.postMessage({ id, dims: r.dims, min: r.min, max: r.max, sh: r.sh }, [r.sh.buffer as ArrayBuffer]);
  } catch (cause) {
    scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) }, []);
  }
};
