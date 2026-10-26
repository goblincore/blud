// src/lab/sdf-zombie/webgpu/bench-cloth.ts
//
// THE SDF-CLOTH COST SPIKE (2026-10-26, docs/dev-notes/2026-10-26-sdf-cloth-cost/). The zombie wearing the
// candidate garments, as TEXT edits of zombie.blob, so the bench measures the crowd enemy's own body with
// only the cloth changed (`sdf-bench.html?scene=CZ&cloth=<variant>`). Bench-only: nothing ships these.
//
//   paint      the labourer trousers as PR #82 ships them: color= on the thigh and shin bars and the pelvis
//              mass. No prim is added; the reference for "what the march pays for no cloth".
//   offset     cloth as an OFFSET of the flesh it covers (lever b): paint plus the covered bars' radius grown
//              by the cloth's stand-off. Still no prim added.
//   trousers   real SDF trousers: the painted legs plus five shells (a seat over the pelvis, a tube per thigh,
//              a tube per shin open at the ankle).
//   robe       the cultist's skirt (on a `hem` pendulum) and capelet on the zombie, legs painted.
//   robe-flat  the same robe with no `warp=` folds (lever d: a cheaper sheet).

export type ClothVariant = 'paint' | 'offset' | 'trousers' | 'robe' | 'robe-flat';
export const CLOTH_VARIANTS: readonly ClothVariant[] = ['paint', 'offset', 'trousers', 'robe', 'robe-flat'];

/** Trouser cloth colour (the labourer brown of PR #82's paint). */
const CLOTH = '3a3428';
/** The cloth's stand-off from the flesh it covers, metres. */
const STANDOFF = 0.012;

const THIGH = /^(\s*bar\s+leg on thigh .*?)r=([0-9.]+)(.*)$/m;
const SHIN = /^(\s*bar\s+leg on shin\s+from=0\.05 .*?)r=([0-9.]+)(.*)$/m;
const PELVIS = /^(\s*blob torso on pelvis at=0\.40 .*)$/m;

function must(src: string, re: RegExp, what: string): RegExpMatchArray {
  const m = src.match(re);
  if (!m) throw new Error(`bench-cloth: zombie.blob has no ${what} line (${re})`);
  return m;
}

/** Paints a matched line, and grows its r= by `grow` when given. */
function paintLine(src: string, re: RegExp, what: string, grow = 0): string {
  const m = must(src, re, what);
  if (m.length === 2) return src.replace(re, `$1 color=${CLOTH}`);
  const r = (Number(m[2]) + grow).toFixed(4);
  return src.replace(re, `${m[1]}r=${r}${m[3]} color=${CLOTH}`);
}

/** Lines appended to the body block (before `bones`). */
const SHELLS: Record<'trousers' | 'robe' | 'robe-flat', string[]> = {
  trousers: [
    // Seat: the pelvis mass's ellipsoid, grown by the stand-off, cut off at the waist.
    `  shell torso on pelvis at=0.40 r=${(0.145 + STANDOFF).toFixed(3)} wide=1.10 tall=0.9 deep=0.92 thick=0.006 clip=(0,1,0) clipd=0.98 rim=0.006 blend=0.010 color=${CLOTH}`,
    // Thigh tubes: closed (the clip plane is far off), they meet the seat and the shin tube inside cloth.
    `  shell leg on thigh at=0.02 tip=(0,-0.44,0) r=${(0.082 + STANDOFF).toFixed(3)} thick=0.006 clip=(0,1,0) clipd=9 rim=0.006 blend=0.010 mirror color=${CLOTH}`,
    // Shin tubes, open at the ankle (the plane keeps y > 0.16).
    `  shell leg on shin at=0.0 tip=(0,-0.475,0.02) r=${(0.070 + STANDOFF).toFixed(3)} thick=0.006 clip=(0,-1,0) clipd=-0.16 rim=0.006 blend=0.010 mirror color=${CLOTH}`,
  ],
  // The cultist's own skirt and capelet lines (cultist.blob), on the zombie's bones.
  robe: [
    `  shell torso on hem at=0.0 offset=(0,0.040,0) r=0.150 r2=0.320 tip=(0,-0.82,0.02) wide=1.06 deep=1.00 thick=0.008 clip=(0,-1,0) clipd=-0.20 rim=0.008 blend=0.010 color=6e5c40 warp=0.010 warpFreq=(22,4,22) rigid`,
    `  shell torso on spine at=1.00 offset=(0,0.045,-0.025) tip=(0,-0.25,0.02) r=0.080 r2=0.285 wide=1.12 deep=0.84 thick=0.008 clip=(0,-1,0) clipd=-1.20 rim=0.008 blend=0.010 color=6e5c40 warp=0.006 warpFreq=(30,6,30) rigid`,
  ],
  'robe-flat': [],
};
SHELLS['robe-flat'] = SHELLS.robe.map(l => l.replace(/ warp=\S+ warpFreq=\S+/, ''));

/** zombie.blob source -> the same body wearing `variant`. Throws when an anchor line moved. */
export function clothVariantSrc(zombieSrc: string, variant: ClothVariant): string {
  let src = zombieSrc;
  const grow = variant === 'offset' ? STANDOFF : 0;
  src = paintLine(src, THIGH, 'thigh bar', grow);
  src = paintLine(src, SHIN, 'shin bar', grow);
  src = paintLine(src, PELVIS, 'pelvis mass');
  if (variant === 'paint' || variant === 'offset') return src;
  if (variant !== 'trousers') {
    // The skirt rides a pendulum off the hips, as the cultist's does (its tail stays above the feet).
    src = src.replace(/^(\s*root pelvis .*)$/m, '$1\n  bone hem parent=pelvis dir=down len=0.55');
    if (!src.includes('bone hem')) throw new Error('bench-cloth: zombie.blob has no `root pelvis` line');
  }
  const at = src.search(/^bones\s*$/m);
  if (at < 0) throw new Error('bench-cloth: zombie.blob has no `bones` block');
  return `${src.slice(0, at)}${SHELLS[variant].join('\n')}\n\n${src.slice(at)}`;
}

/**
 * `?cloth=<variant>` on the game page: dresses the registry's zombie entry before anything spawns (every reader
 * parses `entry.src` lazily). Returns the variant, or null when the query has none. Throws on an unknown one.
 */
export function applyClothQuery(search: string, zombie: { src: string }): ClothVariant | null {
  const v = new URLSearchParams(search).get('cloth');
  if (v === null) return null;
  if (!CLOTH_VARIANTS.includes(v as ClothVariant)) throw new Error(`?cloth=${v}: not one of ${CLOTH_VARIANTS.join('|')}`);
  zombie.src = clothVariantSrc(zombie.src, v as ClothVariant);
  return v as ClothVariant;
}
