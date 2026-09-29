// src/lab/sdf-zombie/webgpu/march/body/blocks/light/skin-detail-proto.ts
//
// SKIN DETAIL (owner 2026-09-27: "bring back some detail and contrast to the zombie and soldier
// skin ... the bumps get really washed out with the flashlight"; 2026-09-28: "set k 2 for zombie
// and soldier and I'll take a look in game"; then zombie off, soldier 1).
//
// DETAIL-PRESERVING COMPRESSION, per body: the highlight shoulder compresses the body as if it
// were smooth (fleshLit / r, r = the dominant light's diffuse on the bumped normal over the smooth
// normal's), then multiplies r^k back on, so the bumps keep (k 1) or gain (k 2) contrast where the
// compression flattened them. k is per instance in meltCfg.z (gInstMelt.z, view.setSkinDetail),
// set per character from SKIN_DETAIL_BY_CHARACTER; 0 skips the term.
//
// A/B knobs, read from the URL at shader build: ?skinDetail=k overrides every body's k;
// ?skinCavity=c (PROTOTYPE, not adopted: the 20 cm shell lumps read as grey blotches, not pores)
// darkens where the shell noise pushes the skin in.

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const num = (k: string): number | null => {
  const raw = q?.get(k);
  if (raw == null) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const DETAIL_OVERRIDE = num('skinDetail');
const SKIN_CAVITY = num('skinCavity') ?? 0;
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Per-character skin detail k; absent = 0 (off). Owner 2026-09-28: tried zombie and soldier at 2,
 *  then "looks really weird with the flashlight on at medium distances" on the zombie: zombie off,
 *  soldier 1 (body and arms show it, subtly). To revisit. */
export const SKIN_DETAIL_BY_CHARACTER: Readonly<Record<string, number>> = { soldier: 1 };
export function skinDetailFor(name: string): number {
  return SKIN_DETAIL_BY_CHARACTER[name] ?? 0;
}

/** The body's k in WGSL: the URL override, or its instance lane. */
const K = DETAIL_OVERRIDE === null ? 'gInstMelt.z' : f(DETAIL_OVERRIDE);

/** After the shading normal: the smooth (no micro-detail) normal and the shell-noise height. */
export const SKIN_NORMAL = `
  // SKIN DETAIL (skin-detail-proto.ts): the smooth normal, before the micro-detail.
  var nSmooth = n;
  if (ngValid) { nSmooth = normalize(ng0); }
  let skinNoiseOn = select(0.0, 1.0, marchCfg.z > 0.0) * (1.0 - max(gloss, metal));${SKIN_CAVITY > 0 ? `
  let skinH = fbm(anchor * 3.0);` : ''}`;

/** Before the shoulder: divide the bump ratio out (k 0: r is 1, nothing moves). */
export const SKIN_PRE = `
  // SKIN DETAIL: compress the smooth body, restore the bumps after the shoulder.
  let skinK = ${K};
  var skinR = 1.0;
  if (skinK > 0.0) {
    var diffS = max(dot(nSmooth, L), 0.0);
    if (lightListCfg.x > 0.0) { diffS = max((dot(nSmooth, Lk) + listDomFloor) / (1.0 + listDomFloor), 0.0); }
    skinR = mix(1.0, clamp((diff + 0.05) / (diffS + 0.05), 0.4, 1.6), skinNoiseOn);
    fleshLit = fleshLit / skinR;
  }`;

/** After the shoulder: restore the bumps (r^k) and, prototype only, darken the pits. */
export const SKIN_POST = `
  if (skinK > 0.0) { fleshLit = fleshLit * pow(skinR, skinK); }${SKIN_CAVITY > 0 ? `
  fleshLit = fleshLit * (1.0 - ${f(SKIN_CAVITY)} * skinNoiseOn * smoothstep(0.05, 0.6, skinH));` : ''}`;
