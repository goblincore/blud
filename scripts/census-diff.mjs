// scripts/census-diff.mjs
//
// THE REPEATABILITY GATE (determinism stage 1). Reads one or more bench.json
// files and reports whether the WORKLOAD was the same in every repeat of every
// leg — because a perf delta measured across a changing workload is measuring
// the scenario, not the change.
//
// WHY THIS EXISTS, in the project's own numbers. Across identical legs of runs
// taken minutes apart, the bench census records:
//
//   room 4 fire   bodies   4 -> 4     in one run, 4 -> 2     in another
//   room 4 fire   droplets 0 -> 69    in one run, 0 -> 222   in another
//   room 3 fire   gooQuads 0 -> 272   vs 0 -> 289 vs 0 -> 406
//
// Three of six bench sessions this week were unusable (worst repeat spreads
// 116%, 116%, 187% against 19%/23% and 1% on quiet windows), and machine load
// was not the only cause: even a quiet machine re-performs the scenario
// slightly differently each time, because the simulation still reads wall-clock
// time and unseeded randomness in places.
//
// So the gate is: for a scenario that CLAIMS to be scripted, the census of one
// repeat must equal the census of every other repeat of that same leg and room.
// Any difference is a repeatability failure, reported with the field and both
// values, before any timing number is believed.
//
// Usage:
//   node scripts/census-diff.mjs <bench.json> [more.json ...]
//   node scripts/census-diff.mjs /tmp/sdf-bench-A/passes.json /tmp/sdf-bench-B/passes.json
//
// Exit code is 1 when any drift is found, so it can gate a script.

import { readFileSync } from 'node:fs';

/**
 * Pull the per-segment census out of one bench document.
 *
 * @returns {Map<string, Record<string, {first: object, last: object}>>}
 *   key = `<leg>/<room>/rep<rep>`, value = segment name -> its census.
 */
export function collectCensus(doc) {
  const out = new Map();
  const results = Array.isArray(doc?.results) ? doc.results : [];
  for (const r of results) {
    const key = `${r.leg}/room${r.room}/rep${r.rep}`;
    const segs = {};
    for (const s of r.segments ?? []) {
      if (s && s.census) segs[s.name] = s.census;
    }
    out.set(key, segs);
  }
  return out;
}

/**
 * Compare the repeats of every (leg, room) and list what drifted.
 *
 * Compares EVERY key present in the census object rather than a hardcoded list,
 * so a field added to the bench later is covered without editing this file.
 *
 * @returns {Array<{leg, room, segment, field, values, reps}>} one entry per
 *   (leg, room, segment, field) whose value is not the same in every repeat.
 */
export function diffCensus(doc) {
  const census = collectCensus(doc);
  // Group the rep keys back by leg+room, preserving repeat order.
  const groups = new Map();
  for (const [key, segs] of census) {
    const m = /^(.+)\/room(\d+)\/rep(\d+)$/.exec(key);
    if (!m) continue;
    const gk = `${m[1]}/room${m[2]}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push({ rep: Number(m[3]), segs });
  }

  const drift = [];
  for (const [gk, entries] of groups) {
    if (entries.length < 2) continue;               // nothing to compare
    entries.sort((a, b) => a.rep - b.rep);
    const [leg, roomStr] = [gk.slice(0, gk.lastIndexOf('/room')), gk.slice(gk.lastIndexOf('/room') + 5)];
    const segments = new Set(entries.flatMap((e) => Object.keys(e.segs)));
    for (const segment of segments) {
      // Only compare repeats that actually ran this segment.
      const present = entries.filter((e) => e.segs[segment]);
      if (present.length < 2) continue;
      const fields = new Set(present.flatMap((e) => Object.keys(e.segs[segment].first ?? {})));
      for (const field of fields) {
        const values = present.map((e) => e.segs[segment].first?.[field]);
        const lastValues = present.map((e) => e.segs[segment].last?.[field]);
        const firstSame = values.every((v) => same(v, values[0]));
        const lastSame = lastValues.every((v) => same(v, lastValues[0]));
        if (firstSame && lastSame) continue;
        drift.push({
          leg, room: Number(roomStr), segment, field,
          values, lastValues, reps: present.map((e) => e.rep),
        });
      }
    }
  }
  return drift;
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;

/**
 * FRAME-HASH DRIFT — the frame-level companion to the census gate
 * (deterministic demo recordings stage 2, 2026-09-10).
 *
 * The census counts what the page CONTAINS; the frame hash digests what it
 * RENDERS. They fail differently on purpose:
 *   - the census cannot see a zeroed probe layer or a mistranscribed shader,
 *     both of which shipped on 2026-09-10 and were caught by playtesting;
 *   - the hash cannot see a droplet count that changed without changing a pixel.
 * Two repeats of one leg that render differently were never measuring one
 * workload, whatever the census says — so this reports the same class of defect
 * from the other side.
 *
 * Skips legs whose page supplied no hash (an older page, or a leg that ran
 * before the seam existed) rather than treating absence as drift.
 *
 * @returns {Array<{leg, room, layer, reps, hashes, stats}>} one entry per
 *   (leg, room, layer) whose digest is not the same in every repeat.
 */
export function diffFrameHash(doc) {
  const results = Array.isArray(doc?.results) ? doc.results : [];
  const groups = new Map();
  for (const r of results) {
    if (!r?.endHash?.layers) continue;
    const gk = `${r.leg}/room${r.room}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push({ rep: r.rep, layers: r.endHash.layers, tiles: r.endHash.tiles });
  }

  const drift = [];
  for (const [gk, entries] of groups) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.rep - b.rep);
    const leg = gk.slice(0, gk.lastIndexOf('/room'));
    const room = Number(gk.slice(gk.lastIndexOf('/room') + 5));
    const layers = new Set(entries.flatMap((e) => Object.keys(e.layers)));
    for (const layer of layers) {
      const present = entries.filter((e) => e.layers[layer]);
      if (present.length < 2) continue;
      const hashes = present.map((e) => e.layers[layer].hash);
      const floats = present.map((e) => e.layers[layer].floats);
      if (hashes.every((h) => same(h, hashes[0])) && floats.every((f) => same(f, floats[0]))) continue;
      // Report the ACTIVITY STATS alongside, because those are what name the
      // cause: the black-silhouette regression read as "nonzero 190 → 0", not
      // as "the hash changed".
      const statKeys = new Set(present.flatMap((e) => Object.keys(e.layers[layer].stats ?? {})));
      const stats = {};
      for (const k of statKeys) {
        const vals = present.map((e) => e.layers[layer].stats?.[k]);
        if (!vals.every((v) => same(v, vals[0]))) stats[k] = vals;
      }
      drift.push({ leg, room, layer, reps: present.map((e) => e.rep), hashes, stats });
    }
  }
  return drift;
}

/** Human-readable frame-hash report. Returns the number of drifted entries. */
export function reportFrameHashDrift(path, doc, log = console.log) {
  const drift = diffFrameHash(doc);
  const withHash = (Array.isArray(doc?.results) ? doc.results : []).filter((r) => r?.endHash?.layers).length;
  log(`\n=== ${path} — frame hash`);
  if (withHash === 0) {
    log('    no leg reported an end-of-leg frame hash (older page, or the seam is off).');
    return 0;
  }
  log(`    ${withHash} leg-run(s) hashed`);
  if (drift.length === 0) {
    log('    FRAME HASH IDENTICAL across repeats — the same leg rendered the same frame.');
    return 0;
  }
  log(`    FRAME HASH DRIFTED in ${drift.length} layer(s) — the same leg rendered DIFFERENT frames:`);
  for (const d of drift) {
    log(`      ${d.leg}/room${d.room} ${d.layer}`);
    log(`        hash: ${d.hashes.map((h, i) => `rep${d.reps[i]}=${h}`).join('  ')}`);
    for (const [k, vals] of Object.entries(d.stats)) {
      log(`        ${k}: ${vals.map((v, i) => `rep${d.reps[i]}=${v}`).join('  ')}`);
    }
  }
  return drift.length;
}

/** Human-readable report. Returns the number of drifted fields. */
export function reportCensusDrift(path, doc, log = console.log) {
  const drift = diffCensus(doc);
  const results = Array.isArray(doc?.results) ? doc.results : [];
  const legs = [...new Set(results.map((r) => `${r.leg}/room${r.room}`))].sort();
  log(`\n=== ${path}`);
  log(`    ${results.length} leg-runs, ${legs.length} leg/room group(s)`);
  if (drift.length === 0) {
    log('    CENSUS IDENTICAL across repeats — the scenario is repeatable.');
    return 0;
  }
  log(`    CENSUS DRIFTED in ${drift.length} field(s) — the workload was NOT the same:`);
  for (const d of drift) {
    log(`      ${d.leg}/room${d.room} ${d.segment}.${d.field}`);
    log(`        first: ${d.values.map((v, i) => `rep${d.reps[i]}=${v}`).join('  ')}`);
    const lastDiffers = !d.lastValues.every((v) => same(v, d.lastValues[0]));
    if (lastDiffers) log(`        last:  ${d.lastValues.map((v, i) => `rep${d.reps[i]}=${v}`).join('  ')}`);
  }
  return drift.length;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/census-diff.mjs <bench.json> [more.json ...]');
    process.exit(2);
  }
  let total = 0;
  for (const f of files) {
    try {
      const doc = JSON.parse(readFileSync(f, 'utf8'));
      total += reportCensusDrift(f, doc);
      total += reportFrameHashDrift(f, doc);
    } catch (e) {
      console.error(`could not read ${f}: ${e.message}`);
      total += 1;
    }
  }
  console.log(`\n${total === 0 ? 'PASS' : 'FAIL'}: ${total} drifted field(s) across ${files.length} document(s).`);
  process.exit(total === 0 ? 0 : 1);
}
