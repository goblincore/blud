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
import { installPipelineWatch, currentPipelineWatch, type PipelineWatch } from './pipeline-watch';

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
    // Without a way to SEE a failed front pipeline, early-Z could drop bodies silently (three's
    // compileAsync resolves on a failed pipeline, and its draw skips it): refuse rather than run blind.
    if (!installPipelineWatch(ctx.boot.handle.renderer as unknown as Parameters<typeof installPipelineWatch>[0])) {
      off('cannot observe pipeline creation on this backend');
      return;
    }
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

type FrontCheckType = Pick<CrowdType, 'name' | 'frontMesh' | 'earlyzFrontDisabled' | 'disableEarlyzFront'>;

/**
 * GRACEFUL DEGRADATION (final review, Important 2). A front material whose pipeline failed to build
 * is skipped by three's draw, so its bodies would silently vanish. For every type whose front
 * pipeline is reported failed: switch its front batch off (every instance then draws through the
 * shipped back-face batch), record `state.reason` and warn once for that type. Returns the names
 * of the types degraded by THIS call. Cheap enough to call every frame and after each front compile.
 */
export function degradeFailedEarlyzFronts(
  types: ReadonlyMap<string, FrontCheckType>,
  state: { reason: string | null },
  watch: Pick<PipelineWatch, 'failure'> | null = currentPipelineWatch(),
): string[] {
  const degraded: string[] = [];
  if (!watch) return degraded;
  for (const t of types.values()) {
    if (!t.frontMesh || t.earlyzFrontDisabled() !== null) continue;
    const why = watch.failure(t.frontMesh.material as object);
    if (why === null) continue;
    const reason = `front pipeline failed for ${t.name}: ${why}`;
    t.disableEarlyzFront(reason);
    state.reason = reason;
    degraded.push(t.name);
    console.warn(`[earlyz] ${reason}; every ${t.name} body now draws through the shipped back-face batch`);
  }
  return degraded;
}
