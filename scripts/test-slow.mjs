#!/usr/bin/env node
// scripts/test-slow.mjs
//
// Runs only the slow group (SLOW_TESTS in vite.config.ts), which a bare
// `npm test` leaves out. The list is read from the config's source so it is
// kept in one place.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const src = readFileSync('vite.config.ts', 'utf8');
const block = /const SLOW_TESTS = \[([\s\S]*?)\n\];/.exec(src)?.[1];
if (!block) throw new Error('SLOW_TESTS not found in vite.config.ts');
const files = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);

console.log(`${files.length} slow test files`);
const r = spawnSync('npx', ['vitest', 'run', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
