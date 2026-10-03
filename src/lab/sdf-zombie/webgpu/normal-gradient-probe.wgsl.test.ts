import { describe, expect, it } from 'vitest';
import { APPLY_WOUNDS } from './march.wgsl';
import { NG_WOUND_PROBE, probeWoundSources } from './normal-gradient-probe.wgsl';

// Top-level comma count of the first `name(...)` call or signature in src.
function arity(src: string, name: string): number {
  const open = src.indexOf(`${name}(`) + name.length;
  let depth = 0;
  let n = 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '<') depth++;
    else if (c === ')' || c === '>') { depth--; if (depth === 0) return n; }
    else if (c === ',' && depth === 1) n++;
  }
  throw new Error(`unterminated ${name}(`);
}

// The normal-gradient check page compiles only on real WebGPU, so a drifted
// probe passes every other test and fails at pipeline creation. These are the
// two drifts it has had: applyWounds' arity, and the globals it reads.
describe('normal-gradient probe (ngWoundProbe)', () => {
  it('calls applyWounds with its current argument count', () => {
    const call = NG_WOUND_PROBE.slice(NG_WOUND_PROBE.indexOf('applyWounds('));
    expect(arity(call, 'applyWounds')).toBe(arity(APPLY_WOUNDS, 'fn applyWounds'));
  });

  it('declares every private global its include chain reads', () => {
    const module = [...probeWoundSources(), NG_WOUND_PROBE].join('\n');
    const declared = new Set([...module.matchAll(/var<private> (g\w+)\s*:/g)].map(m => m[1]));
    const used = new Set([...module.matchAll(/\b(g[A-Z]\w*)\b/g)].map(m => m[1]));
    expect([...used].filter(g => !declared.has(g))).toEqual([]);
  });
});
