// scripts/lib/game-main-deps.test.ts
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { importTable, importsFor, localTypes, usedLocalTypes, localValues, missingLocalValues } from './game-main-deps';

const SRC = [
  "import * as THREE from 'three';",
  "import { SLUG, GRAPESHOT as SHOT } from '../weapon';",
  "import type { Vec3 } from '../types';",
  "import { type RefineTail, buildMarch } from './zombie-gpu';",
  '',
  'type ResRung = "800" | "600";',
  'interface Rig { a: number }',
  'const RES_RUNGS = { 800: 1 };',
  'export const SHARED = 2;',
  'function helper(): number { return 1; }',
  'export function main(): void { void helper; }',
  '',
].join('\n');
const sf = () => ts.createSourceFile('game-main.ts', SRC, ts.ScriptTarget.ES2022, true);

describe('importTable / importsFor', () => {
  it('emits one line per specifier, aliases and namespaces intact', () => {
    const t = importTable(sf());
    const lines = importsFor(['const a = new THREE.Vector3(SLUG.radius, SHOT.radius, buildMarch());'], t);
    expect(lines).toContain("import * as THREE from 'three';");
    expect(lines).toContain("import { GRAPESHOT as SHOT, SLUG } from '../weapon';");
    expect(lines).toContain("import { buildMarch } from './zombie-gpu';");
  });

  it('marks a type-only import as a type import', () => {
    const t = importTable(sf());
    expect(importsFor(['const v: Vec3 = [0, 0, 0];'], t)).toEqual(["import { type Vec3 } from '../types';"]);
  });

  it('carries an inline type import through as a type', () => {
    const t = importTable(sf());
    expect(importsFor(['let t: RefineTail;'], t)).toEqual(["import { type RefineTail } from './zombie-gpu';"]);
  });

  it('ignores a name that only appears as a PROPERTY, in a string or in a comment', () => {
    const t = importTable(sf());
    expect(importsFor(['const o = { SLUG: 1 }; const s = "SLUG"; // SLUG\n'], t)).toEqual([]);
  });

  it('skips names the caller provides another way', () => {
    const t = importTable(sf());
    expect(importsFor(['SLUG;'], t, new Set(['SLUG']))).toEqual([]);
  });
});

describe('local types', () => {
  it('copies a referenced module-scope type or interface', () => {
    const types = localTypes(SRC, sf());
    expect(usedLocalTypes(['let r: ResRung;'], types)).toEqual(['type ResRung = "800" | "600";']);
    expect(usedLocalTypes(['let g: Rig;'], types)).toEqual(['interface Rig { a: number }']);
    expect(usedLocalTypes(['let n: number;'], types)).toEqual([]);
  });
});

describe('local values', () => {
  it('lists non-exported module-scope values only', () => {
    const v = localValues(sf());
    expect([...v].sort()).toEqual(['RES_RUNGS', 'helper']);
    expect(v.has('SHARED')).toBe(false);
    expect(v.has('main')).toBe(false);
  });

  it('reports the module-scope values a fragment would lose', () => {
    expect(missingLocalValues(['const x = RES_RUNGS[800] + helper();'], sf(), new Set()))
      .toEqual(['RES_RUNGS', 'helper']);
    expect(missingLocalValues(['const x = RES_RUNGS[800];'], sf(), new Set(['RES_RUNGS']))).toEqual([]);
  });
});
