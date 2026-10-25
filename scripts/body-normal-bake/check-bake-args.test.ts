// scripts/body-normal-bake/check-bake-args.test.ts
//
// bake-args.json reproduces each committed sidecar's region table (labels, kinds, rows, and head/tail/rMax to the
// sidecar's 4 decimals), and every committed map has an entry. A re-bake from these arguments therefore bakes the
// same regions the shipped map was baked with.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromBlob, buildRegions } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { sidecar } from '../../src/lab/sdf-zombie/body-normal-bake/header';
import { committedBakes } from './bake-args';

const LAB = 'public/assets/lab', CH = 'src/lab/sdf-zombie/characters';
const bakes = committedBakes();

describe('bake-args.json', () => {
  it('has an entry for every committed body normal map', () => {
    const maps = readdirSync(LAB).filter(f => f.endsWith('-body-n.json')).map(f => f.slice(0, -'-body-n.json'.length)).sort();
    expect([...bakes.keys()].sort()).toEqual(maps);
  });
  for (const [name, args] of bakes) {
    it(`${name} reproduces its committed region table`, () => {
      expect(existsSync(`${CH}/${name}.detail`)).toBe(true);
      const base = buildFromBlob(readFileSync(`${CH}/${name}.blob`, 'utf8'));
      const { regions, height } = buildRegions(base, args.regions);
      const want = JSON.parse(readFileSync(`${LAB}/${name}-body-n.json`, 'utf8'));
      const got = sidecar(name, args.width, height, regions);
      const { backend: _b, adapter: _a, ...table } = want;
      expect({ ...got, generator: want.generator }).toEqual(table);
    }, 120_000);
  }
});
