export interface Vec2 { x: number; y: number; }

export interface AngleVariant {
  variant: number;   // 0 .. Math.floor(stride/2)
  flipX: boolean;    // mirror horizontally
}

/**
 * Pick the sprite-rotation variant for a billboard sprite.
 *
 * Blood encodes 5 visual variants (for angleStride=5) covering front,
 * front-side, side, back-side, back. The 8 cardinal directions render by
 * reusing 5 variants + horizontal flip for the right-side directions.
 *
 * Math: compute θ = signed angle between sprite-facing and the
 * sprite-to-camera vector (CCW positive). Normalize to [0, 2π). Bucket
 * into 8 sectors (45° each). Sectors 0/1/2/3/4 map directly to
 * variants 0/1/2/3/4. Sectors 5/6/7 map back to variants 3/2/1 with
 * flipX=true (mirror of their counterparts on the left side).
 *
 * For angleStride=1: always return {variant:0, flipX:false}.
 */
export function pickAngleVariant(
  cameraPos: Vec2,
  spritePos: Vec2,
  spriteFacing: Vec2,
  angleStride: number,
): AngleVariant {
  if (angleStride <= 1) return { variant: 0, flipX: false };
  // Only handle the standard 5-stride Blood case explicitly. Other strides
  // fall back to no flip + modulo (documented limitation).
  if (angleStride !== 5) {
    const n = angleStride;
    const toCam = { x: cameraPos.x - spritePos.x, y: cameraPos.y - spritePos.y };
    const facingTheta = Math.atan2(spriteFacing.y, spriteFacing.x);
    const toCamTheta = Math.atan2(toCam.y, toCam.x);
    const raw = ((toCamTheta - facingTheta) + Math.PI * 2) % (Math.PI * 2);
    const variant = Math.floor((raw / (Math.PI * 2)) * n) % n;
    return { variant, flipX: false };
  }

  const toCam = { x: cameraPos.x - spritePos.x, y: cameraPos.y - spritePos.y };
  const facingTheta = Math.atan2(spriteFacing.y, spriteFacing.x);
  const toCamTheta = Math.atan2(toCam.y, toCam.x);
  const delta = ((toCamTheta - facingTheta) + Math.PI * 2) % (Math.PI * 2);
  // 8 sectors of 45° starting with sector 0 centered on 0° (shift by π/8)
  const sector = Math.floor(((delta + Math.PI / 8) % (Math.PI * 2)) / (Math.PI / 4));
  // sector → (variant, flip)
  const table: Array<[number, boolean]> = [
    [0, false], // 0°    — front
    [1, false], // 45°   — front-left (+y)
    [2, false], // 90°   — left side
    [3, false], // 135°  — back-left
    [4, false], // 180°  — back
    [3, true],  // 225°  — back-right (mirror of back-left)
    [2, true],  // 270°  — right side
    [1, true],  // 315°  — front-right
  ];
  const [variant, flipX] = table[sector % 8]!;
  return { variant, flipX };
}
