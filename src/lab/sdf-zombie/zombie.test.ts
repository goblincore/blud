// src/lab/sdf-zombie/zombie.test.ts
//
// The frozen GLSL twin (/sdf-lab.html) keeps its own 16-slot wound cap while
// the shared ring (damage.ts MAX_WOUNDS) is longer. Its upload must keep the
// NEWEST wounds, or every shot after the cap is invisible.
import { describe, expect, it } from 'vitest';
import { createZombieView } from './zombie';
import { FRAG, GLSL_MAX_WOUNDS } from './march.glsl';
import { MAX_WOUNDS } from './damage';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { makeZombie } from './body';
import type { Vec3 } from './types';

describe('GLSL twin wound upload', () => {
  it('keeps its own cap, sized in the shader text', () => {
    expect(FRAG).toContain(`#define MAX_WOUNDS ${GLSL_MAX_WOUNDS}\n`);
    expect(GLSL_MAX_WOUNDS).toBeLessThan(MAX_WOUNDS);
  });

  it('uploads the newest GLSL_MAX_WOUNDS wounds of a longer ring', () => {
    const view = createZombieView(buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}));
    const n = MAX_WOUNDS;
    const pos = Array.from({ length: n }, (_, i): Vec3 => [i, 0, 0]);
    view.setWounds(pos, pos.map((_, i) => i / 100), pos.map(() => 0), pos.map((_, i) => i));
    const u = view.material.uniforms;
    expect(u.uWoundCount!.value).toBe(GLSL_MAX_WOUNDS);
    const w = u.uWound!.value as Float32Array, m = u.uWoundMeta!.value as Float32Array;
    expect(w).toHaveLength(GLSL_MAX_WOUNDS * 4);
    // Slot 0 holds the oldest KEPT wound; the last slot holds the newest shot.
    expect(w[0]).toBe(n - GLSL_MAX_WOUNDS);
    expect(w[(GLSL_MAX_WOUNDS - 1) * 4]).toBe(n - 1);
    expect(w[(GLSL_MAX_WOUNDS - 1) * 4 + 3]).toBeCloseTo((n - 1) / 100);
    expect(m[(GLSL_MAX_WOUNDS - 1) * 4 + 1]).toBe(n - 1);
  });

  it('uploads a short ring unchanged', () => {
    const view = createZombieView(buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}));
    view.setWounds([[1, 2, 3]], [0.05], [1], [0.5]);
    const w = view.material.uniforms.uWound!.value as Float32Array;
    expect(view.material.uniforms.uWoundCount!.value).toBe(1);
    expect(Array.from(w.slice(0, 4))).toEqual([1, 2, 3, 0.05].map(Math.fround));
  });
});
