// scripts/derive_blob_angles.mjs
// Prints the exact pitch/tilt for each ZOMBIE_BASE bone, for authoring
// zombie.blob. One-off authoring aid; not part of the build.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lab/sdf-zombie/body.ts', 'utf8');
const re = /\{\s*name:\s*'(\w+)'.*?dir:\s*\[([^\]]+)\]/g;
const DEG = 180 / Math.PI;

for (const m of src.matchAll(re)) {
  const [x, y, z] = m[2].split(',').map(Number);
  const ay = Math.abs(y);

  // Invert dirVector's ACTUAL composition, not an idealised one.
  //
  // dirVector applies pitch first, then tilt. Tilt shrinks |y| by cos(tilt)
  // without touching z, so the resulting ratios are:
  //     x/|y| = tan(tilt)              (exact — tilt preserves its own ratio)
  //     z/|y| = tan(pitch) / cos(tilt) (COUPLED — this is the bit that bites)
  // Deriving pitch as atan2(z, |y|) ignores the cos(tilt) term and leaves a
  // real residual on any bone with both angles set. On the zombie's forearm
  // that is ~1.25e-4 in ratio, which eats a third of Task 5's 0.1 mm budget
  // before the bone chain compounds it.
  const tilt = Math.atan2(x, ay);
  const pitch = Math.atan((z / ay) * Math.cos(tilt));
  const dir = y >= 0 ? 'up' : 'down';
  console.log(
    `${m[1].padEnd(10)} dir=${dir} pitch=${(pitch * DEG).toFixed(6)} tilt=${(tilt * DEG).toFixed(6)}`,
  );
}
