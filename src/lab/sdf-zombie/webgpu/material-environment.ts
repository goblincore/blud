import type { MeshStandardMaterial, Texture } from 'three/webgpu';

/** Keep a disposable environment's bindings scoped to its owner.
 *
 * Three's WebGPU EnvironmentNode captures the envMap texture when building
 * the shader, but its material cache key only describes the texture's shape
 * and sampler. Otherwise identical materials can therefore borrow the first
 * owner's PMREM. Retiring that owner leaves survivors sampling a disposed
 * texture (or an empty replacement). Include its identity in the builder key;
 * the renderer can still share the identical compiled GPU shader programs.
 */
export function setMaterialEnvironment(material: MeshStandardMaterial, environment: Texture): void {
  const baseKey = material.customProgramCacheKey;
  material.envMap = environment;
  material.customProgramCacheKey = () => `${baseKey.call(material)}:environment:${environment.uuid}`;
  material.needsUpdate = true;
}
