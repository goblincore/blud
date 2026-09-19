// src/lab/sdf-zombie/webgpu/march/helpers.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): the HELPERS include list.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { AMBIENT_AT, WALL_CONTRIBUTION } from '../ambient.wgsl';
import { FLASHLIGHT_BOUNCE_WGSL } from '../flashlight-bounce.wgsl';
import { PROBE_DYNAMIC_WGSL } from '../probe-dynamic.wgsl';
import { PROBE_GRID_WGSL } from '../probe-grid.wgsl';
import { SEG_VOLUME_WGSL } from '../skeleton-spike/volume.wgsl';
import { DEPTH_PRE_FETCH } from './cone-march.wgsl';
import { APPLY_BONES, FOLD_BONE_RANGE } from './fields/bones.wgsl';
import { APPLY_CARVES, REST_POINT } from './fields/carves.wgsl';
import { FOLD_GROUP, INSTANCE_STATE } from './fields/groups.wgsl';
import { CHAR_MASK, TISSUE_RAMP } from './fields/tissue.wgsl';
import { SAMPLE_VOLUME } from './fields/volume.wgsl';
import { APPLY_WOUNDS, WOUND_MASK, WOUND_SHADOW } from './fields/wounds.wgsl';
import { CALC_NORMAL, MAP_BODY } from './map-body.wgsl';
import { FBM, HASH13, NOISE3, NOISE_LOCAL, Q_FROM_TO, Q_MUL, Q_ROT } from './math.wgsl';
import { CONE_BEND, CONE_CAP, CONE_STRAND, SD_BEZIER_T, SD_GROOVE, SD_PRIM, SD_PRIM_ORIENTED, SD_ROUND_BOX, SD_SHELL, SMAX, SMIN, SMIN_CHAMFER, STRAND_HASH4, STRAND_LIPSCHITZ } from './primitives.wgsl';
import { FLICKER, LEVEL_SHADOW, SOFT_SHOULDER, TEXEL } from './shade-helpers.wgsl';

export const HELPERS = [
  // ORDER IS LOAD-BEARING: WGSL requires declaration before use, and wgslFn
  // concatenates this list as-is. CONE_CAP must precede both sdPrim and
  // sdPrimO, which now call it; SMIN_CHAMFER must precede mapBody. Adding a
  // helper and forgetting this list entirely is the quieter failure — the
  // ordering test below only checks what is IN the list, so an omitted helper
  // passes every unit test and fails at pipeline creation with a bare WGSL
  // parse error pointing at the call site.
  SMIN, SMIN_CHAMFER, SMAX, SD_GROOVE, CONE_CAP, SD_BEZIER_T, CONE_BEND,
  // Strand bundle, BEFORE SD_PRIM because both sdPrim and sdPrimO call
  // coneStrand, and coneStrand itself calls strandHash4 and strandLip — so
  // all three must be declared ahead of it. Omitting a helper from this list
  // is the quiet failure this comment block warns about: it passes every
  // unit test and dies at pipeline creation with a bare WGSL parse error.
  STRAND_HASH4, STRAND_LIPSCHITZ, CONE_STRAND,
  SD_ROUND_BOX, SD_PRIM, SD_PRIM_ORIENTED,
  // NOISE_LOCAL ahead of SD_SHELL: the shell's warp is evaluated in the
  // body frame and calls noiseLocal, and WGSL has no forward declarations at
  // module scope — a helper used before it is declared is a bare parse error
  // at pipeline creation, which is the failure this list's header warns of.
  HASH13, NOISE3, FBM, NOISE_LOCAL,
  SD_SHELL,
  Q_ROT, Q_MUL, Q_FROM_TO, REST_POINT,
  APPLY_CARVES, APPLY_WOUNDS, WOUND_MASK, TISSUE_RAMP, CHAR_MASK, SAMPLE_VOLUME,
  FOLD_GROUP, INSTANCE_STATE, FOLD_BONE_RANGE, SEG_VOLUME_WGSL, APPLY_BONES, MAP_BODY, CALC_NORMAL, WOUND_SHADOW, TEXEL, FLICKER, SOFT_SHOULDER,
  WALL_CONTRIBUTION, AMBIENT_AT, PROBE_GRID_WGSL, PROBE_DYNAMIC_WGSL, FLASHLIGHT_BOUNCE_WGSL, LEVEL_SHADOW,
  // Quarter-res depth prepass fetch (close-up task 3). No field deps — it is
  // a textureLoad — so it rides last, ahead of MARCH_BODY which calls it.
  DEPTH_PRE_FETCH,
];
