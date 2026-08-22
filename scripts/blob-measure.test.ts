// End-to-end test of scripts/blob-measure.ts — the measurement loop agents run.
//
// It shells the real script rather than importing it, because the CONTRACT
// being protected is the command's: an agent runs `--json`, parses stdout and
// acts on `worst`. A unit test of the pieces would keep passing while the
// script printed a banner into the JSON or exited 0 on a character that does
// not exist, and either of those breaks every caller.
//
// Lives beside the script, not in scripts/tests/ (that directory is the python
// suite) and not under src/ — a test that shells out has to import node
// builtins, and tsconfig's `include` is `src` alone with no @types/node, so a
// node import under src/ breaks `npm run build`'s typecheck. vite.config.ts's
// vitest `include` was widened to `scripts/**/*.test.ts` to collect this.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args: string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/blob-measure.ts', ...args],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('blob-measure', () => {
  it('reports the mouse against its plate as parseable JSON', () => {
    const out = JSON.parse(run(
      'mouse', '--json', '--plate', 'docs/dev-notes/refs/mouse-reference.png',
    ));
    expect(out.character).toBe('mouse');
    expect(out.errors).toEqual([]);
    expect(out.refs.length).toBeGreaterThanOrEqual(1);
    const ref = out.refs[0];
    expect(ref.iou).toBeGreaterThan(0.7);
    expect(ref.worst).toHaveLength(3);
    for (const w of ref.worst) {
      expect(w.owner).toBeDefined();
      // A `.blob`-authored prim carries its source line; a TS-authored one (a
      // face prim) legitimately has none. Anything else means the owner lookup
      // returned junk.
      expect(w.owner.line === null || (Number.isInteger(w.owner.line) && w.owner.line > 0))
        .toBe(true);
    }
  }, 120_000);

  it('exits 2 rather than scoring zero when the character does not exist', () => {
    let status: number | undefined;
    expect(() => {
      try { run('definitely-not-a-character', '--json'); }
      catch (e) { status = (e as { status?: number }).status; throw e; }
    }).toThrow();
    expect(status).toBe(2);
  }, 60_000);
});
