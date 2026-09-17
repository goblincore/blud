// scripts/game-context-codemod.test.ts
//
// The codemod rewrites game-main.ts's main()-scope bindings into ctx.<slice>.
// It is the single riskiest step of the decomposition: a plausible-looking
// wrong answer type-checks and fails only at the pixel gate. So the cases that
// a naive textual rename gets wrong are pinned here first.

import { describe, expect, it } from 'vitest';
import { applyCodemod } from './game-context-codemod';

const MAP = { probeWeight: 'probes.weight', sdfScale: 'render.sdfScale' };

describe('applyCodemod — declarations', () => {
  it('rewrites a let declaration in place as an assignment', () => {
    const src = `async function main() {\n  let probeWeight = 0.5;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(`async function main() {\n  ctx.probes.weight = 0.5;\n}\n`);
  });

  it('rewrites a const declaration the same way', () => {
    const src = `async function main() {\n  const sdfScale = 1.0;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(`async function main() {\n  ctx.render.sdfScale = 1.0;\n}\n`);
  });

  it('keeps the declaration on its original line', () => {
    const src = `async function main() {\n  const a = 1;\n  let probeWeight = 0.5;\n  const b = 2;\n}\n`;
    const lines = applyCodemod(src, MAP).split('\n');
    expect(lines[2]).toBe('  ctx.probes.weight = 0.5;');
  });

  it('leaves a declaration with no mapping untouched', () => {
    const src = `async function main() {\n  let untouched = 7;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(src);
  });
});

describe('applyCodemod — references', () => {
  const MAP2 = { probeWeight: 'probes.weight' };

  it('rewrites reads and writes', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  probeWeight = 1;\n  use(probeWeight);\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('ctx.probes.weight = 1;');
    expect(out).toContain('use(ctx.probes.weight);');
  });

  it('expands shorthand properties instead of corrupting them', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  send({ probeWeight });\n}\n`;
    expect(applyCodemod(src, MAP2)).toContain('send({ probeWeight: ctx.probes.weight });');
  });

  it('leaves a property named the same alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  const o = { probeWeight: 3 };\n  use(o.probeWeight);\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('const o = { probeWeight: 3 };');
    expect(out).toContain('use(o.probeWeight);');
  });

  it('leaves a shadowed inner binding alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  function inner() { let probeWeight = 9; return probeWeight; }\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('let probeWeight = 9; return probeWeight;');
  });

  it('leaves strings and comments alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  // probeWeight is tuned\n  log('probeWeight');\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('// probeWeight is tuned');
    expect(out).toContain(`log('probeWeight');`);
  });

  it('rewrites compound assignment and increment', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  probeWeight += 2;\n  probeWeight++;\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('ctx.probes.weight += 2;');
    expect(out).toContain('ctx.probes.weight++;');
  });

  it('rewrites a reference inside a nested arrow that does not shadow', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  const f = () => probeWeight * 2;\n}\n`;
    expect(applyCodemod(src, MAP2)).toContain('const f = () => ctx.probes.weight * 2;');
  });

  it('leaves a parameter with the same name alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  const g = (probeWeight: number) => probeWeight + 1;\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('(probeWeight: number) => probeWeight + 1');
  });
});

describe('applyCodemod — declaration/reference interaction', () => {
  // Regression: pass 1 originally replaced the WHOLE VariableStatement, so an
  // owned binding referenced inside another binding's initializer was silently
  // left as a bare identifier — which would have thrown at runtime (the local
  // no longer exists) rather than failing tsc. Pass 1 now replaces only the
  // declaration prefix, leaving the initializer open to pass 2.
  const MAP3 = { probeWeight: 'probes.weight', probeGain: 'probes.gain' };

  it('rewrites an owned binding referenced inside another declaration initializer', () => {
    const src = `async function main() {\n  let probeWeight = 0.5;\n  let probeGain = probeWeight * 2;\n}\n`;
    const out = applyCodemod(src, MAP3);
    expect(out).toContain('ctx.probes.weight = 0.5;');
    expect(out).toContain('ctx.probes.gain = ctx.probes.weight * 2;');
  });

  it('drops the type annotation, which an assignment cannot carry', () => {
    const src = `async function main() {\n  let probeWeight: number | null = null;\n}\n`;
    expect(applyCodemod(src, MAP3)).toContain('ctx.probes.weight = null;');
  });

  it('keeps a declaration with no initializer on its line', () => {
    const src = `async function main() {\n  let probeWeight;\n}\n`;
    expect(applyCodemod(src, MAP3)).toBe(`async function main() {\n  ctx.probes.weight;\n}\n`);
  });
});

describe('applyCodemod — collapse reporting', () => {
  it('reports a multi-line type annotation as lines lost', () => {
    const src = `async function main() {\n  let texProbe: null | {\n    a: number;\n    b: number;\n  } = null;\n}\n`;
    const report = { collapsed: [], linesLost: 0 };
    const out = applyCodemod(src, { texProbe: 'render.texProbe' }, report);
    expect(out).toContain('ctx.render.texProbe = null;');
    expect(report.linesLost).toBe(3);
    expect(report.collapsed[0]).toMatchObject({ name: 'texProbe', linesLost: 3 });
  });

  it('reports nothing for a single-line declaration', () => {
    const src = `async function main() {\n  let probeWeight = 0.5;\n}\n`;
    const report = { collapsed: [], linesLost: 0 };
    applyCodemod(src, { probeWeight: 'probes.weight' }, report);
    expect(report.linesLost).toBe(0);
  });
});

describe('applyCodemod — multi-declarator statements', () => {
  it('rewrites an all-mapped multi-declarator into a comma expression', () => {
    const src = `async function main() {\n  let pendingDx = 0, pendingDy = 0;\n}\n`;
    const out = applyCodemod(src, { pendingDx: 'player.pendingDx', pendingDy: 'player.pendingDy' });
    expect(out).toBe(`async function main() {\n  ctx.player.pendingDx = 0, ctx.player.pendingDy = 0;\n}\n`);
  });

  it('leaves a wholly unmapped multi-declarator alone', () => {
    const src = `async function main() {\n  const _a = v(), _b = v();\n}\n`;
    expect(applyCodemod(src, { probeWeight: 'probes.weight' })).toBe(src);
  });

  it('refuses a MIXED multi-declarator rather than silently breaking one', () => {
    const src = `async function main() {\n  let probeWeight = 0, keepMe = 1;\n}\n`;
    expect(() => applyCodemod(src, { probeWeight: 'probes.weight' })).toThrow(/mixed multi-declarator/);
  });
});

describe('applyCodemod — name positions must never be rewritten', () => {
  const M = { demoSeed: 'demo.seed', probeWeight: 'probes.weight' };

  // Regression: the first version enumerated PropertyAssignment /
  // PropertyAccessExpression / MethodDeclaration and still produced
  // `get ctx.demo.seed() { ... }` — 808 syntax errors — because accessors
  // were not on the list.
  it('leaves a GETTER name alone but rewrites its body', () => {
    const src = `async function main() {\n  let demoSeed = 1;\n  const o = { get demoSeed() { return demoSeed; } };\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('get demoSeed() { return ctx.demo.seed; }');
  });

  it('leaves a SETTER name alone', () => {
    const src = `async function main() {\n  let demoSeed = 1;\n  const o = { set demoSeed(v) { demoSeed = v; } };\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('set demoSeed(v)');
  });

  it('leaves a method name alone but rewrites its body', () => {
    const src = `async function main() {\n  let probeWeight = 1;\n  const o = { probeWeight() { return probeWeight; } };\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('probeWeight() { return ctx.probes.weight; }');
  });

  it('rewrites the object of a property access but not the property', () => {
    const src = `async function main() {\n  let probeWeight = 1;\n  use(probeWeight.toFixed(2));\n}\n`;
    expect(applyCodemod(src, M)).toContain('use(ctx.probes.weight.toFixed(2));');
  });

  it('leaves a nested function declaration name alone', () => {
    const src = `async function main() {\n  let probeWeight = 1;\n  function probeWeight2() { return probeWeight; }\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('function probeWeight2()');
  });
});

describe('applyCodemod — destructured shadows', () => {
  const M = { coverage: 'world.coverage' };

  // Regression: collectShadows only looked at `ts.isIdentifier(decl.name)`, so
  // `const { coverage } = f()` shadowed nothing and the inner `coverage` — a
  // Float32Array — was rewritten to ctx.world.coverage, an object of a totally
  // different shape. tsc caught it, but only by luck of the type mismatch.
  it('leaves a name shadowed by OBJECT destructuring alone', () => {
    const src = `async function main() {\n  const coverage = { a: 1 };\n  function f() { const { target, coverage } = g(); return [target, coverage]; }\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('const { target, coverage } = g(); return [target, coverage];');
  });

  it('leaves a name shadowed by ARRAY destructuring alone', () => {
    const src = `async function main() {\n  const coverage = { a: 1 };\n  function f() { const [coverage] = g(); return coverage; }\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('const [coverage] = g(); return coverage;');
  });

  it('leaves a name shadowed by a destructured PARAMETER alone', () => {
    const src = `async function main() {\n  const coverage = { a: 1 };\n  const f = ({ coverage }: any) => coverage;\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('({ coverage }: any) => coverage');
  });

  it('still rewrites the outer binding outside the shadowing function', () => {
    const src = `async function main() {\n  const coverage = { a: 1 };\n  use(coverage);\n  function f() { const { coverage } = g(); return coverage; }\n}\n`;
    const out = applyCodemod(src, M);
    expect(out).toContain('use(ctx.world.coverage);');
  });
});
