//
// EARLY-Z BATCH SPLIT (spec 2026-10-01 D5). A front-face proxy rasterises nothing
// when the camera is inside its box (or the front face is clipped by the 0.1 m near
// plane), so those instances keep the SHIPPED back-face, plain-depth material.
// Pure: plain arrays in, plain arrays out, input order kept (crowd sync() sorts
// nearest-first and the draw order depends on it).

/** Inflation of each box before the camera test: covers the 0.1 m near plane
 *  with margin, so a front face is never clipped into a hole. */
export const NEAR_GUARD_M = 0.25;

export interface BatchBox {
  centre: ArrayLike<number>;
  half: ArrayLike<number>;
}

export function boxContainsPoint(box: BatchBox, p: ArrayLike<number>, guard: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(p[i]! - box.centre[i]!) > box.half[i]! + guard) return false;
  }
  return true;
}

export function splitInstances<T extends BatchBox>(
  list: readonly T[],
  camera: ArrayLike<number>,
  guard: number = NEAR_GUARD_M,
): { front: T[]; back: T[] } {
  const front: T[] = [];
  const back: T[] = [];
  for (const b of list) (boxContainsPoint(b, camera, guard) ? back : front).push(b);
  return { front, back };
}
