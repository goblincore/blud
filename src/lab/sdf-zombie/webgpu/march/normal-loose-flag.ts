// src/lab/sdf-zombie/webgpu/march/normal-loose-flag.ts
//
// COMPILE-TIME switch for the CHEAPER FALLBACK NORMAL (2026-11-10; docs/dev-notes/2026-11-10-silhouette-spike/LOOSEN.md).
//
// The shading normal is analytic (ngBody). Where that gives up (a wound in reach, a limb's re-fold, a shape it does
// not differentiate) the pixel pays calcNormal: four more calls of the whole field. On a clean 22-body mob that
// fallback was 6 ms of a 37 ms march pass. With `?ngloose` such a pixel keeps the analytic gradient ngBody already
// returned, and calcNormal runs only where ngBody did not run at all (an open head split, the gradient mode off).
//
// LOOSE, not exact: the picture changes in thin lines at silhouettes, belts and wound lips (the owner's rule,
// 2026-11-10: a speed-up that loosens the look is fine where it is not noticed). Off (the default), the shader text
// is byte-identical (the march golden).
export function normalLooseOn(search: string): boolean {
  const v = new URLSearchParams(search).get('ngloose');
  return v !== null && v !== '0';
}

export const NORMAL_LOOSE: boolean = (() => {
  try {
    return normalLooseOn((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return false;
  }
})();
