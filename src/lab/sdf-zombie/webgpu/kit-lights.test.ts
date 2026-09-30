import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available under vitest (same arrangement as other source pins)
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { KitLightsNode, KIT_BEAM_LAYER, applyKitBeam, setKitBeam, swapLight } from './kit-lights';
import { createFlashlight } from './dungeon-lighting';
import { fitMeshBeam } from '../mesh-beam-fit';

afterEach(() => setKitBeam(null));

describe('swapLight', () => {
  it('replaces the flashlight and nothing else', () => {
    expect(swapLight(['amb', 'spot', 'fire'], 'spot', 'kit')).toEqual(['amb', 'kit', 'fire']);
    expect(swapLight(['amb', 'fire'], 'spot', 'kit')).toEqual(['amb', 'fire']);
  });
});

describe('KitLightsNode', () => {
  it('mirrors the scene LightsNode it is built against, with the flashlight swapped', () => {
    const spot = new THREE.SpotLight(), twin = new THREE.SpotLight(), amb = new THREE.AmbientLight();
    const scene = new THREE.LightsNode().setLights([amb, spot]);
    const kit = new KitLightsNode(spot, twin);
    expect(kit.getBuiltinLights()).toEqual([]);
    kit.bindSource({ lightsNode: scene });
    expect(kit.getBuiltinLights()).toEqual([amb, twin]);
    // The scene list is replaced each frame (RenderList.finish): follow it.
    scene.setLights([amb]);
    expect(kit.getLights()).toEqual([amb]);
    expect(kit.hasLights).toBe(true);
    // Never binds to itself (LightsNode.setup sets builder.lightsNode = this).
    kit.bindSource({ lightsNode: kit });
    expect(kit.getLights()).toEqual([amb]);
  });
});

describe('applyKitBeam', () => {
  it('is a no-op until the game registers a kit beam (the lab keeps scene lighting)', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    expect(applyKitBeam(mesh)).toBe(0);
    expect((mesh.material as unknown as { lightsNode?: unknown }).lightsNode).toBeUndefined();
  });

  it('routes lit materials (core glTF MeshStandardMaterial included) and skips unlit ones', () => {
    const node = new KitLightsNode(new THREE.SpotLight(), new THREE.SpotLight());
    setKitBeam(node);
    const g = new THREE.Group();
    const lit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const unlit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    g.add(lit, unlit);
    expect(applyKitBeam(g)).toBe(1);
    expect((lit.material as unknown as { lightsNode: unknown }).lightsNode).toBe(node);
    expect((unlit.material as unknown as { lightsNode?: unknown }).lightsNode ?? null).toBeNull();
    expect(applyKitBeam(g)).toBe(0); // idempotent
  });
});

describe('createFlashlight kit twin', () => {
  it('carries the fitted beam, casts no shadow, and sits on a layer no camera sees', () => {
    const f = createFlashlight();
    const fit = fitMeshBeam({ gain: 4, range: f.spot.distance });
    expect(f.kitSpot.decay).toBeCloseTo(fit.decay, 6);
    expect(f.kitSpot.distance).toBeCloseTo(fit.distance, 6);
    expect(f.kitSpot.intensity).toBeCloseTo(fit.intensity, 6);
    expect(f.kitSpot.castShadow).toBe(false);
    expect(f.kitSpot.angle).toBe(f.spot.angle);
    expect(f.kitSpot.penumbra).toBe(f.spot.penumbra);
    expect(f.kitSpot.color.equals(f.spot.color)).toBe(true);
    const cam = new THREE.PerspectiveCamera();
    expect(f.kitSpot.layers.test(cam.layers)).toBe(false);
    expect(f.kitSpot.layers.isEnabled(KIT_BEAM_LAYER)).toBe(true);
    // The level keeps the shipped flashlight.
    expect(f.spot.intensity).toBe(90);
    expect(f.spot.decay).toBe(1.6);
  });

  it('follows the flashlight pose and the live beam gain', () => {
    const f = createFlashlight();
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(1, 2, 3);
    cam.lookAt(4, 2, 3);
    f.update(cam);
    expect(f.kitSpot.position.distanceTo(f.spot.position)).toBeLessThan(1e-9);
    expect(f.kitSpot.target).toBe(f.spot.target);
    f.setKitBeamGain(8);
    expect(f.kitSpot.intensity).toBeCloseTo(fitMeshBeam({ gain: 8, range: f.spot.distance }).intensity, 6);
  });

  it('switches fully off at gain 0 (the flashlight gate closed)', () => {
    const f = createFlashlight();
    f.setKitBeamGain(0);
    expect(f.kitSpot.intensity).toBe(0);
  });

  it('is scaled by the flashlight gate in the game loop, like the spot and the body beam', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8') as string;
    expect(src).toContain('setKitBeamGain(ctx.vfx.beamTuning.gain * flashlightGate(ctx))');
  });
});
