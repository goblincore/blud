import * as THREE from 'three';

export { loadAnimationManifests, type AnimationBundle } from '../animation/manifest-loader';
import type { ZombieTextureAtlas } from '../game/enemy/axe-zombie';
import type { ChunkTextureAtlas } from '../game/gibs/chunks';
import type { ExplosionAtlas } from '../vfx/explosion';

const loader = new THREE.TextureLoader();

export function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

export async function loadZombieAtlas(manifestUrl: string): Promise<ZombieTextureAtlas> {
  const baseDir = manifestUrl.replace(/\/manifest\.json$/, '/');
  const manifest = await fetch(manifestUrl).then((r) => r.json());
  const textures: Record<number, THREE.Texture> = {};
  await Promise.all(
    manifest.frames.map(async (f: { picnum: number; file: string }) => {
      textures[f.picnum] = await loadTexture(baseDir + f.file);
    }),
  );

  // Pick representative frames for each animation state.
  // Idle: first frame (1170)
  const idleTex = textures[1170] ?? Object.values(textures)[0];
  // Walk: pick 4 frames spread across walk range (1200-1215)
  const walkFrames = [1200, 1204, 1208, 1212]
    .map((n) => textures[n])
    .filter(Boolean);
  // Attack: pick 3 frames spread across attack range (1216-1247)
  const attackFrames = [1224, 1232, 1240]
    .map((n) => textures[n])
    .filter(Boolean);
  // Dead: last frame (1258)
  const deadTex = textures[1258] ?? idleTex;

  // Fallback: ensure we always return a Texture, never undefined
  const fb = Object.values(textures)[0]!;

  return {
    idle: () => idleTex ?? fb,
    walk: (p: number) => walkFrames[Math.floor(p * walkFrames.length) % walkFrames.length] ?? fb,
    attack: (p: number) => attackFrames[Math.floor(p * attackFrames.length) % attackFrames.length] ?? fb,
    dead: () => deadTex ?? fb,
  };
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
