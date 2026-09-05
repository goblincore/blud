// src/lab/sdf-zombie/blob-emit.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { emitBlob } from './blob-emit';
import src from './characters/zombie.blob?raw';
import soldierSrc from './characters/soldier.blob?raw';
import zombieSrc from './characters/zombie.blob?raw';

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

  // The `bones` block (wound pass r2) is a FOURTH block in the sense of the
  // sheetTrivia story above: its part lines ride `bonesBlock.parts[].src` and
  // its `ratio` lines ride `bonesTrivia`, and if either missed the owned list
  // a re-emitted character would keep the `bones` keyword (it lives in
  // `structure`) while silently losing everything under it — compiling fine,
  // wearing auto-derived bones instead of the authored ones. This test is
  // the same guard the shipped-character round trip provides, exercised on
  // the block itself, because no shipped character uses `bones` yet.
  it('round-trips a bones block — parts, ratio and trivia — to identical text', () => {
    const withBones =
      'model tiny\nskeleton\n  root pelvis at 0.5\n  bone skull parent=pelvis dir=up len=0.1\n' +
      'body\n  blob head on skull at=0.5 r=0.1\n' +
      'bones\n  # hand-tuned skull dome, retuned 2026-09\n  ratio 0.25\n' +
      '  blob head on skull at=0.5 r=0.02\n';
    expect(emitBlob(parseBlob(withBones))).toBe(withBones);
  });
});

describe('palette override', () => {
  it('splices only the baseColor value span; every other byte survives', () => {
    const doc = parseBlob(soldierSrc);
    const out = emitBlob(doc, { palette: { baseColor: [0.5, 0.25, 0.125] } });
    const before = soldierSrc.split('\n'), after = out.split('\n');
    expect(after.length).toBe(before.length);
    const changed = before.map((l, i) => [l, after[i]!] as const).filter(([a, b]) => a !== b);
    expect(changed.length).toBe(1);
    expect(changed[0]![0]).toMatch(/^\s*baseColor\s/);
    expect(changed[0]![1]).toMatch(/^\s*baseColor\s+0\.5 0\.25 0\.125\s*$/);
    // Re-parses to the new colour.
    expect(parseBlob(out).palette!.baseColor).toEqual([0.5, 0.25, 0.125]);
  });
  it('an override for a character with no palette block throws loudly', () => {
    expect(() => emitBlob(parseBlob(zombieSrc), { palette: { baseColor: [1, 1, 1] } }))
      .toThrow(/no palette block/);
  });
  it('a wrong arity throws', () => {
    expect(() => emitBlob(parseBlob(soldierSrc), { palette: { baseColor: [1, 1] } })).toThrow(/3 values/);
  });
});
