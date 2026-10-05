// src/lab/sdf-zombie/webgpu/march/body/blocks/light/split-glisten.wgsl.ts
//
// THE OPENED HEAD GLISTENS (the head split; head-split.ts SPLIT_SHADE.glisten holds its numbers). One block, spliced
// into COMPOSE_BLOCK (compose.wgsl.ts) right after the light list's add and before the highlight shoulder, so what it
// adds is compressed with the rest and cannot clip. What it has in hand: splitIn, splitQ (split-hit.wgsl.ts), the one
// wound mask wm (raised on a cut face: wound-masks.wgsl.ts), cutKeep (cut-face.wgsl.ts), the face sheet's cover
// (face.wgsl.ts), the rest anchor, the analytic flashlight's uniforms, and the light tail's key (keyC, keyI, H, as the
// light list left them), V, shadows (wShadow, lvl) and ao.
//
// It adds highlights only. The albedo, the diffuse light, the wetness (wet.wgsl.ts) and the shading normal are not
// touched, and nothing before the splice reads what it declares.
//
// The legacy light tail only: the deferred surface entry has no highlight of its own to carry it.
import { SPLIT_SHADE } from '../../../../../head-split';

/** A number as a WGSL float literal (the cells' reciprocals rounded to the micro: 1 / 0.012 has no short decimal). */
const f = (v0: number) => { const v = +v0.toFixed(6); return Number.isInteger(v) ? `${v}.0` : `${v}`; };

/** SPLIT_SHADE.glisten's fields, any numbers. */
type Glisten = { readonly [K in keyof typeof SPLIT_SHADE.glisten]: number };

/** The block for a set of numbers. gain 0 writes NOTHING: the shader is then the one without the film, to the byte. */
export const splitGlistenBlock = (G: Glisten = SPLIT_SHADE.glisten): string => (G.gain > 0 ? /* wgsl */ `
  // THE OPENED HEAD GLISTENS (head-split.ts SPLIT_SHADE.glisten). The raw surfaces of an OPEN split, the pit the
  // face cuts carve and the flat caps around it (wm covers both), carry a wet film that catches the torch, or with
  // the torch off the lamp that keys the body, as tight highlights. Everything is behind splitIn: a closed body,
  // and a hit outside an open head's region sphere, run none of it.
  if (splitIn) {
    // One march texel at the hit, in metres (the body grain's measure). An octave of the film's noise fades out as
    // its cell nears it, where it would crawl, and the whole film with the coarse one.
    let glisPix = max(2.0 * t * aaCfg.x, 1e-6);
    // Raw flesh: the wound mask past its faint reach over the skin, and not under the face sheet, which hides a
    // wound's colour where the face cut's footprint crosses the face. Not the look block's non-flesh share, not char;
    // bone as the wetness takes it. It fades out over the last stretch of the region sphere: no seam at its boundary.
    let glisRaw = smoothstep(${f(G.rawLo)}, ${f(G.rawHi)}, wm) * (1.0 - faceSheetCover) * (1.0 - cutKeep) * (1.0 - cm) * select(1.0, 0.25, isBone)
                * smoothstep(${f(G.fadeLo)}, ${f(G.fadeHi)}, ${f(G.lump)} / glisPix)
                * (1.0 - smoothstep(gInstSplitR.x - ${f(G.edge)}, gInstSplitR.x, length(p - gInstSplitH.xyz)));
    if (glisRaw > 0.0) {
      // THE FILM'S NORMAL: the shading normal tilted by two octaves of noise of the REST anchor (the hit piece's
      // un-warped point in rest space: the pattern rides its half and nothing swims), turned out to the world with
      // a turned half.
      let glisA = anchor * ${f(1 / G.lump)};
      let glisB = anchor * ${f(1 / G.fine)};
      // The coarse octave is pushed off zero (v / (|v| + lumpFlat)): value noise sits mostly near zero, which would
      // leave the film nearly flat, a mirror that fires all at once when it faces the light and not at all otherwise.
      let glisLump = vec3<f32>(noise3(glisA), noise3(glisA + 5.0), noise3(glisA + 11.0));
      var glisTilt = glisLump / (abs(glisLump) + vec3<f32>(${f(G.lumpFlat)})) * ${f(G.lumpTilt)}
                   + vec3<f32>(noise3(glisB + 17.0), noise3(glisB + 23.0), noise3(glisB + 31.0))
                     * (${f(G.fineTilt)} * smoothstep(${f(G.fadeLo)}, ${f(G.fadeHi)}, ${f(G.fine)} / glisPix));
      if (splitTheta != 0.0) { glisTilt = qRot(splitQ, glisTilt); }
      let glisN = normalize(n + glisTilt);
      var glis = vec3<f32>(0.0);
      // THE TORCH, from its own place (the analytic flashlight's uniforms). A wet film mirrors the lamp itself, and
      // it sees the lamp from outside the beam's cone: the torch rides a quarter metre off the eye, so at arm's
      // length a head at the middle of the screen stands at the cone's edge. The glint takes the torch's switch,
      // its range and its level shadow, and a cone wider than the beam's by the spill.
      if (spotCfg.x > 0.0) {
        let glisTo = spotPos - p;
        let glisDist = length(glisTo);
        let glisLs = glisTo / max(glisDist, 1e-4);
        let glisCone = clamp((dot(-glisLs, normalize(spotAxis)) - spotCfg.z) / ${f(G.spill)} + 1.0, 0.0, 1.0);
        let glisFar = clamp(1.0 - glisDist / max(spotCfg.w, 1e-4), 0.0, 1.0);
        let glisHv = glisLs + V;
        let glisH = glisHv * inverseSqrt(max(dot(glisHv, glisHv), 1e-12));
        glis = spotColor * (pow(max(dot(glisN, glisH), 0.0), ${f(G.pow)}) * glisCone * glisCone * glisFar * glisFar * min(spotCfg.x, 1.0) * lvl);
      }
      // THE LAMP, with the torch off: the light list then hands the key to its dominant pick (light-list.wgsl.ts:
      // L, keyC, keyI, and H from its view-biased direction), so the key's highlight off the film's normal is that
      // lamp's. Not while a beam light is among the picks (listBeam): the torch has its own term above. Lit, the
      // torch keeps the key and the lamps are only in the list's sums: they add no glint then. (The list is NOT
      // walked again off the film's normal: a second bodyLights call here left whole screen tiles of an open head
      // at a wrong depth. docs/dev-notes/2026-10-04-head-split/NOTES.md, "Look: wet under the flashlight".)
      if (lightListCfg.x > 0.0 && lightListCfg.z <= 0.5 && listBeam <= 0.0) {
        glis = glis + keyC * (pow(max(dot(glisN, H), 0.0), ${f(G.lampPow)}) * min(keyI, 1.0) * wShadow * ${f(G.lamps)});
      }
      fleshLit = fleshLit + glis * (${f(G.gain)} * glisRaw * ao);
    }
  }` : '');

export const SPLIT_GLISTEN_BLOCK = splitGlistenBlock();
