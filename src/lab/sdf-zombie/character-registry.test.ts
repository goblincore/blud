// src/lab/sdf-zombie/character-registry.test.ts
import { describe, it, expect } from 'vitest';
import {
  CHARACTERS, characterEntry, characterNames, hasCharacter,
} from './character-registry';
import { parseBlob } from './blob-parse';

/** Every PNG actually shipped under public/assets/lab, as the SERVED url
 *  ("/assets/lab/faces/soldier-face.png") — which is the form the registry
 *  stores, so the two are directly comparable.
 *
 *  import.meta.glob rather than node:fs, and not by preference: this suite
 *  runs through Vite and the tsconfig carries only ["vite/client"], so
 *  node:fs, node:path and `process` are untyped and `npm run build` fails on
 *  them. blob-checks.test.ts makes the same choice for the same reason.
 *  Non-eager: the keys are the whole point, and eager would decode every PNG. */
const SHIPPED_FACES: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob('../../../public/assets/lab/**/*.png'))
    .map(p => p.slice(p.indexOf('/public/') + '/public'.length)),
);

describe('character-registry', () => {
  it('every registered name resolves to a parseable blob', () => {
    for (const name of characterNames()) {
      const e = characterEntry(name);
      expect(() => parseBlob(e.src), `${name} failed to parse`).not.toThrow();
    }
  });

  it('every face sheet a character declares actually exists on disk', () => {
    // REPLACES a false invariant (2026-09-06). The original assertion here was
    // "a character with a kit has a bespoke motion profile", justified as "a
    // kit rides the RIG, and a body with the zombie's profile has no rig
    // points the kit's bones can name". That conflates two separate things:
    // the MOTION PROFILE picks which gait drives the body, while the kit rides
    // boneFrames() off the rig regardless. goblin, clown and clown-alt carry
    // kits on the zombie shamble deliberately, and motion-profile.test.ts
    // already PINS motionProfileFor('clown') to ZOMBIE_PROFILE.
    //
    // This is the invariant that pays rent instead. minotaur.blob declares
    // `image minotaur-face.png` and no such file exists — the lab has been
    // 404ing it silently, and a declared-but-missing sheet is exactly the
    // lookup miss this module exists to make loud.
    // KNOWN GAP, recorded rather than fixed (owner's call, 2026-09-06):
    // minotaur.blob:433 declares a PNG that was never baked. Fixing it means
    // either baking the face or deleting the sheet block, and both CHANGE HOW
    // THE MINOTAUR RENDERS — not something to do inside a pure refactor.
    // It stays listed here so the gap is visible in the suite instead of
    // silently 404ing in the lab, and so a SECOND missing face still fails.
    const KNOWN_MISSING = new Set(['minotaur']);

    const missing = characterNames()
      .map(n => ({ name: n, url: characterEntry(n).face.url }))
      .filter(d => !SHIPPED_FACES.has(d.url))
      .filter(d => !KNOWN_MISSING.has(d.name));
    expect(missing.map(m => `${m.name} -> ${m.url}`)).toEqual([]);
  });

  it('the known-missing list is not stale', () => {
    // A gap that gets fixed must leave this list, or the list quietly becomes
    // a place where real regressions hide.
    const url = characterEntry('minotaur').face.url;
    expect(
      SHIPPED_FACES.has(url),
      'minotaur-face.png now exists — drop minotaur from KNOWN_MISSING',
    ).toBe(false);
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
