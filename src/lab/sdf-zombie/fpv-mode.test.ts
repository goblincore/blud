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
  handPoseTargets, handPrimsToWorld, handPropPoses, handSheetProjections,
  kickAngles, makeFpvMode, splitHandWounds,
  makeHandJiggle, posedHandPrims, stepFpvMode, stepHandJiggle,
  type FpvGorePort, type FpvKick, type FpvModeState, type FpvWorld,
} from './fpv-mode';
import { EMPTY_FPV_INPUT, throwOrigin, throwSpeedMps, type FpvInput } from './fpv';
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
      // LEFT-handed on purpose: x × y = −z. The camera frame this rides is
      // left-handed (camera +z is forward), so an honest hand frame comes out
      // that way, and fpv-view's setProjection negates the x column to get a
      // real rotation matrix out of it. Asserted so nobody "fixes" one half of
      // that pair without the other.
      const cx: Vec3 = [
        b.x[1] * b.y[2] - b.x[2] * b.y[1],
        b.x[2] * b.y[0] - b.x[0] * b.y[2],
        b.x[0] * b.y[1] - b.x[1] * b.y[0],
      ];
      for (let k = 0; k < 3; k++) expect(cx[k]).toBeCloseTo(-b.z[k]!, 9);
      for (const v of proj[side].halfExtent) expect(v).toBeGreaterThan(0);
    }
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
