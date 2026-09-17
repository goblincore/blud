import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import type { ComputeTileBinding } from './tile-bin-compute';
import type { TileGroupInput } from './tile-cull';
import { createGameTilePlaytest, type GameTileView } from './game-tile-playtest';

const camera = new PerspectiveCamera();
const grid = { widthPx: 1280, heightPx: 720 };
const group: TileGroupInput = {
  center: [1, 2, 3], radius: 1, start: 0, count: 1, distort: 0, flags: 0, bodyIndex: 0,
};

function setup(allowed = true) {
  const allocations: { width: number; height: number; disposed: number }[] = [];
  const controller = createGameTilePlaytest({
    allowed, capacity: () => ({ widthPx: 1920, heightPx: 1080 }),
    createBinding(width, height): ComputeTileBinding {
      const allocation = { width, height, disposed: 0 };
      allocations.push(allocation);
      return {
        headerNode: {}, entryNode: {}, bin() { return true; },
        async readback() { throw new Error('No GPU readback in CPU lifecycle test'); },
        dispose() { allocation.disposed++; },
      };
    },
  });
  function actor(groupCount = 1) {
    const binding = controller.createBinding();
    const state = { enabled: false, rayCull: false, bins: [] as { groups: TileGroupInput[]; camera: PerspectiveCamera; blend: number; grid: typeof grid }[] };
    let groups = Array.from({ length: groupCount }, () => ({ ...group }));
    const view: GameTileView = {
      uniforms: { counts: { value: { w: 0.125 } } },
      getTileGroups: () => groups,
      tiles: binding ? {
        setEnabled(on) { state.enabled = on; },
        setRayCull(on) { state.rayCull = on; },
        bin(groups, camera, blend, grid) { state.bins.push({ groups, camera, blend, grid }); return true; },
        dispose() {},
      } : undefined,
    };
    controller.track(view, binding);
    return { view, state, setGroups(count: number) { groups = Array.from({ length: count }, () => ({ ...group })); } };
  }
  return { controller, actor, allocations };
}

describe('game tile playtest lifecycle', () => {
  it('keeps ordinary launches allocation-free even when toggled on', () => {
    const { controller, actor, allocations } = setup(false);
    const a = actor();
    controller.setEnabled(true);
    controller.refresh(camera, grid, [a.view]);
    expect(allocations).toHaveLength(0);
    expect(a.state.enabled).toBe(false);
    expect(controller.diagnostics()).toMatchObject({ allowed: false, enabled: false, bound: 0, active: 0 });
  });

  it('allocates supplied worst-case capacity and bins latest groups before enabling', () => {
    const { controller, actor, allocations } = setup();
    const a = actor();
    expect(a.state.enabled).toBe(false);
    a.setGroups(3);
    controller.refresh(camera, grid, [a.view]);
    expect(allocations).toEqual([{ width: 1920, height: 1080, disposed: 0 }]);
    expect(a.state.bins[0]).toMatchObject({ camera, blend: 0.125, grid });
    expect(a.state.bins[0]?.groups).toHaveLength(3);
    expect(a.state.enabled).toBe(true);
    expect(controller.diagnostics()).toMatchObject({ enabled: true, bound: 1, active: 1 });
  });

  it('disables all views immediately and holds new actors off until a fresh enabled frame', () => {
    const { controller, actor } = setup();
    const a = actor();
    controller.refresh(camera, grid, [a.view]);
    controller.setEnabled(false);
    const b = actor();
    controller.refresh(camera, grid, [a.view, b.view]);
    expect(a.state.enabled).toBe(false);
    expect(b.state.bins).toHaveLength(0);
    controller.setEnabled(true);
    expect(a.state.enabled).toBe(false);
    controller.refresh(camera, grid, [a.view, b.view]);
    expect(a.state.bins).toHaveLength(2);
    expect(a.state.enabled && b.state.enabled).toBe(true);
    expect(controller.diagnostics().active).toBe(2);
  });

  it('pushes the ray-cull lever to tracked views and to views tracked later', () => {
    const { controller, actor } = setup();
    const a = actor();
    expect(a.state.rayCull).toBe(false);
    controller.setRayCull(true);
    expect(a.state.rayCull).toBe(true);
    const b = actor();
    expect(b.state.rayCull).toBe(true);
    expect(controller.diagnostics().rayCull).toBe(true);
    controller.setRayCull(false);
    expect(a.state.rayCull && b.state.rayCull).toBe(false);
  });

  it.each([{ widthPx: 1921, heightPx: 720 }, { widthPx: 1280, heightPx: 1089 }])(
    'falls back rather than binning an oversized grid %j and recovers on a supported rung', (tooLarge) => {
      const { controller, actor } = setup();
      const a = actor();
      controller.refresh(camera, grid, [a.view]);
      controller.refresh(camera, tooLarge, [a.view]);
      expect(a.state.enabled).toBe(false);
      expect(a.state.bins).toHaveLength(1);
      expect(controller.diagnostics().fallbacks.gridOverflow).toBe(1);
      controller.refresh(camera, { widthPx: 1600, heightPx: 900 }, [a.view]);
      expect(a.state.enabled).toBe(true);
      expect(a.state.bins[1]?.grid).toEqual({ widthPx: 1600, heightPx: 900 });
      expect(controller.diagnostics().fallbacks.gridOverflow).toBe(0);
    },
  );

  it('uses full tile capacity when pixel dimensions grow within the last allocated tile', () => {
    const { controller, actor } = setup();
    const a = actor();
    controller.refresh(camera, { widthPx: 1920, heightPx: 1088 }, [a.view]);
    expect(a.state.enabled).toBe(true);
  });

  it('falls back on 65 groups without truncation while 64 groups remain supported', () => {
    const { controller, actor } = setup();
    const a = actor(65);
    const b = actor(64);
    controller.refresh(camera, grid, [a.view, b.view]);
    expect(a.state.enabled).toBe(false);
    expect(a.state.bins).toHaveLength(0);
    expect(b.state.bins[0]?.groups).toHaveLength(64);
    expect(controller.diagnostics()).toMatchObject({ active: 1, fallbacks: { groupOverflow: 1 } });
    a.setGroups(2);
    controller.refresh(camera, grid, [a.view, b.view]);
    expect(a.state.enabled).toBe(true);
    expect(controller.diagnostics().fallbacks.groupOverflow).toBe(0);
  });

  it('releases removed cast bindings once and retains surviving views', () => {
    const { controller, actor, allocations } = setup();
    const a = actor();
    const b = actor();
    controller.refresh(camera, grid, [a.view, b.view]);
    controller.refresh(camera, grid, [b.view]);
    controller.refresh(camera, grid, [b.view]);
    expect(a.state.enabled).toBe(false);
    expect(allocations.map(a => a.disposed)).toEqual([1, 0]);
    expect(controller.diagnostics().bound).toBe(1);
    controller.dispose();
    controller.dispose();
    expect(b.state.enabled).toBe(false);
    expect(allocations.map(a => a.disposed)).toEqual([1, 1]);
  });

  it('reports an unbound live actor without enabling it', () => {
    const { controller } = setup();
    const view: GameTileView = { getTileGroups: () => [group], uniforms: { counts: { value: { w: 0.1 } } } };
    controller.refresh(camera, grid, [view]);
    expect(controller.diagnostics()).toMatchObject({ bound: 0, active: 0, fallbacks: { missingBinding: 1 } });
  });
});
