// src/lab/sdf-zombie/webgpu/soft-fade.test.ts
//
// Contract for the shared soft-particle depth fade. Two things are being
// pinned, and only one of them is arithmetic:
//
//  1. the falloff itself (0 where the fragment reaches the scene, 1 far from
//     it, fully inert at a 0 metre fade);
//  2. WHERE THE SCENE DEPTH COMES FROM. The wildfire teardown's trap is that
//     feeding the fade the current fragment's own depth produces
//     `saturate((d - d) / fade) = 0` everywhere and the whole effect renders
//     transparent black with no error (docs/dev-notes/
//     2026-09-18-wildfire-fire-teardown.md). So the helper must read the SCENE
//     side itself, from the viewport depth texture — never accept it from the
//     caller. The source guard below fails if someone swaps in a bare
//     `depth()` / `linearDepth()`.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { float, linearDepth } from 'three/tsl';
import { softFade01, softParticleFade } from './soft-fade';

describe('soft-particle fade', () => {
  it('is 1 far from the scene and 0 where the fragment reaches it', () => {
    // The fragment is 1 m in front of the surface behind it: fully visible.
    expect(softFade01(4, 5, 0.5)).toBe(1);
    // The fragment has reached the surface: gone.
    expect(softFade01(5, 5, 0.5)).toBe(0);
    // Half-way through the fade band.
    expect(softFade01(4.75, 5, 0.5)).toBeCloseTo(0.5, 12);
    // The band's top edge is exactly 1 (no overshoot into >1).
    expect(softFade01(4.5, 5, 0.5)).toBe(1);
  });

  it('clamps a fragment that is behind the scene surface to 0, never negative', () => {
    expect(softFade01(5.5, 5, 0.5)).toBe(0);
  });

  it('is inert at a 0 metre fade and at a non-finite one', () => {
    // A disabled fade must be the identity, not a divide-by-zero.
    expect(softFade01(5, 5, 0)).toBe(1);
    expect(softFade01(5, 5, -1)).toBe(1);
    expect(softFade01(5, 5, NaN)).toBe(1);
  });

  it('builds a node graph from the fragment depth and the fade distance', () => {
    // Headless construction only: no GPU device is created (the repo's
    // convention — see explosion-vfx.test.ts).
    const node = softParticleFade(linearDepth() as never, float(0.3) as never);
    expect(node).toBeTruthy();
  });

  it('reads the scene depth from the viewport depth texture, never a bare fragment depth', () => {
    // THE GUARD (the teardown's runtime check, as a test). The scene side must
    // be `linearDepth(viewportDepthTexture())` — three's `viewportLinearDepth`.
    // A bare `linearDepth()` with no argument is the CURRENT fragment, which
    // makes the difference identically zero and renders the effect as
    // transparent black with no error.
    // Repo-relative, like dynamite-panel.test.ts: vitest's import.meta.url is
    // not a file: URL in this setup, so `new URL(..., import.meta.url)` throws.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/soft-fade.ts', 'utf8');
    // Comments are allowed (in fact required) to NAME the trap, so strip them
    // and guard the CODE.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).toMatch(/viewportLinearDepth|viewportDepthTexture/);
    // A bare linearDepth()/depth() call is the trap.
    expect(code).not.toMatch(/\blinearDepth\s*\(/);
    expect(code).not.toMatch(/\bdepth\s*\(/);
  });
});
