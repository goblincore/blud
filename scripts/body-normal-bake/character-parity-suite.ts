// scripts/body-normal-bake/character-parity-suite.ts
//
// CHARACTER FIELD PARITY (spec 2026-10-24-gpu-body-normal-bake-design.md, Tests 2): every character with a .detail
// file, its DETAIL body (the .blob with the .detail lines folded in, which holds every prim of the plain body too),
// sdBody vs the GPU bake field at points on and around the skin. Split into shards so the slow body builds (gamer:
// ~90 s) run in parallel files: field-characters-{0,1}.gpu.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFromBlob, withDetail } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { compareField, describeParity, FIELD_TOL, parityGpu, samplePoints } from './gpu-parity-lib';

const CH = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/lab/sdf-zombie/characters');
export const SHARDS = 2;
/** Points per character: sdBody costs ~1-7 ms a point on a detail body, so this is the CPU side's budget. */
const POINTS = 1500;

export async function characterParitySuite(shard: number): Promise<void> {
  const gpu = await parityGpu();
  const names = readdirSync(CH).filter(f => f.endsWith('.detail')).map(f => f.slice(0, -'.detail'.length)).sort()
    .filter((_, k) => k % SHARDS === shard);
  describe.skipIf(!gpu)(`bake field vs sdBody, detail bodies, shard ${shard} (${gpu?.adapter})`, () => {
    for (const name of names) {
      it(name, async () => {
        const src = withDetail(readFileSync(resolve(CH, `${name}.blob`), 'utf8'), readFileSync(resolve(CH, `${name}.detail`), 'utf8'), name);
        const body = buildFromBlob(src);
        const r = await compareField(gpu!, body, samplePoints(body, POINTS, 11));
        console.log(`${name} (${body.prims.length} prims): ${describeParity(r)}`);
        expect(r.maxErr, describeParity(r)).toBeLessThanOrEqual(FIELD_TOL);
      }, 600_000);
    }
  });
}
