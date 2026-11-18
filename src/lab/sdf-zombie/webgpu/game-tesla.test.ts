// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-tesla.test.ts
//
// The tesla harness against a stub ctx and stub bodies: no renderer, no WebGPU. The subject is the arc's exit
// paths: the actor's setArc is sticky, so every way the hold can end must reach setArc(false).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createTeslaHarness, teslaCentre, type TeslaHarnessDeps } from './game-tesla';
import { TESLA } from './tesla-stick';
import { makeWeaponSlotState, requestSlot, type WeaponSlotState } from './game-weapon-slots';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';

/** A stub body: a torso cluster at `centre`, and the actor's zap contract (beginZap / the sticky setArc). */
function stubActor(id: number, centre: Vec3 = [0, 1.2, -5]) {
  const s = { id, centre, arc: false, zap: false, refuses: false, statue: false, arcCalls: [] as boolean[] };
  const actor = {
    id,
    posed: () => ({ clusters: [{ limb: 'torso', alive: true, center: s.centre, radius: 0.3 }] }),
    pose: () => ({ pos: [s.centre[0], 0, s.centre[2]] as Vec3, yaw: 0 }),
    beginZap: () => { if (s.refuses || s.statue) return false; s.zap = true; return true; },
    setArc: (on: boolean) => { s.arcCalls.push(on); s.arc = on && s.zap && !s.statue; },
    zapping: () => s.zap,
    zapPhase: () => (s.statue ? 'statue' : s.zap ? (s.arc ? 'zapped' : 'recovering') : 'none'),
  };
  return { s, actor: actor as unknown as ZombieActor };
}

const made: { dispose(): void }[] = [];
afterEach(() => { for (const h of made.splice(0)) h.dispose(); });

function fixture(live: 'tesla' | 'shotgun' = 'tesla', actors = [stubActor(7)]) {
  const canvas = {};
  const ctx = {
    weapon: { aimRig: new THREE.Group(), slotState: makeWeaponSlotState(live) as WeaponSlotState, shotAlert: false },
    world: { actors: actors.map(a => a.actor), loop: null as unknown, sequence: null },
    boot: { canvas },
    demo: { replayActive: false },
    gibs: { pendingGibs: [] as { actor: ZombieActor }[] },
    telemetry: { telemetry: { event: vi.fn() } },
  };
  const v = {
    eye: [0, 1.2, 0] as Vec3,
    aim: [0, 0, -1] as Vec3,
    /** The body under the crosshair (null: none), and the first body on the line to a target's centre. */
    under: actors[0]!.s.id as number | null,
    onSightLine: null as number | null,
    wall: false,
  };
  const deps: TeslaHarnessDeps = {
    // The aim trace is the one called with the full reach; the sight trace is capped at the centre's distance.
    trace: vi.fn((o: Vec3, d: Vec3, reach: number) => {
      const id = reach === TESLA.rangeM ? v.under : v.onSightLine;
      return id === null ? { actorId: -1, hit: null } : { actorId: id, hit: [o[0] + d[0] * 4, o[1] + d[1] * 4, o[2] + d[2] * 4] as Vec3 };
    }),
    sightBlocked: () => v.wall,
    eye: () => v.eye,
    aimDir: () => v.aim,
  };
  const tesla = createTeslaHarness(ctx as unknown as GameContext, deps);
  made.push(tesla);
  const tick = () => tesla.tick(1 / 60);
  /** Fire held on the first body, one tick in: the arc is on it. */
  const hold = () => { tesla.fire(true); tick(); };
  /** Aim `deg` off the body's centre, off its flesh. */
  const aimOff = (deg: number) => { const r = deg * Math.PI / 180; v.aim = [Math.sin(r), 0, -Math.cos(r)]; v.under = null; };
  return { ctx, tesla, v, tick, hold, aimOff, actors, canvas };
}

describe('tesla harness: the mouse', () => {
  it('only takes the mouse while it is the live slot', () => {
    const f = fixture('shotgun');
    expect(f.tesla.onMouseDown(0)).toBe(false);
    expect(f.tesla.debug().held).toBe(false);
  });

  it('holds on the left button only, and swallows the right', () => {
    const f = fixture();
    expect(f.tesla.onMouseDown(2)).toBe(true);
    expect(f.tesla.debug().held).toBe(false);
    expect(f.tesla.onMouseDown(0)).toBe(true);
    expect(f.tesla.debug().held).toBe(true);
    f.tesla.onMouseUp(2);
    expect(f.tesla.debug().held).toBe(true);
    f.tesla.onMouseUp(0);
    expect(f.tesla.debug().held).toBe(false);
  });
});

describe('tesla harness: finding and holding', () => {
  it('zaps the body under the crosshair while fire is held, and alerts', () => {
    const f = fixture();
    f.tick();
    expect(f.tesla.target()).toBeNull();
    expect(f.ctx.weapon.shotAlert).toBe(false);
    f.hold();
    expect(f.tesla.target()).toBe(f.actors[0]!.actor);
    expect(f.actors[0]!.s.arc).toBe(true);
    expect(f.ctx.weapon.shotAlert).toBe(true);
    for (let i = 0; i < 5; i++) f.tick();
    expect(f.actors[0]!.s.arc).toBe(true);
    expect(f.actors[0]!.s.arcCalls.every(on => on)).toBe(true);
  });

  it('finds nothing with no body under the crosshair, or with a wall in front of it', () => {
    const f = fixture();
    f.v.under = null;
    f.hold();
    expect(f.tesla.target()).toBeNull();
    f.v.under = 7; f.v.wall = true;
    f.tick();
    expect(f.tesla.target()).toBeNull();
    expect(f.actors[0]!.s.zap).toBe(false);
  });

  it('takes no body that refuses the zap (a corpse, a melt, a statue)', () => {
    const f = fixture();
    f.actors[0]!.s.refuses = true;
    f.hold();
    expect(f.tesla.target()).toBeNull();
    expect(f.actors[0]!.s.arcCalls).toEqual([]);
  });

  it('keeps the target while the aim is off its flesh but inside the stick angle', () => {
    const f = fixture();
    f.hold();
    f.aimOff(TESLA.stickDeg - 1);
    f.tick();
    expect(f.actors[0]!.s.arc).toBe(true);
  });

  it('keeps a close body the crosshair is on though the aim is far outside the stick angle of its centre', () => {
    const f = fixture('tesla', [stubActor(7, [0.6, 1.2, -1])]);   // 31 degrees off the aim, 1.2 m away
    f.hold();
    for (let i = 0; i < 3; i++) f.tick();
    expect(f.actors[0]!.s.arc).toBe(true);
    expect(f.actors[0]!.s.arcCalls.every(on => on)).toBe(true);
  });
});

describe('tesla harness: every way the arc comes off', () => {
  const dropped = (f: ReturnType<typeof fixture>) => {
    expect(f.actors[0]!.s.arc).toBe(false);
    expect(f.actors[0]!.s.arcCalls.at(-1)).toBe(false);
    expect(f.tesla.target()).toBeNull();
  };

  it('fire released', () => {
    const f = fixture();
    f.hold();
    f.tesla.onMouseUp(0);
    f.tick();
    dropped(f);
  });

  it('the seam releasing fire', () => {
    const f = fixture();
    f.hold();
    f.tesla.fire(false);
    f.tick();
    dropped(f);
  });

  it('the slot switched away: as soon as it starts to lower', () => {
    const f = fixture();
    f.hold();
    f.ctx.weapon.slotState = requestSlot(f.ctx.weapon.slotState, 'shotgun');
    expect(f.ctx.weapon.slotState.phase).toBe('lowering');
    f.tick();
    dropped(f);
  });

  it('another slot live', () => {
    const f = fixture();
    f.hold();
    f.ctx.weapon.slotState = makeWeaponSlotState('shotgun');
    f.tick();
    dropped(f);
  });

  it('the aim leaving the stick angle', () => {
    const f = fixture();
    f.hold();
    f.aimOff(TESLA.stickDeg + 1);
    f.tick();
    dropped(f);
  });

  it('the body out of range', () => {
    const f = fixture();
    f.hold();
    f.actors[0]!.s.centre = [0, 1.2, -(TESLA.rangeM + 0.5)];
    f.v.under = null;   // the aim trace is capped at the range
    f.tick();
    dropped(f);
  });

  it('a wall between the eye and the body', () => {
    const f = fixture();
    f.hold();
    f.v.wall = true;
    f.tick();
    dropped(f);
  });

  it('another body stepping onto the line to its centre, the aim off the flesh', () => {
    const other = stubActor(8, [0, 1.2, -2]);
    other.s.refuses = true;
    const f = fixture('tesla', [stubActor(7), other]);
    f.hold();
    f.aimOff(2);
    f.v.onSightLine = 8;
    f.tick();
    dropped(f);
  });

  it('the body becoming a statue, a corpse, a melt (it refuses the zap)', () => {
    const f = fixture();
    f.hold();
    f.actors[0]!.s.refuses = true;
    f.tick();
    dropped(f);
  });

  it('the body queued to gib', () => {
    const f = fixture();
    f.hold();
    f.ctx.gibs.pendingGibs.push({ actor: f.actors[0]!.actor });
    f.tick();
    dropped(f);
  });

  it('the body leaving the world (gibbed, a new cast, a new level)', () => {
    const f = fixture();
    f.hold();
    f.ctx.world.actors = [];
    f.tick();
    dropped(f);
  });

  it('the loop blocking input (dead / done / a sequence)', () => {
    const f = fixture();
    f.hold();
    f.ctx.world.loop = { vitals: { dead: true }, done: false };
    f.tick();
    dropped(f);
  });

  it('a demo replay', () => {
    const f = fixture();
    f.hold();
    f.ctx.demo.replayActive = true;
    f.tick();
    dropped(f);
  });

  it('the window losing focus (a mouseup that never arrives)', () => {
    const f = fixture();
    f.hold();
    window.dispatchEvent(new Event('blur'));
    expect(f.tesla.debug().held).toBe(false);
    f.tick();
    dropped(f);
  });

  it('the pointer lock lost', () => {
    const f = fixture();
    f.hold();
    document.dispatchEvent(new Event('pointerlockchange'));   // pointerLockElement is not the canvas
    expect(f.tesla.debug().held).toBe(false);
    f.tick();
    dropped(f);
  });

  it('dispose', () => {
    const f = fixture();
    f.hold();
    f.tesla.dispose();
    dropped(f);
  });

  it('moves to another body in the same tick the first is lost', () => {
    const other = stubActor(8, [3, 1.2, -5]);
    const f = fixture('tesla', [stubActor(7), other]);
    f.hold();
    f.v.aim = [Math.sin(0.54), 0, -Math.cos(0.54)];   // 31 degrees: on the other body
    f.v.under = 8;
    f.tick();
    expect(f.actors[0]!.s.arc).toBe(false);
    expect(other.s.arc).toBe(true);
    expect(f.tesla.target()).toBe(other.actor);
  });
});

describe('the arc aims at the body the pose gives', () => {
  it('the torso cluster; any live cluster with the torso gone; over the feet with none', () => {
    const a = (clusters: unknown[]) => ({ posed: () => ({ clusters }), pose: () => ({ pos: [1, 2, 3] }) }) as unknown as ZombieActor;
    const torso = { limb: 'torso', alive: true, center: [0, 0.5, 0] }, head = { limb: 'head', alive: true, center: [0, 0.9, 0] };
    expect(teslaCentre(a([head, torso]))).toEqual([0, 0.5, 0]);
    expect(teslaCentre(a([head, { ...torso, alive: false }]))).toEqual([0, 0.9, 0]);
    expect(teslaCentre(a([]))).toEqual([1, 3, 3]);
  });
});
