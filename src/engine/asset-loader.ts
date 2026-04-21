import * as THREE from 'three';

export { loadAnimationManifests, type AnimationBundle } from '../animation/manifest-loader';
import type { ChunkTextureAtlas } from '../game/gibs/chunks';
import type { ExplosionAtlas } from '../vfx/explosion';

const loader = new THREE.TextureLoader();

/**
 * Load a PNG/JPG as a three.js texture, tagged for sRGB color-space and
 * nearest-neighbour filtering (pixel-art).
 *
 * Three.js r150+ defaults `renderer.outputColorSpace` to sRGB but leaves
 * individual textures as NoColorSpace. PNG files on disk are sRGB-encoded,
 * so without tagging each texture's `colorSpace`, three.js treats the byte
 * values as linear light → renders through linear→sRGB → visually washes
 * out all sprites (the "white overlay / low contrast" look).
 *
 * Nearest filtering is applied because every texture we load here is Blood
 * pixel-art; bilinear smoothing would blur the retro look.
 */
export function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) =>
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        resolve(tex);
      },
      undefined,
      reject,
    ),
  );
}

export async function loadGibTextures(manifestUrl: string): Promise<ChunkTextureAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const textures: Record<number, THREE.Texture> = {};
  await Promise.all(
    manifest.frames.map(async (f: { picnum: number; file: string }) => {
      textures[f.picnum] = await loadTexture(baseDir + f.file);
    }),
  );
  const fb = Object.values(textures)[0]!;
  return {
    get: (picnum: number) => textures[picnum] ?? fb,
  };
}

export async function loadExplosionAtlas(manifestUrl: string): Promise<ExplosionAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const frames = await Promise.all(
    manifest.frames.map((f: { file: string }) => loadTexture(baseDir + f.file)),
  );
  return {
    frameCount: frames.length,
    frameDurationMs: manifest.frameDurationMs ?? 67,
    get: (i: number) => frames[Math.min(i, frames.length - 1)],
  };
}
