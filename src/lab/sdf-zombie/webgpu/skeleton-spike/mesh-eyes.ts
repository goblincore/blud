import type { Vec3 } from '../../types';
import type { BoneFieldSource } from './contract';

export interface MeshEyePlacement { center: Vec3; radius: number }

/** Locate the actual frontal bone surface, not the AABB front (which can
 * leave eyes floating off an ellipsoid). The sphere is recessed in its
 * socket; ordinary scene depth keeps it behind intact flesh. */
export function meshEyePlacements(source: Pick<BoneFieldSource, 'segment' | 'bounds' | 'distance'>): MeshEyePlacement[] {
  if (source.segment !== 'head') return [];
  const { min, max } = source.bounds;
  const at = (axis: number, q: number) => min[axis]! + (q + 1) * 0.5 * (max[axis]! - min[axis]!);
  const radius = Math.min((max[0] - min[0]) * 0.095, (max[1] - min[1]) * 0.075);
  const eyes: MeshEyePlacement[] = [];
  for (const x of [-0.36, 0.36]) {
    const cx = at(0, x), cy = at(1, 0.22);
    let outside = max[2] + radius;
    for (let step = 1; step <= 128; step++) {
      const z = max[2] + radius - step / 128 * (max[2] - min[2] + radius);
      if (source.distance([cx, cy, z]) <= 0) {
        let inside = z;
        for (let i = 0; i < 16; i++) {
          const mid = (outside + inside) * 0.5;
          if (source.distance([cx, cy, mid]) > 0) outside = mid;
          else inside = mid;
        }
        eyes.push({ center: [cx, cy, (outside + inside) * 0.5 - radius * 0.35], radius });
        break;
      }
      outside = z;
    }
  }
  return eyes;
}

/** Unit-sphere local +z faces out of the skull. Rose sclera, branching red
 * vessels, dark iris rim and a red central pupil; all are lit, not decals. */
export const MESH_EYE_SURFACE_WGSL = /* wgsl */ `fn meshEyeSurface(p: vec3<f32>) -> vec4<f32> {
  let radial = length(p.xy);
  let front = smoothstep(0.55, 0.82, p.z);
  let iris = (1.0 - smoothstep(0.39, 0.46, radial)) * front;
  let pupil = (1.0 - smoothstep(0.18, 0.25, radial)) * front;
  let vessels = pow(1.0 - abs(sin(p.x * 27.0 + sin(p.y * 19.0) * 2.0 + p.z * 9.0)), 12.0);
  var color = mix(vec3<f32>(0.55, 0.20, 0.23), vec3<f32>(0.25, 0.012, 0.025), vessels * 0.55);
  color = mix(color, vec3<f32>(0.095, 0.003, 0.009), iris);
  color = mix(color, vec3<f32>(0.95, 0.012, 0.025), pupil);
  return vec4<f32>(color, 0.8);
}`;
