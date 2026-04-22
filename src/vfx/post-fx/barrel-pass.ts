import * as THREE from 'three';
import { Effect } from 'postprocessing';

/**
 * Barrel (lens) distortion — cheap radial warp, no pincushion correction.
 * `distortion = 0` is a no-op, `0.15` is a mild CRT-TV bulge, `0.3+` is
 * strong fisheye. Edge samples outside the source UV get clamped to black.
 */
const BARREL_FRAG = /* glsl */ `
  uniform float distortion;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 cc = uv - 0.5;
    float dist = dot(cc, cc);
    vec2 warped = uv + cc * dist * distortion;
    if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
      outputColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      outputColor = texture2D(inputBuffer, warped);
    }
  }
`;

export class BarrelEffect extends Effect {
  constructor(distortion = 0.15) {
    super('Barrel', BARREL_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['distortion', new THREE.Uniform(distortion)],
      ]),
    });
  }

  get distortion(): number {
    return (this.uniforms.get('distortion') as THREE.Uniform).value;
  }
  set distortion(v: number) {
    (this.uniforms.get('distortion') as THREE.Uniform).value = v;
  }
}
