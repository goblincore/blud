// src/lab/sdf-zombie/webgpu/fire-capsules.fixture.ts
//
// A REAL posed zombie BuildResult for the fire-capsule tests. Built the same
// way motion.test.ts builds its joints — `buildBody(makeZombie(face))` over the
// stock body grammar — rather than hand-writing prims, so the capsule rule is
// pinned against the body the game actually burns.
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE } from '../face';

/** The stock zombie, built once per call. */
export function buildTestBody(): BuildResult {
  return buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);
}
