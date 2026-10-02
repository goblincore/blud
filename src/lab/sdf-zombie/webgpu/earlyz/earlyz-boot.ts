// src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.ts
//
// EARLY-Z boot + per-frame glue (spec 2026-10-01). bootEarlyz runs right after the
// renderer exists and BEFORE any crowd material is built: install the r186 builder
// patch, then prove the browser compiles `frag_depth, greater` (D8). Failure leaves
// ctx.crowd.earlyz.on false and the boot is the shipped boot.
import type { GameContext } from '../game-context';
import type { CrowdType } from '../crowd-type';
import { installConservativeDepthPatch, detectConservativeDepth } from './conservative-depth-patch';
import { typeRenderOrder, type TypeDistance } from './type-order';

/** Structural slice of GPUDevice: tsconfig's lib does not promise the WebGPU types. */
type EarlyzDevice = Parameters<typeof detectConservativeDepth>[0] & {
  addEventListener(type: 'uncapturederror', f: (e: { error: { message: string } }) => void): void;
};

/**
 * An experiment flag must never block the boot: every failure below (including a throw)
 * leaves `on` false with a reason and ONE console.warn, and the boot continues as shipped.
 */
export async function bootEarlyz(ctx: GameContext): Promise<void> {
  const state = ctx.crowd.earlyz;
  state.flag = true;
  const off = (reason: string | null): void => {
    state.on = false;
    state.reason = reason ?? 'unknown';
    console.warn(`[earlyz] off for this boot: ${state.reason}`);
  };
  try {
    const patch = installConservativeDepthPatch();
    if (!patch.installed) { off(patch.reason); return; }
    const backend = ctx.boot.handle.renderer.backend as unknown as { device?: EarlyzDevice } | undefined;
    const device = backend?.device;
    if (!device) { off('no GPUDevice on the renderer backend'); return; }
    device.addEventListener('uncapturederror', (e) => {
      if (state.gpuErrors.length < 20) state.gpuErrors.push(String(e.error.message));
    });
    const det = await detectConservativeDepth(device);
    if (!det.ok) { off(det.reason); return; }
    state.on = true;
    state.reason = null;
    console.info('[earlyz] on: front-face crowd proxies + frag_depth greater + level-depth seed');
  } catch (e) {
    off(`threw: ${String(e)}`);
  }
}

type OrderedType = Pick<CrowdType, 'mesh' | 'frontMesh' | 'earlyzBatches'>;

/** D7 (amended): seed, then back batches, then front batches, each near-to-far. */
export function applyEarlyzRenderOrder(types: ReadonlyMap<string, OrderedType>): void {
  const rows: TypeDistance[] = [];
  for (const [key, t] of types) {
    const b = t.earlyzBatches();
    rows.push({ key, nearestBack: b.nearestBack, nearestFront: b.nearestFront });
  }
  const order = typeRenderOrder(rows);
  for (const [key, t] of types) {
    const o = order.get(key)!;
    t.mesh.renderOrder = o.back;
    if (t.frontMesh) t.frontMesh.renderOrder = o.front;
  }
}
