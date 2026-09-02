// draft-paint — the draft's PAINT and BILATERALITY measurements: dominant
// texel colour per band, body mean colour for the palette block, stance off
// the rig's own encoding, asymmetry of mirrored pairs, and the head/hand
// clouds no other tool reads.
//
// WHY COLOUR AT ALL. The authoring skill is blunt that the palette block is
// the biggest lever there is: the first goblin read as "the zombie with
// different limbs" until it was painted, long after its skeleton was right.
// The reference carries a texture and the machinery to read it already
// exists (parseGlb + decodePng), so the draft can arrive painted instead of
// arriving colourless and being fixed by hand.
//
// THE JOIN. Colours live on (uv, texture); geometry lives on RefSkin.verts.
// They meet only because readRefSkin carries TEXCOORD_0 parallel to the kept
// verts — see the field's note there for why that join cannot be re-derived
// downstream. A vertex with no uv contributes geometry but no paint.
//
// Spec: docs/superpowers/specs/2026-09-02-blobforge-draft-and-depth-design.md.
import type { Vec3 } from './types';
import { parseGlb } from './silhouette';
import { decodePng } from './png-decode';
import { dot, sub } from './vec';
import { medialLine, type MedialLine, type Band } from './draft-fit';
import type { RefSkin } from './ref-skin';

/** 8-bit RGB, the units the texture is stored in. */
export type Rgb = readonly [number, number, number];

/** A decoded texture. Structurally decodePng's return, so callers can pass
 *  that straight through without a copy. */
export interface RgbImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** One vertex the paint pass can see: where it is, and where it paints. */
export interface PaintedPt {
  position: Vec3;
  /** glTF uv (origin top-left), or null when the primitive carries no uv. */
  uv: readonly [number, number] | null;
}

/**
 * The reference's texture, decoded. Reaches it THROUGH the skinned
 * primitive's material — a GLB can carry several images (decals, ORM maps),
 * and grabbing `images[0]` would sample plausible-looking garbage on any
 * file where another map ships first. No material/texture, or an image we
 * cannot decode, returns null / throws with the actual reason: an
 * untextured reference is a draft that cannot paint, not an error; a JPEG
 * texture is a loud gap, not a misdecode (png-decode's own rule).
 *
 * Only the FIRST primitive of the skinned mesh is consulted — the same
 * primitive readRefSkin reads, which is the only vertex stream a colour can
 * be joined to. baseColorFactor is ignored, as blob-face-bake.py's sampler
 * already does.
 */
export function readRefImage(glb: Uint8Array): RgbImage | null {
  const { json, bin } = parseGlb(glb);
  const gltf = json as any;
  if (!bin) throw new Error('GLB has no BIN chunk');

  const nodeIndex: number = gltf.nodes.findIndex((n: any) => n.skin === 0 && n.mesh !== undefined);
  const prim = nodeIndex >= 0
    ? gltf.meshes[gltf.nodes[nodeIndex].mesh]?.primitives?.[0]
    : gltf.meshes?.[0]?.primitives?.[0];
  const texIndex = prim?.material !== undefined
    ? gltf.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorTexture?.index
    : undefined;
  if (texIndex === undefined) return null;
  const image = gltf.images?.[gltf.textures?.[texIndex]?.source];
  if (!image) return null;
  if (image.uri !== undefined) throw new Error('reference texture is an external uri — unsupported');
  if (image.mimeType !== undefined && image.mimeType !== 'image/png') {
    throw new Error(`reference texture is ${image.mimeType} — only image/png is decodable here`);
  }
  const bv = gltf.bufferViews[image.bufferView];
  const png = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const d = decodePng(png);
  return { width: d.width, height: d.height, rgba: d.rgba };
}

/**
 * Texel at a uv, nearest-sample like blob-face-bake.py's sampler (no V flip
 * — glTF's uv origin is already top-left). Clamped, so a uv a rounding step
 * outside [0,1] reads the edge texel rather than the wrong side of the atlas.
 */
function sampleTexel(img: RgbImage, uv: readonly [number, number]): Rgb {
  const px = Math.min(img.width - 1, Math.max(0, Math.floor(uv[0] * img.width)));
  const py = Math.min(img.height - 1, Math.max(0, Math.floor(uv[1] * img.height)));
  const o = (py * img.width + px) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}

/**
 * Bins are 16-levels-per-channel (>>4); "same paint" allows ONE step of
 * drift per channel. Meshy-style paint is flat colours with baked AO, whose
 * shading lives within about one such step, while any second flat colour on
 * the model clears several — so this single tolerance both holds one paint
 * job together and splits two.
 */
const quantKey = (c: Rgb): number => ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);

function nearDom(k: number, dom: number): boolean {
  const d = [dom >> 8, (dom >> 4) & 15, dom & 15];
  const q = [k >> 8, (k >> 4) & 15, k & 15];
  return Math.abs(q[0]! - d[0]!) <= 1 && Math.abs(q[1]! - d[1]!) <= 1 && Math.abs(q[2]! - d[2]!) <= 1;
}

/** Mean of the actual texels whose key is `k` — the bin CENTRE would report
 *  a colour nobody painted (240,8,8 for pure red). */
function binMean(samples: Rgb[], k: number): Rgb {
  let r = 0, g = 0, b = 0, n = 0;
  for (const s of samples) if (quantKey(s) === k) { r += s[0]; g += s[1]; b += s[2]; n++; }
  return [r / n, g / n, b / n];
}

/** The paint one band carries. `color` is absent when nothing sampled (no
 *  texture, or no uv) — the emitter then prints no `color=`, honestly. */
export interface BandPaint {
  /** Dominant texel colour, as the mean of the dominant cluster's texels. */
  color?: Rgb;
  /**
   * Bimodality: the fraction of the band's samples NOT within one
   * quantisation step of the dominant colour. ~0 = one paint job; large = a
   * paint boundary falls mid-band, and the draft must split the band there,
   * because a paint boundary IS a primitive boundary in this format (the
   * mouse's tee/shoes/shorts were each their own colour and their own prim).
   */
  split: number;
  /** True when `split` clears PAINT_SPLIT_BAR with enough samples to say so. */
  bimodal: boolean;
  /** The second colour, when the band is bimodal — what the split separates. */
  second?: Rgb;
  /** Samples behind these numbers. A band with few is not evidence. */
  samples: number;
}

/**
 * Split is judged material from this fraction on, and only with at least
 * PAINT_MIN_SAMPLES behind it — at 4 samples a single anti-aliased vertex
 * reads 0.25 and would shatter every band for noise.
 */
export const PAINT_SPLIT_BAR = 0.2;
export const PAINT_MIN_SAMPLES = 8;

/**
 * Per-band paint for one bone's cloud. `bands` must be the bandCloud() fit
 * of the same cloud — ordered, tiling — because assignment walks them in
 * order and hands each point to the first band whose t1 reaches it. `image`
 * is readRefImage()'s decode; null (untextured reference) yields samples 0
 * and no colour, which is the honest report.
 */
export function bandColour(
  pts: PaintedPt[],
  line: MedialLine,
  bands: Band[],
  image: RgbImage | null,
): BandPaint[] {
  const perBand: Rgb[][] = bands.map(() => []);
  if (image !== null) {
    for (const p of pts) {
      if (p.uv === null) continue;
      const t = dot(sub(p.position, line.origin), line.dir);
      const bi = bands.findIndex((b) => t <= b.t1 + 1e-9);
      if (bi < 0) continue;
      perBand[bi]!.push(sampleTexel(image, p.uv));
    }
  }
  return perBand.map((samples) => {
    if (samples.length === 0) return { split: 0, bimodal: false, samples: 0 };
    // Dominant bin by count; ties break to the LOWEST key so an exact 8/8
    // split resolves deterministically rather than by insertion order.
    const counts = new Map<number, number>();
    for (const s of samples) counts.set(quantKey(s), (counts.get(quantKey(s)) ?? 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => a - b);
    let dom = keys[0]!, domN = 0;
    for (const k of keys) if (counts.get(k)! > domN) { domN = counts.get(k)!; dom = k; }
    const color = binMean(samples, dom);
    const others: Rgb[] = samples.filter((s) => !nearDom(quantKey(s), dom));
    const split = others.length / samples.length;
    const bimodal = split >= PAINT_SPLIT_BAR && samples.length >= PAINT_MIN_SAMPLES;
    let second: Rgb | undefined;
    if (bimodal) {
      const oc = new Map<number, number>();
      for (const s of others) oc.set(quantKey(s), (oc.get(quantKey(s)) ?? 0) + 1);
      let sk = -1, sn = 0;
      for (const k of keys) { const n = oc.get(k) ?? 0; if (n > sn) { sn = n; sk = k; } }
      if (sk >= 0) second = binMean(samples, sk);
    }
    return { color, split, bimodal, second, samples: samples.length };
  });
}

/** The whole-body paint the `palette` block is built from. */
export interface BodyPaint {
  /** Mean sampled colour — the palette's base. */
  mean?: Rgb;
  /** RMS distance of the samples from that mean, 0-255 units. A mottle
   *  amplitude comes off this: ~0 is a flat-painted figure, large is a body
   *  of several paints. */
  spread: number;
  samples: number;
}

/** Body mean colour and spread over every painted vertex of the reference. */
export function bodyPaint(pts: PaintedPt[], image: RgbImage | null): BodyPaint {
  if (image === null) return { spread: 0, samples: 0 };
  const samples: Rgb[] = [];
  for (const p of pts) if (p.uv !== null) samples.push(sampleTexel(image, p.uv));
  if (samples.length === 0) return { spread: 0, samples: 0 };
  const chans = [0, 1, 2].map((c) => samples.reduce((s, x) => s + x[c]!, 0) / samples.length);
  const mean: Rgb = [chans[0]!, chans[1]!, chans[2]!];
  let sq = 0;
  for (const s of samples) {
    const d = [s[0]! - mean[0], s[1]! - mean[1], s[2]! - mean[2]];
    sq += d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
  }
  return { mean, spread: Math.sqrt(sq / samples.length), samples: samples.length };
}

/** Which way the leg bends, as the rig's own rigger encoded it. */
export type Stance = 'humanoid' | 'digitigrade';

export interface StanceFit {
  stance: Stance;
  /**
   * Signed forward offset of the knee from the hip-ankle line, in metres,
   * +z = forward. The margin the label was decided on — a near-zero offset
   * is a knee ON the line, and the author should trust it accordingly.
   */
  forwardOffset: number;
}

/**
 * Stance from the knee's position against the hip-to-ankle line: knee
 * forward of that line is a humanoid leg, knee behind it is digitigrade
 * (the backward joint of a digitigrade leg sits behind the load line).
 *
 * This is a SIGN test on rig joints, which the joint trap otherwise forbids:
 * the draft never places geometry from joints, but a rigger ENCODES stance
 * by where they put the knee joint, and the emitted `stance` keyword is a
 * label the checker validates against the same joints — measuring it
 * anywhere else would let the draft and the checker disagree. The
 * convention's ground truth: Meshy rigs face +z (the minotaur's ToeBase and
 * headfront joints both sit +z of their centres). Known limit, shared with
 * blob-checks.ts's stance check: a bird-style leg carrying BOTH a forward
 * knee and a backward hock reads by its knee sign alone.
 */
export function inferStance(hip: Vec3, knee: Vec3, ankle: Vec3): StanceFit {
  const a = sub(ankle, hip);
  const q = sub(knee, hip);
  const aa = dot(a, a);
  // Perpendicular component of the knee's offset from the line; the leg's
  // sideways splay lives in x and cancels here — only the z part is forward.
  const s = aa > 0 ? dot(q, a) / aa : 0;
  const perp = sub(q, [a[0] * s, a[1] * s, a[2] * s] as const as Vec3);
  const forwardOffset = perp[2];
  return { stance: forwardOffset >= 0 ? 'humanoid' : 'digitigrade', forwardOffset };
}

/**
 * The vertex cloud of a joint no .blob bone claims — `Head`, `LeftHand`,
 * `RightHand` on a Meshy rig.
 *
 * WHY THIS EXISTS. groupByBone reports unmapped joints as COUNTS, and
 * blob:rings never needed more (ring-fit explicitly cannot see the head or
 * hands). The draft sizes a cranium mass and one hand mass per side, so it
 * needs the actual points; they are right there in the skin, attributed by
 * the rig's own weights — reading them by joint name is exact, not inferred.
 */
export function unmappedCloud(skin: RefSkin, joint: string): Vec3[] {
  const out: Vec3[] = [];
  for (const v of skin.verts) if (v.joint === joint) out.push(v.position);
  return out;
}

/**
 * Above this composite skew a mirrored .l/.r pair is NOT mirrorable: the
 * draft must emit both sides (and flag that `side=` may be wanted) rather
 * than clone one side over the other. CALIBRATED against the three meshy
 * references, not tuned to look right — the measured composite skews:
 *
 *   mouse, schoolgirl (mirrored authoring)     0.006 - 0.174
 *   minotaur, non-prosthetic pairs             0.207 - 0.363
 *   minotaur shin (the prosthetic)             0.627
 *
 * The bar sits in the gap between "merely hand-sculpted" and "a different
 * limb", and the gap is wide: anywhere in [0.40, 0.55] classifies every
 * measured pair identically. 0.45 is its middle.
 */
export const MIRROR_BAR = 0.45;

export interface PairAsym {
  /** max(countSkew, radSkew) — the number MIRROR_BAR judges. */
  score: number;
  /** 1 - min/max vertex counts. The prosthetic's 18,032-vs-6,724 is 0.627. */
  countSkew: number;
  /** |medianRadius.l - medianRadius.r| / max, about each cloud's OWN medial
   *  line (so a mirror reflection measures 0). */
  radSkew: number;
  /** score < MIRROR_BAR: the pair may be emitted as one mirrored block. */
  mirrorable: boolean;
}

/**
 * Would mirroring the .l cloud over the .r one (or vice versa) lie about the
 * body? Compare vertex counts and the clouds' radial size.
 *
 * Deliberately NOT a band-by-band radius comparison, though the plan phrased
 * it as "banded radii": two different clouds band at different t's, so a
 * band pairing would have to be invented; and the decision this feeds is
 * binary (one mirrored block vs two side= blocks), for which the clouds'
 * overall size and mass answer exactly what mirroring would force equal.
 */
export function pairAsymmetry(l: Vec3[], r: Vec3[]): PairAsym {
  const nl = l.length, nr = r.length;
  const bigger = Math.max(nl, nr);
  const countSkew = bigger === 0 ? 0 : 1 - Math.min(nl, nr) / bigger;

  // Median radial distance of a cloud about its own medial line — the limb's
  // radius as bandCloud would read it, without needing the bands to align.
  const medRad = (cloud: Vec3[]): number => {
    if (cloud.length === 0) return 0;
    const line = medialLine(cloud);
    const ds: number[] = [];
    for (const p of cloud) {
      const q = sub(p, line.origin);
      const t = dot(q, line.dir);
      const perp2 = Math.max(0, dot(q, q) - t * t);
      ds.push(Math.sqrt(perp2));
    }
    ds.sort((x, y) => x - y);
    return ds[ds.length >> 1]!;
  };

  let radSkew = 0;
  if (nl > 0 && nr > 0) {
    const ml = medRad(l), mr = medRad(r);
    const m = Math.max(ml, mr);
    if (m > 0) radSkew = Math.abs(ml - mr) / m;
  }
  const score = Math.max(countSkew, radSkew);
  return { score, countSkew, radSkew, mirrorable: score < MIRROR_BAR };
}
