// Source tripwires for the flame lab's wiring, in the style of
// blood-compare-main.test.ts: importing the module runs its bootstrap, which
// bails before createLabRenderer because the test DOM has no #app, so what this
// proves is that the imports resolve, the syntax is valid, and the page is
// wired to the pieces the plan says it is.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { FLAME_LAB_BODIES } from './flame-lab-main';

const PAGE = 'src/lab/sdf-zombie/webgpu/flame-lab-main.ts';
const src = readFileSync(PAGE, 'utf8');
const html = readFileSync('sdf-flame-lab.html', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');

describe('flame lab page', () => {
  it('shows a zombie and a soldier, the two characters the spec names', () => {
    expect(FLAME_LAB_BODIES.map(b => b.name)).toEqual(['zombie', 'soldier']);
    expect(new Set(FLAME_LAB_BODIES.map(b => b.x)).size).toBe(2);
  });

  it('is served by the page shell and registered for the build', () => {
    expect(html).toContain('/src/lab/sdf-zombie/webgpu/flame-lab-main.ts');
    expect(html).toContain('id="app"');
    expect(vite).toContain("sdfFlameLab: resolve(__dirname, 'sdf-flame-lab.html')");
  });

  it('renders through the real march and the real post chain', () => {
    expect(src).toContain('createSdfLayer');
    expect(src).toContain('createPostAa');
    expect(src).toContain('createCharacterView');
    expect(src).toContain('postAa.render(');
  });

  it('drives each body burn state into its own burnCfg uniform', () => {
    expect(src).toContain('stepBurn(');
    expect(src).toContain('igniteBurn(');
    expect(src).toContain('extinguishBurn(');
    expect(src).toContain('.uniforms.burnCfg.value.set(');
    expect(src).toContain('resolveBurnTuning');
  });

  it('exposes the lab through a console API and pins its clock for captures', () => {
    expect(src).toContain('__flameLab');
    expect(src).toContain('ignite');
    expect(src).toContain('setTuning');
    expect(src).toContain('capture');
  });

  it('pins the Blood reference sprites beside the bodies', () => {
    // Tiles 3321-3326 are the burning-run frames and ARE tracked in the repo.
    expect(html).toContain('assets/blood-tiles/3321.png');
  });
});
