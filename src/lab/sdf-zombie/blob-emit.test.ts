// src/lab/sdf-zombie/blob-emit.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { emitBlob } from './blob-emit';
import src from './characters/zombie.blob?raw';

/**
 * EVERY shipped character, not just the zombie — globbed rather than listed so
 * a new `.blob` is covered the day it lands.
 *
 * The zombie alone was the original coverage, and it hid a real bug for the
 * whole life of the `sheet` block: `emitBlob` never replayed `sheetTrivia`, so
 * a re-emitted goblin came back with an empty `sheet` block, silently lost its
 * entire generated face, and still compiled. zombie.blob declares no sheet, so
 * nothing failed. Any block added to the grammar from here on is caught the
 * moment a character uses it.
 */
const CHARACTERS = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('emitBlob', () => {
  it('has more than one character to check', () => {
    // Guards the glob itself: a pattern that silently matches nothing turns
    // every it.each below into zero tests, which reports as a pass.
    expect(Object.keys(CHARACTERS).length).toBeGreaterThan(1);
  });

  it.each(Object.entries(CHARACTERS))('round-trips %s to an identical document', (_name, text) => {
    expect(emitBlob(parseBlob(text))).toBe(text.trimEnd() + '\n');
  });

  it.each(Object.entries(CHARACTERS))('is idempotent on %s — parse(emit(parse(x))) emits the same text', (_name, text) => {
    const once = emitBlob(parseBlob(text));
    expect(emitBlob(parseBlob(once))).toBe(once);
  });

  // The whole reason trivia exists. troll.wam and body.ts are half reasoning.
  it.each(Object.entries(CHARACTERS))('preserves every comment line in %s', (_name, text) => {
    const comments = (t: string) => t.split('\n').filter(l => l.trim().startsWith('#'));
    expect(comments(emitBlob(parseBlob(text)))).toEqual(comments(text));
  });

  it('writes tuned face parameters back into the face block', () => {
    const out = emitBlob(parseBlob(src), { face: { headRadius: 0.131 } });
    expect(out).toContain('headRadius 0.131');
    expect(out).not.toContain('headRadius 0.118');
  });

  it('leaves the rest of the document untouched when only the face changed', () => {
    const out = emitBlob(parseBlob(src), { face: { headRadius: 0.131 } });
    const bodyOf = (t: string) => t.slice(t.indexOf('body'), t.indexOf('face'));
    expect(bodyOf(out)).toBe(bodyOf(src));
  });

  // The REAL GAP: trivia after the LAST significant line had no "next line"
  // to hang off, so `tokenize` silently dropped it before this task's fix to
  // `trailingTrivia`. A `.blob` file ending in a comment (with a blank line
  // before it, the way a human would actually write one) must not lose it.
  it('preserves a comment and blank line after the last significant line', () => {
    const withTrailingComment =
      'model tiny\nskeleton\n  root pelvis at 0.5\nbody\nface\n  headRadius 0.1\n\n' +
      '# remember to retune this before shipping\n';
    const doc = parseBlob(withTrailingComment);
    // The final `''` here is not a second real trailing blank line — it's
    // the artifact of `src.split('\n')` on a string that itself ends in
    // `\n`. `emitBlob`'s `trimEnd()` absorbs it; asserting on the raw field
    // here (rather than just the emitted text) is what actually pins down
    // that `trailingTrivia` got populated at all, not just that the final
    // `trimEnd()` happened to paper over an empty result.
    expect(doc.trailingTrivia).toEqual(['', '# remember to retune this before shipping', '']);
    const out = emitBlob(doc);
    expect(out).toBe(withTrailingComment);
  });
});
