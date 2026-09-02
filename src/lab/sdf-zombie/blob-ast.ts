// src/lab/sdf-zombie/blob-ast.ts

/**
 * One significant source line, with the trivia that preceded it.
 *
 * `leading` exists so `blob-emit.ts` can put a comment back on the SAME owner
 * it was written above. troll.wam and body.ts both spend half their lines
 * explaining WHY a number is what it is; an emitter that drops that turns a
 * maintainable character into a wall of unexplained floats after one save.
 * Blank strings inside `leading` are blank source lines, kept so paragraph
 * breaks survive too.
 */
export interface BlobLine {
  line: number;
  indent: number;
  words: string[];
  leading: string[];
  trailing: string | null;
  /**
   * The exact original source line (indent, code, and any trailing comment —
   * everything except the newline). `words` is split on `/\s+/`, which
   * collapses the multi-space padding the shipped character files use to
   * keep `len=`/`blend=` columns aligned; rebuilding a line from
   * `words.join(' ')` therefore loses that alignment. `blob-emit.ts` uses
   * `raw` to replay a line byte-for-byte when nothing about it changed,
   * falling back to reconstructing from `words` only for the fields an
   * override actually touches.
   */
  raw: string;
}

export interface BlobBone {
  name: string;
  parent: string | null;
  dir: 'up' | 'down' | 'side' | 'fwd';
  pitchDeg: number;
  tiltDeg: number;
  len: number;
  side: number;
  mirror: boolean;
  at: number | null;
  src: BlobLine;
}

export type BlobPartKind = 'blob' | 'bar' | 'carve' | 'groove' | 'shell';

export interface BlobPart {
  kind: BlobPartKind;
  limb: 'head' | 'torso' | 'arm' | 'leg';
  bone: string;
  at: number;
  to: number | null;
  radius: number;
  wide: number;
  tall: number;
  deep: number;
  blend: number;
  mirror: boolean;
  hard: boolean;
  both: boolean;
  /** `chamfer` — fold with a flat bevel instead of the default fillet. */
  chamfer: boolean;
  /** `r2=` — radius at the far end. Null means untapered. */
  radiusB: number | null;
  offset: readonly [number, number, number] | null;
  /** `tip=` — extra displacement of the FAR end only. */
  tip: readonly [number, number, number] | null;
  /**
   * `bend=(x,y,z)` — displacement of the quadratic Bezier CONTROL point from
   * the midpoint of the primitive's two endpoints. Null means straight.
   */
  bend: readonly [number, number, number] | null;
  /** `depth=`/`width=` — how deep and how wide a `groove` cuts. */
  grooveDepth: number;
  grooveWidth: number;
  /**
   * `shell` — a thin sheet taken off a closed primitive's field
   * (`abs(d) - thickness`), clipped against a half-space plane with a rounded
   * rim. `thickness` is the HALF-thickness (the sheet spans +/-thickness about
   * the base surface). The clip plane is `dot(p, clipNormal) - clipOffset`,
   * keeping the side where the value is negative; `rim` is the rounding radius
   * where the sheet meets the plane (0 = a razor edge). Null = not a shell.
   */
  thickness: number;
  clipNormal: readonly [number, number, number] | null;
  clipOffset: number;
  rim: number;
  /** `color=rrggbb`, converted to LINEAR rgb. null = flesh. */
  color: readonly [number, number, number] | null;
  /** `gloss=0..1`. null = the flesh preset's own wetness. */
  gloss: number | null;
  /** The bare word `core`: this prim is the limb's structural mass. */
  core: boolean;
  /** The bare word `organ` (bones block only): soft viscera, not bone.
   *  Rides the same array and gates as bone; differs only in material. */
  organ: boolean;
  src: BlobLine;
}

/**
 * Which way the knee folds.
 *
 * `humanoid` puts the knee FORWARD of the hip-to-ankle line; `digitigrade`
 * puts it behind, the hock of a hound or a kangaroo. Both are legitimate — a
 * beast wants the backward fold — but getting it by accident is easy and looks
 * like a modelling mistake, so it is declared and then checked rather than
 * left implicit in a pitch sign.
 */
export type BlobStance = 'humanoid' | 'digitigrade';

export interface BlobDoc {
  name: string;
  height: number | null;
  /**
   * Declared knee fold, or null when the document says nothing.
   *
   * NULL RATHER THAN A DEFAULT OF `humanoid`, which is what this was. Stance is
   * the format's one INTENT check — `checkStance` compares the declaration
   * against the geometry precisely because a knee folded the wrong way by
   * accident is invisible to every geometric check. An intent check needs an
   * intent, and a defaulted one is a guess: zombie.blob declares no stance and
   * its hunched knees measure 10.2 mm behind the hip-to-ankle line, so the
   * default reported two validation errors on the lab's own default character
   * for the whole life of the check. Both were false — nobody had claimed the
   * zombie was anything.
   */
  stance: BlobStance | null;
  rootBone: string;
  rootHeight: number;
  /** Root bone length. `root <name> at <h> len=<l>`; 0.14 when omitted. */
  rootLen: number;
  bones: BlobBone[];
  parts: BlobPart[];
  /**
   * A `bones` block's content, or null when the character did not declare one.
   *
   * Named `bonesBlock`, not the plan prose's `bones`: `BlobDoc.bones` is TAKEN
   * — it is the SKELETON's bone declarations above — and this is a different
   * thing entirely (authored bone PRIMITIVES, not the rig). Same reasoning
   * that named `BuiltBody.bonePrims` in task 4a.
   *
   * `ratio` drives auto-derivation for bones this block does not name (null =
   * untouched, DEFAULT_BONE_RATIO applies; 0 opts the character out of bone);
   * `parts` are authored bone overrides written in EXACTLY the body grammar
   * (`blob`/`bar` words only — a carve/groove/shell is not a bone shape) and
   * are kept OUT of `parts` above: body parts and bone parts never mix, or
   * every unaudited `body.prims` consumer is back to filtering on `op` by
   * hand, which is the design that failed.
   */
  bonesBlock: { ratio: number | null; parts: BlobPart[] } | null;
  /**
   * The `bones` block's `ratio` source lines — the same trivia contract as
   * `faceTrivia`/`sheetTrivia`/`paletteTrivia`: the emitter replays them
   * verbatim so a round trip keeps the authored numbers, padding and
   * comments. Parts ride their own `src` lines; the block keyword itself
   * lives in `structure`.
   */
  bonesTrivia: BlobLine[];
  face: Record<string, number> | null;
  faceTrivia: BlobLine[];
  /**
   * A `sheet` block's parameters, or null when the character did not declare
   * one. Present means "generate this character's face texture from these
   * numbers"; absent means "use the shared zombie sheet", which is what every
   * character did before generated faces existed.
   */
  sheet: Record<string, number> | null;
  /**
   * A `sheet` block's `image <file>` line, or null. The one non-numeric sheet
   * parameter: the file (under `public/assets/lab/faces/`) a DECAL sheet is
   * loaded from instead of being generated. Baked from a reference mesh by
   * `npm run blob:face-bake`.
   */
  sheetImage: string | null;
  sheetTrivia: BlobLine[];
  /**
   * A `palette` block's parameters, or null when the character did not declare
   * one — in which case it wears whatever flesh preset the lab has selected,
   * which is what every character did before palettes existed and is most of
   * why they all read as the same pink creature in different shapes.
   *
   * Values are ARRAYS because a palette mixes scalars (`roughness 0.55`) with
   * linear-RGB triples (`base 0.34 0.42 0.22`); arity is checked per key by
   * `compilePalette`, against the shape of the real `FleshMaterial` field.
   * `face` and `sheet` are flat number maps and share a parser for that
   * reason; this one cannot join them without making every face parameter a
   * one-element array.
   */
  palette: Record<string, number[]> | null;
  paletteTrivia: BlobLine[];
  /**
   * Lines that no node owns — `model`, `skeleton`, `body`, `face`, `mirror`,
   * `end`, `height`, `root`. The emitter needs them to rebuild the document in
   * source order; without this it silently drops every block keyword.
   */
  structure: BlobLine[];
  trailingTrivia: string[];
}

export class BlobError extends Error {
  constructor(message: string, readonly line: number, readonly col: number) {
    super(`${line}:${col}: ${message}`);
    this.name = 'BlobError';
  }
}
