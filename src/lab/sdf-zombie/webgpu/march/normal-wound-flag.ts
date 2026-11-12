// src/lab/sdf-zombie/webgpu/march/normal-wound-flag.ts
//
// COMPILE-TIME switch for THE ANALYTIC NORMAL ON WOUNDED PIXELS (2026-11-12, a try;
// docs/dev-notes/2026-11-11-frame-breakdown/NOTES.md: on a wounded mob the shading after the hit is the larger half
// of the march, and every hit pixel of a wounded body takes the four-tap normal).
//
// ngWounds differentiates the wound chain analytically, but gives the pixel up to the four taps (reason 1) for any
// OWNED wound within reach, because the owner re-fold had no analytic twin, and its reach carries a fixed 0.25 m.
// The re-fold is off by default since 2026-11-11 (wound-fold-flag.ts), so an owned wound is the plain union the
// analytic path already handles. With the switch on:
//   - an owned wound stays analytic wherever no limb won a re-fold at the hit (always, with the re-fold off);
//   - the reach is applyWounds' own: the fixed 0.25 m becomes the running -d.
// Both were replay rungs on 2026-11-09 (`ngOwned`, `ngExact` in scripts/native-spike/ladder.mjs): 85 % of a pellet
// body's pixels went back to the analytic normal, 13 % off the pass, and the skin's mottling shifted a little over
// the wounded area. Cuts and torn wounds still take the taps.
//
//   (no parameter), ?ngwound=0   off: the shader text of before the switch, byte for byte
//   ?ngwound, ?ngwound=1         on
//   ?ngwound=2                   on, AND a pixel the analytic path still gives up near a wound takes ngBody's own
//                                gradient (the cheaper fallback, normal-loose-flag.ts) and not the four taps. That
//                                gradient does not carry a crater's shape: a SIZING switch (what the taps cost on
//                                wounded pixels), not a look to ship.
export function normalWoundOn(search: string): boolean {
  const v = new URLSearchParams(search).get('ngwound');
  return v !== null && v !== '0';
}

export const NG_WOUND_ANALYTIC: boolean = (() => {
  try {
    return normalWoundOn((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return false;
  }
})();

/** `?ngwound=2`: no four-tap normal near wounds at all (see the header: for sizing). */
export const NG_WOUND_NO_TAPS: boolean = (() => {
  try {
    return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '').get('ngwound') === '2';
  } catch {
    return false;
  }
})();
