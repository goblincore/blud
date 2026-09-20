// scripts/extract-leaf.test.ts
//
// The four gaps leaves wave 1 hit (docs/dev-notes/2026-09-19-game-main-leaves-1/NOTES.md):
// a generic signature the ctx regex missed, shorthand `{ f }` refs left
// uncontextualised, an untyped `(...a) =>` wrapper that does not compile under
// an `unknown`-typed literal, and "refuses non-leaves" that never refused.
// Fixtures are minimal game-main shapes, not the real file: each test pins ONE
// rewrite rule.
import { describe, it, expect } from 'vitest';
import { extractLeaves, mergeModule } from './extract-leaf';

/** A game-main.ts in miniature: one import line, one main() with a closure. */
function fixture(body: string): string {
  return `import * as THREE from 'three';\nimport { makeGameContext } from './game-context';\n\nexport function main(): void {\n  const ctx = makeGameContext();\n${body}\n}\n`;
}

describe('extract-leaf: signatures', () => {
  it('adds ctx and export to a GENERIC function declaration', () => {
    const src = fixture(`  function registerLit<T extends { id: string }>(m: T): T {\n    ctx.bake.seen.push(m.id);\n    return m;\n  }\n  registerLit({ id: 'a' });`);
    const r = extractLeaves(src, ['registerLit'], [], 'game-bake-leaves');
    expect(r.module).toContain('export function registerLit<T extends { id: string }>(ctx: GameContext, m: T): T {');
    expect(r.main).toContain("registerLit(ctx, { id: 'a' })");
  });

  it('adds ctx to an async function, keeping the async keyword first', () => {
    const src = fixture(`  async function awaitBakes(n: number): Promise<void> {\n    ctx.bake.pending = n;\n  }\n  void awaitBakes(2);`);
    const r = extractLeaves(src, ['awaitBakes'], [], 'game-bake-leaves');
    expect(r.module).toContain('export async function awaitBakes(ctx: GameContext, n: number): Promise<void> {');
  });

  it('gives a zero-parameter function ctx as its only parameter', () => {
    const src = fixture(`  function tick(): void {\n    ctx.render.frame++;\n  }\n  tick();`);
    const r = extractLeaves(src, ['tick'], [], 'game-render-leaves');
    expect(r.module).toContain('export function tick(ctx: GameContext): void {');
    expect(r.main).toContain('tick(ctx);');
  });
});

describe('extract-leaf: references passed as values', () => {
  it('wraps a SHORTHAND property ref with withCtx', () => {
    const src = fixture(`  function bodiesOnScreen(): number {\n    return ctx.world.actors.length;\n  }\n  const deps = { bodiesOnScreen };\n  void deps;`);
    const r = extractLeaves(src, ['bodiesOnScreen'], [], 'game-world-leaves');
    expect(r.main).toContain('const deps = { bodiesOnScreen: withCtx(ctx, bodiesOnScreen) };');
    expect(r.bareRefs).toBe(1);
  });

  it('wraps a bare argument ref with withCtx, which is typed (no implicit any)', () => {
    const src = fixture(`  function pushProbeWeight(w: number): void {\n    ctx.probes.weight = w;\n  }\n  const api: unknown = { setProbeWeight: pushProbeWeight };\n  void api;`);
    const r = extractLeaves(src, ['pushProbeWeight'], [], 'game-probes-leaves');
    expect(r.main).toContain('setProbeWeight: withCtx(ctx, pushProbeWeight)');
    // No untyped rest wrapper anywhere — that is the shape that did not compile.
    expect(r.main).not.toContain('(...a) =>');
  });

  it('imports withCtx into game-main exactly once when it wraps anything', () => {
    const src = fixture(`  function a(): void { ctx.render.frame++; }\n  function b(): void { ctx.render.frame--; }\n  const deps = { a, b };\n  void deps;`);
    const r = extractLeaves(src, ['a', 'b'], [], 'game-render-leaves');
    expect((r.main.match(/withCtx\(ctx, /g) ?? []).length).toBe(2);
    expect((r.main.match(/^import \{ withCtx \} from '\.\/game-context';$/gm) ?? []).length).toBe(1);
  });

  it('does not import withCtx when nothing is passed as a value', () => {
    const src = fixture(`  function a(): void { ctx.render.frame++; }\n  a();`);
    const r = extractLeaves(src, ['a'], [], 'game-render-leaves');
    expect(r.bareRefs).toBe(0);
    expect(r.main).not.toContain('withCtx');
  });

  it('leaves a same-named PROPERTY alone (only the free identifier is a ref)', () => {
    const src = fixture(`  function step(): void { ctx.render.frame++; }\n  step();\n  ctx.demo.step = 3;\n  const o = { step: 1 };\n  void o;`);
    const r = extractLeaves(src, ['step'], [], 'game-render-leaves');
    expect(r.main).toContain('ctx.demo.step = 3;');
    expect(r.main).toContain('const o = { step: 1 };');
  });
});

describe('extract-leaf: the leaf check', () => {
  it('REFUSES a function that still closes over a main()-scope function', () => {
    const src = fixture(`  function ceilingAt(x: number): number { return x; }\n  function chunkCollidersAt(x: number): number {\n    return ceilingAt(x) + ctx.world.floor;\n  }\n  chunkCollidersAt(1);`);
    expect(() => extractLeaves(src, ['chunkCollidersAt'], [], 'game-world-leaves'))
      .toThrow(/chunkCollidersAt.*ceilingAt/s);
  });

  it('REFUSES a function that still closes over a main()-scope const', () => {
    const src = fixture(`  const ROOM_ID_BY_NAME = new Map<string, number>();\n  function playerRoomId(n: string): number {\n    return ROOM_ID_BY_NAME.get(n) ?? ctx.player.roomId;\n  }\n  playerRoomId('a');`);
    expect(() => extractLeaves(src, ['playerRoomId'], [], 'game-player-leaves'))
      .toThrow(/ROOM_ID_BY_NAME/);
  });

  it('accepts it once the const travels along via --consts', () => {
    const src = fixture(`  const ROOM_ID_BY_NAME = new Map<string, number>();\n  function playerRoomId(n: string): number {\n    return ROOM_ID_BY_NAME.get(n) ?? ctx.player.roomId;\n  }\n  playerRoomId('a');`);
    const r = extractLeaves(src, ['playerRoomId'], ['ROOM_ID_BY_NAME'], 'game-player-leaves');
    expect(r.module).toContain('export const ROOM_ID_BY_NAME');
    expect(r.module).toContain('export function playerRoomId(ctx: GameContext, n: string): number {');
  });

  it('accepts co-moved functions calling each other, and passes ctx through', () => {
    const src = fixture(`  function inner(x: number): number { return x + ctx.world.floor; }\n  function outer(x: number): number { return inner(x); }\n  outer(1);`);
    const r = extractLeaves(src, ['inner', 'outer'], [], 'game-world-leaves');
    expect(r.module).toContain('return inner(ctx, x);');
  });

  it('does not count locals, parameters or imports as free names', () => {
    const src = fixture(`  const shadowed = 1;\n  function f(shadowed: number): number {\n    const local = shadowed + 1;\n    return local + new THREE.Vector3().x + ctx.render.frame;\n  }\n  f(2);`);
    const r = extractLeaves(src, ['f'], [], 'game-render-leaves');
    expect(r.module).toContain('export function f(ctx: GameContext, shadowed: number): number {');
  });

  it('names EVERY offender, so one run plans the next wave', () => {
    const src = fixture(`  const A = 1;\n  function b(): number { return 2; }\n  function f(): number { return A + b() + ctx.render.frame; }\n  f();`);
    let msg = '';
    try { extractLeaves(src, ['f'], [], 'game-render-leaves'); } catch (e) { msg = String(e); }
    expect(msg).toContain('A');
    expect(msg).toContain('b');
  });
});

describe('extract-leaf: --rebind', () => {
  // scene and camera are `const { scene, camera } = ctx.boot.handle` in main(),
  // so they are reachable from ctx — they just are not spelled that way. Without
  // this, half of game-main's functions are permanently "blocked" on them.
  const src = fixture(`  const { scene, camera } = ctx.boot.handle;\n  function sizeSdfLayer(w: number): void {\n    scene.add(ctx.render.layer);\n    camera.updateProjectionMatrix();\n    void w;\n  }\n  sizeSdfLayer(2);`);
  const rebind = { scene: 'ctx.boot.handle.scene', camera: 'ctx.boot.handle.camera' };

  it('rewrites a rebound free name inside the moved body', () => {
    const r = extractLeaves(src, ['sizeSdfLayer'], [], 'game-render-leaves', [], { rebind });
    expect(r.module).toContain('ctx.boot.handle.scene.add(ctx.render.layer);');
    expect(r.module).toContain('ctx.boot.handle.camera.updateProjectionMatrix();');
    expect(r.module).not.toMatch(/(^|[^.\w])scene\./m);
  });

  it('accepts the function as a leaf once its free names are rebound', () => {
    expect(() => extractLeaves(src, ['sizeSdfLayer'], [], 'game-render-leaves')).toThrow(/scene/);
    expect(() => extractLeaves(src, ['sizeSdfLayer'], [], 'game-render-leaves', [], { rebind })).not.toThrow();
  });

  it('leaves the call site in game-main alone', () => {
    const r = extractLeaves(src, ['sizeSdfLayer'], [], 'game-render-leaves', [], { rebind });
    expect(r.main).toContain('const { scene, camera } = ');
  });

  it('does not touch a same-named property or local', () => {
    const s2 = fixture(`  const { scene, camera } = ctx.boot.handle;\n  void camera;\n  function f(): void {\n    const scene = ctx.render.frame;\n    ctx.demo.scene = scene;\n    void scene;\n  }\n  f();`);
    const r = extractLeaves(s2, ['f'], [], 'game-render-leaves', [], { rebind });
    expect(r.module).toContain('const scene = ctx.render.frame;');
    expect(r.module).toContain('ctx.demo.scene = scene;');
  });
});

describe('extract-leaf: appending to an existing module', () => {
  // Wave 1 produced game-render-leaves2.ts / game-world-leaves3.ts purely
  // because the writer could only create. A second call for the same slice must
  // land in the same file, merging imports rather than duplicating them.
  const first = fixture(`  function a(x: number): number { return x + ctx.render.frame; }\n  a(1);`);

  it('keeps the existing bodies and adds the new one', () => {
    const r1 = extractLeaves(first, ['a'], [], 'game-render-leaves');
    const second = fixture(`  function b(y: number): number { return y - ctx.render.frame; }\n  b(2);`);
    const r2 = extractLeaves(second, ['b'], [], 'game-render-leaves', [], { existing: r1.module });
    expect(r2.module).toContain('export function a(ctx: GameContext, x: number): number');
    expect(r2.module).toContain('export function b(ctx: GameContext, y: number): number');
    // One header, one GameContext import.
    expect((r2.module.match(/^\/\/ src\/lab/gm) ?? []).length).toBe(1);
    // The merge normalises `import type { X }` to the inline `{ type X }` form;
    // either spelling is fine, one line of it is the point.
    expect((r2.module.match(/GameContext \} from '\.\/game-context';/g) ?? []).length).toBe(1);
  });

  it('merges named imports from the same module instead of repeating the line', () => {
    const r1 = extractLeaves(first, ['a'], [], 'game-render-leaves', ["import { X } from './x';"]);
    const second = fixture(`  function b(y: number): number { return y - ctx.render.frame; }\n  b(2);`);
    const r2 = extractLeaves(second, ['b'], [], 'game-render-leaves', ["import { Y } from './x';"], { existing: r1.module });
    expect((r2.module.match(/from '\.\/x';/g) ?? []).length).toBe(1);
    expect(r2.module).toContain("import { X, Y } from './x';");
  });

  it('does not duplicate a body that is already there', () => {
    const r1 = extractLeaves(first, ['a'], [], 'game-render-leaves');
    const again = extractLeaves(first, ['a'], [], 'game-render-leaves', [], { existing: r1.module });
    expect((again.module.match(/export function a\(/g) ?? []).length).toBe(1);
  });
});

describe('extract-leaf: what the moved code needs to compile', () => {
  const withImports = (body: string): string =>
    `import * as THREE from 'three';\nimport { SLUG } from '../weapon';\nimport type { Vec3 } from '../types';\nimport { makeGameContext } from './game-context';\n\ntype Rung = '800' | '600';\nconst RES_RUNGS = { 800: 1 };\n\nexport function main(): void {\n  const ctx = makeGameContext();\n${body}\n}\n`;

  it('infers game-main imports for the names the body uses', () => {
    const r = extractLeaves(withImports(`  function f(v: Vec3): number {\n    return new THREE.Vector3(...v).x + SLUG.radius + ctx.render.frame;\n  }\n  f([0, 0, 0]);`), ['f'], [], 'game-x-leaves');
    expect(r.module).toContain("import * as THREE from 'three';");
    expect(r.module).toContain("import { SLUG } from '../weapon';");
    expect(r.module).toContain("import { type Vec3 } from '../types';");
  });

  it('copies a module-scope type the body references', () => {
    const r = extractLeaves(withImports(`  function f(r: Rung): string {\n    return r + String(ctx.render.frame);\n  }\n  f('800');`), ['f'], [], 'game-x-leaves');
    expect(r.module).toContain("type Rung = '800' | '600';");
  });

  it('REFUSES when the body needs a module-scope VALUE, naming it', () => {
    const src = withImports(`  function f(): number {\n    return RES_RUNGS[800] + ctx.render.frame;\n  }\n  f();`);
    expect(() => extractLeaves(src, ['f'], [], 'game-x-leaves')).toThrow(/RES_RUNGS/);
    expect(() => extractLeaves(src, ['f'], [], 'game-x-leaves', [], { force: true })).not.toThrow();
  });

  it('imports withCtx into the MODULE when a moved body passes a moved fn as a value', () => {
    const src = withImports(`  function inner(): number { return ctx.render.frame; }\n  function outer(): unknown { return { inner }; }\n  outer();`);
    const r = extractLeaves(src, ['inner', 'outer'], [], 'game-x-leaves');
    expect(r.module).toContain("import { withCtx, type GameContext } from './game-context';");
    expect(r.module).toContain('{ inner: withCtx(ctx, inner) }');
  });
});

describe('extract-leaf: mergeModule import shapes', () => {
  it('dedupes a namespace import', () => {
    const a = ["// header", "", "import * as THREE from 'three';", "", "export function a(): void {}", ""].join('\n');
    const b = ["// header", "", "import * as THREE from 'three';", "", "export function b(): void {}", ""].join('\n');
    const m = mergeModule(a, b);
    expect((m.match(/import \* as THREE/g) ?? []).length).toBe(1);
  });

  it('treats `import type { X }` and `import { type X }` as one specifier', () => {
    const a = ["// header", "", "import type { DemoFile } from './demo';", "", "export function a(): void {}", ""].join('\n');
    const b = ["// header", "", "import { type DemoFile, type Step } from './demo';", "", "export function b(): void {}", ""].join('\n');
    const m = mergeModule(a, b);
    expect((m.match(/from '\.\/demo';/g) ?? []).length).toBe(1);
    expect((m.match(/DemoFile/g) ?? []).length).toBe(1);
    expect(m).toContain('Step');
  });

  it('keeps a value and a type import of the same specifier on one line', () => {
    const a = ["// header", "", "import { buildMarch } from './gpu';", "", "export function a(): void {}", ""].join('\n');
    const b = ["// header", "", "import { type Tail } from './gpu';", "", "export function b(): void {}", ""].join('\n');
    const m = mergeModule(a, b);
    expect((m.match(/from '\.\/gpu';/g) ?? []).length).toBe(1);
    expect(m).toMatch(/import \{ buildMarch, type Tail \} from '\.\/gpu';/);
  });
});

describe('extract-leaf: --consts on a multi-declarator statement', () => {
  // `const _bfA = new THREE.Vector3(), _bfB = new THREE.Vector3();` is one
  // statement with two declarators. Cutting it once per requested name deleted
  // overlapping ranges and left game-main.ts syntactically broken.
  const src = (body: string): string =>
    `import * as THREE from 'three';\nimport { makeGameContext } from './game-context';\n\nexport function main(): void {\n  const ctx = makeGameContext();\n  const _bfA = new THREE.Vector3(), _bfB = new THREE.Vector3();\n${body}\n}\n`;

  it('moves BOTH declarators without corrupting the statement', () => {
    const r = extractLeaves(src(`  function boreFrameInRig(): number {\n    return _bfA.x + _bfB.y + ctx.weapon.bore;\n  }\n  boreFrameInRig();`),
      ['boreFrameInRig'], ['_bfA', '_bfB'], 'game-weapon-leaves');
    expect(r.module).toContain('export const _bfA = new THREE.Vector3()');
    expect(r.module).toContain('export const _bfB = new THREE.Vector3()');
    // The declaration is gone from main() (it comes back as an import), and the
    // statement is not half-deleted.
    expect(r.main).not.toMatch(/const _bfA = /);
    expect(r.main).toContain("import { _bfA, _bfB, boreFrameInRig } from './game-weapon-leaves';");
    expect(r.main).not.toMatch(/const\s*,/);
    expect(r.main).not.toMatch(/,\s*;/);
  });

  it('keeps the declarators that were NOT requested in game-main', () => {
    const r = extractLeaves(src(`  function f(): number { return _bfA.x + ctx.weapon.bore; }\n  f();\n  void _bfB;`),
      ['f'], ['_bfA'], 'game-weapon-leaves');
    expect(r.module).toContain('export const _bfA = new THREE.Vector3()');
    expect(r.module).not.toContain('_bfB');
    expect(r.main).toContain('const _bfB = new THREE.Vector3();');
    expect(r.main).not.toMatch(/_bfA\s*=/);
  });
});

describe('extract-leaf: a module never imports itself', () => {
  it('drops an inferred import whose specifier IS this module', () => {
    // An earlier wave moved viewToRig into game-weapon-leaves, so game-main
    // imports it back from there. A later function that calls it must not
    // re-import it into that same module.
    const src = [
      "import * as THREE from 'three';",
      "import { viewToRig } from './game-weapon-leaves';",
      "import { makeGameContext } from './game-context';",
      '',
      'export function main(): void {',
      '  const ctx = makeGameContext();',
      '  function viewDirToRig(v: number): number {',
      '    return viewToRig(ctx, v) + ctx.weapon.bore;',
      '  }',
      '  viewDirToRig(1);',
      '}',
      '',
    ].join('\n');
    const r = extractLeaves(src, ['viewDirToRig'], [], 'game-weapon-leaves');
    expect(r.module).not.toContain("from './game-weapon-leaves'");
  });
});
