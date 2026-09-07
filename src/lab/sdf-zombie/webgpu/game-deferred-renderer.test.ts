// src/lab/sdf-zombie/webgpu/game-deferred-renderer.test.ts
//
// M2 task 5 unit tests for the pieces of the game deferred wiring that are
// testable WITHOUT a WebGPU device: the boot-mode resolution (the spec's
// "absent/legacy selects old path, deferred selects new path, unsupported
// explicit deferred reports a visible error") and the environment adapter.
// The coordinator's frame composition is exercised on the real device by the
// task-5 GPU boot check and formalised by the task-6 gate; per the global
// constraint, unit tests alone never certify runtime behaviour.
//
// COMPOSITION REVIEW FIX (2026-09-07): the coordinator itself is now driven
// here with a recording mock renderer — the REAL layer/router/shadow
// factories construct pure-JS against it (deferred-layer.test.ts and
// deferred-shadows.test.ts are the precedent) — so the OUTPUT-TARGET
// forwarding, the canvas-depth opt-in and the forward pass's submitted
// target are pinned by tests that observe actual submissions, not by boot
// shape alone.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createGameDeferredRenderer,
  resolveGameBootMode,
  deferredEnvironmentFromRig,
  type GameDeferredRenderer,
} from './game-deferred-renderer';
import { DUNGEON_RIG, GALLERY_RIG } from './dungeon-lighting';
import { DEFERRED_ENVIRONMENT_DEFAULTS } from './deferred-layer';

describe('resolveGameBootMode — the boot ?renderer= contract', () => {
  it('absent param selects the legacy path', () => {
    const boot = resolveGameBootMode(null, 'webgpu');
    expect(boot.mode).toBe('legacy');
    expect(boot.fatal).toBeNull();
    expect(boot.warning).toBeNull();
  });

  it('empty param selects the legacy path', () => {
    const boot = resolveGameBootMode('', 'webgpu');
    expect(boot.mode).toBe('legacy');
    expect(boot.fatal).toBeNull();
  });

  it("explicit 'legacy' selects the legacy path silently", () => {
    const boot = resolveGameBootMode('legacy', 'webgpu');
    expect(boot.mode).toBe('legacy');
    expect(boot.fatal).toBeNull();
    expect(boot.warning).toBeNull();
  });

  it("explicit 'deferred' selects the deferred path on webgpu", () => {
    const boot = resolveGameBootMode('deferred', 'webgpu');
    expect(boot.mode).toBe('deferred');
    expect(boot.fatal).toBeNull();
  });

  it("explicit 'deferred' on a non-webgpu backend is FATAL, never a silent legacy boot", () => {
    // WebGPURenderer silently falls back to WebGL; the backend string is the
    // only honest signal (lab-renderer.ts). The boot mode must say so.
    for (const backend of ['webgl', 'webgl2', '']) {
      const boot = resolveGameBootMode('deferred', backend);
      expect(boot.mode).toBe('deferred');
      expect(boot.fatal).not.toBeNull();
      expect(boot.fatal).toContain('WebGPU');
      expect(boot.warning).toBeNull();
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveGameBootMode('Deferred', 'webgpu').mode).toBe('deferred');
    expect(resolveGameBootMode(' DEFERRED ', 'webgpu').mode).toBe('deferred');
    expect(resolveGameBootMode(' Legacy ', 'webgpu').mode).toBe('legacy');
  });

  it('an unknown value boots legacy with a visible warning', () => {
    const boot = resolveGameBootMode('fast', 'webgpu');
    expect(boot.mode).toBe('legacy');
    expect(boot.fatal).toBeNull();
    expect(boot.warning).toContain('fast');
  });
});

describe('deferredEnvironmentFromRig — the game rig to layer environment adapter', () => {
  it('maps the DUNGEON rig to a near-black ambient and real fog', () => {
    const env = deferredEnvironmentFromRig(DUNGEON_RIG);
    expect(env.fogEnabled).toBe(true);
    expect(env.fogNear).toBe(DUNGEON_RIG.fogNear);
    expect(env.fogFar).toBe(DUNGEON_RIG.fogFar);
    expect(env.fogColor.getHex()).toBe(new THREE.Color(...DUNGEON_RIG.fogColor).getHex());
    // The dungeon's ambient must stay DARK: total < 0.05 per channel, or the
    // "dungeon stays dark" requirement is gone before the beam is priced.
    expect(env.ambient.r).toBeLessThan(0.05);
    expect(env.ambient.g).toBeLessThan(0.05);
    expect(env.ambient.b).toBeLessThan(0.05);
    expect(env.ambient.r).toBeGreaterThan(0);
  });

  it('maps the GALLERY rig to a bright ambient (the A/B rig must survive)', () => {
    const env = deferredEnvironmentFromRig(GALLERY_RIG);
    expect(env.ambient.r).toBeGreaterThan(0.5);
    expect(env.fogEnabled).toBe(true);
  });

  it('ambient = ambient*intensity + hemiSky*hemiIntensity/2 (the documented fold)', () => {
    const rig = {
      ambientColor: [0.5, 0.6, 0.7] as const,
      ambientIntensity: 0.4,
      hemiSky: [1, 0.8, 0.6] as const,
      hemiIntensity: 0.2,
      fogColor: [0, 0, 0] as const,
      fogNear: 1,
      fogFar: 10,
    };
    const env = deferredEnvironmentFromRig(rig);
    expect(env.ambient.r).toBeCloseTo(0.5 * 0.4 + 1 * 0.1, 1e-6);
    expect(env.ambient.g).toBeCloseTo(0.6 * 0.4 + 0.8 * 0.1, 1e-6);
    expect(env.ambient.b).toBeCloseTo(0.7 * 0.4 + 0.6 * 0.1, 1e-6);
  });

  it('returns fresh Color objects the layer can own (no shared-instance aliasing)', () => {
    const a = deferredEnvironmentFromRig(DUNGEON_RIG);
    const b = deferredEnvironmentFromRig(DUNGEON_RIG);
    expect(a.ambient).not.toBe(b.ambient);
    expect(a.fogColor).not.toBe(b.fogColor);
  });

  it('M1 defaults stay untouched by the adapter (fog off, fixture ambient)', () => {
    // The adapter is game-wiring only; it must not have moved the M1 fixture
    // defaults that the deferred-layer tests pin.
    expect(DEFERRED_ENVIRONMENT_DEFAULTS.fogEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The coordinator itself, driven against a recording mock renderer (the
// deferred-shadows.test.ts mock shape, extended with a per-render call log).
// The layer/router/shadow factories are the REAL implementations — pure JS
// construction — so what the tests observe is the actual submission
// sequence, not a re-statement of the wiring.
// ---------------------------------------------------------------------------

function mockCoordinatorRenderer() {
  let current: THREE.RenderTarget | null = null;
  let mrt: unknown = null;
  let depth = 1;
  let clearR = 0, clearG = 0, clearB = 0, clearA = 1;
  /** One entry per renderer.render: the bound target and whether the camera
   *  was the layer's ortho quad camera (fullscreen passes) or a perspective
   *  scene camera (producers and the forward draw). */
  const calls: { target: THREE.RenderTarget | null; ortho: boolean }[] = [];
  const render = vi.fn((scene: THREE.Scene, cam: THREE.Camera) => {
    calls.push({ target: current, ortho: (cam as THREE.OrthographicCamera).isOrthographicCamera === true });
  });
  const renderer = {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    getMRT: () => mrt,
    setMRT: (m: unknown) => { mrt = m; },
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    getClearDepth: () => depth,
    setClearDepth: (d: number) => { depth = d; },
    setClearColor: (c: THREE.Color, a: number) => { clearR = c.r; clearG = c.g; clearB = c.b; clearA = a; },
    getClearColor: (out: THREE.Color) => { out?.setRGB(clearR, clearG, clearB); return out ?? new THREE.Color(clearR, clearG, clearB); },
    getClearAlpha: () => clearA,
    render,
  } as unknown as THREE.WebGPURenderer;
  return { renderer, render, calls, getCurrent: () => current };
}

/** A coordinator over an empty room: one flashlight candidate, dungeon env,
 *  small layer so the tests stay cheap. */
function makeCoordinator(renderer: THREE.WebGPURenderer): GameDeferredRenderer {
  const scene = new THREE.Scene();
  const spot = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
  spot.position.set(0, 2, 0);
  scene.add(spot, spot.target);
  return createGameDeferredRenderer({
    renderer,
    scene,
    lights: () => [{ id: 'flashlight', role: 'flashlight', light: spot }],
    environment: () => deferredEnvironmentFromRig(DUNGEON_RIG),
    flashlight: spot,
    width: 64,
    height: 48,
  });
}

describe('the coordinator frame composition (mock-device, real factories)', () => {
  it('forwards the post-aa target to the layer and keeps canvas depth off', () => {
    const mock = mockCoordinatorRenderer();
    const api = makeCoordinator(mock.renderer);
    const rt = new THREE.RenderTarget(64, 48, { depthBuffer: true });
    api.setOutputTarget(rt);
    const diag = api.diagnostics();
    expect(diag.sizes.outputTarget).toEqual({ width: 64, height: 48 });
    expect(diag.canvasDepthWrites).toBe(false);
    api.dispose();
    rt.dispose();
  });

  it('opts the layer into canvas-depth writes exactly when the target is null', () => {
    const mock = mockCoordinatorRenderer();
    const api = makeCoordinator(mock.renderer);
    // Post-aa fully off: forward content will draw straight onto the canvas,
    // so the canvas present must carry the resolved scene depth.
    api.setOutputTarget(null);
    expect(api.diagnostics().canvasDepthWrites).toBe(true);
    // Redirect re-entry flips it back — the null/nonnull TRANSITION the game
    // hits whenever the panel toggles the last post effect.
    const rt = new THREE.RenderTarget(64, 48, { depthBuffer: true });
    api.setOutputTarget(rt);
    expect(api.diagnostics().canvasDepthWrites).toBe(false);
    api.setOutputTarget(null);
    expect(api.diagnostics().canvasDepthWrites).toBe(true);
    api.dispose();
    rt.dispose();
  });

  it('a null-output frame presents the quad to the canvas, then forwards onto it', () => {
    const mock = mockCoordinatorRenderer();
    const api = makeCoordinator(mock.renderer);
    api.setOutputTarget(null);
    const cam = new THREE.PerspectiveCamera(60, 64 / 48, 0.1, 100);
    cam.position.set(0, 1.6, 4);
    api.render(cam);
    expect(api.diagnostics().frames).toBe(1);
    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
    // The LAST two submissions: the present (layer ortho quad, canvas) and
    // the forward draw (the game camera, canvas — real depth now behind it).
    const present = mock.calls[mock.calls.length - 2]!;
    const forward = mock.calls[mock.calls.length - 1]!;
    expect(present).toEqual({ target: null, ortho: true });
    expect(forward).toEqual({ target: null, ortho: false });
    api.dispose();
  });

  it('a redirected frame presents and forwards onto the SAME caller target', () => {
    const mock = mockCoordinatorRenderer();
    const api = makeCoordinator(mock.renderer);
    const rt = new THREE.RenderTarget(64, 48, { depthBuffer: true });
    api.setOutputTarget(rt);
    const cam = new THREE.PerspectiveCamera(60, 64 / 48, 0.1, 100);
    api.render(cam);
    const present = mock.calls[mock.calls.length - 2]!;
    const forward = mock.calls[mock.calls.length - 1]!;
    expect(present).toEqual({ target: rt, ortho: true });
    expect(forward).toEqual({ target: rt, ortho: false });
    api.dispose();
    rt.dispose();
  });

  it('a throwing frame is recorded and the next frame still composes', () => {
    const mock = mockCoordinatorRenderer();
    const scene = new THREE.Scene();
    const spot = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    scene.add(spot, spot.target);
    let boom = false;
    const api = createGameDeferredRenderer({
      renderer: mock.renderer,
      scene,
      lights: () => {
        if (boom) throw new Error('light list exploded');
        return [{ id: 'flashlight', role: 'flashlight', light: spot }];
      },
      environment: () => deferredEnvironmentFromRig(DUNGEON_RIG),
      flashlight: spot,
      width: 64,
      height: 48,
    });
    api.setOutputTarget(null);
    const cam = new THREE.PerspectiveCamera(60, 64 / 48, 0.1, 100);
    boom = true;
    expect(() => api.render(cam)).not.toThrow();
    const bad = api.diagnostics();
    expect(bad.frames).toBe(1);
    expect(bad.errors.some((e) => e.includes('light list exploded'))).toBe(true);
    // The failed frame presented NOTHING (died before the present) — the
    // recovery frame below must still reach the forward pass.
    boom = false;
    api.render(cam);
    const forward = mock.calls[mock.calls.length - 1]!;
    expect(forward).toEqual({ target: null, ortho: false });
    expect(api.diagnostics().frames).toBe(2);
    api.dispose();
  });
});
