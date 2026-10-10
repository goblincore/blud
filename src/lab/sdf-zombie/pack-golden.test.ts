// src/lab/sdf-zombie/pack-golden.test.ts
//
// BYTE PIN for packBody (CPU pass, 2026-09-25). The hero re-packs every body
// every frame, so the packer gets optimised; this pins its output bytes for
// every shipped character — rest, two rig phases, a severed limb, and all
// three bone-cull modes — as a snapshot of the pre-optimisation packer's hashes.
// A packer change that moves a snapshot changed the packed rows: that is a
// render change, not a refactor. An intended .blob content edit legitimately
// moves its character's hash; re-pin with `npx vitest run -u <this file>`.
import { describe, it, expect } from 'vitest';
// @ts-expect-error the app tsconfig has no @types/node, so node:crypto is untyped here.
import { createHash } from 'node:crypto';
import { packBody } from './pack';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { bindRig, applyRig } from './rig-bind';
import { severLimb } from './sever';

const CHARACTERS_RAW = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function packHash(src: string): string {
  const h = createHash('sha256');
  const rest = buildBody(compileBlob(parseBlob(src)));
  const rig = bindRig(rest);
  const bodies = [rest, applyRig(rest, rig, 0.7), applyRig(rest, rig, 1.9)];
  bodies.push(severLimb(bodies[1]!, 'armL').body);
  let scratch: ReturnType<typeof packBody> | undefined;
  for (const body of bodies) {
    for (const boneCullMode of ['off', 'cluster', 'segment'] as const) {
      scratch = packBody(body, rest, { boneCullMode }, scratch);
      for (const [k, v] of Object.entries(scratch).sort(([a], [b]) => a.localeCompare(b))) {
        h.update(k);
        if (v instanceof Float32Array) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        else h.update(String(v));
      }
    }
  }
  return h.digest('hex').slice(0, 16);
}

// The hashes are of raw float bytes, and they were recorded on darwin/arm64.
// On CI's linux/x64 every character hashes differently (first CI run,
// 2026-10-07), so the pin only holds where it was recorded: it runs there and
// is skipped elsewhere. It is NOT covered by CI; `npm run test:changed` runs it
// when pack.ts changes.
const proc = (globalThis as { process?: { platform: string; arch: string } }).process;
const PINNED_HERE = proc?.platform === 'darwin' && proc.arch === 'arm64';

describe.skipIf(!PINNED_HERE)('packBody byte pin', () => {
  for (const [path, src] of Object.entries(CHARACTERS_RAW)) {
    const name = path.split('/').pop()!;
    it(`${name} packs the pinned bytes`, () => {
      expect(packHash(src)).toMatchSnapshot();
    });
  }
});
