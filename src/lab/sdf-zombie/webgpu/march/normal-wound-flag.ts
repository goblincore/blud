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
// DEFAULT `=8` since 2026-11-12 (owner's call: =2's softer crater lips were "acceptable given the tradeoff", and =8
// gives a soldier's ragged wounds their relief back at about the same cost).
//   (no parameter)               as ?ngwound=8
//   ?ngwound=0                   off: the shader text of before the switch, byte for byte
//   ?ngwound, ?ngwound=1         on
//   ?ngwound=2                   on, AND a pixel the analytic path still gives up near a wound takes ngBody's own
//                                gradient (the cheaper fallback, normal-loose-flag.ts) and not the four taps. That
//                                gradient does not carry a crater's shape: a SIZING switch (what the taps cost on
//                                wounded pixels), not a look to ship.
//   ?ngwound=3, ?ngwound=4       in between: see normalWoundTapRule below.
//   ?ngwound=5                   =2 with THE WHOLE GRADIENT (NG_WOUND_COMPLETE): ngBody stops at the first numerical
//                                give-up (a kink within the taps' reach, reasons 2 to 4), so the gradient =2 keeps is
//                                often the body's WITHOUT its wounds (the give-up came before them) or the crater's
//                                without the bone in it (it came before the bones). With =5 ngBody goes on through
//                                the wounds and the bones after a numerical give-up, so what it returns is the
//                                one-sided gradient of the whole field. Only an unsupported shape (reason 1: a cut, a
//                                torn wound, a limb's re-fold) still takes the taps.
//   ?ngwound=6                   =5, and the taps ON A CRATER'S RAISED RIM (NG_WOUND_RIM: where the rim bump is over
//                                15 % of its height), where the taps' wider stencil draws the bright lip line the
//                                exact gradient does not.
//   ?ngwound=7                   =5 as a PICTURE OF THE ERROR (NG_WOUND_DIFF): a pixel that kept the analytic gradient
//                                also takes the taps and returns how far the two normals are apart, red = 1 - dot
//                                scaled by 8 (full red at about 29 degrees), green = it was a near-wound pixel. Other
//                                pixels are dark blue. For looking only.
//   ?ngwound=8                   =5, and THE RAGGED EDGE (NG_WOUND_RAGGED): a soldier's craters have a noise-ragged
//                                outline (applyWounds' rN), which ngWounds left out, so with the taps gone a
//                                soldier's wounds shaded as smooth round bowls. With =8 ngWounds differentiates the
//                                ragged crater (the lobe noise's slope by three more noise reads a ragged wound).
//   ?ngwound=9                   =8 as the error picture of =7.
/** The page's `?ngwound` value: '8' with no parameter, '1' for a bare `?ngwound`. */
export function normalWoundMode(search: string): string {
  const v = new URLSearchParams(search).get('ngwound');
  return v === null ? '8' : v === '' ? '1' : v;
}
const MODE: string = (() => {
  try {
    return normalWoundMode((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return '8';
  }
})();

export function normalWoundOn(search: string): boolean {
  return normalWoundMode(search) !== '0';
}

export const NG_WOUND_ANALYTIC: boolean = MODE !== '0';

/** The WGSL condition (led by ` && `) under which a pixel the analytic path gave up keeps ngBody's own gradient
 *  and skips the four taps. Off and `?ngwound=1`: never near a wound. `=2`: always. `=3`: near a wound unless the
 *  give-up was a KINK (reason 3: a crater lip, the ridge between two craters), so the taps still draw the edges.
 *  `=4`: the reverse of 3 (taps everywhere near a wound but at kinks), to size the two halves. `=5` and up: near a
 *  wound unless the shape is unsupported (reason 1); `=6` also where the pixel is on a raised rim. */
export function normalWoundTapRule(search: string): string {
  const v = normalWoundMode(search);
  if (v === '2') return '';
  if (v === '3') return ' && (!hitNearWound || ngReason != 3)';
  if (v === '4') return ' && (!hitNearWound || ngReason == 3)';
  if (v === '5' || v === '7' || v === '8' || v === '9') return ' && (!hitNearWound || ngReason != 1)';
  if (v === '6') return ' && (!hitNearWound || (ngReason != 1 && gNgRim < 0.5))';
  return ' && !hitNearWound';
}

export const NG_WOUND_TAP_RULE: string = normalWoundTapRule(`?ngwound=${MODE}`);

/** `?ngwound=5` and up: ngBody carries on past a numerical give-up (see the header). */
export const NG_WOUND_COMPLETE: boolean = ['5', '6', '7', '8', '9'].includes(MODE);

/** `?ngwound=6`: ngWounds marks a pixel on a crater's raised rim (gNgRim), and such a pixel takes the taps. */
export const NG_WOUND_RIM: boolean = MODE === '6';

/** `?ngwound=7` and `=9`: the angle between the kept analytic normal and the taps', as a picture. */
export const NG_WOUND_DIFF: boolean = MODE === '7' || MODE === '9';

/** `?ngwound=8` and `=9`: ngWounds differentiates a ragged crater's outline. */
export const NG_WOUND_RAGGED: boolean = MODE === '8' || MODE === '9';
