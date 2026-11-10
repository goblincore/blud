// src/lab/sdf-zombie/webgpu/march/compute-flag.ts
//
// COMPILE-TIME switch for the COMPUTE MARCH (2026-11-10; docs/dev-notes/2026-11-10-compute-march-spike/NOTES.md).
//
// With `?marchcompute` a quad-dispatch crowd type marches its bodies in a compute pass, 8 x 8 invocations a
// workgroup, into a storage texture, and its quad then only copies that texture into the march target (colour, and
// the hit depth through the depth test). The field code is the fragment march's own text: the one difference is
// that a `discard` becomes a flag the kernel reads. Replayed captures measured the pass 24 to 55 % faster this way
// (the note above); nothing was measured in the game before this flag existed.
//
// Off (the default), no node of the compute path is created: every wgslFn consumes a global three node id, and
// those ids name the buffers of every program built later, so the shipped shader text stays byte-identical.
export const MARCH_COMPUTE: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const v = new URLSearchParams(search).get('marchcompute');
    return v !== null && v !== '0';
  } catch {
    return false;
  }
})();

/** Invocations a side of a workgroup. 8 x 8 was the fastest block measured; 4 x 4 was slower than the fragment pass. */
export const MARCH_COMPUTE_BLOCK = 8;

/** The fragment march's entry text with every discard turned into a flag: a compute stage has no discard. Each one
 *  is written `discard; return <zero>;`, so the return stays and the caller reads the flag (readMarchDiscard). */
export function marchBodyForCompute(entry: string): string {
  const from = 'discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);';
  const n = entry.split(from).length - 1;
  if (n < 1) throw new Error('march compute: the march entry holds no discard-and-return');
  const out = entry.split(from).join('gCmpDiscard = 1.0; return vec4<f32>(0.0, 0.0, 0.0, 0.0);');
  if (/\bdiscard\s*;/.test(out.replace(/\/\/[^\n]*/g, ''))) throw new Error('march compute: a discard without its return is left in the march entry');
  return out;
}

/** The flag's declaration and its read. `dep` is the march result: taking it orders the read after the march. */
export const MARCH_DISCARD_READ = /* wgsl */ `
fn readMarchDiscard(dep: vec4<f32>) -> f32 {
  return gCmpDiscard;
}
var<private> gCmpDiscard: f32 = 0.0;
`;
