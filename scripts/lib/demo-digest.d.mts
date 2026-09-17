// Type declarations for demo-digest.mjs. Kept hand-written and minimal: the
// module exists so the recorder's byte digest can be unit-tested without
// executing that script's main body (which connects to Chrome), and a test that
// imports it needs a shape to check against.
export declare const FNV_OFFSET: number;
export declare const FNV_PRIME: number;
/** FNV-1a (32-bit) over raw bytes. Mirrors frame-hash.ts's `fnv1aBytes`; the
 *  duplication is gated by frame-hash.test.ts against canonical vectors. */
export declare function fnv1aBytes(bytes: ArrayLike<number>): number;
