// scripts/extract-leaf.test.ts
//
// The four gaps leaves wave 1 hit (docs/dev-notes/2026-09-19-game-main-leaves-1/NOTES.md):
// a generic signature the ctx regex missed, shorthand `{ f }` refs left
// uncontextualised, an untyped `(...a) =>` wrapper that does not compile under
// an `unknown`-typed literal, and "refuses non-leaves" that never refused.
// Fixtures are minimal game-main shapes, not the real file: each test pins ONE
// rewrite rule.
import { describe, it, expect } from 'vitest';
import { extractLeaves } from './extract-leaf';

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
