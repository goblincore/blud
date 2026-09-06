import { bakeChunkGeometry } from './chunk-bake-geometry';
import { packChunkBake, chunkBakeTransfers } from './chunk-bake-buffers';
import type { ChunkBakeRequest, ChunkBakeReply } from './chunk-bake-jobs';

// Structural worker scope keeps the page's DOM and worker lib declarations separate.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ChunkBakeRequest>) => void) | null;
  postMessage(message: ChunkBakeReply, transfer: ArrayBuffer[]): void;
};
scope.onmessage = ({ data: { id, data } }) => {
  try {
    const baked = bakeChunkGeometry(data);
    const result = packChunkBake(baked);
    baked.geometry.dispose();
    scope.postMessage({ id, result }, chunkBakeTransfers(result));
  } catch (cause) {
    scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) }, []);
  }
};
