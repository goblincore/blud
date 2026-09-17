import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createCharacterView } from './character-view';
import { loadKit } from './kit-overlay';
import { loadHeldProp } from './held-prop';

vi.mock('./kit-overlay', () => ({ loadKit: vi.fn() }));
vi.mock('./held-prop', () => ({ loadHeldProp: vi.fn() }));
vi.mock('./zombie-gpu', () => ({ createZombieGpuView: () => ({ dispose: vi.fn() }) }));

function attachment() {
  const object = new THREE.Group();
  const debris = new THREE.Group();
  return { object, debris, dispose: vi.fn(() => debris.removeFromParent()) };
}

function soldier(scene: THREE.Scene) {
  return createCharacterView({
    name: 'soldier', start: [0, 0, 0], scene, errors: [],
    renderer: {} as THREE.WebGPURenderer, gpu: {} as never,
  });
}

describe('gib equipment retirement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes loaded armor, debris and weapon without disposing the retained flesh view', async () => {
    const kit = attachment(), prop = attachment();
    vi.mocked(loadKit).mockResolvedValue(kit as never);
    vi.mocked(loadHeldProp).mockResolvedValue(prop as never);
    const scene = new THREE.Scene();
    const view = soldier(scene);
    await Promise.resolve();
    expect(kit.object.parent).toBe(scene);
    expect(prop.object.parent).toBe(scene);
    view.retireEquipment();
    expect(scene.children).toHaveLength(0);
    expect(view.gpu.dispose).not.toHaveBeenCalled();
    view.retireEquipment();
    view.dispose();
    expect(kit.dispose).toHaveBeenCalledTimes(1);
    expect(prop.dispose).toHaveBeenCalledTimes(1);
    expect(view.gpu.dispose).toHaveBeenCalledTimes(1);
  });

  it('never attaches armor or weapon that finishes loading after gibbing', async () => {
    const kit = attachment(), prop = attachment();
    let finishKit!: (value: never) => void;
    let finishProp!: (value: never) => void;
    vi.mocked(loadKit).mockReturnValue(new Promise(resolve => { finishKit = resolve; }));
    vi.mocked(loadHeldProp).mockReturnValue(new Promise(resolve => { finishProp = resolve; }));
    const scene = new THREE.Scene();
    const view = soldier(scene);
    view.retireEquipment();
    finishKit(kit as never);
    finishProp(prop as never);
    await Promise.resolve();
    expect(scene.children).toHaveLength(0);
    expect(view.kit).toBeNull();
    expect(view.prop).toBeNull();
    expect(kit.dispose).toHaveBeenCalledTimes(1);
    expect(prop.dispose).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});
