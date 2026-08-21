// src/lab/sdf-zombie/blob-parse.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize, numArg } from './blob-parse';
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
