// SCRATCH — delete. Crown shape interrogation.
import { describe, it } from 'vitest';
import src from '/Users/donny/.claude/dispatch/worktrees/2026-08-22-ox-alpha-mouse-finish/src/lab/sdf-zombie/characters/mouse.blob?raw';
import { parseBlob } from '/Users/donny/.claude/dispatch/worktrees/2026-08-22-ox-alpha-mouse-finish/src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '/Users/donny/.claude/dispatch/worktrees/2026-08-22-ox-alpha-mouse-finish/src/lab/sdf-zombie/blob-compile';
import { buildBody } from '/Users/donny/.claude/dispatch/worktrees/2026-08-22-ox-alpha-mouse-finish/src/lab/sdf-zombie/build-body';
import { sdBody } from '/Users/donny/.claude/dispatch/worktrees/2026-08-22-ox-alpha-mouse-finish/src/lab/sdf-zombie/validate';

const doc = parseBlob(src);
describe('crown', () => {
  it('profile', () => {
    const b = buildBody(compileBlob(doc, compileFace(doc)));
    const topAt = (x: number): number => {
      for (let y = 1.12; y >= 0.0; y -= 0.001) if (sdBody([x, y, 0.0], b) < 0) return y;
      return -1;
    };
    for (const x of [0, 0.02, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.174, 0.20, 0.25]) {
      console.log(`x=${x.toFixed(3)} top=${topAt(x).toFixed(3)}`);
    }
  });
});
