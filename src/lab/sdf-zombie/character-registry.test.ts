// src/lab/sdf-zombie/character-registry.test.ts
import { describe, it, expect } from 'vitest';
import {
  CHARACTERS, characterEntry, characterNames, hasCharacter,
} from './character-registry';
import { parseBlob } from './blob-parse';

describe('character-registry', () => {
  it('every registered name resolves to a parseable blob', () => {
    for (const name of characterNames()) {
      const e = characterEntry(name);
      expect(() => parseBlob(e.src), `${name} failed to parse`).not.toThrow();
    }
  });

  it('every character with a kit has a motion profile that is not the zombie default', () => {
    // A kit rides the RIG, and a body with the zombie's profile has no rig
    // points the kit's bones can name. This pairing is a real constraint, not
    // a tidiness rule.
    for (const name of characterNames()) {
      const e = characterEntry(name);
      if (!e.kit) continue;
      expect(e.profile.name, `${name} has a kit but the default profile`).toBe(name);
    }
  });

  it('every profile that declares carries also declares a prop', () => {
    for (const name of characterNames()) {
      const p = characterEntry(name).profile;
      if (!p.carries) continue;
      expect(p.prop, `${name} carries but has no prop`).toBeDefined();
    }
  });

  it('an unknown name is a LOUD error, never a silent zombie', () => {
    // This is lab-main's existing bug, fixed by construction: it renders the
    // zombie for any character not hand-listed, so a typo or a new .blob that
    // was never registered looks like a rendering fault instead of a lookup
    // miss. Every recorded bug in this area has been a lookup miss.
    expect(() => characterEntry('no-such-character')).toThrow(/unknown character/i);
  });

  it('hasCharacter is the guard for untrusted input, and does not throw', () => {
    // URL params are untrusted; ?character=garbage must fall back, not crash.
    expect(hasCharacter('zombie')).toBe(true);
    expect(hasCharacter('no-such-character')).toBe(false);
  });

  it('the registry is the single list — no name appears twice', () => {
    const names = characterNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes every character the lab shipped', () => {
    for (const n of ['zombie', 'goblin', 'clown', 'soldier', 'schoolgirl', 'female']) {
      expect(hasCharacter(n), `${n} missing from the registry`).toBe(true);
    }
  });
});
