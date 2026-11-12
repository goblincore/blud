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
//   ?ngwound=3, ?ngwound=4       in between: see normalWoundTapRule below.
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

/** The WGSL condition (led by ` && `) under which a pixel the analytic path gave up keeps ngBody's own gradient
 *  and skips the four taps. Off and `?ngwound=1`: never near a wound. `=2`: always. `=3`: near a wound unless the
 *  give-up was a KINK (reason 3: a crater lip, the ridge between two craters), so the taps still draw the edges.
 *  `=4`: the reverse of 3 (taps everywhere near a wound but at kinks), to size the two halves. */
export function normalWoundTapRule(search: string): string {
  const v = new URLSearchParams(search).get('ngwound');
  if (v === '2') return '';
  if (v === '3') return ' && (!hitNearWound || ngReason != 3)';
  if (v === '4') return ' && (!hitNearWound || ngReason == 3)';
  return ' && !hitNearWound';
}

export const NG_WOUND_TAP_RULE: string = (() => {
  try {
    return normalWoundTapRule((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return ' && !hitNearWound';
  }
})();
