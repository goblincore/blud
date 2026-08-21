// scripts/derive_blob_angles.mjs
// Prints the exact pitch/tilt for each ZOMBIE_BASE bone whose dir is an
// `up`/`down` base, for authoring zombie.blob. One-off authoring aid; not
// part of the build.
//
// LIMITS — read before porting the next character with this:
//   - Only `up`/`down` bases are derivable this way. `dirVector`'s pitch/tilt
//     convention is defined relative to a vertical (y) base component; a
//     `side` or `fwd` bone (e.g. the zombie's clavicle, dir: [1, 0, 0]) has
//     no such component, so the inversion below is meaningless for it. Those
//     bones must be hand-written in .blob with the matching `dir=` and no
//     pitch/tilt (or a pitch/tilt derived by hand, if the source really does
//     use one — this script has no branch for that case). This script
//     detects the ay === 0 case and labels it "not derivable" rather than
//     printing pitch=NaN.
//   - The root bone (bones[0], the one with `parent: null`) is never written
//     as a `bone` line in .blob — `compileBlob` hardcodes its dir/length —
//     so its line is skipped rather than printed as noise to ignore.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lab/sdf-zombie/body.ts', 'utf8');
const re = /\{\s*name:\s*'(\w+)',\s*parent:\s*(null|'[^']*'),.*?dir:\s*\[([^\]]+)\]/g;
const DEG = 180 / Math.PI;

for (const m of src.matchAll(re)) {
  const [name, parent, dirRaw] = [m[1], m[2], m[3]];
  if (parent === 'null') continue; // root bone — hardcoded by compileBlob, not written in .blob

  const [x, y, z] = dirRaw.split(',').map(Number);
  const ay = Math.abs(y);

  if (ay === 0) {
    console.log(`${name.padEnd(10)} dir=[${dirRaw}] -- not derivable (side/fwd base): hand-write dir= with no pitch/tilt`);
    continue;
  }

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
    `${name.padEnd(10)} dir=${dir} pitch=${(pitch * DEG).toFixed(6)} tilt=${(tilt * DEG).toFixed(6)}`,
  );
}
