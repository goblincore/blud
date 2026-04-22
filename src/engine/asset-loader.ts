import * as THREE from 'three';
import type { AudioEngine } from '../audio/engine';
import { decodeAudio } from '../audio/engine';
import { SfxEvent, SFX_BLOOD_MAP } from '../audio/events';
import { SfxRegistry } from '../audio/sfx-registry';

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
  const clamp = (i: number) => Math.min(Math.max(i, 0), frames.length - 1);
  const aspectOf = (tex: THREE.Texture): number => {
    const img = tex.image as { width?: number; height?: number } | undefined;
    const w = img?.width ?? 1;
    const h = img?.height ?? 1;
    return h > 0 ? w / h : 1;
  };
  return {
    frameCount: frames.length,
    frameDurationMs: manifest.frameDurationMs ?? 67,
    get: (i: number) => frames[clamp(i)]!,
    aspect: (i: number) => aspectOf(frames[clamp(i)]!),
  };
}

/** Load all SFX buffers into a registry. Missing files are silently skipped. */
export async function loadSfxRegistry(
  engine: AudioEngine,
  basePath = '/assets/audio-placeholder/sfx',
): Promise<SfxRegistry> {
  const registry = new SfxRegistry();
  const events: SfxEvent[] = Object.values(SfxEvent);
  await Promise.all(events.map(async (event) => {
    const bloodId = SFX_BLOOD_MAP[event];
    try {
      const res = await fetch(`${basePath}/${bloodId}.wav`);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      const buf = await decodeAudio(engine, data);
      registry.set(event, buf);
    } catch (err) {
      console.warn(`[audio] failed to load ${event} (${bloodId})`, err);
    }
  }));
  return registry;
}

/** Load ambient loop buffers (wind + thunder spike). Missing files return null. */
export async function loadAmbientBuffers(
  engine: AudioEngine,
  basePath = '/assets/audio-placeholder/ambient',
): Promise<{ wind: AudioBuffer | null; spike: AudioBuffer | null }> {
  const fetchDecode = async (name: string): Promise<AudioBuffer | null> => {
    try {
      const r = await fetch(`${basePath}/${name}`);
      if (!r.ok) return null;
      return await decodeAudio(engine, await r.arrayBuffer());
    } catch { return null; }
  };
  const [wind, spike] = await Promise.all([
    fetchDecode('wind.wav'),
    fetchDecode('thunder.wav'),
  ]);
  return { wind, spike };
}
