// scripts/census-diff.test.mjs
//
// Tests for the repeatability gate. It exists because census-diff.mjs is
// load-bearing: it is the assertion determinism stage 1 has to pass, and a gate
// that silently passes everything is worse than no gate. The failure mode to
// guard against is the false NEGATIVE — reporting "census identical" for a run
// whose workload actually drifted — because that is the answer a broken gate
// gives.
//
// Fixtures are synthetic and small; the real-data case (12 drifted fields across
// the two committed runs) is demonstrated by running the CLI, not here, so this
// file stays independent of large committed artifacts.

import { describe, it, expect } from 'vitest';
import { collectCensus, diffCensus, reportCensusDrift, diffFrameHash, reportFrameHashDrift } from './census-diff.mjs';

/** One leg-run, with a census per segment. */
function run(leg, room, rep, segments) {
  return {
    leg, room, rep,
    segments: Object.entries(segments).map(([name, census]) => ({ name, census })),
  };
}

/** A census pair, as the bench writes it: `first` and `last` snapshots. */
const census = (bodies, droplets) => ({
  first: { bodies, droplets },
  last: { bodies, droplets },
});

describe('collectCensus', () => {
  it('keys leg-runs by leg, room and repeat', () => {
    const doc = { results: [run('baseline', 4, 0, { fire: census(4, 0) })] };
    const c = collectCensus(doc);
    expect([...c.keys()]).toEqual(['baseline/room4/rep0']);
    expect(c.get('baseline/room4/rep0').fire).toEqual(census(4, 0));
  });

  it('survives missing results, missing segments and missing census', () => {
    expect(collectCensus({}).size).toBe(0);
    expect(collectCensus({ results: [] }).size).toBe(0);
    const doc = { results: [{ leg: 'a', room: 1, rep: 0, segments: [{ name: 'walk' }, null] }] };
    expect(collectCensus(doc).get('a/room1/rep0')).toEqual({});
  });
});

describe('diffCensus — the gate must not pass a drifted workload', () => {
  it('reports NOTHING when every repeat agrees', () => {
    const doc = { results: [
      run('baseline', 4, 0, { fire: census(4, 100) }),
      run('baseline', 4, 1, { fire: census(4, 100) }),
      run('baseline', 4, 2, { fire: census(4, 100) }),
    ] };
    expect(diffCensus(doc)).toEqual([]);
  });

  it('CATCHES drift in a `last` snapshot even when every `first` agrees', () => {
    // This is the real shape: the legs start identically and diverge. A gate
    // that only compared `first` would pass the entire real dataset.
    const doc = { results: [
      run('baseline', 4, 0, { fire: { first: { bodies: 4, droplets: 0 }, last: { bodies: 2, droplets: 222 } } }),
      run('baseline', 4, 1, { fire: { first: { bodies: 4, droplets: 0 }, last: { bodies: 4, droplets: 74 } } }),
      run('baseline', 4, 2, { fire: { first: { bodies: 4, droplets: 0 }, last: { bodies: 3, droplets: 53 } } }),
    ] };
    const drift = diffCensus(doc);
    const fields = drift.map((d) => d.field).sort();
    expect(fields).toEqual(['bodies', 'droplets']);
    const droplets = drift.find((d) => d.field === 'droplets');
    expect(droplets.values).toEqual([0, 0, 0]);          // firsts agree
    expect(droplets.lastValues).toEqual([222, 74, 53]);  // lasts do not
    expect(droplets.reps).toEqual([0, 1, 2]);
    expect(droplets.room).toBe(4);
    expect(droplets.segment).toBe('fire');
  });

  it('CATCHES drift in a `first` snapshot too', () => {
    const doc = { results: [
      run('baseline', 3, 0, { gib: census(1, 30) }),
      run('baseline', 3, 1, { gib: census(0, 67) }),
    ] };
    const drift = diffCensus(doc);
    expect(drift.map((d) => d.field).sort()).toEqual(['bodies', 'droplets']);
  });

  it('compares EVERY field present, not a hardcoded list', () => {
    // A field added to the bench later must be covered without editing the tool.
    const doc = { results: [
      run('baseline', 4, 0, { fire: { first: { someNewMetric: 1 }, last: { someNewMetric: 1 } } }),
      run('baseline', 4, 1, { fire: { first: { someNewMetric: 9 }, last: { someNewMetric: 1 } } }),
    ] };
    expect(diffCensus(doc).map((d) => d.field)).toEqual(['someNewMetric']);
  });

  it('says nothing when there is only ONE repeat — nothing to compare', () => {
    const doc = { results: [run('baseline', 4, 0, { fire: census(4, 0) })] };
    expect(diffCensus(doc)).toEqual([]);
  });

  it('does not confuse different legs or rooms with each other', () => {
    // Same numbers, different groups: identical within each, so no drift.
    const doc = { results: [
      run('baseline', 3, 0, { fire: census(6, 30) }),
      run('baseline', 3, 1, { fire: census(6, 30) }),
      run('cone-on', 3, 0, { fire: census(6, 30) }),
      run('cone-on', 3, 1, { fire: census(6, 30) }),
    ] };
    expect(diffCensus(doc)).toEqual([]);
  });

  it('compares only the repeats that actually ran a segment', () => {
    // A leg-run that skipped the segment must not make the others look drifted.
    const doc = { results: [
      run('baseline', 4, 0, { fire: census(4, 100) }),
      run('baseline', 4, 1, {}),
      run('baseline', 4, 2, { fire: census(4, 100) }),
    ] };
    expect(diffCensus(doc)).toEqual([]);
  });
});

describe('reportCensusDrift — the human-facing verdict', () => {
  const lines = (doc) => {
    const out = [];
    const n = reportCensusDrift('/tmp/fake.json', doc, (...a) => out.push(a.join(' ')));
    return { n, text: out.join('\n') };
  };

  it('reports PASS and returns 0 for a repeatable run', () => {
    const doc = { results: [
      run('baseline', 4, 0, { fire: census(4, 100) }),
      run('baseline', 4, 1, { fire: census(4, 100) }),
    ] };
    const { n, text } = lines(doc);
    expect(n).toBe(0);
    expect(text).toContain('CENSUS IDENTICAL');
  });

  it('reports FAIL, names the field, and shows every repeat value', () => {
    const doc = { results: [
      run('baseline', 4, 0, { fire: census(4, 222) }),
      run('baseline', 4, 1, { fire: census(4, 74) }),
    ] };
    const { n, text } = lines(doc);
    // bodies is 4 in both repeats, so ONLY droplets drifts — and because both
    // snapshots carry it, it is reported once with both value lists.
    expect(n).toBe(1);
    expect(text).toContain('CENSUS DRIFTED');
    expect(text).toContain('baseline/room4 fire.droplets');
    expect(text).toContain('rep0=222');
    expect(text).toContain('rep1=74');
  });
});

// --- FRAME-HASH DRIFT (deterministic demo recordings stage 2, 2026-09-10) ----
//
// The census gate and the frame-hash gate fail differently on purpose, and the
// failure mode to guard here is the same one: a false NEGATIVE that reports
// "identical" for a run whose frames actually differed. The regression this
// exists for is the zeroed dynamic probe layer that rendered characters as
// black silhouettes — two repeats of one leg whose probeDyn digests differ.

/** One leg-run carrying an end-of-leg frame hash. */
function hashedRun(leg, room, rep, layers) {
  const tiles = {};
  for (const key of Object.keys(layers)) tiles[key] = [1, 2, 3, 4];
  return { leg, room, rep, segments: [], endHash: { version: 1, frame: 42, tilesX: 2, tilesY: 2, layers, tiles } };
}

const layer = (hash, nonZero) => ({ hash, width: 4, height: 4, floats: 64, stats: { nonZero } });

describe('diffFrameHash', () => {
  it('reports nothing when every repeat of a leg hashed the same', () => {
    const doc = { results: [
      hashedRun('baseline', 4, 0, { marchTarget: layer(111, 10), probeDyn: layer(222, 32) }),
      hashedRun('baseline', 4, 1, { marchTarget: layer(111, 10), probeDyn: layer(222, 32) }),
    ] };
    expect(diffFrameHash(doc)).toEqual([]);
  });

  it('catches a ZEROED DYNAMIC PROBE LAYER and reports the stat that names it', () => {
    // The shipped bug, as a fixture: same census, same bodies, same droplets —
    // only the rendered frame differs, which is exactly why the census missed it.
    const doc = { results: [
      hashedRun('baseline', 4, 0, { marchTarget: layer(111, 10), probeDyn: layer(222, 6376) }),
      hashedRun('baseline', 4, 1, { marchTarget: layer(111, 10), probeDyn: layer(999, 0) }),
    ] };
    const drift = diffFrameHash(doc);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ leg: 'baseline', room: 4, layer: 'probeDyn' });
    // The march target is UNCHANGED here, so it must not be blamed.
    expect(drift[0].stats).toEqual({ nonZero: [6376, 0] });
  });

  it('treats a size change as drift even when the hash collides', () => {
    const doc = { results: [
      hashedRun('baseline', 4, 0, { marchTarget: layer(111, 10) }),
      hashedRun('baseline', 4, 1, { marchTarget: { ...layer(111, 10), floats: 128 } }),
    ] };
    expect(diffFrameHash(doc)).toHaveLength(1);
  });

  it('ignores legs with no hash rather than calling absence drift', () => {
    const doc = { results: [
      { leg: 'baseline', room: 4, rep: 0, segments: [] },
      hashedRun('baseline', 4, 1, { marchTarget: layer(111, 10) }),
    ] };
    expect(diffFrameHash(doc)).toEqual([]);
  });

  it('needs at least two hashed repeats before it can say anything', () => {
    const doc = { results: [hashedRun('baseline', 4, 0, { marchTarget: layer(111, 10) })] };
    expect(diffFrameHash(doc)).toEqual([]);
  });
});

describe('reportFrameHashDrift', () => {
  const lines = (doc) => {
    const out = [];
    const n = reportFrameHashDrift('t.json', doc, (...a) => out.push(a.join(' ')));
    return { n, text: out.join('\n') };
  };

  it('says so explicitly when no leg hashed, so silence is not read as a pass', () => {
    const { n, text } = lines({ results: [{ leg: 'baseline', room: 4, rep: 0, segments: [] }] });
    expect(n).toBe(0);
    expect(text).toContain('no leg reported an end-of-leg frame hash');
  });

  it('reports FAIL with every repeat value and the naming stat', () => {
    const doc = { results: [
      hashedRun('baseline', 4, 0, { probeDyn: layer(222, 6376) }),
      hashedRun('baseline', 4, 1, { probeDyn: layer(999, 0) }),
    ] };
    const { n, text } = lines(doc);
    expect(n).toBe(1);
    expect(text).toContain('FRAME HASH DRIFTED');
    expect(text).toContain('baseline/room4 probeDyn');
    expect(text).toContain('rep0=222');
    expect(text).toContain('rep1=999');
    expect(text).toContain('nonZero: rep0=6376  rep1=0');
  });

  it('passes with an explicit identical message', () => {
    const doc = { results: [
      hashedRun('baseline', 4, 0, { marchTarget: layer(111, 10) }),
      hashedRun('baseline', 4, 1, { marchTarget: layer(111, 10) }),
    ] };
    const { n, text } = lines(doc);
    expect(n).toBe(0);
    expect(text).toContain('FRAME HASH IDENTICAL');
  });
});
