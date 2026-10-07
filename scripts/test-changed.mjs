#!/usr/bin/env node
// scripts/test-changed.mjs
//
// Runs the tests that sit beside the files this branch changed, plus the cheap
// source guards. The local stand-in for the full suite, which CI runs on push
// (.github/workflows/ci.yml).
//
//   npm run test:changed            # against origin/main
//   npm run test:changed -- <ref>   # against another base
//
// It maps `x.ts` -> `x.test.ts` and no further: a test of some OTHER module
// that imports the changed one is not run, and neither is a test that pins the
// changed file as text. CI catches those. (vitest's own `--changed` cannot be
// used here: its import-graph walk fails on the `.blob` imports.)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

const mergeBase = git('merge-base', 'HEAD', base)[0];
const changed = new Set([
  ...git('diff', '--name-only', mergeBase),             // committed + working tree
  ...git('ls-files', '--others', '--exclude-standard'), // new, not yet added
]);

/** Always run: they read the tree as a whole and take a few seconds. */
const GUARDS = [
  'scripts/module-index.test.ts',
  'scripts/game-context-coverage.test.ts',
  'scripts/seam-merge-guard.test.ts',
];

const tests = new Set(GUARDS);
for (const f of changed) {
  if (!/^(src|scripts)\//.test(f)) continue;
  const m = /^(.*?)(\.test)?\.(ts|mjs)$/.exec(f);
  if (!m) continue;
  for (const ext of ['ts', 'mjs']) {
    const t = `${m[1]}.test.${ext}`;
    if (existsSync(t)) tests.add(t);
  }
}

console.log(`${changed.size} changed files -> ${tests.size} test files (base ${base})`);
const r = spawnSync('npx', ['vitest', 'run', ...tests], { stdio: 'inherit' });
process.exit(r.status ?? 1);
