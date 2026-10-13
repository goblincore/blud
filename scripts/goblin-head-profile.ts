// scripts/goblin-head-profile.ts
//
//   npx tsx scripts/goblin-head-profile.ts            # the committed goblin.blob
//   npx tsx scripts/goblin-head-profile.ts path.blob  # a candidate
//
// Prints each pinned head-profile probe (characters/goblin-head-profile.ts) beside what the .blob measures now, and exits 1 if
// any is outside PROFILE_TOL. This is the tuning loop for the jaw split: edit goblin.blob, rerun, repeat until it is green.
import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { measureProfile, PROFILE_TOL } from '../src/lab/sdf-zombie/characters/goblin-head-profile';

const path = process.argv[2] ?? 'src/lab/sdf-zombie/characters/goblin.blob';
const doc = parseBlob(readFileSync(path, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
let bad = 0;
for (const { probe, got } of measureProfile(body)) {
  const d = got - probe.want;
  const ok = Number.isFinite(got) && Math.abs(d) <= PROFILE_TOL;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${probe.name.padEnd(24)} want ${probe.want.toFixed(4)}  got ${got.toFixed(4)}  (${(d * 1000).toFixed(1)} mm)`);
}
if (body.errors.length > 0) { console.log('build errors:', body.errors); bad++; }
process.exit(bad === 0 ? 0 : 1);
