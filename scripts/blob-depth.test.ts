// End-to-end test of scripts/blob-depth.ts — mirrors blob-measure.test.ts.
//
// It shells the real script rather than importing it, because the CONTRACT
// being protected is the command's: an agent runs `--json`, parses stdout and
// edits the `.blob:` lines the report names. A unit test of the pieces would
// keep passing while the script dropped a view, printed a band with no owning
// line, or exited 0 on a character it never scored — and every one of those
// breaks a caller that trusts the report.
//
// Lives beside the script (see blob-measure.test.ts for why not under src/).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The installed binary, not `npx` — npx can go to the network on a cold cache,
// which turns a unit test into a flaky one that fails for reasons unrelated to
// the script.
const tsx = resolve(repo, 'node_modules/.bin/tsx');
const run = (...args: string[]): string =>
  execFileSync(tsx, ['scripts/blob-depth.ts', ...args],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Run and return the exit status, for the paths that must NOT score. */
const statusOf = (...args: string[]): number | undefined => {
  let status: number | undefined;
  expect(() => {
    try { run(...args); }
    catch (e) { status = (e as { status?: number }).status; throw e; }
  }).toThrow();
  return status;
};

// schoolgirl is the committed control: a character the blob:rings loop
// converged on, whose flesh tracks its mesh. It is also the character the
// CLI's reference resolution is pinned against — schoolgirl-mesh/ holds the
// canonical schoolgirl.glb AND schoolgirl-alt.glb (a symlink), so a resolver
// that "just takes the first .glb sorted" lands on the wrong file and this
// test says which file the report must have used.
interface DepthBand { y0: number; y1: number; meanErr: number; signedErr: number; samples: number; owner?: { line: number; label: string } }
interface DepthView {
  view: string; meanErr: number; signedErr: number; samples: number; bands: DepthBand[];
  depthSpan: { body: number; mesh: number; ratio: number }; poseSuspect: boolean;
}

describe('blob-depth', () => {
  it('reports the control character as parseable JSON, both views, worst-first', () => {
    const out = JSON.parse(run('schoolgirl', '--json'));
    expect(out.character).toBe('schoolgirl');
    // THE CANONICAL FILE, not "first .glb sorted" — schoolgirl-alt.glb sorts
    // ahead of schoolgirl.glb, so this line is the resolver's pin.
    expect(out.mesh).toBe('docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb');
    expect(out.errors).toEqual([]);
    expect(out.triangles).toBeGreaterThan(0);
    expect(out.views.map((v: DepthView) => v.view)).toEqual(['front', 'side']);
    for (const v of out.views as DepthView[]) {
      // A view with no both-occupied pixels measured nothing — the mesh or
      // the body failed to raster and the report would be silence wearing a
      // score's clothes.
      expect(v.samples).toBeGreaterThan(0);
      expect(v.bands).toHaveLength(16);
      // Bands arrive WORST FIRST — the report is a to-do list, so the order
      // is the contract, not a courtesy.
      for (let i = 1; i < v.bands.length; i++)
        expect(v.bands[i - 1]!.meanErr).toBeGreaterThanOrEqual(v.bands[i]!.meanErr);
      // The WORST band is the one an agent acts on first, so it must carry
      // its owning `.blob` line — schoolgirl's worst bands are all .blob-
      // authored prims. (Written as its own hard pin rather than folded into
      // the per-band `if (b.owner)` check below, because that guard makes a
      // dropped owner PASS — the exact vacuity the mutation matrix exists
      // for. Here the absence itself fails.)
      expect(v.bands[0]!.samples).toBeGreaterThan(0);
      expect(v.bands[0]!.owner).toBeDefined();
      expect(v.bands[0]!.owner!.line).toBeGreaterThan(0);
      for (const b of v.bands) {
        expect(b.samples).toBeGreaterThanOrEqual(0);
        // An unsampled band carries no error and no owner; a sampled one
        // names its owning `.blob` line, or legitimately has none when the
        // band is owned by a TS-authored prim (the face block's prims —
        // same contract blob-measure's owner test pins).
        if (b.samples > 0) {
          expect(b.meanErr).toBeGreaterThanOrEqual(0);
          if (b.owner) expect(b.owner.line).toBeGreaterThan(0);
        } else {
          expect(b.meanErr).toBe(0);
          expect(b.owner).toBeUndefined();
        }
      }
      // THE POSE LABEL. schoolgirl's mesh is a T/A-pose: arms out along x,
      // so her SIDE view (depth = world x) mesh span measures ~3.3x the
      // body's and every band's offset is about the pose, not the sculpt —
      // while her FRONT view (depth = z) spans agree to 6%. A run that
      // fails to say which is which hands the agent a 270mm "error" to
      // start editing from. This pin is the detector's teeth; it was added
      // after the first unlabelled schoolgirl run printed exactly that.
      const byView = Object.fromEntries((out.views as DepthView[]).map((v) => [v.view, v]));
      expect(byView.front!.poseSuspect).toBe(false);
      expect(byView.side!.poseSuspect).toBe(true);
      expect(byView.side!.depthSpan.ratio).toBeGreaterThan(2);
    }
  }, 240_000);

  it('prints the === mesh header and both view sections as text', () => {
    const out = run('schoolgirl');
    expect(out).toContain('=== mesh docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb');
    // Both views, and every band names its owning line the way blob:rings
    // names blocks — `<name>.blob:<line>` — so the report is a list of lines
    // to edit without a lookup step.
    expect(out).toContain('front view');
    expect(out).toContain('side view');
    expect(out).toMatch(/schoolgirl\.blob:\d+/);
  }, 240_000);

  it('exits 2 rather than scoring when the character does not exist', () => {
    expect(statusOf('definitely-not-a-character')).toBe(2);
  }, 60_000);

  it('exits 2 when the character has no reference mesh', () => {
    // zombie.blob exists; no zombie-mesh/ directory does. A plate cannot
    // stand in — this tool diffs DEPTH, and a plate has none — so this is
    // "did not run", exit 2, and never a score of zero.
    expect(statusOf('zombie')).toBe(2);
  }, 60_000);
});
