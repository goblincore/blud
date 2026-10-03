// src/lab/sdf-zombie/webgpu/game-rod.test.ts
//
// The rod harness against a stub ctx and a stub actor on the cut-wound fixture body: no renderer, no WebGPU.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRodHarness } from './game-rod';
import { makeWeaponSlotState } from './game-weapon-slots';
import { prim } from '../head-pop';
import type { Primitive, Vec3 } from '../types';
import type { Wound } from '../damage';

const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
const prims: Primitive[] = [torso];
const posed = { prims, clusters: [{ start: 0, count: 1, alive: true }] };

function fixture(live: 'rod' | 'shotgun' = 'rod') {
  const blasts: { wounds: readonly Wound[]; reaction?: string }[] = [];
  const actor = { id: 7, posed: () => posed, pose: () => ({ pos: [0, 0, 0] as Vec3, yaw: 0 }), blast: (e: { wounds: readonly Wound[]; reaction?: string }) => blasts.push(e) };
  const ctx = {
    weapon: { aimRig: new THREE.Group(), slotState: makeWeaponSlotState(live) },
    player: { player: { yaw: 0, pitch: 0 } },
    world: { actors: [actor] },
    boot: {},
    telemetry: { telemetry: { event: vi.fn() } },
  };
  // The crosshair the test sweeps: set per frame, the trace returns it as a hit on actor 7 on the torso's front skin.
  let hit: Vec3 | null = null;
  const bleed = vi.fn();
  const rod = createRodHarness(ctx as never, {
    traceSlugHitFrom: () => (hit ? { actorId: 7, hit } : { actorId: -1, hit: null }),
    eye: () => [0, 1.25, 1] as Vec3,
    aimDir: () => [0, 0, -1] as Vec3,
    bleed,
  });
  return { ctx, rod, blasts, bleed, aim: (p: Vec3 | null) => { hit = p; } };
}

describe('rod harness', () => {
  it('only takes the mouse while it is the live slot', () => {
    const f = fixture('shotgun');
    expect(f.rod.onMouseDown(0)).toBe(false);
    expect(f.rod.debug().held).toBe(false);
  });

  it('cut() stamps one cut wound, blasts it as a flinch and bleeds at the midpoint', () => {
    const f = fixture();
    const n = f.rod.cut(7, [0, 1.15, 0.15], [0, 1.35, 0.15], [0, 0, -1]);
    expect(n).toBe(1);
    expect(f.blasts).toHaveLength(1);
    expect(f.blasts[0]!.reaction).toBe('flinch');
    expect(f.blasts[0]!.wounds[0]!.shape).toBe('cut');
    expect(f.bleed).toHaveBeenCalledTimes(1);
    expect(f.rod.cut(99, [0, 1.15, 0.15], [0, 1.35, 0.15], [0, 0, -1])).toBe(0);
  });

  it('hold, sweep, release: the sweep becomes a cut on the release tick', () => {
    const f = fixture();
    expect(f.rod.onMouseDown(0)).toBe(true);
    for (let i = 0; i < 6; i++) { f.aim([0, 1.1 + i * 0.05, 0.15]); f.rod.tick(1 / 60); }
    expect(f.rod.debug().samples).toBe(6);
    f.rod.onMouseUp(0);
    expect(f.blasts).toHaveLength(0);          // the cut lands on the tick, not on the event
    f.rod.tick(1 / 60);
    expect(f.rod.debug()).toMatchObject({ held: false, samples: 0, lastCuts: 1 });
    expect(f.blasts).toHaveLength(1);
    expect(f.ctx.telemetry.telemetry.event).toHaveBeenCalledWith('rod-cut', { cuts: 1 });
  });

  it('ignores hits beyond the rod reach', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    f.aim([0, 1.25, -5]);                      // eye at z = 1, so 6 m away
    f.rod.tick(1 / 60);
    expect(f.rod.debug().samples).toBe(0);
  });

  it('switching away mid-sweep abandons it: no cut', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    f.aim([0, 1.2, 0.15]); f.rod.tick(1 / 60);
    f.ctx.weapon.slotState = makeWeaponSlotState('shotgun');
    f.rod.tick(1 / 60);
    f.rod.onMouseUp(0);
    f.rod.tick(1 / 60);
    expect(f.blasts).toHaveLength(0);
  });
});
