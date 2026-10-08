// src/lab/sdf-zombie/webgpu/goo-layer-test-support.ts
//
// Recording stub renderer and fixtures for the behavioural goo-layer tests:
// the real createGooLayer runs its real sync()/render() against this stub
// (the trick goo-upload.test.ts proved), and every renderer call the layer
// makes — setRenderTarget, setClearColor with colour AND alpha, render with
// the scene, the quad material it drew with and the target active at that
// moment — lands in one ordered log the tests assert on. Only GPU submission
// is stubbed; scenes, targets, materials, uniforms and instanced attributes
// are real Three objects, so assertions read state the layer itself built.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createGooLayer, type GooLayer } from './goo-layer';
import type { BloodSim, Droplet } from '../blood-sim';

/** One recorded renderer interaction, in call order. A `mark` is pushed by
 *  test code (typically from render()'s `between` callback) so assertions
 *  can talk about "before/after the middle of the frame". */
export type GooLogEntry =
  | { kind: 'target'; target: THREE.RenderTarget | null }
  | { kind: 'clear'; color: number; alpha: number }
  | {
    kind: 'render';
    scene: THREE.Scene;
    /** Material of the first mesh in the scene (quad scenes carry exactly
     *  one fullscreen quad; the density scene carries the instancer). */
    material: THREE.Material | undefined;
    /** The render target active when the call was made (null = canvas). */
    target: THREE.RenderTarget | null;
  }
  | { kind: 'mark'; label: string };

export interface GooRecordingLog {
  /** Every recorded interaction, in order. */
  readonly entries: GooLogEntry[];
  /** Push a marker into the ordered log (e.g. from `between`). */
  mark(label: string): void;
  /** Drop everything recorded so far. The stub's clear colour/alpha state
   *  survives, so restore semantics keep being exercised across resets. */
  reset(): void;
  /** Render calls only, in order. */
  renders(): Extract<GooLogEntry, { kind: 'render' }>[];
  /** setClearColor calls only, in order. */
  clears(): Extract<GooLogEntry, { kind: 'clear' }>[];
  /** Renders of the layer's empty scene — its explicit first-clear probes
   *  after (re)allocation (the lazy-init/submit-rejection trap). */
  initClears(): Extract<GooLogEntry, { kind: 'render' }>[];
  /** Renders whose scene actually draws something (skips the init clears). */
  draws(): Extract<GooLogEntry, { kind: 'render' }>[];
  /** Distinct targets that non-init renders drew to, in first-seen order. */
  drawnTargets(): (THREE.RenderTarget | null)[];
}

/**
 * The stub renderer, in the shape goo-layer calls it. The default clear
 * colour is the game's scene background (0x1a1116) so "the layer restored
 * the previous clear" is distinguishable from "the layer cleared black" —
 * both show up as real hex numbers in the log.
 */
export function createRecordingGooRenderer(width = 800, height = 600): {
  renderer: THREE.WebGPURenderer;
  log: GooRecordingLog;
} {
  const entries: GooLogEntry[] = [];
  const clear = { color: new THREE.Color(0x1a1116), alpha: 1 };
  let active: THREE.RenderTarget | null = null;
  const renderer = {
    domElement: { width, height },
    autoClear: true,
    setRenderTarget(t: THREE.RenderTarget | null) {
      active = t;
      entries.push({ kind: 'target', target: t });
    },
    setClearColor(color: THREE.ColorRepresentation, alpha = 1) {
      clear.color.set(color);
      clear.alpha = alpha;
      entries.push({ kind: 'clear', color: clear.color.getHex(), alpha });
    },
    getClearColor(out: THREE.Color) { return out.copy(clear.color); },
    getClearAlpha: () => clear.alpha,
    render(scene: THREE.Scene) {
      const mesh = scene.children.find((o): o is THREE.Mesh | THREE.InstancedMesh =>
        (o as THREE.Mesh).isMesh === true || (o as THREE.InstancedMesh).isInstancedMesh === true,
      );
      entries.push({
        kind: 'render',
        scene,
        material: mesh?.material as THREE.Material | undefined,
        target: active,
      });
    },
  } as unknown as THREE.WebGPURenderer;
  const renders = () => entries.filter((e): e is Extract<GooLogEntry, { kind: 'render' }> => e.kind === 'render');
  const log: GooRecordingLog = {
    entries,
    mark(label) { entries.push({ kind: 'mark', label }); },
    reset() { entries.length = 0; },
    renders,
    clears: () => entries.filter((e): e is Extract<GooLogEntry, { kind: 'clear' }> => e.kind === 'clear'),
    initClears: () => renders().filter((r) => r.scene.children.length === 0),
    draws: () => renders().filter((r) => r.scene.children.length > 0),
    drawnTargets: () => {
      const seen = new Set<THREE.RenderTarget | null>();
      const out: (THREE.RenderTarget | null)[] = [];
      for (const r of log.draws()) {
        if (!seen.has(r.target)) { seen.add(r.target); out.push(r.target); }
      }
      return out;
    },
  };
  return { renderer, log };
}

/** A goo layer over the recording stub, plus a scene camera pointed at the
 *  droplets gooSim places. Dispose when done (see goo-upload.test.ts). */
export function gooLayerFixture(): {
  layer: GooLayer;
  camera: THREE.PerspectiveCamera;
  log: GooRecordingLog;
  render(between?: () => void): void;
  dispose(): void;
} {
  const { renderer, log } = createRecordingGooRenderer();
  const layer = createGooLayer(renderer, {
    lightDir: uniform(new THREE.Vector3(0, 1, 0)),
    keyColor: uniform(new THREE.Vector3(1, 1, 1)),
    lightCfg: uniform(new THREE.Vector4(1, 1, 1, 1)),
  });
  const camera = new THREE.PerspectiveCamera(65, 800 / 600, 0.1, 200);
  camera.position.set(1, 1.6, 2);
  camera.lookAt(0, 1, -3);
  camera.updateMatrixWorld();
  return {
    layer,
    camera,
    log,
    render: (between) => layer.render(camera, between ?? (() => {})),
    dispose: () => layer.dispose(),
  };
}

/** Droplets in front of the fixture camera, near (0, 1, -3). */
export function gooDroplets(count: number, init?: (i: number) => Partial<Droplet>): Droplet[] {
  return Array.from({ length: count }, (_, i): Droplet => ({
    pos: [i * 0.03, 1 + i * 0.01, -3],
    vel: [i * 0.1, 2, -1],
    size: 0.2,
    age: 0.1,
    life: 2,
    kind: 'drop',
    ...init?.(i),
  }));
}

/** A BloodSim of gooDroplets plus optional splats on the floor. */
export function gooSim(
  count: number,
  init?: (i: number) => Partial<Droplet>,
  splatCount = 0,
): BloodSim {
  return {
    droplets: gooDroplets(count, init),
    splats: Array.from({ length: splatCount }, (_, i) => ({
      pos: [i * 0.5, 0, -3 - i * 0.2],
      size: 0.3,
      yaw: i * 0.7,
    })),
  } as unknown as BloodSim;
}

/** The density InstancedMesh, recovered from a recorded render of the goo
 *  scene (render at least once before calling). This is the mesh sync()
 *  poses, so its count and attributes are the layer's own state. */
export function gooDensityMesh(log: GooRecordingLog): THREE.InstancedMesh {
  for (const r of log.renders()) {
    const mesh = r.scene.children.find((o): o is THREE.InstancedMesh =>
      (o as THREE.InstancedMesh).isInstancedMesh === true,
    );
    if (mesh) return mesh;
  }
  throw new Error('no recorded render carried the density instancer — render once first');
}
