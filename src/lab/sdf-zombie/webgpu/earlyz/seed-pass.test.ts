// src/lab/sdf-zombie/webgpu/earlyz/seed-pass.test.ts
//
// SOURCE PINS for the level-depth seed pass in sdf-layer.ts (spec 2026-10-01 D6).
// The pass needs a WebGPU target, so there is no unit seam; Task 11's smoke and Task 12's
// parity verify it in the browser. What can be pinned here is the wiring that keeps the flag
// OFF byte-identical and the seed conservative: nothing builds the mesh unless setEarlyzSeed
// ran, the draw/refuse decision is the pure seed-gate fed from the layer's own state (the gate
// itself is table-tested in seed-gate.test.ts), and the quad never leaks into any pass but the
// ship march.
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
const blockReasonBody = between('const seedBlockReason = (perBodyGate: boolean): string | null => {', '\n  };\n');
const marchBlock = between("setPassLabel('sdf:march');\n      // EARLY-Z SEED", '// DISTANCE SPLIT FAR PASS');
const precompileBlock = between('ensureSeed();\n        // Only a boot where the seed could ever draw', 'GATED BY THE SAME FLAG');
const disposeBlock = between('dispose() {\n      upscale?.dispose();\n      if (seed) {', 'target.dispose();');

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
    expect(ensureSeedBody).toContain("mesh.name = 'earlyz-seed'");
    expect(ensureSeedBody).toContain('seedScene.add(mesh)');
    // Guarded by the scene, which only setEarlyzSeed sets: flag off means no mesh, no pipeline.
    expect(ensureSeedBody).toMatch(/if \(seed \|\| !seedScene\) return;/);
    expect(source.match(/\bseedScene = /g)).toHaveLength(2); // setEarlyzSeed, and dispose clearing it
    // It needs the sampleable level depth of the post-aa capture target.
    expect(ensureSeedBody).toContain('outputTarget?.depthTexture');
  });

  it('creates the seed node only inside ensureSeed (flag off makes no node at all)', () => {
    expect(count('wgslFn(EARLYZ_SEED_WGSL)')).toBe(1);
    expect(ensureSeedBody).toContain('seedFn ??= wgslFn(EARLYZ_SEED_WGSL);');
    // ... after the two early returns that flag-off and no-capture-target boots take.
    expect(ensureSeedBody.indexOf('wgslFn(')).toBeGreaterThan(ensureSeedBody.indexOf('if (!depthTex) return;'));
    expect(source).not.toMatch(/const seedFn = wgslFn/);
  });

  it('is a depth-only, full-screen quad that draws first in the SDF layer and starts hidden', () => {
    expect(ensureSeedBody).toContain('mat.colorWrite = false;');
    expect(ensureSeedBody).toContain('mat.depthTest = true;');
    expect(ensureSeedBody).toContain('mat.depthWrite = true;');
    // three's default depthFunc (LessEqual) is the contract: a later render of the same target must
    // never overwrite a nearer body depth, so the seed material must not pick its own compare.
    expect(ensureSeedBody).not.toContain('depthFunc');
    expect(ensureSeedBody).toContain('mesh.renderOrder = SEED_RENDER_ORDER;');
    expect(ensureSeedBody).toContain('mesh.layers.set(SDF_LAYER);');
    expect(ensureSeedBody).toContain('mesh.visible = false;');
    expect(ensureSeedBody).toContain('mesh.frustumCulled = false;');
    expect(ensureSeedBody).toContain('mat.depthNode = seedFn({ levelDepth: tex, uv: screenUV, marchSize })');
  });

  it('feeds the pure seed gate every input from the layer\'s own state, sizes included', () => {
    // The size-keyed memo and every refusal live in seed-gate.ts (seed-gate.test.ts); here the
    // layer must hand it the live values. The march size is the INTEGER target size, both axes.
    expect(source).toContain("import { createSeedGate, type SeedGateInput } from './earlyz/seed-gate';");
    expect(count('seedScaleSupported(')).toBe(0); // the layer no longer decides anything itself
    expect(blockReasonBody).toContain('g.requested = seedScene !== null;');
    expect(blockReasonBody).toContain('g.levelDepth = outputTarget?.depthTexture != null;');
    expect(blockReasonBody).toContain('g.fieldStyle = fieldStyle;');
    expect(blockReasonBody).toContain('g.levelSize[0] = outputTarget?.width ?? 0;');
    expect(blockReasonBody).toContain('g.levelSize[1] = outputTarget?.height ?? 0;');
    expect(blockReasonBody).toContain('g.marchSize[0] = target.width;');
    expect(blockReasonBody).toContain('g.marchSize[1] = target.height;');
    expect(blockReasonBody).toContain('g.marchAttachments = target.textures.length;');
    expect(blockReasonBody).toContain('g.accumOn = accumOn;');
    expect(blockReasonBody).toContain('g.captureJitter = marchJitter !== null;');
    expect(blockReasonBody).toContain('g.perBodyGate = perBodyGate;');
    expect(blockReasonBody.trimEnd().endsWith('return seedGate.reason(g);')).toBe(true);
    // One gate for the whole layer: its memo is the size cache.
    expect(count('createSeedGate()')).toBe(1);
  });

  it('decides the per-body branch and the seed with ONE shared predicate', () => {
    const predicate = 'prevUniforms.enabled.value > 0.5 && bodies.length > 0';
    expect(source).toContain(`const perBodyGate = ${predicate};`);
    // The real predicate is written once; nothing re-derives it for the branch or the seed.
    expect(count(predicate)).toBe(1);
    expect(count('const perBodyGate')).toBe(1);
    expect(marchBlock).toContain('if (perBodyGate) {');
    expect(marchBlock).toContain('seedReasonLast = seedBlockReason(perBodyGate);');
    expect(marchBlock).not.toContain("'per-body depth-gate passes'"); // the reason string is the gate's
    // Declared before both users, in the same block.
    const decl = marchBlock.indexOf('const perBodyGate');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(marchBlock.indexOf('seedBlockReason(perBodyGate)'));
    expect(decl).toBeLessThan(marchBlock.indexOf('if (perBodyGate) {'));
  });

  it('shows the seed only for a single-render march of the scene it lives in, then hides it', () => {
    expect(marchBlock).toContain('ensureSeed();\n      seedReasonLast = seedBlockReason(perBodyGate);');
    expect(marchBlock).toContain("if (seedReasonLast === null && seed !== null && seed.mesh.parent !== scene) {");
    expect(marchBlock).toContain("seedReasonLast = 'seed lives in another scene';");
    expect(marchBlock).toContain('seedOnLast = seed !== null && seedReasonLast === null;');
    expect(marchBlock).toContain('seed.mesh.visible = seedOnLast;');
    // Both uniforms are refreshed every drawn frame: the capture target (and its depth texture)
    // can be reallocated by post-aa, and the march size follows the resize.
    expect(marchBlock).toContain(
      'if (seedOnLast) {\n          seed.tex.value = outputTarget!.depthTexture!;\n          seed.marchSize.value.set(target.width, target.height);\n        }',
    );
    // Hidden right after the whole branch chain, before the far pass and every later pass.
    const hide = marchBlock.lastIndexOf('if (seed) seed.mesh.visible = false;');
    expect(hide).toBeGreaterThan(marchBlock.indexOf('renderer.render(scene, camera)'));
    expect(marchBlock.slice(hide).trim()).toBe('if (seed) seed.mesh.visible = false;');
  });

  it("hides the seed before the 'split' chunks-only render (the first render already wrote it)", () => {
    // The split branch is: [first render done above] ... chunks-only render. Slice from the branch
    // head to the end of the march block; its ONE render call is the chunks-only one.
    const head = marchBlock.indexOf("if (chunkPass === 'split') {");
    expect(head).toBeGreaterThan(-1);
    const splitBranch = marchBlock.slice(head);
    const hide = splitBranch.indexOf('if (seed) seed.mesh.visible = false;');
    expect(hide).toBeGreaterThan(-1);
    expect(splitBranch.indexOf("setPassLabel('sdf:march-chunks');")).toBeGreaterThan(hide);
    expect(splitBranch.indexOf('renderer.render(scene, camera)')).toBeGreaterThan(hide);
    // ...while everything before the branch (the first render of the bodies, chunks hidden) still
    // has it visible: nothing hides it until the split branch.
    const beforeSplit = marchBlock.slice(0, head);
    expect(beforeSplit).toContain('seed.mesh.visible = seedOnLast;');
    expect(beforeSplit).not.toContain('seed.mesh.visible = false;');
  });

  it('turns the quad on only around the march, and compiles it only where it could ever draw', () => {
    expect(count('seed.mesh.visible = true;')).toBe(1);
    expect(count('seed.mesh.visible = seedOnLast;')).toBe(1);
    // Precompile: shown (single-attachment march only), compiled, hidden again, in that order.
    expect(precompileBlock).toContain('if (seed && !marchMrt) seed.mesh.visible = true;');
    const compileAt = precompileBlock.indexOf("await compile('march', scene, camera, target, marchMrt);");
    expect(compileAt).toBeGreaterThan(precompileBlock.indexOf('seed.mesh.visible = true;'));
    expect(precompileBlock.indexOf('if (seed) seed.mesh.visible = false;')).toBeGreaterThan(compileAt);
  });

  it('never calls setEarlyzSeed itself (the flag-gated caller does)', () => {
    expect(count('setEarlyzSeed(')).toBe(2); // interface + implementation
  });

  it('dispose removes the quad from its scene and frees its geometry and material', () => {
    expect(disposeBlock).toContain('seed.mesh.removeFromParent();');
    expect(disposeBlock).toContain('seed.mesh.geometry.dispose();');
    expect(disposeBlock).toContain('(seed.mesh.material as THREE.Material).dispose();');
    expect(disposeBlock).toContain('seed = null;');
    const afterSeed = between('seed = null;', 'target.dispose();');
    expect(afterSeed).toContain('seedScene = null;');
    // earlyzSeedInfo() must read like "never requested" once the layer is disposed.
    expect(afterSeed).toContain('seedOnLast = false;');
    expect(afterSeed).toContain("seedReasonLast = 'not requested';");
  });
});
