import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readNormalGates, writeNormalGates } from './normal-gradient-gates.mjs';

test('readNormalGates supplies the versioned pending gate document when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'normal-gradient-gates-'));
  try {
    const gates = await readNormalGates(join(dir, 'gates.json'));
    assert.deepEqual(gates, {
      version: 1,
      reference: 'pending', gpuKernel: 'pending', intact: 'pending', wounds: 'pending',
      visualEvidence: 'pending', timing: 'pending', ownerLook: 'pending', evidence: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeNormalGates atomically replaces the document while preserving unrelated fields and evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'normal-gradient-gates-'));
  const path = join(dir, 'gates.json');
  try {
    await writeFile(path, JSON.stringify({
      version: 1,
      reference: 'pending', gpuKernel: 'pending', intact: 'pending', wounds: 'pending',
      visualEvidence: 'pending', timing: 'pending', ownerLook: 'pending',
      evidence: [{ commit: 'base', command: 'old', artifact: 'old.json', reason: 'baseline' }],
      futureGate: 'keep-me',
    }));
    const evidence = {
      commit: 'working-tree',
      command: 'npx vitest run src/lab/sdf-zombie/webgpu/normal-gradient-reference.test.ts',
      artifact: 'notes.md',
      reason: 'reference checks passed',
    };
    const updated = await writeNormalGates(path, { reference: 'pass' }, evidence);
    assert.equal(updated.reference, 'pass');
    assert.equal(updated.gpuKernel, 'pending');
    assert.equal(updated.futureGate, 'keep-me');
    assert.deepEqual(updated.evidence, [
      { commit: 'base', command: 'old', artifact: 'old.json', reason: 'baseline' },
      evidence,
    ]);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), updated);
    assert.deepEqual((await readdir(dir)).sort(), ['gates.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
