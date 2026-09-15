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
  EVIDENCE_MANIFEST, MAX_GRID_CELLS, RUN_MARKER, RUN_MARKER_MAGIC, RUN_MANIFEST,
  assertDisjoint, assertEvidencePlan, assertGridBudget, cleanEvidenceDir, isGeneratedRelPath,
  parseArgs, prepareOwnedDir, resolveWithinRoot, validateArgs, writeJson,
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
    // A within-repo symlink that aliases a protected tree is refused too.
    symlinkSync(join(root, 'src'), join(root, 'srclink'));
    expect(() => resolveWithinRoot(root, 'srclink/out', '--out')).toThrow(/aliases protected 'src'/);
    // A normal scratch path is accepted.
    expect(resolveWithinRoot(root, '.scratch/run', '--out')).toBe(join(root, '.scratch/run'));
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects overlapping out/evidence directories, including symlink aliases', () => {
    const root = sandbox();
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'a', 'b'), 'out', 'ev')).toThrow(/overlaps/);
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'a'), 'out', 'ev')).toThrow(/overlaps/);
    expect(() => assertDisjoint(join(root, 'a'), join(root, 'b'), 'out', 'ev')).not.toThrow();
    const shared = join(root, 'shared');
    mkdirSync(shared, { recursive: true });
    symlinkSync(shared, join(root, 'alias'));
    expect(() => assertDisjoint(shared, join(root, 'alias', 'x'), 'out', 'ev')).toThrow(/overlaps/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('CLI output ownership', () => {
  it('preserves an unowned evidence file whose name looks generated (exact sentinel repro #1)', () => {
    const root = sandbox();
    const ev = join(root, 'evidence');
    mkdirSync(join(ev, 'meshes'), { recursive: true });
    writeFileSync(join(ev, 'meshes', 'human-authored.obj'), 'sentinel');
    const cleanup = cleanEvidenceDir(ev);
    expect(readFileSync(join(ev, 'meshes', 'human-authored.obj'), 'utf8')).toBe('sentinel');
    expect(cleanup.remaining.has('meshes/human-authored.obj')).toBe(true);
    // Writing an artifact at that same name is rejected before any mutation.
    expect(() => assertEvidencePlan([{ rel: 'meshes/human-authored.obj', data: 'x' }], cleanup)).toThrow(/not tool-owned/);
    expect(readFileSync(join(ev, 'meshes', 'human-authored.obj'), 'utf8')).toBe('sentinel');
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a populated unowned run dir and keeps nested files (exact sentinel repro #2)', () => {
    const root = sandbox();
    const unrelated = join(root, 'unrelated');
    mkdirSync(join(unrelated, 'meshes'), { recursive: true });
    writeFileSync(join(unrelated, 'meshes', 'keep.txt'), 'do not delete');
    expect(() => prepareOwnedDir(unrelated, '--out')).toThrow(/without the tool ownership marker/);
    expect(readFileSync(join(unrelated, 'meshes', 'keep.txt'), 'utf8')).toBe('do not delete');
    rmSync(root, { recursive: true, force: true });
  });

  it('deletes only manifest-listed files and rejects an unknown nested file in an owned meshes dir', () => {
    const root = sandbox();
    const owned = join(root, 'owned');
    prepareOwnedDir(owned, '--out');
    mkdirSync(join(owned, 'meshes'), { recursive: true });
    writeFileSync(join(owned, 'meshes', 'a.glb'), 'old');
    writeFileSync(join(owned, 'results.json'), '{}');
    writeFileSync(join(owned, RUN_MANIFEST), JSON.stringify({ generated: ['meshes/a.glb', 'results.json'] }));
    writeFileSync(join(owned, 'meshes', 'human.txt'), 'keep');
    expect(() => prepareOwnedDir(owned, '--out')).toThrow(/not recorded in the run manifest/);
    expect(readFileSync(join(owned, 'meshes', 'human.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(join(owned, 'meshes', 'a.glb'), 'utf8')).toBe('old');
    rmSync(join(owned, 'meshes', 'human.txt'));
    prepareOwnedDir(owned, '--out');
    expect(existsSync(join(owned, RUN_MARKER))).toBe(true);
    expect(existsSync(join(owned, 'meshes', 'a.glb'))).toBe(false);
    expect(existsSync(join(owned, 'results.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a corrupt marker or a marker without a manifest, deleting nothing', () => {
    const root = sandbox();
    const noManifest = join(root, 'no-manifest');
    mkdirSync(noManifest, { recursive: true });
    writeFileSync(join(noManifest, RUN_MARKER), 'blob-mesh-compare run dir v1\n');
    writeFileSync(join(noManifest, 'results.json'), '{}');
    expect(() => prepareOwnedDir(noManifest, '--out')).toThrow(/no generated-file manifest/);
    expect(readFileSync(join(noManifest, 'results.json'), 'utf8')).toBe('{}');
    const corrupt = join(root, 'corrupt');
    mkdirSync(corrupt, { recursive: true });
    writeFileSync(join(corrupt, RUN_MARKER), 'something else');
    writeFileSync(join(corrupt, 'results.json'), '{}');
    expect(() => prepareOwnedDir(corrupt, '--out')).toThrow(/corrupt ownership marker/);
    expect(readFileSync(join(corrupt, 'results.json'), 'utf8')).toBe('{}');
    const badManifest = join(root, 'bad-manifest');
    prepareOwnedDir(badManifest, '--out');
    writeFileSync(join(badManifest, 'results.json'), '{}');
    writeFileSync(join(badManifest, RUN_MANIFEST), 'not json');
    expect(() => prepareOwnedDir(badManifest, '--out')).toThrow(/not valid JSON/);
    expect(readFileSync(join(badManifest, 'results.json'), 'utf8')).toBe('{}');
    writeFileSync(join(badManifest, RUN_MANIFEST), JSON.stringify({ generated: ['../escape.glb'] }));
    expect(() => prepareOwnedDir(badManifest, '--out')).toThrow(/not a safe generated path/);
    expect(readFileSync(join(badManifest, 'results.json'), 'utf8')).toBe('{}');
    rmSync(root, { recursive: true, force: true });
  });

  it('supports repeat generation into the same owned run dir', () => {
    const root = sandbox();
    const owned = join(root, 'owned');
    for (let i = 0; i < 3; i++) {
      prepareOwnedDir(owned, '--out');
      mkdirSync(join(owned, 'meshes'), { recursive: true });
      writeFileSync(join(owned, 'meshes', 'a.glb'), `run${i}`);
      writeFileSync(join(owned, 'results.json'), '{}');
      writeFileSync(join(owned, RUN_MANIFEST), JSON.stringify({ generated: ['meshes/a.glb', 'results.json'] }));
      expect(readFileSync(join(owned, 'meshes', 'a.glb'), 'utf8')).toBe(`run${i}`);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves README and stray evidence files while replacing manifest-owned output', () => {
    const root = sandbox();
    const ev = join(root, 'evidence');
    mkdirSync(join(ev, 'meshes'), { recursive: true });
    mkdirSync(join(ev, 'panels'), { recursive: true });
    writeFileSync(join(ev, 'README.md'), '# human notes');
    writeFileSync(join(ev, 'NOTES.txt'), 'keep me');
    writeFileSync(join(ev, 'results.json'), 'stale');
    writeFileSync(join(ev, 'meshes', 'old.glb'), 'owned');
    writeFileSync(join(ev, EVIDENCE_MANIFEST), JSON.stringify({ generated: ['meshes/old.glb', 'results.json'] }));
    const cleanup = cleanEvidenceDir(ev);
    expect(readFileSync(join(ev, 'README.md'), 'utf8')).toBe('# human notes');
    expect(readFileSync(join(ev, 'NOTES.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(join(ev, 'results.json'))).toBe(false);
    expect(existsSync(join(ev, 'meshes', 'old.glb'))).toBe(false);
    expect([...cleanup.removed].sort()).toEqual(['meshes/old.glb', 'results.json']);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a malformed or escaping manifest without deleting data', () => {
    const bad = [
      'not json',
      JSON.stringify({ nope: 1 }),
      JSON.stringify({ generated: ['../evil.glb'] }),
      JSON.stringify({ generated: ['/abs.glb'] }),
      JSON.stringify({ generated: ['meshes/../../src/x.glb'] }),
      JSON.stringify({ generated: ['meshes/x.glb', 'human.txt'] }),
      'null',
      '[]',
      '[1,2]',
    ];
    for (const body of bad) {
      const root = sandbox();
      const ev = join(root, 'evidence');
      mkdirSync(join(ev, 'meshes'), { recursive: true });
      writeFileSync(join(ev, 'meshes', 'x.glb'), 'owned');
      writeFileSync(join(ev, 'README.md'), 'human');
      writeFileSync(join(ev, EVIDENCE_MANIFEST), body);
      expect(() => cleanEvidenceDir(ev)).toThrow(/manifest/);
      expect(readFileSync(join(ev, 'meshes', 'x.glb'), 'utf8')).toBe('owned');
      expect(readFileSync(join(ev, 'README.md'), 'utf8')).toBe('human');
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked generated subtree instead of deleting through it', () => {
    const root = sandbox();
    const owned = join(root, 'owned');
    prepareOwnedDir(owned, '--out');
    const outside = sandbox();
    mkdirSync(join(outside, 'meshes'), { recursive: true });
    writeFileSync(join(outside, 'meshes', 'keep.glb'), 'keep');
    symlinkSync(join(outside, 'meshes'), join(owned, 'meshes'));
    writeFileSync(join(owned, RUN_MANIFEST), JSON.stringify({ generated: ['meshes/keep.glb'] }));
    expect(() => prepareOwnedDir(owned, '--out')).toThrow(/symlink/);
    expect(readFileSync(join(outside, 'meshes', 'keep.glb'), 'utf8')).toBe('keep');
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('validates the generated-path grammar strictly', () => {
    expect(isGeneratedRelPath('meshes/a.glb', 'run')).toBe(true);
    expect(isGeneratedRelPath('panels/a-+-b.png', 'evidence')).toBe(true);
    expect(isGeneratedRelPath('results.json', 'run')).toBe(true);
    expect(isGeneratedRelPath('sensitivity.json', 'run')).toBe(false);
    expect(isGeneratedRelPath('sensitivity.json', 'evidence')).toBe(true);
    expect(isGeneratedRelPath('../a.glb', 'run')).toBe(false);
    expect(isGeneratedRelPath('meshes/../a.glb', 'run')).toBe(false);
    expect(isGeneratedRelPath('meshes/a.txt', 'run')).toBe(false);
    expect(isGeneratedRelPath('notes.txt', 'evidence')).toBe(false);
    expect(isGeneratedRelPath('/etc/passwd', 'evidence')).toBe(false);
    expect(isGeneratedRelPath('meshes/a.glb/extra', 'run')).toBe(false);
  });

  it('rejects a symlinked or dangling ownership marker, keeping the target and owned output', () => {
    for (const linkKind of ['regular', 'dangling'] as const) {
      const root = sandbox();
      const owned = join(root, 'owned');
      mkdirSync(owned, { recursive: true });
      writeFileSync(join(owned, RUN_MANIFEST), JSON.stringify({ generated: ['results.json'] }));
      writeFileSync(join(owned, 'results.json'), 'owned-output');
      const sentinel = join(root, 'unrelated.json');
      const target = linkKind === 'regular' ? sentinel : join(root, 'never-created.json');
      if (linkKind === 'regular') writeFileSync(sentinel, `${RUN_MARKER_MAGIC}\nSENTINEL`);
      symlinkSync(target, join(owned, RUN_MARKER));
      expect(() => prepareOwnedDir(owned, '--out')).toThrow(/symlink/);
      expect(readFileSync(join(owned, 'results.json'), 'utf8')).toBe('owned-output');
      if (linkKind === 'regular') expect(readFileSync(sentinel, 'utf8')).toBe(`${RUN_MARKER_MAGIC}\nSENTINEL`);
      else expect(existsSync(target)).toBe(false);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked or dangling run manifest, keeping the target and owned output', () => {
    for (const linkKind of ['regular', 'dangling'] as const) {
      const root = sandbox();
      const owned = join(root, 'owned');
      mkdirSync(owned, { recursive: true });
      writeFileSync(join(owned, RUN_MARKER), `${RUN_MARKER_MAGIC}\n`);
      writeFileSync(join(owned, 'results.json'), 'owned-output');
      const sentinel = join(root, 'unrelated.json');
      const target = linkKind === 'regular' ? sentinel : join(root, 'never-created.json');
      if (linkKind === 'regular') writeFileSync(sentinel, '{"generated":[]}');
      symlinkSync(target, join(owned, RUN_MANIFEST));
      expect(() => prepareOwnedDir(owned, '--out')).toThrow(/symlink/);
      expect(readFileSync(join(owned, 'results.json'), 'utf8')).toBe('owned-output');
      if (linkKind === 'regular') expect(readFileSync(sentinel, 'utf8')).toBe('{"generated":[]}');
      else expect(existsSync(target)).toBe(false);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked or dangling evidence manifest, keeping the target and owned output', () => {
    for (const linkKind of ['regular', 'dangling'] as const) {
      const root = sandbox();
      const ev = join(root, 'evidence');
      mkdirSync(join(ev, 'meshes'), { recursive: true });
      writeFileSync(join(ev, 'meshes', 'owned.glb'), 'owned-output');
      writeFileSync(join(ev, 'README.md'), 'human notes');
      const sentinel = join(root, 'unrelated.json');
      const target = linkKind === 'regular' ? sentinel : join(root, 'never-created.json');
      if (linkKind === 'regular') writeFileSync(sentinel, JSON.stringify({ generated: ['meshes/owned.glb'] }));
      symlinkSync(target, join(ev, EVIDENCE_MANIFEST));
      expect(() => cleanEvidenceDir(ev)).toThrow(/symlink/);
      expect(readFileSync(join(ev, 'meshes', 'owned.glb'), 'utf8')).toBe('owned-output');
      expect(readFileSync(join(ev, 'README.md'), 'utf8')).toBe('human notes');
      if (linkKind === 'regular') expect(readFileSync(sentinel, 'utf8')).toBe(JSON.stringify({ generated: ['meshes/owned.glb'] }));
      else expect(existsSync(target)).toBe(false);
      rmSync(root, { recursive: true, force: true });
    }
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

describe('CLI run-dir regeneration', () => {
  it('runs a fresh smoke dir, then reruns into the same owned dir', () => {
    const repoRoot = process.cwd();
    const relOut = `.scratch/cli-rerun-${process.pid}-${Date.now()}`;
    const out = join(repoRoot, relOut);
    const args = ['tsx', 'scripts/blob-mesh-compare.ts', '--fixtures', 'control-sphere', '--methods', 'surface-nets', '--smoke', '--out', relOut];
    try {
      const first = spawnSync('npx', args, { cwd: repoRoot, encoding: 'utf8' });
      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
      expect(existsSync(join(out, RUN_MARKER))).toBe(true);
      expect(existsSync(join(out, RUN_MANIFEST))).toBe(true);
      const firstManifest = JSON.parse(readFileSync(join(out, RUN_MANIFEST), 'utf8')) as { generated: string[] };
      expect(firstManifest.generated).toContain('results.json');
      expect(existsSync(join(out, 'meshes', 'control-sphere-surface-nets-40mm.glb'))).toBe(true);

      const second = spawnSync('npx', args, { cwd: repoRoot, encoding: 'utf8' });
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
      const secondManifest = JSON.parse(readFileSync(join(out, RUN_MANIFEST), 'utf8')) as { generated: string[] };
      expect(secondManifest.generated.sort()).toEqual(firstManifest.generated.sort());
      expect(existsSync(join(out, 'meshes', 'control-sphere-surface-nets-40mm.glb'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120000);
});
