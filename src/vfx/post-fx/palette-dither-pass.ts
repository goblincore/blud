import * as THREE from 'three';
import { Effect } from 'postprocessing';

/**
 * Bayer 8×8 ordered dither + BLOOD.PAL nearest-color snap.
 *
 * The palette texture is a 16×16 RGBA PNG baked by scripts/build_palette_lut.py
 * from BLOOD.RFF. For each output pixel we add a small Bayer-offset to the
 * input color, then scan all 256 palette entries for the nearest match. At
 * 960×540 this is ~130M texture taps/frame — well within GPU budget.
 *
 * `ditherStrength` ranges 0 (flat palette snap) → 1 (full Bayer dot pattern).
 */
const DITHER_FRAG = /* glsl */ `
  uniform sampler2D palette;
  uniform float ditherStrength;
  uniform float bypass;   // 1 = pass through (both dither AND palette snap off)

  // Classic Bayer 8x8, values in [0,63].
  const float bayer[64] = float[](
     0.0, 32.0,  8.0, 40.0,  2.0, 34.0, 10.0, 42.0,
    48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    12.0, 44.0,  4.0, 36.0, 14.0, 46.0,  6.0, 38.0,
    60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
     3.0, 35.0, 11.0, 43.0,  1.0, 33.0,  9.0, 41.0,
    51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    15.0, 47.0,  7.0, 39.0, 13.0, 45.0,  5.0, 37.0,
    63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
  );

  vec3 snapToPalette(vec3 c) {
    float bestDist = 999.0;
    vec3 bestCol = c;
    for (int i = 0; i < 256; i++) {
      vec2 uv = vec2(
        (float(i - (i / 16) * 16) + 0.5) / 16.0,
        (float(i / 16) + 0.5) / 16.0
      );
      vec3 p = texture2D(palette, uv).rgb;
      vec3 d = c - p;
      float dd = dot(d, d);
      if (dd < bestDist) { bestDist = dd; bestCol = p; }
    }
    return bestCol;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (bypass > 0.5) {
      outputColor = inputColor;
      return;
    }
    ivec2 pix = ivec2(mod(gl_FragCoord.xy, 8.0));
    float b = (bayer[pix.y * 8 + pix.x] / 63.0 - 0.5) * (1.0 / 16.0);
    vec3 offset = vec3(b * ditherStrength);
    vec3 snapped = snapToPalette(clamp(inputColor.rgb + offset, 0.0, 1.0));
    outputColor = vec4(snapped, inputColor.a);
  }
`;

export class PaletteDitherEffect extends Effect {
  constructor(paletteTexture: THREE.Texture, strength = 0.5) {
    super('PaletteDither', DITHER_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['palette', new THREE.Uniform(paletteTexture)],
        ['ditherStrength', new THREE.Uniform(strength)],
        ['bypass', new THREE.Uniform(0)],
      ]),
    });
  }

  get ditherStrength(): number {
    return (this.uniforms.get('ditherStrength') as THREE.Uniform).value;
  }
  set ditherStrength(v: number) {
    (this.uniforms.get('ditherStrength') as THREE.Uniform).value = v;
  }

  set bypass(on: boolean) {
    (this.uniforms.get('bypass') as THREE.Uniform).value = on ? 1 : 0;
  }
}
