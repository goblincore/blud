// scripts/body-normal-bake/bake-args.ts
//
// bake-args.json, parsed the way scripts/bake-body-normal.ts parses its argv: the command that bakes each committed
// body normal map. Shared by the re-bake (rebake-all.ts) and the check that the arguments still match the committed
// sidecars (check-bake-args.ts).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegionArgs } from '../../src/lab/sdf-zombie/body-normal-bake/regions';

export interface BakeArgs { width: number; regions: RegionArgs; argv: string[] }

/** Parse a bake-body-normal.ts argument list (after the character name). */
export function parseBakeArgv(argv: string[]): BakeArgs {
  const limbs: string[] = [], torsoSegs: string[] = [], pos: string[] = [];
  let torsoAxis: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limb') limbs.push(argv[++i]!);
    else if (argv[i] === '--torso-axis') torsoAxis = argv[++i]!;
    else if (argv[i] === '--torso-seg') torsoSegs.push(argv[++i]!);
    else if (!argv[i]!.startsWith('--')) pos.push(argv[i]!);
  }
  return { width: Number(pos[0] ?? 512), regions: { torsoRows: Number(pos[1] ?? 256), torsoAxis, limbs, torsoSegs }, argv };
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'bake-args.json');
/** Every character with a committed map, and its bake arguments. */
export function committedBakes(): Map<string, BakeArgs> {
  const json = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string[] | string>;
  return new Map(Object.entries(json).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, parseBakeArgv(v as string[])]));
}
