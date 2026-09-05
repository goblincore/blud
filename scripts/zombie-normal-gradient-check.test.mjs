import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const driver = join(repo, 'scripts/zombie-normal-gradient-check.mjs');

test('verdict writes an offline incomplete summary and exits nonzero when prerequisites are missing', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'zombie-ng-verdict-'));
  const evidenceDir = join(fixture, 'docs/dev-notes/2026-09-05-zombie-analytic-normals');
  const outDir = join(fixture, 'out');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'gates.json'), `${JSON.stringify({
    version: 1,
    reference: 'pass',
    gpuKernel: 'pass',
    intact: 'deferred',
    wounds: 'pending',
    visualEvidence: 'pending',
    timing: 'pending',
    ownerLook: 'pending',
    evidence: [{ commit: 'prior', command: 'kernel', artifact: 'kernel.json', reason: 'passed' }],
  }, null, 2)}\n`);

  const result = spawnSync(process.execPath, [driver, '--phase', 'verdict', '--out', outDir, '--vite', '1', '--cdp', '1'], {
    cwd: fixture,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VERDICT INCOMPLETE/);
  assert.doesNotMatch(result.stderr, /fetch failed|ECONNREFUSED/);

  const summary = JSON.parse(readFileSync(join(outDir, 'summary.json'), 'utf8'));
  assert.deepEqual(Object.keys(summary), ['commit', 'gates', 'scenes', 'timings', 'coverage', 'artifacts', 'conclusion']);
  assert.equal(summary.commit, execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
  assert.equal(summary.conclusion, 'incomplete');
  assert.equal(summary.gates.reference, 'pass');
  assert.equal(summary.gates.gpuKernel, 'pass');
  assert.equal(summary.gates.intact, 'deferred');
  assert.equal(summary.gates.wounds, 'skipped-by-gate');
  assert.equal(summary.gates.visualEvidence, 'skipped-by-gate');
  assert.equal(summary.gates.timing, 'skipped-by-gate');
  assert.equal(summary.gates.ownerLook, 'pending');
  assert.equal(summary.timings.measurements, null);
  assert.equal(summary.coverage.measurements, null);
  assert.deepEqual(summary.artifacts.images, []);
  assert.equal(summary.artifacts.reel, null);

  const gates = JSON.parse(readFileSync(join(evidenceDir, 'gates.json'), 'utf8'));
  assert.equal(gates.reference, 'pass');
  assert.equal(gates.gpuKernel, 'pass');
  assert.equal(gates.intact, 'deferred');
  assert.equal(gates.wounds, 'skipped-by-gate');
  assert.equal(gates.visualEvidence, 'skipped-by-gate');
  assert.equal(gates.timing, 'skipped-by-gate');
  assert.equal(gates.ownerLook, 'pending');
  assert.equal(gates.evidence.length, 2);
  assert.match(gates.evidence[1].reason, /zero real gameplay GPU samples/i);
});
