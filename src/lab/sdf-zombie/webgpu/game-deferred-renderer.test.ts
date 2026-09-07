// src/lab/sdf-zombie/webgpu/game-deferred-renderer.test.ts
//
// M2 task 5 unit tests for the pieces of the game deferred wiring that are
// testable WITHOUT a WebGPU device: the boot-mode resolution (the spec's
// "absent/legacy selects old path, deferred selects new path, unsupported
// explicit deferred reports a visible error") and the environment adapter.
// The coordinator's frame composition is exercised on the real device by the
// task-5 GPU boot check and formalised by the task-6 gate; per the global
// constraint, unit tests alone never certify runtime behaviour.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  resolveGameBootMode,
  deferredEnvironmentFromRig,
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
