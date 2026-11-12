import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createKitPrewarm } from './game-kit-prewarm';
import { kitPoseSkippable } from './game-zone-cull';
import type { GameContext } from './game-context';

function kit(posed: boolean) {
  const object = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = 'plate';
  object.add(mesh);
  return { object, posed, mesh };
}
function actorWith(k: ReturnType<typeof kit>) {
  return { character: { kit: k, prop: null, entry: { kit: 'x.glb' } }, characterName: () => 'butcher', settled: () => true };
}

describe('the kit pre-warm never draws a kit that stands at the world origin', () => {
  // On a Doom level the player starts AT the origin, so a forced unposed kit is drawn around the camera.
  it('waits for the first pose, then forces it', () => {
    const k = kit(false);
    const ctx = { world: { actors: [actorWith(k)], sightOccluder: {} } } as unknown as GameContext;
    const warm = createKitPrewarm(ctx);
    expect(warm.step()).toBe(false);
    expect(k.mesh.frustumCulled).toBe(true);
    expect(warm.forcedRoot).toBeNull();
    expect(warm.pending).toBeGreaterThan(0);
    k.posed = true;
    expect(warm.step()).toBe(true);
    expect(k.mesh.frustumCulled).toBe(false);
    expect(warm.forcedRoot).toBe(k.object);
  });
});

describe('kitPoseSkippable', () => {
  const ctxFor = (a: unknown) => ({
    world: { zoneCull: { on: true } }, render: { visualActors: new Set() }, boot: { kitPrewarm: { forcedRoot: null } }, a,
  }) as unknown as GameContext;
  const none = new Set<never>();
  it('poses a hidden settled kit once, so it never waits at the origin, then skips it', () => {
    const k = kit(false);
    const a = actorWith(k);
    expect(kitPoseSkippable(ctxFor(a), a as never, none)).toBe(false);
    k.posed = true;
    expect(kitPoseSkippable(ctxFor(a), a as never, none)).toBe(true);
  });
});
