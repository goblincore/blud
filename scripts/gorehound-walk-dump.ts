// Walks the gorehound through the real motion pipeline (as gorehound-blob.test.ts does) and writes every rig
// point per frame as JSON, for scripts/gorehound-gait-strip.py's side-view stick strips. No GPU.
//
//   npx tsx scripts/gorehound-walk-dump.ts .lab-tmp/gh-walk.json [frames] [attack: bite|pounce]
//
// With an attack named, the body halts at frame 90 and swings it once (phase over the variant's swingSec).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { GOREHOUND_PROFILE } from '../src/lab/sdf-zombie/motion-profile';
import { HOUND_TUNING, type HoundVariant } from '../src/lab/sdf-zombie/hound-attack';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../src/lab/sdf-zombie/actor';
import { makeRng } from '../src/lab/sdf-zombie/wander';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const out = process.argv[2] ?? '.lab-tmp/gh-walk.json';
const n = Number(process.argv[3] ?? 360);
const variant = process.argv[4] as HoundVariant | undefined;
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/gorehound.blob', 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
const m = makeActorMotion(body, { seed: 7 });
const J = m.motionJoints!.index;
const rng = makeRng(7);
const frames: Record<string, Vec3>[] = [];
const swingSec = variant ? HOUND_TUNING.brain.swingSecFor?.[variant] ?? HOUND_TUNING.brain.swingSec : 0;
for (let i = 0; i < n; i++) {
  const t = (i - 90) / 60;
  const attack = variant && i >= 90 && t < swingSec ? { phase: t / swingSec, side: 'R' as const, variant } : undefined;
  stepActorMotion(m, {
    current: body, dt: 1 / 60, wander: !attack && !(variant && i >= 90), armStyle: undefined,
    headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    rng, signals: emptyActorSignals(), profile: GOREHOUND_PROFILE, forceSpeed: GOREHOUND_PROFILE.cruise,
    ...(attack ? { attack } : {}),
  });
  const f: Record<string, Vec3> = {};
  for (const [name, k] of Object.entries(J)) f[name] = [...m.bound.rig.points[k]!.pos] as Vec3;
  frames.push(f);
}
writeFileSync(out, JSON.stringify(frames));
console.log(`${frames.length} frames -> ${out}`);
