// src/lab/sdf-zombie/webgpu/earlyz/seed-pass.test.ts
//
// SOURCE PINS for the level-depth seed pass in sdf-layer.ts (spec 2026-10-01 D6).
// The pass needs a WebGPU target, so there is no unit seam; Task 11's smoke and Task 12's
// parity verify it in the browser. What can be pinned here is the wiring that keeps the flag
// OFF byte-identical and the seed conservative: nothing builds the mesh unless setEarlyzSeed
// ran, the 4x4 block cap is never trusted without seedScaleSupported, and the quad never leaks
// into any pass but the ship march.
import { describe, it, expect } from 'vitest';
import source from '../sdf-layer?raw';

/** Text from the first `start` to the next `end` (exclusive); throws so a moved anchor fails loudly. */
function between(start: string, end: string, from = 0): string {
  const a = source.indexOf(start, from);
  if (a < 0) throw new Error(`anchor not found: ${start}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`end anchor not found: ${end}`);
  return source.slice(a, b);
}

const count = (needle: string): number => source.split(needle).length - 1;

const ensureSeedBody = between('const ensureSeed = (): void => {', 'const seedBlockReason');
const blockReasonBody = between('const seedBlockReason = (): string | null => {', '\n  };\n');
const marchBlock = between("setPassLabel('sdf:march');\n      // EARLY-Z SEED", '// DISTANCE SPLIT FAR PASS');

describe('seed pass wiring (source pins)', () => {
  it('exposes setEarlyzSeed and earlyzSeedInfo on the interface and the returned object', () => {
    expect(source).toContain('setEarlyzSeed(scene: THREE.Scene): void;');
    expect(source).toContain('earlyzSeedInfo(): { built: boolean; on: boolean; reason: string | null };');
    expect(source).toContain('setEarlyzSeed(scene) { seedScene = scene; ensureSeed(); },');
    expect(source).toContain('earlyzSeedInfo() { return { built: seed !== null, on: seedOnLast, reason: seedReasonLast }; },');
  });

  it('builds the seed mesh only inside ensureSeed, and only once a scene was requested', () => {
    // The one construction site: nothing else may create a seed material or mesh.
    expect(count("mesh.name = 'earlyz-seed'")).toBe(1);
    expect(count('seedScene.add(')).toBe(1);
    expect(count('new MeshBasicNodeMaterial()')).toBeGreaterThanOrEqual(1);
    expect(ensureSeedBody).toContain("mesh.name = 'earlyz-seed'");
    expect(ensureSeedBody).toContain('seedScene.add(mesh)');
    // Guarded by the scene, which only setEarlyzSeed sets: flag off means no mesh, no pipeline.
    expect(ensureSeedBody).toMatch(/if \(seed \|\| !seedScene\) return;/);
    expect(source.match(/\bseedScene = /g)).toHaveLength(1); // only setEarlyzSeed assigns it
    // It needs the sampleable level depth of the post-aa capture target.
    expect(ensureSeedBody).toContain('outputTarget?.depthTexture');
  });

  it('is a depth-only, full-screen quad that draws first in the SDF layer and starts hidden', () => {
    expect(ensureSeedBody).toContain('mat.colorWrite = false;');
    expect(ensureSeedBody).toContain('mat.depthTest = true;');
    expect(ensureSeedBody).toContain('mat.depthWrite = true;');
    expect(ensureSeedBody).toContain('mesh.renderOrder = SEED_RENDER_ORDER;');
    expect(ensureSeedBody).toContain('mesh.layers.set(SDF_LAYER);');
    expect(ensureSeedBody).toContain('mesh.visible = false;');
    expect(ensureSeedBody).toContain('mesh.frustumCulled = false;');
    expect(ensureSeedBody).toContain('mat.depthNode = seedFn({ levelDepth: tex, uv: screenUV, marchSize })');
  });

  it('never trusts the 4x4 block cap without seedScaleSupported', () => {
    expect(count('seedScaleSupported([')).toBe(1); // the one call (the import and the comment have no `([`)
    expect(blockReasonBody).toContain('seedScaleSupported([outputTarget.width, outputTarget.height], [target.width, target.height])');
    // A refusal when it is false, ahead of the final `return null` (which means "may draw").
    const supported = blockReasonBody.indexOf('seedScaleSupported(');
    const refusal = blockReasonBody.indexOf('if (!seedScaleOk) return');
    expect(refusal).toBeGreaterThan(supported);
    expect(refusal).toBeLessThan(blockReasonBody.indexOf('return null;'));
  });

  it('refuses every case where the seed would not be conservative or would not fit', () => {
    expect(blockReasonBody).toContain("if (!seedScene) return 'not requested';");
    expect(blockReasonBody).toContain('no sampleable level depth');
    expect(blockReasonBody).toContain("if (fieldStyle !== 'off')");
    expect(blockReasonBody).toContain('if (target.textures.length !== 1) return');
    expect(blockReasonBody).toContain('if (accumOn) return');
    expect(blockReasonBody).toContain('if (marchJitter) return');
    expect(blockReasonBody.trimEnd().endsWith('return null;')).toBe(true);
  });

  it('shows the seed only for a single-render march, and hides it again straight after the march', () => {
    expect(marchBlock).toContain('seedReasonLast = seedBlockReason();');
    // The per-body depth-gate branch re-renders per body: the seed is refused there.
    expect(marchBlock).toContain("seedReasonLast = 'per-body depth-gate passes';");
    expect(marchBlock).toContain('seedOnLast = seed !== null && seedReasonLast === null;');
    expect(marchBlock).toContain('seed.mesh.visible = seedOnLast;');
    expect(marchBlock).toContain('seed.marchSize.value.set(target.width, target.height);');
    // Hidden right after the whole branch chain, before the far pass and every later pass.
    const hide = marchBlock.lastIndexOf('if (seed) seed.mesh.visible = false;');
    expect(hide).toBeGreaterThan(marchBlock.indexOf('renderer.render(scene, camera)'));
    expect(marchBlock.slice(hide).trim()).toBe('if (seed) seed.mesh.visible = false;');
  });

  it('turns the quad on only around the march in the render path and the precompile', () => {
    expect(count('seed.mesh.visible = true;')).toBe(1);
    expect(count('seed.mesh.visible = seedOnLast;')).toBe(1);
    // Precompile: shown, compiled, hidden again, in that order.
    const pre = between('ensureSeed();\n        if (seed) seed.mesh.visible = true;', 'GATED BY THE SAME FLAG');
    const compileAt = pre.indexOf("await compile('march', scene, camera, target, marchMrt);");
    expect(compileAt).toBeGreaterThan(0);
    expect(pre.indexOf('if (seed) seed.mesh.visible = false;')).toBeGreaterThan(compileAt);
  });

  it('never calls setEarlyzSeed itself (the flag-gated caller does)', () => {
    expect(count('setEarlyzSeed(')).toBe(2); // interface + implementation
  });
});
