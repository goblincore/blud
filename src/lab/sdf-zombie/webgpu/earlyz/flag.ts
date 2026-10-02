//
// COMPILE-TIME switch for the early-Z march (spec 2026-10-01 D1), read ONCE at
// module load in the `march/limbs-flag.ts` pattern. With the flag off nothing in
// this directory builds a material, a mesh or a byte of WGSL, so march-golden and
// march-hash cannot move. Under Vitest there is no page query: false.
export function readEarlyzFlag(search?: string): boolean {
  try {
    const s = search ?? (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(s).get('earlyz') === '1';
  } catch {
    return false;
  }
}

export const EARLYZ_FLAG: boolean = readEarlyzFlag();
