import type { PerspectiveCamera } from 'three/webgpu';
import type { ComputeTileBinding } from './tile-bin-compute';
import type { ViewTileBinding } from './zombie-gpu';
import { TILE_MAX_ENTRIES, TILE_SIZE_PX, type TileGroupInput } from './tile-cull';

export interface GameTileGrid { widthPx: number; heightPx: number }
export interface GameTileView {
  tiles?: ViewTileBinding;
  getTileGroups(): TileGroupInput[];
  uniforms: { counts: { value: { w: number } } };
}
export interface GameTileDiagnostics {
  allowed: boolean;
  enabled: boolean;
  rayCull: boolean;
  bound: number;
  active: number;
  fallbacks: { gridOverflow: number; groupOverflow: number; missingBinding: number };
}
export interface GameTilePlaytestOptions {
  allowed: boolean;
  initiallyEnabled?: boolean;
  /** Maximum of current SDF size and supported resolution rungs. */
  capacity(): GameTileGrid;
  createBinding(widthPx: number, heightPx: number): ComputeTileBinding;
}

/**
 * Actor-only opt-in controller. Detached chunks retain their group-cull path.
 * Call refresh after actor uploads and camera matrices settle, before draw.
 * Bindings are owned here; view disposal does not dispose them. The current
 * compute binding only closes its JS handle; GPU cache lifetime is renderer-owned.
 */
export function createGameTilePlaytest(options: GameTilePlaytestOptions) {
  type Allocation = { binding: ComputeTileBinding; tilesX: number; tilesY: number };
  const owned = new Map<ComputeTileBinding, Allocation>();
  const tracked = new Map<GameTileView, Allocation>();
  let enabled = options.allowed && (options.initiallyEnabled ?? true);
  let rayCull = false;
  let disposed = false;
  let active = 0;
  const emptyFallbacks = () => ({ gridOverflow: 0, groupOverflow: 0, missingBinding: 0 });
  let fallbacks = emptyFallbacks();

  return {
    createBinding(): ComputeTileBinding | undefined {
      if (!options.allowed || disposed) return undefined;
      const capacity = options.capacity();
      const binding = options.createBinding(capacity.widthPx, capacity.heightPx);
      owned.set(binding, {
        binding,
        tilesX: Math.ceil(Math.max(1, capacity.widthPx) / TILE_SIZE_PX),
        tilesY: Math.ceil(Math.max(1, capacity.heightPx) / TILE_SIZE_PX),
      });
      return binding;
    },
    /** Immediately follows construction with this controller's optional binding. */
    track(view: GameTileView, binding: ComputeTileBinding | undefined) {
      view.tiles?.setEnabled(false);
      if (!binding) return;
      const allocation = owned.get(binding);
      if (!allocation || disposed) throw new Error('Game tile binding is not owned by this controller');
      view.tiles?.setRayCull(rayCull);
      tracked.set(view, allocation);
    },
    refresh(camera: PerspectiveCamera, grid: GameTileGrid, liveViews: Iterable<GameTileView>) {
      const live = new Set(liveViews);
      for (const [view, allocation] of tracked) {
        if (live.has(view)) continue;
        view.tiles?.setEnabled(false);
        allocation.binding.dispose();
        owned.delete(allocation.binding);
        tracked.delete(view);
      }
      active = 0;
      fallbacks = emptyFallbacks();
      if (!enabled || disposed) return;
      const tilesX = Math.ceil(Math.max(1, grid.widthPx) / TILE_SIZE_PX);
      const tilesY = Math.ceil(Math.max(1, grid.heightPx) / TILE_SIZE_PX);
      for (const view of live) {
        // Never enable with stale data, including a frame that cannot be binned.
        view.tiles?.setEnabled(false);
        const allocation = tracked.get(view);
        if (!allocation || !view.tiles) {
          fallbacks.missingBinding++;
          continue;
        }
        if (!Number.isFinite(tilesX) || !Number.isFinite(tilesY)
          || tilesX > allocation.tilesX || tilesY > allocation.tilesY) {
          fallbacks.gridOverflow++;
          continue;
        }
        const groups = view.getTileGroups();
        if (groups.length > TILE_MAX_ENTRIES) {
          fallbacks.groupOverflow++;
          continue;
        }
        // Unexpected compute failures propagate: capacity fallback must not hide
        // a shader/renderer failure. Only a completed submission enables the fold.
        view.tiles.bin(groups, camera, view.uniforms.counts.value.w, grid);
        view.tiles.setEnabled(true);
        active++;
      }
    },
    /** Per-ray sphere compaction (prototype lever). Applies to every tracked
     *  view now and to views tracked later. */
    setRayCull(on: boolean) {
      rayCull = on;
      for (const view of tracked.keys()) view.tiles?.setRayCull(on);
    },
    setEnabled(on: boolean) {
      enabled = options.allowed && !disposed && on;
      if (enabled) return; // The next refresh bins before enabling any view.
      for (const view of tracked.keys()) view.tiles?.setEnabled(false);
      active = 0;
      fallbacks = emptyFallbacks();
    },
    /** Counts actor views for the latest refresh; fallback causes are exclusive. */
    diagnostics(): GameTileDiagnostics {
      return { allowed: options.allowed, enabled, rayCull, bound: tracked.size, active, fallbacks: { ...fallbacks } };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      for (const view of tracked.keys()) view.tiles?.setEnabled(false);
      for (const allocation of owned.values()) allocation.binding.dispose();
      tracked.clear();
      owned.clear();
      active = 0;
      fallbacks = emptyFallbacks();
    },
  };
}
