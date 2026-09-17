/** Broad phase for the dynamic-light gather. Preserve capsule order and shape;
 * one sphere bounds each consecutive group of capsules. Bone rows are already
 * packed by actor, so these groups usually cover a small part of one body.
 * Bounds live after the capsule records in the same storage buffer. */
export const PROBE_CAPSULE_GROUP_SIZE = 16;

export function probeCapsuleStorageVec4s(maxCapsules: number): number {
  return 1 + maxCapsules * 2 + Math.ceil(maxCapsules / PROBE_CAPSULE_GROUP_SIZE);
}

/** Header y is the vec4 offset of the group spheres (0 disables the cull).
 * Compute from the ALREADY ROUNDED f32 capsules. Inflate after rounding the
 * centre so neither CPU→GPU conversion nor grazing-ray arithmetic can shrink
 * the bound. This is a broad phase only: exact capsule tests still decide hits. */
export function packProbeCapsuleGroups(packed: Float32Array, maxCapsules: number): void {
  const count = packed[0]!;
  const offset = 1 + maxCapsules * 2;
  if (count > maxCapsules || packed.length < probeCapsuleStorageVec4s(maxCapsules) * 4) {
    throw new Error('probe capsule group buffer capacity exceeded');
  }
  packed[1] = offset;
  for (let start = 0; start < count; start += PROBE_CAPSULE_GROUP_SIZE) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const end = Math.min(count, start + PROBE_CAPSULE_GROUP_SIZE);
    for (let c = start; c < end; c++) {
      const i = 4 + c * 8, r = packed[i + 3]!;
      minX = Math.min(minX, packed[i]! - r, packed[i + 4]! - r);
      minY = Math.min(minY, packed[i + 1]! - r, packed[i + 5]! - r);
      minZ = Math.min(minZ, packed[i + 2]! - r, packed[i + 6]! - r);
      maxX = Math.max(maxX, packed[i]! + r, packed[i + 4]! + r);
      maxY = Math.max(maxY, packed[i + 1]! + r, packed[i + 5]! + r);
      maxZ = Math.max(maxZ, packed[i + 2]! + r, packed[i + 6]! + r);
    }
    const x = Math.fround((minX + maxX) * 0.5);
    const y = Math.fround((minY + maxY) * 0.5);
    const z = Math.fround((minZ + maxZ) * 0.5);
    const radius = Math.hypot(
      Math.max(x - minX, maxX - x), Math.max(y - minY, maxY - y), Math.max(z - minZ, maxZ - z),
    );
    const i = (offset + start / PROBE_CAPSULE_GROUP_SIZE) * 4;
    packed[i] = x; packed[i + 1] = y; packed[i + 2] = z;
    packed[i + 3] = radius + 1e-4 * (1 + radius + Math.max(Math.abs(x), Math.abs(y), Math.abs(z)));
  }
}
