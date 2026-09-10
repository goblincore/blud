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
      total += reportCensusDrift(f, JSON.parse(readFileSync(f, 'utf8')));
    } catch (e) {
      console.error(`could not read ${f}: ${e.message}`);
      total += 1;
    }
  }
  console.log(`\n${total === 0 ? 'PASS' : 'FAIL'}: ${total} drifted field(s) across ${files.length} document(s).`);
  process.exit(total === 0 ? 0 : 1);
}
