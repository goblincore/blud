// scripts/lib/demo-digest.mjs
//
// FNV-1a 32-bit for the demo recorder's PRESENTED-frame hash.
//
// WHY THIS IS ITS OWN FILE, and why it is a copy. The recorder hashes the
// composited canvas in plain node with no build step, so it cannot import
// src/lab/sdf-zombie/webgpu/frame-hash.ts (a .ts import needs a step). It also
// cannot reimplement the digest quietly: if the in-page digest and this one ever
// disagreed, every recording would report a divergence that is an artefact of the
// TOOL rather than of the game — the worst failure this instrument could have.
//
// So the duplication is deliberate and GATED: frame-hash.test.ts imports this
// module and asserts it agrees with the pure implementation over fixed FNV-1a
// vectors and a 200 KB pseudo-random buffer. If one changes without the other,
// that test goes red.
//
// It lives in scripts/lib/ rather than inside sdf-demo-hash.mjs because that
// script CONNECTS TO CHROME at module scope, so importing it from a test opened a
// browser tab instead of running assertions (observed 2026-09-10).

export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

/** FNV-1a (32-bit) over raw bytes. Unsigned by construction. */
export function fnv1aBytes(bytes) {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ (bytes[i] & 0xff), FNV_PRIME);
  }
  return h >>> 0;
}
