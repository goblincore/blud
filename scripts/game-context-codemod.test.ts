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
