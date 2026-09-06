import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Dev-server only. No caller-selected filenames, no overwrites. */
export function saveGameplayCapture(root: string, payload: unknown): { ok: true; path: string } {
  const data = payload as Record<string, unknown> | null;
  if (!data || data.schema !== 'blud-gameplay-v1'
    || !Array.isArray(data.frames) || data.frames.length > 18000
    || !Array.isArray(data.events) || data.events.length > 4000
    || !data.metadata || !data.summary) throw new Error('Invalid gameplay capture');
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Capture exceeds 16 MiB');
  const path = `telemetry/gameplay-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
  mkdirSync(join(root, 'telemetry'), { recursive: true });
  writeFileSync(join(root, path), json, { flag: 'wx' });
  return { ok: true, path };
}
