import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dev-server only, for the deterministic demo recorder (stage 3, 2026-09-14).
 *
 *  A `.dem.json` is an INPUT log, so the shape check is deliberately narrow:
 *  version, seed, room, dt and a frames[] of plausible length. A file that
 *  fails here would replay into a different world than it was captured in —
 *  refuse it at the door rather than store something that cannot be trusted.
 *
 *  The filename comes from the RECORDING's own startedAt and room, never from
 *  the caller: `path` is not a parameter, so a page cannot choose where on disk
 *  to write. `wx` means an existing file is never silently overwritten. */
export function saveDemo(root: string, payload: unknown): { ok: true; path: string } {
  const data = payload as Record<string, unknown> | null;
  if (!data || data.version !== 1 || !Array.isArray(data.frames)
    || data.frames.length > 200_000 || typeof data.seed !== 'number'
    || !Number.isFinite(data.dt) || (data.dt as number) <= 0) {
    throw new Error('Invalid demo file');
  }
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Demo exceeds 16 MiB');
  const stamp = String(data.startedAt ?? new Date().toISOString())
    .replace(/[:.]/g, '-').replace(/[^0-9A-Za-z-]/g, '');
  const room = Number.isFinite(data.room) ? `room${String(data.room)}` : 'room0';
  const path = `docs/dev-notes/demos/${stamp}-${room}.dem.json`;
  mkdirSync(join(root, 'docs/dev-notes/demos'), { recursive: true });
  writeFileSync(join(root, path), json, { flag: 'wx' });
  return { ok: true, path };
}
