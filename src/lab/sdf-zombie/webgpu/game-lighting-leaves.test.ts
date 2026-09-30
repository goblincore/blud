// levelSceneLights: which scene lights the level's per-room materials shade.
//
// Regression (owner playtest 2026-09-30, night-train): the flashlight's KIT twin (kit-lights.ts) is added to the
// scene so its matrices update, and relies on KIT_BEAM_LAYER to stay out of "the light list". But the level's
// per-room lists are built by traversing the SCENE, which ignores camera layers: the twin lit every room's walls
// as a full-strength torch that no flashlightGate switch reaches -- a torch-shaped disc on the walls at the start
// (torch not yet picked up), bodies dark (their beam IS gated), and a doubled torch on the level afterwards.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { levelSceneLights } from './game-lighting-leaves';
import { KIT_BEAM_LAYER } from './kit-lights';
import { createFlashlight } from './dungeon-lighting';
import type { GameContext } from './game-context';

function fakeCtx(scene: THREE.Scene): GameContext {
  return {
    boot: { handle: { scene } },
    lighting: { levelListOn: false },
    world: { level: { tunnels: [] } },
  } as unknown as GameContext;
}

describe('levelSceneLights', () => {
  it('keeps the flashlight and the lamps, and leaves the kit twin out (it only lights kit materials)', () => {
    const scene = new THREE.Scene();
    const f = createFlashlight();
    const lamp = new THREE.PointLight(0xffffff, 1);
    scene.add(f.spot, f.levelShadow, f.kitSpot, lamp);

    const lights = levelSceneLights(fakeCtx(scene), 1);

    expect(f.kitSpot.layers.isEnabled(KIT_BEAM_LAYER)).toBe(true);
    expect(lights).not.toContain(f.kitSpot);
    expect(lights).toContain(f.spot);
    expect(lights).toContain(lamp);
  });
});
