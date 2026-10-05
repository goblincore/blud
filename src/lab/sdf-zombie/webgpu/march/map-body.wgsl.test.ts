// src/lab/sdf-zombie/webgpu/march/map-body.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `map-body`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, MAP_BODY, MARCH_BODY } from '../march.wgsl';
import { REGION_MARGIN } from '../../head-split';
import { declaredName } from '../march-test-support';

describe('ported features reach the entry point', () => {
  it('carves, wounds and their masks are all called from the march', () => {
    // mapBody folds carves then wounds; the shading reads the two masks.
    expect(MARCH_BODY).toContain('woundMask');
    expect(MARCH_BODY).toContain('charMask');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    expect(mapBody).toContain('applyCarves');
    expect(mapBody).toContain('applyWounds');
  });

  it('applies wounds AFTER carves, as the GLSL does', () => {
    // Carves are part of the body's own definition; wounds are damage stamped
    // on the finished body. Swapping them changes the surface everywhere,
    // because the smooth-min fold is not associative.
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    expect(mapBody.indexOf('applyCarves')).toBeLessThan(mapBody.indexOf('applyWounds'));
  });
});

// THE HEAD SPLIT: what can be said of the slot's STRUCTURE from text (the loader gate, the piece order and early skip,
// where the caps and the shell go, the hit bookkeeping, the continue / break audit). What the pieces COMPUTE is tested
// by value in map-body-split-twin.test.ts, a hand twin of this WGSL run against head-split.ts splitField; the terms'
// text is held by the march golden snapshot.
describe('the head split in mapBody (head-split.ts splitField)', () => {
  const M = `${REGION_MARGIN}`;
  const code = MAP_BODY.replace(/\/\/[^\n]*/g, '');

  it('the slot is closed unless its record carries a plane normal, and a closed slot is one uncapped piece at pIn', () => {
    expect(MAP_BODY).toMatch(/^fn mapBody\(pIn: vec3<f32>, /);
    // The open test is loadInstance's (gInstSplitOpen, groups.wgsl.ts); mapBody does not make its own.
    expect(MAP_BODY).toContain('let splitOpen = gInstSplitOpen;');
    expect(MAP_BODY).toContain('var splitShell = 1e9;');
    expect(MAP_BODY).toContain('var pcA = vec3<f32>(-1e9, 0.0, 0.0);');
    expect(MAP_BODY).toContain('var pcB = vec3<f32>(1e9, 0.0, 1.0);');
    expect(MAP_BODY).toContain('var pcC = vec3<f32>(1e9, 0.0, 2.0);');
    // Every split read sits behind splitOpen, or behind a piece angle only an open slot can set.
    const setup = code.slice(code.indexOf('if (splitOpen) {'), code.indexOf('for (var pc = 0;'));
    const rest = code.replace(setup, '');
    expect(rest.match(/gInstSplit[NHAR]/g)).toEqual(['gInstSplitH', 'gInstSplitA']);
    expect(rest).toContain('if (piece.y != 0.0) { pMoved = splitMoveBack(pIn, gInstSplitH.xyz, gInstSplitA.xyz, piece.y); }');
    // The region margin comes from head-split.ts by interpolation, never as a literal.
    expect(MAP_BODY).toContain(`let spRho = gInstSplitR.x - ${M};`);
    expect(MAP_BODY).toContain(`splitShell = ${M} + abs(spDh - gInstSplitR.x);`);
    // The caps and the shell touch the result only for an open slot.
    expect(MAP_BODY).toContain('if (splitOpen) { dPiece = max(dmgFinal, piece.x); }');
    expect(MAP_BODY).toContain('if (splitOpen) { dUnion = min(dUnion, splitShell); }');
  });

  it('visits the pieces in ascending cap order (an unrolled compare-swap) and stops at the first cap that cannot win', () => {
    const iSort = MAP_BODY.indexOf('if (pcB.x < pcA.x) { let sw = pcA; pcA = pcB; pcB = sw; }');
    const iSort2 = MAP_BODY.indexOf('if (pcC.x < pcB.x) { let sw = pcB; pcB = pcC; pcC = sw; }');
    const iSort3 = MAP_BODY.indexOf('if (pcB.x < pcA.x) { let sw = pcA; pcA = pcB; pcB = sw; }', iSort2);
    const iLoop = MAP_BODY.indexOf('for (var pc = 0; pc < 3; pc = pc + 1) {');
    // The halves are pieces only inside the region sphere; the rest's cap is set last, before the sort.
    expect(MAP_BODY.indexOf('if (spDh <= gInstSplitR.x) {')).toBeLessThan(MAP_BODY.indexOf('pcA.x = cap0;'));
    expect(iSort).toBeGreaterThan(MAP_BODY.indexOf('pcA.x = cap0;'));
    expect(iSort2).toBeGreaterThan(iSort);
    expect(iSort3).toBeGreaterThan(iSort2);
    expect(iLoop).toBeGreaterThan(iSort3);
    const head = MAP_BODY.slice(iLoop, MAP_BODY.indexOf('var d = 1e9;', iLoop)).replace(/\/\/[^\n]*\n/g, '');
    expect(head).toContain('let piece = select(select(pcC, pcB, pc == 1), pcA, pc == 0);');
    // max(f, cap) >= cap, so a cap at or over the best so far (the union's, or the shell) cannot win: exact.
    expect(head).toContain('if (piece.x >= min(dUnion, splitShell)) { break; }');
    expect(head).toContain('let p = pMoved;');
    // No private array rides the piece order (the Metal compile hang rule).
    expect(MAP_BODY.slice(MAP_BODY.indexOf('let splitOpen'), iLoop)).not.toMatch(/array</);
  });

  it('caps the piece after the whole slot body (wounds, bones, noise) and unions it like a slot', () => {
    const iLoop = MAP_BODY.indexOf('for (var pc = 0; pc < 3; pc = pc + 1) {');
    const iCap = MAP_BODY.indexOf('if (splitOpen) { dPiece = max(dmgFinal, piece.x); }');
    const iUnion = MAP_BODY.indexOf('if (dPiece < dUnion) {');
    const iShell = MAP_BODY.indexOf('if (splitOpen) { dUnion = min(dUnion, splitShell); }');
    for (const inside of ['var d = 1e9;', 'gFoldBest = 1e9;', 'gWoundOwners = 0u;', 'let carved = applyCarves(d, p, data, counts, band);',
      'applyBones(dmg, p, data, counts, counts2.x, band, segVolumeAtlas, segVolumeMeta)', 'dmgFinal = dmg + fbm(anchor * 3.0) * noiseCfg.x;']) {
      expect(MAP_BODY.indexOf(inside), inside).toBeGreaterThan(iLoop);
      expect(MAP_BODY.indexOf(inside), inside).toBeLessThan(iCap);
    }
    expect(iUnion).toBeGreaterThan(iCap);
    expect(iShell).toBeGreaterThan(iUnion);
    const union = MAP_BODY.slice(iUnion, iShell);
    expect(union).toContain('dUnion = dPiece;');
    expect(union).toContain('bestSlot = base + s;');
    // The winner's piece and its field BEFORE the caps (the closed head's depth at the un-warped point).
    expect(union).toContain('pieceU = i32(piece.z);');
    expect(union).toContain('splitFU = dmgFinal;');
    expect(MAP_BODY).toContain('gHitPiece = pieceU;');
    expect(MAP_BODY).toContain('gHitSplitF = splitFU;');
  });

  it('no continue or break in the slot body targets the piece loop, except the early skip', () => {
    // The piece loop wraps what used to be the slot loop's body: a `continue` / `break` written for the slot loop
    // would now skip or end a PIECE. Every one must sit inside an inner loop.
    const start = code.indexOf('for (var pc = 0; pc < 3; pc = pc + 1) {');
    const stack: string[] = [];
    const hits: string[] = [];
    const re = /for \([^{]*\{|\{|\}|\b(continue|break);/g;
    re.lastIndex = start;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const tok = m[0];
      if (tok === '}') { stack.pop(); if (stack.length === 0) break; }
      else if (tok.startsWith('for (')) stack.push(stack.length === 0 ? 'piece' : 'for');
      else if (tok === '{') stack.push('block');
      else {
        const loop = [...stack].reverse().find(b => b !== 'block');
        if (loop === 'piece') hits.push(tok);
      }
    }
    expect(stack.length).toBe(0);
    expect(hits).toEqual(['break;']);
  });

  it('the walk skip never applies to an open slot: a piece skipped at the last sample measured no gap', () => {
    expect(MAP_BODY).toContain('let walkSkip = walkSkipOn && gWalkStep > 0.5 && gWalkGap > 0.0 && !splitOpen;');
  });
});
