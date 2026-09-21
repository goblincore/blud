import { describe, it, expect } from 'vitest';
import {
  selectVisualActors, visualForward, diagonalHalfAngleRad, VISUAL_CULL_DEFAULTS,
} from './visual-actor-set';
import type { VisualBody, VisualViewer } from './visual-actor-set';

// Contract for the pure half of the visual-actor cull (2026-09-20): the set
// must be a SAFE superset of what is on screen. The SAFETY BIAS means the
// interesting assertions are the KEPT ones — margin, body radius, close range
// and last frame's set all push toward keeping; only a body the padded cone
// provably cannot see is dropped.

const DEG = Math.PI / 180;

function viewer(overrides: Partial<VisualViewer> = {}): VisualViewer {
  return { eye: [0, 0, 0], yaw: 0, pitch: 0, fovYDeg: 60, aspect: 16 / 9, ...overrides };
}

// `angleDeg` off forward, in the XZ plane (level), at `dist` metres.
function atAngle(angleDeg: number, dist: number): Vec3ish {
  const a = angleDeg * DEG;
  return [Math.sin(a) * dist, 0, -Math.cos(a) * dist];
}
type Vec3ish = VisualBody['center'];

function body(id: number, center: Vec3ish): VisualBody {
  return { id, center };
}

const TIGHT: typeof VISUAL_CULL_DEFAULTS = { marginDeg: 0, bodyRadiusM: 0.001, alwaysWithinM: 0 };

describe('selectVisualActors', () => {
  it('keeps a body dead ahead', () => {
    const kept = selectVisualActors(viewer(), [body(1, [0, 0, -10])], new Set());
    expect(kept.has(1)).toBe(true);
  });

  it('drops a body directly behind at 10 m', () => {
    // 180° off forward: even the 35° margin and the 1.3 m radius (7.5° at this
    // range) cannot reach it.
    const kept = selectVisualActors(viewer(), [body(2, [0, 0, 10])], new Set());
    expect(kept.has(2)).toBe(false);
  });

  it('keeps the same behind body at 2 m — alwaysWithinM', () => {
    // Close enough to be turned to in one flick, and it throws flashlight
    // shadows in front of the player. Distance wins over angle.
    const kept = selectVisualActors(viewer(), [body(2, [0, 0, 2])], new Set());
    expect(kept.has(2)).toBe(true);
  });

  it('keeps a body just outside the raw FOV but inside the margin', () => {
    // 55° off forward at 20 m: the raw diagonal half-angle (fov 60, 16:9) is
    // ~49.7°, so with no margin this is dropped even after the radius
    // subtraction (~3.7°); the 35° margin keeps it — it is what a fast mouse
    // flick between set-build and draw can bring on screen.
    const center = atAngle(55, 20);
    const withoutMargin = selectVisualActors(viewer(), [body(3, center)], new Set(), TIGHT);
    expect(withoutMargin.has(3)).toBe(false);
    const withMargin = selectVisualActors(viewer(), [body(3, center)], new Set());
    expect(withMargin.has(3)).toBe(true);
  });

  it('keeps a large near body whose CENTRE is outside the cone but whose radius reaches in', () => {
    // Centre 55° off forward (outside the ~49.7° cone) at 2 m: the 1.3 m body
    // radius subtends ~40° at that range, so the body's disc overlaps the cone.
    const center = atAngle(55, 2);
    const opts = { marginDeg: 0, bodyRadiusM: 1.3, alwaysWithinM: 0 };
    expect(selectVisualActors(viewer(), [body(4, center)], new Set(), opts).has(4)).toBe(true);
    // Control: a point-sized body in the same place does NOT reach the cone.
    const pointSized = { marginDeg: 0, bodyRadiusM: 0.01, alwaysWithinM: 0 };
    expect(selectVisualActors(viewer(), [body(4, center)], new Set(), pointSized).has(4)).toBe(false);
  });

  it('keeps an id in alsoKeep whatever its position', () => {
    // Last frame's visible actors stay in the set even at 100 m directly
    // behind, with every geometric reason to drop them.
    const bodies = [body(7, [0, 0, 100])];
    expect(selectVisualActors(viewer(), bodies, new Set(), TIGHT).has(7)).toBe(false);
    expect(selectVisualActors(viewer(), bodies, new Set([7]), TIGHT).has(7)).toBe(true);
  });

  it('honours pitch — a body far above drops when level, keeps when looking up', () => {
    // ~100 m up, ~0.6° forward of straight overhead: 89.4° off a level
    // forward, far beyond even the padded cone.
    const up = [0, 100, -1] as Vec3ish;
    expect(selectVisualActors(viewer(), [body(9, up)], new Set()).has(9)).toBe(false);
    // Look up at it (pitch 80°) and it is ~9° off forward — kept.
    expect(selectVisualActors(viewer({ pitch: 80 * DEG }), [body(9, up)], new Set()).has(9)).toBe(true);
  });

  it('uses the game yaw convention: yaw 0 forward is -Z, yaw PI/2 forward is +X', () => {
    expect(visualForward(0, 0)[0]).toBeCloseTo(0);
    expect(visualForward(0, 0)[1]).toBeCloseTo(0);
    expect(visualForward(0, 0)[2]).toBeCloseTo(-1);
    expect(visualForward(Math.PI / 2, 0)[0]).toBeCloseTo(1);
    expect(visualForward(Math.PI / 2, 0)[1]).toBeCloseTo(0);
    expect(visualForward(Math.PI / 2, 0)[2]).toBeCloseTo(0);
    // Behaviourally, with a tight cone so the margin cannot blur it: the body
    // dead ahead of each yaw is kept, the one 90° to its side is dropped.
    const negZ = body(10, [0, 0, -10]);
    const posX = body(11, [10, 0, 0]);
    const yaw0 = selectVisualActors(viewer(), [negZ, posX], new Set(), TIGHT);
    expect(yaw0.has(10)).toBe(true);
    expect(yaw0.has(11)).toBe(false);
    const yaw90 = selectVisualActors(viewer({ yaw: Math.PI / 2 }), [negZ, posX], new Set(), TIGHT);
    expect(yaw90.has(11)).toBe(true);
    expect(yaw90.has(10)).toBe(false);
  });

  it('keeps a body at distance 0 (centre on the eye)', () => {
    const kept = selectVisualActors(viewer(), [body(12, [0, 0, 0])], new Set(), TIGHT);
    expect(kept.has(12)).toBe(true);
  });

  it('keeps nothing from an empty body list and returns a fresh set', () => {
    const kept = selectVisualActors(viewer(), [], new Set());
    expect(kept.size).toBe(0);
    // The result is owned by the caller (Task 2 stores it on ctx.render).
    const bodies = [body(1, [0, 0, -5])];
    const a = selectVisualActors(viewer(), bodies, new Set());
    const b = selectVisualActors(viewer(), bodies, new Set());
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('diagonalHalfAngleRad', () => {
  it('is the diagonal half-FOV of the frustum, not the vertical one', () => {
    // A 90° square frustum has a 2*atan(sqrt(2)) ≈ 109.47° diagonal.
    expect(diagonalHalfAngleRad(90, 1)).toBeCloseTo(Math.atan(Math.SQRT2), 12);
    // Vertical half would be 45°; the 16:9 diagonal is ~10° wider than that.
    const half = diagonalHalfAngleRad(60, 16 / 9) / DEG;
    expect(half).toBeGreaterThan(49);
    expect(half).toBeLessThan(50);
  });

  describe('occlusion (inSight)', () => {
    const viewer = { eye: [0, 1.6, 0] as [number, number, number], yaw: 0, pitch: 0, fovYDeg: 72, aspect: 4 / 3 };
    const ahead = { id: 1, center: [0, 1.2, -10] as [number, number, number] };
    const near = { id: 2, center: [0, 1.2, -2] as [number, number, number] };

    it('drops a body dead ahead that is behind a wall, and a near one too', () => {
      const kept = selectVisualActors(viewer, [ahead, near], new Set(), VISUAL_CULL_DEFAULTS, () => false);
      expect([...kept]).toEqual([]);
    });

    it('keeps an occluded body that was on screen last frame (alsoKeep wins)', () => {
      const kept = selectVisualActors(viewer, [ahead], new Set([1]), VISUAL_CULL_DEFAULTS, () => false);
      expect([...kept]).toEqual([1]);
    });

    it('never asks about bodies the cone already rejected', () => {
      const asked: number[] = [];
      const behind = { id: 3, center: [0, 1.2, 10] as [number, number, number] };
      selectVisualActors(viewer, [ahead, behind], new Set(), VISUAL_CULL_DEFAULTS, (id) => { asked.push(id); return true; });
      expect(asked).toEqual([1]);
    });

    it('omitting inSight is the cone-only behaviour', () => {
      expect([...selectVisualActors(viewer, [ahead], new Set())]).toEqual([1]);
    });
  });
});
