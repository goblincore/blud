// src/lab/sdf-zombie/webgpu/train-steam.wgsl.ts
//
// Steam plumes from the Boiler Room's vents (Night Train layout draft 2), hand-written WGSL:
// each sprite is one puff on a loop, rising and spreading from its vent, drifting aft with the
// train's draught. One fn per string (wgslFn takes one).

/** A puff: xyz its world position, w its age 0..1 (for size and fade). */
export const STEAM_PUFF = /* wgsl */ `fn steamPuff(i: f32, t: f32, vent: vec3<f32>, life: f32, rise: f32) -> vec4<f32> {
  let h = fract(sin(vec3<f32>(i * 12.9898, i * 78.233, i * 37.719)) * 43758.5453);
  let age = fract(t / life + h.x);
  let spread = 0.1 + age * 0.55;
  let swirl = vec2<f32>(sin(age * 6.0 + h.y * 6.283), cos(age * 5.0 + h.z * 6.283)) * spread;
  let p = vent + vec3<f32>(swirl.x, age * rise, swirl.y + age * age * 0.9);
  return vec4<f32>(p, age);
}`;
