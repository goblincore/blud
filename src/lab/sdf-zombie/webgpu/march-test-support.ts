// src/lab/sdf-zombie/webgpu/march-test-support.ts
//
// Shared fixtures for the march shader-text tests (split out of
// march.wgsl.test.ts by march split task 3, 2026-09-19). Deliberately OUTSIDE
// march/: MARCH_TREE_SRC reads every non-test .ts under march/, and a support
// file in there would put its own text into the tree it describes.
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync, readdirSync } from 'node:fs';
import { HELPERS, MARCH_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH } from './march.wgsl';


// Phase-1 split (2026-09-18): the march shader text now lives in per-module
// files under ./march/. These structural pins read the WHOLE split tree (the
// barrel plus every march module) so a pin does not depend on which module
// happens to hold a chunk. Test files are skipped (see the header).
const MARCH_DIR = 'src/lab/sdf-zombie/webgpu/march';
export const MARCH_TREE_SRC = [
  readFileSync('src/lab/sdf-zombie/webgpu/march.wgsl.ts', 'utf8'),
  ...readdirSync(MARCH_DIR, { recursive: true })
    .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((f: string) => readFileSync(`${MARCH_DIR}/${f}`, 'utf8')),
].join('\n');

// Every WGSL source in the file. Anything new MUST be added here: the
// reserved-word and parse-contract checks are the only thing standing between
// a one-word slip and a blank page whose only symptom is a CreateShaderModule
// error buried under a dozen cascading ones.
export const ALL = [...HELPERS, MARCH_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH];

/** `fn name(` — the same shape three's ^-anchored declarationRegexp needs. */
export function declaredName(src: string): string | null {
  return /^fn\s+([a-z_0-9]+)\s*\(/i.exec(src)?.[1] ?? null;
}
