import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveGameplayCapture } from './lib/game-telemetry-save';

it('writes unique local captures, preserves previous recordings and rejects malformed data', () => {
  const root = mkdtempSync(join(tmpdir(), 'blud-telemetry-'));
  try {
    const payload = { schema: 'blud-gameplay-v1', frames: [], events: [], metadata: { build: 'test' }, summary: {} };
    const a = saveGameplayCapture(root, payload);
    const b = saveGameplayCapture(root, payload);
    expect(a.path).not.toBe(b.path);
    expect(JSON.parse(readFileSync(join(root, a.path), 'utf8'))).toEqual(payload);
    expect(a.path.startsWith('telemetry/')).toBe(true);
    expect(() => saveGameplayCapture(root, { schema: 'other' })).toThrow();
    expect(() => saveGameplayCapture(root, { ...payload, frames: Array(18001).fill({}) })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
