// src/lab/sdf-zombie/webgpu/gib-asset-archetypes.ts
//
// The OFFLINE archetype table plus the pure recipe/look builders shared by the
// generator script and the stale-asset test. No node, no three, no DOM: the
// script passes the `.blob` text in (read from disk, so it works outside Vite),
// and the test passes the same text (imported `?raw`, so it uses the real
// tracked source).
//
// WHY A SHARED MODULE. The fingerprint is only meaningful if the generator and
// the checker build the SAME recipe object. One builder, two callers.
import type { FleshMaterial } from '../material';
import { FLESH_PRESETS } from '../material';
import type { FaceParams } from '../face';
import type { ChunkLook } from '../chunk-bake-field';
import type { GibSurfaceResponse } from './gib-asset-build';
import { GIB_ASSET_CUT_MASK, GIB_ASSET_SCHEMA_VERSION, type GibAssetRecipe } from './gib-asset';

/** The archetypes Task 1 ships. `blobPath` is repo-relative and must stay in
 *  step with the tracked `.blob` files (a moved source leaves the asset stale,
 *  which the check reports rather than silently serving old geometry). */
export interface GibArchetypeDef {
  name: string;
  blobPath: string;
}

export const GIB_ARCHETYPES: readonly GibArchetypeDef[] = [
  { name: 'zombie', blobPath: 'src/lab/sdf-zombie/characters/zombie.blob' },
  { name: 'soldier', blobPath: 'src/lab/sdf-zombie/characters/soldier.blob' },
];


/** The palette the game actually wears: the `.blob`'s own `palette` block, else
 *  the stock preset — `game-main.ts:2826` verbatim. */
export function gibMaterialFor(palette: FleshMaterial | null): FleshMaterial {
  return palette ?? { ...FLESH_PRESETS['henenlotter-latex'] };
}

export function gibPaletteName(palette: FleshMaterial | null): string {
  if (palette === null) return 'default:henenlotter-latex';
  // Match by value against the presets; a `.blob` declaration wins over a name.
  for (const [name, preset] of Object.entries(FLESH_PRESETS)) {
    if (JSON.stringify(preset) === JSON.stringify(palette)) return `preset:${name}`;
  }
  return 'blob';
}

/** The bake's albedo input, from the flesh material — the same mapping
 *  `ChunkGpuView.bakeData()` performs on the live uniforms. */
export function gibLookFromMaterial(m: FleshMaterial): ChunkLook {
  return {
    baseColor: [...m.baseColor] as [number, number, number],
    deepColor: [...m.deepColor] as [number, number, number],
    fatColor: [...m.fatColor] as [number, number, number],
    mottleColor: [...m.mottleColor] as [number, number, number],
    organColor: [...m.organColor] as [number, number, number],
    visceraColor: [...m.visceraColor] as [number, number, number],
    woundDepthAmp: m.woundDepthAmp,
    fatDepth: m.fatDepth,
    muscleDepth: m.muscleDepth,
    visceraAmp: m.visceraAmp,
    visceraDepth: m.visceraDepth,
    mottleAmp: m.mottleAmp,
    mottleScale: m.mottleScale,
    organAmp: m.organAmp,
    goreStrength: 1,
  };
}

/** The SDF response the bake writes into `bakeResponse`/fresnel, from the
 *  material preset plus the uniform defaults `applyMaterial` leaves alone. */
export function gibSurfaceFromMaterial(m: FleshMaterial): GibSurfaceResponse {
  return {
    legacyGamma: 1,
    wetness: m.wetness,
    roughness: m.specRoughness,
    specIntensity: m.specIntensity,
    noiseAmp: m.silhouetteNoiseAmp,
    fresnel: m.fresnelBoost,
  };
}

export interface MakeGibRecipeInput {
  archetype: string;
  blobPath: string;
  blobSource: string;
  face: FaceParams;
  look: ChunkLook;
  surface: GibSurfaceResponse;
  paletteName: string;
  cellSize: number;
  maxBindPrims: number;
  carveK: number;
  boneRelease: string;
  organs: boolean;
  generator: string;
  buildOpts: { silhouetteNoiseAmp: number; stepMultiplier: number };
}

/** The complete geometry/deformation recipe. `blobSource` is the full text so
 *  an equal-length edit changes the fingerprint. */
export function makeGibAssetRecipe(input: MakeGibRecipeInput): GibAssetRecipe {
  return {
    schemaVersion: GIB_ASSET_SCHEMA_VERSION,
    generator: input.generator,
    archetype: input.archetype,
    blobPath: input.blobPath,
    blobSource: input.blobSource,
    buildOpts: { ...input.buildOpts },
    face: { ...input.face },
    palette: input.paletteName,
    look: { ...input.look },
    surface: { ...input.surface },
    boneRelease: input.boneRelease,
    organs: input.organs,
    cellSize: input.cellSize,
    maxBindPrims: input.maxBindPrims,
    carveK: input.carveK,
    gore: 1,
    cutMask: GIB_ASSET_CUT_MASK,
  };
}
