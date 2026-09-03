// End-to-end test of scripts/blob-draft.ts — mirrors blob-depth.test.ts.
//
// It shells the real script rather than importing it, because the CONTRACT
// being protected is the command's: an agent runs `npm run blob:draft -- <n>`,
// redirects stdout into a .blob file, authors it, and expects the committed
// suite to accept the result. A unit test of the fit pieces would keep passing
// while the script emitted unparseable text, dropped the mesh provenance from
// stderr, or ignored --height — and every one of those breaks a caller that
// trusts the artifact.
//
// Lives beside the script (see blob-measure.test.ts for why not under src/).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { validateBody } from '../src/lab/sdf-zombie/validate';
import { emitBlob } from '../src/lab/sdf-zombie/blob-emit';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The installed binary, not `npx` — npx can go to the network on a cold cache,
// which turns a unit test into a flaky one that fails for reasons unrelated to
// the script.
const tsx = resolve(repo, 'node_modules/.bin/tsx');

interface RunResult { stdout: string; stderr: string }
// spawnSync rather than execFileSync: the draft's provenance travels on
// STDERR (stdout is the artifact), and execFileSync hands back only stdout.
const run = (...args: string[]): RunResult => {
  const r = spawnSync(tsx, ['scripts/blob-draft.ts', ...args],
    { cwd: repo, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Run and return the exit status, for the paths that must NOT draft. */
const statusOf = (...args: string[]): number | undefined =>
  spawnSync(tsx, ['scripts/blob-draft.ts', ...args], { cwd: repo, encoding: 'utf8' }).status;

/** 4-decimals trailing-zero-trimmed, matching the emitter's number format —
 *  the height line's value is compared as text, so the same formatter. */
const fmt = (n: number): string => {
  let s = n.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};

/** The draft of `name`, built and validated. The gate every authored character
 *  must pass, applied to the draft before anything else gets to trust it. */
function buildDraft(stdout: string) {
  const doc = parseBlob(stdout);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  return { doc, body, errors: validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 }) };
}

// schoolgirl is the committed control (the character blob:rings converged on),
// and the character the CLI's reference resolution is pinned against —
// schoolgirl-mesh/ holds the canonical schoolgirl.glb AND schoolgirl-alt.glb
// (a symlink), so a resolver that "just takes the first .glb sorted" lands on
// the wrong file and this test says which file the draft must have read.
describe('blob-draft', () => {
  it('drafts the control character into text that parses, compiles, builds and validates', () => {
    const { stdout, stderr } = run('schoolgirl');
    // STDOUT IS THE ARTIFACT — pure .blob text. The === provenance header the
    // other tools print travels on STDERR here, because stdout is redirected
    // into characters/<name>.blob verbatim (the plan's own invocation:
    // `npm run blob:draft -- minotaur > /tmp/minotaur-draft.blob`).
    expect(stdout).not.toContain('=== mesh');
    expect(stderr).toContain('=== mesh docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb');

    const { body, errors } = buildDraft(stdout);
    expect(body.errors).toEqual([]);
    // The CLI builds what it just emitted and says what the build said, on
    // stderr, before the author can mistake the artifact for a finished
    // body (blob:rings/blob-depth's build-and-warn convention). schoolgirl's
    // draft validates clean today, so the count itself is pinned at 0 — a
    // quality ratchet: if a fit change breaks the build, this says so on
    // the very first control run.
    expect(stderr).toContain('=== draft build: 0 error(s)');
    // The whole point of the emitter's budget: MAX_CLUSTER_PRIMS is the SILENT
    // shader ceiling, so validateBody's own per-cluster error can only fire
    // past 64 — the draft must sit under its self-declared 40 with room for
    // refinement, which this is the only place that is actually checked.
    expect(errors).toEqual([]);
  }, 240_000);

  it('carries a # fit: source on every numeric line', () => {
    const { stdout } = run('schoolgirl');
    const numeric = stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && /\d/.test(l));
    // Guards the scan itself: a draft with no numeric body lines is not a
    // draft, and a filter matching nothing would vacuously pass.
    expect(numeric.length).toBeGreaterThan(10);
    for (const line of numeric) expect(line).toMatch(/# fit:/);
  }, 240_000);

  it('round-trips through emitBlob — authored-draft safe', () => {
    // blob-emit.test.ts replays EVERY characters/*.blob through
    // parse -> emit expecting bit-identical text. The day this draft is
    // authored into the tree, that suite owns it — so the contract is proven
    // here, on the artifact, before it can break the committed suite.
    const { stdout } = run('schoolgirl');
    expect(emitBlob(parseBlob(stdout))).toBe(stdout);
  }, 240_000);

  it('honours --height, and the body stands as tall as the height line says', () => {
    // 2.4 rather than a realistic height: the pin's job is SCALE CARRY, not
    // shape. The mesh extent is 1.70, so a run that drops the global scale
    // (drafts at mesh size whatever the flag says) lands within ~10% of 1.70,
    // while a correct run lands within the drift of 2.4 — 2.0 separates the
    // two hypotheses for any chain drift up to ~16%, more than twice the
    // cloud-extent overlap a body-sized mesh has shown.
    const { stdout } = run('schoolgirl', '--height', '2.4');
    expect(stdout).toContain('height 2.4');
    const { body } = buildDraft(stdout);
    let minY = Infinity, maxY = -Infinity;
    for (const p of body.prims)
      for (const end of [p.a, p.b]) { minY = Math.min(minY, end[1]); maxY = Math.max(maxY, end[1]); }
    expect(maxY - minY).toBeGreaterThan(2.0);
  }, 240_000);

  it('defaults the height to the mesh’s own measured extent', () => {
    // The skinned surface is the measurement (parseGlb's raw POSITION would
    // be wrong by the armature scale on these files — the exact bug
    // ref-skin.ts exists to prevent), so the expectation is computed through
    // the same readRefSkin the CLI uses, not hardcoded.
    const skin = readRefSkin(new Uint8Array(readFileSync(resolve(repo, 'docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb'))));
    let minY = Infinity, maxY = -Infinity;
    for (const v of skin.verts) { minY = Math.min(minY, v.position[1]); maxY = Math.max(maxY, v.position[1]); }
    const { stdout } = run('schoolgirl');
    expect(stdout).toContain(`height ${fmt(maxY - minY)}`);
  }, 240_000);

  it('exits 2 rather than drafting when there is no reference mesh', () => {
    // zombie.blob exists, but zombie-mesh/ does not: a draft needs a MESH to
    // fit, and a reference plate cannot stand in. This is "did not run" —
    // exit 2 — and never a silent empty document.
    expect(statusOf('zombie')).toBe(2);
  }, 60_000);

  it('exits 2 on a --height it cannot use', () => {
    // 0, negative and non-numeric are all a scale the body cannot carry.
    expect(statusOf('schoolgirl', '--height', '0')).toBe(2);
    expect(statusOf('schoolgirl', '--height', '-3')).toBe(2);
    expect(statusOf('schoolgirl', '--height', 'tall')).toBe(2);
  }, 60_000);

  it('emits the minotaur’s prosthetic shin per-side, not mirrored away', () => {
    // THE case that motivated side=l|r (shin.r 18,032 verts vs shin.l 6,724
    // on this mesh — pairAsymmetry scores it 0.627 against a 0.45 bar). A
    // draft that mirrors this pair lies about the body in its very first
    // output, so the per-side emission is pinned on the real data.
    const { stdout } = run('minotaur');
    const bodyLines = stdout.split('\n').filter((l) => l.trim().startsWith('bar '));
    expect(bodyLines.some((l) => / on shin .*side=l/.test(l))).toBe(true);
    expect(bodyLines.some((l) => / on shin .*side=r/.test(l))).toBe(true);
  }, 240_000);
});
