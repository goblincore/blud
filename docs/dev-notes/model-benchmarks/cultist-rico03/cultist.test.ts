import { describe, it, expect, vi, Mock } from 'vitest';
import { Cultist, GibbableDude } from './cultist';
import { CultistBrain, CultistState, CultistBrainHooks } from './cultist-ai';
import { CULTIST_TOMMY } from '../gibs/tuning';
import type { Sfx } from '../../audio/sfx';
import type { Vec3 } from '../gibs/particles';

/** Minimal mock Sfx — stubs all events to void. */
function makeMockSfx(): Sfx {
  return {
    play: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    setPitch: vi.fn(),
    isPlaying: vi.fn(() => false),
  };
}

/** Minimal mock brain hooks. */
function makeMockHooks(): CultistBrainHooks {
  return {
    onAggroTransition: vi.fn(),
    onShot: vi.fn(),
  };
}

/** Minimal mock BillboardAnimator. */
function makeMockAnim() {
  const mock = {
    play: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
    object: { visible: true } as unknown as THREE.Object3D,
  };
  return mock;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cultist', () => {
  it('implements GibbableDude interface', () => {
    const mockAnim = makeMockAnim();
    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim as unknown as BillboardAnimator);
    expect(c.id).toBe('test-cultist');
    expect(c.kind).toBe('cultist');
  });

  it('sets initial state from CULTIST_TOMMY tuning', () => {
    const mockAnim = makeMockAnim();
    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim as unknown as BillboardAnimator);

    // Brain state should be Idle by default
    expect(c.brain.state).toBe(CultistState.Idle);
    // hp should match CULTIST_TOMMY
    expect(c.hp).toBe(CULTIST_TOMMY.hp);
  });

  it('per-frame update calls brain.update with correct args', () => {
    const mockAnim = makeMockAnim();
    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim as unknown as BillboardAnimator);

    const playerPos: Vec3 = { x: 10, y: 0, z: 10 };

    // Spy on brain.update
    const updateSpy = vi.spyOn(c.brain, 'update');

    c.update(0.016, playerPos, null as unknown as THREE.Camera);

    expect(updateSpy).toHaveBeenCalledWith(0.016, c.pos, playerPos);
  });

  it('takeDamage drops hp and triggers stagger via brain', () => {
    const mockAnim = makeMockAnim();
    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim as unknown as BillboardAnimator);

    const initialHp = c.hp;
    const impulse: Vec3 = { x: 100, y: 50, z: 100 };

    c.takeDamage(10, impulse);

    // hp should decrease
    expect(c.hp).toBeLessThan(initialHp);
    // brain state should reflect damage
    expect(c.brain.state).toBe(CultistState.Stagger);
  });

  it('despawn is idempotent', () => {
    const mockScene = {
      remove: vi.fn(),
    } as unknown as THREE.Scene;
    const mockWorld = {
      removeRigidBody: vi.fn(),
    } as unknown as RAPIER.World;
    const mockAnim = {
      play: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
      object: { visible: true },
    } as unknown as BillboardAnimator;

    const c = new Cultist('test-cultist', mockWorld, mockScene, null as unknown as RAPIER.RigidBody, mockAnim);

    // First call
    c.despawn();
    expect(mockScene.remove).toHaveBeenCalledTimes(1);
    expect(mockWorld.removeRigidBody).toHaveBeenCalledTimes(1);
    expect(mockAnim.dispose).toHaveBeenCalledTimes(1);

    // Second call should not error
    c.despawn();
    expect(mockScene.remove).toHaveBeenCalledTimes(1);
  });

  it('onGibbed hides the anim object', () => {
    let visible = true;
    const mockAnim = {
      play: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
      object: {
        get visible() { return visible; },
        set visible(val: boolean) { visible = val; },
      },
    } as unknown as BillboardAnimator;

    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim);

    c.onGibbed();
    expect(visible).toBe(false);
  });

  it('shouldReap returns true when brain says dead', () => {
    const mockAnim = makeMockAnim();
    const c = new Cultist('test-cultist', null as unknown as RAPIER.World, null as unknown as THREE.Scene, null as unknown as RAPIER.RigidBody, mockAnim as unknown as BillboardAnimator);

    // Initially should not reap
    expect(c.shouldReap()).toBe(false);

    // Make brain report dead
    c.brain.state = CultistState.Dead;
    expect(c.shouldReap()).toBe(true);
  });
});
