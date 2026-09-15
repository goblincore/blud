// scripts/dc-chamfer-probe.test.ts
//
// Focused, filesystem-free gates for the follow-up generator: argument
// validation (including the explicit `--evidence ''` opt-out used by --smoke)
// and the preview HTML it would write. The heavy evidence generation is
// exercised by the bounded smoke command in the dev-note, not by a unit test.

import { describe, expect, it } from 'vitest';
import { HELP, parseArgs, previewHtml } from './dc-chamfer-probe';

describe('dc-chamfer-probe argument parsing', () => {
  it('uses the documented defaults', () => {
    const a = parseArgs([]);
    expect(a.out).toBe('.scratch/dc-chamfer-run');
    expect(a.evidence).toBe('docs/dev-notes/2026-09-15-dc-chamfer');
    expect(a.smoke).toBe(false);
    expect(a.help).toBe(false);
  });

  it('accepts --smoke, --out, --evidence and disables evidence with an empty value', () => {
    const a = parseArgs(['--smoke', '--out', '.scratch/x', '--evidence', '']);
    expect(a.smoke).toBe(true);
    expect(a.out).toBe('.scratch/x');
    expect(a.evidence).toBeNull();
    expect(parseArgs(['--evidence', 'none']).evidence).toBeNull();
  });

  it('rejects an unknown argument and a missing value instead of guessing', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--out'])).toThrow(/missing value/);
  });

  it('documents its options', () => {
    expect(HELP).toContain('--evidence');
    expect(HELP).toContain('--smoke');
  });
});

describe('dc-chamfer-probe preview', () => {
  it('lays out every supplied panel with the ground-truth legend', () => {
    const html = previewHtml([
      { fixture: 'chamfer-groove', method: 'dc-baseline', cell: 0.01, view: 'slice-notch-plus-z', file: 'a.png', tris: 0 },
      { fixture: 'chamfer-groove', method: 'dc-eps-candidate', cell: 0.01, view: 'slice-notch-plus-z', file: 'b.png', tris: 0 },
      { fixture: 'chamfer-groove', method: 'marching-cubes', cell: 0.01, view: 'slice-notch-plus-z', file: 'c.png', tris: 0 },
      { fixture: 'chamfer-groove', method: 'slice', cell: 0.01, view: 'slice-notch-plus-z', file: 'd.png', tris: 0 },
      { fixture: 'chamfer-groove', method: 'surface-nets', cell: 0.01, view: 'slice-notch-plus-z', file: 'e.png', tris: 0 },
    ]);
    for (const f of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) expect(html).toContain(`panels/${f}`);
    expect(html).toContain('ground truth');
    expect(html).toContain('notch-plus-z');
  });
});
