// src/lab/sdf-zombie/blob-parse.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize, numArg, parseBlob } from './blob-parse';
import { BlobError } from './blob-ast';

describe('tokenize', () => {
  it('emits one line record per source line, with 1-based numbers', () => {
    const lines = tokenize('model zombie\n  height 1.78\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ line: 1, indent: 0, words: ['model', 'zombie'] });
    expect(lines[1]).toMatchObject({ line: 2, indent: 2, words: ['height', '1.78'] });
  });

  // Trivia is load-bearing: the emitter re-attaches these to the same owner.
  it('keeps a comment as trivia rather than discarding it', () => {
    const lines = tokenize('# why the stoop lives here\nmodel zombie\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.leading).toEqual(['# why the stoop lives here']);
  });

  it('keeps blank lines in trivia so paragraph breaks survive a round trip', () => {
    const lines = tokenize('# a\n\n# b\nmodel zombie\n');
    expect(lines[0]!.leading).toEqual(['# a', '', '# b']);
  });

  it('keeps a trailing same-line comment separately from leading trivia', () => {
    const lines = tokenize('r=0.15 # keep this fat\n');
    expect(lines[0]!.words).toEqual(['r=0.15']);
    expect(lines[0]!.trailing).toBe('# keep this fat');
  });
});

describe('numArg', () => {
  // BlobError.col must always be a 1-based CHARACTER offset, never a word
  // index — an editor integration or the author reading the error jumps to
  // that column in the source line. Both throw sites need to agree on units.
  it('reports col as a character offset that lands on the offending token, for both a missing key and a bad number', () => {
    const src = '  bone spine parent=pelvis dir=up pitch=bad\n';
    const [line] = tokenize(src);
    // Reconstruct the line the way `numArg`'s column math assumes it: indent
    // plus words joined by single spaces. This source line only ever had
    // single spaces between words, so the reconstruction is exact here.
    const reconstructed = ' '.repeat(line!.indent) + line!.words.join(' ');
    expect(reconstructed).toBe('  bone spine parent=pelvis dir=up pitch=bad');

    // Missing key: nothing on this line starts with "root=".
    let missingKeyErr: BlobError | undefined;
    try {
      numArg(line!, 'root');
    } catch (e) {
      missingKeyErr = e as BlobError;
    }
    expect(missingKeyErr).toBeInstanceOf(BlobError);
    // Points just past the indent, at the start of the line's content.
    expect(missingKeyErr!.col).toBe(line!.indent + 1);
    expect(reconstructed[missingKeyErr!.col - 1]).toBe('b'); // "bone"

    // Bad number: "pitch=bad" is present but doesn't parse as a number.
    let badNumberErr: BlobError | undefined;
    try {
      numArg(line!, 'pitch');
    } catch (e) {
      badNumberErr = e as BlobError;
    }
    expect(badNumberErr).toBeInstanceOf(BlobError);
    // Points at the start of "pitch=bad" itself, in the SAME units as above.
    const col = badNumberErr!.col;
    expect(reconstructed.slice(col - 1, col - 1 + 'pitch=bad'.length)).toBe('pitch=bad');
  });
});

const SKEL = `model zombie
  height 1.78

skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=7 len=0.34
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end
`;

describe('parseBlob — skeleton', () => {
  it('reads the model header', () => {
    const doc = parseBlob(SKEL);
    expect(doc.name).toBe('zombie');
    expect(doc.height).toBe(1.78);
  });

  it('reads the root bone and its world height', () => {
    const doc = parseBlob(SKEL);
    expect(doc.rootBone).toBe('pelvis');
    expect(doc.rootHeight).toBe(0.92);
  });

  it('defaults pitch/tilt/side to zero and mirror to false', () => {
    const spine = parseBlob(SKEL).bones.find(b => b.name === 'spine')!;
    expect(spine).toMatchObject({
      parent: 'pelvis', dir: 'up', pitchDeg: 7, tiltDeg: 0, len: 0.34,
      side: 0, mirror: false,
    });
  });

  it('marks bones inside a mirror block, and only those', () => {
    const doc = parseBlob(SKEL);
    expect(doc.bones.find(b => b.name === 'thigh')!.mirror).toBe(true);
    expect(doc.bones.find(b => b.name === 'spine')!.mirror).toBe(false);
  });

  it('rejects a parent that was never declared, naming the line', () => {
    const bad = SKEL.replace('parent=pelvis dir=up pitch=7', 'parent=nope dir=up pitch=7');
    expect(() => parseBlob(bad)).toThrow(BlobError);
    expect(() => parseBlob(bad)).toThrow(/6:.*unknown parent "nope"/);
  });

  it('rejects an unclosed mirror block', () => {
    expect(() => parseBlob(SKEL.replace('  end\n', ''))).toThrow(/mirror block is never closed/);
  });

  it('rejects an unrecognized keyword inside skeleton, naming the word and section', () => {
    const bad = SKEL.replace('bone spine parent=pelvis', 'boen spine parent=pelvis');
    expect(() => parseBlob(bad)).toThrow(BlobError);
    expect(() => parseBlob(bad)).toThrow(/unrecognized "boen" in skeleton block/);
  });

  // Regression test: a prior implementation reported this error at
  // col = indent + 1 (the "r" of "root") no matter where the bad value
  // actually was, because it validated `at`'s value by wrapping it in a
  // fake single-word BlobLine before handing it to `numArg` — leaving no
  // preceding words for `wordCol` to sum. Assert the column lands on the
  // bad token itself, using the same reconstruct-and-slice technique as the
  // `numArg` column test above.
  it('reports the "at" column on a malformed root line, pointing at the bad value rather than at "root"', () => {
    const bad = SKEL.replace('root pelvis at 0.92', 'root pelvis at oops');
    const rootLine = tokenize(bad)[3]!;
    const reconstructed = ' '.repeat(rootLine.indent) + rootLine.words.join(' ');
    expect(reconstructed).toBe('  root pelvis at oops');

    let err: BlobError | undefined;
    try {
      parseBlob(bad);
    } catch (e) {
      err = e as BlobError;
    }
    expect(err).toBeInstanceOf(BlobError);
    expect(reconstructed.slice(err!.col - 1, err!.col - 1 + 'oops'.length)).toBe('oops');
    expect(err!.col).not.toBe(rootLine.indent + 1);
  });

  // Regression guard: dirArg used to report every bad "dir=" value at
  // col = indent + 1 (the start of the line) instead of the "dir=" token
  // itself — the same class of bug the "at" column test above already
  // guards for "root", just never pinned for "dir=". Same
  // reconstruct-and-slice technique.
  it('reports the "dir=" column on a bad dir value, pointing at the token rather than the start of the line', () => {
    const bad = SKEL.replace('dir=up pitch=7', 'dir=sideways pitch=7');
    const boneLine = tokenize(bad)[4]!;
    const reconstructed = ' '.repeat(boneLine.indent) + boneLine.words.join(' ');
    expect(reconstructed).toBe('  bone spine parent=pelvis dir=sideways pitch=7 len=0.34');

    let err: BlobError | undefined;
    try {
      parseBlob(bad);
    } catch (e) {
      err = e as BlobError;
    }
    expect(err).toBeInstanceOf(BlobError);
    expect(reconstructed.slice(err!.col - 1, err!.col - 1 + 'dir=sideways'.length)).toBe('dir=sideways');
    expect(err!.col).not.toBe(boneLine.indent + 1);
  });
});

const FULL = `model zombie
  height 1.78

skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=7 len=0.34
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.80 r=0.150 wide=1.28 deep=0.78 blend=0.014
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  carve on spine at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both

face
  headRadius 0.118
  headWidth  0.760
`;

describe('parseBlob — body and face', () => {
  it('reads a blob part, defaulting unnamed axes to 1', () => {
    const p = parseBlob(FULL).parts[0]!;
    expect(p).toMatchObject({
      kind: 'blob', limb: 'torso', bone: 'spine', at: 0.80, to: null,
      radius: 0.150, wide: 1.28, tall: 1, deep: 0.78, blend: 0.014,
      mirror: false, hard: false, both: false, offset: null,
    });
  });

  it('reads a bar as a span with from/to', () => {
    const p = parseBlob(FULL).parts[1]!;
    expect(p).toMatchObject({ kind: 'bar', limb: 'leg', at: 0.05, to: 0.95, mirror: true });
  });

  it('reads a carve with its offset triple and hard/both flags', () => {
    const p = parseBlob(FULL).parts[2]!;
    expect(p).toMatchObject({ kind: 'carve', hard: true, both: true, offset: [0.035, 0.01, 0.06] });
  });

  it('reads the face block as plain named parameters', () => {
    expect(parseBlob(FULL).face).toEqual({ headRadius: 0.118, headWidth: 0.760 });
  });

  it('rejects a part riding a bone that does not exist', () => {
    const bad = FULL.replace('blob torso on spine', 'blob torso on ghost');
    expect(() => parseBlob(bad)).toThrow(/unknown bone "ghost"/);
  });

  it('rejects a bar without to=', () => {
    const bad = FULL.replace('from=0.05 to=0.95 ', 'from=0.05 ');
    expect(() => parseBlob(bad)).toThrow(/bar needs "to="/);
  });

  it('rejects a typo\'d limb name on a blob', () => {
    const bad = FULL.replace('blob torso on spine', 'blob torzo on spine');
    expect(() => parseBlob(bad)).toThrow(/limb must be one of head\|torso\|arm\|leg, got "torzo"/);
  });

  it('rejects an omitted limb word on a blob, rather than silently reading "on" as the limb', () => {
    const bad = FULL.replace('blob torso on spine', 'blob on spine');
    expect(() => parseBlob(bad)).toThrow(/limb must be one of head\|torso\|arm\|leg, got "on"/);
  });

  it('rejects an offset with the wrong number of components', () => {
    const bad = FULL.replace('offset=(0.035,0.01,0.06)', 'offset=(0.035,0.01)');
    expect(() => parseBlob(bad)).toThrow(/offset needs exactly 3 components, got 2/);
  });

  it('rejects an offset with a non-numeric component', () => {
    const bad = FULL.replace('offset=(0.035,0.01,0.06)', 'offset=(0.035,x,0.06)');
    expect(() => parseBlob(bad)).toThrow(/offset has a non-numeric component/);
  });

  // Regression guard, same reasoning as the "dir=" column test above:
  // pin limbArg's column so it can't silently regress to indent + 1 the
  // way dirArg did.
  it('reports the limb column on a typo, pointing at the token rather than the start of the line', () => {
    const bad = FULL.replace('blob torso on spine', 'blob torzo on spine');
    const blobLine = tokenize(bad)[9]!;
    const reconstructed = ' '.repeat(blobLine.indent) + blobLine.words.join(' ');
    expect(reconstructed).toBe('  blob torzo on spine at=0.80 r=0.150 wide=1.28 deep=0.78 blend=0.014');

    let err: BlobError | undefined;
    try {
      parseBlob(bad);
    } catch (e) {
      err = e as BlobError;
    }
    expect(err).toBeInstanceOf(BlobError);
    expect(reconstructed.slice(err!.col - 1, err!.col - 1 + 'torzo'.length)).toBe('torzo');
    expect(err!.col).not.toBe(blobLine.indent + 1);
  });
});
