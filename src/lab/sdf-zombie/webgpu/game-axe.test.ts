// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-axe.test.ts
//
// The axe harness against a stub ctx and stub actors built from real prims (a torso capsule and a head sphere), so the
// strike's field, ray trace and head magnet are the real ones: no renderer, no WebGPU. Built like game-rod.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createAxeHarness, type AxeDeps } from './game-axe';
import { makeWeaponSlotState, requestSlot, stepWeaponSlot, type WeaponSlotState } from './game-weapon-slots';
import { AXE_TIMING, axePose, makeAxeSwing, stepAxeSwing, type AxeSide } from './axe-swing';
import { AXE_CALIBRE, AXE_HIT } from './axe-strike';
import { AXE_HEAD } from './axe-head';
import { prim } from '../head-pop';
import { woundDirToWorld, woundWorldPos, type Wound } from '../damage';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';

type Blast = {
  wounds: readonly Wound[]; meterCredit: number; impulse: { at: Vec3; vel: Vec3 } | null;
  reaction?: string; forceCollapse?: boolean;
};

/** Torso capsule y 1.0..1.5 (r 0.15) and a head sphere at y 1.75 (r 0.11), both on x = z = 0 of the actor's pos. */
const HEAD_Y = 1.75;
function stubActor(id: number, pos: Vec3 = [0, 0, 0]) {
  const s = { id, pos, blasts: [] as Blast[] };
  const at = (v: Vec3): Vec3 => [s.pos[0] + v[0], s.pos[1] + v[1], s.pos[2] + v[2]];
  const posed = () => {
    const torso = prim(at([0, 1.0, 0]), at([0, 1.5, 0]), 0.15, [1, 1, 1], { limb: 'torso', cluster: 0 });
    const head = prim(at([0, HEAD_Y, 0]), at([0, HEAD_Y, 0]), 0.11, [1, 1, 1], { limb: 'head', cluster: 1 });
    return {
      prims: [torso, head],
      clusters: [
        { id: 0, limb: 'torso' as const, start: 0, count: 1, center: at([0, 1.25, 0]), radius: 0.3, alive: true },
        { id: 1, limb: 'head' as const, start: 1, count: 1, center: at([0, HEAD_Y, 0]), radius: 0.11, alive: true },
      ],
    };
  };
  const actor = { id, posed, pose: () => ({ pos: s.pos, yaw: 0 }), blast: (e: Blast) => { s.blasts.push(e); } };
  return { s, actor: actor as unknown as ZombieActor, posed };
}

const made: { dispose(): void }[] = [];
afterEach(() => { for (const r of made.splice(0)) r.dispose(); });

const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

function fixture(live: 'axe' | 'shotgun' = 'axe', actors = [stubActor(7)]) {
  const touchedHeadDamage: PropertyKey[] = [];
  const ctx = {
    weapon: {
      aimRig: new THREE.Group(), viewModelAnchor: new THREE.Group(), slotState: makeWeaponSlotState(live) as WeaponSlotState,
      // The slug head burst's leaf: the axe must never touch it.
      headDamage: new Proxy({}, { get: (_t, k) => { touchedHeadDamage.push(k); return undefined; } }),
    },
    player: { player: { yaw: 0, pitch: 0 } },
    world: { actors: actors.map(a => a.actor), loop: null as unknown, sequence: null as { started: boolean; active: boolean } | null },
    boot: { canvas: {}, deferredApi: null },
    telemetry: { telemetry: { event: vi.fn() } },
  };
  /** The eye at chest height 1.2 m in front of the actor, aiming level at its torso. */
  const view = { eye: [0, 1.25, 1.2] as Vec3, aim: [0, 0, -1] as Vec3 };
  const bleed = vi.fn();
  const depsUsed = new Set<PropertyKey>();
  const raw: AxeDeps = { eye: () => view.eye, aimDir: () => view.aim, bleed };
  const deps = new Proxy(raw, { get: (t, k, r) => { depsUsed.add(k); return Reflect.get(t, k, r); } });
  const axe = createAxeHarness(ctx as unknown as GameContext, deps);
  made.push(axe);
  /** Aim from the eye at world point p. */
  const aimAt = (p: Vec3) => { view.aim = unit([p[0] - view.eye[0], p[1] - view.eye[1], p[2] - view.eye[2]]); };
  const blasts = () => actors.flatMap(a => a.s.blasts);
  /** Tick at 60 fps until a blast lands (or n ticks pass); returns the ticks taken (n + 1 on none). */
  const tickToStrike = (n = 120) => {
    const before = blasts().length;
    for (let i = 1; i <= n; i++) { axe.tick(1 / 60); if (blasts().length > before) return i; }
    return n + 1;
  };
  const ticks = (n: number) => { for (let i = 0; i < n; i++) axe.tick(1 / 60); };
  /** A full click: press, the click tick, release. */
  const clickOnce = () => { axe.onMouseDown(0); axe.tick(1 / 60); axe.onMouseUp(0); };
  return { ctx, axe, bleed, view, aimAt, blasts, actors, tickToStrike, ticks, clickOnce, depsUsed, touchedHeadDamage };
}

/** Ticks from the click tick (tick 1) to the strike frame at 60 fps. */
const strikeTick = (side: AxeSide) => Math.ceil(AXE_TIMING[side].strikeT * 60 - 1e-9);
/** The cut's direction in world (body yaw 0). */
const cutWorldDir = (posed: ReturnType<ReturnType<typeof stubActor>['posed']>, w: Wound) => woundDirToWorld(posed.prims, w, w.cutDir!, 0);

describe('axe harness: input', () => {
  it('ignores the mouse unless the axe is the live slot; swallows it (true) when live, chopping only on button 0 when armed', () => {
    const off = fixture('shotgun');
    expect(off.axe.onMouseDown(0)).toBe(false);
    off.ticks(60);
    expect(off.axe.debug()).toMatchObject({ phase: 'idle', swingId: 0, strikes: 0 });

    const f = fixture();
    expect(f.axe.onMouseDown(2)).toBe(true);                 // a right click: swallowed, no chop
    f.ticks(60);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', swingId: 0 });
    f.ctx.world.loop = { vitals: { dead: true }, done: false };   // the loop blocks input
    expect(f.axe.onMouseDown(0)).toBe(true);
    f.axe.onMouseUp(0);
    f.ctx.world.loop = null;
    f.ticks(60);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', swingId: 0 });
    expect(f.blasts()).toHaveLength(0);
    f.axe.onMouseDown(0);                                    // armed: a chop
    f.axe.tick(1 / 60);
    expect(f.axe.debug()).toMatchObject({ phase: 'swing', side: 'H', swingId: 1 });
  });

  it('a click while a scripted sequence has started (the rig hidden) does not swing, nor does the seam', () => {
    const f = fixture();
    f.ctx.world.sequence = { started: true, active: false };   // the sequence ended (inactive) but the level is not done
    expect(f.axe.onMouseDown(0)).toBe(true);                 // swallowed, not armed
    f.axe.tick(1 / 60);
    f.axe.onMouseUp(0);
    f.axe.click();
    f.ticks(60);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', swingId: 0, strikes: 0 });
    expect(f.blasts()).toHaveLength(0);
  });

  it('a click while the axe is still raising is ignored, as the rod\'s is (not replayed once it is up)', () => {
    const f = fixture('shotgun');
    let s = requestSlot(f.ctx.weapon.slotState, 'axe');
    for (let i = 0; i < 60 && s.live !== 'axe'; i++) s = stepWeaponSlot(s, 1 / 60);
    expect(s).toMatchObject({ live: 'axe', phase: 'raising' });
    f.ctx.weapon.slotState = s;
    expect(f.axe.onMouseDown(0)).toBe(true);                 // swallowed (live), but not armed
    f.axe.tick(1 / 60);
    for (let i = 0; i < 60 && s.phase !== 'up'; i++) s = stepWeaponSlot(s, 1 / 60);
    expect(s.phase).toBe('up');
    f.ctx.weapon.slotState = s;
    f.ticks(60);                                             // the button is still physically down: no chop either
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', swingId: 0, strikes: 0 });
    f.axe.click();                                           // the seam, now armed
    f.axe.tick(1 / 60);
    expect(f.axe.debug().swingId).toBe(1);
  });

  it('a click runs a chop: nothing on the click tick before strikeT, one strike when the swing crosses strikeT', () => {
    const f = fixture();
    f.axe.onMouseDown(0);
    f.axe.tick(1 / 60);                                      // the click tick
    f.axe.onMouseUp(0);
    expect(f.blasts()).toHaveLength(0);
    expect(f.axe.debug()).toMatchObject({ phase: 'swing', side: 'H', strikes: 0 });
    const n = f.tickToStrike();
    expect(1 + n).toBe(strikeTick('H'));                     // the strike frame is the first tick at t >= strikeT
    expect(f.blasts()).toHaveLength(1);
    expect(f.axe.debug().strikes).toBe(1);
    f.ticks(60);                                             // the swing ends; the button is up: no repeat
    expect(f.blasts()).toHaveLength(1);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', strikes: 1 });
    expect(f.ctx.telemetry.telemetry.event).toHaveBeenCalledWith('axe-strike', { side: 'H', hits: 1, heads: 0 });
  });

  it('holding the button runs the combo H -> R -> L, one strike each', () => {
    const f = fixture();
    f.axe.onMouseDown(0);
    const sides: AxeSide[] = [];
    for (let i = 0; i < 150; i++) { f.axe.tick(1 / 60); if (f.axe.debug().strikes > sides.length) sides.push(f.axe.debug().last!.side); }
    expect(sides.slice(0, 3)).toEqual(['H', 'R', 'L']);
  });

  it('switching weapon mid-swing cancels it: no strike fires after the switch', () => {
    const f = fixture();
    f.clickOnce();
    f.ticks(strikeTick('H') - 5);                            // mid wind-up, before the strike frame
    expect(f.axe.debug().phase).toBe('swing');
    f.ctx.weapon.slotState = requestSlot(f.ctx.weapon.slotState, 'shotgun');
    expect(f.ctx.weapon.slotState.live).toBe('axe');         // lowering: live has not flipped yet
    f.ticks(90);
    expect(f.blasts()).toHaveLength(0);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', strikes: 0 });
  });

  it('window blur and pointer-lock loss release the held button (no auto-repeat chop)', () => {
    const swingTicks = Math.ceil(AXE_TIMING.H.swingSec * 60) + 30;
    // Control: held through the swing's end, the combo carries on (a second strike).
    const held = fixture();
    held.axe.onMouseDown(0);
    held.ticks(swingTicks + Math.ceil(AXE_TIMING.R.strikeT * 60));
    expect(held.axe.debug().strikes).toBe(2);

    for (const lose of [
      () => window.dispatchEvent(new Event('blur')),
      () => document.dispatchEvent(new Event('pointerlockchange')),   // pointerLockElement is null, not the canvas
    ]) {
      const f = fixture();
      f.axe.onMouseDown(0);
      f.axe.tick(1 / 60);                                    // the swing starts; held
      lose();
      f.ticks(swingTicks + Math.ceil(AXE_TIMING.R.strikeT * 60));
      expect(f.axe.debug()).toMatchObject({ phase: 'idle', strikes: 1, swingId: 1 });
      expect(f.blasts()).toHaveLength(1);
    }
  });
});

describe('axe harness: a body chop', () => {
  it('stamps ONE cut wound (shape "cut", kerf AXE_CALIBRE.kerf) through blast with AXE_HIT[side].meterCredit and reaction "blast", and bleeds once', () => {
    const f = fixture();
    f.clickOnce();
    f.tickToStrike();
    expect(f.blasts()).toHaveLength(1);
    const b = f.blasts()[0]!;
    expect(b.wounds).toHaveLength(1);
    const w = b.wounds[0]!;
    expect(w.shape).toBe('cut');
    expect(w.kerf).toBeCloseTo(AXE_CALIBRE.kerf, 6);
    expect(w.headRegion).toBeUndefined();
    expect(b.meterCredit).toBe(AXE_HIT.H.meterCredit);
    expect(b.reaction).toBe('blast');
    expect(b.forceCollapse).toBeUndefined();
    // The shove: along the eye -> hit ray (level, into the body), AXE_HIT.H.shove long, at the hit on the torso's front.
    expect(b.impulse!.vel[2]).toBeCloseTo(-AXE_HIT.H.shove, 1);
    expect(b.impulse!.at[2]).toBeCloseTo(0.15, 2);
    expect(b.impulse!.at[1]).toBeCloseTo(1.25, 2);
    // The cut sits on the hit.
    const c = woundWorldPos(f.actors[0]!.posed().prims, w, 0);
    expect(Math.hypot(c[0], c[1] - 1.25)).toBeLessThan(0.03);
    expect(f.bleed).toHaveBeenCalledTimes(1);
    expect(f.bleed.mock.calls[0]![1]).toBe(w);
    expect(f.axe.debug().heads).toEqual({});
  });

  it('the overhead chop\'s cut runs vertically in world (|cutDir . y| > 0.8 at body yaw 0)', () => {
    const f = fixture();
    expect(f.axe.chop(7, 'H')).toBe(1);
    const w = f.blasts()[0]!.wounds[0]!;
    expect(Math.abs(cutWorldDir(f.actors[0]!.posed(), w)[1])).toBeGreaterThan(0.8);
  });

  it('a diagonal chop\'s cut is diagonal (0.4 < |cutDir . y| < 0.9)', () => {
    for (const side of ['R', 'L'] as const) {
      const f = fixture();
      expect(f.axe.chop(7, side)).toBe(1);
      const b = f.blasts()[0]!;
      const y = Math.abs(cutWorldDir(f.actors[0]!.posed(), b.wounds[0]!)[1]);
      expect(y).toBeGreaterThan(0.4);
      expect(y).toBeLessThan(0.9);
      expect(b.meterCredit).toBe(AXE_HIT[side].meterCredit);
    }
  });

  it('a body out of the strike arc is not hit by a click chop', () => {
    const f = fixture();
    f.view.aim = [1, 0, 0];                                  // 90 degrees off the actor's bearing
    f.clickOnce();
    f.ticks(60);
    expect(f.axe.debug().strikes).toBe(1);
    expect(f.axe.debug().last).toEqual({ side: 'H', hits: [], heads: [], points: [] });
    expect(f.blasts()).toHaveLength(0);
  });
});

describe('axe harness: head chops', () => {
  it('a head hit (the head magnet) stamps a head-tagged cut (headRegion "axe-1", then "axe-2"), meterCredit 0, reaction "flinch"', () => {
    const f = fixture();
    // The aim passes 0.14 m beside the head centre: the body ray misses the head sphere (r 0.11), the magnet takes it.
    f.aimAt([0.14, HEAD_Y, 0]);
    for (const n of [1, 2]) {
      f.clickOnce();
      f.tickToStrike();
      f.ticks(60);                                           // let the swing end (the next click restarts the combo)
      const b = f.blasts()[n - 1]!;
      expect(b.wounds).toHaveLength(1);
      const w = b.wounds[0]!;
      expect(w.shape).toBe('cut');
      expect(w.headRegion).toBe(`axe-${n}`);
      expect(b.meterCredit).toBe(0);
      expect(b.reaction).toBe('flinch');
      expect(b.forceCollapse).toBe(false);
      // The magnet's point is on the head's surface.
      const at = b.impulse!.at;
      expect(Math.hypot(at[0], at[1] - HEAD_Y, at[2])).toBeCloseTo(0.11, 2);
      expect(f.axe.debug().last).toEqual({ side: 'H', hits: [7], heads: [7], points: [at] });   // the hit point is the impulse's
    }
    expect(f.bleed).toHaveBeenCalledTimes(2);
    expect(f.axe.debug().heads).toEqual({ 7: 2 });
  });

  it('the AXE_HEAD.chopsToKill-th head chop blasts with forceCollapse: true; earlier ones do not', () => {
    const f = fixture();
    const sides: AxeSide[] = ['H', 'R', 'L'];
    for (let i = 0; i < AXE_HEAD.chopsToKill; i++) expect(f.axe.chop(7, sides[i % 3]!, 'head')).toBe(1);
    const bs = f.blasts();
    expect(bs).toHaveLength(AXE_HEAD.chopsToKill);
    bs.forEach((b, i) => {
      expect(b.forceCollapse).toBe(i === AXE_HEAD.chopsToKill - 1);
      expect(b.wounds[0]!.headRegion).toBe(`axe-${i + 1}`);   // unique per chop: none replaces another in the ring
    });
    // A body chop between head chops neither counts nor kills.
    const g = fixture();
    g.axe.chop(7, 'H', 'head');
    g.axe.chop(7, 'R', 'torso');
    expect(g.axe.debug().heads).toEqual({ 7: 1 });
    expect(g.blasts().map(b => b.forceCollapse)).toEqual([false, undefined]);
  });

  it('a head chop after the kill (the chopsToKill+1-th) sends forceCollapse: false and its own region', () => {
    const f = fixture();
    for (let i = 0; i < AXE_HEAD.chopsToKill + 1; i++) expect(f.axe.chop(7, 'H', 'head')).toBe(1);
    const after = f.blasts()[AXE_HEAD.chopsToKill]!;
    expect(f.blasts()[AXE_HEAD.chopsToKill - 1]!.forceCollapse).toBe(true);
    expect(after.forceCollapse).toBe(false);
    expect(after.wounds[0]!.headRegion).toBe(`axe-${AXE_HEAD.chopsToKill + 1}`);
    expect(after.wounds[0]!.headSlot).toBeUndefined();     // never in head-damage's protected slots
    expect(f.axe.debug().heads).toEqual({ 7: AXE_HEAD.chopsToKill + 1 });
  });

  it('never calls into the slug burst: the harness has no head-damage dependency at all (its deps: aim, blood, the head split)', () => {
    const f = fixture();
    for (let i = 0; i < AXE_HEAD.chopsToKill + 1; i++) f.axe.chop(7, 'H', 'head');
    f.clickOnce(); f.ticks(60);                              // and the click path
    expect(f.blasts()).toHaveLength(AXE_HEAD.chopsToKill + 2);
    expect(f.touchedHeadDamage).toEqual([]);                 // ctx.weapon.headDamage never read
    // `split` is the head split leaf (game-head-split.test.ts drives it); absent here, so head chops are cuts and the count.
    expect([...f.depsUsed].sort()).toEqual(['aimDir', 'bleed', 'eye', 'split']);
  });
});

describe('axe harness: seams', () => {
  it('axeChop(id, side, "torso" | "head") strikes that one actor whatever the arc, and returns the wounds stamped', () => {
    // Actor 8 stands between the eye and actor 7; the aim points away from both.
    const f = fixture('axe', [stubActor(7), stubActor(8, [0, 0, 0.6])]);
    f.view.aim = [1, 0, 0];
    expect(f.axe.chop(7, 'H', 'torso')).toBe(1);
    expect(f.actors[0]!.s.blasts).toHaveLength(1);
    expect(f.actors[1]!.s.blasts).toHaveLength(0);
    expect(f.actors[0]!.s.blasts[0]!.wounds[0]!.headRegion).toBeUndefined();
    expect(f.axe.chop(7, 'L', 'head')).toBe(1);
    expect(f.actors[0]!.s.blasts[1]!.wounds[0]!.headRegion).toBe('axe-1');
    expect(f.actors[1]!.s.blasts).toHaveLength(0);
    expect(f.axe.chop(99, 'H')).toBe(0);                     // no such actor
    expect(f.axe.debug().strikes).toBe(2);                   // a seam call with no target is not a strike
    expect(f.bleed).toHaveBeenCalledTimes(2);
  });

  it('debug() reports the swing phase/side, the last strike\'s hit ids and each struck actor\'s head chop count', () => {
    const f = fixture('axe', [stubActor(7), stubActor(8, [0.6, 0, 0])]);
    expect(f.axe.debug()).toMatchObject({ phase: 'idle', side: 'H', swingId: 0, strikes: 0, last: null, heads: {} });
    // The drawn axe's readback (the gate's lighting measure): world points, no hand without a renderer (the stub ctx).
    const rig = f.axe.debug().rig;
    expect(rig.grip).toHaveLength(3);
    expect(Math.hypot(...rig.top.map((v, i) => v - rig.grip[i]!))).toBeGreaterThan(0.4);   // the haft's top is up the haft
    expect(rig.hand).toBeNull();
    f.axe.chop(8, 'H', 'head');
    f.axe.chop(8, 'R', 'head');
    f.clickOnce();
    expect(f.axe.debug()).toMatchObject({ phase: 'swing', side: 'H', swingId: 1, strikes: 2 });
    f.tickToStrike();
    // The level aim at actor 7's torso; actor 8 (0.6 m to the right, inside the arc) is struck too (the eye ray falls back to its torso centre).
    const d = f.axe.debug();
    expect(d.strikes).toBe(3);
    expect(d.last!.side).toBe('H');
    expect([...d.last!.hits].sort()).toEqual([7, 8]);
    expect(d.last!.heads).toEqual([]);
    expect(d.last!.points).toHaveLength(2);
    expect(d.heads).toEqual({ 8: 2 });
  });
});

describe('axe harness: the rig', () => {
  const rigOf = (f: ReturnType<typeof fixture>) => {
    const rig = f.ctx.weapon.aimRig.getObjectByName('axe-rig')!;
    return { rig, haft: rig.getObjectByName('axe-haft')! };
  };

  it('hangs on the aim rig, shown when the axe is up, hidden when fully lowered', () => {
    const f = fixture();
    const { rig } = rigOf(f);
    expect(rig.parent).toBe(f.ctx.weapon.aimRig);
    f.axe.updateRig();
    expect(rig.visible).toBe(true);
    expect(rig.position.length()).toBeCloseTo(0, 12);       // no holster offset when up
    const off = fixture('shotgun');                          // another slot is up: the axe is fully lowered
    off.axe.updateRig();
    expect(rigOf(off).rig.visible).toBe(false);
  });

  it('is hidden while a scripted sequence has started', () => {
    const f = fixture();
    f.ctx.world.sequence = { started: true, active: false };
    f.axe.updateRig();
    expect(rigOf(f).rig.visible).toBe(false);
    f.ctx.world.sequence = { started: false, active: false };
    f.axe.updateRig();
    expect(rigOf(f).rig.visible).toBe(true);
  });

  it('poses the haft from axePose: rest when idle, the swing\'s pose mid-swing', () => {
    const f = fixture();
    const { haft } = rigOf(f);
    f.axe.updateRig();
    const rest = axePose(makeAxeSwing());
    expect(haft.position.toArray()).toEqual([...rest.grip]);
    expect([haft.rotation.x, haft.rotation.y, haft.rotation.z]).toEqual([...rest.rot]);
    // Mirror the harness's inputs on the pure swing: the click tick (held), the release, then 9 more ticks.
    let s = stepAxeSwing(makeAxeSwing(), { click: true, held: true }, 1 / 60).state;
    for (let i = 0; i < 9; i++) s = stepAxeSwing(s, { click: false, held: false }, 1 / 60).state;
    f.clickOnce();
    f.ticks(9);
    f.axe.updateRig();
    const p = axePose(s);
    expect(s.phase).toBe('swing');
    expect(Math.hypot(p.grip[0] - rest.grip[0], p.grip[1] - rest.grip[1], p.grip[2] - rest.grip[2])).toBeGreaterThan(0.05);
    for (let i = 0; i < 3; i++) {
      expect(haft.position.getComponent(i)).toBeCloseTo(p.grip[i as 0 | 1 | 2], 9);
      expect([haft.rotation.x, haft.rotation.y, haft.rotation.z][i]).toBeCloseTo(p.rot[i as 0 | 1 | 2], 9);
    }
  });
});
