// src/lab/sdf-zombie/webgpu/game-rod.test.ts
//
// The rod harness against a stub ctx and stub actors on a torso-capsule fixture: no renderer, no WebGPU.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRodHarness, ROD, type RodDeps } from './game-rod';
import { makeWeaponSlotState, requestSlot, stepWeaponSlot, type WeaponSlotState } from './game-weapon-slots';
import { prim } from '../head-pop';
import { rotateYaw } from '../gait';
import { woundDirToWorld, woundWorldPos, type Wound } from '../damage';
import { ROD_CALIBRE } from '../cut-wound';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';

type Blast = { wounds: readonly Wound[]; reaction?: string };

/** A stub body: a torso capsule 0.4 m off its pose origin, rigidly placed by pos + yaw (rotateYaw, the codebase's convention). */
function stubActor(id: number, pos: Vec3 = [0, 0, 0], yaw = 0) {
  const s = { id, pos, yaw, blasts: [] as Blast[] };
  const place = (v: Vec3): Vec3 => { const r = rotateYaw(v, s.yaw); return [s.pos[0] + r[0], s.pos[1] + r[1], s.pos[2] + r[2]]; };
  const posed = () => {
    const torso = prim(place([0.4, 1.0, 0]), place([0.4, 1.5, 0]), 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
    return { prims: [torso], clusters: [{ start: 0, count: 1, alive: true }] };
  };
  const actor = { id, posed, pose: () => ({ pos: s.pos, yaw: s.yaw }), blast: (e: Blast) => { s.blasts.push(e); } };
  return { s, actor: actor as unknown as ZombieActor, posed, place };
}

const made: { dispose(): void }[] = [];
afterEach(() => { for (const r of made.splice(0)) r.dispose(); });

function fixture(live: 'rod' | 'shotgun' = 'rod', actors = [stubActor(7)]) {
  const ctx = {
    weapon: { aimRig: new THREE.Group(), slotState: makeWeaponSlotState(live) as WeaponSlotState },
    player: { player: { yaw: 0, pitch: 0 } },
    world: { actors: actors.map(a => a.actor), loop: null as unknown, sequence: null },
    boot: { canvas: {} },
    telemetry: { telemetry: { event: vi.fn() } },
  };
  let hit: { id: number; p: Vec3 } | null = null;
  const bleed = vi.fn();
  const traceMelee = vi.fn((_o: Vec3, _d: Vec3, _reach: number) => (hit ? { actorId: hit.id, hit: hit.p } : { actorId: -1, hit: null }));
  const deps: RodDeps = {
    traceMelee,
    eye: () => [0.4, 1.25, 1],
    aimDir: () => [0, 0, -1],
    bleed,
  };
  const rod = createRodHarness(ctx as unknown as GameContext, deps);
  made.push(rod);
  const aim = (id: number, p: Vec3 | null) => { hit = p ? { id, p } : null; };
  /** One held frame with the crosshair at p (null: off every body). */
  const frame = (p: Vec3 | null, id = actors[0]!.s.id) => { aim(id, p); rod.tick(1 / 60); };
  const blasts = () => actors.flatMap(a => a.s.blasts);
  return { ctx, rod, bleed, aim, frame, blasts, actors, traceMelee };
}
/** A point on the torso's front skin at height y (torso at x 0.4, radius 0.15). */
const skin = (y: number, x = 0.4): Vec3 => [x, y, 0.15];

describe('rod harness: slot, press, blocking', () => {
  it('only takes the mouse while it is the live slot', () => {
    const f = fixture('shotgun');
    expect(f.rod.onMouseDown(0)).toBe(false);
    expect(f.rod.debug().held).toBe(false);
  });

  it('a right click, or a press while not ready, holds nothing (and still swallows the input)', () => {
    const f = fixture();
    expect(f.rod.onMouseDown(2)).toBe(true);
    expect(f.rod.debug().held).toBe(false);
    f.ctx.weapon.slotState = requestSlot(makeWeaponSlotState('rod'), 'shotgun'); // lowering
    expect(f.rod.onMouseDown(0)).toBe(true);
    expect(f.rod.debug().held).toBe(false);
  });

  it('a press while the loop blocks input (dead / done / sequence) holds nothing but swallows the input', () => {
    const f = fixture();
    f.ctx.world.loop = { vitals: { dead: true }, done: false };
    expect(f.rod.onMouseDown(0)).toBe(true);
    expect(f.rod.debug().held).toBe(false);
  });
});

describe('rod harness: cut()', () => {
  it('stamps one cut wound, blasts it as a flinch, bleeds along the segment view, and records lastCuts', () => {
    const f = fixture();
    const n = f.rod.cut(7, [0.4, 1.15, 0.15], [0.4, 1.35, 0.15], [0, 0, -1]);
    expect(n).toBe(1);
    expect(f.rod.debug().lastCuts).toBe(1);
    expect(f.blasts()).toHaveLength(1);
    expect(f.blasts()[0]!.reaction).toBe('flinch');
    expect(f.blasts()[0]!.wounds[0]!.shape).toBe('cut');
    expect(f.bleed).toHaveBeenCalledTimes(1);
    expect(f.bleed.mock.calls[0]![3]).toEqual([0, 0, -1]);
    expect(f.rod.cut(99, [0.4, 1.15, 0.15], [0.4, 1.35, 0.15], [0, 0, -1])).toBe(0);
  });

  it('an explicit undefined calibre field keeps the rod default instead of overwriting it (no NaN wound)', () => {
    const f = fixture();
    const n = f.rod.cut(7, [0.4, 1.15, 0.15], [0.4, 1.35, 0.15], [0, 0, -1], { depth: undefined, kerf: undefined, lip: undefined });
    expect(n).toBe(1);
    const w = f.blasts()[0]!.wounds[0]!;
    for (const v of [w.carveDepth, w.kerf, w.radius, ...w.local]) expect(Number.isFinite(v)).toBe(true);
    expect(w.kerf).toBeCloseTo(ROD_CALIBRE.kerf, 6);
  });
});

describe('rod harness: sweeping', () => {
  it('hold, sweep, release: the cut follows the sweep and lands on the release tick', () => {
    const f = fixture();
    const a = f.actors[0]!;
    expect(f.rod.onMouseDown(0)).toBe(true);
    for (let i = 0; i < 6; i++) f.frame(skin(1.1 + i * 0.05));
    expect(f.rod.debug()).toMatchObject({ held: true, samples: 6 });
    f.rod.onMouseUp(0);
    expect(f.blasts()).toHaveLength(0);          // the cut lands on the tick, not on the event
    f.rod.tick(1 / 60);
    expect(f.rod.debug()).toMatchObject({ held: false, samples: 0, lastCuts: 1 });
    const w = f.blasts()[0]!.wounds[0]!;
    const prims = a.posed().prims;
    const dir = woundDirToWorld(prims, w, w.cutDir!, 0);
    expect(Math.abs(dir[1])).toBeGreaterThan(0.9);               // a vertical sweep → a vertical cut
    const c = woundWorldPos(prims, w, 0);
    expect(c[1]).toBeGreaterThan(1.15); expect(c[1]).toBeLessThan(1.3);   // centred on the swept path (1.1..1.35)
    expect(f.ctx.telemetry.telemetry.event).toHaveBeenCalledWith('rod-cut', { cuts: 1 });
  });

  it('traces a straight melee ray from the eye along the aim, capped at the rod reach; a miss samples nothing', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    f.frame(null);
    expect(f.traceMelee).toHaveBeenCalledWith([0.4, 1.25, 1], [0, 0, -1], ROD.reach);
    expect(f.rod.debug().samples).toBe(0);
    f.frame(skin(1.2));
    expect(f.rod.debug().samples).toBe(1);
  });

  it('keeps at most maxSamples per actor', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < ROD.maxSamples + 20; i++) {
      f.frame(skin(1.1 + (i % 10) * 0.01));
      if (f.rod.debug().held === false) break;   // the hold cap may end it first: refresh
    }
    expect(f.rod.debug().samples).toBeLessThanOrEqual(ROD.maxSamples);
  });

  it('the sample cap covers the whole hold at any frame rate: a 2 s sweep at 120 fps still has its end', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    const n = Math.round(ROD.maxHoldS * 120);
    for (let i = 0; i < n + 5 && f.rod.debug().held; i++) {
      f.aim(7, skin(1.1 + (0.3 * Math.min(i, n)) / n));   // 1.1 → 1.4 across the whole hold
      f.rod.tick(1 / 120);
      expect(f.rod.debug().samples).toBeLessThanOrEqual(ROD.maxSamples);
    }
    expect(f.rod.debug().held).toBe(false);        // the hold cap ended it on its own
    const w = f.blasts().flatMap(b => b.wounds);
    expect(w).toHaveLength(1);
    expect(w[0]!.radius).toBeGreaterThan(0.13);    // one chord ~0.3 m long (half-length 0.15), not the first 0.75 s of it
    const c = woundWorldPos(f.actors[0]!.posed().prims, w[0]!, 0);
    expect(c[1]).toBeGreaterThan(1.22);
  });

  it('two actors in one sweep: two cuts, one telemetry event', () => {
    const f = fixture('rod', [stubActor(7), stubActor(8, [2, 0, 0])]);
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05), 7);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05, 2.4), 8);
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(f.actors[0]!.s.blasts).toHaveLength(1);
    expect(f.actors[1]!.s.blasts).toHaveLength(1);
    expect(f.rod.debug().lastCuts).toBe(2);
    const ev = f.ctx.telemetry.telemetry.event as ReturnType<typeof vi.fn>;
    expect(ev.mock.calls.filter(c => c[0] === 'rod-cut')).toEqual([['rod-cut', { cuts: 2 }]]);
  });

  it('two passes with a gap make two cuts, never one chord across the gap', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 4; i++) f.frame(skin(1.05 + i * 0.03));   // 1.05..1.14
    for (let i = 0; i < 3; i++) f.frame(null);                    // off the body
    for (let i = 0; i < 4; i++) f.frame(skin(1.36 + i * 0.03));   // 1.36..1.45
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    const ws = f.blasts().flatMap(b => b.wounds);
    expect(ws).toHaveLength(2);
    for (const w of ws) expect(w.radius).toBeLessThan(0.08);      // each is its own short run (half-length ~0.045)
  });

  it('one missed frame mid-stroke does not split the stroke: still ONE cut', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 4; i++) f.frame(skin(1.1 + i * 0.04));    // 1.10..1.22
    f.frame(null);                                                // one frame off the body
    for (let i = 4; i < 8; i++) f.frame(skin(1.1 + i * 0.04));    // 1.26..1.38
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    const ws = f.blasts().flatMap(b => b.wounds);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.radius).toBeGreaterThan(0.1);                   // one chord across the whole stroke (~0.28 long)
  });

  it('the per-slash cap keeps the LONGEST cuts across runs, not the earliest', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    const pass = (y0: number, len: number) => {
      for (let i = 0; i < 5; i++) f.frame(skin(y0 + (len * i) / 4));
      for (let i = 0; i < 3; i++) f.frame(null);                  // a real gap: the next pass is its own run
    };
    pass(1.40, 0.04);                                             // short, first
    pass(1.0, 0.30); pass(1.05, 0.25); pass(1.1, 0.20);           // three long ones after it
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    const ws = f.blasts().flatMap(b => b.wounds);
    expect(ws).toHaveLength(3);
    const radii = ws.map(w => w.radius);
    expect(Math.min(...radii)).toBeGreaterThan(0.08);             // the 0.04 m pass (radius 0.02) was dropped
    expect(radii[0]! > radii[1]! && radii[1]! > radii[2]!).toBe(true);   // and they stay in sweep order
  });

  it('the hold is capped: after maxHoldS the sweep finishes on its own', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    let i = 0;
    while (f.rod.debug().held && i < 400) { f.frame(skin(1.1 + Math.min(i, 100) * 0.003)); i++; }   // a monotone sweep (a sawtooth's chord may close on itself)
    expect(i).toBeLessThanOrEqual(Math.ceil(ROD.maxHoldS * 60) + 1);
    expect(f.rod.debug().held).toBe(false);
    expect(f.rod.debug().lastCuts).toBe(1);        // the capped hold still cuts what it swept
    expect(f.blasts()).toHaveLength(1);
  });
});

describe('rod harness: samples live in the actor frame', () => {
  const sweep = (f: ReturnType<typeof fixture>, n = 6) => { for (let i = 0; i < n; i++) f.frame(skin(1.1 + i * 0.05)); };

  it('a body that walks between the sweep and the release is cut where the sweep crossed it', () => {
    const a = stubActor(7);
    const f = fixture('rod', [a]);
    f.rod.onMouseDown(0);
    sweep(f);
    a.s.pos = [0.5, 0, -0.2];                    // the body moves before the release
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(a.s.blasts).toHaveLength(1);
    const w = a.s.blasts[0]!.wounds[0]!;
    const c = woundWorldPos(a.posed().prims, w, 0);
    expect(c[0]).toBeCloseTo(0.9, 1);            // 0.4 + 0.5: on the moved body, not at the stale world spot
    expect(c[2]).toBeCloseTo(-0.05, 1);          // -0.2 + 0.15
  });

  it('a body that turns is cut at the rotated spot (yaw convention: rotateYaw, as bodyAxis de-yaws)', () => {
    const a = stubActor(7);
    const f = fixture('rod', [a]);
    f.rod.onMouseDown(0);
    sweep(f);
    a.s.yaw = Math.PI / 2;
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(a.s.blasts).toHaveLength(1);
    const w = a.s.blasts[0]!.wounds[0]!;
    const c = woundWorldPos(a.posed().prims, w, a.s.yaw);
    const expected = a.place([0.4, 1.225, 0.15]);   // the sweep's mid-height on the front skin, through the new pose
    expect(Math.hypot(c[0] - expected[0], c[1] - expected[1], c[2] - expected[2])).toBeLessThan(0.05);
  });
});

describe('rod harness: the armed gate', () => {
  it('releasing while the rod is lowering (live is still rod) makes no cut', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05));
    f.ctx.weapon.slotState = requestSlot(f.ctx.weapon.slotState, 'shotgun');
    expect(f.ctx.weapon.slotState.live).toBe('rod');   // lowering: live has not flipped yet
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(f.blasts()).toHaveLength(0);
    expect(f.rod.debug().samples).toBe(0);
  });

  it('a mouseup after live flipped (tick ran before the slot step) then a tick makes no cut', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05));
    let s = requestSlot(f.ctx.weapon.slotState, 'shotgun');
    for (let i = 0; i < 30 && s.live === 'rod'; i++) s = stepWeaponSlot(s, 1 / 60);
    expect(s.live).toBe('shotgun');
    f.ctx.weapon.slotState = s;
    f.rod.onMouseUp(0);                                  // held was still true: release is armed
    f.rod.tick(1 / 60);
    expect(f.blasts()).toHaveLength(0);
    expect(f.rod.debug().samples).toBe(0);
  });

  it('the loop blocking input mid-sweep drops the sweep', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05));
    f.ctx.world.loop = { vitals: { dead: true }, done: false };
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(f.blasts()).toHaveLength(0);
  });

  it('dispose() removes the blur / lock listeners: a later blur no longer touches the harness', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    f.frame(skin(1.1));
    f.rod.dispose();
    window.dispatchEvent(new Event('blur'));
    expect(f.rod.debug().held).toBe(true);
  });

  it('a window blur abandons a held sweep: nothing is cut later', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05));
    window.dispatchEvent(new Event('blur'));
    expect(f.rod.debug()).toMatchObject({ held: false, samples: 0 });
    f.rod.onMouseUp(0); f.rod.tick(1 / 60);
    expect(f.blasts()).toHaveLength(0);
  });

  it('losing pointer lock abandons a held sweep, including a pending release', () => {
    const f = fixture();
    f.rod.onMouseDown(0);
    for (let i = 0; i < 5; i++) f.frame(skin(1.1 + i * 0.05));
    f.rod.onMouseUp(0);                                  // release pending
    document.dispatchEvent(new Event('pointerlockchange'));   // pointerLockElement is null, not the canvas
    f.rod.tick(1 / 60);
    expect(f.blasts()).toHaveLength(0);
    expect(f.rod.debug().held).toBe(false);
  });
});
