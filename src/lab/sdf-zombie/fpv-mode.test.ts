// src/lab/sdf-zombie/fpv-mode.test.ts
//
// Unit tests for the FPV orchestration seams: mode transitions, the
// cook → throw → flight → detonate pipeline (with a recording gore port and
// a stub world — no renderer), the overcook in-hand path, forceThrow
// automation, hand jiggle/pose/world-transform math, the camera-kick
// envelope, applyExplosionEffect routing, and determinism.
import { describe, it, expect } from 'vitest';
import {
  applyExplosionEffect, enterFpvMode, exitFpvMode, forceThrow,
  handFieldFrame, handPoseTargets, handPrimsToWorld, handPropPoses,
  handSheetProjections, kickAngles, makeFpvMode, makeHandFieldUi,
  requestHandField, settleHandVolume, splitHandWounds,
  makeHandJiggle, posedHandPrims, releasePendingThrow, stepFpvMode, stepHandJiggle,
  type FpvGorePort, type FpvKick, type FpvModeState, type FpvWorld,
  type HandFieldUi,
} from './fpv-mode';
import { EMPTY_FPV_INPUT, chargeFraction, throwDirection, throwOrigin, throwSpeedMps, type FpvInput } from './fpv';
import { makeFlight } from './dynamite-flight';
import {
  HAND_PRIMS, HAND_PRIM_COUNTS, HAND_PRIM_GROUPS, HAND_PROPS, buildHandPrims,
  poseAt, propAnchor,
} from './hands';
import { resolveExplosion, type ExplosionEffect } from './explosion-aoe';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { ZOMBIE } from './body';
import type { Primitive, Vec3 } from './types';
import type { Wound } from './damage';
import { add } from './vec';

// ——— Fixtures —————————————————————————————————————————————————————————

const DT = 1 / 60;

/** A recording gore port — every call lands in a named bucket. */
function recordingPort() {
  const calls: {
    stampWounds: Wound[][]; creditMeter: number[]; impulseRig: [Vec3, Vec3][];
    severFullLimbs: string[][]; applyChainCuts: unknown[][]; gibBody: number;
    impulseChunks: unknown[][]; spawnBurst: unknown[]; stampHandWounds: Wound[][];
    pushShot: { type: string; torso: boolean }[];
  } = {
    stampWounds: [], creditMeter: [], impulseRig: [], severFullLimbs: [],
    applyChainCuts: [], gibBody: 0, impulseChunks: [], spawnBurst: [],
    stampHandWounds: [], pushShot: [],
  };
  const port: FpvGorePort = {
    stampWounds: ws => { calls.stampWounds.push([...ws]); },
    creditMeter: c => { calls.creditMeter.push(c); },
    impulseRig: (at, vel) => { calls.impulseRig.push([at, vel]); },
    severFullLimbs: ls => { calls.severFullLimbs.push([...ls]); },
    applyChainCuts: cs => { calls.applyChainCuts.push([...cs]); },
    gibBody: () => { calls.gibBody++; },
    impulseChunks: is => { calls.impulseChunks.push([...is]); },
    spawnBurst: v => { calls.spawnBurst.push(v); },
    stampHandWounds: ws => { calls.stampHandWounds.push([...ws]); },
    pushShot: s => { calls.pushShot.push({ type: s.type, torso: s.torso }); },
  };
  return { port, calls };
}

/** A one-prim sphere body — exact surface distances for AOE assertions. */
function ballBody(center: Vec3, radius = 0.3): BuildResult {
  const prim: Primitive = {
    a: center, b: center, radius, scale: [1, 1, 1], blendK: 0.01,
    limb: 'torso', cluster: 1,
  };
  return {
    prims: [prim],
    clusters: [{
      id: 1, limb: 'torso', start: 0, count: 1,
      center: [...center] as Vec3, radius, alive: true,
    }],
    bones: new Map(), errors: [],
  };
}

const zombie = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

/** A stub world: one ball body + no chunks + hands at an anchor. */
function stubWorld(hero: BuildResult, handAnchor?: Vec3): FpvWorld {
  const hands = handAnchor
    ? [...buildHandPrims().left, ...buildHandPrims().right].map(p => ({
      ...p, a: add(p.a, handAnchor) as Vec3, b: add(p.b, handAnchor) as Vec3,
    }))
    : [];
  return {
    heroPosed: () => hero,
    chunks: () => [],
    handPrimsWorld: () => hands,
  };
}

const PRESS: FpvInput = { ...EMPTY_FPV_INPUT, press: true };
const RELEASE: FpvInput = { ...EMPTY_FPV_INPUT, release: true };

/** Steps `n` frames of quiet time; returns the accumulated clock. */
function idle(state: FpvModeState, world: FpvWorld, port: FpvGorePort, n: number, t0: number) {
  let s = state;
  let t = t0;
  for (let i = 0; i < n; i++) {
    s = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port).state;
    t += DT;
  }
  return { state: s, t };
}

// ——— Mode transitions ———————————————————————————————————————————————————

describe('mode transitions', () => {
  it('starts in god mode; enter/exit toggle and are idempotent', () => {
    const s0 = makeFpvMode();
    expect(s0.mode).toBe('god');
    const s1 = enterFpvMode(s0);
    expect(s1.mode).toBe('fpv');
    expect(enterFpvMode(s1).mode).toBe('fpv');
    const s2 = exitFpvMode(s1);
    expect(s2.mode).toBe('god');
    expect(exitFpvMode(s2).mode).toBe('god');
  });

  it('FPV state persists across exit/enter (position and aim resume)', () => {
    const port = recordingPort().port;
    const world = stubWorld(zombie);
    let s = enterFpvMode(makeFpvMode());
    s = stepFpvMode(s, { ...EMPTY_FPV_INPUT, dx: 30, forward: true }, 0.5, 1, world, port).state;
    const pos = s.fpv.pos, yaw = s.fpv.yaw;
    s = exitFpvMode(s);
    s = stepFpvMode(s, EMPTY_FPV_INPUT, 0.5, 1.5, world, port).state; // god: frozen
    expect(s.fpv.pos).toEqual(pos);
    expect(s.fpv.yaw).toBe(yaw);
    s = enterFpvMode(s);
    expect(s.fpv.pos).toEqual(pos);
    expect(s.fpv.yaw).toBe(yaw);
  });

  it('enterFpvMode can override the spawn for automation', () => {
    const s = enterFpvMode(makeFpvMode(), { pos: [1, 0, 2], yaw: 0.5 });
    expect(s.fpv.pos).toEqual([1, 0, 2]);
    expect(s.fpv.yaw).toBe(0.5);
  });
});

// ——— Cook → throw → detonate ———————————————————————————————————————————

describe('cook → throw → detonate pipeline', () => {
  it('press starts cooking, the charge reads out, release spawns the flight', () => {
    const { port, calls } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30])); // far: no detonation effects
    let s = enterFpvMode(makeFpvMode());
    let t = 0;

    let r = stepFpvMode(s, PRESS, DT, t, world, port);
    s = r.state; t += DT;
    expect(s.fpv.cook.phase).toBe('cooking');
    expect(r.frame.charge).toBeCloseTo(0, 6);

    for (let i = 0; i < 60; i++) { // 1.0 s of cooking
      r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port);
      s = r.state; t += DT;
    }
    expect(s.fpv.cook.phase).toBe('cooking');
    expect(r.frame.charge).toBeCloseTo(0.5, 2);

    r = stepFpvMode(s, RELEASE, DT, t, world, port);
    s = r.state; t += DT;
    expect(s.fpv.cook.phase).toBe('cooldown');
    expect(s.flight).not.toBeNull();
    // The bundle left the throw origin at the mapped speed — exactly, because
    // a same-frame spawn does not integrate until the next frame.
    const o = throwOrigin(enterFpvMode(makeFpvMode()).fpv);
    expect(s.flight!.pos[0]).toBeCloseTo(o[0], 3);
    expect(s.flight!.vel[1]).toBeGreaterThan(0); // lobbed
    const heldSec = 61 * DT; // press at t=0, release at t=61·DT
    const speed = Math.hypot(...s.flight!.vel);
    expect(speed).toBeCloseTo(throwSpeedMps(heldSec / 2), 6);
    // No detonation yet — the hero is far away and the bundle is airborne.
    expect(calls.spawnBurst).toHaveLength(0);
  });

  it('a landed bundle detonates through the gore port (wounds + direct meter credit)', () => {
    // Hero ball at the landing zone, far enough to survive (no gib): the
    // falloff-scaled wound path with the DIRECT meter credit.
    const hero = ballBody([0, 0.9, -7]);
    const { port, calls } = recordingPort();
    const world = stubWorld(hero);
    let s = enterFpvMode(makeFpvMode()); // at [0,0,4] facing -Z... aim from spawn
    // Re-aim from the origin so the throw lands near the ball deterministically.
    s = enterFpvMode(exitFpvMode(s), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    let t = 0;

    let r = stepFpvMode(s, PRESS, DT, t, world, port);
    s = r.state; t += DT;
    for (let i = 0; i < 6; i++) { r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port); s = r.state; t += DT; }
    r = stepFpvMode(s, RELEASE, DT, t, world, port);
    s = r.state; t += DT;
    expect(s.flight).not.toBeNull();

    // Step until it detonates (impact on the floor near the ball).
    let det = false;
    for (let i = 0; i < 240 && !det; i++) {
      const before = s.flight;
      r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port);
      s = r.state; t += DT;
      if (before && !s.flight) det = true;
    }
    expect(det).toBe(true);
    expect(s.flight).toBeNull();

    // The bundle resolved through the EXISTING resolver: the recorded credit
    // equals a direct resolveExplosion's meterCredit — credited DIRECTLY,
    // never as freshWounds.
    const at = calls.spawnBurst[0] as { at: Vec3 };
    const direct = resolveExplosion(at.at, [{ id: 'hero', body: hero }], {
      eye: [0, 1.75, 0],
    });
    const eff = direct.perBody[0]!;
    expect(eff.gibbed).toBe(false);
    expect(calls.creditMeter).toEqual([eff.meterCredit]);
    expect(calls.stampWounds[0]!.length).toBe(eff.wounds.length);
    expect(calls.impulseRig.length).toBe(1);
    expect(calls.pushShot[0]!.type).toBe('blast');
    expect(calls.gibBody).toBe(0);
    // Ground burst: the bundle rests on the floor when it detonates.
    expect((calls.spawnBurst[0] as { kind: string }).kind).toBe('ground');
  });

  it('a point-blank bundle gibs through the single-hit rule (no wounds)', () => {
    const hero = ballBody([0, 0.9, -3.3]); // landing zone, close ⇒ gib
    const { port, calls } = recordingPort();
    const world = stubWorld(hero);
    let s = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    let t = 0;
    let r = stepFpvMode(s, PRESS, DT, t, world, port); s = r.state; t += DT;
    for (let i = 0; i < 6; i++) { r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port); s = r.state; t += DT; }
    r = stepFpvMode(s, RELEASE, DT, t, world, port); s = r.state; t += DT;

    let gibbed = false;
    for (let i = 0; i < 240 && !gibbed; i++) {
      r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port);
      s = r.state; t += DT;
      if (calls.gibBody > 0) gibbed = true;
    }
    expect(gibbed).toBe(true);
    // Gib supersedes the wound path entirely.
    expect(calls.stampWounds).toHaveLength(0);
    expect(calls.creditMeter).toHaveLength(0);
    expect(calls.impulseRig).toHaveLength(0);
  });
});

// ——— Overcook ———————————————————————————————————————————————————————————

describe('overcook (in-hand detonation)', () => {
  it('holding past the fuse detonates at the hands: splash, air burst, kick', () => {
    const { port, calls } = recordingPort();
    // Hands sit at the throw origin; hero parked far away so only the
    // hand-splash + burst + kick paths fire.
    const anchor = throwOrigin(makeFpvMode().fpv);
    const world = stubWorld(ballBody([0, 1, 60]), anchor);
    let s = enterFpvMode(makeFpvMode());
    let t = 0;
    let r = stepFpvMode(s, PRESS, DT, t, world, port); s = r.state; t += DT;

    // fuseMaxSec = 2.0 s — hold well past it.
    for (let i = 0; i < 150; i++) {
      r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port); s = r.state; t += DT;
    }
    expect(s.fpv.cook.phase).toBe('idle'); // overcook returned to idle
    expect(calls.spawnBurst).toHaveLength(1);
    // Hands are inside the splash band → hand wounds stamped.
    expect(calls.stampHandWounds.length).toBeGreaterThan(0);
    // Held at chest height ⇒ AIR burst.
    expect((calls.spawnBurst[0] as { kind: string }).kind).toBe('air');
    // The blast is at the hands: a large camera kick.
    expect(s.kick).not.toBeNull();
    expect(s.kick!.mag).toBeGreaterThan(2);
    // No flight was ever spawned.
    expect(s.flight).toBeNull();
  });
});

// ——— X1.27 task E3: deferred throw release (clip mode) ——————————————————

/** Reads `pendingThrow` off a state that may predate the field (the
 *  pre-refactor pin test). */
function pendingOf(s: FpvModeState): unknown {
  return (s as { pendingThrow?: unknown }).pendingThrow ?? null;
}

describe('immediate release mode (default, pinned pre-refactor)', () => {
  it('the release frame spawns the flight at the current throwOrigin, with no pending', () => {
    const { port } = recordingPort();
    const world = stubWorld(zombie);
    let s = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    let t = 0;
    s = stepFpvMode(s, PRESS, DT, t, world, port).state; t += DT;
    for (let i = 0; i < 6; i++) { s = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port).state; t += DT; }
    s = stepFpvMode(s, RELEASE, DT, t, world, port).state;
    expect(s.flight).not.toBeNull();
    // spawned EXACTLY at the aim's throw origin (same-frame spawns do not integrate)
    expect(s.flight!.pos).toEqual(throwOrigin(s.fpv));
    expect(pendingOf(s)).toBeNull();
    // the impulse is the aim direction × the mapped charge speed
    const held = 7 * DT;
    const speed = throwSpeedMps(chargeFraction(held));
    const d = throwDirection(s.fpv.yaw, s.fpv.pitch);
    expect(s.flight!.vel[0]).toBeCloseTo(d[0] * speed, 6);
    expect(s.flight!.vel[1]).toBeCloseTo(d[1] * speed, 6);
    expect(s.flight!.vel[2]).toBeCloseTo(d[2] * speed, 6);
  });
});

describe('deferred release mode (clip)', () => {
  /** Cooks briefly and releases in DEFERRED mode: pending set, no flight. */
  function deferredPending() {
    const { port } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30]));
    let s = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    let t = 0;
    s = stepFpvMode(s, PRESS, DT, t, world, port).state; t += DT;
    for (let i = 0; i < 6; i++) { s = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port).state; t += DT; }
    s = stepFpvMode(s, RELEASE, DT, t, world, port, undefined, 'deferred').state;
    return { s, t: t + DT, world, port, held: 7 * DT };
  }

  it('the throw signal sets pendingThrow and spawns no flight', () => {
    const { s, held } = deferredPending();
    expect(s.flight).toBeNull();
    expect(s.pendingThrow).not.toBeNull();
    const d = throwDirection(s.fpv.yaw, s.fpv.pitch);
    expect(s.pendingThrow!.direction[0]).toBeCloseTo(d[0], 12);
    expect(s.pendingThrow!.direction[1]).toBeCloseTo(d[1], 12);
    expect(s.pendingThrow!.direction[2]).toBeCloseTo(d[2], 12);
    expect(s.pendingThrow!.speedMps).toBeCloseTo(throwSpeedMps(chargeFraction(held)), 9);
  });

  it('subsequent frames do not duplicate the pending throw', () => {
    const { s, world, port, t } = deferredPending();
    const first = s.pendingThrow;
    expect(first).not.toBeNull();
    let cur = s;
    let tt = t;
    for (let i = 0; i < 10; i++) {
      cur = stepFpvMode(cur, EMPTY_FPV_INPUT, DT, tt, world, port).state;
      tt += DT;
      expect(cur.flight).toBeNull();
      expect(cur.pendingThrow).toEqual(first);
    }
  });

  it('releasePendingThrow spawns at the exact position, clears pending, and caps the hand velocity at 2.5 m/s', () => {
    const { s } = deferredPending();
    const d = throwDirection(s.fpv.yaw, s.fpv.pitch);
    const speed = s.pendingThrow!.speedMps;
    const pos: Vec3 = [1.25, 1.5, -0.75];

    // zero hand velocity: exactly the stored aim impulse
    const r0 = releasePendingThrow(s, pos, [0, 0, 0]);
    expect(r0.flight!.pos).toEqual(pos); // EXACT — the handoff position
    expect(r0.pendingThrow).toBeNull();
    expect(r0.flight!.vel[0]).toBeCloseTo(d[0] * speed, 9);
    expect(r0.flight!.vel[1]).toBeCloseTo(d[1] * speed, 9);
    expect(r0.flight!.vel[2]).toBeCloseTo(d[2] * speed, 9);
    expect(r0.flight!.spawn).toEqual(pos);
    expect(r0.flight!.age).toBe(0);

    // a fast hand contributes at most 2.5 m/s along its own direction
    const big = releasePendingThrow(s, pos, [0, 10, 0]);
    expect(big.flight!.vel[1]).toBeCloseTo(d[1] * speed + 2.5, 9);
    expect(big.flight!.vel[0]).toBeCloseTo(d[0] * speed, 9);
    expect(big.flight!.vel[2]).toBeCloseTo(d[2] * speed, 9);

    // a slow hand contributes its full velocity
    const small = releasePendingThrow(s, pos, [0, 1, 0]);
    expect(small.flight!.vel[1]).toBeCloseTo(d[1] * speed + 1, 9);
  });

  it('a second release call is identity', () => {
    const { s } = deferredPending();
    const r1 = releasePendingThrow(s, [0.2, 1.0, -0.3], [0.5, 0, 0]);
    const r2 = releasePendingThrow(r1, [9, 9, 9], [8, 0, 0]);
    expect(r2).toEqual(r1);
  });

  it('the new flight does not integrate until the next stepFpvMode', () => {
    const { s, world, port, t } = deferredPending();
    const released = releasePendingThrow(s, [0.2, 1.0, -0.3], [0, 0, 0]);
    expect(released.flight!.pos).toEqual([0.2, 1.0, -0.3]);
    const stepped = stepFpvMode(released, EMPTY_FPV_INPUT, DT, t, world, port).state;
    expect(stepped.flight).not.toBeNull();
    const moved = stepped.flight!.pos[0] !== 0.2 || stepped.flight!.pos[1] !== 1.0 || stepped.flight!.pos[2] !== -0.3;
    expect(moved).toBe(true);
  });

  it('overcook still detonates immediately in deferred mode', () => {
    const { port, calls } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30]));
    let s = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    let t = 0;
    s = stepFpvMode(s, PRESS, DT, t, world, port).state; t += DT;
    let frames = 0;
    while (calls.spawnBurst.length === 0 && frames < 200) {
      s = stepFpvMode(s, EMPTY_FPV_INPUT, DT, t, world, port, undefined, 'deferred').state;
      t += DT;
      frames++;
    }
    expect(calls.spawnBurst.length).toBeGreaterThan(0); // the overcook frame
    expect(s.flight).toBeNull();
    expect(s.pendingThrow).toBeNull();
  });

  it('forceThrow deferred parks a pending throw; default stays immediate', () => {
    const base = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    const deferred = forceThrow(base, 1, 5, 'deferred');
    expect(deferred.flight).toBeNull();
    expect(deferred.pendingThrow).not.toBeNull();
    const d = throwDirection(base.fpv.yaw, base.fpv.pitch);
    expect(deferred.pendingThrow!.direction[1]).toBeCloseTo(d[1], 12);
    expect(deferred.pendingThrow!.speedMps).toBeCloseTo(throwSpeedMps(1), 9);
    const immediate = forceThrow(base, 1, 5);
    expect(immediate.flight).not.toBeNull();
    expect(immediate.pendingThrow).toBeNull();
  });
});

// ——— forceThrow —————————————————————————————————————————————————————————

describe('forceThrow (automation)', () => {
  it('spawns a bundle at the given charge with the hands playing the throw', () => {
    const { port } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30]));
    const base = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
    const s = forceThrow(base, 1, 5);
    expect(s.flight).not.toBeNull();
    expect(Math.hypot(...s.flight!.vel)).toBeCloseTo(throwSpeedMps(1), 6);
    expect(s.fpv.cook.phase).toBe('cooldown');
    // The bundle is live and integrates in the next frames.
    const r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, 5 + DT, world, port);
    expect(r.state.flight).not.toBeNull();
    expect(r.state.flight!.age).toBeGreaterThan(0);
  });
});

// ——— Hand math ——————————————————————————————————————————————————————————

describe('hand jiggle + posing', () => {
  it('makeHandJiggle seeds one point per prim at the rest midpoints', () => {
    const j = makeHandJiggle();
    const prims = buildHandPrims();
    expect(j.left.length).toBe(prims.left.length);
    expect(j.right.length).toBe(prims.right.length);
    expect(j.right[0]!.pos[0]).toBeCloseTo((prims.right[0]!.a[0] + prims.right[0]!.b[0]) / 2, 9);
  });

  it('pinned prims (the forearm) never leave the posed target', () => {
    const prims = buildHandPrims();
    const pose = poseAt('idle', 0, 0);
    const targets = handPoseTargets(prims, pose);
    let j = makeHandJiggle();
    // Shove EVERY point hard.
    j = {
      left: j.left.map(p => ({ pos: [p.pos[0], p.pos[1] + 0.2, p.pos[2]], prev: p.pos })),
      right: j.right.map(p => ({ pos: [p.pos[0], p.pos[1] + 0.2, p.pos[2]], prev: p.pos })),
    };
    for (let i = 0; i < 10; i++) j = stepHandJiggle(j, targets, DT);
    expect(j.right[0]!.pos[1]).toBeCloseTo(targets.right[0]![1], 9); // forearm pinned
    expect(j.left[0]!.pos[1]).toBeCloseTo(targets.left[0]![1], 9);
  });

  it('a displaced distal prim settles back toward its posed target', () => {
    const prims = buildHandPrims();
    const targets = handPoseTargets(prims, poseAt('idle', 0, 0));
    let j = makeHandJiggle();
    const mitten = 3;
    const y0 = j.right[mitten]!.pos[1];
    j = {
      ...j,
      right: j.right.map((p, i) =>
        i === mitten ? { pos: [p.pos[0], p.pos[1] + 0.06, p.pos[2]], prev: p.pos } : p),
    };
    // The shove reads as velocity (prev = pre-shove) — the wobble, then the
    // rest pull wins.
    let d0 = -1, d1 = -1;
    for (let i = 0; i < 90; i++) {
      j = stepHandJiggle(j, targets, DT);
      const d = Math.abs(j.right[mitten]!.pos[1] - y0);
      if (i === 0) d0 = d;
      d1 = d;
    }
    expect(d0).toBeGreaterThan(0.02);
    expect(d1).toBeLessThan(0.005);
  });

  it('posedHandPrims folds pose offsets, scales, and jiggle displacement', () => {
    const prims = buildHandPrims();
    const pose = poseAt('light', 10, 0); // fully blended into light
    const targets = handPoseTargets(prims, pose);
    // Settle the jiggle onto the posed targets first — a settled point IS the
    // posed midpoint, so the fold shows the pose offset exactly.
    let j = makeHandJiggle();
    for (let i = 0; i < 120; i++) j = stepHandJiggle(j, targets, DT);
    // Displace the settled mitten point 1 cm +x — the visible wobble.
    j = { ...j, right: j.right.map((p, i) => i === 3
      ? { pos: [p.pos[0] + 0.01, p.pos[1], p.pos[2]], prev: p.pos } : p) };
    const posed = posedHandPrims(prims, pose, j);
    const rest = prims.right[3]!;
    const out = posed.right[3]!;
    // Both endpoints moved by pose offset + the 1 cm jiggle displacement.
    // (±2 mm on x, ±5 mm on y: the soft rest pull never fully defeats
    // camera-local gravity — the equilibrium sag IS the fleshy-weight look.)
    const tr = pose.right[3]!;
    expect(out.a[0] - rest.a[0]).toBeCloseTo(tr.pos[0] + 0.01, 2);
    expect(out.b[1] - rest.b[1]).toBeCloseTo(tr.pos[1], 1.5);
    // Scale multiplies: the light gesture swells the DIGITS (the grip
    // tightens on the bundle), so read the swell off a finger tube.
    const finger = HAND_PRIM_GROUPS.lead.digits[0]!;
    expect(posed.right[finger]!.scale[0]).toBeCloseTo(
      prims.right[finger]!.scale[0] * pose.right[finger]!.scale[0], 6);
    expect(pose.right[finger]!.scale[0]).toBeGreaterThan(1);
    // An unstepped point (fresh rest midpoint) shows NO pose — the fold is
    // point-driven by design; the jiggle carries the pose.
    const fresh = posedHandPrims(prims, pose, makeHandJiggle());
    expect(fresh.right[3]!.a[0] - rest.a[0]).toBeCloseTo(0, 6);
    expect(targets.right.length).toBe(HAND_PRIM_COUNTS.lead);
    expect(targets.left.length).toBe(HAND_PRIM_COUNTS.support);
  });
});

describe('handPrimsToWorld', () => {
  const rest = buildHandPrims();
  it('maps camera-local axes to world axes at yaw/pitch 0', () => {
    const w = handPrimsToWorld({
      left: [{ ...rest.left[0]!, a: [0, 0, -1], b: [1, 0, 0] }],
      right: [{ ...rest.right[0]!, a: [0, 1, 0], b: [0, 0, 1] }],
    }, [0, 1.75, 0], 0, 0);
    // Camera-local +Z is TOWARD the scene: local -Z lands behind the eye.
    expect(w[0]!.a).toEqual([0, 1.75, 1]);   // (0,0,-1) → behind (+Z)
    expect(w[0]!.b).toEqual([1, 1.75, 0]);   // (1,0,0) → right (+X)
    expect(w[1]!.a).toEqual([0, 2.75, 0]);   // (0,1,0) → up (+Y)
    expect(w[1]!.b).toEqual([0, 1.75, -1]);  // (0,0,1) → forward (-Z)
  });

  it('yaw π/2 turns forward to +X', () => {
    const w = handPrimsToWorld({
      left: [], right: [{ ...rest.right[0]!, a: [0, 0, 1], b: [0, 0, 0] }],
    }, [0, 0, 0], Math.PI / 2, 0);
    expect(w[0]!.a[0]).toBeCloseTo(1, 9);
    expect(w[0]!.a[2]).toBeCloseTo(0, 9);
  });
});

// ——— Held props ————————————————————————————————————————————————————————

describe('handPropPoses', () => {
  const posed = buildHandPrims();

  it('seats each prop on its own hand, in WORLD space at the camera basis', () => {
    const eye: Vec3 = [3, 1.75, -2];
    const seats = handPropPoses(posed, eye, 0, 0);
    // yaw/pitch 0: right=+X, up=+Y, forward=−Z, so world = eye + (x, y, −z).
    const stick = propAnchor(posed.right, HAND_PROPS.stick);
    expect(seats.stick.pos[0]).toBeCloseTo(eye[0] + stick.pos[0], 9);
    expect(seats.stick.pos[1]).toBeCloseTo(eye[1] + stick.pos[1], 9);
    expect(seats.stick.pos[2]).toBeCloseTo(eye[2] - stick.pos[2], 9);
    const cig = propAnchor(posed.left, HAND_PROPS.cig);
    expect(seats.cig.pos[0]).toBeCloseTo(eye[0] + cig.pos[0], 9);
    // The bundle rides the right of the view, the cigarette the left.
    expect(seats.stick.pos[0]).toBeGreaterThan(seats.cig.pos[0]);
  });

  it('keeps the axis CAMERA-local — turning does not re-tilt the prop', () => {
    const a = handPropPoses(posed, [0, 1.75, 0], 0, 0);
    const b = handPropPoses(posed, [0, 1.75, 0], 1.1, -0.3);
    expect(b.stick.axis).toEqual(a.stick.axis);
    expect(b.cig.axis).toEqual(a.cig.axis);
    // …while the world seat DOES follow the turn.
    expect(b.stick.pos).not.toEqual(a.stick.pos);
  });

  it('follows the hand: a posed/jiggled hand carries its prop with it', () => {
    const pose = poseAt('cook', 10, 0);
    let j = makeHandJiggle();
    const targets = handPoseTargets(HAND_PRIMS, pose);
    for (let i = 0; i < 120; i++) j = stepHandJiggle(j, targets, DT);
    const moved = posedHandPrims(HAND_PRIMS, pose, j);
    const rest = handPropPoses(HAND_PRIMS, [0, 0, 0], 0, 0);
    const cooked = handPropPoses(moved, [0, 0, 0], 0, 0);
    const d = Math.hypot(
      cooked.stick.pos[0] - rest.stick.pos[0],
      cooked.stick.pos[1] - rest.stick.pos[1],
      cooked.stick.pos[2] - rest.stick.pos[2],
    );
    expect(d).toBeGreaterThan(0.01); // the cocked hold takes the bundle with it
  });
});

// ——— Sheet projection + wound split ————————————————————————————————————————

describe('handSheetProjections', () => {
  const posed = buildHandPrims();

  it('gives each hand its own WORLD-space frame, orthonormal and handed', () => {
    const eye: Vec3 = [2, 1.75, -3];
    const proj = handSheetProjections(posed, eye, 0.7, -0.2);
    for (const side of ['left', 'right'] as const) {
      const b = proj[side].basis;
      for (const v of [b.x, b.y, b.z]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      const d = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      expect(d(b.x, b.y)).toBeCloseTo(0, 9);
      expect(d(b.y, b.z)).toBeCloseTo(0, 9);
      for (const v of proj[side].halfExtent) expect(v).toBeGreaterThan(0);
    }
    // HANDEDNESS DIFFERS BETWEEN THE HANDS, and that is inherent rather than a
    // bug. The sheet basis is (thumb-ward, knuckle-ward, back-of-hand), which is
    // a LEFT-handed triple for a right hand and right-handed for a left one — the
    // bake measured the same thing as determinants −1 (grip) and +1 (pinch) — and
    // the camera→world map flips both again. So exactly one side arrives here as a
    // reflection, which is why fpv-view's setProjection measures the determinant
    // and negates a column rather than trusting a per-hand flag. Asserted as an
    // inequality so nobody "fixes" one side into agreeing with the other.
    const detOf = (b: { x: Vec3; y: Vec3; z: Vec3 }): number => {
      const cx: Vec3 = [
        b.x[1] * b.y[2] - b.x[2] * b.y[1],
        b.x[2] * b.y[0] - b.x[0] * b.y[2],
        b.x[0] * b.y[1] - b.x[1] * b.y[0],
      ];
      return cx[0] * b.z[0] + cx[1] * b.z[1] + cx[2] * b.z[2];
    };
    const dl = detOf(proj.left.basis), dr = detOf(proj.right.basis);
    expect(Math.abs(dl)).toBeCloseTo(1, 9);   // orthonormal, so ±1
    expect(Math.abs(dr)).toBeCloseTo(1, 9);
    expect(Math.sign(dl)).not.toBe(Math.sign(dr));
    // The two centres are metres apart — one projection could never serve both,
    // which is why each hand gets its own view.
    const dx = proj.left.centre.map((v, i) => v - proj.right.centre[i]!);
    expect(Math.hypot(...dx)).toBeGreaterThan(0.1);
  });

  it('centres on the hand and follows it when the pose moves', () => {
    const eye: Vec3 = [0, 1.75, 0];
    const rest = handSheetProjections(posed, eye, 0, 0);
    const moved = handSheetProjections({
      left: posed.left.map(p => ({ ...p,
        a: [p.a[0], p.a[1] + 0.05, p.a[2]] as Vec3,
        b: [p.b[0], p.b[1] + 0.05, p.b[2]] as Vec3 })),
      right: posed.right,
    }, eye, 0, 0);
    expect(moved.left.centre[1] - rest.left.centre[1]).toBeCloseTo(0.05, 9);
    expect(moved.right.centre[1]).toBeCloseTo(rest.right.centre[1], 9);
  });
});

describe('splitHandWounds', () => {
  it('routes each wound to its own hand and rebases the right hand’s indices', () => {
    const ws = [
      { primIdx: 0, tag: 'l0' }, { primIdx: 6, tag: 'l6' },
      { primIdx: 7, tag: 'r0' }, { primIdx: 13, tag: 'r6' },
    ];
    const { left, right } = splitHandWounds(ws, 7);
    expect(left.map(w => w.tag)).toEqual(['l0', 'l6']);
    expect(left.map(w => w.primIdx)).toEqual([0, 6]);
    expect(right.map(w => w.tag)).toEqual(['r0', 'r6']);
    expect(right.map(w => w.primIdx)).toEqual([0, 6]);
  });

  it('never drops, duplicates or mutates a wound', () => {
    const ws = Array.from({ length: 14 }, (_, i) => ({ primIdx: i }));
    const { left, right } = splitHandWounds(ws, 7);
    expect(left.length + right.length).toBe(ws.length);
    expect(ws.map(w => w.primIdx)).toEqual([...Array(14).keys()]); // inputs intact
    expect(splitHandWounds([], 7)).toEqual({ left: [], right: [] });
  });
});

// ——— Camera kick ————————————————————————————————————————————————————————

describe('camera kick envelope', () => {
  it('is zero without a kick, decays, and cuts off past the window', () => {
    expect(kickAngles(null, 5)).toEqual({ pitch: 0, roll: 0 });
    const kick: FpvKick = { start: 10, mag: 4 };
    const t0 = kickAngles(kick, 10);
    expect(Math.abs(t0.pitch) + Math.abs(t0.roll)).toBeGreaterThan(0.01);
    const half = kickAngles(kick, 10.3);
    const end = kickAngles(kick, 10.9);
    expect(Math.abs(half.pitch) + Math.abs(half.roll)).toBeLessThan(
      Math.abs(t0.pitch) + Math.abs(t0.roll));
    expect(kickAngles(kick, 10 + 1.01)).toEqual({ pitch: 0, roll: 0 });
  });
});

// ——— applyExplosionEffect routing ———————————————————————————————————————

describe('applyExplosionEffect routing', () => {
  const mk = (over: Partial<ExplosionEffect>): ExplosionEffect => ({
    radiusM: 4.6875,
    perBody: [],
    chunkImpulses: [],
    burst: { kind: 'air', at: [0, 1, 0], heightM: 1.9 },
    cameraKick: 0,
    handWounds: [],
    ...over,
  });

  it('routes a wounded body: wounds → meter → impulse+shot → cuts', () => {
    const { port, calls } = recordingPort();
    const hero = ballBody([0, 1, 0]);
    const eff = mk({
      perBody: [{
        bodyId: 'hero', distM: 2, falloff: 0.5, damage: 100, gibbed: false,
        wounds: [{ primIdx: 0, local: [0, 0, 0], radius: 0.1, type: 'blast', ageSec: 0 }],
        meterCredit: 0.42,
        severedLimbs: ['armL'],
        chainCuts: [{ limb: 'legR', joint: 3 } as never],
        rigImpulse: { at: [0, 1, 0.2], vel: [0, 6, 1] },
      }],
    });
    applyExplosionEffect(port, eff, [0, 1, -1], hero);
    expect(calls.stampWounds).toHaveLength(1);
    expect(calls.creditMeter).toEqual([0.42]);
    expect(calls.impulseRig).toHaveLength(1);
    expect(calls.pushShot).toEqual([{ type: 'blast', torso: true }]);
    expect(calls.severFullLimbs).toEqual([['armL']]);
    expect(calls.applyChainCuts).toHaveLength(1);
    expect(calls.gibBody).toBe(0);
    expect(calls.spawnBurst).toHaveLength(1);
  });

  it('a gibbed body routes to gibBody ONLY (supersedes wounds/cuts)', () => {
    const { port, calls } = recordingPort();
    const hero = ballBody([0, 1, 0]);
    const eff = mk({
      perBody: [{
        bodyId: 'hero', distM: 0.5, falloff: 0.9, damage: 300, gibbed: true,
        wounds: [], meterCredit: 3,
        severedLimbs: [], chainCuts: [], rigImpulse: null,
      }],
    });
    applyExplosionEffect(port, eff, [0, 1, 0], hero);
    expect(calls.gibBody).toBe(1);
    expect(calls.stampWounds).toHaveLength(0);
    expect(calls.creditMeter).toHaveLength(0);
    expect(calls.severFullLimbs).toHaveLength(0);
  });

  it('scene effects always fire: burst, chunks, hand wounds', () => {
    const { port, calls } = recordingPort();
    const hero = ballBody([0, 1, 0]);
    const eff = mk({
      chunkImpulses: [{ chunkId: 3, vel: [1, 2, 3] }],
      handWounds: [{ primIdx: 2, local: [0, 0, 0], radius: 0.08, type: 'blast', ageSec: 0 }],
    });
    applyExplosionEffect(port, eff, [0, 1, 0], hero);
    expect(calls.impulseChunks).toHaveLength(1);
    expect(calls.stampHandWounds).toHaveLength(1);
    expect(calls.spawnBurst).toHaveLength(1);
  });

  it('a body out of radius: burst only, nothing per-body', () => {
    const { port, calls } = recordingPort();
    applyExplosionEffect(port, mk({}), [0, 1, 0], ballBody([0, 1, 0]));
    expect(calls.spawnBurst).toHaveLength(1);
    expect(calls.stampWounds).toHaveLength(0);
    expect(calls.creditMeter).toHaveLength(0);
  });
});

// ——— Determinism + entry snapshot ———————————————————————————————————————

describe('determinism and pose continuity', () => {
  it('identical inputs produce identical states', () => {
    const run = () => {
      const { port } = recordingPort();
      const world = stubWorld(ballBody([0, 1, -30]));
      let s = enterFpvMode(makeFpvMode(), { pos: [0, 0, 0], yaw: 0, pitch: 0 });
      let t = 0;
      const seq: FpvInput[] = [PRESS, EMPTY_FPV_INPUT, EMPTY_FPV_INPUT, RELEASE];
      for (const inpt of seq) {
        s = stepFpvMode(s, inpt, DT, t, world, port).state;
        t += DT;
      }
      for (let i = 0; i < 30; i++) {
        s = stepFpvMode(s, { ...EMPTY_FPV_INPUT, dx: 3, forward: i % 2 === 0 }, DT, t, world, port).state;
        t += DT;
      }
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('an early release (during light) blends the throw from the captured pose', () => {
    const { port } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30]));
    let s = enterFpvMode(makeFpvMode());
    let t = 0;
    let r = stepFpvMode(s, PRESS, DT, t, world, port); s = r.state; t += DT;
    // Release during 'light' (< 0.15 s): the pre-release pose is captured and
    // consumed by the throw ON THE SAME FRAME (phaseT=0, where hands.ts
    // guarantees poseAt(B, 0, c, entry) === entry).
    const bobBefore = s.bobClock;
    const poseBefore = poseAt('light', t, bobBefore);
    r = stepFpvMode(s, RELEASE, DT, t, world, port);
    s = r.state;
    expect(s.handEntry).toBeNull(); // consumed
    expect(s.handEntryFrom).toBeNull();
    expect(r.frame.handPhase.phase).toBe('throw');
    // Continuity: the throw frame's pose IS the light pose at release (within
    // one frame of idle-bob re-add).
    const got = r.frame.handPose.right[3]!.pos[0];
    const want = poseBefore.right[3]!.pos[0];
    expect(Math.abs(got - want)).toBeLessThan(0.003);
  });

  it('flight steps in god mode too (a spectator watches the arc)', () => {
    const { port } = recordingPort();
    const world = stubWorld(ballBody([0, 1, -30]));
    let s = forceThrow(enterFpvMode(makeFpvMode(), { pos: [0, 0, 0] }), 0.5, 1);
    s = exitFpvMode(s);
    const r = stepFpvMode(s, EMPTY_FPV_INPUT, DT, 1 + DT, world, port);
    expect(r.state.flight).not.toBeNull();
    expect(r.state.flight!.age).toBeGreaterThan(0);
  });
});

// ——— Baked hand field UI (X1.26 task C2) ————————————————————————————————

describe('hand field UI state', () => {
  it('defaults: prims, warp off, clay off, volume loading', () => {
    expect(makeHandFieldUi()).toEqual({
      field: 'prims', warp: false, clay: false, load: 'loading', error: '',
    });
  });

  it('refuses baked until the volume is ready', () => {
    const ui = makeHandFieldUi();
    expect(requestHandField(ui, 'baked')).toBe(ui);          // loading: refused
    const errored = settleHandVolume(ui, false, 'fetch 404');
    expect(requestHandField(errored, 'baked').field).toBe('prims'); // error: refused
    const ready = settleHandVolume(ui, true);
    expect(requestHandField(ready, 'baked').field).toBe('baked');   // ready: honoured
  });

  it('prims is always honoured (the failed-load fallback)', () => {
    let ui: HandFieldUi = settleHandVolume(makeHandFieldUi(), true);
    ui = requestHandField(ui, 'baked');
    expect(ui.field).toBe('baked');
    expect(requestHandField(ui, 'prims').field).toBe('prims');
  });

  it('settle: success keeps the field; failure forces prims and keeps the message', () => {
    const loading = makeHandFieldUi();
    const ready = settleHandVolume(loading, true);
    expect(ready.load).toBe('ready');
    expect(ready.field).toBe('prims'); // bound, but no mode switch
    expect(settleHandVolume(ready, true)).toBe(ready);       // idempotent

    const baked = requestHandField(ready, 'baked');
    const failed = settleHandVolume(baked, false, 'binary sha-256 mismatch');
    expect(failed).toEqual({
      ...baked, load: 'error', error: 'binary sha-256 mismatch', field: 'prims',
    });
  });

  it('transitions never mutate the state they were given', () => {
    const ui = makeHandFieldUi();
    const snap = JSON.parse(JSON.stringify(ui));
    requestHandField(ui, 'baked');
    requestHandField(settleHandVolume(ui, true), 'baked');
    settleHandVolume(ui, false, 'x');
    handFieldFrame(ui, 'fpv', true);
    expect(JSON.parse(JSON.stringify(ui))).toEqual(snap);
  });
});

describe('hand field frame policy', () => {
  it('primitive mode shows both hands and the held props in FPV', () => {
    const ui = settleHandVolume(makeHandFieldUi(), true);
    expect(handFieldFrame(ui, 'fpv', true)).toEqual({
      leftHand: true, rightHand: true, heldProps: true,
    });
  });

  it('baked mode isolates the right hand and suppresses props', () => {
    const ui = requestHandField(settleHandVolume(makeHandFieldUi(), true), 'baked');
    expect(handFieldFrame(ui, 'fpv', true)).toEqual({
      leftHand: false, rightHand: true, heldProps: false,
    });
  });

  it('god mode or hands-off hides everything, either field', () => {
    const prims = makeHandFieldUi();
    const baked = requestHandField(settleHandVolume(prims, true), 'baked');
    for (const ui of [prims, baked]) {
      expect(handFieldFrame(ui, 'god', true)).toEqual({
        leftHand: false, rightHand: false, heldProps: false,
      });
      expect(handFieldFrame(ui, 'fpv', false)).toEqual({
        leftHand: false, rightHand: false, heldProps: false,
      });
    }
  });
});
