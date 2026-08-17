// src/lab/sdf-zombie/hand-grip-clip.test.ts
//
// X1.27 task E1 — the pure grip/toss controller's timing and continuity
// contract. The keys deliberately shadow the Blood reference silhouette
// VIEWED ONLY (public/assets/animations/weapons/dynamite-throw.json: 17
// frames at 42 ms, open-hand tile 3225 first at frame index 4 = 168 ms):
// the 150 ms release marker and 240 ms swing land just under that early
// underhand release. No Blood pixels enter the implementation.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GRIP_MOTION, gripCameraQuaternion, makeGripMotion, stepGripMotion,
  type GripMotionFrame, type GripMotionInput, type GripMotionState,
} from './hand-grip-clip';
import { camBasis } from './fpv-mode';

const DT = 1 / 1200;
/** Finer stepping for boundary-continuity pairs (frames ~1e-6 apart). */
const DTC = 1 / 6000;

const PRESENT: GripMotionInput = { bundlePresented: true, throwRequested: false };
const THROW: GripMotionInput = { bundlePresented: true, throwRequested: true };
/** A throw request with no bundle re-presentation (probe-only). */
const REQ: GripMotionInput = { bundlePresented: false, throwRequested: true };
const QUIET: GripMotionInput = { bundlePresented: false, throwRequested: false };

/** xyzw tuple → THREE.Quaternion. */
function qOf(q: readonly [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
}

/** The three Euler keys as normalized quaternions (XYZ order). */
function keyQuat(e: readonly [number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
}

/** A state parked in `held` (presented, closed, never thrown). */
function heldState(): GripMotionState {
  return stepGripMotion(makeGripMotion(true), PRESENT, 1).state;
}

/** Assert two frames agree on wrist placement (position/quaternion continuity). */
function expectWristClose(a: GripMotionFrame, b: GripMotionFrame): void {
  for (let i = 0; i < 3; i++) {
    expect(a.wristOffsetCamera[i]).toBeCloseTo(b.wristOffsetCamera[i]!, 5);
  }
  expect(qOf(a.wristQuaternionCamera).angleTo(qOf(b.wristQuaternionCamera))).toBeLessThan(2e-4);
}

describe('GRIP_MOTION keys', () => {
  it('pins the authored timing and transform constants', () => {
    expect(GRIP_MOTION.closeSec).toBe(0.22);
    expect(GRIP_MOTION.swingSec).toBe(0.24);
    expect(GRIP_MOTION.openAtSec).toBe(0.10);
    expect(GRIP_MOTION.releaseAtSec).toBe(0.15);
    expect(GRIP_MOTION.releaseSec).toBe(0.12);
    expect([...GRIP_MOTION.startOffset]).toEqual([0, -0.025, -0.015]);
    expect([...GRIP_MOTION.releaseOffset]).toEqual([0.020, 0.085, 0.095]);
    expect([...GRIP_MOTION.followOffset]).toEqual([0.035, 0.120, 0.150]);
    expect([...GRIP_MOTION.startEuler]).toEqual([0.10, 0, -0.08]);
    expect([...GRIP_MOTION.releaseEuler]).toEqual([-0.25, 0.05, 0.16]);
    expect([...GRIP_MOTION.followEuler]).toEqual([-0.38, 0.08, 0.20]);
  });
});

describe('makeGripMotion', () => {
  it('defaults to the open hand with no bundle', () => {
    const s = makeGripMotion();
    expect(s.phase).toBe('open');
    expect(s.elapsedSec).toBe(0);
    expect(s.releaseEmitted).toBe(false);
    const f = stepGripMotion(s, QUIET, DT).frame;
    expect(f.grip01).toBe(0);
    expect(f.propHeld).toBe(false);
    expect(f.releaseNow).toBe(false);
  });

  it('a presented bundle starts the open→held close immediately', () => {
    const s = makeGripMotion(true);
    expect(s.phase).toBe('closing');
    const f = stepGripMotion(s, PRESENT, DT).frame;
    expect(f.grip01).toBeLessThan(1);
    expect(f.propHeld).toBe(true); // the bundle rides the hand from presentation
  });
});

describe('close → held', () => {
  it('grip reaches exactly 1 at closeSec (0.22 s) and the phase becomes held', () => {
    const at = stepGripMotion(makeGripMotion(true), PRESENT, 0.22);
    expect(at.state.phase).toBe('held');
    expect(at.frame.grip01).toBeCloseTo(1, 12);
    expect(at.frame.propHeld).toBe(true);
    const justUnder = stepGripMotion(makeGripMotion(true), PRESENT, 0.2199);
    expect(justUnder.state.phase).toBe('closing');
    expect(justUnder.frame.grip01).toBeLessThan(1);
    expect(justUnder.frame.grip01).toBeCloseTo(1, 4);
  });

  it('held stays exactly 1 and never breathes through the clip', () => {
    let s = heldState();
    const frames: GripMotionFrame[] = [];
    for (let i = 0; i < 30; i++) {
      const r = stepGripMotion(s, PRESENT, 1 / 60);
      frames.push(r.frame);
      s = r.state;
    }
    expect(s.phase).toBe('held');
    for (const f of frames) {
      expect(f.grip01).toBeCloseTo(1, 12);
      expect(f.propHeld).toBe(true);
      expect(f.releaseNow).toBe(false);
    }
    for (const f of frames.slice(1)) {
      expect([...f.wristOffsetCamera]).toEqual([...frames[0]!.wristOffsetCamera]);
      expect([...f.wristQuaternionCamera]).toEqual([...frames[0]!.wristQuaternionCamera]);
    }
  });

  it('the held frame IS the start key (throw starts from here)', () => {
    const f = stepGripMotion(heldState(), PRESENT, DT).frame;
    for (let i = 0; i < 3; i++) {
      expect(f.wristOffsetCamera[i]).toBeCloseTo(GRIP_MOTION.startOffset[i]!, 12);
    }
    expect(qOf(f.wristQuaternionCamera).angleTo(keyQuat(GRIP_MOTION.startEuler))).toBeLessThan(1e-6);
  });
});

describe('throw swing', () => {
  it('a throw request is consumed only from held', () => {
    // open (no bundle): the presentation wins, the throw is ignored
    expect(stepGripMotion(makeGripMotion(), THROW, 1 / 60).state.phase).toBe('closing');
    // closing: ignored
    const closing = stepGripMotion(makeGripMotion(true), PRESENT, 0.05).state;
    expect(stepGripMotion(closing, THROW, 1 / 60).state.phase).toBe('closing');
    // follow-through: ignored
    const ft = stepGripMotion(heldState(), THROW, 0.3).state;
    expect(ft.phase).toBe('follow-through');
    expect(stepGripMotion(ft, REQ, 1 / 60).state.phase).toBe('follow-through');
    // held: consumed
    const t = stepGripMotion(heldState(), THROW, DT);
    expect(t.state.phase).toBe('throwing');
    expect(t.state.releaseEmitted).toBe(false);
  });

  it('the throw starts from the current held frame (held→throwing continuity)', () => {
    const heldFrame = stepGripMotion(heldState(), PRESENT, 0.371).frame;
    const firstThrow = stepGripMotion(heldState(), THROW, DTC).frame;
    expectWristClose(heldFrame, firstThrow);
    expect(firstThrow.grip01).toBeCloseTo(1, 5);
    expect(firstThrow.propHeld).toBe(true);
  });

  it('the wrist reaches the release key exactly at releaseAtSec (0.15 s)', () => {
    const f = stepGripMotion(heldState(), THROW, 0.15).frame;
    for (let i = 0; i < 3; i++) {
      expect(f.wristOffsetCamera[i]).toBeCloseTo(GRIP_MOTION.releaseOffset[i]!, 12);
    }
    expect(qOf(f.wristQuaternionCamera).angleTo(keyQuat(GRIP_MOTION.releaseEuler))).toBeLessThan(1e-6);
  });

  it('fingers begin opening at openAtSec (0.10 s) and reach 0 by 0.22 s', () => {
    const at = (e: number) => stepGripMotion(heldState(), THROW, e).frame;
    expect(at(0.10).grip01).toBeCloseTo(1, 12); // window not started
    expect(at(0.11).grip01).toBeLessThan(1);
    const mid = at(0.16).grip01;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(at(0.22).grip01).toBe(0);
    expect(at(0.225).grip01).toBe(0);
  });

  it('releaseNow fires exactly once crossing 0.15 s; propHeld flips on that frame', () => {
    let s = heldState();
    let releases = 0;
    let releaseElapsed = -1;
    let thrown = false;
    for (let i = 0; i < 90 && releases === 0; i++) { // 200 Hz sweep past the marker
      const r = stepGripMotion(s, thrown ? PRESENT : THROW, 0.005);
      if (!thrown && r.state.phase === 'throwing') thrown = true;
      if (r.frame.releaseNow) {
        releases++;
        releaseElapsed = r.state.elapsedSec;
        expect(r.state.releaseEmitted).toBe(true);
        expect(r.frame.propHeld).toBe(false); // flight owns it from this frame
      }
      s = r.state;
    }
    expect(releases).toBe(1);
    expect(releaseElapsed).toBeGreaterThanOrEqual(0.149);
    expect(releaseElapsed).toBeLessThanOrEqual(0.156);
    // no second release through the rest of the swing
    for (let i = 0; i < 60; i++) {
      const r = stepGripMotion(s, PRESENT, 0.005);
      expect(r.frame.releaseNow).toBe(false);
      s = r.state;
    }
    // propHeld stays true through the pre-release swing
    expect(stepGripMotion(heldState(), THROW, 0.14).frame.propHeld).toBe(true);
  });

  it('a 0.25 s dt still emits exactly one release', () => {
    const r = stepGripMotion(heldState(), THROW, 0.25);
    expect(r.frame.releaseNow).toBe(true);
    expect(r.state.releaseEmitted).toBe(true);
    expect(r.frame.propHeld).toBe(false);
    expect(r.frame.grip01).toBe(0); // 0.25 > 0.10 + 0.12
    expect(r.state.phase).toBe('follow-through'); // 0.25 > swingSec
    const next = stepGripMotion(r.state, PRESENT, 1 / 60);
    expect(next.frame.releaseNow).toBe(false);
  });

  it('follow-through ends at 0.24 s: the swing completes onto the follow key and holds it', () => {
    const r = stepGripMotion(heldState(), THROW, 0.24);
    expect(r.state.phase).toBe('follow-through');
    for (let i = 0; i < 3; i++) {
      expect(r.frame.wristOffsetCamera[i]).toBeCloseTo(GRIP_MOTION.followOffset[i]!, 12);
    }
    expect(qOf(r.frame.wristQuaternionCamera).angleTo(keyQuat(GRIP_MOTION.followEuler))).toBeLessThan(1e-6);
    expect(r.frame.grip01).toBe(0);
    expect(r.frame.propHeld).toBe(false);
    const settle = stepGripMotion(r.state, QUIET, 1).frame; // stays open, no breathing
    expect([...settle.wristOffsetCamera]).toEqual([...r.frame.wristOffsetCamera]);
    expect(settle.grip01).toBe(0);
  });
});

describe('dt hygiene', () => {
  it('negative and NaN dt do not advance, transition, or release', () => {
    const held = heldState();
    for (const dt of [-0.1, -1e-9, Number.NaN]) {
      const r = stepGripMotion(held, THROW, dt);
      expect(r.state).toEqual(held);
      expect(r.frame.releaseNow).toBe(false);
      expect(r.frame.grip01).toBeCloseTo(1, 12);
    }
    const thrown = stepGripMotion(held, THROW, 0.05).state;
    for (const dt of [-0.05, Number.NaN]) {
      const r = stepGripMotion(thrown, PRESENT, dt);
      expect(r.state).toEqual(thrown);
      expect(r.frame.releaseNow).toBe(false);
    }
  });
});

describe('phase-boundary continuity', () => {
  it('open → closing (first presentation)', () => {
    const before = stepGripMotion(makeGripMotion(), QUIET, DTC).frame;
    const after = stepGripMotion(makeGripMotion(), PRESENT, DTC).frame;
    expectWristClose(before, after);
    expect(after.grip01).toBeCloseTo(before.grip01, 5); // 0 at the boundary
  });

  it('closing → held', () => {
    let s = makeGripMotion(true);
    let frame = stepGripMotion(s, PRESENT, DTC).frame;
    for (let i = 0; i < 3000; i++) {
      const r = stepGripMotion(s, PRESENT, DTC);
      if (r.state.phase === 'held') {
        expectWristClose(frame, r.frame);
        expect(r.frame.grip01).toBeCloseTo(1, 12);
        return;
      }
      expect(r.state.phase).toBe('closing');
      frame = r.frame;
      s = r.state;
    }
    throw new Error('closing never completed');
  });

  it('throwing → follow-through', () => {
    let s = stepGripMotion(heldState(), THROW, DTC).state;
    let frame = stepGripMotion(s, PRESENT, DTC).frame;
    for (let i = 0; i < 3000; i++) {
      const r = stepGripMotion(s, PRESENT, DTC);
      if (r.state.phase === 'follow-through') {
        expectWristClose(frame, r.frame);
        return;
      }
      frame = r.frame;
      s = r.state;
    }
    throw new Error('throwing never completed');
  });

  it('follow-through → closing (re-presentation) and a second cycle re-releases exactly once', () => {
    // complete one throw
    let s = stepGripMotion(heldState(), THROW, 0.3).state;
    expect(s.phase).toBe('follow-through');
    expect(s.releaseEmitted).toBe(true);
    const ftFrame = stepGripMotion(s, QUIET, DTC).frame;
    // re-present: continuous, and releaseEmitted resets
    const again = stepGripMotion(s, PRESENT, DTC);
    expect(again.state.phase).toBe('closing');
    expect(again.state.releaseEmitted).toBe(false);
    expectWristClose(ftFrame, again.frame);
    // run to held, throw again: exactly one more release
    let h = stepGripMotion(again.state, PRESENT, 0.25).state;
    expect(h.phase).toBe('held');
    let releases = 0;
    let thrown = false;
    for (let i = 0; i < 90 && releases === 0; i++) {
      const r = stepGripMotion(h, thrown ? PRESENT : THROW, 0.005);
      if (!thrown && r.state.phase === 'throwing') thrown = true;
      if (r.frame.releaseNow) releases++;
      s = r.state;
      h = r.state;
    }
    expect(releases).toBe(1);
  });
});

describe('gripCameraQuaternion', () => {
  const apply = (q: readonly [number, number, number, number], v: readonly [number, number, number]) =>
    new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(qOf(q));

  it('yaw 0 / pitch 0: forward stays −Z, up stays +Y, unit norm (the camBasis frame with the x-column repair)', () => {
    const q = gripCameraQuaternion(0, 0);
    expect(qOf(q).length()).toBeCloseTo(1, 12);
    const { f, r, u } = camBasis(0, 0);
    const zf = apply(q, [0, 0, 1]);
    expect(zf.x).toBeCloseTo(f[0], 9); expect(zf.y).toBeCloseTo(f[1], 9); expect(zf.z).toBeCloseTo(f[2], 9);
    const yu = apply(q, [0, 1, 0]);
    expect(yu.x).toBeCloseTo(u[0], 9); expect(yu.y).toBeCloseTo(u[1], 9); expect(yu.z).toBeCloseTo(u[2], 9);
    const xr = apply(q, [1, 0, 0]);
    expect(xr.x).toBeCloseTo(-r[0], 9); expect(xr.y).toBeCloseTo(-r[1], 9); expect(xr.z).toBeCloseTo(-r[2], 9);
  });

  it('a 90° yaw carries forward to +X (and matches camBasis there too)', () => {
    const q = gripCameraQuaternion(Math.PI / 2, 0);
    expect(qOf(q).length()).toBeCloseTo(1, 12);
    const { f, r, u } = camBasis(Math.PI / 2, 0);
    expect(f[0]).toBeCloseTo(1, 9); // facing +X
    const zf = apply(q, [0, 0, 1]);
    expect(zf.x).toBeCloseTo(f[0], 9); expect(zf.y).toBeCloseTo(f[1], 9); expect(zf.z).toBeCloseTo(f[2], 9);
    const yu = apply(q, [0, 1, 0]);
    expect(yu.x).toBeCloseTo(u[0], 9); expect(yu.y).toBeCloseTo(u[1], 9); expect(yu.z).toBeCloseTo(u[2], 9);
    const xr = apply(q, [1, 0, 0]);
    expect(xr.x).toBeCloseTo(-r[0], 9); expect(xr.y).toBeCloseTo(-r[1], 9); expect(xr.z).toBeCloseTo(-r[2], 9);
  });

  it('an arbitrary pitched aim keeps the camBasis relationship (forward/up exact, right mirrored by the repair)', () => {
    for (const [y, p] of [[0.7, -0.3], [-2.1, 0.45], [3.0, 1.1]] as const) {
      const q = gripCameraQuaternion(y, p);
      expect(qOf(q).length()).toBeCloseTo(1, 12);
      const { f, r, u } = camBasis(y, p);
      const zf = apply(q, [0, 0, 1]);
      expect(zf.x).toBeCloseTo(f[0], 9); expect(zf.y).toBeCloseTo(f[1], 9); expect(zf.z).toBeCloseTo(f[2], 9);
      const yu = apply(q, [0, 1, 0]);
      expect(yu.x).toBeCloseTo(u[0], 9); expect(yu.y).toBeCloseTo(u[1], 9); expect(yu.z).toBeCloseTo(u[2], 9);
      const xr = apply(q, [1, 0, 0]);
      expect(xr.x).toBeCloseTo(-r[0], 9); expect(xr.y).toBeCloseTo(-r[1], 9); expect(xr.z).toBeCloseTo(-r[2], 9);
    }
  });
});
