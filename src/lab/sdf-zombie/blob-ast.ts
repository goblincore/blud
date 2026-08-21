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

export type BlobPartKind = 'blob' | 'bar' | 'carve';

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
  offset: readonly [number, number, number] | null;
  src: BlobLine;
}

export interface BlobDoc {
  name: string;
  height: number | null;
  rootBone: string;
  rootHeight: number;
  bones: BlobBone[];
  parts: BlobPart[];
  face: Record<string, number> | null;
  faceTrivia: BlobLine[];
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
