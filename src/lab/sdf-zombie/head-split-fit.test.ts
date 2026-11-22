// src/lab/sdf-zombie/head-split-fit.test.ts
//
// THE HEADS THE PRESETS FIT (head-split.ts SPLIT_HEADS). The presets' hinges are metres in the head's frame, measured
// on the zombie, and what turns with a half is the flesh above the hinge plane within rho of the hinge. On a head
// they fit, the head's own flesh on a moving side lies inside that ball (flesh outside it stays behind: the crown that
// tore, head-split.ts headFrameOf) and none of the rest of the body does (it would ride off with a half). Measured on
// each character as it is built and rigged at rest, by sampling: a grid round the skull, each sample inside the head
// cluster's field or the rest of the body's.
import { describe, expect, it } from 'vitest';
import { characterEntry, characterNames } from './character-registry';
import { buildCharacterBody } from './webgpu/character-view';
import { headShape } from './webgpu/flame-anchors';
import { REGION_MARGIN, SPLIT_HEADS, forcedSplit, headFrameOf, splitHold, splitWarpOf, splitsHead, type SplitPresetId } from './head-split';
import { applyRig, bindRig, headQuatOf } from './rig-bind';
import { sdBodyClosed } from './validate';
import { cross, dot, len, sub } from './vec';
import type { BuildResult } from './build-body';
import type { Vec3 } from './types';

/** The body with only the head cluster alive (`head`), or only the rest. */
const part = (b: BuildResult, head: boolean): BuildResult =>
  ({ ...b, clusters: b.clusters.map(c => ({ ...c, alive: c.alive && (c.limb === 'head') === head })) });

/** Of the head's flesh on the sides that turn, the share that lies outside the hold ball (stays behind), and the rest
 *  of the body that lies inside it (rides off), as a share of the same: for the preset, sides and plane offset (a
 *  share of the skull's half-width), under the head's own hold unless `hold` says otherwise. */
function fit(name: string, preset: SplitPresetId, sides: -1 | 0 | 1, offsetFrac: number, hold = splitHold(name), stepM = 0.008) {
  const raw = buildCharacterBody(characterEntry(name), [0, 0, 0], []);
  const bound = bindRig(raw);
  const posed = applyRig(raw, bound, 0);
  const s = headShape(posed)!;
  const frame = headFrameOf(s, headQuatOf(bound, 0) ?? [0, 0, 0, 1], hold);
  const w = splitWarpOf(forcedSplit(preset, sides, offsetFrac * s.axes[0], 1)!, frame)!;
  const H = part(posed, true), B = part(posed, false);
  const u = cross(w.n, w.a), rho = w.r - REGION_MARGIN, half = 2 * frame.radius + 0.12;
  let moving = 0, left = 0, dragged = 0;
  for (let x = -half; x <= half; x += stepM) for (let y = -half; y <= half; y += stepM) for (let z = -half; z <= half; z += stepM) {
    const q: Vec3 = [s.centre[0] + x, s.centre[1] + y, s.centre[2] + z];
    if (dot(u, sub(q, w.h)) <= 0) continue;
    const sd = dot(w.n, q) - w.d0;
    if (!((w.thetaP !== 0 && sd >= 0) || (w.thetaM !== 0 && sd < 0))) continue;
    const inRho = len(sub(q, w.h)) <= rho;
    if (sdBodyClosed(q, H) < 0) { if (inRho) moving++; else left++; }
    else if (inRho && sdBodyClosed(q, B) < 0) dragged++;
  }
  const head = moving + left;
  return { head, left: left / head, dragged: dragged / head };
}

const CASES: [string, SplitPresetId, -1 | 0 | 1, number][] = [
  ['middle, both halves', 'middle', 0, 0], ['middle, + side', 'middle', 1, 0.4], ['middle, - side', 'middle', -1, -0.4],
  ['face', 'face', 1, 0],
];

describe('the heads the presets fit', () => {
  it('SPLIT_HEADS names registered characters, by character: none of the rest, on whatever motion profile or family', () => {
    const names = [...SPLIT_HEADS.keys()];
    for (const n of names) expect(characterNames()).toContain(n);
    expect(names.sort()).toEqual(['soldier', 'zombie']);
    for (const n of characterNames()) expect(splitsHead(n), n).toBe(SPLIT_HEADS.has(n));
    // The soldier's family (the juggernaut and the warbull move on the soldier's rules) and the zombie's profile are
    // not the list.
    expect(splitsHead('juggernaut')).toBe(false);
    expect(splitsHead('warbull')).toBe(false);
    expect(characterEntry('female').profile.name).toBe('zombie');
    expect(splitsHead('female')).toBe(false);
    // The zombie's hold is the one the presets were measured with; a head not on the list has no hold of its own.
    expect(splitHold('zombie')).toBe(1);
    expect(splitHold('female')).toBe(1);
  });

  // Measured (8 mm grid): the zombie 0% / 0% on every case under hold 1. The soldier, under hold 1, up to 0.4% of his
  // turning head behind (the crown of his cap: two chips that floated over the open head in the game); under his hold
  // (1.2; 1.1 is already enough) none, and nothing of his body rides off up to 1.6.
  it.each([...SPLIT_HEADS.keys()])('%s: none of the turning head stays behind, and none of the body rides off with it', name => {
    for (const [label, preset, sides, off] of CASES) {
      const r = fit(name, preset, sides, off);
      expect(r.head, `${name} ${label}`).toBeGreaterThan(100);
      expect(r.left, `${name} ${label}`).toBe(0);
      expect(r.dragged, `${name} ${label}`).toBe(0);
    }
  });

  it('the soldier needs his hold: under the zombie\'s, the crown of his cap stays behind', () => {
    expect(splitHold('soldier')).toBeGreaterThan(1);
    expect(Math.max(...CASES.map(([, preset, sides, off]) => fit('soldier', preset, sides, off, 1).left))).toBeGreaterThan(0.001);
  });

  // THE ROLL-OUT TABLE (docs/dev-notes/2026-11-02-head-split-roll-out.md): every registered character under the zombie's
  // hold, worst case of the four. Off by default (about eight minutes); SPLIT_FIT_SURVEY=1 npx vitest run <this file>.
  it.runIf(!!(import.meta.env as Record<string, string | undefined>).SPLIT_FIT_SURVEY)('survey: every registered character under hold 1', () => {
    const rows = characterNames().map(name => {
      const r = CASES.map(([, preset, sides, off]) => fit(name, preset, sides, off, 1, 0.008));
      const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
      return `${name}\tR ${(headShape(buildCharacterBody(characterEntry(name), [0, 0, 0], []))!.axes.reduce((a, b) => Math.max(a, b)) / 0.137).toFixed(2)}`
        + `\tleft ${pct(Math.max(...r.map(x => x.left)))}\tdragged ${pct(Math.max(...r.map(x => x.dragged)))}`;
    });
    console.log(`\n${rows.join('\n')}`);
  }, 600000);
});
