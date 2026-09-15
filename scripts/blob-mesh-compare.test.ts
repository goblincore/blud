// scripts/blob-mesh-compare.test.ts
//
// Focused gates for the comparison CLI's SAFETY and VALIDATION layers. These
// tests never touch the real checkout: every destructive path runs inside a
// throwaway `mkdtemp` sandbox with sentinel files, so a regression that would
// erase a populated directory fails here instead of on a user's tree.

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  EVIDENCE_GENERATED, EVIDENCE_MANIFEST, MAX_GRID_CELLS, RUN_MARKER,
  assertDisjoint, assertGridBudget, cleanEvidenceDir, parseArgs, prepareOwnedDir,
  resolveWithinRoot, validateArgs, writeJson,
} from './blob-mesh-compare';
import { controlSphere } from '../src/lab/sdf-zombie/mesher-comparison/fixtures';

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'blob-mesh-cli-'));
}

describe('CLI argument validation', () => {
  it('parses sensible defaults and the smoke preset without a repo', () => {
    const def = parseArgs([]);
    expect(def.fixtures.length).toBeGreaterThan(0);
    expect(def.methods).toEqual(['surface-nets', 'marching-cubes', 'dual-contouring']);
    const smoke = parseArgs(['--smoke']);
    expect(smoke.cells).toEqual([0.04]);
    expect(smoke.repeats).toBe(1);
    expect(smoke.warmups).toBe(0);
    expect(() => validateArgs(def)).not.toThrow();
  });

  it('rejects unknown names, empty selections and out-of-range numbers', () => {
    const base = parseArgs([]);
    expect(() => validateArgs({ ...base, fixtures: [] })).toThrow(/no fixtures/);
    expect(() => validateArgs({ ...base, fixtures: ['nope'] })).toThrow(/unknown fixture/);
    expect(() => validateArgs({ ...base, methods: [] })).toThrow(/no methods/);
    expect(() => validateArgs({ ...base, methods: ['marching-tetras' as never] })).toThrow(/unknown method/);
    expect(() => validateArgs({ ...base, cells: [] })).toThrow(/no cell sizes/);
    expect(() => validateArgs({ ...base, cells: [Number.NaN] })).toThrow(/finite positive/);
    expect(() => validateArgs({ ...base, cells: [0] })).toThrow(/finite positive/);
    expect(() => validateArgs({ ...base, repeats: 0 })).toThrow(/positive integer/);
    expect(() => validateArgs({ ...base, repeats: 1.5 })).toThrow(/positive integer/);
    expect(() => validateArgs({ ...base, warmups: -1 })).toThrow(/nonnegative integer/);
    expect(() => validateArgs({ ...base, panelsCellMm: Number.NaN })).toThrow(/panels-cell/);
    expect(() => validateArgs({ ...base, panelsExtraMm: [0] })).toThrow(/panels-extra/);
  });

  it('enforces each fixture minCell instead of silently clamping', () => {
    const base = parseArgs([]);
    // character-head minCell is 5 mm; 2 mm must fail, 5 mm must pass.
    expect(() => validateArgs({ ...base, fixtures: ['character-head'], cells: [0.002] })).toThrow(/requires cell/);
    expect(() => validateArgs({ ...base, fixtures: ['character-head'], cells: [0.005] })).not.toThrow();
  });

  it('enforces a conservative grid budget before allocation', () => {
    const field = controlSphere();
    expect(() => assertGridBudget(field, 0.02, 'ok')).not.toThrow();
    // 1e-5 m over a 0.6 m box is astronomically over budget.
    expect(() => assertGridBudget(field, 1e-5, 'too big')).toThrow(/over the budget/);
    expect(MAX_GRID_CELLS).toBeLessThan(100_000_000);
  });
});

describe('CLI path safety', () => {
  it('rejects the repo root, ancestors, escapes, source trees and symlink escapes', () => {
    const root = sandbox();
    mkdirSync(join(root, 'src'), { recursive: true });
    expect(() => resolveWithinRoot(root, '.', '--out')).toThrow(/repository root/);
    expect(() => resolveWithinRoot(root, '..', '--out')).toThrow(/outside|repository root/);
    expect(() => resolveWithinRoot(root, '/tmp/elsewhere', '--out')).toThrow(/outside/);
    expect(() => resolveWithinRoot(root, 'src/thing', '--out')).toThrow(/refusing to write or delete inside 'src'/);
    // A symlink pointing outside the sandbox must not be followed.
    const outside = sandbox();
    try {
      symlinkSync(outside, join(root, 'link'));
      expect(() => resolveWithinRoot(root, 'link/sub', '--out')).toThrow(/escapes the repository/);
    } finally { rmSync(outside, { recursive: true, force: true }); }
    // A normal scratch path is accepted.
    expect(resolveWithinRoot(root, '.scratch/run', '--out')).toBe(join(root, '.scratch/run'));
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects overlapping out/evidence directories', () => {
    const root = sandbox();
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'a', 'b'), 'out', 'ev')).toThrow(/overlaps/);
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'a'), 'out', 'ev')).toThrow(/overlaps/);
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'b'), 'out', 'ev')).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it('erases only task-owned output, and refuses a populated unrelated directory', () => {
    const root = sandbox();
    const allowed = [...EVIDENCE_GENERATED, RUN_MARKER];
    // Task-owned: known generated names only -> safe to replace.
    const owned = join(root, 'owned');
    mkdirSync(join(owned, 'meshes'), { recursive: true });
    writeFileSync(join(owned, 'results.json'), '{}');
    prepareOwnedDir(owned, allowed, '--out');
    expect(existsSync(join(owned, RUN_MARKER))).toBe(true);
    expect(existsSync(join(owned, 'results.json'))).toBe(false);

    // Unrelated: a sentinel file must survive and the call must throw.
    const unrelated = join(root, 'unrelated');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, 'IMPORTANT.txt'), 'do not delete');
    expect(() => prepareOwnedDir(unrelated, allowed, '--out')).toThrow(/unexpected entries/);
    expect(readFileSync(join(unrelated, 'IMPORTANT.txt'), 'utf8')).toBe('do not delete');
    rmSync(root, { recursive: true, force: true });
  });

  it('cleans generated evidence but preserves human notes and stray files', () => {
    const root = sandbox();
    const ev = join(root, 'evidence');
    mkdirSync(join(ev, 'meshes'), { recursive: true });
    mkdirSync(join(ev, 'panels'), { recursive: true });
    writeFileSync(join(ev, 'README.md'), '# human notes');
    writeFileSync(join(ev, 'NOTES.txt'), 'keep me');
    writeFileSync(join(ev, 'results.json'), '{}');
    writeFileSync(join(ev, 'summary.md'), 'stale');
    writeFileSync(join(ev, EVIDENCE_MANIFEST), JSON.stringify({ generated: ['meshes/old.glb', 'summary.md'] }));
    cleanEvidenceDir(ev);
    expect(readFileSync(join(ev, 'README.md'), 'utf8')).toBe('# human notes');
    expect(readFileSync(join(ev, 'NOTES.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(join(ev, 'results.json'))).toBe(false);
    expect(readdirSync(join(ev, 'meshes'))).toEqual([]);
    expect(existsSync(join(ev, 'panels'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('CLI JSON serialization', () => {
  it('does not turn NaN/Infinity into innocuous nulls', () => {
    const root = sandbox();
    const p = join(root, 'out.json');
    writeJson(p, { a: Number.NaN, b: Number.POSITIVE_INFINITY, c: Number.NEGATIVE_INFINITY, d: 1.5 });
    const text = readFileSync(p, 'utf8');
    expect(text).toContain('"a": "NaN"');
    expect(text).toContain('"b": "Infinity"');
    expect(text).toContain('"c": "-Infinity"');
    expect(text).not.toContain(': null');
    rmSync(root, { recursive: true, force: true });
  });
});

describe('CLI invalid-run regression', () => {
  it('exits non-zero, reports the reason and exports no meshes for an invalid run', () => {
    // A 5 m cell makes the 0.2 m control sphere fit inside one grid cell, so
    // the field never changes sign: the mesh is empty, hence INVALID. This is
    // a genuine end-to-end invalid row, not a validation error.
    const repoRoot = process.cwd();
    const relOut = `.scratch/cli-invalid-${process.pid}-${Date.now()}`;
    const out = join(repoRoot, relOut);
    try {
      const res = spawnSync('npx', [
        'tsx', 'scripts/blob-mesh-compare.ts',
        '--fixtures', 'control-sphere', '--methods', 'marching-cubes',
        '--cells', '5000', '--repeats', '1', '--warmups', '0', '--out', relOut,
      ], { cwd: repoRoot, encoding: 'utf8' });
      expect(res.status).not.toBe(0);
      expect(`${res.stdout}\n${res.stderr}`).toMatch(/INVALID/);
      expect(readdirSync(join(out, 'meshes'))).toEqual([]);
      // Diagnostics are still written and carry the reason — not dropped.
      const body = readFileSync(join(out, 'results.json'), 'utf8');
      expect(body).toMatch(/INVALID|empty mesh|invalid/i);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60000);
});
