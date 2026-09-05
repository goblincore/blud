import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const EMPTY_GATES = Object.freeze({
  version: 1,
  reference: 'pending',
  gpuKernel: 'pending',
  intact: 'pending',
  wounds: 'pending',
  visualEvidence: 'pending',
  timing: 'pending',
  ownerLook: 'pending',
  evidence: Object.freeze([]),
});

export async function readNormalGates(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { ...EMPTY_GATES, evidence: [] };
  }
}

export async function writeNormalGates(path, patch, evidence) {
  const current = await readNormalGates(path);
  const updated = {
    ...current,
    ...patch,
    evidence: [...(Array.isArray(current.evidence) ? current.evidence : []), evidence],
  };
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temp, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return updated;
}
