// scripts/goblin-head-profile.ts
//
//   npx tsx scripts/goblin-head-profile.ts                                                   # the base goblin.blob
//   npx tsx scripts/goblin-head-profile.ts src/lab/sdf-zombie/characters/goblin-cinematic.blob # the cinematic goblin
//   npx tsx scripts/goblin-head-profile.ts path.blob [--probes goblin|goblin-cinematic]       # a candidate
//
// Prints each pinned head-profile probe (characters/goblin-head-profile.ts) beside what the .blob measures now, and exits 1 if
// any is outside PROFILE_TOL. This is the tuning loop for the jaw split: edit the .blob, rerun, repeat until it is green.
// The probe set follows the file's `model` line (goblin-cinematic gets its own, the Task 3b mouth re-pin; anything else gets the
// base goblin's original pins, Task 13); `--probes` overrides it.
import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { measureProfile, profileProbesFor, PROFILE_TOL } from '../src/lab/sdf-zombie/characters/goblin-head-profile';

const args = process.argv.slice(2);
const flag = args.indexOf('--probes');
const forced = flag >= 0 ? args.splice(flag, 2)[1] : undefined;
const path = args[0] ?? 'src/lab/sdf-zombie/characters/goblin.blob';
const text = readFileSync(path, 'utf8');
const model = forced ?? /^model\s+(\S+)/m.exec(text)?.[1] ?? 'goblin';
const doc = parseBlob(text);
const body = buildBody(compileBlob(doc, compileFace(doc)));
console.log(`${path}: ${model === 'goblin-cinematic' ? 'goblin-cinematic' : 'goblin (base)'} probes`);
let bad = 0;
for (const { probe, got } of measureProfile(body, profileProbesFor(model))) {
  const d = got - probe.want;
  const ok = Number.isFinite(got) && Math.abs(d) <= PROFILE_TOL;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${probe.name.padEnd(24)} want ${probe.want.toFixed(4)}  got ${got.toFixed(4)}  (${(d * 1000).toFixed(1)} mm)`);
}
if (body.errors.length > 0) { console.log('build errors:', body.errors); bad++; }
process.exit(bad === 0 ? 0 : 1);
