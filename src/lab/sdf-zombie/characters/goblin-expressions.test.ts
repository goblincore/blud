// src/lab/sdf-zombie/characters/goblin-expressions.test.ts
import { describe, it, expect } from 'vitest';
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './goblin-expressions';
import { expressionsFor } from '../expression-library';
import { expressionAt, actuate, CHANNEL_NAMES } from '../expression';
import { JAW_MAX_GAPE } from '../jaw';
import { compileSheet } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import goblinSrc from './goblin.blob?raw';

const authored = compileSheet(parseBlob(goblinSrc))!;

describe('goblin expressions', () => {
  it('are registered for the goblin and no one else', () => {
    expect(expressionsFor('goblin')?.clips).toBe(GOBLIN_EXPRESSIONS);
    expect(expressionsFor('goblin')?.tuning).toBe(GOBLIN_EXPRESSION_TUNING);
    expect(Object.keys(GOBLIN_EXPRESSIONS).sort()).toEqual(['grin', 'neutral', 'scowl', 'shout']);
    expect(expressionsFor('zombie')).toBeNull();
  });

  it('never asks the jaw for more than jaw.ts allows', () => {
    expect(GOBLIN_EXPRESSION_TUNING.maxGape).toBeLessThanOrEqual(JAW_MAX_GAPE);
  });

  it.each(Object.values(GOBLIN_EXPRESSIONS).map(c => [c.name, c] as const))('%s: keys ascend and every channel stays in range', (_n, clip) => {
    for (let i = 1; i < clip.keys.length; i++) expect(clip.keys[i]!.t).toBeGreaterThan(clip.keys[i - 1]!.t);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const c = expressionAt(clip, (end * k) / 10);
      for (const name of CHANNEL_NAMES) expect(Number.isFinite(c[name]), `${clip.name} ${name}`).toBe(true);
      expect(c.gape).toBeGreaterThanOrEqual(0); expect(c.gape).toBeLessThanOrEqual(1);
      expect(Math.abs(c.smile)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.browDown)).toBeLessThanOrEqual(1);
    }
  });

  it('neutral is the authored face: no gape, the sheet unchanged', () => {
    const a = actuate(expressionAt(GOBLIN_EXPRESSIONS.neutral!, 5), authored, GOBLIN_EXPRESSION_TUNING);
    expect(a.jawGape).toBe(0);
    expect(a.sheet).toEqual({ ...authored, eyeLid: 0 });
  });

  it('grin opens the jaw a little and smiles; shout opens it wide; scowl frowns and lowers the brow', () => {
    const at = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), authored, GOBLIN_EXPRESSION_TUNING);
    const grin = at('grin'), shout = at('shout'), scowl = at('scowl');
    expect(grin.jawGape).toBeGreaterThan(0.05);
    expect(grin.jawGape).toBeLessThan(shout.jawGape);
    expect(grin.sheet.mouthCurve).toBeLessThan(authored.mouthCurve);       // more of a smile
    expect(shout.jawGape).toBeGreaterThan(0.35);
    expect(scowl.sheet.mouthCurve).toBeGreaterThan(authored.mouthCurve);   // frown
    expect(scowl.sheet.browAngle).toBeGreaterThan(authored.browAngle);
  });
});
