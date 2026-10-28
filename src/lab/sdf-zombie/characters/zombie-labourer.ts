// src/lab/sdf-zombie/characters/zombie-labourer.ts
//
// The rotting labourer's TROUSERS AS SDF CLOTH (owner, 2026-10-27: try real cloth over the painted legs before going to
// machine legs). zombie.blob stays the plain zombie, because it is the fixture body that a hundred tests pin; the game's
// zombie wears this: zombie.blob with one marked block of `shell` cloth spliced in before `bones`.
//
// Five shells, the cloth-cost spike's recipe (docs/dev-notes/2026-10-26-sdf-cloth-cost/: 1.16x a bare zombie in the
// arena, 1.44x close up): a seat over the pelvis mass, a tube per thigh, a tube per shin open at the ankle. They stand
// 12 mm off the flesh, which stays painted the same denim, so a limb pushing into the sheet reads as cloth, and a hole
// through it shows a wound, not pink skin.
import zombieSrc from './zombie.blob?raw';

export const TROUSERS_BEGIN = '  # --- labourer trousers begin ---';
export const TROUSERS_END = '  # --- labourer trousers end ---';

/** Worn grey-blue work denim, sRGB: the same as zombie.blob's painted legs. */
const DENIM = '4a5568';
/** The sheet's stand-off from the flesh it covers, metres. */
const STANDOFF = 0.012;
/** The trouser leg's radius at the knee, where the thigh tube hands over to the shin tube: the thigh flesh is r 0.082 right down to it. */
const KNEE = 0.082 + STANDOFF;

const TROUSERS = [
  TROUSERS_BEGIN,
  // Seat: the pelvis mass's ellipsoid grown by the stand-off, cut at the waist under the kit belt (y 1.025-1.065).
  `  shell torso on pelvis at=0.40 r=${(0.145 + STANDOFF).toFixed(3)} wide=1.10 tall=0.9 deep=0.92 thick=0.006 clip=(0,1,0) clipd=1.05 rim=0.006 blend=0.010 color=${DENIM} warp=0.003 warpFreq=(30,8,30)`,
  // Thigh tubes, closed: they meet the seat and the shin tube inside cloth. Each TAPERS to the knee and the shin tube
  // starts at that same radius, so the leg is one straight trouser leg, not a thigh tube stepping down to a shin tube.
  `  shell leg on thigh at=0.02 tip=(0,-0.44,0) r=${(0.082 + STANDOFF).toFixed(3)} r2=${KNEE.toFixed(3)} thick=0.006 clip=(0,1,0) clipd=9 rim=0.006 blend=0.020 mirror color=${DENIM} warp=0.007 warpFreq=(24,5,24)`,
  // Shin tubes, TUCKED INTO THE BOOTS: open at the ankle end, the clip keeping y > 0.235, a centimetre inside the kit
  // boot's shaft (its rolled cuff at shin 0.70, y 0.25), so the hem never fights the boot for the same skin.
  `  shell leg on shin at=0.0 tip=(0,-0.475,0.02) r=${KNEE.toFixed(3)} r2=${(0.062 + STANDOFF).toFixed(3)} thick=0.006 clip=(0,-1,0) clipd=-0.235 rim=0.006 blend=0.020 mirror color=${DENIM} warp=0.006 warpFreq=(24,6,24)`,
  TROUSERS_END,
];

/** zombie.blob source -> the labourer: the shin flesh painted under the cloth, and the trousers block before `bones`. */
export function labourerSrc(src: string): string {
  const shin = /^(\s*bar\s+leg on shin\s+from=0\.05 [^\n#]*?)(\s*)$/m;
  if (!shin.test(src)) throw new Error('zombie-labourer: zombie.blob has no shin bar line');
  const painted = src.replace(shin, `$1 color=${DENIM} fabric$2`);
  const at = painted.search(/^bones\s*$/m);
  if (at < 0) throw new Error('zombie-labourer: zombie.blob has no `bones` block');
  return `${painted.slice(0, at)}${TROUSERS.join('\n')}\n\n${painted.slice(at)}`;
}

export const ZOMBIE_LABOURER_SRC = labourerSrc(zombieSrc);
