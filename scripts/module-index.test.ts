// scripts/module-index.test.ts
//
// Keeps docs/architecture/module-index.md honest: every module of the active
// tree has a header summary, and the committed index matches the tree.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AREAS, INDEX_PATH, areaOf, collect, entrypoints, render, summarize } from './module-index';

describe('summarize', () => {
  it('takes the first sentence after the path label', () => {
    expect(summarize('// src/lab/sdf-zombie/x.ts\n//\n// Owns the thing and its tuning table. And more.\nimport a from "a";\n'))
      .toBe('Owns the thing and its tuning table.');
  });

  it('keeps a paragraph whose first sentence is a stub', () => {
    expect(summarize('// See e.g. the panel chrome module for the shell.\n')).toBe('See e.g. the panel chrome module for the shell.');
  });

  it('reads a label that shares its paragraph with the text', () => {
    expect(summarize('// src/lab/sdf-zombie/x.ts\n// Shader source as strings.\n')).toBe('Shader source as strings.');
  });

  it('reads a block comment', () => {
    expect(summarize('/**\n * Owns the thing.\n *\n * Detail.\n */\nexport {};\n')).toBe('Owns the thing.');
  });

  it('skips the extraction boilerplate', () => {
    const boiler = "// src/x.ts\n//\n// Extracted from game-main.ts's main() closure. Each function takes ctx.\n//\n// Plan: docs/superpowers/plans/p.md\n";
    expect(summarize(boiler)).toBeNull();
    expect(summarize(boiler.replace('//\n// Extracted', '//\n// Chunk piece views.\n//\n// Extracted'))).toBe('Chunk piece views.');
  });

  it('is null with no header', () => {
    expect(summarize("import a from 'a';\n// later comment\n")).toBeNull();
  });

  it('clips a long sentence at a word', () => {
    const s = summarize(`// ${'word '.repeat(60)}end.\n`)!;
    expect(s.length).toBeLessThanOrEqual(151);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('areas', () => {
  it('first match wins, and the last rule catches everything', () => {
    expect(areaOf('webgpu/game-state-world.ts')).toBe('Game: context and state');
    expect(areaOf('webgpu/game-seams-fx.ts')).toBe('Game: debug seams');
    expect(areaOf('webgpu/march/index.ts')).toBe('webgpu/march/');
    expect(areaOf('nothing-like-this.ts')).toBe(AREAS[AREAS.length - 1].name);
  });
});

describe('the module index', () => {
  const entries = collect();

  it('every module says what it owns in its header comment', () => {
    // Fix: start the file with `// <path>` / `//` / `// One sentence.`, then
    // run `npx tsx scripts/module-index.ts`.
    expect(entries.filter((e) => e.summary === null).map((e) => e.path)).toEqual([]);
  });

  it('is up to date (run: npx tsx scripts/module-index.ts)', () => {
    expect(readFileSync(INDEX_PATH, 'utf8')).toBe(render(entries, entrypoints()));
  });
});
