// src/lab/sdf-zombie/blob-compile.ts
import { type BlobDoc, BlobError } from './blob-ast';
import type { BodyDef, BoneDef, PrimDef, Vec3 } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';
import { DEFAULT_SHEET, type FaceSheetParams } from './blob-face-sheet';
import { FLESH_PRESETS, type FleshMaterial } from './material';

/**
 * The only valid `.blob` face parameter names — every key of `FaceParams`,
 * read off `DEFAULT_FACE` rather than duplicated by hand so the two can never
 * drift apart.
 */
const FACE_KEYS = Object.keys(DEFAULT_FACE) as (keyof FaceParams)[];
const FACE_KEY_SET = new Set<string>(FACE_KEYS);

const RAD = Math.PI / 180;

/**
 * Angles → a direction vector, the ergonomic win borrowed from WAM.
 *
 * On `up`/`down` bases, both angles are AUTHOR-FACING conventions that don't
 * depend on which way the bone points: positive `pitch` tips the direction
 * toward +z, and positive `tilt` swings it toward +x, for both. An author
 * writing `pitch=5` means "tip it forward" whether that's a spine pointing
 * `up` or a forearm pointing `down` — so the zombie's 7-degree forward hunch
 * is a number you can reason about instead of the opaque `[0, 1, 0.12]`, and
 * the SAME number means the same thing lower down the skeleton.
 *
 * `side` and `fwd` don't follow that contract — see the inline comments
 * below for why. In short: on `side`, pitch is a no-op and tilt swings
 * toward +y, not +x (a sideways clavicle tilting "up"). On `fwd`, both
 * angles are inert.
 *
 * Magnitude is irrelevant: resolveBones normalises `dir` (resolve.ts:26), so
 * only the direction has to be right.
 */
export function dirVector(
  dir: 'up' | 'down' | 'side' | 'fwd', pitchDeg: number, tiltDeg: number,
): Vec3 {
  const base: Record<'up' | 'down' | 'side' | 'fwd', Vec3> = {
    up: [0, 1, 0], down: [0, -1, 0], side: [1, 0, 0], fwd: [0, 0, 1],
  };
  const [x0, y0, z0] = base[dir];

  // Pitch: y toward z, tipping toward +z regardless of the sign of y0.
  //
  // A plain rotation about X — y1 = y0 cos p - z0 sin p, z1 = y0 sin p + z0
  // cos p — carries `up` (y0 = +1) toward +z but `down` (y0 = -1) toward -z,
  // because the rotation's direction is fixed in world space while the base
  // it's rotating away from is not. That is the bug this function used to
  // have: `pitch=5` tipped a spine forward and a forearm backward.
  //
  // Scaling the rotation angle by sign(y0) — equivalently, always rotating
  // the same way RELATIVE TO the base's own vertical direction rather than
  // relative to world +y — cancels that dependency. Expanded out, the
  // y0-toward-z contribution becomes `|y0| * sin(p)`: positive for both `up`
  // and `down`. `side` has y0 = 0, so `sign(y0) = 0` and pitch is correctly a
  // no-op there — there is no vertical component for it to act on.
  const p = pitchDeg * RAD;
  const ySign = Math.sign(y0);
  const y1 = y0 * Math.cos(p) - ySign * z0 * Math.sin(p);
  const z1 = Math.abs(y0) * Math.sin(p) + z0 * Math.cos(p);

  // Tilt: y toward x, always toward +x regardless of the sign of y1 — the
  // exact twin of the pitch fix above, and the same bug: a plain rotation
  // about Z sends `down` (y1 < 0) toward +x but `up` (y1 > 0) toward -x for
  // the same positive tilt, because `-y1 * sin(t)` flips sign with y1. Using
  // `|y1| * sin(t)` instead makes the x contribution positive for both.
  //
  // Unlike pitch, the `x0`-cross term in `y2` is deliberately left
  // UNCOMPENSATED. Across the four base directions `x0` and `y1` are never
  // both nonzero at this point: `x0` is nonzero only for `side` (where pitch
  // always leaves `y1` at exactly 0), and `y1` is nonzero only for `up` and
  // `down` (where `x0` is 0). So `side`'s current behaviour — tilting a
  // sideways bone swings it toward +y (`troll.wam`'s clavicle relies on
  // this) — comes entirely from that `x0` term, and reworking it to mirror
  // pitch's `sign(y1)`-scaled cross term would zero it out for no gain: it
  // would only ever fire in a combination that cannot occur here.
  const t = tiltDeg * RAD;
  const x2 = x0 * Math.cos(t) + Math.abs(y1) * Math.sin(t);
  const y2 = x0 * Math.sin(t) + y1 * Math.cos(t);

  return [x2, y2, z1];
}

/**
 * Merges a `.blob` face block over the tuned defaults.
 *
 * Validates every key against `FaceParams` rather than trusting the blanket
 * spread that used to sit here. `doc.face` is a `Record<string, number>` —
 * `blob-parse.ts` never checks the parameter NAME, only that its value is a
 * number — so a typo (`headRadus` for `headRadius`) used to be silently
 * accepted: the bad key rode along as an inert extra property while
 * `headRadius` quietly kept `DEFAULT_FACE`'s default, with no error anywhere.
 * That is exactly the silent-shadowing class already fixed several times in
 * `blob-parse.ts`, and it bites hardest here: Task 5 hand-types all 14 face
 * parameter names into `zombie.blob`, where a typo would produce a subtly
 * wrong face with nothing to catch it.
 */
export function compileFace(doc: BlobDoc): FaceParams {
  const face: FaceParams = { ...DEFAULT_FACE };
  for (const [key, value] of Object.entries(doc.face ?? {})) {
    if (!FACE_KEY_SET.has(key)) {
      // Every entry in `doc.face` was written by `parseFaceLine`, which
      // pushes the SAME line into `faceTrivia` with that key as `words[0]`
      // (blob-parse.ts) — so this lookup always finds a real line. The `!`
      // records that invariant rather than inventing a fake location on a
      // lookup miss. `doc.face` is last-write-wins on a repeated key, but
      // `.find()` reports the FIRST line with that key — a key typo'd twice
      // points at the earlier occurrence. Low-stakes: it's the same bad key
      // text either way, just not always the exact line that "won".
      const line = doc.faceTrivia.find(l => l.words[0] === key)!;
      throw new BlobError(
        `unknown face parameter "${key}" — expected one of ${FACE_KEYS.join(', ')}`,
        line.line, line.indent + 1,
      );
    }
    face[key as keyof FaceParams] = value;
  }
  return face;
}

/**
 * A character's own face-sheet parameters, or null if it did not declare a
 * `sheet` block — in which case it wears the shared zombie sheet, which is what
 * every character did before generated faces existed.
 *
 * Validated the same way `compileFace` validates the `face` block, and for the
 * same reason: an unknown key would otherwise be silently ignored while the
 * intended parameter quietly kept its default.
 */
export function compileSheet(doc: BlobDoc): FaceSheetParams | null {
  if (doc.sheet === null) return null;
  const valid = new Set(Object.keys(DEFAULT_SHEET));
  for (const key of Object.keys(doc.sheet)) {
    if (valid.has(key)) continue;
    const at = doc.sheetTrivia.find(l => l.words[0] === key);
    throw new BlobError(
      `unknown sheet parameter "${key}" — expected one of ${[...valid].join(', ')}`,
      at ? at.line : 0, at ? at.indent + 1 : 1);
  }
  const out = { ...DEFAULT_SHEET, ...doc.sheet } as FaceSheetParams;
  if (out.decal > 0.5 && doc.sheetImage === null) {
    const at = doc.sheetTrivia.find(l => l.words[0] === 'decal');
    throw new BlobError('sheet "decal 1" needs an "image <file>" line to paste',
      at ? at.line : 0, at ? at.indent + 1 : 1);
  }
  return out;
}

/** The decal image a `sheet` block names, or null. See BlobDoc.sheetImage. */
export function compileSheetImage(doc: BlobDoc): string | null {
  return doc.sheetImage;
}

/**
 * The preset a `palette` block is a PARTIAL override of.
 *
 * A character declares only what makes it that character — a goblin says it is
 * green and matte and leaves scatter and wound colours alone — so the rest has
 * to come from somewhere fixed. Deliberately a NAMED preset rather than
 * "whatever the lab panel currently has selected": a character's look must not
 * depend on a dropdown, or the same `.blob` renders differently in the lab, in
 * a turntable capture and in the game. `henenlotter-latex` because it is the
 * lab's own default, so a palette that overrides nothing is a no-op.
 */
const PALETTE_BASE = FLESH_PRESETS['henenlotter-latex'];

/**
 * A character's own flesh material, or null if it declared no `palette` block
 * — in which case it wears whatever preset the lab has selected, which is what
 * every character did before palettes existed, and is most of why the whole
 * cast read as one pink creature in different shapes.
 *
 * Keys are `FleshMaterial`'s own field names, read off the base preset rather
 * than duplicated as a friendlier alias table, for the reason `compileFace`
 * gives: an alias table is a second list that can silently drift from the
 * first. The arity of each key comes from the same place — a field whose
 * reference value is an array wants three numbers, everything else wants one —
 * so adding a field to `FleshMaterial` makes it authorable here with no change
 * to this function.
 */
export function compilePalette(doc: BlobDoc): FleshMaterial | null {
  if (doc.palette === null) return null;
  const out: FleshMaterial = {
    ...PALETTE_BASE,
    baseColor: [...PALETTE_BASE.baseColor],
    deepColor: [...PALETTE_BASE.deepColor],
    charColor: [...PALETTE_BASE.charColor],
    mottleColor: [...PALETTE_BASE.mottleColor],
  };
  const keys = Object.keys(PALETTE_BASE) as (keyof FleshMaterial)[];
  for (const [key, nums] of Object.entries(doc.palette)) {
    const at = doc.paletteTrivia.find(l => l.words[0] === key);
    const line = at ? at.line : 0, col = at ? at.indent + 1 : 1;
    if (!keys.includes(key as keyof FleshMaterial))
      throw new BlobError(
        `unknown palette parameter "${key}" — expected one of ${keys.join(', ')}`, line, col);
    const isColor = Array.isArray(PALETTE_BASE[key as keyof FleshMaterial]);
    if (isColor && nums.length !== 3)
      throw new BlobError(`palette parameter "${key}" is a colour and needs 3 numbers (linear r g b)`, line, col);
    if (!isColor && nums.length !== 1)
      throw new BlobError(`palette parameter "${key}" is a single number, got ${nums.length}`, line, col);
    // Checked immediately above, so the casts record the arity rather than
    // asserting past an unknown.
    if (isColor) (out[key as 'baseColor']) = [nums[0]!, nums[1]!, nums[2]!];
    else (out[key as 'wetness']) = nums[0]!;
  }
  return out;
}

/**
 * `face` defaults to `compileFace(doc)`, which validates `doc.face`'s keys and
 * throws on an unknown one — but a default parameter only fires when the caller
 * OMITS the argument. Passing an explicit face (say, one merged from live panel
 * overrides) silently skips that validation: `doc.face` is never even read.
 *
 * This is not hypothetical. `lab-main.ts` always supplies an explicit face, so
 * the unknown-key check was dead in the lab from the moment it was written, and
 * every unit test missed it because they all omit the argument and take the
 * default. **If your caller always supplies a face, call `compileFace(doc)`
 * yourself first** to get the validation back.
 */
export function compileBlob(doc: BlobDoc, face = compileFace(doc)): BodyDef {
  const bones: BoneDef[] = [
    { name: doc.rootBone, parent: null, dir: [0, 1, 0], length: doc.rootLen },
    ...doc.bones.map(b => ({
      name: b.name,
      parent: b.parent,
      dir: dirVector(b.dir, b.pitchDeg, b.tiltDeg),
      length: b.len,
      side: b.side,
      mirror: b.mirror,
    } satisfies BoneDef)),
  ];

  const prims: PrimDef[] = doc.parts.map(p => {
    // A chamfered CARVE would fold through smax, and a chamfered subtraction
    // is a different operator with its own sign conventions — the shader's
    // carve pass deliberately does not read the profile. Rejecting it here is
    // what keeps that from silently doing the wrong thing: without this the
    // author gets a normal fillet-carve and no diagnostic.
    // A groove that cuts nothing is almost certainly a forgotten argument, not
    // an intentional no-op: with width 0 the channel is nowhere and with depth
    // 0 it is infinitely shallow, so the primitive silently does nothing at all
    // while still costing a slot in the fold and a row in the texture.
    if (p.kind === 'groove' && (p.grooveDepth <= 0 || p.grooveWidth <= 0))
      throw new BlobError(
        'groove needs depth= and width= above zero, or it cuts nothing',
        p.src.line, p.src.indent + 1);
    if (p.chamfer && p.kind === 'carve')
      throw new BlobError(
        'chamfer is not supported on a carve — carving folds through smax, '
        + 'which has no chamfered form here', p.src.line, p.src.indent + 1);
    // A shell's cut edge is rounded by `rim`, never by the fold profile; the
    // shell field folds with the round smooth-min regardless, so a `chamfer`
    // flag on a shell is silently meaningless and should fail loudly.
    if (p.chamfer && p.kind === 'shell')
      throw new BlobError(
        'chamfer is not supported on a shell — a shell folds round; round its cut '
        + 'edge with rim=', p.src.line, p.src.indent + 1);
    // A taper needs two ENDS to run between. A `blob` is a sphere (a === b
    // unless `tip=` displaces it), so `r2=` on one with no `tip=` is silently
    // meaningless — the round cone collapses to its larger sphere.
    if (p.radiusB !== null && p.kind === 'blob' && p.tip === null)
      throw new BlobError(
        'r2= needs something to taper ALONG: use it on a bar, or give the blob '
        + 'a tip=(x,y,z) so its far end sits somewhere else', p.src.line, p.src.indent + 1);
    // Same argument for a bend, and for the same reason a bent sphere is not
    // a shape anyone can reason about: with both ends coincident the control
    // point is defined against a midpoint that does not exist.
    if (p.bend !== null && p.kind === 'blob' && p.tip === null)
      throw new BlobError(
        'bend= needs two distinct ends to curve BETWEEN: use it on a bar, or '
        + 'give the blob a tip=(x,y,z) so its far end sits somewhere else',
        p.src.line, p.src.indent + 1);
    // A shell thins a CLOSED base field to a sheet; sdShellWrap takes that
    // base from the capsule path. Boxing the base is a shape nobody has asked
    // for and the spec puts out of scope, so it fails rather than silently
    // producing a boxed sheet nobody designed. This runs BEFORE the
    // argument-level box checks below (same ordering as chamfer-on-carve/shell
    // ahead of r2/bend-on-blob above): a `shell ... box bend=(...)` is a kind
    // mismatch, not an argument mismatch, and `box` is the thing to drop —
    // if the bend= check ran first it would tell the author to drop `bend`,
    // which does not fix anything.
    if (p.box && p.kind === 'shell')
      throw new BlobError(
        'box is not supported on a shell — a shell thins a closed capsule; '
        + 'drop one of the two', p.src.line, p.src.indent + 1);
    // A box is swept along its segment as a rounded BOX, and sdRoundBox has
    // no bent, tapered or tip-displaced form. Each of these would otherwise
    // be silently dropped in the field while the emitter echoed it back, so
    // they fail here with the line rather than becoming a shape the author
    // wrote and never got.
    if (p.box && p.bend !== null)
      throw new BlobError(
        'bend= is not supported on a box — sdRoundBox has no bent form; use a '
        + 'chain of boxes at the inflections, or drop `box`',
        p.src.line, p.src.indent + 1);
    if (p.box && p.radiusB !== null)
      throw new BlobError(
        'r2= is not supported on a box — a box does not taper; use two boxes, '
        + 'or drop `box` for a round cone', p.src.line, p.src.indent + 1);
    if (p.box && p.tip !== null)
      throw new BlobError(
        'tip= is not supported on a box — its far end is the segment end; move '
        + 'the whole prim with offset=', p.src.line, p.src.indent + 1);
    // Deliberately NOT a clamp: above 1 the inset extent goes negative and the
    // field inverts, and a silent clamp would hide a typo in a character file.
    if (p.box && (p.round < 0 || p.round > 1))
      throw new BlobError(
        `round= must be between 0 and 1 (a fraction of r), got ${p.round}`,
        p.src.line, p.src.indent + 1);
    return {
      bone: p.bone,
      src: p.src.line,
      at: p.at,
      ...(p.to === null ? {} : { capTo: p.to }),
      radius: p.radius,
      ...(p.radiusB === null ? {} : { radiusB: p.radiusB }),
      scale: [p.wide, p.tall, p.deep] as Vec3,
      blendK: p.hard ? 0 : p.blend,
      ...(p.chamfer ? { blendProfile: 'chamfer' as const } : {}),
      limb: p.limb,
      ...(p.mirror ? { mirror: true } : {}),
      ...(p.kind === 'carve' ? { op: 'sub' as const } : {}),
      ...(p.kind === 'groove'
        ? { op: 'groove' as const, grooveDepth: p.grooveDepth, grooveWidth: p.grooveWidth }
        : {}),
      ...(p.both ? { mirrorOffset: true } : {}),
      ...(p.offset ? { offset: p.offset as Vec3 } : {}),
      ...(p.tip ? { tip: p.tip as Vec3 } : {}),
      ...(p.bend ? { bend: p.bend as Vec3 } : {}),
      ...(p.color ? { color: p.color as Vec3 } : {}),
      ...(p.gloss === null ? {} : { gloss: p.gloss }),
      ...(p.core ? { core: true } : {}),
      ...(p.kind === 'shell'
        ? {
            shell: {
              thickness: p.thickness,
              clipNormal: p.clipNormal as Vec3,
              clipOffset: p.clipOffset,
              rim: p.rim,
            },
          }
        : {}),
      ...(p.box ? { box: { round: p.round } } : {}),
    } satisfies PrimDef;
  });

  return {
    name: doc.name,
    root: [0, doc.rootHeight, 0],
    bones,
    prims: [...prims, ...facePrims(face)],
  };
}
